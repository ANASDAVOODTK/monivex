package ws

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/docker/docker/api/types/container"
	"github.com/docker/docker/pkg/stdcopy"
	"github.com/go-chi/chi/v5"
	"github.com/gorilla/websocket"
	"github.com/nxadm/tail"

	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/collectors"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/hub"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		// LAN only — accept same-origin and any localhost during dev.
		return true
	},
}

type Server struct {
	hub    *hub.Hub
	cfg    *config.Config
	auth   *auth.Service
	docker *collectors.DockerCollector
}

func NewServer(h *hub.Hub, cfg *config.Config, a *auth.Service, docker *collectors.DockerCollector) *Server {
	return &Server{hub: h, cfg: cfg, auth: a, docker: docker}
}

func (s *Server) checkAuth(r *http.Request) bool {
	tok := auth.ExtractToken(r)
	if tok == "" {
		return false
	}
	_, err := s.auth.Verify(tok)
	return err == nil
}

func (s *Server) HandleMetrics(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ch := s.hub.Subscribe()
	defer s.hub.Unsubscribe(ch)

	conn.SetReadLimit(1024)
	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})
	// reader goroutine to handle pings/close
	go func() {
		for {
			if _, _, err := conn.NextReader(); err != nil {
				conn.Close()
				return
			}
		}
	}()

	pingTick := time.NewTicker(30 * time.Second)
	defer pingTick.Stop()

	for {
		select {
		case snap, ok := <-ch:
			if !ok {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteJSON(snap); err != nil {
				return
			}
		case <-pingTick.C:
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-r.Context().Done():
			return
		}
	}
}

type logFrame struct {
	Type string `json:"type"`
	Line string `json:"line,omitempty"`
	Err  string `json:"err,omitempty"`
}

func (s *Server) HandleLogs(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" || !s.isAllowed(path) {
		http.Error(w, "forbidden path", http.StatusForbidden)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	t, err := tail.TailFile(path, tail.Config{
		Follow:    true,
		ReOpen:    true,
		MustExist: true,
		Location:  &tail.SeekInfo{Offset: 0, Whence: 2}, // start at end
		Logger:    tail.DiscardingLogger,
	})
	if err != nil {
		_ = writeWS(conn, logFrame{Type: "error", Err: err.Error()})
		return
	}
	defer t.Stop()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go func() {
		for {
			if _, _, err := conn.NextReader(); err != nil {
				cancel()
				return
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			return
		case line, ok := <-t.Lines:
			if !ok {
				return
			}
			if line.Err != nil {
				_ = writeWS(conn, logFrame{Type: "error", Err: line.Err.Error()})
				continue
			}
			if err := writeWS(conn, logFrame{Type: "line", Line: line.Text}); err != nil {
				return
			}
		}
	}
}

func (s *Server) isAllowed(p string) bool {
	abs, err := filepath.Abs(p)
	if err != nil {
		return false
	}
	for _, allowed := range s.cfg.Logs.AllowedPaths {
		a, err := filepath.Abs(allowed)
		if err != nil {
			continue
		}
		if a == abs {
			return true
		}
	}
	return false
}

func writeWS(c *websocket.Conn, v any) error {
	c.SetWriteDeadline(time.Now().Add(5 * time.Second))
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return c.WriteMessage(websocket.TextMessage, b)
}

// dockerShellCmd returns the argv for an interactive shell inside the container.
// query shell=auto|bash|sh (default auto): auto runs bash when /bin/bash or /usr/bin/bash exists, else sh.
func dockerShellCmd(pref string) []string {
	switch pref {
	case "sh":
		return []string{"/bin/sh"}
	case "bash":
		return []string{"/bin/sh", "-c", "[ -x /bin/bash ] && exec /bin/bash; [ -x /usr/bin/bash ] && exec /usr/bin/bash; echo 'bash not installed in this image' >&2; exit 127"}
	default:
		// Covers "auto", "", and unknown values.
		return []string{"/bin/sh", "-c", "[ -x /bin/bash ] && exec /bin/bash; [ -x /usr/bin/bash ] && exec /usr/bin/bash; exec /bin/sh"}
	}
}

// HandleDockerExec provides a WebSocket-based interactive shell into a container.
// URL: /ws/docker/exec/{id}?token=...&shell=auto|bash|sh
// Client sends binary frames (stdin) and JSON frames for resize: {"type":"resize","cols":80,"rows":24}
// Server sends binary frames (stdout+stderr).
func (s *Server) HandleDockerExec(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	containerID := chi.URLParam(r, "id")
	if containerID == "" {
		http.Error(w, "missing container id", http.StatusBadRequest)
		return
	}

	cli := s.docker.Client()
	if cli == nil {
		http.Error(w, "docker not available", http.StatusServiceUnavailable)
		return
	}

	ctx := r.Context()

	shell := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("shell")))
	cmd := dockerShellCmd(shell)

	// Create exec instance (see dockerShellCmd: auto prefers bash when present, falls back to sh).
	execCfg := container.ExecOptions{
		Cmd:          cmd,
		AttachStdin:  true,
		AttachStdout: true,
		AttachStderr: true,
		Tty:          true,
	}
	execID, err := cli.ContainerExecCreate(ctx, containerID, execCfg)
	if err != nil {
		http.Error(w, "exec create: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Attach to exec
	hijack, err := cli.ContainerExecAttach(ctx, execID.ID, container.ExecAttachOptions{Tty: true})
	if err != nil {
		http.Error(w, "exec attach: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer hijack.Close()

	// Upgrade to WebSocket
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx2, cancel := context.WithCancel(ctx)
	defer cancel()

	// Container stdout → WebSocket
	go func() {
		defer cancel()
		buf := make([]byte, 4096)
		for {
			n, err := hijack.Reader.Read(buf)
			if n > 0 {
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if wErr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); wErr != nil {
					return
				}
			}
			if err != nil {
				if err != io.EOF {
					return
				}
				return
			}
		}
	}()

	// WebSocket → Container stdin (binary = stdin, text = control messages)
	go func() {
		defer cancel()
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			switch msgType {
			case websocket.BinaryMessage:
				if _, err := hijack.Conn.Write(data); err != nil {
					return
				}
			case websocket.TextMessage:
				// Handle resize messages: {"type":"resize","cols":80,"rows":24}
				var msg struct {
					Type string `json:"type"`
					Cols uint   `json:"cols"`
					Rows uint   `json:"rows"`
				}
				if json.Unmarshal(data, &msg) == nil && msg.Type == "resize" {
					_ = cli.ContainerExecResize(ctx, execID.ID, container.ResizeOptions{
						Height: msg.Rows,
						Width:  msg.Cols,
					})
				}
			}
		}
	}()

	<-ctx2.Done()
}

// HandleDockerLogs streams docker logs over WebSocket.
// URL: /ws/docker/logs/{id}?tail=200
// Server sends binary frames and closes when the stream ends.
func (s *Server) HandleDockerLogs(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	containerID := chi.URLParam(r, "id")
	if containerID == "" {
		http.Error(w, "missing container id", http.StatusBadRequest)
		return
	}

	cli := s.docker.Client()
	if cli == nil {
		http.Error(w, "docker not available", http.StatusServiceUnavailable)
		return
	}

	tail := strings.TrimSpace(r.URL.Query().Get("tail"))
	if tail == "" {
		tail = "200"
	}
	if _, err := strconv.Atoi(tail); err != nil {
		http.Error(w, "invalid tail", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// Reader goroutine so we can detect client disconnects.
	go func() {
		defer cancel()
		for {
			if _, _, err := conn.NextReader(); err != nil {
				return
			}
		}
	}()

	// Check if the container was started with TTY — stdcopy only works for
	// multiplexed (non-TTY) streams.
	inspect, inspErr := cli.ContainerInspect(ctx, containerID)
	isTTY := inspErr == nil && inspect.Config != nil && inspect.Config.Tty

	logs, err := cli.ContainerLogs(ctx, containerID, container.LogsOptions{
		ShowStdout: true,
		ShowStderr: true,
		Follow:     true,
		Tail:       tail,
	})
	if err != nil {
		conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
		_ = conn.WriteMessage(websocket.TextMessage, []byte("* Failed to attach logs: "+err.Error()+"\r\n"))
		return
	}
	defer logs.Close()

	var reader io.Reader
	if isTTY {
		reader = logs
	} else {
		pr, pw := io.Pipe()
		defer pr.Close()
		go func() {
			defer pw.Close()
			_, _ = stdcopy.StdCopy(pw, pw, logs)
		}()
		reader = pr
	}

	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, readErr := reader.Read(buf)
		if n > 0 {
			conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if wErr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); wErr != nil {
				return
			}
		}
		if readErr != nil {
			if readErr == io.EOF {
				return
			}
			conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			_ = conn.WriteMessage(websocket.TextMessage, []byte("* Log stream ended with error: "+readErr.Error()+"\r\n"))
			return
		}
	}
}

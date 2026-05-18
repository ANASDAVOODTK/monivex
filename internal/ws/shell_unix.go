//go:build !windows

package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/exec"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

// HandleShell opens an interactive PTY shell on the agent host and bridges it
// to a WebSocket. Client sends binary frames (stdin) and JSON control messages
// for resize: {"type":"resize","cols":80,"rows":24}. Server sends binary
// frames (PTY output).
//
// SECURITY: this is a full shell as the user running the agent process. Auth
// is checked via the same path as every other WS handler — JWT cookie or
// X-API-Key. Only mount behind a trusted LAN.
func (s *Server) HandleShell(w http.ResponseWriter, r *http.Request) {
	if !s.checkAuth(r) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}

	shellPath := pickHostShell()
	if shellPath == "" {
		http.Error(w, "no shell available on host", http.StatusInternalServerError)
		return
	}

	cmd := exec.Command(shellPath, "-l")
	cmd.Env = append(os.Environ(), "TERM=xterm-256color")

	ptmx, err := pty.Start(cmd)
	if err != nil {
		http.Error(w, "pty start: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer func() {
		_ = ptmx.Close()
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
			_, _ = cmd.Process.Wait()
		}
	}()

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	// PTY → WebSocket
	go func() {
		defer cancel()
		buf := make([]byte, 4096)
		for {
			n, err := ptmx.Read(buf)
			if n > 0 {
				conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
				if wErr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); wErr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}()

	// WebSocket → PTY (binary = stdin, text = resize control)
	go func() {
		defer cancel()
		for {
			msgType, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			switch msgType {
			case websocket.BinaryMessage:
				if _, err := ptmx.Write(data); err != nil {
					return
				}
			case websocket.TextMessage:
				var msg struct {
					Type string `json:"type"`
					Cols uint16 `json:"cols"`
					Rows uint16 `json:"rows"`
				}
				if json.Unmarshal(data, &msg) == nil && msg.Type == "resize" {
					_ = pty.Setsize(ptmx, &pty.Winsize{Cols: msg.Cols, Rows: msg.Rows})
				}
			}
		}
	}()

	<-ctx.Done()
}

func pickHostShell() string {
	if s := os.Getenv("SHELL"); s != "" {
		if _, err := os.Stat(s); err == nil {
			return s
		}
	}
	for _, candidate := range []string{"/bin/bash", "/usr/bin/bash", "/bin/sh"} {
		if _, err := os.Stat(candidate); err == nil {
			return candidate
		}
	}
	return ""
}

package ws

import (
	"context"
	"encoding/json"
	"net/http"
	"path/filepath"
	"time"

	"github.com/gorilla/websocket"
	"github.com/nxadm/tail"

	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
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
	hub  *hub.Hub
	cfg  *config.Config
	auth *auth.Service
}

func NewServer(h *hub.Hub, cfg *config.Config, a *auth.Service) *Server {
	return &Server{hub: h, cfg: cfg, auth: a}
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

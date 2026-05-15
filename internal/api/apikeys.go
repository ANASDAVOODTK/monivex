package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
)

// jwtOnlyGuard rejects requests authenticated via API key. It must run inside
// the outer auth.Middleware (which has already attached Claims to the context).
// We use this on /api-keys management endpoints so an API key can't list or
// revoke other keys.
func (s *Server) jwtOnlyGuard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c := auth.ClaimsFrom(r.Context())
		if c == nil || c.IsAPIKey() {
			writeErr(w, http.StatusForbidden, "user session required")
			return
		}
		next.ServeHTTP(w, r)
	})
}

type apiKeyOut struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	CreatedAt  int64  `json:"created_at"`
	LastUsedAt *int64 `json:"last_used_at,omitempty"`
}

func (s *Server) handleAPIKeysList(w http.ResponseWriter, r *http.Request) {
	keys, err := s.auth.ListAPIKeys(r.Context())
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	out := make([]apiKeyOut, 0, len(keys))
	for _, k := range keys {
		o := apiKeyOut{
			ID:        k.ID,
			Name:      k.Name,
			CreatedAt: k.CreatedAt.Unix(),
		}
		if k.LastUsedAt != nil {
			t := k.LastUsedAt.Unix()
			o.LastUsedAt = &t
		}
		out = append(out, o)
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleAPIKeysCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	id, secret, err := s.auth.CreateAPIKey(r.Context(), body.Name)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{
		"id":         id,
		"name":       body.Name,
		"secret":     secret, // shown once
		"created_at": time.Now().Unix(),
	})
}

func (s *Server) handleAPIKeysDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.auth.DeleteAPIKey(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

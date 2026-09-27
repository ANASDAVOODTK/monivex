package api

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
)

// Edge Function sources + secrets for template deployments whose driver
// implements templates.FunctionsSupport (Supabase). These are the local
// handlers; the hub's per-server dispatch lives in servers.go.

func (s *Server) handleFunctionsList(w http.ResponseWriter, r *http.Request) {
	info, err := s.templates.ListFunctions(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, info)
}

func (s *Server) handleFunctionFileGet(w http.ResponseWriter, r *http.Request) {
	f, err := s.templates.ReadFunctionFile(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("path"))
	if err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, f)
}

func (s *Server) handleFunctionFilePut(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Path    string `json:"path"`
		Content string `json:"content"`
	}
	// JSON escaping can roughly double the size of source text.
	r.Body = http.MaxBytesReader(w, r.Body, 2*templates.MaxFunctionFileBytes+4096)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json or file too large")
		return
	}
	if err := s.templates.WriteFunctionFile(r.Context(), chi.URLParam(r, "id"), body.Path, body.Content); err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleFunctionFileDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.templates.DeleteFunctionPath(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("path")); err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleFunctionsRestart(w http.ResponseWriter, r *http.Request) {
	if err := s.templates.RestartFunctions(r.Context(), chi.URLParam(r, "id")); err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 202, map[string]bool{"ok": true})
}

func (s *Server) handleSecretsGet(w http.ResponseWriter, r *http.Request) {
	info, err := s.templates.Secrets(r.Context(), chi.URLParam(r, "id"))
	if err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, info)
}

func (s *Server) handleSecretsPut(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Env []templates.SecretEnv `json:"env"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if body.Env == nil {
		body.Env = []templates.SecretEnv{}
	}
	if err := s.templates.SaveSecrets(r.Context(), chi.URLParam(r, "id"), body.Env); err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleSecretFilePut(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name          string `json:"name"`
		ContentBase64 string `json:"content_base64"`
	}
	r.Body = http.MaxBytesReader(w, r.Body, 2*templates.MaxSecretFileBytes)
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json or file too large")
		return
	}
	data, err := base64.StdEncoding.DecodeString(body.ContentBase64)
	if err != nil {
		writeErr(w, 400, "content_base64 is not valid base64")
		return
	}
	if err := s.templates.WriteSecretFile(r.Context(), chi.URLParam(r, "id"), body.Name, data); err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleSecretFileDelete(w http.ResponseWriter, r *http.Request) {
	if err := s.templates.DeleteSecretFile(r.Context(), chi.URLParam(r, "id"), r.URL.Query().Get("name")); err != nil {
		writeFunctionsErr(w, err)
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func writeFunctionsErr(w http.ResponseWriter, err error) {
	if errors.Is(err, fs.ErrNotExist) {
		writeErr(w, 404, "not found")
		return
	}
	writeErr(w, 400, err.Error())
}

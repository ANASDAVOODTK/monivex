package api

import (
	"encoding/json"
	"io/fs"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/hub"
	"github.com/ANASDAVOODTK/server-monitor/internal/nodejs"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
	"github.com/ANASDAVOODTK/server-monitor/internal/ws"
)

type Server struct {
	cfg       *config.Config
	store     *store.Store
	auth      *auth.Service
	hub       *hub.Hub
	ws        *ws.Server
	templates *templates.Service
	ui        fs.FS // optional: embedded UI; can be nil during dev
}

func NewServer(cfg *config.Config, st *store.Store, a *auth.Service, h *hub.Hub, tpl *templates.Service, uiFS fs.FS) *Server {
	return &Server{
		cfg:       cfg,
		store:     st,
		auth:      a,
		hub:       h,
		ws:        ws.NewServer(h, cfg, a, h.Docker()),
		templates: tpl,
		ui:        uiFS,
	}
}

func (s *Server) Handler() http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	r.Route("/api/v1", func(r chi.Router) {
		r.Use(middleware.Timeout(30 * time.Second))
		// Public
		r.Get("/health", s.handleHealth)
		r.Get("/setup/status", s.handleSetupStatus)
		r.Post("/setup", s.handleSetup)
		r.Post("/auth/login", s.handleLogin)
		r.Post("/auth/logout", s.handleLogout)

		// Protected
		r.Group(func(r chi.Router) {
			r.Use(s.auth.Middleware)
			r.Get("/me", s.handleMe)
			r.Post("/auth/password", s.handlePasswordChange)
			r.Get("/snapshot", s.handleSnapshot)
			r.Get("/processes", s.handleProcesses)
			r.Get("/services", s.handleServices)
			r.Get("/docker/containers", s.handleDocker)
			r.Post("/docker/containers/{id}/start", s.handleDockerStart)
			r.Post("/docker/containers/{id}/stop", s.handleDockerStop)
			r.Post("/docker/containers/{id}/restart", s.handleDockerRestart)
			r.Get("/node-apps", s.handleNodeApps)
			r.Post("/node-apps", s.handleNodeAppsCreate)
			r.Post("/node-apps/{pmId}/start", s.handleNodeAppStart)
			r.Post("/node-apps/{pmId}/stop", s.handleNodeAppStop)
			r.Post("/node-apps/{pmId}/restart", s.handleNodeAppRestart)
			r.Post("/node-apps/{pmId}/delete", s.handleNodeAppDelete)
			r.Get("/history", s.handleHistory)
			r.Get("/logs/sources", s.handleLogSources)
			r.Get("/templates", s.handleTemplatesList)
			r.Get("/templates/{templateId}", s.handleTemplateGet)
			r.Get("/templates/{templateId}/defaults", s.handleTemplateDefaults)
			r.Post("/templates/{templateId}/deploy", s.handleTemplateDeploy)
			r.Get("/templates/deployments", s.handleDeploymentsList)
			r.Get("/templates/deployments/{id}", s.handleDeploymentGet)
			r.Get("/templates/deployments/{id}/events", s.handleDeploymentEvents)
			r.Post("/templates/deployments/{id}/start", s.handleDeploymentStart)
			r.Post("/templates/deployments/{id}/stop", s.handleDeploymentStop)
			r.Post("/templates/deployments/{id}/update", s.handleDeploymentUpdate)
			r.Post("/templates/deployments/{id}/edit", s.handleDeploymentEdit)
			r.Post("/templates/deployments/{id}/delete", s.handleDeploymentDelete)
		})
	})

	// WebSockets — auth checked inside the handler (token via cookie or ?token=)
	r.Get("/ws/metrics", s.ws.HandleMetrics)
	r.Get("/ws/logs", s.ws.HandleLogs)
	r.Get("/ws/docker/exec/{id}", s.ws.HandleDockerExec)
	r.Get("/ws/docker/logs/{id}", s.ws.HandleDockerLogs)

	// Static UI
	if s.ui != nil {
		r.Handle("/*", s.spaHandler())
	}
	return r
}

// ---- Handlers ----

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"ok": true, "time": time.Now()})
}

func (s *Server) handleSetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]bool{"needs_setup": s.auth.NeedsSetup()})
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Token    string `json:"token"`
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if !s.auth.ConsumeSetupToken(body.Token) {
		writeErr(w, 403, "invalid setup token")
		return
	}
	if _, err := s.auth.Register(r.Context(), body.Username, body.Password); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	tok, err := s.auth.Login(r.Context(), body.Username, body.Password)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	http.SetCookie(w, s.auth.IssueCookie(tok, s.cfg.Server.TLS.Enabled))
	writeJSON(w, 200, map[string]string{"token": tok})
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	tok, err := s.auth.Login(r.Context(), body.Username, body.Password)
	if err != nil {
		writeErr(w, 401, "invalid credentials")
		return
	}
	http.SetCookie(w, s.auth.IssueCookie(tok, s.cfg.Server.TLS.Enabled))
	writeJSON(w, 200, map[string]string{"token": tok})
}

func (s *Server) handleLogout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, s.auth.ClearCookie(s.cfg.Server.TLS.Enabled))
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleMe(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	writeJSON(w, 200, map[string]any{"username": c.Username, "uid": c.UserID})
}

func (s *Server) handlePasswordChange(w http.ResponseWriter, r *http.Request) {
	c := auth.ClaimsFrom(r.Context())
	var body struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if err := s.auth.ChangePassword(r.Context(), c.Username, body.OldPassword, body.NewPassword); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleSnapshot(w http.ResponseWriter, r *http.Request) {
	last := s.hub.Last()
	if last == nil {
		writeErr(w, 503, "warming up")
		return
	}
	writeJSON(w, 200, last)
}

func (s *Server) handleProcesses(w http.ResponseWriter, r *http.Request) {
	last := s.hub.Last()
	if last == nil {
		writeJSON(w, 200, []any{})
		return
	}
	writeJSON(w, 200, last.Processes)
}

func (s *Server) handleServices(w http.ResponseWriter, r *http.Request) {
	last := s.hub.Last()
	if last == nil {
		writeJSON(w, 200, []any{})
		return
	}
	writeJSON(w, 200, last.Services)
}

func (s *Server) handleDocker(w http.ResponseWriter, r *http.Request) {
	last := s.hub.Last()
	if last == nil {
		writeJSON(w, 200, []any{})
		return
	}
	writeJSON(w, 200, last.Docker)
}

func (s *Server) handleDockerStart(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.hub.Docker().StartContainer(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleDockerStop(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.hub.Docker().StopContainer(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleDockerRestart(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.hub.Docker().RestartContainer(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) nodeMgr() *nodejs.Manager {
	return &nodejs.Manager{
		PM2Path:               s.cfg.NodeJS.PM2Path,
		AllowedScriptPrefixes: s.cfg.NodeJS.AllowedScriptPrefixes,
	}
}

func (s *Server) handleNodeApps(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.NodeJS.Enabled {
		writeJSON(w, 200, map[string]any{
			"enabled": false,
			"pm2":     map[string]any{"available": false},
			"apps":    []any{},
		})
		return
	}
	m := s.nodeMgr()
	avail, ver, errMsg := m.Status(r.Context())
	pm2meta := map[string]any{
		"available":        avail,
		"version":          ver,
		"error":            errMsg,
		"can_start_new":    len(s.cfg.NodeJS.AllowedScriptPrefixes) > 0,
		"allowed_prefixes": s.cfg.NodeJS.AllowedScriptPrefixes,
	}
	out := map[string]any{"enabled": true, "pm2": pm2meta}
	if !avail {
		out["apps"] = []any{}
		writeJSON(w, 200, out)
		return
	}
	apps, err := m.List(r.Context())
	if err != nil {
		out["apps"] = []any{}
		pm2meta["list_error"] = err.Error()
		writeJSON(w, 200, out)
		return
	}
	out["apps"] = apps
	writeJSON(w, 200, out)
}

func (s *Server) handleNodeAppsCreate(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.NodeJS.Enabled {
		writeErr(w, 403, "nodejs disabled in config")
		return
	}
	if len(s.cfg.NodeJS.AllowedScriptPrefixes) == 0 {
		writeErr(w, 403, "configure nodejs.allowed_script_prefixes to enable starting apps from the UI")
		return
	}
	var body struct {
		Script string `json:"script"`
		Name   string `json:"name"`
		Cwd    string `json:"cwd"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if err := s.nodeMgr().StartNew(r.Context(), body.Script, body.Name, body.Cwd); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func parsePMID(w http.ResponseWriter, r *http.Request) (int, bool) {
	sid := chi.URLParam(r, "pmId")
	id, err := strconv.Atoi(sid)
	if err != nil || id < 0 {
		writeErr(w, 400, "bad pm id")
		return 0, false
	}
	return id, true
}

func (s *Server) handleNodeAppStart(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.NodeJS.Enabled {
		writeErr(w, 403, "nodejs disabled")
		return
	}
	id, ok := parsePMID(w, r)
	if !ok {
		return
	}
	if err := s.nodeMgr().Start(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleNodeAppStop(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.NodeJS.Enabled {
		writeErr(w, 403, "nodejs disabled")
		return
	}
	id, ok := parsePMID(w, r)
	if !ok {
		return
	}
	if err := s.nodeMgr().Stop(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleNodeAppRestart(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.NodeJS.Enabled {
		writeErr(w, 403, "nodejs disabled")
		return
	}
	id, ok := parsePMID(w, r)
	if !ok {
		return
	}
	if err := s.nodeMgr().Restart(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleNodeAppDelete(w http.ResponseWriter, r *http.Request) {
	if !s.cfg.NodeJS.Enabled {
		writeErr(w, 403, "nodejs disabled")
		return
	}
	id, ok := parsePMID(w, r)
	if !ok {
		return
	}
	if err := s.nodeMgr().Delete(r.Context(), id); err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleHistory(w http.ResponseWriter, r *http.Request) {
	rangeStr := r.URL.Query().Get("range")
	if rangeStr == "" {
		rangeStr = "1h"
	}
	dur, err := time.ParseDuration(rangeStr)
	if err != nil {
		writeErr(w, 400, "bad range")
		return
	}
	now := time.Now()
	from := now.Add(-dur)

	table := "metrics_short"
	if dur > 6*time.Hour {
		table = "metrics_long"
	}
	rows, err := s.store.QueryRange(r.Context(), table, from, now)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	out := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		var payload map[string]any
		_ = json.Unmarshal(row.Payload, &payload)
		out = append(out, payload)
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleLogSources(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.cfg.Logs.AllowedPaths)
}

// ---- Templates ----

func (s *Server) handleTemplatesList(w http.ResponseWriter, r *http.Request) {
	avail, ver, msg := s.templates.EngineStatus(r.Context())
	writeJSON(w, 200, map[string]any{
		"engine": map[string]any{
			"available": avail,
			"version":   ver,
			"error":     msg,
		},
		"templates":    s.templates.Definitions(),
		"storage_root": s.templates.StorageRoot(),
	})
}

func (s *Server) handleTemplateGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "templateId")
	def, err := s.templates.Definition(id)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, def)
}

func (s *Server) handleTemplateDefaults(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "templateId")
	d, err := s.templates.GenerateDefaults(r.Context(), id)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, d)
}

func (s *Server) handleTemplateDeploy(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "templateId")
	var input templates.DeployInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	d, err := s.templates.Deploy(r.Context(), id, input)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 202, d)
}

func (s *Server) handleDeploymentsList(w http.ResponseWriter, r *http.Request) {
	list, err := s.templates.List(r.Context())
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if list == nil {
		list = []templates.DeploymentSummary{}
	}
	writeJSON(w, 200, list)
}

func (s *Server) handleDeploymentGet(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	d, err := s.templates.Get(r.Context(), id)
	if err != nil {
		writeErr(w, 404, err.Error())
		return
	}
	writeJSON(w, 200, d)
}

func (s *Server) handleDeploymentEvents(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	limit := 100
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 {
			limit = n
		}
	}
	events, err := s.templates.Events(r.Context(), id, limit)
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	if events == nil {
		events = []templates.Event{}
	}
	writeJSON(w, 200, events)
}

func (s *Server) handleDeploymentStart(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.templates.Start(r.Context(), id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 202, map[string]bool{"ok": true})
}

func (s *Server) handleDeploymentStop(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.templates.Stop(r.Context(), id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 202, map[string]bool{"ok": true})
}

func (s *Server) handleDeploymentUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.templates.Update(r.Context(), id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 202, map[string]bool{"ok": true})
}

func (s *Server) handleDeploymentEdit(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var input templates.EditInput
	if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	d, err := s.templates.UpdateConfig(r.Context(), id, input)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 202, d)
}

func (s *Server) handleDeploymentDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	removeVolumes := r.URL.Query().Get("volumes") == "true"
	if err := s.templates.Delete(r.Context(), id, removeVolumes); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 202, map[string]bool{"ok": true})
}

// SPA handler: serve embedded UI; for unknown extensionless paths fall back to index.html.
func (s *Server) spaHandler() http.Handler {
	fileServer := http.FileServer(http.FS(s.ui))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(r.URL.Path, "/")
		if clean == "" {
			r2 := *r
			r2.URL.Path = "/index.html"
			fileServer.ServeHTTP(w, &r2)
			return
		}
		if _, err := fs.Stat(s.ui, clean); err != nil {
			if filepath.Ext(clean) == "" {
				// SPA route — serve index.html so client-side router takes over.
				r2 := *r
				r2.URL.Path = "/index.html"
				fileServer.ServeHTTP(w, &r2)
				return
			}
			http.NotFound(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}

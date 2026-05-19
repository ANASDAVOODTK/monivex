package api

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/ANASDAVOODTK/server-monitor/internal/metrics"
	"github.com/ANASDAVOODTK/server-monitor/internal/pairing"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
	"github.com/ANASDAVOODTK/server-monitor/internal/ws"
)

// serverSummary is the shape returned by GET /api/v1/servers.
type serverSummary struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	BaseURL    string  `json:"base_url"`
	IsSelf     bool    `json:"is_self"`
	Enabled    bool    `json:"enabled"`
	Connected  bool    `json:"connected"`
	LastSeen   int64   `json:"last_seen,omitempty"`
	LastError  string  `json:"last_error,omitempty"`
	Hostname   string  `json:"hostname,omitempty"`
	Kernel     string  `json:"kernel,omitempty"`
	Uptime     uint64  `json:"uptime,omitempty"`
	CPUPercent float64 `json:"cpu_percent,omitempty"`
	MemPercent float64 `json:"mem_percent,omitempty"`
	DiskUsed   float64 `json:"disk_percent,omitempty"`
}

func (s *Server) handleServersList(w http.ResponseWriter, r *http.Request) {
	rows, err := s.registry.List(r.Context())
	if err != nil {
		writeErr(w, 500, err.Error())
		return
	}
	states := s.aggregator.StatesByID()
	out := make([]serverSummary, 0, len(rows))
	for _, sv := range rows {
		sum := serverSummary{
			ID:      sv.ID,
			Name:    sv.Name,
			BaseURL: sv.BaseURL,
			IsSelf:  sv.IsSelf,
			Enabled: sv.Enabled,
		}
		if sv.LastError != "" {
			sum.LastError = sv.LastError
		}
		if st, ok := states[sv.ID]; ok {
			sum.Connected = st.Connected
			if !st.LastSeen.IsZero() {
				sum.LastSeen = st.LastSeen.Unix()
			}
			if st.LastError != "" {
				sum.LastError = st.LastError
			}
			if snap := st.Snapshot; snap != nil {
				sum.Hostname = snap.Host.Hostname
				sum.Kernel = snap.Host.KernelVersion
				sum.Uptime = snap.Host.Uptime
				sum.CPUPercent = snap.CPU.Overall
				sum.MemPercent = snap.Memory.UsedPercent
				if d := primaryDisk(snap); d != nil {
					sum.DiskUsed = d.UsedPercent
				}
			}
		}
		out = append(out, sum)
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleServerCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string `json:"name"`
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
		Pairing string `json:"pairing"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	// A "sm://..." pairing string takes precedence — it carries url + key
	// in one field so the UI only needs a single textbox.
	if strings.HasPrefix(strings.TrimSpace(body.Pairing), pairing.Prefix) {
		d, err := pairing.Decode(body.Pairing)
		if err != nil {
			writeErr(w, 400, "bad pairing token: "+err.Error())
			return
		}
		body.BaseURL = d.URL
		body.APIKey = d.Key
		if body.Name == "" {
			body.Name = d.Note
		}
	}
	sv, err := s.registry.Create(r.Context(), body.Name, body.BaseURL, body.APIKey)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 201, serverRowJSON(sv))
}

func (s *Server) handleServerUpdate(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var body struct {
		Name    string `json:"name"`
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
		Enabled *bool  `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	current, err := s.registry.Get(r.Context(), id)
	if err != nil || current == nil {
		writeErr(w, 404, "not found")
		return
	}
	enabled := current.Enabled
	if body.Enabled != nil {
		enabled = *body.Enabled
	}
	sv, err := s.registry.Update(r.Context(), id, body.Name, body.BaseURL, body.APIKey, enabled)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, serverRowJSON(sv))
}

func (s *Server) handleServerDelete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := s.registry.Delete(r.Context(), id); err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) handleServerTest(w http.ResponseWriter, r *http.Request) {
	var body struct {
		BaseURL string `json:"base_url"`
		APIKey  string `json:"api_key"`
		Pairing string `json:"pairing"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeErr(w, 400, "bad json")
		return
	}
	if strings.HasPrefix(strings.TrimSpace(body.Pairing), pairing.Prefix) {
		d, err := pairing.Decode(body.Pairing)
		if err != nil {
			writeErr(w, 400, "bad pairing token: "+err.Error())
			return
		}
		body.BaseURL = d.URL
		body.APIKey = d.Key
	}
	host, err := s.registry.TestConnection(r.Context(), body.BaseURL, body.APIKey)
	if err != nil {
		writeErr(w, 400, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{
		"ok":   true,
		"host": host,
	})
}

func serverRowJSON(sv *store.Server) map[string]any {
	if sv == nil {
		return nil
	}
	return map[string]any{
		"id":       sv.ID,
		"name":     sv.Name,
		"base_url": sv.BaseURL,
		"is_self":  sv.IsSelf,
		"enabled":  sv.Enabled,
	}
}

// resolveServer returns the server row + decrypted API key (empty for self).
// Returns nil, "", false on 404 (also writes the response).
func (s *Server) resolveServer(w http.ResponseWriter, r *http.Request) (*store.Server, string, bool) {
	id := chi.URLParam(r, "serverId")
	sv, err := s.registry.Get(r.Context(), id)
	if err != nil {
		writeErr(w, 500, err.Error())
		return nil, "", false
	}
	if sv == nil || !sv.Enabled {
		writeErr(w, 404, "server not found")
		return nil, "", false
	}
	apiKey, err := s.registry.DecryptKey(sv)
	if err != nil {
		writeErr(w, 500, "decrypt key: "+err.Error())
		return nil, "", false
	}
	return sv, apiKey, true
}

// ----- per-server route registration -----

// registerServerScopedRoutes installs handlers under /api/v1/servers/{serverId}/...
// that, for self, dispatch to the existing local handlers, and for remotes,
// proxy to <base_url>/api/v1/... with X-API-Key.
func (s *Server) registerServerScopedRoutes(r chi.Router) {
	r.Get("/snapshot", s.scoped("/api/v1/snapshot", s.handleSnapshot))
	r.Get("/processes", s.scoped("/api/v1/processes", s.handleProcesses))
	r.Get("/services", s.scoped("/api/v1/services", s.handleServices))
	r.Get("/docker/containers", s.scoped("/api/v1/docker/containers", s.handleDocker))
	r.Post("/docker/containers/{id}/start", s.scopedDocker("start"))
	r.Post("/docker/containers/{id}/stop", s.scopedDocker("stop"))
	r.Post("/docker/containers/{id}/restart", s.scopedDocker("restart"))
	r.Get("/node-apps", s.scoped("/api/v1/node-apps", s.handleNodeApps))
	r.Post("/node-apps", s.scoped("/api/v1/node-apps", s.handleNodeAppsCreate))
	r.Post("/node-apps/{pmId}/start", s.scopedNodeApp("start"))
	r.Post("/node-apps/{pmId}/stop", s.scopedNodeApp("stop"))
	r.Post("/node-apps/{pmId}/restart", s.scopedNodeApp("restart"))
	r.Post("/node-apps/{pmId}/delete", s.scopedNodeApp("delete"))
	r.Get("/history", s.scoped("/api/v1/history", s.handleHistory))
	r.Get("/logs/sources", s.scoped("/api/v1/logs/sources", s.handleLogSources))
	r.Get("/templates", s.scoped("/api/v1/templates", s.handleTemplatesList))
	r.Get("/templates/{templateId}", s.scopedTemplateGet("get"))
	r.Get("/templates/{templateId}/defaults", s.scopedTemplateGet("defaults"))
	r.Post("/templates/{templateId}/deploy", s.scopedTemplateGet("deploy"))
	r.Get("/templates/deployments", s.scoped("/api/v1/templates/deployments", s.handleDeploymentsList))
	r.Get("/templates/deployments/{id}", s.scopedDeployment("get"))
	r.Get("/templates/deployments/{id}/events", s.scopedDeployment("events"))
	r.Get("/templates/deployments/{id}/backups", s.scopedDeployment("backups"))
	r.Post("/templates/deployments/{id}/start", s.scopedDeployment("start"))
	r.Post("/templates/deployments/{id}/stop", s.scopedDeployment("stop"))
	r.Post("/templates/deployments/{id}/update", s.scopedDeployment("update"))
	r.Post("/templates/deployments/{id}/edit", s.scopedDeployment("edit"))
	r.Post("/templates/deployments/{id}/delete", s.scopedDeployment("delete"))
}

// scoped wraps a local handler with self/remote dispatch. The upstreamPath
// argument is what we forward to (relative to /api/v1).
func (s *Server) scoped(upstreamPath string, localHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sv, apiKey, ok := s.resolveServer(w, r)
		if !ok {
			return
		}
		if sv.IsSelf {
			localHandler(w, r)
			return
		}
		proxyHTTP(w, r, sv.BaseURL, apiKey, upstreamPath)
	}
}

func (s *Server) scopedDocker(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sv, apiKey, ok := s.resolveServer(w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "id")
		path := "/api/v1/docker/containers/" + id + "/" + action
		if sv.IsSelf {
			r = withChiParam(r, "id", id)
			switch action {
			case "start":
				s.handleDockerStart(w, r)
			case "stop":
				s.handleDockerStop(w, r)
			case "restart":
				s.handleDockerRestart(w, r)
			}
			return
		}
		proxyHTTP(w, r, sv.BaseURL, apiKey, path)
	}
}

func (s *Server) scopedNodeApp(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sv, apiKey, ok := s.resolveServer(w, r)
		if !ok {
			return
		}
		pmID := chi.URLParam(r, "pmId")
		path := "/api/v1/node-apps/" + pmID + "/" + action
		if sv.IsSelf {
			r = withChiParam(r, "pmId", pmID)
			switch action {
			case "start":
				s.handleNodeAppStart(w, r)
			case "stop":
				s.handleNodeAppStop(w, r)
			case "restart":
				s.handleNodeAppRestart(w, r)
			case "delete":
				s.handleNodeAppDelete(w, r)
			}
			return
		}
		proxyHTTP(w, r, sv.BaseURL, apiKey, path)
	}
}

func (s *Server) scopedTemplateGet(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sv, apiKey, ok := s.resolveServer(w, r)
		if !ok {
			return
		}
		templateID := chi.URLParam(r, "templateId")
		var path string
		switch action {
		case "get":
			path = "/api/v1/templates/" + templateID
		case "defaults":
			path = "/api/v1/templates/" + templateID + "/defaults"
		case "deploy":
			path = "/api/v1/templates/" + templateID + "/deploy"
		}
		if sv.IsSelf {
			r = withChiParam(r, "templateId", templateID)
			switch action {
			case "get":
				s.handleTemplateGet(w, r)
			case "defaults":
				s.handleTemplateDefaults(w, r)
			case "deploy":
				s.handleTemplateDeploy(w, r)
			}
			return
		}
		proxyHTTP(w, r, sv.BaseURL, apiKey, path)
	}
}

func (s *Server) scopedDeployment(action string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sv, apiKey, ok := s.resolveServer(w, r)
		if !ok {
			return
		}
		depID := chi.URLParam(r, "id")
		path := "/api/v1/templates/deployments/" + depID
		switch action {
		case "events":
			path += "/events"
		case "backups":
			path += "/backups"
		case "start", "stop", "update", "edit", "delete":
			path += "/" + action
		}
		if sv.IsSelf {
			r = withChiParam(r, "id", depID)
			switch action {
			case "get":
				s.handleDeploymentGet(w, r)
			case "events":
				s.handleDeploymentEvents(w, r)
			case "backups":
				s.handleDeploymentBackups(w, r)
			case "start":
				s.handleDeploymentStart(w, r)
			case "stop":
				s.handleDeploymentStop(w, r)
			case "update":
				s.handleDeploymentUpdate(w, r)
			case "edit":
				s.handleDeploymentEdit(w, r)
			case "delete":
				s.handleDeploymentDelete(w, r)
			}
			return
		}
		proxyHTTP(w, r, sv.BaseURL, apiKey, path)
	}
}

// withChiParam returns a request whose chi route context has the given URL
// param. Some local handlers read chi.URLParam(r, "<name>") even though the
// request was matched by the server-scoped route; we re-inject the value so
// they keep working without modification.
func withChiParam(r *http.Request, name, value string) *http.Request {
	rctx := chi.RouteContext(r.Context())
	if rctx == nil {
		rctx = chi.NewRouteContext()
	}
	rctx.URLParams.Add(name, value)
	return r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rctx))
}

// ----- server-scoped WebSockets -----

func (s *Server) handleScopedWSMetrics(w http.ResponseWriter, r *http.Request) {
	sv, apiKey, ok := s.resolveServer(w, r)
	if !ok {
		return
	}
	if sv.IsSelf {
		s.ws.HandleMetrics(w, r)
		return
	}
	ws.Proxy(w, r, sv.BaseURL, apiKey, "/ws/metrics", r.URL.RawQuery)
}

func (s *Server) handleScopedWSLogs(w http.ResponseWriter, r *http.Request) {
	sv, apiKey, ok := s.resolveServer(w, r)
	if !ok {
		return
	}
	if sv.IsSelf {
		s.ws.HandleLogs(w, r)
		return
	}
	ws.Proxy(w, r, sv.BaseURL, apiKey, "/ws/logs", r.URL.RawQuery)
}

func (s *Server) handleScopedWSDockerExec(w http.ResponseWriter, r *http.Request) {
	sv, apiKey, ok := s.resolveServer(w, r)
	if !ok {
		return
	}
	cid := chi.URLParam(r, "id")
	if sv.IsSelf {
		r = withChiParam(r, "id", cid)
		s.ws.HandleDockerExec(w, r)
		return
	}
	ws.Proxy(w, r, sv.BaseURL, apiKey, "/ws/docker/exec/"+cid, r.URL.RawQuery)
}

func (s *Server) handleScopedWSDockerLogs(w http.ResponseWriter, r *http.Request) {
	sv, apiKey, ok := s.resolveServer(w, r)
	if !ok {
		return
	}
	cid := chi.URLParam(r, "id")
	if sv.IsSelf {
		r = withChiParam(r, "id", cid)
		s.ws.HandleDockerLogs(w, r)
		return
	}
	ws.Proxy(w, r, sv.BaseURL, apiKey, "/ws/docker/logs/"+cid, r.URL.RawQuery)
}

func (s *Server) handleScopedWSShell(w http.ResponseWriter, r *http.Request) {
	sv, apiKey, ok := s.resolveServer(w, r)
	if !ok {
		return
	}
	if sv.IsSelf {
		s.ws.HandleShell(w, r)
		return
	}
	ws.Proxy(w, r, sv.BaseURL, apiKey, "/ws/shell", r.URL.RawQuery)
}

// primaryDisk picks the root mount, or the first disk if no root is found.
func primaryDisk(snap *metrics.Snapshot) *metrics.Disk {
	if snap == nil {
		return nil
	}
	for i := range snap.Disks {
		if snap.Disks[i].Mountpoint == "/" {
			return &snap.Disks[i]
		}
	}
	if len(snap.Disks) > 0 {
		return &snap.Disks[0]
	}
	return nil
}

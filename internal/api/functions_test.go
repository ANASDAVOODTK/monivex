package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ANASDAVOODTK/server-monitor/internal/aggregator"
	"github.com/ANASDAVOODTK/server-monitor/internal/auth"
	"github.com/ANASDAVOODTK/server-monitor/internal/config"
	"github.com/ANASDAVOODTK/server-monitor/internal/hub"
	"github.com/ANASDAVOODTK/server-monitor/internal/servers"
	"github.com/ANASDAVOODTK/server-monitor/internal/store"
	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
	supabasetpl "github.com/ANASDAVOODTK/server-monitor/internal/templates/supabase"
)

// TestFunctionsAPIThroughServerScope drives the Edge Functions endpoints the
// way the UI does: via /servers/{self}/templates/deployments/{id}/..., which
// exercises the hub's scoped dispatch as well as the local handlers.
func TestFunctionsAPIThroughServerScope(t *testing.T) {
	ctx := context.Background()
	dir := t.TempDir()
	cfg := config.Default()
	cfg.DataDir = dir
	cfg.Docker.Enabled = false
	cfg.GPU.Enabled = false

	st, err := store.Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	authSvc, err := auth.New(ctx, st)
	if err != nil {
		t.Fatal(err)
	}
	_, apiKey, err := authSvc.CreateAPIKey(ctx, "test")
	if err != nil {
		t.Fatal(err)
	}
	h := hub.New(cfg, st)
	defer h.Close()
	reg := templates.NewRegistry()
	reg.Register(supabasetpl.New())
	tpl := templates.NewService(reg, st, dir, "")
	registry, err := servers.New(st, authSvc.Secret())
	if err != nil {
		t.Fatal(err)
	}
	self, err := registry.EnsureSelf(ctx, "self")
	if err != nil {
		t.Fatal(err)
	}
	srv := NewServer(cfg, st, authSvc, h, tpl, registry, aggregator.New(registry, h), nil)

	workDir := filepath.Join(tpl.StorageRoot(), "acme")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := st.CreateTemplateDeployment(ctx, store.TemplateDeployment{
		ID: "d1", TemplateID: "supabase", Name: "acme", Slug: "acme", Status: templates.StatusStopped,
		ConfigJSON: []byte(`{}`), PortsJSON: []byte(`{"kong_http":8000}`), WorkDir: workDir,
	}, nil); err != nil {
		t.Fatal(err)
	}

	ts := httptest.NewServer(srv.Handler())
	defer ts.Close()
	base := ts.URL + "/api/v1/servers/" + self.ID + "/templates/deployments/d1"

	call := func(method, path string, body any) (int, map[string]any) {
		t.Helper()
		var rdr io.Reader
		if body != nil {
			b, _ := json.Marshal(body)
			rdr = bytes.NewReader(b)
		}
		req, _ := http.NewRequest(method, base+path, rdr)
		req.Header.Set("X-API-Key", apiKey)
		req.Header.Set("Content-Type", "application/json")
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatalf("%s %s: %v", method, path, err)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		return resp.StatusCode, out
	}

	code, out := call("GET", "/functions", nil)
	if code != 200 || out["enabled"] != true {
		t.Fatalf("list: %d %v", code, out)
	}

	code, out = call("PUT", "/functions/file", map[string]string{"path": "hello/index.ts", "content": "Deno.serve(() => new Response('hi'))\n"})
	if code != 200 {
		t.Fatalf("save: %d %v", code, out)
	}
	if code, out = call("PUT", "/functions/file", map[string]string{"path": "../escape.ts", "content": "x"}); code != 400 {
		t.Errorf("path escape should be 400, got %d %v", code, out)
	}

	code, out = call("GET", "/functions/file?path=hello/index.ts", nil)
	if code != 200 || !strings.Contains(out["content"].(string), "Response('hi')") {
		t.Fatalf("read: %d %v", code, out)
	}
	if code, _ = call("GET", "/functions/file?path=nope/index.ts", nil); code != 404 {
		t.Errorf("missing file should be 404, got %d", code)
	}

	code, out = call("PUT", "/secrets", map[string]any{"env": []map[string]string{
		{"key": "APNS_KEY_ID", "value": "ABC123"},
		{"key": "APNS_PRIVATE_KEY_FILE", "value": "/run/secrets/AuthKey.p8"},
	}})
	if code != 200 {
		t.Fatalf("save secrets: %d %v", code, out)
	}
	if code, _ = call("PUT", "/secrets", map[string]any{"env": []map[string]string{{"key": "SUPABASE_URL", "value": "x"}}}); code != 400 {
		t.Errorf("reserved secret should be 400, got %d", code)
	}
	p8 := base64.StdEncoding.EncodeToString([]byte("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"))
	if code, out = call("PUT", "/secrets/files", map[string]string{"name": "AuthKey.p8", "content_base64": p8}); code != 200 {
		t.Fatalf("upload secret file: %d %v", code, out)
	}

	code, out = call("GET", "/secrets", nil)
	env, _ := out["env"].([]any)
	files, _ := out["files"].([]any)
	if code != 200 || len(env) != 2 || len(files) != 1 {
		t.Fatalf("secrets listing: %d %v", code, out)
	}
	if files[0].(map[string]any)["container_path"] != "/run/secrets/AuthKey.p8" {
		t.Errorf("unexpected container path: %v", files[0])
	}
	if _, err := os.Stat(filepath.Join(workDir, "volumes", "secrets", "AuthKey.p8")); err != nil {
		t.Errorf("secret file not written under volumes/secrets: %v", err)
	}

	// The deployment is stopped, so applying must be refused with a clear reason.
	if code, out = call("POST", "/functions/restart", nil); code != 400 || !strings.Contains(out["error"].(string), "stopped") {
		t.Errorf("restart of stopped deployment: %d %v", code, out)
	}

	if code, _ = call("DELETE", "/functions/file?path=main", nil); code != 400 {
		t.Errorf("deleting the main worker should be refused, got %d", code)
	}
	if code, out = call("DELETE", "/functions/file?path=hello", nil); code != 200 {
		t.Errorf("delete function: %d %v", code, out)
	}
	if code, out = call("DELETE", "/secrets/files?name=AuthKey.p8", nil); code != 200 {
		t.Errorf("delete secret file: %d %v", code, out)
	}
}

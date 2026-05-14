package supabase

import (
	"strings"
	"testing"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
)

func TestValidateRequiredFields(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name:   "demo",
		Config: map[string]string{},
	})
	if err == nil {
		t.Errorf("expected error for missing fields")
	}
}

func TestValidateRejectsShortJWT(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name: "demo",
		Config: map[string]string{
			"jwt_secret":         "short",
			"anon_key":           "a",
			"service_role_key":   "b",
			"dashboard_password": "supersecret",
			"postgres_password":  "supersecret",
		},
	})
	if err == nil || !strings.Contains(err.Error(), "jwt_secret") {
		t.Errorf("expected jwt_secret length error, got %v", err)
	}
}

func TestValidateAcceptsValidInput(t *testing.T) {
	d := New()
	in := validInput()
	if err := d.Validate(in); err != nil {
		t.Errorf("expected no error, got %v", err)
	}
}

func TestValidateRejectsBadEnv(t *testing.T) {
	d := New()
	in := validInput()
	in.Env = map[string]string{"1bad": "v"}
	if err := d.Validate(in); err == nil {
		t.Errorf("expected env var name error")
	}
}

func TestRenderProducesAllArtifacts(t *testing.T) {
	d := New()
	dep := &templates.Deployment{
		ID:         "abc",
		TemplateID: "supabase",
		Name:       "Acme",
		Slug:       "acme",
		Status:     templates.StatusDeploying,
		Config: map[string]string{
			"jwt_secret":         strings.Repeat("x", 32),
			"anon_key":           "ANON",
			"service_role_key":   "SERVICE",
			"dashboard_user":     "supabase",
			"dashboard_password": "studiopass",
			"postgres_password":  "dbpass1234",
			"postgres_db":        "postgres",
		},
		Ports: map[string]int{
			"studio":     3000,
			"kong_http":  8000,
			"kong_https": 8443,
			"postgres":   54322,
		},
		Env: map[string]string{
			"EXTRA_VAR": "1",
		},
		WorkDir:   "/tmp/acme",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	rendered, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render error: %v", err)
	}
	if !strings.Contains(rendered.Compose, "name: acme") {
		t.Errorf("compose missing project name. got:\n%s", rendered.Compose)
	}
	if !strings.Contains(rendered.Compose, "${POSTGRES_PASSWORD}") {
		t.Errorf("compose missing env reference")
	}
	if !strings.Contains(rendered.Env, "POSTGRES_PASSWORD=dbpass1234") {
		t.Errorf("env missing password. got:\n%s", rendered.Env)
	}
	if !strings.Contains(rendered.Env, "EXTRA_VAR=1") {
		t.Errorf("env missing user-provided var")
	}
	kong, ok := rendered.Files["volumes/kong.yml"]
	if !ok {
		t.Fatalf("kong.yml not generated, files: %v", keys(rendered.Files))
	}
	if !strings.Contains(kong, "auth-v1") {
		t.Errorf("kong.yml missing auth-v1 route")
	}
}

func TestRenderIsDeterministic(t *testing.T) {
	d := New()
	dep := buildDeployment()
	a, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render error: %v", err)
	}
	b, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render error: %v", err)
	}
	if a.Compose != b.Compose || a.Env != b.Env {
		t.Errorf("render not deterministic")
	}
}

func validInput() templates.DeployInput {
	return templates.DeployInput{
		Name: "demo",
		Config: map[string]string{
			"jwt_secret":         strings.Repeat("a", 32),
			"anon_key":           "a",
			"service_role_key":   "b",
			"dashboard_password": "studiopass",
			"postgres_password":  "dbpass1234",
		},
		Ports: map[string]int{
			"studio":     3000,
			"kong_http":  8000,
			"kong_https": 8443,
			"postgres":   54322,
		},
	}
}

func buildDeployment() *templates.Deployment {
	return &templates.Deployment{
		ID: "abc", TemplateID: "supabase", Name: "Acme", Slug: "acme",
		Status: templates.StatusDeploying,
		Config: map[string]string{
			"jwt_secret":         strings.Repeat("x", 32),
			"anon_key":           "ANON",
			"service_role_key":   "SERVICE",
			"dashboard_user":     "supabase",
			"dashboard_password": "studiopass",
			"postgres_password":  "dbpass1234",
			"postgres_db":        "postgres",
		},
		Ports: map[string]int{
			"studio": 3000, "kong_http": 8000, "kong_https": 8443, "postgres": 54322,
		},
	}
}

func keys(m map[string]string) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

package qdrant

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
		t.Errorf("expected error for missing api_key")
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
		TemplateID: "qdrant",
		Name:       "Acme Vectors",
		Slug:       "acme-vectors",
		Status:     templates.StatusDeploying,
		Config: map[string]string{
			"api_key":   "qdrant_test_api_key_123456",
			"log_level": "INFO",
		},
		Ports: map[string]int{
			"http": 6333,
			"grpc": 6334,
			"p2p":  6335,
		},
		Env: map[string]string{
			"EXTRA_VAR": "1",
		},
		WorkDir:   "/tmp/acme-vectors",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	rendered, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render error: %v", err)
	}
	if !strings.Contains(rendered.Compose, "name: acme-vectors") {
		t.Errorf("compose missing project name. got:\n%s", rendered.Compose)
	}
	if !strings.Contains(rendered.Compose, "qdrant/qdrant:latest") {
		t.Errorf("compose missing qdrant image")
	}
	if !strings.Contains(rendered.Compose, "${QDRANT_HTTP_PORT}:6333") {
		t.Errorf("compose missing http port mapping")
	}
	if !strings.Contains(rendered.Env, "QDRANT_API_KEY=qdrant_test_api_key_123456") {
		t.Errorf("env missing api key")
	}
	if !strings.Contains(rendered.Env, "EXTRA_VAR=1") {
		t.Errorf("env missing extra env variable")
	}
	cfg, ok := rendered.Files["volumes/qdrant/production.yaml"]
	if !ok {
		t.Fatalf("production.yaml not generated, files: %v", keys(rendered.Files))
	}
	if !strings.Contains(cfg, "api_key: \"qdrant_test_api_key_123456\"") {
		t.Errorf("production.yaml missing api_key")
	}
	if !strings.Contains(cfg, "log_level: INFO") {
		t.Errorf("production.yaml missing log_level")
	}
}

func TestGenerateConfigProducesValidValues(t *testing.T) {
	d := New()
	cfg, err := d.GenerateConfig()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	if cfg["api_key"] == "" {
		t.Fatalf("generated config missing api_key")
	}
	if !strings.HasPrefix(cfg["api_key"], "qdrant_") {
		t.Fatalf("api_key missing expected prefix, got %q", cfg["api_key"])
	}
	if len(cfg["api_key"]) < 16 {
		t.Fatalf("api_key too short: %d", len(cfg["api_key"]))
	}
	in := templates.DeployInput{Name: "demo", Config: cfg}
	if err := d.Validate(in); err != nil {
		t.Errorf("generated config did not pass Validate: %v", err)
	}
}

func validInput() templates.DeployInput {
	return templates.DeployInput{
		Name: "demo",
		Config: map[string]string{
			"api_key": "qdrant_valid_api_key_123456",
		},
		Ports: map[string]int{
			"http": 6333,
			"grpc": 6334,
			"p2p":  6335,
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

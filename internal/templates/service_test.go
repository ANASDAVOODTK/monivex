package templates

import (
	"testing"
)

func TestExtractFailingServices(t *testing.T) {
	out := `Container foo-db-init-1 Error service "db-init" didn't complete successfully: exit 3
Container foo-db-init-1 Error service "db-init" didn't complete successfully: exit 3
service "db-init" didn't complete successfully: exit 3
service "other" didn't complete successfully: exit 1`
	got := extractFailingServices(out)
	want := []string{"db-init", "other"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i, s := range want {
		if got[i] != s {
			t.Errorf("got[%d] = %q, want %q", i, got[i], s)
		}
	}
}

func TestMakeSlug(t *testing.T) {
	cases := map[string]string{
		"My Supabase":    "my-supabase",
		"Prod / Staging": "prod-staging",
		" foo_bar ":      "foo_bar",
		"123abc":         "p-123abc",
		"   ":            "p-project",
	}
	for in, want := range cases {
		got := makeSlug(in)
		if got != want {
			t.Errorf("makeSlug(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestValidateSlug(t *testing.T) {
	good := []string{"foo", "foo-bar", "abc1", "a_b_c", "supabase-prod-1"}
	for _, s := range good {
		if err := ValidateSlug(s); err != nil {
			t.Errorf("ValidateSlug(%q) returned %v, want nil", s, err)
		}
	}
	bad := []string{"Foo", "1abc", "", "ab", "ab--c-", "way-too-long-deployment-name-that-exceeds-limit"}
	for _, s := range bad {
		if err := ValidateSlug(s); err == nil {
			t.Errorf("ValidateSlug(%q) = nil, want error", s)
		}
	}
}

func TestMergeConfigAppliesDefaults(t *testing.T) {
	def := Definition{
		Fields: []Field{
			{Key: "db_name", Default: "postgres"},
			{Key: "user_password"},
		},
		Ports: []PortField{
			{Key: "studio", Default: 3000},
			{Key: "api", Default: 8000},
		},
	}
	input := DeployInput{
		Config: map[string]string{"user_password": "secret"},
		Ports:  map[string]int{"api": 9000},
		Env:    map[string]string{"X": "Y"},
	}
	cfg, ports, env := MergeConfig(def, input)
	if cfg["db_name"] != "postgres" {
		t.Errorf("expected default db_name=postgres, got %q", cfg["db_name"])
	}
	if cfg["user_password"] != "secret" {
		t.Errorf("expected user_password=secret, got %q", cfg["user_password"])
	}
	if ports["studio"] != 3000 {
		t.Errorf("expected studio default 3000, got %d", ports["studio"])
	}
	if ports["api"] != 9000 {
		t.Errorf("expected api override 9000, got %d", ports["api"])
	}
	if env["X"] != "Y" {
		t.Errorf("expected env passthrough, got %v", env)
	}
}

func TestSummarizeComposeState(t *testing.T) {
	if s, _ := summarizeComposeState([]byte("")); s != StatusStopped {
		t.Errorf("empty -> want stopped, got %q", s)
	}
	jsonAll := `[{"Service":"db","State":"running"},{"Service":"api","State":"running"}]`
	if s, _ := summarizeComposeState([]byte(jsonAll)); s != StatusRunning {
		t.Errorf("all running -> want running, got %q", s)
	}
	jsonStop := `[{"Service":"db","State":"exited"},{"Service":"api","State":"exited"}]`
	if s, _ := summarizeComposeState([]byte(jsonStop)); s != StatusStopped {
		t.Errorf("all exited -> want stopped, got %q", s)
	}
	jsonMix := `[{"Service":"db","State":"running"},{"Service":"api","State":"restarting"}]`
	if s, _ := summarizeComposeState([]byte(jsonMix)); s != StatusFailed {
		t.Errorf("restarting -> want failed, got %q", s)
	}
	// newline-delimited variant
	ndj := "{\"Service\":\"db\",\"State\":\"running\"}\n{\"Service\":\"api\",\"State\":\"running\"}"
	if s, _ := summarizeComposeState([]byte(ndj)); s != StatusRunning {
		t.Errorf("ndjson running -> want running, got %q", s)
	}
}

func TestRegistry(t *testing.T) {
	reg := NewRegistry()
	drv := &fakeDriver{def: Definition{ID: "fake", Name: "Fake Template"}}
	reg.Register(drv)
	got, err := reg.Get("fake")
	if err != nil {
		t.Fatalf("Get error: %v", err)
	}
	if got.Definition().Name != "Fake Template" {
		t.Errorf("definition name = %q, want %q", got.Definition().Name, "Fake Template")
	}
	if _, err := reg.Get("missing"); err == nil {
		t.Errorf("expected error for missing template")
	}
	defs := reg.List()
	if len(defs) != 1 {
		t.Errorf("List() = %d definitions, want 1", len(defs))
	}
}

type fakeDriver struct {
	def Definition
}

func (f *fakeDriver) Definition() Definition       { return f.def }
func (f *fakeDriver) Validate(_ DeployInput) error { return nil }
func (f *fakeDriver) Render(_ *Deployment) (RenderedArtifacts, error) {
	return RenderedArtifacts{Compose: "services: {}", Env: ""}, nil
}

func TestNextFreePort(t *testing.T) {
	used := map[int]bool{40001: true, 40002: true}
	got := nextFreePort(40001, used)
	if used[got] {
		t.Errorf("nextFreePort returned a used port: %d", got)
	}
	if got < 40001 {
		t.Errorf("expected port >= start, got %d", got)
	}
}

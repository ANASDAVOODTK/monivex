package custom

import (
	"strings"
	"testing"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
)

const validCompose = `services:
  app:
    image: nginx:alpine
    ports:
      - "8080:80"
`

func TestValidateRequiresCompose(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{Name: "demo", Config: map[string]string{}})
	if err == nil {
		t.Fatalf("expected error for missing compose body")
	}
	if !strings.Contains(err.Error(), "required") {
		t.Errorf("unexpected message: %v", err)
	}
}

func TestValidateRejectsInvalidYAML(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name:   "demo",
		Config: map[string]string{"compose": "services:\n  app:\n    image: nginx\n   bad-indent: 1\n"},
	})
	if err == nil {
		t.Fatalf("expected YAML parse error")
	}
}

func TestValidateRejectsMissingServices(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name:   "demo",
		Config: map[string]string{"compose": "version: \"3\"\n"},
	})
	if err == nil {
		t.Fatalf("expected error when services map is absent")
	}
}

func TestValidateAcceptsValidInput(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name: "demo",
		Config: map[string]string{
			"compose": validCompose,
			"env":     "FOO=bar\n# comment\nBAZ=qux\n",
		},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateRejectsBadEnvLine(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name: "demo",
		Config: map[string]string{
			"compose": validCompose,
			"env":     "FOO bar\n",
		},
	})
	if err == nil {
		t.Fatalf("expected env parse error")
	}
}

func TestValidateRejectsBadEnvKey(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name: "demo",
		Config: map[string]string{
			"compose": validCompose,
			"env":     "1FOO=bar\n",
		},
	})
	if err == nil {
		t.Fatalf("expected invalid key error")
	}
}

func TestRenderProducesComposeAndEnv(t *testing.T) {
	d := New()
	dep := &templates.Deployment{
		ID:         "abc",
		TemplateID: "custom",
		Name:       "acme",
		Slug:       "acme",
		Status:     templates.StatusDeploying,
		Config: map[string]string{
			"compose": validCompose,
			"env":     "FOO=bar",
		},
		Env:       map[string]string{"EXTRA": "1"},
		WorkDir:   "/tmp/acme",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	out, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out.Compose, "image: nginx:alpine") {
		t.Errorf("compose body not preserved:\n%s", out.Compose)
	}
	if !strings.Contains(out.Env, "FOO=bar\n") {
		t.Errorf("user env block missing newline-terminated entry:\n%s", out.Env)
	}
	if !strings.Contains(out.Env, "EXTRA=1\n") {
		t.Errorf("extra env vars not appended:\n%s", out.Env)
	}
}

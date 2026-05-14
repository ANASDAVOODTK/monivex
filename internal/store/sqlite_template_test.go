package store

import (
	"context"
	"testing"
)

func TestTemplateDeploymentLifecycle(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	defer s.Close()
	ctx := context.Background()

	dep := TemplateDeployment{
		ID:         "dep-1",
		TemplateID: "supabase",
		Name:       "Acme",
		Slug:       "acme",
		Status:     "pending",
		ConfigJSON: []byte(`{"k":"v"}`),
		PortsJSON:  []byte(`{"studio":3000}`),
		WorkDir:    "/tmp/acme",
	}
	env := []TemplateDeploymentEnv{
		{Key: "FOO", Value: "bar"},
		{Key: "BAZ", Value: "qux", Secret: true},
	}
	if err := s.CreateTemplateDeployment(ctx, dep, env); err != nil {
		t.Fatalf("create: %v", err)
	}

	taken, err := s.TemplateDeploymentSlugExists(ctx, "acme")
	if err != nil || !taken {
		t.Errorf("slug should be taken, got taken=%v err=%v", taken, err)
	}

	got, err := s.GetTemplateDeployment(ctx, "dep-1")
	if err != nil || got == nil {
		t.Fatalf("get: %v / nil=%v", err, got == nil)
	}
	if got.Name != "Acme" {
		t.Errorf("name = %q, want Acme", got.Name)
	}

	if err := s.UpdateTemplateDeploymentStatus(ctx, "dep-1", "running", ""); err != nil {
		t.Fatalf("update status: %v", err)
	}
	got, _ = s.GetTemplateDeployment(ctx, "dep-1")
	if got.Status != "running" {
		t.Errorf("status = %q, want running", got.Status)
	}

	if err := s.AppendTemplateDeploymentEvent(ctx, "dep-1", "deploy:done", "ok"); err != nil {
		t.Fatalf("append event: %v", err)
	}
	events, err := s.ListTemplateDeploymentEvents(ctx, "dep-1", 10)
	if err != nil {
		t.Fatalf("list events: %v", err)
	}
	if len(events) != 1 {
		t.Errorf("events = %d, want 1", len(events))
	}

	envs, err := s.GetTemplateDeploymentEnv(ctx, "dep-1")
	if err != nil {
		t.Fatalf("get env: %v", err)
	}
	if len(envs) != 2 {
		t.Errorf("envs = %d, want 2", len(envs))
	}

	list, err := s.ListTemplateDeployments(ctx)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("list = %d, want 1", len(list))
	}

	if err := s.DeleteTemplateDeployment(ctx, "dep-1"); err != nil {
		t.Fatalf("delete: %v", err)
	}
	got, _ = s.GetTemplateDeployment(ctx, "dep-1")
	if got != nil {
		t.Errorf("expected nil after delete, got %+v", got)
	}
}

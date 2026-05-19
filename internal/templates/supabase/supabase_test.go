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
	if !strings.Contains(kong, "dashboard-all") || !strings.Contains(kong, "basic-auth") {
		t.Errorf("kong.yml missing dashboard auth route")
	}
	if !strings.Contains(kong, `username: "supabase"`) || !strings.Contains(kong, `password: "studiopass"`) {
		t.Errorf("kong.yml does not render dashboard basic auth credentials")
	}
	initSQL, ok := rendered.Files["volumes/db/init.sql"]
	if !ok {
		t.Fatalf("init.sql not generated; got %v", keys(rendered.Files))
	}
	for _, want := range []string{
		"supabase_auth_admin",
		"supabase_storage_admin",
		"authenticator",
		"FOREACH role_name",
		"ALTER USER %I WITH PASSWORD %L",
		"CREATE SCHEMA IF NOT EXISTS _realtime",
		"CREATE SCHEMA IF NOT EXISTS supabase_functions",
		"app.settings.jwt_secret",
	} {
		if !strings.Contains(initSQL, want) {
			t.Errorf("init.sql missing %q", want)
		}
	}
	if !strings.Contains(rendered.Compose, "/docker-entrypoint-initdb.d/init-scripts/99-server-monitor-init.sql") {
		t.Errorf("compose is not mounting init.sql as a postgres init script")
	}
	if strings.Contains(rendered.Compose, "STUDIO_PORT") {
		t.Errorf("compose should not expose studio host port")
	}
	for _, want := range []string{
		"EDGE_FUNCTIONS_MANAGEMENT_FOLDER",
		"SNIPPETS_MANAGEMENT_FOLDER",
		"APP_NAME: realtime",
		"supabase/realtime:v2.30.34",
		"SEED_SELF_HOST: \"true\"",
		"RUN_JANITOR: \"true\"",
		"DISABLE_HEALTHCHECK_LOGGING: \"true\"",
	} {
		if !strings.Contains(rendered.Compose, want) {
			t.Errorf("compose missing studio env %q", want)
		}
	}
	if !strings.Contains(rendered.Env, "JWT_EXP=") {
		t.Errorf("env missing JWT_EXP")
	}
	if !strings.Contains(rendered.Env, "APP_NAME=realtime") {
		t.Errorf("env missing APP_NAME")
	}
}

func TestRenderInitSQLEscapesQuotes(t *testing.T) {
	out, err := renderInitSQL("p'wd", "se'cret")
	if err != nil {
		t.Fatalf("renderInitSQL: %v", err)
	}
	if !strings.Contains(out, "p''wd") || !strings.Contains(out, "se''cret") {
		t.Errorf("expected single quotes to be doubled; got: %s", out)
	}
}

func TestRenderIncludesBackupServicesByDefault(t *testing.T) {
	d := New()
	dep := buildDeployment()
	out, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	for _, want := range []string{
		"db-backup:",
		"prodrigestivill/postgres-backup-local:15",
		"files-backup:",
		"offen/docker-volume-backup",
		"./volumes/backup/db:/backups",
		"./volumes/backup/files:/archive",
		"storage-data:/backup/storage-data:ro",
		"studio-snippets:/backup/studio-snippets:ro",
		"studio-functions:/backup/studio-functions:ro",
		"acme-files-",
		"BACKUP_CRON_EXPRESSION: ${BACKUP_SCHEDULE}",
	} {
		if !strings.Contains(out.Compose, want) {
			t.Errorf("compose missing backup snippet %q", want)
		}
	}
	for _, want := range []string{
		"BACKUP_SCHEDULE=0 3 * * *",
		"BACKUP_KEEP_DAYS=7",
	} {
		if !strings.Contains(out.Env, want) {
			t.Errorf("env missing %q\nfull env:\n%s", want, out.Env)
		}
	}
}

func TestRenderOmitsBackupServicesWhenDisabled(t *testing.T) {
	d := New()
	dep := buildDeployment()
	dep.Config["backup_enabled"] = "no"
	out, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	for _, banned := range []string{"db-backup:", "files-backup:", "prodrigestivill", "offen/docker-volume-backup"} {
		if strings.Contains(out.Compose, banned) {
			t.Errorf("compose still contains %q when backups are disabled", banned)
		}
	}
}

func TestValidateBackupRejectsBadSchedule(t *testing.T) {
	d := New()
	in := validInput()
	in.Config["backup_enabled"] = "yes"
	in.Config["backup_schedule"] = "every 5 minutes"
	if err := d.Validate(in); err == nil {
		t.Fatalf("expected error for non-cron schedule")
	}
}

func TestValidateBackupRejectsBadRetention(t *testing.T) {
	d := New()
	in := validInput()
	in.Config["backup_enabled"] = "yes"
	in.Config["backup_schedule"] = "0 3 * * *"
	in.Config["backup_keep_days"] = "-3"
	if err := d.Validate(in); err == nil {
		t.Fatalf("expected error for negative retention")
	}
}

func TestValidateBackupAcceptsValidConfig(t *testing.T) {
	d := New()
	in := validInput()
	in.Config["backup_enabled"] = "yes"
	in.Config["backup_schedule"] = "0 3 * * *"
	in.Config["backup_keep_days"] = "30"
	if err := d.Validate(in); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateBackupSkipsWhenDisabled(t *testing.T) {
	d := New()
	in := validInput()
	in.Config["backup_enabled"] = "no"
	in.Config["backup_schedule"] = "" // would fail if enabled
	if err := d.Validate(in); err != nil {
		t.Fatalf("unexpected error when backups disabled: %v", err)
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
			"kong_http": 8000, "kong_https": 8443, "postgres": 54322,
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

func TestGenerateConfigProducesValidValues(t *testing.T) {
	d := New()
	cfg, err := d.GenerateConfig()
	if err != nil {
		t.Fatalf("generate: %v", err)
	}
	required := []string{"jwt_secret", "anon_key", "service_role_key", "dashboard_password", "postgres_password"}
	for _, k := range required {
		if cfg[k] == "" {
			t.Errorf("generated config missing %s", k)
		}
	}
	if len(cfg["jwt_secret"]) < 32 {
		t.Errorf("jwt_secret too short: %d", len(cfg["jwt_secret"]))
	}
	if !strings.Contains(cfg["anon_key"], ".") {
		t.Errorf("anon_key does not look like a JWT: %s", cfg["anon_key"])
	}
	if !strings.Contains(cfg["service_role_key"], ".") {
		t.Errorf("service_role_key does not look like a JWT")
	}
	// The freshly generated keys must validate against the JWT secret.
	in := templates.DeployInput{Name: "demo", Config: cfg}
	if err := d.Validate(in); err != nil {
		t.Errorf("generated config did not pass Validate: %v", err)
	}
}

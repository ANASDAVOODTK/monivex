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
		"./volumes/functions:/backup/studio-functions:ro",
		"acme-files-",
		"BACKUP_CRON_EXPRESSION: ${BACKUP_SCHEDULE}",
		// Permission fix: a root one-shot hands the dump dir to the
		// image's postgres user before db-backup starts.
		"backup-init:",
		"chown -R postgres:postgres /backups",
		templates.OneShotLabel + `: "true"`,
		"condition: service_completed_successfully",
	} {
		if !strings.Contains(out.Compose, want) {
			t.Errorf("compose missing backup snippet %q", want)
		}
	}
	for _, dir := range []string{"volumes/backup/db", "volumes/backup/files"} {
		if _, ok := out.Dirs[dir]; !ok {
			t.Errorf("Dirs missing %s: %v", dir, out.Dirs)
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
	for _, banned := range []string{"db-backup:", "backup-init:", "files-backup:", "prodrigestivill", "offen/docker-volume-backup"} {
		if strings.Contains(out.Compose, banned) {
			t.Errorf("compose still contains %q when backups are disabled", banned)
		}
	}
}

func TestRenderRealtimeUsesTenantAwareHost(t *testing.T) {
	out, err := New().Render(buildDeployment())
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	// The alias must be a network alias, not a container_name, so two
	// Supabase deployments on one Docker host don't collide.
	if !strings.Contains(out.Compose, "aliases:\n          # Realtime") || !strings.Contains(out.Compose, "- realtime-dev.supabase-realtime") {
		t.Errorf("realtime service missing tenant-aware network alias:\n%s", out.Compose)
	}
	if strings.Contains(out.Compose, "container_name") {
		t.Errorf("compose must not pin container names")
	}
	if !strings.Contains(out.Compose, "request-termination") {
		t.Errorf("KONG_PLUGINS must enable request-termination for the realtime block routes")
	}
	kong := out.Files["volumes/kong.yml"]
	for _, want := range []string{
		"url: http://realtime-dev.supabase-realtime:4000/socket\n    protocol: ws",
		"- /realtime/v1/api/openapi",
		"- /realtime/v1/api/tenants",
		"url: http://realtime-dev.supabase-realtime:4000/api\n",
		"- /realtime/v1/api\n",
	} {
		if !strings.Contains(kong, want) {
			t.Errorf("kong.yml missing %q", want)
		}
	}
	if strings.Contains(kong, "http://realtime:4000") {
		t.Errorf("kong.yml still routes to the tenant-less realtime host")
	}
	if strings.Count(kong, "status_code: 403") != 2 {
		t.Errorf("expected both realtime admin endpoints to be blocked")
	}
}

func TestRenderIncludesEdgeFunctionsByDefault(t *testing.T) {
	d := New()
	dep := buildDeployment()
	out, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	for _, want := range []string{
		"  functions:\n",
		"image: supabase/edge-runtime:v1.76.2",
		"env_file:\n      - .env.functions",
		"VERIFY_JWT: \"${FUNCTIONS_VERIFY_JWT}\"",
		"./volumes/functions:/home/deno/functions",
		"./volumes/secrets:/run/secrets:ro",
		"- /home/deno/functions/main",
		"./volumes/functions:/app/edge-functions",
	} {
		if !strings.Contains(out.Compose, want) {
			t.Errorf("compose missing %q", want)
		}
	}
	if strings.Contains(out.Compose, "studio-functions:/app/edge-functions") {
		t.Errorf("studio must share the runtime's bind-mounted functions dir")
	}
	if !strings.Contains(out.Files["volumes/kong.yml"], "url: http://functions:9000/") {
		t.Errorf("kong.yml missing /functions/v1/ route")
	}
	if !strings.Contains(out.Env, "FUNCTIONS_VERIFY_JWT=true") {
		t.Errorf("env missing FUNCTIONS_VERIFY_JWT=true")
	}
	for _, seed := range []string{"volumes/functions/main/index.ts", "volumes/functions/deno.jsonc", ".env.functions"} {
		if _, ok := out.SeedFiles[seed]; !ok {
			t.Errorf("SeedFiles missing %s", seed)
		}
		if _, ok := out.Files[seed]; ok {
			t.Errorf("%s must be seeded, not overwritten on every render", seed)
		}
	}
	if !strings.Contains(out.SeedFiles["volumes/functions/main/index.ts"], "Deno.env.get('VERIFY_JWT')") {
		t.Errorf("main worker does not read VERIFY_JWT")
	}
	if mode, ok := out.Dirs["volumes/secrets"]; !ok || mode != 0o700 {
		t.Errorf("secrets dir should be created 0700, got %v (present=%v)", mode, ok)
	}

	layout, ok := d.FunctionsLayout(dep)
	if !ok || layout.SourceDir != "volumes/functions" || layout.SecretFilesMount != "/run/secrets" || layout.Service != "functions" {
		t.Errorf("unexpected functions layout: %+v ok=%v", layout, ok)
	}
}

func TestRenderEdgeFunctionsToggles(t *testing.T) {
	d := New()
	dep := buildDeployment()
	dep.Config["functions_verify_jwt"] = "no"
	out, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out.Env, "FUNCTIONS_VERIFY_JWT=false") {
		t.Errorf("functions_verify_jwt=no should render VERIFY_JWT false")
	}

	dep.Config["functions_enabled"] = "no"
	out, err = d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(out.Compose, "edge-runtime") || strings.Contains(out.Files["volumes/kong.yml"], "functions-v1") {
		t.Errorf("functions_enabled=no should drop the runtime and its route")
	}
	if len(out.SeedFiles) != 0 {
		t.Errorf("no seed files expected when functions are disabled: %v", keys(out.SeedFiles))
	}
	if _, ok := d.FunctionsLayout(dep); ok {
		t.Errorf("FunctionsLayout should report disabled")
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

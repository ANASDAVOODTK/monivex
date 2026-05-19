// Package supabase provides a Supabase self-hosted template driver. It renders
// a docker-compose.yml that wires together the core Supabase services
// (Postgres, Studio, Kong gateway, GoTrue, PostgREST, Realtime, Storage,
// Imgproxy and pg-meta) parameterized for one isolated project.
package supabase

import (
	"bytes"
	"fmt"
	"regexp"
	"strings"
	"text/template"

	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
)

// Driver is the Supabase template implementation.
type Driver struct{}

// New returns a ready-to-register Supabase driver.
func New() *Driver { return &Driver{} }

func (d *Driver) Definition() templates.Definition {
	return templates.Definition{
		ID:          "supabase",
		Name:        "Supabase",
		Description: "Self-hosted Supabase stack (Studio, Postgres, GoTrue, PostgREST, Realtime, Storage, Kong) deployed as an isolated project.",
		Icon:        "supabase",
		Fields: []templates.Field{
			{Key: "project_name", Label: "Project name", Type: templates.FieldText, Required: true, Description: "Human-friendly name shown in the dashboard.", Placeholder: "my-supabase", Group: "general"},
			{Key: "jwt_secret", Label: "JWT secret", Type: templates.FieldSecret, Required: true, Description: "Used to sign API tokens. Must be at least 32 characters.", Group: "auth"},
			{Key: "anon_key", Label: "Anon API key (JWT)", Type: templates.FieldSecret, Required: true, Description: "Public anon role JWT issued against the JWT secret.", Group: "auth"},
			{Key: "service_role_key", Label: "Service role key (JWT)", Type: templates.FieldSecret, Required: true, Description: "Service role JWT issued against the JWT secret.", Group: "auth"},
			{Key: "dashboard_user", Label: "Studio admin username", Type: templates.FieldText, Required: true, Default: "supabase", Group: "studio"},
			{Key: "dashboard_password", Label: "Studio admin password", Type: templates.FieldPassword, Required: true, Group: "studio"},
			{Key: "postgres_password", Label: "Postgres password", Type: templates.FieldPassword, Required: true, Description: "Used by the postgres superuser and all internal services.", Group: "database"},
			{Key: "postgres_db", Label: "Postgres database", Type: templates.FieldText, Required: true, Default: "postgres", Group: "database"},
			{Key: "site_url", Label: "Site URL", Type: templates.FieldText, Required: false, Description: "Your app frontend URL. Used by GoTrue for email links and redirects. Defaults to the Kong URL if left empty.", Group: "general"},
			{Key: "public_api_url", Label: "Public API URL", Type: templates.FieldText, Required: false, Description: "Browser-facing Supabase URL (Kong). Use your server IP/domain, not localhost, when accessing from another machine.", Group: "general"},
			{Key: "smtp_host", Label: "SMTP host", Type: templates.FieldText, Required: false, Group: "smtp"},
			{Key: "smtp_port", Label: "SMTP port", Type: templates.FieldText, Required: false, Default: "587", Group: "smtp"},
			{Key: "smtp_user", Label: "SMTP user", Type: templates.FieldText, Required: false, Group: "smtp"},
			{Key: "smtp_pass", Label: "SMTP password", Type: templates.FieldSecret, Required: false, Group: "smtp"},
			{Key: "smtp_sender", Label: "SMTP sender", Type: templates.FieldText, Required: false, Default: "noreply@example.com", Group: "smtp"},
			{Key: "backup_enabled", Label: "Enable scheduled backups", Type: templates.FieldText, Required: false, Default: "yes", Description: "Set to 'yes' to run automated Postgres + Storage backups inside this deployment. Set to 'no' to skip the backup sidecars entirely.", Group: "backup"},
			{Key: "backup_schedule", Label: "Backup cron schedule", Type: templates.FieldText, Required: false, Default: "0 3 * * *", Description: "Standard 5-field cron (minute hour dom month dow). Applied to both the Postgres dump and the file-volume tarball.", Group: "backup"},
			{Key: "backup_keep_days", Label: "Keep daily backups for (days)", Type: templates.FieldNumber, Required: false, Default: "7", Description: "Daily backups older than this are pruned. Postgres backups also retain 4 weekly and 6 monthly snapshots automatically.", Group: "backup"},
		},
		Ports: []templates.PortField{
			{Key: "kong_http", Label: "Kong API gateway", Default: 8000, Description: "Public REST/auth/storage URL host port."},
			{Key: "kong_https", Label: "Kong API gateway (HTTPS)", Default: 8443},
			{Key: "postgres", Label: "Postgres", Default: 54322, Description: "Expose Postgres on the host for direct access."},
		},
		SupportsUpdate: true,
	}
}

func (d *Driver) Validate(input templates.DeployInput) error {
	required := []string{"jwt_secret", "anon_key", "service_role_key", "dashboard_password", "postgres_password"}
	for _, k := range required {
		if strings.TrimSpace(input.Config[k]) == "" {
			return fmt.Errorf("%s is required", k)
		}
	}
	if v := input.Config["jwt_secret"]; len(v) < 32 {
		return fmt.Errorf("jwt_secret must be at least 32 characters")
	}
	if v := input.Config["postgres_password"]; len(v) < 8 {
		return fmt.Errorf("postgres_password must be at least 8 characters")
	}
	for k, v := range input.Ports {
		if v <= 0 || v > 65535 {
			return fmt.Errorf("invalid port %q: %d", k, v)
		}
	}
	if err := validateBackupConfig(input.Config); err != nil {
		return err
	}
	for k := range input.Env {
		if !envKeyRe.MatchString(k) {
			return fmt.Errorf("invalid env var name %q (use A-Z, 0-9, _; must start with a letter)", k)
		}
	}
	return nil
}

func (d *Driver) Render(dep *templates.Deployment) (templates.RenderedArtifacts, error) {
	data := struct {
		Dep           *templates.Deployment
		Config        map[string]string
		Ports         map[string]int
		BackupEnabled bool
	}{Dep: dep, Config: dep.Config, Ports: dep.Ports, BackupEnabled: backupEnabled(dep.Config)}

	composeBuf := &bytes.Buffer{}
	if err := composeTpl.Execute(composeBuf, data); err != nil {
		return templates.RenderedArtifacts{}, fmt.Errorf("compose render: %w", err)
	}
	envBuf := &bytes.Buffer{}
	if err := envTpl.Execute(envBuf, data); err != nil {
		return templates.RenderedArtifacts{}, fmt.Errorf("env render: %w", err)
	}
	for k, v := range dep.Env {
		fmt.Fprintf(envBuf, "%s=%s\n", k, v)
	}
	kongBuf := &bytes.Buffer{}
	if err := kongTpl.Execute(kongBuf, data); err != nil {
		return templates.RenderedArtifacts{}, fmt.Errorf("kong render: %w", err)
	}
	initSQL, err := renderInitSQL(dep.Config["postgres_password"], dep.Config["jwt_secret"])
	if err != nil {
		return templates.RenderedArtifacts{}, err
	}
	return templates.RenderedArtifacts{
		Compose: composeBuf.String(),
		Env:     envBuf.String(),
		Files: map[string]string{
			"volumes/kong.yml":    kongBuf.String(),
			"volumes/db/init.sql": initSQL,
		},
	}, nil
}

var envTpl = template.Must(template.New("env").Funcs(template.FuncMap{
	"default": tmplDefault,
}).Parse(`# Auto-generated by server-monitor. Do not edit by hand.
POSTGRES_PASSWORD={{ .Config.postgres_password }}
POSTGRES_DB={{ default .Config.postgres_db "postgres" }}
JWT_SECRET={{ .Config.jwt_secret }}
JWT_EXP=3600
APP_NAME=realtime
ANON_KEY={{ .Config.anon_key }}
SERVICE_ROLE_KEY={{ .Config.service_role_key }}
DASHBOARD_USERNAME={{ .Config.dashboard_user }}
DASHBOARD_PASSWORD={{ .Config.dashboard_password }}
SITE_URL={{ default .Config.site_url (printf "http://localhost:%d" .Ports.kong_http) }}
PUBLIC_API_URL={{ default .Config.public_api_url (printf "http://localhost:%d" .Ports.kong_http) }}
SMTP_HOST={{ .Config.smtp_host }}
SMTP_PORT={{ default .Config.smtp_port "587" }}
SMTP_USER={{ .Config.smtp_user }}
SMTP_PASS={{ .Config.smtp_pass }}
SMTP_SENDER={{ default .Config.smtp_sender "noreply@example.com" }}
KONG_HTTP_PORT={{ .Ports.kong_http }}
KONG_HTTPS_PORT={{ .Ports.kong_https }}
POSTGRES_PORT={{ .Ports.postgres }}
PROJECT_SLUG={{ .Dep.Slug }}
BACKUP_SCHEDULE={{ default .Config.backup_schedule "0 3 * * *" }}
BACKUP_KEEP_DAYS={{ default .Config.backup_keep_days "7" }}
`))

var composeTpl = template.Must(template.New("compose").Funcs(template.FuncMap{
	"default": tmplDefault,
}).Parse(supabaseComposeYAML))

var kongTpl = template.Must(template.New("kong").Funcs(template.FuncMap{
	"default": tmplDefault,
}).Parse(kongDeclarativeYAML))

func tmplDefault(value any, fallback string) string {
	switch v := value.(type) {
	case string:
		if strings.TrimSpace(v) == "" {
			return fallback
		}
		return v
	case nil:
		return fallback
	default:
		return fallback
	}
}

// envKeyRe restricts user-supplied environment variable names.
var envKeyRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)

// backupEnabled reports whether the user opted in to backup sidecars. The
// default in the Definition is "yes"; any value other than yes/true/1
// disables the services.
func backupEnabled(cfg map[string]string) bool {
	v := strings.ToLower(strings.TrimSpace(cfg["backup_enabled"]))
	if v == "" {
		return true
	}
	return v == "yes" || v == "true" || v == "1" || v == "on"
}

// validateBackupConfig sanity-checks the user-facing backup fields. The cron
// expression accepts standard 5-field form and the optional leading second
// (6-field). Anything else would silently break the sidecar so we reject it
// here with a clear message.
func validateBackupConfig(cfg map[string]string) error {
	if !backupEnabled(cfg) {
		return nil
	}
	// Empty values are not an error here — MergeConfig fills them from the
	// Definition's Default before the deployment is rendered. We only reject
	// values that are genuinely malformed.
	if schedule := strings.TrimSpace(cfg["backup_schedule"]); schedule != "" {
		parts := strings.Fields(schedule)
		if len(parts) != 5 && len(parts) != 6 {
			return fmt.Errorf("backup_schedule must be a 5-field cron expression (got %d fields)", len(parts))
		}
	}
	if v := strings.TrimSpace(cfg["backup_keep_days"]); v != "" {
		if !backupDaysRe.MatchString(v) {
			return fmt.Errorf("backup_keep_days must be a positive integer (got %q)", v)
		}
	}
	return nil
}

var backupDaysRe = regexp.MustCompile(`^[1-9][0-9]{0,3}$`)

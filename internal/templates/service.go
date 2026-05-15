package templates

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

// Service is the public entry point for managing template deployments.
type Service struct {
	registry  *Registry
	store     *store.Store
	rootDir   string // {data_dir}/templates
	composeBin string // "docker"

	mu sync.Mutex // serialize lifecycle ops per process
}

// NewService wires the registry, store and on-disk workdir root together.
// If storageRoot is empty it defaults to "{dataDir}/templates".
func NewService(reg *Registry, st *store.Store, dataDir, storageRoot string) *Service {
	root := storageRoot
	if root == "" {
		root = filepath.Join(dataDir, "templates")
	}
	_ = os.MkdirAll(root, 0o755)
	return &Service{
		registry:   reg,
		store:      st,
		rootDir:    root,
		composeBin: "docker",
	}
}

// StorageRoot returns the directory holding per-deployment workdirs.
func (s *Service) StorageRoot() string { return s.rootDir }

// Definitions returns the registered template catalog.
func (s *Service) Definitions() []Definition { return s.registry.List() }

// Definition returns the metadata for a specific template, or an error if unknown.
func (s *Service) Definition(id string) (Definition, error) {
	d, err := s.registry.Get(id)
	if err != nil {
		return Definition{}, err
	}
	return d.Definition(), nil
}

// EngineStatus reports whether docker compose is callable on this host.
func (s *Service) EngineStatus(ctx context.Context) (available bool, version, message string) {
	ok, ver, err := ComposeAvailable(ctx, s.composeBin)
	if err != nil {
		return false, "", err.Error()
	}
	return ok, ver, ""
}

// Deploy validates input, persists the deployment, renders artifacts and runs `docker compose up`.
func (s *Service) Deploy(ctx context.Context, templateID string, input DeployInput) (*Deployment, error) {
	driver, err := s.registry.Get(templateID)
	if err != nil {
		return nil, err
	}
	def := driver.Definition()
	if strings.TrimSpace(input.Name) == "" {
		return nil, fmt.Errorf("project name is required")
	}
	if err := driver.Validate(input); err != nil {
		return nil, err
	}
	config, ports, env := MergeConfig(def, input)
	slug := makeSlug(input.Name)
	if err := ValidateSlug(slug); err != nil {
		return nil, err
	}
	taken, err := s.store.TemplateDeploymentSlugExists(ctx, slug)
	if err != nil {
		return nil, fmt.Errorf("check slug: %w", err)
	}
	if taken {
		return nil, fmt.Errorf("a deployment named %q already exists", input.Name)
	}
	if err := s.assertPortsFree(ctx, ports, ""); err != nil {
		return nil, err
	}
	id := newDeploymentID()
	workDir := filepath.Join(s.rootDir, slug)
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		return nil, fmt.Errorf("create workdir: %w", err)
	}
	d := &Deployment{
		ID:         id,
		TemplateID: templateID,
		Name:       input.Name,
		Slug:       slug,
		Status:     StatusDeploying,
		Config:     config,
		Ports:      ports,
		Env:        env,
		WorkDir:    workDir,
		CreatedAt:  time.Now(),
		UpdatedAt:  time.Now(),
	}
	cfgJSON, _ := json.Marshal(d.Config)
	portsJSON, _ := json.Marshal(d.Ports)
	dep := store.TemplateDeployment{
		ID:         d.ID,
		TemplateID: d.TemplateID,
		Name:       d.Name,
		Slug:       d.Slug,
		Status:     d.Status,
		ConfigJSON: cfgJSON,
		PortsJSON:  portsJSON,
		WorkDir:    d.WorkDir,
	}
	envRows := make([]store.TemplateDeploymentEnv, 0, len(env))
	for k, v := range env {
		envRows = append(envRows, store.TemplateDeploymentEnv{Key: k, Value: v, Secret: false})
	}
	if err := s.store.CreateTemplateDeployment(ctx, dep, envRows); err != nil {
		return nil, fmt.Errorf("persist: %w", err)
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, "deploy:start", fmt.Sprintf("Deploying %s", def.Name))
	if err := s.writeArtifacts(driver, d); err != nil {
		s.fail(ctx, d, "render", err)
		return d, err
	}
	go s.runDeploy(d)
	return d, nil
}

func (s *Service) runDeploy(d *Deployment) {
	s.mu.Lock()
	defer s.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	c := s.compose(d)
	if out, err := c.Up(ctx); err != nil {
		extra := s.collectFailureLogs(ctx, c, string(out))
		s.fail(ctx, d, "deploy", fmt.Errorf("%w\n%s%s", err, string(out), extra))
		return
	}
	_ = s.store.UpdateTemplateDeploymentStatus(ctx, d.ID, StatusRunning, "")
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, "deploy:done", "Deployment completed successfully")
}

// collectFailureLogs grabs the logs of any container that compose flagged as
// failing inside `out`. Best effort: it's used purely to give the user an
// actionable error message.
func (s *Service) collectFailureLogs(ctx context.Context, c *Compose, out string) string {
	services := extractFailingServices(out)
	if len(services) == 0 {
		return ""
	}
	var b strings.Builder
	for _, svc := range services {
		logs := c.Logs(ctx, svc, 200)
		if len(logs) == 0 {
			continue
		}
		b.WriteString("\n\n--- logs for ")
		b.WriteString(svc)
		b.WriteString(" ---\n")
		b.Write(logs)
	}
	return b.String()
}

var failingServiceRe = regexp.MustCompile(`service "([^"]+)" didn't complete successfully`)

func extractFailingServices(out string) []string {
	matches := failingServiceRe.FindAllStringSubmatch(out, -1)
	seen := map[string]bool{}
	var svcs []string
	for _, m := range matches {
		if len(m) >= 2 && !seen[m[1]] {
			seen[m[1]] = true
			svcs = append(svcs, m[1])
		}
	}
	return svcs
}

// Start brings a stopped deployment back online.
func (s *Service) Start(ctx context.Context, id string) error {
	d, driver, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	_ = s.writeArtifacts(driver, d)
	if err := s.store.UpdateTemplateDeploymentStatus(ctx, id, StatusStarting, ""); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, id, "start", "Start requested")
	go func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		ctx2, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		c := s.compose(d)
		if out, err := c.Up(ctx2); err != nil {
			s.fail(ctx2, d, "start", fmt.Errorf("%w\n%s", err, string(out)))
			return
		}
		_ = s.store.UpdateTemplateDeploymentStatus(ctx2, id, StatusRunning, "")
		_ = s.store.AppendTemplateDeploymentEvent(ctx2, id, "start:done", "Deployment started")
	}()
	return nil
}

// Stop stops the deployment without removing its volumes or config.
func (s *Service) Stop(ctx context.Context, id string) error {
	d, _, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	if err := s.store.UpdateTemplateDeploymentStatus(ctx, id, StatusStopping, ""); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, id, "stop", "Stop requested")
	go func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		ctx2, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
		defer cancel()
		c := s.compose(d)
		if out, err := c.Stop(ctx2); err != nil {
			s.fail(ctx2, d, "stop", fmt.Errorf("%w\n%s", err, string(out)))
			return
		}
		_ = s.store.UpdateTemplateDeploymentStatus(ctx2, id, StatusStopped, "")
		_ = s.store.AppendTemplateDeploymentEvent(ctx2, id, "stop:done", "Deployment stopped")
	}()
	return nil
}

// UpdateConfig applies a configuration patch to an existing deployment,
// re-renders the artifacts on disk and (optionally) restarts the containers
// so the new values take effect. Ports already in use by other deployments
// are rejected. The deployment slug, template ID and ID are pinned.
func (s *Service) UpdateConfig(ctx context.Context, id string, input EditInput) (*Deployment, error) {
	d, driver, err := s.load(ctx, id)
	if err != nil {
		return nil, err
	}
	def := driver.Definition()

	// Build a synthetic DeployInput that combines the existing values with
	// the patch so MergeConfig keeps any field the user didn't touch.
	merged := DeployInput{Name: d.Name, Config: map[string]string{}, Ports: map[string]int{}, Env: map[string]string{}}
	for k, v := range d.Config {
		merged.Config[k] = v
	}
	for k, v := range input.Config {
		merged.Config[k] = v
	}
	for k, v := range d.Ports {
		merged.Ports[k] = v
	}
	for k, v := range input.Ports {
		if v > 0 {
			merged.Ports[k] = v
		}
	}
	for k, v := range d.Env {
		merged.Env[k] = v
	}
	for k, v := range input.Env {
		merged.Env[k] = v
	}
	if err := driver.Validate(merged); err != nil {
		return nil, err
	}
	config, ports, env := MergeConfig(def, merged)
	if err := s.assertPortsFree(ctx, ports, id); err != nil {
		return nil, err
	}
	d.Config = config
	d.Ports = ports
	d.Env = env

	cfgJSON, _ := json.Marshal(d.Config)
	portsJSON, _ := json.Marshal(d.Ports)
	envRows := make([]store.TemplateDeploymentEnv, 0, len(env))
	for k, v := range env {
		envRows = append(envRows, store.TemplateDeploymentEnv{Key: k, Value: v, Secret: false})
	}
	if err := s.store.UpdateTemplateDeploymentConfig(ctx, id, cfgJSON, portsJSON, envRows); err != nil {
		return nil, fmt.Errorf("persist: %w", err)
	}
	if err := s.writeArtifacts(driver, d); err != nil {
		return nil, fmt.Errorf("render: %w", err)
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, id, "edit", "Configuration updated")

	if input.Restart {
		if err := s.store.UpdateTemplateDeploymentStatus(ctx, id, StatusUpdating, ""); err != nil {
			return nil, err
		}
		_ = s.store.AppendTemplateDeploymentEvent(ctx, id, "edit:restart", "Restarting to apply changes")
		go func() {
			s.mu.Lock()
			defer s.mu.Unlock()
			ctx2, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
			defer cancel()
			c := s.compose(d)
			if out, err := c.Up(ctx2); err != nil {
				s.fail(ctx2, d, "edit", fmt.Errorf("up: %w\n%s", err, string(out)))
				return
			}
			_ = s.store.UpdateTemplateDeploymentStatus(ctx2, id, StatusRunning, "")
			_ = s.store.AppendTemplateDeploymentEvent(ctx2, id, "edit:done", "Configuration applied; containers restarted")
		}()
	}
	return d, nil
}

// Update pulls the latest images and re-runs `compose up`.
func (s *Service) Update(ctx context.Context, id string) error {
	d, driver, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	if err := s.writeArtifacts(driver, d); err != nil {
		return err
	}
	if err := s.store.UpdateTemplateDeploymentStatus(ctx, id, StatusUpdating, ""); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, id, "update", "Update requested")
	go func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		ctx2, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
		defer cancel()
		c := s.compose(d)
		if out, err := c.Pull(ctx2); err != nil {
			s.fail(ctx2, d, "update", fmt.Errorf("pull: %w\n%s", err, string(out)))
			return
		}
		if out, err := c.Up(ctx2); err != nil {
			s.fail(ctx2, d, "update", fmt.Errorf("up: %w\n%s", err, string(out)))
			return
		}
		_ = s.store.UpdateTemplateDeploymentStatus(ctx2, id, StatusRunning, "")
		_ = s.store.AppendTemplateDeploymentEvent(ctx2, id, "update:done", "Update completed")
	}()
	return nil
}

// Delete tears the deployment down and removes its volumes + on-disk state.
func (s *Service) Delete(ctx context.Context, id string, removeVolumes bool) error {
	d, _, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	if err := s.store.UpdateTemplateDeploymentStatus(ctx, id, StatusDeleting, ""); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, id, "delete", "Delete requested")
	go func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		ctx2, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		c := s.compose(d)
		if out, err := c.Down(ctx2, removeVolumes); err != nil {
			s.fail(ctx2, d, "delete", fmt.Errorf("%w\n%s", err, string(out)))
			return
		}
		_ = os.RemoveAll(d.WorkDir)
		if err := s.store.DeleteTemplateDeployment(ctx2, id); err != nil {
			log.Printf("templates: delete row %s: %v", id, err)
		}
	}()
	return nil
}

// Get returns one deployment + its env (with secret values present).
func (s *Service) Get(ctx context.Context, id string) (*Deployment, error) {
	row, err := s.store.GetTemplateDeployment(ctx, id)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, fmt.Errorf("deployment not found")
	}
	return toDeployment(s, row, ctx)
}

// List returns slim summaries for all deployments.
func (s *Service) List(ctx context.Context) ([]DeploymentSummary, error) {
	rows, err := s.store.ListTemplateDeployments(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]DeploymentSummary, 0, len(rows))
	for _, r := range rows {
		var ports map[string]int
		_ = json.Unmarshal(r.PortsJSON, &ports)
		out = append(out, DeploymentSummary{
			ID:         r.ID,
			TemplateID: r.TemplateID,
			Name:       r.Name,
			Slug:       r.Slug,
			Status:     r.Status,
			Message:    r.Message,
			Ports:      ports,
			CreatedAt:  r.CreatedAt,
			UpdatedAt:  r.UpdatedAt,
		})
	}
	return out, nil
}

// Reconcile inspects docker compose ps for each deployment and updates the
// status (only for terminal states: running, stopped, failed). In-flight
// transitions are left untouched to avoid clobbering an active action.
func (s *Service) Reconcile(ctx context.Context) {
	rows, err := s.store.ListTemplateDeployments(ctx)
	if err != nil {
		log.Printf("templates reconcile: list: %v", err)
		return
	}
	for _, r := range rows {
		switch r.Status {
		case StatusDeploying, StatusStarting, StatusStopping, StatusUpdating, StatusDeleting:
			continue
		}
		c := &Compose{Project: r.Slug, WorkDir: r.WorkDir, File: "docker-compose.yml", EnvFile: ".env", Bin: s.composeBin}
		out, err := c.PS(ctx)
		if err != nil {
			continue
		}
		status, msg := summarizeComposeState(out)
		if status != "" && status != r.Status {
			_ = s.store.UpdateTemplateDeploymentStatus(ctx, r.ID, status, msg)
		}
	}
}

// Events returns recent lifecycle events for a deployment.
func (s *Service) Events(ctx context.Context, id string, limit int) ([]Event, error) {
	rows, err := s.store.ListTemplateDeploymentEvents(ctx, id, limit)
	if err != nil {
		return nil, err
	}
	out := make([]Event, 0, len(rows))
	for _, r := range rows {
		out = append(out, Event{
			ID:        r.ID,
			Kind:      r.Kind,
			Message:   r.Message,
			CreatedAt: r.CreatedAt,
		})
	}
	return out, nil
}

// ----- internal helpers -----

func (s *Service) load(ctx context.Context, id string) (*Deployment, Driver, error) {
	row, err := s.store.GetTemplateDeployment(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	if row == nil {
		return nil, nil, fmt.Errorf("deployment not found")
	}
	driver, err := s.registry.Get(row.TemplateID)
	if err != nil {
		return nil, nil, err
	}
	d, err := toDeployment(s, row, ctx)
	if err != nil {
		return nil, nil, err
	}
	return d, driver, nil
}

func (s *Service) compose(d *Deployment) *Compose {
	return &Compose{
		Project: d.Slug,
		WorkDir: d.WorkDir,
		File:    "docker-compose.yml",
		EnvFile: ".env",
		Bin:     s.composeBin,
	}
}

func (s *Service) writeArtifacts(driver Driver, d *Deployment) error {
	rendered, err := driver.Render(d)
	if err != nil {
		return fmt.Errorf("render: %w", err)
	}
	if err := os.WriteFile(filepath.Join(d.WorkDir, "docker-compose.yml"), []byte(rendered.Compose), 0o644); err != nil {
		return fmt.Errorf("write compose: %w", err)
	}
	if err := os.WriteFile(filepath.Join(d.WorkDir, ".env"), []byte(rendered.Env), 0o600); err != nil {
		return fmt.Errorf("write env: %w", err)
	}
	for rel, content := range rendered.Files {
		// Reject absolute paths or path escapes to keep writes inside workdir.
		clean := filepath.Clean(rel)
		if filepath.IsAbs(clean) || strings.HasPrefix(clean, "..") || strings.Contains(clean, ".."+string(filepath.Separator)) {
			return fmt.Errorf("driver returned unsafe file path: %s", rel)
		}
		full := filepath.Join(d.WorkDir, clean)
		if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
			return fmt.Errorf("mkdir %s: %w", clean, err)
		}
		if err := os.WriteFile(full, []byte(content), 0o644); err != nil {
			return fmt.Errorf("write %s: %w", clean, err)
		}
	}
	return nil
}

func (s *Service) fail(ctx context.Context, d *Deployment, kind string, err error) {
	msg := err.Error()
	log.Printf("templates: %s %s: %s", d.Slug, kind, msg)
	_ = s.store.UpdateTemplateDeploymentStatus(ctx, d.ID, StatusFailed, msg)
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, kind+":fail", msg)
}

func (s *Service) assertPortsFree(ctx context.Context, ports map[string]int, exceptID string) error {
	if len(ports) == 0 {
		return nil
	}
	rows, err := s.store.ListTemplateDeployments(ctx)
	if err != nil {
		return err
	}
	used := map[int]string{}
	for _, r := range rows {
		if r.ID == exceptID {
			continue
		}
		var p map[string]int
		_ = json.Unmarshal(r.PortsJSON, &p)
		for _, v := range p {
			if v > 0 {
				used[v] = r.Name
			}
		}
	}
	for k, v := range ports {
		if v <= 0 || v > 65535 {
			return fmt.Errorf("invalid port for %q: %d", k, v)
		}
		if owner, ok := used[v]; ok {
			return fmt.Errorf("port %d (%s) is already used by deployment %q", v, k, owner)
		}
	}
	return nil
}

func toDeployment(_ *Service, row *store.TemplateDeployment, _ context.Context) (*Deployment, error) {
	d := &Deployment{
		ID:         row.ID,
		TemplateID: row.TemplateID,
		Name:       row.Name,
		Slug:       row.Slug,
		Status:     row.Status,
		Message:    row.Message,
		WorkDir:    row.WorkDir,
		CreatedAt:  row.CreatedAt,
		UpdatedAt:  row.UpdatedAt,
	}
	d.Config = map[string]string{}
	d.Ports = map[string]int{}
	d.Env = map[string]string{}
	_ = json.Unmarshal(row.ConfigJSON, &d.Config)
	_ = json.Unmarshal(row.PortsJSON, &d.Ports)
	return d, nil
}

var (
	slugReplaceRe  = regexp.MustCompile(`[^a-z0-9_-]+`)
	slugCollapseRe = regexp.MustCompile(`-+`)
)

// makeSlug converts a human name into a docker compose / filesystem safe slug.
func makeSlug(name string) string {
	s := strings.ToLower(strings.TrimSpace(name))
	s = slugReplaceRe.ReplaceAllString(s, "-")
	s = slugCollapseRe.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-_")
	if s == "" {
		return "p-project"
	}
	if !regexp.MustCompile(`^[a-z]`).MatchString(s) {
		s = "p-" + s
	}
	if len(s) > 32 {
		s = s[:32]
	}
	return s
}

func newDeploymentID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// summarizeComposeState examines the JSON output of `docker compose ps` and
// derives an overall deployment status. Empty output means no containers.
func summarizeComposeState(out []byte) (string, string) {
	type item struct {
		Service string `json:"Service"`
		State   string `json:"State"`
		Status  string `json:"Status"`
	}
	text := strings.TrimSpace(string(out))
	if text == "" {
		return StatusStopped, "no containers"
	}
	var items []item
	if err := json.Unmarshal(out, &items); err != nil {
		// docker compose ps emits one JSON object per line in some versions.
		items = nil
		for _, line := range strings.Split(text, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			var single item
			if err := json.Unmarshal([]byte(line), &single); err == nil {
				items = append(items, single)
			}
		}
	}
	if len(items) == 0 {
		return StatusStopped, "no containers"
	}
	running, stopped, problem := 0, 0, 0
	var firstProblem string
	for _, it := range items {
		state := strings.ToLower(it.State)
		switch {
		case state == "running":
			running++
		case state == "exited", state == "dead", state == "removing":
			stopped++
		case state == "restarting", state == "paused", state == "created":
			problem++
			if firstProblem == "" {
				firstProblem = it.Service + ": " + it.State
			}
		default:
			if state != "" {
				problem++
				if firstProblem == "" {
					firstProblem = it.Service + ": " + it.State
				}
			}
		}
	}
	if problem == 0 && stopped == 0 && running > 0 {
		return StatusRunning, ""
	}
	if running == 0 && stopped > 0 {
		return StatusStopped, ""
	}
	return StatusFailed, firstProblem
}

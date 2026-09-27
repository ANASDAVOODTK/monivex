package templates

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"
)

// FunctionsLayout describes where a deployment keeps user-editable serverless
// function sources and runtime secrets on disk. Paths are relative to the
// deployment workdir.
type FunctionsLayout struct {
	SourceDir        string `json:"source_dir"`         // e.g. volumes/functions
	SecretsEnvFile   string `json:"secrets_env_file"`   // e.g. .env.functions (compose env_file)
	SecretFilesDir   string `json:"secret_files_dir"`   // e.g. volumes/secrets
	SecretFilesMount string `json:"secret_files_mount"` // SecretFilesDir as seen inside the runtime, e.g. /run/secrets
	Service          string `json:"service"`            // compose service recreated by RestartFunctions
	RoutePrefix      string `json:"route_prefix"`       // public gateway path, e.g. /functions/v1/
	// System lists top-level entries owned by the runtime (main worker,
	// import map). They can be edited but not deleted.
	System []string `json:"system"`
	// ReservedEnv / ReservedEnvPrefixes are keys the compose file sets
	// itself. Compose gives `environment:` precedence over env_file, so a
	// secret with one of these names would be silently ignored.
	ReservedEnv         []string `json:"reserved_env"`
	ReservedEnvPrefixes []string `json:"reserved_env_prefixes"`
}

// FunctionsSupport is an optional Driver capability for templates whose
// deployments host editable functions plus secrets (Supabase Edge Functions).
type FunctionsSupport interface {
	// FunctionsLayout returns the layout for d, or ok=false when functions
	// are disabled for this deployment.
	FunctionsLayout(d *Deployment) (layout FunctionsLayout, ok bool)
}

// FunctionsInfo is the listing returned by ListFunctions.
type FunctionsInfo struct {
	Enabled   bool               `json:"enabled"`
	Layout    *FunctionsLayout   `json:"layout,omitempty"`
	Functions []FunctionEntry    `json:"functions"`
	RootFiles []FunctionFileInfo `json:"root_files"` // shared files such as deno.jsonc
}

// FunctionEntry is one function directory.
type FunctionEntry struct {
	Name   string             `json:"name"`
	System bool               `json:"system"`
	Files  []FunctionFileInfo `json:"files"`
}

// FunctionFileInfo describes one source file. Path is relative to
// FunctionsLayout.SourceDir and always uses forward slashes.
type FunctionFileInfo struct {
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
}

// FunctionFile is a source file with its content.
type FunctionFile struct {
	Path    string    `json:"path"`
	Content string    `json:"content"`
	ModTime time.Time `json:"mod_time"`
}

// SecretEnv is one KEY=value entry of the functions env file.
type SecretEnv struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// SecretFileInfo describes a file in the secret-files directory. Contents
// are never returned by the API.
type SecretFileInfo struct {
	Name          string    `json:"name"`
	Size          int64     `json:"size"`
	ModTime       time.Time `json:"mod_time"`
	ContainerPath string    `json:"container_path"`
}

// SecretsInfo is the listing returned by Secrets.
type SecretsInfo struct {
	Enabled bool             `json:"enabled"`
	Layout  *FunctionsLayout `json:"layout,omitempty"`
	Env     []SecretEnv      `json:"env"`
	Files   []SecretFileInfo `json:"files"`
}

const (
	MaxFunctionFileBytes = 1 << 20   // one source file
	MaxSecretFileBytes   = 256 << 10 // one secret file (keys, certificates)
	maxFilesPerFunction  = 200
	maxPathDepth         = 8
)

var (
	// ErrFunctionsUnsupported is returned for templates without FunctionsSupport.
	ErrFunctionsUnsupported = errors.New("this template does not support edge functions")
	// ErrFunctionsDisabled is returned when the deployment turned functions off.
	ErrFunctionsDisabled = errors.New("edge functions are disabled for this deployment")

	functionNameRe = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$`)
	pathSegmentRe  = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$`)
	secretKeyRe    = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)
	// dotenvBareRe matches values that compose reads verbatim without quotes:
	// no whitespace, '#', quotes or '$' (which compose would interpolate).
	dotenvBareRe = regexp.MustCompile(`^[A-Za-z0-9_./:@+,=%-]*$`)
)

// ListFunctions returns the function directories and shared root files.
func (s *Service) ListFunctions(ctx context.Context, id string) (*FunctionsInfo, error) {
	d, layout, enabled, err := s.functionsLayout(ctx, id)
	if err != nil {
		return nil, err
	}
	info := &FunctionsInfo{Enabled: enabled, Functions: []FunctionEntry{}, RootFiles: []FunctionFileInfo{}}
	if !enabled {
		return info, nil
	}
	info.Layout = &layout
	root := filepath.Join(d.WorkDir, layout.SourceDir)
	entries, err := os.ReadDir(root)
	if os.IsNotExist(err) {
		return info, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read functions dir: %w", err)
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".") || e.Type()&fs.ModeSymlink != 0 {
			continue
		}
		switch {
		case e.IsDir():
			info.Functions = append(info.Functions, FunctionEntry{
				Name:   name,
				System: contains(layout.System, name),
				Files:  listSourceFiles(root, name),
			})
		case e.Type().IsRegular():
			if fi, err := e.Info(); err == nil {
				info.RootFiles = append(info.RootFiles, FunctionFileInfo{Path: name, Size: fi.Size(), ModTime: fi.ModTime()})
			}
		}
	}
	// Runtime plumbing (main worker) first, then user functions by name.
	sort.SliceStable(info.Functions, func(i, j int) bool {
		a, b := info.Functions[i], info.Functions[j]
		if a.System != b.System {
			return a.System
		}
		return a.Name < b.Name
	})
	return info, nil
}

// listSourceFiles walks one function directory, skipping hidden entries and
// symlinks, and returns paths relative to root.
func listSourceFiles(root, fn string) []FunctionFileInfo {
	out := []FunctionFileInfo{}
	base := filepath.Join(root, fn)
	_ = filepath.WalkDir(base, func(p string, e fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if p == base {
			return nil
		}
		if strings.HasPrefix(e.Name(), ".") || e.Type()&fs.ModeSymlink != 0 {
			if e.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		if e.IsDir() {
			if strings.Count(filepath.ToSlash(rel), "/")+1 >= maxPathDepth {
				return fs.SkipDir
			}
			return nil
		}
		if !e.Type().IsRegular() || len(out) >= maxFilesPerFunction {
			return nil
		}
		if fi, err := e.Info(); err == nil {
			out = append(out, FunctionFileInfo{Path: filepath.ToSlash(rel), Size: fi.Size(), ModTime: fi.ModTime()})
		}
		return nil
	})
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

// ReadFunctionFile returns one source file.
func (s *Service) ReadFunctionFile(ctx context.Context, id, rel string) (*FunctionFile, error) {
	d, layout, err := s.enabledFunctions(ctx, id)
	if err != nil {
		return nil, err
	}
	rel, err = cleanSourcePath(rel)
	if err != nil {
		return nil, err
	}
	full, err := resolveInside(filepath.Join(d.WorkDir, layout.SourceDir), rel)
	if err != nil {
		return nil, err
	}
	fi, err := os.Lstat(full)
	if err != nil {
		return nil, err
	}
	if !fi.Mode().IsRegular() {
		return nil, fmt.Errorf("%s is not a regular file", rel)
	}
	if fi.Size() > MaxFunctionFileBytes {
		return nil, fmt.Errorf("%s is larger than %d bytes and cannot be edited here", rel, MaxFunctionFileBytes)
	}
	data, err := os.ReadFile(full)
	if err != nil {
		return nil, err
	}
	if !utf8.Valid(data) {
		return nil, fmt.Errorf("%s is not a text file", rel)
	}
	return &FunctionFile{Path: rel, Content: string(data), ModTime: fi.ModTime()}, nil
}

// WriteFunctionFile creates or replaces one source file. Writing
// "<name>/index.ts" for a new name creates a new function.
func (s *Service) WriteFunctionFile(ctx context.Context, id, rel, content string) error {
	d, layout, err := s.enabledFunctions(ctx, id)
	if err != nil {
		return err
	}
	rel, err = cleanSourcePath(rel)
	if err != nil {
		return err
	}
	if len(content) > MaxFunctionFileBytes {
		return fmt.Errorf("file is larger than %d bytes", MaxFunctionFileBytes)
	}
	if !utf8.ValidString(content) {
		return fmt.Errorf("content must be UTF-8 text")
	}
	root := filepath.Join(d.WorkDir, layout.SourceDir)
	if err := os.MkdirAll(root, 0o755); err != nil {
		return fmt.Errorf("create functions dir: %w", err)
	}
	full, err := resolveInside(root, rel)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return fmt.Errorf("mkdir: %w", err)
	}
	s.fnMu.Lock()
	defer s.fnMu.Unlock()
	if err := writeFileAtomic(full, []byte(content), 0o644); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, "functions:save", "Saved "+rel)
	return nil
}

// DeleteFunctionPath removes a source file, or a whole function when rel is
// a single segment. Runtime entries (FunctionsLayout.System) are protected.
func (s *Service) DeleteFunctionPath(ctx context.Context, id, rel string) error {
	d, layout, err := s.enabledFunctions(ctx, id)
	if err != nil {
		return err
	}
	rel, err = cleanSourcePath(rel)
	if err != nil {
		return err
	}
	top := strings.SplitN(rel, "/", 2)[0]
	if contains(layout.System, top) {
		return fmt.Errorf("%s is part of the functions runtime and cannot be deleted", top)
	}
	full, err := resolveInside(filepath.Join(d.WorkDir, layout.SourceDir), rel)
	if err != nil {
		return err
	}
	fi, err := os.Lstat(full)
	if err != nil {
		return err
	}
	s.fnMu.Lock()
	defer s.fnMu.Unlock()
	if fi.IsDir() {
		err = os.RemoveAll(full)
	} else {
		err = os.Remove(full)
	}
	if err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, "functions:delete", "Deleted "+rel)
	return nil
}

// Secrets returns the functions env entries and the secret-file listing.
func (s *Service) Secrets(ctx context.Context, id string) (*SecretsInfo, error) {
	d, layout, enabled, err := s.functionsLayout(ctx, id)
	if err != nil {
		return nil, err
	}
	info := &SecretsInfo{Enabled: enabled, Env: []SecretEnv{}, Files: []SecretFileInfo{}}
	if !enabled {
		return info, nil
	}
	info.Layout = &layout
	data, err := os.ReadFile(filepath.Join(d.WorkDir, layout.SecretsEnvFile))
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read %s: %w", layout.SecretsEnvFile, err)
	}
	info.Env = parseDotenv(data)

	entries, err := os.ReadDir(filepath.Join(d.WorkDir, layout.SecretFilesDir))
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read %s: %w", layout.SecretFilesDir, err)
	}
	for _, e := range entries {
		if strings.HasPrefix(e.Name(), ".") || !e.Type().IsRegular() {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		info.Files = append(info.Files, SecretFileInfo{
			Name:          e.Name(),
			Size:          fi.Size(),
			ModTime:       fi.ModTime(),
			ContainerPath: strings.TrimRight(layout.SecretFilesMount, "/") + "/" + e.Name(),
		})
	}
	return info, nil
}

// SaveSecrets replaces the functions env file with the given entries.
func (s *Service) SaveSecrets(ctx context.Context, id string, env []SecretEnv) error {
	d, layout, err := s.enabledFunctions(ctx, id)
	if err != nil {
		return err
	}
	seen := map[string]bool{}
	for i := range env {
		env[i].Key = strings.TrimSpace(env[i].Key)
		k := env[i].Key
		if !secretKeyRe.MatchString(k) {
			return fmt.Errorf("invalid secret name %q (use letters, digits and _; must not start with a digit)", k)
		}
		if seen[k] {
			return fmt.Errorf("secret %s is listed twice", k)
		}
		seen[k] = true
		if contains(layout.ReservedEnv, k) {
			return fmt.Errorf("%s is set by the functions runtime and cannot be overridden", k)
		}
		for _, p := range layout.ReservedEnvPrefixes {
			if strings.HasPrefix(k, p) {
				return fmt.Errorf("secret names starting with %s are reserved by the functions runtime", p)
			}
		}
	}
	data, err := formatDotenv(env)
	if err != nil {
		return err
	}
	s.fnMu.Lock()
	defer s.fnMu.Unlock()
	if err := writeFileAtomic(filepath.Join(d.WorkDir, layout.SecretsEnvFile), data, 0o600); err != nil {
		return err
	}
	keys := make([]string, 0, len(env))
	for _, e := range env {
		keys = append(keys, e.Key)
	}
	msg := fmt.Sprintf("Saved %d function secret(s)", len(env))
	if len(keys) > 0 {
		msg += ": " + strings.Join(keys, ", ")
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, "secrets:save", msg)
	return nil
}

// WriteSecretFile creates or replaces one file in the secret-files directory.
func (s *Service) WriteSecretFile(ctx context.Context, id, name string, data []byte) error {
	d, layout, err := s.enabledFunctions(ctx, id)
	if err != nil {
		return err
	}
	if err := validateSecretFileName(name); err != nil {
		return err
	}
	if len(data) == 0 {
		return fmt.Errorf("secret file is empty")
	}
	if len(data) > MaxSecretFileBytes {
		return fmt.Errorf("secret file is larger than %d bytes", MaxSecretFileBytes)
	}
	dir := filepath.Join(d.WorkDir, layout.SecretFilesDir)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create secrets dir: %w", err)
	}
	s.fnMu.Lock()
	defer s.fnMu.Unlock()
	if err := writeFileAtomic(filepath.Join(dir, name), data, 0o600); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, "secrets:file",
		fmt.Sprintf("Uploaded secret file %s (%d bytes)", name, len(data)))
	return nil
}

// DeleteSecretFile removes one file from the secret-files directory.
func (s *Service) DeleteSecretFile(ctx context.Context, id, name string) error {
	d, layout, err := s.enabledFunctions(ctx, id)
	if err != nil {
		return err
	}
	if err := validateSecretFileName(name); err != nil {
		return err
	}
	s.fnMu.Lock()
	defer s.fnMu.Unlock()
	if err := os.Remove(filepath.Join(d.WorkDir, layout.SecretFilesDir, name)); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, d.ID, "secrets:file", "Deleted secret file "+name)
	return nil
}

// RestartFunctions re-renders the deployment, applies any compose drift and
// force-recreates the functions service so new code, secrets and secret
// files take effect. Runs in the background; progress lands in the event log
// without changing the deployment status.
func (s *Service) RestartFunctions(ctx context.Context, id string) error {
	d, driver, err := s.load(ctx, id)
	if err != nil {
		return err
	}
	fsup, ok := driver.(FunctionsSupport)
	if !ok {
		return ErrFunctionsUnsupported
	}
	layout, enabled := fsup.FunctionsLayout(d)
	if !enabled {
		return ErrFunctionsDisabled
	}
	if d.Status != StatusRunning && d.Status != StatusFailed {
		return fmt.Errorf("deployment is %s; start it to apply function changes", d.Status)
	}
	if err := s.writeArtifacts(driver, d); err != nil {
		return err
	}
	_ = s.store.AppendTemplateDeploymentEvent(ctx, id, "functions:restart", "Restarting the functions runtime")
	go func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		ctx2, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
		defer cancel()
		c := s.compose(d)
		// A plain `up` first creates the runtime / gateway changes on
		// deployments rendered before functions existed; the recreate then
		// reloads env_file and mounts even when compose sees no drift.
		if out, err := c.Up(ctx2); err != nil {
			_ = s.store.AppendTemplateDeploymentEvent(ctx2, id, "functions:restart:fail", fmt.Sprintf("up: %v\n%s", err, out))
			return
		}
		if out, err := c.Recreate(ctx2, layout.Service); err != nil {
			_ = s.store.AppendTemplateDeploymentEvent(ctx2, id, "functions:restart:fail", fmt.Sprintf("recreate: %v\n%s", err, out))
			return
		}
		_ = s.store.AppendTemplateDeploymentEvent(ctx2, id, "functions:restart:done", "Functions runtime restarted")
	}()
	return nil
}

// ----- helpers -----

func (s *Service) functionsLayout(ctx context.Context, id string) (*Deployment, FunctionsLayout, bool, error) {
	d, driver, err := s.load(ctx, id)
	if err != nil {
		return nil, FunctionsLayout{}, false, err
	}
	fsup, ok := driver.(FunctionsSupport)
	if !ok {
		return nil, FunctionsLayout{}, false, ErrFunctionsUnsupported
	}
	layout, enabled := fsup.FunctionsLayout(d)
	return d, layout, enabled, nil
}

func (s *Service) enabledFunctions(ctx context.Context, id string) (*Deployment, FunctionsLayout, error) {
	d, layout, enabled, err := s.functionsLayout(ctx, id)
	if err != nil {
		return nil, FunctionsLayout{}, err
	}
	if !enabled {
		return nil, FunctionsLayout{}, ErrFunctionsDisabled
	}
	return d, layout, nil
}

// cleanSourcePath validates a slash-separated path relative to the functions
// source dir. Hidden segments, "..", empty segments and absolute paths are
// rejected; the first segment of a nested path must be a valid function name.
func cleanSourcePath(p string) (string, error) {
	p = strings.TrimSpace(strings.ReplaceAll(p, `\`, "/"))
	if p == "" {
		return "", fmt.Errorf("path is required")
	}
	segs := strings.Split(p, "/")
	if len(segs) > maxPathDepth {
		return "", fmt.Errorf("path %q is nested too deeply", p)
	}
	for _, seg := range segs {
		if !pathSegmentRe.MatchString(seg) || strings.Contains(seg, "..") {
			return "", fmt.Errorf("invalid path %q (use letters, digits, '.', '-' and '_'; no hidden or empty segments)", p)
		}
	}
	if len(segs) > 1 && !functionNameRe.MatchString(segs[0]) {
		return "", fmt.Errorf("invalid function name %q (letters, digits, '-' and '_', max 64)", segs[0])
	}
	return strings.Join(segs, "/"), nil
}

func validateSecretFileName(name string) error {
	if !pathSegmentRe.MatchString(name) || strings.Contains(name, "..") {
		return fmt.Errorf("invalid secret file name %q (letters, digits, '.', '-' and '_'; must not start with '.')", name)
	}
	return nil
}

// resolveInside joins rel onto root and refuses results that escape root
// through symlinks. The Studio container writes into the same directory, so
// we cannot assume it only contains what this process created.
func resolveInside(root, rel string) (string, error) {
	full := filepath.Join(root, filepath.FromSlash(rel))
	rootReal, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", err
	}
	// Resolve the deepest existing ancestor (or the file itself).
	for probe := full; ; {
		if real, err := filepath.EvalSymlinks(probe); err == nil {
			if !pathWithin(rootReal, real) {
				return "", fmt.Errorf("path %q resolves outside the functions directory", rel)
			}
			break
		}
		parent := filepath.Dir(probe)
		if parent == probe {
			break
		}
		probe = parent
	}
	return full, nil
}

func pathWithin(root, p string) bool {
	rel, err := filepath.Rel(root, p)
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// writeFileAtomic writes via a temp file + rename so the runtime and compose
// never observe a half-written file.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	tmp, err := os.CreateTemp(filepath.Dir(path), ".tmp-*")
	if err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	tmpName := tmp.Name()
	cleanup := func(err error) error {
		_ = tmp.Close()
		_ = os.Remove(tmpName)
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	if _, err := tmp.Write(data); err != nil {
		return cleanup(err)
	}
	if err := tmp.Chmod(perm); err != nil {
		return cleanup(err)
	}
	if err := tmp.Close(); err != nil {
		return cleanup(err)
	}
	if err := os.Rename(tmpName, path); err != nil {
		_ = os.Remove(tmpName)
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	return nil
}

// parseDotenv reads KEY=value lines the way docker compose does for the
// common cases: comments, blank lines, an optional `export ` prefix, and
// single- or double-quoted values. Unparseable lines are skipped.
func parseDotenv(data []byte) []SecretEnv {
	out := []SecretEnv{}
	for _, line := range strings.Split(string(data), "\n") {
		t := strings.TrimSpace(strings.TrimSuffix(line, "\r"))
		if t == "" || strings.HasPrefix(t, "#") {
			continue
		}
		t = strings.TrimPrefix(t, "export ")
		eq := strings.IndexByte(t, '=')
		if eq <= 0 {
			continue
		}
		key := strings.TrimSpace(t[:eq])
		out = append(out, SecretEnv{Key: key, Value: unquoteDotenv(strings.TrimSpace(t[eq+1:]))})
	}
	return out
}

func unquoteDotenv(v string) string {
	if v == "" {
		return v
	}
	switch v[0] {
	case '\'':
		if end := strings.IndexByte(v[1:], '\''); end >= 0 {
			return v[1 : 1+end]
		}
	case '"':
		var b strings.Builder
		for i := 1; i < len(v); i++ {
			c := v[i]
			if c == '\\' && i+1 < len(v) {
				i++
				switch v[i] {
				case 'n':
					b.WriteByte('\n')
				case 't':
					b.WriteByte('\t')
				default:
					b.WriteByte(v[i])
				}
				continue
			}
			if c == '"' {
				return b.String()
			}
			b.WriteByte(c)
		}
	}
	// Unquoted (or unterminated quote): an inline comment starts at " #".
	if i := strings.Index(v, " #"); i >= 0 {
		v = v[:i]
	}
	return strings.TrimSpace(v)
}

// formatDotenv renders entries so compose reads back exactly the given
// values: bare when safe, otherwise single-quoted (literal, no interpolation),
// falling back to double quotes for values that contain a single quote.
func formatDotenv(entries []SecretEnv) ([]byte, error) {
	var b strings.Builder
	b.WriteString("# Edge Function secrets. Managed by server-monitor from the deployment page.\n")
	b.WriteString("# Read inside a function with Deno.env.get(\"KEY\").\n")
	for _, e := range entries {
		v, err := quoteDotenv(e.Value)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", e.Key, err)
		}
		b.WriteString(e.Key)
		b.WriteByte('=')
		b.WriteString(v)
		b.WriteByte('\n')
	}
	return []byte(b.String()), nil
}

func quoteDotenv(v string) (string, error) {
	if strings.ContainsAny(v, "\r\n\x00") {
		return "", fmt.Errorf("value must be a single line; upload multi-line secrets (keys, certificates) as secret files")
	}
	if dotenvBareRe.MatchString(v) {
		return v, nil
	}
	if !strings.Contains(v, "'") {
		return "'" + v + "'", nil
	}
	if strings.ContainsAny(v, "$`") {
		return "", fmt.Errorf("value cannot contain both a single quote and '$'")
	}
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(v) + `"`, nil
}

func contains(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}

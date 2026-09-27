package templates

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/ANASDAVOODTK/server-monitor/internal/store"
)

// fnDriver is a fake driver with the FunctionsSupport capability. Setting
// config "functions"="off" disables it, like functions_enabled=no.
type fnDriver struct {
	fakeDriver
	seeds map[string]string
}

func (f *fnDriver) Render(_ *Deployment) (RenderedArtifacts, error) {
	return RenderedArtifacts{
		Compose:   "services: {}",
		SeedFiles: f.seeds,
		Dirs:      map[string]os.FileMode{"volumes/functions": 0o755},
	}, nil
}

func (f *fnDriver) FunctionsLayout(d *Deployment) (FunctionsLayout, bool) {
	return FunctionsLayout{
		SourceDir:           "volumes/functions",
		SecretsEnvFile:      ".env.functions",
		SecretFilesDir:      "volumes/secrets",
		SecretFilesMount:    "/run/secrets",
		Service:             "functions",
		System:              []string{"main", "deno.jsonc"},
		ReservedEnv:         []string{"JWT_SECRET"},
		ReservedEnvPrefixes: []string{"SUPABASE_"},
	}, d.Config["functions"] != "off"
}

func newFunctionsTestService(t *testing.T, templateID string, cfg map[string]string, env []store.TemplateDeploymentEnv) (*Service, string) {
	t.Helper()
	dir := t.TempDir()
	st, err := store.Open(dir)
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	reg := NewRegistry()
	reg.Register(&fnDriver{fakeDriver: fakeDriver{def: Definition{ID: "fn", Name: "Fn"}}})
	reg.Register(&fakeDriver{def: Definition{ID: "plain", Name: "Plain"}})
	svc := NewService(reg, st, dir, "")
	workDir := filepath.Join(svc.StorageRoot(), "demo")
	if err := os.MkdirAll(workDir, 0o755); err != nil {
		t.Fatal(err)
	}
	cfgJSON, _ := json.Marshal(cfg)
	err = st.CreateTemplateDeployment(context.Background(), store.TemplateDeployment{
		ID: "dep1", TemplateID: templateID, Name: "demo", Slug: "demo", Status: StatusRunning,
		ConfigJSON: cfgJSON, PortsJSON: []byte("{}"), WorkDir: workDir,
	}, env)
	if err != nil {
		t.Fatalf("create deployment: %v", err)
	}
	return svc, workDir
}

func TestFunctionFileLifecycle(t *testing.T) {
	ctx := context.Background()
	svc, workDir := newFunctionsTestService(t, "fn", map[string]string{}, nil)

	if err := svc.WriteFunctionFile(ctx, "dep1", "hello/index.ts", "Deno.serve(() => new Response('hi'))\n"); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := svc.WriteFunctionFile(ctx, "dep1", "main/index.ts", "// main\n"); err != nil {
		t.Fatalf("write main: %v", err)
	}
	if err := svc.WriteFunctionFile(ctx, "dep1", "deno.jsonc", "{}\n"); err != nil {
		t.Fatalf("write root file: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "volumes", "functions", "hello", "index.ts")); err != nil {
		t.Fatalf("file not on disk: %v", err)
	}

	info, err := svc.ListFunctions(ctx, "dep1")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if !info.Enabled || len(info.Functions) != 2 {
		t.Fatalf("unexpected listing: %+v", info)
	}
	if info.Functions[0].Name != "main" || !info.Functions[0].System {
		t.Errorf("system function should sort first: %+v", info.Functions)
	}
	if got := info.Functions[1]; got.Name != "hello" || len(got.Files) != 1 || got.Files[0].Path != "hello/index.ts" {
		t.Errorf("unexpected hello entry: %+v", got)
	}
	if len(info.RootFiles) != 1 || info.RootFiles[0].Path != "deno.jsonc" {
		t.Errorf("unexpected root files: %+v", info.RootFiles)
	}

	f, err := svc.ReadFunctionFile(ctx, "dep1", "hello/index.ts")
	if err != nil || !strings.Contains(f.Content, "Response('hi')") {
		t.Fatalf("read: %v %+v", err, f)
	}

	if err := svc.DeleteFunctionPath(ctx, "dep1", "main"); err == nil {
		t.Errorf("deleting the main worker must be refused")
	}
	if err := svc.DeleteFunctionPath(ctx, "dep1", "deno.jsonc"); err == nil {
		t.Errorf("deleting the import map must be refused")
	}
	if err := svc.DeleteFunctionPath(ctx, "dep1", "hello"); err != nil {
		t.Fatalf("delete function: %v", err)
	}
	if _, err := os.Stat(filepath.Join(workDir, "volumes", "functions", "hello")); !os.IsNotExist(err) {
		t.Errorf("function dir still exists: %v", err)
	}
	if _, err := svc.ReadFunctionFile(ctx, "dep1", "hello/index.ts"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("read of deleted file should be not-exist, got %v", err)
	}
}

func TestFunctionPathsCannotEscape(t *testing.T) {
	ctx := context.Background()
	svc, _ := newFunctionsTestService(t, "fn", map[string]string{}, nil)
	for _, p := range []string{
		"", "../x", "/etc/passwd", "hello/../../x", "hello/..", ".hidden/index.ts",
		"hello/.env", "hello//index.ts", "hello/", `..\x`, "bad name/index.ts", "a.b/index.ts",
	} {
		if err := svc.WriteFunctionFile(ctx, "dep1", p, "x"); err == nil {
			t.Errorf("write %q should be rejected", p)
		}
	}
}

func TestResolveInsideRejectsSymlinkEscape(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "evil")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	if _, err := resolveInside(root, "evil/secret.txt"); err == nil {
		t.Errorf("path through a symlink leaving root must be rejected")
	}
	if _, err := resolveInside(root, "fine/index.ts"); err != nil {
		t.Errorf("new nested path inside root should be allowed: %v", err)
	}
}

func TestSecretsRoundTrip(t *testing.T) {
	ctx := context.Background()
	svc, workDir := newFunctionsTestService(t, "fn", map[string]string{}, nil)

	want := []SecretEnv{
		{Key: "APNS_KEY_ID", Value: "ABC123XYZ"},
		{Key: "APNS_PRIVATE_KEY_FILE", Value: "/run/secrets/AuthKey.p8"},
		{Key: "WITH_SPACE", Value: "hello world # not a comment"},
		{Key: "DOLLAR", Value: "a$b${HOME}"},
		{Key: "QUOTE", Value: `it's "quoted" \ ok`},
		{Key: "EMPTY", Value: ""},
	}
	if err := svc.SaveSecrets(ctx, "dep1", append([]SecretEnv(nil), want...)); err != nil {
		t.Fatalf("save: %v", err)
	}
	info, err := svc.Secrets(ctx, "dep1")
	if err != nil {
		t.Fatalf("secrets: %v", err)
	}
	if len(info.Env) != len(want) {
		t.Fatalf("got %d entries, want %d: %+v", len(info.Env), len(want), info.Env)
	}
	for i := range want {
		if info.Env[i] != want[i] {
			t.Errorf("entry %d: got %+v, want %+v", i, info.Env[i], want[i])
		}
	}
	if runtime.GOOS != "windows" {
		fi, err := os.Stat(filepath.Join(workDir, ".env.functions"))
		if err != nil || fi.Mode().Perm() != 0o600 {
			t.Errorf(".env.functions should be 0600: %v %v", fi.Mode(), err)
		}
	}

	for name, bad := range map[string][]SecretEnv{
		"reserved key":    {{Key: "JWT_SECRET", Value: "x"}},
		"reserved prefix": {{Key: "SUPABASE_URL", Value: "x"}},
		"bad name":        {{Key: "1BAD", Value: "x"}},
		"duplicate":       {{Key: "A", Value: "1"}, {Key: "A", Value: "2"}},
		"multi-line":      {{Key: "PEM", Value: "-----BEGIN\nabc"}},
		"quote+dollar":    {{Key: "X", Value: `it's $HOME`}},
	} {
		if err := svc.SaveSecrets(ctx, "dep1", bad); err == nil {
			t.Errorf("%s: expected error", name)
		}
	}

	key := []byte("-----BEGIN PRIVATE KEY-----\nMIGT\n-----END PRIVATE KEY-----\n")
	if err := svc.WriteSecretFile(ctx, "dep1", "AuthKey.p8", key); err != nil {
		t.Fatalf("write secret file: %v", err)
	}
	if err := svc.WriteSecretFile(ctx, "dep1", "../escape", key); err == nil {
		t.Errorf("secret file name with .. must be rejected")
	}
	info, _ = svc.Secrets(ctx, "dep1")
	if len(info.Files) != 1 || info.Files[0].ContainerPath != "/run/secrets/AuthKey.p8" || info.Files[0].Size != int64(len(key)) {
		t.Errorf("unexpected secret files: %+v", info.Files)
	}
	if err := svc.DeleteSecretFile(ctx, "dep1", "AuthKey.p8"); err != nil {
		t.Fatalf("delete secret file: %v", err)
	}
	info, _ = svc.Secrets(ctx, "dep1")
	if len(info.Files) != 0 {
		t.Errorf("secret file not deleted: %+v", info.Files)
	}
}

func TestParseDotenvHandlesManualEdits(t *testing.T) {
	got := parseDotenv([]byte("# comment\n\nexport A=1\nB = 'two words'\nC=\"x\\\"y\"\nD=plain # trailing\r\nnot a pair\n=novalue\n"))
	want := []SecretEnv{{"A", "1"}, {"B", "two words"}, {"C", `x"y`}, {"D", "plain"}}
	if len(got) != len(want) {
		t.Fatalf("got %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("entry %d: got %+v, want %+v", i, got[i], want[i])
		}
	}
}

func TestFunctionsDisabledAndUnsupported(t *testing.T) {
	ctx := context.Background()
	svc, _ := newFunctionsTestService(t, "fn", map[string]string{"functions": "off"}, nil)
	info, err := svc.ListFunctions(ctx, "dep1")
	if err != nil || info.Enabled {
		t.Errorf("disabled deployment should list as disabled: %+v %v", info, err)
	}
	if err := svc.WriteFunctionFile(ctx, "dep1", "a/index.ts", "x"); !errors.Is(err, ErrFunctionsDisabled) {
		t.Errorf("want ErrFunctionsDisabled, got %v", err)
	}

	svc, _ = newFunctionsTestService(t, "plain", map[string]string{}, nil)
	if _, err := svc.ListFunctions(ctx, "dep1"); !errors.Is(err, ErrFunctionsUnsupported) {
		t.Errorf("want ErrFunctionsUnsupported, got %v", err)
	}
}

func TestWriteArtifactsKeepsSeedFiles(t *testing.T) {
	svc, workDir := newFunctionsTestService(t, "fn", map[string]string{}, nil)
	drv := &fnDriver{seeds: map[string]string{
		"volumes/functions/main/index.ts": "// seeded\n",
		".env.functions":                  "# seeded\n",
	}}
	d := &Deployment{ID: "dep1", WorkDir: workDir, Config: map[string]string{}}
	if err := svc.writeArtifacts(drv, d); err != nil {
		t.Fatalf("first render: %v", err)
	}
	main := filepath.Join(workDir, "volumes", "functions", "main", "index.ts")
	if err := os.WriteFile(main, []byte("// edited by user\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := svc.writeArtifacts(drv, d); err != nil {
		t.Fatalf("second render: %v", err)
	}
	if b, _ := os.ReadFile(main); string(b) != "// edited by user\n" {
		t.Errorf("seed file was overwritten: %q", b)
	}
	if runtime.GOOS != "windows" {
		if fi, err := os.Stat(filepath.Join(workDir, ".env.functions")); err != nil || fi.Mode().Perm() != 0o600 {
			t.Errorf("seeded .env file should be 0600: %v %v", fi, err)
		}
	}
}

func TestLoadedDeploymentKeepsExtraEnv(t *testing.T) {
	svc, _ := newFunctionsTestService(t, "fn", map[string]string{}, []store.TemplateDeploymentEnv{{Key: "EXTRA", Value: "1"}})
	d, err := svc.Get(context.Background(), "dep1")
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if d.Env["EXTRA"] != "1" {
		t.Errorf("env rows not loaded; re-renders would drop them: %+v", d.Env)
	}
}

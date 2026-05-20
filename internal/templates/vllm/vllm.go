// Package vllm provides a template driver for deploying LLM models via the
// vLLM OpenAI-compatible server. It supports two image strategies:
//
//   - Stock image: when extra_pip_packages is empty, the compose uses the
//     image tag directly (e.g. vllm/vllm-openai:latest, :nightly, :v0.6.5).
//   - Build-on-host: when extra_pip_packages is non-empty, a Dockerfile is
//     emitted that FROMs the same image, installs git + ca-certificates,
//     and pip-installs every line as a separate dependency. This is how
//     fresh-from-HF builds (e.g. transformers main) get wired in.
//
// Everything else — model, served name, port, GPU config, extra CLI args —
// is dynamic via form fields so the same template can serve very different
// models without code changes.
package vllm

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"text/template"

	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
)

type Driver struct{}

func New() *Driver { return &Driver{} }

func (d *Driver) Definition() templates.Definition {
	return templates.Definition{
		ID:          "vllm",
		Name:        "vLLM (LLM inference)",
		Description: "Deploy a HuggingFace model behind an OpenAI-compatible API using vLLM. Supports stock images and build-on-host for bleeding-edge dependencies.",
		Fields: []templates.Field{
			{Key: "model", Label: "HuggingFace model ID", Type: templates.FieldText, Required: true, Description: "Full HF repo path passed to vLLM as --model.", Placeholder: "google/gemma-4-31B-it", Group: "model"},
			{Key: "served_model_name", Label: "Served model name", Type: templates.FieldText, Required: true, Description: "Short alias clients send in the OpenAI 'model' field.", Placeholder: "gemma-4-31B", Group: "model"},
			{Key: "hf_token", Label: "HuggingFace token", Type: templates.FieldSecret, Required: false, Description: "Required for gated models. Leave blank for fully public weights.", Group: "model"},
			{Key: "hf_cache_dir", Label: "HF cache directory (host)", Type: templates.FieldText, Required: true, Default: "/opt/hf-cache", Description: "Absolute host path mounted into the container at /hf-cache. Models and torch.compile cache live here.", Group: "model"},

			{Key: "vllm_image", Label: "vLLM image", Type: templates.FieldText, Required: true, Default: "vllm/vllm-openai:latest", Description: "Image tag. Use :nightly for the latest features, a pinned :vX.Y.Z for reproducibility, or any custom tag.", Group: "image"},
			{Key: "extra_pip_packages", Label: "Extra pip packages (one per line)", Type: templates.FieldTextarea, Required: false, Description: "When set, server-monitor renders a Dockerfile that installs these on top of vLLM. Useful for `git+https://github.com/huggingface/transformers.git` style fresh deps.", Placeholder: "git+https://github.com/huggingface/transformers.git\n", Group: "image"},

			{Key: "tensor_parallel_size", Label: "Tensor parallel size", Type: templates.FieldNumber, Required: true, Default: "1", Description: "Number of GPUs to shard the model across (--tensor-parallel-size).", Group: "serving"},
			{Key: "max_model_len", Label: "Max model length (tokens)", Type: templates.FieldNumber, Required: false, Description: "Context window passed as --max-model-len. Leave blank to let vLLM use the model's full context.", Placeholder: "32768", Group: "serving"},
			{Key: "gpu_memory_utilization", Label: "GPU memory utilization", Type: templates.FieldText, Required: true, Default: "0.9", Description: "Fraction of total GPU memory vLLM may reserve (0.0–1.0).", Group: "serving"},
			{Key: "extra_cli_args", Label: "Extra vLLM CLI args (one argv per line)", Type: templates.FieldTextarea, Required: false, Description: "Appended verbatim to the vLLM command. Each line is one argv entry — put '--flag' on one line and its value on the next. JSON values are fine.", Placeholder: "--max-num-seqs\n6\n--reasoning-parser\nqwen3\n--speculative-config\n{\"method\":\"mtp\",\"num_speculative_tokens\":4}", Group: "serving"},
		},
		Ports: []templates.PortField{
			{Key: "vllm", Label: "vLLM API port", Default: 8000, Description: "Host port exposing vLLM's OpenAI-compatible API."},
		},
		SupportsUpdate: true,
	}
}

func (d *Driver) Validate(input templates.DeployInput) error {
	cfg := input.Config
	if strings.TrimSpace(cfg["model"]) == "" {
		return fmt.Errorf("model is required")
	}
	served := strings.TrimSpace(cfg["served_model_name"])
	if served == "" {
		return fmt.Errorf("served_model_name is required")
	}
	if strings.ContainsAny(served, " \t\n\r") {
		return fmt.Errorf("served_model_name must not contain whitespace")
	}
	if cache := strings.TrimSpace(cfg["hf_cache_dir"]); cache != "" {
		if !strings.HasPrefix(cache, "/") && !winAbsRe.MatchString(cache) {
			return fmt.Errorf("hf_cache_dir must be an absolute path (got %q)", cache)
		}
	}
	if v := strings.TrimSpace(cfg["tensor_parallel_size"]); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > 64 {
			return fmt.Errorf("tensor_parallel_size must be a positive integer (got %q)", v)
		}
	}
	if v := strings.TrimSpace(cfg["max_model_len"]); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			return fmt.Errorf("max_model_len must be a positive integer (got %q)", v)
		}
	}
	if v := strings.TrimSpace(cfg["gpu_memory_utilization"]); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil || f <= 0 || f > 1 {
			return fmt.Errorf("gpu_memory_utilization must be a float between 0 and 1 (got %q)", v)
		}
	}
	for k, v := range input.Ports {
		if v <= 0 || v > 65535 {
			return fmt.Errorf("invalid port %q: %d", k, v)
		}
	}
	for k := range input.Env {
		if !envKeyRe.MatchString(k) {
			return fmt.Errorf("invalid env var name %q (use A-Z, 0-9, _; must start with a letter)", k)
		}
	}
	return nil
}

func (d *Driver) Render(dep *templates.Deployment) (templates.RenderedArtifacts, error) {
	pipPackages := splitLines(dep.Config["extra_pip_packages"])
	cliArgs := splitLines(dep.Config["extra_cli_args"])
	needsBuild := len(pipPackages) > 0

	data := struct {
		Dep         *templates.Deployment
		Config      map[string]string
		Ports       map[string]int
		NeedsBuild  bool
		PipPackages []string
		ExtraArgs   []string
	}{
		Dep:         dep,
		Config:      dep.Config,
		Ports:       dep.Ports,
		NeedsBuild:  needsBuild,
		PipPackages: pipPackages,
		ExtraArgs:   cliArgs,
	}

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

	files := map[string]string{}
	if needsBuild {
		dfBuf := &bytes.Buffer{}
		if err := dockerfileTpl.Execute(dfBuf, data); err != nil {
			return templates.RenderedArtifacts{}, fmt.Errorf("Dockerfile render: %w", err)
		}
		files["Dockerfile"] = dfBuf.String()
	}

	return templates.RenderedArtifacts{
		Compose: composeBuf.String(),
		Env:     envBuf.String(),
		Files:   files,
	}, nil
}

// splitLines splits a textarea value into trimmed, non-blank lines. Comment
// lines (starting with '#') are dropped so users can annotate their input.
func splitLines(s string) []string {
	out := []string{}
	for _, line := range strings.Split(s, "\n") {
		t := strings.TrimRight(line, "\r")
		// Trim trailing whitespace only; preserve leading whitespace inside
		// JSON values for readability.
		t = strings.TrimRight(t, " \t")
		if t == "" || strings.HasPrefix(strings.TrimSpace(t), "#") {
			continue
		}
		out = append(out, t)
	}
	return out
}

// yamlQuote renders a string as a double-quoted YAML scalar. Used for items
// in the `command:` array so JSON payloads and odd characters survive the
// YAML parser unchanged.
func yamlQuote(s string) string {
	var b strings.Builder
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\':
			b.WriteString(`\\`)
		case '"':
			b.WriteString(`\"`)
		case '\n':
			b.WriteString(`\n`)
		case '\r':
			b.WriteString(`\r`)
		case '\t':
			b.WriteString(`\t`)
		default:
			b.WriteRune(r)
		}
	}
	b.WriteByte('"')
	return b.String()
}

var (
	composeTpl = template.Must(template.New("compose").Funcs(template.FuncMap{
		"yamlQuote": yamlQuote,
	}).Parse(vllmComposeYAML))

	envTpl = template.Must(template.New("env").Parse(`# Auto-generated by server-monitor. Do not edit by hand.
HF_TOKEN={{ .Config.hf_token }}
HF_CACHE_DIR={{ .Config.hf_cache_dir }}
VLLM_PORT={{ .Ports.vllm }}
PROJECT_SLUG={{ .Dep.Slug }}
`))

	dockerfileTpl = template.Must(template.New("dockerfile").Parse(vllmDockerfile))
)

var (
	envKeyRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9_]{0,63}$`)
	// winAbsRe matches Windows absolute paths like C:\foo so tests / mixed
	// hosts don't false-reject. Linux abs paths (/foo) are handled separately.
	winAbsRe = regexp.MustCompile(`^[A-Za-z]:[\\/]`)
)

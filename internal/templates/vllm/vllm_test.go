package vllm

import (
	"strings"
	"testing"
	"time"

	"github.com/ANASDAVOODTK/server-monitor/internal/templates"
)

func TestValidateRequiresModel(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{Name: "demo", Config: map[string]string{}})
	if err == nil || !strings.Contains(err.Error(), "model") {
		t.Fatalf("expected model required error, got %v", err)
	}
}

func TestValidateRejectsWhitespaceInServedName(t *testing.T) {
	d := New()
	err := d.Validate(templates.DeployInput{
		Name: "demo",
		Config: map[string]string{
			"model":             "google/gemma-4-31B-it",
			"served_model_name": "has space",
		},
	})
	if err == nil {
		t.Fatalf("expected whitespace error")
	}
}

func TestValidateRejectsBadGPUUtilization(t *testing.T) {
	d := New()
	in := validInput()
	in.Config["gpu_memory_utilization"] = "1.5"
	if err := d.Validate(in); err == nil {
		t.Fatalf("expected error for util > 1")
	}
}

func TestValidateRejectsBadTensorParallel(t *testing.T) {
	d := New()
	in := validInput()
	in.Config["tensor_parallel_size"] = "0"
	if err := d.Validate(in); err == nil {
		t.Fatalf("expected error for tensor_parallel_size=0")
	}
}

func TestValidateRejectsRelativeCacheDir(t *testing.T) {
	d := New()
	in := validInput()
	in.Config["hf_cache_dir"] = "relative/path"
	if err := d.Validate(in); err == nil {
		t.Fatalf("expected error for non-absolute cache dir")
	}
}

func TestValidateAcceptsValidInput(t *testing.T) {
	d := New()
	if err := d.Validate(validInput()); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestRenderImageOnly(t *testing.T) {
	d := New()
	dep := buildDeployment()
	out, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out.Compose, "image: vllm/vllm-openai:latest") {
		t.Errorf("compose missing image line:\n%s", out.Compose)
	}
	if strings.Contains(out.Compose, "build:") {
		t.Errorf("compose should not include build: when no extra pip packages")
	}
	if _, ok := out.Files["Dockerfile"]; ok {
		t.Errorf("Dockerfile should not be rendered without extra_pip_packages")
	}
	for _, want := range []string{
		"name: qwen-deploy",
		`"--model"`,
		`"Qwen/Qwen3.6-27B-FP8"`,
		`"--served-model-name"`,
		`"qwen3-27b"`,
		`"--max-model-len"`,
		`"65536"`,
		`"--gpu-memory-utilization"`,
		`"0.5"`,
		"${VLLM_PORT}:8000",
		"${HF_CACHE_DIR}:/hf-cache",
	} {
		if !strings.Contains(out.Compose, want) {
			t.Errorf("compose missing %q", want)
		}
	}
	for _, want := range []string{
		"HF_TOKEN=hf_test_token",
		"HF_CACHE_DIR=/opt/hf-cache",
		"VLLM_PORT=8012",
		"PROJECT_SLUG=qwen-deploy",
	} {
		if !strings.Contains(out.Env, want) {
			t.Errorf("env missing %q\nfull:\n%s", want, out.Env)
		}
	}
}

func TestRenderWithBuildAndExtraArgs(t *testing.T) {
	d := New()
	dep := buildDeployment()
	dep.Config["vllm_image"] = "vllm/vllm-openai:nightly"
	dep.Config["extra_pip_packages"] = "git+https://github.com/huggingface/transformers.git\n# comment\naccelerate>=0.30\n"
	dep.Config["extra_cli_args"] = "--max-num-seqs\n6\n--speculative-config\n{\"method\":\"mtp\",\"num_speculative_tokens\":4}\n"
	out, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if !strings.Contains(out.Compose, "build:") {
		t.Errorf("compose missing build: section")
	}
	if !strings.Contains(out.Compose, "image: vllm-qwen-deploy:custom") {
		t.Errorf("compose missing custom image tag")
	}
	if !strings.Contains(out.Compose, `"--max-num-seqs"`) || !strings.Contains(out.Compose, `"6"`) {
		t.Errorf("compose missing --max-num-seqs extra args")
	}
	if !strings.Contains(out.Compose, `"--speculative-config"`) {
		t.Errorf("compose missing --speculative-config")
	}
	// JSON arg must survive escaping intact (YAML double-quote with \" escapes).
	if !strings.Contains(out.Compose, `"{\"method\":\"mtp\",\"num_speculative_tokens\":4}"`) {
		t.Errorf("speculative-config JSON not yaml-quoted properly:\n%s", out.Compose)
	}
	df, ok := out.Files["Dockerfile"]
	if !ok {
		t.Fatalf("Dockerfile not rendered when extra_pip_packages set")
	}
	if !strings.Contains(df, "FROM vllm/vllm-openai:nightly") {
		t.Errorf("Dockerfile FROM wrong base:\n%s", df)
	}
	if !strings.Contains(df, "apt-get install -y --no-install-recommends git ca-certificates") {
		t.Errorf("Dockerfile missing git install step")
	}
	if !strings.Contains(df, "pip install --no-cache-dir git+https://github.com/huggingface/transformers.git") {
		t.Errorf("Dockerfile missing first pip line:\n%s", df)
	}
	if !strings.Contains(df, "pip install --no-cache-dir accelerate>=0.30") {
		t.Errorf("Dockerfile missing second pip line")
	}
	if strings.Contains(df, "comment") {
		t.Errorf("Dockerfile must not include commented lines:\n%s", df)
	}
}

func TestRenderIsDeterministic(t *testing.T) {
	d := New()
	dep := buildDeployment()
	a, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	b, err := d.Render(dep)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if a.Compose != b.Compose || a.Env != b.Env {
		t.Errorf("render not deterministic")
	}
}

func validInput() templates.DeployInput {
	return templates.DeployInput{
		Name: "qwen-deploy",
		Config: map[string]string{
			"model":                  "Qwen/Qwen3.6-27B-FP8",
			"served_model_name":      "qwen3-27b",
			"hf_token":               "hf_test_token",
			"hf_cache_dir":           "/opt/hf-cache",
			"vllm_image":             "vllm/vllm-openai:latest",
			"tensor_parallel_size":   "1",
			"max_model_len":          "65536",
			"gpu_memory_utilization": "0.5",
		},
		Ports: map[string]int{"vllm": 8012},
	}
}

func buildDeployment() *templates.Deployment {
	return &templates.Deployment{
		ID:         "vllmid",
		TemplateID: "vllm",
		Name:       "Qwen Deploy",
		Slug:       "qwen-deploy",
		Status:     templates.StatusDeploying,
		Config: map[string]string{
			"model":                  "Qwen/Qwen3.6-27B-FP8",
			"served_model_name":      "qwen3-27b",
			"hf_token":               "hf_test_token",
			"hf_cache_dir":           "/opt/hf-cache",
			"vllm_image":             "vllm/vllm-openai:latest",
			"tensor_parallel_size":   "1",
			"max_model_len":          "65536",
			"gpu_memory_utilization": "0.5",
		},
		Ports:     map[string]int{"vllm": 8012},
		WorkDir:   "/tmp/qwen-deploy",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
}

package templates

import (
	"fmt"
	"regexp"
)

// RenderedArtifacts is what a driver returns when materializing a deployment.
// Files are written relative to the deployment workdir. The compose file path
// is fixed at docker-compose.yml and the env file at .env.
type RenderedArtifacts struct {
	Compose string            // docker-compose.yml content
	Env     string            // .env file content
	Files   map[string]string // additional relative path -> content (e.g. volumes/kong.yml)
}

// Driver implements the template-specific rendering and validation. The Service
// orchestrates lifecycle (start/stop/update/delete) by calling Docker Compose
// against the rendered artifacts produced here.
type Driver interface {
	// Definition returns metadata used by the catalog and UI form.
	Definition() Definition
	// Validate verifies the user input. Called before persisting a deployment.
	Validate(input DeployInput) error
	// Render returns the docker-compose.yml content, .env file content and any
	// additional support files for the resolved deployment.
	Render(d *Deployment) (RenderedArtifacts, error)
}

// slugRe restricts deployment slugs (used as docker compose project names and
// filesystem paths) to a docker-compose-safe alphabet.
var slugRe = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,38}[a-z0-9]$`)

// ValidateSlug checks that a slug is safe for filesystem + compose project use.
func ValidateSlug(slug string) error {
	if !slugRe.MatchString(slug) {
		return fmt.Errorf("slug must start with a letter, end with a letter or digit, and contain only lowercase letters, digits, '-' or '_' (3-40 chars)")
	}
	return nil
}

// MergeConfig applies driver defaults to user-supplied config, returning a
// fully resolved map. User values always win over defaults.
func MergeConfig(def Definition, input DeployInput) (config map[string]string, ports map[string]int, env map[string]string) {
	config = map[string]string{}
	for _, f := range def.Fields {
		if f.Default != "" {
			config[f.Key] = f.Default
		}
	}
	for k, v := range input.Config {
		config[k] = v
	}
	ports = map[string]int{}
	for _, p := range def.Ports {
		ports[p.Key] = p.Default
	}
	for k, v := range input.Ports {
		if v > 0 {
			ports[k] = v
		}
	}
	env = map[string]string{}
	for k, v := range input.Env {
		env[k] = v
	}
	return
}

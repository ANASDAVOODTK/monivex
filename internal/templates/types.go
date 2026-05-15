package templates

import "time"

// Status constants describe the lifecycle of a deployment.
const (
	StatusPending   = "pending"
	StatusDeploying = "deploying"
	StatusRunning   = "running"
	StatusStopping  = "stopping"
	StatusStopped   = "stopped"
	StatusStarting  = "starting"
	StatusUpdating  = "updating"
	StatusDeleting  = "deleting"
	StatusFailed    = "failed"
)

// FieldType controls UI rendering for a template input field.
type FieldType string

const (
	FieldText     FieldType = "text"
	FieldPassword FieldType = "password"
	FieldSecret   FieldType = "secret"
	FieldNumber   FieldType = "number"
	FieldTextarea FieldType = "textarea"
)

// Field describes one input on the template form.
type Field struct {
	Key         string    `json:"key"`
	Label       string    `json:"label"`
	Type        FieldType `json:"type"`
	Required    bool      `json:"required"`
	Description string    `json:"description,omitempty"`
	Default     string    `json:"default,omitempty"`
	Placeholder string    `json:"placeholder,omitempty"`
	Group       string    `json:"group,omitempty"`
}

// PortField is a numeric port mapping the user can override.
type PortField struct {
	Key         string `json:"key"`
	Label       string `json:"label"`
	Default     int    `json:"default"`
	Description string `json:"description,omitempty"`
}

// Definition is the public metadata for a template. Returned in template
// catalog responses; consumed by the UI to render forms.
type Definition struct {
	ID             string      `json:"id"`
	Name           string      `json:"name"`
	Description    string      `json:"description"`
	Icon           string      `json:"icon,omitempty"`
	Fields         []Field     `json:"fields"`
	Ports          []PortField `json:"ports"`
	SupportsUpdate bool        `json:"supports_update"`
}

// Deployment is the in-memory representation of a provisioned template.
type Deployment struct {
	ID         string            `json:"id"`
	TemplateID string            `json:"template_id"`
	Name       string            `json:"name"`
	Slug       string            `json:"slug"`
	Status     string            `json:"status"`
	Message    string            `json:"message,omitempty"`
	Config     map[string]string `json:"config"`
	Ports      map[string]int    `json:"ports"`
	Env        map[string]string `json:"env"`
	WorkDir    string            `json:"work_dir"`
	CreatedAt  time.Time         `json:"created_at"`
	UpdatedAt  time.Time         `json:"updated_at"`
}

// DeploymentSummary is a slim row used by table listings.
type DeploymentSummary struct {
	ID         string         `json:"id"`
	TemplateID string         `json:"template_id"`
	Name       string         `json:"name"`
	Slug       string         `json:"slug"`
	Status     string         `json:"status"`
	Message    string         `json:"message,omitempty"`
	Ports      map[string]int `json:"ports"`
	CreatedAt  time.Time      `json:"created_at"`
	UpdatedAt  time.Time      `json:"updated_at"`
}

// Event mirrors the persisted lifecycle entry but with json tags for the API.
type Event struct {
	ID        int64     `json:"id"`
	Kind      string    `json:"kind"`
	Message   string    `json:"message"`
	CreatedAt time.Time `json:"created_at"`
}

// DeployInput captures what the API receives when starting a new deployment.
type DeployInput struct {
	Name   string            `json:"name"`
	Config map[string]string `json:"config"`
	Ports  map[string]int    `json:"ports"`
	Env    map[string]string `json:"env"`
}

// EditInput captures the patch applied by the in-place "Edit configuration"
// flow for an existing deployment. Only Config / Env / Ports are mutable;
// the deployment ID, template ID and slug are pinned.
//
// Restart controls whether the service should re-render artifacts and bounce
// the running containers immediately, or just persist the new values for the
// next start.
type EditInput struct {
	Config  map[string]string `json:"config"`
	Ports   map[string]int    `json:"ports"`
	Env     map[string]string `json:"env"`
	Restart bool              `json:"restart"`
}

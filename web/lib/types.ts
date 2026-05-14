export interface Snapshot {
  timestamp: string;
  host: HostInfo;
  cpu: CPUInfo;
  memory: Memory;
  swap: Swap;
  disks: Disk[];
  network: Network[];
  load: Load;
  gpus: GPU[] | null;
  processes: Process[] | null;
  docker: Container[] | null;
  services: ServiceUnit[] | null;
}

export interface HostInfo {
  hostname: string;
  os: string;
  platform: string;
  platform_version: string;
  kernel_version: string;
  uptime: number;
  boot_time: number;
}

export interface CPUInfo {
  cores: number;
  threads: number;
  model: string;
  overall: number;
  per_core: number[] | null;
}

export interface Memory {
  total: number;
  available: number;
  used: number;
  used_percent: number;
}

export interface Swap {
  total: number;
  used: number;
  used_percent: number;
}

export interface Disk {
  device: string;
  mountpoint: string;
  fstype: string;
  total: number;
  used: number;
  free: number;
  used_percent: number;
}

export interface Network {
  name: string;
  bytes_sent: number;
  bytes_recv: number;
  packets_sent: number;
  packets_recv: number;
  send_rate: number;
  recv_rate: number;
}

export interface Load {
  load1: number;
  load5: number;
  load15: number;
}

export interface GPU {
  index: number;
  name: string;
  uuid: string;
  utilization: number;
  memory_total: number;
  memory_used: number;
  memory_used_pct: number;
  temperature: number;
  power_draw: number;
  power_limit: number;
  fan_speed: number;
  graphics_clock: number;
  memory_clock: number;
  processes: GPUProcess[] | null;
}

export interface GPUProcess {
  pid: number;
  name: string;
  memory_used: number;
}

export interface Process {
  pid: number;
  name: string;
  user: string;
  cpu_percent: number;
  mem_percent: number;
  mem_rss: number;
  status: string;
  create_time: number;
  num_threads: number;
  command: string;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created: number;
  cpu_pct: number;
  mem_usage: number;
  mem_limit: number;
  mem_pct: number;
  net_rx: number;
  net_tx: number;
}

export interface ServiceUnit {
  name: string;
  description: string;
  load_state: string;
  active_state: string;
  sub_state: string;
}

export interface NodeApp {
  pm_id: number;
  name: string;
  status: string;
  mode: string;
  cpu: number;
  memory: number;
  restarts: number;
  uptime_ms: number;
  script: string;
  cwd: string;
}

export interface NodeAppsPM2Meta {
  available: boolean;
  version?: string;
  error?: string;
  list_error?: string;
  /** When false or missing, "Start app" from UI is disabled (configure allowed_script_prefixes). */
  can_start_new?: boolean;
  allowed_prefixes?: string[];
}

export interface NodeAppsResponse {
  enabled: boolean;
  pm2: NodeAppsPM2Meta;
  apps: NodeApp[];
}

export type TemplateFieldType = 'text' | 'password' | 'secret' | 'number' | 'textarea';

export interface TemplateField {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  description?: string;
  default?: string;
  placeholder?: string;
  group?: string;
}

export interface TemplatePortField {
  key: string;
  label: string;
  default: number;
  description?: string;
}

export interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  icon?: string;
  fields: TemplateField[];
  ports: TemplatePortField[];
  supports_update: boolean;
}

export interface TemplateEngineStatus {
  available: boolean;
  version?: string;
  error?: string;
}

export interface TemplatesCatalogResponse {
  engine: TemplateEngineStatus;
  templates: TemplateDefinition[];
}

export type DeploymentStatus =
  | 'pending'
  | 'deploying'
  | 'running'
  | 'stopping'
  | 'stopped'
  | 'starting'
  | 'updating'
  | 'deleting'
  | 'failed';

export interface DeploymentSummary {
  id: string;
  template_id: string;
  name: string;
  slug: string;
  status: DeploymentStatus;
  message?: string;
  ports: Record<string, number>;
  created_at: string;
  updated_at: string;
}

export interface Deployment extends DeploymentSummary {
  config: Record<string, string>;
  env: Record<string, string>;
  work_dir: string;
}

export interface DeploymentEvent {
  id: number;
  kind: string;
  message: string;
  created_at: string;
}

export interface DeployInput {
  name: string;
  config: Record<string, string>;
  ports: Record<string, number>;
  env: Record<string, string>;
}

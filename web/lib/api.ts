const BASE = '/api/v1';

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const enc = (s: string) => encodeURIComponent(s);

export interface ServerSummary {
  id: string;
  name: string;
  base_url: string;
  is_self: boolean;
  enabled: boolean;
  connected: boolean;
  last_seen?: number;
  last_error?: string;
  hostname?: string;
  kernel?: string;
  uptime?: number;
  cpu_percent?: number;
  mem_percent?: number;
  disk_percent?: number;
}

export interface APIKeySummary {
  id: string;
  name: string;
  created_at: number;
  last_used_at?: number;
}

export const api = {
  setupStatus: () => request<{ needs_setup: boolean }>('/setup/status'),
  setup: (token: string, username: string, password: string) =>
    request<{ token: string }>('/setup', {
      method: 'POST',
      body: JSON.stringify({ token, username, password }),
    }),
  login: (username: string, password: string) =>
    request<{ token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ username: string; uid: number }>('/me'),
  changePassword: (oldPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/password', {
      method: 'POST',
      body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
    }),

  // ---- Server registry (hub-level) ----
  serversList: () => request<ServerSummary[]>('/servers'),
  serverCreate: (body: { name: string; base_url: string; api_key: string }) =>
    request<ServerSummary>('/servers', { method: 'POST', body: JSON.stringify(body) }),
  serverUpdate: (
    id: string,
    body: { name?: string; base_url?: string; api_key?: string; enabled?: boolean },
  ) => request<ServerSummary>(`/servers/${enc(id)}`, { method: 'PUT', body: JSON.stringify(body) }),
  serverDelete: (id: string) =>
    request<{ ok: boolean }>(`/servers/${enc(id)}`, { method: 'DELETE' }),
  serverTest: (body: { base_url: string; api_key: string }) =>
    request<{ ok: boolean; host: { hostname: string; kernel_version: string; uptime: number } }>(
      '/servers/test',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  // ---- API keys (this hub's own keys) ----
  apiKeysList: () => request<APIKeySummary[]>('/api-keys'),
  apiKeyCreate: (name: string) =>
    request<APIKeySummary & { secret: string }>('/api-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  apiKeyDelete: (id: string) =>
    request<{ ok: boolean }>(`/api-keys/${enc(id)}`, { method: 'DELETE' }),

  // ---- Per-server endpoints (use these from server-detail pages) ----
  snapshot: (serverId: string) =>
    request<import('./types').Snapshot>(`/servers/${enc(serverId)}/snapshot`),
  history: (serverId: string, range: string) =>
    request<any[]>(`/servers/${enc(serverId)}/history?range=${enc(range)}`),
  logSources: (serverId: string) =>
    request<string[]>(`/servers/${enc(serverId)}/logs/sources`),
  dockerStart: (serverId: string, id: string) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/docker/containers/${enc(id)}/start`, {
      method: 'POST',
    }),
  dockerStop: (serverId: string, id: string) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/docker/containers/${enc(id)}/stop`, {
      method: 'POST',
    }),
  dockerRestart: (serverId: string, id: string) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/docker/containers/${enc(id)}/restart`, {
      method: 'POST',
    }),
  nodeApps: (serverId: string) =>
    request<import('./types').NodeAppsResponse>(`/servers/${enc(serverId)}/node-apps`),
  nodeAppCreate: (serverId: string, body: { script: string; name: string; cwd?: string }) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/node-apps`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  nodeAppStart: (serverId: string, pmId: number) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/node-apps/${pmId}/start`, { method: 'POST' }),
  nodeAppStop: (serverId: string, pmId: number) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/node-apps/${pmId}/stop`, { method: 'POST' }),
  nodeAppRestart: (serverId: string, pmId: number) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/node-apps/${pmId}/restart`, { method: 'POST' }),
  nodeAppDelete: (serverId: string, pmId: number) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/node-apps/${pmId}/delete`, { method: 'POST' }),
  templatesCatalog: (serverId: string) =>
    request<import('./types').TemplatesCatalogResponse>(`/servers/${enc(serverId)}/templates`),
  templateGet: (serverId: string, id: string) =>
    request<import('./types').TemplateDefinition>(`/servers/${enc(serverId)}/templates/${enc(id)}`),
  templateDefaults: (serverId: string, id: string) =>
    request<import('./types').TemplateDefaults>(
      `/servers/${enc(serverId)}/templates/${enc(id)}/defaults`,
    ),
  templateDeploy: (serverId: string, id: string, body: import('./types').DeployInput) =>
    request<import('./types').Deployment>(`/servers/${enc(serverId)}/templates/${enc(id)}/deploy`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deploymentList: (serverId: string) =>
    request<import('./types').DeploymentSummary[]>(`/servers/${enc(serverId)}/templates/deployments`),
  deploymentGet: (serverId: string, id: string) =>
    request<import('./types').Deployment>(`/servers/${enc(serverId)}/templates/deployments/${enc(id)}`),
  deploymentEvents: (serverId: string, id: string) =>
    request<import('./types').DeploymentEvent[]>(
      `/servers/${enc(serverId)}/templates/deployments/${enc(id)}/events`,
    ),
  deploymentStart: (serverId: string, id: string) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/templates/deployments/${enc(id)}/start`, {
      method: 'POST',
    }),
  deploymentStop: (serverId: string, id: string) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/templates/deployments/${enc(id)}/stop`, {
      method: 'POST',
    }),
  deploymentUpdate: (serverId: string, id: string) =>
    request<{ ok: boolean }>(`/servers/${enc(serverId)}/templates/deployments/${enc(id)}/update`, {
      method: 'POST',
    }),
  deploymentEdit: (serverId: string, id: string, body: import('./types').EditInput) =>
    request<import('./types').Deployment>(
      `/servers/${enc(serverId)}/templates/deployments/${enc(id)}/edit`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  deploymentDelete: (serverId: string, id: string, removeVolumes = false) =>
    request<{ ok: boolean }>(
      `/servers/${enc(serverId)}/templates/deployments/${enc(id)}/delete${removeVolumes ? '?volumes=true' : ''}`,
      { method: 'POST' },
    ),
};

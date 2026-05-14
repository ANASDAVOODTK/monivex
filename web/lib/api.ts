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
  snapshot: () => request<import('./types').Snapshot>('/snapshot'),
  history: (range: string) => request<any[]>(`/history?range=${encodeURIComponent(range)}`),
  logSources: () => request<string[]>('/logs/sources'),
  dockerStart: (id: string) => request<{ ok: boolean }>(`/docker/containers/${id}/start`, { method: 'POST' }),
  dockerStop: (id: string) => request<{ ok: boolean }>(`/docker/containers/${id}/stop`, { method: 'POST' }),
  dockerRestart: (id: string) => request<{ ok: boolean }>(`/docker/containers/${id}/restart`, { method: 'POST' }),
  nodeApps: () => request<import('./types').NodeAppsResponse>('/node-apps'),
  nodeAppCreate: (body: { script: string; name: string; cwd?: string }) =>
    request<{ ok: boolean }>('/node-apps', { method: 'POST', body: JSON.stringify(body) }),
  nodeAppStart: (pmId: number) =>
    request<{ ok: boolean }>(`/node-apps/${pmId}/start`, { method: 'POST' }),
  nodeAppStop: (pmId: number) =>
    request<{ ok: boolean }>(`/node-apps/${pmId}/stop`, { method: 'POST' }),
  nodeAppRestart: (pmId: number) =>
    request<{ ok: boolean }>(`/node-apps/${pmId}/restart`, { method: 'POST' }),
  nodeAppDelete: (pmId: number) =>
    request<{ ok: boolean }>(`/node-apps/${pmId}/delete`, { method: 'POST' }),
  templatesCatalog: () => request<import('./types').TemplatesCatalogResponse>('/templates'),
  templateGet: (id: string) => request<import('./types').TemplateDefinition>(`/templates/${id}`),
  templateDeploy: (id: string, body: import('./types').DeployInput) =>
    request<import('./types').Deployment>(`/templates/${id}/deploy`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deploymentList: () => request<import('./types').DeploymentSummary[]>('/templates/deployments'),
  deploymentGet: (id: string) => request<import('./types').Deployment>(`/templates/deployments/${id}`),
  deploymentEvents: (id: string) =>
    request<import('./types').DeploymentEvent[]>(`/templates/deployments/${id}/events`),
  deploymentStart: (id: string) =>
    request<{ ok: boolean }>(`/templates/deployments/${id}/start`, { method: 'POST' }),
  deploymentStop: (id: string) =>
    request<{ ok: boolean }>(`/templates/deployments/${id}/stop`, { method: 'POST' }),
  deploymentUpdate: (id: string) =>
    request<{ ok: boolean }>(`/templates/deployments/${id}/update`, { method: 'POST' }),
  deploymentDelete: (id: string, removeVolumes = false) =>
    request<{ ok: boolean }>(
      `/templates/deployments/${id}/delete${removeVolumes ? '?volumes=true' : ''}`,
      { method: 'POST' },
    ),
};

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
};

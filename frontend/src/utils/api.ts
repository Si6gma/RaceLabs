// Writes to the backend carry the control key when one has been set on this
// browser. The key lives in localStorage; the backend decides whether it is
// required (GET /api/access).
const KEY = 'racelabs.controlKey';

export function getControlKey(): string {
  try { return localStorage.getItem(KEY) ?? ''; } catch { return ''; }
}

export function setControlKey(value: string): void {
  try {
    if (value) localStorage.setItem(KEY, value); else localStorage.removeItem(KEY);
  } catch { /* storage unavailable: the key just will not persist */ }
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const key = getControlKey();
  const headers = new Headers(init.headers ?? {});
  if (key) headers.set('X-Control-Key', key);
  return fetch(input, { ...init, headers });
}

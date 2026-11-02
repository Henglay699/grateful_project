import type { ApiErrorBody, AuthResponse, ErrorCode } from '@gs/shared';

/** Error thrown for any non-2xx API response, carrying the server's error body. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const BASE = '/api/v1';

/* ---------- Access token: kept in memory only (never localStorage). ---------- */
let accessToken: string | null = null;
let onSessionLost: (() => void) | null = null;

export const session = {
  setToken(token: string | null) {
    accessToken = token;
  },
  hasToken: () => accessToken !== null,
  authHeader: (): Record<string, string> =>
    accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  /** Called when a refresh fails mid-session, so the UI can return to /login. */
  onLost(cb: () => void) {
    onSessionLost = cb;
  },
};

async function toApiError(res: Response): Promise<ApiError> {
  let body: Partial<ApiErrorBody> | null = null;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    /* non-JSON error (proxy, network) */
  }
  const err = body?.error;
  return new ApiError(
    res.status,
    err?.code ?? (res.status >= 500 ? 'INTERNAL' : 'VALIDATION_ERROR'),
    err?.message ?? `Request failed (${res.status})`,
    err?.details,
  );
}

/* ---------- Refresh: single-flight so parallel 401s trigger one refresh. ---------- */
let refreshing: Promise<AuthResponse | null> | null = null;

export function refreshSession(): Promise<AuthResponse | null> {
  refreshing ??= (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!res.ok) {
        accessToken = null;
        return null;
      }
      const data = (await res.json()) as AuthResponse;
      accessToken = data.accessToken;
      return data;
    } catch {
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  body?: BodyInit;
  query?: Record<
    string,
    string | number | boolean | undefined | null | readonly (string | number)[]
  >;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, String(x)));
    else url.searchParams.set(k, String(v));
  }
  return url.pathname + url.search;
}

/** Fetch JSON from the API with auth, one transparent refresh on 401, and typed errors. */
export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const { json, query, headers, ...init } = opts;
  const h = new Headers(headers);
  if (json !== undefined) h.set('Content-Type', 'application/json');
  if (accessToken) h.set('Authorization', `Bearer ${accessToken}`);

  const res = await fetch(buildUrl(path, query), {
    ...init,
    headers: h,
    credentials: 'include',
    body: json !== undefined ? JSON.stringify(json) : opts.body,
  });

  if (res.status === 401 && !retried && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return api<T>(path, opts, true);
    onSessionLost?.();
  }
  if (!res.ok) throw await toApiError(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

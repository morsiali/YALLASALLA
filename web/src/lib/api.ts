export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: any,
  ) {
    super(message);
  }
}

/**
 * Web: same-origin `/api` (dev proxy or reverse proxy). Android/iOS (Capacitor) and split deployments: set VITE_API_BASE at
 * build time to the absolute API origin, e.g. https://api.example.ae  (the `/api` prefix is added here).
 */
const ORIGIN = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '');
export const apiUrl = (path: string) => `${ORIGIN}${path.startsWith('/api/') ? path : `/api${path}`}`;

const TOKEN_KEY = 'yalasala.token';
let token: string | null = null;
try {
  token = localStorage.getItem(TOKEN_KEY);
} catch {
  /* storage unavailable (private mode): session-only */
}
export const getToken = () => token;
export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export interface ReqOptions {
  method?: string;
  body?: unknown;
  idempotencyKey?: string;
  form?: FormData;
  signal?: AbortSignal;
}

export async function api<T = any>(path: string, opts: ReqOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method: opts.method ?? (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'network');
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const err = data?.error;
    if (res.status === 401 && token) {
      /* expired/invalid token: let AuthProvider clear it */ window.dispatchEvent(
        new Event('yalasala:unauthorized'),
      );
    }
    throw new ApiError(res.status, err?.code ?? 'ERROR', err?.message ?? res.statusText, err?.details);
  }
  return data as T;
}

export const newIdempotencyKey = () => `web-${crypto.randomUUID()}`;

/** Retry transient failures (network / 5xx) with backoff. Never retries 4xx. Use only with idempotent calls. */
export async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      const retryable = e instanceof ApiError && (e.status === 0 || e.status >= 500);
      if (!retryable || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 400 * 2 ** i));
    }
  }
  throw last;
}

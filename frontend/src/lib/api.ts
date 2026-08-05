// Every browser-side call to the API goes through here, so the edge prefix is written
// down exactly once.
//
// `/api` is the browser-facing prefix in F03's route table, in both REFERENCE files, and
// in F01's next-intl matcher (which excludes `/api/*` from locale rewriting). The backend
// mounts its routers at `/auth` and `/me` with no prefix, so the edge is what strips
// `/api` — see the auth ledger's open blocker for the one-line Caddyfile change that
// makes this true at runtime.
export const API_BASE = '/api';

export interface ApiResult<T> {
  status: number;
  ok: boolean;
  data: T | null;
  /** The `{ error: { code } }` code, or null on success. Never a display string. */
  code: string | null;
  /**
   * The parsed body whatever the status was. `data` is deliberately null on a failure —
   * a refused call has no payload of type `T` — but some refusals carry a field the
   * screen needs anyway: `EMAIL_RESEND_COOLDOWN` says how many seconds are left, and the
   * countdown has no other source for it.
   */
  payload: unknown;
}

/**
 * A transport-level failure has no error code of its own, and the registry has no entry
 * for "the request never arrived". `UNKNOWN` is the documented fallback and the only
 * honest answer.
 */
const TRANSPORT_FAILURE = 'UNKNOWN';

function readErrorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

export async function apiGet<T>(path: string): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin' });
  } catch {
    return { status: 0, ok: false, data: null, code: TRANSPORT_FAILURE, payload: null };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      status: response.status,
      ok: false,
      data: null,
      code: readErrorCode(payload) ?? TRANSPORT_FAILURE,
      payload,
    };
  }

  return { status: response.status, ok: true, data: payload as T, code: null, payload };
}

async function apiSend<T>(
  path: string,
  init: RequestInit,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { credentials: 'same-origin', ...init });
  } catch {
    return { status: 0, ok: false, data: null, code: TRANSPORT_FAILURE, payload: null };
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    return {
      status: response.status,
      ok: false,
      data: null,
      code: readErrorCode(payload) ?? TRANSPORT_FAILURE,
      payload,
    };
  }

  return { status: response.status, ok: true, data: payload as T, code: null, payload };
}

export function apiPost<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return apiSend<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function apiPatch<T>(path: string, body: unknown): Promise<ApiResult<T>> {
  return apiSend<T>(path, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** `204` carries no body; `apiSend`'s tolerant parse leaves `data` null on success. */
export function apiDelete(path: string): Promise<ApiResult<never>> {
  return apiSend<never>(path, { method: 'DELETE' });
}

/** Multipart upload (`POST /uploads`) — no JSON content-type, the browser sets the boundary. */
export function apiUpload<T>(kind: 'cv' | 'listing', file: File): Promise<ApiResult<T>> {
  const form = new FormData();
  form.append('kind', kind);
  form.append('file', file);
  return apiSend<T>('/uploads', { method: 'POST', body: form });
}

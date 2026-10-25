// Transport details shared by the auth session and the remote backend: headers, timeout, the single retry of a read
// on a network error and the contract's error mapping (backend/docs/API.md, "Ошибки").
import { BACKEND_ERROR_CODES, BackendError, type BackendErrorCode } from "./errors";
import { InvalidResponseError } from "./parse";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ApiConfig {
  /** https://api.evolako.rs — no trailing slash. Empty: demo only. */
  apiBase: string;
  /** sb_publishable_… (or a legacy anon JWT). Never a secret key. */
  publishableKey: string;
}

export const TIMEOUT_MS = 15000;

/** A legacy anon key is a JWT: three dot-separated parts and no "sb_" prefix. */
export function isLegacyJwt(key: string): boolean {
  return !key.startsWith("sb_") && key.split(".").length === 3;
}

/**
 * `apikey` on every request. `Authorization: Bearer <access>` only for a signed-in user; the new publishable key
 * never goes into Authorization (it is not a JWT — the gateway would reject it). A legacy anon JWT is also sent
 * as Bearer when nobody is signed in, like Supabase clients before 2026 (RemoteEndpoint.accessHeaders).
 */
export function accessHeaders(publishableKey: string, userToken: string | null): Record<string, string> {
  const headers: Record<string, string> = { apikey: publishableKey };
  if (userToken) headers.authorization = `Bearer ${userToken}`;
  else if (isLegacyJwt(publishableKey)) headers.authorization = `Bearer ${publishableKey}`;
  return headers;
}

function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError"));
}

/** The caller cancelled the request (init.signal): never retried, never reported as "offline". */
export function cancelled(): DOMException {
  return new DOMException("The request was cancelled.", "AbortError");
}

/**
 * fetch with a 15 s timeout; network failures become BackendError("offline"). `retries` is 0 unless the caller
 * knows the request is safe to repeat: a request whose answer was lost may still have been carried out, so only
 * reads (GET and the read-only RPCs) are retried — never a sign-in, a token refresh, a new request, an upload or
 * a deletion. `init.signal` lets the caller cancel (sign-out cancels a refresh on its way): that is thrown as an
 * AbortError right away, without a retry.
 */
export async function send(fetchImpl: FetchLike, url: string, init: RequestInit, retries = 0): Promise<Response> {
  const external = init.signal ?? null;
  for (let attempt = 0; ; attempt++) {
    if (external?.aborted) throw cancelled();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const onAbort = () => controller.abort();
    external?.addEventListener("abort", onAbort, { once: true });
    try {
      return await fetchImpl(url, { ...init, signal: controller.signal, credentials: "omit", cache: "no-store" });
    } catch (e) {
      if (external?.aborted) throw cancelled();
      if (!isNetworkError(e)) throw e;
      if (attempt >= retries) throw new BackendError("offline");
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    }
  }
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function body(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const json = await readJson(res);
  if (json === undefined) throw new InvalidResponseError(res.url || "response", "not JSON");
  return json;
}

/**
 * Maps a non-2xx answer to the contract's errors:
 * 400 {"code":"P0001","message":"<name>"} → BackendError(name); 422/409 of installation-requests;
 * 429 → rateLimited; 5xx → offline; anything else → InvalidResponseError (a bug, not "no connection").
 * 401 is handled by the caller (refresh once, then sign out).
 */
export async function errorFrom(res: Response): Promise<Error> {
  const json = (await readJson(res)) as Record<string, unknown> | null | undefined;
  if (res.status === 429) return new BackendError("rateLimited");
  if (res.status >= 500) return new BackendError("offline");
  if (json && typeof json === "object") {
    if (res.status === 400 && json.code === "P0001" && typeof json.message === "string"
      && (BACKEND_ERROR_CODES as readonly string[]).includes(json.message)) {
      return new BackendError(json.message as BackendErrorCode);
    }
    if (res.status === 422 && json.error === "installationRequestIncomplete") {
      return new BackendError("installationRequestIncomplete", typeof json.field === "string" ? json.field : undefined);
    }
    if (res.status === 409 && json.error === "installationAlreadyRequested") {
      return new BackendError("installationAlreadyRequested");
    }
    if (json.error === "rateLimited") return new BackendError("rateLimited");
  }
  return new InvalidResponseError(res.url || "response", `HTTP ${res.status}`);
}

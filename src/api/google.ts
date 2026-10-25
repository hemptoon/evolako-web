// Sign-in with Google (13.10.2026): OpenID Connect without a client secret and without Google's script.
//
// The browser goes to Google with response_type=id_token; Google comes back to /auth/google with the ID token in the
// #fragment — a fragment never reaches any server, ours included — and the token goes to Supabase Auth
// (POST /auth/v1/token?grant_type=id_token), which checks Google's signature, that the token was issued to our client
// ID and the nonce, and then signs the person in: the account of that e-mail when there is one (an account made by an
// e-mail code gets Google linked to it), a new one otherwise.
//
// Two random values per sign-in, kept in localStorage for 10 minutes and spent on the way back:
// - state: the return must belong to a sign-in this browser started (someone else's link to /auth/google#id_token=…
//   signs nobody in);
// - nonce: Google writes its SHA-256 into the token, Supabase compares it with the raw value we send, so a token
//   caught elsewhere cannot be replayed here.
// Scope "openid email": the e-mail and that Google checked it — no name, no photo, no other data.
import type { Lang } from "../lib/format";

export const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
export const RETURN_PATH = "/auth/google";
export const PENDING_KEY = "evo.google";
export const PENDING_TTL_MS = 10 * 60_000;

export interface GooglePending {
  state: string;
  /** Raw nonce: Google gets its SHA-256 (hex), Supabase the raw value. */
  nonce: string;
  /** Where to go after signing in (already checked by safeNext). */
  next: string | null;
  /** Date.now() when the sign-in started. */
  at: number;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What Google put in the fragment of /auth/google (or in the query, for an error before any token). */
export interface GoogleReturn {
  idToken: string | null;
  state: string | null;
  /** access_denied when the person pressed Cancel; any other value is a failure. */
  error: string | null;
}

const HEX = /^[0-9a-f]+$/;

/** `bytes` random bytes as lowercase hex. */
export function randomToken(bytes = 32, source: Pick<Crypto, "getRandomValues"> = globalThis.crypto): string {
  const a = new Uint8Array(bytes);
  source.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(text: string, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<string> {
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Google's language for its own pages: Serbian Latin is "sr-Latn" there, plain "sr" is Cyrillic. */
export function googleHl(l: Lang): string {
  return l === "sr" ? "sr-Latn" : l === "sr-Cyrl" ? "sr" : l;
}

export function googleAuthUrl(o: { clientId: string; redirectUri: string; state: string; nonceHash: string; hl: string }): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "id_token",
    response_mode: "fragment",
    scope: "openid email",
    state: o.state,
    nonce: o.nonceHash,
    // Always the account chooser: on a shared computer the person picks the account, it is never assumed.
    prompt: "select_account",
    hl: o.hl,
  });
  return `${GOOGLE_AUTH}?${q.toString()}`;
}

/** Reads the return from Google: the fragment (#id_token=…&state=…), or ?error=… when Google failed early. */
export function parseReturn(hash: string, search: string): GoogleReturn {
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const query = new URLSearchParams(search.replace(/^\?/, ""));
  const pick = (name: string) => fragment.get(name) ?? query.get(name);
  const idToken = fragment.get("id_token");
  return {
    // A JWT: three base64url parts. Anything else is not a token.
    idToken: idToken && /^[\w-]+\.[\w-]+\.[\w-]+$/.test(idToken) ? idToken : null,
    state: pick("state"),
    error: pick("error"),
  };
}

export function savePending(storage: StorageLike, pending: GooglePending): void {
  storage.setItem(PENDING_KEY, JSON.stringify(pending));
}

/**
 * The sign-in this browser started, when `state` is its state and it is younger than 10 minutes; null otherwise.
 * Always removed: a state is spent on the first return, right or wrong.
 */
export function takePending(storage: StorageLike, state: string | null, now: number): GooglePending | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(PENDING_KEY);
    storage.removeItem(PENDING_KEY);
  } catch {
    return null;
  }
  if (!raw || !state) return null;
  try {
    const p = JSON.parse(raw) as Partial<GooglePending>;
    if (typeof p.state !== "string" || typeof p.nonce !== "string" || typeof p.at !== "number") return null;
    if (!HEX.test(p.state) || !HEX.test(p.nonce)) return null;
    if (p.state !== state) return null;
    if (now - p.at > PENDING_TTL_MS || p.at > now + 60_000) return null;
    return { state: p.state, nonce: p.nonce, next: typeof p.next === "string" ? p.next : null, at: p.at };
  } catch {
    return null;
  }
}

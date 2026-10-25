// Evolako pismo — the public `newsletter` edge function of the backend (evo-backend: supabase/functions/newsletter,
// _shared/newsletter.ts), called by the pages /pismo and /odjava without an account:
//
//   POST {apiBase}/functions/v1/newsletter   apikey: <publishable key>   content-type: application/json
//   {"action": "confirm", "token"}            → 200 {ok, status: "confirmed" | "expired" | "invalid"}  (all three 200:
//                                               the status decides, not ok) · 429 {ok: false, error: "limit"}
//   {"action": "unsubscribe", "e", "t", "l"}  → 200 {ok: true} · 400 {ok: false, error: "invalid"}
//
// Both are writes: they go out exactly once (no automatic retry) — an answer lost on the way may still mean the server
// did it. The person presses the button again. Answers are mapped to words the pages show, never to exceptions.
import { isBackendError } from "./errors";
import { accessHeaders, send, type ApiConfig, type FetchLike } from "./http";

export const NEWSLETTER_PATH = "/functions/v1/newsletter";

/** Something went wrong on the way: too many attempts (429), no connection or a server error, an unexpected answer. */
export type NewsletterProblem = "limited" | "offline" | "failed";
export type ConfirmResult = "confirmed" | "expired" | "invalid" | NewsletterProblem;
export type UnsubscribeResult = "done" | "invalid" | NewsletterProblem;

export interface UnsubscribeLink {
  /** The address exactly as in the link (the server lower-cases it for the check). */
  e: string;
  /** Its HMAC from the link. */
  t: string;
  /** The language of the page. */
  l: "sr" | "en" | "ru";
}

type Answer = { status: number; json: Record<string, unknown> | null } | "offline";

async function post(api: ApiConfig, fetchImpl: FetchLike, payload: Record<string, unknown>): Promise<Answer> {
  let res: Response;
  try {
    // No user token: the function is public, and the publishable key is all it needs (apikey).
    res = await send(fetchImpl, `${api.apiBase}${NEWSLETTER_PATH}`, {
      method: "POST",
      headers: { ...accessHeaders(api.publishableKey, null), "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    if (isBackendError(e, "offline")) return "offline";
    throw e;
  }
  let json: Record<string, unknown> | null = null;
  try {
    const parsed: unknown = JSON.parse(await res.text());
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch {
    // not JSON (or the body was cut off): the status alone decides
  }
  return { status: res.status, json };
}

/** Confirms a website sign-up with the token of the confirmation e-mail (/pismo?t=…). */
export async function confirmSubscription(api: ApiConfig, token: string, fetchImpl: FetchLike): Promise<ConfirmResult> {
  const answer = await post(api, fetchImpl, { action: "confirm", token });
  if (answer === "offline") return "offline";
  if (answer.status === 429) return "limited";
  if (answer.status >= 500) return "offline";
  const status = answer.json?.status;
  if (answer.status === 200 && (status === "confirmed" || status === "expired" || status === "invalid")) return status;
  return "failed";
}

/** Unsubscribes the address of an e-mail's footer link (/odjava?e=…&t=…&l=…) from tips and news. */
export async function unsubscribeByLink(api: ApiConfig, link: UnsubscribeLink, fetchImpl: FetchLike): Promise<UnsubscribeResult> {
  const answer = await post(api, fetchImpl, { action: "unsubscribe", e: link.e, t: link.t, l: link.l });
  if (answer === "offline") return "offline";
  if (answer.status === 200 && answer.json?.ok === true) return "done";
  if (answer.status === 400 && answer.json?.error === "invalid") return "invalid";
  if (answer.status === 429) return "limited";
  if (answer.status >= 500) return "offline";
  return "failed";
}

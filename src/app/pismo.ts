// Links from the Evolako pismo e-mails — /pismo?t=…&l=… (confirm a website sign-up) and /odjava?e=…&t=…&l=…
// (unsubscribe) — and the steps of the two pages. Pure functions; the pages do the side effects.
//
// A page cleans its address at once: a token must not stay in the address bar, the history entry or a screenshot.
// The link is kept for the tab in sessionStorage (gone with the tab, never localStorage), so a reload still works —
// also after the answer: a used confirmation token would now be "invalid", so the outcome is kept with the link and a
// reload shows it again without asking the server. A new link opened in the same tab replaces the kept one.
// ?l= is the language of the e-mail: public/boot.js applies it before the first paint, exactly like ?lang=.
import type { ConfirmResult, NewsletterProblem, UnsubscribeResult } from "../api/newsletter";
import type { Lang } from "../lib/format";
import { isValidEmail } from "../lib/forms";

export type LinkLang = Lang;

/** sessionStorage keys: this tab's link of each page, with its outcome once there is one. */
export const CONFIRM_KEY = "evo.pismo.potvrda";
export const UNSUBSCRIBE_KEY = "evo.pismo.odjava";

/** The parameters a page takes out of its address. */
export const CONFIRM_PARAMS = ["t", "l"] as const;
export const UNSUBSCRIBE_PARAMS = ["e", "t", "l"] as const;

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * A query parameter as written in the link. Unlike URLSearchParams a "+" stays a "+": the e-mails encode the address
 * (%2B), but a link retyped or rewritten on the way may not, and "ana+pismo@…" is an address. A broken escape counts as
 * absent. The first occurrence wins.
 */
export function linkParam(search: string, name: string): string | null {
  for (const part of search.replace(/^\?/, "").split("&")) {
    if (!part) continue;
    const eq = part.indexOf("=");
    if (decode(eq < 0 ? part : part.slice(0, eq)) !== name) continue;
    return eq < 0 ? "" : decode(part.slice(eq + 1));
  }
  return null;
}

/** A language as a link writes it — sr, en, ru, and sr-Cyrl / cy / cyr for Serbian Cyrillic (any case) — or null. */
export function parseLang(value: string | null | undefined): Lang | null {
  const l = (value ?? "").trim().toLowerCase();
  if (l === "sr-cyrl" || l === "cy" || l === "cyr") return "sr-Cyrl";
  if (l === "sr-latn") return "sr";
  return l === "sr" || l === "en" || l === "ru" ? l : null;
}

/** ?l= of an e-mail link (the same values as ?lang=), or null. */
export function linkLang(search: string): LinkLang | null {
  return parseLang(linkParam(search, "l"));
}

/** True when the address carries any of the page's link parameters (then it is cleaned). */
export function hasLinkParams(search: string, names: readonly string[]): boolean {
  return names.some((name) => linkParam(search, name) !== null);
}

function parseStored(stored: string | null): Record<string, unknown> | null {
  if (!stored) return null;
  try {
    const v: unknown = JSON.parse(stored);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** One step of a page: what it shows, whether the request is on its way, and a problem to retry after. */
export interface Flow<V extends string> {
  view: V;
  busy: boolean;
  problem: NewsletterProblem | null;
}

/** The button was pressed: once, and only from "ready" (a second click while busy does nothing). */
export function sending<V extends string>(flow: Flow<V>): Flow<V> | null {
  return flow.view === "ready" && !flow.busy ? { ...flow, busy: true, problem: null } : null;
}

// ---------------------------------------------------------------- /pismo — confirm a website sign-up

export type ConfirmOutcome = "confirmed" | "expired" | "invalid";
export type ConfirmView = "demo" | "ready" | ConfirmOutcome;

export interface ConfirmLink {
  t: string;
  outcome?: ConfirmOutcome;
}

/**
 * Looks like a confirmation token (base64url). The server checks the exact form (43 characters today) and answers an
 * unknown one "invalid" — only a missing or plainly broken token is refused here, without a request.
 */
const CONFIRM_TOKEN = /^[A-Za-z0-9_-]{16,256}$/;

function isConfirmOutcome(v: unknown): v is ConfirmOutcome {
  return v === "confirmed" || v === "expired" || v === "invalid";
}

/** This tab's confirmation link: a link in the address wins (the same token keeps its outcome), else the kept one. */
export function confirmLinkFrom(search: string, stored: string | null): ConfirmLink | null {
  const raw = parseStored(stored);
  const kept: ConfirmLink | null = raw && typeof raw.t === "string"
    ? { t: raw.t, ...(isConfirmOutcome(raw.outcome) ? { outcome: raw.outcome } : {}) }
    : null;
  const fromAddress = linkParam(search, "t");
  if (fromAddress === null) return kept;
  const t = fromAddress.trim();
  return kept && kept.t === t ? kept : { t };
}

/** Where /pismo starts: the demo sends nothing; a missing or broken token is not a link; a kept outcome stays. */
export function confirmStart(link: ConfirmLink | null, live: boolean): Flow<ConfirmView> {
  const view: ConfirmView = !live ? "demo" : !link || !CONFIRM_TOKEN.test(link.t) ? "invalid" : link.outcome ?? "ready";
  return { view, busy: false, problem: null };
}

/** The answer: an outcome ends the page (and is kept); a problem leaves the button for another try. */
export function confirmAfter(result: ConfirmResult): Flow<ConfirmView> {
  if (isConfirmOutcome(result)) return { view: result, busy: false, problem: null };
  return { view: "ready", busy: false, problem: result };
}

// ---------------------------------------------------------------- /odjava — unsubscribe from tips and news

export type UnsubscribeOutcome = "done" | "invalid";
export type UnsubscribeView = "demo" | "ready" | UnsubscribeOutcome;

export interface UnsubscribeKept {
  e: string;
  t: string;
  outcome?: UnsubscribeOutcome;
}

/** Looks like the HMAC of an unsubscribe link (hex today); the server checks it against the address. */
const UNSUBSCRIBE_TOKEN = /^[A-Za-z0-9_-]{8,256}$/;

function isUnsubscribeOutcome(v: unknown): v is UnsubscribeOutcome {
  return v === "done" || v === "invalid";
}

/** This tab's unsubscribe link: e and t from the address win (the same pair keeps its outcome), else the kept one. */
export function unsubscribeLinkFrom(search: string, stored: string | null): UnsubscribeKept | null {
  const raw = parseStored(stored);
  const kept: UnsubscribeKept | null = raw && typeof raw.e === "string" && typeof raw.t === "string"
    ? { e: raw.e, t: raw.t, ...(isUnsubscribeOutcome(raw.outcome) ? { outcome: raw.outcome } : {}) }
    : null;
  const e = linkParam(search, "e");
  const t = linkParam(search, "t");
  if (e === null && t === null) return kept;
  const link = { e: (e ?? "").trim(), t: (t ?? "").trim() };
  return kept && kept.e === link.e && kept.t === link.t ? kept : link;
}

/** An address and a token that can be checked at all (the server decides whether they belong together). */
export function isUnsubscribeLink(link: UnsubscribeKept | null): link is UnsubscribeKept {
  return !!link && link.e.length <= 254 && isValidEmail(link.e) && UNSUBSCRIBE_TOKEN.test(link.t);
}

export function unsubscribeStart(link: UnsubscribeKept | null, live: boolean): Flow<UnsubscribeView> {
  const view: UnsubscribeView = !live ? "demo" : !isUnsubscribeLink(link) ? "invalid" : link.outcome ?? "ready";
  return { view, busy: false, problem: null };
}

export function unsubscribeAfter(result: UnsubscribeResult): Flow<UnsubscribeView> {
  if (isUnsubscribeOutcome(result)) return { view: result, busy: false, problem: null };
  return { view: "ready", busy: false, problem: result };
}

// ---------------------------------------------------------------- the tab's storage

/** sessionStorage of this tab; null when the browser blocks it (the link then lives only until a reload). */
export function readTab(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeTab(key: string, value: unknown): void {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // blocked: kept in memory for this visit only
  }
}

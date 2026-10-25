// Evolako pismo — the issue file (public/posta/<slug>.json, shipped with the app) and its web version /pismo/<slug>.
//
// The format belongs to the backend (evo-backend: supabase/functions/_shared/newsletter_issue.ts validates it,
// _shared/email/render.ts draws the e-mail, Docs/NEWSLETTER.md tells the operator how to write it):
//
//   { "slug": "2026-10", "issue": 1, "date": "2026-10-07",
//     "cover": { "src": "/posta/2026-10.jpg", "alt": { "sr": "…", "en": "…", "ru": "…" } },   ← optional, web only
//     "sr": { "subject": "…", "preheader": "…", "blocks": [ { "type": "h2", "text": "…" }, … ] },
//     "en": { … }, "ru": { … } }
//
// Blocks are the e-mail's own: h2, p, note {text}; list {items: [text]}; steps {items: [{title, text}]};
// kv {rows: [[label, value]]}; button {text, href}; divider. Texts are plain text where **bold** works; links (in a
// text or a button) lead only to our sites and addresses only to our domains — anything else stays plain text here.
//
// The decoder mirrors the backend's structure (every language, known block types, their required fields, the slug of
// the address, a real calendar date, a cover on our own site) and, like the other decoders of the app, ignores fields
// it does not know. A file that fails it is not an issue: the page shows "not found".
import type { ContentLang } from "../lib/format";
import { BackendError } from "./errors";
import { send, type FetchLike } from "./http";
import { InvalidResponseError, obj } from "./parse";

export const ISSUE_SLUG = /^[a-z0-9-]{3,40}$/;
const COVER_SRC = /^\/posta\/[a-z0-9-]+\.(jpg|jpeg|png|webp)$/;
const LANGS: readonly ContentLang[] = ["sr", "en", "ru"];

/** Where links of an issue may lead (LINK_HOSTS of newsletter_issue.ts): https only, no port, no user. */
export const LINK_HOSTS: ReadonlySet<string> = new Set([
  "evolako.rs", "www.evolako.rs", "app.evolako.rs", "blokvolt.rs", "www.blokvolt.rs",
]);
/** Whose e-mail addresses an issue may show as links (MAIL_DOMAINS of newsletter_issue.ts). */
export const MAIL_DOMAINS: ReadonlySet<string> = new Set(["evolako.com", "evolako.rs", "blokvolt.rs"]);
/** Moj Evolako itself: its links open in the same tab (on app.evolako.rs the router takes them). */
const APP_HOST = "app.evolako.rs";

export interface IssueStep {
  title: string;
  text: string;
}

export type IssueBlock =
  | { type: "h2"; text: string }
  | { type: "p"; text: string }
  | { type: "note"; text: string }
  /** The validator allows only texts in a list; the renderer's block type also has {title, text} — both are drawn. */
  | { type: "list"; items: Array<string | IssueStep> }
  | { type: "steps"; items: IssueStep[] }
  | { type: "kv"; rows: Array<[string, string]> }
  | { type: "button"; text: string; href: string }
  | { type: "divider" };

export interface IssuePart {
  subject: string;
  preheader: string;
  blocks: IssueBlock[];
}

export interface IssueCover {
  /** /posta/<name>.jpg|jpeg|png|webp — same origin (CSP img-src 'self'). */
  src: string;
  alt: Partial<Record<ContentLang, string>>;
}

export interface Issue extends Record<ContentLang, IssuePart> {
  slug: string;
  issue: number;
  /** YYYY-MM-DD, the day the issue goes out. */
  date: string;
  cover: IssueCover | null;
}

/** There is no such issue: no file, the app's own page instead of one, or a file that is not an issue. */
export class IssueNotFound extends Error {
  constructor(public readonly slug: string) {
    super(`No issue "${slug}"`);
    this.name = "IssueNotFound";
  }
}

// ---------------------------------------------------------------- decoder

type J = Record<string, unknown>;

function fail(path: string, detail: string): never {
  throw new InvalidResponseError(path, detail);
}

/** A text the backend would accept as present: a string that is not blank. */
function text(v: unknown, path: string): string {
  if (typeof v !== "string" || !v.trim()) fail(path, "expected a text");
  return v;
}

function items(v: unknown, path: string): unknown[] {
  if (!Array.isArray(v) || v.length === 0) fail(path, "expected a non-empty array");
  return v;
}

function step(v: unknown, path: string): IssueStep {
  const o = obj(v, path);
  return { title: text(o.title, `${path}.title`), text: text(o.text, `${path}.text`) };
}

function block(v: unknown, path: string): IssueBlock {
  const o = obj(v, path);
  switch (o.type) {
    case "h2":
    case "p":
    case "note":
      return { type: o.type, text: text(o.text, `${path}.text`) };
    case "list":
      return {
        type: "list",
        items: items(o.items, `${path}.items`).map((x, i) => (typeof x === "string"
          ? text(x, `${path}.items[${i}]`)
          : step(x, `${path}.items[${i}]`))),
      };
    case "steps":
      return { type: "steps", items: items(o.items, `${path}.items`).map((x, i) => step(x, `${path}.items[${i}]`)) };
    case "kv":
      return {
        type: "kv",
        rows: items(o.rows, `${path}.rows`).map((row, i) => {
          if (!Array.isArray(row) || row.length !== 2) fail(`${path}.rows[${i}]`, "expected [label, value]");
          return [text(row[0], `${path}.rows[${i}][0]`), text(row[1], `${path}.rows[${i}][1]`)] as [string, string];
        }),
      };
    case "button":
      return { type: "button", text: text(o.text, `${path}.text`), href: text(o.href, `${path}.href`) };
    case "divider":
      return { type: "divider" };
    default:
      return fail(`${path}.type`, `unknown block type "${String(o.type)}"`);
  }
}

function part(v: unknown, path: string): IssuePart {
  const o = obj(v, path);
  return {
    subject: text(o.subject, `${path}.subject`),
    preheader: text(o.preheader, `${path}.preheader`),
    blocks: items(o.blocks, `${path}.blocks`).map((b, i) => block(b, `${path}.blocks[${i}]`)),
  };
}

function cover(v: unknown): IssueCover {
  const o = obj(v, "cover");
  if (typeof o.src !== "string" || !COVER_SRC.test(o.src)) fail("cover.src", "expected /posta/<name>.jpg|jpeg|png|webp");
  const alt: Partial<Record<ContentLang, string>> = {};
  if (o.alt !== undefined) {
    const a = obj(o.alt, "cover.alt");
    for (const [key, value] of Object.entries(a)) {
      if (typeof value !== "string") fail(`cover.alt.${key}`, "expected a string");
      if ((LANGS as readonly string[]).includes(key)) alt[key as ContentLang] = value;
    }
  }
  return { src: o.src, alt };
}

function isCalendarDay(v: unknown): v is string {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const day = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === v;
}

/** The issue file → an Issue, or InvalidResponseError with the path of the first problem. */
export function parseIssue(v: unknown, slug: string): Issue {
  const o: J = obj(v, "issue");
  if (o.slug !== slug || !ISSUE_SLUG.test(slug)) fail("slug", `expected "${slug}"`);
  if (typeof o.issue !== "number" || !Number.isInteger(o.issue) || o.issue < 1) fail("issue", "expected a whole number from 1");
  if (!isCalendarDay(o.date)) fail("date", "expected YYYY-MM-DD");
  return {
    slug,
    issue: o.issue,
    date: o.date,
    cover: o.cover === undefined ? null : cover(o.cover),
    sr: part(o.sr, "sr"),
    en: part(o.en, "en"),
    ru: part(o.ru, "ru"),
  };
}

// ---------------------------------------------------------------- loading

/**
 * GET /posta/<slug>.json from this site. A read: one retry on a network error. Pages answers an unknown path with the
 * app itself (index.html, 200), so an answer that is not JSON is "no such issue", like a 404 and like a file that is
 * not an issue; a 5xx or no connection is BackendError("offline") (the page offers "Pokušaj ponovo").
 */
export async function loadIssue(slug: string, fetchImpl: FetchLike): Promise<Issue> {
  if (!ISSUE_SLUG.test(slug)) throw new IssueNotFound(slug);
  const res = await send(fetchImpl, `/posta/${slug}.json`, { method: "GET", headers: { accept: "application/json" } }, 1);
  if (res.status >= 500) throw new BackendError("offline");
  if (!res.ok) throw new IssueNotFound(slug);
  let json: unknown;
  try {
    json = JSON.parse(await res.text());
  } catch {
    throw new IssueNotFound(slug);
  }
  try {
    return parseIssue(json, slug);
  } catch (e) {
    if (e instanceof InvalidResponseError) throw new IssueNotFound(slug);
    throw e;
  }
}

// ---------------------------------------------------------------- words and links

/** Where a link of an issue may go: "app" (Moj Evolako, same tab), "site" (our sites, a new tab) or nowhere (null). */
export function linkTarget(href: string): "app" | "site" | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  if (url.hostname === APP_HOST) return "app";
  return LINK_HOSTS.has(url.hostname) ? "site" : null;
}

export type InlineToken =
  | { kind: "text"; text: string; bold: boolean }
  | { kind: "link"; text: string; href: string; bold: boolean; target: "app" | "site" }
  | { kind: "mail"; text: string; href: string; bold: boolean };

// As the e-mail renderer (render.ts inline()): **bold** within one line; https:// links end before trailing
// punctuation; an address starts the text or follows a space or "(".
const BOLD = /\*\*(.+?)\*\*/g;
const URL_IN_TEXT = /https:\/\/[^\s<>"']*[^\s<>"'.,;:)!?]/g;
const MAIL_IN_TEXT = /(^|[\s(])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

function mails(text: string, bold: boolean, out: InlineToken[]): void {
  let last = 0;
  for (const m of text.matchAll(MAIL_IN_TEXT)) {
    const start = m.index + m[1]!.length;
    const address = m[2]!;
    if (start > last) out.push({ kind: "text", text: text.slice(last, start), bold });
    const domain = address.slice(address.indexOf("@") + 1).toLowerCase();
    out.push(MAIL_DOMAINS.has(domain)
      ? { kind: "mail", text: address, href: `mailto:${address}`, bold }
      : { kind: "text", text: address, bold });
    last = start + address.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last), bold });
}

function links(text: string, bold: boolean, out: InlineToken[]): void {
  let last = 0;
  for (const m of text.matchAll(URL_IN_TEXT)) {
    const href = m[0];
    if (m.index > last) mails(text.slice(last, m.index), bold, out);
    const target = linkTarget(href);
    out.push(target ? { kind: "link", text: href, href, bold, target } : { kind: "text", text: href, bold });
    last = m.index + href.length;
  }
  if (last < text.length) mails(text.slice(last), bold, out);
}

/** A text of an issue → runs of plain text, **bold**, our links and our addresses (everything else stays text). */
export function inlineTokens(text: string): InlineToken[] {
  const out: InlineToken[] = [];
  let last = 0;
  for (const m of text.matchAll(BOLD)) {
    if (m.index > last) links(text.slice(last, m.index), false, out);
    links(m[1]!, true, out);
    last = m.index + m[0].length;
  }
  if (last < text.length) links(text.slice(last), false, out);
  return out;
}

/** The rows the e-mail shows: a row whose value is only units ("RSD", "kWh") or blank is left out, as in render.ts. */
export function shownRows(rows: Array<[string, string]>): Array<[string, string]> {
  return rows.filter(([, value]) => value.replace(/\s|kWh|RSD/g, "") !== "");
}

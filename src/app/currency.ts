// Display currency (docs/VALUTA_SPEC_2026-10-06.md): RSD always by default, EUR or USD only by the person's choice.
// The choice lives in this browser (`evo:cur`) and, when signed in, also in the profile on the server
// (display_currency), so the app and Moj Evolako agree: the last change wins. The demo keeps it locally only.
// Payments never see it: statements, IPS QR, print/PDF, CSV and e-mails stay in dinars (README "Display currency").
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import type { User } from "../api/types";
import { parseFx } from "../api/parse";
import { FALLBACK_FX, isCurrency, type Currency, type FxRates } from "../lib/format";
import { invalidate } from "./query";
import { config, session } from "./session";
import { accountPref, setAccountPref } from "./settings";

const CURRENCY_KEY = "evo:cur";
const FX_KEY = "evo:fx";
/** Per account (evo.pref.<uuid>.…, forgotten at sign-out): the server has not got the last change yet. */
const PENDING_PREF = "currencyPending";
/** How often a long-open tab looks for a newer rate (the server publishes it once a working day). */
const FX_REFRESH_MS = 6 * 60 * 60 * 1000;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

function initialCurrency(): Currency {
  const stored = read(CURRENCY_KEY);
  return isCurrency(stored) ? stored : "RSD";
}

function cachedFx(): FxRates | null {
  const raw = read(FX_KEY);
  if (!raw) return null;
  try {
    return parseFx(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The chosen display currency. Reading it subscribes the component: a change redraws the open page at once. */
export const currency = signal<Currency>(initialCurrency());
/** The rate in use: the last good one from the server, else the fallback constants of the spec. */
export const fx = signal<FxRates>(cachedFx() ?? FALLBACK_FX);

/** True while a PATCH is on its way: an older server answer must not undo the newer local choice. */
let saving = 0;

function signedIn(): { id: string; userId: string; save: (c: Currency) => Promise<void> } | null {
  const s = session.value;
  if (s.kind !== "in") return null;
  return { id: s.id, userId: s.id.replace(/^in:/, ""), save: (c) => s.backend.setDisplayCurrency(c) };
}

async function push(next: Currency): Promise<void> {
  const account = signedIn();
  if (!account) return;
  saving++;
  try {
    await account.save(next);
    setAccountPref(account.userId, PENDING_PREF, false);
    invalidate(`${account.id}:user`);
  } catch {
    // Offline or refused: the local choice stays, the server gets it at the next opening.
    setAccountPref(account.userId, PENDING_PREF, true);
  } finally {
    saving--;
  }
}

/** The person chose: applied at once here, and sent to the profile when signed in. */
export function setCurrency(next: Currency): void {
  if (next === currency.value) return;
  currency.value = next;
  write(CURRENCY_KEY, next);
  void push(next);
}

let pushedPending: string | null = null;

/**
 * Called with every fresh answer of currentUser while signed in. A change that did not reach the server last
 * time is sent again (once per opening); otherwise the server's value wins over the local one — it is the
 * newest change made on any device.
 */
export function applyServerCurrency(user: User | undefined): void {
  const account = signedIn();
  if (!account || !user || saving > 0) return;
  if (accountPref(account.userId, PENDING_PREF)) {
    if (pushedPending === account.id) return;
    pushedPending = account.id;
    void push(currency.value);
    return;
  }
  if (user.displayCurrency !== currency.value) {
    currency.value = user.displayCurrency;
    write(CURRENCY_KEY, user.displayCurrency);
  }
}

export function useCurrencySync(user: User | undefined): void {
  useEffect(() => applyServerCurrency(user), [user]);
}

// ---------------------------------------------------------------- the rate

/**
 * The content document `fx` from our API: manifest → file. No headers (a simple GET, no preflight), only paths
 * under /content/ of our apiBase, the sha256 of the manifest checked. Any problem keeps the last good rate.
 */
export async function loadFx(fetcher: typeof fetch = (input, init) => fetch(input, init)): Promise<void> {
  const base = config.value.apiBase;
  if (!base) return;
  try {
    const manifest = await (await ok(fetcher(`${base}/content/v1/manifest.json`, { cache: "no-cache" }))).json() as {
      files?: Record<string, { path?: unknown; sha256?: unknown; schemaVersion?: unknown }>;
    };
    const entry = manifest.files?.fx;
    if (!entry || typeof entry.path !== "string" || (entry.schemaVersion ?? 1) !== 1) return;
    const path = entry.path.replace(/^\/+/, "");
    if (!/^v1\/[a-z_]+(\.[0-9a-f]{12})?\.json$/.test(path)) return;
    const bytes = await (await ok(fetcher(`${base}/content/${path}`))).arrayBuffer();
    if (typeof entry.sha256 === "string" && crypto.subtle) {
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (b) => b.toString(16).padStart(2, "0")).join("");
      if (digest !== entry.sha256.toLowerCase()) return;
    }
    const next = parseFx(JSON.parse(new TextDecoder().decode(bytes)));
    fx.value = next;
    write(FX_KEY, JSON.stringify(next));
  } catch {
    // offline, 5xx, not the contract: the cached rate or the fallback stays
  }
}

async function ok(response: Promise<Response>): Promise<Response> {
  const res = await response;
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

/** At start (after config.json) and every few hours in an open tab. */
export function installFx(): void {
  void loadFx();
  setInterval(() => {
    if (document.visibilityState === "visible") void loadFx();
  }, FX_REFRESH_MS);
}

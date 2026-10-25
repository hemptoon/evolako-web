// Who is using the app: nobody, a demo account, or a person signed in with the e-mail code.
// One place creates the backends (AppSession of the app); screens only see the Backend interface.
import { computed, signal } from "@preact/signals";
import { AuthSession, type StorageLike } from "../api/auth";
import { AccountError } from "../api/errors";
import type { Backend } from "../api/backend";
import type { DemoBackend } from "../api/demo/backend";
import type { DemoAccount } from "../api/demo/data";
import { RemoteBackend } from "../api/remote";
import type { ContentLang } from "../lib/format";
import { forgetSelectedPoint } from "./point";
import { clearCache } from "./query";
import { navigate } from "./router";
import { forgetAccountPrefs } from "./settings";

export interface AppConfig {
  apiBase: string;
  publishableKey: string;
  demo: boolean;
  /** Sign-in with Google (app/google.ts): the OAuth client ID of Moj Evolako — public, like publishableKey. "": off. */
  googleClientId: string;
  /** The origins registered at Google for that client (https://app.evolako.rs): elsewhere the button does not show. */
  googleOrigins: string[];
}

export type Session =
  | { kind: "booting" }
  | { kind: "out" }
  | { kind: "demo"; id: string; account: DemoAccount; backend: DemoBackend }
  | { kind: "in"; id: string; backend: RemoteBackend; email: string };

export const config = signal<AppConfig>({ apiBase: "", publishableKey: "", demo: true, googleClientId: "", googleOrigins: [] });
export const session = signal<Session>({ kind: "booting" });
/** Bumped when demo switches change data that is not behind a query key (live, fault). */
export const demoRevision = signal(0);
/** Why the person is on the sign-in screen again: the session ended by itself (expired, revoked, signed out in
 *  another tab) or the account was just deleted. */
export const sessionNotice = signal<"expired" | "deleted" | null>(null);

export const backend = computed<Backend | null>(() => {
  const s = session.value;
  return s.kind === "demo" || s.kind === "in" ? s.backend : null;
});

export const isDemo = computed(() => session.value.kind === "demo");
/** Real sign-in is possible only once the backend exists: config.json has both apiBase and publishableKey. */
export const signInAvailable = computed(() => config.value.apiBase !== "" && config.value.publishableKey !== "");
/** config.json "demo": false hides the demo (e.g. once real accounts exist and the demo should go). */
export const demoAvailable = computed(() => config.value.demo || !signInAvailable.value);

const DEMO_KEY = "evo.demo";
const DEMO_ACCOUNTS: DemoAccount[] = ["wallbox", "socket", "lead"];
const INSTALL_KEY = "evo.installId";

let auth: AuthSession | null = null;

function storage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeStorage(): StorageLike {
  return storage() ?? { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };
}

function uuid(): string {
  return crypto.randomUUID();
}

/**
 * Forgets what this browser keeps about the person who just left: the chosen point, their remembered choices,
 * the cached answers — and gives the browser a NEW install id, so whoever uses it next cannot list the previous
 * person's installation requests (x-install-id). Theme and language stay: they belong to the device.
 */
function forgetAccountData(rotateInstallId: boolean): void {
  forgetSelectedPoint();
  forgetAccountPrefs();
  clearCache();
  if (rotateInstallId) {
    try {
      safeStorage().setItem(INSTALL_KEY, uuid());
    } catch {
      // storage blocked: there was no stored id to reuse either
    }
  }
}

/** Anonymous id of this browser for installation requests (x-install-id) — never analytics, never logs. */
function installId(): string {
  const store = safeStorage();
  let id = store.getItem(INSTALL_KEY);
  if (!id) {
    id = uuid();
    store.setItem(INSTALL_KEY, id);
  }
  return id;
}

export function getAuth(): AuthSession | null {
  return auth;
}

/** The demo lives in its own chunk: people who sign in never download it. */
async function makeDemo(account: DemoAccount): Promise<Session> {
  const { DemoBackend } = await import("../api/demo/backend");
  const backend = new DemoBackend(account, {
    storage: storage(),
    now: () => new Date(),
    online: () => navigator.onLine,
    latency: 160,
  });
  return { kind: "demo", id: `demo:${account}`, account, backend };
}

function makeSignedIn(): Session {
  const a = auth!;
  const backend = new RemoteBackend(config.value, a, {
    fetch: (input, init) => fetch(input, init),
    installId,
    uuid,
  });
  const user = a.user;
  return { kind: "in", id: `in:${user?.id ?? "me"}`, backend, email: user?.email ?? "" };
}

async function loadConfig(): Promise<void> {
  try {
    const res = await fetch("/config.json", { cache: "no-cache" });
    if (!res.ok) return;
    const raw = (await res.json()) as Partial<AppConfig>;
    config.value = {
      apiBase: typeof raw.apiBase === "string" ? raw.apiBase.replace(/\/+$/, "") : "",
      publishableKey: typeof raw.publishableKey === "string" ? raw.publishableKey : "",
      demo: raw.demo !== false,
      googleClientId: typeof raw.googleClientId === "string" && /^[\w-]+\.apps\.googleusercontent\.com$/.test(raw.googleClientId)
        ? raw.googleClientId : "",
      googleOrigins: Array.isArray(raw.googleOrigins)
        ? raw.googleOrigins.filter((o): o is string => typeof o === "string" && /^https?:\/\/[^/]+$/.test(o)) : [],
    };
  } catch {
    // No config (offline first visit): demo only.
  }
}

export async function boot(): Promise<void> {
  await loadConfig();
  const store = storage();
  if (config.value.apiBase && config.value.publishableKey) {
    auth = new AuthSession(config.value, {
      fetch: (input, init) => fetch(input, init),
      storage: safeStorage(),
      locks: typeof navigator !== "undefined" && "locks" in navigator
        ? (navigator.locks as unknown as { request<T>(n: string, cb: () => Promise<T>): Promise<T> })
        : null,
      now: () => Date.now(),
    });
    auth.onChange(() => {
      const current = session.value;
      if (current.kind === "in" && !auth?.hasSession) {
        // Not a sign-out from this tab (that sets "out" first): the session expired or ended in another tab.
        forgetAccountData(true);
        sessionNotice.value = "expired";
        session.value = { kind: "out" };
      }
    });
    window.addEventListener("storage", (e) => auth?.handleStorageChange(e.key));
  }
  const demo = store?.getItem(DEMO_KEY) as DemoAccount | null;
  if (demo && DEMO_ACCOUNTS.includes(demo) && config.value.demo) {
    try {
      session.value = await makeDemo(demo);
      return;
    } catch {
      // The demo chunk did not load (offline first visit): start signed out.
    }
  }
  if (auth?.hasSession) {
    session.value = makeSignedIn();
    return;
  }
  session.value = { kind: "out" };
}

export async function startDemo(account: DemoAccount): Promise<void> {
  const next = await makeDemo(account);
  sessionNotice.value = null;
  clearCache();
  safeStorage().setItem(DEMO_KEY, account);
  session.value = next;
}

/** Back to the landing page after an explicit exit (in the same tick as the session change: one render). */
function toLanding(): void {
  if (typeof window !== "undefined") navigate("/prijava", { replace: true });
}

export function exitDemo(): void {
  const current = session.value;
  if (current.kind === "demo") current.backend.reset();
  safeStorage().removeItem(DEMO_KEY);
  forgetAccountData(false);
  session.value = { kind: "out" };
  toLanding();
}

export async function requestCode(email: string, lang: ContentLang): Promise<void> {
  if (!auth) throw new Error("sign-in is not configured");
  await auth.requestCode(email, lang);
}

/** After any sign-in (code or Google): no notice, no demo, nothing cached from before — the account starts fresh. */
function signedIn(): void {
  sessionNotice.value = null;
  safeStorage().removeItem(DEMO_KEY);
  clearCache();
  session.value = makeSignedIn();
}

export async function verifyCode(email: string, code: string): Promise<void> {
  if (!auth) throw new Error("sign-in is not configured");
  await auth.verify(email, code);
  signedIn();
}

/** Sign-in with Google (app/google.ts): Google's ID token and the raw nonce. `isNew`: the account was just created. */
export async function signInWithGoogleToken(idToken: string, nonce: string): Promise<{ isNew: boolean }> {
  if (!auth) throw new AccountError("notConfigured");
  const user = await auth.signInWithIdToken(idToken, nonce);
  signedIn();
  return { isNew: user.isNew };
}

export async function signOut(): Promise<void> {
  const current = session.value;
  if (current.kind === "demo") {
    exitDemo();
    return;
  }
  sessionNotice.value = null;
  forgetAccountData(true);
  session.value = { kind: "out" };
  toLanding();
  await auth?.signOut(true);
}

/**
 * After "Obriši nalog": the server already deleted everything; forget it here too and say so on the landing
 * ("Nalog je obrisan.", not "Sesija je istekla"). The session is "out" before the tokens go, so the auth change
 * is not mistaken for an expired session. No logout call: the account and its sessions no longer exist.
 * `stay`: the page that asked says it itself and keeps its address (/obrisi-nalog).
 */
export async function afterAccountDeleted(options: { stay?: boolean } = {}): Promise<void> {
  const current = session.value;
  if (current.kind === "demo") {
    exitDemo();
    return;
  }
  forgetAccountData(true);
  sessionNotice.value = "deleted";
  session.value = { kind: "out" };
  if (!options.stay) toLanding();
  await auth?.signOut(false);
}

// Sign-in with Google on Moj Evolako: when the button shows, how a sign-in starts, and the return to /auth/google.
// The protocol itself (state, nonce, the address at Google, reading the return) is in api/google.ts.
//
// The button shows only when all of these hold:
// - real sign-in is configured (config.json apiBase + publishableKey);
// - config.json has googleClientId, and this page's origin is one of config.json googleOrigins — Google sends the
//   person back only to an address registered for the client (https://app.evolako.rs/auth/google), so a preview
//   deployment on *.pages.dev must not offer a button that would end on Google's error page;
// - the service's kill switch app_config.features.googleLogin is not false (no release needed to hide it).
import { computed, signal } from "@preact/signals";
import {
  googleAuthUrl, googleHl, parseReturn, randomToken, RETURN_PATH, savePending, sha256Hex, takePending,
  type GoogleReturn, type StorageLike,
} from "../api/google";
import { BackendError } from "../api/errors";
import { contentLang, lang } from "../i18n";
import { features } from "./features";
import { navigate, safeNext } from "./router";
import { config, session, signInAvailable, signInWithGoogleToken } from "./session";

/** Why the last sign-in with Google did not finish, for the card on /prijava (null: nothing to say). */
export const googleNotice = signal<"failed" | "offline" | "rateLimited" | null>(null);

export const googleAvailable = computed(() =>
  signInAvailable.value
  && config.value.googleClientId !== ""
  && typeof window !== "undefined"
  && config.value.googleOrigins.includes(window.location.origin)
  && features.value.googleLogin);

function storage(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The return from Google, read once when the app loads on /auth/google and taken out of the address at once: the
 * ID token must not stay in the address bar, in the history or in a copied link.
 */
let captured: GoogleReturn | null = null;
if (typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === RETURN_PATH) {
  captured = parseReturn(window.location.hash, window.location.search);
  try {
    history.replaceState(history.state, "", RETURN_PATH);
  } catch {
    // the address keeps the fragment until the next navigation
  }
}

/** Leaves for Google's account chooser. `next`: where to land after signing in (checked again on the way back). */
export async function startGoogleSignIn(next: string | null): Promise<void> {
  const store = storage();
  if (!store || !googleAvailable.value) {
    googleNotice.value = "failed";
    return;
  }
  googleNotice.value = null;
  const state = randomToken(16);
  const nonce = randomToken(32);
  savePending(store, { state, nonce, next: safeNext(next), at: Date.now() });
  window.location.assign(googleAuthUrl({
    clientId: config.value.googleClientId,
    redirectUri: `${window.location.origin}${RETURN_PATH}`,
    state,
    nonceHash: await sha256Hex(nonce),
    hl: googleHl(lang.value),
  }));
}

function backToSignIn(next: string | null): void {
  navigate(next ? `/prijava?next=${encodeURIComponent(next)}` : "/prijava", { replace: true });
}

/**
 * /auth/google: checks that the return belongs to the sign-in this browser started, sends the token to Supabase and
 * opens the account. Cancel at Google → back to /prijava without a message; anything wrong → /prijava with
 * "Prijava preko Google naloga nije uspela…". A new account gets the language of the page (the token has none).
 */
export async function finishGoogleSignIn(): Promise<void> {
  const ret = captured ?? { idToken: null, state: null, error: null };
  captured = null;
  const store = storage();
  const pending = store ? takePending(store, ret.state, Date.now()) : null;
  if (ret.error === "access_denied") {
    googleNotice.value = null;
    backToSignIn(pending?.next ?? null);
    return;
  }
  if (!pending || !ret.idToken || ret.error) {
    googleNotice.value = "failed";
    backToSignIn(pending?.next ?? null);
    return;
  }
  try {
    const { isNew } = await signInWithGoogleToken(ret.idToken, pending.nonce);
    googleNotice.value = null;
    const current = session.value;
    if (isNew && current.kind === "in") {
      // Best effort: the welcome mail waits a few minutes for it (backend migration 20261013000100).
      void current.backend.setProfileLang(contentLang(lang.value)).catch(() => undefined);
    }
    navigate(safeNext(pending.next) ?? "/", { replace: true });
  } catch (e) {
    googleNotice.value = e instanceof BackendError && e.code === "offline" ? "offline"
      : e instanceof BackendError && e.code === "rateLimited" ? "rateLimited" : "failed";
    backToSignIn(pending.next);
  }
}

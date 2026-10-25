// /obrisi-nalog — deleting the account without the app. Google Play asks every app with accounts for a web address
// where a person can do that; this is the address (https://app.evolako.rs/obrisi-nalog). The page is public: anyone
// can read what is deleted and what stays, then signs in the usual way and confirms.
// Pure functions; the page (src/screens/ObrisiNalog.tsx) does the side effects.

export const DELETE_ACCOUNT_PATH = "/obrisi-nalog";

/**
 * What the page offers:
 *   unavailable — no API configured (demo-only build): there are no accounts to delete here;
 *   demo        — the person is looking at a demo account: nothing real to delete, leave the demo first;
 *   signedOut   — sign in first (and come back here);
 *   ready       — signed in: the account's e-mail and "Obriši nalog";
 *   done        — the account was deleted in this tab.
 */
export type DeletionView = "unavailable" | "demo" | "signedOut" | "ready" | "done";

export interface DeletionInput {
  session: "out" | "demo" | "in";
  /** config.json has both apiBase and publishableKey. */
  signInAvailable: boolean;
  /** The account was just deleted here (the session is already "out"). */
  deleted: boolean;
}

export function deletionView({ session, signInAvailable, deleted }: DeletionInput): DeletionView {
  if (session === "in") return "ready";
  if (session === "demo") return "demo";
  // "Deleted" outlives the session, but not a build without accounts (nothing could have been deleted there).
  if (!signInAvailable) return "unavailable";
  return deleted ? "done" : "signedOut";
}

/** Sign-in that returns to this page (safeNext of the router accepts in-app paths only). */
export function deletionSignInLink(): string {
  return `/prijava?next=${encodeURIComponent(DELETE_ACCOUNT_PATH)}`;
}

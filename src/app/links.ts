// Deep links: the addresses that e-mails, the website and people share, and what they open.
//
//   /#podesavanja                    → /profil/nalog (backend e-mails link APP_LINK + "#podesavanja" in the footer)
//   ?lang=sr|sr-Cyrl|en|ru on any route → that language (public/boot.js applies it before the first paint, remembers
//                                      it and takes it out of the address)
//   /obracuni/YYYY-MM                → that month's statement (sign-in first, then back to it)
//   /prijava?email=…                 → the sign-in e-mail filled in (nothing is sent until the person taps)
//   /zatrazi-procenu?ref=EVO-XXXXX   → the referral code filled in, only when it is a valid code
//   /obrisi-nalog                    → deleting the account without the app (public; Google Play links to it —
//                                      src/app/deletion.ts)
import { isValidEmail, normalizeReferral } from "../lib/forms";
import { navigate } from "./router";

/** Hash links from outside the app and the routes they stand for. */
const HASH_ROUTES = new Map<string, string>([
  ["podesavanja", "/profil/nalog"],
]);

/** The route a hash link stands for ("#podesavanja" → "/profil/nalog"), or null for any other hash. */
export function hashRoute(hash: string): string | null {
  const key = decodeHash(hash).replace(/^#\/?/, "").replace(/\/+$/, "").toLowerCase();
  return HASH_ROUTES.get(key) ?? null;
}

function decodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash);
  } catch {
    return hash;
  }
}

/** Follows a hash link (on any path: APP_LINK may carry one), replacing the address. True when it did. */
export function followHashLink(): boolean {
  const target = hashRoute(window.location.hash);
  if (!target) return false;
  navigate(target, { replace: true });
  return true;
}

/** Hash links at start-up and later (a link clicked while the app is open in this tab). */
export function installDeepLinks(): void {
  followHashLink();
  window.addEventListener("hashchange", () => void followHashLink());
}

/** ?email= for the sign-in form: trimmed and lower-case, and only when it looks like an address. */
export function prefillEmail(query: URLSearchParams): string {
  const value = (query.get("email") ?? "").trim().toLowerCase();
  return value.length <= 254 && isValidEmail(value) ? value : "";
}

/** ?ref= for the assessment request: a valid EVO-XXXXX code (case and spaces forgiven), otherwise nothing. */
export function prefillReferral(query: URLSearchParams): string {
  return normalizeReferral(query.get("ref") ?? "") ?? "";
}

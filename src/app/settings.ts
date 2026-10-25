// Appearance settings of this browser: theme (light by default, dark and system selectable) — persisted.
// The language lives in i18n (also persisted, and ?lang= wins, see boot.js).
import { signal } from "@preact/signals";

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "evo.theme";

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // storage blocked
  }
  return "light";
}

export const theme = signal<Theme>(typeof window === "undefined" ? "light" : initialTheme());

const media = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

function apply(): void {
  const dark = theme.value === "dark" || (theme.value === "system" && Boolean(media?.matches));
  const root = document.documentElement;
  root.setAttribute("data-theme", dark ? "dark" : "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0B1220" : "#F1F4F9");
}

export function setTheme(next: Theme): void {
  theme.value = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // the choice lasts for this visit
  }
  apply();
}

export function installTheme(): void {
  apply();
  media?.addEventListener("change", () => {
    if (theme.value === "system") apply();
  });
}

const PREF_PREFIX = "evo.pref.";

/** Forgets every person's remembered choices in this browser (sign-out, account deletion, an ended session). */
export function forgetAccountPrefs(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREF_PREFIX)) keys.push(key);
    }
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    // storage blocked: nothing was remembered
  }
}

/** Per-account preferences the API cannot read back (consents): remembered in this browser, off by default. */
export function accountPref(accountId: string, name: string): boolean {
  try {
    return localStorage.getItem(`${PREF_PREFIX}${accountId}.${name}`) === "1";
  } catch {
    return false;
  }
}

export function setAccountPref(accountId: string, name: string, value: boolean): void {
  try {
    localStorage.setItem(`${PREF_PREFIX}${accountId}.${name}`, value ? "1" : "0");
  } catch {
    // not remembered
  }
}

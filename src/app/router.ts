// A tiny path router on the History API. Same-origin <a href="/…"> clicks are intercepted globally, so every link
// is a plain anchor (middle-click, "open in new tab" and copy link keep working). Cloudflare Pages serves
// index.html for every path (_redirects), so deep links like /obracuni/2026-09 load directly.
import { signal } from "@preact/signals";

export interface Location {
  path: string;
  query: URLSearchParams;
}

function read(): Location {
  return { path: normalize(window.location.pathname), query: new URLSearchParams(window.location.search) };
}

function normalize(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed === "" ? "/" : trimmed;
}

export const location = signal<Location>(typeof window === "undefined"
  ? { path: "/", query: new URLSearchParams() }
  : read());

/** How the current location was reached: a link (push), history (pop) or a redirect (replace). */
export const navigationKind = signal<"initial" | "push" | "pop" | "replace">("initial");

const scrollPositions = new Map<string, number>();

function historyKey(): string {
  return (history.state as { key?: string } | null)?.key ?? "initial";
}

export function navigate(to: string, options: { replace?: boolean; keepScroll?: boolean } = {}): void {
  const url = new URL(to, window.location.origin);
  const next = url.pathname + url.search + url.hash;
  const current = window.location.pathname + window.location.search + window.location.hash;
  if (next === current && !options.replace) return;
  scrollPositions.set(historyKey(), window.scrollY);
  const state = { key: Math.random().toString(36).slice(2) };
  if (options.replace) history.replaceState(state, "", next);
  else history.pushState(state, "", next);
  navigationKind.value = options.replace ? "replace" : "push";
  location.value = read();
  if (!options.keepScroll) window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
}

/** Change only the query string (drawers, filters) without a new page transition. */
export function setQuery(params: Record<string, string | null>, options: { replace?: boolean } = {}): void {
  const query = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(params)) {
    if (value === null) query.delete(key);
    else query.set(key, value);
  }
  const search = query.toString();
  const next = window.location.pathname + (search ? `?${search}` : "");
  const state = { key: Math.random().toString(36).slice(2) };
  if (options.replace) history.replaceState(state, "", next);
  else history.pushState(state, "", next);
  navigationKind.value = "replace";
  location.value = read();
}

export function back(fallback: string): void {
  if (history.state && (history.state as { key?: string }).key && history.length > 1) history.back();
  else navigate(fallback);
}

export function installRouter(): void {
  if (!history.state) history.replaceState({ key: "initial" }, "");
  window.addEventListener("popstate", () => {
    const previousPath = location.value.path;
    navigationKind.value = "pop";
    location.value = read();
    if (location.value.path !== previousPath) {
      const y = scrollPositions.get(historyKey()) ?? 0;
      requestAnimationFrame(() => window.scrollTo({ top: y, left: 0, behavior: "instant" as ScrollBehavior }));
    }
  });
  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const anchor = (e.target as Element | null)?.closest?.("a");
    if (!anchor || !anchor.href) return;
    if (anchor.target && anchor.target !== "_self") return;
    if (anchor.hasAttribute("download") || anchor.getAttribute("rel")?.includes("external")) return;
    const url = new URL(anchor.href);
    if (url.origin !== window.location.origin) return;
    // In-page anchors (the skip link) are handled by the browser.
    if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return;
    // Static files (licences, config) are real documents, not routes.
    if (/\.[a-z0-9]+$/i.test(url.pathname)) return;
    e.preventDefault();
    navigate(url.pathname + url.search + url.hash);
  });
}

/** Match "/obracuni/:month" style patterns. A malformed escape ("/obracuni/%") matches nothing: not found. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split("/").filter(Boolean);
  const b = path.split("/").filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const v = b[i]!;
    if (p.startsWith(":")) {
      try {
        params[p.slice(1)] = decodeURIComponent(v);
      } catch {
        return null;
      }
    } else if (p !== v) return null;
  }
  return params;
}

/** A path inside the app, safe to return to after sign-in (no open redirects). */
export function safeNext(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

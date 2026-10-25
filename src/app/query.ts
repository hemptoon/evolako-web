// A small data layer: cached resources keyed by string, shared between screens, refreshed on focus, polled like the
// app's …Updates() streams (every 30 s while the tab is visible, the live session every 10 s), and invalidated
// after writes. The last good data stays on screen when a refresh fails (offline): the error is shown beside it.
import { useEffect, useReducer, useRef } from "preact/hooks";

interface Entry {
  data?: unknown;
  error?: unknown;
  promise?: Promise<void>;
  updatedAt: number;
  stale: boolean;
  fetcher?: () => Promise<unknown>;
  listeners: Set<() => void>;
}

const cache = new Map<string, Entry>();

export const POLL_MS = 30_000;
export const LIVE_POLL_MS = 10_000;

function entry(key: string): Entry {
  let e = cache.get(key);
  if (!e) {
    e = { updatedAt: 0, stale: true, listeners: new Set() };
    cache.set(key, e);
  }
  return e;
}

function notify(e: Entry): void {
  for (const listener of e.listeners) listener();
}

function run(key: string, e: Entry): Promise<void> {
  if (e.promise || !e.fetcher) return e.promise ?? Promise.resolve();
  const fetcher = e.fetcher;
  e.promise = fetcher()
    .then((data) => {
      e.data = data;
      e.error = undefined;
      e.stale = false;
      e.updatedAt = Date.now();
    })
    .catch((error: unknown) => {
      e.error = error;
      e.stale = false;
      if (import.meta.env.DEV) console.warn(`[query] ${key}`, error);
    })
    .finally(() => {
      e.promise = undefined;
      notify(e);
    });
  notify(e);
  return e.promise;
}

export function clearCache(): void {
  cache.clear();
}

/** Refetch everything whose key starts with `prefix` (on screen now), mark the rest stale. */
export function invalidate(...prefixes: string[]): void {
  for (const [key, e] of cache) {
    if (!prefixes.some((p) => key.startsWith(p))) continue;
    e.stale = true;
    if (e.listeners.size > 0) void run(key, e);
  }
}

/** Replace cached data after a write that returned the new value. */
export function setData<T>(key: string, data: T): void {
  const e = entry(key);
  e.data = data;
  e.error = undefined;
  e.stale = false;
  e.updatedAt = Date.now();
  notify(e);
}

export function getData<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export interface Resource<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  reload: () => Promise<void>;
}

interface Options {
  /** Poll every n ms while the tab is visible. */
  poll?: number;
}

/**
 * Subscribe to a resource. `key === null` waits (a dependency is not known yet). Data is kept across screens;
 * a mount refetches stale data (older than 15 s) without hiding what is already there.
 */
export function useResource<T>(key: string | null, fetcher: () => Promise<T>, options: Options = {}): Resource<T> {
  const [, force] = useReducer((n: number) => n + 1, 0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    if (key === null) return;
    const e = entry(key);
    e.fetcher = () => fetcherRef.current();
    const listener = () => force(0);
    e.listeners.add(listener);
    if (e.stale || Date.now() - e.updatedAt > 15_000 || e.error) void run(key, e);
    else force(0);

    let timer: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (!options.poll || timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === "visible") void run(key, e);
      }, options.poll);
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        if (Date.now() - e.updatedAt > 5_000) void run(key, e);
        start();
      } else if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };
    const onOnline = () => void run(key, e);
    start();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      e.listeners.delete(listener);
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
  }, [key, options.poll]);

  if (key === null) return { data: undefined, error: undefined, loading: true, refreshing: false, reload: async () => {} };
  const e = entry(key);
  return {
    data: e.data as T | undefined,
    error: e.error,
    loading: e.data === undefined && e.error === undefined,
    refreshing: Boolean(e.promise),
    reload: () => {
      e.stale = true;
      return run(key, e);
    },
  };
}

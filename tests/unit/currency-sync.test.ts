// Display currency: the contract (PATCH of the profile, displayCurrency of the user, the fx document), the
// "last change wins" sync with the server, and the rate: content → cache → fallback constants.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSession } from "../../src/api/auth";
import { InvalidResponseError, parseFx, parseUser } from "../../src/api/parse";
import { RemoteBackend } from "../../src/api/remote";
import type { User } from "../../src/api/types";
import { FALLBACK_FX } from "../../src/lib/format";

const API = "https://api.evolako.rs";
const KEY = "sb_publishable_test";
const UID = "aaaaaaaa-0000-4000-8000-000000000001";
const FIXTURES = join(__dirname, "../fixtures/api");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

class MemoryStorage {
  private map = new Map<string, string>();
  get length() { return this.map.size; }
  key(i: number) { return [...this.map.keys()][i] ?? null; }
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, String(v)); }
  removeItem(k: string) { this.map.delete(k); }
  clear() { this.map.clear(); }
}

describe("contract", () => {
  it("displayCurrency: read when sent, RSD from an older server or an unknown value", () => {
    const user = fixture("currentUser.json");
    expect(parseUser(user).displayCurrency).toBe("RSD");
    expect(parseUser({ ...user, displayCurrency: "EUR" }).displayCurrency).toBe("EUR");
    const { displayCurrency: _drop, ...old } = user;
    expect(parseUser(old).displayCurrency).toBe("RSD");
    expect(parseUser({ ...user, displayCurrency: "RUB" }).displayCurrency).toBe("RSD");
  });

  it("fx: the fixture reads; a rate out of the sanity bounds is rejected", () => {
    const fx = parseFx(fixture("fx.json"));
    expect(fx).toEqual({ ...FALLBACK_FX, fetchedAt: "2026-10-06T06:10:00Z" });
    expect(() => parseFx({ ...fixture("fx.json"), rates: { EUR: 1.17, USD: 105 } })).toThrow(InvalidResponseError);
    expect(() => parseFx({ ...fixture("fx.json"), rates: { EUR: 117, USD: 200 } })).toThrow(InvalidResponseError);
    expect(() => parseFx({ ...fixture("fx.json"), base: "EUR" })).toThrow(InvalidResponseError);
  });

  it("setDisplayCurrency: PATCH of the own profile row with the user's token, sent once", async () => {
    const storage = new MemoryStorage();
    storage.setItem("evo.auth.refresh", "refresh-1");
    storage.setItem("evo.auth.user", JSON.stringify({ id: UID, email: "mila@example.com" }));
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)
        .map(([k, v]) => [k.toLowerCase(), v]));
      calls.push({ url, method: init?.method ?? "GET", headers, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (url.includes("/auth/v1/token")) {
        return new Response(JSON.stringify({ access_token: "access-1", refresh_token: "refresh-2", expires_in: 3600,
          token_type: "bearer", user: { id: UID, email: "mila@example.com" } }), { status: 200 });
      }
      return new Response(null, { status: 204 });
    });
    const config = { apiBase: API, publishableKey: KEY };
    const auth = new AuthSession(config, { fetch, storage, locks: null, now: () => 1_800_000_000_000 });
    const backend = new RemoteBackend(config, auth, { fetch, installId: () => "install", uuid: () => "u" });
    await backend.setDisplayCurrency("EUR");
    const patch = calls.at(-1)!;
    expect(patch.url).toBe(`${API}/rest/v1/profiles?id=eq.${UID}`);
    expect(patch.method).toBe("PATCH");
    expect(patch.body).toEqual({ display_currency: "EUR" });
    expect(patch.headers.authorization).toBe("Bearer access-1");
    expect(patch.headers.apikey).toBe(KEY);
    expect(patch.headers.prefer).toBe("return=minimal");
  });
});

describe("sync and rate", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    vi.resetModules();
    storage = new MemoryStorage();
    vi.stubGlobal("localStorage", storage);
  });
  afterEach(() => vi.unstubAllGlobals());

  async function load(apiBase = API) {
    const currency = await import("../../src/app/currency");
    const session = await import("../../src/app/session");
    session.config.value = { apiBase, publishableKey: KEY, demo: true, googleClientId: "", googleOrigins: [] };
    return { ...currency, ...session };
  }

  function signIn(s: Awaited<ReturnType<typeof load>>, save: (c: string) => Promise<void>) {
    s.session.value = { kind: "in", id: `in:${UID}`, email: "", backend: { setDisplayCurrency: save } } as never;
  }

  const user = (displayCurrency: "RSD" | "EUR" | "USD") => ({ ...parseUser(fixture("currentUser.json")), displayCurrency }) as User;

  it("defaults to RSD and the fallback rate", async () => {
    const s = await load();
    expect(s.currency.value).toBe("RSD");
    expect(s.fx.value).toEqual(FALLBACK_FX);
  });

  it("signed in: a choice goes to the server; the server's value wins at the next answer", async () => {
    const s = await load();
    const save = vi.fn(async () => undefined);
    signIn(s, save);
    s.setCurrency("EUR");
    expect(s.currency.value).toBe("EUR");
    expect(storage.getItem("evo:cur")).toBe("EUR");
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith("EUR"));
    await Promise.resolve();
    s.applyServerCurrency(user("USD")); // changed on the phone since
    expect(s.currency.value).toBe("USD");
    expect(storage.getItem("evo:cur")).toBe("USD");
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("a failed save keeps the local choice and is sent again at the next opening, not undone by the server", async () => {
    const s = await load();
    const save = vi.fn(async () => { throw new TypeError("offline"); });
    signIn(s, save);
    s.setCurrency("EUR");
    await vi.waitFor(() => expect(storage.getItem(`evo.pref.${UID}.currencyPending`)).toBe("1"));
    // next opening: the server still says RSD — the pending local choice is pushed instead
    vi.resetModules();
    const again = await load();
    expect(again.currency.value).toBe("EUR");
    const retry = vi.fn(async () => undefined);
    signIn(again, retry);
    again.applyServerCurrency(user("RSD"));
    expect(again.currency.value).toBe("EUR");
    await vi.waitFor(() => expect(retry).toHaveBeenCalledWith("EUR"));
    await vi.waitFor(() => expect(storage.getItem(`evo.pref.${UID}.currencyPending`)).toBe("0"));
  });

  it("the demo keeps the choice locally and never calls the backend", async () => {
    const s = await load();
    const save = vi.fn(async () => undefined);
    s.session.value = { kind: "demo", id: "demo:wallbox", backend: { setDisplayCurrency: save } } as never;
    s.setCurrency("USD");
    s.applyServerCurrency(user("RSD"));
    expect(s.currency.value).toBe("USD");
    expect(save).not.toHaveBeenCalled();
  });

  it("the rate: manifest → file with a matching sha256 → kept for the next start", async () => {
    const s = await load();
    const body = readFileSync(join(FIXTURES, "fx.json"));
    const sha256 = createHash("sha256").update(body).digest("hex");
    const path = `v1/fx.${sha256.slice(0, 12)}.json`;
    const urls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      urls.push(String(url));
      if (String(url).endsWith("/manifest.json")) {
        return new Response(JSON.stringify({ files: { fx: { path, sha256, bytes: body.length, schemaVersion: 1 } } }));
      }
      return new Response(new Uint8Array(body));
    });
    await s.loadFx(fetcher as typeof fetch);
    expect(urls).toEqual([`${API}/content/v1/manifest.json`, `${API}/content/${path}`]);
    expect(s.fx.value.date).toBe("2026-10-05");
    expect(JSON.parse(storage.getItem("evo:fx")!).rates.EUR).toBe(117.4948);
  });

  it("no rate (503, wrong hash, a path outside /content/, demo-only mode): the cache or the fallback stays", async () => {
    const s = await load();
    await s.loadFx((async () => new Response("", { status: 503 })) as typeof fetch);
    expect(s.fx.value).toEqual(FALLBACK_FX);
    await s.loadFx((async (url: RequestInfo | URL) => String(url).endsWith("manifest.json")
      ? new Response(JSON.stringify({ files: { fx: { path: "v1/fx.0123456789ab.json", sha256: "00", schemaVersion: 1 } } }))
      : new Response(JSON.stringify({ ...fixture("fx.json"), date: "2026-10-06" }))) as typeof fetch);
    expect(s.fx.value).toEqual(FALLBACK_FX);
    const outside = vi.fn(async () => new Response(JSON.stringify({ files: { fx: { path: "https://evil.example/fx.json" } } })));
    await s.loadFx(outside as typeof fetch);
    expect(outside).toHaveBeenCalledTimes(1);
    expect(s.fx.value).toEqual(FALLBACK_FX);
    s.config.value = { apiBase: "", publishableKey: "", demo: true, googleClientId: "", googleOrigins: [] };
    const none = vi.fn();
    await s.loadFx(none as typeof fetch);
    expect(none).not.toHaveBeenCalled();
  });
});

// Sign-in with Google: the address at Google, the return, state and nonce, and the token exchange at Supabase.
import { describe, expect, it, vi } from "vitest";
import { AuthSession, REFRESH_KEY, USER_KEY, type StorageLike } from "../../src/api/auth";
import { AccountError, BackendError } from "../../src/api/errors";
import {
  GOOGLE_AUTH, googleAuthUrl, googleHl, parseReturn, PENDING_KEY, PENDING_TTL_MS, randomToken, savePending, sha256Hex,
  takePending,
} from "../../src/api/google";

const API = "https://api.evolako.rs";
const KEY = "sb_publishable_test123";
const CLIENT = "936328602255-httlmmrs4ktooaechkqrslmvduh6t0pg.apps.googleusercontent.com";
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

describe("the address at Google", () => {
  it("asks for an ID token only, for the e-mail only, with our state, the hashed nonce and the account chooser", () => {
    const url = new URL(googleAuthUrl({ clientId: CLIENT, redirectUri: "https://app.evolako.rs/auth/google",
      state: "ab12", nonceHash: "ff00", hl: "sr-Latn" }));
    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTH);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CLIENT,
      redirect_uri: "https://app.evolako.rs/auth/google",
      response_type: "id_token",
      response_mode: "fragment",
      scope: "openid email",
      state: "ab12",
      nonce: "ff00",
      prompt: "select_account",
      hl: "sr-Latn",
    });
  });

  it("speaks the page's language at Google: Latin Serbian is sr-Latn there, plain sr is Cyrillic", () => {
    expect(googleHl("sr")).toBe("sr-Latn");
    expect(googleHl("sr-Cyrl")).toBe("sr");
    expect(googleHl("en")).toBe("en");
    expect(googleHl("ru")).toBe("ru");
  });

  it("random values are hex of the asked length; the nonce hash is SHA-256 hex", async () => {
    expect(randomToken(16)).toMatch(/^[0-9a-f]{32}$/);
    expect(randomToken(16)).not.toBe(randomToken(16));
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("the return from Google", () => {
  it("reads the token and the state from the fragment", () => {
    expect(parseReturn(`#state=ab12&id_token=${TOKEN}&authuser=0&prompt=none`, "")).toEqual({ idToken: TOKEN, state: "ab12", error: null });
  });

  it("an error from Google (Cancel), in the fragment or the query", () => {
    expect(parseReturn("#error=access_denied&state=ab12", "")).toEqual({ idToken: null, state: "ab12", error: "access_denied" });
    expect(parseReturn("", "?error=invalid_request")).toEqual({ idToken: null, state: null, error: "invalid_request" });
  });

  it("something that is not a JWT is not a token", () => {
    expect(parseReturn("#id_token=<script>&state=ab12", "").idToken).toBeNull();
    expect(parseReturn("#id_token=a.b&state=ab12", "").idToken).toBeNull();
  });
});

describe("state and nonce of the sign-in this browser started", () => {
  const now = 1_800_000_000_000;

  it("the right state gives the sign-in back once; it is gone afterwards", () => {
    const store = new MemoryStorage();
    savePending(store, { state: "ab12", nonce: "cd34", next: "/obracuni", at: now - 1000 });
    expect(takePending(store, "ab12", now)).toEqual({ state: "ab12", nonce: "cd34", next: "/obracuni", at: now - 1000 });
    expect(store.getItem(PENDING_KEY)).toBeNull();
    expect(takePending(store, "ab12", now)).toBeNull();
  });

  it("another state, an old sign-in or a missing one: nothing — and the stored one is spent anyway", () => {
    const store = new MemoryStorage();
    savePending(store, { state: "ab12", nonce: "cd34", next: null, at: now });
    expect(takePending(store, "ab13", now)).toBeNull();
    expect(store.getItem(PENDING_KEY)).toBeNull();
    savePending(store, { state: "ab12", nonce: "cd34", next: null, at: now - PENDING_TTL_MS - 1 });
    expect(takePending(store, "ab12", now)).toBeNull();
    savePending(store, { state: "ab12", nonce: "cd34", next: null, at: now + 10 * 60_000 });
    expect(takePending(store, "ab12", now)).toBeNull();
    expect(takePending(store, null, now)).toBeNull();
    expect(takePending(new MemoryStorage(), "ab12", now)).toBeNull();
  });

  it("garbage in storage is not a sign-in", () => {
    const store = new MemoryStorage();
    store.setItem(PENDING_KEY, "{not json");
    expect(takePending(store, "ab12", now)).toBeNull();
    store.setItem(PENDING_KEY, JSON.stringify({ state: "ab12", nonce: "<x>", at: now }));
    expect(takePending(store, "ab12", now)).toBeNull();
  });
});

describe("AuthSession.signInWithIdToken", () => {
  function setup(answer: () => Response | Promise<Response>) {
    const storage = new MemoryStorage();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init: init ?? {} });
      return answer();
    });
    const auth = new AuthSession({ apiBase: API, publishableKey: KEY },
      { fetch, storage, locks: null, now: () => Date.parse("2026-10-13T01:00:00Z") });
    return { auth, storage, calls };
  }
  const ok = (created: string) => new Response(JSON.stringify({
    access_token: "a1", refresh_token: "r1", expires_in: 3600, token_type: "bearer",
    user: { id: "u-1", email: "mila@gmail.com", created_at: created },
  }), { status: 200, headers: { "content-type": "application/json" } });

  it("sends the token and the raw nonce to grant_type=id_token with the publishable key only", async () => {
    const { auth, storage, calls } = setup(() => ok("2026-10-13T00:59:00Z"));
    const user = await auth.signInWithIdToken(TOKEN, "cd34");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${API}/auth/v1/token?grant_type=id_token`);
    expect(calls[0]!.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ provider: "google", id_token: TOKEN, nonce: "cd34" });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.apikey).toBe(KEY);
    expect(headers.authorization).toBeUndefined();
    expect(user).toEqual({ id: "u-1", email: "mila@gmail.com", isNew: true });
    expect(storage.getItem(REFRESH_KEY)).toBe("r1");
    expect(JSON.parse(storage.getItem(USER_KEY)!)).toEqual({ id: "u-1", email: "mila@gmail.com" });
    expect(auth.hasSession).toBe(true);
  });

  it("an account made earlier (by an e-mail code) is not new", async () => {
    const { auth } = setup(() => ok("2026-09-29T20:00:00Z"));
    expect((await auth.signInWithIdToken(TOKEN, "cd34")).isNew).toBe(false);
  });

  it("a refused token → googleFailed; too many → rateLimited; no network → offline; nothing stored", async () => {
    for (const [status, expected] of [[400, "googleFailed"], [403, "googleFailed"], [422, "googleFailed"]] as const) {
      const { auth, storage } = setup(() => new Response(JSON.stringify({ error: "invalid_grant" }), { status }));
      await expect(auth.signInWithIdToken(TOKEN, "cd34")).rejects.toEqual(new AccountError(expected));
      expect(storage.getItem(REFRESH_KEY)).toBeNull();
    }
    const limited = setup(() => new Response("{}", { status: 429 }));
    await expect(limited.auth.signInWithIdToken(TOKEN, "cd34")).rejects.toEqual(new BackendError("rateLimited"));
    const offline = setup(() => { throw new TypeError("Failed to fetch"); });
    await expect(offline.auth.signInWithIdToken(TOKEN, "cd34")).rejects.toEqual(new BackendError("offline"));
  });

  it("an answer without the user is not a sign-in", async () => {
    const { auth, storage } = setup(() => new Response(JSON.stringify({ access_token: "a1", refresh_token: "r1" }), { status: 200 }));
    await expect(auth.signInWithIdToken(TOKEN, "cd34")).rejects.toEqual(new AccountError("googleFailed"));
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
  });
});

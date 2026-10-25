// Evolako pismo — /pismo (confirm a website sign-up) and /odjava (unsubscribe): the calls to the `newsletter` function
// (exact bodies and headers, every answer mapped, never an automatic retry) and the steps of the two pages (what the
// link gives, what the tab keeps, what a result leads to).
import { describe, expect, it, vi } from "vitest";
import { confirmSubscription, NEWSLETTER_PATH, unsubscribeByLink } from "../../src/api/newsletter";
import {
  confirmAfter, confirmLinkFrom, confirmStart, hasLinkParams, isUnsubscribeLink, linkLang, linkParam, sending,
  unsubscribeAfter, unsubscribeLinkFrom, unsubscribeStart, type ConfirmView, type Flow,
} from "../../src/app/pismo";

const API = { apiBase: "https://api.evolako.rs", publishableKey: "sb_publishable_test123" };
const TOKEN = "Qx2mV7cN0pL4sT9wY1zA3bD5fG8hJ6kR2uE4iO7aS0d"; // 43 characters of base64url, like the backend's
const HMAC = "0f3a9c2b7d1e4f6a8b0c2d4e6f8a0b1c"; // 32 hex characters, like hmacHex()

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown }

function mockFetch(answer: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)
      .map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url, method: init?.method ?? "GET", headers, body: JSON.parse(String(init?.body ?? "null")) });
    return answer();
  });
  return { fn, calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("confirm (POST newsletter {action: confirm})", () => {
  it("sends the token with the publishable key only — no user token, no retry", async () => {
    const { fn, calls } = mockFetch(() => json(200, { ok: true, status: "confirmed" }));
    expect(await confirmSubscription(API, TOKEN, fn)).toBe("confirmed");
    expect(calls).toEqual([{
      url: `https://api.evolako.rs${NEWSLETTER_PATH}`,
      method: "POST",
      headers: { apikey: API.publishableKey, "content-type": "application/json" },
      body: { action: "confirm", token: TOKEN },
    }]);
  });

  it("switches on status, not on ok: all three outcomes are 200", async () => {
    for (const status of ["confirmed", "expired", "invalid"] as const) {
      const { fn } = mockFetch(() => json(200, { ok: status === "confirmed", status }));
      expect(await confirmSubscription(API, TOKEN, fn), status).toBe(status);
    }
  });

  it("maps 429 to 'limited', a 5xx or no connection to 'offline', anything else to 'failed'", async () => {
    const cases: Array<[() => Response, string]> = [
      [() => json(429, { ok: false, error: "limit" }), "limited"],
      [() => json(500, {}), "offline"],
      [() => new Response("Bad gateway", { status: 502 }), "offline"],
      [() => json(200, { ok: true, status: "done" }), "failed"],
      [() => json(200, { ok: true }), "failed"],
      [() => new Response("<html></html>", { status: 200 }), "failed"],
      [() => json(400, { ok: false, error: "json" }), "failed"],
      [() => json(401, { message: "Invalid API key" }), "failed"],
      [() => json(404, { error: "not found" }), "failed"],
    ];
    for (const [answer, expected] of cases) {
      const { fn } = mockFetch(answer);
      expect(await confirmSubscription(API, TOKEN, fn)).toBe(expected);
    }
  });

  it("a lost answer is 'offline' after exactly one request: the server may have confirmed already", async () => {
    const { fn, calls } = mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await confirmSubscription(API, TOKEN, fn)).toBe("offline");
    expect(calls).toHaveLength(1);
  });

  it("sends a legacy anon JWT as Bearer too, like every other call without a user", async () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln";
    const { fn, calls } = mockFetch(() => json(200, { ok: true, status: "confirmed" }));
    await confirmSubscription({ apiBase: API.apiBase, publishableKey: jwt }, TOKEN, fn);
    expect(calls[0]!.headers).toMatchObject({ apikey: jwt, authorization: `Bearer ${jwt}` });
  });
});

describe("unsubscribe (POST newsletter {action: unsubscribe})", () => {
  const link = { e: "Mila+Pismo@Example.com", t: HMAC, l: "ru" as const };

  it("sends e, t and l exactly as they came (the server lower-cases the address itself)", async () => {
    const { fn, calls } = mockFetch(() => json(200, { ok: true }));
    expect(await unsubscribeByLink(API, link, fn)).toBe("done");
    expect(calls).toEqual([{
      url: `https://api.evolako.rs${NEWSLETTER_PATH}`,
      method: "POST",
      headers: { apikey: API.publishableKey, "content-type": "application/json" },
      body: { action: "unsubscribe", e: "Mila+Pismo@Example.com", t: HMAC, l: "ru" },
    }]);
  });

  it("maps every answer", async () => {
    const cases: Array<[() => Response, string]> = [
      [() => json(200, { ok: true }), "done"],
      [() => json(400, { ok: false, error: "invalid" }), "invalid"],
      [() => json(429, { ok: false, error: "limit" }), "limited"],
      [() => json(503, {}), "offline"],
      [() => json(200, { ok: false }), "failed"],
      [() => json(400, { ok: false, error: "json" }), "failed"],
      [() => new Response("", { status: 200 }), "failed"],
    ];
    for (const [answer, expected] of cases) {
      const { fn } = mockFetch(answer);
      expect(await unsubscribeByLink(API, link, fn)).toBe(expected);
    }
    const { fn, calls } = mockFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect(await unsubscribeByLink(API, link, fn)).toBe("offline");
    expect(calls).toHaveLength(1);
  });
});

describe("the link in the address", () => {
  it("reads a parameter as written: '+' stays '+', %2B is '+', a broken escape is absent", () => {
    expect(linkParam("?e=ana+pismo@primer.rs&t=x", "e")).toBe("ana+pismo@primer.rs");
    expect(linkParam("?e=ana%2Bpismo%40primer.rs", "e")).toBe("ana+pismo@primer.rs");
    expect(linkParam("e=a%40b.rs", "e")).toBe("a@b.rs");
    expect(linkParam("?e=%E0%A4%A", "e")).toBeNull();
    expect(linkParam("?t=", "t")).toBe("");
    expect(linkParam("?t", "t")).toBe("");
    expect(linkParam("?t=first&t=second", "t")).toBe("first");
    expect(linkParam("?utm=1&%74=encoded-name", "t")).toBe("encoded-name");
    expect(linkParam("", "t")).toBeNull();
    expect(linkParam("?tt=1&l=en", "t")).toBeNull();
  });

  it("takes ?l= only when it is one of our languages", () => {
    expect(linkLang("?t=x&l=en")).toBe("en");
    expect(linkLang("?l=RU")).toBe("ru");
    expect(linkLang("?l=sr-Cyrl")).toBe("sr-Cyrl");
    expect(linkLang("?t=x&l=CY")).toBe("sr-Cyrl");
    expect(linkLang("?l=de")).toBeNull();
    expect(linkLang("?lang=en")).toBeNull();
    expect(hasLinkParams("?utm_source=x", ["t", "l"])).toBe(false);
    expect(hasLinkParams("?utm_source=x&l=de", ["t", "l"])).toBe(true);
  });
});

describe("/pismo — steps", () => {
  it("takes the token from the address, else from the tab; a new link replaces the kept one", () => {
    expect(confirmLinkFrom(`?t=${TOKEN}&l=en`, null)).toEqual({ t: TOKEN });
    expect(confirmLinkFrom(`?t=%20${TOKEN}%20`, null)).toEqual({ t: TOKEN });
    // reload: the address was cleaned, the tab kept the link and its outcome
    const kept = JSON.stringify({ t: TOKEN, outcome: "confirmed" });
    expect(confirmLinkFrom("", kept)).toEqual({ t: TOKEN, outcome: "confirmed" });
    // the same link opened again keeps its outcome; another link starts over
    expect(confirmLinkFrom(`?t=${TOKEN}`, kept)).toEqual({ t: TOKEN, outcome: "confirmed" });
    expect(confirmLinkFrom("?t=another-token-0123456789", kept)).toEqual({ t: "another-token-0123456789" });
    // nothing anywhere, or rubbish kept
    expect(confirmLinkFrom("", null)).toBeNull();
    for (const junk of ["{", "[]", "null", "\"x\"", "{\"t\":1}"]) expect(confirmLinkFrom("", junk), junk).toBeNull();
    expect(confirmLinkFrom("", JSON.stringify({ t: TOKEN, outcome: "maybe" }))).toEqual({ t: TOKEN });
  });

  it("starts: demo sends nothing; no token or a broken one is an invalid link; otherwise the button", () => {
    const view = (link: Parameters<typeof confirmStart>[0], live = true) => confirmStart(link, live).view;
    expect(view({ t: TOKEN }, false)).toBe("demo");
    expect(view(null, false)).toBe("demo");
    expect(view(null)).toBe("invalid");
    for (const t of ["", "abc", "short-token", `${TOKEN}!`, "a b c d e f g h i j", "x".repeat(257)]) expect(view({ t }), t).toBe("invalid");
    expect(view({ t: TOKEN })).toBe("ready");
    expect(view({ t: TOKEN, outcome: "expired" })).toBe("expired");
    expect(confirmStart({ t: TOKEN }, true)).toEqual({ view: "ready", busy: false, problem: null });
  });

  it("sends once, from 'ready' only", () => {
    const ready: Flow<ConfirmView> = { view: "ready", busy: false, problem: "offline" };
    expect(sending(ready)).toEqual({ view: "ready", busy: true, problem: null });
    expect(sending({ ...ready, busy: true })).toBeNull();
    for (const view of ["demo", "invalid", "confirmed", "expired"] as const) expect(sending({ view, busy: false, problem: null })).toBeNull();
  });

  it("ends with an outcome; a problem leaves the button for another try", () => {
    expect(confirmAfter("confirmed")).toEqual({ view: "confirmed", busy: false, problem: null });
    expect(confirmAfter("expired")).toEqual({ view: "expired", busy: false, problem: null });
    expect(confirmAfter("invalid")).toEqual({ view: "invalid", busy: false, problem: null });
    for (const problem of ["limited", "offline", "failed"] as const) {
      expect(confirmAfter(problem)).toEqual({ view: "ready", busy: false, problem });
    }
  });
});

describe("/odjava — steps", () => {
  it("takes e and t from the address, else from the tab", () => {
    expect(unsubscribeLinkFrom(`?e=mila%40example.com&t=${HMAC}&l=sr`, null)).toEqual({ e: "mila@example.com", t: HMAC });
    expect(unsubscribeLinkFrom(`?e=ana+pismo@example.com&t=${HMAC}`, null)).toEqual({ e: "ana+pismo@example.com", t: HMAC });
    const kept = JSON.stringify({ e: "mila@example.com", t: HMAC, outcome: "done" });
    expect(unsubscribeLinkFrom("", kept)).toEqual({ e: "mila@example.com", t: HMAC, outcome: "done" });
    expect(unsubscribeLinkFrom(`?e=mila@example.com&t=${HMAC}`, kept)).toEqual({ e: "mila@example.com", t: HMAC, outcome: "done" });
    expect(unsubscribeLinkFrom(`?e=ana@example.com&t=${HMAC}`, kept)).toEqual({ e: "ana@example.com", t: HMAC });
    // half a link in the address is still this link — and not a valid one
    expect(unsubscribeLinkFrom("?e=mila@example.com", kept)).toEqual({ e: "mila@example.com", t: "" });
    expect(unsubscribeLinkFrom("", null)).toBeNull();
  });

  it("checks only what can be checked here: an address and a token (the server checks they belong together)", () => {
    expect(isUnsubscribeLink({ e: "mila@example.com", t: HMAC })).toBe(true);
    expect(isUnsubscribeLink({ e: "Mila+Pismo@Example.com", t: HMAC })).toBe(true);
    for (const bad of [{ e: "", t: HMAC }, { e: "mila@", t: HMAC }, { e: "mila example@x.rs", t: HMAC }, { e: "mila@example.com", t: "" },
      { e: "mila@example.com", t: "abc" }, { e: `${"a".repeat(250)}@x.rs`, t: HMAC }, { e: "mila@example.com", t: "<script>" }]) {
      expect(isUnsubscribeLink(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(isUnsubscribeLink(null)).toBe(false);
  });

  it("starts and ends like /pismo", () => {
    const link = { e: "mila@example.com", t: HMAC };
    expect(unsubscribeStart(link, false).view).toBe("demo");
    expect(unsubscribeStart(null, true).view).toBe("invalid");
    expect(unsubscribeStart({ e: "mila@", t: HMAC }, true).view).toBe("invalid");
    expect(unsubscribeStart(link, true).view).toBe("ready");
    expect(unsubscribeStart({ ...link, outcome: "done" }, true).view).toBe("done");
    expect(unsubscribeAfter("done")).toEqual({ view: "done", busy: false, problem: null });
    expect(unsubscribeAfter("invalid")).toEqual({ view: "invalid", busy: false, problem: null });
    for (const problem of ["limited", "offline", "failed"] as const) {
      expect(unsubscribeAfter(problem)).toEqual({ view: "ready", busy: false, problem });
    }
  });
});

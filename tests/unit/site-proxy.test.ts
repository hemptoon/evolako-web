// site-proxy/bot.js: app.evolako.rs/s/p, /zgrada/broj and /kr/* pass the visitor's request on to the CRM bot unchanged
import { describe, expect, it } from "vitest";
import { toBot } from "../../site-proxy/bot.js";

function bot() {
  const seen: Request[] = [];
  return { seen, BOT: { fetch: async (r: Request) => { seen.push(r); return new Response(null, { status: 204 }); } } };
}

describe("site proxy to the bot", () => {
  it("counter: same path, method, body and visitor headers", async () => {
    const b = bot();
    const req = new Request("https://app.evolako.rs/s/p", {
      method: "POST",
      body: JSON.stringify({ h: "www.evolako.rs", p: "/" }),
      headers: { origin: "https://www.evolako.rs", "cf-connecting-ip": "203.0.113.7", "user-agent": "UA/1" },
    });
    const res = await toBot({ request: req, env: { BOT: b.BOT } });
    expect(res.status).toBe(204);
    const f = b.seen[0]!;
    expect(new URL(f.url).pathname).toBe("/s/p");
    expect(f.method).toBe("POST");
    expect(f.headers.get("origin")).toBe("https://www.evolako.rs");
    expect(f.headers.get("cf-connecting-ip")).toBe("203.0.113.7");
    expect(f.headers.get("user-agent")).toBe("UA/1");
    expect(JSON.parse(await f.text())).toEqual({ h: "www.evolako.rs", p: "/" });
  });

  it("building count: the query string goes along", async () => {
    const b = bot();
    await toBot({ request: new Request("https://app.evolako.rs/zgrada/broj?grad=Beograd&ulica=X&broj=1"), env: { BOT: b.BOT } });
    const u = new URL(b.seen[0]!.url);
    expect(u.pathname).toBe("/zgrada/broj");
    expect(u.searchParams.get("grad")).toBe("Beograd");
  });

  it("careers form: CORS preflight and file upload pass through", async () => {
    const b = bot();
    await toBot({ request: new Request("https://app.evolako.rs/kr/apply", { method: "OPTIONS", headers: { origin: "https://www.evolako.rs" } }), env: { BOT: b.BOT } });
    await toBot({ request: new Request("https://app.evolako.rs/kr/file/abc123?t=tok&n=0", { method: "POST", body: new Uint8Array([1, 2, 3]), headers: { "x-name": "cv.pdf" } }), env: { BOT: b.BOT } });
    expect(b.seen[0]!.method).toBe("OPTIONS");
    expect(new URL(b.seen[1]!.url).pathname).toBe("/kr/file/abc123");
    expect(b.seen[1]!.headers.get("x-name")).toBe("cv.pdf");
    expect(new Uint8Array(await b.seen[1]!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("no binding yet: 503, no crash", async () => {
    const res = await toBot({ request: new Request("https://app.evolako.rs/s/p", { method: "POST", body: "{}" }), env: {} });
    expect(res.status).toBe(503);
  });
});

// site-proxy/kr.js: careers form only from Serbia (09.11.2026)
import { careers } from "../../site-proxy/kr.js";

function withCf(req: Request, country?: string): Request {
  if (country) Object.defineProperty(req, "cf", { value: { country } });
  return req;
}

describe("careers: Serbia only", () => {
  const origin = { origin: "https://www.evolako.rs" };

  it("zemlja: the visitor's country, with CORS for the site", async () => {
    const b = bot();
    const res = await careers({ request: withCf(new Request("https://app.evolako.rs/kr/zemlja", { headers: origin }), "RS"), env: { BOT: b.BOT } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cc: "RS" });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.evolako.rs");
    expect(b.seen.length).toBe(0);
  });

  it("zemlja: no CORS for other sites", async () => {
    const res = await careers({ request: withCf(new Request("https://app.evolako.rs/kr/zemlja", { headers: { origin: "https://evil.example" } }), "RS"), env: {} });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("apply from abroad: 403 geo, nothing goes to the bot", async () => {
    const b = bot();
    const req = withCf(new Request("https://app.evolako.rs/kr/apply", { method: "POST", body: "{}", headers: origin }), "IN");
    const res = await careers({ request: req, env: { BOT: b.BOT } });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, err: "geo" });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://www.evolako.rs");
    expect(b.seen.length).toBe(0);
  });

  it("apply from Serbia, preflight and files: on to the bot", async () => {
    const b = bot();
    await careers({ request: withCf(new Request("https://app.evolako.rs/kr/apply", { method: "POST", body: "{}", headers: origin }), "RS"), env: { BOT: b.BOT } });
    await careers({ request: withCf(new Request("https://app.evolako.rs/kr/apply", { method: "OPTIONS", headers: origin }), "IN"), env: { BOT: b.BOT } });
    await careers({ request: withCf(new Request("https://app.evolako.rs/kr/file/abc?t=x&n=0", { method: "POST", body: "x" }), "RS"), env: { BOT: b.BOT } });
    expect(b.seen.map((r) => r.method + " " + new URL(r.url).pathname)).toEqual(["POST /kr/apply", "OPTIONS /kr/apply", "POST /kr/file/abc"]);
  });

  it("no country known (local): not refused", async () => {
    const b = bot();
    const res = await careers({ request: new Request("https://app.evolako.rs/kr/apply", { method: "POST", body: "{}" }), env: { BOT: b.BOT } });
    expect(res.status).toBe(204);
  });
});

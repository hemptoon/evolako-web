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

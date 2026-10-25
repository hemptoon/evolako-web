// Evolako pismo — the issue file (public/posta/<slug>.json) as the web version reads it: the backend's own fixture
// issue, the structure rules mirrored from newsletter_issue.ts, loading (404, the SPA fallback, bad JSON, offline), and
// the words of a text: **bold**, our links and addresses only.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { BackendError } from "../../src/api/errors";
import { InvalidResponseError } from "../../src/api/parse";
import {
  inlineTokens, IssueNotFound, linkTarget, loadIssue, parseIssue, shownRows, type InlineToken,
} from "../../src/api/posta";

const SLUG = "test-2026-09-29";
// A copy of evo-backend backend/tests/functions/data/posta/test-2026-09-29.json (hash 0b2b3291…): the file the
// backend's validator and e-mail renderer are tested with.
const RAW = readFileSync(new URL(`../fixtures/posta/${SLUG}.json`, import.meta.url), "utf8");
const issue = (): any => JSON.parse(RAW);

function refused(mutate: (d: ReturnType<typeof issue>) => void, slug = SLUG): boolean {
  const d = issue();
  mutate(d);
  try {
    parseIssue(d, slug);
    return false;
  } catch (e) {
    expect(e).toBeInstanceOf(InvalidResponseError);
    return true;
  }
}

describe("the issue file", () => {
  it("reads the backend's fixture issue in all three languages", () => {
    const parsed = parseIssue(issue(), SLUG);
    expect(parsed.slug).toBe(SLUG);
    expect(parsed.issue).toBe(1);
    expect(parsed.date).toBe("2026-09-29");
    expect(parsed.cover).toEqual({
      src: "/posta/test-2026-09-29.jpg",
      alt: { sr: "Auto na punjenju u garaži zgrade", en: "A car charging in a building garage", ru: "Машина на зарядке в гараже дома" },
    });
    for (const lang of ["sr", "en", "ru"] as const) {
      expect(parsed[lang].blocks.map((b) => b.type)).toEqual(["h2", "p", "list", "h2", "steps", "kv", "note", "divider", "button"]);
    }
    expect(parsed.ru.subject).toBe("Пробный выпуск: как заряжаться дешевле дома");
    expect(parsed.en.blocks[4]).toEqual({ type: "steps", items: [
      { title: "Consent", text: "A shared garage needs the consent of the building assembly." },
      { title: "Papers", text: "We give you templates for the assembly — draft decision and agenda item; you or the building manager submit them." },
    ] });
    expect(parsed.sr.blocks[5]).toEqual({ type: "kv", rows: [["Niža tarifa", "23–07 h"], ["kWh noću", "oko 6 RSD"]] });
    expect(parsed.sr.blocks[8]).toEqual({ type: "button", text: "Proveri svoju garažu", href: "https://www.evolako.rs/proveri-svoju-garazu" });
  });

  it("refuses what the backend refuses in the structure (the same cases as newsletter_issue_test.ts)", () => {
    const cases: Array<[string, (d: ReturnType<typeof issue>) => void]> = [
      ["no en", (d) => delete d.en],
      ["no blocks", (d) => (d.sr.blocks = [])],
      ["blocks not a list", (d) => (d.sr.blocks = { type: "p", text: "x" })],
      ["image block", (d) => d.sr.blocks.push({ type: "image", src: "https://www.evolako.rs/x.jpg" })],
      ["signature block", (d) => d.sr.blocks.push({ type: "signature" })],
      ["typo in a field", (d) => {
        d.sr.blocks[1].texts = d.sr.blocks[1].text;
        delete d.sr.blocks[1].text;
      }],
      ["blank text", (d) => (d.en.blocks[0].text = "   ")],
      ["kv row of three", (d) => d.sr.blocks[5].rows[0].push("x")],
      ["kv value not a text", (d) => (d.sr.blocks[5].rows[1][1] = 6)],
      ["empty list", (d) => (d.sr.blocks[2].items = [])],
      ["step without text", (d) => delete d.ru.blocks[4].items[1].text],
      ["button without link", (d) => delete d.sr.blocks[8].href],
      ["missing preheader", (d) => delete d.ru.preheader],
      ["missing subject", (d) => (d.en.subject = "")],
      ["wrong slug", (d) => (d.slug = "2026-10")],
      ["issue number as text", (d) => (d.issue = "1")],
      ["issue number 0", (d) => (d.issue = 0)],
      ["issue number 1.5", (d) => (d.issue = 1.5)],
      ["date that does not exist", (d) => (d.date = "2026-02-30")],
      ["date with a time", (d) => (d.date = "2026-09-29T10:00:00Z")],
      ["cover elsewhere", (d) => (d.cover.src = "https://cdn.example.com/x.jpg")],
      ["cover outside posta/", (d) => (d.cover.src = "/assets/x.jpg")],
      ["cover of another type", (d) => (d.cover.src = "/posta/x.gif")],
      ["cover null", (d) => (d.cover = null)],
      ["cover alt not a text", (d) => (d.cover.alt.sr = 1)],
      ["not an object", (d) => {
        for (const key of Object.keys(d)) delete d[key];
      }],
    ];
    for (const [name, mutate] of cases) expect(refused(mutate), name).toBe(true);
    expect(() => parseIssue([], SLUG)).toThrow(InvalidResponseError);
    expect(() => parseIssue(null, SLUG)).toThrow(InvalidResponseError);
    // the slug of the address must be a slug at all
    expect(refused((d) => (d.slug = "Test Issue"), "Test Issue")).toBe(true);
  });

  it("ignores what it does not know, like every decoder of the app; a cover is optional", () => {
    const d = issue();
    d.web_title = "ignored";
    d.sr.blocks[1].style = "lead";
    delete d.cover;
    const parsed = parseIssue(d, SLUG);
    expect(parsed.cover).toBeNull();
    expect(parsed.sr.blocks[1]).toEqual({ type: "p", text: d.sr.blocks[1].text });
    // alt texts are optional, unknown languages are dropped
    const e = issue();
    e.cover.alt = { sr: "Garaža", de: "Garage" };
    expect(parseIssue(e, SLUG).cover).toEqual({ src: "/posta/test-2026-09-29.jpg", alt: { sr: "Garaža" } });
    const f = issue();
    delete f.cover.alt;
    expect(parseIssue(f, SLUG).cover).toEqual({ src: "/posta/test-2026-09-29.jpg", alt: {} });
  });

  it("draws a list item of {title, text} too (the renderer's block type allows it)", () => {
    const d = issue();
    d.sr.blocks[2].items = ["Tekst", { title: "Naslov", text: "Opis" }];
    expect(parseIssue(d, SLUG).sr.blocks[2]).toEqual({ type: "list", items: ["Tekst", { title: "Naslov", text: "Opis" }] });
  });
});

describe("loading /posta/<slug>.json", () => {
  const respond = (status: number, body: string, type = "application/json") =>
    new Response(body, { status, headers: { "content-type": type } });

  it("GETs the file of this site and reads it", async () => {
    const fetch = vi.fn(async () => respond(200, RAW));
    const parsed = await loadIssue(SLUG, fetch);
    expect(parsed.en.subject).toBe("Test issue: how to charge for less at home");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/posta/${SLUG}.json`);
    expect(init.method).toBe("GET");
  });

  it("is not found: a bad slug (no request), a 404, the app's own page (SPA fallback), bad JSON, a file that is not an issue", async () => {
    const fetch = vi.fn(async () => respond(200, RAW));
    for (const slug of ["", "ab", "2026_10", "Test-2026", "a".repeat(41), "../config", "x/y"]) {
      await expect(loadIssue(slug, fetch), slug).rejects.toBeInstanceOf(IssueNotFound);
    }
    expect(fetch).not.toHaveBeenCalled();
    const answers = [
      respond(404, "Not found", "text/plain"),
      respond(200, "<!doctype html><html><body><div id=\"app\"></div></body></html>", "text/html"),
      respond(200, "{\"slug\": \"test-2026-09-29\","),
      respond(200, JSON.stringify({ ...issue(), slug: "other" })),
      respond(200, "[]"),
      respond(403, "{}"),
    ];
    for (const answer of answers) {
      await expect(loadIssue(SLUG, async () => answer)).rejects.toBeInstanceOf(IssueNotFound);
    }
  });

  it("offline is not 'not found': a 5xx, or no connection after one retry (a read)", async () => {
    await expect(loadIssue(SLUG, async () => respond(503, ""))).rejects.toEqual(new BackendError("offline"));
    const down = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(loadIssue(SLUG, down)).rejects.toEqual(new BackendError("offline"));
    expect(down).toHaveBeenCalledTimes(2);
  });
});

describe("links of an issue", () => {
  it("lead only to our sites over https", () => {
    expect(linkTarget("https://www.evolako.rs/proveri-svoju-garazu")).toBe("site");
    expect(linkTarget("https://evolako.rs")).toBe("site");
    expect(linkTarget("https://blokvolt.rs/mapa")).toBe("site");
    expect(linkTarget("https://www.blokvolt.rs/mapa?x=1#y")).toBe("site");
    expect(linkTarget("https://EVOLAKO.rs/cesta-pitanja")).toBe("site");
    expect(linkTarget("https://app.evolako.rs/profil/nalog")).toBe("app");
    for (const bad of [
      "http://www.evolako.rs/", "https://example.com/deal", "https://evolako.rs.example.com/", "https://app.evolako.rs:8443/pismo",
      "https://user@evolako.rs/", "https://user:pw@evolako.rs/", "mailto:hello@evolako.com", "javascript:alert(1)",
      "//evolako.rs/x", "/pismo", "evolako.rs", "https://", "https://mail.evolako.rs/",
    ]) {
      expect(linkTarget(bad), bad).toBeNull();
    }
  });
});

describe("the words of a text", () => {
  const plain = (text: string, bold = false): InlineToken => ({ kind: "text", text, bold });
  // Adjacent plain runs are merged: the tests compare what a reader sees, not how the text was cut.
  const merged = (text: string) => inlineTokens(text).reduce<InlineToken[]>((out, t) => {
    const prev = out[out.length - 1];
    if (prev && prev.kind === "text" && t.kind === "text" && prev.bold === t.bold) prev.text += t.text;
    else out.push({ ...t });
    return out;
  }, []);

  it("keeps plain text plain, even with < and >", () => {
    expect(merged("Kad je 3 < 5, a 7 > 2 — to nije HTML.")).toEqual([plain("Kad je 3 < 5, a 7 > 2 — to nije HTML.")]);
    expect(merged("<b>noću</b> &amp;")).toEqual([plain("<b>noću</b> &amp;")]);
    expect(inlineTokens("")).toEqual([]);
  });

  it("reads **bold** within a line; an unpaired ** stays as written", () => {
    expect(merged("Košta **oko 6 RSD** noću.")).toEqual([plain("Košta "), plain("oko 6 RSD", true), plain(" noću.")]);
    expect(merged("**a** i **b**")).toEqual([plain("a", true), plain(" i "), plain("b", true)]);
    expect(merged("2 ** 3 = 8")).toEqual([plain("2 ** 3 = 8")]);
    expect(merged("**prvi\ndrugi**")).toEqual([plain("**prvi\ndrugi**")]);
  });

  it("links our https addresses, without the punctuation after them, also inside bold", () => {
    expect(merged("Vidi https://www.evolako.rs/cesta-pitanja.")).toEqual([
      plain("Vidi "),
      { kind: "link", text: "https://www.evolako.rs/cesta-pitanja", href: "https://www.evolako.rs/cesta-pitanja", bold: false, target: "site" },
      plain("."),
    ]);
    expect(merged("(https://app.evolako.rs/pismo)")).toEqual([
      plain("("),
      { kind: "link", text: "https://app.evolako.rs/pismo", href: "https://app.evolako.rs/pismo", bold: false, target: "app" },
      plain(")"),
    ]);
    expect(merged("**Mapa: https://blokvolt.rs/mapa**")).toEqual([
      plain("Mapa: ", true),
      { kind: "link", text: "https://blokvolt.rs/mapa", href: "https://blokvolt.rs/mapa", bold: true, target: "site" },
    ]);
  });

  it("never links anything else: other hosts, http, ports — they stay text", () => {
    for (const text of ["See https://example.com/deal", "Vidi http://www.evolako.rs/paketi-i-cene", "https://app.evolako.rs:8443/pismo",
      "https://evolako.rs.example.com/", "Poseti www.evolako.rs"]) {
      expect(merged(text).every((t) => t.kind === "text"), text).toBe(true);
      expect(merged(text).map((t) => t.text).join(""), text).toBe(text);
    }
  });

  it("links only our e-mail addresses", () => {
    expect(merged("Piši nam na hello@evolako.com ili (podrska@blokvolt.rs).")).toEqual([
      plain("Piši nam na "),
      { kind: "mail", text: "hello@evolako.com", href: "mailto:hello@evolako.com", bold: false },
      plain(" ili ("),
      { kind: "mail", text: "podrska@blokvolt.rs", href: "mailto:podrska@blokvolt.rs", bold: false },
      plain(")."),
    ]);
    expect(merged("Piši na prodaja@example.com")).toEqual([plain("Piši na prodaja@example.com")]);
    expect(merged("**hello@evolako.rs**")).toEqual([{ kind: "mail", text: "hello@evolako.rs", href: "mailto:hello@evolako.rs", bold: true }]);
    // an address glued to a word is not one (as in the e-mail)
    expect(merged("x:hello@evolako.com")).toEqual([plain("x:hello@evolako.com")]);
  });

  it("reads the fixture's note like the e-mail does", () => {
    expect(merged(issue().en.blocks[6].text).map((t) => t.kind)).toEqual(["text", "mail", "text", "link", "text"]);
  });

  it("shows the kv rows the e-mail shows", () => {
    expect(shownRows([["Niža tarifa", "23–07 h"], ["Iznos", "RSD"], ["Energija", " kWh "], ["kWh noću", "oko 6 RSD"]]))
      .toEqual([["Niža tarifa", "23–07 h"], ["kWh noću", "oko 6 RSD"]]);
  });
});

describe("public/posta — what ships with the app", () => {
  const PUBLIC = new URL("../../public/", import.meta.url);
  const dir = new URL("posta/", PUBLIC);
  const read = (name: string) => readFileSync(new URL(name, dir), "utf8");

  it("index.json is {\"issues\": [...]}: valid JSON without a BOM, one entry per slug, each with its file", () => {
    const text = read("index.json");
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    const index = JSON.parse(text) as { issues?: unknown };
    expect(Array.isArray(index.issues)).toBe(true);
    const slugs = (index.issues as Array<{ slug?: unknown; status?: unknown }>).map((e) => {
      expect(typeof e.slug === "string" && /^[a-z0-9-]{3,40}$/.test(e.slug), JSON.stringify(e)).toBe(true);
      expect(["preview", "approved", "stopped"], JSON.stringify(e)).toContain(e.status);
      expect(existsSync(new URL(`${String(e.slug)}.json`, dir)), `posta/${String(e.slug)}.json`).toBe(true);
      return e.slug;
    });
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every issue file reads as an issue here, and its cover is there", () => {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json")) {
      const slug = name.slice(0, -".json".length);
      const text = read(name);
      expect(text.charCodeAt(0), name).not.toBe(0xfeff);
      const parsed = parseIssue(JSON.parse(text), slug);
      if (parsed.cover) expect(existsSync(new URL(`.${parsed.cover.src}`, PUBLIC)), parsed.cover.src).toBe(true);
    }
  });
});

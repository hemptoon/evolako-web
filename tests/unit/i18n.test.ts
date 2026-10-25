// The string catalog: complete in sr/en/ru, placeholders consistent, up to date with the sources, and free of
// the words Evolako never writes. The same word rules apply to the bundled site content (FAQ, kits).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error — a plain .mjs build script
import { build } from "../../scripts/make_strings.mjs";
import { fill } from "../../src/i18n";

type Plural = Record<string, string>;
type Entry = Record<"sr" | "en" | "ru", string | Plural>;

const catalog = JSON.parse(readFileSync(new URL("../../src/i18n/strings.json", import.meta.url), "utf8")) as Record<string, Entry>;
const faq = readFileSync(new URL("../../src/content/faq.json", import.meta.url), "utf8");
const paketi = readFileSync(new URL("../../src/content/paketi.json", import.meta.url), "utf8");

function texts(value: string | Plural): string[] {
  return typeof value === "string" ? [value] : Object.values(value);
}

function placeholders(text: string): string[] {
  return (text.match(/%(?:\d+\$)?(?:@|lld|ld|d)/g) ?? []).map((p) => p.replace(/^%\d+\$/, "%")).sort();
}

/** Words Evolako never writes (brief: no "atest", no discounts, no 24/7, no "odmah" as a promise, no Plug&Charge). */
const FORBIDDEN: Record<"sr" | "en" | "ru", RegExp[]> = {
  sr: [/(?<!\p{L})atest/iu, /popust/i, /24\/7/, /(?<!\p{L})odmah(?!\p{L})/iu, /plug\s*&\s*charge/i],
  en: [/discount/i, /24\/7/, /plug\s*&\s*charge/i, /certificate of (conformity|compliance)/i],
  ru: [/скидк/i, /24\/7/, /аттест|атест/i, /plug\s*&\s*charge/i, /немедленно/i],
};

describe("string catalog", () => {
  it("is up to date with the sources and complete in all three languages", () => {
    const { out, errors } = build() as { out: Record<string, Entry>; errors: string[] };
    expect(errors).toEqual([]);
    expect(Object.keys(out).sort()).toEqual(Object.keys(catalog).sort());
    for (const [key, entry] of Object.entries(catalog)) {
      for (const lang of ["sr", "en", "ru"] as const) {
        const value = entry[lang];
        expect(value, `${lang}: ${key}`).toBeTruthy();
        for (const text of texts(value)) expect(text.trim(), `${lang}: ${key}`).not.toBe("");
      }
    }
  });

  it("keeps the same placeholders in every language", () => {
    for (const [key, entry] of Object.entries(catalog)) {
      const expected = placeholders(key);
      for (const lang of ["sr", "en", "ru"] as const) {
        const value = entry[lang];
        // Plural forms may drop the count ("one" → "a month") but never add a placeholder.
        if (typeof value === "string") expect(placeholders(value), `${lang}: ${key}`).toEqual(expected);
        else for (const form of Object.values(value)) expect(placeholders(form).length).toBeLessThanOrEqual(expected.length);
      }
    }
  });

  it("never uses the forbidden words", () => {
    for (const [key, entry] of Object.entries(catalog)) {
      for (const lang of ["sr", "en", "ru"] as const) {
        for (const text of texts(entry[lang])) {
          for (const word of FORBIDDEN[lang]) expect(text, `${lang}: ${key}`).not.toMatch(word);
        }
      }
    }
  });

  it("keeps the site content free of them too", () => {
    for (const content of [faq, paketi]) {
      for (const word of [/(?<!\p{L})atest/iu, /popust/i, /24\/7/, /plug\s*&\s*charge/i, /discount/i, /скидк/i, /аттест|атест/i]) {
        expect(content).not.toMatch(word);
      }
    }
  });

  // Paketi v2 (07.10.2026): the basic WALLBOX promises no CT sensor / dynamic load management, and the only
  // add-on priced as a sum is the MID meter option (+10.000). The snapshots are byte-for-byte the app's.
  it("keeps the v2 line-up honest: no load balancing for WALLBOX, only MID +10.000 as an add-on sum", () => {
    const doc = JSON.parse(paketi);
    const wallbox = JSON.stringify(doc.packages.find((p: { id: string }) => p.id === "wallbox"));
    expect(wallbox).not.toMatch(/CT senzor|CT sensor|dinamičk|dynamic|динамическ/i);
    expect(wallbox).toContain("od 94.000");
    expect(doc.options.items.map((o: { id: string }) => o.id)).toEqual(["plus", "premium", "ugradnja"]);
    expect(new Set(paketi.match(/\+\s?\d{1,3}(?:\.\d{3})*/g))).toEqual(new Set(["+10.000"]));
  });

  it("uses the glossary: statement, charging point, kit, subscription", () => {
    const en = (key: string) => catalog[key]?.en;
    const ru = (key: string) => catalog[key]?.ru;
    expect(en("Obračuni")).toBe("Statements");
    expect(ru("Obračuni")).toBe("Отчёты");
    expect(en("Pretplata")).toBe("Subscription");
    expect(ru("Pretplata")).toBe("Подписка");
    expect(en("Komplet")).toBe("Kit");
    expect(en("Probni period")).toBe("Trial");
    expect(ru("Noćno okno")).toBe("Ночное окно");
    expect(en("Prijava kvara")).toBe("Problem report");
    // "Poziv na broj" and "IPS QR" are never translated.
    expect(String(en("Poziv na broj"))).toContain("Poziv na broj");
  });

  it("addresses people informally in Serbian and Russian", () => {
    for (const [key, entry] of Object.entries(catalog)) {
      // Unicode-aware word boundaries (\b does not know Cyrillic or "š").
      for (const text of texts(entry.ru)) expect(text, key).not.toMatch(/(?<!\p{L})(Вы|Вас|Вам|Ваш\p{L}*)(?!\p{L})/u);
      for (const text of texts(entry.sr)) expect(text, key).not.toMatch(/(?<!\p{L})(Vi|Vas|Vama|Vaš\p{L}*)(?!\p{L})/u);
    }
  });
});

// 01.10.2026: Evolako gives templates and a checklist; the paperwork and the talking are the customer's
// (docs/LEKSIKON_papiri_2026-10-01.md). One list with the app and the e-mails — papiri_forbidden.json, a copy of
// blokvolt-ios Scripts/papiri_forbidden.json: change one, copy it to the other.
const PAPIRI = JSON.parse(readFileSync(new URL("./papiri_forbidden.json", import.meta.url), "utf8")) as Record<
  "sr" | "en" | "ru" | "mustPass" | "mustFail", string[]>;
const PAPIRI_RX = (["sr", "en", "ru"] as const).flatMap((l) => PAPIRI[l].map((p) => new RegExp(p, "giu")));

function paperworkHits(text: string): string[] {
  return PAPIRI_RX.flatMap((re) => [...text.matchAll(re)].map((m) =>
    `${re}: …${text.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40)}…`));
}

function jsonFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? jsonFiles(path) : path.endsWith(".json") ? [path] : [];
  });
}

describe("paperwork rule (01.10.2026)", () => {
  it("passes the control samples", () => {
    for (const text of PAPIRI.mustPass) expect(paperworkHits(text), text).toEqual([]);
    for (const text of PAPIRI.mustFail) expect(paperworkHits(text).length, text).toBeGreaterThan(0);
  });

  it("finds nothing in the catalog, the site content and the newsletter issues", () => {
    const root = fileURLToPath(new URL("../../", import.meta.url));
    const files = [
      "src/i18n/strings.json", "src/content/faq.json", "src/content/paketi.json",
      ...jsonFiles(join(root, "public/posta")).map((f) => f.slice(root.length)),
      ...jsonFiles(join(root, "tests/fixtures/posta")).map((f) => f.slice(root.length)),
    ];
    expect(files.length).toBeGreaterThan(4);
    for (const file of files) expect(paperworkHits(readFileSync(join(root, file), "utf8")), file).toEqual([]);
  });
});

describe("fill", () => {
  it("fills %@, %lld and positional placeholders", () => {
    expect(fill("Obračun za %@ je spreman", ["septembar 2026."])).toBe("Obračun za septembar 2026. je spreman");
    expect(fill("%lld od %lld", [2, 3])).toBe("2 od 3");
    expect(fill("%2$@ — %1$@", ["a", "b"])).toBe("b — a");
  });

  it("keeps one dot after a Serbian date at the end of a sentence", () => {
    expect(fill("Rešeno %@.", ["20. oktobar 2026."])).toBe("Rešeno 20. oktobar 2026.");
    expect(fill("Rok za uplatu: %@", ["15. oktobar 2026."])).toBe("Rok za uplatu: 15. oktobar 2026.");
  });
});

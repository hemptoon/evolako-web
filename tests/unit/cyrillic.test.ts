// Serbian Cyrillic: never written by hand. Every text of the "sr-Cyrl" catalog is the Serbian one run through the
// transliteration of evolako.rs (src/i18n/evo-cyr.mjs, kept byte for byte), with placeholders, brands, units and
// codes left as they are.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cyr } from "../../src/i18n/evo-cyr.mjs";
import { cyrText, cyrValue } from "../../src/i18n/cyrillic.mjs";
import { contentLang, HTML_LANG, inScript, LANGS, langTitle, loadLang, tIn } from "../../src/i18n";
import { parseLang } from "../../src/app/pismo";
import { dayAndMonth, duration, fullDate, monthAndYear, weekdayAndDate } from "../../src/lib/format";

type Plural = Record<string, string>;
type Value = string | Plural;
type Entry = Record<"sr" | "sr-Cyrl" | "en" | "ru", Value>;

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const catalog = JSON.parse(read("src/i18n/strings.json")) as Record<string, Entry>;
const cyrillic = JSON.parse(read("src/i18n/lang/sr-Cyrl.json")) as Record<string, Value>;
const latin = JSON.parse(read("src/i18n/lang/sr.json")) as Record<string, Value>;

const texts = (value: Value): string[] => (typeof value === "string" ? [value] : Object.values(value));
const PLACEHOLDER = /%(?:\d+\$)?(?:@|lld|ld|lu|d|s|f|\.\d+f)|\{[A-Za-z_][A-Za-z0-9_]*\}/g;
const placeholders = (text: string): string[] => text.match(PLACEHOLDER) ?? [];
/** What stays Latin in Cyrillic: brands and networks, units, codes, e-mail and site addresses. */
const KEPT = /Evolako|Wallbox|Viber|WhatsApp|Telegram|Tesla|Excel|\bkWh\b|\bkW\b|\bRSD\b|\bEUR\b|\bUSD\b|\bMID\b|\bIPS QR\b|\bQR\b|\bPDF\b|\bCSV\b|\bOCPP\b|\bDC\b|EVO-XXXXX|[\w.]+@[\w.]+|evolako\.rs|e-mail/gi;

describe("the transliteration module", () => {
  // The file of evolako.rs (Evolako i18n v3, 13.10.2026) plus three exact-word exceptions the iOS app needed in KX —
  // Face, Optic, Store ("Face ID", "Optic ID", "App Store") — to be added on the site too. Its rules are never
  // changed here; another exception (KX, KP) goes to every copy — then this hash changes with it. The same file is
  // blokvolt-ios EvolakoKit/Sources/Domain/Resources/evo-cyr.mjs.
  it("is the site's module: the rules unchanged, the exceptions listed", () => {
    expect(createHash("sha256").update(read("src/i18n/evo-cyr.mjs")).digest("hex"))
      .toBe("6680ae064dafe1ae38b9db5e79cfb259a3e6559c9913223a9232bab4af0057d7");
  });

  it("writes Serbian in Cyrillic and keeps brands, units, codes and addresses", () => {
    expect(cyr("Tvoja tačka punjenja, obračuni i pretplata na jednom mestu")).toBe("Твоја тачка пуњења, обрачуни и претплата на једном месту");
    expect(cyr("Njujork, Ljubljana, džem, Đorđe")).toBe("Њујорк, Љубљана, џем, Ђорђе");
    expect(cyr("Moj Evolako")).toBe("Мој Evolako");
    expect(cyr("Wallbox 11 kW")).toBe("Wallbox 11 kW");
    expect(cyr("Piši nam na hello@evolako.com")).toBe("Пиши нам на hello@evolako.com");
    expect(cyr("Obračuni sa IPS QR kodom")).toBe("Обрачуни са IPS QR кодом");
    expect(cyr("Javićemo se u roku od 48 h.")).toBe("Јавићемо се у року од 48 h.");
    expect(cyr("Face ID pri otvaranju, Otvori App Store")).toBe("Face ID при отварању, Отвори App Store");
  });
});

describe("cyrText — format strings", () => {
  it("leaves every kind of placeholder as it is", () => {
    expect(cyrText("Obračun za %@ je spreman")).toBe("Обрачун за %@ је спреман");
    expect(cyrText("Probni period ističe za %lld dana")).toBe("Пробни период истиче за %lld дана");
    expect(cyrText("%2$@ — %1$@, %d dana, %s")).toBe("%2$@ — %1$@, %d дана, %s");
    expect(cyrText("%1$s i %2$s")).toBe("%1$s и %2$s");
    expect(cyrText("{name} je tu, {count} puta")).toBe("{name} је ту, {count} пута");
    expect(cyrText("%@%@")).toBe("%@%@");
  });

  it("keeps a unit after a placeholder, as after a number on the site", () => {
    expect(cyrText("do %lld A")).toBe("до %lld A");
    expect(cyrText("%@ kWh noću")).toBe("%@ kWh ноћу");
    expect(cyrText("16 A")).toBe(cyr("16 A"));
  });

  it("passes empty and non-Latin texts through", () => {
    expect(cyrText("")).toBe("");
    expect(cyrText("→ 12,50")).toBe("→ 12,50");
    expect(cyrValue({ one: "%lld mesec", few: "%lld meseca", other: "%lld meseci" }))
      .toEqual({ one: "%lld месец", few: "%lld месеца", other: "%lld месеци" });
  });
});

describe("the sr-Cyrl catalog", () => {
  it("is generated: every text equals the Serbian one transliterated", () => {
    expect(Object.keys(cyrillic)).toEqual(Object.keys(latin));
    for (const [key, entry] of Object.entries(catalog)) {
      expect(entry["sr-Cyrl"], key).toEqual(cyrValue(entry.sr));
      expect(cyrillic[key], key).toEqual(entry["sr-Cyrl"]);
    }
  });

  it("keeps placeholders, brands, units and codes exactly as in Serbian", () => {
    for (const [key, entry] of Object.entries(catalog)) {
      const from = texts(entry.sr);
      const to = texts(entry["sr-Cyrl"]);
      expect(to.length, key).toBe(from.length);
      from.forEach((text, i) => {
        expect(placeholders(to[i]!), key).toEqual(placeholders(text));
        expect(to[i]!.match(KEPT) ?? [], key).toEqual(text.match(KEPT) ?? []);
      });
    }
  });

  it("has no Latin left except what must stay Latin", () => {
    // Everything that stays Latin in the catalog, reviewed by eye on 13.10.2026; a new word here is a decision.
    // Google (13.10.2026, sign-in with Google): a brand, Latin like on Google's own Serbian pages.
    const allowed = /^(Evolako|Google|Wallbox|Viber|Excel|kWh|kW|RSD|EUR|USD|MID|IPS|QR|PDF|CSV|EVO|XXXXX|E|e|mail|hello|evolako|com|rs|h|webu|lld)$/;
    const left = new Set<string>();
    for (const value of Object.values(cyrillic)) {
      for (const text of texts(value)) {
        for (const word of text.replace(PLACEHOLDER, " ").match(/[A-Za-zČĆĐŠŽčćđšž]+/g) ?? []) if (!allowed.test(word)) left.add(word);
      }
    }
    expect([...left]).toEqual([]);
  });
});

describe("the language itself", () => {
  it("is offered second, after Serbian in Latin script", () => {
    expect(LANGS).toEqual(["sr", "sr-Cyrl", "en", "ru"]);
    expect(LANGS.map(langTitle)).toEqual(["Srpski (latinica)", "Српски (ћирилица)", "English", "Русский"]);
    expect(HTML_LANG["sr-Cyrl"]).toBe("sr-Cyrl");
  });

  it("is Serbian for the backend, the e-mails and the content", () => {
    expect(LANGS.map(contentLang)).toEqual(["sr", "sr", "en", "ru"]);
  });

  it("is read from a link in every spelling", () => {
    for (const value of ["sr-Cyrl", "sr-cyrl", "SR-CYRL", "cy", "CY", "cyr", "Cyr", " sr-Cyrl "]) expect(parseLang(value), value).toBe("sr-Cyrl");
    expect(parseLang("sr")).toBe("sr");
    expect(parseLang("sr-Latn")).toBe("sr");
    expect(parseLang("EN")).toBe("en");
    expect(parseLang("ru")).toBe("ru");
    for (const value of ["", "de", "sr-", "cyrl", "sr_Cyrl", null, undefined]) expect(parseLang(value), String(value)).toBeNull();
  });

  it("translates with the catalog and transliterates what is not in it", async () => {
    expect(inScript("Česta pitanja", "sr-Cyrl")).toBe("Česta pitanja"); // not loaded yet: Latin, never broken
    await loadLang("sr-Cyrl");
    expect(tIn("sr-Cyrl", "Nalog i podešavanja")).toBe("Налог и подешавања");
    expect(tIn("sr-Cyrl", "Obračun za %@ je spreman", "септембар 2026.")).toBe("Обрачун за септембар 2026. је спреман");
    expect(inScript("Wallbox u garaži zgrade", "sr-Cyrl")).toBe("Wallbox у гаражи зграде");
    expect(inScript("Wallbox u garaži zgrade", "sr")).toBe("Wallbox u garaži zgrade");
    expect(inScript("Wallbox in a building garage", "en")).toBe("Wallbox in a building garage");
  });

  it("writes dates in Cyrillic (sr-Cyrl-RS) and keeps Latin ones Latin (sr-Latn-RS)", () => {
    const day = new Date("2026-08-14T21:15:00Z"); // 23:15 in Belgrade
    expect(fullDate(day, "sr-Cyrl")).toBe("14. август 2026.");
    expect(fullDate(day, "sr")).toBe("14. avgust 2026.");
    expect(dayAndMonth(day, "sr-Cyrl")).toBe("14. авг");
    expect(weekdayAndDate(day, "sr-Cyrl")).toBe("петак, 14. август");
    expect(monthAndYear(2026, 9, "sr-Cyrl")).toBe("септембар 2026.");
    expect(monthAndYear(2026, 9, "sr")).toBe("septembar 2026.");
  });

  it("keeps hours Latin and writes minutes in Cyrillic, as the site does", () => {
    expect(duration(7 * 3600 + 12 * 60, "sr-Cyrl")).toBe(cyr("7 h 12 min"));
    expect(duration(48 * 60, "sr-Cyrl")).toBe("48 мин");
    expect(duration(48 * 60, "sr")).toBe("48 min");
  });
});

// The language choice (13.10.2026): the same drop-down as in the header of evolako.rs on the public pages, four
// languages everywhere — Srpski (latinica), Српски (ћирилица), English, Русский — and Serbian Cyrillic as a script of
// the Serbian texts: ?lang=sr-Cyrl from the site, <html lang="sr-Cyrl">, Cyrillic dates, and "sr" for the backend.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./mock-api";
import {
  chooseLang, expectAccessible, expectNoHorizontalOverflow, expectTouchTargets, openDemo, waitForAnimations, watchErrors,
} from "./helpers";


const TITLE = {
  sr: "Tvoja tačka punjenja, obračuni i pretplata na jednom mestu",
  "sr-Cyrl": "Твоја тачка пуњења, обрачуни и претплата на једном месту",
  en: "Your charging point, statements and subscription in one place",
  ru: "Твоя точка, отчёты и подписка в одном месте",
} as const;
const CODE = { sr: "SR", "sr-Cyrl": "СР", en: "EN", ru: "RU" } as const;
const HTML = { sr: "sr-Latn", "sr-Cyrl": "sr-Cyrl", en: "en", ru: "ru" } as const;
const LANGS = ["sr", "sr-Cyrl", "en", "ru"] as const;

const ISSUE = readFileSync(new URL("../fixtures/posta/test-2026-09-29.json", import.meta.url), "utf8");
/** The fixture issue as /posta/<slug>.json, as if it were published with the app (posta.spec.ts). */
async function serveIssue(page: Page) {
  await page.route("**/posta/test-2026-09-29.json", (route) => route.fulfill({ status: 200, contentType: "application/json", body: ISSUE }));
  await page.route("**/posta/test-2026-09-29.jpg", (route) => route.fulfill({ status: 404, body: "" }));
}

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("evo.lang"));

test.describe("the language menu of the public pages", () => {
  test("a button [globe · code · chevron] and a menu of four languages, the current one ticked", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/prijava");
    const button = page.getByTestId("lang-button");
    await expect(button).toHaveText("SR");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAccessibleName("Jezik: Srpski (latinica)");
    await expect(button.locator("svg")).toHaveCount(2);
    await expect(page.getByRole("menu")).toHaveCount(0);

    await button.click();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    const items = page.getByRole("menu", { name: "Jezik" }).getByRole("menuitemradio");
    await expect(items).toHaveText(["Srpskilatinica", "Српскићирилица", "English", "Русский"]);
    await expect(items.nth(0)).toHaveAttribute("aria-checked", "true");
    await expect(items.nth(0).locator("svg")).toHaveCount(1); // the tick
    await expect(items.nth(1).locator("svg")).toHaveCount(0);
    await expect(items.nth(1)).toHaveAttribute("lang", "sr-Cyrl");
    await expectAccessible(page, "language menu");
    await expectTouchTargets(page, "language menu");

    // Every language, there and back, without a reload.
    await items.nth(1).click();
    for (const lang of ["sr-Cyrl", "en", "ru", "sr", "sr-Cyrl", "sr"] as const) {
      if (lang !== "sr-Cyrl" || (await button.textContent()) !== CODE[lang]) await chooseLang(page, lang);
      await expect(h1(page)).toHaveText(TITLE[lang]);
      await expect(button).toHaveText(CODE[lang]);
      await expect(page.locator("html")).toHaveAttribute("lang", HTML[lang]);
      await expect(page.getByRole("menu")).toHaveCount(0);
      expect(await stored(page)).toBe(lang);
    }
    expect(errors).toEqual([]);
  });

  test("the code sits in the middle of its button in every language", async ({ page }) => {
    await page.goto("/prijava");
    const widths = new Set<number>();
    for (const lang of LANGS) {
      if (lang !== "sr") await chooseLang(page, lang);
      await waitForAnimations(page); // the chevron turns back
      const box = await page.getByTestId("lang-button").evaluate((el) => {
        const b = el.getBoundingClientRect();
        const kids = [...el.children].map((k) => k.getBoundingClientRect());
        const code = el.querySelector(".lang-btn__code")!;
        const range = document.createRange();
        range.selectNodeContents(code);
        const text = range.getBoundingClientRect();
        const c = code.getBoundingClientRect();
        return {
          width: b.width, height: b.height,
          left: kids[0]!.left - b.left, right: b.right - kids[kids.length - 1]!.right,
          top: text.top - b.top, bottom: b.bottom - text.bottom,
          codeLeft: text.left - c.left, codeRight: c.right - text.right,
        };
      });
      expect(Math.abs(box.left - box.right), `${lang}: the row is centred`).toBeLessThanOrEqual(1);
      expect(Math.abs(box.top - box.bottom), `${lang}: the code is centred vertically`).toBeLessThanOrEqual(2);
      expect(Math.abs(box.codeLeft - box.codeRight), `${lang}: the code is centred in its slot`).toBeLessThanOrEqual(1);
      expect(box.height).toBe(44);
      widths.add(Math.round(box.width));
    }
    expect(widths.size, "the button keeps its width").toBe(1);
  });

  test("keyboard: arrows, Home/End, Enter, Space and Escape", async ({ page }) => {
    await page.goto("/prijava");
    const button = page.getByTestId("lang-button");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("lang-sr")).toBeFocused(); // the menu opens on the current language
    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("lang-sr-Cyrl")).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByTestId("lang-ru")).toBeFocused();
    await page.keyboard.press("ArrowDown"); // wraps
    await expect(page.getByTestId("lang-sr")).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByTestId("lang-ru")).toBeFocused();
    await page.keyboard.press("Home");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(h1(page)).toHaveText(TITLE.sr);

    await page.keyboard.press("ArrowDown"); // also opens
    await expect(page.getByTestId("lang-sr")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(h1(page)).toHaveText(TITLE["sr-Cyrl"]);
    await expect(button).toBeFocused();

    await page.keyboard.press("Space");
    await expect(page.getByTestId("lang-sr-Cyrl")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    await expect(h1(page)).toHaveText(TITLE.en);
    await expect(page.getByRole("menu")).toHaveCount(0);
  });

  test("a click outside closes it; the theme menu next to it still works", async ({ page }) => {
    await page.goto("/prijava");
    await page.getByTestId("lang-button").click();
    await expect(page.getByTestId("lang-sr")).toBeFocused(); // the menu is open and listening
    await page.mouse.click(40, 500);
    await expect(page.getByRole("menu")).toHaveCount(0);
    await page.getByTestId("lang-button").click();
    await page.getByTestId("theme-button").click(); // the other menu: one at a time
    await expect(page.getByRole("menu")).toHaveCount(1);
    await page.getByTestId("theme-dark").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await chooseLang(page, "sr-Cyrl");
    await expect(h1(page)).toHaveText(TITLE["sr-Cyrl"]);
    await page.getByTestId("lang-button").click();
    await expectAccessible(page, "language menu, dark");
  });

  for (const width of [320, 360, 390]) {
    test(`on a ${width} px phone the menu stays inside the screen`, async ({ page }) => {
      await page.setViewportSize({ width, height: 780 });
      await serveIssue(page);
      for (const path of ["/prijava", "/demo", "/pismo", "/odjava", "/pismo/test-2026-09-29"]) {
        await page.goto(`${path}?lang=sr-Cyrl`);
        await page.getByTestId("lang-button").click();
        const box = (await page.getByRole("menu").boundingBox())!;
        expect(box.x, path).toBeGreaterThanOrEqual(8);
        expect(box.x + box.width, path).toBeLessThanOrEqual(width - 8);
        await expectNoHorizontalOverflow(page, `${path} ${width}`);
        await page.keyboard.press("Escape");
      }
    });
  }

  test("the same menu on every public page", async ({ page }) => {
    await serveIssue(page);
    for (const path of ["/prijava", "/demo", "/pismo", "/odjava", "/pismo/test-2026-09-29", "/nema-takve-strane"]) {
      await page.goto(path);
      await expect(page.getByTestId("lang-button"), path).toBeVisible();
      await expect(page.getByTestId("theme-button"), path).toBeVisible();
      await expect(page.locator(".lang-switch"), path).toHaveCount(0);
    }
  });
});

test.describe("Serbian Cyrillic", () => {
  test("?lang=sr-Cyrl from the site: applied before the first paint, remembered, taken out of the address", async ({ page }) => {
    await page.addInitScript(() => {
      document.addEventListener("DOMContentLoaded", () => {
        (window as unknown as { langAtLoad: string }).langAtLoad = document.documentElement.lang;
      });
    });
    await page.goto("/prijava?lang=sr-Cyrl&x=1");
    await expect(h1(page)).toHaveText(TITLE["sr-Cyrl"]);
    expect(await page.evaluate(() => (window as unknown as { langAtLoad: string }).langAtLoad)).toBe("sr-Cyrl");
    await expect(page).toHaveURL(/\/prijava\?x=1$/);
    expect(await stored(page)).toBe("sr-Cyrl");
    await page.reload();
    await expect(h1(page)).toHaveText(TITLE["sr-Cyrl"]);
    await expect(page).toHaveTitle("Пријава · Мој Evolako");

    for (const value of ["sr-cyrl", "SR-CYRL", "cy", "CY", "cyr", "Cyr"]) {
      await page.goto("/prijava?lang=sr");
      await expect(h1(page)).toHaveText(TITLE.sr);
      await page.goto(`/prijava?lang=${value}`);
      await expect(h1(page), value).toHaveText(TITLE["sr-Cyrl"]);
      await expect(page.locator("html")).toHaveAttribute("lang", "sr-Cyrl");
      expect(await stored(page), value).toBe("sr-Cyrl");
      await expect(page).toHaveURL(/\/prijava$/);
    }
    // Not a language: nothing changes.
    await page.goto("/prijava?lang=cyrl");
    await expect(h1(page)).toHaveText(TITLE["sr-Cyrl"]);
    await page.goto("/prijava?lang=sr-Latn");
    await expect(h1(page)).toHaveText(TITLE.sr);
  });

  test("brands, units and addresses stay Latin; links to the site carry lang=sr-Cyrl", async ({ page }) => {
    await page.goto("/prijava?lang=sr-Cyrl");
    const landing = page.getByTestId("landing");
    await expect(landing).toContainText("Мој Evolako");
    await expect(landing).toContainText("Исти налог као у апликацији Evolako — на рачунару, таблету или телефону.");
    await expect(landing).toContainText("Обрачуни са IPS QR кодом");
    await expect(landing).toContainText("Јавићемо се у року од 48 h.");
    await expect(page.getByTestId("landing-site")).toHaveAttribute("href", "https://www.evolako.rs/proveri-svoju-garazu?lang=sr-Cyrl");
    await expectAccessible(page, "landing sr-Cyrl");
    await chooseLang(page, "sr");
    await expect(page.getByTestId("landing-site")).toHaveAttribute("href", "https://www.evolako.rs/proveri-svoju-garazu?lang=sr");
  });

  test("the e-mail links: ?l=sr-Cyrl on /pismo and /odjava", async ({ page }) => {
    await mockApi(page);
    await page.goto("/pismo?t=tok_en_abcdefghijklmnop&l=sr-Cyrl");
    await expect(page.locator("html")).toHaveAttribute("lang", "sr-Cyrl");
    await expect(h1(page)).toHaveText("Потврди пријаву на Evolako писмо");
    await expect(page).toHaveURL(/\/pismo$/);
    expect(await stored(page)).toBe("sr-Cyrl");
    await expect(page.getByTestId("lang-button")).toHaveText("СР");
  });

  test("an issue of Evolako pismo: the Serbian issue in Cyrillic, links and addresses as they are", async ({ page }) => {
    await serveIssue(page);
    await page.goto("/pismo/test-2026-09-29?lang=sr");
    const latin = await page.getByTestId("pismo-issue").locator(".issue__body").innerText();
    const hrefs = await page.getByTestId("pismo-issue").locator(".issue__body a").evaluateAll((a) => a.map((x) => x.getAttribute("href")));
    await page.goto("/pismo/test-2026-09-29?lang=sr-Cyrl");
    const issue = page.getByTestId("pismo-issue");
    await expect(issue.locator(".issue__date")).toHaveText("29. септембар 2026.");
    await expect(issue.locator(".issue__signature")).toHaveText("Тим Evolako");
    const body = await issue.locator(".issue__body").innerText();
    expect(body).not.toBe(latin);
    expect(body).toMatch(/[а-яђјљњћџ]{4,}/);
    expect(await issue.locator(".issue__body a").evaluateAll((a) => a.map((x) => x.getAttribute("href")))).toEqual(hrefs);
    // What is a link or an address reads exactly as in the Latin issue.
    const linkTexts = await issue.locator(".issue__body a:not(.btn)").allInnerTexts();
    for (const text of linkTexts) expect(latin).toContain(text);
  });

  test("the cabinet: four languages in the settings, Cyrillic dates, dinars as always", async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page, "wallbox", "/profil/nalog");
    const radios = page.getByTestId("settings-lang").getByRole("radio");
    await expect(radios).toHaveText(["Srpski (latinica)", "Српски (ћирилица)", "English", "Русский"]);
    await expect(radios.nth(0)).toHaveAttribute("aria-checked", "true");
    await expectNoHorizontalOverflow(page, "nalog 390");
    await expectTouchTargets(page, "nalog 390");
    // Every option is as wide as the others and its text is centred.
    const boxes = await radios.evaluateAll((els) => els.map((el) => {
      const b = el.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(el);
      const t = range.getBoundingClientRect();
      return { width: Math.round(b.width), off: Math.abs((t.left - b.left) - (b.right - t.right)) };
    }));
    expect(new Set(boxes.map((b) => b.width)).size).toBe(1);
    for (const b of boxes) expect(b.off).toBeLessThanOrEqual(1);

    await radios.nth(1).click();
    await expect(h1(page)).toHaveText("Налог и подешавања");
    await expect(page.locator("html")).toHaveAttribute("lang", "sr-Cyrl");
    await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
    await expectAccessible(page, "nalog sr-Cyrl");
    await expectNoHorizontalOverflow(page, "nalog 390 sr-Cyrl");
    await page.reload();
    await expect(h1(page)).toHaveText("Налог и подешавања");

    await page.goto("/obracuni/2026-09");
    await expect(h1(page)).toHaveText("Септембар 2026.");
    await expect(page.getByTestId("part-service")).toContainText("990,00 RSD");
    await page.goto("/danas");
    await expect(page.getByTestId("live-session")).toContainText("kWh");
    await expectNoHorizontalOverflow(page, "danas 390 sr-Cyrl");
    await page.goto("/profil/pitanja");
    await expect(h1(page)).toHaveText("Честа питања");
    // The questions are found in either script.
    const all = await page.getByTestId("faq-item").count();
    await page.getByTestId("faq-search").fill("претплат");
    const cyrillic = await page.getByTestId("faq-item").count();
    await page.getByTestId("faq-search").fill("pretplat");
    expect(await page.getByTestId("faq-item").count()).toBe(cyrillic);
    expect(cyrillic).toBeGreaterThan(0);
    expect(cyrillic).toBeLessThan(all);
    expect(errors).toEqual([]);
  });

  test("the backend hears Serbian: the sign-in code is asked for with lang sr", async ({ page }) => {
    const log = await mockApi(page);
    await page.goto("/prijava?lang=sr-Cyrl");
    await page.getByTestId("signin-email").fill("mila@example.com");
    await page.getByTestId("signin-send").click();
    await expect(page.getByTestId("signin-code")).toBeFocused();
    const otp = log.find((r) => r.path === "/auth/v1/otp");
    expect(otp?.body).toEqual({ email: "mila@example.com", create_user: true, data: { lang: "sr" } });
  });
});

// Evolako pismo — /pismo/<slug>, the web version of an issue ("Otvori u pregledaču" in the e-mail): the backend's own
// fixture issue drawn in sr/en/ru (cover, date, title, every block type, the signature), links only to our sites, a
// cover that fails, "not found" for anything that is not an issue (a bad slug is not even fetched), offline with a retry,
// the dark theme and a demo session, public/posta/index.json as shipped (every entry valid), never indexed, no horizontal scroll 360–1440.
// The fixture lives in tests/fixtures/posta only and is served by the test; nothing of it ships with the app.
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow, expectTouchTargets, openDemo, watchErrors } from "./helpers";

type Lang = "sr" | "en" | "ru";
const LANGS: Lang[] = ["sr", "en", "ru"];

const SLUG = "test-2026-09-29";
const FIXTURES = new URL("../fixtures/posta/", import.meta.url);
const ISSUE_RAW = readFileSync(new URL(`${SLUG}.json`, FIXTURES), "utf8");
const COVER = readFileSync(new URL(`${SLUG}.jpg`, FIXTURES));
const ISSUE = JSON.parse(ISSUE_RAW) as Record<Lang, { subject: string; blocks: Array<Record<string, unknown>> }>
  & { cover: { alt: Record<Lang, string> } };

const TEXT = {
  sr: { kicker: "Evolako pismo", date: "29. septembar 2026.", signature: "Tim Evolako", notFound: "Ova stranica ne postoji.",
    offline: "Nema veze sa serverom. Proveri internet i pokušaj ponovo." },
  en: { kicker: "Evolako Letter", date: "September 29, 2026", signature: "The Evolako team", notFound: "This page doesn't exist.",
    offline: "Can't reach the server. Check your internet connection and try again." },
  ru: { kicker: "Письмо Evolako", date: "29 сентября 2026 г.", signature: "Команда Evolako", notFound: "Такой страницы нет.",
    offline: "Нет связи с сервером. Проверь интернет и попробуй ещё раз." },
} satisfies Record<Lang, Record<string, string>>;

/** Console noise of the failures the tests cause on purpose (a 404, a dropped connection). */
const expected = (e: string) => /Failed to load resource|ERR_INTERNET_DISCONNECTED/.test(e);

function heading(page: Page) {
  return page.getByRole("heading", { level: 1 });
}

async function check(page: Page, label: string) {
  await expectNoHorizontalOverflow(page, label);
  await expectAccessible(page, label);
}

/** The fixture issue as /posta/<slug>.json (and its cover), as if it were published with the app. */
async function serveIssue(page: Page, body: string = ISSUE_RAW) {
  await page.route(`**/posta/${SLUG}.json`, (route) => route.fulfill({ status: 200, contentType: "application/json", body }));
  await page.route(`**/posta/${SLUG}.jpg`, (route) => route.fulfill({ status: 200, contentType: "image/jpeg", body: COVER }));
}

test.describe("/pismo/<slug> — the web version of an issue", () => {
  for (const lang of LANGS) {
    test(`the fixture issue in ${lang}, at 390 and 1280 px`, async ({ page }) => {
      const x = TEXT[lang];
      const part = ISSUE[lang];
      const errors = watchErrors(page);
      await serveIssue(page);
      // No mockApi: the app's own config.json, the demo — an issue is a static file and works in any mode.
      await page.goto(`/pismo/${SLUG}?lang=${lang}`);
      const issue = page.getByTestId("pismo-issue");
      await expect(heading(page)).toHaveText(part.subject);
      await expect(page).toHaveTitle(`${part.subject} · ${x.kicker}`);
      await expect(issue.locator(".kicker")).toHaveText(x.kicker);
      await expect(issue.locator("time")).toHaveAttribute("datetime", "2026-09-29");
      await expect(issue.locator("time")).toHaveText(x.date);
      const cover = issue.locator(".issue__cover img");
      await expect(cover).toHaveAttribute("src", `/posta/${SLUG}.jpg`);
      await expect(cover).toHaveAttribute("alt", ISSUE.cover.alt[lang]);
      await expect.poll(() => cover.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

      // The blocks of the e-mail, in order.
      const texts = (i: number) => String(part.blocks[i]!.text);
      await expect(issue.locator("h2")).toHaveText([texts(0), texts(3)]);
      await expect(issue.locator(".issue__body > p").first()).toHaveText(texts(1).replace(/\*\*/g, ""));
      await expect(issue.locator(".issue__body > p strong").first()).toHaveText(/6 RSD/);
      await expect(issue.locator(".issue__list > li")).toHaveText(part.blocks[2]!.items as string[]);
      const steps = part.blocks[4]!.items as Array<{ title: string; text: string }>;
      await expect(issue.locator(".issue__steps > li .issue__step-title")).toHaveText(steps.map((s) => s.title));
      await expect(issue.locator(".issue__steps > li .issue__step-text")).toHaveText(steps.map((s) => s.text));
      const rows = part.blocks[5]!.rows as Array<[string, string]>;
      await expect(issue.locator(".issue__kv dt")).toHaveText(rows.map((r) => r[0]));
      await expect(issue.locator(".issue__kv dd")).toHaveText(rows.map((r) => r[1]));
      await expect(issue.locator(".issue__note")).toHaveText(texts(6));
      await expect(issue.locator(".issue__note a[href='mailto:hello@evolako.com']")).toHaveText("hello@evolako.com");
      const faq = issue.locator(".issue__note a[href='https://www.evolako.rs/cesta-pitanja']");
      await expect(faq).toHaveAttribute("target", "_blank");
      await expect(faq).toHaveAttribute("rel", "noopener noreferrer");
      await expect(issue.locator("hr.issue__divider")).toHaveCount(1);
      const button = issue.locator(".issue__button a");
      await expect(button).toHaveText(String(part.blocks[8]!.text));
      await expect(button).toHaveAttribute("href", "https://www.evolako.rs/proveri-svoju-garazu");
      await expect(button).toHaveAttribute("target", "_blank");
      await expect(issue.locator(".issue__signature")).toHaveText(x.signature);
      // Every link leads to our sites or our address.
      for (const href of await issue.locator("article a").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))) {
        expect(href).toMatch(/^(https:\/\/(www\.)?evolako\.rs\/|mailto:hello@evolako\.com$)/);
      }
      // A public page: no account navigation, whatever the session.
      await expect(page.locator(".tabbar, .sidebar")).toHaveCount(0);

      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await check(page, `issue ${lang} ${width}`);
      }
      expect(errors).toEqual([]);
    });
  }

  test("dark theme, and the same page inside a demo session", async ({ page }) => {
    await serveIssue(page);
    await openDemo(page, "wallbox", `/pismo/${SLUG}`, "dark");
    await expect(heading(page)).toHaveText(ISSUE.sr.subject);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator(".tabbar, .sidebar")).toHaveCount(0);
    await check(page, "issue dark");
  });

  test("links only to our sites: anything else stays text; Moj Evolako opens in the same tab", async ({ page }) => {
    const doc = JSON.parse(ISSUE_RAW);
    doc.sr.blocks[1].text = "Vidi https://example.com/deal, **https://app.evolako.rs/profil/nalog** i http://www.evolako.rs/x; piši na prodaja@example.com.";
    doc.sr.blocks[8].href = "https://evil.example/x";
    await serveIssue(page, JSON.stringify(doc));
    await page.goto(`/pismo/${SLUG}?lang=sr`);
    const issue = page.getByTestId("pismo-issue");
    const paragraph = issue.locator(".issue__body > p").first();
    await expect(paragraph).toHaveText("Vidi https://example.com/deal, https://app.evolako.rs/profil/nalog i http://www.evolako.rs/x; piši na prodaja@example.com.");
    await expect(paragraph.locator("a")).toHaveCount(1);
    const app = paragraph.locator("strong a");
    await expect(app).toHaveAttribute("href", "https://app.evolako.rs/profil/nalog");
    expect(await app.getAttribute("target")).toBeNull();
    // A button that would lead elsewhere keeps only its words.
    await expect(issue.locator(".issue__button")).toHaveCount(0);
    await expect(issue.getByText("Proveri svoju garažu", { exact: true })).toBeVisible();
    await expect(issue.locator("a[href*='example']")).toHaveCount(0);
  });

  test("a cover that does not load is left out", async ({ page }) => {
    await serveIssue(page);
    await page.route(`**/posta/${SLUG}.jpg`, (route) => route.fulfill({ status: 404, body: "" }));
    await page.goto(`/pismo/${SLUG}`);
    await expect(heading(page)).toHaveText(ISSUE.sr.subject);
    await expect(page.locator(".issue__cover")).toHaveCount(0);
  });

  test("no such issue: the app's 'not found' — a slug that cannot be one is not even fetched", async ({ page }) => {
    const errors = watchErrors(page);
    const fetched: string[] = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/posta/")) fetched.push(path);
    });
    const notFound = page.getByTestId("not-found");
    for (const path of ["/pismo/Test-2026", "/pismo/ab", "/pismo/2026_10", `/pismo/${"a".repeat(41)}`, "/pismo/%E0%A4%A",
      "/pismo/2026-10/x"]) {
      await page.goto(path);
      await expect(notFound, path).toBeVisible();
    }
    expect(fetched).toEqual([]);

    // No file: the server answers with the app itself (the SPA fallback, as on Pages).
    await page.goto("/pismo/nema-2099");
    await expect(notFound).toBeVisible();
    expect(fetched).toEqual(["/posta/nema-2099.json"]);
    await expect(heading(page)).toHaveText(TEXT.sr.notFound);
    await expect(page.getByTestId("not-found-home")).toHaveAttribute("href", "/");
    await check(page, "not found");

    // A 404, bad JSON, and a file that is not this issue.
    const bodies: Array<[number, string]> = [[404, "Not found"], [200, "{\"slug\": \"test-2026-09-29\","],
      [200, JSON.stringify({ ...JSON.parse(ISSUE_RAW), slug: "other" })], [200, JSON.stringify({ ...JSON.parse(ISSUE_RAW), ru: undefined })]];
    for (const [status, body] of bodies) {
      await page.unroute(`**/posta/${SLUG}.json`);
      await page.route(`**/posta/${SLUG}.json`, (route) => route.fulfill({ status, contentType: "application/json", body }));
      await page.goto(`/pismo/${SLUG}?lang=en`);
      await expect(notFound).toBeVisible();
      await expect(heading(page)).toHaveText(TEXT.en.notFound);
    }
    expect(errors.filter((e) => !expected(e))).toEqual([]);
  });

  test("no connection is not 'not found': the page offers another try", async ({ page }) => {
    let down = true;
    await page.route(`**/posta/${SLUG}.json`, (route) => (down ? route.abort("internetdisconnected")
      : route.fulfill({ status: 200, contentType: "application/json", body: ISSUE_RAW })));
    await page.goto(`/pismo/${SLUG}`);
    await expect(page.getByTestId("pismo-issue-error")).toBeVisible();
    await expect(page.getByTestId("pismo-issue-error")).toContainText(TEXT.sr.offline);
    await expect(page.getByTestId("not-found")).toHaveCount(0);
    await check(page, "issue offline");
    down = false;
    await page.getByTestId("pismo-issue-retry").click();
    await expect(heading(page)).toHaveText(ISSUE.sr.subject);
  });
});

test.describe("publishing and indexing", () => {
  test("posta/index.json ships valid and never cached stale; no test issue ships; never indexed", async ({ page, request }) => {
    const index = await request.get("/posta/index.json");
    expect(index.headers()["content-type"]).toContain("application/json");
    expect(index.headers()["cache-control"]).toBe("no-cache");
    expect(index.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    const text = await index.text();
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
    // Not emptiness (issues are published here), but that every entry is one the backend can act on.
    const doc = JSON.parse(text) as { issues: Array<Record<string, unknown>> };
    expect(Object.keys(doc)).toEqual(["issues"]);
    expect(Array.isArray(doc.issues)).toBe(true);
    const slugs = doc.issues.map((i) => i.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const issue of doc.issues) {
      expect(String(issue.slug), JSON.stringify(issue)).toMatch(/^[a-z0-9][a-z0-9-]{2,39}$/);
      expect(String(issue.slug)).not.toMatch(/test/);
      expect(["preview", "approved", "stopped"]).toContain(issue.status);
      if (issue.status === "approved") {
        expect(String(issue.approved_hash)).toMatch(/^[0-9a-f]{64}$/);
        expect(String(issue.send_at)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?([+-]\d{2}:\d{2}|Z)$/);
        expect(Number.isNaN(Date.parse(String(issue.send_at)))).toBe(false);
      }
      // The issue itself ships next to the index, as a JSON file with the same slug.
      const file = await request.get(`/posta/${String(issue.slug)}.json`);
      expect(file.headers()["content-type"]).toContain("application/json");
      expect((JSON.parse(await file.text()) as { slug: string }).slug).toBe(issue.slug);
    }
    // The fixture issue lives in tests/ only: on the site its address is just the app (the SPA fallback).
    expect((await request.get(`/posta/${SLUG}.json`)).headers()["content-type"]).toContain("text/html");

    expect((await request.get(`/pismo/${SLUG}`)).headers()["x-robots-tag"]).toBe("noindex, nofollow");
    await serveIssue(page);
    await page.goto(`/pismo/${SLUG}`);
    await expect(heading(page)).toHaveText(ISSUE.sr.subject);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
  });
});

test.describe("layout", () => {
  test("no horizontal scroll from 360 to 1440 px; 44 px touch targets", async ({ page }) => {
    await serveIssue(page);
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`/pismo/${SLUG}?lang=ru`);
      await expect(heading(page)).toHaveText(ISSUE.ru.subject);
      await expectNoHorizontalOverflow(page, `issue ${width}`);
      if (width === 390) await expectTouchTargets(page, "issue");

      await page.goto("/pismo/nema-2099");
      await expect(page.getByTestId("not-found")).toBeVisible();
      await expectNoHorizontalOverflow(page, `not found ${width}`);
      if (width === 390) await expectTouchTargets(page, "not found");
    }
  });
});

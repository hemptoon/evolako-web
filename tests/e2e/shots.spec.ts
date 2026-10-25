// Screenshots for the design review: npm run shots → ../shots/evolako next to the repo (or $SHOTS_DIR).
// Viewport-sized (390×844 phones, 1440×900 desktops) with a fixed Belgrade clock, like a person would see it.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, type Page } from "@playwright/test";
import { openDemo, waitForAnimations } from "./helpers";
import { fixture, GOOD_CODE, mockApi, type MockOptions } from "./mock-api";

const OUT = process.env.SHOTS_DIR ?? fileURLToPath(new URL("../../../shots/evolako/", import.meta.url));
mkdirSync(OUT, { recursive: true });

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  // Pictures show the finished state: the ring filled, cards faded in (the pulse dot keeps going, it is infinite).
  await waitForAnimations(page);
  await page.waitForTimeout(300);
  await waitForAnimations(page);
  // No focus rings or hover leftovers in the pictures.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

async function shoot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
}

test.describe.configure({ mode: "parallel" });

for (const theme of ["light", "dark"] as const) {
  for (const [label, size] of [["390", PHONE], ["1440", DESKTOP]] as const) {
    test(`landing ${label} ${theme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.addInitScript((t) => localStorage.setItem("evo.theme", t), theme);
      await page.goto("/prijava");
      await shoot(page, `landing-${label}-${theme}`);
    });

    test(`danas ${label} ${theme}`, async ({ page }) => {
      await page.setViewportSize(size);
      await openDemo(page, "wallbox", "/danas", theme);
      await page.getByTestId("live-session").waitFor();
      await shoot(page, `danas-${label}-${theme}`);
    });
  }
}

test("landing 390 light, live mode (dummy apiBase, mocked API)", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize(PHONE);
  await page.addInitScript(() => localStorage.setItem("evo.theme", "light"));
  await page.goto("/prijava");
  await page.getByTestId("signin").waitFor();
  await shoot(page, "landing-390-live");
});

test("demo chooser", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/demo");
  await shoot(page, "demo-chooser-1440-light");
  await page.setViewportSize(PHONE);
  await shoot(page, "demo-chooser-390-light");
});

test("statistika 1440 light, 390 dark", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openDemo(page, "wallbox", "/statistika");
  await page.getByTestId("session-row").first().waitFor();
  await shoot(page, "statistika-1440-light");
  await page.locator(".chart__hit").nth(23).hover();
  await page.getByTestId("chart-tooltip").waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "statistika-1440-light-tooltip.png") });
});

test("statistika 390 dark", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "wallbox", "/statistika", "dark");
  await page.getByTestId("session-row").first().waitFor();
  await shoot(page, "statistika-390-dark");
});

test("statement detail 1440 and 390, print PDF", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openDemo(page, "wallbox", "/obracuni/2026-09");
  await page.getByTestId("part-energy").waitFor();
  await shoot(page, "obracun-1440-light");
  await page.setViewportSize(PHONE);
  await shoot(page, "obracun-390-light");
  await page.getByTestId("part-energy").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await shoot(page, "obracun-390-light-payment");

  const dir = mkdtempSync(join(tmpdir(), "evo-shots-"));
  writeFileSync(join(dir, "statement.pdf"), await page.pdf({ preferCSSPageSize: true, printBackground: true }));
  execFileSync("pdftoppm", ["-r", "110", "-png", "-f", "1", "-l", "1", "-singlefile", join(dir, "statement.pdf"), join(OUT, "obracun-print-page1")]);
});

test("statement detail 390 light, a paid month (a record: no QR, no copy)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "wallbox", "/obracuni/2026-08");
  await page.getByTestId("part-energy-paid").waitFor();
  await shoot(page, "obracun-390-light-paid");
  await page.getByTestId("part-energy").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -80));
  await shoot(page, "obracun-390-light-paid-parts");
});

test("nalog 390 light, the consents (this device's last choice)", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "wallbox", "/profil/nalog");
  await page.getByTestId("consent-analytics-note").waitFor();
  await page.getByTestId("consent-marketing").scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 160));
  await shoot(page, "nalog-390-light-consents");
});

test("obračuni list", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openDemo(page, "wallbox", "/obracuni");
  await page.getByTestId("statement-row").first().waitFor();
  await shoot(page, "obracuni-1440-light");
});

for (const [name, path, ready] of [
  ["profil", "/profil", "point-card"],
  ["pozovi-komsiju", "/profil/pozovi-komsiju", "referral-code"],
  ["prijavi-kvar", "/profil/prijavi-kvar", "service-form"],
  ["nalog", "/profil/nalog", "account-email"],
  ["paketi", "/paketi", "package-start"],
  ["pretplata", "/profil/pretplata", "subscription-status"],
] as const) {
  test(`${name} 390`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "wallbox", path);
    await page.getByTestId(ready).first().waitFor();
    await shoot(page, `${name}-390-light`);
  });
}

test("alerts panel 390", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "wallbox", "/danas");
  await page.getByTestId("bell").click();
  await page.getByTestId("alerts-panel").waitFor();
  await shoot(page, "alerts-390-light");
});

test("moja prijava (lead) 390 and 1440", async ({ page }) => {
  await page.setViewportSize(PHONE);
  await openDemo(page, "lead", "/moja-prijava");
  await page.getByTestId("installation-card").waitFor();
  await shoot(page, "moja-prijava-390-light");
  await page.setViewportSize(DESKTOP);
  await shoot(page, "moja-prijava-1440-light");
});

for (const lang of ["en", "ru"] as const) {
  test(`danas and statement 390 ${lang}`, async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openDemo(page, "wallbox", `/danas?lang=${lang}`);
    await page.getByTestId("live-session").waitFor();
    await shoot(page, `danas-390-${lang}`);
    await page.goto("/obracuni/2026-09");
    await page.getByTestId("part-energy").waitFor();
    await shoot(page, `obracun-390-${lang}`);
  });
}

// Evolako pismo: the pages the e-mails link to (mocked API) and the web version of the backend's fixture issue.
const POSTA = new URL("../fixtures/posta/", import.meta.url);
const TOKEN = "Qx2mV7cN0pL4sT9wY1zA3bD5fG8hJ6kR2uE4iO7aS0d";

async function pismoPages(page: Page) {
  await mockApi(page, { newsletter: (body) => ({ status: 200, body: body.action === "confirm" ? { ok: true, status: "confirmed" } : { ok: true } }) });
  await page.route("**/posta/test-2026-09-29.json", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: readFileSync(new URL("test-2026-09-29.json", POSTA), "utf8") }));
  await page.route("**/posta/test-2026-09-29.jpg", (route) => route.fulfill({
    status: 200, contentType: "image/jpeg", body: readFileSync(new URL("test-2026-09-29.jpg", POSTA)) }));
}

for (const theme of ["light", "dark"] as const) {
  test(`evolako pismo 390 ${theme}: confirm, unsubscribe, the issue`, async ({ page }) => {
    await pismoPages(page);
    await page.setViewportSize(PHONE);
    await page.addInitScript((t) => localStorage.setItem("evo.theme", t), theme);
    await page.goto(`/pismo?t=${TOKEN}&l=sr`);
    await page.getByTestId("pismo-confirm").waitFor();
    await shoot(page, `pismo-390-${theme}`);
    await page.getByTestId("pismo-confirm").click();
    await page.locator('[data-state="confirmed"]').waitFor();
    await shoot(page, `pismo-confirmed-390-${theme}`);
    await page.goto("/odjava?e=mila.petrovic%2Bpismo%40example.com&t=0f3a9c2b7d1e4f6a8b0c2d4e6f8a0b1c&l=sr");
    await page.getByTestId("odjava-confirm").waitFor();
    await shoot(page, `odjava-390-${theme}`);
    await page.goto("/pismo/test-2026-09-29");
    await page.locator(".issue__signature").waitFor();
    await settle(page);
    await page.screenshot({ path: join(OUT, `pismo-issue-390-${theme}-full.png`), fullPage: true });
  });
}

test("evolako pismo 1440: the issue, and unsubscribe done", async ({ page }) => {
  await pismoPages(page);
  await page.setViewportSize(DESKTOP);
  await page.goto("/pismo/test-2026-09-29?lang=en");
  await page.locator(".issue__signature").waitFor();
  await shoot(page, "pismo-issue-1440-light");
  await page.goto("/odjava?e=mila.petrovic%2Bpismo%40example.com&t=0f3a9c2b7d1e4f6a8b0c2d4e6f8a0b1c&l=en");
  await page.getByTestId("odjava-confirm").click();
  await page.locator('[data-state="done"]').waitFor();
  await shoot(page, "odjava-done-1440-light");
});

// Display currency (VALUTA brief §4): the switch, Pretplata (kind A), Danas and Statistika (kind B) —
// SR/EN/RU × RSD/EUR, light and dark, phone. Into $SHOTS_DIR/valuta/.
for (const lang of ["sr", "en", "ru"] as const) {
  for (const cur of ["RSD", "EUR"] as const) {
    for (const theme of ["light", "dark"] as const) {
      test(`valuta ${lang} ${cur} ${theme}`, async ({ page }) => {
        mkdirSync(join(OUT, "valuta"), { recursive: true });
        await page.setViewportSize(PHONE);
        await page.addInitScript((c) => localStorage.setItem("evo:cur", c), cur);
        await openDemo(page, "wallbox", `/profil/nalog?lang=${lang}`, theme);
        await page.getByTestId("settings-currency").scrollIntoViewIfNeeded();
        await shoot(page, `valuta/nalog-${lang}-${cur}-${theme}`);
        for (const [path, wait, name] of [
          ["/profil/pretplata", "subscription-status", "pretplata"],
          ["/danas", "live-session", "danas"],
          ["/statistika", "stats-amount", "statistika"],
        ] as const) {
          await page.goto(path);
          await page.getByTestId(wait).waitFor();
          await shoot(page, `valuta/${name}-${lang}-${cur}-${theme}`);
        }
      });
    }
  }
}

// 1.14 (11.10.2026): meter readings by photo, the free period, a subscription on hold — SR/EN/RU, light and dark,
// phone. Into $SHOTS_DIR/ocitavanje/. A signed-in account on the mocked API (the contract fixtures).
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

async function signedIn(page: Page, path: string, theme: "light" | "dark", options: MockOptions, now: string) {
  await mockApi(page, options);
  await page.clock.setFixedTime(new Date(now));
  await page.addInitScript((t) => localStorage.setItem("evo.theme", t), theme);
  await page.goto(path);
  await page.getByTestId("signin-email").fill("mila@example.com");
  await page.getByTestId("signin-send").click();
  await page.getByTestId("signin-code").fill(GOOD_CODE);
  await page.locator("#page-title").first().waitFor();
}

const SEPTEMBER_READING = {
  required: true,
  lastAccepted: { valueKWh: 1310.2, readAt: "2026-09-30T19:00:00+02:00" },
  readings: [{ id: 7, valueKWh: 1310.2, readAt: "2026-09-30T19:00:00+02:00", month: { year: 2026, month: 9 }, status: "accepted" }],
};

for (const lang of ["sr", "en", "ru"] as const) {
  for (const theme of ["light", "dark"] as const) {
    test(`ocitavanje ${lang} ${theme}`, async ({ page }) => {
      mkdirSync(join(OUT, "ocitavanje"), { recursive: true });
      await page.setViewportSize(PHONE);
      await signedIn(page, `/ocitavanje?lang=${lang}`, theme, { readings: "fixture" }, "2026-10-12T10:00:00+02:00");
      await page.getByTestId("reading-form").waitFor();
      await shoot(page, `ocitavanje/forma-${lang}-${theme}`);
      await page.getByTestId("readings-list").scrollIntoViewIfNeeded();
      await shoot(page, `ocitavanje/istorija-${lang}-${theme}`);
      await page.getByTestId("reading-gallery-input").setInputFiles({ name: "brojilo.png", mimeType: "image/png", buffer: PIXEL });
      await page.getByTestId("reading-preview").waitFor();
      await page.getByTestId("reading-value").fill("2431,5");
      await page.getByTestId("reading-send").click();
      await page.getByTestId("reading-ask").scrollIntoViewIfNeeded();
      await shoot(page, `ocitavanje/provera-${lang}-${theme}`);
      await page.getByTestId("reading-send-anyway").click();
      await page.getByTestId("reading-sent").waitFor();
      await page.evaluate(() => window.scrollTo(0, 0));
      await shoot(page, `ocitavanje/poslato-${lang}-${theme}`);
    });

    test(`ocitavanje entries ${lang} ${theme}: Obračuni, the Danas card, Pretplata waiting and on hold`, async ({ page }) => {
      mkdirSync(join(OUT, "ocitavanje"), { recursive: true });
      await page.setViewportSize(PHONE);
      await signedIn(page, `/obracuni?lang=${lang}`, theme, { readings: SEPTEMBER_READING,
        subscription: fixture("subscription_pending.json") as Record<string, unknown> }, "2026-10-31T18:00:00+01:00");
      await page.getByTestId("readings-entry").waitFor();
      await shoot(page, `ocitavanje/obracuni-${lang}-${theme}`);
      await page.goto("/danas");
      await page.getByTestId("reading-card").waitFor();
      await shoot(page, `ocitavanje/danas-kartica-${lang}-${theme}`);
      await page.goto("/profil/pretplata");
      await page.getByTestId("trial-pending").waitFor();
      await shoot(page, `ocitavanje/pretplata-ceka-${lang}-${theme}`);
    });

    test(`pretplata on hold ${lang} ${theme}`, async ({ page }) => {
      mkdirSync(join(OUT, "ocitavanje"), { recursive: true });
      await page.setViewportSize(PHONE);
      await signedIn(page, `/profil/pretplata?lang=${lang}`, theme, { subscription: {
        state: { type: "active" }, startedAt: "2026-01-10T00:00:00+01:00", endsOn: null, history: [],
        activatedAt: "2026-01-10T12:00:00+01:00", suspendedSince: "2026-10-11T02:05:00+02:00",
        unpaid: { month: { year: 2026, month: 9 }, amountRSD: 990 } } }, "2026-10-12T10:00:00+02:00");
      await page.getByTestId("subscription-hold").waitFor();
      await shoot(page, `ocitavanje/pretplata-na-cekanju-${lang}-${theme}`);
    });
  }
}

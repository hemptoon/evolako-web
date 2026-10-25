// The demo end to end: landing → demo chooser → wallbox → every tab → a statement → copy → print to PDF;
// the lead demo; theme and language; no console errors, no CSP violations, no horizontal overflow, axe clean.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  chooseLang,
  DEMO_NOW, expectAccessible, expectNoHorizontalOverflow, expectTouchTargets, openDemo, waitForAnimations, watchErrors,
} from "./helpers";

test.describe("demo — wallbox", () => {
  test("landing → demo → all tabs → statement → copy → PDF", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium");
    const errors = watchErrors(page);
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.clock.setFixedTime(DEMO_NOW);
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.goto("/");
    await expect(page).toHaveURL(/\/prijava$/);
    await expect(page.getByTestId("landing")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tvoja tačka punjenja");
    await expectAccessible(page, "landing");

    await page.getByTestId("landing-demo").first().click();
    await expect(page).toHaveURL(/\/demo$/);
    await expectAccessible(page, "demo chooser");
    await page.getByTestId("demo-wallbox").click();

    await expect(page).toHaveURL(/\/danas$/);
    await expect(page.getByTestId("live-session")).toBeVisible();
    await expect(page.getByTestId("live-session")).toContainText("kW");
    await expect(page.getByTestId("demo-badge")).toBeVisible();
    await expectAccessible(page, "danas");

    await page.getByTestId("side-nav-statistika").click();
    await expect(page.getByTestId("statistika")).toBeVisible();
    await expect(page.getByTestId("session-row").first()).toBeVisible();
    await expectAccessible(page, "statistika");

    await page.getByTestId("side-nav-obracuni").click();
    await expect(page.getByTestId("statement-row")).toHaveCount(4);
    await page.getByTestId("statement-row").first().click();
    await expect(page).toHaveURL(/\/obracuni\/2026-09$/);
    await expect(page.getByTestId("part-energy")).toBeVisible();
    await expect(page.getByTestId("part-service")).toBeVisible();
    await expect(page.getByTestId("qr-demo").first()).toHaveText("DEMO — ne plaćaj");
    await expect(page.getByTestId("demo-example").first()).toHaveText("Primer");
    await expect(page.getByTestId("due-date")).toContainText("15. oktobar 2026.");
    await expectAccessible(page, "statement");

    // Copy: one field and the whole payment.
    await page.getByTestId("part-energy-account-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("160000000000000173");
    await page.getByTestId("part-energy-copy-all").click();
    const all = await page.evaluate(() => navigator.clipboard.readText());
    expect(all).toContain("Primalac: SZ Bulevar oslobođenja 12, Novi Sad");
    expect(all).toContain("Model: 97");
    expect(all).toContain("Svrha plaćanja: PRIMER - ne placaj");

    // "Sačuvaj PDF": the print document on A4.
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    const dir = mkdtempSync(join(tmpdir(), "evo-pdf-"));
    writeFileSync(join(dir, "statement.pdf"), pdf);
    const info = execFileSync("pdfinfo", [join(dir, "statement.pdf")]).toString();
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(1);
    expect(pages).toBeLessThanOrEqual(3);
    expect(/Page size:\s+59\d(\.\d+)? x 84\d(\.\d+)? pts \(A4\)/.test(info), info).toBe(true);
    const text = execFileSync("pdftotext", ["-layout", join(dir, "statement.pdf"), "-"]).toString();
    expect(text).toContain("Obračun");
    expect(text).toContain("DEMO — ne plaćaj");
    expect(text).toContain("Struju ne prodajemo — merimo je.");
    expect(readFileSync(join(dir, "statement.pdf")).subarray(0, 4).toString()).toBe("%PDF");

    await page.getByTestId("side-nav-profil").click();
    await expect(page.getByTestId("profil")).toBeVisible();
    await expectAccessible(page, "profil");

    expect(errors).toEqual([]);
  });

  test("session drawer, tag, CSV export", async ({ page }) => {
    const errors = watchErrors(page);
    await openDemo(page, "wallbox", "/statistika");
    await page.getByTestId("period").getByRole("radio", { name: "Godina" }).click();
    await expect(page.getByTestId("stats-chart")).toBeVisible();

    await page.locator('[data-testid="session-row"] .session-row__main').first().click();
    await expect(page).toHaveURL(/sesija=/);
    const drawer = page.getByTestId("session-drawer");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("radio", { name: "Službeno" }).click();
    await expect(page.locator(".toast")).toContainText("Sačuvano");
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(page).not.toHaveURL(/sesija=/);

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
    expect(download.suggestedFilename()).toMatch(/^evolako-sesije-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = readFileSync((await download.path())!, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split("\r\n")[0]).toBe("Datum;Početak;Kraj;kWh noć;kWh dan;RSD;Oznaka");
    expect(csv).toMatch(/\r\n\d{4}-\d{2}-\d{2};\d{2}:\d{2};\d{2}:\d{2};\d+,\d{2};\d+,\d{2};\d+,\d{2};/);
    expect(errors).toEqual([]);
  });

  test("chart tooltips follow the keyboard", async ({ page }) => {
    await openDemo(page, "wallbox", "/statistika");
    const plot = page.locator(".chart__plot");
    await plot.focus();
    await expect(page.getByTestId("chart-tooltip")).toBeVisible();
    const first = await page.getByTestId("chart-tooltip").textContent();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("chart-tooltip")).not.toHaveText(first ?? "");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("chart-tooltip")).toBeHidden();
  });

  test("schedule saves itself", async ({ page }) => {
    await openDemo(page, "wallbox", "/danas");
    await page.getByTestId("schedule-card").click();
    const drawer = page.getByTestId("schedule-drawer");
    await expect(drawer).toBeVisible();
    await drawer.getByTestId("schedule-start-plus").click();
    await expect(drawer.getByTestId("schedule-status")).toContainText("Sačuvano");
    await expect(drawer.getByTestId("schedule-start")).toHaveValue(String(23 * 60 + 15));
  });

  test("Danas ring: the power now against the point's 11 kW, filled after the entrance", async ({ page }) => {
    await openDemo(page, "wallbox", "/danas");
    const live = page.getByTestId("live-session");
    await expect(live.getByTestId("ring-of")).toHaveText("od 11 kW");
    const kw = Number((await live.locator(".ring__value-text").textContent())!.replace(",", "."));
    expect(kw).toBeGreaterThan(10.5);
    expect(kw).toBeLessThanOrEqual(11);
    await waitForAnimations(page);
    const ring = live.getByTestId("ring-value");
    // 10,8 of 11 kW ≈ 98 % of the circle (pathLength 100); the dash is shorter by the two round caps (≈ 2,2).
    expect(Number(await ring.getAttribute("data-share"))).toBeCloseTo((kw / 11) * 100, 0);
    const drawn = await ring.evaluate((el) => getComputedStyle(el).strokeDasharray);
    expect(Number.parseFloat(drawn)).toBeCloseTo((kw / 11) * 100 - 2.17, 0);
    // The start (23:00, the night window opened) is an auto-start, 40 minutes before 23:40.
    await expect(live).toContainText("23:00");
    await expect(live).toContainText("40 min");
  });

  test("demo menu: charging, idle and fault are one switch", async ({ page }) => {
    const errors = watchErrors(page);
    await openDemo(page, "wallbox", "/danas");
    await expect(page.getByTestId("live-session")).toBeVisible();
    await page.getByTestId("demo-badge").click();
    const states = page.getByRole("menuitemradio");
    await expect(page.getByTestId("demo-state-live")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("demo-state-idle")).toHaveAttribute("aria-checked", "false");
    await expect(states).toHaveCount(6); // three demo accounts + three point states
    await page.getByTestId("demo-state-idle").click();
    await expect(page.getByTestId("hero-idle")).toBeVisible();
    await expect(page.getByTestId("live-session")).toHaveCount(0);
    await expect(page.getByTestId("fault-banner")).toHaveCount(0);
    await page.getByTestId("demo-badge").click();
    await expect(page.getByTestId("demo-state-idle")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("demo-state-fault").click();
    await expect(page.getByTestId("fault-banner")).toBeVisible();
    await page.getByTestId("demo-badge").click();
    await page.getByTestId("demo-state-live").click();
    await expect(page.getByTestId("live-session")).toBeVisible();
    await expect(page.getByTestId("fault-banner")).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("fault: banner and the report form", async ({ page }) => {
    const errors = watchErrors(page);
    await openDemo(page, "wallbox", "/danas");
    await page.getByTestId("demo-badge").click();
    await expect(page.getByTestId("demo-state-live")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("demo-state-fault").click();
    await expect(page.getByTestId("fault-banner")).toBeVisible();
    await page.getByTestId("report-fault").click();
    await expect(page).toHaveURL(/\/profil\/prijavi-kvar$/);
    await page.getByTestId("category-other").click();
    await page.getByTestId("service-send").click();
    await expect(page.getByTestId("form-error")).toContainText("Drugo");
    await page.getByTestId("service-comment").fill("Lampica treperi crveno.");
    await page.getByTestId("service-send").click();
    await expect(page.getByTestId("service-sent")).toContainText("Javićemo se u roku od 48 h.");
    await expectAccessible(page, "prijavi kvar");
    expect(errors).toEqual([]);
  });

  test("move request: one open at a time", async ({ page }) => {
    await openDemo(page, "wallbox", "/profil/selim-se");
    await expect(page.getByTestId("relocation-open")).toBeVisible();
    await expect(page.getByTestId("relocation-card")).toContainText("Primljeno");
  });

  test("subscription: pause needs a confirmation", async ({ page }) => {
    await openDemo(page, "wallbox", "/profil/pretplata");
    await page.getByTestId("subscription-pause").click();
    const dialog = page.getByTestId("pause-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("role", "alertdialog");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await page.getByTestId("subscription-pause").click();
    await page.getByTestId("pause-confirm").click();
    await expect(page.getByTestId("subscription-status")).toContainText("Pauzirana");
  });

  test("referral: code, copy, referrals", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openDemo(page, "wallbox", "/profil/pozovi-komsiju");
    const code = (await page.getByTestId("referral-code").textContent()) ?? "";
    expect(code).toMatch(/^EVO-[A-Z2-9]{5}$/);
    await page.getByTestId("referral-copy").click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(code);
    await expect(page.getByTestId("referral-row")).toHaveCount(2);
    await expectAccessible(page, "pozovi komšiju");
  });

  test("electricity prices are read-only on the building's meter", async ({ page }) => {
    await openDemo(page, "wallbox", "/profil/cene-struje");
    await expect(page.getByTestId("tariff-readonly")).toContainText("Cene unosimo po računu zgrade koji nam pošalješ");
    await expect(page.getByTestId("tariff-form")).toHaveCount(0);
  });
});

test.describe("demo — socket, own meter", () => {
  test("metering only, estimate prices can be replaced", async ({ page }) => {
    const errors = watchErrors(page);
    await openDemo(page, "socket", "/danas");
    await expect(page.getByTestId("hero-idle").or(page.getByTestId("live-session"))).toBeVisible();
    await page.goto("/obracuni");
    await page.getByTestId("statement-row").first().click();
    await expect(page.getByTestId("own-meter-note")).toBeVisible();
    await page.goto("/profil/cene-struje");
    await page.getByTestId("tariff-high").fill("20,1");
    await page.getByTestId("tariff-low").fill("25");
    await page.getByTestId("tariff-save").click();
    await expect(page.getByText("Niža tarifa ne može biti skuplja od više.")).toBeVisible();
    await page.getByTestId("tariff-low").fill("6,05");
    await page.getByTestId("tariff-save").click();
    await expect(page.getByTestId("tariff-source")).toContainText("Iznosi su po cenama iz tvog računa.");
    expect(errors).toEqual([]);
  });
});

test.describe("demo — lead", () => {
  test("Moja prijava shows the booked assessment", async ({ page }) => {
    const errors = watchErrors(page);
    await openDemo(page, "lead", "/");
    await expect(page).toHaveURL(/\/moja-prijava$/);
    await expect(page.getByTestId("installation-card")).toContainText("Procena zakazana");
    await expect(page.getByTestId("request-no")).toHaveText("Z-1042");
    await expect(page.getByTestId("request-detail")).toContainText("Procena je zakazana za");
    await expectAccessible(page, "moja prijava");
    await page.goto("/danas");
    await expect(page).toHaveURL(/\/moja-prijava$/);
    await page.goto("/paketi");
    // Paketi v2 (07.10.2026): WALLBOX "od 94.000" with its variants, "Još opcija", the basic installation (2 m).
    await expect(page.getByTestId("package-wallbox")).toContainText("od 94.000");
    await expect(page.getByTestId("package-wallbox")).toContainText("104.000");
    await expect(page.getByTestId("package-wallbox")).not.toContainText("CT senzor");
    await expect(page.getByTestId("package-start")).toContainText("39.000");
    for (const id of ["plus", "premium", "ugradnja"]) {
      await expect(page.getByTestId(`package-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId("package-plus")).toContainText("+10.000");
    await expect(page.getByTestId("standard-installation")).toContainText("2 m");
    await page.getByTestId("package-premium-request").click();
    await expect(page).toHaveURL(/\/zatrazi-procenu\?paket=premium$/);
    await expectAccessible(page, "paketi");
    expect(errors).toEqual([]);
  });

  test("exit the demo", async ({ page }) => {
    await openDemo(page, "lead", "/moja-prijava");
    await page.getByTestId("demo-badge").click();
    await page.getByTestId("demo-exit").click();
    await expect(page).toHaveURL(/\/prijava$/);
    expect(await page.evaluate(() => localStorage.getItem("evo.demo"))).toBeNull();
  });
});

test.describe("account settings", () => {
  test("the consent switches say they show this device's last choice, not the account's", async ({ page }) => {
    await openDemo(page, "wallbox", "/profil/nalog");
    for (const id of ["consent-marketing", "consent-analytics"]) {
      const note = page.getByTestId(`${id}-note`);
      await expect(note).toHaveText("Poslednji izbor sa ovog uređaja");
      const noteId = await note.getAttribute("id");
      expect(await page.getByTestId(id).getAttribute("aria-describedby")).toContain(noteId!);
    }
    await page.getByTestId("settings-lang").getByRole("radio", { name: "English" }).click();
    await expect(page.getByTestId("consent-marketing-note")).toHaveText("Your last choice on this device");
    await expectAccessible(page, "nalog");
  });
});

test.describe("appearance and language", () => {
  test("theme: dark and system, persisted", async ({ page }) => {
    await page.goto("/prijava");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByTestId("theme-button").click();
    await page.getByTestId("theme-dark").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expectAccessible(page, "landing dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.getByTestId("theme-button").click();
    await page.getByTestId("theme-system").click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });

  test("language: switch, persisted, and ?lang=", async ({ page }) => {
    await page.goto("/prijava");
    await chooseLang(page, "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Your charging point, statements and subscription in one place");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Your charging point");
    await page.goto("/prijava?lang=ru");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Твоя точка");
    await expect(page.locator("html")).toHaveAttribute("lang", "ru");
    await chooseLang(page, "sr");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Tvoja tačka punjenja");
  });

  test("money stays Serbian in English; units follow the language", async ({ page }) => {
    await openDemo(page, "wallbox", "/obracuni/2026-09?lang=en");
    await expect(page.getByTestId("part-service")).toContainText("990,00 RSD");
    await openDemo(page, "wallbox", "/danas?lang=ru");
    await expect(page.getByTestId("live-session")).toContainText("кВт·ч");
  });
});

test.describe("layout", () => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    test(`no horizontal scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.clock.setFixedTime(DEMO_NOW);
      await page.goto("/prijava");
      await expectNoHorizontalOverflow(page, "prijava");
      await page.goto("/demo");
      await expectNoHorizontalOverflow(page, "demo");
      await openDemo(page, "wallbox", "/danas");
      for (const path of ["/danas", "/statistika", "/obracuni", "/obracuni/2026-09", "/profil", "/profil/pozovi-komsiju",
        "/profil/prijavi-kvar", "/profil/nalog", "/profil/pitanja", "/paketi"]) {
        await page.goto(path);
        await page.locator("#page-title").first().waitFor();
        await page.waitForTimeout(250);
        await expectNoHorizontalOverflow(page, path);
      }
    });
  }

  test("touch targets are at least 44 px", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page, "wallbox", "/danas");
    for (const path of ["/danas", "/statistika", "/obracuni/2026-09", "/profil", "/profil/nalog", "/profil/prijavi-kvar", "/paketi"]) {
      await page.goto(path);
      await page.locator("#page-title").first().waitFor();
      await page.waitForTimeout(300);
      await expectTouchTargets(page, path);
    }
  });

  test("tab bar on phones, sidebar on desktop", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openDemo(page, "wallbox", "/danas");
    await expect(page.locator(".tabbar")).toBeVisible();
    await expect(page.locator(".sidebar")).toBeHidden();
    await page.getByTestId("tab-nav-obracuni").click();
    await expect(page).toHaveURL(/\/obracuni$/);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator(".tabbar")).toBeHidden();
    await expect(page.locator(".sidebar")).toBeVisible();
  });

  test("keyboard: skip link, focus moves to the new page title", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openDemo(page, "wallbox", "/danas");
    await page.keyboard.press("Tab");
    await expect(page.locator(".skip-link")).toBeFocused();
    await page.getByTestId("side-nav-statistika").click();
    await expect(page.locator("#page-title")).toBeFocused();
  });
});

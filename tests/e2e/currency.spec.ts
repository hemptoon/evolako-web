// Display currency (docs/VALUTA_SPEC_2026-10-06.md): RSD by default with the page as before, the switch in Nalog
// redraws at once and survives a reload, the signed-in account's choice comes from the server and goes back with
// PATCH, the rate comes from the content document (or the fallback of 05.10.2026) — and nothing payable changes.
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow, openDemo, watchErrors } from "./helpers";
import { GOOD_CODE, mockApi } from "./mock-api";

const NOW = new Date("2026-09-25T06:40:00+02:00");
/** Normalises no-break spaces, so the expectations read like the spec. */
const plain = (s: string | null) => (s ?? "").replace(/ /g, " ");

async function chooseCurrency(page: Page, code: "RSD" | "EUR" | "USD") {
  await page.goto("/profil/nalog");
  const group = page.getByTestId("settings-currency");
  await group.getByRole("radio", { name: new RegExp(`^${code}`) }).click();
  await expect(group.getByRole("radio", { name: new RegExp(`^${code}`) })).toHaveAttribute("aria-checked", "true");
}

/** Payable text: the statement on screen and as printed. */
async function payableText(page: Page): Promise<string> {
  const screen = await page.getByTestId("part-energy").locator("xpath=ancestor::main").innerText();
  await page.emulateMedia({ media: "print" });
  const printed = await page.locator("body").innerText();
  await page.emulateMedia({ media: "screen" });
  return `${screen}\n${printed}`;
}

test.describe("display currency", () => {
  test("default RSD: nothing converted, no note; the switch shows RSD with the rate's date", async ({ page }) => {
    const errors = watchErrors(page);
    await openDemo(page, "wallbox", "/profil/pretplata");
    await expect(page.getByTestId("subscription-status")).toContainText("990 RSD");
    await expect(page.getByTestId("subscription-status")).not.toContainText("≈");
    await expect(page.getByTestId("fx-note")).toHaveCount(0);
    await page.goto("/profil/nalog");
    await expect(page.getByTestId("settings-currency").getByRole("radio", { name: /^RSD/ })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("fx-note")).toContainText("05.10.2026");
    expect(errors).toEqual([]);
  });

  test("EUR in Nalog → Pretplata «990 RSD · ≈ 8,43 €» at once; survives a reload; payments stay in dinars", async ({ page }) => {
    const errors = watchErrors(page);
    await openDemo(page, "wallbox", "/profil/nalog");
    await chooseCurrency(page, "EUR");
    await expectAccessible(page, "nalog EUR");
    await page.goto("/profil/pretplata");
    await expect(page.getByTestId("subscription-status")).toContainText(/990 RSD · ≈\s8,43\s€/);
    await expect(page.getByTestId("fx-note")).toContainText("Plaćaš uvek u dinarima");

    await page.reload();
    await expect(page.getByTestId("subscription-status")).toContainText(/990 RSD · ≈\s8,43\s€/);
    expect(await page.evaluate(() => localStorage.getItem("evo:cur"))).toBe("EUR");

    // Kind B: the chosen currency first, dinars muted next to it; tiles only converted.
    await page.goto("/danas");
    await expect(page.getByTestId("month-amount")).toContainText("€");
    await expect(page.getByTestId("live-cost")).toContainText(/≈\s[\d.,]+\s€ · [\d.]+ RSD/);
    await page.goto("/statistika");
    await expect(page.getByTestId("stats-amount")).toContainText("€");
    await expect(page.getByTestId("fx-note")).toBeVisible();

    // The statement: on screen and on paper only dinars, the IPS QR payload as with RSD.
    await page.goto("/obracuni/2026-09");
    await expect(page.getByTestId("part-energy")).toBeVisible();
    const text = await payableText(page);
    expect(text).toContain("RSD");
    expect(text).not.toMatch(/€|\$|\bEUR\b|\bUSD\b/);
    const qrEur = await page.getByTestId("ips-qr").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-payload")}|${e.querySelector("path")?.getAttribute("d")}`));

    await chooseCurrency(page, "RSD");
    await page.goto("/obracuni/2026-09");
    await expect(page.getByTestId("part-energy")).toBeVisible();
    const qrRsd = await page.getByTestId("ips-qr").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-payload")}|${e.querySelector("path")?.getAttribute("d")}`));
    expect(qrEur.length).toBeGreaterThan(0);
    expect(qrEur).toEqual(qrRsd);
    expect(errors).toEqual([]);
  });

  test("packages: the dinar price first, the conversion muted; USD", async ({ page }) => {
    await openDemo(page, "lead", "/profil/nalog");
    await chooseCurrency(page, "USD");
    await page.goto("/paketi");
    await expect(page.getByTestId("package-wallbox")).toContainText("od 94.000");
    expect(plain(await page.getByTestId("price-wallbox-converted").first().textContent())).toBe("od ≈ 895 $");
    expect(plain(await page.getByTestId("price-start-converted").first().textContent())).toBe("≈ 371 $");
    expect(plain(await page.getByTestId("price-zgrada-converted").first().textContent())).toMatch(/^od ≈ \d+ \$$/);
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalOverflow(page, `paketi ${width}`);
    }
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/profil/nalog");
    await expectNoHorizontalOverflow(page, "nalog 360");
  });

  test("signed in: the server's displayCurrency applies; a change is sent with PATCH", async ({ page }) => {
    const log = await mockApi(page, { displayCurrency: "USD" });
    await page.clock.setFixedTime(NOW);
    await page.goto("/prijava");
    await page.getByTestId("signin-email").fill("mila@example.com");
    await page.getByTestId("signin-send").click();
    await page.getByTestId("signin-code").fill(GOOD_CODE);
    await page.locator("#page-title").first().waitFor();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("evo:cur"))).toBe("USD");
    await page.goto("/profil/nalog");
    await expect(page.getByTestId("settings-currency").getByRole("radio", { name: /^USD/ })).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("settings-currency").getByRole("radio", { name: /^EUR/ }).click();
    await expect.poll(() => log.find((r) => r.method === "PATCH")?.body).toEqual({ display_currency: "EUR" });
    const patch = log.find((r) => r.method === "PATCH")!;
    expect(patch.path).toBe("/rest/v1/profiles?id=eq.aaaaaaaa-0000-4000-8000-000000000001");
    expect(patch.headers.authorization).toMatch(/^Bearer /);
    expect(patch.headers.prefer).toBe("return=minimal");
    // The next answer of the server carries the new value: it stays EUR.
    await page.reload();
    await page.locator("#page-title").first().waitFor();
    await expect(page.getByTestId("settings-currency").getByRole("radio", { name: /^EUR/ })).toHaveAttribute("aria-checked", "true");
  });

  test("the rate: a newer document from the server is used, with its date in the note", async ({ page }) => {
    await mockApi(page, { fx: { base: "RSD", source: "NBS srednji kurs", date: "2026-10-06",
      rates: { EUR: 117.2, USD: 100 }, fetchedAt: "2026-10-06T06:40:00Z", stale: false } });
    await page.goto("/prijava");
    await page.evaluate(() => localStorage.setItem("evo:cur", "USD"));
    await page.goto("/demo");
    await page.getByTestId("demo-wallbox").click();
    await expect(page).toHaveURL(/\/danas$/);
    await page.goto("/profil/pretplata");
    await expect(page.getByTestId("subscription-status")).toContainText(/990 RSD · ≈\s9,90\s\$/);
    await expect(page.getByTestId("fx-note")).toContainText("06.10.2026");
  });

  test("no rate (the server answers 503, nothing cached): the fallback and its date", async ({ page }) => {
    await mockApi(page, { fx: "down" });
    await page.goto("/prijava");
    await page.evaluate(() => localStorage.setItem("evo:cur", "EUR"));
    await page.goto("/demo");
    await page.getByTestId("demo-wallbox").click();
    await expect(page).toHaveURL(/\/danas$/);
    await page.goto("/profil/pretplata");
    await expect(page.getByTestId("subscription-status")).toContainText(/990 RSD · ≈\s8,43\s€/);
    await expect(page.getByTestId("fx-note")).toContainText("05.10.2026");
  });
});

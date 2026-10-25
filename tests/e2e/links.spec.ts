// Deep links: #podesavanja from the e-mail footer, ?lang= on any route, /obracuni/YYYY-MM, /prijava?email=,
// /zatrazi-procenu?ref=. Signed out they go through sign-in and come back; in the demo they open directly.
import { expect, test } from "@playwright/test";
import { DEMO_NOW, expectAccessible, openDemo, watchErrors } from "./helpers";
import { mockApi } from "./mock-api";

test.describe("deep links", () => {
  test("#podesavanja opens the account settings — after sign-in when signed out", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/#podesavanja");
    await expect(page).toHaveURL(/\/prijava\?next=%2Fprofil%2Fnalog$/);

    await openDemo(page, "wallbox", "/#podesavanja");
    await expect(page).toHaveURL(/\/profil\/nalog$/);
    await expect(page.getByTestId("nalog")).toBeVisible();
    // APP_LINK may carry a path; and a link clicked while the app is open in the tab works too.
    await page.goto("/app#podesavanja");
    await expect(page).toHaveURL(/\/profil\/nalog$/);
    await page.goto("/danas");
    await page.getByTestId("live-session").waitFor();
    await page.evaluate(() => {
      window.location.hash = "podesavanja";
    });
    await expect(page).toHaveURL(/\/profil\/nalog$/);
    await expect(page.getByTestId("nalog")).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("?lang= on any route: applied, remembered, and taken out of the address", async ({ page }) => {
    await openDemo(page, "wallbox", "/obracuni/2026-09?lang=en&x=1#top");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("September 2026");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveURL(/\/obracuni\/2026-09\?x=1#top$/);
    // A later switch in the app wins over the link: a reload does not bring English back.
    await page.goto("/profil/nalog?lang=RU");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Аккаунт и настройки");
    await page.getByTestId("settings-lang").getByRole("radio").first().click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nalog i podešavanja");
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nalog i podešavanja");
    // An unknown language changes nothing.
    await page.goto("/danas?lang=de");
    await expect(page.locator("html")).toHaveAttribute("lang", "sr-Latn");
  });

  test("/obracuni/YYYY-MM opens that statement; any other month key is not a statement", async ({ page }) => {
    await openDemo(page, "wallbox", "/obracuni/2026-08");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Avgust 2026.");
    await expect(page.getByTestId("part-energy")).toBeVisible();
    for (const path of ["/obracuni/2026-13", "/obracuni/2026-8", "/obracuni/2025-01"]) {
      await page.goto(path);
      await expect(page.getByTestId("statement-missing"), path).toBeVisible();
      await expect(page.getByTestId("statement-missing").getByRole("link", { name: "Obračuni" })).toBeVisible();
    }
    // Signed out: sign-in first, then back to the same statement.
    await page.evaluate(() => localStorage.clear());
    await page.goto("/obracuni/2026-09");
    await expect(page).toHaveURL(/\/prijava\?next=%2Fobracuni%2F2026-09$/);
  });

  test("/prijava?email= fills the sign-in address in and sends nothing by itself", async ({ page }) => {
    const log = await mockApi(page);
    await page.goto("/prijava?email=Mila%40Example.com&next=%2Fobracuni%2F2026-09");
    await expect(page.getByTestId("signin-email")).toHaveValue("mila@example.com");
    expect(log.filter((r) => r.path === "/auth/v1/otp")).toHaveLength(0);
    await page.getByTestId("signin-send").click();
    await expect(page.getByTestId("signin-code")).toBeFocused();
    expect(log.find((r) => r.path === "/auth/v1/otp")?.body).toMatchObject({ email: "mila@example.com" });
    await page.goto("/prijava?email=mila@");
    await expect(page.getByTestId("signin-email")).toHaveValue("");
  });

  test("/zatrazi-procenu?ref= fills a valid referral code in, and only a valid one", async ({ page }) => {
    await page.clock.setFixedTime(DEMO_NOW);
    await page.goto("/zatrazi-procenu?ref=EVO-K7PQ2");
    await expect(page).toHaveURL(/\/prijava\?next=%2Fzatrazi-procenu%3Fref%3DEVO-K7PQ2$/);

    await openDemo(page, "wallbox", "/zatrazi-procenu?ref=evo-k7pq2");
    await expect(page.getByTestId("request-referral")).toHaveValue("EVO-K7PQ2");
    await page.goto("/zatrazi-procenu?ref=EVO-K7PQ1&paket=wallbox");
    await expect(page.getByTestId("request-referral")).toHaveValue("");
  });
});

test.describe("robustness", () => {
  test("/obracuni/% (a malformed address) is simply not found — no crash", async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto("/obracuni/%");
    await expect(page).toHaveURL(/\/prijava\?next=%2Fobracuni%2F%25$/);
    await openDemo(page, "wallbox", "/obracuni/%");
    await expect(page.getByTestId("not-found")).toBeVisible();
    await expect(page.locator('[data-testid$="nav-danas"]:visible')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test("a screen that cannot load shows 'Nešto nije u redu' with Osveži; the rest of the app still works", async ({ page }) => {
    await openDemo(page, "wallbox", "/danas");
    // A new release removed the old chunk (or the network dropped it): the statement screen cannot load.
    await page.route(/\/assets\/Obracun-[\w-]+\.js$/, (route) => route.abort());
    await page.goto("/obracuni/2026-09");
    const error = page.getByTestId("app-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText("Nešto nije u redu");
    await expect(page.getByTestId("app-error-reload")).toHaveText("Osveži");
    await expectAccessible(page, "error screen");
    // Another screen gets its own chance: the navigation still works.
    await page.locator('[data-testid$="nav-danas"]:visible').click();
    await expect(page.getByTestId("live-session")).toBeVisible();
    await page.goBack();
    await expect(error).toBeVisible();
    await page.unroute(/\/assets\/Obracun-[\w-]+\.js$/);
    await page.getByTestId("app-error-reload").click();
    await expect(page.getByTestId("part-energy")).toBeVisible();
  });

  test("the error screen speaks English and Russian too", async ({ page }) => {
    await openDemo(page, "wallbox", "/danas?lang=ru");
    await page.route(/\/assets\/Obracun-[\w-]+\.js$/, (route) => route.abort());
    await page.goto("/obracuni/2026-09");
    await expect(page.getByTestId("app-error")).toContainText("Что-то пошло не так");
    await expect(page.getByTestId("app-error-reload")).toHaveText("Обновить");
  });
});

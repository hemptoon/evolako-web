// Sign-in with Google against a mocked API and a mocked Google: Google's account chooser is replaced by a route that
// answers the way Google does (a redirect back to /auth/google with the ID token in the fragment), so the whole way
// — the button, the address at Google, state and nonce, the token at Supabase, the account — runs in the browser.
import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { chooseLang, expectAccessible, expectTouchTargets, watchErrors } from "./helpers";
import { ACCESS, GOOGLE_CLIENT, KEY, mockApi, type MockOptions } from "./mock-api";

const ORIGIN = "http://127.0.0.1:4173";
const TOKEN = "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20ifQ.c2lnbmF0dXJl";
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Google, mocked: records the request and comes back the way `answer` says (the state is echoed as Google does). */
async function mockGoogle(page: Page, answer: (state: string) => string) {
  const seen: URL[] = [];
  await page.route("https://accounts.google.com/**", (route) => {
    const url = new URL(route.request().url());
    seen.push(url);
    return route.fulfill({ status: 302, headers: { location: `${ORIGIN}/auth/google#${answer(url.searchParams.get("state") ?? "")}` } });
  });
  return seen;
}

async function open(page: Page, options: MockOptions = {}) {
  const log = await mockApi(page, { google: { origins: [ORIGIN] }, ...options });
  await page.goto("/prijava");
  await expect(page.getByTestId("signin")).toBeVisible();
  return log;
}

test.describe("sign-in with Google (mocked Google and API)", () => {
  test("button → Google → back with the token → signed in; state, nonce and the token are checked and gone", async ({ page }) => {
    const errors = watchErrors(page);
    const log = await open(page);
    await expect(page.getByTestId("signin-google")).toBeVisible();
    await expect(page.getByTestId("signin-google")).toHaveText("Nastavi sa Google nalogom");
    await expectAccessible(page, "sign-in with Google button");
    await expectTouchTargets(page, "sign-in with Google button");

    const google = await mockGoogle(page, (state) => `state=${state}&id_token=${TOKEN}&authuser=0&prompt=consent`);
    await page.getByTestId("signin-google").click();
    await expect(page).toHaveURL(/\/(danas|moja-prijava)$/);

    // The address at Google: our client, our return, an ID token only, the e-mail only, Latin Serbian.
    expect(google).toHaveLength(1);
    const at = Object.fromEntries(google[0]!.searchParams);
    expect(at).toMatchObject({ client_id: GOOGLE_CLIENT, redirect_uri: `${ORIGIN}/auth/google`, response_type: "id_token",
      response_mode: "fragment", scope: "openid email", prompt: "select_account", hl: "sr-Latn" });
    expect(at.state).toMatch(/^[0-9a-f]{32}$/);
    expect(at.nonce).toMatch(/^[0-9a-f]{64}$/);

    // Supabase got the token and the raw nonce whose SHA-256 went to Google; the publishable key, no Bearer yet.
    const exchange = log.find((r) => r.path === "/auth/v1/token?grant_type=id_token");
    const sent = exchange?.body as { provider: string; id_token: string; nonce: string };
    expect(sent.provider).toBe("google");
    expect(sent.id_token).toBe(TOKEN);
    expect(sha256(sent.nonce)).toBe(at.nonce);
    expect(exchange?.headers.apikey).toBe(KEY);
    expect(exchange?.headers.authorization).toBeUndefined();

    // A new account gets the page's language (the token has none).
    const patch = log.find((r) => r.method === "PATCH" && r.path.startsWith("/rest/v1/profiles"));
    expect(patch?.body).toEqual({ lang: "sr" });
    expect(patch?.headers.authorization).toBe(`Bearer ${ACCESS}`);

    // Signed in like after a code; nothing of the sign-in is left behind.
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBe("refresh-token-g");
    expect(await page.evaluate(() => localStorage.getItem("evo.google"))).toBeNull();
    expect(page.url()).not.toContain("id_token");
    expect(await page.evaluate(() => history.length)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test("an account made earlier keeps its language; ?next= is honoured", async ({ page }) => {
    const log = await mockApi(page, { google: { origins: [ORIGIN] }, googleToken: "existing" });
    await page.goto("/obracuni/2026-09");
    await expect(page).toHaveURL(/\/prijava\?next=%2Fobracuni%2F2026-09$/);
    await mockGoogle(page, (state) => `state=${state}&id_token=${TOKEN}`);
    await page.getByTestId("signin-google").click();
    await expect(page).toHaveURL(/\/obracuni\/2026-09$/);
    expect(log.some((r) => r.method === "PATCH" && r.path.startsWith("/rest/v1/profiles"))).toBe(false);
  });

  test("English page: Google in English, the new account in English", async ({ page }) => {
    const log = await open(page);
    await chooseLang(page, "en");
    await expect(page.getByTestId("signin-google")).toHaveText("Continue with Google");
    const google = await mockGoogle(page, (state) => `state=${state}&id_token=${TOKEN}`);
    await page.getByTestId("signin-google").click();
    await expect(page).toHaveURL(/\/(danas|moja-prijava)$/);
    expect(google[0]!.searchParams.get("hl")).toBe("en");
    expect(log.find((r) => r.method === "PATCH" && r.path.startsWith("/rest/v1/profiles"))?.body).toEqual({ lang: "en" });
  });

  test("Cyrillic page: the button in Cyrillic, Google itself in Serbian (Cyrillic), the account's language sr", async ({ page }) => {
    const log = await open(page);
    await chooseLang(page, "sr-Cyrl");
    await expect(page.getByTestId("signin-google")).toHaveText("Настави са Google налогом");
    const google = await mockGoogle(page, (state) => `state=${state}&id_token=${TOKEN}`);
    await page.getByTestId("signin-google").click();
    await expect(page).toHaveURL(/\/(danas|moja-prijava)$/);
    expect(google[0]!.searchParams.get("hl")).toBe("sr");
    expect(log.find((r) => r.method === "PATCH" && r.path.startsWith("/rest/v1/profiles"))?.body).toEqual({ lang: "sr" });
  });

  test("Cancel at Google: back on the sign-in, no error, nobody signed in", async ({ page }) => {
    const log = await open(page);
    await mockGoogle(page, (state) => `error=access_denied&state=${state}`);
    await page.getByTestId("signin-google").click();
    await expect(page).toHaveURL(/\/prijava$/);
    await expect(page.getByTestId("signin")).toBeVisible();
    await expect(page.getByTestId("google-error")).toHaveCount(0);
    expect(log.some((r) => r.path.startsWith("/auth/v1/token"))).toBe(false);
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBeNull();
  });

  test("a return that is not ours (another state) never reaches Supabase and says so", async ({ page }) => {
    const log = await open(page);
    await mockGoogle(page, () => `state=${"0".repeat(32)}&id_token=${TOKEN}`);
    await page.getByTestId("signin-google").click();
    await expect(page).toHaveURL(/\/prijava$/);
    await expect(page.getByTestId("google-error")).toContainText("Prijava preko Google naloga nije uspela");
    expect(log.some((r) => r.path.startsWith("/auth/v1/token"))).toBe(false);
  });

  test("someone else's link to /auth/google#id_token=… signs nobody in", async ({ page }) => {
    const log = await mockApi(page, { google: { origins: [ORIGIN] } });
    await page.goto(`/auth/google#state=${"a".repeat(32)}&id_token=${TOKEN}`);
    await expect(page).toHaveURL(/\/prijava$/);
    await expect(page.getByTestId("google-error")).toBeVisible();
    expect(log.some((r) => r.path.startsWith("/auth/v1/token"))).toBe(false);
  });

  test("Supabase refuses the token: the error, and the e-mail code still works", async ({ page }) => {
    await open(page, { googleToken: "refused" });
    await mockGoogle(page, (state) => `state=${state}&id_token=${TOKEN}`);
    await page.getByTestId("signin-google").click();
    await expect(page.getByTestId("google-error")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBeNull();
    await page.getByTestId("signin-email").fill("mila@example.com");
    await page.getByTestId("signin-send").click();
    await expect(page.getByTestId("google-error")).toHaveCount(0);
    await expect(page.getByTestId("signin-code")).toBeFocused();
  });

  test("no button: kill switch off, this origin not registered, or no client in config.json", async ({ page }) => {
    await mockApi(page, { google: { origins: [ORIGIN] }, features: { googleLogin: false } });
    await page.goto("/prijava");
    await expect(page.getByTestId("signin")).toBeVisible();
    await page.waitForTimeout(500);
    await expect(page.getByTestId("signin-google")).toHaveCount(0);
  });

  test("no button on an origin Google would not send back to", async ({ page }) => {
    await mockApi(page, { google: { origins: ["https://app.evolako.rs"] } });
    await page.goto("/prijava");
    await expect(page.getByTestId("signin")).toBeVisible();
    await expect(page.getByTestId("signin-google")).toHaveCount(0);
  });

  test("no button without a client ID (config.json as built)", async ({ page }) => {
    await mockApi(page);
    await page.goto("/prijava");
    await expect(page.getByTestId("signin")).toBeVisible();
    await expect(page.getByTestId("signin-google")).toHaveCount(0);
  });

  test("phone width, dark theme: the button and the divider fit", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => localStorage.setItem("evo.theme", "dark"));
    await open(page);
    const button = page.getByTestId("signin-google");
    await expect(button).toBeVisible();
    const box = await button.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectAccessible(page, "Google button, dark, 390 px");
  });
});

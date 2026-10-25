// Sign-in against a mocked API (the real one is not deployed): e-mail code, a wrong code, rate limiting, the
// headers of every call, and the printed statement whose IPS QR must decode to the backend's payload exactly.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { expectAccessible, watchErrors } from "./helpers";
import { ACCESS, fixture, GOOD_CODE, KEY, mockApi } from "./mock-api";

const NOW = new Date("2026-09-25T06:40:00+02:00");

test.describe("sign-in by e-mail code (mocked API)", () => {
  test("wrong code, then the right one; every call carries apikey and Bearer", async ({ page }) => {
    const errors = watchErrors(page);
    const log = await mockApi(page);
    await page.clock.setFixedTime(NOW);
    await page.goto("/obracuni/2026-09");
    // Signed out: to the landing, remembering where to return.
    await expect(page).toHaveURL(/\/prijava\?next=%2Fobracuni%2F2026-09$/);
    await expect(page.getByTestId("signin")).toBeVisible();
    await expectAccessible(page, "sign-in");

    await page.getByTestId("signin-email").fill("mila@example.com");
    await page.getByTestId("signin-send").click();
    await expect(page.getByTestId("signin-code")).toBeFocused();
    await expect(page.getByTestId("signin-resend")).toBeDisabled();
    const otp = log.find((r) => r.path === "/auth/v1/otp");
    expect(otp?.body).toEqual({ email: "mila@example.com", create_user: true, data: { lang: "sr" } });
    expect(otp?.headers.apikey).toBe(KEY);
    expect(otp?.headers.authorization).toBeUndefined();

    await page.getByTestId("signin-code").fill("000000");
    await expect(page.getByTestId("signin").locator(".field__error")).toContainText("Kod nije tačan ili je istekao");

    await page.getByTestId("signin-code").fill(GOOD_CODE);
    await expect(page).toHaveURL(/\/obracuni\/2026-09$/);
    await expect(page.getByTestId("part-energy")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBe("refresh-token-1");
    // The access token lives in memory only.
    expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(ACCESS);

    const rpcs = log.filter((r) => r.path.startsWith("/rest/v1/rpc/"));
    expect(rpcs.length).toBeGreaterThan(0);
    for (const r of rpcs) {
      expect(r.method).toBe("POST");
      expect(r.headers.apikey).toBe(KEY);
      expect(r.headers.authorization).toBe(`Bearer ${ACCESS}`);
    }
    const statementCall = rpcs.find((r) => r.path === "/rest/v1/rpc/api_statement");
    expect(statementCall?.body).toEqual({ p_id: "9efd2948-b5ec-465e-bc8a-efa6bb8e4aa5", p_year: 2026, p_month: 9 });
    expect(errors.filter((e) => !e.includes("403"))).toEqual([]);
  });

  test("live landing: sign in with the request's e-mail; no 'we open your account' note", async ({ page }) => {
    await mockApi(page);
    await page.goto("/prijava");
    const card = page.getByTestId("signin");
    await expect(card.getByTestId("signin-lead")).toHaveText(
      "Prijavi se istom e-poštom kao u zahtevu za procenu. Ovde pratiš status procene i ugradnje, a kad je komplet ugrađen — obračune i punjenje.");
    await expect(card).toContainText("Prijava kodom na e-poštu — bez lozinke.");
    await expect(page.getByTestId("landing")).not.toContainText("Nalog otvaramo mi");
    await expect(page.getByTestId("landing")).not.toContainText("stiže uskoro");
    await expect(page.getByTestId("landing-demo")).toBeVisible(); // demo: true next to a live API
    await page.goto("/prijava?lang=en");
    await expect(card.getByTestId("signin-lead")).toContainText("Sign in with the same email as in your assessment request.");
    await page.goto("/prijava?lang=ru");
    await expect(card.getByTestId("signin-lead")).toContainText("Войди с той же почтой, что и в заявке на оценку.");
    await expectAccessible(page, "live landing ru");
  });

  test("demo-only landing keeps the 'coming soon' copy", async ({ page }) => {
    await page.goto("/prijava");
    const soon = page.getByTestId("signin-soon");
    await expect(soon).toContainText("Prijava na webu stiže uskoro. Do tada pogledaj demo.");
    await expect(soon).toContainText("Nalog otvaramo mi, posle ugradnje kompleta.");
    await expect(page.getByTestId("signin")).toHaveCount(0);
    await expect(page.getByTestId("signin-lead")).toHaveCount(0);
  });

  test("429 on sending the code is explained in words", async ({ page }) => {
    await mockApi(page, { rateLimited: ["ana@example.com"] });
    await page.goto("/prijava");
    await page.getByTestId("signin-email").fill("ana@example.com");
    await page.getByTestId("signin-send").click();
    await expect(page.getByTestId("signin").locator(".field__error")).toContainText("Previše pokušaja");
    await expect(page.getByTestId("signin-code")).toHaveCount(0);
  });

  test("an invalid e-mail never reaches the server", async ({ page }) => {
    const log = await mockApi(page);
    await page.goto("/prijava");
    await page.getByTestId("signin-email").fill("mila@");
    await page.getByTestId("signin-send").click();
    await expect(page.getByTestId("signin").locator(".field__error")).toContainText("Proveri adresu e-pošte.");
    expect(log.filter((r) => r.path === "/auth/v1/otp")).toHaveLength(0);
  });

  test("printed statement: the IPS QR decodes to the backend payload byte for byte", async ({ page }) => {
    // An issued (unpaid) month: only then is there a QR to scan.
    await mockApi(page, { statementStatus: "issued" });
    await page.clock.setFixedTime(NOW);
    await page.goto("/prijava");
    await page.getByTestId("signin-email").fill("mila@example.com");
    await page.getByTestId("signin-send").click();
    await page.getByTestId("signin-code").fill(GOOD_CODE);
    await expect(page).toHaveURL(/\/danas$/);
    await page.goto("/obracuni/2026-09");
    await expect(page.getByTestId("part-energy")).toBeVisible();
    // No demo marks on a real statement.
    await expect(page.getByTestId("qr-demo")).toHaveCount(0);
    // The trial subscription part is 0 RSD with no QR.
    await expect(page.getByTestId("part-service")).toContainText("Prva 2 meseca — 0 RSD");

    const dir = mkdtempSync(join(tmpdir(), "evo-print-"));
    writeFileSync(join(dir, "statement.pdf"), await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    const pages = Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [join(dir, "statement.pdf")]).toString())?.[1]);
    expect(pages).toBe(1);
    execFileSync("pdftoppm", ["-r", "200", "-png", "-f", "1", "-l", "1", join(dir, "statement.pdf"), join(dir, "page")]);
    const png = PNG.sync.read(readFileSync(join(dir, "page-1.png")));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    const expected = (fixture("statement_2026_09.json") as { energyPart: { qrPayload: string } }).energyPart.qrPayload;
    expect(decoded?.data).toBe(expected);
  });

  test("a paid statement is a record: no QR, no copy, the details as text — on screen and on paper", async ({ page }) => {
    await mockApi(page); // statement_2026_09.json is paid
    await page.clock.setFixedTime(NOW);
    await page.goto("/prijava");
    await page.getByTestId("signin-email").fill("mila@example.com");
    await page.getByTestId("signin-send").click();
    await page.getByTestId("signin-code").fill(GOOD_CODE);
    await expect(page).toHaveURL(/\/danas$/);
    await page.goto("/obracuni/2026-09");
    const energy = page.getByTestId("part-energy");
    await expect(energy).toBeVisible();
    await expect(page.getByTestId("statement-summary")).toContainText("Plaćeno");
    await expect(page.getByTestId("statement-summary")).toContainText("Iznos");
    await expect(page.getByTestId("statement-summary")).not.toContainText("Za uplatu");
    await expect(page.getByTestId("due-date")).toHaveCount(0);
    await expect(page.getByTestId("ips-qr")).toHaveCount(0);
    await expect(page.getByTestId("part-energy-copy-all")).toHaveCount(0);
    await expect(energy.locator(".copy-btn")).toHaveCount(0);
    await expect(page.getByTestId("part-energy-paid")).toContainText("samo radi evidencije");
    // The details stay readable, as plain text.
    await expect(page.getByTestId("part-energy-account")).toContainText("160-0000000000001-73");
    await expect(page.getByTestId("part-energy-poziv")).toBeVisible();
    await expect(page.getByTestId("part-energy-amount")).toContainText("310,62 RSD");
    await expectAccessible(page, "paid statement");

    const dir = mkdtempSync(join(tmpdir(), "evo-paid-"));
    writeFileSync(join(dir, "statement.pdf"), await page.pdf({ preferCSSPageSize: true, printBackground: true }));
    const text = execFileSync("pdftotext", ["-layout", join(dir, "statement.pdf"), "-"]).toString();
    expect(text).toContain("Plaćeno. Podaci za uplatu ostaju ovde samo radi evidencije.");
    expect(text).not.toContain("Za uplatu");
    expect(text).not.toContain("IPS QR");
    execFileSync("pdftoppm", ["-r", "200", "-png", "-f", "1", "-l", "1", join(dir, "statement.pdf"), join(dir, "page")]);
    const png = PNG.sync.read(readFileSync(join(dir, "page-1.png")));
    expect(jsQR(new Uint8ClampedArray(png.data), png.width, png.height)).toBeNull();
  });

  test("sign-out ends only this browser's session on the server and forgets the tokens", async ({ page }) => {
    const log = await mockApi(page);
    await page.clock.setFixedTime(NOW);
    await page.goto("/prijava");
    await page.getByTestId("signin-email").fill("mila@example.com");
    await page.getByTestId("signin-send").click();
    await page.getByTestId("signin-code").fill(GOOD_CODE);
    await expect(page).toHaveURL(/\/danas$/);
    await page.goto("/profil");
    await page.getByTestId("sign-out").click();
    await expect(page).toHaveURL(/\/prijava$/);
    await expect.poll(() => log.filter((r) => r.path.startsWith("/auth/v1/logout")).map((r) => r.path)).toEqual(["/auth/v1/logout?scope=local"]);
    // The reload on the way to /profil refreshed the session: the logout carries the newest access token.
    const logout = log.find((r) => r.path.startsWith("/auth/v1/logout"))!;
    expect(logout.headers.authorization).toBe("Bearer access-token-2");
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBeNull();
    await page.reload();
    await expect(page.getByTestId("signin")).toBeVisible();
  });

  test("sign-out and account deletion forget this browser's account data and rotate the install id", async ({ page }) => {
    const log = await mockApi(page);
    await page.clock.setFixedTime(NOW);
    const signIn = async () => {
      await page.goto("/prijava");
      await page.getByTestId("signin-email").fill("mila@example.com");
      await page.getByTestId("signin-send").click();
      await page.getByTestId("signin-code").fill(GOOD_CODE);
      await expect(page).toHaveURL(/\/danas$/);
      // What a session leaves in this browser: the chosen point, remembered choices, the install id.
      await page.evaluate(() => {
        localStorage.setItem("evo.point", "9efd2948-b5ec-465e-bc8a-efa6bb8e4aa5");
        localStorage.setItem("evo.pref.aaaaaaaa-0000-4000-8000-000000000001.marketing", "1");
        localStorage.setItem("evo.pref.aaaaaaaa-0000-4000-8000-000000000001.analyticsOptOut", "1");
        localStorage.setItem("evo.installId", "11111111-2222-4333-8444-555555555555");
        localStorage.setItem("evo.theme", "dark");
      });
    };
    const leftovers = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage)
      .filter((k) => k.startsWith("evo.")).map((k) => [k, localStorage.getItem(k)])));

    await signIn();
    await page.goto("/profil");
    await page.getByTestId("sign-out").click();
    await expect(page).toHaveURL(/\/prijava$/);
    let left = await leftovers();
    expect(Object.keys(left).filter((k) => k.startsWith("evo.pref.") || k === "evo.point" || k.startsWith("evo.auth."))).toEqual([]);
    expect(left["evo.installId"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(left["evo.installId"]).not.toBe("11111111-2222-4333-8444-555555555555");
    expect(left["evo.theme"]).toBe("dark"); // the device's own settings stay

    await signIn();
    await page.goto("/profil/nalog");
    await page.getByTestId("delete-account").click();
    await page.getByTestId("delete-confirm").click();
    await expect(page).toHaveURL(/\/prijava$/);
    await expect(page.getByTestId("account-deleted")).toContainText("Nalog je obrisan.");
    await expect(page.getByTestId("session-expired")).toHaveCount(0);
    left = await leftovers();
    expect(Object.keys(left).filter((k) => k.startsWith("evo.pref.") || k === "evo.point" || k.startsWith("evo.auth."))).toEqual([]);
    expect(left["evo.installId"]).not.toBe("11111111-2222-4333-8444-555555555555");
    expect(log.filter((r) => r.path === "/functions/v1/account-delete")).toHaveLength(1);
    await expectAccessible(page, "account deleted");
  });

  test("a rejected refresh token signs out and says why", async ({ page }) => {
    await mockApi(page);
    await page.route("https://api.evolako.rs/auth/v1/token**", (route) =>
      route.fulfill({ status: 400, contentType: "application/json", body: '{"error":"invalid_grant"}',
        headers: { "access-control-allow-origin": "*" } }));
    await page.addInitScript(() => {
      if (!sessionStorage.getItem("seeded")) {
        localStorage.setItem("evo.auth.refresh", "stale-refresh-token");
        localStorage.setItem("evo.auth.user", JSON.stringify({ id: "u1", email: "mila@example.com" }));
        localStorage.setItem("evo.pref.u1.marketing", "1");
        localStorage.setItem("evo.installId", "11111111-2222-4333-8444-555555555555");
        sessionStorage.setItem("seeded", "1");
      }
    });
    await page.goto("/danas");
    await expect(page).toHaveURL(/\/prijava/);
    await expect(page.getByTestId("session-expired")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("evo.auth.refresh"))).toBeNull();
    // An ended session is left behind like a sign-out: no remembered choices, a new install id.
    expect(await page.evaluate(() => localStorage.getItem("evo.pref.u1.marketing"))).toBeNull();
    expect(await page.evaluate(() => localStorage.getItem("evo.installId"))).not.toBe("11111111-2222-4333-8444-555555555555");
  });
});

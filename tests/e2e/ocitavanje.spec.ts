// 1.14 (11.10.2026), against the mocked API: meter readings by photo (/ocitavanje — the flow, the checks, the history,
// where it is offered and where it is not), the card on Danas inside its window, the "something was done with the
// charger" mark that starts the free period (and that a sign-in alone is not one), Pretplata while the period waits,
// runs, is on hold or keeps free months, and the estimated statement.
import { expect, test, type Page } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow, expectTouchTargets, openDemo, watchErrors } from "./helpers";
import { ACCESS, fixture, GOOD_CODE, mockApi, type MockOptions, type Recorded } from "./mock-api";

const NOW = new Date("2026-10-12T10:00:00+02:00");
const USER = "aaaaaaaa-0000-4000-8000-000000000001";
const POINT = (fixture("currentUser.json") as { chargePoints: Array<{ id: string }> }).chargePoints[0]!.id;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const rpc = (log: Recorded[], name: string) => log.filter((r) => r.path === `/rest/v1/rpc/${name}`);

/** Signs in and lands on `path` (the landing remembers where to return). */
async function signIn(page: Page, path: string, options: MockOptions = {}, now: Date = NOW): Promise<Recorded[]> {
  const log = await mockApi(page, options);
  await page.clock.setFixedTime(now);
  await page.goto(path);
  await page.getByTestId("signin-email").fill("mila@example.com");
  await page.getByTestId("signin-send").click();
  await page.getByTestId("signin-code").fill(GOOD_CODE);
  await page.locator("#page-title").first().waitFor();
  return log;
}

async function addPhoto(page: Page) {
  await page.getByTestId("reading-gallery-input").setInputFiles({ name: "brojilo.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByTestId("reading-preview")).toBeVisible();
}

/** A point read by photo whose last reading closed September. */
const SEPTEMBER = {
  required: true,
  lastAccepted: { valueKWh: 1310.2, readAt: "2026-09-30T19:00:00+02:00" },
  readings: [{ id: 7, valueKWh: 1310.2, readAt: "2026-09-30T19:00:00+02:00", month: { year: 2026, month: 9 },
    status: "accepted", source: "app_photo", chargePointID: POINT }],
};

test.describe("/ocitavanje — the meter reading by photo", () => {
  test("photo, number, send: the photo goes to storage, the value to the RPC; the list is refreshed", async ({ page }) => {
    const errors = watchErrors(page);
    const log = await signIn(page, "/obracuni", { readings: "fixture" });
    // The way in: a row on the statements page with what the last reading is.
    const entry = page.getByTestId("readings-entry");
    await expect(entry).toContainText("Očitavanje brojila");
    await expect(page.getByTestId("readings-entry-status")).toHaveText(/^Poslato · /);
    await entry.click();
    await expect(page).toHaveURL(/\/ocitavanje$/);
    await expect(page.locator("#page-title")).toHaveText("Očitavanje brojila");
    const form = page.getByTestId("reading-form");
    await expect(form).toContainText("Jednom mesečno pošalji fotografiju MID brojila pored punjača. Iz nje pravimo mesečni obračun.");
    await expect(form).toContainText("Upiši broj sa ekrana brojila. Poslednje prihvaćeno: 18,412 kWh");
    await expect(page.getByTestId("reading-camera")).toHaveText("Fotografiši brojilo");
    await expect(page.getByTestId("reading-gallery")).toHaveText("Izaberi iz galerije");
    await expect(page.getByTestId("reading-camera-input")).toHaveAttribute("capture", "environment");
    expect(await page.getByTestId("reading-gallery-input").getAttribute("capture")).toBeNull();

    // The history: every status, the reason of a rejection, a thumbnail only of one's own photo.
    const rows = page.getByTestId("reading-row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("2.431,5 kWh");
    await expect(rows.nth(0)).toContainText("Poslato");
    await expect(rows.nth(1)).toContainText("Prihvaćeno");
    await expect(rows.nth(2)).toContainText("Treba ponoviti");
    await expect(rows.nth(2).getByTestId("reading-note")).toHaveText("Razlog: Na fotografiji se ne vidi ceo ekran brojila.");
    await expect(rows.nth(3)).toContainText("0 kWh");
    await expect(page.getByTestId("reading-photo")).toHaveCount(3);
    const photos = log.filter((r) => r.path.startsWith("/storage/v1/object/authenticated/readings/"));
    expect(photos.map((r) => r.path).sort()).toEqual(["r1", "r2", "r3"].map((f) =>
      `/storage/v1/object/authenticated/readings/aaaaaaaa-0000-4000-8000-000000000002/${f}.jpg`));
    for (const r of photos) expect([r.method, r.headers.authorization]).toEqual(["GET", `Bearer ${ACCESS}`]);

    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page, `ocitavanje ${width}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectTouchTargets(page, "ocitavanje");
    await expectAccessible(page, "ocitavanje");

    await addPhoto(page);
    await page.getByTestId("reading-value").fill("25,5");
    await page.getByTestId("reading-send").click();
    await expect(page.getByTestId("reading-sent")).toContainText("Očitavanje je poslato. Proveravamo ga i javljamo se ako nešto nije jasno.");

    const upload = log.find((r) => r.method === "POST" && r.path.startsWith("/storage/v1/object/readings/"))!;
    expect(upload.path).toMatch(new RegExp(`^/storage/v1/object/readings/${USER}/[0-9a-f-]{36}\\.jpg$`));
    expect(upload.headers["content-type"]).toBe("image/jpeg");
    expect(upload.headers.authorization).toBe(`Bearer ${ACCESS}`);
    const sent = rpc(log, "api_submit_meter_reading");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toEqual({ p_id: POINT, p_value: 25.5, p_photo_path: upload.path.replace("/storage/v1/object/readings/", "") });
    expect(log.indexOf(upload)).toBeLessThan(log.indexOf(sent[0]!));
    // The list comes back from the server with the new reading on top.
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText("25,5 kWh");
    await expect(rows.nth(0)).toContainText("Prihvaćeno");
    await expectAccessible(page, "ocitavanje sent");
    expect(errors).toEqual([]);
  });

  test("checks before sending: a photo and a number, not below the last accepted, «izgleda previše» asks once", async ({ page }) => {
    const log = await signIn(page, "/ocitavanje", { readings: "fixture" });
    await page.getByTestId("reading-send").click();
    await expect(page.getByTestId("reading-photo-error")).toHaveText("Dodaj fotografiju brojila.");
    await expect(page.getByTestId("reading-form").locator(".field__error").last()).toHaveText("Upiši stanje na brojilu.");

    await addPhoto(page);
    const value = page.getByTestId("reading-value");
    for (const bad of ["1,2345", "12 kWh", "-3"]) {
      await value.fill(bad);
      await page.getByTestId("reading-send").click();
      await expect(page.getByTestId("reading-form").locator(".field__error").last(), bad).toHaveText("Upiši stanje na brojilu.");
    }
    await value.fill("18.4");
    await page.getByTestId("reading-send").click();
    await expect(page.getByTestId("reading-form").locator(".field__error").last())
      .toHaveText("Stanje ne može biti manje od poslednjeg prihvaćenog: 18,412 kWh.");
    await expect(value).toBeFocused();

    // More than 2 000 kWh since the last accepted reading: asked, and it may still go.
    await value.fill("2431.5");
    await page.getByTestId("reading-send").click();
    const ask = page.getByTestId("reading-ask");
    await expect(ask).toContainText("Proveri broj — izgleda previše.");
    await expectAccessible(page, "ocitavanje ask");
    expect(rpc(log, "api_submit_meter_reading")).toHaveLength(0);
    await page.getByTestId("reading-edit").click();
    await expect(ask).toHaveCount(0);
    await expect(value).toBeFocused();
    await page.getByTestId("reading-send").click();
    await page.getByTestId("reading-send-anyway").click();
    await expect(page.getByTestId("reading-sent")).toBeVisible();
    expect(rpc(log, "api_submit_meter_reading")[0]!.body).toMatchObject({ p_id: POINT, p_value: 2431.5 });
  });

  test("no connection: a clear error, and the photo and the number stay", async ({ page }) => {
    const log = await signIn(page, "/ocitavanje", { readings: "fixture", submitReading: "abort" });
    await addPhoto(page);
    await page.getByTestId("reading-value").fill("30");
    await page.getByTestId("reading-send").click();
    await expect(page.getByTestId("form-error"))
      .toHaveText("Nema veze. Očitavanje nije poslato — fotografija i broj su sačuvani, pokušaj ponovo.");
    await expect(page.getByTestId("reading-preview")).toBeVisible();
    await expect(page.getByTestId("reading-value")).toHaveValue("30");
    await expect(page.getByTestId("reading-sent")).toHaveCount(0);
    // Sent once: a write is never repeated by itself.
    expect(rpc(log, "api_submit_meter_reading")).toHaveLength(1);
  });

  test("the server's own refusals are said in words", async ({ page }) => {
    await signIn(page, "/ocitavanje", { readings: "fixture", submitReading: "meterReadingTooLow" });
    await addPhoto(page);
    await page.getByTestId("reading-value").fill("30");
    await page.getByTestId("reading-send").click();
    await expect(page.getByTestId("reading-form").locator(".field__error").last())
      .toHaveText("Stanje ne može biti manje od poslednjeg prihvaćenog: 18,412 kWh.");
    await expect(page.getByTestId("reading-preview")).toBeVisible();
  });

  test("too many in a day: «Previše pokušaja»", async ({ page }) => {
    await signIn(page, "/ocitavanje", { readings: "fixture", submitReading: "rateLimited" });
    await addPhoto(page);
    await page.getByTestId("reading-value").fill("30");
    await page.getByTestId("reading-send").click();
    await expect(page.getByTestId("form-error")).toHaveText("Previše pokušaja. Pokušaj ponovo za minut.");
  });

  test("a point that reports by itself: no row, no card, no page", async ({ page }) => {
    await signIn(page, "/obracuni");
    await expect(page.getByTestId("statement-list")).toBeVisible();
    await expect(page.getByTestId("readings-entry")).toHaveCount(0);
    await page.goto("/danas");
    await page.getByTestId("status-hero").waitFor();
    await expect(page.getByTestId("reading-card")).toHaveCount(0);
    await page.goto("/ocitavanje");
    await expect(page.getByTestId("not-found")).toBeVisible();
  });

  test("the kill switch (features.meterPhoto = false) hides the row, the card and the page, and asks nothing", async ({ page }) => {
    const log = await signIn(page, "/obracuni", { readings: SEPTEMBER, features: { meterPhoto: false } }, new Date("2026-10-30T12:00:00+01:00"));
    await expect(page.getByTestId("statement-list")).toBeVisible();
    await expect(page.getByTestId("readings-entry")).toHaveCount(0);
    await page.goto("/danas");
    await page.getByTestId("status-hero").waitFor();
    await expect(page.getByTestId("reading-card")).toHaveCount(0);
    await page.goto("/ocitavanje");
    await expect(page.getByTestId("not-found")).toBeVisible();
    expect(rpc(log, "api_meter_readings")).toHaveLength(0);
  });

  for (const [lang, title, send] of [["en", "Meter reading", "Send reading"], ["ru", "Показания счётчика", "Отправить показания"]] as const) {
    test(`in ${lang}`, async ({ page }) => {
      await signIn(page, `/ocitavanje?lang=${lang}`, { readings: "fixture" });
      await expect(page.locator("#page-title")).toHaveText(title);
      await expect(page.getByTestId("reading-send")).toHaveText(send);
      await expect(page.getByTestId("reading-row").nth(2)).toContainText(lang === "en" ? "Please resend" : "Нужно переснять");
      await expectNoHorizontalOverflow(page, `ocitavanje ${lang}`);
      await expectAccessible(page, `ocitavanje ${lang}`);
    });
  }

  test("the demo socket: the same flow in memory; the demo wallbox has nothing to read", async ({ page }) => {
    await openDemo(page, "socket", "/obracuni");
    await page.getByTestId("readings-entry").click();
    await expect(page.getByTestId("reading-row").first()).toContainText("Prihvaćeno");
    const before = await page.getByTestId("reading-row").count();
    await addPhoto(page);
    await page.getByTestId("reading-value").fill("99999");
    await page.getByTestId("reading-send").click();
    await expect(page.getByTestId("reading-ask")).toBeVisible();
    await page.getByTestId("reading-send-anyway").click();
    await expect(page.getByTestId("reading-sent")).toBeVisible();
    await expect(page.getByTestId("reading-row")).toHaveCount(Math.min(12, before + 1));
    await expect(page.getByTestId("reading-row").first()).toContainText("Poslato");
    await expect(page.getByTestId("reading-photo")).toHaveCount(1);
  });

  test("the demo wallbox reports by itself", async ({ page }) => {
    await openDemo(page, "wallbox", "/obracuni");
    await expect(page.getByTestId("statement-list")).toBeVisible();
    await expect(page.getByTestId("readings-entry")).toHaveCount(0);
  });
});

test.describe("Danas: the card of the last and first three days", () => {
  const card = "Poslednji dan u mesecu — pošalji očitavanje brojila.";
  const cases: Array<[string, string, MockOptions["readings"], boolean]> = [
    ["28 October: not yet", "2026-10-28T12:00:00+01:00", SEPTEMBER, false],
    ["29 October: the window opens", "2026-10-29T08:00:00+01:00", SEPTEMBER, true],
    ["31 October, no reading for October", "2026-10-31T18:00:00+01:00", SEPTEMBER, true],
    ["2 November, still none", "2026-11-02T10:00:00+01:00", SEPTEMBER, true],
    ["4 November: the window is over", "2026-11-04T10:00:00+01:00", SEPTEMBER, false],
    ["31 October with a reading sent for October", "2026-10-31T18:00:00+01:00", { ...SEPTEMBER, readings: [
      { id: 8, valueKWh: 1400, readAt: "2026-10-30T19:00:00+01:00", month: { year: 2026, month: 10 }, status: "submitted" },
      ...SEPTEMBER.readings] }, false],
    ["31 October with a rejected one only", "2026-10-31T18:00:00+01:00", { ...SEPTEMBER, readings: [
      { id: 8, valueKWh: 1400, readAt: "2026-10-30T19:00:00+01:00", month: { year: 2026, month: 10 }, status: "rejected", note: "Mutno." },
      ...SEPTEMBER.readings] }, true],
  ];
  for (const [name, now, readings, shown] of cases) {
    test(name, async ({ page }) => {
      await signIn(page, "/danas", { readings }, new Date(now));
      await page.getByTestId("status-hero").waitFor();
      await expect(page.getByTestId("subscription-card")).toBeVisible();
      if (!shown) {
        await expect(page.getByTestId("reading-card")).toHaveCount(0);
        return;
      }
      await expect(page.getByTestId("reading-card")).toContainText(card);
      await expectAccessible(page, name);
      await expectNoHorizontalOverflow(page, name);
      await page.getByTestId("reading-card-open").click();
      await expect(page).toHaveURL(/\/ocitavanje$/);
      await expect(page.getByTestId("reading-form")).toBeVisible();
    });
  }
});

test.describe("the free period starts with the first action with the charger", () => {
  const pending = fixture("subscription_pending.json") as Record<string, unknown>;
  const mark = (log: Recorded[]) => rpc(log, "api_mark_point_activity");

  test("signing in alone is not an action; opening the charger is — once", async ({ page }) => {
    const log = await signIn(page, "/profil/nalog", { subscription: pending });
    await page.getByTestId("settings-currency").waitFor();
    // Profil and its account pages: the account, not the charger.
    await page.goto("/profil");
    await page.getByTestId("row-pretplata").waitFor();
    await page.goto("/profil/pretplata");
    await expect(page.getByTestId("trial-pending")).toBeVisible();
    expect(mark(log)).toHaveLength(0);

    await page.goto("/danas");
    await page.getByTestId("status-hero").waitFor();
    await expect.poll(() => mark(log).length).toBe(1);
    expect(mark(log)[0]!.body).toEqual({ p_point: POINT });
    expect(mark(log)[0]!.headers.authorization).toMatch(/^Bearer access-token-/);
    // Moving on inside the app does not tell the server again.
    await page.locator('a[href="/statistika"]').first().click();
    await page.locator('a[href="/obracuni"]').first().click();
    await page.getByTestId("statement-list").waitFor();
    expect(mark(log)).toHaveLength(1);
  });

  for (const path of ["/statistika", "/obracuni", "/obracuni/2026-09", "/ocitavanje"]) {
    test(`${path} is an action with the charger`, async ({ page }) => {
      const log = await signIn(page, path, { subscription: pending, readings: "fixture" });
      await expect.poll(() => mark(log).length).toBe(1);
    });
  }

  test("a period that has started is not reported again", async ({ page }) => {
    const started = { ...(fixture("subscription.json") as object), activatedAt: "2026-08-21T09:12:00+02:00" };
    const log = await signIn(page, "/danas", { subscription: started });
    await page.getByTestId("status-hero").waitFor();
    await expect(page.getByTestId("subscription-card")).toBeVisible();
    await page.locator('a[href="/statistika"]').first().click();
    await page.locator('a[href="/obracuni"]').first().click();
    await page.getByTestId("statement-list").waitFor();
    expect(mark(log)).toHaveLength(0);
  });

  test("the demo never calls it", async ({ page }) => {
    const log = await mockApi(page);
    await openDemo(page, "socket", "/danas");
    await page.getByTestId("status-hero").waitFor();
    expect(mark(log)).toHaveLength(0);
  });
});

test.describe("Pretplata: waiting, running, on hold, kept months", () => {
  const base = { startedAt: "2026-10-08T00:00:00+02:00", endsOn: null, history: [] };

  test("waiting for the first action: how the period starts, and no date", async ({ page }) => {
    await signIn(page, "/profil/pretplata", { subscription: fixture("subscription_pending.json") as Record<string, unknown> });
    const status = page.getByTestId("subscription-status");
    await expect(status.locator("#sub-title")).toHaveText("Probni period");
    await expect(page.getByTestId("trial-pending"))
      .toHaveText("Probni period počinje kad prvi put otvoriš punjač u aplikaciji (najkasnije 14 dana posle ugradnje).");
    await expect(status).not.toContainText("2027");
    await expectAccessible(page, "pretplata pending");
    await page.goto("/danas");
    await expect(page.getByTestId("subscription-card")).toContainText("Probni period");
    await expect(page.getByTestId("subscription-card")).not.toContainText("ističe");
  });

  test("running: «Probni period: do 14.12.» — the last free day", async ({ page }) => {
    await signIn(page, "/profil/pretplata", { subscription: { ...base, state: { type: "trial", until: "2026-12-15T00:00:00+01:00" },
      activatedAt: "2026-10-15T08:30:00+02:00" } });
    await expect(page.locator("#sub-title")).toHaveText("Probni period: do 14.12.");
    await expect(page.getByTestId("trial-pending")).toHaveCount(0);
    await page.goto("/profil/pretplata?lang=ru");
    await expect(page.locator("#sub-title")).toHaveText("Пробный период: до 14.12.");
    await page.goto("/profil/pretplata?lang=en");
    await expect(page.locator("#sub-title")).toHaveText("Trial: until 14.12.");
  });

  test("on hold: a calm line, «Plati pretplatu» to the unpaid month's statement, nothing else", async ({ page }) => {
    await signIn(page, "/profil/pretplata", { subscription: { ...base, state: { type: "active" },
      activatedAt: "2026-01-10T12:00:00+01:00", suspendedSince: "2026-10-11T02:05:00+02:00",
      unpaid: { month: { year: 2026, month: 9 }, amountRSD: 990 } } });
    const status = page.getByTestId("subscription-status");
    await expect(status.locator(".badge").first()).toHaveText("Na čekanju");
    await expect(page.getByTestId("subscription-hold")).toContainText("Pretplata je na čekanju jer uplata kasni više od 30 dana. Dok je tako, produžena garancija i prioritetni servis ne važe. Nema kamata ni penala — čim uplata stigne, sve se vraća samo.");
    await expectAccessible(page, "pretplata hold");
    await expectNoHorizontalOverflow(page, "pretplata hold");
    const pay = page.getByTestId("subscription-pay");
    await expect(pay).toHaveText("Plati pretplatu");
    await pay.click();
    await expect(page).toHaveURL(/\/obracuni\/2026-09$/);
    await expect(page.getByTestId("part-service")).toBeVisible();
    await page.goto("/profil");
    await expect(page.getByTestId("row-pretplata")).toContainText("Na čekanju");
  });

  test("cancelling says what happens to free months, before and after", async ({ page }) => {
    await signIn(page, "/profil/pretplata", { subscription: { ...base, state: { type: "active" }, activatedAt: "2026-01-10T12:00:00+01:00" },
      cancel: { freeMonthsKept: 2, freeMonthsKeptUntil: "2027-10-31" } });
    const line = "Neiskorišćeni besplatni meseci od preporuka čuvaju se 12 meseci — važe ako se vratiš u tom roku.";
    await expect(page.getByTestId("kept-months")).toHaveCount(0);
    await page.getByTestId("subscription-cancel").click();
    await expect(page.getByTestId("cancel-kept-months")).toHaveText(line);
    await page.getByTestId("cancel-confirm").click();
    await expect(page.getByTestId("subscription-ends")).toBeVisible();
    await expect(page.getByTestId("kept-months")).toHaveText(line);
    await expectAccessible(page, "pretplata cancelled");
  });

  test("no subscription any more, months still kept", async ({ page }) => {
    await signIn(page, "/profil/pretplata", { subscription: { ...base, state: { type: "none" },
      keptFreeMonths: { months: 2, until: "2027-10-31T00:00:00+01:00" } } });
    await expect(page.getByTestId("kept-months")).toBeVisible();
  });

  test("nothing kept, nothing said", async ({ page }) => {
    await signIn(page, "/profil/pretplata", { subscription: { ...base, state: { type: "none" } } });
    await expect(page.getByTestId("subscription-status")).toBeVisible();
    await expect(page.getByTestId("kept-months")).toHaveCount(0);
  });
});

test.describe("the statement", () => {
  const estimated = "Za ovaj mesec nismo dobili očitavanje, pa je potrošnja procenjena po proseku. Razliku ispravljamo u sledećem obračunu.";

  test("an estimated month says so on screen and on paper; the month the trial ended in names its days", async ({ page }) => {
    const raw = fixture("statement_2026_09.json") as { servicePart: Record<string, unknown> };
    await signIn(page, "/obracuni/2026-09", { statementStatus: "issued", statement: { energyEstimated: true,
      servicePart: { ...raw.servicePart, isTrial: false, proration: { paidDays: 17, monthDays: 31 } } } });
    await expect(page.getByTestId("statement-estimated")).toHaveText(estimated);
    await expect(page.getByTestId("part-service")).toContainText("Pretplata za ovaj mesec: 17 od 31 dana (posle probnog perioda).");
    await expectAccessible(page, "statement estimated");
    await expectNoHorizontalOverflow(page, "statement estimated");
    await page.emulateMedia({ media: "print" });
    const printed = await page.getByTestId("print-doc").innerText();
    expect(printed).toContain(estimated);
    expect(printed).toContain("Pretplata za ovaj mesec: 17 od 31 dana (posle probnog perioda).");
  });

  test("a measured month carries no such line", async ({ page }) => {
    await signIn(page, "/obracuni/2026-09");
    await expect(page.getByTestId("part-energy")).toBeVisible();
    await expect(page.getByTestId("statement-estimated")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("procenjena po proseku");
  });
});

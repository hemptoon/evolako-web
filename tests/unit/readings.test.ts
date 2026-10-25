// Meter readings by photo, the free period and the proration note (1.14): the pure rules.
import { beforeAll, describe, expect, it } from "vitest";
import { DemoBackend } from "../../src/api/demo/backend";
import { BackendError } from "../../src/api/errors";
import { subscriptionSummary, subscriptionTitle } from "../../src/app/texts";
import { loadLang, tIn } from "../../src/i18n";
import { fromBelgrade } from "../../src/lib/belgrade";
import {
  checkReading, coversMonth, lastFreeDay, MAX_INCREASE_KWH, MAX_PER_DAY_KWH, parseReading, readingDue, readingWindow,
} from "../../src/lib/readings";

beforeAll(async () => {
  await loadLang("en");
  await loadLang("ru");
});

describe("the number on the meter", () => {
  it("takes a comma or a dot and up to three decimals", () => {
    expect(parseReading("1432,6")).toBe(1432.6);
    expect(parseReading("1432.6")).toBe(1432.6);
    expect(parseReading(" 18,412 ")).toBe(18.412);
    expect(parseReading("0")).toBe(0);
    expect(parseReading("007")).toBe(7);
    expect(parseReading("12345678,125")).toBe(12345678.125);
  });

  it("refuses everything that is not one plain number", () => {
    for (const bad of ["", " ", "1,2345", "1.432,6", "1 432", "-5", "+5", "12kWh", "1,", ",5", "1e3", "123456789", "١٢٣"]) {
      expect(parseReading(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});

describe("is the value plausible", () => {
  const now = fromBelgrade(2026, 10, 31, 18);
  const monthAgo = { valueKWh: 1000, readAt: fromBelgrade(2026, 9, 30, 18) };

  it("never below the last accepted reading", () => {
    expect(checkReading(999.999, monthAgo, now)).toBe("tooLow");
    expect(checkReading(1000, monthAgo, now)).toBe("ok");
  });

  it("asks above 2 000 kWh since the last accepted one", () => {
    expect(MAX_INCREASE_KWH).toBe(2000);
    expect(checkReading(3000, monthAgo, now)).toBe("ok");
    expect(checkReading(3000.001, monthAgo, now)).toBe("tooHigh");
  });

  it("asks above 300 kWh a day; less than a day counts as one", () => {
    expect(MAX_PER_DAY_KWH).toBe(300);
    const twoDays = { valueKWh: 1000, readAt: fromBelgrade(2026, 10, 29, 18) };
    expect(checkReading(1600, twoDays, now)).toBe("ok");
    expect(checkReading(1600.5, twoDays, now)).toBe("tooHigh");
    const hourAgo = { valueKWh: 1000, readAt: fromBelgrade(2026, 10, 31, 17) };
    expect(checkReading(1300, hourAgo, now)).toBe("ok");
    expect(checkReading(1301, hourAgo, now)).toBe("tooHigh");
  });

  it("a first reading has nothing to be compared with", () => {
    expect(checkReading(99999, null, now)).toBe("ok");
  });
});

describe("when a reading is expected", () => {
  it("the last three days of a month — that month; the first three — the month before", () => {
    expect(readingWindow(fromBelgrade(2026, 10, 28, 23, 59))).toBeNull();
    expect(readingWindow(fromBelgrade(2026, 10, 29, 0, 0))).toEqual({ year: 2026, month: 10 });
    expect(readingWindow(fromBelgrade(2026, 10, 31, 23, 59))).toEqual({ year: 2026, month: 10 });
    expect(readingWindow(fromBelgrade(2026, 11, 1, 0, 0))).toEqual({ year: 2026, month: 10 });
    expect(readingWindow(fromBelgrade(2026, 11, 3, 23, 59))).toEqual({ year: 2026, month: 10 });
    expect(readingWindow(fromBelgrade(2026, 11, 4, 0, 0))).toBeNull();
    expect(readingWindow(fromBelgrade(2026, 10, 12, 12))).toBeNull();
  });

  it("month lengths and the turn of the year", () => {
    expect(readingWindow(fromBelgrade(2026, 11, 27, 23))).toBeNull();
    expect(readingWindow(fromBelgrade(2026, 11, 28, 1))).toEqual({ year: 2026, month: 11 });      // 30 days
    expect(readingWindow(fromBelgrade(2027, 2, 25, 23))).toBeNull();
    expect(readingWindow(fromBelgrade(2027, 2, 26, 1))).toEqual({ year: 2027, month: 2 });        // 28 days
    expect(readingWindow(fromBelgrade(2028, 2, 26, 23))).toBeNull();
    expect(readingWindow(fromBelgrade(2028, 2, 27, 1))).toEqual({ year: 2028, month: 2 });        // 29 days
    expect(readingWindow(fromBelgrade(2026, 12, 31, 20))).toEqual({ year: 2026, month: 12 });
    expect(readingWindow(fromBelgrade(2027, 1, 2, 9))).toEqual({ year: 2026, month: 12 });
  });

  it("a reading sent or accepted for the month ends the reminder; a rejected one does not", () => {
    const now = fromBelgrade(2026, 11, 2, 10);
    const october = { year: 2026, month: 10 };
    expect(readingDue([], now)).toEqual(october);
    expect(readingDue([{ month: { year: 2026, month: 9 }, status: "accepted" }], now)).toEqual(october);
    expect(readingDue([{ month: october, status: "rejected" }], now)).toEqual(october);
    expect(readingDue([{ month: october, status: "submitted" }], now)).toBeNull();
    expect(readingDue([{ month: october, status: "accepted" }], now)).toBeNull();
    expect(readingDue([], fromBelgrade(2026, 11, 10, 10))).toBeNull();
    expect(coversMonth([{ month: october, status: "accepted" }], { year: 2026, month: 11 })).toBe(false);
  });
});

describe("the free period on screen", () => {
  it("shows the last free day: `until` is the first paid one", () => {
    expect(lastFreeDay(fromBelgrade(2026, 12, 15))).toBe("14.12");
    expect(lastFreeDay(fromBelgrade(2027, 1, 1))).toBe("31.12");
    expect(lastFreeDay(fromBelgrade(2027, 3, 1))).toBe("28.02");
    expect(lastFreeDay(fromBelgrade(2026, 10, 26))).toBe("25.10");     // the day the clocks go back
    expect(lastFreeDay(fromBelgrade(2027, 3, 29))).toBe("28.03");      // … and forward
  });

  it("started: «Probni period: do 14.12.»; waiting: no date at all", () => {
    const state = { type: "trial" as const, until: fromBelgrade(2026, 12, 15) };
    expect(subscriptionSummary({ state, trialStartsBy: null }, "990 RSD")).toBe("Probni period: do 14.12.");
    expect(subscriptionSummary({ state }, "990 RSD")).toBe("Probni period: do 14.12.");
    expect(subscriptionSummary({ state, trialStartsBy: fromBelgrade(2026, 10, 24) }, "990 RSD")).toBe("Probni period");
    expect(tIn("en", "Probni period: do %@.", "14.12")).toBe("Trial: until 14.12.");
    expect(tIn("ru", "Probni period: do %@.", "14.12")).toBe("Пробный период: до 14.12.");
  });

  it("on hold is its own word, not the customer's pause", () => {
    expect(subscriptionTitle({ state: { type: "active" }, suspendedSince: new Date() })).toEqual({ title: "Na čekanju", active: false });
    expect(subscriptionTitle({ state: { type: "active" }, suspendedSince: null })).toEqual({ title: "Aktivna", active: true });
  });

  it("the proration note names the days", () => {
    const key = "Pretplata za ovaj mesec: %lld od %lld dana (posle probnog perioda).";
    expect(tIn("sr", key, 17, 31)).toBe("Pretplata za ovaj mesec: 17 od 31 dana (posle probnog perioda).");
    expect(tIn("en", key, 17, 31)).toBe("Subscription this month: 17 of 31 days (after the trial).");
    expect(tIn("ru", key, 17, 31)).toBe("Подписка за этот месяц: 17 из 31 дней (после пробного периода).");
  });
});

describe("the demo", () => {
  const NOW = fromBelgrade(2026, 10, 30, 20);
  const demo = (account: "wallbox" | "socket") => new DemoBackend(account, { storage: null, now: () => NOW, online: () => true, latency: 0 });
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });

  it("the socket is read by photo, the wallbox reports by itself", async () => {
    const socket = demo("socket");
    const point = (await socket.currentUser()).chargePoints[0]!;
    const list = await socket.meterReadings(point.id);
    expect(list.required).toBe(true);
    expect(list.readings.length).toBeGreaterThanOrEqual(1);
    expect(list.readings.every((r) => r.status === "accepted")).toBe(true);
    expect(list.lastAccepted).not.toBeNull();
    // 30 October: inside the window, and October has no reading yet.
    expect(readingDue(list.readings, NOW)).toEqual({ year: 2026, month: 10 });
    const wallbox = demo("wallbox");
    expect((await wallbox.meterReadings((await wallbox.currentUser()).chargePoints[0]!.id)).required).toBe(false);
  });

  it("a plausible reading is accepted at once and ends the reminder; too low is refused; too much waits", async () => {
    const socket = demo("socket");
    const point = (await socket.currentUser()).chargePoints[0]!;
    const last = (await socket.meterReadings(point.id)).lastAccepted!.valueKWh;
    await expect(socket.submitMeterReading(point.id, last - 1, photo)).rejects.toEqual(new BackendError("meterReadingTooLow"));
    await socket.submitMeterReading(point.id, last + 80.5, photo);
    let list = await socket.meterReadings(point.id);
    expect([list.readings[0]!.status, list.readings[0]!.valueKWh]).toEqual(["accepted", Math.round((last + 80.5) * 1000) / 1000]);
    expect(list.lastAccepted!.valueKWh).toBe(list.readings[0]!.valueKWh);
    expect(readingDue(list.readings, NOW)).toBeNull();
    expect((await socket.readingPhoto(list.readings[0]!.photoPath!)).size).toBe(3);
    await socket.submitMeterReading(point.id, last + 5000, photo);
    list = await socket.meterReadings(point.id);
    expect(list.readings[0]!.status).toBe("submitted");
    expect(list.lastAccepted!.valueKWh).toBe(Math.round((last + 80.5) * 1000) / 1000);
  });

  it("the demo's free period started with the installation: nothing waits, nothing is started", async () => {
    const socket = demo("socket");
    const point = (await socket.currentUser()).chargePoints[0]!;
    const subscription = await socket.subscription();
    expect(subscription.activatedAt).not.toBeNull();
    expect(subscription.trialStartsBy).toBeNull();
    expect((await socket.markPointActivity(point.id)).started).toBe(false);
  });

  it("a cancellation keeps the free referral months for a year", async () => {
    const wallbox = demo("wallbox");
    const free = (await wallbox.referralStatus()).freeMonthsBalance;
    const result = await wallbox.cancelSubscription();
    expect(result.freeMonthsKept).toBe(free);
    const kept = (await wallbox.subscription()).keptFreeMonths;
    if (free > 0) expect(kept?.months).toBe(free);
    else expect(kept).toBeNull();
  });
});

import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { DemoBackend } from "../../src/api/demo/backend";
import { DEMO_BUILDING_ACCOUNT, DEMO_EVOLAKO_ACCOUNT, demoSeed, generateDemo } from "../../src/api/demo/data";
import { referralCode, SeededRandom } from "../../src/api/demo/random";
import { belgradeParts, daysBetween, fromBelgrade, monthOf, startOfDay } from "../../src/lib/belgrade";
import { isValidAccount, parseIps } from "../../src/lib/payments";
import { encodeQr, rasterize } from "../../src/lib/qr";
import { statementDueDate, statementTotal } from "../../src/lib/statement";
import { total } from "../../src/lib/tariff";

const NOW = fromBelgrade(2026, 10, 5, 23, 40);

function backend(account: "wallbox" | "socket" | "lead", now: Date | (() => Date) = NOW, online = true) {
  return new DemoBackend(account, { storage: null, now: typeof now === "function" ? now : () => now, online: () => online,
    latency: 0 });
}

/** What a visitor sees that must not change during one Belgrade day. */
function dayView(account: "wallbox" | "socket" | "lead", now: Date) {
  const d = generateDemo(account, now);
  return JSON.stringify([d.sessions, d.statementMonths, d.latestPaid, d.serviceRequests, d.relocationRequests,
    d.installationRequests, d.referral, d.alerts.filter((a) => !String(a.id).startsWith("alert-statement"))]);
}

describe("seeded random", () => {
  it("is SplitMix64", () => {
    const r = new SeededRandom(0n);
    expect(r.next()).toBe(0xe220a8397b1dcdafn);
    expect(r.next()).toBe(0x6e789e6aa1b965f4n);
  });

  it("derives referral codes without look-alike characters", () => {
    const code = referralCode("demo-wallbox");
    expect(code).toMatch(/^EVO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/);
    expect(referralCode("demo-wallbox")).toBe(code);
  });
});

describe("demo data", () => {
  it("is deterministic for the same moment", () => {
    expect(JSON.stringify(generateDemo("wallbox", NOW))).toBe(JSON.stringify(generateDemo("wallbox", NOW)));
  });

  it("is the same all day in Belgrade and new the next day", () => {
    for (const account of ["wallbox", "socket", "lead"] as const) {
      const night = fromBelgrade(2026, 10, 5, 23, 55);
      expect(demoSeed(account, fromBelgrade(2026, 10, 5, 0, 5))).toBe(demoSeed(account, night));
      // Once last night's charge has ended (they all do by early morning) nothing moves until midnight.
      expect(dayView(account, fromBelgrade(2026, 10, 5, 8, 0))).toBe(dayView(account, night));
      expect(demoSeed(account, fromBelgrade(2026, 10, 6, 0, 5))).not.toBe(demoSeed(account, night));
    }
    expect(dayView("wallbox", fromBelgrade(2026, 10, 6, 12, 0))).not.toBe(dayView("wallbox", NOW));
    // The Belgrade day, not the UTC one: 00:30 in Belgrade is still the previous day in UTC.
    expect(demoSeed("wallbox", new Date("2026-10-05T22:30:00Z"))).toBe(demoSeed("wallbox", fromBelgrade(2026, 10, 6, 9, 0)));
  });

  it("ends the history where today begins: the current month is in progress", () => {
    for (const account of ["wallbox", "socket"] as const) {
      const d = generateDemo(account, NOW);
      for (const s of d.sessions) {
        expect(new Date(String(s.startedAt)) < startOfDay(NOW)).toBe(true);
        expect(new Date(String(s.endedAt)) <= NOW).toBe(true);
      }
      expect(d.sessions.some((s) => monthOf(new Date(String(s.startedAt))).month === 10)).toBe(true);
      expect(d.statementMonths.at(-1)).toEqual({ year: 2026, month: 9 });
    }
    // Just after midnight last night's charge is still running: it is the live session, not history yet.
    const early = fromBelgrade(2026, 10, 5, 0, 20);
    for (const s of generateDemo("wallbox", early).sessions) expect(new Date(String(s.endedAt)) <= early).toBe(true);
  });

  it("gives the wallbox about four months of realistic night sessions", async () => {
    const b = backend("wallbox");
    const user = await b.currentUser();
    const point = user.chargePoints[0]!;
    expect(point.capabilities).toEqual(["metering", "remoteControl", "scheduling", "livePower"]);
    expect(point.connectionScheme.type).toBe("thirdPartyMeter");
    const sessions = await b.sessions(point.id, new Date(0), NOW);
    const days = daysBetween(sessions.at(-1)!.startedAt, NOW);
    expect(days).toBeGreaterThanOrEqual(115);
    expect(sessions.length).toBeGreaterThan(35);
    const nights = sessions.filter((s) => s.trigger === "auto");
    expect(nights.length / sessions.length).toBeGreaterThan(0.7);
    for (const s of nights) {
      expect(belgradeParts(s.startedAt).hour).toBe(23);
      expect(total(s.energy)).toBeGreaterThanOrEqual(8);
      expect(total(s.energy)).toBeLessThanOrEqual(35);
      expect(s.energy.dayKWh).toBe(0);
    }
    const manual = sessions.filter((s) => s.trigger === "manual");
    expect(manual.length).toBeGreaterThan(0);
    for (const s of manual) expect(belgradeParts(s.startedAt).hour).toBeGreaterThanOrEqual(10);
    expect(sessions.some((s) => s.tag === "personal") && sessions.some((s) => s.tag === "business")).toBe(true);
  });

  it("issues four statements: older paid, the last one issued and due", async () => {
    const b = backend("wallbox");
    const [point] = (await b.currentUser()).chargePoints;
    const statements = await b.statements(point!.id);
    expect(statements).toHaveLength(4);
    expect(statements.map((s) => s.status)).toEqual(["issued", "paid", "paid", "paid"]);
    expect(statements[0]!.month).toEqual({ year: 2026, month: 9 });
    expect(statementDueDate(statements[0]!).getTime()).toBe(fromBelgrade(2026, 10, 15).getTime());
    expect(statements.map((s) => s.servicePart!.isTrial)).toEqual([false, false, true, true]);
    for (const s of statements) {
      const energy = s.energyPart!;
      expect(energy.payee.accountNumber).toBe(DEMO_BUILDING_ACCOUNT);
      expect(energy.purpose).toMatch(/^PRIMER/);
      expect(parseIps(energy.qrPayload).R).toBe(DEMO_BUILDING_ACCOUNT);
      expect(statementTotal(s)).toBeGreaterThan(0);
      // Sessions of the statement are the month's sessions, and sum to its energy.
      const sum = s.sessions.reduce((a, x) => a + total(x.energy), 0);
      expect(sum).toBeCloseTo(total(s.energy), 1);
      for (const x of s.sessions) expect(monthOf(x.startedAt)).toEqual(s.month);
    }
    const active = statements[0]!.servicePart!;
    expect(active.amountRSD).toBe(990);
    expect(isValidAccount(DEMO_EVOLAKO_ACCOUNT)).toBe(true);
    const { data, width } = rasterize(encodeQr(active.qrPayload));
    expect(jsQR(data, width, width)?.data).toBe(active.qrPayload);
    const alert = (await b.alerts()).find((a) => a.kind.type === "statementReady")!;
    expect(alert.isRead).toBe(false);
    expect(alert.timestamp.getTime()).toBe(fromBelgrade(2026, 10, 1, 8, 0).getTime());
  });

  it("shows last month's statement due until the 15th and paid after it", async () => {
    const statuses = async (now: Date) => {
      const b = backend("wallbox", now);
      const [point] = (await b.currentUser()).chargePoints;
      return (await b.statements(point!.id)).map((s) => `${s.month.month}:${s.status}`);
    };
    expect(await statuses(fromBelgrade(2026, 10, 1, 9, 0))).toEqual(["9:issued", "8:paid", "7:paid", "6:paid"]);
    expect(await statuses(fromBelgrade(2026, 10, 15, 23, 59))).toEqual(["9:issued", "8:paid", "7:paid", "6:paid"]);
    expect(await statuses(fromBelgrade(2026, 10, 16, 0, 1))).toEqual(["9:paid", "8:paid", "7:paid", "6:paid"]);
    const b = backend("wallbox", fromBelgrade(2026, 10, 20, 12, 0));
    expect((await b.alerts()).filter((a) => a.kind.type === "statementReady").every((a) => a.isRead)).toBe(true);
    // The socket's one statement (a trial month on its own meter) follows the same rule.
    const socket = backend("socket", fromBelgrade(2026, 10, 20, 12, 0));
    const [point] = (await socket.currentUser()).chargePoints;
    expect((await socket.statements(point!.id)).map((s) => s.status)).toEqual(["paid"]);
  });

  it("switches between charging, idle and a fault", async () => {
    const b = backend("wallbox");
    const [point] = (await b.currentUser()).chargePoints;
    expect(b.state).toBe("live");
    expect(point!.status).toBe("charging");
    const live = await b.liveSession(point!.id);
    // 23:40 — inside the night window, so auto-start: it fired when the window opened at 23:00, 40 minutes ago.
    expect(live!.trigger).toBe("auto");
    expect(live!.startedAt.getTime()).toBe(fromBelgrade(2026, 10, 5, 23, 0).getTime());
    expect(live!.powerKW).toBeGreaterThan(10);
    expect(total(live!.energy)).toBeGreaterThan(5);
    expect(live!.costRSD).toBeGreaterThan(0);
    b.setState("idle");
    expect(b.state).toBe("idle");
    expect(await b.liveSession(point!.id)).toBeNull();
    expect((await b.currentUser()).chargePoints[0]!.status).toBe("online");
    b.setState("fault");
    expect(b.state).toBe("fault");
    expect(await b.liveSession(point!.id)).toBeNull();
    expect((await b.currentUser()).chargePoints[0]!.status).toBe("fault");
    expect((await b.alerts())[0]!.kind.type).toBe("fault");
    b.setState("live");
    expect((await b.currentUser()).chargePoints[0]!.status).toBe("charging");
    expect((await b.alerts()).some((a) => a.kind.type === "fault" && !a.isRead)).toBe(false);
  });

  it("starts the live session about 40 minutes ago: manual by day, auto inside the night window", async () => {
    const at = async (account: "wallbox" | "socket", now: Date) => {
      const b = backend(account, now);
      b.setState("live"); // the socket demo opens idle
      const [point] = (await b.currentUser()).chargePoints;
      return (await b.liveSession(point!.id))!;
    };
    const day = await at("wallbox", fromBelgrade(2026, 10, 5, 14, 0));
    expect(day.trigger).toBe("manual");
    expect(day.startedAt.getTime()).toBe(fromBelgrade(2026, 10, 5, 13, 20).getTime());
    // 01:30 is inside 23:00–07:00; the window opened long ago, so the start is simply 40 minutes back.
    const lateNight = await at("wallbox", fromBelgrade(2026, 10, 6, 1, 30));
    expect(lateNight.trigger).toBe("auto");
    expect(lateNight.startedAt.getTime()).toBe(fromBelgrade(2026, 10, 6, 0, 50).getTime());
    expect(lateNight.energy.dayKWh).toBe(0);
    // Evening before the window: manual; the start is on the minute.
    const evening = await at("wallbox", fromBelgrade(2026, 10, 5, 22, 59, 30));
    expect(evening.trigger).toBe("manual");
    expect(evening.startedAt.getTime()).toBe(fromBelgrade(2026, 10, 5, 22, 19).getTime());
    // A socket has no auto-start at all, even at night.
    const socket = await at("socket", fromBelgrade(2026, 10, 6, 1, 30));
    expect(socket.trigger).toBe("manual");
    expect(socket.powerKW).toBeNull();
  });

  it("is manual at night when the visitor turned the schedule off", async () => {
    const b = backend("wallbox");
    const [point] = (await b.currentUser()).chargePoints;
    await b.updateSchedule(point!.id, { isEnabled: false, window: { startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 } });
    const live = await b.liveSession(point!.id);
    expect(live!.trigger).toBe("manual");
    expect(live!.startedAt.getTime()).toBe(fromBelgrade(2026, 10, 5, 23, 0).getTime());
  });

  it("keeps the running session going while the page is open, and restarts it when switched back on", async () => {
    let now = fromBelgrade(2026, 10, 5, 14, 0);
    const b = backend("wallbox", () => now);
    const [point] = (await b.currentUser()).chargePoints;
    const first = await b.liveSession(point!.id);
    now = fromBelgrade(2026, 10, 5, 14, 30);
    const later = await b.liveSession(point!.id);
    expect(later!.startedAt.getTime()).toBe(first!.startedAt.getTime());
    expect(total(later!.energy)).toBeGreaterThan(total(first!.energy));
    b.setState("idle");
    now = fromBelgrade(2026, 10, 5, 16, 0);
    b.setState("live");
    const again = await b.liveSession(point!.id);
    expect(again!.startedAt.getTime()).toBe(fromBelgrade(2026, 10, 5, 15, 20).getTime());
    const alerts = (await b.alerts()).filter((a) => a.kind.type === "chargeStarted" && !a.isRead);
    expect(alerts.map((a) => a.timestamp.getTime())).toEqual([fromBelgrade(2026, 10, 5, 15, 20).getTime()]);
  });

  it("has a referral with one installed friend and one pending, a resolved report and a received move", async () => {
    const b = backend("wallbox");
    const [point] = (await b.currentUser()).chargePoints;
    const referral = await b.referralStatus();
    expect(referral.referrals.map((r) => r.status).sort()).toEqual(["installed", "sent"]);
    expect(referral.freeMonthsBalance).toBe(2);
    expect((await b.serviceRequests(point!.id)).map((r) => r.status)).toEqual(["resolved"]);
    expect((await b.relocationRequests(point!.id)).map((r) => r.status)).toEqual(["received"]);
    expect((await b.subscription()).state.type).toBe("active");
    const kinds = new Set<string>((await b.alerts()).map((a) => a.kind.type));
    for (const k of ["chargeStarted", "chargeFinished", "autostartExecuted", "statementReady"]) expect(kinds.has(k)).toBe(true);
  });

  it("keeps the socket in the trial for about three more weeks, metering only", async () => {
    const b = backend("socket");
    const [point] = (await b.currentUser()).chargePoints;
    expect(point!.capabilities).toEqual(["metering"]);
    expect(point!.connectionScheme.type).toBe("ownMeter");
    const subscription = await b.subscription();
    expect(subscription.state.type).toBe("trial");
    const until = subscription.state.type === "trial" ? subscription.state.until : NOW;
    expect(daysBetween(NOW, until)).toBeGreaterThanOrEqual(18);
    expect(daysBetween(NOW, until)).toBeLessThanOrEqual(25);
    const statements = await b.statements(point!.id);
    expect(statements.length).toBeGreaterThan(0);
    for (const s of statements) {
      expect(s.energyPart).toBeNull();
      expect(s.servicePart!.isTrial).toBe(true);
    }
    expect((await b.alerts()).some((a) => a.kind.type === "trialEnding")).toBe(true);
    await expect(b.updateSessionTag(point!.id, "x", "personal")).rejects.toMatchObject({ code: "capabilityUnavailable" });
    const prices = await b.updateTariffPrices(point!.id, { highRateRSDPerKWh: 14, lowRateRSDPerKWh: 4 });
    expect(prices.source).toBe("customerBill");
  });

  it("has a signed-in lead with the assessment booked and no charging points", async () => {
    const b = backend("lead");
    expect((await b.currentUser()).chargePoints).toEqual([]);
    const [request] = await b.installationRequests();
    expect(request!.status).toBe("assessmentScheduled");
    expect(request!.assessmentAt! > NOW).toBe(true);
    expect(request!.draft.referralCode).toBe("");
    await expect(b.createInstallationRequest(request!.draft, { lang: "sr", marketingOptIn: false }))
      .rejects.toMatchObject({ code: "installationAlreadyRequested" });
  });

  it("answers offline when the browser is offline", async () => {
    await expect(backend("wallbox", NOW, false).alerts()).rejects.toMatchObject({ code: "offline" });
  });

  it("refuses a building tariff change and a second move", async () => {
    const b = backend("wallbox");
    const [point] = (await b.currentUser()).chargePoints;
    await expect(b.updateTariffPrices(point!.id, null)).rejects.toMatchObject({ code: "tariffReadOnly" });
    await expect(b.createRelocationRequest(point!.id, { newAddress: "Nova 1, Novi Sad", desiredDate: "2026-11-01", comment: null }))
      .rejects.toMatchObject({ code: "relocationAlreadyRequested" });
  });
});

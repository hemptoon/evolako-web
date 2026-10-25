// Deterministic demo data, in exactly the JSON shapes of backend/tests/fixtures/api (ISO strings with the Belgrade
// offset), so the demo goes through the same decoders as the real API. Anchored to TODAY in Europe/Belgrade and
// seeded from the date: the same calendar day always gives the same data, the current month is in progress, last
// month's statement is issued on the 1st and due on the 15th. A wallbox in a building garage in Novi Sad with four
// months of history, a socket on its own meter in Belgrade in the middle of the trial, and a signed-in lead whose
// assessment is booked.
import {
  addDays,
  addMonths,
  atTime,
  belgradeParts,
  compareMonths,
  fromBelgrade,
  isoBelgrade,
  monthEnd,
  monthOf,
  monthStart,
  startOfDay,
  type Month,
} from "../../lib/belgrade";
import { roundHalfUp } from "../../lib/format";
import { buildIps, makePoziv } from "../../lib/payments";
import { add, cost, isNight, split, ZERO, type EnergySplit, type Window } from "../../lib/tariff";
import { referralCode, SeededRandom } from "./random";

export type DemoAccount = "wallbox" | "socket" | "lead";
export const DEMO_ACCOUNTS: DemoAccount[] = ["wallbox", "socket", "lead"];

export type J = Record<string, unknown>;

/** Placeholder accounts from the app's Config (valid mod 97, nobody must pay to them). */
export const DEMO_BUILDING_ACCOUNT = "160000000000000173";
export const DEMO_EVOLAKO_ACCOUNT = "160000000000000076";
/** Svrha plaćanja of every demo payment: even a scanned demo code says it is an example. */
export const DEMO_PURPOSE = "PRIMER - ne placaj";
export const SUBSCRIPTION_RSD = 990;

export interface DemoPoint {
  id: string;
  /** Six digits for poziv na broj. */
  number: string;
  json: J;
  window: Window;
  tariff: J;
  rates: { highRateRSDPerKWh: number; lowRateRSDPerKWh: number };
  nominal: number;
  livePower: boolean;
}

export interface DemoData {
  account: DemoAccount;
  now: Date;
  user: J;
  point: DemoPoint | null;
  schedule: J | null;
  /** Completed sessions, newest first. */
  sessions: J[];
  subscriptionStartedAt: Date;
  trialUntil: Date | null;
  /** Months that were trial months (statement months before the first paid one). */
  trialMonths: Month[];
  statementMonths: Month[];
  /** After the 15th last month's statement is paid too (it is issued on the 1st, due on the 15th). */
  latestPaid: boolean;
  alerts: J[];
  serviceRequests: J[];
  relocationRequests: J[];
  installationRequests: J[];
  referral: J;
}

const SEEDS: Record<DemoAccount, bigint> = { wallbox: 0x5eed_0001n, socket: 0x5eed_0002n, lead: 0x5eed_0003n };

/** The seed of a demo account on a Belgrade calendar day: one day, one dataset. */
export function demoSeed(account: DemoAccount, now: Date): bigint {
  const p = belgradeParts(now);
  return SEEDS[account] ^ (BigInt(p.year * 10000 + p.month * 100 + p.day) << 20n);
}

const round2 = (v: number) => roundHalfUp(v, 2);
const iso = isoBelgrade;

function energyJson(e: EnergySplit): J {
  return { nightKWh: round2(e.nightKWh), dayKWh: round2(e.dayKWh) };
}

function windowJson(w: Window): J {
  return { startHour: w.startHour, startMinute: w.startMinute, endHour: w.endHour, endMinute: w.endMinute };
}

// ---------------------------------------------------------------- points

function wallboxPoint(installedAt: Date): DemoPoint {
  const window = { startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 };
  const rates = { highRateRSDPerKWh: 19.65, lowRateRSDPerKWh: 5.7 };
  const id = "cp-wallbox-000148";
  return {
    id,
    number: "000148",
    window,
    rates,
    nominal: 11,
    livePower: true,
    tariff: { ...rates, nightWindow: windowJson(window), source: "meterOwnerBill" },
    json: {
      id,
      sku: "wallboxB",
      phases: 3,
      status: "online",
      address: "Bulevar oslobođenja 12, garaža −1, mesto 14, Novi Sad",
      location: { latitude: 45.2551, longitude: 19.8452 },
      customName: "Garaža",
      installedAt: iso(installedAt),
      capabilities: ["metering", "remoteControl", "scheduling", "livePower"],
      serialNumber: "EV-B-48213",
      nominalPowerKW: 11,
      connectionScheme: {
        type: "thirdPartyMeter",
        payee: { name: "SZ Bulevar oslobođenja 12, Novi Sad", accountNumber: DEMO_BUILDING_ACCOUNT, referenceModel: "97" },
      },
    },
  };
}

function socketPoint(installedAt: Date): DemoPoint {
  // Belgrade: EDS lower tariff 00:00–08:00 (app_config.nightWindows); prices are the service's estimate
  // until the customer copies them from the EPS bill.
  const window = { startHour: 0, startMinute: 0, endHour: 8, endMinute: 0 };
  const rates = { highRateRSDPerKWh: 19.65, lowRateRSDPerKWh: 5.7 };
  const id = "cp-socket-000207";
  return {
    id,
    number: "000207",
    window,
    rates,
    nominal: 3.7,
    livePower: false,
    tariff: { ...rates, nightWindow: windowJson(window), source: "estimate" },
    json: {
      id,
      sku: "socketA",
      phases: 1,
      status: "online",
      address: "Ustanička 45, garaža −2, Beograd",
      location: { latitude: 44.7884, longitude: 20.4905 },
      customName: null,
      installedAt: iso(installedAt),
      capabilities: ["metering"],
      serialNumber: "EV-A-20714",
      nominalPowerKW: 3.7,
      connectionScheme: { type: "ownMeter" },
    },
  };
}

// ---------------------------------------------------------------- sessions

function makeSessions(account: DemoAccount, point: DemoPoint, from: Date, now: Date, random: SeededRandom): J[] {
  const out: J[] = [];
  const wallbox = account === "wallbox";
  // History ends where today begins (today's charge is the live session); a session still running now is not history.
  const today = startOfDay(now);
  let weekStart = startOfDay(from);
  let index = 0;
  while (weekStart <= today) {
    const count = random.int(wallbox ? 2 : 3, wallbox ? 4 : 5);
    const used = new Set<number>();
    for (let i = 0; i < count; i++) {
      let offset = random.int(0, 6);
      for (let n = 0; used.has(offset) && n < 7; n++) offset = (offset + 1) % 7;
      used.add(offset);
      const day = addDays(weekStart, offset);
      const isNight = random.chance(wallbox ? 0.85 : 0.8);
      let startedAt: Date;
      let totalKWh: number;
      let power: number;
      let trigger: "auto" | "manual";
      if (wallbox) {
        startedAt = isNight ? atTime(day, 23, random.int(0, 3)) : atTime(day, random.int(10, 18), random.int(0, 59));
        totalKWh = isNight ? random.double(8, 35) : random.double(4, 12);
        power = point.nominal * random.double(0.88, 0.98);
        trigger = isNight ? "auto" : "manual";
      } else {
        // A socket has no auto-start: plugged in before bed or topped up in the afternoon.
        startedAt = isNight ? atTime(day, 22, random.int(15, 59)) : atTime(day, random.int(13, 18), random.int(0, 59));
        totalKWh = isNight ? random.double(10, 20) : random.double(4, 9);
        power = 3.3 * random.double(0.92, 1.0);
        trigger = "manual";
      }
      const endedAt = new Date(startedAt.getTime() + (totalKWh / power) * 3600_000);
      if (startedAt < from || startedAt >= today || endedAt > now) continue;
      index += 1;
      const tag = wallbox
        ? (random.chance(0.15) ? null
          : isNight ? (random.chance(0.85) ? "personal" : "business") : (random.chance(0.7) ? "business" : "personal"))
        : null;
      out.push({
        id: `session-${point.number}-${String(index).padStart(3, "0")}`,
        tag,
        energy: energyJson(split(point.window, roundHalfUp(totalKWh, 1), startedAt, endedAt)),
        endedAt: iso(new Date(Math.round(endedAt.getTime() / 60000) * 60000)),
        trigger,
        startedAt: iso(startedAt),
        chargePointID: point.id,
      });
    }
    weekStart = addDays(weekStart, 7);
  }
  return out.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
}

// ---------------------------------------------------------------- statements

export function sessionEnergy(s: J): EnergySplit {
  const e = s.energy as { nightKWh: number; dayKWh: number };
  return { nightKWh: e.nightKWh, dayKWh: e.dayKWh };
}

export function sessionsInMonth(sessions: J[], m: Month): J[] {
  const from = monthStart(m).getTime();
  const to = monthEnd(m).getTime();
  return sessions
    .filter((s) => {
      const t = new Date(String(s.startedAt)).getTime();
      return t >= from && t < to;
    })
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

/** A statement in the backend's shape (j_statement), derived from the current sessions (tags included). */
export function statementJson(data: DemoData, m: Month, paid: boolean): J {
  const point = data.point!;
  const sessions = sessionsInMonth(data.sessions, m);
  const energy = sessions.reduce<EnergySplit>((sum, s) => add(sum, sessionEnergy(s)), ZERO);
  const yyyymm = `${m.year}${String(m.month).padStart(2, "0")}`;
  const scheme = point.json.connectionScheme as J;
  let energyPart: J | null = null;
  if (scheme.type === "thirdPartyMeter") {
    const payee = scheme.payee as { name: string; accountNumber: string; referenceModel: string };
    const amount = cost(point.rates, energy);
    const poziv = makePoziv("97", `1${yyyymm}${point.number}`)!;
    energyPart = {
      payee,
      tariff: point.tariff,
      purpose: DEMO_PURPOSE,
      amountRSD: amount,
      qrPayload: buildIps({ account: payee.accountNumber, payeeName: payee.name, amount, purpose: DEMO_PURPOSE, poziv }),
      pozivNaBroj: poziv,
    };
  }
  const trial = data.trialMonths.some((t) => compareMonths(t, m) === 0);
  const payee = { name: "Evolako, Novi Sad", accountNumber: DEMO_EVOLAKO_ACCOUNT, referenceModel: "97" };
  const servicePoziv = makePoziv("97", `2${yyyymm}${point.number}`)!;
  const serviceAmount = trial ? 0 : SUBSCRIPTION_RSD;
  const servicePart: J = {
    payee,
    isTrial: trial,
    amountRSD: serviceAmount,
    // As the backend: "" when there is nothing to pay (trial month).
    qrPayload: trial ? "" : buildIps({ account: payee.accountNumber, payeeName: payee.name, amount: serviceAmount,
      purpose: DEMO_PURPOSE, poziv: servicePoziv }),
    pozivNaBroj: servicePoziv,
  };
  return {
    month: { year: m.year, month: m.month },
    energy: energyJson(energy),
    status: paid ? "paid" : "issued",
    // No dueDate, like the app's mock: the web app applies the rule (15th of the next month).
    sessions,
    energyPart,
    servicePart,
    chargePointID: point.id,
  };
}

// ---------------------------------------------------------------- the accounts

export function generateDemo(account: DemoAccount, now: Date): DemoData {
  const random = new SeededRandom(demoSeed(account, now));
  const current = monthOf(now);
  const today = startOfDay(now);

  if (account === "lead") {
    const created = atTime(addDays(now, -1), 19, 10);
    let assessment = atTime(addDays(now, 2), 10, 0);
    // Assessments are booked on working days.
    const wd = belgradeParts(assessment).weekday;
    if (wd >= 5) assessment = atTime(addDays(assessment, 7 - wd), 10, 0);
    return {
      account,
      now,
      user: { id: "demo-lead", lang: "sr", name: "Ana Marković", email: "ana@example.com", phone: "", chargePoints: [] },
      point: null,
      schedule: null,
      sessions: [],
      subscriptionStartedAt: now,
      trialUntil: null,
      trialMonths: [],
      statementMonths: [],
      latestPaid: false,
      alerts: [],
      serviceRequests: [],
      relocationRequests: [],
      installationRequests: [{
        id: "inst-demo-1042",
        requestNo: "Z-1042",
        status: "assessmentScheduled",
        createdAt: iso(created),
        updatedAt: iso(new Date(created.getTime() + 50 * 60000)),
        assessmentAt: iso(assessment),
        installationAt: null,
        draft: {
          car: "Škoda Enyaq", city: "beograd", name: "Ana Marković", email: "ana@example.com",
          phone: "+381 60 123 45 67", address: "Cara Dušana 5, Beograd", comment: "Garaža −1, mesto 27",
          package: "wallbox", parking: "zajednicka", referralCode: "", acceptsPrivacyPolicy: true,
        },
      }],
      referral: { code: referralCode("demo-lead"), link: `https://www.evolako.rs/preporuka?ref=${referralCode("demo-lead")}`,
        referrals: [], freeMonthsBalance: 0, appliesFrom: null },
    };
  }

  const wallbox = account === "wallbox";
  // Wallbox: installed on the 4th, four months ago — four statements, the first two in the trial.
  // Socket: installed 38 days ago — the trial ends in about three weeks.
  const installedAt = wallbox
    ? fromBelgrade(addMonths(current, -4).year, addMonths(current, -4).month, 4, 11, 0)
    : atTime(addDays(now, -38), 11, 30);
  const point = wallbox ? wallboxPoint(installedAt) : socketPoint(installedAt);
  const sessions = makeSessions(account, point, addDays(startOfDay(installedAt), 1), now, random);

  const installMonth = monthOf(installedAt);
  const trialUntil = wallbox ? monthStart(addMonths(installMonth, 2)) : fromBelgrade(
    belgradeParts(installedAt).year, belgradeParts(installedAt).month + 2, belgradeParts(installedAt).day);
  const statementMonths: Month[] = [];
  for (let i = 4; i >= 1; i--) {
    const m = addMonths(current, -i);
    if (monthEnd(m) > installedAt) statementMonths.push(m);
  }
  const trialMonths = statementMonths.filter((m) => monthStart(m) < trialUntil);

  const alerts: J[] = [];
  for (const [i, s] of sessions.slice(0, 5).entries()) {
    const e = sessionEnergy(s);
    alerts.push({ id: `alert-done-${s.id}`, kind: { kWh: round2(e.nightKWh + e.dayKWh), type: "chargeFinished" },
      isRead: i > 0, timestamp: s.endedAt, chargePointID: point.id });
    if (s.trigger === "auto") {
      alerts.push({ id: `alert-auto-${s.id}`, kind: { type: "autostartExecuted" }, isRead: true,
        timestamp: s.startedAt, chargePointID: point.id });
    }
  }
  // Statements are issued on the 1st of the next month (08:00); the latest is unread until it is paid.
  const latestPaid = belgradeParts(now).day > 15;
  statementMonths.forEach((m, i) => {
    const latest = i === statementMonths.length - 1;
    alerts.push({ id: `alert-statement-${m.year}-${m.month}`, kind: { type: "statementReady", month: { ...m } },
      isRead: !latest || latestPaid, timestamp: iso(atTime(monthStart(addMonths(m, 1)), 8, 0)), chargePointID: point.id });
  });

  const serviceRequests: J[] = [];
  const relocationRequests: J[] = [];
  let referral: J;
  const userId = wallbox ? "demo-wallbox" : "demo-socket";
  const code = referralCode(userId);
  if (wallbox) {
    // One resolved problem report three weeks ago (with the fault it was about) …
    const reported = atTime(addDays(now, -23), 18, 30);
    const visit = atTime(addDays(reported, 1), 10, 0);
    serviceRequests.push({
      id: "service-demo-1", status: "resolved", comment: "Auto je priključen, punjenje ne počinje",
      category: "notCharging", hasPhoto: true, createdAt: iso(reported),
      updatedAt: iso(new Date(visit.getTime() + 75 * 60000)), scheduledFor: iso(visit), chargePointID: point.id,
    });
    alerts.push({ id: "alert-fault-1", kind: { type: "fault" }, isRead: true,
      timestamp: iso(new Date(reported.getTime() - 40 * 60000)), chargePointID: point.id });
    // … and a move request received yesterday.
    const sent = atTime(addDays(now, -1), 18, 30);
    relocationRequests.push({
      id: "relocation-demo-1", status: "received", comment: "Ključ kod upravnika", createdAt: iso(sent),
      updatedAt: iso(sent), newAddress: "Njegoševa 5, Novi Sad, garaža −2",
      desiredDate: iso(startOfDay(addDays(now, 21))), scheduledFor: null, chargePointID: point.id,
    });
    const installedFriend = atTime(addDays(now, -34), 10, 0);
    referral = {
      code, link: `https://www.evolako.rs/preporuka?ref=${code}`,
      referrals: [
        { id: "ref-2", status: "sent", createdAt: iso(atTime(addDays(now, -9), 18, 0)), friendName: "Jelena S.",
          monthsAwarded: 0 },
        { id: "ref-1", status: "installed", createdAt: iso(atTime(addDays(now, -48), 18, 0)), friendName: "Marko P.",
          installedAt: iso(installedFriend), monthsAwarded: 2 },
      ],
      appliesFrom: addMonths(current, 1),
      freeMonthsBalance: 2,
    };
  } else {
    const daysLeft = Math.max(0, Math.round((trialUntil.getTime() - today.getTime()) / 86400000));
    alerts.push({ id: "alert-trial", kind: { type: "trialEnding", daysLeft }, isRead: false,
      timestamp: iso(atTime(addDays(today, -1), 9, 0)), chargePointID: point.id });
    referral = { code, link: `https://www.evolako.rs/preporuka?ref=${code}`, referrals: [], freeMonthsBalance: 0,
      appliesFrom: null };
  }

  return {
    account,
    now,
    user: {
      id: userId,
      lang: "sr",
      name: wallbox ? "Mila Ilić" : "Stefan Marković",
      email: wallbox ? "mila@example.com" : "stefan@example.com",
      phone: "",
      chargePoints: [point.json],
    },
    point,
    schedule: { window: windowJson(point.window), isEnabled: wallbox },
    sessions,
    subscriptionStartedAt: startOfDay(installedAt),
    trialUntil,
    trialMonths,
    statementMonths,
    latestPaid,
    alerts: alerts.filter((a) => new Date(String(a.timestamp)) <= now)
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp))),
    serviceRequests,
    relocationRequests,
    installationRequests: [{
      id: `inst-${userId}`,
      requestNo: wallbox ? "Z-1001" : "Z-1009",
      status: "installed",
      createdAt: iso(addDays(installedAt, -12)),
      updatedAt: iso(installedAt),
      assessmentAt: iso(atTime(addDays(installedAt, -7), 10, 0)),
      installationAt: iso(installedAt),
      draft: {
        car: wallbox ? "Renault Zoe" : "Dacia Spring", city: wallbox ? "novisad" : "beograd",
        name: wallbox ? "Mila Ilić" : "Stefan Marković", email: wallbox ? "mila@example.com" : "stefan@example.com",
        phone: "", address: wallbox ? "Bulevar oslobođenja 12" : "Ustanička 45", comment: "",
        package: wallbox ? "wallbox" : "start", parking: wallbox ? "zajednicka" : "iznajmljena", referralCode: "",
        acceptsPrivacyPolicy: true,
      },
    }],
    referral,
  };
}

/**
 * When the demo live session started: about 40 minutes ago. It is an auto-start when the point has a schedule and
 * now is inside the night window (never earlier than the window opened — that is when auto-start fires), else a
 * manual charge.
 */
export function defaultLiveStart(point: DemoPoint, schedule: J | null, now: Date): { at: Date; trigger: "auto" | "manual" } {
  const minute = Math.floor(now.getTime() / 60000) * 60000;
  const at = new Date(minute - 40 * 60000);
  const canSchedule = ((point.json.capabilities as string[]) ?? []).includes("scheduling");
  const scheduled = canSchedule && Boolean(schedule && (schedule as { isEnabled?: boolean }).isEnabled);
  const w = scheduled && schedule?.window ? (schedule.window as Window) : point.window;
  if (scheduled && isNight(w, now)) {
    const p = belgradeParts(now);
    const since = (p.hour * 60 + p.minute - (w.startHour * 60 + w.startMinute) + 1440) % 1440;
    const opened = minute - since * 60000;
    return { at: new Date(Math.max(at.getTime(), opened)), trigger: "auto" };
  }
  return { at, trigger: "manual" };
}

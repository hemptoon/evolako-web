// Decoders: backend JSON (contract shape) → models. The same functions read the demo data, so demo and
// remote go through one path. Unknown fields are ignored; a missing or malformed required field is a bug of
// the server, reported as InvalidResponseError (never shown as "no connection").
import { fromBelgrade } from "../lib/belgrade";
import { FX_BOUNDS, isCurrency, type FxRates } from "../lib/format";
import {
  CAPABILITIES,
  PACKAGE_IDS,
  type Alert,
  type AlertKind,
  type CancelResult,
  type Capability,
  type ChargePoint,
  type ChargingSchedule,
  type ChargingSession,
  type City,
  type ConnectionScheme,
  type EnergyPart,
  type EnergySplit,
  type InstallationDraft,
  type InstallationRequest,
  type LiveSession,
  type MeterReading,
  type MeterReadings,
  type Month,
  type PackageId,
  type PointActivity,
  type Parking,
  type Payee,
  type PozivNaBroj,
  type Referral,
  type ReferralStatus,
  type RelocationRequest,
  type ServicePart,
  type ServiceRequest,
  type Statement,
  type Subscription,
  type SubscriptionState,
  type TariffConfig,
  type User,
  type Window,
} from "./types";

export class InvalidResponseError extends Error {
  constructor(public readonly path: string, detail: string) {
    super(`Invalid response at ${path}: ${detail}`);
    this.name = "InvalidResponseError";
  }
}

type J = Record<string, unknown>;

function fail(path: string, detail: string): never {
  throw new InvalidResponseError(path, detail);
}

export function obj(v: unknown, path: string): J {
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail(path, "expected an object");
  return v as J;
}

export function arr<T>(v: unknown, path: string, item: (x: unknown, p: string) => T): T[] {
  if (!Array.isArray(v)) fail(path, "expected an array");
  return v.map((x, i) => item(x, `${path}[${i}]`));
}

function str(o: J, key: string, path: string): string {
  const v = o[key];
  if (typeof v !== "string") fail(`${path}.${key}`, "expected a string");
  return v;
}

function optStr(o: J, key: string, path: string): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") fail(`${path}.${key}`, "expected a string");
  return v;
}

function num(o: J, key: string, path: string): number {
  const v = o[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // PostgreSQL numeric can arrive as a string from some drivers.
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  fail(`${path}.${key}`, "expected a number");
}

function optNum(o: J, key: string, path: string): number | null {
  const v = o[key];
  return v === undefined || v === null ? null : num(o, key, path);
}

function bool(o: J, key: string, path: string): boolean {
  const v = o[key];
  if (typeof v !== "boolean") fail(`${path}.${key}`, "expected a boolean");
  return v;
}

function oneOf<T extends string>(o: J, key: string, path: string, values: readonly T[]): T {
  const v = str(o, key, path);
  if (!values.includes(v as T)) fail(`${path}.${key}`, `unexpected value "${v}"`);
  return v as T;
}

/** ISO 8601 with an offset or Z (fractional seconds allowed), or a bare day "2026-10-06" (Belgrade midnight). */
export function parseDate(v: unknown, path: string): Date {
  if (typeof v !== "string") fail(path, "expected a date string");
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (day) return fromBelgrade(Number(day[1]), Number(day[2]), Number(day[3]));
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v)) fail(path, `bad date "${v}"`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(path, `bad date "${v}"`);
  return d;
}

function date(o: J, key: string, path: string): Date {
  return parseDate(o[key], `${path}.${key}`);
}

function optDate(o: J, key: string, path: string): Date | null {
  const v = o[key];
  return v === undefined || v === null ? null : parseDate(v, `${path}.${key}`);
}

// ---------------------------------------------------------------- pieces

export function parseMonth(v: unknown, path: string): Month {
  const o = obj(v, path);
  const month = num(o, "month", path);
  if (month < 1 || month > 12) fail(`${path}.month`, "out of range");
  return { year: num(o, "year", path), month };
}

export function parseEnergy(v: unknown, path: string): EnergySplit {
  const o = obj(v, path);
  return { nightKWh: num(o, "nightKWh", path), dayKWh: num(o, "dayKWh", path) };
}

export function parseWindow(v: unknown, path: string): Window {
  const o = obj(v, path);
  return {
    startHour: num(o, "startHour", path),
    startMinute: num(o, "startMinute", path),
    endHour: num(o, "endHour", path),
    endMinute: num(o, "endMinute", path),
  };
}

export function parsePayee(v: unknown, path: string): Payee {
  const o = obj(v, path);
  return { name: str(o, "name", path), accountNumber: str(o, "accountNumber", path),
    referenceModel: str(o, "referenceModel", path) };
}

function parsePoziv(v: unknown, path: string): PozivNaBroj | null {
  if (v === undefined || v === null) return null;
  const o = obj(v, path);
  return { model: str(o, "model", path), reference: str(o, "reference", path) };
}

function parseScheme(v: unknown, path: string): ConnectionScheme {
  const o = obj(v, path);
  const type = oneOf(o, "type", path, ["ownMeter", "thirdPartyMeter"] as const);
  return type === "ownMeter" ? { type } : { type, payee: parsePayee(o.payee, `${path}.payee`) };
}

// ---------------------------------------------------------------- models

export function parseChargePoint(v: unknown, path = "chargePoint"): ChargePoint {
  const o = obj(v, path);
  const sku = oneOf(o, "sku", path, ["socketA", "wallboxB"] as const);
  // Capabilities are the source of truth for the UI; unknown ones (a future kit) are skipped, not fatal.
  const capabilities = arr(o.capabilities, `${path}.capabilities`, (x, p) => {
    if (typeof x !== "string") fail(p, "expected a string");
    return x;
  }).filter((c): c is Capability => (CAPABILITIES as string[]).includes(c));
  const name = optStr(o, "customName", path)?.trim();
  const location = o.location == null ? null : (() => {
    const l = obj(o.location, `${path}.location`);
    return { latitude: num(l, "latitude", `${path}.location`), longitude: num(l, "longitude", `${path}.location`) };
  })();
  return {
    id: str(o, "id", path),
    customName: name ? name.slice(0, 24) : null,
    address: str(o, "address", path),
    sku,
    capabilities,
    status: oneOf(o, "status", path, ["online", "offline", "charging", "fault"] as const),
    serialNumber: str(o, "serialNumber", path),
    installedAt: date(o, "installedAt", path),
    connectionScheme: parseScheme(o.connectionScheme, `${path}.connectionScheme`),
    nominalPowerKW: num(o, "nominalPowerKW", path),
    phases: optNum(o, "phases", path) ?? (sku === "wallboxB" ? 3 : 1),
    location,
  };
}

export function parseUser(v: unknown, path = "user"): User {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    name: optStr(o, "name", path) ?? "",
    phone: optStr(o, "phone", path) ?? "",
    email: optStr(o, "email", path),
    lang: optStr(o, "lang", path),
    // 1.11.3: an older server does not send it — RSD; an unknown value is not a reason to fail the whole user.
    displayCurrency: isCurrency(o.displayCurrency) ? o.displayCurrency : "RSD",
    chargePoints: arr(o.chargePoints ?? [], `${path}.chargePoints`, parseChargePoint),
  };
}

export function parseSession(v: unknown, path = "session"): ChargingSession {
  const o = obj(v, path);
  const tag = o.tag == null ? null : oneOf(o, "tag", path, ["personal", "business"] as const);
  return {
    id: str(o, "id", path),
    chargePointID: str(o, "chargePointID", path),
    startedAt: date(o, "startedAt", path),
    endedAt: date(o, "endedAt", path),
    energy: parseEnergy(o.energy, `${path}.energy`),
    trigger: oneOf(o, "trigger", path, ["auto", "manual"] as const),
    tag,
  };
}

export function parseSessions(v: unknown): ChargingSession[] {
  return arr(v, "sessions", parseSession);
}

export function parseLiveSession(v: unknown, path = "liveSession"): LiveSession | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  return {
    chargePointID: str(o, "chargePointID", path),
    startedAt: date(o, "startedAt", path),
    powerKW: optNum(o, "powerKW", path),
    energy: parseEnergy(o.energy, `${path}.energy`),
    costRSD: num(o, "costRSD", path),
    trigger: oneOf(o, "trigger", path, ["auto", "manual"] as const),
  };
}

export function parseTariff(v: unknown, path = "tariff"): TariffConfig {
  const o = obj(v, path);
  return {
    highRateRSDPerKWh: num(o, "highRateRSDPerKWh", path),
    lowRateRSDPerKWh: num(o, "lowRateRSDPerKWh", path),
    nightWindow: parseWindow(o.nightWindow, `${path}.nightWindow`),
    source: o.source == null ? "estimate"
      : oneOf(o, "source", path, ["estimate", "customerBill", "meterOwnerBill"] as const),
  };
}

export function parseSchedule(v: unknown, path = "schedule"): ChargingSchedule {
  const o = obj(v, path);
  return { isEnabled: bool(o, "isEnabled", path), window: parseWindow(o.window, `${path}.window`) };
}

function parseSubscriptionState(v: unknown, path: string): SubscriptionState {
  const o = obj(v, path);
  const type = oneOf(o, "type", path, ["trial", "active", "paused", "none"] as const);
  switch (type) {
    case "trial": return { type, until: date(o, "until", path) };
    // The history of api_subscription sends {"type": "paused"} without monthsUsed.
    case "paused": return { type, monthsUsed: optNum(o, "monthsUsed", path) ?? 0 };
    default: return { type };
  }
}

export function parseSubscription(v: unknown, path = "subscription"): Subscription {
  const o = obj(v, path);
  const endsOn = o.endsOn == null ? null : String(o.endsOn).slice(0, 10);
  return {
    state: parseSubscriptionState(o.state, `${path}.state`),
    startedAt: date(o, "startedAt", path),
    endsOn,
    history: arr(o.history ?? [], `${path}.history`, (x, p) => {
      const e = obj(x, p);
      return { month: parseMonth(e.month, `${p}.month`), state: parseSubscriptionState(e.state, `${p}.state`),
        amountRSD: num(e, "amountRSD", p) };
    }),
    activatedAt: optDate(o, "activatedAt", path),
    trialStartsBy: optDate(o, "trialStartsBy", path),
    suspendedSince: optDate(o, "suspendedSince", path),
    unpaid: o.unpaid == null ? null : (() => {
      const u = obj(o.unpaid, `${path}.unpaid`);
      return { month: parseMonth(u.month, `${path}.unpaid.month`), amountRSD: num(u, "amountRSD", `${path}.unpaid`) };
    })(),
    keptFreeMonths: o.keptFreeMonths == null ? null : (() => {
      const kept = obj(o.keptFreeMonths, `${path}.keptFreeMonths`);
      return { months: num(kept, "months", `${path}.keptFreeMonths`), until: date(kept, "until", `${path}.keptFreeMonths`) };
    })(),
  };
}

const READING_STATUSES = ["submitted", "accepted", "rejected"] as const;

function parseReading(v: unknown, path: string): MeterReading {
  const o = obj(v, path);
  return {
    id: num(o, "id", path),
    valueKWh: num(o, "valueKWh", path),
    readAt: date(o, "readAt", path),
    month: parseMonth(o.month, `${path}.month`),
    status: oneOf(o, "status", path, READING_STATUSES),
    note: optStr(o, "note", path),
    photoPath: optStr(o, "photoPath", path),
  };
}

/** api_meter_readings (1.14): whether the point is read by photo, the last accepted value, the last 12 readings. */
export function parseMeterReadings(v: unknown, path = "meterReadings"): MeterReadings {
  const o = obj(v, path);
  const last = o.lastAccepted == null ? null : obj(o.lastAccepted, `${path}.lastAccepted`);
  return {
    required: o.required === true,
    lastAccepted: last ? { valueKWh: num(last, "valueKWh", `${path}.lastAccepted`), readAt: date(last, "readAt", `${path}.lastAccepted`) } : null,
    readings: arr(o.readings ?? [], `${path}.readings`, parseReading),
  };
}

/** api_mark_point_activity (1.14). */
export function parsePointActivity(v: unknown, path = "pointActivity"): PointActivity {
  const o = obj(v, path);
  return { started: o.started === true, activatedAt: optDate(o, "activatedAt", path) };
}

function parseEnergyPart(v: unknown, path: string): EnergyPart | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  return {
    amountRSD: num(o, "amountRSD", path),
    payee: parsePayee(o.payee, `${path}.payee`),
    pozivNaBroj: parsePoziv(o.pozivNaBroj, `${path}.pozivNaBroj`),
    qrPayload: optStr(o, "qrPayload", path) ?? "",
    tariff: parseTariff(o.tariff, `${path}.tariff`),
    purpose: optStr(o, "purpose", path),
  };
}

function parseServicePart(v: unknown, path: string): ServicePart | null {
  if (v === null || v === undefined) return null;
  const o = obj(v, path);
  return {
    amountRSD: num(o, "amountRSD", path),
    payee: parsePayee(o.payee, `${path}.payee`),
    pozivNaBroj: parsePoziv(o.pozivNaBroj, `${path}.pozivNaBroj`),
    qrPayload: optStr(o, "qrPayload", path) ?? "",
    isTrial: o.isTrial === true,
    purpose: optStr(o, "purpose", path),
    proration: o.proration == null ? null : (() => {
      const p = obj(o.proration, `${path}.proration`);
      return { paidDays: num(p, "paidDays", `${path}.proration`), monthDays: num(p, "monthDays", `${path}.proration`) };
    })(),
  };
}

export function parseStatement(v: unknown, path = "statement"): Statement {
  const o = obj(v, path);
  return {
    month: parseMonth(o.month, `${path}.month`),
    chargePointID: str(o, "chargePointID", path),
    sessions: arr(o.sessions ?? [], `${path}.sessions`, parseSession),
    energy: parseEnergy(o.energy, `${path}.energy`),
    energyPart: parseEnergyPart(o.energyPart, `${path}.energyPart`),
    servicePart: parseServicePart(o.servicePart, `${path}.servicePart`),
    status: oneOf(o, "status", path, ["issued", "paid"] as const),
    dueDate: optDate(o, "dueDate", path),
    energyEstimated: o.energyEstimated === true,
  };
}

export function parseStatements(v: unknown): Statement[] {
  return arr(v, "statements", parseStatement);
}

function parseAlertKind(v: unknown, path: string): AlertKind | null {
  const o = obj(v, path);
  const type = str(o, "type", path);
  switch (type) {
    case "chargeStarted":
    case "fault":
    case "wentOffline":
    case "autostartExecuted":
      return { type };
    case "chargeFinished": return { type, kWh: num(o, "kWh", path) };
    case "statementReady": return { type, month: parseMonth(o.month, `${path}.month`) };
    case "trialEnding": return { type, daysLeft: num(o, "daysLeft", path) };
    // A kind this version does not know yet is skipped: the feed must not break on a new event type.
    default: return null;
  }
}

export function parseAlerts(v: unknown): Alert[] {
  const out: Alert[] = [];
  arr(v, "alerts", (x, p) => {
    const o = obj(x, p);
    const kind = parseAlertKind(o.kind, `${p}.kind`);
    if (kind) {
      out.push({ id: str(o, "id", p), kind, timestamp: date(o, "timestamp", p),
        chargePointID: str(o, "chargePointID", p), isRead: bool(o, "isRead", p) });
    }
    return null;
  });
  return out;
}

export function parseServiceRequest(v: unknown, path = "serviceRequest"): ServiceRequest {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    chargePointID: str(o, "chargePointID", path),
    category: oneOf(o, "category", path, ["notCharging", "notVisible", "damaged", "other"] as const),
    comment: optStr(o, "comment", path),
    hasPhoto: o.hasPhoto === true,
    createdAt: date(o, "createdAt", path),
    status: oneOf(o, "status", path, ["received", "scheduled", "resolved"] as const),
    updatedAt: date(o, "updatedAt", path),
    scheduledFor: optDate(o, "scheduledFor", path),
  };
}

export function parseServiceRequests(v: unknown): ServiceRequest[] {
  return arr(v, "serviceRequests", parseServiceRequest);
}

export function parseRelocationRequest(v: unknown, path = "relocationRequest"): RelocationRequest {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    chargePointID: str(o, "chargePointID", path),
    newAddress: str(o, "newAddress", path),
    desiredDate: date(o, "desiredDate", path),
    comment: optStr(o, "comment", path),
    createdAt: date(o, "createdAt", path),
    status: oneOf(o, "status", path, ["received", "scheduled", "completed"] as const),
    updatedAt: date(o, "updatedAt", path),
    scheduledFor: optDate(o, "scheduledFor", path),
  };
}

export function parseRelocationRequests(v: unknown): RelocationRequest[] {
  return arr(v, "relocationRequests", parseRelocationRequest);
}

function parseDraft(v: unknown, path: string): InstallationDraft {
  const o = obj(v, path);
  const opt = (key: string) => optStr(o, key, path) ?? "";
  const city = opt("city");
  const parking = opt("parking");
  const pkg = opt("package");
  return {
    name: opt("name"),
    phone: opt("phone"),
    email: opt("email"),
    city: (["beograd", "novisad", "vojvodina", "ostatak"] as string[]).includes(city) ? city as City : null,
    address: opt("address"),
    parking: (["iznajmljena", "svoja", "zajednicka", "kuca", "kompanija"] as string[]).includes(parking)
      ? parking as Parking : null,
    package: (PACKAGE_IDS as string[]).includes(pkg) ? pkg as PackageId : null,
    car: opt("car"),
    comment: opt("comment"),
    referralCode: opt("referralCode"),
    acceptsPrivacyPolicy: o.acceptsPrivacyPolicy === true,
  };
}

export function parseInstallationRequest(v: unknown, path = "installationRequest"): InstallationRequest {
  const o = obj(v, path);
  return {
    id: str(o, "id", path),
    draft: parseDraft(o.draft, `${path}.draft`),
    createdAt: date(o, "createdAt", path),
    status: oneOf(o, "status", path,
      ["received", "assessmentScheduled", "installationScheduled", "installed"] as const),
    updatedAt: date(o, "updatedAt", path),
    assessmentAt: optDate(o, "assessmentAt", path),
    installationAt: optDate(o, "installationAt", path),
    requestNo: optStr(o, "requestNo", path),
  };
}

export function parseInstallationRequests(v: unknown): InstallationRequest[] {
  return arr(v, "installationRequests", parseInstallationRequest);
}

export function parseReferralStatus(v: unknown, path = "referralStatus"): ReferralStatus {
  const o = obj(v, path);
  return {
    code: str(o, "code", path),
    link: str(o, "link", path),
    referrals: arr(o.referrals ?? [], `${path}.referrals`, (x, p): Referral => {
      const r = obj(x, p);
      const reason = r.notEligibleReason == null ? null
        : oneOf(r, "notEligibleReason", p, ["ownCode", "sameAddress", "existingCustomer", "codeAfterInstallation"] as const);
      return {
        id: str(r, "id", p),
        friendName: str(r, "friendName", p),
        status: oneOf(r, "status", p, ["sent", "installed", "notEligible"] as const),
        notEligibleReason: reason,
        createdAt: date(r, "createdAt", p),
        installedAt: optDate(r, "installedAt", p),
        monthsAwarded: optNum(r, "monthsAwarded", p) ?? 0,
      };
    }),
    freeMonthsBalance: optNum(o, "freeMonthsBalance", path) ?? 0,
    appliesFrom: o.appliesFrom == null ? null : parseMonth(o.appliesFrom, `${path}.appliesFrom`),
  };
}

export function parseCancelResult(v: unknown): CancelResult {
  const o = obj(v, "cancel");
  return { endsOn: o.endsOn == null ? null : String(o.endsOn).slice(0, 10), already: o.already === true,
    freeMonthsKept: optNum(o, "freeMonthsKept", "cancel") ?? 0 };
}

/**
 * The content document `fx` (VALUTA_SPEC §2): RSD per 1 EUR / 1 USD at the NBS middle rate. A rate outside the
 * sanity bounds is not a rate: the document is rejected and the last good one (or the fallback) stays.
 */
export function parseFx(v: unknown, path = "fx"): FxRates {
  const o = obj(v, path);
  if (o.base !== "RSD") fail(`${path}.base`, "expected RSD");
  const date = str(o, "date", path);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(`${path}.date`, "expected YYYY-MM-DD");
  const rates = obj(o.rates, `${path}.rates`);
  const rate = (code: "EUR" | "USD") => {
    const value = num(rates, code, `${path}.rates`);
    const [min, max] = FX_BOUNDS[code];
    if (!(value >= min && value <= max)) fail(`${path}.rates.${code}`, `out of ${min}–${max}`);
    return value;
  };
  return {
    base: "RSD",
    source: optStr(o, "source", path) ?? "NBS srednji kurs",
    date,
    rates: { EUR: rate("EUR"), USD: rate("USD") },
    fetchedAt: optStr(o, "fetchedAt", path),
    stale: o.stale === true,
  };
}

/** Decoder for every fixture file of backend/tests/fixtures/api, by file name. */
export const FIXTURE_DECODERS: Record<string, (v: unknown) => unknown> = {
  "alerts.json": parseAlerts,
  "chargePoint.json": (v) => parseChargePoint(v),
  "currentUser.json": (v) => parseUser(v),
  "fx.json": (v) => parseFx(v),
  "guest_installationRequests.json": parseInstallationRequests,
  "installationRequests.json": parseInstallationRequests,
  "liveSession.json": (v) => parseLiveSession(v),
  "meterReadings.json": (v) => parseMeterReadings(v),
  "pointActivity.json": (v) => parsePointActivity(v),
  "referralStatus.json": (v) => parseReferralStatus(v),
  "relocationRequests.json": parseRelocationRequests,
  "schedule.json": (v) => parseSchedule(v),
  "serviceRequests.json": parseServiceRequests,
  "sessions.json": parseSessions,
  "statement_2026_09.json": (v) => parseStatement(v),
  "statements.json": parseStatements,
  "subscription.json": (v) => parseSubscription(v),
  "subscription_pending.json": (v) => parseSubscription(v),
  "tariff.json": (v) => parseTariff(v),
};

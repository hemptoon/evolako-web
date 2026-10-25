// DemoBackend — the Backend interface over deterministic demo data. Every answer is contract JSON run through the
// same decoders as the remote API. Changes the visitor makes (a renamed point, tags, the night window, requests…)
// live in localStorage for this demo account only, so a reload keeps them; "Izađi iz demoa" forgets them.
// The live session is not stored: it starts about 40 minutes before the moment the demo opens (or is switched to
// "charging") and keeps running while the page is open.
import { addMonths, isoBelgrade, monthEnd, monthOf, type Month } from "../../lib/belgrade";
import { checkReading } from "../../lib/readings";
import type { Currency } from "../../lib/format";
import { cost, split } from "../../lib/tariff";
import type { StorageLike } from "../auth";
import type { Backend, InstallationMeta } from "../backend";
import { BackendError } from "../errors";
import {
  parseAlerts,
  parseCancelResult,
  parseChargePoint,
  parseInstallationRequest,
  parseInstallationRequests,
  parseLiveSession,
  parseMeterReadings,
  parsePointActivity,
  parseReferralStatus,
  parseRelocationRequest,
  parseRelocationRequests,
  parseSchedule,
  parseServiceRequest,
  parseServiceRequests,
  parseSession,
  parseSessions,
  parseStatement,
  parseStatements,
  parseSubscription,
  parseTariff,
  parseUser,
} from "../parse";
import { normalizeDraft } from "../remote";
import type {
  ChargingSchedule,
  InstallationDraft,
  RelocationDraft,
  ServiceDraft,
  SessionTag,
  TariffPrices,
} from "../types";
import { defaultLiveStart, generateDemo, statementJson, type DemoAccount, type DemoData, type J } from "./data";

export interface DemoOverrides {
  customName?: string | null;
  tags?: Record<string, SessionTag | null>;
  schedule?: J;
  /** undefined — unchanged; null — back to the estimate. */
  tariffPrices?: TariffPrices | null;
  read?: string[];
  live?: boolean;
  fault?: boolean;
  serviceRequests?: J[];
  relocationRequests?: J[];
  installationRequests?: J[];
  pausedMonths?: number;
  endsOn?: string | null;
  marketing?: boolean;
  analyticsOptOut?: boolean;
  /** Meter readings the visitor sent (newest first); the photos themselves live in memory only. */
  readings?: J[];
}

export interface DemoDeps {
  storage: StorageLike | null;
  now: () => Date;
  online: () => boolean;
  /** Simulated network latency, ms. */
  latency: number;
}

const LIVE_POWER: Record<string, number> = { wallboxB: 10.8, socketA: 3.3 };

/** What the demo menu switches between: charging now, idle on the network, or a fault. */
export type DemoPointState = "live" | "idle" | "fault";

export class DemoBackend implements Backend {
  readonly kind = "demo" as const;
  private readonly data: DemoData;
  private overrides: DemoOverrides;
  private readonly key: string;
  /** The running session's start, fixed at first use so the charge keeps going while the page is open. */
  private live: { at: Date; trigger: "auto" | "manual" } | null = null;
  private faultAt: Date | null = null;
  /** Photos of the readings sent in this visit, by their path (never stored: a reload keeps the rows, not the pictures). */
  private readonly photos = new Map<string, Blob>();

  constructor(readonly account: DemoAccount, private readonly deps: DemoDeps) {
    this.data = generateDemo(account, deps.now());
    this.key = `evo.demo.${account}`;
    this.overrides = this.load();
    if (this.overrides.live === undefined) this.overrides.live = account === "wallbox";
  }

  // ------------------------------------------------------------ demo controls

  get isLive(): boolean {
    return this.overrides.live === true && this.data.point !== null;
  }

  get hasFault(): boolean {
    return this.overrides.fault === true && this.data.point !== null;
  }

  /** The point's state in the demo; a fault wins over charging, as on the real point. */
  get state(): DemoPointState {
    return this.hasFault ? "fault" : this.isLive ? "live" : "idle";
  }

  setState(state: DemoPointState): void {
    if (state === this.state) return;
    this.overrides.live = state === "live";
    this.overrides.fault = state === "fault";
    // Switching to charging starts a fresh session (about 40 minutes ago); a new fault is a few minutes old.
    this.live = null;
    this.faultAt = null;
    this.save();
  }

  get marketingConsent(): boolean {
    return this.overrides.marketing === true;
  }

  get analyticsOptOut(): boolean {
    return this.overrides.analyticsOptOut === true;
  }

  reset(): void {
    try {
      this.deps.storage?.removeItem(this.key);
    } catch {
      // nothing stored
    }
    this.overrides = { live: this.account === "wallbox" };
    this.live = null;
    this.faultAt = null;
  }

  // ------------------------------------------------------------ plumbing

  private load(): DemoOverrides {
    try {
      const raw = this.deps.storage?.getItem(this.key);
      if (!raw) return {};
      // Older builds stored the live start; it is now always "about 40 minutes ago" when the demo opens.
      const { liveStart: _start, liveTrigger: _trigger, ...rest } = JSON.parse(raw) as DemoOverrides & J;
      return rest as DemoOverrides;
    } catch {
      return {};
    }
  }

  private save(): void {
    try {
      this.deps.storage?.setItem(this.key, JSON.stringify(this.overrides));
    } catch {
      // storage full or blocked: the change lasts until reload
    }
  }

  private async reply<T>(make: () => T): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, this.deps.latency));
    if (!this.deps.online()) throw new BackendError("offline");
    return make();
  }

  private point() {
    if (!this.data.point) throw new BackendError("guestMode");
    return this.data.point;
  }

  private requirePoint(id: string) {
    const point = this.point();
    if (point.id !== id) throw new BackendError("chargePointNotFound");
    return point;
  }

  private can(capability: string): boolean {
    return ((this.data.point?.json.capabilities as string[]) ?? []).includes(capability);
  }

  private pointJson(): J {
    const point = this.point();
    const status = this.hasFault ? "fault" : this.isLive ? "charging" : "online";
    const customName = this.overrides.customName !== undefined ? this.overrides.customName : point.json.customName;
    return { ...point.json, customName, status };
  }

  private sessionsJson(): J[] {
    const tags = this.overrides.tags ?? {};
    return this.data.sessions.map((s) => (String(s.id) in tags ? { ...s, tag: tags[String(s.id)] } : s));
  }

  private tariffJson(): J {
    const point = this.point();
    const prices = this.overrides.tariffPrices;
    if (prices && (point.json.connectionScheme as J).type === "ownMeter") {
      return { ...point.tariff, highRateRSDPerKWh: prices.highRateRSDPerKWh, lowRateRSDPerKWh: prices.lowRateRSDPerKWh,
        source: "customerBill" };
    }
    return point.tariff;
  }

  private liveStart(): { at: Date; trigger: "auto" | "manual" } {
    this.live ??= defaultLiveStart(this.point(), this.scheduleJson(), this.deps.now());
    return this.live;
  }

  private liveJson(): J | null {
    if (!this.isLive || this.hasFault) return null;
    const point = this.point();
    const now = this.deps.now();
    const { at, trigger } = this.liveStart();
    const sku = String(point.json.sku);
    const average = LIVE_POWER[sku] ?? 3.3;
    const hours = Math.max(0, (now.getTime() - at.getTime()) / 3600_000);
    const energy = split(point.window, average * hours, at, now);
    const tariff = this.tariffJson() as { highRateRSDPerKWh: number; lowRateRSDPerKWh: number };
    // Live power breathes a little around the average, as a real charger does.
    const minute = Math.floor(now.getTime() / 60000);
    const power = Math.round((average + 0.12 * Math.sin(minute / 3)) * 10) / 10;
    return {
      energy: { nightKWh: Math.round(energy.nightKWh * 100) / 100, dayKWh: Math.round(energy.dayKWh * 100) / 100 },
      costRSD: cost(tariff, energy),
      powerKW: point.livePower ? power : null,
      trigger,
      startedAt: isoBelgrade(at),
      chargePointID: point.id,
    };
  }

  private scheduleJson(): J {
    return this.overrides.schedule ?? this.data.schedule ?? {};
  }

  private statementsJson(): J[] {
    const months = [...this.data.statementMonths].reverse();
    const data = { ...this.data, sessions: this.sessionsJson() };
    // The latest statement is due on the 15th; after that it is paid too.
    return months.map((m, i) => statementJson(data, m, i > 0 || this.data.latestPaid));
  }

  private subscriptionJson(): J {
    const d = this.data;
    const iso = isoBelgrade;
    if (!d.point) {
      return { state: { type: "none" }, startedAt: iso(d.now), endsOn: null, history: [] };
    }
    const history = [...d.statementMonths].reverse().map((m) => {
      const trial = d.trialMonths.some((t) => t.year === m.year && t.month === m.month);
      return {
        month: { ...m },
        state: trial ? { type: "trial", until: iso(d.trialUntil!) } : { type: "active" },
        amountRSD: trial ? 0 : 990,
      };
    });
    const inTrial = d.trialUntil !== null && d.trialUntil > this.deps.now();
    const paused = this.overrides.pausedMonths ?? 0;
    const state = paused > 0 ? { type: "paused", monthsUsed: paused }
      : inTrial ? { type: "trial", until: iso(d.trialUntil!) } : { type: "active" };
    // The demo's free period started on the day of the installation; a cancelled one keeps its free months a year.
    const free = Number(d.referral?.freeMonthsBalance ?? 0);
    const endsOn = this.overrides.endsOn ?? null;
    const kept = endsOn && free > 0
      ? { months: free, until: `${Number(endsOn.slice(0, 4)) + 1}${endsOn.slice(4)}T00:00:00+01:00` } : undefined;
    return { state, startedAt: iso(d.subscriptionStartedAt), activatedAt: iso(d.subscriptionStartedAt), endsOn, history,
      keptFreeMonths: kept };
  }

  /** Read by photo: billed by the MID meter and nothing comes from the station (private.needs_photo_readings). */
  private readByPhoto(): boolean {
    const caps = (this.data.point?.json.capabilities as string[]) ?? [];
    return caps.includes("metering")
      && !["connectivity", "cellular", "remoteControl", "livePower"].some((c) => caps.includes(c));
  }

  /**
   * The demo's readings, newest first: the installer's base reading, one accepted at the end of every finished month
   * (what the sessions added up to), then what the visitor sent.
   */
  private readingsJson(): J[] {
    const point = this.point();
    const now = this.deps.now();
    const installed = new Date(String(point.json.installedAt));
    const rows: J[] = [{ id: 1, valueKWh: 0, readAt: isoBelgrade(installed), month: { ...monthOf(installed) },
      status: "accepted", source: "technician", chargePointID: point.id }];
    let id = 1;
    for (let m = monthOf(installed); monthEnd(m) <= now; m = addMonths(m, 1)) {
      const at = new Date(monthEnd(m).getTime() - 5 * 3600_000);          // the last evening of the month, 19:00
      if (at <= installed) continue;
      const total = this.data.sessions
        .filter((s) => new Date(String(s.startedAt)) < at)
        .reduce((sum, s) => sum + Number((s.energy as J).nightKWh) + Number((s.energy as J).dayKWh), 0);
      rows.unshift({ id: ++id, valueKWh: Math.round(total * 10) / 10, readAt: isoBelgrade(at), month: { ...m },
        status: "accepted", source: "app_photo", chargePointID: point.id });
    }
    return [...(this.overrides.readings ?? []), ...rows].slice(0, 12);
  }

  private meterReadingsJson(): J {
    const readings = this.readingsJson();
    const last = readings.find((r) => r.status === "accepted");
    return { chargePointID: this.point().id, required: this.readByPhoto(), readings,
      lastAccepted: last ? { valueKWh: last.valueKWh, readAt: last.readAt } : undefined };
  }

  private alertsJson(): J[] {
    const read = new Set(this.overrides.read ?? []);
    const extra: J[] = [];
    const point = this.data.point;
    if (point && this.isLive && !this.hasFault) {
      const { at, trigger } = this.liveStart();
      extra.push({ id: `alert-live-start-${at.getTime()}`, kind: { type: "chargeStarted" }, isRead: false,
        timestamp: isoBelgrade(at), chargePointID: point.id });
      if (trigger === "auto") {
        extra.push({ id: `alert-live-auto-${at.getTime()}`, kind: { type: "autostartExecuted" }, isRead: false,
          timestamp: isoBelgrade(at), chargePointID: point.id });
      }
    }
    if (point && this.hasFault) {
      this.faultAt ??= new Date(Math.floor(this.deps.now().getTime() / 60000) * 60000 - 6 * 60000);
      extra.push({ id: "alert-fault-now", kind: { type: "fault" }, isRead: false,
        timestamp: isoBelgrade(this.faultAt), chargePointID: point.id });
    }
    return [...extra, ...this.data.alerts]
      .map((a) => (read.has(String(a.id)) ? { ...a, isRead: true } : a))
      .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)));
  }

  // ------------------------------------------------------------ Backend

  currentUser() {
    return this.reply(() => parseUser({ ...this.data.user, chargePoints: this.data.point ? [this.pointJson()] : [] }));
  }

  chargePoint(id: string) {
    return this.reply(() => {
      this.requirePoint(id);
      return parseChargePoint(this.pointJson());
    });
  }

  updateChargePointName(id: string, name: string | null) {
    return this.reply(() => {
      this.requirePoint(id);
      const trimmed = name?.trim() ?? "";
      if (trimmed.length > 24) throw new BackendError("chargePointNameTooLong");
      this.overrides.customName = trimmed || null;
      this.save();
      return parseChargePoint(this.pointJson());
    });
  }

  sessions(pointId: string, from: Date, to: Date) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseSessions(this.sessionsJson().filter((s) => {
        const t = new Date(String(s.startedAt));
        return t >= from && t < to;
      }));
    });
  }

  updateSessionTag(pointId: string, sessionId: string, tag: SessionTag | null) {
    return this.reply(() => {
      this.requirePoint(pointId);
      if (!this.can("remoteControl")) throw new BackendError("capabilityUnavailable");
      const session = this.sessionsJson().find((s) => s.id === sessionId);
      if (!session) throw new BackendError("sessionNotFound");
      this.overrides.tags = { ...(this.overrides.tags ?? {}), [sessionId]: tag };
      this.save();
      return parseSession({ ...session, tag });
    });
  }

  liveSession(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseLiveSession(this.liveJson());
    });
  }

  schedule(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseSchedule(this.scheduleJson());
    });
  }

  updateSchedule(pointId: string, schedule: ChargingSchedule) {
    return this.reply(() => {
      this.requirePoint(pointId);
      if (!this.can("scheduling")) throw new BackendError("capabilityUnavailable");
      this.overrides.schedule = { isEnabled: schedule.isEnabled, window: { ...schedule.window } };
      this.save();
    });
  }

  tariff(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseTariff(this.tariffJson());
    });
  }

  updateTariffPrices(pointId: string, prices: TariffPrices | null) {
    return this.reply(() => {
      const point = this.requirePoint(pointId);
      if ((point.json.connectionScheme as J).type !== "ownMeter") throw new BackendError("tariffReadOnly");
      this.overrides.tariffPrices = prices;
      this.save();
      return parseTariff(this.tariffJson());
    });
  }

  statements(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseStatements(this.statementsJson());
    });
  }

  statement(pointId: string, month: Month) {
    return this.reply(() => {
      this.requirePoint(pointId);
      const found = this.statementsJson().find((s) => {
        const m = s.month as Month;
        return m.year === month.year && m.month === month.month;
      });
      return found ? parseStatement(found) : null;
    });
  }

  subscription() {
    return this.reply(() => parseSubscription(this.subscriptionJson()));
  }

  requestSubscriptionPause() {
    return this.reply(() => {
      const current = this.subscriptionJson().state as { type: string };
      const used = this.overrides.pausedMonths ?? 0;
      if (current.type !== "active" || used >= 3) throw new BackendError("pauseNotAvailable");
      this.overrides.pausedMonths = used + 1;
      this.save();
      return parseSubscription(this.subscriptionJson());
    });
  }

  cancelSubscription() {
    return this.reply(() => {
      const freeMonthsKept = Number(this.data.referral?.freeMonthsBalance ?? 0);
      if (this.overrides.endsOn) return parseCancelResult({ endsOn: this.overrides.endsOn, already: true, freeMonthsKept });
      // Effective at the end of this month, or at the end of the free period if that is later.
      const now = this.deps.now();
      const lastDay = new Date(monthEnd(monthOf(now)).getTime() - 12 * 3600_000);
      const trialEnd = this.data.trialUntil ? new Date(this.data.trialUntil.getTime() - 12 * 3600_000) : null;
      const end = trialEnd && trialEnd > lastDay ? trialEnd : lastDay;
      this.overrides.endsOn = isoBelgrade(end).slice(0, 10);
      this.save();
      return parseCancelResult({ endsOn: this.overrides.endsOn, already: false, freeMonthsKept });
    });
  }

  resumeSubscription() {
    return this.reply(() => {
      this.overrides.endsOn = null;
      this.overrides.pausedMonths = 0;
      this.save();
      return parseSubscription(this.subscriptionJson());
    });
  }

  referralStatus() {
    return this.reply(() => parseReferralStatus(this.data.referral));
  }

  meterReadings(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseMeterReadings(this.meterReadingsJson());
    });
  }

  submitMeterReading(pointId: string, valueKWh: number, photo: Blob) {
    return this.reply(() => {
      const point = this.requirePoint(pointId);
      if (!Number.isFinite(valueKWh) || valueKWh < 0 || !photo) throw new BackendError("meterReadingIncomplete");
      const now = this.deps.now();
      const value = Math.round(valueKWh * 1000) / 1000;
      const last = parseMeterReadings(this.meterReadingsJson()).lastAccepted;
      const verdict = checkReading(value, last, now);
      if (verdict === "tooLow") throw new BackendError("meterReadingTooLow");
      const id = Date.now();
      const photoPath = `demo/${id}.jpg`;
      this.photos.set(photoPath, photo);
      // As on the server: a plausible value is accepted at once, anything else waits for a person.
      const month = monthOf(new Date(now.getTime() - 3 * 86_400_000));
      this.overrides.readings = [{ id, valueKWh: value, readAt: isoBelgrade(now), month,
        status: last && verdict === "ok" ? "accepted" : "submitted", source: "app_photo", photoPath, chargePointID: point.id },
        ...(this.overrides.readings ?? [])];
      this.save();
      return id;
    });
  }

  readingPhoto(photoPath: string) {
    return this.reply(() => {
      const photo = this.photos.get(photoPath);
      if (!photo) throw new BackendError("offline");
      return photo;
    });
  }

  /** The demo's free period started with the installation: nothing to start. */
  markPointActivity(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parsePointActivity({ started: false, activatedAt: isoBelgrade(this.data.subscriptionStartedAt) });
    });
  }

  alerts() {
    return this.reply(() => parseAlerts(this.alertsJson()));
  }

  markAlertRead(id: string) {
    return this.reply(() => {
      this.overrides.read = [...new Set([...(this.overrides.read ?? []), id])];
      this.save();
    });
  }

  createServiceRequest(pointId: string, draft: ServiceDraft) {
    return this.reply(() => {
      const point = this.requirePoint(pointId);
      const comment = draft.comment?.trim().slice(0, 500) || null;
      if (draft.category === "other" && !comment) throw new BackendError("serviceRequestIncomplete");
      const now = isoBelgrade(this.deps.now());
      const request: J = {
        id: `service-demo-${Date.now()}`, status: "received", comment, category: draft.category,
        hasPhoto: draft.photo !== null, createdAt: now, updatedAt: now, scheduledFor: null, chargePointID: point.id,
      };
      this.overrides.serviceRequests = [request, ...(this.overrides.serviceRequests ?? [])];
      this.save();
      return parseServiceRequest(request);
    });
  }

  serviceRequests(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseServiceRequests([...(this.overrides.serviceRequests ?? []), ...this.data.serviceRequests]);
    });
  }

  createRelocationRequest(pointId: string, draft: RelocationDraft) {
    return this.reply(() => {
      const point = this.requirePoint(pointId);
      const all = [...(this.overrides.relocationRequests ?? []), ...this.data.relocationRequests];
      if (all.some((r) => r.status !== "completed")) throw new BackendError("relocationAlreadyRequested");
      const address = draft.newAddress.trim();
      if (address.length < 5 || address.length > 200 || !/^\d{4}-\d{2}-\d{2}$/.test(draft.desiredDate)) {
        throw new BackendError("relocationRequestIncomplete");
      }
      const now = isoBelgrade(this.deps.now());
      const request: J = {
        id: `relocation-demo-${Date.now()}`, status: "received", comment: draft.comment?.trim() || null,
        createdAt: now, updatedAt: now, newAddress: address, desiredDate: draft.desiredDate, scheduledFor: null,
        chargePointID: point.id,
      };
      this.overrides.relocationRequests = [request, ...(this.overrides.relocationRequests ?? [])];
      this.save();
      return parseRelocationRequest(request);
    });
  }

  relocationRequests(pointId: string) {
    return this.reply(() => {
      this.requirePoint(pointId);
      return parseRelocationRequests([...(this.overrides.relocationRequests ?? []), ...this.data.relocationRequests]);
    });
  }

  createInstallationRequest(draft: InstallationDraft, meta: InstallationMeta) {
    return this.reply(() => {
      const all = [...(this.overrides.installationRequests ?? []), ...this.data.installationRequests];
      if (all.some((r) => r.status !== "installed")) throw new BackendError("installationAlreadyRequested");
      const clean = normalizeDraft(draft);
      if (!clean.name || (!clean.phone && !clean.email) || !clean.city || !clean.parking || !clean.acceptsPrivacyPolicy) {
        throw new BackendError("installationRequestIncomplete");
      }
      const now = isoBelgrade(this.deps.now());
      const request: J = {
        id: `inst-demo-${Date.now()}`, requestNo: "Z-1077", status: "received", createdAt: now, updatedAt: now,
        assessmentAt: null, installationAt: null, draft: { ...clean }, source: "web", lang: meta.lang,
      };
      this.overrides.installationRequests = [request, ...(this.overrides.installationRequests ?? [])];
      this.save();
      return parseInstallationRequest(request);
    });
  }

  installationRequests() {
    return this.reply(() => parseInstallationRequests(
      [...(this.overrides.installationRequests ?? []), ...this.data.installationRequests]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))));
  }

  setMarketingConsent(granted: boolean) {
    return this.reply(() => {
      this.overrides.marketing = granted;
      this.save();
    });
  }

  setAnalyticsOptOut(optOut: boolean) {
    return this.reply(() => {
      this.overrides.analyticsOptOut = optOut;
      this.save();
    });
  }

  /** The demo keeps the currency in this browser only (src/app/currency.ts) — nothing to store here. */
  setDisplayCurrency(_currency: Currency) {
    return this.reply(() => undefined);
  }

  deleteAccount() {
    return this.reply(() => this.reset());
  }
}


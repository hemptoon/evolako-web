// RemoteBackend — the contract over HTTPS, exactly per backend/docs/API.md:
// every method is POST /rest/v1/rpc/<fn> with p_… parameters; installation requests go to the edge function with
// the x-install-id header; a service photo is uploaded to Storage first, then referenced by path.
import { isoBelgrade, type Month } from "../lib/belgrade";
import type { ContentLang, Currency } from "../lib/format";
import type { AuthSession } from "./auth";
import type { Backend, InstallationMeta } from "./backend";
import { AccountError } from "./errors";
import { body, errorFrom, send, type ApiConfig, type FetchLike } from "./http";
import {
  InvalidResponseError,
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
} from "./parse";
import type {
  ChargingSchedule,
  InstallationDraft,
  RelocationDraft,
  ServiceDraft,
  SessionTag,
  TariffPrices,
} from "./types";

/**
 * RPCs that only read: safe to send again when the answer was lost on the way (one retry on a network error).
 * Everything else — writes, new requests, uploads, deletion — is sent exactly once.
 */
export const READ_ONLY_RPCS: ReadonlySet<string> = new Set([
  "api_current_user", "api_charge_point", "api_sessions", "api_statements", "api_statement", "api_subscription",
  "api_referral_status", "api_alerts", "api_service_requests", "api_relocation_requests", "api_tariff",
  "api_schedule", "api_live_session", "api_meter_readings",
]);

export interface RemoteDeps {
  fetch: FetchLike;
  /** Anonymous id of this browser for installation requests (x-install-id), kept in localStorage. */
  installId: () => string;
  uuid: () => string;
}

/** Trims text fields and normalises the referral code, as the app does before sending (draft.normalized). */
export function normalizeDraft(draft: InstallationDraft): InstallationDraft {
  const code = draft.referralCode.replace(/\s+/g, "").toUpperCase();
  return {
    ...draft,
    name: draft.name.trim(),
    phone: draft.phone.trim(),
    email: draft.email.trim(),
    address: draft.address.trim(),
    car: draft.car.trim(),
    comment: draft.comment.trim(),
    referralCode: /^EVO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/.test(code) ? code : "",
  };
}

export class RemoteBackend implements Backend {
  readonly kind = "remote" as const;

  constructor(
    private readonly config: ApiConfig,
    private readonly auth: AuthSession,
    private readonly deps: RemoteDeps,
  ) {}

  /**
   * A request with the user's token; on 401 one refresh and one retry (a 401 was not carried out), then sign-out
   * ("sessionExpired"). A network error is retried once only for a read (`idempotent`).
   */
  private async call(path: string, init: RequestInit & { headers?: Record<string, string> },
    idempotent = false): Promise<Response> {
    const url = `${this.config.apiBase}${path}`;
    const attempt = async (token: string | null) => send(this.deps.fetch, url, {
      ...init,
      headers: { ...this.auth.headers(token), ...(init.headers ?? {}) },
    }, idempotent ? 1 : 0);
    let res = await attempt(await this.auth.accessToken());
    if (res.status === 401 && this.auth.hasSession) {
      const fresh = await this.auth.refresh();
      res = await attempt(fresh);
      if (res.status === 401) {
        await this.auth.signOut(false);
        throw new AccountError("sessionExpired");
      }
    } else if (res.status === 401) {
      throw new AccountError("sessionExpired");
    }
    if (!res.ok) throw await errorFrom(res);
    return res;
  }

  private async rpc<T>(fn: string, params: Record<string, unknown>, decode: (v: unknown) => T): Promise<T> {
    const res = await this.call(`/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    }, READ_ONLY_RPCS.has(fn));
    return decode(await body(res));
  }

  currentUser() { return this.rpc("api_current_user", {}, (v) => parseUser(v)); }
  chargePoint(id: string) { return this.rpc("api_charge_point", { p_id: id }, (v) => parseChargePoint(v)); }
  updateChargePointName(id: string, name: string | null) {
    return this.rpc("api_update_charge_point_name", { p_id: id, p_name: name }, (v) => parseChargePoint(v));
  }

  sessions(pointId: string, from: Date, to: Date) {
    return this.rpc("api_sessions", { p_id: pointId, p_from: isoBelgrade(from), p_to: isoBelgrade(to) }, parseSessions);
  }
  updateSessionTag(pointId: string, sessionId: string, tag: SessionTag | null) {
    return this.rpc("api_update_session_tag", { p_id: pointId, p_session: sessionId, p_tag: tag }, (v) => parseSession(v));
  }
  liveSession(pointId: string) { return this.rpc("api_live_session", { p_id: pointId }, (v) => parseLiveSession(v)); }

  schedule(pointId: string) { return this.rpc("api_schedule", { p_id: pointId }, (v) => parseSchedule(v)); }
  async updateSchedule(pointId: string, schedule: ChargingSchedule) {
    await this.rpc("api_update_schedule", { p_id: pointId, p_schedule: schedule }, () => undefined);
  }
  tariff(pointId: string) { return this.rpc("api_tariff", { p_id: pointId }, (v) => parseTariff(v)); }
  updateTariffPrices(pointId: string, prices: TariffPrices | null) {
    return this.rpc("api_update_tariff_prices", {
      p_id: pointId,
      p_high: prices?.highRateRSDPerKWh ?? null,
      p_low: prices?.lowRateRSDPerKWh ?? null,
    }, (v) => parseTariff(v));
  }

  statements(pointId: string) { return this.rpc("api_statements", { p_id: pointId }, parseStatements); }
  statement(pointId: string, month: Month) {
    return this.rpc("api_statement", { p_id: pointId, p_year: month.year, p_month: month.month },
      (v) => (v === null ? null : parseStatement(v)));
  }

  subscription() { return this.rpc("api_subscription", {}, (v) => parseSubscription(v)); }
  requestSubscriptionPause() { return this.rpc("api_request_subscription_pause", {}, (v) => parseSubscription(v)); }
  cancelSubscription() { return this.rpc("api_cancel_subscription", {}, parseCancelResult); }
  resumeSubscription() { return this.rpc("api_resume_subscription", {}, (v) => parseSubscription(v)); }
  referralStatus() { return this.rpc("api_referral_status", {}, (v) => parseReferralStatus(v)); }

  meterReadings(pointId: string) {
    return this.rpc("api_meter_readings", { p_id: pointId }, (v) => parseMeterReadings(v));
  }
  /** The photo goes to the private bucket `readings/<user id>/<uuid>.jpg` first; both requests are sent once. */
  async submitMeterReading(pointId: string, valueKWh: number, photo: Blob) {
    const userId = this.auth.user?.id || (await this.currentUser()).id;
    const photoPath = `${userId}/${this.deps.uuid()}.jpg`;
    await this.call(`/storage/v1/object/readings/${photoPath}`, {
      method: "POST",
      headers: { "content-type": "image/jpeg" },
      body: photo,
    });
    return this.rpc("api_submit_meter_reading", { p_id: pointId, p_value: valueKWh, p_photo_path: photoPath },
      (v) => Number(v));
  }
  async readingPhoto(photoPath: string) {
    // "<user id>/<file>" as the server stored it; nothing else is ever asked for.
    if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/.test(photoPath)) throw new InvalidResponseError("readingPhoto", "not a photo path");
    const res = await this.call(`/storage/v1/object/authenticated/readings/${photoPath}`, { method: "GET" }, true);
    return res.blob();
  }
  markPointActivity(pointId: string) {
    return this.rpc("api_mark_point_activity", { p_point: pointId }, (v) => parsePointActivity(v));
  }

  alerts() { return this.rpc("api_alerts", {}, parseAlerts); }
  async markAlertRead(id: string) { await this.rpc("api_mark_alert_read", { p_alert: id }, () => undefined); }

  async createServiceRequest(pointId: string, draft: ServiceDraft) {
    let photoPath: string | null = null;
    if (draft.photo) {
      const userId = this.auth.user?.id || (await this.currentUser()).id;
      photoPath = `${userId}/${this.deps.uuid()}.jpg`;
      await this.call(`/storage/v1/object/tickets/${photoPath}`, {
        method: "POST",
        headers: { "content-type": "image/jpeg" },
        body: draft.photo,
      });
    }
    return this.rpc("api_create_service_request", {
      p_id: pointId,
      p_category: draft.category,
      p_comment: draft.comment,
      p_photo_path: photoPath,
    }, (v) => parseServiceRequest(v));
  }
  serviceRequests(pointId: string) { return this.rpc("api_service_requests", { p_id: pointId }, parseServiceRequests); }

  createRelocationRequest(pointId: string, draft: RelocationDraft) {
    return this.rpc("api_create_relocation_request", {
      p_id: pointId,
      p_new_address: draft.newAddress,
      p_desired_date: draft.desiredDate,
      p_comment: draft.comment,
    }, (v) => parseRelocationRequest(v));
  }
  relocationRequests(pointId: string) {
    return this.rpc("api_relocation_requests", { p_id: pointId }, parseRelocationRequests);
  }

  async createInstallationRequest(draft: InstallationDraft, meta: InstallationMeta) {
    const res = await this.call("/functions/v1/installation-requests", {
      method: "POST",
      headers: { "content-type": "application/json", "x-install-id": this.deps.installId() },
      body: JSON.stringify({ ...normalizeDraft(draft), source: "web", lang: meta.lang, marketingOptIn: meta.marketingOptIn }),
    });
    return parseInstallationRequest(await body(res));
  }
  async installationRequests() {
    const res = await this.call("/functions/v1/installation-requests", {
      method: "GET",
      headers: { "x-install-id": this.deps.installId() },
    }, true);
    return parseInstallationRequests(await body(res));
  }

  async setMarketingConsent(granted: boolean) {
    await this.rpc("set_marketing_consent", { granted, source: "web" }, () => undefined);
  }
  async setAnalyticsOptOut(optOut: boolean) {
    await this.rpc("set_analytics_opt_out", { opt_out: optOut }, () => undefined);
  }

  /**
   * Display currency — the same way the app writes it (and lang): PATCH of the own profile row, the column is
   * opened by `grant update (display_currency)`. A write: sent once, never retried by itself.
   */
  async setDisplayCurrency(currency: Currency) {
    const userId = this.auth.user?.id || (await this.currentUser()).id;
    await this.call(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ display_currency: currency }),
    });
  }

  /**
   * The account's language (mails, statements), the way the app writes it: PATCH of the own profile row (`grant update
   * (lang)`). Used after the first sign-in with Google — an ID token carries no language, an e-mail code does.
   */
  async setProfileLang(lang: ContentLang) {
    const userId = this.auth.user?.id || (await this.currentUser()).id;
    await this.call(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify({ lang }),
    });
  }

  /** Deletes the account on the server; the session then forgets it locally (afterAccountDeleted). */
  async deleteAccount() {
    await this.call("/functions/v1/account-delete", { method: "POST" });
  }
}

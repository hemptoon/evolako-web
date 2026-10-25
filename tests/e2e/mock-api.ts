// A fake backend for the e2e tests: /config.json points the app at https://api.evolako.rs and every request to
// that origin is answered here from the contract fixtures (tests/fixtures/api). Nothing leaves the machine.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page, Request, Route } from "@playwright/test";

export const API = "https://api.evolako.rs";
export const KEY = "sb_publishable_e2e_test";
export const GOOD_CODE = "123456";
export const ACCESS = "access-token-1";

const FIXTURES = fileURLToPath(new URL("../fixtures/api", import.meta.url));
export const fixture = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));

/** One answer of the newsletter function, or "abort": the connection drops before any answer. */
export type NewsletterAnswer = { status: number; body: unknown } | "abort";

export interface MockOptions {
  /** E-mails for which /auth/v1/otp answers 429. */
  rateLimited?: string[];
  /** The status api_statement answers with (the fixture statement_2026_09.json is "paid"). */
  statementStatus?: "paid" | "issued";
  /**
   * Answers of POST /functions/v1/newsletter (Evolako pismo: confirm, unsubscribe): one per request in this order (the
   * last one repeats), or a function of the request body. Default: 200 {ok: true, status: "confirmed"}.
   */
  newsletter?: NewsletterAnswer[] | ((body: { action?: string }) => NewsletterAnswer);
  /** displayCurrency of api_current_user (default: the fixture's "RSD"); a PATCH of the profile changes it. */
  displayCurrency?: "RSD" | "EUR" | "USD";
  /** The content document fx: "ok" (the fixture fx.json through the manifest, default), "down" (503) or a document. */
  fx?: "ok" | "down" | Record<string, unknown>;
  // ---- 1.14: meter readings by photo, the free period, the subscription's new states
  /** api_meter_readings: default — a point that reports by itself ({required: false}); "fixture" — meterReadings.json. */
  readings?: "fixture" | Record<string, unknown>;
  /** What api_submit_meter_reading answers: the reading's number (default), a contract error by name, or no connection. */
  submitReading?: "ok" | "meterReadingTooLow" | "rateLimited" | "abort";
  /** Replaces the answer of api_subscription (default: the fixture subscription.json). */
  subscription?: Record<string, unknown>;
  /** Merged into the answer of api_statement (energyEstimated, a servicePart with proration…). */
  statement?: Record<string, unknown>;
  /** api_cancel_subscription (default {endsOn: "2026-10-31", already: false}). */
  cancel?: Record<string, unknown>;
  /** app_config.features in the content document `config` (default: no such document — everything on). */
  features?: Record<string, boolean>;
  /** Sign-in with Google: config.json carries the client ID and these origins (default: no Google in config.json). */
  google?: { origins: string[] };
  /** What /auth/v1/token?grant_type=id_token answers: a session of a new account (default), of an old one, or 400. */
  googleToken?: "new" | "existing" | "refused";
  /**
   * Answers of POST /functions/v1/account-delete ("Obriši nalog"): one per request in this order (the last one
   * repeats) — an HTTP status (200 answers {ok: true}) or "abort": the connection drops. Default: 200.
   */
  accountDelete?: Array<number | "abort">;
}

export const GOOGLE_CLIENT = "936328602255-httlmmrs4ktooaechkqrslmvduh6t0pg.apps.googleusercontent.com";

/** A tiny valid JPEG-ish body for the thumbnail of a reading (1×1 PNG bytes do as well: the test checks the request). */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");

export interface Recorded {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: body === undefined ? "" : JSON.stringify(body),
  });
}

function parseBody(request: Request): unknown {
  try {
    return request.postDataJSON();
  } catch {
    return request.postData();
  }
}

const RPC: Record<string, () => unknown> = {
  api_current_user: () => fixture("currentUser.json"),
  api_charge_point: () => fixture("chargePoint.json"),
  api_tariff: () => fixture("tariff.json"),
  api_schedule: () => fixture("schedule.json"),
  api_live_session: () => fixture("liveSession.json"),
  api_sessions: () => fixture("sessions.json"),
  api_statements: () => fixture("statements.json"),
  api_statement: () => fixture("statement_2026_09.json"),
  api_subscription: () => fixture("subscription.json"),
  api_referral_status: () => fixture("referralStatus.json"),
  api_alerts: () => fixture("alerts.json"),
  api_service_requests: () => fixture("serviceRequests.json"),
  api_relocation_requests: () => fixture("relocationRequests.json"),
  api_mark_point_activity: () => fixture("pointActivity.json"),
  api_mark_alert_read: () => null,
  api_update_schedule: () => null,
  set_marketing_consent: () => null,
  set_analytics_opt_out: () => null,
};

/** Installs /config.json and the API routes on the page; returns the log of API requests. */
export async function mockApi(page: Page, options: MockOptions = {}): Promise<Recorded[]> {
  const log: Recorded[] = [];
  let displayCurrency = options.displayCurrency;
  let cancelled: { endsOn: string; already: boolean; freeMonthsKept?: number } | null = null;
  const readings = (options.readings === "fixture" ? fixture("meterReadings.json")
    : options.readings ?? { required: false, readings: [] }) as { required: boolean; readings: Array<Record<string, unknown>>; lastAccepted?: unknown };
  await page.route("**/config.json", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ apiBase: API, publishableKey: KEY, demo: true,
      ...(options.google ? { googleClientId: GOOGLE_CLIENT, googleOrigins: options.google.origins } : {}) }) }));
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*",
        // "*" does not cover Authorization: list the headers the client sends.
        "access-control-allow-headers": "apikey, authorization, content-type, x-install-id, x-client-info, prefer",
        "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
      } });
    }
    // Content without releases (the rate of the display currency): answered, not logged — it is not an API call
    // of the account and goes out on every start, also on the public pages.
    if (url.pathname.startsWith("/content/")) {
      if (options.fx === "down") return route.fulfill({ status: 503, headers: { "access-control-allow-origin": "*" }, body: "" });
      const fx = typeof options.fx === "object" ? Buffer.from(JSON.stringify(options.fx)) : readFileSync(join(FIXTURES, "fx.json"));
      const sha256 = createHash("sha256").update(fx).digest("hex");
      const path = `v1/fx.${sha256.slice(0, 12)}.json`;
      const config = options.features
        ? Buffer.from(JSON.stringify({ schema: "evolako.config/1", values: { features: options.features }, banners: [] })) : null;
      const configPath = config ? `v1/config.${createHash("sha256").update(config).digest("hex").slice(0, 12)}.json` : "";
      if (url.pathname === "/content/v1/manifest.json") {
        return json(route, 200, { schema: "evolako.manifest/1", release: 1, generatedAt: "2026-10-06T06:10:00Z",
          files: { fx: { path, sha256, bytes: fx.length, schemaVersion: 1 },
            ...(config ? { config: { path: configPath, bytes: config.length, schemaVersion: 1 } } : {}) } });
      }
      if (config && url.pathname === `/content/${configPath}`) {
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: config });
      }
      if (url.pathname === `/content/${path}`) {
        return route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: fx });
      }
      return json(route, 404, { error: "not mocked", path: url.pathname });
    }
    const body = parseBody(request);
    log.push({ method: request.method(), path: url.pathname + url.search, headers: request.headers(), body });

    if (url.pathname === "/auth/v1/otp") {
      const email = (body as { email?: string })?.email ?? "";
      if (options.rateLimited?.includes(email)) return json(route, 429, { code: 429, msg: "email rate limit exceeded" });
      return json(route, 200, {});
    }
    if (url.pathname === "/auth/v1/verify") {
      const token = (body as { token?: string })?.token;
      if (token !== GOOD_CODE) return json(route, 403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return json(route, 200, {
        access_token: ACCESS,
        refresh_token: "refresh-token-1",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "aaaaaaaa-0000-4000-8000-000000000001", email: (body as { email: string }).email },
      });
    }
    if (url.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "id_token") {
      if (options.googleToken === "refused") return json(route, 400, { code: 400, error_code: "bad_jwt", msg: "Bad ID token" });
      const createdAt = options.googleToken === "existing" ? "2026-09-29T20:00:00Z" : new Date().toISOString();
      return json(route, 200, { access_token: ACCESS, refresh_token: "refresh-token-g", expires_in: 3600, token_type: "bearer",
        user: { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "mila@gmail.com", created_at: createdAt } });
    }
    if (url.pathname === "/auth/v1/token") {
      return json(route, 200, { access_token: "access-token-2", refresh_token: "refresh-token-2", expires_in: 3600, token_type: "bearer" });
    }
    const rpc = /^\/rest\/v1\/rpc\/(\w+)$/.exec(url.pathname)?.[1];
    if (rpc === "api_statement" && (options.statementStatus || options.statement)) {
      return json(route, 200, { ...(fixture("statement_2026_09.json") as object),
        ...(options.statementStatus ? { status: options.statementStatus } : {}), ...(options.statement ?? {}) });
    }
    if (rpc === "api_subscription") {
      const subscription = (options.subscription ?? fixture("subscription.json")) as Record<string, unknown>;
      // After "Otkaži pretplatu" the server says when it ends and what is kept.
      return json(route, 200, cancelled ? { ...subscription, endsOn: cancelled.endsOn,
        ...(cancelled.freeMonthsKept ? { keptFreeMonths: { months: cancelled.freeMonthsKept, until: "2027-10-31T00:00:00+01:00" } } : {}) }
        : subscription);
    }
    if (rpc === "api_cancel_subscription") {
      cancelled = { endsOn: "2026-10-31", already: false, ...(options.cancel ?? {}) } as typeof cancelled;
      return json(route, 200, cancelled);
    }
    if (rpc === "api_meter_readings") return json(route, 200, readings);
    if (rpc === "api_submit_meter_reading") {
      const answer = options.submitReading ?? "ok";
      if (answer === "abort") return route.abort("internetdisconnected");
      if (answer !== "ok") return json(route, 400, { code: "P0001", details: null, hint: null, message: answer });
      const sent = body as { p_value: number; p_photo_path: string };
      const id = 100 + readings.readings.length;
      // As the server: the newest first, accepted at once (the mocked value is always plausible), the new base.
      readings.readings.unshift({ id, valueKWh: sent.p_value, readAt: new Date().toISOString(), status: "accepted",
        month: { year: 2026, month: 10 }, source: "app_photo", photoPath: sent.p_photo_path });
      readings.lastAccepted = { valueKWh: sent.p_value, readAt: new Date().toISOString() };
      return json(route, 200, id);
    }
    if (url.pathname.startsWith("/storage/v1/object/readings/") && request.method() === "POST") {
      return json(route, 200, { Key: url.pathname.replace("/storage/v1/object/", "") });
    }
    if (url.pathname.startsWith("/storage/v1/object/authenticated/readings/") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PIXEL });
    }
    if (rpc === "api_current_user") {
      const user = fixture("currentUser.json") as Record<string, unknown>;
      return json(route, 200, displayCurrency ? { ...user, displayCurrency } : user);
    }
    if (rpc && RPC[rpc]) return json(route, 200, RPC[rpc]!());
    if (url.pathname === "/rest/v1/profiles" && request.method() === "PATCH") {
      const next = (body as { display_currency?: "RSD" | "EUR" | "USD" })?.display_currency;
      if (next) displayCurrency = next;
      return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
    }
    if (url.pathname === "/functions/v1/newsletter" && request.method() === "POST") {
      const queue = options.newsletter ?? [];
      const answer = (typeof queue === "function" ? queue((body ?? {}) as { action?: string })
        : queue.length > 1 ? queue.shift() : queue[0]) ?? { status: 200, body: { ok: true, status: "confirmed" } };
      if (answer === "abort") return route.abort("internetdisconnected");
      return json(route, answer.status, answer.body);
    }
    if (url.pathname === "/functions/v1/installation-requests") return json(route, 200, []);
    if (url.pathname === "/functions/v1/account-delete" && request.method() === "POST") {
      const queue = options.accountDelete ?? [];
      const answer = (queue.length > 1 ? queue.shift() : queue[0]) ?? 200;
      if (answer === "abort") return route.abort("internetdisconnected");
      return json(route, answer, answer === 200 ? { ok: true } : { ok: false, error: answer === 401 ? "auth" : "server" });
    }
    return json(route, 404, { error: "not mocked", path: url.pathname });
  });
  return log;
}

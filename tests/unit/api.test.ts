import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AuthSession, LOCK_NAME, REFRESH_KEY, SIGN_OUT_WAIT_MS, USER_KEY, type LocksLike, type StorageLike } from "../../src/api/auth";
import { AccountError, BackendError } from "../../src/api/errors";
import { accessHeaders, errorFrom } from "../../src/api/http";
import { FIXTURE_DECODERS, InvalidResponseError, parseCancelResult, parseStatement, parseSubscription, parseUser } from "../../src/api/parse";
import { normalizeDraft, READ_ONLY_RPCS, RemoteBackend } from "../../src/api/remote";
import type { InstallationDraft } from "../../src/api/types";

const FIXTURES = join(__dirname, "../fixtures/api");
const fixture = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
const API = "https://api.evolako.rs";
const KEY = "sb_publishable_test123";

class MemoryStorage implements StorageLike {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
  removeItem(k: string) { this.map.delete(k); }
}

/** A Web Locks stand-in: exclusive per name, records every acquisition. */
class FakeLocks implements LocksLike {
  names: string[] = [];
  private tail = new Map<string, Promise<unknown>>();
  request<T>(name: string, cb: () => Promise<T>): Promise<T> {
    this.names.push(name);
    const prev = this.tail.get(name) ?? Promise.resolve();
    const next = prev.then(cb, cb);
    this.tail.set(name, next.catch(() => undefined));
    return next;
  }
}

interface Call { url: string; method: string; headers: Record<string, string>; body: unknown; signal: AbortSignal | null }

function json(status: number, body: unknown): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

/** fetch mock: a queue of handlers by URL fragment; records every call. */
function mockFetch(routes: Array<[string, (call: Call) => Response | Promise<Response>]>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)
      .map(([k, v]) => [k.toLowerCase(), v]));
    let body: unknown = init?.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { /* raw */ } }
    const call = { url, method: init?.method ?? "GET", headers, body, signal: init?.signal ?? null };
    calls.push(call);
    const index = routes.findIndex(([fragment]) => url.includes(fragment));
    if (index < 0) throw new Error(`unexpected request ${url}`);
    const [, handler] = routes[index]!;
    routes.splice(index, 1);
    return handler(call);
  });
  return { fn, calls };
}

function setup(routes: Array<[string, (call: Call) => Response | Promise<Response>]>, signedIn = true) {
  const storage = new MemoryStorage();
  const locks = new FakeLocks();
  if (signedIn) storage.setItem(REFRESH_KEY, "refresh-1");
  storage.setItem("evo.auth.user", JSON.stringify({ id: "aaaaaaaa-0000-4000-8000-000000000001", email: "mila@example.com" }));
  const { fn, calls } = mockFetch(routes);
  let now = 1_800_000_000_000;
  const auth = new AuthSession({ apiBase: API, publishableKey: KEY }, { fetch: fn, storage, locks, now: () => now });
  const backend = new RemoteBackend({ apiBase: API, publishableKey: KEY }, auth, {
    fetch: fn, installId: () => "11111111-2222-4333-8444-555555555555", uuid: () => "photo-uuid",
  });
  return { auth, backend, storage, locks, calls, advance: (ms: number) => { now += ms; } };
}

const tokens = (n: number, expires = 3600) => json(200, {
  access_token: `access-${n}`, refresh_token: `refresh-${n + 1}`, expires_in: expires, token_type: "bearer",
  user: { id: "aaaaaaaa-0000-4000-8000-000000000001", email: "mila@example.com" },
});

describe("contract fixtures", () => {
  it("every server fixture parses into the web models", () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
    expect(files.length).toBeGreaterThanOrEqual(15);
    for (const file of files) {
      const decode = FIXTURE_DECODERS[file];
      expect(decode, `no decoder for ${file}`).toBeTypeOf("function");
      expect(() => decode!(fixture(file)), file).not.toThrow();
    }
  });

  it("1.14: the subscription's new fields are optional — absent before the backend change, read when present", () => {
    const before = parseSubscription({ state: { type: "active" }, startedAt: "2026-08-20T00:00:00+02:00", history: [] });
    expect([before.activatedAt, before.trialStartsBy, before.suspendedSince, before.unpaid, before.keptFreeMonths])
      .toEqual([null, null, null, null, null]);
    const pending = parseSubscription(fixture("subscription_pending.json"));
    expect(pending.state.type).toBe("trial");
    expect(pending.trialStartsBy).toBeInstanceOf(Date);
    expect(pending.activatedAt).toBeNull();
    expect(parseSubscription(fixture("subscription.json")).trialStartsBy).toBeNull();
    const hold = parseSubscription({ state: { type: "active" }, startedAt: "2026-01-10T00:00:00+01:00", history: [],
      activatedAt: "2026-01-10T12:00:00+01:00", suspendedSince: "2026-10-11T02:05:00+02:00",
      unpaid: { month: { year: 2026, month: 3 }, amountRSD: 990 },
      keptFreeMonths: { months: 2, until: "2027-10-31T00:00:00+01:00" } });
    expect(hold.unpaid).toEqual({ month: { year: 2026, month: 3 }, amountRSD: 990 });
    expect(hold.keptFreeMonths?.months).toBe(2);
    expect(hold.suspendedSince?.toISOString()).toBe("2026-10-11T00:05:00.000Z");
    const statement = parseStatement({ ...fixture("statement_2026_09.json"), energyEstimated: true });
    expect(statement.energyEstimated).toBe(true);
    expect(parseStatement(fixture("statement_2026_09.json")).energyEstimated).toBe(false);
    expect(parseStatement(fixture("statement_2026_09.json")).servicePart?.proration).toBeNull();
    const raw = fixture("statement_2026_09.json");
    const prorated = parseStatement({ ...raw, servicePart: { ...raw.servicePart, proration: { paidDays: 17, monthDays: 31 } } });
    expect(prorated.servicePart?.proration).toEqual({ paidDays: 17, monthDays: 31 });
    expect(parseCancelResult({ endsOn: "2026-10-31", already: false, freeMonthsKept: 2, freeMonthsKeptUntil: "2027-10-31" }))
      .toEqual({ endsOn: "2026-10-31", already: false, freeMonthsKept: 2 });
    expect(parseCancelResult({ endsOn: "2026-10-31", already: false }).freeMonthsKept).toBe(0);
  });

  it("keeps the fields screens rely on", () => {
    const user = parseUser(fixture("currentUser.json"));
    expect(user.chargePoints[0]!.customName).toBe("Garaža");
    expect(user.chargePoints[0]!.connectionScheme.type).toBe("thirdPartyMeter");
    expect(user.chargePoints[0]!.installedAt.toISOString()).toBe("2026-08-20T10:00:00.000Z");
    const statement = parseStatement(fixture("statement_2026_09.json"));
    expect(statement.dueDate!.toISOString()).toBe("2026-10-14T22:00:00.000Z");
    expect(statement.energyPart!.tariff.source).toBe("meterOwnerBill");
  });

  it("rejects a malformed answer as a bug, not as offline", () => {
    expect(() => parseUser({ id: 1 })).toThrow(InvalidResponseError);
    expect(() => parseStatement({ ...fixture("statement_2026_09.json"), status: "overdue" })).toThrow(InvalidResponseError);
  });

  it("maps every error fixture", async () => {
    const errors = fixture("_errors.json") as Record<string, { status: number; body: unknown }>;
    const mapped: Record<string, string> = {};
    for (const [name, { status, body }] of Object.entries(errors)) {
      if (name === "_comment") continue;
      const error = await errorFrom(json(status, body));
      mapped[name] = error instanceof BackendError ? error.code : error.name;
    }
    expect(mapped).toEqual({
      chargePointNotFound: "chargePointNotFound",
      guestMode: "guestMode",
      installationRequestIncomplete: "installationRequestIncomplete",
      installationAlreadyRequested: "installationAlreadyRequested",
      rateLimited: "rateLimited",
      jwtExpired: "InvalidResponseError", // 401 is handled before mapping (refresh once, then sign out)
    });
    const incomplete = await errorFrom(json(422, errors.installationRequestIncomplete!.body));
    expect((incomplete as BackendError).field).toBe("email");
    expect(((await errorFrom(json(503, {}))) as BackendError).code).toBe("offline");
  });
});

describe("headers", () => {
  it("never puts the publishable key into Authorization", () => {
    expect(accessHeaders(KEY, null)).toEqual({ apikey: KEY });
    expect(accessHeaders(KEY, "user-token")).toEqual({ apikey: KEY, authorization: "Bearer user-token" });
  });

  it("sends a legacy anon JWT as Bearer when nobody is signed in", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.c2ln";
    expect(accessHeaders(jwt, null)).toEqual({ apikey: jwt, authorization: `Bearer ${jwt}` });
    expect(accessHeaders(jwt, "user")).toEqual({ apikey: jwt, authorization: "Bearer user" });
  });
});

describe("sign-in by code", () => {
  it("requests the code with create_user and the interface language", async () => {
    const { auth, calls } = setup([["/auth/v1/otp", () => json(200, {})]], false);
    await auth.requestCode("mila@example.com", "en");
    expect(calls[0]).toMatchObject({
      url: `${API}/auth/v1/otp`, method: "POST",
      body: { email: "mila@example.com", create_user: true, data: { lang: "en" } },
    });
    expect(calls[0]!.headers.apikey).toBe(KEY);
    expect(calls[0]!.headers.authorization).toBeUndefined();
  });

  it("maps 429 to rateLimited and a wrong code to invalidCode", async () => {
    const a = setup([["/auth/v1/otp", () => json(429, { error: "over_email_send_rate_limit" })]], false);
    await expect(a.auth.requestCode("mila@example.com", "sr")).rejects.toMatchObject({ code: "rateLimited" });
    const b = setup([["/auth/v1/verify", () => json(403, { error_code: "otp_expired" })]], false);
    await expect(b.auth.verify("mila@example.com", "000000")).rejects.toEqual(new AccountError("invalidCode"));
  });

  it("stores the refresh token and keeps the access token in memory", async () => {
    const { auth, storage, calls } = setup([["/auth/v1/verify", () => tokens(1)]], false);
    const user = await auth.verify("mila@example.com", "123456");
    expect(calls[0]!.body).toEqual({ type: "email", email: "mila@example.com", token: "123456" });
    expect(user.id).toBe("aaaaaaaa-0000-4000-8000-000000000001");
    expect(storage.getItem(REFRESH_KEY)).toBe("refresh-2");
    expect([...storage.map.values()].join()).not.toContain("access-1");
    expect(await auth.accessToken()).toBe("access-1");
  });
});

describe("RPC transport", () => {
  it("calls POST /rest/v1/rpc/<fn> with p_ parameters, apikey and Bearer", async () => {
    const { backend, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/rest/v1/rpc/api_sessions", () => json(200, fixture("sessions.json"))],
    ]);
    const sessions = await backend.sessions("9efd2948-b5ec-465e-bc8a-efa6bb8e4aa5",
      new Date("2026-08-31T22:00:00Z"), new Date("2026-09-30T22:00:00Z"));
    expect(sessions).toHaveLength(2);
    const rpc = calls[1]!;
    expect(rpc.method).toBe("POST");
    expect(rpc.headers).toMatchObject({ apikey: KEY, authorization: "Bearer access-1", "content-type": "application/json" });
    expect(rpc.body).toEqual({
      p_id: "9efd2948-b5ec-465e-bc8a-efa6bb8e4aa5",
      p_from: "2026-09-01T00:00:00+02:00",
      p_to: "2026-10-01T00:00:00+02:00",
    });
  });

  it("sends the exact bodies of the write methods", async () => {
    const { backend, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["api_update_tariff_prices", () => json(200, fixture("tariff.json"))],
      ["api_update_session_tag", () => json(200, fixture("sessions.json")[0])],
      ["api_create_relocation_request", () => json(200, fixture("relocationRequests.json")[0])],
      ["set_marketing_consent", () => json(204, null)],
      ["set_analytics_opt_out", () => json(204, null)],
      ["api_update_schedule", () => json(204, null)],
      ["api_statement", () => json(200, null)],
    ]);
    await backend.updateTariffPrices("p", { highRateRSDPerKWh: 12.5, lowRateRSDPerKWh: 3.1 });
    await backend.updateSessionTag("p", "s", "business");
    await backend.createRelocationRequest("p", { newAddress: "Njegoševa 5", desiredDate: "2026-10-20", comment: null });
    await backend.setMarketingConsent(true);
    await backend.setAnalyticsOptOut(true);
    await backend.updateSchedule("p", { isEnabled: true, window: { startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 } });
    expect(await backend.statement("p", { year: 2026, month: 8 })).toBeNull();
    expect(calls.slice(1).map((c) => [c.url.replace(`${API}/rest/v1/rpc/`, ""), c.body])).toEqual([
      ["api_update_tariff_prices", { p_id: "p", p_high: 12.5, p_low: 3.1 }],
      ["api_update_session_tag", { p_id: "p", p_session: "s", p_tag: "business" }],
      ["api_create_relocation_request", { p_id: "p", p_new_address: "Njegoševa 5", p_desired_date: "2026-10-20", p_comment: null }],
      ["set_marketing_consent", { granted: true, source: "web" }],
      ["set_analytics_opt_out", { opt_out: true }],
      ["api_update_schedule", { p_id: "p", p_schedule: { isEnabled: true, window: { startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 } } }],
      ["api_statement", { p_id: "p", p_year: 2026, p_month: 8 }],
    ]);
  });

  it("maps P0001 to the typed error with the name from the message", async () => {
    const { backend } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["api_update_tariff_prices", () => json(400, { code: "P0001", details: null, hint: null, message: "tariffReadOnly" })],
    ]);
    await expect(backend.updateTariffPrices("p", null)).rejects.toMatchObject({ code: "tariffReadOnly" });
  });

  it("refreshes once on 401 and retries", async () => {
    const { backend, calls, locks } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["api_current_user", () => json(401, fixture("_errors.json").jwtExpired.body)],
      ["/auth/v1/token", (call) => { expect(call.body).toEqual({ refresh_token: "refresh-2" }); return tokens(2); }],
      ["api_current_user", () => json(200, fixture("currentUser.json"))],
    ]);
    const user = await backend.currentUser();
    expect(user.name).toBe("Mila Ilić");
    expect(calls.map((c) => c.headers.authorization)).toEqual([undefined, "Bearer access-1", undefined, "Bearer access-2"]);
    expect(locks.names).toEqual([LOCK_NAME, LOCK_NAME]);
  });

  it("signs out after a second 401", async () => {
    const { backend, auth, storage } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["api_alerts", () => json(401, {})],
      ["/auth/v1/token", () => tokens(2)],
      ["api_alerts", () => json(401, {})],
    ]);
    const changes = vi.fn();
    auth.onChange(changes);
    await expect(backend.alerts()).rejects.toEqual(new AccountError("sessionExpired"));
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
    expect(auth.hasSession).toBe(false);
    expect(changes).toHaveBeenCalled();
  });

  it("signs out when the refresh token is rejected", async () => {
    const { backend, storage } = setup([["/auth/v1/token", () => json(400, { error: "invalid_grant" })]]);
    await expect(backend.alerts()).rejects.toEqual(new AccountError("sessionExpired"));
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
  });

  it("serialises parallel refreshes: one request, the latest stored token", async () => {
    const { auth, calls, locks, storage } = setup([
      ["/auth/v1/token", async (call) => {
        await new Promise((r) => setTimeout(r, 10));
        expect(call.body).toEqual({ refresh_token: "refresh-rotated-by-other-tab" });
        return tokens(7);
      }],
    ]);
    // Another tab rotated the token before this tab took the lock.
    storage.setItem(REFRESH_KEY, "refresh-rotated-by-other-tab");
    const [a, b, c] = await Promise.all([auth.accessToken(), auth.accessToken(), auth.refresh()]);
    expect([a, b, c]).toEqual(["access-7", "access-7", "access-7"]);
    expect(calls.filter((x) => x.url.includes("/auth/v1/token"))).toHaveLength(1);
    expect(locks.names).toEqual([LOCK_NAME]);
    expect(storage.getItem(REFRESH_KEY)).toBe("refresh-8");
  });

  it("refreshes 60 s before expiry", async () => {
    const { auth, advance, calls } = setup([
      ["/auth/v1/token", () => tokens(1, 3600)],
      ["/auth/v1/token", () => tokens(2, 3600)],
    ]);
    expect(await auth.accessToken()).toBe("access-1");
    advance(3600_000 - 61_000);
    expect(await auth.accessToken()).toBe("access-1");
    advance(2_000);
    expect(await auth.accessToken()).toBe("access-2");
    expect(calls).toHaveLength(2);
  });

  it("turns network failures into offline after one retry, 5xx into offline", async () => {
    const failing = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["api_alerts", () => { throw new TypeError("Failed to fetch"); }],
      ["api_alerts", () => { throw new TypeError("Failed to fetch"); }],
    ]);
    await expect(failing.backend.alerts()).rejects.toEqual(new BackendError("offline"));
    expect(failing.calls).toHaveLength(3);
    const recovering = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["api_alerts", () => { throw new TypeError("Failed to fetch"); }],
      ["api_alerts", () => json(200, fixture("alerts.json"))],
    ]);
    expect(await recovering.backend.alerts()).toHaveLength(6);
    const server = setup([["/auth/v1/token", () => tokens(1)], ["api_alerts", () => json(502, "bad gateway")]]);
    await expect(server.backend.alerts()).rejects.toMatchObject({ code: "offline" });
  });
});

/** A promise to settle from the test: the server's answer arrives exactly when the test says so. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("sign-out is final", () => {
  it("a refresh answering after sign-out is never stored; logout uses its token, scope=local", async () => {
    const answer = deferred<Response>();
    const { auth, storage, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/auth/v1/token", () => answer.promise],
      ["/auth/v1/logout", () => json(204, null)],
    ]);
    expect(await auth.accessToken()).toBe("access-1");
    const refreshing = auth.refresh();
    await vi.waitFor(() => expect(calls).toHaveLength(2)); // the refresh is on the network
    const out = auth.signOut();
    // Signed out here at once, before the server has answered the refresh.
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
    expect(storage.getItem(USER_KEY)).toBeNull();
    answer.resolve(tokens(5));
    await expect(refreshing).rejects.toEqual(new AccountError("sessionExpired"));
    await out;
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
    expect([...storage.map.values()].join()).not.toContain("refresh-6");
    expect(auth.hasSession).toBe(false);
    expect(await auth.accessToken()).toBeNull();
    const logout = calls.at(-1)!;
    expect(logout.url).toBe(`${API}/auth/v1/logout?scope=local`);
    expect(logout.method).toBe("POST");
    expect(logout.headers.authorization).toBe("Bearer access-5");
  });

  it("cancels a refresh still hanging after the wait and logs out with the last access token", async () => {
    vi.useFakeTimers();
    try {
      const { auth, storage, calls } = setup([
        ["/auth/v1/token", () => tokens(1)],
        // The next refresh never answers; it only ends when it is cancelled.
        ["/auth/v1/token", (call) => new Promise<Response>((_, reject) => {
          call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        })],
        ["/auth/v1/logout", () => json(204, null)],
      ]);
      expect(await auth.accessToken()).toBe("access-1");
      const refreshing = auth.refresh();
      const failed = expect(refreshing).rejects.toEqual(new AccountError("sessionExpired"));
      await vi.waitFor(() => expect(calls).toHaveLength(2)); // the refresh is on the network
      const out = auth.signOut();
      await vi.advanceTimersByTimeAsync(SIGN_OUT_WAIT_MS + 10);
      await out;
      await failed;
      const hanging = calls.find((c, i) => i > 0 && c.url.includes("/auth/v1/token"))!;
      expect(hanging.signal!.aborted).toBe(true);
      expect(calls.filter((c) => c.url.includes("/auth/v1/token"))).toHaveLength(2); // cancelled, not retried
      expect(storage.getItem(REFRESH_KEY)).toBeNull();
      expect(calls.at(-1)!.url).toBe(`${API}/auth/v1/logout?scope=local`);
      expect(calls.at(-1)!.headers.authorization).toBe("Bearer access-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a refresh waiting for another tab's lock does not run after sign-out", async () => {
    const { auth, locks, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/auth/v1/logout", () => json(204, null)],
    ]);
    expect(await auth.accessToken()).toBe("access-1");
    const release = deferred<void>();
    void locks.request(LOCK_NAME, () => release.promise); // another tab holds the lock
    const refreshing = auth.refresh();
    const out = auth.signOut();
    release.resolve();
    await expect(refreshing).rejects.toEqual(new AccountError("sessionExpired"));
    await out;
    expect(calls.filter((c) => c.url.includes("/auth/v1/token"))).toHaveLength(1);
    expect(calls.at(-1)!.headers.authorization).toBe("Bearer access-1");
  });

  it("another tab signs out while this tab's refresh is on its way: the answer is dropped", async () => {
    const answer = deferred<Response>();
    const { auth, storage, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/auth/v1/token", () => answer.promise],
    ]);
    expect(await auth.accessToken()).toBe("access-1");
    const changes = vi.fn();
    auth.onChange(changes);
    const refreshing = auth.refresh();
    await vi.waitFor(() => expect(calls).toHaveLength(2)); // the refresh is on the network
    storage.removeItem(REFRESH_KEY); // the other tab's sign-out (its storage event may come later)
    answer.resolve(tokens(3));
    await expect(refreshing).rejects.toEqual(new AccountError("sessionExpired"));
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
    expect(changes).toHaveBeenCalled();
    expect(await auth.accessToken()).toBeNull();
  });

  it("the storage event of another tab's sign-out cancels a refresh on its way", async () => {
    const { auth, storage, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/auth/v1/token", (call) => new Promise<Response>((_, reject) => {
        call.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })],
    ]);
    expect(await auth.accessToken()).toBe("access-1");
    const refreshing = auth.refresh();
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    storage.removeItem(REFRESH_KEY);
    auth.handleStorageChange(REFRESH_KEY);
    await expect(refreshing).rejects.toEqual(new AccountError("sessionExpired"));
    expect(calls[1]!.signal!.aborted).toBe(true);
    expect(auth.hasSession).toBe(false);
    expect(await auth.accessToken()).toBeNull();
  });

  it("with an expired access token, sign-out refreshes once only to log out — and stores nothing", async () => {
    const { auth, storage, calls, advance } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/auth/v1/token", () => tokens(2)],
      ["/auth/v1/logout", () => json(204, null)],
    ]);
    expect(await auth.accessToken()).toBe("access-1");
    advance(3601_000);
    await auth.signOut();
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
    expect(calls.map((c) => c.url.replace(API, ""))).toEqual([
      "/auth/v1/token?grant_type=refresh_token", "/auth/v1/token?grant_type=refresh_token", "/auth/v1/logout?scope=local"]);
    expect(calls[1]!.body).toEqual({ refresh_token: "refresh-2" });
    expect(calls[2]!.headers.authorization).toBe("Bearer access-2");
  });
});

describe("retries: reads only", () => {
  const offline = () => { throw new TypeError("Failed to fetch"); };
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
  const draft: InstallationDraft = {
    name: "Ana", phone: "+381 60 123 45 67", email: "", city: "beograd", address: "Cara Dušana 5",
    parking: "iznajmljena", package: null, car: "", comment: "", referralCode: "", acceptsPrivacyPolicy: true,
  };

  it("marks exactly the reading RPCs as safe to repeat", () => {
    expect([...READ_ONLY_RPCS].sort()).toEqual([
      "api_alerts", "api_charge_point", "api_current_user", "api_live_session", "api_meter_readings", "api_referral_status",
      "api_relocation_requests", "api_schedule", "api_service_requests", "api_sessions", "api_statement",
      "api_statements", "api_subscription", "api_tariff",
    ]);
  });

  it("repeats a read once after a lost answer: RPCs and the GET of installation requests", async () => {
    const reads: Array<[string, (b: RemoteBackend) => Promise<unknown>, unknown]> = [
      ["api_current_user", (b) => b.currentUser(), fixture("currentUser.json")],
      ["api_statement", (b) => b.statement("p", { year: 2026, month: 9 }), fixture("statement_2026_09.json")],
      ["api_live_session", (b) => b.liveSession("p"), null],
      ["/functions/v1/installation-requests", (b) => b.installationRequests(), []],
    ];
    for (const [fragment, run, answer] of reads) {
      const { backend, calls } = setup([
        ["/auth/v1/token", () => tokens(1)],
        [fragment, offline],
        [fragment, () => json(200, answer)],
      ]);
      await run(backend);
      expect(calls.filter((c) => c.url.includes(fragment)), fragment).toHaveLength(2);
    }
  });

  it("sends every write, new request, upload and deletion exactly once", async () => {
    const writes: Array<[string, (b: RemoteBackend) => Promise<unknown>]> = [
      ["api_create_service_request", (b) => b.createServiceRequest("p", { category: "other", comment: "x", photo: null })],
      ["/storage/v1/object/tickets/", (b) => b.createServiceRequest("p", { category: "damaged", comment: "", photo })],
      ["api_create_relocation_request", (b) => b.createRelocationRequest("p", { newAddress: "Njegoševa 5", desiredDate: "2026-10-20", comment: null })],
      ["/functions/v1/installation-requests", (b) => b.createInstallationRequest(draft, { lang: "sr", marketingOptIn: false })],
      ["/functions/v1/account-delete", (b) => b.deleteAccount()],
      ["api_update_schedule", (b) => b.updateSchedule("p", { isEnabled: true, window: { startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 } })],
      ["api_update_session_tag", (b) => b.updateSessionTag("p", "s", "personal")],
      ["api_mark_alert_read", (b) => b.markAlertRead("a")],
      ["api_request_subscription_pause", (b) => b.requestSubscriptionPause()],
      ["api_cancel_subscription", (b) => b.cancelSubscription()],
      ["set_marketing_consent", (b) => b.setMarketingConsent(true)],
      // 1.14: the meter photo, its reading and the "something was done with the charger" mark
      ["/storage/v1/object/readings/", (b) => b.submitMeterReading("p", 1432.6, photo)],
      ["api_mark_point_activity", (b) => b.markPointActivity("p")],
    ];
    for (const [fragment, run] of writes) {
      const { backend, calls } = setup([["/auth/v1/token", () => tokens(1)], [fragment, offline], [fragment, offline]]);
      await expect(run(backend), fragment).rejects.toEqual(new BackendError("offline"));
      expect(calls.filter((c) => c.url.includes(fragment)), fragment).toHaveLength(1);
    }
  });

  it("never repeats a sign-in step or a token refresh", async () => {
    const otp = setup([["/auth/v1/otp", offline], ["/auth/v1/otp", offline]], false);
    await expect(otp.auth.requestCode("mila@example.com", "sr")).rejects.toEqual(new BackendError("offline"));
    expect(otp.calls).toHaveLength(1);
    const verify = setup([["/auth/v1/verify", offline], ["/auth/v1/verify", offline]], false);
    await expect(verify.auth.verify("mila@example.com", "123456")).rejects.toEqual(new BackendError("offline"));
    expect(verify.calls).toHaveLength(1);
    const refresh = setup([["/auth/v1/token", offline], ["/auth/v1/token", offline]]);
    await expect(refresh.auth.refresh()).rejects.toEqual(new BackendError("offline"));
    expect(refresh.calls).toHaveLength(1);
    // Still signed in: a lost refresh answer is "offline", not a sign-out.
    expect(refresh.auth.hasSession).toBe(true);
  });
});

describe("installation requests and uploads", () => {
  const draft: InstallationDraft = {
    name: " Ana ", phone: "+381 60 123 45 67", email: "", city: "beograd", address: "Cara Dušana 5",
    parking: "iznajmljena", package: null, car: "Renault Zoe", comment: "", referralCode: "evo-7kq3m ",
    acceptsPrivacyPolicy: true,
  };

  it("posts the normalised draft with source web, lang, marketing opt-in and x-install-id", async () => {
    const { backend, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/functions/v1/installation-requests", () => json(201, fixture("guest_installationRequests.json")[0])],
    ]);
    const request = await backend.createInstallationRequest(draft, { lang: "sr", marketingOptIn: false });
    expect(request.requestNo).toBe("Z-1003");
    const call = calls[1]!;
    expect(call.method).toBe("POST");
    expect(call.headers["x-install-id"]).toBe("11111111-2222-4333-8444-555555555555");
    expect(call.headers.authorization).toBe("Bearer access-1");
    expect(call.body).toEqual({ ...normalizeDraft(draft), name: "Ana", referralCode: "EVO-7KQ3M", source: "web",
      lang: "sr", marketingOptIn: false });
  });

  it("maps 409 and 422 of the function", async () => {
    const { backend } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/functions/v1/installation-requests", () => json(409, { error: "installationAlreadyRequested" })],
    ]);
    await expect(backend.createInstallationRequest(draft, { lang: "sr", marketingOptIn: false }))
      .rejects.toMatchObject({ code: "installationAlreadyRequested" });
  });

  it("lists requests with GET and the install id", async () => {
    const { backend, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/functions/v1/installation-requests", () => json(200, fixture("installationRequests.json"))],
    ]);
    const list = await backend.installationRequests();
    expect(list[0]!.status).toBe("installed");
    expect(calls[1]!.method).toBe("GET");
    expect(calls[1]!.headers["x-install-id"]).toBeDefined();
  });

  it("uploads the photo to Storage, then references it in the RPC", async () => {
    const { backend, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/storage/v1/object/tickets/", () => json(200, { Key: "tickets/x" })],
      ["api_create_service_request", () => json(200, fixture("serviceRequests.json")[0])],
    ]);
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    await backend.createServiceRequest("p", { category: "damaged", comment: "Kabl je oštećen", photo });
    const path = "aaaaaaaa-0000-4000-8000-000000000001/photo-uuid.jpg";
    expect(calls[1]!.url).toBe(`${API}/storage/v1/object/tickets/${path}`);
    expect(calls[1]!.headers["content-type"]).toBe("image/jpeg");
    expect(calls[1]!.headers.authorization).toBe("Bearer access-1");
    expect(calls[2]!.body).toEqual({ p_id: "p", p_category: "damaged", p_comment: "Kabl je oštećen", p_photo_path: path });
  });

  it("meter reading: the photo goes to readings/<user>/<uuid>.jpg, then the value with its path; the list and a photo are read", async () => {
    const { backend, calls } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/storage/v1/object/readings/", () => json(200, { Key: "readings/x" })],
      ["api_submit_meter_reading", () => json(200, 412)],
      ["api_meter_readings", () => json(200, fixture("meterReadings.json"))],
      ["/storage/v1/object/authenticated/readings/", () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 })],
      ["api_mark_point_activity", () => json(200, fixture("pointActivity.json"))],
    ]);
    const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" });
    expect(await backend.submitMeterReading("p", 1432.6, photo)).toBe(412);
    const path = "aaaaaaaa-0000-4000-8000-000000000001/photo-uuid.jpg";
    expect(calls[1]!.url).toBe(`${API}/storage/v1/object/readings/${path}`);
    expect([calls[1]!.method, calls[1]!.headers["content-type"], calls[1]!.headers.authorization]).toEqual(["POST", "image/jpeg", "Bearer access-1"]);
    expect(calls[2]!.body).toEqual({ p_id: "p", p_value: 1432.6, p_photo_path: path });

    const list = await backend.meterReadings("p");
    expect(calls[3]!.body).toEqual({ p_id: "p" });
    expect(list.required).toBe(true);
    expect(list.lastAccepted?.valueKWh).toBe(18.412);
    expect(list.readings.map((r) => r.status)).toEqual(["submitted", "accepted", "rejected", "accepted"]);
    expect(list.readings[2]!.note).toBe("Na fotografiji se ne vidi ceo ekran brojila.");
    expect(list.readings[3]!.photoPath).toBeNull();
    expect(list.readings[0]!.month).toEqual({ year: 2026, month: 10 });

    const own = list.readings[0]!.photoPath!;
    expect((await backend.readingPhoto(own)).size).toBe(3);
    expect([calls[4]!.method, calls[4]!.url]).toEqual(["GET", `${API}/storage/v1/object/authenticated/readings/${own}`]);
    expect(calls[4]!.headers.authorization).toBe("Bearer access-1");
    // Only "<user id>/<file>" is ever asked for: no request leaves for anything else.
    await expect(backend.readingPhoto("../bills/eps.pdf")).rejects.toBeInstanceOf(InvalidResponseError);
    expect(calls).toHaveLength(5);

    const activity = await backend.markPointActivity("p");
    expect(calls[5]!.body).toEqual({ p_point: "p" });
    expect(activity.started).toBe(true);
    expect(activity.activatedAt).toBeInstanceOf(Date);
  });

  it("the errors of a reading are the contract's names", async () => {
    for (const name of ["meterReadingTooLow", "meterReadingIncomplete", "rateLimited"] as const) {
      const error = await errorFrom(json(400, { code: "P0001", details: null, hint: null, message: name }));
      expect(error).toEqual(new BackendError(name));
    }
  });

  it("deletes the account with one POST; the local sign-out follows without a logout call", async () => {
    const { backend, calls, auth, storage } = setup([
      ["/auth/v1/token", () => tokens(1)],
      ["/functions/v1/account-delete", () => json(200, { ok: true })],
    ]);
    await backend.deleteAccount();
    expect(calls[1]!.method).toBe("POST");
    expect(calls[1]!.headers.authorization).toBe("Bearer access-1");
    // The session (afterAccountDeleted) then forgets the tokens; the account and its sessions no longer exist.
    await auth.signOut(false);
    expect(auth.hasSession).toBe(false);
    expect(storage.getItem(REFRESH_KEY)).toBeNull();
    expect(calls).toHaveLength(2);
  });
});

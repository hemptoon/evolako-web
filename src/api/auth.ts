// Sign-in by a six-digit code sent to the e-mail (backend/docs/API.md, "Вход по коду").
//
// Tokens: the access token lives only in memory; the refresh token in localStorage, so a reload keeps the person
// signed in. Supabase refresh tokens rotate — reusing an old one can revoke the whole session — so refreshes are
// serialized across tabs with navigator.locks, and inside the lock the latest refresh token is read again from
// storage (another tab may have rotated it while we waited). Access is refreshed 60 s before it expires, or once
// after a 401; if that fails the person is signed out.
//
// Sign-out is final. Every sign-out (here or in another tab) starts a new session epoch; a refresh that began in an
// older epoch is cancelled and its answer is never stored, so an answer arriving late cannot sign the person back
// in. Sign-out waits (at most 5 s) for a refresh that was already on its way and ends that session on the server
// with the newest access token — only this browser's session (scope=local), the phone app stays signed in.
import { AccountError, BackendError } from "./errors";
import { accessHeaders, body, errorFrom, send, type ApiConfig, type FetchLike } from "./http";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocksLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>;
}

export interface AuthDeps {
  fetch: FetchLike;
  storage: StorageLike;
  /** navigator.locks; null in browsers without the Web Locks API (then only in-tab dedupe). */
  locks: LocksLike | null;
  now: () => number;
}

export interface SignedInUser {
  id: string;
  email: string;
}

export const REFRESH_KEY = "evo.auth.refresh";
export const USER_KEY = "evo.auth.user";
export const LOCK_NAME = "evolako-auth-refresh";
/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_MS = 60_000;
/** How long sign-out waits for a refresh already on its way before cancelling it. */
export const SIGN_OUT_WAIT_MS = 5_000;

interface TokenAnswer {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  user?: { id?: unknown; email?: unknown };
}

/** A refresh on its way: the epoch it started in, its cancel switch, and — when the session was signed out before
 *  the answer came — the access token it got anyway (never stored; sign-out uses it to end the session). */
interface RefreshTicket {
  epoch: number;
  abort: AbortController;
  lateAccess: string | null;
}

export class AuthSession {
  private access: { token: string; expiresAt: number } | null = null;
  private inFlight: Promise<string> | null = null;
  private ticket: RefreshTicket | null = null;
  /** Bumped by every sign-out, here or in another tab: answers that belong to an older session are dropped. */
  private epoch = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly config: ApiConfig, private readonly deps: AuthDeps) {}

  // ------------------------------------------------------------ state

  get hasSession(): boolean {
    return this.read(REFRESH_KEY) !== null;
  }

  get user(): SignedInUser | null {
    const raw = this.read(USER_KEY);
    if (!raw) return null;
    try {
      const u = JSON.parse(raw) as SignedInUser;
      return typeof u.id === "string" ? u : null;
    } catch {
      return null;
    }
  }

  /** Called when the person signs in or out (here or in another tab). */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  headers(userToken: string | null): Record<string, string> {
    return accessHeaders(this.config.publishableKey, userToken);
  }

  // ------------------------------------------------------------ sign-in

  async requestCode(email: string, lang: string): Promise<void> {
    const res = await send(this.deps.fetch, `${this.config.apiBase}/auth/v1/otp`, {
      method: "POST",
      headers: { ...this.headers(null), "content-type": "application/json" },
      body: JSON.stringify({ email, create_user: true, data: { lang } }),
    });
    if (res.ok) return;
    if (res.status === 429) throw new BackendError("rateLimited");
    if (res.status === 400 || res.status === 422) throw new AccountError("invalidEmail");
    throw await errorFrom(res);
  }

  async verify(email: string, code: string): Promise<SignedInUser> {
    const res = await send(this.deps.fetch, `${this.config.apiBase}/auth/v1/verify`, {
      method: "POST",
      headers: { ...this.headers(null), "content-type": "application/json" },
      body: JSON.stringify({ type: "email", email, token: code }),
    });
    if (res.status === 429) throw new BackendError("rateLimited");
    // 400/403 on verify: the code is wrong or expired.
    if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 422) {
      throw new AccountError("invalidCode");
    }
    if (!res.ok) throw await errorFrom(res);
    const answer = (await body(res)) as TokenAnswer;
    const user: SignedInUser = {
      id: typeof answer?.user?.id === "string" ? answer.user.id : "",
      email: typeof answer?.user?.email === "string" ? answer.user.email : email,
    };
    this.write(USER_KEY, JSON.stringify(user));
    this.accept(answer);
    this.emit();
    return user;
  }

  /**
   * Sign-in with Google (api/google.ts): Google's ID token and the raw nonce whose SHA-256 is in it. Supabase checks
   * the token (signature, our client ID, the nonce) and answers like a code sign-in. `isNew`: the account was created
   * by this sign-in (the token carries no language: the caller writes it to the profile).
   */
  async signInWithIdToken(idToken: string, nonce: string): Promise<SignedInUser & { isNew: boolean }> {
    const res = await send(this.deps.fetch, `${this.config.apiBase}/auth/v1/token?grant_type=id_token`, {
      method: "POST",
      headers: { ...this.headers(null), "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", id_token: idToken, nonce }),
    });
    if (res.status === 429) throw new BackendError("rateLimited");
    // 400/401/403/422: the token or the nonce was refused, or the account cannot sign in this way.
    if (res.status >= 400 && res.status < 500) throw new AccountError("googleFailed");
    if (!res.ok) throw await errorFrom(res);
    const answer = (await body(res)) as TokenAnswer & { user?: { created_at?: unknown } };
    if (typeof answer?.user?.email !== "string" || typeof answer.user.id !== "string") throw new AccountError("googleFailed");
    const user: SignedInUser = { id: answer.user.id, email: answer.user.email };
    const created = typeof answer.user.created_at === "string" ? Date.parse(answer.user.created_at) : NaN;
    this.write(USER_KEY, JSON.stringify(user));
    this.accept(answer);
    this.emit();
    // "New" = created in the last 10 minutes (a sign-in that failed halfway and was repeated still counts).
    return { ...user, isNew: Number.isFinite(created) && this.deps.now() - created < 10 * 60_000 };
  }

  // ------------------------------------------------------------ tokens

  /** A valid access token (refreshing if it expires within a minute), or null when signed out. */
  async accessToken(): Promise<string | null> {
    if (this.access && this.deps.now() < this.access.expiresAt - REFRESH_MARGIN_MS) return this.access.token;
    if (!this.hasSession) return null;
    return this.refresh();
  }

  /**
   * One refresh at a time: within the tab (a shared promise) and across tabs (a Web Lock). Rejected refresh →
   * local sign-out and AccountError("sessionExpired"); no network → BackendError("offline"), still signed in.
   */
  refresh(): Promise<string> {
    if (this.inFlight) return this.inFlight;
    const ticket: RefreshTicket = { epoch: this.epoch, abort: new AbortController(), lateAccess: null };
    this.ticket = ticket;
    const stale = () => ticket.epoch !== this.epoch;
    const run = async (): Promise<string> => {
      // Signed out while this tab waited for the lock: there is nothing to refresh any more.
      if (stale()) throw new AccountError("sessionExpired");
      const stored = this.read(REFRESH_KEY);
      if (!stored) {
        // Signed out in another tab while this one was about to refresh.
        this.clear();
        this.emit();
        throw new AccountError("sessionExpired");
      }
      let res: Response;
      try {
        res = await send(this.deps.fetch, `${this.config.apiBase}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { ...this.headers(null), "content-type": "application/json" },
          body: JSON.stringify({ refresh_token: stored }),
          signal: ticket.abort.signal,
        });
      } catch (e) {
        if (stale()) throw new AccountError("sessionExpired");
        throw e;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        if (!stale()) {
          this.clear();
          this.emit();
        }
        throw new AccountError("sessionExpired");
      }
      if (!res.ok) throw await errorFrom(res);
      const answer = (await body(res)) as TokenAnswer;
      // The answer belongs to a session that is over when this tab signed out meanwhile (a new epoch) or when the
      // stored token is no longer the one we sent (signed out or in again in another tab): never store it.
      const now = this.read(REFRESH_KEY);
      if (stale() || now !== stored) {
        ticket.lateAccess = typeof answer?.access_token === "string" ? answer.access_token : null;
        if (!stale() && now === null) {
          this.forget();
          this.emit();
        }
        throw new AccountError("sessionExpired");
      }
      return this.accept(answer);
    };
    const locked = this.deps.locks ? this.deps.locks.request(LOCK_NAME, run) : run();
    this.inFlight = locked.finally(() => {
      this.inFlight = null;
      if (this.ticket === ticket) this.ticket = null;
    });
    return this.inFlight;
  }

  private accept(answer: TokenAnswer): string {
    if (typeof answer?.access_token !== "string" || typeof answer.refresh_token !== "string") {
      throw new AccountError("sessionExpired");
    }
    const expiresIn = typeof answer.expires_in === "number" ? answer.expires_in : 3600;
    this.access = { token: answer.access_token, expiresAt: this.deps.now() + expiresIn * 1000 };
    this.write(REFRESH_KEY, answer.refresh_token);
    this.schedule(expiresIn * 1000 - REFRESH_MARGIN_MS);
    return answer.access_token;
  }

  private schedule(inMs: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.hasSession) this.refresh().catch(() => undefined);
    }, Math.max(inMs, 5_000));
  }

  // ------------------------------------------------------------ sign-out

  /**
   * Signs out: forgets the tokens here at once (a new epoch — a refresh on its way can no longer store anything),
   * then ends this browser's session on the server (best effort). `remote = false` when the server already did.
   */
  async signOut(remote = true): Promise<void> {
    const stored = this.read(REFRESH_KEY);
    const usable = this.access && this.deps.now() < this.access.expiresAt ? this.access.token : null;
    const pending = this.inFlight;
    const ticket = this.ticket;
    this.clear();
    this.emit();
    if (!remote) {
      ticket?.abort.abort();
      return;
    }
    let token = usable;
    if (pending && ticket) {
      // A refresh already on its way may have rotated the session on the server: wait for it (bounded) so the
      // logout can use the access token it brings; its answer is never stored. Past the limit, cancel it.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const limit = new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), SIGN_OUT_WAIT_MS);
      });
      const settled = await Promise.race([pending.then(() => true, () => true), limit]);
      clearTimeout(timer);
      if (!settled) ticket.abort.abort();
      token = ticket.lateAccess ?? token;
    } else if (!token && stored) {
      // No usable access token (it expired, e.g. in a background tab): one refresh, only to end the session.
      token = await this.accessForLogout(stored);
    }
    if (!token) return;
    await send(this.deps.fetch, `${this.config.apiBase}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: this.headers(token),
    }, 0).catch(() => undefined);
  }

  /** An access token for the logout call only: exchanged from the old refresh token, never stored. */
  private async accessForLogout(refreshToken: string): Promise<string | null> {
    try {
      const res = await send(this.deps.fetch, `${this.config.apiBase}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { ...this.headers(null), "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }, 0);
      if (!res.ok) return null;
      const answer = (await body(res)) as TokenAnswer;
      return typeof answer?.access_token === "string" ? answer.access_token : null;
    } catch {
      return null;
    }
  }

  /** Another tab signed out (the refresh token disappeared from storage): end the session here too. */
  handleStorageChange(key: string | null): void {
    if ((key === REFRESH_KEY || key === null) && !this.hasSession && (this.access || this.inFlight)) {
      // That tab already ended the session on the server; a refresh of ours on its way is simply cancelled.
      this.ticket?.abort.abort();
      this.forget();
      this.emit();
    }
  }

  /** A new epoch without the tokens in memory: whatever was on its way for the old session is dropped. */
  private forget(): void {
    this.epoch += 1;
    this.access = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clear(): void {
    this.forget();
    this.remove(REFRESH_KEY);
    this.remove(USER_KEY);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private read(key: string): string | null {
    try {
      return this.deps.storage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.deps.storage.setItem(key, value);
    } catch {
      // Private mode without storage: the session lasts as long as the tab.
    }
  }

  private remove(key: string): void {
    try {
      this.deps.storage.removeItem(key);
    } catch {
      // nothing to remove
    }
  }
}

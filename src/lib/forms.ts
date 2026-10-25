// Input rules shared by the forms (ports of the app's Domain validators) and small pure helpers of the screens.
import { addDays, dayKey, startOfDay } from "./belgrade";

// ---------------------------------------------------------------- contact (InstallationRequestDraft)

/** Digits with an optional leading "+" and separators, 8–15 digits (E.164): "+381 60 123 45 67", "060/123-4567". */
export function isValidPhone(raw: string): boolean {
  if (!/^[+0-9 \-/().]+$/.test(raw)) return false;
  if (raw.slice(1).includes("+")) return false;
  const digits = raw.replace(/\D/g, "").length;
  return digits >= 8 && digits <= 15;
}

/** something@domain.zone without spaces — only against typos; the e-mail itself is the real check. */
export function isValidEmail(raw: string): boolean {
  const parts = raw.split("@");
  if (parts.length !== 2 || !parts[0] || raw.includes(" ")) return false;
  const domain = parts[1]!.split(".");
  return domain.length >= 2 && domain.every(Boolean);
}

const REFERRAL = /^EVO-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/;

/** "evo - 7kq2m" → "EVO-7KQ2M"; null when it is not a referral code (ReferralCode of the app). */
export function normalizeReferral(raw: string): string | null {
  const cleaned = raw.toUpperCase().replace(/\s+/g, "");
  return REFERRAL.test(cleaned) ? cleaned : null;
}

// ---------------------------------------------------------------- tariff prices (TariffPrices.parse)

export const PRICE_RANGE = { min: 1, max: 80 } as const;
export type PriceError = "notANumber" | "tooManyDecimals" | "outOfRange";

/** "12,50" → 12.5 — comma or dot, at most two decimals, 1–80 RSD per kWh. */
export function parsePrice(text: string): number | PriceError {
  const trimmed = text.trim().replace(",", ".");
  const parts = trimmed.split(".");
  if (!trimmed || parts.length > 2 || parts.some((p) => !/^\d+$/.test(p))) return "notANumber";
  if (parts.length === 2 && parts[1]!.length > 2) return "tooManyDecimals";
  const value = Number(trimmed);
  if (!(value >= PRICE_RANGE.min && value <= PRICE_RANGE.max)) return "outOfRange";
  return value;
}

// ---------------------------------------------------------------- move (RelocationRequestDraft)

export const RELOCATION = { addressMin: 5, addressMax: 200, commentMax: 500, responseHours: 72, daysAhead: 365 } as const;

/** Earliest day: the day after our 72-hour answer; latest: a year from today; suggested: two weeks. Belgrade days. */
export function relocationDates(now: Date): { earliest: string; latest: string; initial: string } {
  const earliest = addDays(startOfDay(new Date(now.getTime() + RELOCATION.responseHours * 3600_000)), 1);
  const latest = addDays(startOfDay(now), RELOCATION.daysAhead);
  const twoWeeks = addDays(startOfDay(now), 14);
  return { earliest: dayKey(earliest), latest: dayKey(latest), initial: dayKey(twoWeeks > earliest ? twoWeeks : earliest) };
}

// ---------------------------------------------------------------- search

/** Lowercase, without accents: č→c, ć→c, š→s, ž→z, đ→dj, ё→е, й→и. */
export function fold(text: string): string {
  return text.toLowerCase().replace(/đ/g, "dj").normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Every word of the query is in the text ("dj" and "d" both find "đ"). */
export function matchesQuery(text: string, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const haystack = fold(text);
  const loose = haystack.replace(/dj/g, "d");
  return q.split(/\s+/).every((word) => haystack.includes(word) || loose.includes(word));
}

// ---------------------------------------------------------------- chart

/** A round top for the axis and its step: 0, 5, 10, 20, 25, 50 … */
export function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 10, step: 5 };
  const raw = max / 3;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? 10 * magnitude;
  return { top: Math.ceil(max / step) * step, step };
}

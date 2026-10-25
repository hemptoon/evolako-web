// Meter readings by photo (11.10.2026): the rules shared by the screen, the demo and the tests. The same numbers as
// the backend (api_submit_meter_reading) and the app: a reading is never below the last accepted one; more than
// 2 000 kWh since it, or more than 300 kWh a day, is asked about once ("Proveri broj — izgleda previše.") and may
// still be sent — then a person decides.
import { addMonths, belgradeParts, monthEnd, monthOf, type Month } from "./belgrade";

export const MAX_INCREASE_KWH = 2000;
export const MAX_PER_DAY_KWH = 300;
/** A reading for a month is expected in its last 3 days and in the first 3 days of the next one. */
export const WINDOW_DAYS = 3;
export const READING_DECIMALS = 3;
/** The photo as it leaves the browser: JPEG, the longest side ≤ 1600 px, ≤ 1,5 MB. */
export const PHOTO_MAX_SIDE = 1600;
export const PHOTO_MAX_BYTES = 1_500_000;

/**
 * "1432,6" or "1432.6" → 1432.6. Digits with at most one decimal separator (comma or dot) and up to three decimals;
 * spaces around are forgiven. Anything else — thousands separators, a sign, letters — is not a reading: null.
 */
export function parseReading(text: string): number | null {
  const m = /^(\d{1,8})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!m) return null;
  const value = Number(`${m[1]}.${m[2] ?? "0"}`);
  return Number.isFinite(value) ? value : null;
}

export type ReadingCheck = "ok" | "tooLow" | "tooHigh";

/** `last` — the last accepted reading (none yet: nothing to compare with, the team looks at the first one). */
export function checkReading(value: number, last: { valueKWh: number; readAt: Date } | null, now: Date): ReadingCheck {
  if (!last) return "ok";
  if (value < last.valueKWh) return "tooLow";
  const increase = value - last.valueKWh;
  const days = Math.max((now.getTime() - last.readAt.getTime()) / 86_400_000, 1);
  return increase > MAX_INCREASE_KWH || increase / days > MAX_PER_DAY_KWH ? "tooHigh" : "ok";
}

/**
 * The month a reading is expected for right now: in the last 3 days of a month — that month; in the first 3 days —
 * the month before; otherwise none (Belgrade calendar).
 */
export function readingWindow(now: Date): Month | null {
  const p = belgradeParts(now);
  const current = monthOf(now);
  if (p.day <= WINDOW_DAYS) return addMonths(current, -1);
  const lastDay = belgradeParts(new Date(monthEnd(current).getTime() - 12 * 3600_000)).day;
  return p.day > lastDay - WINDOW_DAYS ? current : null;
}

/** A reading that counts for its month: sent and waiting, or accepted. A rejected one does not. */
export function coversMonth(readings: ReadonlyArray<{ month: Month; status: string }>, month: Month): boolean {
  return readings.some((r) => r.status !== "rejected" && r.month.year === month.year && r.month.month === month.month);
}

/** The month to remind about now, or null: outside the window, or a reading for it is already there. */
export function readingDue(readings: ReadonlyArray<{ month: Month; status: string }>, now: Date): Month | null {
  const month = readingWindow(now);
  return month && !coversMonth(readings, month) ? month : null;
}

/** The last free day of a trial: `until` is the first paid day (contract), so one calendar day earlier. "14.12". */
export function lastFreeDay(until: Date): string {
  const p = belgradeParts(new Date(until.getTime() - 12 * 3600_000));
  return `${String(p.day).padStart(2, "0")}.${String(p.month).padStart(2, "0")}`;
}

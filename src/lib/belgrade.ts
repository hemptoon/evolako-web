// Calendar arithmetic in Europe/Belgrade.
//
// Every period, day boundary and tariff zone of the product is computed in the Belgrade time zone, whatever the
// zone of the browser: a customer abroad must see the same statement and the same night window (API contract,
// "Общие соглашения"). Wall-clock times are turned into instants through Intl, so DST nights (last Sunday of March
// and of October) are handled by the platform's time zone database, not by adding 24 h.

export const TIME_ZONE = "Europe/Belgrade";

export interface BelgradeParts {
  year: number;
  /** 1…12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Monday … 6 = Sunday */
  weekday: number;
}

const partsFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  weekday: "short",
});

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export function belgradeParts(date: Date): BelgradeParts {
  const out: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(date)) out[part.type] = part.value;
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
    weekday: WEEKDAYS[out.weekday ?? "Mon"] ?? 0,
  };
}

/** Offset of Belgrade from UTC at the given instant, in minutes (60 in winter, 120 in summer). */
export function offsetMinutes(date: Date): number {
  const p = belgradeParts(date);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/**
 * The instant of a Belgrade wall-clock time. Month is 1…12 and may overflow (13 = January next year), day may
 * overflow too — like `Calendar` date components. A time inside the spring-forward gap (02:00–03:00 on the last
 * Sunday of March) resolves to the same distance after the gap, as Foundation does.
 */
export function fromBelgrade(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = wall - offsetMinutes(new Date(wall)) * 60000;
  const second2 = wall - offsetMinutes(new Date(first)) * 60000;
  return new Date(second2);
}

export function startOfDay(date: Date): Date {
  const p = belgradeParts(date);
  return fromBelgrade(p.year, p.month, p.day);
}

/** The same wall-clock time `days` later (Belgrade days, not 24-hour steps). */
export function addDays(date: Date, days: number): Date {
  const p = belgradeParts(date);
  return fromBelgrade(p.year, p.month, p.day + days, p.hour, p.minute, p.second);
}

/** Set the wall-clock time on the Belgrade day of `date`. */
export function atTime(date: Date, hour: number, minute = 0): Date {
  const p = belgradeParts(date);
  return fromBelgrade(p.year, p.month, p.day, hour, minute, 0);
}

export interface Month {
  year: number;
  /** 1…12 */
  month: number;
}

export function monthOf(date: Date): Month {
  const p = belgradeParts(date);
  return { year: p.year, month: p.month };
}

export function monthStart(m: Month): Date {
  return fromBelgrade(m.year, m.month, 1);
}

/** First day of the following month — the exclusive upper bound. */
export function monthEnd(m: Month): Date {
  return fromBelgrade(m.year, m.month + 1, 1);
}

export function addMonths(m: Month, count: number): Month {
  const index = m.year * 12 + (m.month - 1) + count;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function compareMonths(a: Month, b: Month): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month);
}

/** "2026-09" — the statement route key. */
export function monthKey(m: Month): string {
  return `${m.year}-${String(m.month).padStart(2, "0")}`;
}

export function parseMonthKey(key: string): Month | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

/** "2026-07-14" in Belgrade. */
export function dayKey(date: Date): string {
  const p = belgradeParts(date);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** "23:15" in Belgrade, 24-hour — for CSV and contract strings, not for display. */
export function clockKey(date: Date): string {
  const p = belgradeParts(date);
  return `${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
}

/** ISO 8601 with the Belgrade offset and whole seconds, as the backend sends it: "2026-07-14T23:15:00+02:00". */
export function isoBelgrade(date: Date): string {
  const p = belgradeParts(date);
  const offset = offsetMinutes(date);
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Whole Belgrade days between two instants' calendar dates (b − a). */
export function daysBetween(a: Date, b: Date): number {
  const pa = belgradeParts(a);
  const pb = belgradeParts(b);
  return Math.round((Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) / 86400000);
}

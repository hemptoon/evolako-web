// Tariff maths: how much of a session fell into the night window, and what it costs.
// Port of Domain/Math/TariffCalculator.swift. The window repeats every Belgrade day and usually crosses midnight;
// its boundaries are built from wall-clock times (fromBelgrade), so DST nights are counted correctly.
import { belgradeParts, fromBelgrade } from "./belgrade";
import { roundHalfUp } from "./format";

export interface Window {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
}

export interface Rates {
  highRateRSDPerKWh: number;
  lowRateRSDPerKWh: number;
  nightWindow: Window;
}

export interface EnergySplit {
  nightKWh: number;
  dayKWh: number;
}

export const ZERO: EnergySplit = { nightKWh: 0, dayKWh: 0 };

export function total(e: EnergySplit): number {
  return e.nightKWh + e.dayKWh;
}

export function nightShare(e: EnergySplit): number {
  const t = total(e);
  return t > 0 ? e.nightKWh / t : 0;
}

/** How much of the point's power a charge is drawing now, 0…1: 10,8 kW on an 11 kW point is 0,98. */
export function powerShare(powerKW: number | null, nominalKW: number): number {
  if (powerKW === null || !(nominalKW > 0) || !(powerKW > 0)) return 0;
  return Math.min(powerKW / nominalKW, 1);
}

export function add(a: EnergySplit, b: EnergySplit): EnergySplit {
  return { nightKWh: a.nightKWh + b.nightKWh, dayKWh: a.dayKWh + b.dayKWh };
}

export const startMinuteOfDay = (w: Window) => w.startHour * 60 + w.startMinute;
export const endMinuteOfDay = (w: Window) => w.endHour * 60 + w.endMinute;
export const crossesMidnight = (w: Window) => startMinuteOfDay(w) > endMinuteOfDay(w);
export const isEmptyWindow = (w: Window) => startMinuteOfDay(w) === endMinuteOfDay(w);

export function windowMinutes(w: Window): number {
  return crossesMidnight(w)
    ? 24 * 60 - startMinuteOfDay(w) + endMinuteOfDay(w)
    : endMinuteOfDay(w) - startMinuteOfDay(w);
}

/** The window opening on the Belgrade day that contains `day`. */
function windowStartingOn(w: Window, day: Date): [number, number] | null {
  const p = belgradeParts(day);
  const start = fromBelgrade(p.year, p.month, p.day, w.startHour, w.startMinute).getTime();
  const endDay = crossesMidnight(w) ? p.day + 1 : p.day;
  const end = fromBelgrade(p.year, p.month, endDay, w.endHour, w.endMinute).getTime();
  return end > start ? [start, end] : null;
}

/** Seconds of [start, end) inside night windows. */
export function nightSeconds(w: Window, start: Date, end: Date): number {
  if (end <= start || isEmptyWindow(w)) return 0;
  let totalMs = 0;
  // Start a day early: a window that opened yesterday at 23:00 is still open at 01:00 today.
  const first = belgradeParts(new Date(start.getTime() - 86400000));
  for (let offset = 0; ; offset++) {
    const day = fromBelgrade(first.year, first.month, first.day + offset);
    if (day.getTime() >= end.getTime()) break;
    const window = windowStartingOn(w, day);
    if (window) {
      const from = Math.max(window[0], start.getTime());
      const to = Math.min(window[1], end.getTime());
      if (to > from) totalMs += to - from;
    }
    if (offset > 4000) break;
  }
  return totalMs / 1000;
}

/** Splits a session's energy assuming constant power (the backend sends the real split; this is for estimates). */
export function split(w: Window, totalKWh: number, start: Date, end: Date): EnergySplit {
  const seconds = (end.getTime() - start.getTime()) / 1000;
  if (seconds <= 0 || totalKWh <= 0) return ZERO;
  const nightKWh = totalKWh * (nightSeconds(w, start, end) / seconds);
  return { nightKWh, dayKWh: totalKWh - nightKWh };
}

/** Cost at the two rates, rounded to paras (half up). */
export function cost(rates: Pick<Rates, "highRateRSDPerKWh" | "lowRateRSDPerKWh">, energy: EnergySplit): number {
  return roundHalfUp(energy.nightKWh * rates.lowRateRSDPerKWh + energy.dayKWh * rates.highRateRSDPerKWh, 2);
}

export function isNight(w: Window, at: Date): boolean {
  return nightSeconds(w, at, new Date(at.getTime() + 1000)) > 0;
}

function nextBoundary(hour: number, minute: number, after: Date): Date {
  const p = belgradeParts(after);
  for (let offset = 0; offset <= 2; offset++) {
    const candidate = fromBelgrade(p.year, p.month, p.day + offset, hour, minute);
    if (candidate > after) return candidate;
  }
  return fromBelgrade(p.year, p.month, p.day + 3, hour, minute);
}

/** Next opening of the window after `after` (if it is open now — the next one, not the current). */
export function nextWindowOpening(w: Window, after: Date): Date | null {
  return isEmptyWindow(w) ? null : nextBoundary(w.startHour, w.startMinute, after);
}

/** Next closing of the window after `after` — "do 07:00" of an auto-start session. */
export function nextWindowClosing(w: Window, after: Date): Date | null {
  return isEmptyWindow(w) ? null : nextBoundary(w.endHour, w.endMinute, after);
}

/** Window with one bound moved (minutes wrap around the day). */
export function moveBound(w: Window, bound: "start" | "end", minuteOfDay: number): Window {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  return bound === "start"
    ? { ...w, startHour: Math.floor(m / 60), startMinute: m % 60 }
    : { ...w, endHour: Math.floor(m / 60), endMinute: m % 60 };
}

/** Both bounds rounded to a step: 23:07 → 23:00, 23:08 → 23:15. */
export function roundWindow(w: Window, step = 15): Window {
  const r = (v: number) => ((Math.round(v / step) * step) % 1440 + 1440) % 1440;
  return moveBound(moveBound(w, "start", r(startMinuteOfDay(w))), "end", r(endMinuteOfDay(w)));
}

import { describe, expect, it } from "vitest";
import {
  addDays,
  atTime,
  belgradeParts,
  dayKey,
  fromBelgrade,
  isoBelgrade,
  monthEnd,
  offsetMinutes,
  startOfDay,
} from "../../src/lib/belgrade";
import {
  dateAndTime,
  dayAndMonth,
  decimal,
  duration,
  energyValue,
  fullDate,
  monthAndYear,
  percentValue,
  rate,
  roundHalfUp,
  rsd,
  rsdPrecise,
  time,
} from "../../src/lib/format";
import { statementDueDate } from "../../src/lib/statement";
import { parseStatement } from "../../src/api/parse";
import fixture from "../fixtures/api/statement_2026_09.json";

describe("money and energy — Serbian format in every language", () => {
  it("formats dinars", () => {
    expect(rsd(1690)).toBe("1.690 RSD");
    expect(rsd(669.56)).toBe("670 RSD");
    expect(rsd(0)).toBe("0 RSD");
    expect(rsd(1234567)).toBe("1.234.567 RSD");
    expect(rsd(999.5)).toBe("1.000 RSD");
  });

  it("formats dinars with paras", () => {
    expect(rsdPrecise(310.62)).toBe("310,62 RSD");
    expect(rsdPrecise(1690)).toBe("1.690,00 RSD");
    expect(rsdPrecise(1.005)).toBe("1,01 RSD");
  });

  it("formats rates like the EPS bill", () => {
    expect(rate(5.7)).toBe("5,70");
    expect(rate(19.65)).toBe("19,65");
    expect(rate(1234.5)).toBe("1234,50");
  });

  it("formats kWh values", () => {
    expect(decimal(12.44)).toBe("12,4");
    expect(decimal(12.45)).toBe("12,5");
    expect(energyValue(99.94)).toBe("99,9");
    expect(energyValue(209.3)).toBe("209");
    expect(energyValue(1209.6)).toBe("1.210");
    expect(percentValue(0.814)).toBe("81");
  });

  it("rounds half up robustly", () => {
    expect(roundHalfUp(2.675, 2)).toBe(2.68);
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(-0.5)).toBe(-1);
  });

  it("formats durations", () => {
    expect(duration(7 * 3600 + 12 * 60, "sr")).toBe("7 h 12 min");
    expect(duration(48 * 60, "en")).toBe("48 min");
    expect(duration(3 * 3600 + 5 * 60, "ru")).toBe("3 ч 5 мин");
  });
});

describe("dates — interface language, always Europe/Belgrade", () => {
  const summer = new Date("2026-08-14T21:15:00Z"); // 23:15 CEST

  it("shows Belgrade wall-clock time whatever the host zone", () => {
    expect(time(summer, "sr")).toBe("23:15");
    expect(time(new Date("2026-01-14T22:15:00Z"), "en")).toBe("23:15"); // CET
  });

  it("localizes dates", () => {
    expect(fullDate(summer, "sr")).toBe("14. avgust 2026.");
    expect(fullDate(summer, "en")).toBe("August 14, 2026");
    expect(fullDate(summer, "ru")).toBe("14 августа 2026 г.");
    expect(dayAndMonth(summer, "sr")).toBe("14. avg");
    expect(monthAndYear(2026, 9, "sr")).toBe("septembar 2026.");
    expect(monthAndYear(2026, 9, "en")).toBe("September 2026");
    expect(monthAndYear(2026, 9, "ru")).toBe("сентябрь 2026 г.");
    expect(dateAndTime(summer, "en")).toBe("Aug 14, 23:15");
  });

  it("a session crossing midnight belongs to the Belgrade day it started on", () => {
    const start = new Date("2026-07-14T21:07:00Z"); // 23:07 Belgrade, 14 July
    expect(dayKey(start)).toBe("2026-07-14");
    expect(dayKey(new Date("2026-07-14T22:30:00Z"))).toBe("2026-07-15");
  });

  it("handles the spring-forward night (29 March 2026)", () => {
    // 01:30 CET = 00:30Z; 03:30 CEST = 01:30Z — one hour apart on the clock, one hour in reality.
    const before = fromBelgrade(2026, 3, 29, 1, 30);
    const after = fromBelgrade(2026, 3, 29, 3, 30);
    expect(before.toISOString()).toBe("2026-03-29T00:30:00.000Z");
    expect(after.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(offsetMinutes(before)).toBe(60);
    expect(offsetMinutes(after)).toBe(120);
    expect(time(after, "sr")).toBe("03:30");
    // The day is 23 hours long.
    const day = startOfDay(before);
    expect(addDays(day, 1).getTime() - day.getTime()).toBe(23 * 3600_000);
    // 02:30 does not exist; it resolves after the gap.
    expect(time(fromBelgrade(2026, 3, 29, 2, 30), "sr")).toBe("03:30");
  });

  it("handles the fall-back night (25 October 2026)", () => {
    const day = fromBelgrade(2026, 10, 25);
    expect(addDays(day, 1).getTime() - day.getTime()).toBe(25 * 3600_000);
    expect(isoBelgrade(atTime(day, 23, 0))).toBe("2026-10-25T23:00:00+01:00");
    expect(isoBelgrade(fromBelgrade(2026, 10, 24, 23))).toBe("2026-10-24T23:00:00+02:00");
  });

  it("builds month boundaries in Belgrade", () => {
    expect(monthEnd({ year: 2026, month: 12 }).toISOString()).toBe("2026-12-31T23:00:00.000Z");
    expect(belgradeParts(monthEnd({ year: 2026, month: 3 })).month).toBe(4);
  });
});

describe("statement due date", () => {
  it("is the 15th of the next month when the server omits it", () => {
    const due = statementDueDate({ month: { year: 2026, month: 8 }, dueDate: null });
    expect(isoBelgrade(due)).toBe("2026-09-15T00:00:00+02:00");
    expect(fullDate(due, "sr")).toBe("15. septembar 2026.");
  });

  it("wraps into January", () => {
    expect(isoBelgrade(statementDueDate({ month: { year: 2026, month: 12 }, dueDate: null })))
      .toBe("2027-01-15T00:00:00+01:00");
  });

  it("uses the server's dueDate when present", () => {
    const statement = parseStatement(fixture);
    expect(isoBelgrade(statementDueDate(statement))).toBe("2026-10-15T00:00:00+02:00");
    const custom = new Date("2026-10-20T00:00:00+02:00");
    expect(statementDueDate({ month: { year: 2026, month: 9 }, dueDate: custom })).toBe(custom);
  });
});

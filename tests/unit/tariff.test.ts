import { describe, expect, it } from "vitest";
import { fromBelgrade } from "../../src/lib/belgrade";
import { BOM, csvFileName, escapeCsv, sessionsCsv } from "../../src/lib/csv";
import {
  cost,
  isNight,
  nextWindowClosing,
  nextWindowOpening,
  nightSeconds,
  powerShare,
  roundWindow,
  split,
  windowMinutes,
} from "../../src/lib/tariff";

const night = { startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 };
const belgrade = { startHour: 0, startMinute: 0, endHour: 8, endMinute: 0 };

describe("night window", () => {
  it("counts a session inside the window", () => {
    const start = fromBelgrade(2026, 7, 14, 23, 7);
    const end = fromBelgrade(2026, 7, 15, 4, 31);
    expect(nightSeconds(night, start, end)).toBe((5 * 60 + 24) * 60);
  });

  it("splits a session crossing into the day", () => {
    const e = split(night, 10, fromBelgrade(2026, 7, 15, 6, 0), fromBelgrade(2026, 7, 15, 8, 0));
    expect(e.nightKWh).toBeCloseTo(5);
    expect(e.dayKWh).toBeCloseTo(5);
  });

  it("splits a Belgrade window that opens at midnight", () => {
    const e = split(belgrade, 12, fromBelgrade(2026, 9, 1, 22, 0), fromBelgrade(2026, 9, 2, 2, 0));
    expect(e.dayKWh).toBeCloseTo(6);
    expect(e.nightKWh).toBeCloseTo(6);
  });

  it("is one hour shorter on the spring-forward night", () => {
    const start = fromBelgrade(2026, 3, 28, 23, 0);
    const end = fromBelgrade(2026, 3, 29, 7, 0);
    expect(nightSeconds(night, start, end)).toBe(7 * 3600);
    expect(windowMinutes(night)).toBe(480);
  });

  it("is one hour longer on the fall-back night", () => {
    expect(nightSeconds(night, fromBelgrade(2026, 10, 24, 23), fromBelgrade(2026, 10, 25, 7))).toBe(9 * 3600);
  });

  it("finds the next opening and closing", () => {
    const evening = fromBelgrade(2026, 9, 29, 20, 0);
    expect(nextWindowOpening(night, evening)!.getTime()).toBe(fromBelgrade(2026, 9, 29, 23).getTime());
    const inside = fromBelgrade(2026, 9, 29, 23, 30);
    expect(isNight(night, inside)).toBe(true);
    expect(nextWindowOpening(night, inside)!.getTime()).toBe(fromBelgrade(2026, 9, 30, 23).getTime());
    expect(nextWindowClosing(night, inside)!.getTime()).toBe(fromBelgrade(2026, 9, 30, 7).getTime());
    expect(isNight(night, fromBelgrade(2026, 9, 29, 12))).toBe(false);
  });

  it("an empty window means no night tariff, not round the clock", () => {
    const empty = { startHour: 23, startMinute: 0, endHour: 23, endMinute: 0 };
    expect(nightSeconds(empty, fromBelgrade(2026, 9, 1), fromBelgrade(2026, 9, 2))).toBe(0);
    expect(nextWindowOpening(empty, new Date())).toBeNull();
  });

  it("rounds bounds to 15 minutes", () => {
    expect(roundWindow({ startHour: 23, startMinute: 7, endHour: 6, endMinute: 53 }))
      .toEqual({ startHour: 23, startMinute: 0, endHour: 7, endMinute: 0 });
    expect(roundWindow({ startHour: 23, startMinute: 53, endHour: 7, endMinute: 8 }))
      .toEqual({ startHour: 0, startMinute: 0, endHour: 7, endMinute: 15 });
  });

  it("costs energy at two rates, rounded to paras", () => {
    expect(cost({ lowRateRSDPerKWh: 5.7, highRateRSDPerKWh: 19.65 }, { nightKWh: 47.6, dayKWh: 2 })).toBe(310.62);
  });
});

describe("the Danas ring", () => {
  it("is the power now against the point's nominal power", () => {
    expect(powerShare(10.8, 11)).toBeCloseTo(0.9818, 4);
    expect(powerShare(3.3, 3.7)).toBeCloseTo(0.8919, 4);
    expect(powerShare(11.4, 11)).toBe(1);
    expect(powerShare(0, 11)).toBe(0);
    expect(powerShare(null, 11)).toBe(0);
    expect(powerShare(5, 0)).toBe(0);
    expect(powerShare(Number.NaN, 11)).toBe(0);
  });
});

describe("CSV for Serbian Excel", () => {
  const columns = { date: "Datum", start: "Početak", end: "Kraj", nightKWh: "kWh noć", dayKWh: "kWh dan",
    rsd: "RSD", rsdEstimate: "RSD (procena)", tag: "Oznaka" };
  const tags = { personal: "lično", business: "službeno" };
  const sessions = [
    { startedAt: new Date("2026-09-20T21:00:00Z"), endedAt: new Date("2026-09-21T01:30:00Z"),
      energy: { nightKWh: 28.6, dayKWh: 0 }, tag: "personal" as const },
    { startedAt: new Date("2026-09-10T20:40:00Z"), endedAt: new Date("2026-09-11T00:10:00Z"),
      energy: { nightKWh: 19, dayKWh: 2 }, tag: null },
  ];

  it("writes ; separated rows, decimal commas, Belgrade time, oldest first, CRLF", () => {
    const text = sessionsCsv(sessions, { lowRateRSDPerKWh: 5.7, highRateRSDPerKWh: 19.65, source: "meterOwnerBill" },
      columns, tags);
    expect(text).toBe(
      "Datum;Početak;Kraj;kWh noć;kWh dan;RSD;Oznaka\r\n"
      + "2026-09-10;22:40;02:10;19,00;2,00;147,60;\r\n"
      + "2026-09-20;23:00;03:30;28,60;0,00;163,02;lično\r\n",
    );
  });

  it("names the amount column an estimate when prices are typical", () => {
    const text = sessionsCsv([], { lowRateRSDPerKWh: 5.7, highRateRSDPerKWh: 19.65, source: "estimate" }, columns, tags);
    expect(text.split("\r\n")[0]).toContain("RSD (procena)");
  });

  it("quotes fields with separators and uses a BOM", () => {
    expect(escapeCsv('a;b')).toBe('"a;b"');
    expect(escapeCsv('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsv("plain")).toBe("plain");
    expect(BOM).toBe("﻿");
    expect(new TextEncoder().encode(BOM)).toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(csvFileName(new Date("2026-09-21T23:30:00Z"))).toBe("evolako-sesije-2026-09-22.csv");
  });
});

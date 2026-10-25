// Input rules of the forms (ports of the app's validators) and the small helpers of the screens.
import { describe, expect, it } from "vitest";
import { fromBelgrade } from "../../src/lib/belgrade";
import {
  fold,
  isValidEmail,
  isValidPhone,
  matchesQuery,
  niceScale,
  normalizeReferral,
  parsePrice,
  relocationDates,
} from "../../src/lib/forms";

describe("assessment request", () => {
  it("accepts Serbian phone numbers as people write them", () => {
    for (const ok of ["+381 60 123 45 67", "060/123-4567", "0601234567", "(011) 123-4567"]) expect(isValidPhone(ok), ok).toBe(true);
    for (const bad of ["123", "+381 60 ab 45 67", "60+1234567", "+381 60 123 45 67 89 01 23"]) expect(isValidPhone(bad), bad).toBe(false);
  });

  it("checks e-mail only against typos", () => {
    expect(isValidEmail("ana@example.com")).toBe(true);
    expect(isValidEmail("ana@example")).toBe(false);
    expect(isValidEmail("ana example@example.com")).toBe(false);
    expect(isValidEmail("@example.com")).toBe(false);
    expect(isValidEmail("ana@example..com")).toBe(false);
  });

  it("normalises referral codes and rejects look-alikes", () => {
    expect(normalizeReferral(" evo-7kq2m ")).toBe("EVO-7KQ2M");
    expect(normalizeReferral("EVO - 7KQ2M")).toBe("EVO-7KQ2M");
    expect(normalizeReferral("EVO-7KQ2O")).toBeNull(); // O is not in the alphabet
    expect(normalizeReferral("EVO-7KQ2")).toBeNull();
    expect(normalizeReferral("ABC-7KQ2M")).toBeNull();
  });
});

describe("prices from the EPS bill", () => {
  it("reads a comma or a dot with at most two decimals", () => {
    expect(parsePrice("12,50")).toBe(12.5);
    expect(parsePrice(" 5.7 ")).toBe(5.7);
    expect(parsePrice("19")).toBe(19);
    expect(parsePrice("12,505")).toBe("tooManyDecimals");
    expect(parsePrice("abc")).toBe("notANumber");
    expect(parsePrice("")).toBe("notANumber");
    expect(parsePrice("1,2,3")).toBe("notANumber");
    expect(parsePrice("0,50")).toBe("outOfRange");
    expect(parsePrice("81")).toBe("outOfRange");
  });
});

describe("move dates", () => {
  it("starts the day after the 72-hour answer and ends a year out (Belgrade days)", () => {
    const now = fromBelgrade(2026, 10, 12, 23, 40);
    expect(relocationDates(now)).toEqual({ earliest: "2026-10-16", latest: "2027-10-12", initial: "2026-10-26" });
  });

  it("works across the DST change", () => {
    const now = fromBelgrade(2026, 10, 24, 12, 0);
    expect(relocationDates(now).earliest).toBe("2026-10-28");
  });
});

describe("FAQ search", () => {
  it("ignores case and diacritics", () => {
    expect(fold("Šta je UKLJUČENO u cenu?")).toBe("sta je ukljuceno u cenu?");
    expect(matchesQuery("Koliko košta kućni punjač sa ugradnjom?", "kosta PUNJAC")).toBe(true);
    expect(matchesQuery("Đak i struja", "djak")).toBe(true);
    expect(matchesQuery("Đak i struja", "dak")).toBe(true);
    expect(matchesQuery("Сколько стоит зарядка?", "СКОЛЬКО")).toBe(true);
    expect(matchesQuery("Koliko košta?", "skupština")).toBe(false);
    expect(matchesQuery("anything", "   ")).toBe(true);
  });
});

describe("chart scale", () => {
  it("rounds the axis to friendly steps", () => {
    expect(niceScale(0)).toEqual({ top: 10, step: 5 });
    expect(niceScale(34.1)).toEqual({ top: 40, step: 20 });
    expect(niceScale(9)).toEqual({ top: 10, step: 5 });
    expect(niceScale(420)).toEqual({ top: 600, step: 200 });
  });
});

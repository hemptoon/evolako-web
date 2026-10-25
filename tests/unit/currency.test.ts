// Display currency: conversion and format exactly per docs/VALUTA_SPEC_2026-10-06.md §5, at the fallback rate of
// 05.10.2026 (EUR 117,4948; USD 105,0468). The spec's table is recomputed here: if a figure disagrees, the test wins.
import { describe, expect, it } from "vitest";
import {
  compactAmount,
  convert,
  FALLBACK_FX,
  foreignAmount,
  foreignRate,
  foreignRateRange,
  fxDate,
  ownPrice,
  ownPriceLine,
  referenceAmount,
  referenceRate,
  rsd,
} from "../../src/lib/format";

const fx = FALLBACK_FX;
/** The spec writes plain spaces; the product uses no-break spaces after "≈" and before the symbol. */
const nb = (s: string) => s.replace(/ /g, " ");

describe("spec §5 table", () => {
  const amounts: Array<[number, string, string]> = [
    [125000, "≈ 1.064 €", "≈ 1.190 $"],
    [59000, "≈ 502 €", "≈ 562 $"],
    [990, "≈ 8,43 €", "≈ 9,42 $"],
    [3500, "≈ 29,79 €", "≈ 33,32 $"],
  ];
  for (const [value, eur, usd] of amounts) {
    it(`${value} RSD`, () => {
      expect(foreignAmount(value, "EUR", fx)).toBe(nb(eur));
      expect(foreignAmount(value, "USD", fx)).toBe(nb(usd));
    });
  }

  const rates: Array<[number, string, string, string]> = [
    [58.33, "min", "≈ 0,50 €/min", "≈ 0,56 $/min"],
    [1.2, "min", "≈ 0,010 €/min", "≈ 0,011 $/min"],
    [6, "kWh", "≈ 0,051 €/kWh", "≈ 0,057 $/kWh"],
  ];
  for (const [value, unit, eur, usd] of rates) {
    it(`${value} RSD/${unit}`, () => {
      expect(foreignRate(value, "EUR", fx, unit)).toBe(nb(eur));
      expect(foreignRate(value, "USD", fx, unit)).toBe(nb(usd));
    });
  }

  it("43–79 RSD/kWh", () => {
    expect(foreignRateRange(43, 79, "EUR", fx, "kWh")).toBe(nb("≈ 0,37–0,67 €/kWh"));
    expect(foreignRateRange(43, 79, "USD", fx, "kWh")).toBe(nb("≈ 0,41–0,75 $/kWh"));
  });
});

describe("conversion rules", () => {
  it("zero is exact, without ≈", () => {
    expect(foreignAmount(0, "EUR", fx)).toBe(nb("0 €"));
    expect(foreignAmount(0, "USD", fx)).toBe(nb("0 $"));
    expect(foreignRate(0, "EUR", fx, "kWh")).toBe(nb("0 €/kWh"));
  });

  it("rounds half up from the dinar amount", () => {
    // 117,4948 × 8,425 = 989,89… → 8,425 € exactly half → 8,43
    const half = 8.425 * fx.rates.EUR;
    expect(foreignAmount(half, "EUR", fx)).toBe(nb("≈ 8,43 €"));
    // just below 100 stays with two decimals, from 100 on whole numbers
    expect(foreignAmount(99.99 * fx.rates.EUR, "EUR", fx)).toBe(nb("≈ 99,99 €"));
    expect(foreignAmount(100 * fx.rates.EUR, "EUR", fx)).toBe(nb("≈ 100 €"));
    expect(foreignAmount(1000.5 * fx.rates.EUR, "EUR", fx)).toBe(nb("≈ 1.001 €"));
  });

  it("rates below 0,10 get three decimals, from 0,10 on two", () => {
    expect(foreignRate(0.0995 * fx.rates.EUR, "EUR", fx, "kWh")).toBe(nb("≈ 0,10 €/kWh"));
    expect(foreignRate(0.0994 * fx.rates.EUR, "EUR", fx, "kWh")).toBe(nb("≈ 0,099 €/kWh"));
  });

  it("a range takes its decimals from the lower end, for both ends", () => {
    expect(foreignRateRange(6, 20, "EUR", fx, "kWh")).toBe(nb("≈ 0,051–0,170 €/kWh"));
    expect(foreignRateRange(79, 43, "EUR", fx, "kWh")).toBe(nb("≈ 0,37–0,67 €/kWh"));
  });

  it("divides by the rate", () => {
    expect(convert(117.4948, "EUR", fx)).toBeCloseTo(1, 10);
    expect(convert(990, "RSD", fx)).toBe(990);
  });

  it("the list date is dd.MM.yyyy in every language", () => {
    expect(fxDate(fx)).toBe("05.10.2026");
  });
});

describe("kinds A and B", () => {
  it("with RSD everything reads as before", () => {
    expect(ownPrice(990, "RSD", fx)).toEqual({ main: rsd(990), secondary: null });
    expect(ownPriceLine(990, "RSD", fx)).toBe("990 RSD");
    expect(referenceAmount(3208.4, "RSD", fx)).toEqual({ main: "3.208 RSD", secondary: null });
    expect(referenceRate(5.7, "RSD", fx, "kWh", "5,70 RSD / kWh")).toEqual({ main: "5,70 RSD / kWh", secondary: null });
    expect(compactAmount(3208.4, "RSD", fx)).toEqual({ value: "3.208", unit: "RSD" });
  });

  it("A: dinars first, the conversion second", () => {
    expect(ownPrice(125000, "EUR", fx)).toEqual({ main: "125.000 RSD", secondary: nb("≈ 1.064 €") });
    expect(ownPriceLine(990, "EUR", fx)).toBe(`990 RSD · ${nb("≈ 8,43 €")}`);
  });

  it("B: the chosen currency first, dinars second", () => {
    expect(referenceAmount(3500, "USD", fx)).toEqual({ main: nb("≈ 33,32 $"), secondary: "3.500 RSD" });
    expect(referenceRate(6, "EUR", fx, "kWh", "6,00 RSD / kWh"))
      .toEqual({ main: nb("≈ 0,051 €/kWh"), secondary: "6,00 RSD / kWh" });
  });

  it("compact: only the conversion, number and unit apart", () => {
    expect(compactAmount(3500, "EUR", fx)).toEqual({ value: nb("≈ 29,79"), unit: "€" });
    expect(compactAmount(0, "USD", fx)).toEqual({ value: "0", unit: "$" });
  });
});

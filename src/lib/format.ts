// Numbers, money, energy and dates of the product.
//
// Money and energy are always written the Serbian way — "1.690 RSD", "12,4 kWh" — in every interface language:
// this is the format of the payment document (BVFormat in the app). Dates follow the interface language but are
// always shown in Europe/Belgrade: a session that started at 23:10 in Belgrade stays 23:10 abroad.
import { TIME_ZONE } from "./belgrade";

/**
 * The interface language. "sr" is Serbian in Latin script (the default), "sr-Cyrl" the same texts in Cyrillic —
 * a script, not a translation: the backend, the e-mails and the site content know only ContentLang.
 */
export type Lang = "sr" | "sr-Cyrl" | "en" | "ru";
export type ContentLang = "sr" | "en" | "ru";

export const LOCALES: Record<Lang, string> = { sr: "sr-Latn-RS", "sr-Cyrl": "sr-Cyrl-RS", en: "en-US", ru: "ru-RU" };

/** <html lang> and the `lang` attribute of a text in that language. */
export const HTML_LANG: Record<Lang, string> = { sr: "sr-Latn", "sr-Cyrl": "sr-Cyrl", en: "en", ru: "ru" };

/** What the backend, the e-mails and the content documents are written in: Cyrillic is Serbian there. */
export function contentLang(lang: Lang): ContentLang {
  return lang === "sr-Cyrl" ? "sr" : lang;
}

// ---------------------------------------------------------------- numbers

/** Round half away from zero to `decimals` places, robust to binary floating point ("1.005" → 1.01). */
export function roundHalfUp(value: number, decimals = 0): number {
  const factor = 10 ** decimals;
  const shifted = Math.abs(value) * factor;
  const rounded = Math.round(Number(shifted.toPrecision(15)));
  return (Math.sign(value) * rounded) / factor || 0;
}

function group(integer: string, separator: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

/**
 * A number with Serbian separators: "." for thousands, "," for decimals. Deterministic (no Intl), so the
 * payment-document format cannot drift with the browser's ICU data.
 */
export function decimal(value: number, fractionDigits = 1, grouping = true): string {
  const rounded = roundHalfUp(value, fractionDigits);
  const negative = rounded < 0;
  const [int = "0", frac] = Math.abs(rounded).toFixed(fractionDigits).split(".");
  const body = (grouping ? group(int, ".") : int) + (frac ? `,${frac}` : "");
  return negative ? `−${body}` : body;
}

/** Whole dinars: "1.690 RSD". */
export function rsd(amount: number): string {
  return `${decimal(amount, 0)} RSD`;
}

/** Dinars with paras, for payment documents: "1.690,00 RSD". */
export function rsdPrecise(amount: number): string {
  return `${decimal(amount, 2)} RSD`;
}

/** Price per kWh as on the EPS bill, no grouping: "12,50". */
export function rate(amount: number): string {
  return decimal(amount, 2, false);
}

/** Tiles: one decimal below 100 kWh, whole numbers above (209,3 kWh a month is false precision). */
export function energyValue(kWh: number): string {
  return decimal(kWh, Math.abs(kWh) >= 100 ? 0 : 1);
}

/** Share 0…1 → "81". */
export function percentValue(share: number): string {
  return decimal(Math.round(share * 100), 0);
}

/** Session length: "7 h 12 min", "48 min" (Russian units in Russian; Cyrillic as on evolako.rs: "7 h 12 мин"). */
export function duration(seconds: number, lang: Lang): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const [h, min] = lang === "ru" ? ["ч", "мин"] : lang === "sr-Cyrl" ? ["h", "мин"] : ["h", "min"];
  return hours > 0 ? `${hours} ${h} ${minutes} ${min}` : `${minutes} ${min}`;
}

// ---------------------------------------------------------------- dates

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(lang: Lang, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${lang}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(LOCALES[lang], { timeZone: TIME_ZONE, ...options });
    cache.set(key, f);
  }
  return f;
}

/** "23:15" */
export function time(date: Date, lang: Lang): string {
  return formatter(lang, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** "14. avg" / "Aug 14" / "14 авг." */
export function dayAndMonth(date: Date, lang: Lang): string {
  return formatter(lang, { day: "numeric", month: "short" }).format(date);
}

/** "14. avgust 2026." / "August 14, 2026" / "14 августа 2026 г." */
export function fullDate(date: Date, lang: Lang): string {
  return formatter(lang, { day: "numeric", month: "long", year: "numeric" }).format(date);
}

/** "14. avg 23:15" / "Aug 14, 23:15" */
export function dateAndTime(date: Date, lang: Lang): string {
  return formatter(lang, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .format(date);
}

/** "petak, 14. avgust" — the day heading in lists. */
export function weekdayAndDate(date: Date, lang: Lang): string {
  return formatter(lang, { weekday: "long", day: "numeric", month: "long" }).format(date);
}

/** "avgust 2026." / "August 2026" / "август 2026 г." — a statement's month. */
export function monthAndYear(year: number, month: number, lang: Lang): string {
  // Noon on the 15th: far from any day or DST boundary.
  return formatter(lang, { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

/** "avgust" — month name for compact lists. */
export function monthName(year: number, month: number, lang: Lang): string {
  return formatter(lang, { month: "long" }).format(new Date(Date.UTC(year, month - 1, 15, 12)));
}

/** "avg" — chart axis. */
export function monthShort(year: number, month: number, lang: Lang): string {
  return formatter(lang, { month: "short" }).format(new Date(Date.UTC(year, month - 1, 15, 12))).replace(/\.$/, "");
}

/** "pet" — chart axis for a week. */
export function weekdayShort(date: Date, lang: Lang): string {
  return formatter(lang, { weekday: "short" }).format(date);
}

/** "14" — chart axis for a month. */
export function dayNumber(date: Date, lang: Lang): string {
  return formatter(lang, { day: "numeric" }).format(date);
}

// ---------------------------------------------------------------- display currency (VALUTA_SPEC_2026-10-06)
//
// RSD by default; EUR or USD only by the person's choice. Payments are always in dinars: statements, IPS QR, PDF,
// CSV and e-mails keep rsd() / rsdPrecise() / rate() above and never see these functions. A converted amount is a
// reference, always marked "≈", at the NBS middle rate, rounded half up from the dinar amount (never from an
// already rounded one), and written the Serbian way in every language: "≈ 1.064 €", "≈ 0,49 €/kWh".

export type Currency = "RSD" | "EUR" | "USD";
export const CURRENCIES: Currency[] = ["RSD", "EUR", "USD"];

export function isCurrency(value: unknown): value is Currency {
  return value === "RSD" || value === "EUR" || value === "USD";
}

/** The rate document (`fx` of the content, spec §2): RSD per 1 EUR / 1 USD, `date` = the NBS list's date. */
export interface FxRates {
  base: "RSD";
  source: string;
  date: string;
  rates: { EUR: number; USD: number };
  fetchedAt: string | null;
  stale: boolean;
}

/** Fallback when there is no rate in the cache or the network (spec §2, 05.10.2026). Update with every release. */
export const FALLBACK_FX: FxRates = {
  base: "RSD",
  source: "NBS srednji kurs",
  date: "2026-10-05",
  rates: { EUR: 117.4948, USD: 105.0468 },
  fetchedAt: null,
  stale: false,
};

/** Sanity bounds of a rate before it is used or kept (spec §2). */
export const FX_BOUNDS: Record<Exclude<Currency, "RSD">, [number, number]> = { EUR: [100, 140], USD: [80, 140] };

const SYMBOL: Record<Currency, string> = { RSD: "RSD", EUR: "€", USD: "$" };
const NBSP = " ";
const APPROX = `≈${NBSP}`;

/** The amount in the chosen currency, unrounded. */
export function convert(amountRSD: number, currency: Currency, fx: FxRates): number {
  return currency === "RSD" ? amountRSD : amountRSD / fx.rates[currency];
}

/** "dd.MM.yyyy" in every language (the date of the NBS list in the note and the hint). */
export function fxDate(fx: FxRates): string {
  const [y, m, d] = fx.date.split("-");
  return `${d}.${m}.${y}`;
}

/** Decimals of a converted amount: none from 100 up, two below. */
function amountDecimals(value: number): number {
  return Math.abs(roundHalfUp(value, 2)) >= 100 ? 0 : 2;
}

/** Decimals of a converted rate (per kWh, minute, km…): two, three below 0,10. */
function rateDecimals(value: number): number {
  return Math.abs(roundHalfUp(value, 3)) < 0.1 ? 3 : 2;
}

/** "≈ 1.064 €", "≈ 8,43 €"; zero is exact: "0 €". Never for RSD (use rsd()). */
export function foreignAmount(amountRSD: number, currency: Exclude<Currency, "RSD">, fx: FxRates): string {
  const value = convert(amountRSD, currency, fx);
  if (roundHalfUp(value, 2) === 0) return `0${NBSP}${SYMBOL[currency]}`;
  return `${APPROX}${decimal(value, amountDecimals(value))}${NBSP}${SYMBOL[currency]}`;
}

/** "≈ 0,49 €/kWh", "≈ 0,010 €/min"; zero: "0 €/kWh". */
export function foreignRate(rsdPerUnit: number, currency: Exclude<Currency, "RSD">, fx: FxRates, unit: string): string {
  const value = convert(rsdPerUnit, currency, fx);
  if (roundHalfUp(value, 3) === 0) return `0${NBSP}${SYMBOL[currency]}/${unit}`;
  return `${APPROX}${decimal(value, rateDecimals(value))}${NBSP}${SYMBOL[currency]}/${unit}`;
}

/** "≈ 0,37–0,67 €/kWh": the decimals follow the lower end and are the same at both ends; the unit once. */
export function foreignRateRange(lowRSD: number, highRSD: number, currency: Exclude<Currency, "RSD">, fx: FxRates,
  unit: string): string {
  const low = convert(Math.min(lowRSD, highRSD), currency, fx);
  const high = convert(Math.max(lowRSD, highRSD), currency, fx);
  const digits = rateDecimals(low);
  return `${APPROX}${decimal(low, digits)}–${decimal(high, digits)}${NBSP}${SYMBOL[currency]}/${unit}`;
}

/** What the page draws: `main` first, `secondary` muted next to it (null with RSD — the page looks as before). */
export interface MoneyText {
  main: string;
  secondary: string | null;
}

/**
 * Kind A — Evolako's own price (kits, subscription, assessment): dinars first, the conversion muted next to them.
 * "125.000 RSD" · "≈ 1.064 €".
 */
export function ownPrice(amountRSD: number, currency: Currency, fx: FxRates): MoneyText {
  return { main: rsd(amountRSD), secondary: currency === "RSD" ? null : foreignAmount(amountRSD, currency, fx) };
}

/**
 * Kind B — a reference amount (estimates, statistics, a session's cost): the chosen currency first, dinars muted.
 * "≈ 27,30 €" · "3.208 RSD". `rsdText` is the dinar text as the page writes it with RSD (default: rsd()).
 */
export function referenceAmount(amountRSD: number, currency: Currency, fx: FxRates, rsdText = rsd(amountRSD)): MoneyText {
  return currency === "RSD"
    ? { main: rsdText, secondary: null }
    : { main: foreignAmount(amountRSD, currency, fx), secondary: rsdText };
}

/** Kind B for a rate: "≈ 0,049 €/kWh" · "5,70 RSD / kWh". `rsdText` — the dinar text as written with RSD. */
export function referenceRate(rsdPerUnit: number, currency: Currency, fx: FxRates, unit: string, rsdText: string): MoneyText {
  return currency === "RSD"
    ? { main: rsdText, secondary: null }
    : { main: foreignRate(rsdPerUnit, currency, fx, unit), secondary: rsdText };
}

/** Tight places (tiles with one figure): the number and the unit apart. RSD: "3.208" + "RSD", as before. */
export function compactAmount(amountRSD: number, currency: Currency, fx: FxRates): { value: string; unit: string } {
  if (currency === "RSD") return { value: decimal(amountRSD, 0), unit: "RSD" };
  const text = foreignAmount(amountRSD, currency, fx);
  const cut = text.lastIndexOf(NBSP);
  return { value: text.slice(0, cut), unit: text.slice(cut + 1) };
}

/** Kind A as one line: "990 RSD" or "990 RSD · ≈ 8,43 €" (inside a sentence, e.g. the subscription summary). */
export function ownPriceLine(amountRSD: number, currency: Currency, fx: FxRates): string {
  const p = ownPrice(amountRSD, currency, fx);
  return p.secondary ? `${p.main} · ${p.secondary}` : p.main;
}

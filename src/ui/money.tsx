// Amounts in the display currency (docs/VALUTA_SPEC_2026-10-06.md §4). With RSD — the default — every amount reads
// exactly as before. Never used for anything payable: statements, IPS QR, print, CSV keep rsd()/rsdPrecise().
import { currency, fx } from "../app/currency";
import { t } from "../i18n";
import {
  compactAmount,
  foreignAmount,
  fxDate,
  ownPrice,
  ownPriceLine,
  referenceAmount,
  referenceRate,
  rsd,
  type MoneyText,
} from "../lib/format";
import { Icon } from "./Icon";

/** "Preračunato po kursu NBS na 05.10.2026. Cena u dinarima: 3.208 RSD." — the hint of a converted amount. */
export function convertedHint(rsdText: string): string {
  return t("Preračunato po kursu NBS na %@. Cena u dinarima: %@.", fxDate(fx.value), rsdText);
}

function Pair({ text, hint, class: className, testId }: { text: MoneyText; hint: string; class?: string; testId?: string }) {
  if (!text.secondary) return <span class={className} data-testid={testId}>{text.main}</span>;
  return (
    <span class={className ? `money ${className}` : "money"} title={hint} data-testid={testId}>
      <span class="money__main">{text.main}</span>
      <span class="money__alt"> · {text.secondary}</span>
    </span>
  );
}

/** Kind A — Evolako's own price: "125.000 RSD · ≈ 1.064 €". */
export function OwnPrice({ rsd: amount, class: className, testId }: { rsd: number; class?: string; testId?: string }) {
  const text = ownPrice(amount, currency.value, fx.value);
  return <Pair text={text} hint={convertedHint(text.main)} class={className} testId={testId} />;
}

/** Kind B — a reference amount: "≈ 27,30 € · 3.208 RSD". `rsdText` is how the page writes it with RSD. */
export function RefAmount({ rsd: amount, rsdText, class: className, testId }: {
  rsd: number; rsdText?: string; class?: string; testId?: string;
}) {
  const plain = rsdText ?? rsd(amount);
  return <Pair text={referenceAmount(amount, currency.value, fx.value, plain)} hint={convertedHint(plain)}
    class={className} testId={testId} />;
}

/** Kind B for a price per unit: "≈ 0,049 €/kWh · 5,70 RSD / kWh". */
export function RefRate({ rsd: perUnit, unit, rsdText, class: className, testId }: {
  rsd: number; unit: string; rsdText: string; class?: string; testId?: string;
}) {
  return <Pair text={referenceRate(perUnit, currency.value, fx.value, unit, rsdText)} hint={convertedHint(rsdText)}
    class={className} testId={testId} />;
}

/** Tight places (a tile, one figure): the number and the unit apart, only the conversion; dinars in the hint. */
export function compact(amount: number): { value: string; unit: string; hint: string | null } {
  const parts = compactAmount(amount, currency.value, fx.value);
  return { ...parts, hint: currency.value === "RSD" ? null : convertedHint(rsd(amount)) };
}

/**
 * The note — once, at the bottom of a page with converted amounts, and only when the currency is not RSD
 * (`always`: under the switch in the settings).
 */
export function FxNote({ always }: { always?: boolean }) {
  if (!always && currency.value === "RSD") return null;
  return (
    <p class="note fx-note" data-testid="fx-note">
      <Icon name="info" />
      <span>{t("Iznosi u evrima i dolarima su informativni, po srednjem kursu NBS na %@. Plaćaš uvek u dinarima.",
        fxDate(fx.value))}</span>
    </p>
  );
}

/** Kind A inside a sentence: "990 RSD" or "990 RSD · ≈ 8,43 €" (the subscription summary). */
export function ownPriceText(amount: number): string {
  return ownPriceLine(amount, currency.value, fx.value);
}

/** Kind B in a tight place (a list row): only the conversion, dinars in the hint; RSD as before. */
export function CompactAmount({ rsd: amount, class: className }: { rsd: number; class?: string }) {
  if (currency.value === "RSD") return <span class={className}>{rsd(amount)}</span>;
  const plain = rsd(amount);
  return (
    <span class={className} title={convertedHint(plain)}>
      {foreignAmount(amount, currency.value, fx.value)}
      <span class="sr-only"> · {plain}</span>
    </span>
  );
}

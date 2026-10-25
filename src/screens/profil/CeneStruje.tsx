// /profil/cene-struje — the prices per kWh behind every amount. On your own meter you copy them from the EPS
// bill (or go back to the typical prices); on the building's meter we enter them from the building's bill.
import { useEffect, useState } from "preact/hooks";
import type { ChargePoint, TariffConfig } from "../../api/types";
import { markActivity } from "../../app/activity";
import { activePoint, backendOrThrow, k, useTariff, useUser } from "../../app/data";
import { invalidate, setData } from "../../app/query";
import { errorMessage } from "../../app/texts";
import { t } from "../../i18n";
import { rate } from "../../lib/format";
import { parsePrice, PRICE_RANGE, type PriceError } from "../../lib/forms";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button, TextField } from "../../ui/controls";
import { Card, ErrorState, toast } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { PageSkeleton } from "../common";
import { windowText } from "../Schedule";

function fieldMessage(error: PriceError, zone: string): string {
  switch (error) {
    case "notANumber": return t("%@: upiši cenu, na primer 12,50.", zone);
    case "tooManyDecimals": return t("%@: najviše dve decimale, kao na računu.", zone);
    case "outOfRange": return t("%@: cena mora biti između %@ i %@ RSD.", zone, rate(PRICE_RANGE.min), rate(PRICE_RANGE.max));
  }
}

function Rates({ tariff }: { tariff: TariffConfig }) {
  return (
    <dl class="rates rates--big">
      <div>
        <dt><span class="split__swatch split__swatch--day" aria-hidden="true" />{t("Viša tarifa")} <span class="card__sub">· {t("dan")}</span></dt>
        <dd class="num">{rate(tariff.highRateRSDPerKWh)} RSD / {t("kWh")}</dd>
      </div>
      <div>
        <dt><span class="split__swatch split__swatch--night" aria-hidden="true" />{t("Niža tarifa")} <span class="card__sub">· {t("noć")}</span></dt>
        <dd class="num">{rate(tariff.lowRateRSDPerKWh)} RSD / {t("kWh")}</dd>
      </div>
    </dl>
  );
}

function WindowCard({ tariff }: { tariff: TariffConfig }) {
  return (
    <Card as="section" aria-labelledby="window-title">
      <h2 class="card__title" id="window-title">{t("Noćno okno")}</h2>
      <p class="window-line"><span class="card__sub">{t("Niža tarifa važi")}</span><strong class="num">{windowText(tariff.nightWindow)}</strong></p>
      <p class="note"><Icon name="info" /><span>{t("Noćno okno određuje EPS, ne račun — zato se ovde ne menja.")}</span></p>
    </Card>
  );
}

function OwnMeterForm({ point, tariff }: { point: ChargePoint; tariff: TariffConfig }) {
  const [high, setHigh] = useState(rate(tariff.highRateRSDPerKWh));
  const [low, setLow] = useState(rate(tariff.lowRateRSDPerKWh));
  const [errors, setErrors] = useState<{ high?: string; low?: string; pair?: string }>({});
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);

  useEffect(() => {
    setHigh(rate(tariff.highRateRSDPerKWh));
    setLow(rate(tariff.lowRateRSDPerKWh));
  }, [tariff.highRateRSDPerKWh, tariff.lowRateRSDPerKWh]);

  const apply = async (prices: { highRateRSDPerKWh: number; lowRateRSDPerKWh: number } | null) => {
    setBusy(prices ? "save" : "reset");
    try {
      const updated = await backendOrThrow().updateTariffPrices(point.id, prices);
      markActivity(point.id);
      setData(k("tariff", point.id), updated);
      invalidate(k("statement"), k("sessions"));
      toast(t("Sačuvano"));
    } catch (e) {
      setErrors({ pair: errorMessage(e) });
    } finally {
      setBusy(null);
    }
  };

  const save = () => {
    const h = parsePrice(high);
    const lo = parsePrice(low);
    const next: typeof errors = {};
    if (typeof h !== "number") next.high = fieldMessage(h, t("Viša tarifa"));
    if (typeof lo !== "number") next.low = fieldMessage(lo, t("Niža tarifa"));
    if (typeof h === "number" && typeof lo === "number" && lo > h) next.pair = t("Niža tarifa ne može biti skuplja od više.");
    setErrors(next);
    if (next.high || next.low || next.pair) return;
    void apply({ highRateRSDPerKWh: h as number, lowRateRSDPerKWh: lo as number });
  };

  return (
    <form class="card card--block form" noValidate data-testid="tariff-form" onSubmit={(e) => {
      e.preventDefault();
      save();
    }}>
      <div>
        <h2 class="card__title">{t("Cene iz mog EPS računa")}</h2>
        <p class="card__sub">{t("Prepiši cene po kWh sa svog EPS računa. Tada su iznosi u aplikaciji tvoji, a ne procena.")}</p>
      </div>
      <div class="price-fields">
        <TextField label={`${t("Viša tarifa")} · ${t("dan")}`} value={high} onValue={setHigh} inputMode="decimal"
          autoComplete="off" error={errors.high} hint="RSD / kWh" testId="tariff-high" />
        <TextField label={`${t("Niža tarifa")} · ${t("noć")}`} value={low} onValue={setLow} inputMode="decimal"
          autoComplete="off" error={errors.low} hint="RSD / kWh" testId="tariff-low" />
      </div>
      {errors.pair ? <div class="inline-error" role="alert"><Icon name="circleAlert" /><span>{errors.pair}</span></div> : null}
      <p class="note" data-testid="tariff-source">
        <Icon name={tariff.source === "customerBill" ? "badgeCheck" : "help"} />
        <span>{tariff.source === "customerBill" ? t("Iznosi su po cenama iz tvog računa.") : t("Sada su iznosi procena po okvirnim cenama.")}</span>
      </p>
      <div class="form__actions">
        <Button type="submit" loading={busy === "save"} testId="tariff-save">{t("Sačuvaj cene")}</Button>
        {tariff.source === "customerBill" ? (
          <Button variant="ghost" loading={busy === "reset"} onClick={() => void apply(null)} testId="tariff-reset">
            {t("Vrati okvirne cene")}
          </Button>
        ) : null}
      </div>
    </form>
  );
}

export default function CeneStruje(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const tariff = useTariff(point?.id ?? null);
  if (!point) return <PageSkeleton />;

  let body;
  if (!tariff.data) {
    body = tariff.error
      ? <Card><ErrorState message={errorMessage(tariff.error)} onRetry={tariff.reload} /></Card>
      : <PageSkeleton blocks={2} />;
  } else if (point.connectionScheme.type === "thirdPartyMeter") {
    body = (
      <div class="two-col">
        <section class="card card--block" aria-labelledby="building-title" data-testid="tariff-readonly">
          <p class="kicker">{t("Cene po kWh")}</p>
          <h2 class="card__title" id="building-title">{t("Cene unosimo po računu zgrade koji nam pošalješ")}</h2>
          <p class="card__sub">
            {tariff.data.source === "estimate"
              ? t("Tvoja tačka je na brojilu zgrade. Cene unosimo po računu za to brojilo koji nam pošalješ (dobijaš ga od upravnika) — dok ga ne pošalješ, iznosi su procena.")
              : t("Tvoja tačka je na brojilu zgrade. Cene unosimo po računu za to brojilo koji nam pošalješ (dobijaš ga od upravnika) — po njima se računa iznos koji uplaćuješ zgradi.")}
          </p>
          <Rates tariff={tariff.data} />
        </section>
        <WindowCard tariff={tariff.data} />
      </div>
    );
  } else {
    body = (
      <div class="two-col">
        <OwnMeterForm point={point} tariff={tariff.data} />
        <WindowCard tariff={tariff.data} />
      </div>
    );
  }
  return (
    <Page title={t("Cene struje")} back="/profil" backLabel={t("Profil")} testId="cene-struje">
      {body}
    </Page>
  );
}

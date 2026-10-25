// /profil/tacka — the charging point: its own name (≤ 24 characters), where it is, what kit it is and what it can do.
import { useState } from "preact/hooks";
import type { Capability, ChargePoint } from "../../api/types";
import { markActivity } from "../../app/activity";
import { activePoint, backendOrThrow, k, useUser } from "../../app/data";
import { invalidate } from "../../app/query";
import { errorMessage, pointName, skuTitle, statusIcon, statusTitle } from "../../app/texts";
import { lang, msg, t, tp } from "../../i18n";
import { decimal, fullDate } from "../../lib/format";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button, TextField } from "../../ui/controls";
import { Badge, Card, KeyValues, toast } from "../../ui/display";
import { Icon, type IconName } from "../../ui/Icon";
import { PageSkeleton } from "../common";

const NAME_LIMIT = 24;

const CAPABILITIES: Array<{ capability: Capability; icon: IconName; title: string; text: string }> = [
  { capability: "metering", icon: "gauge", title: msg("Merenje"),
    text: msg("MID brojilo broji kilovat-sate, noću i danju odvojeno.") },
  { capability: "scheduling", icon: "moon", title: msg("Noćni autostart"),
    text: msg("Punjenje kreće samo, u okviru noćnog okna.") },
  { capability: "remoteControl", icon: "bolt", title: msg("Upravljanje punjenjem"),
    text: msg("Punjenje pokrećeš i zaustavljaš u aplikaciji Evolako.") },
  { capability: "livePower", icon: "chart", title: msg("Snaga uživo"),
    text: msg("Vidiš koliko kW auto prima dok se puni.") },
];

function RenameCard({ point }: { point: ChargePoint }) {
  const [value, setValue] = useState(point.customName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = value.trim();
  const changed = trimmed !== (point.customName ?? "");
  const tooLong = trimmed.length > NAME_LIMIT;

  const save = async () => {
    if (!changed || busy) return;
    if (tooLong) {
      setError(tp("Ime može da ima najviše %lld znakova.", NAME_LIMIT));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await backendOrThrow().updateChargePointName(point.id, trimmed || null);
      markActivity(point.id);
      setValue(updated.customName ?? "");
      invalidate(k("user"));
      toast(t("Sačuvano"));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="section" aria-labelledby="rename-title">
      <form class="rename" noValidate onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}>
        <h2 class="card__title" id="rename-title">{t("Ime tačke")}</h2>
        <TextField label={t("Preimenuj tačku")} value={value} onValue={(v) => {
          setValue(v);
          setError(null);
        }} placeholder={t("Moja tačka")} maxLength={NAME_LIMIT + 8} autoComplete="off" testId="rename-input"
          counter={`${trimmed.length} / ${NAME_LIMIT}`} error={error ?? (tooLong ? tp("Ime može da ima najviše %lld znakova.", NAME_LIMIT) : null)} />
        <div class="rename__actions">
          <Button type="submit" loading={busy} disabled={!changed || tooLong} testId="rename-save">{t("Sačuvaj")}</Button>
          {changed ? (
            <Button variant="ghost" onClick={() => {
              setValue(point.customName ?? "");
              setError(null);
            }}>{t("Otkaži")}</Button>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

export default function Tacka(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const l = lang.value;
  if (!point) return <PageSkeleton />;
  const phases = point.phases === 1 ? t("monofazno") : t("trofazno");
  return (
    <Page title={pointName(point)} subtitle={point.address} back="/profil" backLabel={t("Profil")} testId="tacka">
      <div class="two-col">
        <div class="stack">
          <RenameCard point={point} />
          <Card as="section" aria-labelledby="point-facts">
            <div class="card__head">
              <h2 class="card__title" id="point-facts">{t("Tačka punjenja")}</h2>
              <Badge tone={point.status} icon={statusIcon(point.status)}>{statusTitle(point.status)}</Badge>
            </div>
            <KeyValues items={[
              [t("Adresa"), point.address],
              [t("Komplet"), skuTitle(point.sku)],
              [t("Snaga"), <span class="num">{decimal(point.nominalPowerKW, 1)} {t("kW")} · {phases}</span>],
              [t("Serijski broj"), <span class="num">{point.serialNumber}</span>],
              [t("Ugradnja"), fullDate(point.installedAt, l)],
            ]} />
          </Card>
        </div>
        <div class="stack">
          <Card as="section" aria-labelledby="point-can">
            <h2 class="card__title" id="point-can">{t("Šta tačka može")}</h2>
            <ul class="capabilities" data-testid="capabilities">
              {CAPABILITIES.filter((c) => point.capabilities.includes(c.capability)).map((c) => (
                <li key={c.capability} class="capability">
                  <span class="capability__icon"><Icon name={c.icon} /></span>
                  <span>
                    <strong>{t(c.title)}</strong>
                    <span>{t(c.text)}</span>
                  </span>
                </li>
              ))}
            </ul>
            {!point.capabilities.includes("remoteControl") ? (
              <p class="note capabilities__note"><Icon name="info" /><span>{t("Na utičnici upravljanje nije dostupno")}</span></p>
            ) : null}
          </Card>
          <Card as="section" aria-labelledby="point-meter">
            <h2 class="card__title" id="point-meter">{t("Brojilo")}</h2>
            <p class="card__sub point-meter">
              {point.connectionScheme.type === "thirdPartyMeter"
                ? t("Tvoja tačka je na brojilu zgrade. Cene unosimo po računu za to brojilo koji nam pošalješ (dobijaš ga od upravnika) — po njima se računa iznos koji uplaćuješ zgradi.")
                : `${t("Struja ide preko tvog brojila")}. ${t("Potrošnja je već na tvom računu za struju od EPS-a. Nema šta da se nadoknađuje.")}`}
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}

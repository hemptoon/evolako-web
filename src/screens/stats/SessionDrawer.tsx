// "Sesija": one charge in detail — energy by tariff zone at the point's prices, times, trigger and the tag.
import type { ChargePoint, ChargingSession, SessionTag, TariffConfig } from "../../api/types";
import { energy, tagTitle, triggerTitle } from "../../app/texts";
import { lang, t } from "../../i18n";
import { dateAndTime, decimal, duration, rsdPrecise, weekdayAndDate } from "../../lib/format";
import { cost, total } from "../../lib/tariff";
import { Segmented } from "../../ui/controls";
import { EmptyState, KeyValues } from "../../ui/display";
import { CompactAmount, FxNote, RefAmount, RefRate } from "../../ui/money";
import { Drawer } from "../../ui/overlay";
import { can, capitalize } from "../common";

export function SessionDrawer({ session, point, tariff, onClose, onTag, saving }: {
  session: ChargingSession | null;
  point: ChargePoint;
  tariff: TariffConfig;
  onClose: () => void;
  onTag: (session: ChargingSession, tag: SessionTag | null) => void;
  saving: boolean;
}) {
  const l = lang.value;
  if (!session) {
    return (
      <Drawer title={t("Sesija")} onClose={onClose} testId="session-drawer">
        <EmptyState icon="search" title={t("Ne možemo da nađemo tu sesiju.")} />
      </Drawer>
    );
  }
  const kWh = total(session.energy);
  const seconds = (session.endedAt.getTime() - session.startedAt.getTime()) / 1000;
  const average = seconds > 0 ? kWh / (seconds / 3600) : 0;
  const tagValue: "none" | SessionTag = session.tag ?? "none";
  return (
    <Drawer title={t("Sesija")} onClose={onClose} testId="session-drawer">
      <div class="stack session-detail">
        <p class="session-detail__date">{capitalize(weekdayAndDate(session.startedAt, l))}</p>
        <div class="session-detail__head">
          <div class="metric">
            <span class="metric__value num">{decimal(kWh, 1)}</span>
            <span class="metric__unit">{t("kWh")}</span>
          </div>
          <RefAmount class="session-detail__cost num" rsd={cost(tariff, session.energy)} testId="session-cost" />
        </div>
        <div class="card card--tile zones">
          {([
            ["night", t("Noćna energija"), tariff.lowRateRSDPerKWh, session.energy.nightKWh],
            ["day", t("Dnevna energija"), tariff.highRateRSDPerKWh, session.energy.dayKWh],
          ] as const).map(([zone, title, price, value]) => (
            <div class="zone" key={zone}>
              <span class={`split__swatch split__swatch--${zone}`} aria-hidden="true" />
              <span class="zone__text">
                <span class="zone__title">{title}</span>
                <RefRate class="zone__rate num" rsd={price} unit={t("kWh")} rsdText={`${rsdPrecise(price)} / ${t("kWh")}`} />
              </span>
              <span class="zone__value">
                <strong class="num">{energy(value)}</strong>
                <CompactAmount class="num" rsd={value * price} />
              </span>
            </div>
          ))}
        </div>
        <div class="card card--tile">
          <KeyValues items={[
            [t("Početak"), <span class="num">{dateAndTime(session.startedAt, l)}</span>],
            [t("Kraj"), <span class="num">{dateAndTime(session.endedAt, l)}</span>],
            [t("Trajanje"), <span class="num">{duration(seconds, l)}</span>],
            [t("Prosečna snaga"), <span class="num">{decimal(average, 1)} {t("kW")}</span>],
            [t("Pokretanje"), triggerTitle(session.trigger)],
          ]} />
        </div>
        {can(point, "remoteControl") ? (
          <div class="card card--tile session-detail__tag">
            <h3 class="card__title">{t("Oznaka")}</h3>
            <Segmented
              label={t("Oznaka")}
              value={tagValue}
              options={[
                { value: "none", label: t("Bez oznake") },
                { value: "personal", label: tagTitle("personal") },
                { value: "business", label: tagTitle("business") },
              ]}
              onChange={(value) => !saving && onTag(session, value === "none" ? null : value)}
              testId="session-tag"
            />
            <p class="card__sub">{t("Deli potrošnju na privatnu i poslovnu — vidi se u statistici, obračunu i izvozu.")}</p>
          </div>
        ) : null}
        <FxNote />
      </div>
    </Drawer>
  );
}

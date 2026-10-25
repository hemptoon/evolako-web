// /statistika — energy by day (week, 30 days) or by month (year), totals, the sessions and the CSV export.
import { useMemo, useState } from "preact/hooks";
import type { ChargePoint, ChargingSession, SessionTag, TariffConfig } from "../api/types";
import { useActivity } from "../app/activity";
import { activePoint, backendOrThrow, k, useSessions, useTariff, useUser } from "../app/data";
import { invalidate } from "../app/query";
import { location, setQuery } from "../app/router";
import { energy, errorMessage, tagTitle, triggerTitle } from "../app/texts";
import { HTML_LANG, lang, t, type Lang } from "../i18n";
import { addDays, addMonths, dayKey, monthKey, monthOf, monthStart, startOfDay } from "../lib/belgrade";
import { BOM, csvFileName, sessionsCsv } from "../lib/csv";
import {
  dayAndMonth,
  dayNumber,
  decimal,
  duration,
  energyValue,
  monthAndYear,
  monthShort,
  percentValue,
  time,
  weekdayAndDate,
  weekdayShort,
} from "../lib/format";
import { add, cost, nightShare, total, ZERO } from "../lib/tariff";
import { Page } from "../shell/Page";
import type { Mode } from "../shell/Shell";
import { Button, Chip, Segmented } from "../ui/controls";
import { Card, EmptyState, ErrorState, Skeleton, Tile, toast } from "../ui/display";
import { Icon } from "../ui/Icon";
import { compact, CompactAmount, FxNote } from "../ui/money";
import { Menu } from "../ui/overlay";
import { can, capitalize, PageSkeleton, useNow } from "./common";
import { BarChart, type ChartBucket } from "./stats/BarChart";
import { SessionDrawer } from "./stats/SessionDrawer";

type Period = "week" | "month" | "year";
type Filter = "all" | SessionTag;

function range(period: Period, now: Date): { from: Date; to: Date } {
  if (period === "year") {
    const month = monthOf(now);
    return { from: monthStart(addMonths(month, -11)), to: monthStart(addMonths(month, 1)) };
  }
  const today = startOfDay(now);
  return { from: addDays(today, period === "week" ? -6 : -29), to: addDays(today, 1) };
}

function buckets(period: Period, from: Date, sessions: ChargingSession[], l: Lang): ChartBucket[] {
  const totals = new Map<string, { night: number; day: number }>();
  const keyOf = (d: Date) => (period === "year" ? monthKey(monthOf(d)) : dayKey(d));
  for (const s of sessions) {
    const key = keyOf(s.startedAt);
    const current = totals.get(key) ?? { night: 0, day: 0 };
    current.night += s.energy.nightKWh;
    current.day += s.energy.dayKWh;
    totals.set(key, current);
  }
  const out: ChartBucket[] = [];
  if (period === "year") {
    const first = monthOf(from);
    for (let i = 0; i < 12; i++) {
      const m = addMonths(first, i);
      const key = monthKey(m);
      const v = totals.get(key) ?? { night: 0, day: 0 };
      out.push({ key, label: monthShort(m.year, m.month, l), title: capitalize(monthAndYear(m.year, m.month, l)), ...v });
    }
    return out;
  }
  const days = period === "week" ? 7 : 30;
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const key = dayKey(d);
    const v = totals.get(key) ?? { night: 0, day: 0 };
    out.push({
      key,
      label: period === "week" ? weekdayShort(d, l) : dayNumber(d, l),
      title: capitalize(weekdayAndDate(d, l)),
      ...v,
    });
  }
  return out;
}

async function exportCsv(point: ChargePoint, tariff: TariffConfig): Promise<void> {
  const l = lang.value;
  const sessions = await backendOrThrow().sessions(point.id, new Date(Date.UTC(2020, 0, 1)), addDays(new Date(), 1));
  const text = sessionsCsv(sessions, tariff, {
    date: t("Datum"),
    start: t("Početak"),
    end: t("Kraj"),
    nightKWh: t("kWh noć"),
    dayKWh: t("kWh dan"),
    rsd: "RSD",
    rsdEstimate: t("RSD (procena)"),
    tag: t("Oznaka"),
  }, {
    personal: tagTitle("personal").toLocaleLowerCase(HTML_LANG[l]),
    business: tagTitle("business").toLocaleLowerCase(HTML_LANG[l]),
  });
  const blob = new Blob([BOM, text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = csvFileName(new Date());
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function TagMenu({ session, onTag }: { session: ChargingSession; onTag: (tag: SessionTag | null) => void }) {
  const [open, setOpen] = useState(false);
  const id = `tag-menu-${session.id}`;
  const options: Array<[SessionTag | null, string]> = [
    ["personal", tagTitle("personal")],
    ["business", tagTitle("business")],
    [null, t("Bez oznake")],
  ];
  return (
    <div class="menu-wrap">
      <button type="button" class="icon-btn session-row__tag-btn" aria-haspopup="menu" aria-expanded={open ? "true" : "false"}
        aria-controls={id} aria-label={`${t("Oznaka")}: ${session.tag ? tagTitle(session.tag) : t("Bez oznake")}`}
        title={t("Oznaka")} onClick={() => setOpen(!open)} data-testid="session-tag-button">
        <Icon name="tag" />
      </button>
      {open ? (
        <Menu label={t("Oznaka")} id={id} onClose={() => setOpen(false)}>
          {options.map(([tag, title]) => (
            <button key={String(tag)} type="button" role="menuitemradio" class="menu__item"
              aria-checked={session.tag === tag ? "true" : "false"}
              onClick={() => {
                setOpen(false);
                if (session.tag !== tag) onTag(tag);
              }}>
              <Icon name={session.tag === tag ? "check" : tag === null ? "xCircle" : tag === "personal" ? "home" : "briefcase"} />
              <span>{title}</span>
            </button>
          ))}
        </Menu>
      ) : null}
    </div>
  );
}

function SessionRow({ session, tariff, taggable, onOpen, onTag }: {
  session: ChargingSession;
  tariff: TariffConfig;
  taggable: boolean;
  onOpen: () => void;
  onTag: (tag: SessionTag | null) => void;
}) {
  const l = lang.value;
  const seconds = (session.endedAt.getTime() - session.startedAt.getTime()) / 1000;
  return (
    <li class="session-row" data-testid="session-row">
      <button type="button" class="session-row__main" onClick={onOpen}>
        <span class="session-row__when">
          <span class="session-row__date">
            {dayAndMonth(session.startedAt, l)}
            <span class="pill">{triggerTitle(session.trigger).toLocaleLowerCase()}</span>
            {session.tag ? <span class={`pill pill--${session.tag}`}>{tagTitle(session.tag)}</span> : null}
          </span>
          <span class="session-row__time num">
            {time(session.startedAt, l)}–{time(session.endedAt, l)} · {duration(seconds, l)}
          </span>
        </span>
        <span class="session-row__split num" aria-hidden="true">
          <span><span class="split__swatch split__swatch--night" />{decimal(session.energy.nightKWh, 1)}</span>
          <span><span class="split__swatch split__swatch--day" />{decimal(session.energy.dayKWh, 1)}</span>
        </span>
        <span class="sr-only">{`${t("Noćna")} ${energy(session.energy.nightKWh)}, ${t("Dnevna")} ${energy(session.energy.dayKWh)}`}</span>
        <span class="session-row__sum">
          <strong class="num">{energy(total(session.energy))}</strong>
          <CompactAmount class="num" rsd={cost(tariff, session.energy)} />
        </span>
      </button>
      {taggable ? <TagMenu session={session} onTag={onTag} /> : null}
    </li>
  );
}

function TariffNote({ point, tariff }: { point: ChargePoint; tariff: TariffConfig }) {
  if (tariff.source === "customerBill" || tariff.source === "meterOwnerBill") {
    return (
      <p class="note stats__note">
        <Icon name="badgeCheck" />
        <span>{tariff.source === "customerBill" ? t("Po cenama iz tvog računa") : t("Po cenama sa računa zgrade")}</span>
      </p>
    );
  }
  const ownMeter = point.connectionScheme.type === "ownMeter";
  return (
    <p class="note stats__note">
      <Icon name="help" />
      <span>
        {t("Procena po okvirnim cenama")}
        {ownMeter ? <> · <a href="/profil/cene-struje">{t("Unesi cene sa svog EPS računa")}</a></> : null}
      </span>
    </p>
  );
}

export default function Statistika(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  useActivity(point?.id ?? null);
  const tariff = useTariff(point?.id ?? null);
  const now = useNow(60_000);
  const [period, setPeriod] = useState<Period>("month");
  const [filter, setFilter] = useState<Filter>("all");
  const [exporting, setExporting] = useState(false);
  const [saving, setSaving] = useState(false);
  const { from, to } = useMemo(() => range(period, now), [period, dayKey(now)]);
  const sessions = useSessions(point?.id ?? null, from, to);
  const l = lang.value;
  const openId = location.value.query.get("sesija");

  if (!point) return <PageSkeleton />;
  const taggable = can(point, "remoteControl");
  const all = sessions.data ?? [];
  const shown = taggable && filter !== "all" ? all.filter((s) => s.tag === filter) : all;
  const sum = shown.reduce((acc, s) => add(acc, s.energy), ZERO);
  const chart = buckets(period, from, shown, l);

  const setTag = async (session: ChargingSession, tag: SessionTag | null) => {
    setSaving(true);
    try {
      await backendOrThrow().updateSessionTag(point.id, session.id, tag);
      invalidate(k("sessions"), k("statement"));
      toast(t("Sačuvano"));
    } catch (e) {
      toast(errorMessage(e), "circleAlert");
    } finally {
      setSaving(false);
    }
  };

  const openSession = (id: string) => setQuery({ sesija: id });
  const closeSession = () => {
    if (history.state && history.length > 1 && (history.state as { key?: string }).key !== "initial") history.back();
    else setQuery({ sesija: null }, { replace: true });
  };

  const exportButton = tariff.data ? (
    <Button variant="secondary" size="sm" icon="download" loading={exporting} testId="export-csv"
      onClick={async () => {
        if (exporting) return;
        setExporting(true);
        try {
          await exportCsv(point, tariff.data!);
        } catch (e) {
          toast(errorMessage(e), "circleAlert");
        } finally {
          setExporting(false);
        }
      }}>
      {exporting ? t("Pripremam CSV…") : t("Izvezi sesije (CSV)")}
    </Button>
  ) : null;

  let body;
  if (tariff.data === undefined || sessions.data === undefined) {
    const error = tariff.error ?? sessions.error;
    body = error ? (
      <Card><ErrorState message={errorMessage(error)} onRetry={() => {
        void tariff.reload();
        void sessions.reload();
      }} /></Card>
    ) : (
      <div class="stack">
        <div class="tiles">{[0, 1, 2].map((i) => <Skeleton key={i} height={92} radius={20} />)}</div>
        <Skeleton height={300} radius={24} />
      </div>
    );
  } else if (all.length === 0) {
    body = (
      <Card>
        <EmptyState icon="chart" title={t("Još nema sesija")}
          message={t("Kada se auto napuni, ovde će biti grafikon potrošnje i lista sesija.")} testId="stats-empty" />
      </Card>
    );
  } else {
    const selected = openId ? all.find((s) => s.id === openId) ?? null : null;
    body = (
      <div class="stack stack--lg">
        <div class="tiles tiles--lead" data-testid="stats-totals">
          <Tile value={energyValue(total(sum))} unit={t("kWh")} caption={t("Ukupno")} />
          <Tile {...compact(cost(tariff.data, sum))} testId="stats-amount"
            caption={tariff.data.source === "estimate" ? t("Procena iznosa") : t("Iznos")} />
          <Tile value={total(sum) > 0 ? percentValue(nightShare(sum)) : "0"} unit="%" caption={t("Noćna energija")} accent />
        </div>
        <TariffNote point={point} tariff={tariff.data} />
        <Card class="stats__chart">
          <div class="card__head stats__chart-head">
            <h2 class="card__title">{t("Potrošnja po danima")}</h2>
            <div class="legend" aria-hidden="true">
              <span><span class="split__swatch split__swatch--night" />{t("Noćna")}</span>
              <span><span class="split__swatch split__swatch--day" />{t("Dnevna")}</span>
            </div>
          </div>
          <BarChart buckets={chart} title={t("Potrošnja po danima")} labelEvery={period === "month" ? 5 : period === "year" ? 2 : 1}
            testId="stats-chart" />
        </Card>
        <section aria-labelledby="sessions-title">
          <div class="section-head section-head--start">
            <h2 class="section-title" id="sessions-title">{t("Sesije")}</h2>
            <span class="section-head__count num">{shown.length}</span>
          </div>
          {shown.length === 0 ? (
            <Card><EmptyState icon="tag" title={t("Još nema sesija")} /></Card>
          ) : (
            <ul class="card card--flush session-list" data-testid="session-list">
              {shown.map((s) => (
                <SessionRow key={s.id} session={s} tariff={tariff.data!} taggable={taggable}
                  onOpen={() => openSession(s.id)} onTag={(tag) => void setTag(s, tag)} />
              ))}
            </ul>
          )}
        </section>
        {openId ? (
          <SessionDrawer session={selected} point={point} tariff={tariff.data} onClose={closeSession} saving={saving}
            onTag={(s, tag) => void setTag(s, tag)} />
        ) : null}
      </div>
    );
  }

  return (
    <Page title={t("Statistika")} testId="statistika" actions={exportButton}>
      <div class="stats__controls">
        <Segmented<Period> label={t("Period")} value={period} onChange={setPeriod} testId="period"
          options={[
            { value: "week", label: t("Nedelja") },
            { value: "month", label: t("Mesec") },
            { value: "year", label: t("Godina") },
          ]} />
        {taggable ? (
          <div class="chips" role="group" aria-label={t("Oznaka")} data-testid="tag-filter">
            <Chip pressed={filter === "all"} onClick={() => setFilter("all")}>{t("Sve")}</Chip>
            <Chip pressed={filter === "personal"} onClick={() => setFilter("personal")} icon="home">{tagTitle("personal")}</Chip>
            <Chip pressed={filter === "business"} onClick={() => setFilter("business")} icon="briefcase">{tagTitle("business")}</Chip>
          </div>
        ) : null}
      </div>
      {body}
      <FxNote />
    </Page>
  );
}

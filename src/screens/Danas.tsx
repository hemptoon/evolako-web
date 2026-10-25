// /danas — what is happening with the charging point right now, and this month at a glance.
// One focal element: the status card (live session or the next auto-start). Everything else is quieter.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { ChargePoint, ChargingSchedule, LiveSession, Statement, Subscription, TariffConfig } from "../api/types";
import { useActivity } from "../app/activity";
import {
  activePoint,
  useLive,
  useMeterReadings,
  useReferral,
  useRelocations,
  useSchedule,
  useServiceRequests,
  useSessions,
  useStatements,
  useSubscription,
  useTariff,
  useUser,
} from "../app/data";
import {
  energy,
  errorMessage,
  pointName,
  statusIcon,
  statusTitle,
  subscriptionSummary,
  subscriptionTitle,
  triggerTitle,
} from "../app/texts";
import { features } from "../app/features";
import { lang, t, tp } from "../i18n";
import { daysBetween, monthEnd, monthKey, monthOf, monthStart } from "../lib/belgrade";
import { decimal, duration, energyValue, fullDate, monthAndYear, roundHalfUp, time } from "../lib/format";
import { readingDue } from "../lib/readings";
import { statementDueDate, statementTotal } from "../lib/statement";
import { add, cost, nextWindowOpening, powerShare, total, ZERO } from "../lib/tariff";
import { Page } from "../shell/Page";
import type { Mode } from "../shell/Shell";
import { Button } from "../ui/controls";
import { Badge, Banner, Card, EmptyState, ErrorState, Skeleton } from "../ui/display";
import { Icon } from "../ui/Icon";
import { compact, FxNote, ownPriceText, RefAmount } from "../ui/money";
import {
  can,
  capitalize,
  InlineError,
  isOpenRelocation,
  isOpenService,
  NightDayBar,
  PageSkeleton,
  RelocationRequestCard,
  ServiceRequestCard,
  useNow,
} from "./common";
import { ScheduleDrawer, windowText } from "./Schedule";

const SUBSCRIPTION_PRICE = 990;

// ---------------------------------------------------------------- live ring

/** Power to show: the meter's instant power, else the session average (sockets have no live power). */
function displayedPower(live: LiveSession, now: Date): { value: number; average: boolean } | null {
  if (live.powerKW !== null) return { value: live.powerKW, average: false };
  const elapsed = (now.getTime() - live.startedAt.getTime()) / 1000;
  const kWh = total(live.energy);
  if (elapsed <= 60 || kWh <= 0) return null;
  return { value: kWh / (elapsed / 3600), average: true };
}

/** "11" or "3,7" — the point's nominal power without a trailing ",0". */
function nominalText(kW: number): string {
  return decimal(kW, Number.isInteger(roundHalfUp(kW, 1)) ? 0 : 1);
}

/** The round caps of the 12-px stroke on the r=88 circle, in pathLength units (100 = the whole circle). */
const RING_CAPS = (12 / (2 * Math.PI * 88)) * 100;

function Ring({ share, children }: { share: number; children: ComponentChildren }) {
  // A sliver stays visible at the very start of a session, so the ring never reads as empty.
  const p = share > 0 ? Math.max(share, 0.02) * 100 : 0;
  // The caps stick out past both ends of the dash; draw it shorter by that much, so 98 % leaves a real 2 % gap
  // at the top instead of two caps touching (which reads as a full ring with a glitch).
  const dash = roundHalfUp(Math.max(p - RING_CAPS, 0.01), 2);
  return (
    <div class="ring">
      <svg viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <circle class="ring__track" cx="100" cy="100" r="88" />
        {p > 0 ? (
          <circle class="ring__value" cx="100" cy="100" r="88" pathLength={100} stroke-dasharray={`${dash} 100`}
            stroke-dashoffset={roundHalfUp(-RING_CAPS / 2, 3)} transform="rotate(-90 100 100)"
            data-share={roundHalfUp(p, 1)} data-testid="ring-value" />
        ) : null}
      </svg>
      <div class="ring__center">{children}</div>
    </div>
  );
}

function LiveBody({ point, live, now }: { point: ChargePoint; live: LiveSession; now: Date }) {
  const l = lang.value;
  const power = displayedPower(live, now);
  const kWh = total(live.energy);
  return (
    <div class="hero__live" data-testid="live-session">
      <Ring share={powerShare(power?.value ?? null, point.nominalPowerKW)}>
        {power ? (
          <>
            <span class="ring__value-text num">{decimal(power.value, 1)}</span>
            <span class="ring__unit">{power.average ? t("kW u proseku") : t("kW")}</span>
            <span class="ring__of" data-testid="ring-of">{t("od %@", `${nominalText(point.nominalPowerKW)} ${t("kW")}`)}</span>
          </>
        ) : (
          <>
            <span class="ring__value-text num">{decimal(kWh, 1)}</span>
            <span class="ring__unit">{t("kWh")}</span>
          </>
        )}
      </Ring>
      <div class="hero__figures">
        <dl class="figures">
          <div>
            <dt>{t("Napunjeno")}</dt>
            <dd class="num">{energy(kWh)}</dd>
          </div>
          <div>
            <dt>{t("Trošak")}</dt>
            <dd class="num"><RefAmount rsd={live.costRSD} testId="live-cost" /></dd>
          </div>
          <div>
            <dt>{t("Trajanje")}</dt>
            <dd class="num">{duration((now.getTime() - live.startedAt.getTime()) / 1000, l)}</dd>
          </div>
        </dl>
        <p class="hero__meta">
          <Icon name={live.trigger === "auto" ? "moon" : "bolt"} />
          <span>{t("Početak")} <strong class="num">{time(live.startedAt, l)}</strong> · {triggerTitle(live.trigger)}</span>
        </p>
      </div>
    </div>
  );
}

function IdleBody({ point, schedule, tariff, now, onSchedule }: {
  point: ChargePoint;
  schedule: ChargingSchedule | undefined;
  tariff: TariffConfig;
  now: Date;
  onSchedule: () => void;
}) {
  const l = lang.value;
  if (!can(point, "scheduling")) {
    return (
      <div class="hero__idle" data-testid="hero-idle">
        <span class="hero__idle-icon"><Icon name="gauge" /></span>
        <div>
          <p class="hero__idle-title">{t("Na utičnici upravljanje nije dostupno")}</p>
          <p class="hero__idle-text">{t("Merenje, statistika i obračuni rade kao i uvek.")}</p>
        </div>
      </div>
    );
  }
  if (!schedule) return <Skeleton height={64} radius={16} />;
  const next = schedule.isEnabled ? nextWindowOpening(schedule.window, now) : null;
  return (
    <div class="hero__idle" data-testid="hero-idle">
      <span class="hero__idle-icon"><Icon name="moon" /></span>
      <div>
        <p class="hero__idle-title">
          {next ? t("Sledeći autostart u %@", time(next, l)) : `${t("Noćni autostart")}: ${t("Isključen")}`}
        </p>
        <p class="hero__idle-text">
          {t("Noćno okno")} {windowText(schedule.isEnabled ? schedule.window : tariff.nightWindow, l)}
        </p>
      </div>
      <Button variant="secondary" size="sm" icon="clock" onClick={onSchedule} class="hero__idle-action" testId="hero-schedule">
        {t("Punjenje")}
      </Button>
    </div>
  );
}

function StatusHero({ point, live, tariff, schedule, now, onSchedule }: {
  point: ChargePoint;
  live: LiveSession | null;
  tariff: TariffConfig;
  schedule: ChargingSchedule | undefined;
  now: Date;
  onSchedule: () => void;
}) {
  const charging = live !== null;
  const status = charging ? "charging" : point.status;
  return (
    <section class={`card card--block hero${charging ? " hero--live" : ""}`} aria-labelledby="hero-title" data-testid="status-hero">
      <div class="hero__head">
        <div class="hero__titles">
          <h2 class="hero__name" id="hero-title">{pointName(point)}</h2>
          <p class="hero__address">{point.address}</p>
        </div>
        <Badge tone={status} icon={statusIcon(status)} pulse={charging}>{statusTitle(status)}</Badge>
      </div>
      {live ? <LiveBody point={point} live={live} now={now} /> : (
        <IdleBody point={point} schedule={schedule} tariff={tariff} now={now} onSchedule={onSchedule} />
      )}
      {can(point, "remoteControl") ? (
        <p class="hero__note">
          <Icon name="info" />
          <span>{t("Punjenje pokrećeš i zaustavljaš u aplikaciji Evolako.")}</span>
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------- this month

function MonthCard({ pointId, tariff, now }: { pointId: string; tariff: TariffConfig; now: Date }) {
  const month = monthOf(now);
  const sessions = useSessions(pointId, monthStart(month), monthEnd(month));
  if (sessions.data === undefined) {
    if (sessions.error) return <InlineError message={errorMessage(sessions.error)} onRetry={sessions.reload} />;
    return <Skeleton height={196} radius={24} />;
  }
  const list = sessions.data;
  const sum = list.reduce((acc, s) => add(acc, s.energy), ZERO);
  const amount = cost(tariff, sum);
  const money = compact(amount);
  if (list.length === 0) {
    return (
      <Card class="month" data-testid="month-card">
        <EmptyState icon="chart" title={t("Još nema sesija")}
          message={t("Kada se auto prvi put napuni, ovde će se pojaviti potrošnja i procena iznosa.")} />
      </Card>
    );
  }
  return (
    <Card class="month" data-testid="month-card">
      <div class="card__head">
        <h2 class="card__title">{t("Ovog meseca")}</h2>
        <a class="link-btn" href="/statistika">{t("Statistika")}<Icon name="chevronRight" /></a>
      </div>
      <dl class="month__metrics">
        <div class="month__metric">
          <dt>{t("Napunjeno")}</dt>
          <dd><span class="month__value num">{energyValue(total(sum))}</span><span class="month__unit">{t("kWh")}</span></dd>
        </div>
        <div class="month__metric">
          <dt>{tariff.source === "estimate" ? t("Procena iznosa") : t("Iznos")}</dt>
          <dd title={money.hint ?? undefined} data-testid="month-amount">
            <span class="month__value num">{money.value}</span><span class="month__unit">{money.unit}</span>
            {money.hint ? <span class="sr-only">{money.hint}</span> : null}
          </dd>
        </div>
        <div class="month__metric">
          <dt>{t("Sesije")}</dt>
          <dd><span class="month__value num">{list.length}</span></dd>
        </div>
      </dl>
      <NightDayBar value={sum} />
    </Card>
  );
}

// ---------------------------------------------------------------- side cards

function StatementCard({ statements }: { statements: Statement[] }) {
  const l = lang.value;
  const latest = statements[0];
  if (!latest) {
    return (
      <Card data-testid="statement-card">
        <div class="side-card__head">
          <span class="card__icon"><Icon name="statement" /></span>
          <h2 class="card__title">{t("Obračuni")}</h2>
        </div>
        <p class="card__sub">{t("Prvi obračun stiže na kraju meseca. U njemu su kilovat-sati i iznosi sa QR kodom za plaćanje.")}</p>
      </Card>
    );
  }
  const amount = statementTotal(latest);
  const paid = latest.status === "paid";
  return (
    <Card data-testid="statement-card">
      <div class="side-card__head">
        <span class="card__icon"><Icon name="statement" /></span>
        <div class="side-card__titles">
          <p class="card__sub">{t("Obračuni")}</p>
          <h2 class="card__title">{capitalize(monthAndYear(latest.month.year, latest.month.month, l))}</h2>
        </div>
        <Badge tone={paid ? "paid" : "neutral"} icon={paid ? "checkCircle" : "statement"}>
          {paid ? t("Plaćeno") : t("Izdato")}
        </Badge>
      </div>
      <div class="side-card__amount">
        <span class="num">{decimal(amount, 0)}</span>
        <small>RSD</small>
      </div>
      <p class="card__sub">
        {!paid && amount > 0 ? t("Rok za uplatu: %@", fullDate(statementDueDate(latest), l)) : energy(total(latest.energy))}
      </p>
      <Button variant="secondary" block iconRight="arrowRight" href={`/obracuni/${monthKey(latest.month)}`}
        testId="open-statement" class="side-card__action">
        {t("Otvori obračun")}
      </Button>
    </Card>
  );
}

function SubscriptionCard({ subscription, freeMonths, now }: { subscription: Subscription; freeMonths: number; now: Date }) {
  const state = subscription.state;
  const status = subscriptionTitle(subscription);
  let trial: { left: number; progress: number } | null = null;
  if (state.type === "trial" && !subscription.trialStartsBy) {
    const span = state.until.getTime() - subscription.startedAt.getTime();
    const left = Math.max(0, daysBetween(now, state.until));
    trial = { left, progress: span > 0 ? Math.min(1, Math.max(0, (now.getTime() - subscription.startedAt.getTime()) / span)) : 1 };
  }
  return (
    <a class="card card--link" href="/profil/pretplata" data-testid="subscription-card">
      <div class="side-card__head">
        <span class="card__icon"><Icon name="badgeCheck" /></span>
        <div class="side-card__titles">
          <h2 class="card__title">{t("Pretplata")}</h2>
          <p class="card__sub">{subscriptionSummary(subscription, ownPriceText(SUBSCRIPTION_PRICE))}</p>
        </div>
        <Badge tone={status.active ? "online" : "offline"} icon={status.active ? "checkCircle" : "pause"}>{status.title}</Badge>
      </div>
      {trial ? (
        <div class="trial">
          <div class="trial__bar" aria-hidden="true"><span style={{ width: `${Math.round(trial.progress * 100)}%` }} /></div>
          <p class="trial__text">{tp("Probni period ističe za %lld dana", trial.left)}</p>
        </div>
      ) : null}
      {freeMonths > 0 ? (
        <p class="side-card__gift"><Icon name="gift" />{tp("+%lld besplatna meseca od preporuka", freeMonths)}</p>
      ) : null}
    </a>
  );
}

function ScheduleCard({ schedule, onOpen }: { schedule: ChargingSchedule; onOpen: () => void }) {
  const l = lang.value;
  return (
    <button type="button" class="card card--link schedule-card" onClick={onOpen} data-testid="schedule-card"
      aria-haspopup="dialog">
      <span class="card__icon"><Icon name="moon" /></span>
      <span class="schedule-card__text">
        <span class="card__title">{t("Noćni autostart")}</span>
        <span class="card__sub num">{schedule.isEnabled ? windowText(schedule.window, l) : t("Isključen")}</span>
      </span>
      <Icon name="chevronRight" class="schedule-card__chevron" />
    </button>
  );
}

// ---------------------------------------------------------------- screen

export default function Danas(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const pointId = point?.id ?? null;
  const now = useNow(15_000);
  const live = useLive(pointId);
  const tariff = useTariff(pointId);
  const schedule = useSchedule(point && can(point, "scheduling") ? pointId : null);
  const statements = useStatements(pointId);
  const subscription = useSubscription(Boolean(point));
  const referral = useReferral(Boolean(point));
  const service = useServiceRequests(pointId);
  const relocations = useRelocations(pointId);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  // The charger's status is on screen (not just a sign-in): the owner's first look starts the free period (1.14).
  useActivity(tariff.data !== undefined && live.data !== undefined ? pointId : null);
  const readings = useMeterReadings(features.value.meterPhoto ? pointId : null);

  if (!point) return <PageSkeleton />;
  if (tariff.data === undefined || live.data === undefined) {
    const error = tariff.error ?? live.error;
    if (error) {
      return (
        <Page title={t("Danas")} testId="danas">
          <Card><ErrorState message={errorMessage(error)} onRetry={() => {
            void tariff.reload();
            void live.reload();
          }} /></Card>
        </Page>
      );
    }
    return <PageSkeleton />;
  }

  const openService = (service.data ?? []).find((r) => isOpenService(r)
    || now.getTime() - r.updatedAt.getTime() < 24 * 3600_000);
  const hasOpenService = (service.data ?? []).some(isOpenService);
  const openRelocation = (relocations.data ?? []).find(isOpenRelocation);
  const status = point.status;
  const withSchedule = can(point, "scheduling") && schedule.data;

  return (
    <Page title={t("Danas")} testId="danas" wide>
      <div class="danas">
        {status === "fault" ? (
          <div class="danas__banner">
            <Banner tone="fault" icon="alert" title={t("Kvar na tački")} testId="fault-banner"
              text={hasOpenService ? t("Prijava je poslata. Javićemo se u roku od 48 h.") : t("Javićemo se u roku od 48 h.")}>
              {hasOpenService ? null : (
                <Button variant="secondary" size="sm" icon="wrench" href="/profil/prijavi-kvar" class="banner__action"
                  testId="report-fault">
                  {t("Prijavi kvar")}
                </Button>
              )}
            </Banner>
          </div>
        ) : status === "offline" ? (
          <div class="danas__banner">
            <Banner icon="wifiOff" title={t("Tačka nije na mreži")} text={t("Prikazujemo poslednje poznate podatke.")}
              testId="offline-banner" />
          </div>
        ) : null}

        {features.value.meterPhoto && readings.data?.required && readingDue(readings.data.readings, now) ? (
          <div class="danas__banner">
            <Banner tone="info" icon="gauge" title={t("Poslednji dan u mesecu — pošalji očitavanje brojila.")} testId="reading-card">
              <Button size="sm" icon="camera" href="/ocitavanje" class="banner__action" testId="reading-card-open">
                {t("Pošalji očitavanje")}
              </Button>
            </Banner>
          </div>
        ) : null}

        <div class="danas__main">
          <StatusHero point={point} live={live.data} tariff={tariff.data} schedule={schedule.data} now={now}
            onSchedule={() => setScheduleOpen(true)} />
          <MonthCard pointId={point.id} tariff={tariff.data} now={now} />
        </div>

        <div class="danas__side">
          {statements.data ? <StatementCard statements={statements.data} /> : statements.error ? (
            <InlineError message={errorMessage(statements.error)} onRetry={statements.reload} />
          ) : <Skeleton height={210} radius={24} />}
          {openService ? <ServiceRequestCard request={openService} /> : null}
          {openRelocation ? <RelocationRequestCard request={openRelocation} /> : null}
          {withSchedule ? <ScheduleCard schedule={schedule.data!} onOpen={() => setScheduleOpen(true)} /> : null}
          {subscription.data ? (
            <SubscriptionCard subscription={subscription.data} freeMonths={referral.data?.freeMonthsBalance ?? 0} now={now} />
          ) : subscription.error ? null : <Skeleton height={120} radius={24} />}
        </div>
      </div>
      {scheduleOpen && can(point, "scheduling") ? (
        <ScheduleDrawer pointId={point.id} tariff={tariff.data} onClose={() => setScheduleOpen(false)} />
      ) : null}
      <FxNote />
    </Page>
  );
}

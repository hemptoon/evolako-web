// Pieces shared by several screens: request cards (service, relocation), the night/day split, skeletons and
// small helpers. Everything the app's Common/ folder does, on the web.
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Capability, ChargePoint, RelocationRequest, ServiceRequest } from "../api/types";
import { categoryTitle, energy, relocationStatusTitle, serviceStatusTitle } from "../app/texts";
import { lang, t } from "../i18n";
import { dateAndTime, fullDate, percentValue } from "../lib/format";
import { nightShare, total, type EnergySplit } from "../lib/tariff";
import { Button } from "../ui/controls";
import { Card, Skeleton, Steps } from "../ui/display";
import { Icon, type IconName } from "../ui/Icon";

export function can(point: Pick<ChargePoint, "capabilities"> | null | undefined, capability: Capability): boolean {
  return Boolean(point?.capabilities.includes(capability));
}

/** "septembar 2026." → "Septembar 2026." for headings (Serbian and Russian months are lowercase). */
export function capitalize(text: string): string {
  return text.charAt(0).toLocaleUpperCase() + text.slice(1);
}

/** The current time, re-rendered every `ms` (durations of a live session, "za 3 dana"). */
export function useNow(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

const HOUR = 3600_000;

/** The service promise: an answer within 48 h of the request (72 h for a move). */
export function respondBy(createdAt: Date, hours: number): Date {
  return new Date(createdAt.getTime() + hours * HOUR);
}

export const isOpenService = (r: ServiceRequest) => r.status !== "resolved";
export const isOpenRelocation = (r: RelocationRequest) => r.status !== "completed";

// ---------------------------------------------------------------- night / day split

/** A two-colour bar (night = accent, day = slate) with its legend: the month at a glance. */
export function NightDayBar({ value, compact }: { value: EnergySplit; compact?: boolean }) {
  const all = total(value);
  const share = all > 0 ? nightShare(value) : 0;
  const night = Math.round(share * 1000) / 10;
  return (
    <div class={compact ? "split split--compact" : "split"}>
      <div class="split__bar" aria-hidden="true">
        {all > 0 ? (
          <>
            <span class="split__night" style={{ flexGrow: String(Math.max(value.nightKWh, 0)) }} />
            <span class="split__day" style={{ flexGrow: String(Math.max(value.dayKWh, 0)) }} />
          </>
        ) : null}
      </div>
      <div class="split__legend">
        <span class="split__key">
          <span class="split__swatch split__swatch--night" aria-hidden="true" />
          {t("Noćna")} <strong class="num">{energy(value.nightKWh)}</strong>
          {all > 0 ? <span class="split__pct num">{percentValue(share)} %</span> : null}
        </span>
        <span class="split__key">
          <span class="split__swatch split__swatch--day" aria-hidden="true" />
          {t("Dnevna")} <strong class="num">{energy(value.dayKWh)}</strong>
          {all > 0 ? <span class="split__pct num">{percentValue(1 - share)} %</span> : null}
        </span>
      </div>
      <span class="sr-only">{`${t("Noćna energija")}: ${night} %`}</span>
    </div>
  );
}

// ---------------------------------------------------------------- request cards

function RequestCard({ icon, title, subtitle, labels, current, detail, testId, children }: {
  icon: IconName;
  title: string;
  subtitle: string;
  labels: string[];
  current: number;
  detail: string;
  testId: string;
  children?: ComponentChildren;
}) {
  return (
    <Card class="request" data-testid={testId}>
      <div class="request__head">
        <span class="card__icon"><Icon name={icon} /></span>
        <div class="request__titles">
          <h3 class="card__title">{title}</h3>
          <p class="card__sub">{subtitle}</p>
        </div>
      </div>
      <Steps labels={labels} current={current} label={title} />
      <p class="request__detail">{detail}</p>
      {children}
    </Card>
  );
}

/** "Prijava kvara": what was reported and where the request is now (ServiceRequestCard). */
export function ServiceRequestCard({ request, action }: { request: ServiceRequest; action?: ComponentChildren }) {
  const l = lang.value;
  const current = ["received", "scheduled", "resolved"].indexOf(request.status);
  const detail = request.status === "received"
    ? t("Javićemo se do %@.", dateAndTime(respondBy(request.createdAt, 48), l))
    : request.status === "scheduled"
      ? t("Serviser dolazi %@.", dateAndTime(request.scheduledFor ?? request.updatedAt, l))
      : t("Rešeno %@.", dateAndTime(request.updatedAt, l));
  return (
    <RequestCard
      icon={isOpenService(request) ? "wrench" : "checkCircle"}
      title={t("Prijava kvara")}
      subtitle={categoryTitle(request.category)}
      labels={(["received", "scheduled", "resolved"] as const).map(serviceStatusTitle)}
      current={current}
      detail={detail}
      testId="service-request-card"
    >
      {action}
    </RequestCard>
  );
}

/** "Selidba": where the kit moves and where the request is now (RelocationRequestCard). */
export function RelocationRequestCard({ request }: { request: RelocationRequest }) {
  const l = lang.value;
  const current = ["received", "scheduled", "completed"].indexOf(request.status);
  const detail = request.status === "received"
    ? t("Željeni datum: %@. Javićemo se do %@.", fullDate(request.desiredDate, l), dateAndTime(respondBy(request.createdAt, 72), l))
    : request.status === "scheduled"
      ? t("Prenos je zakazan za %@.", dateAndTime(request.scheduledFor ?? request.desiredDate, l))
      : t("Komplet je na novoj adresi od %@.", fullDate(request.updatedAt, l));
  return (
    <RequestCard
      icon={isOpenRelocation(request) ? "truck" : "checkCircle"}
      title={t("Selidba")}
      subtitle={request.newAddress}
      labels={(["received", "scheduled", "completed"] as const).map(relocationStatusTitle)}
      current={current}
      detail={detail}
      testId="relocation-card"
    />
  );
}

// ---------------------------------------------------------------- loading & errors

/** A calm placeholder in the shape of the screen while the first data arrives. */
export function PageSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <div class="page" aria-busy="true" data-testid="page-skeleton">
      <div class="page__head">
        <Skeleton width={180} height={34} radius={10} />
      </div>
      <div class="stack">
        <Skeleton height={220} radius={28} />
        {Array.from({ length: blocks - 1 }, (_, i) => <Skeleton key={i} height={120} radius={24} />)}
      </div>
      <span class="sr-only" role="status">{t("Učitavanje…")}</span>
    </div>
  );
}

/** A section that could not load: one line and a retry, the rest of the screen stays. */
export function InlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div class="inline-error" role="alert">
      <Icon name="circleAlert" />
      <span>{message}</span>
      <Button variant="ghost" size="sm" icon="refresh" onClick={onRetry}>{t("Pokušaj ponovo")}</Button>
    </div>
  );
}

// /obracuni — the monthly statements, newest first. The unpaid one leads, with its amount and due date.
import type { Statement } from "../api/types";
import { useActivity } from "../app/activity";
import { activePoint, useMeterReadings, useStatements, useUser } from "../app/data";
import { features } from "../app/features";
import { energy, errorMessage } from "../app/texts";
import { lang, t } from "../i18n";
import { monthKey } from "../lib/belgrade";
import { decimal, fullDate, monthAndYear, rsd } from "../lib/format";
import { statementDueDate, statementTotal } from "../lib/statement";
import { total } from "../lib/tariff";
import { Page } from "../shell/Page";
import type { Mode } from "../shell/Shell";
import { Button } from "../ui/controls";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "../ui/display";
import { Icon } from "../ui/Icon";
import { capitalize, PageSkeleton, useNow } from "./common";
import { readingSummary } from "./Ocitavanje";

function StatusBadge({ statement }: { statement: Statement }) {
  const paid = statement.status === "paid";
  return (
    <Badge tone={paid ? "paid" : "neutral"} icon={paid ? "checkCircle" : "statement"}>
      {paid ? t("Plaćeno") : t("Izdato")}
    </Badge>
  );
}

function DueCard({ statement }: { statement: Statement }) {
  const l = lang.value;
  const amount = statementTotal(statement);
  return (
    <section class="card card--block due" aria-labelledby="due-title" data-testid="due-card">
      <div class="due__main">
        <p class="kicker" id="due-title">{t("Za uplatu")}</p>
        <p class="due__amount num">{decimal(amount, 0)}<small>RSD</small></p>
        <p class="due__meta">
          {capitalize(monthAndYear(statement.month.year, statement.month.month, l))} ·{" "}
          {t("Rok za uplatu: %@", fullDate(statementDueDate(statement), l))}
        </p>
      </div>
      <Button href={`/obracuni/${monthKey(statement.month)}`} iconRight="arrowRight" testId="due-open">
        {t("Otvori obračun")}
      </Button>
    </section>
  );
}

/** The way to the monthly meter reading — only for a point read by photo (1.14). */
function ReadingsEntry({ pointId }: { pointId: string }) {
  const readings = useMeterReadings(features.value.meterPhoto ? pointId : null);
  const now = useNow(60_000);
  if (!features.value.meterPhoto || !readings.data?.required) return null;
  return (
    <a class="card card--link readings-entry" href="/ocitavanje" data-testid="readings-entry">
      <span class="card__icon"><Icon name="gauge" /></span>
      <span class="readings-entry__text">
        <span class="card__title">{t("Očitavanje brojila")}</span>
        <span class="card__sub" data-testid="readings-entry-status">{readingSummary(readings.data, now)}</span>
      </span>
      <Icon name="chevronRight" class="readings-entry__chevron" />
    </a>
  );
}

export default function Obracuni(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const statements = useStatements(point?.id ?? null);
  const l = lang.value;
  useActivity(point?.id ?? null);
  if (!point) return <PageSkeleton />;

  let body;
  if (statements.data === undefined) {
    body = statements.error ? (
      <Card><ErrorState message={errorMessage(statements.error)} onRetry={statements.reload} /></Card>
    ) : (
      <div class="stack">
        <Skeleton height={148} radius={28} />
        <Skeleton height={280} radius={24} />
      </div>
    );
  } else if (statements.data.length === 0) {
    body = (
      <Card>
        <EmptyState icon="statement" title={t("Još nema obračuna")} testId="statements-empty"
          message={t("Prvi obračun stiže na kraju meseca. U njemu su kilovat-sati i iznosi sa QR kodom za plaćanje.")} />
      </Card>
    );
  } else {
    const due = statements.data.find((s) => s.status === "issued" && statementTotal(s) > 0);
    body = (
      <div class="stack stack--lg">
        {due ? <DueCard statement={due} /> : null}
        <ul class="card card--flush statement-list" data-testid="statement-list">
          {statements.data.map((s) => {
            const amount = statementTotal(s);
            return (
              <li key={monthKey(s.month)}>
                <a class="statement-row" href={`/obracuni/${monthKey(s.month)}`} data-testid="statement-row">
                  <span class="statement-row__icon"><Icon name="statement" /></span>
                  <span class="statement-row__text">
                    <span class="statement-row__month">{capitalize(monthAndYear(s.month.year, s.month.month, l))}</span>
                    <span class="statement-row__sub num">
                      {energy(total(s.energy))}
                      {s.status === "issued" && amount > 0 ? ` · ${t("Rok za uplatu: %@", fullDate(statementDueDate(s), l))}` : ""}
                    </span>
                  </span>
                  <span class="statement-row__status"><StatusBadge statement={s} /></span>
                  <span class="statement-row__amount num">{rsd(amount)}</span>
                  <Icon name="chevronRight" class="statement-row__chevron" />
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <Page title={t("Obračuni")} testId="obracuni">
      <div class="stack stack--lg">
        <ReadingsEntry pointId={point.id} />
        {body}
      </div>
    </Page>
  );
}

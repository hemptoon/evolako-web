// /obracuni/2026-09 — one month's statement: the energy, two independent payment parts with IPS QR codes,
// the prices it was computed with, and the month's sessions. "Sačuvaj PDF" prints a clean A4 document.
import type { ChargePoint, Statement, TariffConfig } from "../api/types";
import { useActivity } from "../app/activity";
import { activePoint, useStatement, useTariff, useUser } from "../app/data";
import { isDemo } from "../app/session";
import { energy, errorMessage, pointName, tagTitle } from "../app/texts";
import { lang, t } from "../i18n";
import { parseMonthKey } from "../lib/belgrade";
import { dayAndMonth, decimal, duration, fullDate, monthAndYear, rate, time } from "../lib/format";
import { isPayableNow, statementDueDate, statementTotal } from "../lib/statement";
import { add, cost, total, ZERO } from "../lib/tariff";
import { Page } from "../shell/Page";
import type { Mode } from "../shell/Shell";
import { Button } from "../ui/controls";
import { Badge, Card, EmptyState, ErrorState, Skeleton } from "../ui/display";
import { can, capitalize, NightDayBar, PageSkeleton } from "./common";
import { EstimatedNote, OwnMeterNote, PaymentPart, serviceNote, tariffNote } from "./statement/parts";
import { PrintDocument } from "./statement/PrintDocument";

function Summary({ statement }: { statement: Statement }) {
  const l = lang.value;
  const paid = statement.status === "paid";
  const amount = statementTotal(statement);
  return (
    <section class="card card--block statement-summary" aria-label={t("Obračun")} data-testid="statement-summary">
      <div class="statement-summary__energy">
        <p class="card__sub">{t("Ukupno")}</p>
        <div class="metric">
          <span class="metric__value num">{decimal(total(statement.energy), 1)}</span>
          <span class="metric__unit">{t("kWh")}</span>
        </div>
        <NightDayBar value={statement.energy} />
      </div>
      <div class="statement-summary__due">
        <p class="card__sub">{paid ? t("Iznos") : t("Za uplatu")}</p>
        <div class="metric">
          <span class="metric__value num">{decimal(amount, 0)}</span>
          <span class="metric__unit">RSD</span>
        </div>
        <div class="statement-summary__status">
          <Badge tone={paid ? "paid" : "neutral"} icon={paid ? "checkCircle" : "statement"}>
            {paid ? t("Plaćeno") : t("Izdato")}
          </Badge>
          {!paid && amount > 0 ? (
            <span class="card__sub" data-testid="due-date">{t("Rok za uplatu: %@", fullDate(statementDueDate(statement), l))}</span>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function EnergyTable({ statement, prices }: { statement: Statement; prices: TariffConfig }) {
  const rows = [
    { key: "night", title: t("Noćna"), kWh: statement.energy.nightKWh, price: prices.lowRateRSDPerKWh },
    { key: "day", title: t("Dnevna"), kWh: statement.energy.dayKWh, price: prices.highRateRSDPerKWh },
  ];
  return (
    <Card class="energy-table" data-testid="energy-table">
      <h2 class="card__title">{t("Energija i cene")}</h2>
      <table class="table">
        <thead>
          <tr>
            <th scope="col"><span class="sr-only">{t("Tarifa")}</span></th>
            <th scope="col" class="table__num">{t("kWh")}</th>
            <th scope="col" class="table__num">{t("Cena")}</th>
            <th scope="col" class="table__num">RSD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row"><span class={`split__swatch split__swatch--${r.key}`} aria-hidden="true" />{r.title}</th>
              <td class="table__num num">{decimal(r.kWh, 2)}</td>
              <td class="table__num num">{rate(r.price)}</td>
              <td class="table__num num">{decimal(r.kWh * r.price, 2)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row">{t("Ukupno")}</th>
            <td class="table__num num">{decimal(total(statement.energy), 2)}</td>
            <td />
            <td class="table__num num">{decimal(cost(prices, statement.energy), 2)}</td>
          </tr>
        </tfoot>
      </table>
      <p class="note"><span>{tariffNote(prices)}</span></p>
    </Card>
  );
}

function TaggedLine({ statement }: { statement: Statement }) {
  const personal = statement.sessions.filter((s) => s.tag === "personal").reduce((a, s) => add(a, s.energy), ZERO);
  const business = statement.sessions.filter((s) => s.tag === "business").reduce((a, s) => add(a, s.energy), ZERO);
  const untagged = statement.sessions.filter((s) => s.tag === null).reduce((a, s) => add(a, s.energy), ZERO);
  if (total(personal) + total(business) <= 0) return null;
  return (
    <Card data-testid="tagged-line">
      <h2 class="card__title">{t("Lično i službeno")}</h2>
      <dl class="tagged">
        <div><dt>{tagTitle("personal")}</dt><dd class="num">{energy(total(personal))}</dd></div>
        <div><dt>{tagTitle("business")}</dt><dd class="num">{energy(total(business))}</dd></div>
        {total(untagged) > 0 ? <div><dt>{t("Bez oznake")}</dt><dd class="num">{energy(total(untagged))}</dd></div> : null}
      </dl>
    </Card>
  );
}

function MonthSessions({ statement, prices }: { statement: Statement; prices: TariffConfig }) {
  const l = lang.value;
  const sessions = [...statement.sessions].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return (
    <section aria-labelledby="month-sessions">
      <div class="section-head section-head--start">
        <h2 class="section-title" id="month-sessions">{t("Sesije")}</h2>
        <span class="section-head__count num">{sessions.length}</span>
      </div>
      {sessions.length === 0 ? (
        <Card><EmptyState icon="chart" title={t("Još nema sesija")} /></Card>
      ) : (
        <div class="card card--flush table-wrap">
          <table class="table table--sessions" data-testid="month-sessions">
            <thead>
              <tr>
                <th scope="col">{t("Datum")}</th>
                <th scope="col">{t("Početak")}</th>
                <th scope="col" class="table__num table__hide-sm">{t("kWh noć")}</th>
                <th scope="col" class="table__num table__hide-sm">{t("kWh dan")}</th>
                <th scope="col" class="table__num">{t("kWh")}</th>
                <th scope="col" class="table__num">{prices.source === "estimate" ? t("RSD (procena)") : "RSD"}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td>{dayAndMonth(s.startedAt, l)}</td>
                  <td class="num">
                    {time(s.startedAt, l)}
                    <span class="table__sub">{duration((s.endedAt.getTime() - s.startedAt.getTime()) / 1000, l)}</span>
                  </td>
                  <td class="table__num num table__hide-sm">{decimal(s.energy.nightKWh, 1)}</td>
                  <td class="table__num num table__hide-sm">{decimal(s.energy.dayKWh, 1)}</td>
                  <td class="table__num num">{decimal(total(s.energy), 1)}</td>
                  <td class="table__num num">{decimal(cost(prices, s.energy), 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatementBody({ statement, point, prices }: { statement: Statement; point: ChargePoint; prices: TariffConfig }) {
  const demo = isDemo.value;
  const paid = statement.status === "paid";
  return (
    <div class="stack stack--lg statement">
      <Summary statement={statement} />
      {statement.energyEstimated ? <EstimatedNote /> : null}
      <section class="statement__parts" aria-label={paid ? t("Plaćeno") : t("Za uplatu")}>
        {statement.energyPart ? (
          <PaymentPart title={t("Struja — uplata zgradi")} part={statement.energyPart} demo={demo} paid={paid}
            payable={isPayableNow(statement, statement.energyPart)}
            note={tariffNote(statement.energyPart.tariff)} testId="part-energy" />
        ) : <OwnMeterNote />}
        {statement.servicePart ? (
          <PaymentPart title={t("Pretplata Evolako")} part={statement.servicePart} demo={demo} paid={paid}
            payable={isPayableNow(statement, statement.servicePart)}
            note={serviceNote(statement.servicePart)} testId="part-service" />
        ) : null}
      </section>
      <div class="statement__details">
        <EnergyTable statement={statement} prices={prices} />
        {can(point, "remoteControl") ? <TaggedLine statement={statement} /> : null}
      </div>
      <MonthSessions statement={statement} prices={prices} />
    </div>
  );
}

export default function Obracun({ params }: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  const month = parseMonthKey(params.month ?? "");
  const statement = useStatement(point?.id ?? null, month);
  const tariff = useTariff(point?.id ?? null);
  const l = lang.value;
  useActivity(point?.id ?? null);
  if (!point || !user.data) return <PageSkeleton />;

  const title = month ? capitalize(monthAndYear(month.year, month.month, l)) : t("Obračun");
  const data = statement.data;
  const prices = data?.energyPart?.tariff ?? tariff.data;
  const actions = data && prices ? (
    <Button variant="secondary" size="sm" icon="printer" onClick={() => window.print()} testId="save-pdf">
      {t("Sačuvaj PDF")}
    </Button>
  ) : null;

  let body;
  const missing = (
    <Card>
      <EmptyState icon="statement" title={t("Nema obračuna za ovaj mesec.")} testId="statement-missing"
        action={<Button variant="secondary" href="/obracuni" icon="chevronLeft">{t("Obračuni")}</Button>} />
    </Card>
  );
  // /obracuni/YYYY-MM is a deep link; anything else in that place is simply not a statement.
  if (!month) {
    body = missing;
  } else if (data === undefined || (data !== null && !prices)) {
    const error = statement.error ?? tariff.error;
    body = error ? (
      <Card><ErrorState message={errorMessage(error)} onRetry={() => {
        void statement.reload();
        void tariff.reload();
      }} /></Card>
    ) : (
      <div class="stack">
        <Skeleton height={190} radius={28} />
        <div class="statement__parts">
          <Skeleton height={420} radius={28} />
          <Skeleton height={420} radius={28} />
        </div>
      </div>
    );
  } else if (data === null) {
    body = missing;
  } else {
    body = <StatementBody statement={data} point={point} prices={prices!} />;
  }

  return (
    <Page title={title} subtitle={`${t("Obračun")} · ${pointName(point)}`} back="/obracuni" backLabel={t("Obračuni")}
      actions={actions} testId="obracun">
      {body}
      {data && prices ? (
        <PrintDocument statement={data} point={point} user={user.data} tariff={prices} demo={isDemo.value} />
      ) : null}
    </Page>
  );
}

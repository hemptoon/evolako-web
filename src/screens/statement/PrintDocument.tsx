// The statement on paper ("Sačuvaj PDF" = the browser's print to PDF). A separate, print-only document so the
// screen layout never has to compromise: A4, white paper, ink and deep accent, vector QR codes, the payments on
// the first page and the month's sessions after them (StatementDocument of the app). Page numbers and the
// contact line live in the @page margin boxes (print.css) — language-neutral.
import { createPortal } from "preact/compat";
import type { ChargePoint, Statement, TariffConfig, User } from "../../api/types";
import { pointName } from "../../app/texts";
import { lang, t } from "../../i18n";
import { decimal, fullDate, monthAndYear, rsdPrecise, time } from "../../lib/format";
import { accountDisplay, pozivDisplay } from "../../lib/payments";
import { isPayableNow, statementDueDate, statementTotal } from "../../lib/statement";
import { cost, total } from "../../lib/tariff";
import { Mark, Wordmark } from "../../ui/brand";
import { QrCode } from "../../ui/QrCode";
import { capitalize } from "../common";
import { ESTIMATED_TEXT, paymentFields, serviceNote, tariffNote } from "./parts";

/** A payment slip on paper: the QR only when there is something to pay now; a paid statement is a record. */
function PaymentBlock({ title, part, note, demo, statement }: {
  title: string;
  part: NonNullable<Statement["energyPart"]> | NonNullable<Statement["servicePart"]>;
  note: string | null;
  demo: boolean;
  statement: Statement;
}) {
  const f = paymentFields(part);
  const payable = isPayableNow(statement, part);
  const paid = statement.status === "paid";
  return (
    <div class={paid ? "pd-slip pd-slip--paid" : "pd-slip"}>
      <div class="pd-slip__main">
        <p class="pd-slip__title">{title}</p>
        <p class="pd-slip__amount">{rsdPrecise(part.amountRSD)}</p>
        {note ? <p class="pd-muted">{note}</p> : null}
        {paid ? <p class="pd-paid">{t("Plaćeno. Podaci za uplatu ostaju ovde samo radi evidencije.")}</p> : null}
        {demo ? <p class="pd-demo">{t("Primer")} · {t("DEMO — ne plaćaj")}</p> : null}
        <dl class="pd-fields">
          <div><dt>{t("Primalac")}</dt><dd>{f.payee.name}</dd></div>
          <div><dt>{t("Račun")}</dt><dd>{accountDisplay(f.payee.accountNumber)}</dd></div>
          {f.poziv ? <div><dt>{t("Poziv na broj")}</dt><dd>{pozivDisplay(f.poziv)}</dd></div> : null}
          {f.purpose ? <div><dt>{t("Svrha plaćanja")}</dt><dd>{f.purpose}</dd></div> : null}
        </dl>
      </div>
      {payable ? (
        <div class="pd-slip__qr">
          <QrCode payload={part.qrPayload} demo={demo} label={`IPS QR — ${title}`} />
          <span class="pd-muted">IPS QR</span>
        </div>
      ) : null}
    </div>
  );
}

export function PrintDocument({ statement, point, user, tariff, demo }: {
  statement: Statement;
  point: ChargePoint;
  user: User;
  tariff: TariffConfig;
  demo: boolean;
}) {
  const l = lang.value;
  const month = capitalize(monthAndYear(statement.month.year, statement.month.month, l));
  const paid = statement.status === "paid";
  const prices = statement.energyPart?.tariff ?? tariff;
  const sessions = [...statement.sessions].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
  const amount = statementTotal(statement);
  return createPortal(
    <article class="print-doc" aria-hidden="true" data-testid="print-doc">
      <header class="pd-head">
        <div class="pd-brand">
          <Mark size={30} />
          <Wordmark size={24} />
        </div>
        <div class="pd-heading">
          <h1>{t("Obračun")}</h1>
          <p class="pd-month">{month}</p>
          <p class={paid ? "pd-status pd-status--paid" : "pd-status"}>
            {paid ? t("Plaćeno") : t("Izdato")}
            {!paid && amount > 0 ? ` · ${t("Rok za uplatu: %@", fullDate(statementDueDate(statement), l))}` : ""}
          </p>
        </div>
      </header>

      <section class="pd-point">
        <div>
          <p class="pd-strong">{user.name}</p>
          <p class="pd-muted">{user.email ?? ""}</p>
        </div>
        <div>
          <p class="pd-strong">{pointName(point)}</p>
          <p class="pd-muted">{point.address}</p>
          <p class="pd-muted">{t("Serijski broj")}: {point.serialNumber}</p>
        </div>
      </section>

      <section class="pd-totals">
        <div><span>{t("Ukupno")}</span><strong>{decimal(total(statement.energy), 1)} {t("kWh")}</strong></div>
        <div><span>{t("Noćna")}</span><strong>{decimal(statement.energy.nightKWh, 1)} {t("kWh")}</strong></div>
        <div><span>{t("Dnevna")}</span><strong>{decimal(statement.energy.dayKWh, 1)} {t("kWh")}</strong></div>
        <div class="pd-totals__due"><span>{paid ? t("Iznos") : t("Za uplatu")}</span><strong>{rsdPrecise(amount)}</strong></div>
      </section>

      {statement.energyEstimated ? <p class="pd-muted pd-estimated">{t(ESTIMATED_TEXT)}</p> : null}

      <section class="pd-payments">
        {statement.energyPart ? (
          <PaymentBlock title={t("Struja — uplata zgradi")} part={statement.energyPart} demo={demo} statement={statement}
            note={tariffNote(statement.energyPart.tariff)} />
        ) : (
          <div class="pd-slip pd-slip--info">
            <div class="pd-slip__main">
              <p class="pd-slip__title">{t("Struja ide preko tvog brojila")}</p>
              <p class="pd-muted">{t("Potrošnja je već na tvom računu za struju od EPS-a. Nema šta da se nadoknađuje.")}</p>
            </div>
          </div>
        )}
        {statement.servicePart ? (
          <PaymentBlock title={t("Pretplata Evolako")} part={statement.servicePart} demo={demo} statement={statement}
            note={serviceNote(statement.servicePart)} />
        ) : null}
      </section>

      <section class="pd-sessions">
        <h2>{t("Sesije")}</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">{t("Datum")}</th>
              <th scope="col">{t("Početak")}</th>
              <th scope="col">{t("Kraj")}</th>
              <th scope="col" class="pd-num">{t("kWh noć")}</th>
              <th scope="col" class="pd-num">{t("kWh dan")}</th>
              <th scope="col" class="pd-num">{prices.source === "estimate" ? t("RSD (procena)") : "RSD"}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.length === 0 ? (
              <tr><td colSpan={6} class="pd-muted">{t("Još nema sesija")}</td></tr>
            ) : sessions.map((s) => (
              <tr key={s.id}>
                <td>{fullDate(s.startedAt, l)}</td>
                <td>{time(s.startedAt, l)}</td>
                <td>{time(s.endedAt, l)}</td>
                <td class="pd-num">{decimal(s.energy.nightKWh, 2)}</td>
                <td class="pd-num">{decimal(s.energy.dayKWh, 2)}</td>
                <td class="pd-num">{decimal(cost(prices, s.energy), 2)}</td>
              </tr>
            ))}
          </tbody>
          {sessions.length > 0 ? (
            <tfoot>
              <tr>
                <th scope="row" colSpan={3}>{t("Ukupno")}</th>
                <td class="pd-num">{decimal(statement.energy.nightKWh, 2)}</td>
                <td class="pd-num">{decimal(statement.energy.dayKWh, 2)}</td>
                <td class="pd-num">{decimal(cost(prices, statement.energy), 2)}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
        <p class="pd-muted pd-tariff">{tariffNote(prices)}</p>
      </section>

      <footer class="pd-foot">
        <p class="pd-strong">{t("Struju ne prodajemo — merimo je.")}</p>
      </footer>
    </article>,
    document.body,
  );
}

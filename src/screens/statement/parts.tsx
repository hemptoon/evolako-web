// The two independent payment parts of a statement: electricity (paid to the meter owner) and the Evolako
// subscription. Each with its payee, account, amount, poziv na broj, purpose and the IPS QR from the backend —
// the web app never rebuilds a payment document.
import type { EnergyPart, Payee, PozivNaBroj, ServicePart, TariffConfig } from "../../api/types";
import { msg, t } from "../../i18n";
import { decimal, rate, rsdPrecise } from "../../lib/format";
import { accountDisplay, parseIps, pozivDisplay } from "../../lib/payments";
import { paymentPurpose } from "../../lib/statement";
import { Button } from "../../ui/controls";
import { copyText, CopyButton, toast } from "../../ui/display";
import { QrCode } from "../../ui/QrCode";
import { Icon } from "../../ui/Icon";

/** "Po cenama sa računa zgrade: noć / dan 5,70 / 19,65 RSD/kWh" — the prices the part was computed with. */
export function tariffNote(tariff: TariffConfig): string {
  const rates = `${rate(tariff.lowRateRSDPerKWh)} / ${rate(tariff.highRateRSDPerKWh)} RSD/${t("kWh")}`;
  switch (tariff.source) {
    case "customerBill": return t("Po cenama iz tvog računa: noć / dan %@", rates);
    case "meterOwnerBill": return t("Po cenama sa računa zgrade: noć / dan %@", rates);
    case "estimate": return t("Procena po okvirnim cenama: noć / dan %@", rates);
  }
}

/** The amount as a bank form wants it: "1690,00". */
function amountForForm(amount: number): string {
  return decimal(amount, 2, false);
}

export interface PaymentFields {
  payee: Payee;
  amount: number;
  poziv: PozivNaBroj | null;
  purpose: string | null;
  code: string | null;
}

export function paymentFields(part: EnergyPart | ServicePart): PaymentFields {
  const ips = part.qrPayload ? parseIps(part.qrPayload) : {};
  return {
    payee: part.payee,
    amount: part.amountRSD,
    poziv: part.pozivNaBroj,
    purpose: paymentPurpose(part),
    code: ips.SF ?? null,
  };
}

/** Everything a bank form asks for, one field per line — for "Kopiraj podatke za uplatu". */
export function paymentText(f: PaymentFields): string {
  const lines = [
    `${t("Primalac")}: ${f.payee.name}`,
    `${t("Račun")}: ${accountDisplay(f.payee.accountNumber)}`,
    `${t("Iznos")}: ${rsdPrecise(f.amount)}`,
  ];
  if (f.code) lines.push(`${t("Šifra plaćanja")}: ${f.code}`);
  if (f.poziv) {
    lines.push(`${t("Model")}: ${f.poziv.model}`);
    lines.push(`${t("Poziv na broj")}: ${f.poziv.reference}`);
  }
  if (f.purpose) lines.push(`${t("Svrha plaćanja")}: ${f.purpose}`);
  return lines.join("\n");
}

function Field({ label, value, copy, testId }: { label: string; value: string; copy?: string; testId?: string }) {
  return (
    <div class="pay-field" data-testid={testId}>
      <dt>{label}</dt>
      <dd>
        <span class="pay-field__value">{value}</span>
        {copy ? <CopyButton text={copy} what={label} testId={testId ? `${testId}-copy` : undefined} /> : null}
      </dd>
    </div>
  );
}

/**
 * One payment part. `payable` = something to pay now (isPayableNow): the IPS QR, per-field copy and "Kopiraj
 * podatke za uplatu". `paid` = the statement is paid: a calm "Plaćeno" and the details as plain text, for the record
 * only — nothing on the page invites paying twice. A 0 RSD part (trial) shows its details as text too.
 */
export function PaymentPart({ title, part, note, demo, payable, paid, testId }: {
  title: string;
  part: EnergyPart | ServicePart;
  note: string | null;
  demo: boolean;
  payable: boolean;
  paid: boolean;
  testId: string;
}) {
  const f = paymentFields(part);
  const scan = t("Skeniraj u svojoj m-banking aplikaciji").replace("m-banking", "m-\u2060banking");
  const copy = (value: string) => (payable ? value : undefined);
  return (
    <section class={`card card--block pay${paid ? " pay--paid" : ""}`} aria-labelledby={`${testId}-title`}
      data-testid={testId}>
      <div class="pay__intro">
        <header class="pay__head">
          <h3 class="pay__title" id={`${testId}-title`}>{title}</h3>
          {demo ? <span class="badge badge--demo" data-testid="demo-example"><Icon name="info" />{t("Primer")}</span> : null}
        </header>
        <div class="pay__amount num">{rsdPrecise(part.amountRSD)}</div>
        {note ? <p class="pay__note">{note}</p> : null}
        {payable ? <p class="pay__scan pay__scan--side"><Icon name="qr" /><span>{scan}</span></p> : null}
        {paid ? (
          <p class="pay__paid" data-testid={`${testId}-paid`}>
            <Icon name="checkCircle" />
            <span>{t("Plaćeno. Podaci za uplatu ostaju ovde samo radi evidencije.")}</span>
          </p>
        ) : null}
      </div>
      {payable ? (
        <div class="pay__qr">
          <QrCode payload={part.qrPayload} demo={demo} label={`IPS QR — ${title}`} />
          <p class="pay__scan pay__scan--below">{scan}</p>
        </div>
      ) : null}
      <dl class={payable ? "pay__fields" : "pay__fields pay__fields--record"}>
        <Field label={t("Primalac")} value={f.payee.name} copy={copy(f.payee.name)} testId={`${testId}-payee`} />
        <Field label={t("Račun")} value={accountDisplay(f.payee.accountNumber)} copy={copy(f.payee.accountNumber)}
          testId={`${testId}-account`} />
        {payable || paid ? (
          <Field label={t("Iznos")} value={rsdPrecise(f.amount)} copy={copy(amountForForm(f.amount))} testId={`${testId}-amount`} />
        ) : null}
        {f.poziv ? (
          <Field label={t("Poziv na broj")} value={pozivDisplay(f.poziv)} copy={copy(f.poziv.reference)}
            testId={`${testId}-poziv`} />
        ) : null}
        {f.purpose ? <Field label={t("Svrha plaćanja")} value={f.purpose} copy={copy(f.purpose)} testId={`${testId}-purpose`} /> : null}
      </dl>
      {payable ? (
        <Button variant="secondary" block icon="copy" testId={`${testId}-copy-all`} class="pay__copy"
          onClick={async () => {
            if (await copyText(paymentText(f))) toast(t("Kopirano"));
          }}>
          {t("Kopiraj podatke za uplatu")}
        </Button>
      ) : null}
    </section>
  );
}

/** The note of the subscription part: the free period, or the days charged in the month it ended in (1.14). */
export function serviceNote(part: ServicePart): string | null {
  if (part.isTrial) return t("Prva 2 meseca — 0 RSD");
  if (part.proration) {
    return t("Pretplata za ovaj mesec: %lld od %lld dana (posle probnog perioda).", part.proration.paidDays, part.proration.monthDays);
  }
  return null;
}

export const ESTIMATED_TEXT = msg("Za ovaj mesec nismo dobili očitavanje, pa je potrošnja procenjena po proseku. Razliku ispravljamo u sledećem obračunu.");

/** No meter reading arrived for the month: the energy is the average, and the next statement settles the difference. */
export function EstimatedNote() {
  return (
    <p class="banner banner--info statement__estimated" data-testid="statement-estimated">
      <Icon name="info" />
      <span>{t(ESTIMATED_TEXT)}</span>
    </p>
  );
}

export function OwnMeterNote() {
  return (
    <section class="card card--block pay pay--info" data-testid="own-meter-note">
      <span class="card__icon"><Icon name="home" /></span>
      <h3 class="pay__title">{t("Struja ide preko tvog brojila")}</h3>
      <p class="card__sub">{t("Potrošnja je već na tvom računu za struju od EPS-a. Nema šta da se nadoknađuje.")}</p>
    </section>
  );
}

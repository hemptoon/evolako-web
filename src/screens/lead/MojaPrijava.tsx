// /moja-prijava — the lead's request: where it is (Primljeno → Procena zakazana → Ugradnja zakazana → Ugrađeno),
// its number, what we know, what happens next and how to reach us. Without a request: the request form.
import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { InstallationRequest, InstallationStatus, User } from "../../api/types";
import { INSTALLATION_STATUSES } from "../../api/types";
import { LINKS, MESSENGER_NUMBER, SUPPORT_EMAIL, mailto } from "../../app/contacts";
import { useInstallationRequests, useUser } from "../../app/data";
import { prefillReferral } from "../../app/links";
import { location } from "../../app/router";
import { session } from "../../app/session";
import { errorMessage, installationStatusTitle } from "../../app/texts";
import { lang, siteText, t } from "../../i18n";
import { dateAndTime } from "../../lib/format";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Badge, Card, ErrorState, KeyValues, Steps } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { PageSkeleton, respondBy } from "../common";
import { CATALOG, cityTitle, findAnyPackage, parkingTitle } from "./content";
import { RequestForm } from "./RequestForm";

export function requestDetail(request: InstallationRequest): string {
  const l = lang.value;
  switch (request.status) {
    case "received":
      return t("Javićemo se do %@ da dogovorimo procenu.", dateAndTime(respondBy(request.createdAt, 48), l));
    case "assessmentScheduled":
      return t("Procena je zakazana za %@.", dateAndTime(request.assessmentAt ?? request.updatedAt, l));
    case "installationScheduled":
      return t("Ugradnja je zakazana za %@.", dateAndTime(request.installationAt ?? request.updatedAt, l));
    case "installed":
      return t("Komplet je ugrađen. Nalog ti otvara naš tim — posle toga se prijavi u aplikaciji.");
  }
}

export function RequestStatusCard({ request }: { request: InstallationRequest }) {
  const current = INSTALLATION_STATUSES.indexOf(request.status);
  const pkg = findAnyPackage(request.draft.package);
  return (
    <section class="card card--block lead-hero" aria-labelledby="request-title" data-testid="installation-card">
      <div class="lead-hero__head">
        <span class="card__icon"><Icon name={request.status === "installed" ? "checkCircle" : "calendarClock"} /></span>
        <div class="lead-hero__titles">
          <h2 class="card__title" id="request-title">{t("Zahtev za procenu")}</h2>
          <p class="card__sub">{pkg ? siteText(pkg.name) : t("Paket još nije izabran")}</p>
        </div>
        {request.requestNo ? <Badge tone="neutral" icon="tag"><span class="num" data-testid="request-no">{request.requestNo}</span></Badge> : null}
      </div>
      <Steps labels={INSTALLATION_STATUSES.map((s: InstallationStatus) => installationStatusTitle(s))} current={current}
        label={t("Zahtev za procenu")} />
      <p class="lead-hero__detail" data-testid="request-detail">{requestDetail(request)}</p>
    </section>
  );
}

function Facts({ request }: { request: InstallationRequest }) {
  const l = lang.value;
  const d = request.draft;
  const pkg = findAnyPackage(d.package);
  const items: Array<[string, ComponentChildren]> = [
    [t("Paket"), pkg ? siteText(pkg.name) : t("Još ne znam")],
  ];
  const city = cityTitle(d.city);
  if (city) items.push([t("Grad"), siteText(city)]);
  const parking = parkingTitle(d.parking);
  if (parking) items.push([t("Gde auto noći"), siteText(parking)]);
  if (d.address) items.push([t("Adresa"), d.address]);
  if (d.car) items.push([t("Auto"), d.car]);
  if (d.phone) items.push([t("Telefon"), <span class="num">{d.phone}</span>]);
  if (d.email) items.push([t("E-mail"), d.email]);
  if (d.referralCode) items.push([t("Kod preporuke"), <span class="num">{d.referralCode}</span>]);
  if (d.comment) items.push([t("Komentar"), d.comment]);
  items.push([t("Poslato"), dateAndTime(request.createdAt, l)]);
  return (
    <Card as="section" aria-labelledby="facts-title">
      <h2 class="card__title" id="facts-title">{t("Šta znamo")}</h2>
      <KeyValues items={items} />
    </Card>
  );
}

function NextSteps({ request }: { request: InstallationRequest }) {
  const index = request.status === "received" || request.status === "assessmentScheduled" ? 0
    : request.status === "installationScheduled" ? 1 : 2;
  return (
    <Card as="section" aria-labelledby="next-title">
      <h2 class="card__title" id="next-title">{t("Šta sledi")}</h2>
      <ol class="how how--steps">
        {CATALOG.steps.items.map((step, i) => (
          <li key={step.title.sr} class={i < index ? "is-done" : i === index ? "is-current" : undefined}
            aria-current={i === index ? "step" : undefined}>
            <span class="how__n num" aria-hidden="true">{i < index ? <Icon name="check" /> : i + 1}</span>
            <span>
              <strong>{siteText(step.title)}</strong>
              <span class="how__text">{siteText(step.text)}</span>
            </span>
          </li>
        ))}
      </ol>
      {request.status === "received" || request.status === "assessmentScheduled" ? (
        <p class="note"><Icon name="info" /><span>{siteText(CATALOG.assessment.text)}</span></p>
      ) : null}
    </Card>
  );
}

function Contacts() {
  return (
    <Card as="section" aria-labelledby="contact-title">
      <h2 class="card__title" id="contact-title">{t("Podrška")}</h2>
      <p class="card__sub">{t("Javićemo se u roku od 48 h.")}</p>
      <div class="rows contact-rows">
        <a class="row" href={mailto("Moj Evolako")}>
          <span class="row__icon"><Icon name="mail" /></span>
          <span class="row__text"><span class="row__title">{t("Piši nam")}</span><span class="row__sub">{SUPPORT_EMAIL}</span></span>
        </a>
        <a class="row" href={LINKS.whatsapp} target="_blank" rel="noopener noreferrer">
          <span class="row__icon"><Icon name="whatsapp" /></span>
          <span class="row__text">
            <span class="row__title">WhatsApp · {MESSENGER_NUMBER}</span>
            <span class="row__sub">{t("Samo poruke, bez poziva")}</span>
          </span>
          <span class="row__trail"><Icon name="external" /></span>
        </a>
        <a class="row" href="/profil/podrska">
          <span class="row__icon"><Icon name="viber" /></span>
          <span class="row__text"><span class="row__title">Viber · Telegram</span><span class="row__sub">{t("Samo poruke, bez poziva")}</span></span>
          <span class="row__trail"><Icon name="chevronRight" /></span>
        </a>
      </div>
    </Card>
  );
}

function ReferralInfo({ request }: { request: InstallationRequest }) {
  return (
    <Card as="section" aria-labelledby="ref-title" class="ref-info">
      <h2 class="card__title" id="ref-title">{t("Imaš kod preporuke?")}</h2>
      {request.draft.referralCode ? (
        <p class="card__sub"><Icon name="checkCircle" /> {t("Kod preporuke")}: <strong class="num">{request.draft.referralCode}</strong></p>
      ) : (
        <p class="card__sub">{t("Kod se upisuje pre ugradnje. Ako ga imaš, pošalji nam ga porukom — dodaćemo ga u tvoj zahtev.")}</p>
      )}
    </Card>
  );
}

function initialDraft(user: User | undefined) {
  const s = session.value;
  const pkg = location.value.query.get("paket");
  return {
    name: user?.name ?? "",
    email: (s.kind === "in" ? s.email : user?.email) ?? "",
    phone: user?.phone ?? "",
    package: findAnyPackage(pkg)?.id ?? null,
    referralCode: prefillReferral(location.value.query),
  };
}

export function RequestSent({ request }: { request: InstallationRequest }) {
  return (
    <Card class="sent" data-testid="request-sent">
      <span class="state__icon"><Icon name="checkCircle" /></span>
      <h2 class="state__title">{t("Poslato")}</h2>
      <p class="state__text">{t("Javićemo se u roku od 48 h.")}</p>
      {request.requestNo ? <p class="card__sub num">{request.requestNo}</p> : null}
    </Card>
  );
}

export default function MojaPrijava(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const requests = useInstallationRequests(true);
  const [sent, setSent] = useState<InstallationRequest | null>(null);
  if (requests.data === undefined && !requests.error) return <PageSkeleton />;

  let body;
  if (!requests.data) {
    body = <Card><ErrorState message={errorMessage(requests.error)} onRetry={requests.reload} /></Card>;
  } else {
    const request = sent ?? requests.data[0] ?? null;
    if (!request) {
      body = (
        <div class="two-col two-col--form">
          <RequestForm initial={initialDraft(user.data)} onSent={setSent} />
          <div class="stack">
            <Card as="section" aria-labelledby="why-title">
              <p class="kicker">{siteText(CATALOG.assessment.kicker)}</p>
              <h2 class="card__title" id="why-title">{siteText(CATALOG.assessment.title)}</h2>
              <p class="card__sub">{siteText(CATALOG.assessment.text)}</p>
            </Card>
            <Contacts />
          </div>
        </div>
      );
    } else {
      body = (
        <div class="two-col">
          <div class="stack">
            {sent ? <RequestSent request={sent} /> : null}
            <RequestStatusCard request={request} />
            <NextSteps request={request} />
          </div>
          <div class="stack">
            <Facts request={request} />
            <ReferralInfo request={request} />
            <Contacts />
          </div>
        </div>
      );
    }
  }
  const hasRequest = Boolean(sent ?? requests.data?.[0]);
  return (
    <Page title={t("Moja prijava")} subtitle={hasRequest ? undefined : t("Zatraži procenu")} testId="moja-prijava">
      {body}
    </Page>
  );
}

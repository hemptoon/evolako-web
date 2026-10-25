// /profil — the account at a glance and the way to everything else: the point, the subscription, referrals,
// service, settings and help. A lead (no point yet) sees the account, help and the kits.
import type { ChargePoint, User } from "../../api/types";
import { activePoint, useReferral, useSubscription, useTariff, useUser } from "../../app/data";
import { PRICING } from "../../app/contacts";
import { session, signOut } from "../../app/session";
import { pointName, skuTitle, statusIcon, statusTitle, subscriptionSummary, subscriptionTitle } from "../../app/texts";
import { lang, t, tp } from "../../i18n";
import { fullDate } from "../../lib/format";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Badge, Card, Row, Skeleton } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { FxNote, ownPriceText } from "../../ui/money";
import { PageSkeleton } from "../common";

export function initials(name: string, email: string): string {
  const source = (name || email || "E").trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "E") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function accountEmail(user: User): string {
  const s = session.value;
  return s.kind === "in" ? s.email || user.email || "" : user.email ?? "";
}

function AccountCard({ user }: { user: User }) {
  const email = accountEmail(user);
  return (
    <a class="card card--link account-card" href="/profil/nalog" data-testid="account-card">
      <span class="avatar avatar--lg" aria-hidden="true">{initials(user.name, email)}</span>
      <span class="account-card__text">
        <span class="account-card__name">{user.name || t("Nalog")}</span>
        <span class="account-card__mail">{email}</span>
      </span>
      <span class="account-card__link">{t("Nalog i podešavanja")}<Icon name="chevronRight" /></span>
    </a>
  );
}

function PointCard({ point }: { point: ChargePoint }) {
  const l = lang.value;
  return (
    <a class="card card--link point-card" href="/profil/tacka" data-testid="point-card">
      <div class="point-card__head">
        <span class="card__icon"><Icon name={point.sku === "wallboxB" ? "charger" : "plug"} /></span>
        <div class="point-card__titles">
          <h2 class="card__title">{pointName(point)}</h2>
          <p class="card__sub">{point.address}</p>
        </div>
        <Badge tone={point.status} icon={statusIcon(point.status)}>{statusTitle(point.status)}</Badge>
      </div>
      <dl class="point-card__facts">
        <div><dt>{t("Komplet")}</dt><dd>{skuTitle(point.sku)}</dd></div>
        <div><dt>{t("Ugradnja")}</dt><dd>{fullDate(point.installedAt, l)}</dd></div>
      </dl>
      <span class="point-card__more">{t("Preimenuj")} · {t("Tačka punjenja")}<Icon name="chevronRight" /></span>
    </a>
  );
}

function SubscriptionRow() {
  const subscription = useSubscription(true);
  const referral = useReferral(true);
  if (!subscription.data) return <Skeleton height={64} radius={14} />;
  const status = subscriptionTitle(subscription.data);
  const free = referral.data?.freeMonthsBalance ?? 0;
  return (
    <Row icon="badgeCheck" href="/profil/pretplata" chevron testId="row-pretplata"
      title={t("Pretplata")}
      subtitle={free > 0
        ? `${subscriptionSummary(subscription.data, ownPriceText(PRICING.subscriptionMonthly))} · ${tp("+%lld besplatna meseca od preporuka", free)}`
        : subscriptionSummary(subscription.data, ownPriceText(PRICING.subscriptionMonthly))}
      trailing={<Badge tone={status.active ? "online" : "offline"}>{status.title}</Badge>} />
  );
}

function tariffSubtitle(point: ChargePoint, source: string | undefined): string {
  if (point.connectionScheme.type === "thirdPartyMeter") return t("Cene unosimo po računu zgrade koji nam pošalješ");
  if (source === "customerBill") return t("Po cenama iz tvog računa");
  return t("Procena po okvirnim cenama");
}

function CustomerProfile({ user, point }: { user: User; point: ChargePoint }) {
  const tariff = useTariff(point.id);
  return (
    <div class="profil">
      <div class="profil__main stack">
        <AccountCard user={user} />
        <PointCard point={point} />
        <a class="card card--link invite-card" href="/profil/pozovi-komsiju" data-testid="invite-card">
          <span class="invite-card__icon"><Icon name="gift" /></span>
          <span class="invite-card__text">
            <span class="card__title">{t("Pozovi komšiju")}</span>
            <span class="card__sub">{t("Za svaku ugradnju po tvojoj preporuci — besplatni meseci i tebi i prijatelju.")}</span>
          </span>
          <Icon name="chevronRight" class="invite-card__chevron" />
        </a>
      </div>
      <div class="profil__side stack">
        <Card class="list-card" as="section" aria-labelledby="profil-account">
          <h2 class="list-card__title" id="profil-account">{t("Pretplata")} · {t("Tarifa")}</h2>
          <div class="rows">
            <SubscriptionRow />
            <Row icon="bolt" href="/profil/cene-struje" chevron testId="row-cene" title={t("Cene struje")}
              subtitle={tariffSubtitle(point, tariff.data?.source)} />
          </div>
        </Card>
        <Card class="list-card" as="section" aria-labelledby="profil-help">
          <h2 class="list-card__title" id="profil-help">{t("Podrška")}</h2>
          <div class="rows">
            <Row icon="wrench" href="/profil/prijavi-kvar" chevron testId="row-kvar" title={t("Prijavi kvar")}
              subtitle={t("Javićemo se u roku od 48 h.")} />
            <Row icon="truck" href="/profil/selim-se" chevron testId="row-selidba" title={t("Selim se")}
              subtitle={t("Prenosimo komplet na novu adresu. Javićemo se u roku od 72 h.")} />
            <Row icon="mail" href="/profil/podrska" chevron testId="row-podrska" title={t("Piši nam")}
              subtitle={`hello@evolako.com · ${t("Samo poruke, bez poziva")}`} />
            <Row icon="help" href="/profil/pitanja" chevron testId="row-faq" title={t("Česta pitanja")} />
          </div>
        </Card>
        <Card class="list-card" as="section" aria-labelledby="profil-more">
          <h2 class="list-card__title" id="profil-more">{t("Još")}</h2>
          <div class="rows">
            <Row icon="charger" href="/paketi" chevron testId="row-paketi" title={t("Paketi")}
              subtitle={t("Druga tačka ili komplet za komšiju")} />
            <Row icon="settings" href="/profil/nalog" chevron testId="row-nalog" title={t("Nalog i podešavanja")}
              subtitle={t("Jezik i izgled")} />
            <Row icon="info" href="/profil/o-aplikaciji" chevron testId="row-about" title={t("O aplikaciji")}
              subtitle={`${t("Verzija")} ${__APP_VERSION__}`} />
          </div>
        </Card>
        <Button variant="secondary" icon="logout" block onClick={() => void signOut()} testId="sign-out">
          {session.value.kind === "demo" ? t("Izađi iz demoa") : t("Odjavi se")}
        </Button>
      </div>
    </div>
  );
}

function LeadProfile({ user }: { user: User }) {
  return (
    <div class="profil profil--lead">
      <div class="profil__main stack">
        <AccountCard user={user} />
        <Card class="list-card">
          <div class="rows">
            <Row icon="calendarClock" href="/moja-prijava" chevron title={t("Moja prijava")}
              subtitle={t("Javićemo se u roku od 48 h.")} />
            <Row icon="charger" href="/paketi" chevron title={t("Paketi")}
              subtitle={t("Komplet, ugradnja, pretplata i kalkulator")} />
          </div>
        </Card>
      </div>
      <div class="profil__side stack">
        <Card class="list-card">
          <div class="rows">
            <Row icon="settings" href="/profil/nalog" chevron testId="row-nalog" title={t("Nalog i podešavanja")}
              subtitle={t("Jezik i izgled")} />
            <Row icon="mail" href="/profil/podrska" chevron testId="row-podrska" title={t("Piši nam")}
              subtitle={`hello@evolako.com · ${t("Samo poruke, bez poziva")}`} />
            <Row icon="help" href="/profil/pitanja" chevron testId="row-faq" title={t("Česta pitanja")} />
            <Row icon="info" href="/profil/o-aplikaciji" chevron testId="row-about" title={t("O aplikaciji")}
              subtitle={`${t("Verzija")} ${__APP_VERSION__}`} />
          </div>
        </Card>
        <Button variant="secondary" icon="logout" block onClick={() => void signOut()} testId="sign-out">
          {session.value.kind === "demo" ? t("Izađi iz demoa") : t("Odjavi se")}
        </Button>
      </div>
    </div>
  );
}

export default function Profil({ mode }: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const point = activePoint(user.data);
  if (!user.data) return <PageSkeleton />;
  return (
    <Page title={t("Profil")} testId="profil">
      {mode === "customer" && point ? <CustomerProfile user={user.data} point={point} /> : <LeadProfile user={user.data} />}
      <FxNote />
    </Page>
  );
}

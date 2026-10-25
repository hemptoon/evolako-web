// /profil/pretplata — the subscription: state, what it covers, the free months from referrals, pause, cancel
// and resume, and the monthly history. Pause needs an active subscription (server rule).
import { useState } from "preact/hooks";
import type { Subscription, SubscriptionState } from "../../api/types";
import { PRICING } from "../../app/contacts";
import { backendOrThrow, k, useReferral, useSubscription } from "../../app/data";
import { invalidate, setData } from "../../app/query";
import { errorMessage, subscriptionSummary, subscriptionTitle } from "../../app/texts";
import { lang, siteText, t, tp } from "../../i18n";
import { belgradeParts, fromBelgrade, monthKey } from "../../lib/belgrade";
import { fullDate, monthAndYear, rsd } from "../../lib/format";
import paketi from "../../content/paketi.json";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Badge, Card, EmptyState, ErrorState, toast } from "../../ui/display";
import { Icon, type IconName } from "../../ui/Icon";
import { FxNote, ownPriceText } from "../../ui/money";
import { Dialog } from "../../ui/overlay";
import { capitalize, PageSkeleton } from "../common";

type Text = { sr: string; en: string; ru: string };
const COVER = (paketi as unknown as { subscription: { title: Text; items: Array<{ title: Text; text: Text }> } }).subscription;
const COVER_ICONS: IconName[] = ["statement", "bell", "wrench", "shield", "badgeCheck", "truck"];

function endsOnDate(endsOn: string | null): Date | null {
  if (!endsOn) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(endsOn);
  return m ? fromBelgrade(Number(m[1]), Number(m[2]), Number(m[3]), 12) : null;
}

function stateAmount(state: SubscriptionState, amount: number): string {
  if (state.type === "trial") return `${t("Probni period")} · 0 RSD`;
  if (state.type === "paused") return `${t("Pauzirana")} · 0 RSD`;
  if (state.type === "none") return t("Nema pretplate");
  return rsd(amount);
}

type Confirm = "pause" | "cancel" | null;

function StatusCard({ subscription, onChange }: { subscription: Subscription; onChange: (s: Subscription) => void }) {
  const l = lang.value;
  const referral = useReferral(true);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<Confirm | "resume">(null);
  const state = subscription.state;
  const status = subscriptionTitle(subscription);
  const hold = subscription.suspendedSince !== null;
  // The line about unused free months: after a cancellation here, or told by the server (cancelled, ended).
  const [keptNow, setKeptNow] = useState(false);
  const kept = keptNow || (subscription.keptFreeMonths?.months ?? 0) > 0;
  const ends = endsOnDate(subscription.endsOn);
  const free = referral.data?.freeMonthsBalance ?? 0;
  // Pause months used this calendar year: the server's count while paused, otherwise read from the history.
  const year = belgradeParts(new Date()).year;
  const monthsUsed = state.type === "paused"
    ? state.monthsUsed
    : subscription.history.filter((h) => h.month.year === year && h.state.type === "paused").length;
  const pausesLeft = Math.max(0, PRICING.pauseMonthsPerYear - monthsUsed);

  const run = async (what: "pause" | "cancel" | "resume") => {
    setBusy(what);
    setConfirm(null);
    try {
      const backend = backendOrThrow();
      if (what === "pause") {
        onChange(await backend.requestSubscriptionPause());
      } else if (what === "resume") {
        onChange(await backend.resumeSubscription());
      } else {
        const result = await backend.cancelSubscription();
        if (result.already) toast(t("Pretplata je već otkazana."), "info");
        setKeptNow(result.freeMonthsKept > 0);
        invalidate(k("subscription"));
      }
    } catch (e) {
      toast(errorMessage(e), "circleAlert");
    } finally {
      setBusy(null);
    }
  };

  return (
    <section class="card card--block sub-status" aria-labelledby="sub-title" data-testid="subscription-status">
      <div class="sub-status__head">
        <div>
          <p class="kicker">{t("Pretplata Evolako")}</p>
          <h2 class="sub-status__title" id="sub-title">{subscriptionSummary(subscription, ownPriceText(PRICING.subscriptionMonthly))}</h2>
        </div>
        <Badge tone={status.active && !ends ? "online" : "offline"}
          icon={status.active && !ends ? "checkCircle" : hold && !ends ? "clock" : "pause"}>
          {ends ? t("Otkazana") : status.title}
        </Badge>
      </div>
      {state.type === "trial" && subscription.trialStartsBy ? (
        <p class="card__sub" data-testid="trial-pending">
          {t("Probni period počinje kad prvi put otvoriš punjač u aplikaciji (najkasnije 14 dana posle ugradnje).")}
        </p>
      ) : null}
      {state.type === "trial" ? (
        <p class="card__sub">{t("Posle probnog perioda — %@ mesečno.", ownPriceText(PRICING.subscriptionMonthly))}</p>
      ) : null}
      {hold ? (
        <div class="banner banner--info sub-status__hold" data-testid="subscription-hold">
          <Icon name="info" />
          <div class="banner__main">
            <div class="banner__text">
              {t("Pretplata je na čekanju jer uplata kasni više od 30 dana. Dok je tako, produžena garancija i prioritetni servis ne važe. Nema kamata ni penala — čim uplata stigne, sve se vraća samo.")}
            </div>
            <Button size="sm" icon="qr" class="banner__action" testId="subscription-pay"
              href={subscription.unpaid ? `/obracuni/${monthKey(subscription.unpaid.month)}` : "/obracuni"}>
              {t("Plati pretplatu")}
            </Button>
          </div>
        </div>
      ) : null}
      {ends ? (
        <p class="banner banner--info sub-status__ends" data-testid="subscription-ends">
          <Icon name="calendar" />
          <span>{t("Pretplata važi do %@.", fullDate(ends, l))}</span>
        </p>
      ) : null}
      {kept && (ends || state.type === "none") ? (
        <p class="note" data-testid="kept-months">
          <Icon name="gift" />
          <span>{t("Neiskorišćeni besplatni meseci od preporuka čuvaju se 12 meseci — važe ako se vratiš u tom roku.")}</span>
        </p>
      ) : null}
      {free > 0 ? (
        <p class="side-card__gift" data-testid="free-months">
          <Icon name="gift" />
          <span>
            {tp("+%lld besplatna meseca od preporuka", free)}
            {referral.data?.appliesFrom ? (
              <span class="card__sub">
                {" · "}{t("Primenjuju se od: %@", monthAndYear(referral.data.appliesFrom.year, referral.data.appliesFrom.month, l))}
              </span>
            ) : null}
          </span>
        </p>
      ) : null}
      <div class="sub-status__actions">
        {ends ? (
          <Button icon="play" loading={busy === "resume"} onClick={() => void run("resume")} testId="subscription-resume">
            {t("Nastavi pretplatu")}
          </Button>
        ) : null}
        {state.type === "active" && !ends ? (
          <Button variant="secondary" icon="pause" loading={busy === "pause"} onClick={() => setConfirm("pause")}
            testId="subscription-pause">
            {t("Zatraži pauzu")}
          </Button>
        ) : null}
        {(state.type === "active" || state.type === "trial") && !ends ? (
          <Button variant="ghost" loading={busy === "cancel"} onClick={() => setConfirm("cancel")} testId="subscription-cancel">
            {t("Otkaži pretplatu")}
          </Button>
        ) : null}
      </div>
      {confirm === "pause" ? (
        <Dialog role="alertdialog" title={t("Pauzirati pretplatu?")} onClose={() => setConfirm(null)} testId="pause-dialog"
          actions={
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("Otkaži")}</Button>
              <Button onClick={() => void run("pause")} testId="pause-confirm">{t("Pauziraj pretplatu")}</Button>
            </>
          }>
          {t("Pauza traje ceo kalendarski mesec: pretplata se tada ne plaća, a merenje i obračuni rade i dalje. Produžena garancija i prioritetni izlazak važe dok traje pretplata. Ove godine možeš još %lld od %lld meseca pauze.",
            pausesLeft, PRICING.pauseMonthsPerYear)}
        </Dialog>
      ) : null}
      {confirm === "cancel" ? (
        <Dialog role="alertdialog" title={t("Otkazati pretplatu?")} onClose={() => setConfirm(null)} testId="cancel-dialog"
          actions={
            <>
              <Button variant="secondary" onClick={() => setConfirm(null)}>{t("Zadrži pretplatu")}</Button>
              <Button variant="danger" onClick={() => void run("cancel")} testId="cancel-confirm">{t("Otkaži pretplatu")}</Button>
            </>
          }>
          {t("Komplet radi i bez pretplate. Kad pretplata istekne, prestaje sve što ona pokriva — spisak je na ovoj strani. Do tada je možeš nastaviti.")}
          {free > 0 ? (
            <p class="dialog__extra" data-testid="cancel-kept-months">
              {t("Neiskorišćeni besplatni meseci od preporuka čuvaju se 12 meseci — važe ako se vratiš u tom roku.")}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}

export default function Pretplata(_props: { params: Record<string, string>; mode: Mode }) {
  const subscription = useSubscription(true);
  const l = lang.value;
  if (subscription.data === undefined && !subscription.error) return <PageSkeleton />;

  let body;
  if (!subscription.data) {
    body = <Card><ErrorState message={errorMessage(subscription.error)} onRetry={subscription.reload} /></Card>;
  } else {
    const data = subscription.data;
    body = (
      <div class="two-col">
        <div class="stack">
          <StatusCard subscription={data} onChange={(next) => setData(k("subscription"), next)} />
          <Card as="section" aria-labelledby="sub-history">
            <h2 class="card__title" id="sub-history">{t("Istorija")}</h2>
            {data.history.length === 0 ? (
              <EmptyState icon="history" title={t("Još nema obračuna")} />
            ) : (
              <ul class="history" data-testid="subscription-history">
                {data.history.map((h) => (
                  <li key={monthKey(h.month)}>
                    <span>{capitalize(monthAndYear(h.month.year, h.month.month, l))}</span>
                    <span class="num">{stateAmount(h.state, h.amountRSD)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p class="note"><Icon name="info" /><span>{t("Pretplata od %@", fullDate(data.startedAt, l))}</span></p>
          </Card>
        </div>
        <Card as="section" aria-labelledby="sub-cover" class="cover">
          <h2 class="card__title" id="sub-cover">{siteText(COVER.title)}</h2>
          <ul class="cover__list">
            {COVER.items.map((item, i) => (
              <li key={item.title.sr} class="cover__item">
                <span class="capability__icon"><Icon name={COVER_ICONS[i] ?? "check"} /></span>
                <span>
                  <strong>{siteText(item.title)}</strong>
                  <span>{siteText(item.text)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    );
  }
  return (
    <Page title={t("Pretplata")} back="/profil" backLabel={t("Profil")} testId="pretplata">
      {body}
      <FxNote />
    </Page>
  );
}

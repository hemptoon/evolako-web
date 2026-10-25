// /profil/pozovi-komsiju — the referral programme: your EVO-XXXXX code, sharing, how it works, your referrals
// with their status, and the conditions (ReferralTexts of the app). The reward is free months, nothing else.
import type { Referral } from "../../api/types";
import { PRICING, REFERRAL } from "../../app/contacts";
import { useReferral } from "../../app/data";
import { errorMessage, notEligibleTitle, referralStatusTitle } from "../../app/texts";
import { lang, msg, t, tp } from "../../i18n";
import { fullDate, monthAndYear } from "../../lib/format";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Badge, Card, copyText, EmptyState, ErrorState, toast } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { PageSkeleton } from "../common";

const STEPS = [
  msg("Podeli svoj kod ili link komšiji ili prijatelju."),
  msg("Prijatelj upiše kod kad se prijavljuje — pre ugradnje."),
  msg("Kad mu ugradimo komplet, oboje dobijate besplatne mesece pretplate."),
];

const RULES = [
  msg("Kod se upisuje pre ugradnje."),
  msg("Preporuka se računa kad je komplet prijatelja ugrađen."),
  msg("Ne računa se: sopstveni kod, ista adresa ili tačka i postojeći klijent."),
  msg("Besplatni meseci se ne menjaju za novac i ne prenose se na drugog."),
];

function friendSentence(): string {
  return tp("Dobijaš još %lld meseca pretplate besplatno, preko probnog perioda.", REFERRAL.friendBonusMonths);
}

function linkMessage(code: string): string {
  return `${t("Punim auto u garaži dok spavam — uz Evolako. Kad se prijaviš, upiši moj kod %@ pre ugradnje.", code)} ${friendSentence()}`;
}

function ReferralRow({ referral }: { referral: Referral }) {
  const l = lang.value;
  const detail = referral.status === "notEligible" && referral.notEligibleReason
    ? notEligibleTitle(referral.notEligibleReason)
    : referral.installedAt
      ? t("Ugrađeno: %@", fullDate(referral.installedAt, l))
      : t("Kod upisan: %@", fullDate(referral.createdAt, l));
  const tone = referral.status === "installed" ? "ok" : referral.status === "notEligible" ? "offline" : "neutral";
  return (
    <li class="referral" data-testid="referral-row">
      <span class="avatar avatar--sm" aria-hidden="true">{referral.friendName.charAt(0).toUpperCase()}</span>
      <span class="referral__text">
        <span class="referral__name">{referral.friendName}</span>
        <span class="referral__detail">{detail}</span>
      </span>
      <span class="referral__trail">
        <Badge tone={tone} icon={referral.status === "installed" ? "checkCircle" : referral.status === "notEligible" ? "xCircle" : "send"}>
          {referralStatusTitle(referral.status)}
        </Badge>
        {referral.monthsAwarded > 0 ? <span class="referral__months num">{tp("+%lld meseca", referral.monthsAwarded)}</span> : null}
      </span>
    </li>
  );
}

export default function PozoviKomsiju(_props: { params: Record<string, string>; mode: Mode }) {
  const referral = useReferral(true);
  const l = lang.value;
  if (referral.data === undefined && !referral.error) return <PageSkeleton />;

  let body;
  if (!referral.data) {
    body = (
      <Card>
        <ErrorState message={referral.error ? errorMessage(referral.error) : t("Preporuke trenutno nisu dostupne")}
          onRetry={referral.reload} />
      </Card>
    );
  } else {
    const data = referral.data;
    const link = data.link || `${REFERRAL.baseURL}?kod=${encodeURIComponent(data.code)}`;
    const share = async () => {
      const text = linkMessage(data.code);
      if (typeof navigator.share === "function") {
        try {
          await navigator.share({ title: "Evolako", text, url: link });
          return;
        } catch (e) {
          if ((e as DOMException)?.name === "AbortError") return;
        }
      }
      if (await copyText(`${text} ${link}`)) toast(t("Kopirano"));
    };
    body = (
      <div class="two-col">
        <div class="stack">
          <section class="card card--block invite" aria-labelledby="invite-title" data-testid="referral-code-card">
            <p class="kicker">{t("Pozovi komšiju")}</p>
            <h2 class="invite__title" id="invite-title">{t("Preporuči Evolako komšiji ili prijatelju")}</h2>
            <p class="card__sub">{t("Kad mu ugradimo komplet, besplatne mesece pretplate dobijate oboje.")}</p>
            <div class="invite__code">
              <span class="invite__code-label">{t("Tvoj kod")}</span>
              <span class="invite__code-value num" data-testid="referral-code">{data.code}</span>
              <Button variant="secondary" size="sm" icon="copy" testId="referral-copy"
                onClick={async () => {
                  if (await copyText(data.code)) toast(t("Kopirano"));
                }}>
                {t("Kopiraj")}
              </Button>
            </div>
            <Button block icon="share" onClick={() => void share()} testId="referral-share">{t("Podeli link")}</Button>
          </section>
          <div class="tiles">
            <div class="tile tile--flat reward">
              <p class="reward__title">{t("Prijatelj dobija")}</p>
              <p class="reward__value">{tp("+%lld meseca pretplate besplatno", REFERRAL.friendBonusMonths)}</p>
              <p class="reward__caption">
                {tp("Preko probnog perioda — ukupno %lld besplatnih meseci", REFERRAL.friendBonusMonths + PRICING.trialMonths)}
              </p>
            </div>
            <div class="tile tile--flat reward">
              <p class="reward__title">{t("Ti dobijaš")}</p>
              <p class="reward__value">{tp("%lld meseca za svakog prijatelja", REFERRAL.referrerMonthsPerFriend)}</p>
              <p class="reward__caption">{t("Bez ograničenja: meseci se sabiraju i pokrivaju tvoje sledeće plaćene mesece.")}</p>
            </div>
          </div>
          <Card as="section" aria-labelledby="how-title">
            <h2 class="card__title" id="how-title">{t("Kako funkcioniše")}</h2>
            <ol class="how">
              {STEPS.map((step, i) => (
                <li key={step}><span class="how__n num" aria-hidden="true">{i + 1}</span><span>{t(step)}</span></li>
              ))}
            </ol>
          </Card>
        </div>
        <div class="stack">
          <Card as="section" aria-labelledby="refs-title" data-testid="referrals">
            <div class="card__head">
              <h2 class="card__title" id="refs-title">{t("Tvoje preporuke")}</h2>
            </div>
            {data.freeMonthsBalance > 0 ? (
              <p class="side-card__gift referrals__balance">
                <Icon name="gift" />
                <span>
                  {tp("+%lld besplatna meseca od preporuka", data.freeMonthsBalance)}
                  {data.appliesFrom ? (
                    <span class="card__sub"> · {t("Primenjuju se od: %@", monthAndYear(data.appliesFrom.year, data.appliesFrom.month, l))}</span>
                  ) : null}
                </span>
              </p>
            ) : null}
            {data.referrals.length === 0 ? (
              <EmptyState icon="users" title={t("Tvoje preporuke")}
                message={t("Još nema preporuka. Kad prijatelj upiše tvoj kod, videćeš ga ovde.")} />
            ) : (
              <ul class="referrals">
                {data.referrals.map((r) => <ReferralRow key={r.id} referral={r} />)}
              </ul>
            )}
          </Card>
          <Card as="section" aria-labelledby="rules-title">
            <h2 class="card__title" id="rules-title">{t("Uslovi")}</h2>
            <ul class="rules">
              {RULES.map((rule) => <li key={rule}>{t(rule)}</li>)}
            </ul>
          </Card>
        </div>
      </div>
    );
  }
  return (
    <Page title={t("Pozovi komšiju")} back="/profil" backLabel={t("Profil")} testId="pozovi-komsiju">
      {body}
    </Page>
  );
}

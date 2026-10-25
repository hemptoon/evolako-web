// /paketi/:id — one kit: for whom, what you get, the questions people ask about it, and the way to an assessment.
import { siteText, t } from "../../i18n";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Card, EmptyState } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { FxNote } from "../../ui/money";
import { Render } from "../../ui/Render";
import { CATALOG, findPackage, packageFaq } from "./content";
import { Price, VariantLines } from "./Paketi";

export default function Paket({ params }: { params: Record<string, string>; mode: Mode }) {
  const pkg = findPackage(params.id);
  if (!pkg) {
    return (
      <Page title={t("Paketi")} back="/paketi" backLabel={t("Paketi")}>
        <Card><EmptyState icon="box" title={t("Ova stranica ne postoji.")}
          action={<Button variant="secondary" href="/paketi">{t("Paketi")}</Button>} /></Card>
      </Page>
    );
  }
  const photo = pkg.photos[0];
  const questions = packageFaq(pkg);
  return (
    <Page title={siteText(pkg.name)} subtitle={siteText(pkg.tagline)} back="/paketi" backLabel={t("Paketi")} testId={`paket-${pkg.id}`}>
      <div class="two-col">
        <div class="stack">
          {photo ? (
            <div class="paket__photo" aria-hidden="true">
              <Render name={photo} sizes="(min-width: 1024px) 45vw, 100vw" alt="" eager />
            </div>
          ) : null}
          <section class="card card--block" aria-labelledby="price-title">
            <h2 class="sr-only" id="price-title">{t("Cena")}</h2>
            <Price pkg={pkg} large />
            <VariantLines lines={pkg.variantLines} />
            <Button href={`/zatrazi-procenu?paket=${pkg.id}`} block icon="calendarPlus" testId="paket-request">
              {t("Zatraži procenu")}
            </Button>
            <p class="note paket__standard"><Icon name="ruler" /><span>{siteText(CATALOG.standardInstallation)}</span></p>
          </section>
          <Card as="section" aria-labelledby="for-title">
            <h2 class="card__title" id="for-title">{t("Za koga")}</h2>
            <p class="card__sub">{siteText(pkg.forWhom)}</p>
            {pkg.note ? <p class="note"><Icon name="info" /><span>{siteText(pkg.note)}</span></p> : null}
          </Card>
        </div>
        <div class="stack">
          <Card as="section" aria-labelledby="get-title">
            <h2 class="card__title" id="get-title">{t("Šta dobijaš")}</h2>
            <ul class="package__features package__features--full">
              {pkg.features.map((f) => <li key={f.sr}><Icon name="check" /><span>{siteText(f)}</span></li>)}
            </ul>
          </Card>
          {questions.length > 0 ? (
            <section aria-labelledby="asked-title" class="stack">
              <h2 class="section-title" id="asked-title">{t("Često pitano")}</h2>
              <div class="card card--flush faq__list">
                {questions.map((q) => (
                  <details key={q.question.sr} class="faq__item">
                    <summary class="faq__q"><span>{siteText(q.question)}</span><Icon name="chevronDown" class="faq__chevron" /></summary>
                    <p class="faq__a">{siteText(q.answer)}</p>
                  </details>
                ))}
              </div>
            </section>
          ) : null}
        </div>
      </div>
      <FxNote />
    </Page>
  );
}

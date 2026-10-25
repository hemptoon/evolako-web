// /paketi — the kits exactly as on evolako.rs (bundled snapshot): three main ones with their price variants and
// "Još opcija" (07.10.2026), what the basic installation covers, the subscription and the way to an assessment.
import { siteText, t } from "../../i18n";
import { fullDate } from "../../lib/format";
import { fromBelgrade } from "../../lib/belgrade";
import { lang } from "../../i18n";
import { currency, fx } from "../../app/currency";
import { foreignAmount, rsd } from "../../lib/format";
import { LINKS, siteUrl } from "../../app/contacts";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Card } from "../../ui/display";
import { Icon } from "../../ui/Icon";
import { convertedHint, FxNote } from "../../ui/money";
import { Render } from "../../ui/Render";
import { CATALOG, type ExtraOption, type Package, type SiteText } from "./content";

/**
 * A kit's price exactly as on the site, in dinars first (kind A); with EUR or USD chosen the conversion follows,
 * muted: "39.000 RSD sa PDV · ≈ 332 €", "od 94.000 RSD sa PDV · od ≈ 800 €".
 */
export function Price({ pkg, large }: { pkg: Package | ExtraOption; large?: boolean }) {
  const c = currency.value;
  const from = pkg.priceFrom ? siteText(pkg.priceText).replace(/[\d.,]+/g, "").trim() : "";
  const converted = c === "RSD" ? null : `${from ? `${from} ` : ""}${foreignAmount(pkg.priceRSD, c, fx.value)}`;
  return (
    <p class={large ? "price price--large" : "price"} title={converted ? convertedHint(rsd(pkg.priceRSD)) : undefined}>
      <span class="price__value num">{siteText(pkg.priceText)}</span>
      <span class="price__unit">{siteText(pkg.priceUnit)}</span>
      {converted ? <span class="price__alt num" data-testid={`price-${pkg.id}-converted`}>{converted}</span> : null}
    </p>
  );
}

/** Price variants as the site writes them: "94.000 — punjač i osnovna ugradnja…", "104.000 — isto, plus MID…". */
export function VariantLines({ lines }: { lines: SiteText[] }) {
  if (lines.length === 0) return null;
  return (
    <ul class="package__variants">
      {lines.map((v) => <li key={v.sr}><Icon name="tag" /><span>{siteText(v)}</span></li>)}
    </ul>
  );
}

/** "Još opcija": compact, no photo and no page of its own — price, variants and the assessment button. */
function OptionCard({ opt }: { opt: ExtraOption }) {
  return (
    <article class="card card--block package package--option" data-testid={`package-${opt.id}`} aria-labelledby={`pkg-${opt.id}`}>
      <h3 class="package__name package__name--option" id={`pkg-${opt.id}`}>{siteText(opt.name)}</h3>
      <Price pkg={opt} />
      <p class="package__tagline package__tagline--strong">{siteText(opt.tagline)}</p>
      {opt.text ? <p class="package__tagline">{siteText(opt.text)}</p> : null}
      <VariantLines lines={opt.variantLines} />
      {opt.note ? <p class="note package__note"><Icon name="info" /><span>{siteText(opt.note)}</span></p> : null}
      <div class="package__actions">
        <Button href={`/zatrazi-procenu?paket=${opt.id}`} variant="secondary" block testId={`package-${opt.id}-request`}>
          {t("Zatraži procenu")}
        </Button>
      </div>
    </article>
  );
}

function PackageCard({ pkg }: { pkg: Package }) {
  return (
    <article class={`card card--block package${pkg.badge ? " package--featured" : ""}`} data-testid={`package-${pkg.id}`}
      aria-labelledby={`pkg-${pkg.id}`}>
      <div class="package__head">
        <h2 class="package__name" id={`pkg-${pkg.id}`}>{siteText(pkg.name)}</h2>
        {pkg.badge ? <span class="badge badge--online package__badge"><Icon name="sparkles" />{siteText(pkg.badge)}</span> : null}
      </div>
      <p class="package__tagline">{siteText(pkg.tagline)}</p>
      <Price pkg={pkg} />
      <VariantLines lines={pkg.variantLines} />
      <ul class="package__features">
        {pkg.features.map((f) => (
          <li key={f.sr}><Icon name="check" /><span>{siteText(f)}</span></li>
        ))}
      </ul>
      <div class="package__actions">
        <Button href={`/zatrazi-procenu?paket=${pkg.id}`} variant={pkg.badge ? "primary" : "secondary"} block
          testId={`package-${pkg.id}-request`}>{t("Zatraži procenu")}</Button>
        <a class="link-btn package__more" href={`/paketi/${pkg.id}`}>{t("Šta dobijaš")} · {t("Za koga")}<Icon name="chevronRight" /></a>
      </div>
    </article>
  );
}

export default function Paketi({ mode }: { params: Record<string, string>; mode: Mode }) {
  const l = lang.value;
  const [y, m, d] = CATALOG.retrieved.split("-").map(Number);
  return (
    <Page title={t("Paketi")} subtitle={siteText(CATALOG.intro.text)} back={mode === "customer" ? "/profil" : undefined}
      backLabel={t("Profil")} testId="paketi" wide>
      <div class="stack stack--lg">
        <div class="paketi__hero" aria-hidden="true">
          <Render name="paketi-hero" sizes="(min-width: 1024px) 70vw, 100vw" alt="" />
        </div>
        <div class="packages">
          {CATALOG.packages.map((p) => <PackageCard key={p.id} pkg={p} />)}
        </div>
        <section class="stack" aria-labelledby="options-title" data-testid="package-options">
          <div>
            <p class="kicker">{siteText(CATALOG.options.kicker)}</p>
            <h2 class="section-title" id="options-title">{siteText(CATALOG.options.title)}</h2>
          </div>
          <div class="packages packages--options">
            {CATALOG.options.items.map((o) => <OptionCard key={o.id} opt={o} />)}
          </div>
        </section>
        <p class="note paketi__standard" data-testid="standard-installation">
          <Icon name="ruler" /><span>{siteText(CATALOG.standardInstallation)}</span>
        </p>
        <div class="two-col">
          <Card as="section" aria-labelledby="sub-title">
            <p class="kicker">{siteText(CATALOG.subscription.kicker)}</p>
            <h2 class="card__title" id="sub-title">{siteText(CATALOG.subscription.title)}</h2>
            <p class="card__sub">{siteText(CATALOG.subscription.text)}</p>
            <ul class="cover__list cover__list--compact">
              {CATALOG.subscription.items.map((item) => (
                <li key={item.title.sr} class="cover__item">
                  <Icon name="check" />
                  <span><strong>{siteText(item.title)}</strong></span>
                </li>
              ))}
            </ul>
          </Card>
          <Card as="section" aria-labelledby="assess-title">
            <p class="kicker">{siteText(CATALOG.assessment.kicker)}</p>
            <h2 class="card__title" id="assess-title">{siteText(CATALOG.assessment.title)}</h2>
            <p class="card__sub">{siteText(CATALOG.assessment.text)}</p>
            <Button href="/zatrazi-procenu" icon="calendarPlus" class="paketi__cta" testId="paketi-request">{t("Zatraži procenu")}</Button>
          </Card>
        </div>
        <p class="note paketi__source">
          <Icon name="globe" />
          <span>
            {t("Stanje sa sajta od %@", fullDate(fromBelgrade(y!, m!, d!, 12), l))} ·{" "}
            <a href={siteUrl(LINKS.paketi, l)} target="_blank" rel="noopener noreferrer">{t("Sve na sajtu")}</a>
          </span>
        </p>
        <FxNote />
      </div>
    </Page>
  );
}

// /profil/o-aplikaciji — version, the privacy policy, and the licences of what ships with the web app.
import { LINKS, mailto, siteUrl } from "../../app/contacts";
import { lang, t } from "../../i18n";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Brand } from "../../ui/brand";
import { Card, Row } from "../../ui/display";

const LICENSES = [
  { name: "Onest", detail: "SIL Open Font License 1.1", href: "/licenses/OFL.txt" },
  { name: "QR Code generator library (Nayuki)", detail: "MIT", href: "/licenses/qrcodegen.txt" },
  { name: "Lucide", detail: "ISC", href: "/licenses/lucide.txt" },
  { name: "Preact, @preact/signals", detail: "MIT", href: "/licenses/preact.txt" },
];

export default function OAplikaciji(_props: { params: Record<string, string>; mode: Mode }) {
  return (
    <Page title={t("O aplikaciji")} back="/profil" backLabel={t("Profil")} testId="o-aplikaciji">
      <div class="two-col">
        <section class="card card--block about" aria-label="Moj Evolako">
          <Brand size={30} />
          <p class="about__product">{t("Moj Evolako")}</p>
          <p class="card__sub num" data-testid="app-version">{t("Verzija")} {__APP_VERSION__} · {__BUILD_DATE__}</p>
          <p class="about__slogan">{t("Puni auto tamo gde parkiraš. Dok spavaš.")}</p>
          <p class="card__sub">{t("Struju ne prodajemo — merimo je.")}</p>
        </section>
        <div class="stack">
          <Card class="list-card">
            <div class="rows">
              <Row icon="shield" href={siteUrl(LINKS.privacy, lang.value)} external title={t("Politika privatnosti")} />
              <Row icon="globe" href={siteUrl(LINKS.site, lang.value)} external title="evolako.rs" />
              <Row icon="mail" href={mailto("Moj Evolako")} title={t("Piši nam")} subtitle="hello@evolako.com" />
            </div>
          </Card>
          <Card class="list-card" as="section" aria-labelledby="licenses-title">
            <h2 class="list-card__title" id="licenses-title">{t("Licence")}</h2>
            <div class="rows" data-testid="licenses">
              {LICENSES.map((l) => (
                <Row key={l.href} icon="book" href={l.href} external title={l.name} subtitle={l.detail} />
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Page>
  );
}

// /profil/nalog — the account and this browser's settings: e-mail, language, theme, the two consents
// (e-mail tips off by default; anonymous usage statistics), sign out and account deletion.
import { useState } from "preact/hooks";
import type { User } from "../../api/types";
import { backendOrThrow, useUser } from "../../app/data";
import { isDemo, session, signOut } from "../../app/session";
import { currency, setCurrency } from "../../app/currency";
import { accountPref, setAccountPref, setTheme, theme, type Theme } from "../../app/settings";
import { errorMessage } from "../../app/texts";
import { HTML_LANG, lang, LANG_NAMES, LANG_SCRIPTS, LANGS, setLang, t, type Lang } from "../../i18n";
import { CURRENCIES, type Currency } from "../../lib/format";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button, Segmented, Switch } from "../../ui/controls";
import { Card, toast } from "../../ui/display";
import { FxNote } from "../../ui/money";
import { PageSkeleton } from "../common";
import { themeTitle } from "../public";
import { DeleteAccount } from "./DeleteAccount";
import { initials } from "./Profil";

/** "RSD — dinar": the code always visible, the name hidden on narrow screens (still read by screen readers). */
function currencyLabel(c: Currency) {
  const full = c === "RSD" ? t("RSD — dinar") : c === "EUR" ? t("EUR — evro") : t("USD — dolar");
  const name = full.slice(full.indexOf(c) + c.length);
  return <><span class="seg__code">{c}</span><span class="seg__name">{name}</span></>;
}

function email(user: User): string {
  const s = session.value;
  return s.kind === "in" ? s.email || user.email || "" : user.email ?? "";
}

/**
 * The two consents. The API can set them but cannot read them back yet, so the switches show the last choice made
 * in this browser (forgotten at sign-out) — and say so, instead of pretending to show the account's state.
 */
function Consents({ user }: { user: User }) {
  const account = user.id;
  const note = t("Poslednji izbor sa ovog uređaja");
  const [marketing, setMarketing] = useState(() => accountPref(account, "marketing"));
  // Analytics: on unless the person opted out here (the app's default).
  const [analytics, setAnalytics] = useState(() => !accountPref(account, "analyticsOptOut"));

  const toggleMarketing = async (granted: boolean) => {
    setMarketing(granted);
    try {
      await backendOrThrow().setMarketingConsent(granted);
      setAccountPref(account, "marketing", granted);
      toast(t("Sačuvano"));
    } catch (e) {
      setMarketing(!granted);
      toast(errorMessage(e), "circleAlert");
    }
  };

  const toggleAnalytics = async (on: boolean) => {
    setAnalytics(on);
    try {
      await backendOrThrow().setAnalyticsOptOut(!on);
      setAccountPref(account, "analyticsOptOut", !on);
      toast(t("Sačuvano"));
    } catch (e) {
      setAnalytics(!on);
      toast(errorMessage(e), "circleAlert");
    }
  };

  return (
    <Card as="section" aria-labelledby="privacy-title" class="settings-card">
      <h2 class="card__title" id="privacy-title">{t("Privatnost")}</h2>
      <Switch label={t("Saveti o punjenju e-poštom")} hint={t("Retko, bez reklama drugih firmi. Odjava je u svakom pismu.")}
        note={note} checked={marketing} onChange={(v) => void toggleMarketing(v)} testId="consent-marketing" />
      <div class="settings-card__sep" />
      <Switch label={t("Anonimna statistika korišćenja")}
        hint={t("Koje ekrane i dugmad koristiš — bez imena, kontakta i lokacije. Pomaže nam da vidimo šta radi, a šta ne.")}
        note={note} checked={analytics} onChange={(v) => void toggleAnalytics(v)} testId="consent-analytics" />
    </Card>
  );
}

export default function Nalog(_props: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  if (!user.data) return <PageSkeleton />;
  const mail = email(user.data);
  return (
    <Page title={t("Nalog i podešavanja")} back="/profil" backLabel={t("Profil")} testId="nalog">
      <div class="two-col">
        <div class="stack">
          <Card as="section" aria-labelledby="account-title" class="settings-card">
            <h2 class="sr-only" id="account-title">{t("Nalog")}</h2>
            <div class="account-line">
              <span class="avatar avatar--lg" aria-hidden="true">{initials(user.data.name, mail)}</span>
              <div class="account-line__text">
                <p class="account-card__name">{user.data.name || t("Nalog")}</p>
                <p class="card__sub">{t("E-pošta naloga")}</p>
                <p class="account-line__mail" data-testid="account-email">{mail}</p>
              </div>
            </div>
          </Card>
          <Card as="section" aria-labelledby="look-title" class="settings-card">
            <h2 class="card__title" id="look-title">{t("Jezik i izgled")}</h2>
            <div class="setting">
              <span class="setting__label" id="lang-label">{t("Jezik")}</span>
              <Segmented<Lang> label={t("Jezik")} value={lang.value} onChange={setLang} testId="settings-lang" class="seg--lang"
                options={LANGS.map((l) => ({
                  value: l,
                  label: (
                    <span lang={HTML_LANG[l]}>
                      {LANG_NAMES[l]}
                      {LANG_SCRIPTS[l] ? <>{" "}<span class="seg__note">({LANG_SCRIPTS[l]})</span></> : null}
                    </span>
                  ),
                }))} />
            </div>
            <div class="setting">
              <span class="setting__label">{t("Valuta")}</span>
              <Segmented<Currency> label={t("Valuta")} value={currency.value} onChange={setCurrency} testId="settings-currency"
                class="seg--currency" options={CURRENCIES.map((c) => ({ value: c, label: currencyLabel(c) }))} />
              <FxNote always />
            </div>
            <div class="setting">
              <span class="setting__label">{t("Tema")}</span>
              <Segmented<Theme> label={t("Tema")} value={theme.value} onChange={setTheme} testId="settings-theme"
                options={(["light", "dark", "system"] as Theme[]).map((v) => ({ value: v, label: themeTitle(v) }))} />
            </div>
          </Card>
        </div>
        <div class="stack">
          <Consents user={user.data} />
          <Card as="section" aria-labelledby="session-title" class="settings-card">
            <h2 class="card__title" id="session-title">{t("Nalog")}</h2>
            <Button variant="secondary" icon="logout" block onClick={() => void signOut()} testId="settings-sign-out">
              {isDemo.value ? t("Izađi iz demoa") : t("Odjavi se")}
            </Button>
            <DeleteAccount />
          </Card>
        </div>
      </div>
    </Page>
  );
}

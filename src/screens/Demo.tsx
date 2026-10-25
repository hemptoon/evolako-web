// /demo — three demo accounts on the same screens as a real account. Nothing leaves the browser.
import { useEffect, useState } from "preact/hooks";
import type { DemoAccount } from "../api/demo/data";
import { navigate } from "../app/router";
import { session, startDemo } from "../app/session";
import { lang, msg, t } from "../i18n";
import type { Mode } from "../shell/Shell";
import { Brand, Loader } from "../ui/brand";
import { toast } from "../ui/display";
import { Icon, type IconName } from "../ui/Icon";
import { PublicControls } from "./public";

const ACCOUNTS: Array<{ account: DemoAccount; icon: IconName; title: string; text: string; tags: string[] }> = [
  {
    account: "wallbox",
    icon: "charger",
    title: msg("Wallbox u garaži zgrade"),
    text: msg("Noćni autostart, statistika po danima i obračun sa dva IPS QR koda — struja za zgradu, pretplata za Evolako."),
    tags: [msg("Wallbox 11 kW"), msg("Na brojilu zgrade")],
  },
  {
    account: "socket",
    icon: "plug",
    title: msg("Utičnica, sopstveno brojilo"),
    text: msg("Samo merenje i obračuni, bez upravljanja. Struja ide preko tvog brojila."),
    tags: [msg("Utičnica + merenje"), msg("Probni period")],
  },
  {
    account: "lead",
    icon: "calendarClock",
    title: msg("Prijava u toku"),
    text: msg("Zahtev je poslat i procena je zakazana: tok prijave, paketi i kontakt."),
    tags: [msg("Procena zakazana")],
  },
];

export default function Demo(_props: { params: Record<string, string>; mode: Mode }) {
  useEffect(() => {
    document.title = `${t("Izaberi demo nalog")} · Moj Evolako`;
  }, [lang.value]);
  const current = session.value.kind === "demo" ? session.value.account : null;
  const [busy, setBusy] = useState<DemoAccount | null>(null);
  const choose = async (account: DemoAccount) => {
    if (busy) return;
    setBusy(account);
    try {
      await startDemo(account);
      navigate(account === "lead" ? "/moja-prijava" : "/danas", { replace: true });
    } catch {
      toast(t("Nema veze sa serverom. Proveri internet i pokušaj ponovo."), "wifiOff");
    } finally {
      setBusy(null);
    }
  };
  return (
    <div class="public demo-chooser" data-testid="demo-chooser">
      <div class="public__bar">
        <a href="/prijava" class="brand" aria-label="Evolako"><Brand size={24} /></a>
        <PublicControls />
      </div>
      <main class="demo-chooser__main" id="main">
        <p class="kicker">{t("Demo")}</p>
        <h1 class="demo-chooser__title" id="page-title" tabIndex={-1}>{t("Izaberi demo nalog")}</h1>
        <p class="demo-chooser__lead">
          {t("Primeri podataka iz Novog Sada i Beograda. Ništa se ne šalje i ništa se ne plaća.")}
        </p>
        <ul class="demo-chooser__list">
          {ACCOUNTS.map((a) => (
            <li key={a.account}>
              <button type="button" class="demo-card" onClick={() => void choose(a.account)}
                aria-current={current === a.account ? "true" : undefined} aria-busy={busy === a.account ? "true" : undefined}
                data-testid={`demo-${a.account}`}>
                <span class="demo-card__icon"><Icon name={a.icon} /></span>
                <span class="demo-card__text">
                  <span class="demo-card__title">{t(a.title)}</span>
                  <span class="demo-card__sub">{t(a.text)}</span>
                  <span class="demo-card__tags">
                    {a.tags.map((tag) => <span key={tag} class="demo-card__tag">{t(tag)}</span>)}
                  </span>
                </span>
                {busy === a.account ? <Loader size="inline" /> : <Icon name="chevronRight" class="demo-card__chevron" />}
              </button>
            </li>
          ))}
        </ul>
        <a class="link-btn demo-chooser__back" href="/prijava">
          <Icon name="chevronLeft" />
          {t("Nazad na prijavu")}
        </a>
      </main>
    </div>
  );
}

// /obrisi-nalog — deleting the account without the app: the web address Google Play asks for ("Delete account URL").
// A public page, the same for anyone and without the account's navigation: what is deleted, what stays and for how
// long, and the ways to do it. The deletion itself needs the person: sign in the usual way (and come back here),
// "Obriši nalog", confirm — the same call as in the apps (POST /functions/v1/account-delete), sent once.
// What the server deletes and keeps is the backend's account-delete function and delete_account_data(); the texts
// here say exactly that — change them only together with the server.
import type { ComponentChildren } from "preact";
import { LINKS, mailto, siteUrl, SUPPORT_EMAIL } from "../app/contacts";
import { deletionSignInLink, deletionView, DELETE_ACCOUNT_PATH } from "../app/deletion";
import { googleAvailable } from "../app/google";
import { navigate } from "../app/router";
import { exitDemo, session, sessionNotice, signInAvailable } from "../app/session";
import { lang, t } from "../i18n";
import { Button } from "../ui/controls";
import { Banner } from "../ui/display";
import { Icon, type IconName } from "../ui/Icon";
import { AccountButton, SiteButton, useOutcomeFocus, useTitle, WriteButton } from "./pismo/common";
import { DeleteAccount } from "./profil/DeleteAccount";
import { PublicActions, PublicPage, PublicState } from "./public";

/** The account's e-mail: the person sees which account goes. A long address breaks at the "@". */
function Address({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  return (
    <p class="public-state__address" data-testid="deletion-email">
      <Icon name="mail" />
      <span>
        <span class="sr-only">{t("E-pošta naloga")}: </span>
        {at > 0 ? <>{email.slice(0, at)}<wbr />{email.slice(at)}</> : email}
      </span>
    </p>
  );
}

function Section({ icon, title, children }: { icon: IconName; title: string; children: ComponentChildren }) {
  return (
    <section class="deletion__section">
      <h2 class="deletion__heading"><Icon name={icon} />{title}</h2>
      {children}
    </section>
  );
}

/** A sentence that ends with our address: the address is the link. */
function WriteLine({ text, subject }: { text: string; subject: string }) {
  const at = text.indexOf(SUPPORT_EMAIL);
  if (at < 0) return <p class="deletion__note">{text}</p>;
  return (
    <p class="deletion__note" data-testid="deletion-write">
      {text.slice(0, at)}
      <a href={mailto(subject)}>{SUPPORT_EMAIL}</a>
      {text.slice(at + SUPPORT_EMAIL.length)}
    </p>
  );
}

/** What is deleted, what stays, what else to know and the three ways — the same whatever the session. */
function Details({ title }: { title: string }) {
  const inApp = [t("Podešavanja"), t("Nalog"), t("Obriši nalog")].join(" → ");
  const inWeb = [t("Profil"), t("Nalog i podešavanja"), t("Obriši nalog")].join(" → ");
  return (
    <div class="card card--block deletion" data-testid="deletion-details">
      <Section icon="trash" title={t("Šta brišemo")}>
        <ul class="issue__list">
          <li>{t("Nalog i profil: e-poštu za prijavu, ime, telefon, podešavanja i saglasnosti.")}</li>
          <li>{t("Lične podatke u zahtevima za procenu: ime, kontakt, adresu, auto i komentar.")}</li>
          <li>{t("Fotografije koje si poslao — uz prijavu kvara i očitavanje brojila.")}</li>
          <li>{t("Obaveštenja u nalogu, prijavu na Evolako pismo i neiskorišćene besplatne mesece od preporuka.")}</li>
        </ul>
      </Section>
      <Section icon="shield" title={t("Šta ostaje")}>
        <ul class="issue__list">
          <li>{t("Obračuni i podaci o plaćanjima — samo sa imenom platioca. Čuvamo ih onoliko dugo koliko to propisuje Zakon o računovodstvu.")}</li>
          <li>{t("Podaci o samoj tački punjenja — adresa ugradnje, sesije punjenja, stanja brojila i istorija servisa — ostaju uz tačku, bez veze sa tvojim nalogom.")}</li>
        </ul>
      </Section>
      <Section icon="info" title={t("Pre nego što obrišeš")}>
        <ul class="issue__list">
          <li>{t("Brisanje je trajno — ne može da se poništi.")}</li>
          <li>{t("Ako tačku punjenja koristiš samo ti, pretplata za nju prestaje poslednjeg dana tekućeg meseca.")}</li>
        </ul>
      </Section>
      <Section icon="list" title={t("Kako da obrišeš nalog")}>
        <ul class="issue__list">
          <li>{t("Ovde: prijavi se, pritisni „%@“ i potvrdi.", t("Obriši nalog"))}</li>
          <li>{t("U aplikaciji Evolako: %@.", inApp)}</li>
          <li>{t("U Moj Evolako: %@.", inWeb)}</li>
        </ul>
        <WriteLine subject={title} text={t("Ne možeš da se prijaviš? Piši nam sa e-pošte naloga na hello@evolako.com.")} />
      </Section>
      <p class="deletion__policy">
        <a href={siteUrl(LINKS.privacy, lang.value)} target="_blank" rel="noopener noreferrer" data-testid="deletion-policy">
          {t("Politika privatnosti")}
        </a>
      </p>
    </div>
  );
}

export default function ObrisiNalog(_props: { params: Record<string, string> }) {
  const s = session.value;
  const view = deletionView({
    session: s.kind === "in" ? "in" : s.kind === "demo" ? "demo" : "out",
    signInAvailable: signInAvailable.value,
    deleted: sessionNotice.value === "deleted",
  });
  const { heading, arm } = useOutcomeFocus(view);
  const title = t("Brisanje naloga");
  useTitle(title);
  const lead = t("Evolako nalog možeš da obrišeš sam — ovde, bez aplikacije, ili u aplikaciji. Isti je u aplikaciji Evolako i u Moj Evolako.");

  let content;
  switch (view) {
    case "done":
      content = (
        <PublicState icon="checkCircle" title={t("Nalog je obrisan.")} state="done" headingRef={heading} testId="deletion"
          text={t("Ime, kontakt, zahtevi i fotografije su obrisani. Obračuni ostaju samo sa imenom platioca — čuvamo ih po zakonu.")}>
          <p class="public-state__text">{t("Potvrdu šaljemo na e-poštu naloga.")}</p>
          <PublicActions><SiteButton /></PublicActions>
        </PublicState>
      );
      break;
    case "ready":
      content = (
        <PublicState icon="userX" title={title} state="ready" headingRef={heading} testId="deletion" text={lead}>
          {s.kind === "in" && s.email ? (
            <>
              <p class="public-state__text">{t("Nalog koji brišeš:")}</p>
              <Address email={s.email} />
            </>
          ) : null}
          <PublicActions>
            <DeleteAccount stay onDeleted={arm} />
            <AccountButton />
          </PublicActions>
        </PublicState>
      );
      break;
    case "demo":
      content = (
        <PublicState icon="userX" title={title} state="demo" headingRef={heading} testId="deletion" text={lead}>
          <p class="public-state__text">
            {t("Sada gledaš demo — u njemu nema pravog naloga. Izađi iz demoa i prijavi se svojom e-poštom.")}
          </p>
          <PublicActions>
            <Button icon="logout" testId="deletion-exit-demo"
              onClick={() => {
                exitDemo();
                // exitDemo leads to the landing; this page is where the person was going.
                navigate(DELETE_ACCOUNT_PATH, { replace: true });
              }}>
              {t("Izađi iz demoa")}
            </Button>
          </PublicActions>
        </PublicState>
      );
      break;
    case "unavailable":
      content = (
        <PublicState icon="userX" title={title} state="unavailable" headingRef={heading} testId="deletion" text={lead}>
          <p class="public-state__text">{t("U demou ovo nije dostupno: Moj Evolako ovde radi bez servera i ništa ne šalje.")}</p>
          <PublicActions><WriteButton subject={title} /></PublicActions>
        </PublicState>
      );
      break;
    case "signedOut":
      content = (
        <PublicState icon="userX" title={title} state="signedOut" headingRef={heading} testId="deletion" text={lead}>
          {sessionNotice.value === "expired" ? (
            <Banner tone="info" icon="clock" title={t("Sesija je istekla. Prijavi se ponovo.")} testId="session-expired" live />
          ) : null}
          <p class="public-state__text" data-testid="deletion-sign-in-text">
            {/* The way /prijava offers: with the Google button there, Google too — with the account's own e-mail. */}
            {googleAvailable.value
              ? t("Prijavi se kodom na e-poštu naloga ili preko Google naloga sa tom e-poštom, pa potvrdi brisanje.")
              : t("Prijavi se kodom na e-poštu naloga, pa potvrdi brisanje.")}
          </p>
          <PublicActions>
            <Button href={deletionSignInLink()} icon="lock" testId="deletion-sign-in">{t("Prijavi se da obrišeš nalog")}</Button>
          </PublicActions>
        </PublicState>
      );
      break;
  }
  return (
    <PublicPage testId="obrisi-nalog">
      {content}
      {view === "done" ? null : <Details title={title} />}
    </PublicPage>
  );
}

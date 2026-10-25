// /profil/podrska — how to reach us: e-mail, and messages only (no calls) on WhatsApp, Viber and Telegram.
// viber:// fails silently where Viber is not installed (most desktops), so Viber opens a small sheet with the
// number, a copy button and the link.
import { useState } from "preact/hooks";
import { LINKS, mailto, MESSENGER_NUMBER, MESSENGER_NUMBER_RAW, SUPPORT_EMAIL } from "../../app/contacts";
import { t } from "../../i18n";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Card, copyText, CopyButton, toast } from "../../ui/display";
import { Icon, type IconName } from "../../ui/Icon";
import { Dialog } from "../../ui/overlay";

function MessengerRow({ name, icon, href, onClick, testId }: {
  name: string;
  icon: IconName;
  href?: string;
  onClick?: () => void;
  testId: string;
}) {
  const body = (
    <>
      <span class={`messenger__icon messenger__icon--${icon}`}><Icon name={icon} /></span>
      <span class="row__text">
        <span class="row__title">{name}</span>
        <span class="row__sub">{t("Samo poruke, bez poziva")}</span>
      </span>
      <span class="row__trail"><Icon name={href ? "external" : "chevronRight"} /></span>
    </>
  );
  return href ? (
    <a class="row messenger" href={href} target="_blank" rel="noopener noreferrer" data-testid={testId}>{body}</a>
  ) : (
    <button type="button" class="row messenger" onClick={onClick} aria-haspopup="dialog" data-testid={testId}>{body}</button>
  );
}

export default function Podrska(_props: { params: Record<string, string>; mode: Mode }) {
  const [viber, setViber] = useState(false);
  return (
    <Page title={t("Podrška")} subtitle={t("Javićemo se u roku od 48 h.")} back="/profil" backLabel={t("Profil")} testId="podrska">
      <div class="two-col">
        <section class="card card--block support-mail" aria-labelledby="mail-title">
          <span class="card__icon"><Icon name="mail" /></span>
          <h2 class="card__title" id="mail-title">{t("Piši nam")}</h2>
          <div class="copy-field support-mail__address">
            <a href={mailto("Moj Evolako")} class="support-mail__link" data-testid="support-email">{SUPPORT_EMAIL}</a>
            <CopyButton text={SUPPORT_EMAIL} what={t("E-pošta")} />
          </div>
          <Button href={mailto("Moj Evolako")} icon="send" testId="support-email-button">{t("Piši nam")}</Button>
        </section>
        <div class="stack">
          <Card as="section" aria-labelledby="messengers-title">
            <h2 class="card__title" id="messengers-title">{t("Samo poruke, bez poziva")}</h2>
            <p class="card__sub messengers__number num">{MESSENGER_NUMBER}</p>
            <div class="rows">
              <MessengerRow name="WhatsApp" icon="whatsapp" href={LINKS.whatsapp} testId="support-whatsapp" />
              <MessengerRow name="Viber" icon="viber" onClick={() => setViber(true)} testId="support-viber" />
              <MessengerRow name="Telegram" icon="telegram" href={LINKS.telegram} testId="support-telegram" />
            </div>
          </Card>
          <Card>
            <a class="row" href="/profil/pitanja">
              <span class="row__icon"><Icon name="help" /></span>
              <span class="row__text"><span class="row__title">{t("Česta pitanja")}</span></span>
              <span class="row__trail"><Icon name="chevronRight" /></span>
            </a>
          </Card>
        </div>
      </div>
      {viber ? (
        <Dialog title="Viber" onClose={() => setViber(false)} testId="viber-dialog"
          actions={
            <>
              <Button variant="secondary" icon="copy" onClick={async () => {
                if (await copyText(MESSENGER_NUMBER_RAW)) toast(t("Kopirano"));
              }}>{t("Kopiraj")}</Button>
              <Button href={LINKS.viber} icon="external" testId="viber-open">{t("Otvori Viber")}</Button>
            </>
          }>
          <p class="viber__number num">{MESSENGER_NUMBER}</p>
          <p>{t("Samo poruke, bez poziva")}</p>
        </Dialog>
      ) : null}
    </Page>
  );
}

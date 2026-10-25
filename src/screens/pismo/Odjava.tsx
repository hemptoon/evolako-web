// /odjava — unsubscribe from tips and news (Evolako pismo): the "Odjavi se" link in the footer of every marketing e-mail
// opens /odjava?e=…&t=…&l=…, and so does the old one-click link (the backend's GET now passes on here). Nothing is sent
// until the person presses "Odjavi me" — mail scanners open every link. Account and statement e-mails keep coming.
import { useRef, useState } from "preact/hooks";
import { unsubscribeByLink, type UnsubscribeResult } from "../../api/newsletter";
import {
  sending, UNSUBSCRIBE_KEY, UNSUBSCRIBE_PARAMS, unsubscribeAfter, unsubscribeLinkFrom, unsubscribeStart, writeTab,
  type Flow, type UnsubscribeView,
} from "../../app/pismo";
import { config, signInAvailable } from "../../app/session";
import { contentLang, lang, t } from "../../i18n";
import { Button } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { PublicActions, PublicPage, PublicState } from "../public";
import { ProblemLine, SiteButton, useEmailLink, useOutcomeFocus, useTitle, WriteButton } from "./common";

/** The address the link is about: people with several addresses see which one leaves. A long one breaks at the "@". */
function Address({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  return (
    <p class="public-state__address" data-testid="odjava-email">
      <Icon name="mail" />
      <span>
        <span class="sr-only">{t("E-pošta")}: </span>
        {at > 0 ? <>{email.slice(0, at)}<wbr />{email.slice(at)}</> : email}
      </span>
    </p>
  );
}

export default function Odjava(_props: { params: Record<string, string> }) {
  const link = useEmailLink(UNSUBSCRIBE_KEY, UNSUBSCRIBE_PARAMS, unsubscribeLinkFrom);
  const [flow, setFlow] = useState<Flow<UnsubscribeView>>(() => unsubscribeStart(link, signInAvailable.value));
  const inFlight = useRef(false);
  const { heading, arm } = useOutcomeFocus(flow.view);
  const title = t("Odjava sa Evolako pisma");
  useTitle(title);

  const unsubscribe = async () => {
    const next = sending(flow);
    if (!next || !link || inFlight.current) return;
    inFlight.current = true;
    setFlow(next);
    let result: UnsubscribeResult;
    try {
      result = await unsubscribeByLink(config.value, { e: link.e, t: link.t, l: contentLang(lang.value) }, (input, init) => fetch(input, init));
    } catch {
      result = "failed";
    }
    inFlight.current = false;
    const after = unsubscribeAfter(result);
    if (after.view !== "ready") {
      writeTab(UNSUBSCRIBE_KEY, { ...link, outcome: after.view });
      arm();
    }
    setFlow(after);
  };

  let content;
  switch (flow.view) {
    case "demo":
      content = (
        <PublicState icon="info" title={title} state="demo" headingRef={heading}
          text={t("U demou ovo nije dostupno: Moj Evolako ovde radi bez servera i ništa ne šalje.")}>
          <PublicActions><WriteButton subject={title} /></PublicActions>
        </PublicState>
      );
      break;
    case "ready":
      content = (
        <PublicState icon="mail" title={title} state="ready" headingRef={heading}
          text={t("Više ti nećemo slati savete i novosti. Obaveštenja o nalogu, zahtevima i obračunima stižu i dalje.")}>
          {link ? <Address email={link.e} /> : null}
          {flow.problem ? <ProblemLine problem={flow.problem} /> : null}
          <PublicActions>
            <Button loading={flow.busy} icon={flow.problem ? "refresh" : undefined} onClick={() => void unsubscribe()}
              testId="odjava-confirm">
              {flow.problem ? t("Pokušaj ponovo") : t("Odjavi me")}
            </Button>
          </PublicActions>
        </PublicState>
      );
      break;
    case "done":
      content = (
        <PublicState icon="checkCircle" title={t("Odjavljen si.")} state="done" headingRef={heading}
          text={t("Ako se predomisliš, prijavi se ponovo na evolako.rs.")}>
          {link ? <Address email={link.e} /> : null}
          <PublicActions><SiteButton /></PublicActions>
        </PublicState>
      );
      break;
    case "invalid":
      content = (
        <PublicState icon="link" title={t("Link nije ispravan.")} state="invalid" headingRef={heading}
          text={t("Piši nam na hello@evolako.com i odjavićemo te.")}>
          <PublicActions><WriteButton subject={title} primary /></PublicActions>
        </PublicState>
      );
      break;
  }
  return <PublicPage testId="odjava">{content}</PublicPage>;
}

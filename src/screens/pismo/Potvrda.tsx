// /pismo — confirm a website sign-up for Evolako pismo: the button of the confirmation e-mail opens /pismo?t=…&l=….
// No account needed. Nothing is sent until the person presses "Potvrdi prijavu" (mail scanners open links, some run
// their scripts). Then: confirmed, expired or invalid — kept for the tab, so a reload shows it again — or a problem with
// the button for another try (never retried by itself). In the demo (no API configured) nothing is sent at all.
import { useRef, useState } from "preact/hooks";
import { confirmSubscription, type ConfirmResult } from "../../api/newsletter";
import {
  CONFIRM_KEY, CONFIRM_PARAMS, confirmAfter, confirmLinkFrom, confirmStart, sending, writeTab, type ConfirmView, type Flow,
} from "../../app/pismo";
import { config, signInAvailable } from "../../app/session";
import { t } from "../../i18n";
import { Button } from "../../ui/controls";
import { PublicActions, PublicPage, PublicState } from "../public";
import {
  AccountButton, ProblemLine, SiteButton, useEmailLink, useOutcomeFocus, useTitle, WriteButton,
} from "./common";

export default function Potvrda(_props: { params: Record<string, string> }) {
  const link = useEmailLink(CONFIRM_KEY, CONFIRM_PARAMS, confirmLinkFrom);
  // The API is configured (both apiBase and the publishable key), as for sign-in; otherwise this is the demo.
  const [flow, setFlow] = useState<Flow<ConfirmView>>(() => confirmStart(link, signInAvailable.value));
  const inFlight = useRef(false);
  const { heading, arm } = useOutcomeFocus(flow.view);
  const title = t("Potvrdi prijavu na Evolako pismo");
  useTitle(title);

  const confirm = async () => {
    const next = sending(flow);
    if (!next || !link || inFlight.current) return;
    inFlight.current = true;
    setFlow(next);
    let result: ConfirmResult;
    try {
      result = await confirmSubscription(config.value, link.t, (input, init) => fetch(input, init));
    } catch {
      result = "failed";
    }
    inFlight.current = false;
    const after = confirmAfter(result);
    if (after.view !== "ready") {
      writeTab(CONFIRM_KEY, { ...link, outcome: after.view });
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
          <PublicActions><WriteButton subject={t("Evolako pismo")} /></PublicActions>
        </PublicState>
      );
      break;
    case "ready":
      content = (
        <PublicState icon="mail" title={title} state="ready" headingRef={heading}
          text={t("Evolako pismo stiže jednom mesečno: kako da puniš jeftinije kod kuće, šta traži skupština zgrade i šta je novo u Evolako. Odjava je u svakom pismu, jednim klikom.")}>
          {flow.problem ? <ProblemLine problem={flow.problem} /> : null}
          <PublicActions>
            <Button loading={flow.busy} icon={flow.problem ? "refresh" : undefined} onClick={() => void confirm()}
              testId="pismo-confirm">
              {flow.problem ? t("Pokušaj ponovo") : t("Potvrdi prijavu")}
            </Button>
          </PublicActions>
        </PublicState>
      );
      break;
    case "confirmed":
      content = (
        <PublicState icon="checkCircle" title={t("Hvala — prijava je potvrđena.")} state="confirmed" headingRef={heading}
          text={t("Evolako pismo stiže prve srede u mesecu.")}>
          <PublicActions>
            <SiteButton />
            <AccountButton />
          </PublicActions>
        </PublicState>
      );
      break;
    case "expired":
      content = (
        <PublicState icon="hourglass" title={t("Link je istekao.")} state="expired" headingRef={heading}
          text={t("Prijavi se ponovo na evolako.rs.")}>
          <PublicActions><SiteButton primary /></PublicActions>
        </PublicState>
      );
      break;
    case "invalid":
      content = (
        <PublicState icon="link" title={t("Link nije ispravan.")} state="invalid" headingRef={heading}
          text={t("Ako si prijavu već potvrdio, ovaj link više ne važi. Ako nisi, prijavi se ponovo na evolako.rs.")}>
          <PublicActions><SiteButton primary /></PublicActions>
        </PublicState>
      );
      break;
  }
  return <PublicPage testId="pismo">{content}</PublicPage>;
}

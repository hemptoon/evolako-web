// /zatrazi-procenu — the assessment request on its own page (from Paketi, with ?paket= preselected).
import { useState } from "preact/hooks";
import type { InstallationRequest } from "../../api/types";
import { useInstallationRequests, useUser } from "../../app/data";
import { prefillReferral } from "../../app/links";
import { location } from "../../app/router";
import { session } from "../../app/session";
import { errorMessage } from "../../app/texts";
import { siteText, t } from "../../i18n";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Banner, Card, ErrorState } from "../../ui/display";
import { PageSkeleton } from "../common";
import { CATALOG, findAnyPackage } from "./content";
import { RequestSent, RequestStatusCard } from "./MojaPrijava";
import { RequestForm } from "./RequestForm";

export default function ZatraziProcenu({ mode }: { params: Record<string, string>; mode: Mode }) {
  const user = useUser();
  const requests = useInstallationRequests(true);
  const [sent, setSent] = useState<InstallationRequest | null>(null);
  if (requests.data === undefined && !requests.error) return <PageSkeleton />;
  const back = mode === "lead" ? "/moja-prijava" : "/paketi";
  const open = requests.data?.find((r) => r.status !== "installed");

  let body;
  if (!requests.data) {
    body = <Card><ErrorState message={errorMessage(requests.error)} onRetry={requests.reload} /></Card>;
  } else if (sent) {
    body = (
      <div class="stack narrow">
        <RequestSent request={sent} />
        <RequestStatusCard request={sent} />
        {mode === "lead" ? <Button href="/moja-prijava" iconRight="arrowRight">{t("Moja prijava")}</Button> : null}
      </div>
    );
  } else if (open) {
    body = (
      <div class="stack narrow">
        <Banner tone="info" icon="info" title={t("Zahtev za procenu je već poslat.")} testId="request-exists" />
        <RequestStatusCard request={open} />
      </div>
    );
  } else {
    const s = session.value;
    const u = user.data;
    body = (
      <div class="two-col two-col--form">
        <RequestForm onSent={setSent} initial={{
          name: u?.name ?? "",
          email: (s.kind === "in" ? s.email : u?.email) ?? "",
          phone: u?.phone ?? "",
          // ?paket=start|wallbox|zgrada|plus|premium|ugradnja — like the site's form (evoformpack3)
          package: findAnyPackage(location.value.query.get("paket"))?.id ?? null,
          referralCode: prefillReferral(location.value.query),
        }} />
        <Card as="section" aria-labelledby="assessment-title">
          <p class="kicker">{siteText(CATALOG.assessment.kicker)}</p>
          <h2 class="card__title" id="assessment-title">{siteText(CATALOG.assessment.title)}</h2>
          <p class="card__sub">{siteText(CATALOG.assessment.text)}</p>
          <p class="note"><span>{siteText(CATALOG.assessment.note)}</span></p>
        </Card>
      </div>
    );
  }
  return (
    <Page title={t("Zatraži procenu")} back={back} backLabel={mode === "lead" ? t("Moja prijava") : t("Paketi")} testId="zatrazi-procenu">
      {body}
    </Page>
  );
}

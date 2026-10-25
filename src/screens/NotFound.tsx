// Any path the app does not know: inside the account (the shell) and on the public pages e-mails link to.
import { useEffect } from "preact/hooks";
import { lang, t } from "../i18n";
import { Page } from "../shell/Page";
import type { Mode } from "../shell/Shell";
import { Button } from "../ui/controls";
import { Card, EmptyState } from "../ui/display";
import { PublicActions, PublicPage, PublicState } from "./public";

export default function NotFound({ mode }: { params: Record<string, string>; mode: Mode }) {
  return (
    <Page title={t("Ova stranica ne postoji.")} testId="not-found">
      <Card>
        <EmptyState icon="search" title={t("Ova stranica ne postoji.")}
          action={<Button href={mode === "customer" ? "/danas" : "/moja-prijava"} icon="home">
            {mode === "customer" ? t("Danas") : t("Moja prijava")}
          </Button>} />
      </Card>
    </Page>
  );
}

/** The same words on a public page (an issue of Evolako pismo that does not exist): home is Moj Evolako. */
export function PublicNotFound() {
  useEffect(() => {
    document.title = `${t("Ova stranica ne postoji.")} · ${t("Moj Evolako")}`;
  }, [lang.value]);
  return (
    <PublicPage testId="not-found">
      <PublicState icon="search" title={t("Ova stranica ne postoji.")} state="not-found">
        <PublicActions>
          <Button href="/" icon="home" testId="not-found-home">{t("Moj Evolako")}</Button>
        </PublicActions>
      </PublicState>
    </PublicPage>
  );
}

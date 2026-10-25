// What /pismo and /odjava share: taking the link out of the address, the line that explains a problem, the focus that
// follows an outcome, and the ways out (evolako.rs, Moj Evolako, e-mail).
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { NewsletterProblem } from "../../api/newsletter";
import { LINKS, mailto, siteUrl } from "../../app/contacts";
import { hasLinkParams, linkLang, readTab, writeTab } from "../../app/pismo";
import { setQuery } from "../../app/router";
import { session } from "../../app/session";
import { lang, setLang, t } from "../../i18n";
import { Button } from "../../ui/controls";
import { Icon } from "../../ui/Icon";

/**
 * This tab's link, taken once: from the address (a new link) or from what the tab kept (a reload). It is kept in
 * sessionStorage and the address is cleaned as the page first renders — the token does not stay in the address bar
 * or the history entry. public/boot.js already applied ?l=; an installed app may still run an older cached boot.js,
 * so a ?l= left in the address is applied here.
 */
export function useEmailLink<T>(key: string, params: readonly string[],
  from: (search: string, stored: string | null) => T | null): T | null {
  const [link] = useState(() => {
    const value = from(window.location.search, readTab(key));
    if (value) writeTab(key, value);
    return value;
  });
  useLayoutEffect(() => {
    const search = window.location.search;
    const l = linkLang(search);
    if (l && l !== lang.value) void setLang(l);
    if (hasLinkParams(search, params)) setQuery(Object.fromEntries(params.map((name) => [name, null])), { replace: true });
  }, []);
  return link;
}

/**
 * The title takes the focus when the page reaches an outcome (the button that had it is gone): keyboard and screen
 * reader users land on what happened. Call `arm()` right before the state change.
 */
export function useOutcomeFocus(view: string) {
  const heading = useRef<HTMLHeadingElement>(null);
  const armed = useRef(false);
  useEffect(() => {
    if (!armed.current) return;
    armed.current = false;
    heading.current?.focus();
  }, [view]);
  return { heading, arm: () => (armed.current = true) };
}

/** The document title of a public page. */
export function useTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · ${t("Moj Evolako")}`;
  }, [title]);
}

/** Why the button is there again: too many attempts, no connection, or something unexpected. */
export function ProblemLine({ problem }: { problem: NewsletterProblem }) {
  const text = problem === "limited" ? t("Previše pokušaja. Pokušaj ponovo malo kasnije.")
    : problem === "offline" ? t("Nema veze sa serverom. Proveri internet i pokušaj ponovo.")
      : t("Nešto nije u redu. Pokušaj ponovo malo kasnije.");
  return (
    <div class="inline-error public-state__problem" role="alert" data-testid="problem" data-problem={problem}>
      <Icon name={problem === "offline" ? "wifiOff" : "circleAlert"} />
      <span>{text}</span>
    </div>
  );
}

/** evolako.rs in the page's language, in a new tab. */
export function SiteButton({ primary }: { primary?: boolean }) {
  return (
    <Button variant={primary ? "primary" : "secondary"} href={siteUrl(LINKS.site, lang.value)} external iconRight="external"
      testId="site-link">
      evolako.rs
    </Button>
  );
}

/** Moj Evolako: sign in when nobody is signed in in this browser, otherwise open it. */
export function AccountButton() {
  const out = session.value.kind === "out";
  return (
    <Button variant="secondary" href={out ? "/prijava" : "/"} testId="account-link">
      {out ? t("Prijavi se u Moj Evolako") : t("Otvori Moj Evolako")}
    </Button>
  );
}

/** hello@evolako.com with a subject that says what it is about. */
export function WriteButton({ subject, primary }: { subject: string; primary?: boolean }) {
  return (
    <Button variant={primary ? "primary" : "secondary"} href={mailto(subject)} icon="mail" testId="write-link">
      {t("Piši nam")}
    </Button>
  );
}

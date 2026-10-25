// /pismo/<slug> — the web version of an issue of Evolako pismo ("Otvori u pregledaču" in the e-mail links here with
// ?lang=). The issue is a static file of this site, /posta/<slug>.json (src/api/posta.ts), so the page works in any
// mode, also in the demo. It is drawn in the interface language (Cyrillic: the Serbian issue, transliterated) with the app's type: the cover (web only), the date,
// the subject as the title, the blocks of the e-mail, the signature. Links lead only to our sites; everything else is
// text. No such issue (no file, not an issue, a slug that cannot be one) → "not found".
import { Fragment } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  inlineTokens, ISSUE_SLUG, IssueNotFound, linkTarget, loadIssue, shownRows, type Issue, type IssueBlock, type IssueCover,
  type IssueStep,
} from "../../api/posta";
import { useResource } from "../../app/query";
import { errorMessage, isOfflineError } from "../../app/texts";
import { contentLang, inScript, lang, t } from "../../i18n";
import { fromBelgrade } from "../../lib/belgrade";
import { fullDate } from "../../lib/format";
import { LoadingScreen } from "../../ui/brand";
import { Button } from "../../ui/controls";
import { Icon } from "../../ui/Icon";
import { PublicNotFound } from "../NotFound";
import { PublicActions, PublicPage, PublicState } from "../public";

/** A text of the issue: plain words, **bold**, our links (Moj Evolako in this tab, the sites in a new one), our addresses. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {inlineTokens(text).map((token, i) => {
        const node = token.kind === "link" ? (
          token.target === "app"
            ? <a href={token.href}>{token.text}</a>
            : <a href={token.href} target="_blank" rel="noopener noreferrer">{token.text}</a>
        ) : token.kind === "mail" ? <a href={token.href}>{token.text}</a> : inScript(token.text);
        return token.bold ? <strong key={i}>{node}</strong> : <Fragment key={i}>{node}</Fragment>;
      })}
    </>
  );
}

/** A step (or a list item with a title): the title in bold, the text under it. */
function Step({ step }: { step: IssueStep }) {
  return (
    <span class="issue__step">
      <span class="issue__step-title"><Inline text={step.title} /></span>
      <span class="issue__step-text"><Inline text={step.text} /></span>
    </span>
  );
}

function Block({ block }: { block: IssueBlock }) {
  switch (block.type) {
    case "h2":
      return <h2 class="issue__h2"><Inline text={block.text} /></h2>;
    case "p":
      return <p class="issue__p"><Inline text={block.text} /></p>;
    case "note":
      return <p class="issue__note"><Icon name="info" /><span><Inline text={block.text} /></span></p>;
    case "list":
      return (
        <ul class="issue__list">
          {block.items.map((item, i) => (
            <li key={i}>{typeof item === "string" ? <Inline text={item} /> : <Step step={item} />}</li>
          ))}
        </ul>
      );
    case "steps":
      return (
        <ol class="issue__steps">
          {block.items.map((item, i) => (
            <li key={i}>
              <span class="how__n" aria-hidden="true">{i + 1}</span>
              <Step step={item} />
            </li>
          ))}
        </ol>
      );
    case "kv": {
      const rows = shownRows(block.rows);
      if (!rows.length) return null;
      return (
        <dl class="kv issue__kv">
          {rows.map(([label, value], i) => (
            <div key={i}>
              <dt><Inline text={label} /></dt>
              <dd><Inline text={value} /></dd>
            </div>
          ))}
        </dl>
      );
    }
    case "button": {
      // A button leads only where a link may lead; any other address leaves just its words.
      const target = linkTarget(block.href);
      if (!target) return <p class="issue__p">{inScript(block.text)}</p>;
      return (
        <p class="issue__button">
          {target === "app"
            ? <Button href={block.href}>{inScript(block.text)}</Button>
            : <Button href={block.href} external iconRight="external">{inScript(block.text)}</Button>}
        </p>
      );
    }
    case "divider":
      return <hr class="issue__divider" />;
  }
}

function Cover({ cover }: { cover: IssueCover }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <figure class="issue__cover">
      <img src={cover.src} alt={inScript(cover.alt[contentLang(lang.value)] ?? cover.alt.sr ?? "")} decoding="async" fetchpriority="high"
        onError={() => setFailed(true)} />
    </figure>
  );
}

function IssueView({ issue }: { issue: Issue }) {
  const l = lang.value;
  const part = issue[contentLang(l)];
  const subject = inScript(part.subject, l);
  const [y, m, d] = issue.date.split("-").map(Number) as [number, number, number];
  useEffect(() => {
    document.title = `${subject} · ${t("Evolako pismo")}`;
  }, [subject]);
  return (
    <PublicPage wide testId="pismo-issue">
      <article class="card card--block issue">
        {issue.cover ? <Cover cover={issue.cover} /> : null}
        <div class="issue__content">
          <header class="issue__head">
            <p class="kicker">{t("Evolako pismo")}</p>
            <h1 class="issue__title" id="page-title" tabIndex={-1}>{subject}</h1>
            <p class="issue__date"><time dateTime={issue.date}>{fullDate(fromBelgrade(y, m, d), l)}</time></p>
          </header>
          <div class="issue__body">
            {part.blocks.map((block, i) => <Block key={i} block={block} />)}
          </div>
          <p class="issue__signature">{t("Tim Evolako")}</p>
        </div>
      </article>
    </PublicPage>
  );
}

export default function Pismo({ params }: { params: Record<string, string> }) {
  const slug = params.slug ?? "";
  const valid = ISSUE_SLUG.test(slug);
  const issue = useResource<Issue>(valid ? `posta:${slug}` : null, () => loadIssue(slug, (input, init) => fetch(input, init)));
  if (!valid) return <PublicNotFound />;
  if (issue.data) return <IssueView issue={issue.data} />;
  if (issue.error instanceof IssueNotFound) return <PublicNotFound />;
  if (issue.error) {
    const offline = isOfflineError(issue.error);
    return (
      <PublicPage testId="pismo-issue-error">
        <PublicState icon={offline ? "wifiOff" : "alert"} tone={offline ? "accent" : "fault"} title={t("Nešto nije u redu")}
          text={errorMessage(issue.error)} state="error">
          <PublicActions>
            <Button variant="secondary" icon="refresh" onClick={() => void issue.reload()} testId="pismo-issue-retry">
              {t("Pokušaj ponovo")}
            </Button>
          </PublicActions>
        </PublicState>
      </PublicPage>
    );
  }
  return <PublicPage><LoadingScreen /></PublicPage>;
}

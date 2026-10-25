// /profil/pitanja — the site's FAQ (a bundled snapshot of evolako.rs/cesta-pitanja), searchable without caring
// about case or diacritics ("cena" finds "Cena", "sasa" finds "Saša", "djak" finds "đak").
import { useMemo, useState } from "preact/hooks";
import faq from "../../content/faq.json";
import { matchesQuery } from "../../lib/forms";
import { contentLang, inScript, lang, siteText, t, type Lang } from "../../i18n";
import { Page } from "../../shell/Page";
import type { Mode } from "../../shell/Shell";
import { Button } from "../../ui/controls";
import { Card, EmptyState } from "../../ui/display";
import { Icon } from "../../ui/Icon";

type Text = { sr: string; en: string; ru: string };
interface Item { question: Text; answer: Text }
interface Category { id: string; title: Text; items: Item[] }

const CATEGORIES = (faq as unknown as { categories: Category[] }).categories;

/** In Cyrillic the question is found whichever script it is typed in. */
function matches(item: Item, query: string, l: Lang): boolean {
  const c = contentLang(l);
  const text = `${item.question[c]} ${item.answer[c]}`;
  return matchesQuery(l === "sr-Cyrl" ? `${text} ${inScript(text, l)}` : text, query);
}

export default function Pitanja(_props: { params: Record<string, string>; mode: Mode }) {
  const [query, setQuery] = useState("");
  const l = lang.value;
  const filtered = useMemo(() => CATEGORIES
    .map((c) => ({ ...c, items: c.items.filter((i) => matches(i, query, l)) }))
    .filter((c) => c.items.length > 0), [query, l]);
  const searching = query.trim().length > 0;
  const count = filtered.reduce((n, c) => n + c.items.length, 0);

  return (
    <Page title={t("Česta pitanja")} back="/profil" backLabel={t("Profil")} testId="pitanja">
      <div class="faq">
        <div class="faq__search">
          <label class="sr-only" for="faq-search">{t("Pretraži pitanja")}</label>
          <Icon name="search" />
          <input id="faq-search" type="search" class="input faq__input" value={query} placeholder={t("Pretraži pitanja")}
            autoComplete="off" onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)} data-testid="faq-search" />
        </div>
        <p class="sr-only" aria-live="polite">{searching ? `${count}` : ""}</p>
        {filtered.length === 0 ? (
          <Card>
            <EmptyState icon="search" title={t("Nema pitanja koja se poklapaju.")} testId="faq-empty"
              action={<Button variant="secondary" href="/profil/podrska" icon="mail">{t("Piši nam")}</Button>} />
          </Card>
        ) : filtered.map((c) => (
          <section key={c.id} class="faq__group" aria-labelledby={`faq-${c.id}`}>
            <h2 class="section-title" id={`faq-${c.id}`}>{siteText(c.title)}</h2>
            <div class="card card--flush faq__list">
              {c.items.map((item) => (
                <details key={`${item.question.sr}-${searching}`} class="faq__item" open={searching} data-testid="faq-item">
                  <summary class="faq__q">
                    <span>{siteText(item.question)}</span>
                    <Icon name="chevronDown" class="faq__chevron" />
                  </summary>
                  <p class="faq__a">{siteText(item.answer)}</p>
                </details>
              ))}
            </div>
          </section>
        ))}
        <p class="note faq__source">
          <Icon name="globe" />
          <span>{t("Isto kao na sajtu evolako.rs.")}</span>
        </p>
      </div>
    </Page>
  );
}

// Pages without an account (landing, demo chooser, Evolako pismo): the language and theme controls, and the frame and
// message card of the pages that e-mails link to (/pismo, /odjava, /pismo/<slug>, a public "not found").
import type { ComponentChildren, Ref } from "preact";
import { useState } from "preact/hooks";
import { setTheme, theme, type Theme } from "../app/settings";
import { HTML_LANG, lang, LANG_CODES, LANG_NAMES, LANG_SCRIPTS, LANGS, langTitle, setLang, t } from "../i18n";
import { Brand } from "../ui/brand";
import { IconButton } from "../ui/controls";
import { Icon, type IconName } from "../ui/Icon";
import { Menu } from "../ui/overlay";

const THEME_ICON: Record<Theme, IconName> = { light: "sun", dark: "moon", system: "monitor" };

export function themeTitle(value: Theme): string {
  return value === "light" ? t("Svetla") : value === "dark" ? t("Tamna") : t("Sistem");
}

/**
 * The language choice of the public pages — the same drop-down as in the header of evolako.rs: a button
 * [globe · code · chevron] (SR, СР, EN, RU) and a menu with the names of the languages, the current one ticked.
 * Arrow keys, Home/End, Enter/Space, Escape and a click outside work as in every menu of the app.
 */
export function LangMenu() {
  const [open, setOpen] = useState(false);
  const current = lang.value;
  return (
    <div class="menu-wrap lang-menu">
      <button type="button" class="lang-btn" aria-haspopup="menu" aria-expanded={open ? "true" : "false"}
        aria-controls="lang-menu" aria-label={`${t("Jezik")}: ${langTitle(current)}`} title={t("Jezik")}
        data-testid="lang-button" data-lang={current} onClick={() => setOpen(!open)}
        onKeyDown={(e) => {
          if (open || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
          e.preventDefault();
          setOpen(true);
        }}>
        <Icon name="globe" />
        <span class="lang-btn__code" aria-hidden="true">{LANG_CODES[current]}</span>
        <Icon name="chevronDown" class="lang-btn__chevron" />
      </button>
      {open ? (
        <Menu label={t("Jezik")} id="lang-menu" onClose={() => setOpen(false)}>
          {LANGS.map((l) => (
            <button key={l} type="button" role="menuitemradio" class="menu__item lang-menu__item" lang={HTML_LANG[l]}
              aria-checked={current === l ? "true" : "false"} data-testid={`lang-${l}`}
              onClick={(e) => {
                setOpen(false);
                (e.currentTarget.closest(".menu-wrap")?.querySelector("[aria-haspopup]") as HTMLElement | null)?.focus();
                void setLang(l);
              }}>
              <span class="lang-menu__name">{LANG_NAMES[l]}</span>
              {LANG_SCRIPTS[l] ? <span class="lang-menu__script">{LANG_SCRIPTS[l]}</span> : null}
              {current === l ? <Icon name="check" class="lang-menu__check" /> : null}
            </button>
          ))}
        </Menu>
      ) : null}
    </div>
  );
}

export function PublicControls() {
  const [open, setOpen] = useState(false);
  return (
    <div class="public__controls">
      <LangMenu />
      <div class="menu-wrap">
        <IconButton icon={THEME_ICON[theme.value]} label={`${t("Tema")}: ${themeTitle(theme.value)}`}
          onClick={() => setOpen(!open)} hasPopup="menu" expanded={open} controls="theme-menu" testId="theme-button" />
        {open ? (
          <Menu label={t("Tema")} id="theme-menu" onClose={() => setOpen(false)}>
            {(["light", "dark", "system"] as Theme[]).map((value) => (
              <button key={value} type="button" role="menuitemradio" class="menu__item"
                aria-checked={theme.value === value ? "true" : "false"} data-testid={`theme-${value}`}
                onClick={() => {
                  setTheme(value);
                  setOpen(false);
                }}>
                <Icon name={THEME_ICON[value]} />
                <span>{themeTitle(value)}</span>
              </button>
            ))}
          </Menu>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A page for anyone, signed in or not (the pages e-mails link to): the brand (home) and the controls on top, then the
 * content. `wide` for reading (an issue of Evolako pismo), otherwise a narrow column for one message card.
 */
export function PublicPage({ children, wide, testId }: { children: ComponentChildren; wide?: boolean; testId?: string }) {
  return (
    <div class={wide ? "public public-page public-page--wide" : "public public-page"} data-testid={testId}>
      <div class="public__bar">
        <a href="/" class="brand" aria-label="Evolako"><Brand size={24} /></a>
        <PublicControls />
      </div>
      <main class="public-page__main" id="main">{children}</main>
    </div>
  );
}

interface PublicStateProps {
  icon: IconName;
  tone?: "accent" | "fault";
  /** The page's h1: it says where the person is, or what just happened. */
  title: string;
  text?: ComponentChildren;
  /** A line, an error, the actions. */
  children?: ComponentChildren;
  headingRef?: Ref<HTMLHeadingElement>;
  /** Which step the page is in (data-state, for tests and styles). */
  state?: string;
  testId?: string;
}

/** One message on a public page: an icon, a title and what to do next — the card of /pismo, /odjava and "not found". */
export function PublicState({ icon, tone, title, text, children, headingRef, state, testId }: PublicStateProps) {
  return (
    <section class="card card--block public-state" data-state={state} data-testid={testId}>
      <span class={`state__icon${tone === "fault" ? " state__icon--fault" : ""}`}><Icon name={icon} /></span>
      <h1 class="public-state__title" id="page-title" tabIndex={-1} ref={headingRef}>{title}</h1>
      {text ? <p class="public-state__text">{text}</p> : null}
      {children}
    </section>
  );
}

/** The buttons under a message: side by side where they fit, one under the other on a phone. */
export function PublicActions({ children }: { children: ComponentChildren }) {
  return <div class="public-state__actions">{children}</div>;
}

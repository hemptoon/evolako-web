import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { DemoPointState } from "../api/demo/backend";
import type { DemoAccount } from "../api/demo/data";
import type { PointStatus, User } from "../api/types";
import { activePoint, k, selectPoint, useAlerts } from "../app/data";
import { invalidate } from "../app/query";
import { location, navigate } from "../app/router";
import { exitDemo, session, startDemo } from "../app/session";
import { pointName, statusTitle } from "../app/texts";
import { msg, t } from "../i18n";
import { Brand, Mark } from "../ui/brand";
import { IconButton } from "../ui/controls";
import { Icon, type IconName } from "../ui/Icon";
import { Menu } from "../ui/overlay";
import { AlertsPanel } from "./Alerts";
import { pageMeta, titleHidden } from "./Page";

export type Mode = "customer" | "lead";

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  match: (path: string) => boolean;
  testId: string;
}

export function navItems(mode: Mode): NavItem[] {
  if (mode === "customer") {
    return [
      { href: "/danas", label: t("Danas"), icon: "bolt", match: (p) => p === "/danas", testId: "nav-danas" },
      { href: "/statistika", label: t("Statistika"), icon: "chart", match: (p) => p.startsWith("/statistika"), testId: "nav-statistika" },
      { href: "/obracuni", label: t("Obračuni"), icon: "statement", match: (p) => p.startsWith("/obracuni"), testId: "nav-obracuni" },
      { href: "/profil", label: t("Profil"), icon: "user", match: (p) => p.startsWith("/profil") || p.startsWith("/paketi"), testId: "nav-profil" },
    ];
  }
  return [
    { href: "/moja-prijava", label: t("Moja prijava"), icon: "calendarClock", match: (p) => p.startsWith("/moja-prijava") || p.startsWith("/zatrazi-procenu"), testId: "nav-prijava" },
    { href: "/paketi", label: t("Paketi"), icon: "charger", match: (p) => p.startsWith("/paketi"), testId: "nav-paketi" },
    { href: "/profil", label: t("Profil"), icon: "user", match: (p) => p.startsWith("/profil"), testId: "nav-profil" },
  ];
}

function initials(user: User | undefined, email: string): string {
  const source = (user?.name || email || "E").trim();
  const parts = source.split(/[\s.@_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "E") + (parts[1]?.[0] ?? "")).toUpperCase();
}

// ---------------------------------------------------------------- demo chrome

const DEMO_TITLES: Record<DemoAccount, string> = {
  wallbox: msg("Wallbox u garaži zgrade"),
  socket: msg("Utičnica, sopstveno brojilo"),
  lead: msg("Prijava u toku"),
};

export function demoTitle(account: DemoAccount): string {
  return t(DEMO_TITLES[account]);
}

/** The demo point's three states, named like the point's status on Danas (type-only import: the demo stays lazy). */
const DEMO_POINT_STATES: DemoPointState[] = ["live", "idle", "fault"];
const DEMO_STATE_STATUS: Record<DemoPointState, PointStatus> = { live: "charging", idle: "online", fault: "fault" };
const DEMO_STATE_ICONS: Record<DemoPointState, IconName> = { live: "bolt", idle: "checkCircle", fault: "alert" };

function DemoMenu() {
  const s = session.value;
  const [open, setOpen] = useState(false);
  if (s.kind !== "demo") return null;
  const hasPoint = s.account !== "lead";
  const choose = async (account: DemoAccount) => {
    setOpen(false);
    await startDemo(account);
    navigate("/", { replace: true });
  };
  const setState = (state: DemoPointState) => {
    s.backend.setState(state);
    setOpen(false);
    invalidate(k(""));
  };
  return (
    <div class="menu-wrap">
      <button type="button" class="demo-pill" aria-haspopup="menu" aria-expanded={open ? "true" : "false"}
        aria-controls="demo-menu" onClick={() => setOpen(!open)} data-testid="demo-badge">
        <Icon name="playCircle" />
        <span>{t("Demo")}</span>
      </button>
      {open ? (
        <Menu label={t("Demo")} id="demo-menu" onClose={() => setOpen(false)}>
          <div class="menu__label">{t("Demo nalog")}</div>
          {(["wallbox", "socket", "lead"] as DemoAccount[]).map((account) => (
            <button key={account} type="button" role="menuitemradio" class="menu__item"
              aria-checked={s.account === account ? "true" : "false"} onClick={() => void choose(account)}>
              <Icon name={s.account === account ? "check" : account === "lead" ? "calendarClock" : account === "wallbox" ? "charger" : "plug"} />
              <span>{demoTitle(account)}</span>
            </button>
          ))}
          {hasPoint ? (
            <>
              <div class="menu__sep" role="separator" />
              <div class="menu__label">{t("Tačka punjenja")}</div>
              {DEMO_POINT_STATES.map((state) => {
                const checked = s.backend.state === state;
                return (
                  <button key={state} type="button" role="menuitemradio" class="menu__item"
                    aria-checked={checked ? "true" : "false"} onClick={() => setState(state)}
                    data-testid={`demo-state-${state}`}>
                    <Icon name={checked ? "check" : DEMO_STATE_ICONS[state]} />
                    <span>{statusTitle(DEMO_STATE_STATUS[state])}</span>
                  </button>
                );
              })}
            </>
          ) : null}
          <div class="menu__sep" role="separator" />
          <button type="button" role="menuitem" class="menu__item" data-testid="demo-exit"
            onClick={() => {
              setOpen(false);
              exitDemo();
              navigate("/prijava", { replace: true });
            }}>
            <Icon name="logout" />
            <span>{t("Izađi iz demoa")}</span>
          </button>
        </Menu>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- top bar

function Bell() {
  const alerts = useAlerts(true);
  const [open, setOpen] = useState(false);
  const unread = (alerts.data ?? []).filter((a) => !a.isRead).length;
  return (
    <>
      <IconButton icon="bell" label={unread > 0 ? `${t("Obaveštenja")} (${unread})` : t("Obaveštenja")}
        onClick={() => setOpen(true)} hasPopup="dialog" testId="bell">
        {unread > 0 ? <span class="bell-dot" aria-hidden="true">{unread > 9 ? "9+" : unread}</span> : null}
      </IconButton>
      {open ? <AlertsPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function TopBar({ mode }: { mode: Mode }) {
  const meta = pageMeta.value;
  const scrolled = titleHidden.value;
  return (
    <div class={`topbar${scrolled ? " topbar--scrolled" : ""}`} data-testid="topbar">
      <div class="topbar__lead">
        {meta?.back ? (
          <IconButton icon="chevronLeft" label={meta.backLabel ?? t("Nazad")} href={meta.back} testId="back" />
        ) : (
          <a class="topbar__brand topbar__brand--collapsible" href={mode === "customer" ? "/danas" : "/moja-prijava"}
            aria-label="Evolako">
            <Mark size={24} />
          </a>
        )}
        <div class="topbar__title" aria-hidden="true">{meta?.title}</div>
      </div>
      <div class="topbar__actions">
        <DemoMenu />
        {mode === "customer" ? <Bell /> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- navigation

function TabBar({ mode }: { mode: Mode }) {
  const path = location.value.path;
  return (
    <nav class="tabbar" aria-label={t("Glavna navigacija")}>
      {navItems(mode).map((item) => (
        <a key={item.href} class="tabbar__item" href={item.href} aria-current={item.match(path) ? "page" : undefined}
          data-testid={`tab-${item.testId}`}>
          <span class="tabbar__icon"><Icon name={item.icon} /></span>
          <span>{item.label}</span>
        </a>
      ))}
    </nav>
  );
}

function Sidebar({ mode, user }: { mode: Mode; user: User | undefined }) {
  const path = location.value.path;
  const s = session.value;
  const email = s.kind === "in" ? s.email : user?.email ?? "";
  const points = user?.chargePoints ?? [];
  const active = activePoint(user);
  return (
    <aside class="sidebar" aria-label={t("Glavna navigacija")}>
      <div class="sidebar__brand">
        <a href={mode === "customer" ? "/danas" : "/moja-prijava"} aria-label="Evolako" class="brand"><Brand size={24} /></a>
      </div>
      {points.length > 1 ? (
        <label class="point-switch">
          <span class="point-switch__label">{t("Tačka punjenja")}</span>
          <span class="select-wrap">
            <select class="select" value={active?.id} onChange={(e) => {
              selectPoint((e.currentTarget as HTMLSelectElement).value);
              invalidate(k(""));
            }}>
              {points.map((p) => <option key={p.id} value={p.id}>{pointName(p)}</option>)}
            </select>
            <Icon name="chevronDown" />
          </span>
        </label>
      ) : null}
      <nav class="sidebar__nav">
        {navItems(mode).map((item) => (
          <a key={item.href} class="sidebar__item" href={item.href} aria-current={item.match(path) ? "page" : undefined}
            data-testid={`side-${item.testId}`}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </a>
        ))}
      </nav>
      <div class="sidebar__spacer" />
      <a class="sidebar__account" href="/profil/nalog" data-testid="sidebar-account">
        <span class="avatar" aria-hidden="true">{initials(user, email)}</span>
        <span class="sidebar__account-text">
          <span class="sidebar__account-name">{user?.name || t("Nalog")}</span>
          <span class="sidebar__account-mail">{email || t("Nalog i podešavanja")}</span>
        </span>
        <Icon name="chevronRight" />
      </a>
    </aside>
  );
}

// ---------------------------------------------------------------- shell

export function Shell({ mode, user, children }: { mode: Mode; user: User | undefined; children: ComponentChildren }) {
  return (
    <div class="shell">
      <a class="skip-link" href="#main">{t("Preskoči na sadržaj")}</a>
      <Sidebar mode={mode} user={user} />
      <div class="main-col">
        <TopBar mode={mode} />
        <main class="main" id="main">
          {children}
        </main>
      </div>
      <TabBar mode={mode} />
    </div>
  );
}

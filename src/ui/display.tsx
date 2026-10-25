import type { ComponentChildren, JSX } from "preact";
import { signal } from "@preact/signals";
import { t } from "../i18n";
import { Button } from "./controls";
import { Icon, type IconName } from "./Icon";

// ---------------------------------------------------------------- card

interface CardProps extends Omit<JSX.HTMLAttributes<HTMLElement>, "size"> {
  variant?: "card" | "block" | "tile" | "flush";
  as?: "section" | "div" | "article" | "aside" | "li";
  children?: ComponentChildren;
  class?: string;
}

export function Card({ variant = "card", as = "section", children, class: className, ...rest }: CardProps) {
  const Tag = as as unknown as (p: Record<string, unknown>) => JSX.Element;
  const cls = ["card", variant !== "card" ? `card--${variant}` : "", className ?? ""].filter(Boolean).join(" ");
  return <Tag class={cls} {...rest}>{children}</Tag>;
}

// ---------------------------------------------------------------- badge

export type BadgeTone = "online" | "charging" | "offline" | "fault" | "paid" | "neutral" | "ok" | "demo";

export function Badge({ tone, icon, children, pulse }: {
  tone: BadgeTone;
  icon?: IconName;
  children: ComponentChildren;
  pulse?: boolean;
}) {
  return (
    <span class={`badge badge--${tone}`}>
      {pulse ? <span class="pulse-dot" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------- tiles

interface TileProps {
  value: string;
  unit?: string;
  caption: string;
  accent?: boolean;
  flat?: boolean;
  testId?: string;
  /** A converted amount: "Preračunato po kursu NBS… Cena u dinarima: …" (title and screen readers). */
  hint?: string | null;
}

/** One number with a small unit and a caption (MetricTile). The number never wraps. */
export function Tile({ value, unit, caption, accent, flat, testId, hint }: TileProps) {
  return (
    <div class={`tile${flat ? " tile--flat" : ""}${accent ? " tile--accent" : ""}`} data-testid={testId}
      title={hint ?? undefined}>
      <div class="tile__value">
        <span class="tile__number">{value}</span>
        {unit ? <span class="tile__unit">{unit}</span> : null}
      </div>
      <div class="tile__caption">{caption}</div>
      {hint ? <span class="sr-only">{hint}</span> : null}
    </div>
  );
}

export function Metric({ value, unit, class: className }: { value: string; unit?: string; class?: string }) {
  return (
    <div class={className ? `metric ${className}` : "metric"}>
      <span class="metric__value">{value}</span>
      {unit ? <span class="metric__unit">{unit}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------- rows

interface RowProps {
  icon?: IconName;
  iconTone?: "accent" | "fault";
  title: ComponentChildren;
  subtitle?: ComponentChildren;
  trailing?: ComponentChildren;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  chevron?: boolean;
  testId?: string;
  label?: string;
}

/** A list/settings row: icon, title with a secondary line, trailing value; a link or a button when interactive. */
export function Row({ icon, iconTone, title, subtitle, trailing, href, external, onClick, chevron, testId, label }: RowProps) {
  const body = (
    <>
      {icon ? (
        <span class={`row__icon${iconTone === "fault" ? " row__icon--fault" : ""}`}><Icon name={icon} /></span>
      ) : null}
      <span class="row__text">
        <span class="row__title">{title}</span>
        {subtitle ? <span class="row__sub">{subtitle}</span> : null}
      </span>
      {trailing || chevron || external ? (
        <span class="row__trail">
          {trailing}
          {external ? <Icon name="external" /> : chevron ? <Icon name="chevronRight" /> : null}
        </span>
      ) : null}
    </>
  );
  if (href) {
    return (
      <a class="row" href={href} target={external ? "_blank" : undefined}
        rel={external ? "noopener noreferrer" : undefined} data-testid={testId} aria-label={label}>
        {body}
      </a>
    );
  }
  if (onClick) {
    return <button type="button" class="row" onClick={onClick} data-testid={testId} aria-label={label}>{body}</button>;
  }
  return <div class="row" data-testid={testId}>{body}</div>;
}

export function KeyValues({ items }: { items: Array<[string, ComponentChildren]> }) {
  return (
    <dl class="kv">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ---------------------------------------------------------------- steps

/** Progress of a request: done steps in accent, the current one in bold. */
export function Steps({ labels, current, label }: { labels: string[]; current: number; label: string }) {
  return (
    <ol class="steps" style={{ "--steps": String(labels.length) }} aria-label={label}>
      {labels.map((text, index) => {
        const done = index <= current;
        return (
          <li key={text} class={`steps__item${done ? " steps__item--done" : ""}${index === current ? " steps__item--current" : ""}`}
            aria-current={index === current ? "step" : undefined}>
            <span class="steps__bar" aria-hidden="true" />
            <span>{text}</span>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------- states

export function Skeleton({ width = "100%", height = 16, radius = 10, class: className }: {
  width?: string | number;
  height?: string | number;
  radius?: number;
  class?: string;
}) {
  return (
    <span class={className ? `skeleton ${className}` : "skeleton"} aria-hidden="true"
      style={{ width: typeof width === "number" ? `${width}px` : width,
        height: typeof height === "number" ? `${height}px` : height, borderRadius: `${radius}px` }} />
  );
}

interface StateProps {
  icon: IconName;
  title: string;
  message?: string;
  action?: ComponentChildren;
  tone?: "accent" | "fault";
  testId?: string;
}

export function EmptyState({ icon, title, message, action, tone = "accent", testId }: StateProps) {
  return (
    <div class="state" data-testid={testId}>
      <span class={`state__icon${tone === "fault" ? " state__icon--fault" : ""}`}><Icon name={icon} /></span>
      <h2 class="state__title">{title}</h2>
      {message ? <p class="state__text">{message}</p> : null}
      {action}
    </div>
  );
}

/** Error with a way out: words, not codes, and "Pokušaj ponovo". */
export function ErrorState({ message, onRetry, offline }: { message: string; onRetry: () => void; offline?: boolean }) {
  return (
    <EmptyState
      icon={offline ? "wifiOff" : "alert"}
      tone={offline ? "accent" : "fault"}
      title={t("Nešto nije u redu")}
      message={message}
      testId="error-state"
      action={<Button variant="secondary" icon="refresh" onClick={onRetry}>{t("Pokušaj ponovo")}</Button>}
    />
  );
}

export function Banner({ tone = "neutral", icon, title, text, children, testId, live }: {
  tone?: "neutral" | "fault" | "info";
  icon: IconName;
  title: string;
  text?: string;
  children?: ComponentChildren;
  testId?: string;
  /** Announced when it appears (a status, not an alarm). */
  live?: boolean;
}) {
  return (
    <div class={`banner${tone !== "neutral" ? ` banner--${tone}` : ""}`}
      role={tone === "fault" ? "alert" : live ? "status" : undefined} data-testid={testId}>
      <Icon name={icon} />
      <div class="banner__main">
        <div class="banner__title">{title}</div>
        {text ? <div class="banner__text">{text}</div> : null}
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- toasts

interface ToastItem {
  id: number;
  text: string;
  icon: IconName;
}

export const toasts = signal<ToastItem[]>([]);
let toastId = 0;

/** A short confirmation ("Kopirano", "Sačuvano") announced politely to screen readers. */
export function toast(text: string, icon: IconName = "checkCircle"): void {
  const id = ++toastId;
  toasts.value = [...toasts.value.slice(-2), { id, text, icon }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((x) => x.id !== id);
  }, 2400);
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map((x) => (
        <div class="toast" key={x.id}>
          <Icon name={x.icon} />
          <span>{x.text}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- clipboard

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers / denied permission: select-and-copy fallback.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.className = "sr-only";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function CopyButton({ text, label, what, testId }: { text: string; label?: string; what: string; testId?: string }) {
  return (
    <button
      type="button"
      class="icon-btn copy-btn"
      aria-label={label ?? `${t("Kopiraj")}: ${what}`}
      title={t("Kopiraj")}
      data-testid={testId}
      onClick={async () => {
        if (await copyText(text)) toast(t("Kopirano"));
      }}
    >
      <Icon name="copy" />
    </button>
  );
}

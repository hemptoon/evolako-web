import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useId, useRef } from "preact/hooks";
import { t } from "../i18n";
import { IconButton } from "./controls";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;

/** Traps Tab inside the container, closes on Escape, restores focus and page scroll on close. */
function useModal(ref: { current: HTMLElement | null }, onClose: () => void, initialFocus?: string) {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = document.documentElement;
    openCount += 1;
    root.style.overflow = "hidden";
    const node = ref.current;
    const target = (initialFocus && node?.querySelector<HTMLElement>(initialFocus))
      || node?.querySelector<HTMLElement>("[data-autofocus]")
      || node?.querySelector<HTMLElement>(FOCUSABLE)
      || node;
    target?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      openCount -= 1;
      if (openCount === 0) root.style.overflow = "";
      previous?.focus?.({ preventScroll: true });
    };
  }, []);
}

interface DialogProps {
  title: string;
  onClose: () => void;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  /** alertdialog for confirmations (system-like confirm), dialog otherwise. */
  role?: "dialog" | "alertdialog";
  testId?: string;
  wide?: boolean;
}

/** Centred modal; a bottom sheet on phones. Escape and the scrim close it. */
export function Dialog({ title, onClose, children, actions, role = "dialog", testId, wide }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useModal(ref, onClose);
  return createPortal(
    <div class="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        class="dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        aria-describedby={children ? `${id}-b` : undefined}
        tabIndex={-1}
        data-testid={testId}
        style={wide ? { width: "min(560px, 100%)" } : undefined}
      >
        <h2 class="dialog__title" id={`${id}-t`}>{title}</h2>
        {children ? <div class="dialog__body" id={`${id}-b`}>{children}</div> : null}
        {actions ? <div class="dialog__actions">{actions}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

interface DrawerProps {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  testId?: string;
  headerExtra?: ComponentChildren;
}

/** A side panel on wide screens, a bottom sheet on phones. */
export function Drawer({ title, onClose, children, testId, headerExtra }: DrawerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useId();
  useModal(ref, onClose, "[data-autofocus]");
  return createPortal(
    <div class="scrim drawer-scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} class="drawer" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1}
        data-testid={testId}>
        <div class="drawer__head">
          <h2 class="drawer__title" id={`${id}-t`}>{title}</h2>
          <div class="drawer__head-actions">
            {headerExtra}
            <IconButton icon="close" label={t("Zatvori")} onClick={onClose} />
          </div>
        </div>
        <div class="drawer__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

interface MenuProps {
  onClose: () => void;
  children: ComponentChildren;
  label: string;
  id?: string;
  align?: "right" | "left";
}

/** A small popover menu: arrow keys, Home and End move, Escape and outside clicks close it; it opens on the ticked item. */
export function Menu({ onClose, children, label, id, align = "right" }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const node = ref.current;
    (node?.querySelector<HTMLElement>('[role^="menuitem"][aria-checked="true"]')
      ?? node?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
    const onDown = (e: MouseEvent) => {
      if (node && !node.parentElement?.contains(e.target as Node)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (!node) return;
      const items = [...node.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (e.key === "Escape") {
        e.preventDefault();
        close.current();
        (node.parentElement?.querySelector("[aria-haspopup]") as HTMLElement | null)?.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(index + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(index - 1 + items.length) % items.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        items[items.length - 1]?.focus();
      } else if (e.key === "Tab") {
        close.current();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return (
    <div ref={ref} class="menu" role="menu" aria-label={label} id={id}
      style={align === "left" ? { left: "0", right: "auto" } : undefined}>
      {children}
    </div>
  );
}

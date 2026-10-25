import type { ComponentChildren } from "preact";
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { navigationKind } from "../app/router";

export interface PageMeta {
  title: string;
  back?: string;
  backLabel?: string;
}

/** What the top bar shows: the compact title (once the big one scrolls away) and the way back. */
export const pageMeta = signal<PageMeta | null>(null);
export const titleHidden = signal(false);

interface PageProps {
  title: string;
  subtitle?: ComponentChildren;
  /** Parent route for sub-pages (the top bar shows a back button). */
  back?: string;
  backLabel?: string;
  actions?: ComponentChildren;
  children: ComponentChildren;
  testId?: string;
  wide?: boolean;
}

/**
 * A screen: one large H1 (the focus target after navigation) and its content. The title element is observed:
 * when it scrolls under the top bar, the bar shows the compact title instead — like a large-title nav bar.
 */
export function Page({ title, subtitle, back, backLabel, actions, children, testId, wide }: PageProps) {
  const h1 = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    pageMeta.value = { title, back, backLabel };
    document.title = title === "Evolako" ? "Moj Evolako" : `${title} · Moj Evolako`;
  }, [title, back, backLabel]);
  // After a navigation (not the first load) the new title takes the focus: screen readers hear where they are,
  // and the next Tab starts from the top of the new content.
  useEffect(() => {
    if (navigationKind.value === "push" || navigationKind.value === "pop") h1.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const node = h1.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      titleHidden.value = entry ? !entry.isIntersecting : false;
    }, { rootMargin: "-72px 0px 0px 0px", threshold: 0 });
    observer.observe(node);
    return () => {
      observer.disconnect();
      titleHidden.value = false;
    };
  }, []);
  return (
    <div class={wide ? "page page--wide" : "page"} data-testid={testId}>
      <header class="page__head">
        <div>
          <h1 class="page__title" id="page-title" tabIndex={-1} ref={h1}>{title}</h1>
          {subtitle ? <div class="page__subtitle">{subtitle}</div> : null}
        </div>
        {actions ? <div class="page__actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

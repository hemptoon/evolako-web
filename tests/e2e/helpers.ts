// Shared e2e helpers: a fixed Belgrade clock, a demo session, console/CSP error capture, overflow and axe checks.
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** 12 October 2026, 23:40 in Belgrade: the September statement is issued and due on the 15th, auto-start is on. */
export const DEMO_NOW = new Date("2026-10-12T23:40:00+02:00");

export async function openDemo(page: Page, account: "wallbox" | "socket" | "lead", path: string, theme: "light" | "dark" = "light") {
  await page.clock.setFixedTime(DEMO_NOW);
  await page.addInitScript(([account, theme]) => {
    try {
      if (!sessionStorage.getItem("e2e.seeded")) {
        localStorage.setItem("evo.demo", account);
        localStorage.setItem("evo.theme", theme);
        sessionStorage.setItem("e2e.seeded", "1");
      }
    } catch {
      // storage blocked
    }
  }, [account, theme] as const);
  await page.goto(path);
  await page.locator("#page-title").first().waitFor();
}

/** The language menu of a public page: open it and pick a language. */
export async function chooseLang(page: Page, lang: "sr" | "sr-Cyrl" | "en" | "ru") {
  await page.getByTestId("lang-button").click();
  await page.getByTestId(`lang-${lang}`).click();
}

/** Collects console errors, page errors and CSP violations for the whole test. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  void page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  return errors;
}

/** Every control is at least 44 px tall (links inside sentences and the switch track, with its larger hit area, aside). */
export async function expectTouchTargets(page: Page, label: string) {
  const small = await page.evaluate(() => [...document.querySelectorAll(
    'a, button, input, select, textarea, summary, [role="radio"], [tabindex="0"]',
  )].flatMap((el) => {
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (!r.width || !r.height || el.closest(".sr-only") || style.visibility === "hidden") return [];
    if (el.tagName === "A" && style.display === "inline") return []; // links inside sentences
    if (el.classList.contains("switch")) return []; // 32 px track, 44 px hit area (::before)
    if (style.opacity === "0" && el.closest("label")) return []; // a hidden radio: its whole label is the target
    return r.height < 44 ? [`${el.className} ${Math.round(r.width)}×${Math.round(r.height)}`] : [];
  }));
  expect(small, label).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
}

/** Waits until every finite animation and transition has finished (the Danas ring fills, cards fade in). */
export async function waitForAnimations(page: Page) {
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"
    || (a.effect?.getTiming().iterations ?? 1) === Infinity));
}

export async function expectAccessible(page: Page, label: string) {
  // Let entrance animations finish: a half-faded page is not what anyone reads.
  await waitForAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`), label).toEqual([]);
}

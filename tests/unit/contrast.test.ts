// WCAG contrast of the design tokens, read from src/styles/tokens.css itself (so a changed colour is checked):
// text ≥ 4.5:1, graphics and control outlines ≥ 3:1, in the light and the dark theme.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");

function block(selectorStart: string): Record<string, string> {
  const start = css.indexOf(selectorStart);
  if (start < 0) throw new Error(`no block ${selectorStart}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, close).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const palette = block(":root {");
const light = block(':root,\n:root[data-theme="light"] {');
const dark = block(':root[data-theme="dark"] {');

type RGBA = [number, number, number, number];

function parse(value: string, vars: Record<string, string>): RGBA {
  const v = value.trim();
  const ref = /^var\(--([\w-]+)\)$/.exec(v);
  if (ref) {
    const next = vars[ref[1]!] ?? palette[ref[1]!];
    if (!next) throw new Error(`unknown ${v}`);
    return parse(next, vars);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(v);
  if (hex) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const rgba = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(v);
  if (rgba) return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
  throw new Error(`cannot parse colour ${v}`);
}

function over(top: RGBA, bottom: RGBA): RGBA {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + bottom[i]! * (1 - a)).concat(1) as RGBA;
}

function luminance([r, g, b]: RGBA): number {
  const c = [r, g, b].map((x) => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function ratio(a: RGBA, b: RGBA): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Resolve a role in a theme; translucent colours are composited over the given backdrop (itself resolved). */
function color(theme: Record<string, string>, role: string, backdrop?: RGBA): RGBA {
  const raw = parse(theme[role] ?? `var(--${role})`, theme);
  if (raw[3] >= 1) return raw;
  if (!backdrop) throw new Error(`${role} is translucent: give a backdrop`);
  return over(raw, backdrop);
}

interface Pair { fg: string; bg: string; on?: string; min: number; what: string }

// bg: the surface under the foreground; on: what a translucent bg sits on (bg or surface).
const PAIRS: Pair[] = [
  // text
  { fg: "text", bg: "bg", min: 4.5, what: "body text on the page" },
  { fg: "text", bg: "surface", min: 4.5, what: "body text on cards" },
  { fg: "text-2", bg: "bg", min: 4.5, what: "secondary text on the page" },
  { fg: "text-2", bg: "surface", min: 4.5, what: "secondary text on cards" },
  { fg: "text-2", bg: "surface-2", on: "surface", min: 4.5, what: "secondary text on grey chips" },
  { fg: "text-2", bg: "tile", on: "surface", min: 4.5, what: "captions in tiles" },
  { fg: "text", bg: "accent-soft", on: "surface", min: 4.5, what: "text on soft blue (active nav, badges)" },
  { fg: "accent-text", bg: "bg", min: 4.5, what: "links on the page" },
  { fg: "accent-text", bg: "surface", min: 4.5, what: "links and amounts on cards" },
  { fg: "accent-text", bg: "accent-soft", on: "surface", min: 4.5, what: "icons and labels on soft blue" },
  { fg: "on-accent", bg: "accent", min: 4.5, what: "text on primary buttons" },
  { fg: "on-accent", bg: "accent-deep", min: 4.5, what: "the charging badge" },
  { fg: "fault-text", bg: "surface", min: 4.5, what: "error messages on cards" },
  { fg: "fault-text", bg: "bg", min: 4.5, what: "error messages on the page" },
  { fg: "text", bg: "fault-soft", on: "surface", min: 4.5, what: "text in the fault banner" },
  { fg: "on-fault", bg: "fault", min: 4.5, what: "fault badge" },
  { fg: "ok-text", bg: "surface", min: 3, what: "ok icons" },
  { fg: "text", bg: "ok-soft", on: "surface", min: 4.5, what: "text on the ok badge" },
  { fg: "caution-text", bg: "caution-soft", on: "bg", min: 3, what: "demo pill icon" },
  { fg: "text", bg: "caution-soft", on: "bg", min: 4.5, what: "demo pill text" },
  { fg: "text", bg: "chrome", on: "bg", min: 4.5, what: "top bar and tab bar" },
  { fg: "text-2", bg: "chrome", on: "bg", min: 4.5, what: "inactive tabs" },
  // graphics and controls
  { fg: "accent", bg: "surface", min: 3, what: "primary buttons, live ring, switches" },
  { fg: "accent-graphic", bg: "surface", min: 3, what: "progress steps and bars" },
  { fg: "chart-night", bg: "surface", min: 3, what: "night bars" },
  { fg: "chart-day", bg: "surface", min: 3, what: "day bars" },
  { fg: "outline", bg: "surface", min: 3, what: "input borders and secondary buttons" },
  { fg: "outline", bg: "bg", min: 3, what: "secondary buttons on the page" },
  { fg: "focus", bg: "bg", min: 3, what: "focus ring on the page" },
  { fg: "focus", bg: "surface", min: 3, what: "focus ring on cards" },
  { fg: "mark", bg: "bg", min: 3, what: "the Evolako mark" },
  { fg: "fault", bg: "surface", min: 3, what: "fault badge fill" },
];

for (const [name, theme] of [["light", light], ["dark", dark]] as const) {
  describe(`contrast — ${name} theme`, () => {
    for (const p of PAIRS) {
      it(`${p.what}: ${p.fg} on ${p.bg} ≥ ${p.min}`, () => {
        const base = p.on ? color(theme, p.on) : undefined;
        const bg = color(theme, p.bg, base);
        const fg = color(theme, p.fg, bg);
        expect(ratio(fg, bg)).toBeGreaterThanOrEqual(p.min);
      });
    }
  });
}

describe("print and QR colours", () => {
  it("ink on paper and deep accent on paper are text-safe", () => {
    const white: RGBA = [255, 255, 255, 1];
    expect(ratio(parse("#0b1220", {}), white)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(parse("#2358e0", {}), white)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(parse("#5a6478", {}), white)).toBeGreaterThanOrEqual(4.5);
  });

  it("the DEMO label on its red is readable", () => {
    expect(ratio([255, 255, 255, 1], parse("#be4325", {}))).toBeGreaterThanOrEqual(4.5);
  });
});

// The Evolako mark: a geometric lowercase "e" — a ring with a radial aperture cut 35° below the horizontal on the
// right and a crossbar through the centre that runs out beyond the ring. Proportions from the master icon
// (BVMark): stroke = 0.199 of the ring diameter, width with the bar = 1.133 × diameter. Drawn in a 113.28 × 100 box.
import { t } from "../i18n";

export const MARK = {
  width: 113.28,
  height: 100,
  stroke: 19.9,
  /** Ring centreline: radius 50 − stroke/2, arc from 35° clockwise round to 0°. */
  ring: "M82.807 72.972A40.05 40.05 0 1 1 90.05 50",
  bar: { x: 19.9, y: 40.05, width: 93.38, height: 19.9 },
} as const;

interface MarkProps {
  size?: number;
  class?: string;
  title?: string;
}

/** The mark alone. Height = `size`; colour from `color` (var(--mark) by default). */
export function Mark({ size = 32, class: className, title }: MarkProps) {
  return (
    <svg
      class={className ? `mark ${className}` : "mark"}
      viewBox={`0 0 ${MARK.width} ${MARK.height}`}
      width={(size * MARK.width) / MARK.height}
      height={size}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
      focusable="false"
    >
      <path d={MARK.ring} stroke-width={MARK.stroke} />
      <rect x={MARK.bar.x} y={MARK.bar.y} width={MARK.bar.width} height={MARK.bar.height} />
    </svg>
  );
}

/** "evolako": evo in Onest 350, lako in Onest 800 in accent blue. Never translated. */
export function Wordmark({ size = 22, class: className }: { size?: number; class?: string }) {
  return (
    <span class={className ? `wordmark ${className}` : "wordmark"} style={{ fontSize: `${size}px` }} aria-label="Evolako" role="img">
      <span class="wordmark__evo" aria-hidden="true">evo</span>
      <span class="wordmark__lako" aria-hidden="true">lako</span>
    </span>
  );
}

/** Mark + wordmark side by side. */
export function Brand({ size = 22 }: { size?: number }) {
  return (
    <span class="brand">
      <Mark size={Math.round(size * 1.05)} />
      <Wordmark size={size} />
    </span>
  );
}

/**
 * The loader: the ring draws itself, the bar slides right, a pause, 1.6 s loop (BVLoader).
 * Static under prefers-reduced-motion. Hidden from assistive tech — the caller gives the label.
 */
export function Loader({ size = "screen" }: { size?: "inline" | "screen" }) {
  return (
    <svg class={`loader loader--${size}`} viewBox={`0 0 ${MARK.width} ${MARK.height}`} aria-hidden="true" focusable="false">
      <path d={MARK.ring} stroke-width={MARK.stroke} pathLength={100} />
      <rect x={MARK.bar.x} y={MARK.bar.y} width={MARK.bar.width} height={MARK.bar.height} />
    </svg>
  );
}

export function LoadingScreen() {
  return (
    <div class="loading-screen" role="status" aria-live="polite">
      <Loader />
      <span>{t("Učitavanje…")}</span>
    </div>
  );
}

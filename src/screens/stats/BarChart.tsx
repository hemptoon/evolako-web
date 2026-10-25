// Stacked bars of energy per day (or month): night at the bottom in accent, day on top in slate.
// Pixel-exact SVG sized by a ResizeObserver (text never stretches). Hover, tap or the arrow keys pick a bar and
// show its tooltip; screen readers get the same numbers from a visually hidden table.
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { energy } from "../../app/texts";
import { t } from "../../i18n";
import { decimal } from "../../lib/format";
import { niceScale } from "../../lib/forms";

export interface ChartBucket {
  key: string;
  /** Short axis label: "pon", "14", "okt". */
  label: string;
  /** Full label for the tooltip and the table: "ponedeljak, 14. oktobar". */
  title: string;
  night: number;
  day: number;
}

interface Props {
  buckets: ChartBucket[];
  /** Accessible name: "Potrošnja po danima". */
  title: string;
  /** Label every n-th bar (counted from the newest). */
  labelEvery: number;
  testId?: string;
}

const HEIGHT = 248;
const PAD = { left: 40, right: 8, top: 30, bottom: 30 };

/** A rectangle with rounded top corners (the top of a stack). */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const radius = Math.max(0, Math.min(r, w / 2, h));
  return `M${x} ${y + h}V${y + radius}Q${x} ${y} ${x + radius} ${y}H${x + w - radius}Q${x + w} ${y} ${x + w} ${y + radius}V${y + h}Z`;
}

export function BarChart({ buckets, title, labelEvery, testId }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);

  useLayoutEffect(() => {
    const node = wrap.current;
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // A new period: forget the picked bar.
  useEffect(() => setActive(null), [buckets.length, buckets[0]?.key]);

  const n = buckets.length;
  const maxTotal = Math.max(0, ...buckets.map((b) => b.night + b.day));
  const { top, step } = niceScale(maxTotal);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = n > 0 ? plotW / n : 0;
  const barW = Math.max(3, Math.min(30, slot * (n > 20 ? 0.66 : 0.56)));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v);

  const move = (index: number) => setActive(Math.max(0, Math.min(n - 1, index)));
  const onKey = (e: KeyboardEvent) => {
    const current = active ?? n - 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") move(current - 1);
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") move(current + 1);
    else if (e.key === "Home") move(0);
    else if (e.key === "End") move(n - 1);
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const picked = active !== null ? buckets[active] : undefined;
  const pickedX = active !== null ? PAD.left + slot * active + slot / 2 : 0;
  const pickedTop = picked ? y(picked.night + picked.day) : 0;

  return (
    <div class="chart" data-testid={testId}>
      <div
        ref={wrap}
        class={`chart__plot${active !== null ? " chart__plot--active" : ""}`}
        tabIndex={0}
        role="group"
        aria-label={title}
        aria-describedby={`${testId ?? "chart"}-hint`}
        onKeyDown={onKey}
        onFocus={() => {
          setFocused(true);
          if (active === null) {
            let last = n - 1;
            while (last > 0 && (buckets[last]!.night + buckets[last]!.day) === 0) last -= 1;
            setActive(last);
          }
        }}
        onBlur={() => {
          setFocused(false);
          setActive(null);
        }}
        onMouseLeave={() => !focused && setActive(null)}
      >
        {width > 0 ? (
          <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true" focusable="false">
            <g class="chart__grid">
              {ticks.map((v) => (
                <g key={v}>
                  <line x1={PAD.left} x2={width - PAD.right} y1={y(v)} y2={y(v)} />
                  <text x={PAD.left - 8} y={y(v)} dy="0.32em" text-anchor="end">{decimal(v, 0)}</text>
                </g>
              ))}
              <text class="chart__unit" x={0} y={12}>{t("kWh")}</text>
            </g>
            <g>
              {buckets.map((b, i) => {
                const x = PAD.left + slot * i + (slot - barW) / 2;
                const nightTop = y(b.night);
                const dayTop = y(b.night + b.day);
                const base = y(0);
                const empty = b.night + b.day <= 0;
                const gap = b.night > 0 && b.day > 0 ? 1.5 : 0;
                return (
                  <g key={b.key} class={`chart__bar${active === i ? " is-active" : ""}`}>
                    {empty ? <rect class="chart__stub" x={x} y={base - 2} width={barW} height={2} rx={1} /> : null}
                    {b.night > 0 ? (
                      b.day > 0
                        ? <rect class="chart__night" x={x} y={nightTop} width={barW} height={Math.max(0, base - nightTop)} />
                        : <path class="chart__night" d={topRounded(x, nightTop, barW, base - nightTop, 4)} />
                    ) : null}
                    {b.day > 0 ? (
                      <path class="chart__day" d={topRounded(x, dayTop, barW, Math.max(0.5, nightTop - dayTop - gap), 4)} />
                    ) : null}
                  </g>
                );
              })}
            </g>
            <g class="chart__axis">
              {buckets.map((b, i) => ((n - 1 - i) % labelEvery === 0 ? (
                <text key={b.key} x={PAD.left + slot * i + slot / 2} y={HEIGHT - 8} text-anchor="middle"
                  class={active === i ? "is-active" : undefined}>{b.label}</text>
              ) : null))}
            </g>
            <g>
              {buckets.map((b, i) => (
                <rect key={b.key} class="chart__hit" x={PAD.left + slot * i} y={PAD.top} width={slot} height={plotH}
                  onMouseEnter={() => setActive(i)} onClick={() => setActive(i)} />
              ))}
            </g>
          </svg>
        ) : <div class="chart__placeholder" />}
        {picked ? (
          <div class="chart__tip" style={{
            left: `${Math.min(Math.max(pickedX, 84), Math.max(84, width - 84))}px`,
            top: `${Math.max(pickedTop - 10, 64)}px`,
          }} data-testid="chart-tooltip">
            <div class="chart__tip-title">{picked.title}</div>
            <div class="chart__tip-row">
              <span class="split__swatch split__swatch--night" />
              <span>{t("Noćna")}</span>
              <strong class="num">{energy(picked.night)}</strong>
            </div>
            <div class="chart__tip-row">
              <span class="split__swatch split__swatch--day" />
              <span>{t("Dnevna")}</span>
              <strong class="num">{energy(picked.day)}</strong>
            </div>
          </div>
        ) : null}
      </div>
      <div class="sr-only" aria-live="polite">
        {picked && focused ? `${picked.title}: ${t("Noćna")} ${energy(picked.night)}, ${t("Dnevna")} ${energy(picked.day)}` : ""}
      </div>
      <p class="sr-only" id={`${testId ?? "chart"}-hint`}>{t("Strelicama biraš dan, podaci su i u tabeli ispod.")}</p>
      {/* A table ignores width: 1px, so the visually hidden wrapper is a div. */}
      <div class="sr-only">
      <table>
        <caption>{title}</caption>
        <thead>
          <tr><th scope="col">{t("Datum")}</th><th scope="col">{t("Noćna")}</th><th scope="col">{t("Dnevna")}</th></tr>
        </thead>
        <tbody>
          {buckets.filter((b) => b.night + b.day > 0).map((b) => (
            <tr key={b.key}><th scope="row">{b.title}</th><td>{energy(b.night)}</td><td>{energy(b.day)}</td></tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}

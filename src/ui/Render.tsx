// Our own charger renders — the only photos the product may use. Responsive WebP, lazy by default.
const files = import.meta.glob("../assets/img/*.webp", { eager: true, query: "?url", import: "default" }) as Record<string, string>;

export type RenderName = "paket-wallbox-hero" | "paket-wallbox-closeup" | "paketi-hero" | "paket-garage" | "paket-zgrada";

const WIDTHS = [480, 960, 1600];
const RATIO: Record<RenderName, number> = {
  "paket-wallbox-hero": 893 / 1600,
  "paket-wallbox-closeup": 904 / 1600,
  "paketi-hero": 893 / 1600,
  "paket-garage": 670 / 1600,
  "paket-zgrada": 904 / 1600,
};

function url(name: RenderName, width: number): string {
  return files[`../assets/img/${name}-${width}.webp`] ?? "";
}

export function Render({ name, sizes, alt, eager, class: className }: {
  name: RenderName;
  sizes: string;
  alt: string;
  eager?: boolean;
  class?: string;
}) {
  return (
    <img
      class={className ? `render ${className}` : "render"}
      src={url(name, 960)}
      srcset={WIDTHS.map((w) => `${url(name, w)} ${w}w`).join(", ")}
      sizes={sizes}
      width={1600}
      height={Math.round(1600 * RATIO[name])}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchpriority={eager ? "high" : undefined}
    />
  );
}

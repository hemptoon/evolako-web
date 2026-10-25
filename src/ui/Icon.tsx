import { h } from "preact";
import { ICONS, type IconName } from "./icon-data";

export type { IconName };

interface Props {
  name: IconName;
  size?: number;
  class?: string;
  /** Icons are decorative by default; pass a label only when the icon alone carries meaning. */
  label?: string;
}

/** One consistent 1.75 px line set (Lucide subset, ISC). */
export function Icon({ name, size, class: className, label }: Props) {
  const nodes = ICONS[name];
  return h(
    "svg",
    {
      class: className ? `icon ${className}` : "icon",
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      "aria-hidden": label ? undefined : "true",
      role: label ? "img" : undefined,
      "aria-label": label,
      focusable: "false",
    },
    nodes.map(([tag, attrs], i) => h(tag, { ...attrs, key: i })),
  );
}

// Serbian Cyrillic for Moj Evolako: the texts are never written by hand — they are the Serbian (Latin) texts run
// through evo-cyr.mjs, the transliteration cut out of the evolako.rs engine (do not edit its rules here: the site
// and the apps must give the same result; a word that comes out wrong gets an exception in its KX / KP lists).
//
// evo-cyr.mjs knows running text, not format strings: "%d" would come out as "%д". A placeholder (%@, %lld, %1$@,
// %d, %s, {name}) therefore stands in as a number while the text is transliterated and is put back untouched —
// a number is what it mostly is, so "%@ A" keeps its unit exactly like "16 A" does on the site.
import { cyr } from "./evo-cyr.mjs";

const PLACEHOLDER = /%(?:\d+\$)?(?:@|lld|ld|lu|d|s|f|\.\d+f)|\{[A-Za-z_][A-Za-z0-9_]*\}/g;
/** A run of digits no text contains: 990 + the placeholder's index (two digits) + 099. */
const mark = (index) => `990${String(index).padStart(2, "0")}099`;
const MARK = /990(\d\d)099/g;

/** One text in Cyrillic; placeholders stay as they are. */
export function cyrText(text) {
  if (typeof text !== "string" || text === "") return text;
  const kept = [];
  const masked = text.replace(PLACEHOLDER, (p) => mark(kept.push(p) - 1));
  return cyr(masked).replace(MARK, (_m, index) => kept[Number(index)]);
}

/** A catalog value: a text, or plural forms ({one, few, other}). */
export function cyrValue(value) {
  if (typeof value === "string") return cyrText(value);
  return Object.fromEntries(Object.entries(value).map(([form, text]) => [form, cyrText(text)]));
}

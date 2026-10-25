// Builds src/i18n/strings.json — the web app's string catalog.
//
// Like the app's build_catalog.py: keys are collected from the sources (t("…"), tp("…"), tIn(l, "…"), msg("…")),
// each key takes the app's translations VERBATIM from vendor/ios/Localizable.xcstrings when the app has it, and
// otherwise from src/i18n/web.json. Fails when a key has no translation in one of sr/en/ru, when web.json keeps a
// key the sources no longer use, or when web.json redefines a key the app already translates.
// Serbian Cyrillic ("sr-Cyrl") is never translated or written by hand: every Serbian text goes through cyrValue()
// (src/i18n/cyrillic.mjs — the transliteration of evolako.rs) and lands in the catalog and in lang/sr-Cyrl.json.
// Run: node scripts/make_strings.mjs   (--check: verify strings.json is up to date, write nothing)
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cyrValue } from "../src/i18n/cyrillic.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const LANGS = ["sr", "en", "ru"];
/** Generated from "sr", so it needs no translation of its own. */
const CYRILLIC = "sr-Cyrl";
/** The order of a catalog entry and of the files in src/i18n/lang. */
const FILES = ["sr", CYRILLIC, "en", "ru"];
const APP_LANG = { sr: "sr-Latn", en: "en", ru: "ru" };

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

export function collectKeys() {
  const keys = new Set();
  const pattern = /\b(?:t|tp|msg)\(\s*"((?:[^"\\]|\\.)*)"|\btIn\(\s*[\w.]+\s*,\s*"((?:[^"\\]|\\.)*)"/g;
  for (const file of walk(join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f))) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(pattern)) keys.add(JSON.parse(`"${m[1] ?? m[2]}"`));
  }
  return keys;
}

function appValue(entry, lang) {
  const loc = entry?.localizations?.[APP_LANG[lang]];
  if (!loc) return null;
  if (loc.stringUnit) return loc.stringUnit.value;
  const plural = loc.variations?.plural;
  if (!plural) return null;
  return Object.fromEntries(Object.entries(plural).map(([k, v]) => [k, v.stringUnit.value]));
}

export function build() {
  const app = JSON.parse(readFileSync(join(root, "vendor/ios/Localizable.xcstrings"), "utf8")).strings;
  const web = JSON.parse(readFileSync(join(root, "src/i18n/web.json"), "utf8"));
  const keys = [...collectKeys()].sort((a, b) => a.localeCompare(b, "sr"));
  const out = {};
  const errors = [];
  for (const key of keys) {
    const fromApp = app[key];
    if (fromApp && web[key]) errors.push(`web.json redefines an app key (reuse the app's): ${key}`);
    const entry = {};
    for (const lang of LANGS) {
      const value = fromApp ? appValue(fromApp, lang) : web[key]?.[lang];
      if (value === null || value === undefined || value === "") errors.push(`no ${lang} for: ${key}`);
      entry[lang] = value;
      if (lang === "sr" && value) entry[CYRILLIC] = cyrValue(value);
    }
    out[key] = entry;
  }
  for (const key of Object.keys(web)) {
    if (!keys.includes(key)) errors.push(`web.json key not used in the sources: ${key}`);
  }
  return { out, errors, keys };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { out, errors, keys } = build();
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  // The whole catalog (review, tests) and one file per language: the app ships Serbian in the main chunk and
  // loads Cyrillic, English or Russian only when they are chosen.
  const files = { "src/i18n/strings.json": JSON.stringify(out, null, 1) + "\n" };
  for (const lang of FILES) {
    const one = Object.fromEntries(Object.entries(out).map(([key, entry]) => [key, entry[lang]]));
    files[`src/i18n/lang/${lang}.json`] = JSON.stringify(one) + "\n";
  }
  if (process.argv.includes("--check")) {
    for (const [file, text] of Object.entries(files)) {
      let current = "";
      try {
        current = readFileSync(join(root, file), "utf8");
      } catch {
        // missing
      }
      if (current !== text) {
        console.error(`${file} is out of date — run node scripts/make_strings.mjs`);
        process.exit(1);
      }
    }
    console.log(`${keys.length} keys, up to date`);
  } else {
    mkdirSync(join(root, "src/i18n/lang"), { recursive: true });
    for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
    const app = JSON.parse(readFileSync(join(root, "vendor/ios/Localizable.xcstrings"), "utf8")).strings;
    const reused = keys.filter((k) => app[k]).length;
    console.log(`${keys.length} keys (${reused} from the app catalog, ${keys.length - reused} web)`);
  }
}

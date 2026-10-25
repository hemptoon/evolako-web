// Generates dist/sw.js at the end of the production build.
//
// The service worker caches only the app shell and our own static assets: the
// HTML, the hashed JS/CSS chunks, the fonts, the icons and the runtime config.
// API responses are never cached — the API lives on another origin and the
// worker does not touch cross-origin requests at all.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";

const TEMPLATE = fileURLToPath(new URL("./sw-template.js", import.meta.url));
const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Files that belong to the shell and are precached on install. */
export function isShellFile(name: string): boolean {
  if (name.endsWith(".map")) return false;
  if (name.startsWith("_")) return false; // _headers, _redirects
  if (name === "sw.js" || name === "boot.js") return name === "boot.js";
  if (/\.(js|css|woff2|webmanifest)$/.test(name)) return true;
  if (name.startsWith("icons/")) return true;
  return name === "index.html" || name === "config.json" || name === "favicon.svg";
}

export function swPlugin(): Plugin {
  return {
    name: "evolako-sw",
    apply: "build",
    generateBundle(_options, bundle) {
      const publicFiles = ["index.html", "config.json", "boot.js", "manifest.webmanifest", "favicon.svg",
        "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png"];
      const names = [...new Set([...Object.keys(bundle), ...publicFiles])].filter(isShellFile).sort();
      // The version follows the content, not only the names: boot.js and the icons keep their names between
      // releases, and the worker serves them from its cache until the version changes.
      const hash = createHash("sha256");
      for (const name of names) {
        hash.update(`${name}\n`);
        const item = bundle[name];
        // index.html is emitted after this hook (its chunk names are in `names` already): hash its source.
        if (item) hash.update(item.type === "chunk" ? item.code : item.source);
        else hash.update(readFileSync(ROOT + (name === "index.html" ? name : `public/${name}`)));
      }
      const version = hash.digest("hex").slice(0, 12);
      const urls = names.map((n) => (n === "index.html" ? "/" : `/${n}`));
      const source = readFileSync(TEMPLATE, "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(urls, null, 2));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

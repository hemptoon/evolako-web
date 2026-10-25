// A static server that behaves like Cloudflare Pages for this project: files from dist/, the headers of
// dist/_headers (path patterns with * splats, headers of every matching rule are merged) and the rewrites of
// dist/_redirects (`/* /index.html 200`). An existing file always wins over a rewrite (Pages' asset shadowing).
// Usage: node tests/e2e/serve.mjs dist 4173
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "dist");
const port = Number(process.argv[3] ?? 4173);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".ico": "image/x-icon",
};

function pattern(path) {
  const escaped = path.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/:\w+/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

function readRules(file) {
  try {
    return readFileSync(join(root, file), "utf8");
  } catch {
    return "";
  }
}

function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) {
      const index = line.indexOf(":");
      if (current && index > 0) current.headers.push([line.slice(0, index).trim(), line.slice(index + 1).trim()]);
    } else {
      current = { match: pattern(line.trim()), headers: [] };
      rules.push(current);
    }
  }
  return rules;
}

function parseRedirects(text) {
  return text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const [from, to, status = "301"] = line.split(/\s+/);
      return { match: pattern(from), to, status: Number(status) };
    });
}

const headerRules = parseHeaders(readRules("_headers"));
const redirectRules = parseRedirects(readRules("_redirects"));

function fileFor(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null; // "/obracuni/%": no such file — the SPA fallback answers, as on Pages
  }
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const candidates = [join(root, clean)];
  if (clean.endsWith("/")) candidates.push(join(root, clean, "index.html"));
  for (const candidate of candidates) {
    if (!candidate.startsWith(root)) continue;
    try {
      if (statSync(candidate).isFile()) return candidate;
    } catch {
      // not there
    }
  }
  return null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let pathname = url.pathname;
  let file = pathname === "/" ? join(root, "index.html") : fileFor(pathname);
  if (!file) {
    const rule = redirectRules.find((r) => r.match.test(pathname));
    if (rule && rule.status === 200) {
      pathname = rule.to;
      file = fileFor(rule.to);
    } else if (rule) {
      res.writeHead(rule.status, { Location: rule.to });
      res.end();
      return;
    }
  }
  if (!file || file.endsWith("/_headers") || file.endsWith("/_redirects")) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  const headers = { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" };
  const served = file === join(root, "index.html") ? "/index.html" : pathname;
  for (const rule of headerRules) {
    if (rule.match.test(url.pathname) || rule.match.test(served)) {
      for (const [name, value] of rule.headers) headers[name] = value;
    }
  }
  res.writeHead(200, headers);
  res.end(req.method === "HEAD" ? undefined : readFileSync(file));
});

server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root} on http://127.0.0.1:${port}`);
});

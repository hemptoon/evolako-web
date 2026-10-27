# www.evolako.rs — own static site (work in progress)

Decision 27.10.2026: www.evolako.rs moves off Webflow to an own static build, like blokvolt.rs (GitHub → Cloudflare
Pages). This folder is the workspace for that move. **Nothing here is deployed yet**: the live site is still Webflow
until the founders say the word for the switch, and the app (app.evolako.rs, the rest of this repository) is not
affected.

Plan (details in the project document "Evolako — переезд с Webflow"):

1. **Snapshot** — the workflow `.github/workflows/site-snapshot.yml` (branch `site-migration`) copies the published
   site into `snapshot/` (see below). Done; repeat right before the switch.
2. **Build** — `build.py` turns the snapshot into `dist/`: own copies of every file, no Webflow or Google at runtime,
   own form endpoint, CSP. Done (steps 2 and 2b). Still to come: real `/en/` and `/ru/` pages prerendered from the
   dictionaries, sitemap with hreflang.
3. **Preview** — a separate Cloudflare Pages project (`evolako-site`, noindex on `*.pages.dev`), compared page by
   page with the live site.
4. **Switch** — only on the founders' word: custom domains www.evolako.rs and evolako.rs move to the new project;
   rollback = point them back to Webflow (the Webflow plan stays active for a month). The scheduled guide/news tasks
   move from the Webflow API to commits here at the same time.

## Snapshot (what the workflow copies)

Only the GitHub runner reaches the live site, so the copy is made there and committed back to `site-migration`.

- `tools/snapshot.py` — static crawl: every page of `sitemap.xml` (+ the 404), every stylesheet, script, image, font
  and file the HTML and CSS name, robots.txt, sitemap.xml. Google Fonts is asked with a Chrome User-Agent, so the copy
  holds the variable woff2 files visitors get (they are byte-identical to `@fontsource-variable/onest` 5.3.1).
- `tools/snapshot_runtime.py` — runtime capture (Playwright 1.63.0 + its Chromium, pinned by version and sha256 in
  `tools/requirements-snapshot.txt`): every page and the 404 in the four language modes (Serbian, `?lang=en`,
  `?lang=ru`, `?lang=sr-cyrl`) at 1440 and 390 px, each load in a fresh browser; it scrolls, loads lazy images and
  saves everything the browser loads — about 180 scripts whose URLs scripts build at runtime (EN/RU dictionaries of the
  i18n engine and its loader, the cookie-consent pack, the i18n fixes) — as manifest entries `"runtime": true` with
  the pages, modes and the script that started them (`initiators`). Live services (evo-fx, the exchange-rate file,
  the BlokVolt map embed with its data and tiles) are saved as `"live": true`: QA replays them, the build never copies
  them. **Nothing is sent or counted during the capture**: non-GET requests, the visit counter, Cloudflare Web
  Analytics, Turnstile, webflow.com endpoints and analytics hosts are aborted, no form is submitted and the cookie
  banner is never answered.
- `snapshot/manifest.json` — source URL → local file, status, bytes, type, sha256, pages; `runtime` = summary of the
  capture (loads, modes, what was aborted, errors).

**Taking the final snapshot (right before the switch):** change `snapshot.request` (e.g. the date) and push to
`site-migration`, or Actions → "Site snapshot" → Run workflow. About 10 minutes. The job fails if a mode never
switched the language, if Google Fonts came without woff2, or if fewer than 50 runtime files were saved. Then
`git pull --rebase`, `python3 site/build.py`, and the three checks below. No manual fetches: the snapshot is always
the workflow's output. (`snapshot-fill/` held three GSAP files an old `.gitignore` rule had dropped; the snapshot has
them itself now, so the build no longer takes anything from there.)

## Build

`python3 site/build.py` — snapshot → `site/dist/` (never committed; standard library only; the same snapshot gives a
byte-identical dist):

- every page at its current URL (`kontakt.html` serves `/kontakt`), `<html lang="sr">` static (the i18n engine still
  switches EN/RU/Cyrillic in the browser), every file under `/_a/<host>/<path>` with every reference rewritten
- **runtime URLs**: scripts that build Webflow CDN URLs from a base + `<assetId>%2F<name>-1.0.0.js` get the local base
  `/_a/cdn.prod.website-files.com/<site>/<folder>/` and real slashes (no local path depends on an encoded `%2F`);
  the runtime files a built page or a copied file starts are copied; the build checks every `<assetId>/<name>` entry
  of those maps against `dist`
- **fonts**: the WebFont loader is replaced by the local Google Fonts CSS (Onest, variable woff2, one face per subset
  over weights 300–900: Latin, Latin Extended, Cyrillic, Cyrillic Extended, …), the OFL licence
  (`licenses/Onest-OFL.txt`, the licence file of `@fontsource-variable/onest` 5.3.1, whose woff2 files are the same
  bytes) next to the font files; resource hints to Webflow/Google/jsDelivr dropped
- **forms**: see below
- **`_headers`**: security headers, cache rules and a **Content-Security-Policy per page** — sha256 of each inline
  script after all rewrites, `'self'`, the live hosts the page really uses (from the runtime capture), the endpoints
  only an interaction reaches (map search/routes), `'unsafe-inline'` for styles only. `/*` (also unknown paths, which
  get `404.html`) carries the 404's policy; every page rule removes it (`! Content-Security-Policy`) and sets its own.
  Pages allows 100 rules and 2,000 characters per line; the build stops if either is exceeded (the longest policy is
  ~1,860 characters — if a page grows past the limit, move its inline scripts to files or its policy to the
  middleware)
- `_routes.json`: Functions run for pages and `/f/*`, not for `/_a/*`

Hosts the built site still uses at runtime, on purpose: `app.evolako.rs` (evo-fx, the visit counter `/s/p`,
`/zgrada/broj`, the career forms `/kr`), the Supabase public file evo-fx reads rates from, `www.blokvolt.rs` (map
embed on `/mapa-punjaca`, which itself loads MapLibre 5.24.0 from cdn.jsdelivr.net and tiles from
tiles.openfreemap.org — only the BlokVolt embed could change that, in its own repository), Cloudflare Web Analytics
(`static.cloudflareinsights.com`, loaded by the consent loader on every page), and — **only after a visitor clicks
"Dozvoli"** in the cookie banner — Google Analytics 4 and the Meta pixel, as on the Webflow site (decision
11.10.2026). The CSP allows exactly those (`CSP_CONSENT_ANALYTICS` in `build.py`, from Google's and Meta's
published lists; empty it to run with no Google/Meta at all). If Google Signals or Ads features are switched on in the
GA4 property, their hosts (`https://*.g.doubleclick.net`, `https://*.google.com`, `https://*.google.rs`) have to be
added too — mind the 2,000-character line limit. The Webflow editor and badge code inside `webflow.js` is still in the file but never runs here
(it needs `?edit` / a `*.webflow.io` domain) and the CSP blocks it.

## Forms

- `webflow.js` (local copy) posts to `/f/6ab19bf9a3bb86f8fb7bba00` instead of `https://webflow.com/api/v1/form/…`,
  so everything it did stays: field collection incl. the hidden fields the widgets add, the 5-second rule of the
  validation script, success/failure blocks (`.w-form-done` / `.w-form-fail`). Webflow's Turnstile sitekey is
  removed (it kept the real submit disabled until a Turnstile token came; the Turnstile box is gone from the forms).
- `functions/f/[site].js` (Pages Function) turns the post into exactly what Webflow's `form_submission` webhook gave
  the CRM bot and hands it over through the service binding `BOT`:
  `POST https://evolako-bot.internal/wf/<HOOK>` with
  `{"triggerType":"form_submission","payload":{"siteId":"6ab19bf9a3bb86f8fb7bba00","id":"<24 hex>","name":"<data-name>","data":{…},"submittedAt":"<ISO>","source":"evolako.rs"}}`.
  The bot does not change (it dedupes by `id`, routes by `Tip` / form name). The answer `{"code":200}` shows the
  success block; any refusal or bot error shows the failure block.
- Accepted forms: `Kontakt`, `Kviz prijava`, `Preporuka prijava`, `Prijava zgrade`, `B2B upit` (9 pages); the build
  stops if a page has another sendable Webflow form. The home calculator ("Html Form") can never be sent. The four
  career forms keep posting to `app.evolako.rs/kr` (not Webflow forms).
- Anti-spam without secrets: Origin must be `https://www.evolako.rs` or `https://evolako.rs` (and `Sec-Fetch-Site:
  same-origin` when sent); body ≤ 32 KB, ≤ 40 fields, names ≤ 80 and values ≤ 5,000 characters; a hidden honeypot
  field `website` in every form (filled → normal-looking success, nothing forwarded); **per-IP limit, best effort: 8
  forms per 10 minutes per client IP, counted in the memory of the Cloudflare isolate** — each data center and isolate
  counts separately and forgets on restart, so it only slows a flood from one address. For a hard limit add a
  rate-limiting rule for `/f/*` in the zone (Security → WAF → Rate limiting rules, e.g. 10 requests / 10 minutes per
  IP; optional). The function never logs field values or the HOOK.

**What the founder sets in the Pages project (Settings → Variables and Secrets / Bindings), Production:**

| name | kind | value |
|---|---|---|
| `BOT` | service binding | the CRM bot worker (the one Webflow's webhook reached) |
| `HOOK` | secret (encrypted) | the bot's own `HOOK` value, the part after `/wf/` in the webhook URL (≥ 16 characters) |
| `FORMS_ALLOW_PREVIEW` | variable, optional | `1` only for a deliberate end-to-end test on a `*.pages.dev` preview — those forms then reach the real bot; remove afterwards |

Without `BOT` or `HOOK` every form shows the failure block (nothing is lost silently).

## Checks (all local, nothing leaves the machine)

- `node site/tools/forms_unit.mjs` — the endpoint with a fake bot: payload format, decoding, origin rules, limits,
  honeypot, missing configuration, bot answers, per-IP limit, no HOOK or field value in logs.
- `python3 site/tools/forms_e2e.py` — every sendable form in Chromium on `wrangler pages dev` (real Functions
  runtime, `_headers` with the CSP) with `tools/fake_bot/worker.js` as `BOT` and a fake HOOK; the same steps on the
  original page with the Webflow POST caught in the browser; asserts the exact JSON the bot gets equals what Webflow
  got (plus `Paket`, referral code, quiz, B2B `Segment`/`Kalk`, building fields), the success blocks, that the home
  calculator never sends, that an invalid referral code blocks, the honeypot, and the refused origin. Needs wrangler
  (`WRANGLER=<binary>` or `npx --yes wrangler@4.151.0`).
- `python3 site/tools/qa_dist.py --shots <folder outside the repo> [--shard 1/2]` — every page + 404 × 1440/390 ×
  4 modes: status, console errors, failed local requests, CSP violations (the `_headers` rules applied as Pages applies
  them), requests to forbidden hosts (Webflow, its CDNs, Google Fonts/ajax, jsDelivr; the BlokVolt embed's own
  requests are listed apart), links, fonts, and text + pixels against the original page replayed from the snapshot
  in the same mode. `--merge part*.json` joins shards.
- `site/functions/_middleware.js` — `X-Robots-Tag: noindex, nofollow` on every host except www.evolako.rs and
  evolako.rs. Pages project: root directory `site`, output `dist` (`wrangler pages deploy dist` must run from `site/`,
  so that `functions/` is picked up). Rocket Loader must stay off for evolako.rs: it rewrites the script tags and the
  CSP hashes would no longer match.

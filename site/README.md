# www.evolako.rs — own static site (live since 28.10.2026)

Decision 27.10.2026: www.evolako.rs moves off Webflow to an own static build, like blokvolt.rs (GitHub → Cloudflare
Pages). **Switched on 28.10.2026 (15:36–15:45):** the custom domains www.evolako.rs and evolako.rs point at the
Cloudflare Pages project `evolako-site`, which this folder builds (branch `site-migration`). The app (app.evolako.rs,
the rest of this repository) is not affected. Rollback to Webflow is possible only until ≈ 20.11.2026 (its plan is not
renewed): DNS `www` → CNAME `cdn.webflow.com` (DNS only), apex → A `198.202.211.1`, then remove the custom domains in
Pages; after that, a rollback is an earlier deployment of `evolako-site` (Pages → Deployments → Rollback).

How the site is made (details below):

1. **Snapshot** — `snapshot/` is the copy of the published Webflow site of 28.10.2026 13:22 UTC (static crawl + runtime
   capture). **Frozen since the switch**: a new crawl would copy this build itself, so the workflow
   `.github/workflows/site-snapshot.yml` runs only by hand and stops while www.evolako.rs is the own build.
2. **Content** — guides, news and B2B guides published after the switch are JSON in `content/` (format and the
   publishing steps: `content/README.md`; code: `content.py`, rules: the kits in `kits/`). The scheduled tasks publish
   by committing there.
3. **Build** — `build.py` turns snapshot + content into `dist/`: own copies of every file, no Webflow or Google at
   runtime, own form endpoint, CSP, real `/en/` and `/ru/` pages prerendered from the dictionaries, sitemap with
   hreflang.
4. **Deploy** — the workflow `.github/workflows/site-preview.yml` ("Site preview", the name of the preview phase) builds,
   runs the offline checks, uploads to `evolako-site` (production) and smoke-tests www.evolako.rs. It runs on a push to
   `site-migration` that changes `content/**` (a publication — allowed to the scheduled tasks after their checks),
   `deploy.request` (code or snapshot changes — only on the founders' word, one line per deploy) or `preview.request`
   (the file of the preview phase). Everything committed to `site-migration` must be ready for production: the next
   content commit deploys it too.

## Publishing guides, news and B2B guides (since 28.10.2026)

The Webflow pipelines (pages duplicated in the Designer, footer dictionaries, publish) are gone. A scheduled task
writes the item's JSON into `content/` (same schema and copy rules as before — the kits `kits/evc.py` and
`kits/evb_vodic.py` are the code those pipelines used, now in the repository), checks it (`python3 site/content.py
check <item>`), builds, runs the offline QA on the new and changed pages and commits; the push deploys. Step by step:
`content/README.md`.

What `content.py` does with an item (checked by `tools/content_selftest.py`: the guides and news items Webflow
published are read back from the snapshot, rendered again and must come out identical — 8 guides and 2 news items):

- a guide becomes a copy of the newest published guide of its kind (`komsija-puni-iz-zajednicke-uticnice` for
  residents, `garaza-za-izdavanje-sa-punjacem` for B2B) with its own head (title, description, og/twitter texts,
  canonical, og:url, JSON-LD Article), hero, cover photo and sections — the kits' markup written the way Webflow
  publishes it. Navigation, footer, scripts and styles stay those of the published page;
- its card goes first into `/vodici` (B2B: last on `/punjaci-za-firme`, first on the segment page of its CTA) and into
  the hub's JSON-LD ItemList; a news item goes on top of `/novosti` and into its ItemList (the 30 newest);
- the EN/RU texts of the item go into the build-time dictionaries of the pages that show them, so the `/en/` and `/ru/`
  versions are complete (the build stops on a missing head/JSON-LD translation, QA on Serbian text left);
- new pages carry no dictionary script of their own, so their inline scripts are those every guide has: they are
  served with the policy of `/*` (the 404 policy plus those script hashes) and need no `_headers` rule (Pages allows
  100; the build reports which pages share it);
- photos: only those of the kits' table that the snapshot holds (`FULL_FALLBACK` replaces the five full-size photos it
  lacks); sitemap.xml gets the new pages and the new lastmod of the changed hubs.

## Changing a published page (code or snapshot)

Pages of the Webflow era live in `snapshot/pages/<slug>.html`; the build makes `/en/` and `/ru/` from them. A change
there (a text, a script tag) is a production deploy: `python3 site/build.py` (no `BUILD ERROR`), `python3
site/tools/qa_dist.py --shots /tmp/evo-shots --pages <slug> --no-reference` (0 issues), a line in `deploy.request`, push
to `site-migration` — only on the founders' word. New Serbian text needs its EN/RU pairs in `i18n/en.json` and
`i18n/ru.json`: the build stops on text it cannot translate. A new `<title>` also needs the page in `RETITLED`
(`build.py`) with the old title: the build otherwise compares the `/en/` and `/ru/` title with what the Webflow engine
showed (the i18n harvest) and stops. Pages with a quiz (`/proveri-svoju-garazu`, `/preporuka`) show only the first
step, so `qa_dist.py --no-reference` reports their text as low: run those two without `--no-reference`.

**«Cela Srbija» (28.10.2026):** Evolako works in the whole country (decision 27.10). The coverage texts (footer of every
page, `/kontakt`, the home page, the B2B pages and their FAQ, the careers pages for electricians, the media kit),
JSON-LD `areaServed` (one Country, Srbija — also in the kits), the quiz (other cities get a package, not a waiting
list) and the social image (`og/evolako-og-sr.png`, now also on the Serbian pages) were changed in the snapshot pages;
their EN/RU pairs are in `i18n/en.json` / `ru.json`.

**The BlokVolt map embed on `/mapa-punjaca`** (the "evomap" of github.com/hemptoon/blokvolt-rs, its RUNBOOK 3.25): the
tag is near the end of `snapshot/pages/mapa-punjaca.html` —
`<script src="https://www.blokvolt.rs/assets/embed/evomap-<10 hex>.js" integrity="sha384-…" crossorigin="anonymous">`.
A new build of the map: blokvolt.rs is deployed first (the new file next to the old ones), then only `src` and
`integrity` change here (the head `<style>` block "Mapa punjača — izgled (evomap)" only if `evomap.css` changed),
build + QA, a `deploy.request` line, push on the founders' word, then check the live tag and its SRI. The CSP allows
`https://www.blokvolt.rs` as a host, so a new file name needs no CSP change.

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

- every page at its current URL (`kontakt.html` serves `/kontakt`), `<html lang="sr">` static (Cyrillic stays a
  browser mode of the Serbian page), plus `en/<slug>.html` and `ru/<slug>.html` (see "Languages"), every file under
  `/_a/<host>/<path>` with every reference rewritten
- **names of changed files**: `/_a/*` is cached as immutable for a year, so a path must never serve other bytes.
  Every copied file whose bytes the build changes (the Webflow CSS after its `url()` rewrite, `webflow.js`, the
  scripts with a rewritten CDN base or a path patch, the Google Fonts CSS — 13 files now) gets the sha256 of its new
  content in its name: `<name>.h<10 hex><ext>`, or `<name>.h<10 hex>-1.0.0.js` for the scripts that runtime URL maps
  load as `'<assetId>/<name>' + '-1.0.0.js'` (the map entries are rewritten to the new names). Unchanged copies keep
  their names — the same bytes as on the original CDN. Names and contents depend on each other (a file names the files
  it loads), so the rewrite repeats until no name moves (3 passes now); the build stops if a changed runtime file is
  loaded some other way (e.g. the engine's dictionary files, which it names by pieces — if one of them ever needs a
  patch, the engine's map has to learn the new name first)
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

## Languages (step 3)

On the Webflow site every page has one URL and the i18n engine (an inline script in the head) swaps Serbian text for
English or Russian in the browser, so search engines only ever see Serbian. The build now writes each page three
times: `/<slug>` (Serbian, as before), `/en/<slug>` and `/ru/<slug>` (home: `/`, `/en/`, `/ru/`), same slugs.

- **Text** — `prerender.py` applies, at build time, the dictionaries the live page really has in that language:
  `i18n/harvest.json`, the engine's final dictionaries per page and language, captured by `tools/i18n_harvest.py`
  from the snapshot replay (fixed load order, two delays; a key whose value depends on timing stops the build if a
  page uses it). Lookup, normalization and skip rules are the engine's own (`tools/i18n_selftest.py` runs the engine's
  functions in node against the Python copy). What the live site never translated (titles, meta descriptions,
  JSON-LD, a few texts) comes from `i18n/en.json` and `i18n/ru.json` — keyed by the engine's hash of the Serbian
  text, each entry with its Serbian source (the build checks the key) — and is used only where the live dictionaries
  have nothing. `i18n/keep.json` lists texts that stay as they are (brands, package names, language names, titles of
  Serbian sources …) with the reason. **The build stops** if a static text of an `/en/` or `/ru/` page has no
  translation and is not in `keep.json` (it writes `site/i18n-missing.json`, not committed; `--allow-missing` only
  for development), if an own translation uses a word the copy rules ban (atest, discount/скидка, 24/7, Plug&Charge,
  "immediately"/«сразу», "we handle the paperwork"-type phrases) or drops a number of the Serbian text.
- **Head** — static `<html lang="en|ru">`, translated `<title>`, meta description, og/twitter texts, `og:locale`
  (sr_RS / en_US / ru_RU), canonical to itself, `hreflang` sr/en/ru + `x-default` (Serbian) on all three versions,
  `og:url` of the page. JSON-LD in the page language: strings translated, page URLs and `@id`s moved to the
  language's URLs (`/#org`, `/#organization`, `/#website` and the organization's own url stay shared),
  `inLanguage` = the page language; the social image (og:image and the JSON-LD `image`) of the pages that use the
  default Webflow picture is the same design drawn with code — `og/evolako-og-<sr|en|ru>.png` (since 28.10.2026 the
  Serbian pages too: the Webflow picture names three cities, Evolako works in the whole country), by
  `tools/og_images.py` (fonts and logo from `dist`, no model; `--check` compares a rendering of the original Serbian
  text with the original), copied to `/_a/evo-og/` with the content hash in the name; the FAQPage of
  `/cesta-pitanja`, `/en/` and `/ru/cesta-pitanja` is generated
  from the questions and answers the page shows (each structured question of the Webflow embed takes the text of the
  visible `<details>` block it stands for; on the live site 5 of the 8 were worded differently). `sitemap.xml`: every page in sr, en, ru with `xhtml:link` alternates; `robots.txt`
  unchanged; the 404 stays Serbian-only. `llms.txt` (llmstxt.org, 28.10.2026) — `site/llms.txt`, written by hand in
  English and checked by the build against the built pages (links, RSD amounts, words the copy never uses); edit it
  together with the prices and pages it names.
- **Engine on `/en/`, `/ru/`** — still runs (widgets write Serbian text at runtime) but locked to the page language;
  it also consults the own translations last (`_a/evo-i18n/<lang>.<sha>.js`). Scripts that read the page path see
  the Serbian one (`window.EVO_PATH`), so the bot (`Stranica`), the visit counter, GA page paths and the career
  backend get the same values as today; `Jezik` in the forms is the page language. Internal links on `/en/` and
  `/ru/` pages point to the same language (static and at runtime).
- **Switching = navigation** — the language menu (header and footer chips) links to the same page in the other
  language; Cyrillic stays a mode of the Serbian page (`?lang=sr-cyrl`). Old links `?lang=en|ru` on a Serbian path
  get a **301** to `/en/…` or `/ru/…` from `functions/_middleware.js`, other parameters kept (`?paket=wallbox`,
  `?ref=…`); `?lang=sr-cyrl` passes. No Accept-Language or IP redirect. **A remembered choice** (`localStorage bvl`
  = en/ru, set by an earlier visit) moves a visitor who arrives on a Serbian page from outside (another site, a
  bookmark, typed) to the matching `/en/` or `/ru/` URL; clicking "Srpski" on an English or Russian page counts as
  choosing Serbian, and reload/back/forward never redirect. Reason: the URL always tells the language (shareable
  links, no Serbian URL showing English), and there is one English and one Russian rendering to maintain and test.
  Crawlers have no remembered choice, so they always get the page of the URL.
- **Updating translations** — when the live texts change: new snapshot (workflow), `python3 site/tools/i18n_harvest.py`
  (~4 min), `python3 site/build.py`; add what the build reports as missing to `i18n/en.json` / `i18n/ru.json`
  (key = `prerender.key_of(serbian text)`), build again, run the checks below.
- Scripts the build patches for this (exact strings, each applied exactly as often as expected or the build stops):
  `ENGINE_PATCHES`, `INLINE_PATCHES`, `FILE_PATCHES` in `prerender.py`. The patched copied files get a content hash
  in their names (see "Build"), so a later change to a patch reaches returning visitors.

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
- Accepted forms: `Kontakt`, `Kviz prijava`, `Preporuka prijava`, `Prijava zgrade`, `B2B upit` (9 pages, each also
  at `/en/` and `/ru/`: same form names and fields, `Jezik` = the page language; the `Kontakt` form, which never had
  `Jezik`, gets it as a hidden field set at build time — `sr`, `en`, `ru` — so the CRM card shows in which language to
  answer); the build stops if a page has another sendable Webflow form. The home calculator ("Html Form") can never be sent. The four
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
  4 versions (Serbian, Serbian Cyrillic, `/en/`, `/ru/`): status, `<html lang>`, console errors, failed local
  requests, CSP violations (the `_headers` rules applied as Pages applies them), requests to forbidden hosts (Webflow,
  its CDNs, Google Fonts/ajax, jsDelivr; the BlokVolt embed's own requests are listed apart), links incl. canonical
  and hreflang, app links with the page's `?lang=`, fonts, JSON-LD (parses; FAQPage = visible FAQ), Serbian left on
  `/en/` and `/ru/` (texts the BlokVolt map embed renders from its own data — station names, addresses — are
  listed apart), and text + pixels against the original page replayed from the snapshot in the same language
  (`?lang=`); a text difference counts as explained only where an own translation, a load-timing variant or the
  hidden legal-data placeholder turns the original's words into exactly the built ones. Then interactions: language switching by both menus on five pages, the `?lang=` redirects, the
  remembered choice, back/forward, Cyrillic (also when chosen on an /en/ or /ru/ page and reloaded), cookie banner, A4
  notice, map search, the map's station card (its network logo from www.blokvolt.rs must pass the CSP).
  `--merge part*.json` joins shards.
- `python3 site/tools/compare_builds.py --old <dist built from the previous commit>` — the Serbian pages and every
  other file equal the earlier build except for exactly the step-3 changes (engine/script patches, language menu as
  links, hreflang, `_headers`, `sitemap.xml`, new `en/`, `ru/`, `_a/evo-i18n/`).
- `python3 site/tools/i18n_selftest.py` — the prerender's copy of the engine's text functions equals the engine.
- `node site/tools/middleware_unit.mjs` — the `?lang=` redirects (parameters kept, `sr-cyrl` untouched, GET/HEAD only),
  the bare domain → www and the noindex header.
- `python3 site/tools/diff_builds.py --old <earlier dist> --expect <pattern> …` — for every later change: what the new
  build changes against an earlier one, with the content hash taken out of names and contents (a file that only moved
  because a file it names moved does not count); exit code 1 if a file outside the `--expect` patterns differs.
- `site/functions/_middleware.js` — 301 for old `?lang=en|ru` links (see "Languages"); 301 from the bare domain
  evolako.rs to the same path on https://www.evolako.rs (GET/HEAD; one step with the `?lang=` target);
  `X-Robots-Tag: noindex, nofollow` on every host except www.evolako.rs and evolako.rs. Pages project: root directory `site`, output `dist` (`wrangler pages deploy dist` must run from `site/`,
  so that `functions/` is picked up). Rocket Loader must stay off for evolako.rs: it rewrites the script tags and the
  CSP hashes would no longer match.

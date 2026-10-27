# www.evolako.rs — own static site (work in progress)

Decision 27.10.2026: www.evolako.rs moves off Webflow to an own static build, like blokvolt.rs (GitHub → Cloudflare
Pages). This folder is the workspace for that move. **Nothing here is deployed yet**: the live site is still Webflow
until the founders say the word for the switch, and the app (app.evolako.rs, the rest of this repository) is not
affected.

Plan (details in the project document "Evolako — переезд с Webflow"):

1. **Snapshot** — `tools/snapshot.py`, run by the workflow `.github/workflows/site-snapshot.yml` on the branch
   `site-migration`, copies every published page, the CSS/JS/images/fonts/files they use, robots.txt and the sitemap
   into `snapshot/`, with `snapshot/manifest.json` (source URL → local file, size, sha256, which pages use it). To take
   a fresh copy, change `snapshot.request` and push.
2. **Build** — a build step turns the snapshot into `dist/`: own asset URLs instead of the Webflow CDN, Webflow's
   form backend replaced by a Pages Function that hands the form to the CRM bot through the service binding `BOT`,
   real `/en/` and `/ru/` pages prerendered from the existing dictionaries (today EN/RU exist only in the browser, so
   search engines see Serbian only), sitemap with hreflang, `_headers`, `_redirects`.
3. **Preview** — a separate Cloudflare Pages project (`evolako-site`, noindex on `*.pages.dev`), compared page by
   page with the live site (screenshots, forms, links, structured data).
4. **Switch** — only on the founders' word: custom domains www.evolako.rs and evolako.rs move to the new project;
   rollback = point them back to Webflow (the Webflow plan stays active for a month). The scheduled guide/news tasks
   are switched from the Webflow API to commits here at the same time.

## Build and local QA (step 2, parity build)

- `python3 site/build.py` — snapshot → `site/dist/` (never committed): every page at its current URL (`kontakt.html`
  serves `/kontakt`), every file the pages use under `/_a/<host>/<path>`, own 404, robots.txt, sitemap.xml, `_headers`,
  `_routes.json`. Standard library only; the same snapshot gives a byte-identical dist. Forms are still Webflow forms.
- `site/functions/_middleware.js` (Pages Functions) — `X-Robots-Tag: noindex, nofollow` on every host except
  www.evolako.rs and evolako.rs. Pages project: root directory `site`, output `dist` (a `wrangler pages deploy dist`
  must run from `site/`, so that `functions/` is picked up).
- `site/snapshot-fill/` — files the manifest lists but the committed snapshot lacks (GSAP 3.15.0: the root `.gitignore`
  rule `dist/` dropped `…/gsap@3.15/dist/` from the snapshot commit; now excluded from that rule). The build uses a
  fill file only if its sha256 equals the manifest's.
- `python3 site/tools/qa_dist.py --shots <folder outside the repo> [--langs en,ru]` — serves dist like Pages, opens
  every page in Chromium (Playwright) at 1440 and 390 px, compares it with the original page replayed from the
  snapshot (text and pixels), checks links and forms, and lists every request that leaves the site.

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

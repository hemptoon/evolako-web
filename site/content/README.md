# site/content — guides, news and B2B guides of www.evolako.rs (since the switch, 28.10.2026)

www.evolako.rs is served by this repository's own build (Cloudflare Pages project `evolako-site`). The Webflow
snapshot of 28.10.2026 is frozen; everything published after the switch lives here as JSON and is put on the site by
`site/build.py` (code: `site/content.py`). **A commit that changes this folder on the branch `site-migration` deploys
the site to production** (workflow "Site preview", `.github/workflows/site-preview.yml`) — after the same checks as on
a laptop and with a smoke test of every page of this folder on www.evolako.rs.

| folder | what | kit (rules, unchanged from Webflow) | where it shows |
|---|---|---|---|
| `vodici/<page>/` | guide for residents, tone «ti» | `site/kits/evc.py` | new page `/<page>` (+ `/en/`, `/ru/`), card first on `/vodici`, sitemap |
| `b2b/<page>/` | B2B guide, tone «vi» | `site/kits/evb_vodic.py` | new page `/<page>`, card last on `/punjaci-za-firme` and first on the segment page of its CTA |
| `novosti/<id>.json` | news item | `site/kits/evc.py` (`newscheck`) | first on `/novosti` (newest first), its JSON-LD |

A guide folder holds `sr.json`, `en.json`, `ru.json` (the schema of the project document
`claude/Evolako_B2B_Vodici_Pipeline_2026-09-30.md` §5, guides for residents: `claude/Evolako_Vodici_Novosti_Pipeline_2026-09-30.md`
§5.1 — the same JSON the Webflow pipelines wrote) and `meta.json`:

```json
{"date": "2026-10-29"}
```

`date` is the publication date: «Ažurirano: …» under the title, the transparency line under the sources, the JSON-LD
dates, the sitemap. The folder name is the `page` of `sr.json` (the slug without `/`). A news item is one file
`novosti/<id>.json` = `{"sr": {…}, "en": {…}, "ru": {…}}` exactly as the news pipeline writes it; `id` starts with its
`date`.

## Publishing one item (what a scheduled task does)

1. Write access first (`add_repo` hemptoon/evolako-web, push), then
   `git clone https://github.com/hemptoon/evolako-web && cd evolako-web && git checkout site-migration`.
2. Write the files of the item (and nothing else).
3. `python3 site/content.py check site/content/vodici/<page>` (or `b2b/<page>`, `novosti/<id>.json`) → `0 errors`.
   Every warning "number … is not in the fact base" must be a number its source in "Izvori" states.
4. `python3 site/build.py | tail -25` → no `BUILD ERROR`; the line `content (site/content): …` names the new page and
   the changed pages. `python3 site/tools/content_selftest.py` → all ok.
5. Offline QA of the new and the changed pages (needs Playwright, preinstalled):
   `python3 site/tools/qa_dist.py --shots /tmp/evo-shots --pages <page>,vodici --no-reference --no-interactions --keep-shots all`
   (B2B: `<page>,punjaci-za-firme,<segment>`; news: `novosti`) → `0 issues`. Open the screenshots of the new page
   (`/tmp/evo-shots/<page>__sr__1440.png`, `…__390.png`): the cover photo must be whole (no cut face, head, car or
   charger), the text and the cards readable.
6. Commit only the item: `git add site/content/<…> && git commit -m "Content: <guide|news|B2B guide> <slug or id>"`
   (author `Evolako <hello@evolako.com>`) → `git push origin HEAD:site-migration` (rejected: `git pull --rebase`,
   steps 4–5 again, push).
7. The push starts the workflow "Site preview": build, checks, upload, smoke test on www.evolako.rs (the new page in
   sr/en/ru with its H1, the news id on /novosti). Wait for it (≈ 3–5 minutes):
   `curl -s "https://api.github.com/repos/hemptoon/evolako-web/actions/runs?branch=site-migration&per_page=5"` →
   the run of your commit (`head_sha`) `status: completed`, `conclusion: success`. A failure leaves the live site as it
   was: report the failed step, do not work around it.

A correction is a commit that changes the item (and its `date` if the change is material). Removing an item is only
done by a founder (Claude deletes nothing). Photos: only the photos of the kits' table that the frozen snapshot holds
(a full-size photo it lacks is replaced by a close one, `FULL_FALLBACK` in `site/content.py`); new images are not
supported yet.

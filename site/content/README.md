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
| `gradovi/gradovi.json` | city pages (28.10.2026) | `site/gradovi.py` (texts and `check()`) | `/ugradnja-punjaca` (all cities by region) and `/ugradnja-punjaca-<grad>` (+ `/en/`, `/ru/`), sitemap; footer link «Ugradnja po gradovima» and `/kontakt` link to the hub |
| `hoteli/mesta.json` | resort pages for hotels and vacation rentals (17.11.2026) | `site/hoteli.py` + `site/klasteri.py` (`check()`), B2B kit, tone «vi» | `/punjaci-za-hotele-<mesto>` (+ `/en/`, `/ru/`), sitemap; a card last on `/punjaci-za-hotele` |
| `modeli/modeli.json` | a home charger by car (17.11.2026) | `site/modeli.py` + `site/klasteri.py`, residents' kit, tone «ti» | `/kucni-punjac-po-modelu` (hub, in the footer) and `/kucni-punjac-za-<auto>`, sitemap |
| `marke/marke.json` | installing a charger the customer already has (17.11.2026) | `site/marke.py` + `site/klasteri.py`, residents' kit, tone «ti» | `/samo-ugradnja-punjaca` (hub, in the footer) and `/ugradnja-<punjač>`, sitemap |

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

## City pages (`gradovi/gradovi.json`, since 28.10.2026)

Evolako works in the whole country (decision 27.10.2026). `gradovi.json` holds Belgrade and the 27 cities of
the Law on territorial organisation (art. 20) in Vojvodina and central Serbia: slug, names and locatives (sr «u
<loc>», en, ru with its preposition), region (NSTJ 2) and night-tariff area — written by hand — and, per city, the
public-charging facts of the BlokVolt charger map (`public`, `map`), which only `site/tools/gradovi_data.py` writes.
The texts are templates in `site/gradovi.py` (sr «ti», en, ru «ты»), filled with each city's own data (its public
chargers within 25 km, the strongest one or the nearest fast one, the networks, the lower-tariff hours of its area,
local parking facts for Belgrade, Novi Sad and Niš), so no page is a copy with another city name. `check()` keeps the
copy rules (and no visit deadline, no "PDV", no local-electrician claim, every number of the Serbian text in the
translations); the build stops on an error.

Refresh the facts (monthly, or after a big change of the map), then build, QA, commit as a content change:

```
git clone --depth 1 https://github.com/hemptoon/blokvolt-rs /tmp/bv           # read-only
python3 site/tools/gradovi_data.py --blokvolt /tmp/bv --date <YYYY-MM-DD>      # "date" = Ažurirano on the pages
python3 site/content.py check && python3 site/build.py | tail -5
python3 site/tools/qa_dist.py --shots /tmp/evo-shots --pages ugradnja-punjaca,ugradnja-punjaca-beograd,ugradnja-punjaca-bor --no-reference --no-interactions
```

A new city: add it to `cities` (the name must be a town of BlokVolt `scripts/map_data.py` TOWNS), run the tool, check
its page in the three languages. Prices in the texts follow `/paketi-i-cene`: when a package price changes, change
`PRICES_ROWS` / `PRICES_MORE` in `site/gradovi.py` in the same commit.

## Resorts, cars and charger brands (`hoteli/`, `modeli/`, `marke/`, since 17.11.2026)

Three page families of the SEO plan (§4.1 в, г, д), made like the city pages: the facts are data, the texts are
templates in three languages filled with each page's own data, so no page is a copy with another name. The shared
parts are in `site/klasteri.py`: the document builder, the article markup — with a visible FAQ (`<details>`), from
which the build makes the FAQPage of every language — the JSON-LD pieces (Service, BreadcrumbList, FAQPage) and
`check()`: the copy rules of the kits, no "PDV", 72 h only with the wording of the site, no reviews or counts of
installations, no claim that the Evolako app controls a charger, the tone of the family, every number of the Serbian
text in the translations, title ≤ 60 and description 70–155 in the three languages, links only to pages of the site,
www.blokvolt.rs or shop.evolako.rs. The build stops on an error.

**Resorts — `hoteli/mesta.json`, `site/hoteli.py`** (B2B kit, «vi»). Written by hand: the places with their name
forms (sr «na Kopaoniku / na Kopaonik / do Kopaonika», en, ru), `kind` (planina, banja), the two routes (from Beograd
and Novi Sad: km, minutes and the fast chargers along, each with its kilometre) and the two sources of the winter
paragraph (`winter`: ADAC, Recurrent — the quoted sentences are in the file). Written by `site/tools/hoteli_data.py`
from the BlokVolt charger map: `public` (locations in the town area, how many with DC ≥ 50 kW, the strongest, the
networks, how many stand at places to stay and how many of those are for guests only), the `facts` of each route (the
last fast charger and how far the place is after it) and `map`. The offer on the page (per-spot prices, the three
examples, the steps) repeats `/punjaci-za-hotele`; when that page changes, change `hoteli.py` with it. The
subscription price is not named (rule of the B2B kit).

```
git clone --depth 1 https://github.com/hemptoon/blokvolt-rs /tmp/bv            # read-only
python3 site/tools/hoteli_data.py --blokvolt /tmp/bv --date <YYYY-MM-DD>        # add --routes fetch to ask the router again
```

A new place: add it to `places` (slug, town as BlokVolt names it, name forms, `kind`, `centre`), run the tool with
`--routes fetch` (needs access to routing.openstreetmap.de; on 16.11.2026 the routes were computed in a browser and
typed in), check the page. Only places with a sign of demand (SEO plan §4): on 16.11.2026 Sokobanja, Palić, Divčibare
and Tara had none and have no page.

**Cars — `modeli/modeli.json`, `site/modeli.py`** («ti»). Per model: the versions (battery, on-board AC charger,
phases, the manufacturer's own charging times) and the texts only that model has (lead, facts, which package fits,
two questions), each fact from a document under `sources`. The page computes, the same way everywhere and says so:
time = capacity × 1,10 ÷ power from 0 to 100%; on a three-phase 11 kW wallbox a car takes min(its charger, phases ×
3,7 kW); a full battery at night = capacity × 1,10 × `tariff.rsd_kwh` (the lower tariff of the blue zone with all
fees and taxes; `tariff.valid_from` = the EPS price list, `tariff.checked` = when it was last looked up on eps.rs).
`kind` says what the capacity is (neto, bruto, nominal, pr = one figure of the maker, adac = ADAC's net figure where
the maker publishes none); `ph: 0` = the documents read do not state the phases (the page says «nije navedeno»);
`cells` replaces a computed cell by the maker's statement where the calculation would mislead. When EPS changes its
price list, change `tariff` (and the same figures in `gradovi.py`, if they moved).

**Charger brands — `marke/marke.json`, `site/marke.py`** («ti»), for the installation-only package. Per charger:
versions, the protection and the conductors exactly as the manufacturer's manual states them, what to check before
buying, the warranty as the manufacturer (or a named Serbian seller, with the date) states it, and the product in
shop.evolako.rs. Not on these pages, on purpose: controlling a charger from the Evolako app (it does not do that —
the page names the manufacturer's app) and a monthly statement for a charger bought elsewhere.

The date a page shows («Ažurirano»), its sitemap lastmod and the dates of its JSON-LD are the top-level `date` of the
family's file: change it by hand when the pages change materially. `checked`, next to it, is the day the facts were last
read in their sources: the line under «Izvori» shows it («podaci su provereni …»); change it only after reading the
sources again. The dates of single facts are separate (`map.checked`, `routing.date`, `winter.*.checked`,
`tariff.checked`). English pages write every date the American way («November 16, 2026», `klasteri.american()`), also
in the title of a source, so that 06.10.2025 is not read as June 10.

After any change: `python3 site/content.py check` → `0 errors`; `python3 site/tools/klasteri_keep.py --write` when a
place, a car, a version or a charger was added (names that stay the same in every language go to `i18n/keep.json`);
`python3 site/build.py`; QA of the changed pages as for a guide (`--pages <slug>,…`, all modes and both widths, look
at the screenshots at 1440 and 390: the tables scroll sideways on a phone, so the two columns that matter come
first). Covers: only photos of the kits' table (`COVER`, `COVERS` in the modules).

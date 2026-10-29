Naselja of Serbia for the quiz «Gde je parking?» — provenance (29.10.2026)

What the site ships
  site/public/kviz-naselja.json (served at /kviz-naselja.json, noindex; the quiz loads it when the place field gets
  focus) is written by site/tools/naselja_kviz.py from two committed files:
    site/data/naselja-srbija.json   4709 naselja of Serbia without AP Kosovo i Metohija: n (Latin name), c (Cyrillic
                                    name), o (opština / grad / gradska opština), r (region), p (population, census
                                    2022, used only to order the list)
    site/data/naselja-sinonimi.json city districts and quarters, city municipalities and spelling variants: s (alias),
                                    c (Cyrillic alias), n + o (the naselje it means), k (kind), trap (also a village
                                    elsewhere)
  No coordinates are committed or shipped. The quiz file holds names, opštine and the zone of each opština only.

Sources and terms
  * Republički zavod za statistiku (RZS), open data — «Izvor: Republički zavod za statistiku»: the list of naselja
    (1201IND01, data for 2025) and the population of the 2022 census (Popis 2022). The page shows «Spisak mesta:
    Republički zavod za statistiku» under the field.
  * Wikidata (CC0): identifiers and Cyrillic/Latin names used to cross-check the RZS list.
  * Names of city quarters: the city-quarter lists of sr.wikipedia.org (CC BY-SA), read on 29.10.2026 — names only.
  * OpenStreetMap (ODbL): used only to verify coordinates while the list was built. Nothing OSM-derived is committed
    or shipped (raw/ stays out of the repository; the browser scripts fetch it again).

How to rebuild
  1. build_browser.js (in a browser tab: RZS and Wikidata) and crosscheck_osm_browser.js (OSM checks) write the input
     tables into raw/ (not committed); build.py builds naselja-srbija.json from them and checks their SHA-256;
     kvartovi_browser.js + build_sinonimi.py build naselja-sinonimi.json. report.txt is the build report (Russian):
     counts per region, okrug and opština against RZS, every correction, the synonyms.
  2. Copy n, c, o, r, p of naselja-srbija.json into site/data/naselja-srbija.json (no lat/lon) and the synonyms into
     site/data/naselja-sinonimi.json.
  3. python3 site/tools/naselja_kviz.py --src site/data/naselja-srbija.json --syn site/data/naselja-sinonimi.json
     -> site/public/kviz-naselja.json; then build the site and run the checks (forms_e2e covers the quiz).

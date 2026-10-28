# site/kits — the content kits of the Webflow pipelines

The two scripts the scheduled tasks used to write guides and news on Webflow (28.09–28.10.2026), copied unchanged from
the project documents on 28.10.2026, the day of the switch:

| file | was | sha256 (first 16) | used for |
|---|---|---|---|
| `evc.py` | `claude/Evolako_Kit_evc_py.md` (KIT block `evc`, v1.3 of 26.10.2026) | `6f3dbd9bba38b485` | guides for residents and news: `check`, `newscheck`, rendering |
| `evb_vodic.py` | `claude/Evolako_B2B_Vodici_Pipeline_2026-09-30.md` §9 (KIT block `evb`, v1.3 of 26.10.2026) | `b52bcbe26577f65b` | B2B guides: `check`, rendering |
| `lint_sr.py` | `claude/Evolako_Vodici_lint_sr.py.md` (v1 of 21.09.2026) | `9f2468d5421b5d8b` | Serbian linter of the B2B pipeline (spylls + the LibreOffice sr-Latn dictionary next to it; tone «vi» — on guides for residents its «ti» notes are expected) |

`site/content.py` imports them: the JSON schema, the copy rules (`check()`, `newscheck()`: forbidden words, tone,
links, numbers, structure of EN/RU) and the markup (`render_section()`, `render_item()`, `jsonld()`) are exactly those
of the pages Webflow published (`site/tools/content_selftest.py` proves it on 8 guides and 2 news items). The parts
that wrote Webflow steps (`build`, `preflight`, `verify`, `hubinit`, `newsinit`, the element ids) are no longer used.
`content.py` sets their link lists (every guide of the site) and uses one photo table for both (`evb_vodic.py`'s:
photo 2 v2, photos 17 and 18).

Changing a rule = changing the kit here (and noting it in the pipeline document of the project); the hashes above then
change too.

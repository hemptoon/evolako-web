# site-embed — valuta prikaza za www.evolako.rs

Skripta koju Webflow sajt www.evolako.rs učitava sa app.evolako.rs (Webflow „hosted script“ sa SRI).
Spec: `docs/VALUTA_SPEC_2026-10-06.md`.

- `fx.js` — zajedničko jezgro (isto kao `static/assets/fx.js` na blokvolt.rs; menjati oba).
- `evo-fx-init.js` — Evolako: prekidač u `.mega-nav__lang` i `.v3-lang`, dopisivanje „· ≈ 502 €“ uz cene
  (dinari ostaju prvi), napomena iznad futera, kurs iz javnog sadržaja (`content/v1/manifest.json` → `fx`).
- Gradnja: `bash site-embed/build.sh` → `public/embed/evo-fx-<sha10>.js` i SRI u izlazu. Novi fajl = novo ime;
  u Webflow-u registrovati novu verziju skripte (stara ostaje dok se ne zameni).
- Testovi: `node site-embed/tests/fx.test.js && node site-embed/tests/fx.append.test.js` (jsdom).

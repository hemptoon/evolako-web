# Moj Evolako — go-live checklist

Cloudflare Pages project **`evolako-app`**, Direct Upload of `dist/` (no Git integration), custom domain
**`app.evolako.rs`**. Each step says who acts. The founders log in to Cloudflare, Supabase and the DNS host
themselves; a Claude session prepares the files and commands, and never deploys without their go-ahead.

There are two stages:

- **A — demo only.** No backend is needed, so it can go out whenever the founders decide.
- **B — live sign-in.** This needs the backend from `backend/docs/DEPLOY.md` in the iOS repo.

---

## 0. Before anything

- [ ] `npm ci && npm run check` is green: strings, types, unit tests, build, e2e.
- [ ] `dist/` contains these files at its root:
  - `index.html`, `sw.js`, `boot.js`, `config.json`, `robots.txt`;
  - `_headers`, `_redirects`;
  - `manifest.webmanifest`, `favicon.svg`;
  - the folders `assets/`, `icons/`, `licenses/` and `posta/` (at least `posta/index.json`, see step 8);
  - `.well-known/assetlinks.json` — a hidden folder: `ls -a dist`. It lets the Android app open the site's links
    (README, "Android App Links").
- [ ] Prefer a zip for a dashboard upload. Its files must sit at the zip root (no enclosing folder):
  `cd dist && zip -r -X ../evolako-web-dist.zip .`

## 1. `config.json` for the stage (in `dist/`, no rebuild needed)

| Stage | `dist/config.json` |
| --- | --- |
| A — demo only | `{"apiBase": "", "publishableKey": "", "demo": true}` (as built) |
| B — live, before the DNS move (until 27.10.2026) | `{"apiBase": "<the API Worker's workers.dev address>", "publishableKey": "sb_publishable_…", "demo": true}` |
| B — live, after `api.evolako.rs` works (production since 27.10.2026) | `{"apiBase": "https://api.evolako.rs", "publishableKey": "sb_publishable_…", "demo": true}` |
| B + Google (13.10.2026) | the line above plus `"googleClientId": "936328602255-httlmmrs4ktooaechkqrslmvduh6t0pg.apps.googleusercontent.com", "googleOrigins": ["https://app.evolako.rs"]` |

- `demo: false` hides the demo once real accounts should be the only way in.
- `googleClientId` / `googleOrigins`: sign-in with Google (README, "Demo and live"). The client and its redirect URI
  `https://app.evolako.rs/auth/google` live in Google Cloud, project `evolako` → Google Auth Platform → Clients
  ("Moj Evolako web"); Supabase Auth → Sign In / Providers → Google lists the same client ID (and the iOS one).
  A preview on `*.evolako-app.pages.dev` is not a registered origin, so the button does not show there.
- Sign-in appears only when **both** `apiBase` and `publishableKey` are set.
- The API origin must be in `connect-src` of `dist/_headers`. Both origins above are already there. If the API ever
  moves, edit `public/_headers` too.
- The publishable key is public by design (it goes to every browser). Never put a `sb_secret_…` key here.

## 2. Create the Pages project (once): founders in Cloudflare

Either in the dashboard:

- [ ] Workers & Pages → **Create application** → **Pages** → **Upload assets** (Direct Upload), then name the
  project `evolako-app`.
- [ ] Upload `evolako-web-dist.zip` (or the `dist` folder) and choose **Deploy site**.
- [ ] The site is at `https://evolako-app.pages.dev`.

Or with Wrangler, from the repo:

```sh
npx wrangler@4 login                                     # opens the browser; a founder confirms
npx wrangler@4 pages project create evolako-app --production-branch main
npx wrangler@4 pages deploy dist --project-name evolako-app --branch main --commit-dirty=true
```

- A Direct Upload project cannot be switched to Git integration later.
- `--branch <other>` makes a preview at `https://<other>.evolako-app.pages.dev`, plus a per-deploy hash URL.
  Pages marks previews `noindex` by itself; the app does so everywhere anyway.

## 3. Smoke test on `https://evolako-app.pages.dev`

```sh
U=https://evolako-app.pages.dev
curl -s  $U/robots.txt                                   # User-agent: * / Allow: /.well-known/assetlinks.json / Disallow: /
curl -sI $U/.well-known/assetlinks.json | grep -iE '^HTTP|content-type|location'   # 200, application/json, no location
curl -sI $U/ | grep -iE 'content-security-policy|x-robots-tag|strict-transport|x-frame-options'
curl -sI $U/obracuni/2026-09 | head -1                   # HTTP/2 200 (SPA fallback serves index.html)
curl -s  $U/config.json                                  # the values from step 1
curl -sI $U/sw.js | grep -i cache-control                # no-cache
curl -s  $U/posta/index.json                             # {"issues": []} (or the issues being published, step 8)
curl -sI $U/posta/index.json | grep -iE 'content-type|cache-control'   # application/json, no-cache
```

- [ ] `robots.txt` answers with the three lines, and `X-Robots-Tag: noindex, nofollow` is on every response.
- [ ] `/.well-known/assetlinks.json` answers 200 with `content-type: application/json` and without a redirect — on
  `app.evolako.rs` itself once the domain is attached (Google reads it from there, not from `pages.dev`).
- [ ] A deep link (`/obracuni/2026-09`, `/profil/nalog`) loads the app directly.
  - The build has no `404.html`, so Pages serves `index.html` for unknown paths (its SPA mode).
  - If the deploy log says the `_redirects` rule `/* /index.html 200` was ignored as an infinite loop, that is
    expected on Pages. The fallback above does the same job; only this check matters.
- [ ] In a browser (private window):
  - [ ] `/prijava` → **Pogledaj demo** → the wallbox demo;
  - [ ] Danas shows the ring;
  - [ ] Statistika, Obračuni → a statement → **Sačuvaj PDF**;
  - [ ] the devtools console has no errors and no CSP violations.
- [ ] `/#podesavanja` ends on `/prijava?next=%2Fprofil%2Fnalog` when signed out, or on `/profil/nalog` in the demo.
- [ ] `/prijava?lang=en` switches to English, and the address loses `?lang=`.
- [ ] `/prijava?lang=sr-Cyrl` shows Cyrillic ("Пријава"), the language button reads "СР", and its menu lists
  Srpski · latinica, Српски · ћирилица, English, Русский.
- [ ] Evolako pismo pages: `/pismo/nema-2099` says "Ova stranica ne postoji."; `/pismo` without a link says
  "Link nije ispravan." (stage B) or "U demou ovo nije dostupno…" (stage A) — and sends nothing.
- [ ] Install as an app (Chrome or Safari "Add to Home Screen"). It opens standalone, and a reload offline shows
  the shell.

## 4. Custom domain `app.evolako.rs`: founders in Cloudflare and at the DNS host

The order matters. Attach the domain in Pages **first**, and only then create the DNS record. A CNAME that points
at `pages.dev` before the domain is attached in Pages ends in a **522** error.

- [ ] Pages → `evolako-app` → **Custom domains** → **Set up a custom domain** → `app.evolako.rs` → Continue.
- [ ] At the DNS host of `evolako.rs`, add a record. Per the backend's DEPLOY.md, the zone is at mCloud today, not
  at Cloudflare.

  | Type | Name | Target | TTL |
  | --- | --- | --- | --- |
  | CNAME | `app` | `evolako-app.pages.dev` | default |

  - A subdomain works with an external DNS; only an apex would need the zone on Cloudflare.
  - If the zone has **CAA** records, they must also allow the authorities Cloudflare uses for Pages certificates
    (today `letsencrypt.org`, `pki.goog` and `ssl.com`; see Cloudflare's CAA documentation).
- [ ] Wait until Pages shows the domain as **Active**, with the certificate issued. This usually takes minutes, but
  allow up to a day for DNS.
- [ ] Repeat step 3 with `U=https://app.evolako.rs`.
- [ ] If `evolako.rs` moves to Cloudflare DNS later, Pages manages the record itself. Delete the old CNAME at the
  old host only after the move.

## 5. Backend CORS: only if the app must reach the API from `*.pages.dev`

The Worker already allows `https://app.evolako.rs`, `https://www.evolako.rs` and `http://localhost:*`.
`docs/backend-cors.patch` adds `https://evolako-app.pages.dev` and its preview subdomains. It is **not applied
anywhere**. Apply it only if live sign-in must work on the `pages.dev` address, for example before the custom
domain is active or for previews.

- [ ] In the iOS repo:

  ```sh
  git apply --check /path/to/evolako-web/docs/backend-cors.patch
  git apply /path/to/evolako-web/docs/backend-cors.patch
  ```

- [ ] Run the Worker's tests, then `cd backend/worker && npx wrangler deploy`. A founder confirms the Cloudflare
  login.
- [ ] Verify:

  ```sh
  curl -si -X OPTIONS https://api.evolako.rs/rest/v1/rpc/api_current_user \
       -H 'Origin: https://evolako-app.pages.dev' -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
  # access-control-allow-origin: https://evolako-app.pages.dev
  ```

  (Before the DNS move the check used the Worker's `workers.dev` address; since 27.10.2026 production uses `api.evolako.rs`.)
- [ ] Once everyone uses `app.evolako.rs`, the `pages.dev` entry can stay (only this Cloudflare account can
  publish there) or be reverted.

## 6. Stage B — live sign-in

Preconditions, from `backend/docs/DEPLOY.md` in the iOS repo:

- [ ] Its check section passes: `/health`, and an OTP e-mail arrives in SR/EN/RU with a **6-digit code**.
- [ ] `/auth/v1/verify` returns a token, and `rpc/api_current_user` answers.
- [ ] The web app signs in with the code only, never with a magic link, so the code e-mail must show the code. The
  backend's `email-hook` does. Supabase Redirect URLs already contain `https://app.evolako.rs/auth`; nothing else
  in Auth changes for the web.
- [ ] The publishable key (`sb_publishable_…`) is at hand.

Go live:

- [ ] Set `dist/config.json` for stage B (step 1) and redeploy. It is the same command, or a new upload in the
  dashboard; unchanged files are deduplicated.
- [ ] Test with a real e-mail from an assessment request:
  - [ ] `/prijava` → the e-mail → the code arrives → signed in;
  - [ ] a lead sees **Moja prijava** with the request status;
  - [ ] a customer with an installed kit sees **Danas**.
- [ ] Wrong code → "Kod nije tačan ili je istekao…". Too many attempts → the words "Previše pokušaja…".
- [ ] Keep two tabs open past the access token's lifetime (1 h). Both stay signed in, because the refresh is
  serialized with `navigator.locks`. Signing out in one tab signs out the other right away.
- [ ] **APP_LINK** (a backend variable) is `https://app.evolako.rs` — set so on 29.09.2026, and it must stay so. The
  e-mail buttons "Otvori Evolako" and the footer link "Podešavanja obaveštenja" (`APP_LINK#podesavanja`) open this
  app; since Evolako pismo the e-mails also link to `APP_LINK/pismo`, `/odjava` and `/pismo/<slug>`, and the
  backend's `newsletter-tick` reads `APP_LINK/posta/index.json`. A forwarding page such as `www.evolako.rs/app` would
  break all of these.
- [ ] The pages call `POST <apiBase>/functions/v1/newsletter` from `https://app.evolako.rs`; the Worker answers the
  preflight (use the `apiBase` of `dist/config.json`):

  ```sh
  curl -si -X OPTIONS https://api.evolako.rs/functions/v1/newsletter -H 'Origin: https://app.evolako.rs' \
       -H 'Access-Control-Request-Method: POST' | grep -i access-control-allow-origin
  # access-control-allow-origin: https://app.evolako.rs
  ```

- [ ] Display currency (display-currency spec of 06.10.2026, internal). The backend with migration
  `20261006000100_display_currency.sql` and the `fx` step of `content-build` must be out before or together with
  this release; without it the web works on the local choice and the fallback rate of 05.10.2026.
  - `curl -s https://api.evolako.rs/content/v1/manifest.json | grep -o '"fx":{[^}]*}'` — the document is there;
  - signed in: Nalog → Valuta → EUR → Pretplata reads "990 RSD · ≈ 8,43 €" (at the current rate), the note shows
    the NBS list's date; the iOS app on the same account shows EUR after its next refresh, and back;
  - a statement and its print stay in dinars.
- [ ] Evolako pismo, with hello@evolako.com only (the backend's `Docs/NEWSLETTER_BRIEF_2026-09-29.md` §2.6):
  - a sign-up with `source: "team"` → the e-mail "Potvrdi prijavu na Evolako pismo" → its button opens
    `/pismo?t=…&l=sr` → "Potvrdi prijavu" → "Hvala — prijava je potvrđena.";
  - the footer link "Odjavi se od saveta i novosti" of a marketing e-mail → `/odjava` → "Odjavi me" →
    "Odjavljen si.";
  - sign up and confirm again: hello@ stays subscribed (the team gets every issue).

## 7. Rollback and later releases

- **Rollback:** Pages → `evolako-app` → Deployments → a previous deployment → **Rollback to this deployment**. This
  is instant.
- **A config mistake:** fix `dist/config.json` and redeploy. No rebuild is needed.
- **A release:**
  1. `npm run check`.
  2. Set `dist/config.json` for the current stage. The build always writes the demo-only defaults from
     `public/config.json`.
  3. Deploy.
  4. Installed apps show "Stigla je nova verzija — Osveži" and reload only when the person taps.
- **Keep the account out of search:** keep `robots.txt`, `X-Robots-Tag` and the noindex meta as they are. The one
  `Allow` line in `robots.txt` is for `/.well-known/assetlinks.json` only (README, "Android App Links").
- **Keep `public/posta/` in the repo.** Every release ships `posta/index.json` and the issue files from
  `public/posta/`. A file put only into `dist/` disappears with the next release — and an issue approved but not yet
  sent loses its approval when `index.json` no longer lists it.

## 8. Evolako pismo: publishing an issue

An issue is a file, not an admin screen. The backend's `Docs/NEWSLETTER.md` is the operator guide (format, preview,
approval by hash, stop); this is the app's side. A Claude session prepares the files and the founders approve.

1. Add `public/posta/<slug>.json` (`<slug>`: `^[a-z0-9-]{3,40}$`, e.g. `2026-10`) and, if the issue has a cover,
   `public/posta/<slug>.jpg` (16:9, about 1600 px wide, JPEG or WebP, a few hundred KB at most; it must be on this
   site: the CSP allows images from `self` only).
2. Add `{"slug": "<slug>", "status": "preview"}` to `public/posta/index.json`. Keep it valid JSON without a BOM.
3. `npm run check`. The unit tests read everything in `public/posta/`: `index.json`, each issue as the web version
   reads it, and the cover of each. The backend checks the rest (links, words, sizes) and mails its errors.
4. Commit, build and deploy (a release, step 7). Check the web version at
   `https://app.evolako.rs/pismo/<slug>?lang=sr` (and `en`, `ru`).
5. Within 10 minutes three previews "[PREVIEW <hash>] …" arrive at hello@evolako.com. After the founders' "ok",
   set the entry to `"status": "approved"` with `approved_hash` (the full hash from the last preview) and `send_at`
   (with the offset, at least 10 minutes after the deploy), then commit and deploy again. Do not touch the issue file
   after the approval: any change is a new version and needs a new preview and a new "ok".
6. To stop: `"status": "stopped"` and deploy. Copies not yet sent are cancelled; a stopped issue needs a new slug.

## 9. App 1.14 (11.10.2026): meter readings, the free period, the subscription's new states

Nothing to configure here: the page `/ocitavanje`, the call `api_mark_point_activity` and the new fields of the
subscription and the statement need the backend migration `20261011000100_ocitavanje.sql`, so the two go out
**together**, backend first — the founders' helper `build/deploy/29_ocitavanje.command` in the iOS repo does both
(db push, functions, checks, then this app). For Moj Evolako it runs what step 27 ran:

```sh
npm run build
curl -fsS https://app.evolako.rs/config.json -o dist/config.json     # keep the live config
npx --yes wrangler@4 pages deploy dist --project-name evolako-app --branch main --commit-dirty=true
```

- Before the migration is live the app still works: the new fields are optional, a point is offered the readings
  only when `api_meter_readings` says `required`, and a missing `api_mark_point_activity` is ignored.
- [ ] After the deploy: `/ocitavanje` signed in with a START point shows the form and the history; with a wallbox
  that reports by itself — "Ova stranica ne postoji.".
- [ ] `/profil/pretplata` of a freshly installed point says "Probni period počinje kad prvi put otvoriš punjač…"
  only until its owner opens Danas once.
- The reminder e-mail (last day of the month, 18:00) is behind `app_config.features.meterReminderEmail`; the page
  itself is behind `features.meterPhoto` (default on). Both are changed in Supabase Studio, without a release.

## 10. Account deletion page for Google Play: `/obrisi-nalog`

The Android app's listing needs a web address where an account can be deleted without the app (README, "Account
deletion without the app"). Nothing to configure: the page ships with the app and uses the same sign-in and the same
`account-delete` function as `/profil/nalog`. It needs stage B (live sign-in) to do anything; before that it says so
and offers "Piši nam".

- [ ] After the deploy, in a private window: `https://app.evolako.rs/obrisi-nalog` opens **without** going through
  `/prijava`, in all four languages (`?lang=sr|sr-Cyrl|en|ru`), and lists what is deleted and what stays.
- [ ] `curl -sI https://app.evolako.rs/obrisi-nalog | head -1` → `HTTP/2 200` (the SPA fallback), with
  `x-robots-tag: noindex, nofollow` like every page.
- [ ] With a test account: "Prijavi se da obrišeš nalog" → the code (or "Nastavi sa Google nalogom") → back on the page with the account's e-mail →
  "Obriši nalog" → "Obrisati nalog?" → "Nalog je obrisan."; the confirmation e-mail arrives; signing in to the app
  with that address now starts an empty account.
- [ ] Play Console → App content → Data safety → "Delete account URL": `https://app.evolako.rs/obrisi-nalog`.
- If Play Console ever reports the address as unreachable although it opens in a browser: `robots.txt` closes the whole
  site to crawlers (`Disallow: /`). Add one line `Allow: /obrisi-nalog` above it, next to the `assetlinks.json` one
  (the page stays out of search by its `X-Robots-Tag` header), and adjust the `robots.txt` assertions in
  `tests/e2e/pwa.spec.ts` and `tests/unit/assetlinks.test.ts`.

# Moj Evolako — web

The web version of the Evolako customer account, planned at **https://app.evolako.rs**. It mirrors the Evolako iOS
app (same screens, copy and product rules) and talks to the same backend contract: Supabase behind the Cloudflare
Worker at `api.evolako.rs`. Until the backend is live it runs as a self-contained demo with realistic data.

Written for whoever picks this up next, human or Claude session. The go-live steps are in
[docs/DEPLOY.md](docs/DEPLOY.md).

## Quick start

```sh
npm ci              # Node >= 20; .npmrc sets legacy-peer-deps (needed by the preset's peer ranges)
npm run dev         # http://localhost:5173, demo data, no backend needed
npm run check       # strings, types, unit tests, production build, e2e: must be green before any release
```

## Stack

- **Vite 7, Preact 10 + @preact/signals, strict TypeScript.** No UI kit and no CSS framework. The CSS is our own,
  with custom properties in `src/styles/tokens.css`: light is the default, and dark lives under
  `:root[data-theme="dark"]`. Every text/background token pair is checked for contrast (4.5:1 text, 3:1 graphics)
  in `tests/unit/contrast.test.ts`.
- **Routing:** a tiny History-API router (`src/app/router.ts`) with plain `<a href>` links. Cloudflare Pages serves
  `index.html` for every path.
- **Self-hosted assets only:**
  - the Onest fonts as WOFF2 subsets;
  - a subset of Lucide icons, drawn as inline SVG;
  - Nayuki's QR generator (`src/lib/qrcodegen.ts`, MIT);
  - our own charger renders (WebP).

  There are no third-party runtime scripts, fonts or images. A strict CSP lives in `public/_headers`, and the HTML
  has no inline scripts or styles: `public/boot.js` sets the theme and language before the first paint.
- **PWA:** a manifest plus a generated service worker (`build/sw-plugin.ts` with `build/sw-template.js`).
  - It caches the shell and static files only, never an API response.
  - Navigations and `config.json` are fetched network-first.
  - A new version waits until the person taps "Osveži".
  - The worker's version is a hash of the shell files' names and contents.
- **Tests:**
  - Vitest in `tests/unit`;
  - Playwright + axe-core in `tests/e2e`;
  - jsQR, pngjs and poppler (`pdftoppm`, `pdfinfo`, `pdftotext`) for the QR and print-to-PDF checks.

## Layout

```
src/
  api/        the backend contract: types, parse (decoders), http, auth (tokens), remote (RemoteBackend),
              demo/ (DemoBackend and the seeded demo data) — screens only ever see the Backend interface;
              newsletter (the public `newsletter` function), posta (the issue file of Evolako pismo)
  app/        session (config.json, demo/live), router, links (deep links), query (cache + polling),
              data (hooks per resource), settings (theme), currency (display currency and the NBS rate),
              texts (status/enum words), contacts, pismo (the links of the Evolako pismo e-mails: address, tab storage, steps)
  i18n/       t() / tp() / msg(); strings.json and lang/*.json are GENERATED; web.json = web-only strings
  lib/        pure logic: Belgrade time, formatting, tariff and night window, payments (IPS QR, poziv na broj,
              mod 97), QR, CSV, form rules, statement rules
  screens/    one module per route: Danas, Statistika, Obracuni, Obracun, Ocitavanje, profil/*, lead/*, Prijava, Demo,
              pismo/* (Potvrda /pismo, Odjava /odjava, Pismo /pismo/<slug>), ObrisiNalog (/obrisi-nalog)
  shell/      Shell (sidebar / tab bar / top bar / demo menu), Page, Alerts, Pwa (update prompt, offline strip)
  ui/         controls, display, overlay (dialogs, drawers, menus), Icon, brand (mark + wordmark), QrCode, Render,
              money (amounts in the display currency and the note)
  content/    offline snapshots from the app: faq.json, paketi.json (byte for byte the app's; paketi v2 07.10.2026 —
              three main kits with price variants + "Još opcija": plus, premium, ugradnja), config.json
public/       _headers, _redirects, config.json, boot.js, robots.txt, manifest, icons, licenses,
              posta/ (Evolako pismo: index.json and the issue files),
              .well-known/assetlinks.json (Android App Links, see below)
scripts/      make_strings.mjs, make_fonts.py, make_images.py, make_icons.mjs
build/        the service worker plugin and template
vendor/ios/   Localizable.xcstrings copied from the iOS app
tests/        unit/, e2e/ (+ serve.mjs, mock-api.ts, helpers.ts), fixtures/api (the backend's contract fixtures),
              fixtures/posta (the backend's fixture issue — tests only, never shipped)
docs/         DEPLOY.md (go-live checklist), backend-cors.patch
```

## Scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | `tsc --noEmit` + production build into `dist/` (incl. `sw.js`) |
| `npm run preview` | serves `dist/` on :4173 exactly like Pages (headers, SPA fallback) |
| `npm test` | unit tests (Vitest) |
| `npm run test:e2e` | e2e against `dist/` (build first) |
| `npm run shots` | screenshots into `$SHOTS_DIR` (default `../shots/evolako` next to the repo) |
| `npm run check` | `strings:check` + `typecheck` + `test` + `build` + `test:e2e` |
| `npm run strings` / `strings:check` | build / verify the string catalog |
| `npm run assets` | regenerate fonts, renders, icons (needs the iOS repo at `$IOS_SRC`, Python with fonttools, brotli and Pillow) |

Playwright uses `$PW_CHROMIUM` or the sandbox's Chromium in `/opt/pw-browsers`. Elsewhere, run
`npx playwright install chromium` once.

## Runtime config: `config.json`

```json
{ "apiBase": "", "publishableKey": "", "demo": true }
```

- **`apiBase`**: the API origin, without a trailing slash. It is `https://api.evolako.rs` (since 27.10.2026; before
  that the Worker's own `workers.dev` address). Empty means demo-only mode.
- **`publishableKey`**: the Supabase publishable key (`sb_publishable_…`), sent as `apikey`. Sign-in is offered only
  when **both** `apiBase` and `publishableKey` are set.
- **`demo`**: `false` hides the demo once real sign-in exists. It is ignored while sign-in is not configured, because
  then the demo is all there is.
- **`googleClientId`** and **`googleOrigins`** (13.10.2026): sign-in with Google. The OAuth client ID of the web client
  "Moj Evolako web" in the Google Cloud project `evolako` (public, like the publishable key) and the origins
  registered for it. The button shows only on those origins (Google sends people back only to
  `https://app.evolako.rs/auth/google`), only while sign-in is configured, and only while the service's kill switch
  `app_config.features.googleLogin` is not `false`. Without them the landing is as before.

`config.json` is read at every start, with `no-cache` and network-first in the service worker. You can change it in
`dist/` (or in the uploaded folder) **without rebuilding**. Any API origin must also appear in the CSP
`connect-src` in `_headers`. Both origins above are already there.

## Demo and live

- **Demo-only** (no API configured):
  - the landing says web sign-in is coming soon and offers the demo;
  - the note "Nalog otvaramo mi, posle ugradnje kompleta." is shown.
- **Live** (`apiBase` and `publishableKey` set):
  - Sign-in is by a 6-digit code sent to the person's e-mail (`/auth/v1/otp` → `/auth/v1/verify`), or with Google:
    "Nastavi sa Google nalogom" goes to Google's account chooser with `response_type=id_token` and scope
    `openid email` (no client secret, no Google script); Google comes back to `/auth/google` with the ID token in
    the fragment, which is taken out of the address at once and sent to `/auth/v1/token?grant_type=id_token`.
    A random `state` (the return belongs to a sign-in this browser started) and nonce (Google gets its SHA-256,
    Supabase the raw value) live 10 minutes in localStorage (`evo.google`) and are spent on the way back. The
    account of that e-mail is used — an account made by a code gets Google linked to it — or a new one is made;
    a new one gets the page's language (`PATCH profiles.lang`), since the token carries none. Code:
    `src/api/google.ts`, `src/app/google.ts`, `AuthSession.signInWithIdToken`; tests: `tests/unit/google.test.ts`,
    `tests/e2e/google.spec.ts` (Google mocked).
  - The landing asks for the same e-mail as in the assessment request. People follow the assessment and
    installation, and after installation their statements and charging.
  - Accounts with charge points get the customer navigation: Danas · Statistika · Obračuni · Profil.
  - Accounts without charge points get the lead navigation: Moja prijava · Paketi · Profil.
  - With `demo: true` the demo stays reachable as a secondary button.
- **Tokens:**
  - The access token is kept in memory and the refresh token in `localStorage` (`evo.auth.refresh`).
  - The refresh runs 60 s before expiry, serialized across tabs with `navigator.locks`, because Supabase refresh
    tokens rotate and must never be refreshed twice in parallel.
  - A 401 gets one refresh, then sign-out with "Sesija je istekla".
- **Sign-out is final** (`src/api/auth.ts`):
  - Every sign-out, here or in another tab, starts a new session epoch. A refresh that began earlier is
    cancelled, or its late answer is dropped: it is never written to storage.
  - Sign-out waits up to 5 s for a refresh already on its way, then calls `POST /auth/v1/logout?scope=local`
    with the newest access token. Only this browser's session ends; the phone app stays signed in.
  - Sign-out, account deletion and an ended session forget `evo.point`, every `evo.pref.<uuid>.*` and the
    cached answers, and give the browser a **new** `evo.installId`. The next person cannot list the previous
    person's installation requests. After a deletion the landing says "Nalog je obrisan.".
- **Retries:** a network error is retried once only for reads: GET and the RPCs in `READ_ONLY_RPCS`
  (`src/api/remote.ts`). Sign-in steps, the token refresh, writes, new requests, uploads and account deletion
  go out exactly once, because an answer lost on the way may still mean the server did it.
- **Crashes:** a screen that fails to render, or a chunk gone after a release, shows "Nešto nije u redu" with
  "Osveži" (`src/shell/ErrorBoundary.tsx`). This happens per screen inside the shell, and for the whole app as
  a last resort.
- **Consents:** the API can set them but not read them back yet. The switches in Nalog show this browser's last
  choice and say so ("Poslednji izbor sa ovog uređaja").
- **The demo** lives in `src/api/demo` and is lazy-loaded, so people who sign in never download it.
  - **Dates:** anchored to *today* in Europe/Belgrade and seeded from the calendar date, so one day gives one
    dataset. History ends where today begins, so the current month is in progress.
  - **Statements:** last month's statement is issued on the 1st and due on the 15th. After the 15th it shows as
    paid, like the older ones.
  - **Accounts:**
    - *Wallbox u garaži zgrade*: a building meter, full history and a live session;
    - *Utičnica, sopstveno brojilo*: its own meter, in trial;
    - *Prijava u toku*: a signed-in lead with the assessment booked.
  - **Live session:** it started about 40 minutes ago. It is *auto* when now is inside the night window and the
    schedule is on, *manual* otherwise. It keeps running while the page is open.
  - **Demo menu:** switches the account and the point state (Punjenje u toku / Na mreži / Kvar).
  - **Persistence:** changes a visitor makes are kept per demo account in `localStorage` until "Izađi iz demoa".
  - **Payments:** demo IPS QR codes pay placeholder accounts with the purpose "PRIMER - ne placaj" and carry a
    "DEMO — ne plaćaj" overlay. Nobody must ever be able to pay to a demo code.

## Display currency (06.10.2026)

The canon is the display-currency spec of 06.10.2026 (internal project document), shared with the app and the sites.

- **Choice:** RSD always by default (no guess from language or locale), EUR or USD in Profil → Nalog i
  podešavanja → "Valuta", right under the language. Kept in `localStorage` `evo:cur`
  (`src/app/currency.ts`); signed in, also in the profile: `api_current_user().displayCurrency` is read on every
  answer and wins (the last change on any device), a change goes out at once as
  `PATCH /rest/v1/profiles?id=eq.<uid>` `{"display_currency": …}`. A failed PATCH keeps the local choice and is sent
  again at the next opening (`evo.pref.<uuid>.currencyPending`). The demo keeps it locally only.
- **Rate:** the NBS middle rate, the content document `fx` (`{apiBase}/content/v1/manifest.json` →
  `files.fx.path`, sha256 checked, sanity bounds EUR 100–140, USD 80–140), cached as `evo:fx`. No API, no document,
  an error → the cache, else the fallback constants of 05.10.2026 in `src/lib/format.ts` (`FALLBACK_FX`):
  **update them with every release.**
- **What converts** (`src/ui/money.tsx`, pure functions in `src/lib/format.ts`):
  - kind A, Evolako's own prices — dinars first, the conversion muted: Pretplata, the subscription line in Profil
    and on Danas, the kit prices in Paketi and on a kit's page ("od 94.000 RSD sa PDV · od ≈ 800 €");
  - kind B, reference amounts — the chosen currency first, dinars muted: Danas (the live cost, the month's amount),
    Statistika (the amount tile, session rows), the session drawer (cost, per-kWh prices, per-zone amounts),
    the Schedule drawer's prices; tiles and rows show only the conversion, dinars in the hint ("≈ 0,35 €");
  - the note "Iznosi u evrima i dolarima su informativni…" once at the bottom of such a page, only when the
    currency is not RSD; always under the switch.
- **Payments are only in dinars — never converted:** statements (`Obracuni`, `Obracun`, `statement/*`, print/PDF),
  the IPS QR (`lib/payments.ts`), the CSV (`lib/csv.ts`), `lib/statement.ts`, the subscription's payment history,
  Evolako pismo (`api/posta.ts`), request forms (`lib/forms.ts`) and the bill's prices in Cene struje (input copied
  from a Serbian document). Guard: `tests/unit/currency-guard.test.ts` (these modules never import the display
  currency; CSV and QR byte for byte as with RSD) and `tests/e2e/currency.spec.ts` (screen and print text).
- **Strings:** the six keys are the app's own Serbian keys, kept in `web.json` until `vendor/ios` is refreshed from
  an app catalog that has them — then delete them from `web.json` (redefining an app key fails `strings:check`).
- **Analytics:** none in the web app, so there is no `currency_changed` event here.

## Meter readings, the free period, the subscription's new states (app 1.14, 11.10.2026)

The backend side is `backend/supabase/migrations/20261011000100_ocitavanje.sql` and `backend/docs/API.md` in the iOS
repo; the brief is `Docs/V1_14_BRIEF_2026-10-11.md` there.

- **`/ocitavanje` — the monthly meter reading by photo** (`src/screens/Ocitavanje.tsx`, rules in
  `src/lib/readings.ts`), for a point billed by its MID meter with no link to the station (START, a building's shared
  line, a wallbox without a connection): `api_meter_readings(p_id).required`. For the active point of the switcher.
  - Photo from the camera (`capture="environment"`) or the gallery, re-encoded through a canvas to JPEG, the longest
    side ≤ 1600 px and ≤ 1,5 MB (`src/lib/photo.ts`) — re-encoding drops EXIF. The number: a comma or a dot, up to
    three decimals.
  - Before sending: not below the last accepted reading; above 2 000 kWh since it or 300 kWh a day —
    "Proveri broj — izgleda previše." once, and it may still be sent (then a person decides).
  - Sending: `POST /storage/v1/object/readings/<user id>/<uuid>.jpg`, then `rpc/api_submit_meter_reading`. Each goes
    out once; without a connection the photo and the number stay in the form.
  - The last 12 readings: date, value, Poslato · Prihvaćeno · Treba ponoviti, the reason of a rejection, and a
    thumbnail of the person's own photo (`GET /storage/v1/object/authenticated/readings/<photoPath>`, when the row
    scrolls into view; the blob URL is revoked on unmount).
  - Entries: a row on Obračuni with the status of the last reading; a card on Danas in the last 3 days of a month and
    the first 3 of the next one while the month has no reading that is sent or accepted. The reminder e-mail of the
    last day of the month links to `/ocitavanje`.
  - **Kill switch:** `app_config.features.meterPhoto = false` (the content document `config`, read by
    `src/app/features.ts`) hides the row, the card and the page; the server applies the same switch to `required`.
  - Demo: the socket account is read by photo, in memory (photos are not stored); the wallbox is not.
- **The free period starts with the first action with the charger** (`src/app/activity.ts`):
  `rpc/api_mark_point_activity {p_point}` when the owner opens the charger's status (Danas), the history
  (Statistika), a statement or their list, the readings, or changes the point's name, the bill's prices or the
  schedule. Once per page load and point, only while `subscription.activatedAt` is null, never in the demo, and
  never on sign-in alone (the account pages do not call it). A failure is ignored: the server starts the period on
  the 14th day anyway.
- **Pretplata:** `trialStartsBy` → "Probni period počinje kad prvi put otvoriš punjač u aplikaciji (najkasnije 14
  dana posle ugradnje)." and no date; started → "Probni period: do 14.12." — `state.until` is the first paid day, so
  the day before it. `suspendedSince` → the badge "Na čekanju", a calm line and "Plati pretplatu", which opens the
  statement of `unpaid.month` (the IPS QR as always; no fees, no interest — and no such words beyond that sentence).
  Unused free referral months are kept 12 months after a cancellation: one line in the cancel dialog and, after it
  (or whenever the server sends `keptFreeMonths`), on the page.
- **Statement:** `energyEstimated` → "Za ovaj mesec nismo dobili očitavanje…" on screen and on paper;
  `servicePart.proration` → "Pretplata za ovaj mesec: 17 od 31 dana (posle probnog perioda).".
- All new fields are optional in the decoders: a backend before the change simply sends none of them.

## Deep links

| Link | Opens |
| --- | --- |
| `/#podesavanja` (any path) | `/profil/nalog`. The backend e-mails put `APP_LINK + "#podesavanja"` in the footer ("Podešavanja obaveštenja"). |
| `?lang=sr\|sr-Cyrl\|en\|ru` on any route | That language (`cy`, `cyr` and any case also mean `sr-Cyrl` — evolako.rs sends it when it is open in Cyrillic). `boot.js` applies it, remembers it, then removes it from the address. |
| `/obracuni/YYYY-MM` | That month's statement. Any other key shows "Nema obračuna za ovaj mesec." |
| `/ocitavanje` | The meter reading by photo of the active point (the reminder and "Treba ponoviti" e-mails). A point that reports by itself, or the feature switched off: "Ova stranica ne postoji." |
| `/prijava?email=…` | The sign-in e-mail filled in, if it looks valid. Nothing is sent until the person taps. |
| `/zatrazi-procenu?ref=EVO-XXXXX` | The referral code filled in, only a valid code (case and spaces forgiven). |
| `/pismo?t=…&l=…` | Confirm an Evolako pismo sign-up (the button of the confirmation e-mail). See below. |
| `/odjava?e=…&t=…&l=…` | Unsubscribe from tips and news ("Odjavi se" in every marketing e-mail). See below. |
| `/pismo/<slug>?lang=…` | The web version of an issue ("Otvori u pregledaču" in the e-mail). See below. |
| `/obrisi-nalog` | Deleting the account without the app — the address given to Google Play. Public. See below. |

Signed out, every protected link goes to `/prijava?next=<path+query>` and returns there after sign-in (`safeNext`
allows only in-app paths). The public pages (`/pismo…`, `/odjava`, `/obrisi-nalog`) open as they are.

## Evolako pismo: `/pismo`, `/odjava`, `/pismo/<slug>`

The monthly letter's pages. The backend (evo-backend: the `newsletter` and `newsletter-tick` functions,
`Docs/NEWSLETTER.md`) sends the e-mails; these pages are where their links lead. They are public: the same page for
anyone (signed in, in the demo or nobody), without the account's navigation, never indexed.

- **`/pismo?t=…&l=…`** confirms a website sign-up. "Potvrdi prijavu" sends
  `POST {apiBase}/functions/v1/newsletter` `{"action": "confirm", "token"}` (apikey = the publishable key, no user
  token). The answer's `status` decides (all 200): confirmed, expired or invalid. A 429 says "Previše pokušaja…".
- **`/odjava?e=…&t=…&l=…`** unsubscribes the address from tips and news. "Odjavi me" sends
  `{"action": "unsubscribe", e, t, l}`: done, or 400 invalid ("Piši nam na hello@evolako.com…"). Account and
  statement e-mails keep coming.
- **Both pages:**
  - nothing is sent until the person presses the button (mail scanners open links, some run scripts);
  - each press sends one request, never retried by itself; a problem leaves "Pokušaj ponovo";
  - the link leaves the address at once and is kept in `sessionStorage` for this tab only (never `localStorage`),
    with its outcome, so a reload shows the result again instead of sending a used token;
  - `?l=` is applied like `?lang=` (by `boot.js`, before the first paint; `?lang=` wins);
  - in the demo (`apiBase: ""`) they say "U demou ovo nije dostupno…" and send nothing.
- **`/pismo/<slug>`** draws `/posta/<slug>.json`, a static file of this site, so it works in any mode: the cover,
  the date, the subject as the title, the e-mail's blocks, "Tim Evolako". The slug must match `^[a-z0-9-]{3,40}$`.
  No file, bad JSON or a file that is not this issue → "Ova stranica ne postoji.". Links lead only to evolako.rs,
  www., app., blokvolt.rs and www.blokvolt.rs, addresses only to our domains; anything else stays text.
- **Publishing** is a file, not an admin screen. The operator (a Claude session with the founders) adds:
  - `public/posta/<slug>.json` — the format: `src/api/posta.ts` and the backend's `Docs/NEWSLETTER.md`;
  - optionally a cover `public/posta/<slug>.jpg` (16:9; same origin, the CSP allows images from this site only);
  - the entry in `public/posta/index.json`, which the backend's `newsletter-tick` reads every 10 minutes
    (preview → approval by hash → sending). It ships as `{"issues": []}`; keep it valid JSON without a BOM.

  The steps are in [docs/DEPLOY.md](docs/DEPLOY.md), section 8.
- **Strings:** brief §3 of the backend verbatim in SR/EN/RU. The unsubscribe text keeps the backend's Russian
  "расчётах" (the e-mails' word for obračun); the app's own glossary word is "отчёт".

## Account deletion without the app: `/obrisi-nalog`

Google Play requires every app with accounts to name a web address where a person can delete the account without
installing the app ("Delete account URL" in Play Console → App content → Data safety). For the Evolako Android app
that address is **`https://app.evolako.rs/obrisi-nalog`** (`src/screens/ObrisiNalog.tsx`, rules in
`src/app/deletion.ts`). The same account lives in the iOS app, the Android app and here, so the page serves all three.

- **Public, like the Evolako pismo pages:** the same page for anyone, without the account's navigation, never sent
  through sign-in first, never indexed (the usual `X-Robots-Tag` and robots meta). It reads without an account: what
  is deleted, what stays and why, what else to know, and the three ways (here; the app: Podešavanja → Nalog → Obriši
  nalog; Moj Evolako: Profil → Nalog i podešavanja → Obriši nalog), plus "write to us from the account's e-mail" for
  someone who cannot sign in, and the privacy policy.
- **Deleting needs the person:** "Prijavi se da obrišeš nalog" → the usual sign-in (`/prijava?next=%2Fobrisi-nalog`,
  whatever sign-in methods the landing offers: with the Google button there, the page's line names Google too — "with
  that e-mail", since a Google account under another address signs in to a new, empty account) → back on the page: the account's e-mail, "Obriši nalog", the
  confirmation "Obrisati nalog?" (the app's own words) → `POST {apiBase}/functions/v1/account-delete` with the
  user's token — the same call as the apps and `/profil/nalog` (`src/screens/profil/DeleteAccount.tsx` is shared).
  One request per press, never repeated by itself; no connection, a server error and "too many attempts" are said in
  words and leave the dialog open. Then the page says "Nalog je obrisan." itself and keeps its address
  (`afterAccountDeleted({ stay: true })`); the session is forgotten in this browser as after any deletion. A session
  that ended meanwhile: "Sesija je istekla. Prijavi se ponovo." on the page.
- **Where there is nothing to delete:** in a demo session the page offers "Izađi iz demoa" (then asks to sign in); in
  a build without the API (`apiBase: ""`) it says so and offers "Piši nam". Neither sends anything.
- **The texts say what the server does** — the backend's `account-delete` function and `delete_account_data()` in the
  iOS repo: the account and profile, the personal data in assessment requests, the photos (problem reports, meter
  readings), the notifications, the Evolako pismo subscription and unused free referral months are deleted; statements
  and payment records stay with the payer's name only, "for as long as the Law on Accounting requires" (the wording of
  the server's own confirmation e-mail — **no number of years is stated anywhere, do not add one**); the charging
  point's own records (installation address, sessions, meter values, service history) stay with the point, unlinked;
  the subscription of a point the person held alone ends with the current month. **Change these texts only together
  with the server.** `tests/unit/deletion.test.ts` and `tests/e2e/obrisi-nalog.spec.ts` hold the page.
- The Android app does **not** take this address (its App Links list the paths it opens; `/obrisi-nalog` is not one
  of them): the link must open in a browser also on a phone with the app installed.

## Tests

- **Unit** (`npm test`) covers:
  - formatters, Belgrade dates and DST, the statement due-date rule;
  - the IPS QR round trip (encode → decode → byte-equal to the fixtures);
  - the API client (headers, bodies, error mapping, one refresh then sign-out, lock usage);
  - every contract fixture parsing;
  - the CSV format for Serbian Excel;
  - token contrast;
  - the string catalog (complete, placeholders, forbidden words, informal address);
  - form rules, deep links, the demo data (day determinism, due/paid, live start and trigger), the Danas ring;
  - Evolako pismo: the confirm/unsubscribe calls (bodies, headers, every answer, no retry), the steps of /pismo and
    /odjava, the issue decoder against the backend's fixture issue, the link policy of an issue.
  - the account deletion page: what it offers for each session, sign-in and back, the texts in all four languages.
  - the display currency: the spec's §5 table for EUR and USD, rounding, zero, small rates, ranges; the sync with
    the profile (server wins, PATCH, retry at the next opening); the rate (manifest → file → cache → fallback); the
    payment guard.
- **E2E** (`npm run test:e2e`) serves `dist/` with `tests/e2e/serve.mjs`, which applies `_headers` and `_redirects`
  like Pages, on a fixed Belgrade clock. It covers:
  - the demo flows (all tabs, statement copy, print to PDF with the QR decoded from the rasterized page);
  - sign-in against a mocked API (`tests/e2e/mock-api.ts`; nothing leaves the machine);
  - the live and demo-only landing, deep links, PWA/offline and indexing headers;
  - theme and language;
  - no console errors or CSP violations, no horizontal overflow from 360 to 1440 px, axe with 0 serious/critical
    issues, and 44 px touch targets;
  - Evolako pismo (`pismo.spec.ts`, `posta.spec.ts`): every state of /pismo and /odjava in sr/en/ru at 390 and
    1280 px, the address cleaned, nothing sent before the button, the demo; /pismo/<slug> from the fixture issue,
    "not found", `posta/index.json` as shipped.
  - the account deletion page (`obrisi-nalog.spec.ts`): reading without an account in sr / sr-Cyrl / en / ru at 390
    and 1280 px, nothing sent; sign-in and back; cancel; every problem in words, one request per press; "Nalog je
    obrisan." and the session forgotten; an ended session; the demo; a build without the API; both themes.
  - display currency (`currency.spec.ts`): RSD by default, EUR in Nalog → Pretplata «990 RSD · ≈ 8,43 €», a
    reload keeps it, the statement on screen and on paper stays in dinars with the same QR; the account's
    `displayCurrency` from the mocked API and the PATCH; a newer rate and the fallback when the API answers 503.
- **Shots** (`npm run shots`): phone 390×844 and desktop 1440×900, light and dark. They wait for animations to
  finish. `valuta/`: Nalog, Pretplata, Danas, Statistika in SR/EN/RU × RSD/EUR × light/dark.

## Deploy (GitHub Actions → Cloudflare Pages, since 25.10.2026)

The project name is **`evolako-app`** (a Direct Upload project). Every commit to `main` of `hemptoon/evolako-web` is
checked (strings, types, unit tests), built and uploaded by `.github/workflows/deploy.yml` with Wrangler; the live
runtime config is `deploy/config.production.json` (copied over `dist/config.json`; public values only). A commit with
`[skip deploy]` in its message is not deployed. This GitHub repository is the source of truth: work from a clone of it
and push to `main`. Manual fallback (only if Actions is down):

```sh
npm ci && npm run check                       # green
cp deploy/config.production.json dist/config.json
npx wrangler@4 pages deploy dist --project-name evolako-app --branch main
```

You can also upload the folder, or a zip with the files at its root, in the dashboard: Workers & Pages → Create
application → Pages → Upload assets.

- **Custom domain:** `app.evolako.rs`.
  1. Add it in the Pages project first (Custom domains).
  2. Then create the CNAME `app` → `evolako-app.pages.dev` at the DNS host of evolako.rs. A CNAME created before
     the domain is attached in Pages ends in a 522 error.
- **SPA fallback:** the build has no top-level `404.html`, so Pages serves `index.html` for unknown paths.
  `_redirects` (`/* /index.html 200`) states the same thing for the local server and other hosts. If Pages
  reports that rule as an infinite loop and ignores it, deep links still work; `DEPLOY.md` has the check.
- **CORS:** the Worker already allows `https://app.evolako.rs`. [docs/backend-cors.patch](docs/backend-cors.patch)
  additionally allows `https://evolako-app.pages.dev` and its preview subdomains. It is **not applied anywhere**:
  apply it in the iOS repo and redeploy the Worker only if the app must reach the API from `*.pages.dev`.

Full checklist, smoke tests and rollback: [docs/DEPLOY.md](docs/DEPLOY.md).

## Strings

- **Keys are the Serbian text.**
  - `t("…")` translates, with placeholders `%@` and `%lld` like the app.
  - `tp("…", n)` handles plurals.
  - `msg("…")` marks a string for the catalog when it is translated later.
- **`npm run strings`** writes the catalog:
  - output: `src/i18n/strings.json` and the per-language chunks `src/i18n/lang/{sr,sr-Cyrl,en,ru}.json`;
  - input: every key found in `src/`;
  - app strings are taken **verbatim** from `vendor/ios/Localizable.xcstrings` (a copy of the iOS app's
    `EvolakoKit/Sources/Features/Resources/Localizable.xcstrings`);
  - all other strings come from `src/i18n/web.json`.
  - Serbian is bundled; Cyrillic, English and Russian load on demand.
- **Serbian Cyrillic (`sr-Cyrl`) is a script, not a translation** — never written by hand:
  - `src/i18n/evo-cyr.mjs` is the transliteration of evolako.rs, byte for byte (a test keeps its hash). Do not edit
    its rules here; a word that comes out wrong gets an exception in its `KX` (exact word) / `KP` (word start)
    lists, on the site too.
  - `src/i18n/cyrillic.mjs` wraps it for format strings (placeholders stay as they are); `npm run strings`
    generates `lang/sr-Cyrl.json` from the Serbian texts, and `tests/unit/cyrillic.test.ts` checks every text.
  - Texts outside the catalog (site content, issues of Evolako pismo) go through `inScript()` / `siteText()`.
    What a person typed (names, addresses, the point's name) and payment data stay as they are.
  - Dates use `sr-Cyrl-RS`; the backend, the e-mails and links' content know only sr/en/ru — `contentLang()`
    sends `sr` for Cyrillic (the e-mails are Latin for now).
- **Adding a string:**
  1. If the app already says the same thing, use the app's exact Serbian key. Consistency with the app is
     required, and redefining an app key in `web.json` fails the build.
  2. Otherwise, write `t("Serbian text")` and add one line to `web.json`:
     `"Serbian text": {"sr": "…", "en": "…", "ru": "…"}`.
  3. Run `npm run strings` and commit the generated files. `strings:check` (part of `check`) fails on a stale
     catalog, a missing language or an unused `web.json` key.
- **Refreshing from the app:** copy the app's `Localizable.xcstrings` into `vendor/ios/` and run
  `npm run strings`.
- **Site content** (FAQ, kits) comes from the app's snapshots in `src/content/*.json`, via `siteText()`.

## Product rules (non-negotiable)

- **Brand:** Evolako. The wordmark "evolako" is never translated ("evo" Onest 350, "lako" Onest 800 in accent
  blue). The mark is the geometric "e", drawn from its geometry in `src/ui/brand.tsx`.
- **Languages:**
  - Serbian (Latin) is the default; Serbian Cyrillic, English and Russian are selectable — always in this order:
    Srpski (latinica), Српски (ћирилица), English, Русский. Public pages: the drop-down of evolako.rs
    (`LangMenu`); the cabinet: Profil → Nalog i podešavanja.
  - Address people informally: Serbian "ti", Russian "ты". English is American product English.
- **Glossary:**

  | Serbian | English | Russian |
  | --- | --- | --- |
  | obračun | statement | отчёт |
  | tačka | charging point | точка |
  | komplet | kit | комплект |
  | pretplata | subscription | подписка |
  | probni period | trial | пробный период |
  | ugradnja | installation | установка |
  | brojilo | meter | счётчик |
  | noćno okno | night window | ночное окно |
  | prijava kvara | problem report | заявка о проблеме |
  | selidba | move | переезд |
  | preporuka | referral | рекомендация |

  *IPS QR* and *poziv na broj* are never translated.
- **Never write** (`tests/unit/i18n.test.ts` enforces the words it can):
  - "atest" in any form;
  - "popust" / discount / скидка;
  - "24/7";
  - "Plug&Charge";
  - "odmah" as a promise;
  - savings percentages;
  - surcharge amounts;
  - that Evolako does the paperwork for the customer — see "Paperwork" below.

  Referrals give *besplatni meseci* only.
- **Paperwork (rule of 01.10.2026):** Evolako does not do the paperwork or the negotiating for the customer: it
  doesn't run the building assembly, doesn't negotiate with the building manager, the neighbors or the garage owner,
  doesn't file EDS/EPS requests, doesn't obtain permits and doesn't represent the customer before the building or the
  authorities. The ZGRADA kit and everything for buildings stays; only "we do it for you" goes. The monthly statement
  is unchanged: prices of a third-party meter are entered by us, from the bill the customer sends ("Cene unosimo po
  računu zgrade koji nam pošalješ"). Canon: the document-wording lexicon of 01.10.2026 (internal project document).
  - **Evolako does:** assessment, installation, equipment, MID meter, power management, a technical description of
    the installation (with the offer), as-built documentation, the app, the monthly statement (a document the
    customer forwards), service.
  - **Evolako gives for the customer to use:** templates (draft assembly decision, agenda item, owner's consent,
    answers to residents' questions) and a step-by-step checklist.
  - **The customer / building manager / owner does:** the assembly and the vote, signatures, consents, talking to the
    manager, neighbors and owner, EDS/EPS requests, permits, fees.
  - **Never write:** SR «vodimo umesto tebe/Vas», «kompletnu dokumentaciju vodimo mi», «Papiri su naš posao»,
    «papire/dokumentaciju pripremamo mi», «ti ništa ne sastavljaš sam», «na tebi je samo da potpišeš», «papiri —
    uključeni», «sa … i papirima» in a price, «pripremljen tako da prođe proveru upravnika», «mi dolazimo sa
    odgovorima», «naši papiri odgovaraju umesto tebe», «po potrebi te pripremimo», «partner koji preuzima ceo posao»,
    «rešavaju sve», «bez muke», «unosimo mi»; EN "we prepare the paperwork", "we handle the paperwork", "we run it for
    you", "paperwork included"; RU «документы готовим мы», «ведём вместо тебя», «документы включены», «вносим мы».
    A power increase is never "a separate item in the offer" without saying that the customer files the request
    (checked by eye — no regex for it). Fine to keep: «Šablon saglasnosti dajemo mi», «dokument koji stavljaš na sto
    pred vlasnika ili zgradu», «dokumentacija o izvedenim radovima», neutral descriptions of the procedure.
  - **Guard:** `tests/unit/papiri_forbidden.json` (regexes + control samples), checked by `tests/unit/i18n.test.ts`
    against the catalog, `src/content/{faq,paketi}.json`, `public/posta/**` and `tests/fixtures/posta/**`. It is a copy
    of blokvolt-ios `Scripts/papiri_forbidden.json` — change one, copy it to the other.
- **Promises:**
  - Service: a reply within 48 h ("u roku od 48 h").
  - Relocation: a reply within 72 h.
  - Support: e-mail hello@evolako.com, plus messages only (no calls) on WhatsApp, Viber and Telegram at
    +381 65 381 6083 ("Samo poruke, bez poziva").
- **Money and dates:**
  - Money is Serbian in every language: "1.690 RSD", "12,4 kWh" (Russian unit "кВт·ч"); a converted amount too:
    "≈ 1.064 €", "≈ 0,49 €/kWh".
  - Everything payable is in dinars whatever the display currency (see "Display currency").
  - Dates are localized but always in Europe/Belgrade.
  - A statement's due date is the 15th of the next month when the server omits it.
- **Payments:**
  - A statement has two independent parts:
    - energy, paid to the meter owner at the EPS price without markup. Evolako meters and passes the cost through;
      it never resells electricity;
    - the subscription, paid to Evolako.
  - `energyPart` is null for the socket on its own meter.
  - A trial month is 0 RSD.
  - **A paid statement never looks payable** (`isPayableNow`). It has no IPS QR, no "Kopiraj podatke za uplatu"
    and no per-field copy, on screen or on paper. The details stay as plain text, for the record only.
- **Charging control:** starting and stopping a charge happens in the iOS app only ("Punjenje pokrećeš i
  zaustavljaš u aplikaciji Evolako."). The web shows the state; it has no remote start or stop.
- **Privacy:**
  - no analytics or third-party calls;
  - marketing e-mails are off by default ("Saveti o punjenju e-poštom");
  - the account is never indexed (robots.txt, `X-Robots-Tag`, noindex meta);
  - no founder names in anything that ships.

## Android App Links

`public/.well-known/assetlinks.json` tells Android that the app `com.evolako.app` may open this site's links. With it,
a link such as `https://app.evolako.rs/ocitavanje` in an e-mail opens the same screen in the installed app; without
it (or when the app is not installed) the link opens here, as before.

- **Which links the app takes** is the app's decision (its manifest), not this file's: `/danas`, `/statistika`,
  `/obracuni`, `/obracuni/YYYY-MM`, `/ocitavanje`, `/profil`, `/paketi`. Everything else stays on the site —
  sign-in (`/prijava`), `/demo`, Evolako pismo (`/pismo…`, `/odjava`), the root (`/#podesavanja`), the other
  `/profil/…` pages. **A new route here does not reach the app** until the app lists it too.
- **The fingerprints** are the SHA-256 of the certificates the app is signed with: the upload key and the debug key
  (builds installed by cable). **For Google Play add the Play App Signing certificate** (Play Console → the app →
  Release → Setup → App signing: the SHA-256 of the "App signing key certificate"; the same page shows a ready
  Digital Asset Links snippet): the builds people install from Play are signed with that one, and without it their
  links keep opening in the browser.
  - **Adding it is one line in one place:** a new first line inside `sha256_cert_fingerprints` of
    `public/.well-known/assetlinks.json` — `"AB:CD:…:EF",` (upper-case pairs, with the comma at the end), the two
    lines below it untouched. Nothing else lists fingerprints: the tests check the file's shape, not its values, and
    the deploy helper compares the live file with the built one. Then deploy the site.
- **Hosting rules** (Google's): HTTPS, status 200 without a redirect, `Content-Type: application/json`, readable by
  crawlers. Hence the single `Allow: /.well-known/assetlinks.json` in `robots.txt` (the rest stays `Disallow: /`,
  and `X-Robots-Tag: noindex` still goes out with every response). The file is a real file in `dist/`, so it is
  served before the SPA fallback; `tests/e2e/pwa.spec.ts` and `tests/unit/assetlinks.test.ts` hold all of this.
- **Check after a deploy:**
  `curl -sI https://app.evolako.rs/.well-known/assetlinks.json` and
  `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://app.evolako.rs&relation=delegate_permission/common.handle_all_urls`
  (the app's package and fingerprints must be in the answer). Phones pick a change up when the app is installed or
  updated; Android 15+ also re-checks in the background, within about a week.

## Working rules for future sessions

- Keep `npm run check` green and commit in logical steps.
- A push to `main` deploys to production (see Deploy). Push to `main` only with the founders' go-ahead for that
  change; the monthly "Evolako pismo" scheduled task may push its issue files (`public/posta/`) on its own
  (decision of 25.10.2026). Do not call a real backend without the founders' explicit go-ahead.
- Never change the backend from here. It lives in the backend repo.
- New screens follow the app first: the iOS sources are the reference for information architecture, states and
  copy. The contract is `backend/docs/API.md` plus `backend/tests/fixtures/api` in the iOS repo; `tests/fixtures/api`
  here is a copy.

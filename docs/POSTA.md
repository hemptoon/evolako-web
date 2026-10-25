# Evolako pismo — publishing an issue from this repository (since 25.10.2026)

Short operator guide for a Claude session or the monthly scheduled task. The backend's `Docs/NEWSLETTER.md` (iOS repo)
stays the full guide; this file holds what is needed to publish without it.

## Files

- `public/posta/<slug>.json` — slug `^[a-z0-9-]{3,40}$`, for the monthly letter `YYYY-MM`. Format: as
  `public/posta/2026-10.json` and the parser in `src/api/posta.ts` (`slug`, `issue`, `date`, and `sr`/`en`/`ru` each with
  `subject` ≤ 80, `preheader` ≤ 160, `blocks` of `h2`/`p`/`note`/`list`/`steps`/`kv`/`button`/`divider`). Links: https on
  evolako.rs, www.evolako.rs, app.evolako.rs only. No HTML, no `{{…}}`. No cover unless one is added as
  `public/posta/<slug>.jpg`.
- `public/posta/index.json` — `{"issues": [...]}`, valid JSON without a BOM; a new issue goes **last**.

## Hash

The approval hash is SHA-256 of the issue as canonical JSON: keys sorted, no spaces, UTF-8 (not `\u` escapes).
It is checked here against issue 2026-10 (`25db04ab…49c66`):

```sh
python3 -c "import json,hashlib,sys;print(hashlib.sha256(json.dumps(json.load(open(sys.argv[1],encoding='utf-8')),sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()).hexdigest())" public/posta/2026-10.json
# 25db04ab101bd473806bf9cd7b1c0c155d36e44531fd8c20eaad58f59e849c66
```

Keep issues to strings, integers and the block types above (no floats), so this hash equals the backend's.

## Steps

1. Add the issue file and `{"slug": "<slug>", "status": "preview"}` at the end of `index.json`; `npm test` (the unit
   tests read every file in `public/posta/`). Commit and push to `main` → the Deploy workflow publishes app.evolako.rs.
2. Within 10 minutes `newsletter-tick` sends three previews "[PREVIEW <8 chars of the hash>] …" to hello@evolako.com.
3. Approval (by the founders, or by the monthly scheduled task — decision of 25.10.2026): set the entry to
   `"status": "approved"`, `"approved_hash": "<full hash>"`, `"send_at": "<YYYY-MM-DD>T10:00:00+01:00"` (+02:00 from
   the last Sunday of March to the last Sunday of October); `send_at` at least 30 minutes after the deploy. Commit,
   push. Do not touch the issue file after approval: any change is a new version and needs a new preview.
4. Stop: `"status": "stopped"`, commit, push. A stopped issue needs a new slug.

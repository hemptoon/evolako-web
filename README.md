# shop-media — official product photos for shop.evolako.rs

Branch for the image pipeline only (no site code). A push that changes `media/request.json`
runs the workflow "Shop media" on GitHub Actions:

- `"mode": "collect"` — opens the listed official manufacturer pages in a headless browser, collects
  every product photo ≥ 500 px, removes duplicates and commits numbered contact sheets
  (`media/sheets/<id>.jpg`) and candidate lists (`media/candidates/<id>.json`).
- `"mode": "process"` — downloads the chosen photos, cuts out the background (rembg + border colour),
  trims, centres on a square and commits WebP files 1600/800/400 px (`media/out/<id>/`) plus QA sheets
  on light and dark backgrounds (`media/qa/<id>.jpg`).

Sources: only manufacturer-owned pages and their CDNs, never retailers. Photos stay the
manufacturers' property; the shop credits the brand under each gallery and asks every manufacturer
for written permission in the reseller letters.

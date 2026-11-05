# Конвейер фото магазина shop.evolako.rs (копия из ветки shop-media, 05.11.2026)

Ветка `shop-media` в публичном `hemptoon/evolako-web` удаляется (в ней кадры производителей). Здесь — код конвейера, чтобы его можно было восстановить: положить файлы в новую ветку с теми же путями, запуск — изменение `media/request.json` (`mode: collect` или `process`). Готовые фото магазина лежат в сборке (`shop4/media/p`, выкладка — ветка `shop-deploy`, её не удалять). Выбор кадров — `shop4/data/photos_v7.json` в архиве Source-документа + добавки 03.11 (Beny, Copper SB, Heidelberg, V2C Denka, ABB DC, вырезки Mini/Home Eco/Teltonika из фото в интерьере).

## `.github/workflows/shop-media.yml`

```
# Shop images for shop.evolako.rs: collect candidate photos from official manufacturer pages,
# then cut out, square and export the selected ones. Runs only on this branch, only when
# media/request.json changes. Results are committed back to the branch (no deploy, no secrets).
name: Shop media
on:
  push:
    branches: [shop-media]
    paths: [media/request.json]
  workflow_dispatch:
permissions:
  contents: write
concurrency:
  group: shop-media
  cancel-in-progress: false
jobs:
  run:
    runs-on: ubuntu-latest
    timeout-minutes: 120
    strategy:
      fail-fast: false
      max-parallel: 4
      matrix:
        shard: [0, 1, 2, 3]
    env:
      SHARD: ${{ matrix.shard }}
      SHARDS: 4
    defaults:
      run:
        shell: bash
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1
      - name: Install
        run: |
          python3 -m pip install --quiet --user pillow imagehash playwright "rembg[cpu]" onnxruntime pymupdf
          python3 -m playwright install --with-deps chromium > /dev/null
      - name: Run
        run: |
          MODE=$(python3 -c "import json;print(json.load(open('media/request.json'))['mode'])")
          echo "mode: $MODE shard $SHARD/$SHARDS"
          mkdir -p media/log
          if [ "$MODE" = collect ]; then python3 -u media/collect.py 2>&1 | tee "media/log/collect-$GITHUB_RUN_ID-$SHARD.txt"; else python3 -u media/process.py 2>&1 | tee "media/log/process-$GITHUB_RUN_ID-$SHARD.txt"; fi
      - name: Commit results
        if: always()
        run: |
          git config user.name "shop-media bot"
          git config user.email "shop-media@users.noreply.github.com"
          for d in media/candidates media/sheets media/out media/qa media/log; do [ -e "$d" ] && git add "$d"; done
          git commit -q -m "Shop media: results of $(python3 -c "import json;print(json.load(open('media/request.json'))['mode'])") ($GITHUB_RUN_ID, shard $SHARD)" || { echo "nothing new"; exit 0; }
          ok=0; for i in 1 2 3 4 5 6; do git pull -q --rebase -X theirs origin shop-media && git push -q origin HEAD:shop-media && { ok=1; break; }; git rebase --abort 2>/dev/null; sleep $((5 + SHARD * 3)); done; [ $ok = 1 ] || { echo "push failed"; exit 1; }

```

## `media/collect.py`

```
"""Collect candidate product photos from official manufacturer pages (runs on GitHub Actions).

Input  media/request.json  {"mode": "collect", "items": {"<id>": {"pages": [...], "direct": [...]}}}
Output media/candidates/<id>.json   list of candidates (n, url, w, h, alpha, bg, bytes, src_page)
       media/sheets/<id>.jpg         contact sheet: numbered thumbnails on a checkerboard
Nothing is downloaded from retailers: only the pages and direct URLs listed in the request.
"""
import asyncio, io, json, os, re, sys, hashlib, urllib.parse
from PIL import Image, ImageDraw, ImageFont
Image.MAX_IMAGE_PIXELS = 80_000_000
import imagehash
from playwright.async_api import async_playwright
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pdfimg import pdf_images

ROOT = os.path.dirname(os.path.abspath(__file__))
REQ = json.load(open(os.path.join(ROOT, 'request.json'), encoding='utf-8'))
MIN_SIDE = 500
MAX_PER_ITEM = 40
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
SKIP = re.compile(r'(logo|icon|sprite|favicon|flag|badge|avatar|payment|social|placeholder|loader|banner-?app|qr)', re.I)


def bigger_from_srcset(srcset):
    best, bw = None, -1
    for part in (srcset or '').split(','):
        bits = part.strip().split()
        if not bits:
            continue
        w = 0
        if len(bits) > 1:
            m = re.match(r'(\d+)(w|x)', bits[1])
            if m:
                w = int(m.group(1)) * (1000 if m.group(2) == 'x' else 1)
        if w >= bw:
            best, bw = bits[0], w
    return best


def upgrade(url):
    """Ask common CDNs for the largest rendition."""
    u = url
    u = re.sub(r'([?&])(w|width|h|height|q|quality)=\d+', r'\1', u)
    u = re.sub(r'_(\d{2,4})x(\d{2,4})?(\.(?:png|jpe?g|webp))', r'\3', u)        # shopify _600x
    u = re.sub(r'-\d{2,4}x\d{2,4}(\.(?:png|jpe?g|webp))', r'\1', u)              # wordpress -300x300
    u = re.sub(r'/(w|h)_\d+,?', '/', u)                                            # cloudinary
    return u.replace('?&', '?').rstrip('?&')


def describe(img):
    w, h = img.size
    alpha = False
    if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
        a = img.convert('RGBA').split()[3]
        corners = [a.getpixel((0, 0)), a.getpixel((w - 1, 0)), a.getpixel((0, h - 1)), a.getpixel((w - 1, h - 1))]
        alpha = min(corners) < 16
    rgb = img.convert('RGB')
    small = rgb.resize((64, 64))
    px = small.load()
    border = [px[x, 0] for x in range(64)] + [px[x, 63] for x in range(64)] + [px[0, y] for y in range(64)] + [px[63, y] for y in range(64)]
    white = sum(1 for p in border if min(p) >= 240) / len(border)
    bg = 'alpha' if alpha else ('white' if white >= 0.9 else ('light' if white >= 0.6 else 'scene'))
    return w, h, alpha, bg


def checker(size, sq=12):
    im = Image.new('RGB', size, (236, 238, 242))
    d = ImageDraw.Draw(im)
    for y in range(0, size[1], sq):
        for x in range(0, size[0], sq):
            if (x // sq + y // sq) % 2:
                d.rectangle([x, y, x + sq - 1, y + sq - 1], fill=(222, 225, 231))
    return im


def thumb(img, box=300):
    im = img.convert('RGBA')
    im.thumbnail((box, box))
    bg = checker((box, box))
    bg.paste(im, ((box - im.width) // 2, (box - im.height) // 2), im)
    return bg


def sheet(item_id, cands, thumbs):
    cols = 5
    box = 300
    rows = (len(thumbs) + cols - 1) // cols or 1
    W, H = cols * (box + 10) + 10, rows * (box + 44) + 50
    im = Image.new('RGB', (W, H), (255, 255, 255))
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 16)
        fb = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
    except Exception:
        f = fb = ImageFont.load_default()
    d.text((10, 12), item_id, fill=(0, 0, 0), font=fb)
    for i, (c, t) in enumerate(zip(cands, thumbs)):
        x = 10 + (i % cols) * (box + 10)
        y = 50 + (i // cols) * (box + 44)
        im.paste(t, (x, y))
        d.text((x, y + box + 4), f"#{c['n']}  {c['w']}x{c['h']}  {c['bg']}", fill=(0, 0, 0), font=f)
        host = urllib.parse.urlparse(c['url']).netloc.replace('www.', '')[:30]
        d.text((x, y + box + 22), host, fill=(110, 110, 110), font=f)
    os.makedirs(os.path.join(ROOT, 'sheets'), exist_ok=True)
    im.save(os.path.join(ROOT, 'sheets', f'{item_id}.jpg'), quality=82)


async def harvest(page, url):
    """Open a page like a visitor, scroll, and list every image URL it shows or references."""
    seen = []
    def add(u):
        if not u or u.startswith('data:'):
            return
        u = urllib.parse.urljoin(url, u)
        if u not in seen:
            seen.append(u)
    page.on('response', lambda r: add(r.url) if r.request.resource_type == 'image' else None)
    try:
        await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    except Exception as e:
        print('  page failed', url, e)
        return []
    for sel in ['button:has-text("Accept")', 'button:has-text("Accept all")', 'button:has-text("Allow all")',
                'button:has-text("Alle akzeptieren")', '#onetrust-accept-btn-handler', 'button:has-text("Agree")']:
        try:
            b = page.locator(sel).first
            if await b.is_visible(timeout=500):
                await b.click(timeout=1500)
                break
        except Exception:
            pass
    for _ in range(14):
        await page.mouse.wheel(0, 1400)
        await page.wait_for_timeout(350)
    await page.wait_for_timeout(1500)
    dom = await page.evaluate('''() => {
      const out = [];
      document.querySelectorAll('img').forEach(i => { out.push(i.currentSrc || i.src); out.push(i.getAttribute('data-src')); out.push(i.getAttribute('data-zoom-image')); out.push(i.getAttribute('data-large_image')); if (i.srcset) out.push('SRCSET:' + i.srcset); if (i.dataset && i.dataset.srcset) out.push('SRCSET:' + i.dataset.srcset); });
      document.querySelectorAll('source[srcset]').forEach(s => out.push('SRCSET:' + s.srcset));
      document.querySelectorAll('a[href]').forEach(a => { if (/\\.(png|jpe?g|webp)(\\?|$)/i.test(a.href)) out.push(a.href); });
      const og = document.querySelector('meta[property="og:image"]'); if (og) out.push(og.content);
      document.querySelectorAll('script[type="application/ld+json"]').forEach(s => { try { const j = JSON.parse(s.textContent); const walk = o => { if (!o) return; if (Array.isArray(o)) o.forEach(walk); else if (typeof o === 'object') { if (o.image) { [].concat(o.image).forEach(x => out.push(typeof x === 'string' ? x : (x && x.url))); } Object.values(o).forEach(v => { if (typeof v === 'object') walk(v); }); } }; walk(j); } catch (e) {} });
      const html = document.documentElement.innerHTML;
      (html.match(/https?:\\/\\/[^"'\\s)]+?\\.(?:png|jpe?g|webp)(?:\\?[^"'\\s)]*)?/gi) || []).forEach(u => out.push(u.replace(/\\\\u002F/g, '/').replace(/\\\\\\//g, '/')));
      return out.filter(Boolean);
    }''')
    for u in dom:
        if u.startswith('SRCSET:'):
            add(bigger_from_srcset(u[7:]))
        else:
            add(u)
    return seen


async def fetch(ctx, url, referer):
    for u in [upgrade(url), url] if upgrade(url) != url else [url]:
        try:
            r = await ctx.request.get(u, headers={'Referer': referer or u, 'User-Agent': UA}, timeout=40000)
            if r.ok:
                b = await r.body()
                if len(b) > 8000:
                    return u, b
        except Exception:
            pass
    return None, None


async def one_item(ctx, item_id, spec):
            urls = []
            for d in spec.get('direct', []):
                urls.append((d, spec['pages'][0] if spec.get('pages') else d))
            for pg in spec.get('pages', []):
                page = await ctx.new_page()
                try:
                    found = await asyncio.wait_for(harvest(page, pg), timeout=120)
                except Exception as e:
                    print('  page gave up', pg, type(e).__name__, flush=True)
                    found = []
                try:
                    await page.close()
                except Exception:
                    pass
                print('  ', pg, len(found), 'urls')
                urls += [(u, pg) for u in found]
            cands, thumbs, hashes, done = [], [], [], set()

            def keep(c, img, ph):
                dup = next((i for i, x in enumerate(hashes) if ph - x <= 4), None)
                if dup is not None:
                    if c['w'] * c['h'] > cands[dup]['w'] * cands[dup]['h']:
                        c['n'] = cands[dup]['n']; cands[dup] = c; thumbs[dup] = thumb(img); hashes[dup] = ph
                    return
                c['n'] = len(cands) + 1
                cands.append(c); thumbs.append(thumb(img)); hashes.append(ph)

            for pdf in spec.get('pdfs', []):           # datasheets: embedded renders
                try:
                    r = await ctx.request.get(pdf, headers={'User-Agent': UA}, timeout=60000)
                    if not r.ok:
                        print('  pdf', r.status, pdf, flush=True); continue
                    body = await r.body()
                    n0 = len(cands)
                    for xref, img in pdf_images(body, MIN_SIDE):
                        if len(cands) >= MAX_PER_ITEM:
                            break
                        try:
                            w, h, alpha, bg = describe(img)
                            ph = imagehash.phash(img.convert('RGB'))
                        except Exception:
                            continue
                        keep(dict(url=f'pdf:{pdf}#xref={xref}', w=w, h=h, alpha=alpha, bg=bg, bytes=0, src_page=pdf, sha1=''), img, ph)
                    print('  pdf', pdf, len(cands) - n0, 'images', flush=True)
                except Exception as e:
                    print('  pdf failed', pdf, type(e).__name__, flush=True)

            for u, ref in urls:
                if len(cands) >= MAX_PER_ITEM:
                    break
                if SKIP.search(urllib.parse.urlparse(u).path) or u in done:
                    continue
                if re.search(r'\.(svg|gif)(\?|$)', u, re.I):
                    continue
                done.add(u)
                got, body = await fetch(ctx, u, ref)
                if not body:
                    continue
                try:
                    img = Image.open(io.BytesIO(body)); img.load()
                    w, h, alpha, bg = describe(img)
                    if min(w, h) < MIN_SIDE:
                        continue
                    ph = imagehash.phash(img.convert('RGB'))
                except Exception:
                    continue
                keep(dict(url=got, w=w, h=h, alpha=alpha, bg=bg, bytes=len(body), src_page=ref,
                          sha1=hashlib.sha1(body).hexdigest()[:12]), img, ph)
            json.dump(cands, open(os.path.join(ROOT, 'candidates', f'{item_id}.json'), 'w'), indent=1)
            sheet(item_id, cands, thumbs)
            print('  kept', len(cands), flush=True)
            return len(cands)


async def main():
    items = REQ['items']
    only = os.environ.get('ONLY', '').split(',') if os.environ.get('ONLY') else None
    shard, shards = int(os.environ.get('SHARD', 0)), int(os.environ.get('SHARDS', 1))
    os.makedirs(os.path.join(ROOT, 'candidates'), exist_ok=True)
    rep_path = os.path.join(ROOT, 'candidates', f"_report-b{REQ.get('batch', 0)}-{shard}.json")
    report = {}
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        for i, (item_id, spec) in enumerate(items.items()):
            if only and item_id not in only:
                continue
            if i % shards != shard:
                continue
            print('==', item_id, flush=True)
            ctx = await browser.new_context(user_agent=UA, viewport={'width': 1440, 'height': 1000}, locale='en-US')
            try:
                report[item_id] = await asyncio.wait_for(one_item(ctx, item_id, spec), timeout=420)
            except Exception as e:          # one bad site must not stop the batch
                print('  item failed', item_id, type(e).__name__, str(e)[:200], flush=True)
                report[item_id] = 'failed: ' + type(e).__name__
            finally:
                try:
                    await ctx.close()
                except Exception:
                    pass
            json.dump(report, open(rep_path, 'w'), indent=1)
        await browser.close()


if __name__ == '__main__':
    asyncio.run(main())

```

## `media/process.py`

```
"""Turn selected official photos into shop images (runs on GitHub Actions).

Input  media/request.json  {"mode": "process", "items": {"<id>": [{"url": ..., "src_page": ..., "kind": "cut"|"keep"|"scene"}]}}
         kind "cut"   — product on a plain background: cut it out (rembg mask + colour mask from the border)
         kind "keep"  — already transparent: only trim and centre
         kind "scene" — a photo in a setting: no cut-out, square crop, shown after the product shots
         optional "crop": [x0, y0, x1, y1] (fractions) — take one product out of a group shot first
Output media/out/<id>/<k>-1440.webp, <k>-720.webp  (square, transparent for cut/keep)
       media/out/<id>/meta.json
       media/qa/<id>.jpg   every result on a light and on a dark background, to spot halos
"""
import io, json, os, sys, urllib.request
from collections import deque
from PIL import Image, ImageDraw, ImageFilter, ImageFont
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.abspath(__file__))
REQ = json.load(open(os.path.join(ROOT, 'request.json'), encoding='utf-8'))
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
SIZES = (1440, 720)   # two files per photo: the shop's Pages upload stays under 1,000 files
FILL = 0.86          # the product takes 86 % of the square's longer side
_session = None


def rembg_mask(img):
    global _session
    from rembg import remove, new_session
    if _session is None:
        _session = new_session(REQ.get('model') or os.environ.get('REMBG_MODEL', 'birefnet-general'))
    out = remove(img.convert('RGB'), session=_session, post_process_mask=True)
    return out.split()[3]


def border_bg_mask(img, tol=30):
    """Background = pixels connected to the border whose colour is close to the border colour."""
    small = img.convert('RGB')
    scale = 1
    if max(small.size) > 1200:
        scale = max(small.size) / 1200
        small = small.resize((round(small.width / scale), round(small.height / scale)), Image.LANCZOS)
    w, h = small.size
    px = small.load()
    border = [px[x, 0] for x in range(w)] + [px[x, h - 1] for x in range(w)] + [px[0, y] for y in range(h)] + [px[w - 1, y] for y in range(h)]
    border.sort(key=lambda p: sum(p))
    ref = border[len(border) // 2]
    def close(p):
        return abs(p[0] - ref[0]) + abs(p[1] - ref[1]) + abs(p[2] - ref[2]) <= tol * 3
    bg = bytearray(w * h)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if close(px[x, y]) and not bg[y * w + x]:
                bg[y * w + x] = 1; q.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if close(px[x, y]) and not bg[y * w + x]:
                bg[y * w + x] = 1; q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not bg[ny * w + nx] and close(px[nx, ny]):
                bg[ny * w + nx] = 1; q.append((nx, ny))
    m = Image.frombytes('L', (w, h), bytes(0 if v else 255 for v in bg))
    if scale != 1:
        m = m.resize(img.size, Image.LANCZOS)
    return m


def cut(img):
    a1 = rembg_mask(img)
    a2 = border_bg_mask(img)
    # rembg knows what an object is (white casing on white); the colour mask keeps thin dark cables
    from PIL import ImageChops
    # dark or coloured product: trust the colour mask to remove leftover background (e.g. white bits beside a black cable);
    # white product on white: the colour mask eats into the product, so take the model's mask alone
    import numpy as np
    f1 = np.asarray(a1) > 128
    lost = (f1 & (np.asarray(a2) < 128)).sum() / max(1, f1.sum())
    if lost < 0.06:
        a = ImageChops.darker(a1, a2.filter(ImageFilter.MaxFilter(5)))
    else:
        a = a1          # BiRefNet alone: the colour mask would only add soft shadows back
    print(f'    mask: {"intersection" if lost < 0.06 else "model only"} (colour mask would remove {lost:.1%} of the object)')
    a = a.filter(ImageFilter.GaussianBlur(0.6))
    out = decontaminate(img.convert('RGB'), a, bg_colour(img))
    out.putalpha(a)
    return out


def bg_colour(img):
    rgb = img.convert('RGB')
    w, h = rgb.size
    px = rgb.load()
    border = [px[x, 0] for x in range(0, w, 4)] + [px[x, h - 1] for x in range(0, w, 4)] + \
             [px[0, y] for y in range(0, h, 4)] + [px[w - 1, y] for y in range(0, h, 4)]
    border.sort(key=lambda p: sum(p))
    return border[len(border) // 2]


def decontaminate(rgb, alpha, bg):
    """Remove the old background colour from soft edge pixels, so a product cut from white has no white halo on a dark page."""
    import numpy as np
    c = np.asarray(rgb, dtype=np.float32)
    a = np.asarray(alpha, dtype=np.float32)[..., None] / 255.0
    b = np.array(bg, dtype=np.float32)[None, None, :]
    edge = (a > 0.02) & (a < 0.98)
    fixed = np.clip((c - (1 - a) * b) / np.maximum(a, 0.02), 0, 255)
    c = np.where(edge, fixed, c)
    return Image.fromarray(c.astype('uint8'), 'RGB').convert('RGBA')


def square(img, transparent=True):
    if transparent:
        bbox = img.split()[3].point(lambda v: 255 if v > 10 else 0).getbbox() or (0, 0, img.width, img.height)
        img = img.crop(bbox)
        side = round(max(img.size) / FILL)
        canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
        canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2), img)
        return canvas
    s = min(img.size)
    l, t = (img.width - s) // 2, (img.height - s) // 2
    return img.convert('RGB').crop((l, t, l + s, t + s))


def get(url, ref):
    if url.startswith('pdf:'):                       # pdf:<datasheet url>#xref=<n>
        pdf, xref = url[4:].rsplit('#xref=', 1)
        rq = urllib.request.Request(pdf, headers={'User-Agent': UA})
        with urllib.request.urlopen(rq, timeout=90) as r:
            body = r.read()
        from pdfimg import pdf_image
        b = io.BytesIO(); pdf_image(body, int(xref)).save(b, 'PNG')
        return b.getvalue()
    rq = urllib.request.Request(url, headers={'User-Agent': UA, 'Referer': ref or url})
    with urllib.request.urlopen(rq, timeout=60) as r:
        return r.read()


def qa_sheet(item_id, outs):
    box = 360
    W, H = 2 * (box + 12) + 12, len(outs) * (box + 34) + 46
    im = Image.new('RGB', (W, max(H, 120)), (255, 255, 255))
    d = ImageDraw.Draw(im)
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 15)
    except Exception:
        f = ImageFont.load_default()
    d.text((12, 12), item_id, fill=(0, 0, 0), font=f)
    for i, (k, kind, img) in enumerate(outs):
        y = 40 + i * (box + 34)
        for j, bgc in enumerate([(238, 240, 243), (26, 31, 43)]):
            bg = Image.new('RGB', (box, box), bgc)
            t = img.copy(); t.thumbnail((box, box))
            if t.mode == 'RGBA':
                bg.paste(t, ((box - t.width) // 2, (box - t.height) // 2), t)
            else:
                bg.paste(t, ((box - t.width) // 2, (box - t.height) // 2))
            im.paste(bg, (12 + j * (box + 12), y))
        d.text((12, y + box + 6), f'{k}  {kind}', fill=(0, 0, 0), font=f)
    os.makedirs(os.path.join(ROOT, 'qa'), exist_ok=True)
    im.save(os.path.join(ROOT, 'qa', f'{item_id}.jpg'), quality=84)


def main():
    only = os.environ.get('ONLY', '').split(',') if os.environ.get('ONLY') else None
    shard, shards = int(os.environ.get('SHARD', 0)), int(os.environ.get('SHARDS', 1))
    for i, (item_id, sel) in enumerate(REQ['items'].items()):
        if only and item_id not in only:
            continue
        if i % shards != shard:
            continue
        print('==', item_id)
        od = os.path.join(ROOT, 'out', item_id)
        os.makedirs(od, exist_ok=True)
        for fn in os.listdir(od):
            os.remove(os.path.join(od, fn))
        meta, outs = [], []
        for k, s in enumerate(sel, 1):
            try:
                body = get(s['url'], s.get('src_page'))
                img = Image.open(io.BytesIO(body)); img.load()
            except Exception as e:
                print('  failed', s['url'], e); continue
            kind = s.get('kind', 'cut')
            if s.get('crop'):                        # [x0, y0, x1, y1] as fractions: one product out of a group shot
                x0, y0, x1, y1 = s['crop']
                img = img.crop((round(x0 * img.width), round(y0 * img.height), round(x1 * img.width), round(y1 * img.height)))
            try:
                if kind == 'scene':
                    res = square(img, transparent=False)
                else:
                    if kind == 'keep' and img.mode in ('RGBA', 'LA', 'P'):
                        res = img.convert('RGBA')
                    else:
                        res = cut(img)
                    res = square(res)
            except Exception as e:
                print('  cut failed', s['url'], e); continue
            big = min(1440, max(720, res.width))   # never blow a small original up past its own size
            for size in SIZES:
                z = big if size == 1440 else size
                r = res.resize((z, z), Image.LANCZOS)
                r.save(os.path.join(od, f'{k}-{size}.webp'), 'WEBP', quality=88 if kind != 'scene' else 82, method=6)
            meta.append(dict(k=k, kind=kind, src=s['url'], page=s.get('src_page'), w=img.width, h=img.height, crop=s.get('crop')))
            outs.append((k, kind, res))
            print('  ok', k, kind, img.size)
        json.dump(meta, open(os.path.join(od, 'meta.json'), 'w'), indent=1)
        qa_sheet(item_id, outs)


if __name__ == '__main__':
    main()

```

## `media/pdfimg.py`

```
"""Product photos embedded in a manufacturer's datasheet PDF (often the cleanest renders they publish)."""
import io
from PIL import Image


def pdf_images(body, min_side=500):
    """Yield (xref, PIL image with alpha if the PDF has a soft mask) for every large embedded image."""
    import fitz  # PyMuPDF
    doc = fitz.open(stream=body, filetype='pdf')
    seen = set()
    for page in doc:
        for info in page.get_images(full=True):
            xref, smask = info[0], info[1]
            if xref in seen:
                continue
            seen.add(xref)
            try:
                pix = fitz.Pixmap(doc, xref)
                if min(pix.width, pix.height) < min_side:
                    continue
                if pix.n - pix.alpha >= 4:          # CMYK → RGB
                    pix = fitz.Pixmap(fitz.csRGB, pix)
                if smask:
                    pix = fitz.Pixmap(pix, fitz.Pixmap(doc, smask))
                img = Image.open(io.BytesIO(pix.tobytes('png')))
                img.load()
                yield xref, img
            except Exception:
                continue


def pdf_image(body, xref):
    for x, img in pdf_images(body, min_side=1):
        if x == xref:
            return img
    raise KeyError(xref)

```

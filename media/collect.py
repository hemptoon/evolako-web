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
                dup = next((i for i, x in enumerate(hashes) if ph - x <= 4), None)
                c = dict(url=got, w=w, h=h, alpha=alpha, bg=bg, bytes=len(body), src_page=ref,
                         sha1=hashlib.sha1(body).hexdigest()[:12])
                if dup is not None:
                    if w * h > cands[dup]['w'] * cands[dup]['h']:
                        c['n'] = cands[dup]['n']; cands[dup] = c; thumbs[dup] = thumb(img); hashes[dup] = ph
                    continue
                c['n'] = len(cands) + 1
                cands.append(c); thumbs.append(thumb(img)); hashes.append(ph)
            json.dump(cands, open(os.path.join(ROOT, 'candidates', f'{item_id}.json'), 'w'), indent=1)
            sheet(item_id, cands, thumbs)
            print('  kept', len(cands), flush=True)
            return len(cands)


async def main():
    items = REQ['items']
    only = os.environ.get('ONLY', '').split(',') if os.environ.get('ONLY') else None
    shard, shards = int(os.environ.get('SHARD', 0)), int(os.environ.get('SHARDS', 1))
    os.makedirs(os.path.join(ROOT, 'candidates'), exist_ok=True)
    rep_path = os.path.join(ROOT, 'candidates', f'_report-{shard}.json')
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

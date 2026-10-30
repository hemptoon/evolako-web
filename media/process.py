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
        _session = new_session(os.environ.get('REMBG_MODEL', 'isnet-general-use'))
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
    # white product on white: the colour mask eats into the product, so take the union instead
    import numpy as np
    f1 = np.asarray(a1) > 128
    lost = (f1 & (np.asarray(a2) < 128)).sum() / max(1, f1.sum())
    if lost < 0.06:
        a = ImageChops.darker(a1, a2.filter(ImageFilter.MaxFilter(5)))
    else:
        a = ImageChops.lighter(a1, a2.filter(ImageFilter.MinFilter(3)))
    print(f'    mask: {"intersection" if lost < 0.06 else "union"} (colour mask would remove {lost:.1%} of the object)')
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

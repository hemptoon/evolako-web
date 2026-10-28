#!/usr/bin/env python3
"""Self-test of site/content.py against what Webflow published: the JSON of guides that are already on the site is
read back from the snapshot (the Serbian page + the EN/RU dictionary in its footer + its card on the hub), rendered
again through site/content.py under a new slug, and compared with the original page:

  * the body from the hero to the footer (hero, cover photo, every section) must be byte-identical,
  * title, meta description, og/twitter texts, canonical and og:url must be the same (up to the slug),
  * the JSON-LD must be the same object (up to the slug; key order and indentation may differ),
  * the rest of the page (navigation, footer, scripts, styles) must be identical apart from the page's own EN/RU
    dictionary script, which new pages do not carry (their /en/ and /ru/ versions are prerendered by the build),
  * every EN/RU pair the new page gets equals the original page's dictionary.
News items are checked the same way on /novosti (every item rendered again equals the published block).

Nothing is written into site/; the reconstructed content goes to a temporary folder.
Usage: python3 site/tools/content_selftest.py [--keep <folder>]
"""
import argparse
import html
import json
import os
import re
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
sys.path.insert(0, SITE_DIR)
import content as CT   # noqa: E402
import prerender as PR  # noqa: E402

GUIDES = [('vodic', 'komsija-puni-iz-zajednicke-uticnice'), ('vodic', 'povecanje-snage-struje-eds'),
          ('vodic', 'koliko-elektricni-auto-podize-racun-za-struju'), ('vodic', 'punjenje-nocu-tajmer'),
          ('vodic', 'punjac-11-ili-22-kw'), ('vodic', 'punjenje-preko-suko-uticnice'),
          ('b2b', 'garaza-za-izdavanje-sa-punjacem'), ('b2b', 'operativni-lizing-elektricnog-automobila-punjenje')]
SUFFIX = '-selftest'


def u(s):
    return html.unescape(s)


def dictionary(page_html, slug):
    m = re.search(r'<script>\s*/\* Evolako · /%s · EN/RU dictionaries for the i18n engine[^*]*\*/(.*?)</script>'
                  % re.escape(slug), page_html, re.S)
    if not m:
        raise SystemExit('no dictionary script on /%s' % slug)
    d = {}
    for name, payload in re.findall(r'BVQ\.push\(\["(en2|ru2)",("(?:[^"\\]|\\.)*")\]\)', m.group(1)):
        parts = json.loads(payload).split('§')
        for i in range(0, len(parts) - 1, 2):
            d.setdefault(parts[i], {})[name[:2]] = parts[i + 1]
    return d, m.group(0)


class Tr:
    """EN/RU of a Serbian text as the /en/ and /ru/ versions of the page show it: the page's dictionary first, then
    what the engine held on that page (harvest) and the site's own translations (site/i18n), then the hub's."""

    def __init__(self, d, slugs):
        sys.path.insert(0, HERE)
        from i18n_harvest import expand
        with open(os.path.join(SITE_DIR, 'i18n', 'harvest.json'), encoding='utf-8') as f:
            hv = expand(json.load(f))
        extra = {lang: PR.load_i18n(os.path.join(SITE_DIR, 'i18n'), lang)[0] for lang in PR.LANGS}
        self.d = d
        self.trs = [{lang: PR.Translator(lang, hv[s][lang]['dicts'], extra[lang]) for lang in PR.LANGS} for s in slugs]
        self.missing = []

    def __call__(self, sr):
        k = PR.key_of(sr)
        if k in self.d:
            return self.d[k]['en'], self.d[k]['ru']
        for tr in self.trs:
            en, ru = tr['en'].tr(sr, record=False), tr['ru'].tr(sr, record=False)
            if en is not None and ru is not None:
                return en, ru
        if len(sr.strip()) > 1:
            self.missing.append(sr)
        return sr, sr


def para(inner, tr):
    """<p> content -> string or segments [text, {a, href}, text]"""
    m = re.fullmatch(r'(.*?)<a href="([^"]*)" class="evb-link">([^<]*)</a>(.*)', inner, re.S)
    if not m:
        s = u(inner)
        return s, tr(s)
    a, href, anchor, b = u(m.group(1)), u(m.group(2)), u(m.group(3)), u(m.group(4))
    sr, en, ru = [], [], []
    for seg in (a, {'a': anchor, 'href': href}, b):
        if isinstance(seg, dict):
            e_, r_ = tr(seg['a'])
            sr.append(seg)
            en.append({'a': e_, 'href': seg['href']})
            ru.append({'a': r_, 'href': seg['href']})
        elif seg:
            e_, r_ = tr(seg) if len(seg.strip()) > 1 else (seg, seg)
            sr.append(seg)
            en.append(e_)
            ru.append(r_)
    return sr, (en, ru)


def blocks_of(art, tr):
    out = ([], [], [])
    pos = 0
    pat = re.compile(r'<h2 class="evb-ah2">([^<]*)</h2>|<p class="evb-ap">(.*?)</p>|<ul role="list" class="evb-ul">(.*?)</ul>'
                     r'|<div class="evb-anote">([^<]*)</div>|<div class="evb-tblw"><div class="evb-tbl">'
                     r'(<div class="evb-trh\d">(?:<div class="evb-th">[^<]*</div>)+</div>'
                     r'(?:<div class="evb-tr\d">(?:<div class="evb-td">[^<]*</div>)+</div>)*)</div></div>', re.S)
    while pos < len(art):
        m = pat.match(art, pos)
        if not m:
            raise SystemExit('unknown block at: %r' % art[pos:pos + 120])
        pos = m.end()
        if m.group(1) is not None:
            s = u(m.group(1))
            e_, r_ = tr(s)
            for d, v in zip(out, (s, e_, r_)):
                d.append({'h2': v})
        elif m.group(2) is not None:
            sr, (en, ru) = para(m.group(2), tr)
            for d, v in zip(out, (sr, en, ru)):
                d.append({'p': v})
        elif m.group(3) is not None:
            items = [u(x) for x in re.findall(r'<li class="evb-li">([^<]*)</li>', m.group(3))]
            trs = [tr(x) for x in items]
            out[0].append({'ul': items})
            out[1].append({'ul': [t[0] for t in trs]})
            out[2].append({'ul': [t[1] for t in trs]})
        elif m.group(4) is not None:
            s = u(m.group(4))
            e_, r_ = tr(s)
            for d, v in zip(out, (s, e_, r_)):
                d.append({'note': v})
        else:
            t = m.group(5)
            head = [u(x) for x in re.findall(r'<div class="evb-th">([^<]*)</div>', t)]
            rows = [[u(c) for c in re.findall(r'<div class="evb-td">([^<]*)</div>', r)]
                    for r in re.findall(r'<div class="evb-tr\d">((?:<div class="evb-td">[^<]*</div>)+)</div>', t)]
            for i, d in enumerate(out):
                f = (lambda x: x) if i == 0 else (lambda x, i=i: tr(x)[i - 1])
                d.append({'table': {'head': [f(x) for x in head], 'rows': [[f(c) for c in r] for r in rows]}})
    return out


def reconstruct(kind, slug, sources, assets):
    t = sources[slug]
    d, _ = dictionary(t, slug)
    tr = Tr(d, [slug, CT.HUB_VODICI if kind == 'vodic' else CT.HUB_B2B])
    get = lambda pat, what: u(CT.one(t, pat, what, re.S).group(1))  # noqa: E731
    title = get(r'<title>([^<]*)</title>', 'title')
    desc = get(r'<meta content="([^"]*)" name="description"/>', 'description')
    ogt = get(r'<meta content="([^"]*)" property="og:title"/>', 'og:title')
    ogd = get(r'<meta content="([^"]*)" property="og:description"/>', 'og:description')
    hero = CT.one(t, r'<div class="v3-ph"><div class="w3"><div class="v3-kick">([^<]*)</div><h1>([^<]*)</h1><p>([^<]*)</p>'
                     r'<div class="evb-upd">Ažurirano: ([^<]*)</div></div></div>', 'hero')
    h1, lead = u(hero.group(2)), u(hero.group(3))
    dm = re.fullmatch(r'(\d+)\. ([a-z]+) (\d{4})\.', hero.group(4))
    date = '%s-%02d-%02d' % (dm.group(3), CT.EVC.MONTHS['sr'].index(dm.group(2)) + 1, int(dm.group(1)))
    cover_url = CT.one(t, r'<section class="evb2-cvsec"><div class="w3"><img src="([^"]*)"', 'cover').group(1)
    cover = [i for i, v in CT.EVB.IMG.items() if v[1] == cover_url]
    # sections
    a = t.find('<section id="tekst" class="evb-sec-art">')
    b = t.find('<div class="v3-foot">')
    region = t[a:b]
    arts = re.findall(r'<section id="tekst(?:-\d+)?" class="evb-sec-art"><div class="w3"><div class="evb-art">(.*?)</div></div>'
                      r'</section>(?=<section)', region, re.S)
    blocks = ([], [], [])
    for art in arts:
        for i, bl in enumerate(blocks_of(art, tr)):
            blocks[i].extend(bl)
    src = CT.one(region, r'<section id="izvori" class="evb-sec-art"><div class="w3"><div class="evb-art"><h2 class="evb-ah2">'
                         r'([^<]*)</h2><ul role="list" class="evb-ul">(.*?)</ul><p class="evb-trans">', 'izvori', re.S)
    items = [(u(h), u(x)) for h, x in re.findall(r'<li class="evb-li"><a href="([^"]*)" class="evb-link">([^<]*)</a></li>',
                                                 src.group(2))]
    cta = CT.one(region, r'<section id="cta" class="evmk-sec"><div class="w3"><div class="evb-call"><div class="evb-callbody">'
                         r'<h2 class="evb-callh">([^<]*)</h2>(?:<p class="evb-callp">([^<]*)</p>)?</div>'
                         r'<a href="([^"]*)" class="evmk-btn">([^<]*)</a></div></div></section>', 'cta')
    sro = CT.one(region, r'<section id="srodni" class="evmk-sec"><div class="w3"><h2 class="evmk-h2">([^<]*)</h2>'
                         r'<div class="evb2-guides">(.*?)</div></div></section>$', 'srodni', re.S)
    links = re.findall(r'<a href="([^"]*)" class="evb2-g w-inline-block"><img [^>]*/><div class="evb2-gb"><div class="evb-lt">'
                       r'([^<]*)</div>(?:<div class="evb-lx">([^<]*)</div>)?</div><div class="evb2-garr">→</div></a>', sro.group(2))
    # card: on the hub (B2B: /punjaci-za-firme)
    hub = sources[CT.HUB_VODICI if kind == 'vodic' else CT.HUB_B2B]
    cm = CT.one(hub, r'<a href="/%s" class="evb2-g w-inline-block"><img [^>]*/><div class="evb2-gb"><div class="evb-lt">([^<]*)</div>'
                     r'<div class="evb-lx">([^<]*)</div>' % re.escape(slug), 'card on the hub')
    docs = []
    for li in range(3):
        pick = (lambda s: s) if li == 0 else (lambda s, li=li: tr(s)[li - 1])
        doc = {'page': slug + SUFFIX, 'slug': '/' + slug + SUFFIX, 'tone': 'ti' if kind == 'vodic' else 'vi', 'kind': 'article',
               'seo': {'title': pick(title), 'description': pick(desc), 'og_title': pick(ogt), 'og_description': pick(ogd)},
               'hero': {'kicker': '', 'h1': pick(h1), 'lead': pick(lead), 'updated': '@auto'},
               'card': {'title': pick(u(cm.group(1))), 'text': pick(u(cm.group(2)))},
               'sections': [
                   {'type': 'article', 'id': 'tekst', 'blocks': blocks[li]},
                   {'type': 'sources', 'id': 'izvori', 'h2': pick(u(src.group(1))),
                    'items': [{'title': pick(x), 'url': h} for h, x in items]},
                   {'type': 'callout', 'id': 'cta', 'h2': pick(u(cta.group(1))),
                    **({'text': pick(u(cta.group(2)))} if cta.group(2) is not None else {}),
                    'button': {'label': pick(u(cta.group(4))), 'href': u(cta.group(3))}},
                   {'type': 'links', 'id': 'srodni', 'h2': pick(u(sro.group(1))),
                    'items': [dict({'title': pick(u(ti)), 'href': u(h)}, **({'text': pick(u(x))} if x else {}))
                              for h, ti, x in links]}]}
        if kind == 'vodic' and cover:
            doc['cover'] = cover[0]
        docs.append(doc)
    return docs, date, tr


def compare(slug, new, orig, dict_script, whole):
    """Differences between the rendered page (new slug put back) and the original: the body from the hero to the
    footer byte for byte, the head texts, the JSON-LD as an object (the Organization's sameAs of pages published before
    26.10 had two profiles, the kits name six since — that one difference is expected and reported apart); with
    whole=True (the template page itself) the entire page without its dictionary script."""
    new = new.replace('/' + slug + SUFFIX, '/' + slug)
    orig = orig.replace(dict_script, '', 1)
    probs, notes = [], []
    ln = re.search(r'<script type="application/ld\+json">(.*?)</script>', new, re.S)
    lo = re.search(r'<script type="application/ld\+json">(.*?)</script>', orig, re.S)
    a, b = json.loads(ln.group(1)), json.loads(lo.group(1))
    for x, y in zip(a['@graph'], b['@graph']):
        if x.get('@type') == 'Organization' and x.get('sameAs') != y.get('sameAs'):
            notes.append('Organization.sameAs: %d profiles (kit v1.3), published %d' % (len(x['sameAs']), len(y['sameAs'])))
            y = dict(y, sameAs=x['sameAs'])
        if x != y:
            for k in sorted(set(x) | set(y)):
                if x.get(k) != y.get(k):
                    probs.append('JSON-LD %s %s: new %r | published %r' % (x.get('@type'), k, str(x.get(k))[:160],
                                                                        str(y.get(k))[:160]))
    if len(a['@graph']) != len(b['@graph']):
        probs.append('JSON-LD: %d nodes, published %d' % (len(a['@graph']), len(b['@graph'])))
    for pat in (r'<title>[^<]*</title>', r'<meta content="[^"]*" name="description"/>',
                r'<meta content="[^"]*" property="og:title"/>', r'<meta content="[^"]*" property="og:description"/>',
                r'<meta content="[^"]*" name="twitter:title"/>', r'<meta content="[^"]*" name="twitter:description"/>',
                r'<link href="[^"]*" rel="canonical"/>', r'<meta property="og:url" content="[^"]*">'):
        x, y = re.findall(pat, new), re.findall(pat, orig)
        if x != y:
            probs.append('head %s: new %r | published %r' % (pat[:30], x, y))
    def body(s):
        return s[s.index('<div class="v3-ph">'):s.index('<div class="v3-foot">')]
    bn, bo = body(new), body(orig)
    if bn != bo:
        i = next((i for i in range(min(len(bn), len(bo))) if bn[i] != bo[i]), min(len(bn), len(bo)))
        probs.append('body differs at %d (len %d vs %d):\n      new:       %r\n      published: %r' % (
            i, len(bn), len(bo), bn[max(0, i - 150):i + 150], bo[max(0, i - 150):i + 150]))
    if whole:
        new2 = new[:ln.start(1)] + new[ln.end(1):]
        orig2 = orig[:lo.start(1)] + orig[lo.end(1):]
        if new2 != orig2:
            i = next((i for i in range(min(len(new2), len(orig2))) if new2[i] != orig2[i]), min(len(new2), len(orig2)))
            probs.append('page differs at %d: new %r | published %r' % (i, new2[i - 80:i + 80], orig2[i - 80:i + 80]))
    return probs, notes


def news_items(sources):
    """The items on /novosti read back into the kit's format ({"sr", "en", "ru"}), with the published block of each."""
    t = sources[CT.NEWS_PAGE]
    d, _ = dictionary(t, CT.NEWS_PAGE)
    tr = Tr(d, [CT.NEWS_PAGE])
    out = []
    for m in re.finditer(r'<div id="([^"]+)" class="evb-art evn-item">(.*?)</p></div>(?=<div id=|</div>)', t, re.S):
        nid, inner = m.group(1), m.group(2) + '</p>'
        mm = re.match(r'<div class="evb-upd">([^<]*)</div><h2 class="evb-ah2">([^<]*)</h2><p class="evb-ap">([^<]*)</p>(.*)'
                      r'<p class="evb-trans">([^<]*?) (<a .*)</p>$', inner, re.S)
        if not mm:
            raise SystemExit('news block %s: unknown markup' % nid)
        title, lead, rest, links = u(mm.group(2)), u(mm.group(3)), mm.group(4), mm.group(6)
        blocks = ([], [], [])
        parts = re.findall(r'<p class="evb-ap">(.*?)</p>|<ul role="list" class="evb-ul">(.*?)</ul>', rest, re.S)
        why = u(parts[-1][0])
        for pp, ul in parts[:-1]:
            if ul:
                items = [u(x) for x in re.findall(r'<li class="evb-li">([^<]*)</li>', ul)]
                for i, b in enumerate(blocks):
                    b.append({'ul': [x if i == 0 else tr(x)[i - 1] for x in items]})
            else:
                s = u(pp)
                for i, b in enumerate(blocks):
                    b.append({'p': s if i == 0 else tr(s)[i - 1]})
        srcs = [(u(h), u(x)) for h, x in re.findall(r'<a href="([^"]*)" class="evb-link">([^<]*)</a>', links)]
        item = {}
        for i, lang in enumerate(('sr', 'en', 'ru')):
            pick = (lambda s: s) if i == 0 else (lambda s, i=i: tr(s)[i - 1])
            item[lang] = {'id': nid, 'date': nid[:10], 'title': pick(title), 'lead': pick(lead), 'blocks': blocks[i],
                          'why': pick(why), 'sources': [{'title': pick(x), 'url': h} for h, x in srcs]}
        out.append((item, m.group(0), tr))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--keep', help='write the reconstructed content here (a folder outside the repository)')
    ap.add_argument('--snapshot', default=os.path.join(SITE_DIR, 'snapshot'))
    args = ap.parse_args()
    sources, assets = CT.snapshot_sources(args.snapshot)
    base = args.keep or tempfile.mkdtemp(prefix='evo-content-selftest-')
    if os.path.realpath(base).startswith(os.path.realpath(SITE_DIR) + os.sep):
        raise SystemExit('--keep must be outside site/')
    fails = 0
    trs = {}
    for kind, slug in GUIDES:
        docs, date, tr = reconstruct(kind, slug, sources, assets)
        trs[slug] = tr
        d = os.path.join(base, CT.DIRS[kind], slug + SUFFIX)
        os.makedirs(d, exist_ok=True)
        for lang, doc in zip(('sr', 'en', 'ru'), docs):
            with open(os.path.join(d, lang + '.json'), 'w', encoding='utf-8') as f:
                json.dump(doc, f, ensure_ascii=False, indent=1)
        with open(os.path.join(d, 'meta.json'), 'w', encoding='utf-8') as f:
            json.dump({'date': date}, f)
    # news: the published items, read back from /novosti (and its dictionary), as one new item each
    c = CT.Content(sources, assets, base)
    for item, kind, text in c.messages:
        if kind == 'error':
            print('content error (%s): %s' % (item, text))
    if c.errors():
        fails += 1
    for kind, slug in GUIDES:
        page = slug + SUFFIX
        if page not in c.new_pages:
            print('FAIL /%s: not rendered' % slug)
            fails += 1
            continue
        d, script = dictionary(sources[slug], slug)
        probs, notes = compare(slug, c.new_pages[page], sources[slug], script, slug in CT.TEMPLATE.values())
        # pairs: every pair the build gets equals the original dictionary (texts the original dictionary has)
        bad = []
        for sr, en, ru in c.pairs[page]:
            k = PR.key_of(sr)
            if k in d and (d[k]['en'], d[k]['ru']) != (en, ru):
                bad.append(sr[:60])
        if trs[slug].missing:
            probs.append('texts without a pair in the original dictionary: %s' % trs[slug].missing[:5])
        if bad:
            probs.append('pairs differ from the original dictionary: %s' % bad[:5])
        print('%s /%s (%s): %s%s' % ('FAIL' if probs else 'ok  ', slug, kind, 'identical to the published page' if not probs
                                      else '\n   ' + '\n   '.join(probs), (' (%s)' % '; '.join(notes)) if notes else ''))
        fails += bool(probs)
    # news: every item on /novosti rendered again by the kit and written the Webflow way equals its published block
    for item, block, tr in news_items(sources):
        errs, _ = CT.EVC.newscheck(item)
        html_, pairs = CT.EVC.render_item(item)
        probs = ['newscheck: %s' % x for x in errs]
        if CT.wf(html_) != block:
            a, b = CT.wf(html_), block
            i = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
            probs.append('block differs at %d: new %r | published %r' % (i, a[i - 80:i + 120], b[i - 80:i + 120]))
        if tr.missing:
            probs.append('texts without a pair: %s' % tr.missing[:4])
        print('%s news %s: %s' % ('FAIL' if probs else 'ok  ', item['sr']['id'], 'identical to the published block'
                                  if not probs else '; '.join(probs)))
        fails += bool(probs)
    if not args.keep:
        shutil.rmtree(base)
    print('content selftest: %d of %d guides identical to the published pages' % (len(GUIDES) - fails, len(GUIDES)))
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())

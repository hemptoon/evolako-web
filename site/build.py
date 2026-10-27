#!/usr/bin/env python3
"""Static build of www.evolako.rs from the Webflow snapshot — step 2 of moving the site off Webflow ("parity build").

Reads site/snapshot/ (taken by tools/snapshot.py on the GitHub runner) and writes site/dist/ for Cloudflare Pages:

  <slug>.html              every page at the URL it has today, without a trailing slash (Pages serves /kontakt from
                           kontakt.html); index.html is /
  _a/<host>/<path>         every file the built pages use, at the same relative path as in snapshot/assets/ (a file
                           the snapshot saved without an extension gets one from its content type, e.g. the Google Fonts
                           CSS); every reference rewritten to that root-relative path — HTML attributes, srcset, inline
                           <style>/<script>, url()/@import inside the CSS, absolute URLs of other copied files inside JS
  404.html                 own "page not found" built from the markup of /vodici (navigation, footer, shared CSS/JS)
  robots.txt, sitemap.xml  as published (URLs stay on https://www.evolako.rs)
  _headers, _routes.json   cache and security headers; Pages Functions (site/functions/) run for pages, not for /_a/

Rules (see the report printed at the end):
  * og:image / twitter:image and JSON-LD keep absolute URLs, on https://www.evolako.rs/_a/... (crawlers need them).
  * Links on app.evolako.rs (live services: /s/p, /zgrada/broj, /kr/..., /embed/...) stay absolute and are not copied.
  * The Google WebFont loader (ajax.googleapis.com) is replaced by a <link> to the local copy of the Google Fonts CSS,
    whose url() point at the local font files; preconnect hints to the font hosts are dropped.
  * Everything else stays byte-for-byte as Webflow published it: data-wf-* attributes, jQuery, webflow.js, forms
    (still Webflow forms in this step). SRI hashes are recomputed only for files whose content changed here.
  * A file the manifest lists but the committed snapshot lacks is taken from site/snapshot-fill/ (same layout) only if
    its sha256 equals the manifest's — the copy is then provably the bytes the live site served.

Deterministic: the same snapshot gives a byte-identical dist. Standard library only. Nothing is deployed.
Usage: python3 site/build.py [--snapshot site/snapshot] [--fill site/snapshot-fill] [--out site/dist]
"""
import argparse
import base64
import hashlib
import html
import json
import os
import re
import shutil
import sys
import urllib.parse

SITE = 'https://www.evolako.rs'
ASSET_DIR = '_a'
LIVE_HOSTS = {'app.evolako.rs'}                       # live services: absolute links, nothing copied
FONT_HOSTS = {'fonts.googleapis.com', 'fonts.gstatic.com'}  # served locally after the build: hints are dropped
ABS_META = {'og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'}
TEMPLATE_404 = 'vodici'                               # page whose navigation/footer the 404 page reuses
EXT_BY_TYPE = {'text/css': '.css', 'application/javascript': '.js', 'text/javascript': '.js', 'image/png': '.png',
               'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg', 'font/ttf': '.ttf',
               'font/woff2': '.woff2', 'font/woff': '.woff', 'application/pdf': '.pdf'}
# Words that must never appear in Evolako copy (checked on the text this build writes itself, i.e. the 404 page)
BANNED_WORDS = re.compile(r'atest|popust|24/7|odmah', re.I)

COPY_404 = {
    'title': 'Stranica ne postoji | Evolako',
    'kick': '404',
    'h1': 'Ova stranica ne postoji',
    'p': 'Možda je adresa promenjena. Kreni od početne ili pogledaj pakete.',
    'home': 'Početna',
    'paketi': 'Paketi i cene',
}

HEADERS = """\
# www.evolako.rs on Cloudflare Pages — written by site/build.py (edit the build, not this file).
# No Content-Security-Policy yet: see "CSP inputs" printed by site/build.py and the external requests (with their
# resource types) listed by site/tools/qa_dist.py.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: camera=(), microphone=(), payment=(), usb=(), geolocation=(self)

# pages, robots.txt, sitemap.xml: short browser cache (the edge revalidates on every deploy)
/
  Cache-Control: public, max-age=300, must-revalidate

/:page
  Cache-Control: public, max-age=300, must-revalidate

# copied files: names change whenever the content changes (Webflow hashes, versioned scripts)
/_a/*
  Cache-Control: public, max-age=31536000, immutable

# *.pages.dev (production alias and every preview) is never indexed; site/functions/_middleware.js does the same
# for any host other than www.evolako.rs / evolako.rs
https://:project.pages.dev/*
  X-Robots-Tag: noindex, nofollow

https://:version.:project.pages.dev/*
  X-Robots-Tag: noindex, nofollow
"""

ROUTES = {'version': 1, 'include': ['/*'], 'exclude': ['/' + ASSET_DIR + '/*']}


def fail(msg):
    print('BUILD ERROR: ' + msg, file=sys.stderr)
    sys.exit(1)


def url_key(u):
    """Normalized form of an absolute URL for matching: host + percent-decoded path (+ query).

    Covers the variants that occur in Webflow output: &amp; in attributes, %2F inside registered-script paths,
    JSON-escaped slashes, protocol-relative and http:// forms."""
    u = html.unescape(u).replace('\\/', '/')
    if u.startswith('//'):
        u = 'https:' + u
    p = urllib.parse.urlsplit(u)
    if p.scheme not in ('http', 'https') or not p.netloc:
        return None
    return p.netloc.lower() + urllib.parse.unquote(p.path) + ('?' + p.query if p.query else '')


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def sri(b, algo):
    return algo + '-' + base64.b64encode(hashlib.new(algo, b).digest()).decode()


class Asset:
    def __init__(self, entry, src, dist_rel):
        self.url = entry['url']
        self.host = urllib.parse.urlsplit(entry['url']).netloc.lower()
        self.type = entry.get('type') or ''
        self.pages = entry.get('pages') or []
        self.kinds = entry.get('kinds') or []
        self.src = src              # file to read, or None when it cannot be found
        self.dist_rel = dist_rel    # path inside dist, e.g. _a/cdn.prod.website-files.com/...
        self.data = None            # bytes written to dist (rewritten for CSS/JS)
        self.refs = set()           # dist paths this file references (CSS/JS after rewriting)
        self.changed = False
        self.from_fill = False

    @property
    def local_url(self):
        return '/' + self.dist_rel

    @property
    def is_css(self):
        return self.type == 'text/css' or self.dist_rel.endswith('.css')

    @property
    def is_js(self):
        return 'javascript' in self.type or self.dist_rel.endswith('.js')


class Build:
    def __init__(self, snapshot, fill, out):
        self.snapshot, self.fill, self.out = snapshot, fill, out
        mpath = os.path.join(snapshot, 'manifest.json')
        if not os.path.exists(mpath):
            fail('no manifest at ' + mpath)
        with open(mpath, encoding='utf-8') as f:
            self.manifest = json.load(f)
        self.assets = {}            # url_key -> Asset (copyable)
        self.live = {}              # url_key -> manifest entry (live host, not copied)
        self.missing = []           # manifest entries with no usable file
        self.unmapped = {}          # (host, url) -> pages/files: absolute URLs on asset hosts that match no asset
        self.page_counts = {}       # page -> counts of rewritten references (total, absolute, per spelling)
        self.load_assets()
        hosts = {a.host for a in self.assets.values()} | LIVE_HOSTS
        alt = '|'.join(re.escape(h) for h in sorted(hosts, key=len, reverse=True))
        # an absolute (or protocol-relative) URL on one of the asset hosts, also JSON-escaped (https:\/\/...), up to a
        # quote, space, bracket, comma or backtick
        self.tok = re.compile(r'(?:https?:)?\\?/\\?/(?:%s)(?![A-Za-z0-9.-])(?:\\/|[^\s"\'<>()\\,`])*' % alt, re.I)

    # ---------------------------------------------------------------- assets
    def load_assets(self):
        used_dist = {}
        for e in sorted(self.manifest['assets'], key=lambda x: x['url']):
            if not e.get('file'):
                self.missing.append((e['url'], 'not fetched by the snapshot (HTTP %s)' % e.get('status')))
                continue
            key = url_key(e['url'])
            host = urllib.parse.urlsplit(e['url']).netloc.lower()
            if host in LIVE_HOSTS:
                self.live[key] = e
                continue
            rel = e['file']
            if not rel.startswith('assets/'):
                fail('unexpected asset path ' + rel)
            dist_rel = ASSET_DIR + '/' + rel[len('assets/'):]
            if not os.path.splitext(dist_rel.rsplit('/', 1)[-1])[1]:
                ext = EXT_BY_TYPE.get(e.get('type', ''))
                if ext:
                    dist_rel += ext
            if dist_rel in used_dist:
                fail('two assets map to %s: %s and %s' % (dist_rel, used_dist[dist_rel], e['url']))
            used_dist[dist_rel] = e['url']
            a = Asset(e, None, dist_rel)
            for base, is_fill in ((self.snapshot, False), (self.fill, True)):
                p = os.path.join(base, rel)
                if base and os.path.isfile(p):
                    with open(p, 'rb') as f:
                        data = f.read()
                    if sha256(data) != e.get('sha256'):
                        if is_fill:
                            fail('fill file %s does not match the manifest sha256' % p)
                        fail('snapshot file %s does not match the manifest sha256' % p)
                    a.src, a.data, a.from_fill = p, data, is_fill
                    break
            if a.src is None:
                self.missing.append((e['url'], 'listed in the manifest, file not in the snapshot or the fill'))
            self.assets[key] = a

    def lookup(self, token):
        """Asset for a URL token, trying the token as written, then without trailing entities / punctuation.
        Returns (matched_length, asset, fragment) or None."""
        t = token
        while t:
            base, _, frag = t.partition('#')
            k = url_key(base)
            if k in self.assets and self.assets[k].src:
                return len(t), self.assets[k], frag
            m = re.search(r'&(?:quot|apos|lt|gt|amp|#x?[0-9a-fA-F]+);$', t)
            if m:
                t = t[:m.start()]
                continue
            if t[-1] in '.;:!?':
                t = t[:-1]
                continue
            return None
        return None

    def rewrite_text(self, text, page=None, absolute_spans=(), counts=None, refs=None):
        """Replace every URL token that points at a copied file. Tokens inside absolute_spans (og:image meta, JSON-LD)
        get https://www.evolako.rs/_a/..., all others the root-relative /_a/... ."""
        def repl(m):
            tok = m.group(0)
            hit = self.lookup(tok)
            plain = tok.replace('\\/', '/')
            host = urllib.parse.urlsplit(('https:' + plain) if plain.startswith('//') else plain).netloc.lower()
            if not hit:
                if host not in LIVE_HOSTS and page is not None:
                    self.unmapped.setdefault((host, tok[:160]), set()).add(page)
                return tok
            n, asset, frag = hit
            absolute = any(s <= m.start() < e for s, e in absolute_spans)
            new = (SITE if absolute else '') + asset.local_url + ('#' + frag if frag else '')
            if refs is not None:
                refs.add(asset.dist_rel)
            if counts is not None:
                counts['rewritten'] += 1
                if absolute:
                    counts['absolute'] += 1
                if '%2f' in tok[:n].lower():
                    counts['pct2F'] += 1
                if '&amp;' in tok[:n]:
                    counts['amp'] += 1
                if '\\/' in tok[:n]:
                    counts['json_slash'] += 1
                if plain.startswith('//'):
                    counts['protocol_relative'] += 1
            return new + tok[n:]
        return self.tok.sub(repl, text)

    def rewrite_css(self, a):
        css = a.data.decode('utf-8')
        refs = set()

        def fix(ref):
            r = ref.strip()
            if not r or r.startswith(('data:', '#')):
                return None
            k = url_key(urllib.parse.urljoin(a.url, r).split('#')[0])
            b = self.assets.get(k)
            if b is not None and b.src:
                refs.add(b.dist_rel)
                return b.local_url
            if k and not k.startswith(tuple(LIVE_HOSTS)):
                self.unmapped.setdefault((urllib.parse.urlsplit(urllib.parse.urljoin(a.url, r)).netloc, r[:160]),
                                         set()).add(a.dist_rel)
            return None

        def url_repl(m):
            new = fix(m.group(2))
            return m.group(0) if new is None else 'url(' + m.group(1) + new + m.group(1) + ')'

        def imp_repl(m):
            new = fix(m.group(2))
            return m.group(0) if new is None else '@import ' + m.group(1) + new + m.group(1)

        out = re.sub(r'url\(\s*([\'"]?)([^\'")]+)\1\s*\)', url_repl, css, flags=re.I)
        out = re.sub(r'@import\s+([\'"])([^\'"]+)\1', imp_repl, out, flags=re.I)
        return out, refs

    def rewrite_assets(self):
        for a in sorted(self.assets.values(), key=lambda x: x.dist_rel):
            if a.data is None:
                continue
            if a.is_css:
                out, refs = self.rewrite_css(a)
            elif a.is_js:
                try:
                    text = a.data.decode('utf-8')
                except UnicodeDecodeError:
                    continue
                refs = set()
                out = self.rewrite_text(text, page=a.dist_rel, refs=refs)
            else:
                continue
            new = out.encode('utf-8')
            a.refs = refs
            if new != a.data:
                a.data, a.changed = new, True

    # ---------------------------------------------------------------- pages
    def font_css_asset(self):
        cands = [a for a in self.assets.values() if a.host == 'fonts.googleapis.com' and a.src]
        if len(cands) != 1:
            fail('expected exactly one Google Fonts stylesheet in the snapshot, found %d' % len(cands))
        return cands[0]

    def replace_webfont_loader(self, page, text):
        """<script src=.../webfont.js> + <script>WebFont.load(...)</script> -> <link rel=stylesheet> to the local CSS."""
        font = self.font_css_asset()
        loader = re.compile(r'<script\b[^>]*\bsrc="[^"]*/webfont(?:\.min)?\.js"[^>]*>\s*</script>', re.I)
        call = re.compile(r'<script\b[^>]*>\s*WebFont\.load\((.*?)\);?\s*</script>', re.I | re.S)
        ml, mc = list(loader.finditer(text)), list(call.finditer(text))
        if not ml and not mc:
            return text, None
        if len(ml) != 1 or len(mc) != 1:
            fail('%s: expected one WebFont loader and one WebFont.load call, found %d and %d' % (page, len(ml), len(mc)))
        fams = re.findall(r'"([^"]+)"', mc[0].group(1))
        link = '<link href="%s" rel="stylesheet" type="text/css"/>' % font.local_url
        text = text[:mc[0].start()] + text[mc[0].end():]
        text = loader.sub(lambda m: link, text, count=1)
        if 'WebFont' in text:
            fail(page + ': WebFont still referenced after replacing the loader')
        return text, fams

    def drop_font_hints(self, text):
        def repl(m):
            href = re.search(r'\bhref="([^"]*)"', m.group(0))
            host = urllib.parse.urlsplit(href.group(1)).netloc.lower() if href else ''
            return '' if host in FONT_HOSTS else m.group(0)
        return re.sub(r'<link\b[^>]*\brel="(?:preconnect|dns-prefetch)"[^>]*>', repl, text, flags=re.I)

    @staticmethod
    def absolute_spans(text):
        spans = []
        for m in re.finditer(r'<script\b[^>]*type=["\']?application/ld\+json["\']?[^>]*>(.*?)</script>', text,
                             re.I | re.S):
            spans.append((m.start(1), m.end(1)))
        for m in re.finditer(r'<meta\b[^>]*>', text, re.I):
            prop = re.search(r'\b(?:property|name)="([^"]+)"', m.group(0))
            if prop and prop.group(1).lower() in ABS_META:
                spans.append((m.start(), m.end()))
        return spans

    def fix_integrity(self, page, text):
        """Recompute integrity= for local files this build changed (e.g. the Webflow CSS after its url() rewrite)."""
        by_url = {a.local_url: a for a in self.assets.values() if a.src}
        changed = []

        def repl(m):
            tag = m.group(0)
            ref = re.search(r'\b(?:src|href)="([^"]+)"', tag)
            integ = re.search(r'\bintegrity="([^"]+)"', tag)
            if not ref or not integ or ref.group(1) not in by_url:
                return tag
            a = by_url[ref.group(1)]
            algo = integ.group(1).split('-', 1)[0]
            good = sri(a.data, algo)
            if integ.group(1) == good:
                return tag
            if not a.changed:
                fail('%s: integrity of unchanged %s does not match the file' % (page, a.dist_rel))
            changed.append(a.dist_rel)
            return tag.replace(integ.group(0), 'integrity="%s"' % good)

        return re.sub(r'<(?:script|link)\b[^>]*\bintegrity="[^"]+"[^>]*>', repl, text, flags=re.I), changed

    def build_page(self, page, text):
        counts = {'rewritten': 0, 'absolute': 0, 'pct2F': 0, 'amp': 0, 'json_slash': 0, 'protocol_relative': 0}
        refs = set()
        text, fams = self.replace_webfont_loader(page, text)
        text = self.drop_font_hints(text)
        text = self.rewrite_text(text, page=page, absolute_spans=self.absolute_spans(text), counts=counts, refs=refs)
        text, sri_changed = self.fix_integrity(page, text)
        counts['sri_updated'] = len(sri_changed)
        return text, refs, counts, fams

    def page_404(self, template_out):
        """Own 404: the /vodici page with its hero and sections replaced, its page-only scripts and metadata removed."""
        t = template_out
        a = t.find('<div class="v3-ph">')
        b = t.find('<div class="v3-foot">')
        if a < 0 or b < a or t.count('<div class="v3-ph">') != 1 or t.count('<div class="v3-foot">') != 1:
            fail('404: the template page no longer has one hero (v3-ph) and one footer (v3-foot)')
        c = COPY_404
        hero = ('<div class="v3-ph"><div class="w3"><div class="v3-kick">{kick}</div><h1>{h1}</h1><p>{p}</p>'
                '<div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:30px">'
                '<a href="/" class="evmk-btn">{home}</a><a href="/paketi-i-cene" class="evmk-btn2">{paketi}</a>'
                '</div></div></div>').format(**{k: html.escape(v) for k, v in c.items()})
        for v in c.values():
            if BANNED_WORDS.search(v):
                fail('404 copy contains a banned word: ' + v)
        t = t[:a] + hero + t[b:]
        # head: no canonical / description / social cards / structured data for a page that does not exist
        t = re.sub(r'<title>.*?</title>', '<title>%s</title>' % html.escape(c['title']), t, count=1, flags=re.S)
        t = re.sub(r'<link\b[^>]*\brel="canonical"[^>]*>', '', t)
        t = re.sub(r'<meta\b[^>]*\b(?:name|property)="(?:description|og:[^"]*|twitter:[^"]*)"[^>]*>', '', t)
        t = re.sub(r'<script\b[^>]*application/ld\+json[^>]*>.*?</script>', '', t, flags=re.S)
        t = t.replace('<meta charset="utf-8"/>', '<meta charset="utf-8"/><meta name="robots" content="noindex"/>', 1)
        # scripts that only the template page has (its EN/RU dictionaries, its EN/RU title) are dropped; scripts that
        # every page has (navigation, footer, i18n engine, consent, counter) stay
        shared_inline, shared_src = self.shared_scripts()

        def drop_page_scripts(m):
            tag, body = m.group(1), m.group(2)
            src = re.search(r'\bsrc="([^"]+)"', tag)
            if src:
                return m.group(0) if src.group(1) in shared_src else ''
            if 'application/ld+json' in tag:
                return ''
            return m.group(0) if sha256(body.encode()) in shared_inline else ''
        t = re.sub(r'(<script\b[^>]*>)(.*?)</script>', drop_page_scripts, t, flags=re.S)
        if BANNED_WORDS.search(re.sub(r'<[^>]+>', ' ', hero)):
            fail('404 hero contains a banned word')
        return t

    def shared_scripts(self):
        """Inline script bodies (sha256) and script src values present on every published page (after rewriting)."""
        inl, srcs = None, None
        for text in self.page_out.values():
            i = {sha256(m.group(2).encode()) for m in re.finditer(r'(<script\b[^>]*>)(.*?)</script>', text, re.S)
                 if 'src=' not in m.group(1)}
            s = set(re.findall(r'<script\b[^>]*\bsrc="([^"]+)"', text))
            inl = i if inl is None else inl & i
            srcs = s if srcs is None else srcs & s
        return inl or set(), srcs or set()

    # ---------------------------------------------------------------- run
    def run(self):
        pages = sorted(self.manifest['pages'], key=lambda p: p['path'])
        published = [p for p in pages if p['path'] != '404']
        if not published:
            fail('no pages in the manifest')
        self.rewrite_assets()
        self.page_out, page_refs, fams_seen = {}, {}, {}
        for p in published:
            slug = p['path'].strip('/') or 'index'
            if not re.fullmatch(r'[a-z0-9-]+', slug):
                fail('unexpected page path ' + p['path'])
            with open(os.path.join(self.snapshot, p['file']), encoding='utf-8') as f:
                src = f.read()
            out, refs, counts, fams = self.build_page(slug, src)
            self.page_out[slug] = out
            page_refs[slug] = refs
            self.page_counts[slug] = counts
            if fams:
                fams_seen.setdefault(tuple(fams), []).append(slug)
        if TEMPLATE_404 not in self.page_out:
            fail('404 template page /%s is missing' % TEMPLATE_404)
        self.page_out['404'] = self.page_404(self.page_out[TEMPLATE_404])
        page_refs['404'] = {r for r in page_refs[TEMPLATE_404]
                            if ('/' + r) in self.page_out['404'] or (SITE + '/' + r) in self.page_out['404']}

        # files to copy: everything the pages reference, plus what those CSS/JS files reference
        by_rel = {a.dist_rel: a for a in self.assets.values() if a.src}
        need, todo = set(), sorted(set().union(*page_refs.values()))
        while todo:
            r = todo.pop()
            if r in need:
                continue
            need.add(r)
            todo.extend(sorted(by_rel[r].refs - need))

        self.check_manifest_coverage(page_refs)
        self.write(need)
        self.report(need, fams_seen)

    def check_manifest_coverage(self, page_refs):
        """Every (page, asset) pair from the manifest is either rewritten on that page or explained."""
        self.not_rewritten = []
        for a in self.assets.values():
            for path in a.pages:
                slug = path.strip('/') or 'index'
                if slug == '404' or slug not in page_refs:
                    continue
                if a.dist_rel in page_refs[slug] or a.kinds == ['css']:
                    continue
                if a.host == 'ajax.googleapis.com':      # WebFont loader, replaced by the local font CSS
                    continue
                self.not_rewritten.append((slug, a.url))
        if self.not_rewritten:
            for slug, u in self.not_rewritten[:20]:
                print('  not rewritten on /%s: %s' % (slug, u), file=sys.stderr)
            fail('%d manifest references were not rewritten' % len(self.not_rewritten))

    def write(self, need):
        out = os.path.abspath(self.out)
        if os.path.basename(out) != 'dist' or os.path.exists(os.path.join(out, '.git')):
            fail('refusing to write to %s (the output folder must be called dist)' % out)
        if os.path.isdir(out):
            shutil.rmtree(out)
        os.makedirs(out)

        def put(rel, data):
            p = os.path.join(out, rel)
            os.makedirs(os.path.dirname(p), exist_ok=True)
            with open(p, 'wb') as f:
                f.write(data)

        for slug in sorted(self.page_out):
            put(slug + '.html', self.page_out[slug].encode('utf-8'))
        by_rel = {a.dist_rel: a for a in self.assets.values() if a.src}
        for rel in sorted(need):
            put(rel, by_rel[rel].data)
        for name in ('robots.txt', 'sitemap.xml'):
            p = os.path.join(self.snapshot, 'extra', name)
            if not os.path.isfile(p):
                fail('missing snapshot/extra/' + name)
            with open(p, 'rb') as f:
                put(name, f.read())
        put('_headers', HEADERS.encode('utf-8'))
        put('_routes.json', (json.dumps(ROUTES, indent=2, sort_keys=True) + '\n').encode('utf-8'))
        self.verify(out, need)

    def verify(self, out, need):
        # sitemap and pages describe the same URLs
        with open(os.path.join(out, 'sitemap.xml'), encoding='utf-8') as f:
            locs = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', f.read())
        sm = sorted(urllib.parse.urlsplit(u).path.strip('/') or 'index' for u in locs)
        built = sorted(s for s in self.page_out if s != '404')
        if sm != built:
            fail('sitemap URLs and built pages differ: %s' % sorted(set(sm) ^ set(built)))
        if not all(u.startswith(SITE) for u in locs):
            fail('sitemap URL outside ' + SITE)
        # every local reference resolves, every integrity attribute matches, nothing copyable is left absolute
        for slug, text in sorted(self.page_out.items()):
            for ref in re.findall(r'(?:%s)?/%s/[^\s"\'<>()\\,`#?]+' % (re.escape(SITE), ASSET_DIR), text):
                rel = ref[len(SITE) + 1:] if ref.startswith(SITE) else ref[1:]
                if not os.path.isfile(os.path.join(out, rel)):
                    fail('/%s references %s, which is not in dist' % (slug, ref))
            for m in re.finditer(r'<(?:script|link)\b[^>]*\bintegrity="([^"]+)"[^>]*>', text):
                ref = re.search(r'\b(?:src|href)="(/[^"]+)"', m.group(0))
                if ref:
                    with open(os.path.join(out, ref.group(1)[1:]), 'rb') as f:
                        algo = m.group(1).split('-', 1)[0]
                        if sri(f.read(), algo) != m.group(1):
                            fail('/%s: integrity mismatch for %s' % (slug, ref.group(1)))
            for m in self.tok.finditer(text):
                if self.lookup(m.group(0)):
                    fail('/%s still has an absolute URL of a copied file: %s' % (slug, m.group(0)[:120]))
        for rel in sorted(need):
            data = open(os.path.join(out, rel), 'rb').read()
            if rel.endswith(('.css', '.js')):
                for m in self.tok.finditer(data.decode('utf-8', 'replace')):
                    if self.lookup(m.group(0)):
                        fail('%s still has an absolute URL of a copied file: %s' % (rel, m.group(0)[:120]))

    # ---------------------------------------------------------------- report
    def report(self, need, fams_seen):
        out = os.path.abspath(self.out)
        total, files = 0, 0
        for root, _, fs in os.walk(out):
            for f in fs:
                total += os.path.getsize(os.path.join(root, f))
                files += 1
        by_rel = {a.dist_rel: a for a in self.assets.values() if a.src}
        asset_bytes = sum(len(by_rel[r].data) for r in need)
        print('dist: %s — %d files, %.1f MB (%d pages + 404, %d assets %.1f MB)' % (
            os.path.relpath(out), files, total / 1e6, len(self.page_out) - 1, len(need), asset_bytes / 1e6))
        tot = {k: sum(c[k] for c in self.page_counts.values()) for k in next(iter(self.page_counts.values()))}
        print('references rewritten in pages: %(rewritten)d (absolute on %(site)s: %(absolute)d; written with %%2F: '
              '%(pct2F)d, with &amp;: %(amp)d, JSON-escaped: %(json_slash)d, protocol-relative: %(protocol_relative)d); '
              'SRI recomputed: %(sri_updated)d' % dict(tot, site=SITE))
        changed = sorted(a.dist_rel for a in by_rel.values() if a.changed and a.dist_rel in need)
        print('copied files changed by the build (%d): %s' % (len(changed), ', '.join(changed)))
        fill = sorted(a.dist_rel for a in by_rel.values() if a.from_fill and a.dist_rel in need)
        if fill:
            print('taken from snapshot-fill (sha256 = manifest) (%d): %s' % (len(fill), ', '.join(fill)))
        skipped = sorted(a.url for a in by_rel.values() if a.dist_rel not in need)
        print('manifest files not copied (%d):' % (len(skipped) + len(self.live)))
        for u in skipped:
            print('   unused after the build: ' + u)
        for e in sorted(self.live.values(), key=lambda x: x['url']):
            print('   live host, link kept absolute: ' + e['url'])
        for u, why in self.missing:
            print('   MISSING: %s (%s)' % (u, why))
        # fonts: what the pages ask the WebFont loader for vs. what the copied Google Fonts CSS has
        font = self.font_css_asset()
        faces = re.findall(r"@font-face\s*\{[^}]*font-family:\s*'?([^;']+)'?;[^}]*font-weight:\s*([0-9 ]+);", font.data
                           .decode('utf-8'))
        have = {}
        for fam, w in faces:
            have.setdefault(fam.strip(), set()).update(w.split())
        for fams, slugs in sorted(fams_seen.items()):
            for spec in fams:
                parts = spec.split(':')
                fam, weights = parts[0], parts[1].split(',') if len(parts) > 1 else ['400']
                lack = [w for w in weights if w.rstrip('i') not in have.get(fam, set())]
                print('fonts: %d pages ask WebFont for %s; local CSS has %s %s -> %s' % (
                    len(slugs), spec, fam, ','.join(sorted(have.get(fam, set()))),
                    'missing weights: ' + ','.join(lack) if lack else 'all requested weights present'))
        # what a Content-Security-Policy would have to allow, as far as the HTML shows it (runtime loads: qa_dist.py)
        inline, per_page, style_blocks, style_attrs, src_hosts = set(), [], 0, 0, set()
        for slug, text in sorted(self.page_out.items()):
            n = 0
            for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', text, re.S):
                if 'src=' in m.group(1):
                    src = re.search(r'\bsrc="(https?://[^"]+)"', m.group(1))
                    if src:
                        src_hosts.add(urllib.parse.urlsplit(src.group(1)).netloc)
                elif 'ld+json' not in m.group(1):
                    n += 1
                    inline.add(sha256(m.group(2).encode()))
            per_page.append(n)
            style_blocks += len(re.findall(r'<style\b', text))
            style_attrs += len(re.findall(r'\sstyle="', text))
        print('CSP inputs: %d-%d inline <script> per page (%d distinct, hashable at build time), %d inline <style> '
              'blocks and %d style="" attributes in all pages (style-src needs \'unsafe-inline\'), no inline event '
              'handlers or javascript: URLs; <script src> on other hosts: %s; CSS data: fonts/images (font-src and '
              'img-src need data:)' % (min(per_page), max(per_page), len(inline), style_blocks, style_attrs,
                                        ', '.join(sorted(src_hosts)) or 'none'))
        if re.search(r'\son[a-z]+="|href="javascript:', ''.join(self.page_out.values())):
            print('   note: an inline event handler or javascript: URL appeared — CSP would need \'unsafe-inline\'')
        # absolute URLs on asset hosts that are not files (runtime-built URLs, bare hosts), in pages and copied files
        by_host = {}
        for (host, tok), where in self.unmapped.items():
            where = {w for w in where if w in self.page_out or w in need}
            if where:
                by_host.setdefault(host, []).append((tok, len(where)))
        for host in sorted(by_host):
            items = sorted(by_host[host])
            print('left as is on %s (%d distinct): %s' % (host, len(items), '; '.join(
                '%s [%d]' % (t, n) for t, n in items[:6]) + (' …' if len(items) > 6 else '')))


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--snapshot', default=os.path.join(here, 'snapshot'))
    ap.add_argument('--fill', default=os.path.join(here, 'snapshot-fill'))
    ap.add_argument('--out', default=os.path.join(here, 'dist'))
    args = ap.parse_args()
    Build(args.snapshot, args.fill, args.out).run()


if __name__ == '__main__':
    main()

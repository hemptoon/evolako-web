#!/usr/bin/env python3
"""Static build of www.evolako.rs from the Webflow snapshot (steps 2, 2b and 3 of moving the site off Webflow).

Reads site/snapshot/ (static crawl + runtime capture, both taken on the GitHub runner by the workflow "Site snapshot")
and writes site/dist/ for Cloudflare Pages. The built site needs neither Webflow nor Google at runtime.

  <slug>.html              every page at the URL it has today, without a trailing slash (Pages serves /kontakt from
                           kontakt.html); index.html is /. <html lang="sr">; Cyrillic stays a mode of the Serbian page
                           in the browser (?lang=sr-cyrl, the language menu)
  en/<slug>.html,          step 3: the same page prerendered in English / Russian at /en/<slug> and /ru/<slug> (home:
  ru/<slug>.html           /en/, /ru/) — static <html lang>, text, title, meta, canonical, hreflang, JSON-LD in that
                           language (site/prerender.py; dictionaries in site/i18n/); the menu links to the other
                           languages, old ?lang=en|ru links get a 301 from site/functions/_middleware.js
  _a/evo-i18n/<lang>.<sha>.js  the own translations (site/i18n/<lang>.json) for the engine of the /en/, /ru/ pages
  _a/<host>/<path>         every file the built pages use, at the same relative path as in snapshot/assets/ (a file
                           the snapshot saved without an extension gets one from its content type, e.g. the Google Fonts
                           CSS); every reference rewritten to that root-relative path — HTML attributes, srcset, inline
                           <style>/<script>, url()/@import inside the CSS, absolute URLs of other copied files inside JS.
                           Also the files the pages only load at runtime (manifest entries "runtime": true) when a built
                           page or a copied file started them (their "initiators")
  404.html                 own "page not found" built from the markup of /vodici (navigation, footer, shared CSS/JS)
  robots.txt               as published
  sitemap.xml              the published one (order, lastmod) with every page in sr, en and ru and xhtml:link
                           alternates (URLs stay on https://www.evolako.rs)
  _headers, _routes.json   cache and security headers incl. a Content-Security-Policy per page; Pages Functions
                           (site/functions/: noindex middleware, the form endpoint /f/<site>) run for pages, not /_a/

Rules (see the report printed at the end):
  * og:image / twitter:image and JSON-LD keep absolute URLs, on https://www.evolako.rs/_a/... (crawlers need them).
  * Live services stay absolute and are never copied: app.evolako.rs (evo-fx, the visit counter /s/p, /zgrada/broj,
    /kr/...), the exchange-rate file evo-fx reads (Supabase), the BlokVolt map embed on /mapa-punjaca and what it
    loads (manifest entries "live": true, or started by such a file).
  * Runtime-built URLs: script code that builds Webflow CDN URLs from a base + '<assetId>%2F<name>-1.0.0.js' (the
    i18n engine, its loader, the dictionary loaders of /preporuka and /mapa-punjaca, the consent loader, the i18n fix
    loader) gets the local base /_a/cdn.prod.website-files.com/<site>/<folder>/ and real slashes instead of %2F, so no
    local path depends on an encoded slash.
  * Fonts: the Google WebFont loader is replaced by a <link> to the local copy of the Google Fonts CSS (variable woff2,
    one face per subset over the whole weight range, so Onest 350/550 render as such); the OFL licence of Onest ships
    next to the font files; preconnect / dns-prefetch hints to hosts the built site does not use are dropped.
  * Forms: the local webflow.js posts to /f/<site> (site/functions/f/[site].js hands the form to the CRM bot through
    the service binding BOT) instead of https://webflow.com/api/v1/form/; Webflow's Turnstile sitekey is removed (it
    held the real submit back until a Turnstile token arrived); every form the endpoint accepts gets a hidden honeypot
    field "website". Fields, hidden fields, widgets and success/failure blocks stay as published.
  * CSP per page: sha256 of every inline script as the browser sees it after these rewrites, 'self', the live hosts
    the page uses (runtime capture: by resource type) plus the few endpoints that only an interaction reaches.
    'unsafe-inline' only for styles (406 <style> blocks and style="" attributes). /* (unknown paths -> 404.html)
    carries the 404 policy; each page rule replaces it ("! Content-Security-Policy", then its own policy).
  * Everything else stays byte-for-byte as Webflow published it: data-wf-* attributes, jQuery, webflow.js (apart from
    the form URL). SRI hashes are recomputed only for files whose content changed here.
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

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import prerender as PR  # noqa: E402  (site/prerender.py: the /en/ and /ru/ pages)

SITE = 'https://www.evolako.rs'
SITE_ID = '6ab19bf9a3bb86f8fb7bba00'
ASSET_DIR = '_a'
LIVE_HOSTS = {'app.evolako.rs'}                       # live services: absolute links, nothing copied
FONT_HOSTS = {'fonts.googleapis.com', 'fonts.gstatic.com'}
# Hosts the built site must never request (QA checks the same list); resource hints to them are dropped
FORBIDDEN_HOSTS = {'cdn.prod.website-files.com', 'd3e54v103j8qbb.cloudfront.net', 'd8j0ntlcm91z4.cloudfront.net',
                   'fonts.googleapis.com', 'fonts.gstatic.com', 'ajax.googleapis.com', 'cdn.jsdelivr.net',
                   'webflow.com', 'assets-global.website-files.com', 'uploads-ssl.webflow.com',
                   'app-assets.website-files.com'}
ABS_META = {'og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src'}
TEMPLATE_404 = 'vodici'                               # page whose navigation/footer the 404 page reuses
EXT_BY_TYPE = {'text/css': '.css', 'application/javascript': '.js', 'text/javascript': '.js', 'image/png': '.png',
               'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/jpeg': '.jpg', 'font/ttf': '.ttf',
               'font/woff2': '.woff2', 'font/woff': '.woff', 'application/pdf': '.pdf'}
# Words that must never appear in Evolako copy (checked on the text this build writes itself, i.e. the 404 page)
BANNED_WORDS = re.compile(r'atest|popust|24/7|odmah', re.I)

# Runtime-built Webflow CDN URLs: base + '<assetId>%2F<name>-1.0.0.js' -> local folder with real slashes
RUNTIME_BASE = 'https://cdn.prod.website-files.com/%s%%2F689e5ba67671442434f3ca35%%2F' % SITE_ID
LOCAL_RUNTIME_BASE = '/%s/cdn.prod.website-files.com/%s/689e5ba67671442434f3ca35/' % (ASSET_DIR, SITE_ID)
# webflow.js: the form backend
WEBFLOW_FORM_URL = '"https://webflow.com/api/v1/form/"'
LOCAL_FORM_URL = '"/f/"'
FORM_FUNCTION = os.path.join(HERE, 'functions', 'f', '[site].js')
HONEYPOT = 'website'
HONEYPOT_HTML = ('<div aria-hidden="true" style="position:absolute;left:-10000px;top:auto;width:1px;height:1px;'
                 'overflow:hidden"><input type="text" name="%s" value="" tabindex="-1" autocomplete="off"/></div>'
                 % HONEYPOT)
FONT_LICENSE = os.path.join(HERE, 'licenses', 'Onest-OFL.txt')
I18N_DIR = os.path.join(HERE, 'i18n')                # harvest.json (live dictionaries), en.json / ru.json (own),
HARVEST = os.path.join(I18N_DIR, 'harvest.json')      # keep.json (texts that stay as they are)
LANGS = PR.LANGS                                      # prerendered languages besides Serbian
EXTRA_DIR = ASSET_DIR + '/evo-i18n'                   # the site's own translations as scripts for the engine
WEBFLOW_COMMENT = '<!-- This site was created in Webflow. https://webflow.com -->'

COPY_404 = {
    'title': 'Stranica ne postoji | Evolako',
    'kick': '404',
    'h1': 'Ova stranica ne postoji',
    'p': 'Možda je adresa promenjena. Kreni od početne ili pogledaj pakete.',
    'home': 'Početna',
    'paketi': 'Paketi i cene',
}

# Content-Security-Policy: what every page needs (beyond the hashes of its inline scripts)
CSP_BASE = [
    ('default-src', ["'self'"]),
    # evo-fx (app.evolako.rs/embed), Cloudflare Web Analytics (beacon, loaded by the consent loader on every page)
    ('script-src', ["'self'", 'https://app.evolako.rs', 'https://static.cloudflareinsights.com']),
    ('style-src', ["'self'", "'unsafe-inline'"]),
    ('img-src', ["'self'", 'data:', 'blob:']),
    ('font-src', ["'self'", 'data:']),
    # visit counter /s/p, /zgrada/broj, career forms /kr (app.evolako.rs); evo-fx exchange rates (Supabase);
    # Web Analytics beacon; 'self' = the form endpoint /f/
    ('connect-src', ["'self'", 'https://app.evolako.rs', 'https://smcsmkkzdksocvroqekl.supabase.co',
                     'https://cloudflareinsights.com']),
    ('object-src', ["'none'"]),
    ('base-uri', ["'self'"]),
    ('form-action', ["'self'"]),
    ('frame-ancestors', ["'self'"]),
]
# Only after a visitor clicks "Dozvoli" in the cookie banner, the consent pack (evoconsent1210, decision of 11.10.2026)
# loads Google Analytics 4 and the Meta pixel, as on the Webflow site. Their hosts (Google's and Meta's published CSP
# lists) are allowed on every page that has the banner; without them the CSP would silently switch that analytics
# off. To run with no Google/Meta at all, empty this list (the banner then only stores the choice).
CSP_CONSENT_ANALYTICS = [
    ('script-src', ['https://*.googletagmanager.com', 'https://connect.facebook.net']),
    ('img-src', ['https://*.google-analytics.com', 'https://*.googletagmanager.com', 'https://www.facebook.com']),
    ('connect-src', ['https://*.google-analytics.com', 'https://*.analytics.google.com',
                     'https://*.googletagmanager.com', 'https://www.facebook.com']),
]
CONSENT_PACK = 'evocfconsent1210'                     # script name that loads the cookie banner and the consent pack
# Sources only an interaction reaches (no passive load shows them), by page
CSP_INTERACTION = {
    # BlokVolt map embed: MapLibre runs its worker from a blob: URL; address search and routes on demand
    'mapa-punjaca': [('worker-src', ["'self'", 'blob:']),
                     ('connect-src', ['https://photon.komoot.io', 'https://routing.openstreetmap.de'])],
}
CSP_DIRECTIVE_BY_KIND = {'script': 'script-src', 'stylesheet': 'style-src', 'image': 'img-src', 'font': 'font-src',
                         'media': 'media-src', 'fetch': 'connect-src', 'xhr': 'connect-src', 'other': 'connect-src',
                         'eventsource': 'connect-src', 'websocket': 'connect-src', 'texttrack': 'media-src',
                         'document': 'frame-src', 'manifest': 'manifest-src'}
HEADERS_MAX_LINE = 2000                               # Cloudflare Pages: characters per _headers line

HEADERS_TOP = """\
# www.evolako.rs on Cloudflare Pages — written by site/build.py (edit the build, not this file).
# Rules apply in this order; "! Name" removes a header an earlier rule set. Every page replaces the CSP of /* (which
# unknown paths get with 404.html) with its own: the sha256 of its inline scripts, 'self' and the hosts it uses.
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Strict-Transport-Security: max-age=31536000
  Permissions-Policy: camera=(), microphone=(), payment=(), usb=(), geolocation=(self)
  Content-Security-Policy: {csp404}

# copied files: names change whenever the content changes (Webflow hashes, versioned scripts); no CSP on files
/_a/*
  Cache-Control: public, max-age=31536000, immutable
  ! Content-Security-Policy

# pages, robots.txt, sitemap.xml: short browser cache (the edge revalidates on every deploy)
/:page
  Cache-Control: public, max-age=300, must-revalidate

/
  Cache-Control: public, max-age=300, must-revalidate
  ! Content-Security-Policy
  Content-Security-Policy: {cspindex}

# /en/ and /ru/: the same pages in English and Russian, with the same scripts, so each shares the policy of its
# Serbian page (":lang" is one path segment; /en/x and /ru/x are the only pages it can match)
/:lang/:page
  Cache-Control: public, max-age=300, must-revalidate

/:lang/
  Cache-Control: public, max-age=300, must-revalidate
  ! Content-Security-Policy
  Content-Security-Policy: {cspindex}
"""
HEADERS_BOTTOM = """
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


def host_of(u):
    return (urllib.parse.urlsplit(u).hostname or '').lower()


def is_forbidden(host):
    return any(host == h or host.endswith('.' + h) for h in FORBIDDEN_HOSTS)


def page_path(slug):
    return '/' if slug == 'index' else '/' + slug


def page_file(path):
    """dist file that serves a page path (/, /x, /en/, /en/x), or None for anything else."""
    if path == '/':
        return 'index.html'
    m = re.fullmatch(r'/(en|ru)/([a-z0-9-]*)', path)
    if m:
        return '%s/%s.html' % (m.group(1), m.group(2) or 'index')
    m = re.fullmatch(r'/([a-z0-9-]+)', path)
    return m.group(1) + '.html' if m else None


JS_TYPES = ('', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript', 'application/ecmascript')


def inline_scripts(text):
    """(attributes, body) of every inline script the browser executes (no src, a JavaScript type)."""
    out = []
    for m in re.finditer(r'<script\b([^>]*)>(.*?)</script>', text, re.S | re.I):
        attrs = m.group(1)
        if re.search(r'\ssrc\s*=', attrs):
            continue
        t = re.search(r'\btype\s*=\s*["\']?([^"\'\s>]+)', attrs)
        if (t.group(1).lower() if t else '') not in JS_TYPES:
            continue
        out.append((attrs, m.group(2)))
    return out


def csp_hash(body):
    # the HTML parser turns CR LF / CR into LF before the script text exists
    b = body.replace('\r\n', '\n').replace('\r', '\n').encode('utf-8')
    return "'sha256-%s'" % base64.b64encode(hashlib.sha256(b).digest()).decode()


class Asset:
    def __init__(self, entry, src, dist_rel):
        self.url = entry['url']
        self.host = urllib.parse.urlsplit(entry['url']).netloc.lower()
        self.type = entry.get('type') or ''
        self.pages = entry.get('pages') or []
        self.kinds = entry.get('kinds') or []
        self.runtime = bool(entry.get('runtime'))
        self.initiators = entry.get('initiators') or []
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
    def __init__(self, snapshot, fill, out, allow_missing=False):
        self.snapshot, self.fill, self.out = snapshot, fill, out
        self.allow_missing = allow_missing
        mpath = os.path.join(snapshot, 'manifest.json')
        if not os.path.exists(mpath):
            fail('no manifest at ' + mpath)
        with open(mpath, encoding='utf-8') as f:
            self.manifest = json.load(f)
        self.assets = {}            # url_key -> Asset (copyable)
        self.live = {}              # url_key -> manifest entry (live service, not copied)
        self.missing = []           # manifest entries with no usable file
        self.unmapped = {}          # (host, url) -> pages/files: absolute URLs on asset hosts that match no asset
        self.page_counts = {}       # page -> counts of rewritten references (total, absolute, per spelling)
        self.runtime_bases = []     # (page or file, number of runtime bases rewritten)
        self.runtime_tokens = {}    # '<assetId>/<name>' pieces of runtime URL maps -> where they were found
        self.forms = []             # (page, data-name) of the forms that post to /f/
        self.turnstile_removed = 0
        self.hints_dropped = {}
        self.form_url_patched = None
        self.file_patches = {}      # copied script -> dist paths patched for /en/ and /ru/ (PR.FILE_PATCHES)
        self.inline_patches = {}    # inline patch name -> count over all pages (PR.INLINE_PATCHES)
        self.engines_patched = 0
        self.load_assets()
        self.live_hosts = LIVE_HOSTS | {host_of(e['url']) for e in self.live.values()}
        hosts = {a.host for a in self.assets.values()} | self.live_hosts
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
            if host in LIVE_HOSTS or e.get('live'):
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
                if host not in self.live_hosts and page is not None:
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

    def rewrite_runtime_bases(self, text, where):
        """Script code that builds Webflow CDN URLs at runtime: the base becomes the local folder and the %2F
        separators of the pieces it concatenates ('<assetId>%2F<name>', '%2Fbv...') real slashes."""
        n = text.count(RUNTIME_BASE)
        if not n:
            return text, 0
        t = text.replace(RUNTIME_BASE, LOCAL_RUNTIME_BASE)
        t = re.sub(r'(?<=[0-9a-f]{24})%2F', '/', t)
        t = re.sub(r'(["\'])%2F(?=[A-Za-z])', r'\1/', t)
        left = re.findall(r'.{0,50}%2[Ff].{0,30}', t)
        if left:
            fail('%s: an encoded slash is left after rewriting the runtime CDN base: %s' % (where, left[:3]))
        for m in re.finditer(r'["\']([0-9a-f]{24}/[A-Za-z0-9_.-]+)["\']', t):
            self.runtime_tokens.setdefault(m.group(1), set()).add(where)
        self.runtime_bases.append((where, n))
        return t, n

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
            if k and not k.startswith(tuple(self.live_hosts)):
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

    def is_webflow_js(self, a):
        return a.host == 'cdn.prod.website-files.com' and re.search(r'/js/webflow\.[^/]+\.js$', a.dist_rel)

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
                text, _ = self.rewrite_runtime_bases(text, a.dist_rel)
                if self.is_webflow_js(a):
                    if text.count(WEBFLOW_FORM_URL) != 1:
                        fail('%s: expected the form URL %s once, found %d' % (a.dist_rel, WEBFLOW_FORM_URL,
                                                                             text.count(WEBFLOW_FORM_URL)))
                    if self.form_url_patched:
                        fail('two webflow.js files: %s and %s' % (self.form_url_patched, a.dist_rel))
                    text = text.replace(WEBFLOW_FORM_URL, LOCAL_FORM_URL)
                    self.form_url_patched = a.dist_rel
                for name, old, new in PR.FILE_PATCHES:
                    if a.dist_rel.rsplit('/', 1)[-1] == name:
                        if text.count(old) != 1:
                            fail('%s: path patch expected once, found %d: %s' % (a.dist_rel, text.count(old), old))
                        text = text.replace(old, new)
                        self.file_patches.setdefault(name, []).append(a.dist_rel)
                out = self.rewrite_text(text, page=a.dist_rel, refs=refs)
            else:
                continue
            new = out.encode('utf-8')
            a.refs = refs
            if new != a.data:
                a.data, a.changed = new, True

    # ---------------------------------------------------------------- pages
    def font_css_asset(self):
        """The Google Fonts stylesheet the pages use (the runtime capture may add others, e.g. the CSS the WebFont
        loader asked for — that loader is not part of the build)."""
        cands = [a for a in self.assets.values() if a.host == 'fonts.googleapis.com' and a.src and not a.runtime]
        if len(cands) != 1:
            fail('expected exactly one Google Fonts stylesheet in the static snapshot, found %d' % len(cands))
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

    def drop_hints(self, page, text):
        """preconnect / dns-prefetch to hosts the built site no longer loads from (Webflow CDN, fonts, jsDelivr)."""
        def repl(m):
            href = re.search(r'\bhref="([^"]*)"', m.group(0))
            host = urllib.parse.urlsplit(href.group(1)).netloc.lower() if href else ''
            if is_forbidden(host):
                self.hints_dropped[host] = self.hints_dropped.get(host, 0) + 1
                return ''
            return m.group(0)
        return re.sub(r'<link\b[^>]*\brel="(?:preconnect|dns-prefetch)"[^>]*>', repl, text, flags=re.I)

    def rewrite_inline_scripts(self, page, text):
        def repl(m):
            attrs, body = m.group(1), m.group(2)
            if re.search(r'\ssrc\s*=', attrs):
                return m.group(0)
            new, n = self.rewrite_runtime_bases(body, page)
            return '<script' + attrs + '>' + new + '</script>' if n else m.group(0)
        return re.sub(r'<script\b([^>]*)>(.*?)</script>', repl, text, flags=re.S | re.I)

    def prepare_forms(self, page, text):
        """No Turnstile; a honeypot in every form the endpoint accepts; nothing else changes."""
        out, pos = [], 0
        for m in re.finditer(r'<form\b[^>]*>', text):
            end = text.find('</form>', m.end())
            if end < 0:
                fail('%s: unclosed <form>' % page)
            tag = m.group(0)
            body = text[m.end():end]
            new_tag, k = re.subn(r'\s+data-turnstile-sitekey="[^"]*"', '', tag)
            self.turnstile_removed += k
            dn = re.search(r'\bdata-name="([^"]*)"', tag)
            name = html.unescape(dn.group(1)) if dn else None
            can_submit = bool(re.search(r'<input\b[^>]*\btype="submit"', body) or re.search(r'<button\b', body))
            if name in self.form_names:
                if re.search(r'\bname="%s"' % HONEYPOT, body):
                    fail('%s: the form %s already has a field named %s' % (page, name, HONEYPOT))
                body += HONEYPOT_HTML
                self.forms.append((page, name))
            elif name is not None and can_submit:
                fail('%s: Webflow form "%s" can be sent but the form endpoint does not accept it (FORM_NAMES in %s)'
                     % (page, name, os.path.relpath(FORM_FUNCTION, HERE)))
            out.append(text[pos:m.start()] + new_tag + body)
            pos = end
        out.append(text[pos:])
        text = ''.join(out)
        if 'data-turnstile-sitekey' in text:
            fail(page + ': a Turnstile sitekey is left')
        return text

    @staticmethod
    def set_lang(page, text):
        tags = re.findall(r'<html\b[^>]*>', text, re.I)
        if len(tags) != 1:
            fail('%s: expected one <html> tag, found %d' % (page, len(tags)))
        tag = tags[0]
        new = re.sub(r'\slang="[^"]*"', ' lang="sr"', tag) if re.search(r'\slang=', tag) else '<html lang="sr"' + tag[5:]
        return text.replace(tag, new, 1)

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
        text = text.replace(WEBFLOW_COMMENT, '', 1)
        text, fams = self.replace_webfont_loader(page, text)
        text = self.drop_hints(page, text)
        text = self.rewrite_inline_scripts(page, text)
        try:
            text, n = PR.patch_engine(text, page)
        except ValueError as e:
            fail(str(e))
        if not n:
            fail('%s: the i18n engine (%s) is missing' % (page, PR.ENGINE_MARKER))
        self.engines_patched += n
        text = PR.patch_inline(text, self.inline_patches)
        text = self.prepare_forms(page, text)
        text = self.set_lang(page, text)
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
    def read_form_names(self):
        try:
            with open(FORM_FUNCTION, encoding='utf-8') as f:
                src = f.read()
        except OSError:
            fail('form endpoint %s is missing' % FORM_FUNCTION)
        m = re.search(r'export const FORM_NAMES = \[(.*?)\];', src, re.S)
        hp = re.search(r"export const HONEYPOT = '([^']+)';", src)
        sid = re.search(r"export const SITE_ID = '([^']+)';", src)
        if not m or not hp or not sid:
            fail('%s: FORM_NAMES, HONEYPOT or SITE_ID not found' % FORM_FUNCTION)
        if hp.group(1) != HONEYPOT or sid.group(1) != SITE_ID:
            fail('%s: HONEYPOT / SITE_ID differ from the build' % FORM_FUNCTION)
        return set(re.findall(r"'([^']*)'", m.group(1)))

    def run(self):
        pages = sorted(self.manifest['pages'], key=lambda p: p['path'])
        published = [p for p in pages if p['path'] != '404']
        if not published:
            fail('no pages in the manifest')
        self.form_names = self.read_form_names()
        self.rewrite_assets()
        if not self.form_url_patched:
            fail('webflow.js not found in the snapshot — the form URL could not be pointed at /f/')
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
        seen_forms = {n for _, n in self.forms}
        if seen_forms != self.form_names:
            fail('forms on the pages %s and FORM_NAMES of the endpoint %s differ' % (sorted(seen_forms),
                                                                                   sorted(self.form_names)))
        # languages: hreflang alternates and real language-menu links on the Serbian pages, then /en/ and /ru/
        self.languages()
        for (lang, slug), text in self.lang_out.items():
            page_refs[(lang, slug)] = set(page_refs[slug])

        # files to copy: everything the pages reference, plus what those CSS/JS files reference, plus the runtime
        # files a built page or a copied file starts (repeated until nothing new is added)
        by_rel = {a.dist_rel: a for a in self.assets.values() if a.src}
        need = set()

        def close(todo):
            todo = sorted(todo)
            while todo:
                r = todo.pop()
                if r in need:
                    continue
                need.add(r)
                todo.extend(sorted(by_rel[r].refs - need))
        close(set().union(*page_refs.values()))
        page_urls = {url_key(SITE + page_path(s)) for s in self.page_out if s != '404'}
        runtime = sorted((a for a in by_rel.values() if a.runtime), key=lambda a: a.dist_rel)
        while True:
            copied = page_urls | {url_key(by_rel[r].url) for r in need}
            add = [a.dist_rel for a in runtime if a.dist_rel not in need
                   and any(url_key(i) in copied for i in a.initiators)]
            if not add:
                break
            close(add)
        self.runtime_unused = [a for a in runtime if a.dist_rel not in need]

        self.check_manifest_coverage(page_refs)
        self.csp = self.content_security_policies()
        self.write(need)
        self.report(need, fams_seen)

    # ---------------------------------------------------------------- languages
    def check_patches(self):
        for name, rx, fn, minimum in PR.INLINE_PATCHES:
            if self.inline_patches.get(name, 0) < minimum:
                fail('inline patch "%s" applied %d times, expected at least %d' % (
                    name, self.inline_patches.get(name, 0), minimum))
        for name, old, new in PR.FILE_PATCHES:
            if name not in self.file_patches:
                fail('path patch for %s: file not in the build' % name)
        if sum(len(v) for v in self.file_patches.values()) != len(PR.FILE_PATCHES):
            fail('path patches applied %d times, expected %d' % (sum(len(v) for v in self.file_patches.values()),
                                                                 len(PR.FILE_PATCHES)))
        if self.engines_patched != len(self.page_out) - 1:
            fail('i18n engine patched on %d of %d pages' % (self.engines_patched, len(self.page_out) - 1))
        left = {}
        for slug, text in self.page_out.items():
            for _, body in inline_scripts(text):
                for m in re.finditer(r'.{0,60}location\.pathname.{0,40}', body):
                    if 'replaceState' not in m.group(0) and 'EVO_PATH' not in m.group(0) and 'location.origin+location.pathname+(L()' not in m.group(0) and 'var EP=' not in m.group(0):
                        left.setdefault(m.group(0).strip()[:100], set()).add(slug)
        self.pathname_left = left

    def load_harvest(self):
        if not os.path.isfile(HARVEST):
            fail('%s is missing: run python3 site/tools/i18n_harvest.py (needs Playwright) and commit it' %
                 os.path.relpath(HARVEST))
        with open(HARVEST, encoding='utf-8') as f:
            h = json.load(f)
        with open(os.path.join(self.snapshot, 'manifest.json'), 'rb') as f:
            sha = sha256(f.read())
        if h.get('snapshot_manifest_sha256') != sha:
            fail('%s was taken from another snapshot (manifest %s, snapshot %s): run python3 '
                 'site/tools/i18n_harvest.py again and commit it' % (os.path.relpath(HARVEST),
                                                                     (h.get('snapshot_manifest_sha256') or '?')[:12],
                                                                     sha[:12]))
        sys.path.insert(0, os.path.join(HERE, 'tools'))
        from i18n_harvest import expand
        pages = expand(h)
        missing = [s for s in self.page_out if s != '404' and not all(l in pages.get(s, {}) for l in LANGS)]
        if missing:
            fail('the harvest lacks pages %s: run python3 site/tools/i18n_harvest.py' % missing)
        return pages

    def languages(self):
        self.check_patches()
        harvest = self.load_harvest()
        try:
            self.keep = PR.load_keep(I18N_DIR)
            self.extra = {}
            for lang in LANGS:
                self.extra[lang], src = PR.load_i18n(I18N_DIR, lang)
                bad = [(k, src[k][:50], p) for k, v in self.extra[lang].items()
                       for p in PR.copy_problems(lang, src[k], v)]
                if bad:
                    fail('site/i18n/%s.json breaks the copy rules: %s' % (lang, bad[:8]))
        except ValueError as e:
            fail(str(e))
        slugs = sorted(s for s in self.page_out if s != '404')
        alts = 0
        for slug in slugs:
            text, n_menu, n_chips = PR.language_menu(self.page_out[slug], slug)
            if n_menu != 4 or n_chips != 3:
                fail('/%s: language menu has %d entries in the header and %d chips in the footer (expected 4 and 3)'
                     % (slug, n_menu, n_chips))
            canon = re.findall(r'<link\b[^>]*\brel="canonical"[^>]*>', text)
            if len(canon) != 1:
                fail('/%s: expected one canonical link, found %d' % (slug, len(canon)))
            text = text.replace(canon[0], canon[0] + PR.alternates(SITE, slug), 1)
            alts += 1
            self.page_out[slug] = text
        self.extra_files = {}
        for lang in LANGS:
            js = PR.extra_script(lang, self.extra[lang]).encode('utf-8')
            self.extra_files[lang] = ('%s/%s.%s.js' % (EXTRA_DIR, lang, sha256(js)[:10]), js)
        self.lang_out, self.lang_report = {}, {}
        missing_head = []
        for lang in LANGS:
            for slug in slugs:
                hv = harvest[slug][lang]
                tr = PR.Translator(lang, hv['dicts'], self.extra[lang])
                try:
                    doc, rep = PR.make_lang_page(self.page_out[slug], slug, lang, tr, self.keep, SITE,
                                                 '/' + self.extra_files[lang][0], PR.ENGINE_MARKER)
                except ValueError as e:
                    fail(str(e))
                title = html.unescape(re.search(r'<title>(.*?)</title>', self.page_out[slug], re.S).group(1))
                if (tr.live(title) or PR.nm(title)) != hv['title']:
                    fail('/%s/%s: the engine titled the live page %r, the build computes %r' % (
                        lang, slug, hv['title'], tr.live(title)))
                if rep.get('chains'):
                    fail('/%s/%s: translations the engine would translate again at runtime: %s' % (
                        lang, slug, rep['chains'][:5]))
                bad = {k for d in (hv.get('unstable') or {}).values() for k in d} & tr.used_live
                if bad:
                    fail('/%s/%s uses dictionary keys whose live value depends on load timing: %s' % (
                        lang, slug, sorted(bad)))
                self.lang_out[(lang, slug)] = doc
                body = html.unescape(re.sub(r'<[^>]+>', ' ', re.sub(r'<(script|style)\b.*?</\1>', ' ',
                                                                     doc[doc.find('<body'):], flags=re.S)))
                rep['banned_live'] = sorted({m.group(0) for p in PR.BANNED[lang]
                                             for m in re.finditer(r'[^.!?\n]{0,60}' + p + r'[^.!?\n]{0,40}', body,
                                                                  re.I)})
                rep['hits'] = dict(tr.hits)
                rep['extra_used'] = sorted(tr.used_extra)
                self.lang_report[(lang, slug)] = rep
                missing_head += [(lang, slug, k, v) for k, v in rep['missing_head']]
        self.alternates_added = alts
        if missing_head:
            self.write_missing(missing_head)
            msg = ('%d title/meta/JSON-LD texts of the /en/ and /ru/ pages have no translation (list: %s); add them '
                   'to site/i18n/<lang>.json' % (len(missing_head), os.path.relpath(self.missing_path)))
            if not self.allow_missing:
                fail(msg)
            print('WARNING (--allow-missing, never for a release): ' + msg, file=sys.stderr)

    def write_missing(self, items):
        out = {}
        for lang, slug, kind, sr in items:
            e = out.setdefault(lang, {}).setdefault(PR.key_of(sr), {'sr': sr, 'where': []})
            e['where'].append('/%s %s' % (slug, kind))
        self.missing_path = os.path.join(os.path.dirname(os.path.abspath(self.out)), 'i18n-missing.json')  # ignored
        with open(self.missing_path, 'w', encoding='utf-8') as f:
            json.dump(out, f, ensure_ascii=False, indent=1, sort_keys=True)

    def check_manifest_coverage(self, page_refs):
        """Every (page, asset) pair from the static manifest is either rewritten on that page or explained."""
        self.not_rewritten = []
        for a in self.assets.values():
            if a.runtime:
                continue
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

    # ---------------------------------------------------------------- CSP
    def page_live_sources(self):
        """Per page: (directive, origin) of every live-service request the runtime capture saw, and of the files those
        services loaded from other hosts (e.g. the map library the BlokVolt embed takes from jsDelivr)."""
        live_urls = {url_key(e['url']) for e in self.live.values()}
        embed = list(self.live.values())
        # runtime files not copied, started by a live service (or by such a file): they stay external too
        keys = live_urls
        pending = [a for a in self.runtime_unused]
        while True:
            more = [a for a in pending if any(url_key(i) in keys or host_of(i) in self.live_hosts
                                              for i in a.initiators)]
            if not more:
                break
            for a in more:
                pending.remove(a)
                embed.append({'url': a.url, 'kinds': a.kinds, 'pages': a.pages})
            keys = keys | {url_key(a.url) for a in more}
        self.embed_dependencies = sorted(e['url'] for e in embed if url_key(e['url']) not in live_urls)
        out = {}
        for e in embed:
            p = urllib.parse.urlsplit(e['url'])
            origin = '%s://%s' % (p.scheme, p.netloc.lower())
            for kind in e.get('kinds') or []:
                d = CSP_DIRECTIVE_BY_KIND.get(kind.split('[')[0].split(':')[0])
                if kind.startswith('script[') or kind == 'script':
                    d = 'script-src'
                if not d:
                    continue
                for page in e.get('pages') or []:
                    out.setdefault(page.strip('/') or 'index', set()).add((d, origin))
        return out

    def content_security_policies(self):
        live = self.page_live_sources()
        policies = {}
        self.csp_hashes = {}
        for slug, text in self.page_out.items():
            pol = [(d, list(s)) for d, s in CSP_BASE]
            idx = {d: i for i, (d, _) in enumerate(pol)}

            def add(d, srcs):
                if d not in idx:                      # a directive the base leaves to default-src 'self'
                    idx[d] = len(pol)
                    pol.insert(len(pol) - 4, (d, ["'self'"]))
                    idx.update({x: i for i, (x, _) in enumerate(pol)})
                cur = pol[idx[d]][1]
                for s in srcs:
                    if s not in cur:
                        cur.append(s)
            hashes = sorted({csp_hash(body) for _, body in inline_scripts(text)})
            script = pol[idx['script-src']][1]
            pol[idx['script-src']] = ('script-src', script[:1] + hashes + script[1:])
            for d, origin in sorted(live.get(slug, ())):
                add(d, [origin])
            if CONSENT_PACK in text:
                for d, srcs in CSP_CONSENT_ANALYTICS:
                    add(d, srcs)
            for d, srcs in CSP_INTERACTION.get(slug, []):
                add(d, srcs)
            value = '; '.join('%s %s' % (d, ' '.join(s)) for d, s in pol)
            line = '  Content-Security-Policy: ' + value
            if len(line) > HEADERS_MAX_LINE:
                fail('CSP of /%s is %d characters, Pages allows %d per _headers line' % (slug, len(line),
                                                                                      HEADERS_MAX_LINE))
            if re.search(r'\son[a-z]+\s*=\s*["\']|href="javascript:', text):
                fail('%s: an inline event handler or javascript: URL — the CSP would block it' % slug)
            policies[slug] = (value, len(hashes))
            self.csp_hashes[slug] = hashes
        for (lang, slug), text in sorted(self.lang_out.items()):
            hashes = sorted({csp_hash(body) for _, body in inline_scripts(text)})
            if hashes != self.csp_hashes[slug]:
                fail('/%s/%s: its inline scripts differ from /%s (the policy is shared)' % (lang, slug, slug))
            if re.search(r'\son[a-z]+\s*=\s*["\']|href="javascript:', text):
                fail('/%s/%s: an inline event handler or javascript: URL' % (lang, slug))
        return policies

    def headers_file(self):
        parts = [HEADERS_TOP.format(csp404=self.csp['404'][0], cspindex=self.csp['index'][0])]
        for slug in sorted(s for s in self.csp if s not in ('404', 'index')):
            for path in (page_path(slug), '/:lang' + page_path(slug)):
                parts.append('\n%s\n  ! Content-Security-Policy\n  Content-Security-Policy: %s\n' % (
                    path, self.csp[slug][0]))
        parts.append(HEADERS_BOTTOM)
        text = ''.join(parts)
        rules = len(re.findall(r'^\S', text, re.M)) - len(re.findall(r'^#', text, re.M))
        if rules > 100:
            fail('_headers has %d rules, Pages allows 100' % rules)
        self.header_rules = rules
        return text

    # ---------------------------------------------------------------- write
    def font_files(self, need):
        css = self.font_css_asset()
        text = css.data.decode('utf-8')
        faces = re.findall(r'@font-face\s*\{([^}]*)\}', text)
        woff2 = sorted({r for r in css.refs if r.endswith('.woff2')})
        if not faces or not woff2 or 'format(\'woff2\')' not in text or len(woff2) != len(css.refs):
            fail('the Google Fonts CSS in the snapshot is not woff2 (take a fresh snapshot: snapshot.py asks Google '
                 'Fonts with a browser User-Agent)')
        weights = set(re.findall(r'font-weight:\s*([0-9]+(?: [0-9]+)?)', text))
        self.font_report = {'css': css.dist_rel, 'faces': len(faces), 'files': woff2, 'weights': sorted(weights),
                            'subsets': re.findall(r'/\* ([a-z-]+) \*/', text)}
        if weights != {'300 900'}:
            fail('expected one variable weight range 300 900 in the font CSS, found %s' % sorted(weights))
        return os.path.dirname(woff2[0]) + '/OFL.txt'

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
        for (lang, slug), text in sorted(self.lang_out.items()):
            put('%s/%s.html' % (lang, slug), text.encode('utf-8'))
        for lang, (rel, js) in sorted(self.extra_files.items()):
            put(rel, js)
        by_rel = {a.dist_rel: a for a in self.assets.values() if a.src}
        for rel in sorted(need):
            put(rel, by_rel[rel].data)
        lic = self.font_files(need)
        with open(FONT_LICENSE, 'rb') as f:
            put(lic, f.read())
        self.font_license = lic
        p = os.path.join(self.snapshot, 'extra', 'robots.txt')
        if not os.path.isfile(p):
            fail('missing snapshot/extra/robots.txt')
        with open(p, 'rb') as f:
            put('robots.txt', f.read())
        put('sitemap.xml', self.sitemap().encode('utf-8'))
        put('_headers', self.headers_file().encode('utf-8'))
        put('_routes.json', (json.dumps(ROUTES, indent=2, sort_keys=True) + '\n').encode('utf-8'))
        self.verify(out, need)

    def sitemap(self):
        """The published sitemap's pages (same order, same lastmod), each in Serbian, English and Russian, every URL
        with its xhtml:link alternates (the same four links as in the pages' heads)."""
        p = os.path.join(self.snapshot, 'extra', 'sitemap.xml')
        if not os.path.isfile(p):
            fail('missing snapshot/extra/sitemap.xml')
        with open(p, encoding='utf-8') as f:
            src = f.read()
        entries = []
        for m in re.finditer(r'<url>(.*?)</url>', src, re.S):
            loc = re.search(r'<loc>\s*([^<\s]+)\s*</loc>', m.group(1)).group(1)
            lm = re.search(r'<lastmod>\s*([^<\s]+)\s*</lastmod>', m.group(1))
            slug = urllib.parse.urlsplit(loc).path.strip('/') or 'index'
            entries.append((slug, lm.group(1) if lm else None))
        lines = ['<?xml version="1.0" encoding="UTF-8"?>',
                 '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" '
                 'xmlns:xhtml="http://www.w3.org/1999/xhtml">']
        for slug, lastmod in entries:
            for lang in ('sr',) + LANGS:
                lines.append('    <url>')
                lines.append('        <loc>%s</loc>' % PR.page_url(SITE, lang, slug))
                if lastmod:
                    lines.append('        <lastmod>%s</lastmod>' % lastmod)
                for h, l in (('sr', 'sr'), ('en', 'en'), ('ru', 'ru'), ('x-default', 'sr')):
                    lines.append('        <xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (
                        h, PR.page_url(SITE, l, slug)))
                lines.append('    </url>')
        lines.append('</urlset>')
        self.sitemap_urls = len(entries) * (1 + len(LANGS))
        return '\n'.join(lines) + '\n'

    def verify(self, out, need):
        # sitemap and pages describe the same URLs
        with open(os.path.join(out, 'sitemap.xml'), encoding='utf-8') as f:
            locs = re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', f.read())
        built = sorted(PR.page_url(SITE, 'sr', s) for s in self.page_out if s != '404') + sorted(
            PR.page_url(SITE, l, s) for (l, s) in self.lang_out)
        if sorted(locs) != sorted(built):
            fail('sitemap URLs and built pages differ: %s' % sorted(set(locs) ^ set(built))[:10])
        if not all(u.startswith(SITE) for u in locs):
            fail('sitemap URL outside ' + SITE)
        # every page version names the same four alternates, each of them a built page that names it back
        files = {}
        for slug in self.page_out:
            if slug != '404':
                files[PR.page_url(SITE, 'sr', slug)] = self.page_out[slug]
        for (lang, slug), text in self.lang_out.items():
            files[PR.page_url(SITE, lang, slug)] = text
        self.hreflang_checked = 0
        for url, text in files.items():
            head = text[:text.find('</head>')]
            alts = dict((h, u) for h, u in re.findall(r'<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/>',
                                                      head))
            canon = re.findall(r'<link\b[^>]*\brel="canonical"[^>]*>', head)
            if len(canon) != 1 or 'href="%s"' % url not in canon[0]:
                fail('%s: canonical is not the page itself: %s' % (url, canon))
            if set(alts) != {'sr', 'en', 'ru', 'x-default'} or url not in alts.values():
                fail('%s: hreflang alternates %s' % (url, alts))
            for h, u in alts.items():
                if u not in files:
                    fail('%s: hreflang %s points to %s, which is not built' % (url, h, u))
                back = re.findall(r'<link rel="alternate" hreflang="[^"]+" href="([^"]+)"/>',
                                  files[u][:files[u].find('</head>')])
                if url not in back:
                    fail('%s: %s does not name it back' % (url, u))
                self.hreflang_checked += 1
        # internal links of the /en/ and /ru/ pages stay in their language and resolve (the language menu excepted)
        self.lang_links_checked = 0
        for (lang, slug), text in self.lang_out.items():
            if '<html lang="%s"' % lang not in text:
                fail('/%s/%s: no static lang' % (lang, slug))
            markup = re.sub(r'(<script\b[^>]*>).*?(</script>)', r'\1\2', text, flags=re.S)   # links scripts build
            for tag in re.findall(r'<a\b[^>]*>', markup):                                        # are the engine's
                href = re.search(r'\shref="([^"]*)"', tag)
                if not href or not href.group(1).startswith('/') or href.group(1).startswith('//'):
                    continue
                path = urllib.parse.urlsplit(href.group(1)).path
                f = page_file(path)
                if f is None:
                    continue
                if not os.path.isfile(os.path.join(out, f)):
                    fail('/%s/%s links to %s, which is not built' % (lang, slug, href.group(1)))
                if 'hreflang=' not in tag and not path.startswith('/%s/' % lang):
                    fail('/%s/%s links to %s, another language' % (lang, slug, href.group(1)))
                self.lang_links_checked += 1
        # every local reference resolves, every integrity attribute matches, nothing copyable is left absolute
        for slug, text in sorted(self.page_out.items()):
            for ref in re.findall(r'(?:%s)?/%s/[^\s"\'<>()\\,`#?]+' % (re.escape(SITE), ASSET_DIR), text):
                rel = ref[len(SITE) + 1:] if ref.startswith(SITE) else ref[1:]
                if rel.startswith(LOCAL_RUNTIME_BASE[1:]) and rel.endswith('/'):
                    continue                              # the runtime base itself
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
            if '<html lang="sr"' not in text:
                fail('/%s: no static lang' % slug)
        for (lang, slug), text in sorted(self.lang_out.items()):
            where = '%s/%s' % (lang, slug)
            for ref in re.findall(r'(?:%s)?/%s/[^\s"\'<>()\\,`#?]+' % (re.escape(SITE), ASSET_DIR), text):
                rel = ref[len(SITE) + 1:] if ref.startswith(SITE) else ref[1:]
                if rel.startswith(LOCAL_RUNTIME_BASE[1:]) and rel.endswith('/'):
                    continue
                if not os.path.isfile(os.path.join(out, rel)):
                    fail('/%s references %s, which is not in dist' % (where, ref))
            for m in self.tok.finditer(text):
                if self.lookup(m.group(0)):
                    fail('/%s still has an absolute URL of a copied file: %s' % (where, m.group(0)[:120]))
        for rel in sorted(need):
            data = open(os.path.join(out, rel), 'rb').read()
            if rel.endswith(('.css', '.js')):
                for m in self.tok.finditer(data.decode('utf-8', 'replace')):
                    if self.lookup(m.group(0)):
                        fail('%s still has an absolute URL of a copied file: %s' % (rel, m.group(0)[:120]))
        # runtime URL maps: '<assetId>/<name>' pieces the scripts append '-1.0.0.js' to
        self.runtime_missing = sorted(t for t in self.runtime_tokens
                                      if not os.path.isfile(os.path.join(out, LOCAL_RUNTIME_BASE[1:] + t +
                                                                         '-1.0.0.js')))
        # what is still written with a forbidden host in the built files (only code paths that never run here)
        self.forbidden_text = {}
        for root, _, files in os.walk(out):
            for fn in files:
                if not fn.endswith(('.html', '.css', '.js')):
                    continue
                p = os.path.join(root, fn)
                text = open(p, encoding='utf-8', errors='replace').read()
                for m in re.finditer(r'(?:https?:)?//([a-z0-9.-]+\.[a-z]{2,})', text):
                    if is_forbidden(m.group(1)):
                        self.forbidden_text.setdefault(os.path.relpath(p, out), set()).add(m.group(1))

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
        runtime_copied = sorted(r for r in need if by_rel[r].runtime)
        print('dist: %s — %d files, %.1f MB (%d pages + 404, %d assets %.1f MB, of them %d loaded at runtime)' % (
            os.path.relpath(out), files, total / 1e6, len(self.page_out) - 1, len(need), asset_bytes / 1e6,
            len(runtime_copied)))
        tot = {k: sum(c[k] for c in self.page_counts.values()) for k in next(iter(self.page_counts.values()))}
        print('references rewritten in pages: %(rewritten)d (absolute on %(site)s: %(absolute)d; written with %%2F: '
              '%(pct2F)d, with &amp;: %(amp)d, JSON-escaped: %(json_slash)d, protocol-relative: %(protocol_relative)d); '
              'SRI recomputed: %(sri_updated)d' % dict(tot, site=SITE))
        where = sorted({w for w, _ in self.runtime_bases})
        print('runtime CDN base rewritten to %s in %d places (%d inline scripts on %d pages, files: %s); '
              '%d <assetId>/<name> map entries, without a file in dist: %d%s' % (
                  LOCAL_RUNTIME_BASE, sum(n for _, n in self.runtime_bases),
                  len([w for w, _ in self.runtime_bases if '/' not in w]), len({w for w in where if '/' not in w}),
                  ', '.join(sorted(os.path.basename(w) for w in where if '/' in w)) or 'none',
                  len(self.runtime_tokens), len(self.runtime_missing),
                  (' (' + ', '.join(self.runtime_missing[:8]) + ')') if self.runtime_missing else ''))
        print('forms: webflow.js (%s) posts to /f/%s; %d forms with a honeypot: %s; Turnstile sitekeys removed: %d' % (
            self.form_url_patched, SITE_ID, len(self.forms),
            ', '.join('%s (%d)' % (n, sum(1 for _, x in self.forms if x == n)) for n in sorted(self.form_names)),
            self.turnstile_removed))
        fr = self.font_report
        print('fonts: %s — %d @font-face (%s), weights %s, %d woff2 files; licence %s' % (
            fr['css'], fr['faces'], ', '.join(fr['subsets']), ', '.join(fr['weights']), len(fr['files']),
            self.font_license))
        for fams, slugs in sorted(fams_seen.items()):
            print('   %d pages asked the WebFont loader for %s (now covered by the variable faces)' % (
                len(slugs), ', '.join(fams)))
        print('resource hints dropped: %s' % (', '.join('%s %d' % kv for kv in sorted(self.hints_dropped.items()))
                                              or 'none'))
        hs = [n for _, n in self.csp.values()]
        lens = [len(v) for v, _ in self.csp.values()]
        print('CSP: %d policies (%d header rules), %d-%d inline script hashes per page, %d-%d characters; '
              'map page extras: %s' % (len(self.csp), self.header_rules, min(hs), max(hs), min(lens), max(lens),
                                       self.csp_extras('mapa-punjaca')))
        if self.embed_dependencies:
            print('   files the BlokVolt embed loads itself (stay external, allowed on its page): %s' % ', '.join(
                self.embed_dependencies[:6]) + (' …' if len(self.embed_dependencies) > 6 else ''))
        self.report_languages()
        changed = sorted(a.dist_rel for a in by_rel.values() if a.changed and a.dist_rel in need)
        print('copied files changed by the build (%d): %s' % (len(changed), ', '.join(changed)))
        fill = sorted(a.dist_rel for a in by_rel.values() if a.from_fill and a.dist_rel in need)
        if fill:
            print('taken from snapshot-fill (sha256 = manifest) (%d): %s' % (len(fill), ', '.join(fill)))
        skipped = sorted(a.url for a in by_rel.values() if a.dist_rel not in need and not a.runtime)
        print('manifest files not copied (%d static, %d runtime, %d live):' % (len(skipped), len(self.runtime_unused),
                                                                            len(self.live)))
        for u in skipped:
            print('   unused after the build: ' + u)
        for a in self.runtime_unused[:12]:
            print('   runtime, not started by the built site: %s (by %s)' % (a.url[:110], ', '.join(
                i[:70] for i in a.initiators[:2]) or '?'))
        if len(self.runtime_unused) > 12:
            print('   … %d more runtime files not started by the built site' % (len(self.runtime_unused) - 12))
        hosts = {}
        for e in self.live.values():
            hosts[host_of(e['url'])] = hosts.get(host_of(e['url']), 0) + 1
        print('   live services, kept absolute: %s' % ', '.join('%s (%d files)' % kv for kv in sorted(hosts.items())))
        for u, why in self.missing:
            print('   MISSING: %s (%s)' % (u, why))
        if self.forbidden_text:
            print('forbidden hosts still written in built files (never requested by the pages; QA checks requests):')
            for f, hs in sorted(self.forbidden_text.items()):
                print('   %s: %s' % (f, ', '.join(sorted(hs))))
        # absolute URLs on asset hosts that are not files (bare hosts, unknown runtime URLs), in pages and copied files
        by_host = {}
        for (host, tok), where in self.unmapped.items():
            where = {w for w in where if w in self.page_out or w in need}
            if where:
                by_host.setdefault(host, []).append((tok, len(where)))
        for host in sorted(by_host):
            items = sorted(by_host[host])
            print('left as is on %s (%d distinct): %s' % (host, len(items), '; '.join(
                '%s [%d]' % (t, n) for t, n in items[:6]) + (' …' if len(items) > 6 else '')))

    def report_languages(self):
        n = len({s for _, s in self.lang_out})
        print('languages: /en/ and /ru/ for %d pages (%d files) — static <html lang>, title, meta, canonical, og:url, '
              'og:locale, JSON-LD in the page language; hreflang sr/en/ru/x-default on %d Serbian pages and all /en/, '
              '/ru/ pages (%d alternates checked both ways); sitemap.xml %d URLs with xhtml:link alternates' % (
                  n, len(self.lang_out), self.alternates_added, self.hreflang_checked, self.sitemap_urls))
        for lang in LANGS:
            reps = [r for (l, _), r in self.lang_report.items() if l == lang]
            hits = {}
            for r in reps:
                for k, v in r['hits'].items():
                    hits[k] = hits.get(k, 0) + v
            left = {}
            for (l, s), r in self.lang_report.items():
                if l == lang:
                    for kind, sr in r['left']:
                        left.setdefault(sr, set()).add(s)
            own = {k for r in reps for k in r['extra_used']}
            print('   %s: %d text nodes + %d attributes translated, %d internal links -> /%s/; lookups: live %d '
                  '(%s2 %d, month %d, %s %d), own %d (%d distinct of %d in site/i18n/%s.json, script %s); '
                  'static texts left as they are (not in keep.json): %d distinct%s' % (
                      lang, sum(r['text'] for r in reps), sum(r['attrs'] for r in reps), sum(r['links'] for r in reps),
                      lang, hits.get('d2', 0) + hits.get('month', 0) + hits.get('d1', 0), lang, hits.get('d2', 0),
                      hits.get('month', 0), lang, hits.get('d1', 0), hits.get('extra', 0), len(own),
                      len(self.extra[lang]), lang, self.extra_files[lang][0], len(left),
                      (': ' + '; '.join('%r (%d)' % (k[:50], len(v)) for k, v in sorted(left.items())[:12]) +
                       (' …' if len(left) > 12 else '')) if left else ''))
        for (lang, slug), r in sorted(self.lang_report.items()):
            if r.get('faq') and lang == LANGS[0]:
                exact = sum(1 for q, v, sq, sa in r['faq'] if sq == 1 and sa == 1)
                print('   FAQPage of /%s/%s, /%s/%s from the visible FAQ: %d questions (%d equal to the Serbian structured '
                      'data, the others matched by text: %s)' % (
                          LANGS[0], slug, LANGS[1], slug, len(r['faq']), exact, '; '.join(
                              '%r -> %r (%.2f/%.2f)' % (q[:40], v[:40], sq, sa) for q, v, sq, sa in r['faq']
                              if sq < 1 or sa < 1)))
        for lang in LANGS:
            shown = {}
            for (l, s), r in self.lang_report.items():
                if l == lang:
                    for x in r.get('banned_live') or []:
                        shown.setdefault(PR.nm(x), set()).add(s)
            if shown:
                print('   %s: words the copy rules ban, in live translations the prerendered pages show (static text; '
                      'the Serbian page has them too or the live dictionary added them): %s' % (lang, '; '.join(
                          '%r (%s)' % (k[:110], ', '.join(sorted(v))[:60]) for k, v in sorted(shown.items()))))
        print('   i18n engine patched on %d pages; scripts that read the path see the Serbian one: inline %s; files %s'
              % (self.engines_patched, ', '.join('%s %d' % kv for kv in sorted(self.inline_patches.items())),
                 ', '.join(sorted(self.file_patches))))
        if self.pathname_left:
            print('   location.pathname still read as is (real path) by: %s' % '; '.join(
                '%s [%d]' % (k, len(v)) for k, v in sorted(self.pathname_left.items())[:6]))

    def csp_extras(self, slug):
        if slug not in self.csp:
            return 'none'
        base = {d: set(s) for d, s in CSP_BASE}
        extra = []
        for part in self.csp[slug][0].split('; '):
            d, _, rest = part.partition(' ')
            add = [s for s in rest.split() if s not in base.get(d, set()) and not s.startswith("'sha256-")]
            if add:
                extra.append('%s %s' % (d, ' '.join(add)))
        return '; '.join(extra) or 'none'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--snapshot', default=os.path.join(HERE, 'snapshot'))
    ap.add_argument('--fill', default=os.path.join(HERE, 'snapshot-fill'))
    ap.add_argument('--out', default=os.path.join(HERE, 'dist'))
    ap.add_argument('--allow-missing', action='store_true',
                    help='development only: build even if a title/meta/JSON-LD text has no EN/RU translation')
    args = ap.parse_args()
    Build(args.snapshot, args.fill, args.out, args.allow_missing).run()


if __name__ == '__main__':
    main()

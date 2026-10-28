#!/usr/bin/env python3
"""Local QA of the static build site/dist (moving www.evolako.rs off Webflow). Nothing leaves this machine.

Serves site/dist on 127.0.0.1 the way Cloudflare Pages does — /slug -> slug.html, /en/ -> en/index.html,
/en/slug -> en/slug.html, /slug.html, /slug/, /en and /en/index.html -> 308 to the clean URL, an unknown path ->
404.html with status 404, the rules of dist/_headers applied in file order the way Pages applies them ("! Name"
removes, a later rule sets again, :placeholders match one path segment), so the browser enforces each page's
Content-Security-Policy, and the redirects of site/functions/_middleware.js (old ?lang=en|ru links -> 301 to /en/ or
/ru/; the Python rule is checked against the JavaScript at start) — and opens every page + the 404 in Chromium
(Playwright) in four versions: the Serbian page, the Serbian page in Cyrillic (?lang=sr-cyrl), the /en/ page and the
/ru/ page, at 1440x900 and 390x844:

  * HTTP status, console errors, uncaught exceptions, failed requests to the local server, <html lang>
  * CSP violations: securitypolicyviolation events, "Refused to ..." console/log entries, requests blocked by CSP
  * every request that leaves the site, with the script/document that started it (CDP initiator):
      - forbidden hosts (Webflow, its CDNs, Google Fonts/ajax, jsDelivr) must not be requested by the built site; the
        only exception is the BlokVolt map embed on /mapa-punjaca, a live service that loads its map library from
        jsDelivr itself ("embed", listed separately)
      - live services (app.evolako.rs, the exchange-rate file of evo-fx, the BlokVolt embed with its data and tiles)
        are answered with the copy the runtime capture saved, so every page runs complete offline
      - anything else is blocked and listed (e.g. Cloudflare Web Analytics, which the site loads on purpose)
  * visible text and pixels against the "reference": the original Webflow page from site/snapshot rendered the same
    way (same width; Serbian, ?lang=sr-cyrl, ?lang=en or ?lang=ru), every file it asks for answered from the snapshot
    (static + runtime + live). Text differences are compared word by word and classified: a translation the site adds
    (site/i18n/<lang>.json), a text whose live value depends on load timing (site/i18n/harvest.json "timing"), the
    legal-data placeholder hidden on the /en/ page and in Cyrillic as on the Serbian page — each only where it turns the original's
    words into exactly the built ones — or unexplained
  * links: every root-relative href/src in the rendered page and every absolute link to www.evolako.rs (canonical,
    hreflang alternates) resolves in dist
  * /en/ and /ru/ pages: Serbian left — visible and hidden text nodes, alt/title/aria-label/placeholder, button values,
    the title, meta description and social texts, JSON-LD strings — a text counts as Serbian when it is a Serbian
    source text of the dictionaries or the pages, or looks Serbian (diacritics, Serbian function words), unless
    site/i18n/keep.json lists it (brand, unit, address, legal name …, each with a reason); texts the BlokVolt map
    embed (#evm on /mapa-punjaca, a live service) renders from its own data are listed apart
  * links to the app (app.evolako.rs) carry the page's language (?lang=sr|en|ru)
  * JSON-LD: every block parses; FAQPage questions and answers equal the visible ones (<details>) in sr, en, ru (the
    Cyrillic mode keeps the Latin JSON-LD of the Serbian page)
  * fonts: width of a test string in Onest 300/350/400/500/550/600/800 (a variable font gives 7 different widths),
    weight and width of the wordmark "evo" (Onest 350)
  * forms: what the DOM holds after the page scripts ran (fields incl. hidden ones, honeypot, Turnstile left?)
Then interaction checks (shard 1 only; --no-interactions skips them), with the same CSP/request checks: language
switching through the header (1440) and footer (390) menus from each language to the others on five pages, the old
?lang= links, a remembered choice (localStorage bvl) on Serbian and /en/ pages, back/forward and reload, Cyrillic as a
mode of the Serbian page; "Dozvoli" in the cookie banner (GA4 and the Meta pixel answered by empty stubs: the CSP
must let them load, nothing is sent), the A4 notice with its QR code on /prijavi-zgradu (counter stubbed), the
address search of the map (photon.komoot.io stubbed). The forms themselves are sent by forms_e2e.py.

Screenshots go to --shots, which must be outside the repository (never committed). With --keep-shots changed (the
default) a pair of screenshots is kept only when the pixel difference is above 0.5 %.
Exit code: 1 = a load has an issue (see "issues"), 0 = clean.

Usage: python3 site/tools/qa_dist.py --shots /tmp/evo-shots [--pages index,kontakt] [--modes sr,sr-cyrl,en,ru]
                                     [--widths 1440,390] [--no-reference] [--shard 1/2] [--json report.json]
       python3 site/tools/qa_dist.py --merge part1.json part2.json [--json all.json]
"""
import argparse
import html.parser
import http.server
import json
import mimetypes
import os
import re
import subprocess
import sys
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(SITE_DIR)
sys.path.insert(0, SITE_DIR)
import prerender as PR  # noqa: E402  (key_of, the engine's hash; page URLs)

SITE = 'https://www.evolako.rs'
VIEWPORTS = {1440: (1440, 900), 390: (390, 844)}
# sr = the Serbian page, sr-cyrl = the Serbian page in Cyrillic (?lang=sr-cyrl), en / ru = the /en/ and /ru/ pages
MODES = ['sr', 'sr-cyrl', 'en', 'ru']
HTML_LANG = {'sr': 'sr', 'en': 'en', 'ru': 'ru', 'sr-cyrl': 'sr-Cyrl'}
FORBIDDEN_HOSTS = {'cdn.prod.website-files.com', 'd3e54v103j8qbb.cloudfront.net', 'd8j0ntlcm91z4.cloudfront.net',
                   'fonts.googleapis.com', 'fonts.gstatic.com', 'ajax.googleapis.com', 'cdn.jsdelivr.net',
                   'webflow.com', 'assets-global.website-files.com', 'uploads-ssl.webflow.com',
                   'app-assets.website-files.com'}
LIVE_HOSTS = {'app.evolako.rs', 'smcsmkkzdksocvroqekl.supabase.co', 'www.blokvolt.rs', 'tiles.openfreemap.org'}
EMBED_HOSTS = {'www.blokvolt.rs'}       # embeds whose own requests are theirs, not the site's
KNOWN_HOSTS = {
    'static.cloudflareinsights.com': 'Cloudflare Web Analytics beacon (the consent loader adds it on every page; '
                                     'own analytics, blocked during QA)',
    'cloudflareinsights.com': 'Cloudflare Web Analytics data (blocked during QA)',
    'challenges.cloudflare.com': 'Turnstile — must not appear any more',
}
# The reference (original page) asks Turnstile for a token before its submit buttons work; a stub answers at once,
# as the real widget does for most visitors, so both renders show the forms ready (the build has no Turnstile)
TURNSTILE_API = 'challenges.cloudflare.com/turnstile/v0/api.js'
TURNSTILE_STUB = (b"window.turnstile={render:function(el,o){setTimeout(function(){o&&o.callback&&o.callback('qa-stub')},"
                  b"5);return 'qa'},reset:function(){},remove:function(){},getResponse:function(){return 'qa-stub'}};")
TEXT_MIN, TEXT_MAX = 0.5, 1.5           # dist innerText vs snapshot static text: outside = broken render
REF_TOLERANCE = 0.02                    # dist innerText vs reference innerText
PIXEL_KEEP = 0.5                        # keep a screenshot pair above this changed %
TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript',
         '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
         '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
         '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf'}


def is_forbidden(host):
    return any(host == h or host.endswith('.' + h) for h in FORBIDDEN_HOSTS)


# ------------------------------------------------------------------------------------------------ _headers (Pages)
class HeaderRules:
    """dist/_headers as Cloudflare Pages applies it: every matching rule in file order; '! Name' deletes the header,
    a name set again by a later rule is appended (the deleted one is gone, so the new value stands alone)."""

    def __init__(self, path):
        self.rules = []
        if not os.path.isfile(path):
            return
        cur = None
        for line in open(path, encoding='utf-8'):
            line = line.rstrip('\n')
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            if not line[0].isspace():
                cur = {'pattern': line.strip(), 'set': [], 'unset': []}
                self.rules.append(cur)
                continue
            s = line.strip()
            if s.startswith('!'):
                cur['unset'].append(s[1:].strip().lower())
            else:
                name, _, value = s.partition(':')
                cur['set'].append((name.strip(), value.strip()))
        for r in self.rules:
            r['cross_host'] = r['pattern'].startswith('https://')
            pat = '(?P<splat>.*)'.join(re.escape(x) for x in r['pattern'].split('*'))
            pat = re.sub(r'(?<=^https://)(.*?):([A-Za-z]\w*)', lambda m: m.group(1) + '(?P<%s>[^/.]+)' % m.group(2),
                         pat) if r['cross_host'] else pat
            pat = re.sub(r'\\?:([A-Za-z]\w*)', lambda m: '(?P<%s>[^/]+)' % m.group(1), pat)
            r['re'] = re.compile('^' + pat + '$')

    def apply(self, host, path, headers):
        """headers: list of [name, value]; returns the new list."""
        out = list(headers)
        set_by_rules = set()
        for r in self.rules:
            test = 'https://%s%s' % (host, path) if r['cross_host'] else path
            if not r['re'].match(test):
                continue
            for name in r['unset']:
                out = [h for h in out if h[0].lower() != name]
            for name, value in r['set']:
                if name.lower() in set_by_rules:
                    out.append([name, value])
                else:
                    out = [h for h in out if h[0].lower() != name.lower()] + [[name, value]]
                    set_by_rules.add(name.lower())
        return out


# ------------------------------------------------------------------------------------------------ middleware
_LANG_PARAM = re.compile(r'^(sr-cyrl|sr-latn|cyr|cy|sr|en|ru)$', re.I)
_PAGE_PATH = re.compile(r'^/(?:(en|ru)(?:/([a-z0-9-]*))?|([a-z0-9-]*))$')


def lang_redirect(path, query):
    """langRedirect() of site/functions/_middleware.js: where a page request with ?lang= goes (or None)."""
    params = urllib.parse.parse_qsl(query, keep_blank_values=True)
    lang = next((v.lower() for k, v in params if k == 'lang' and _LANG_PARAM.match(v)), None)
    if not lang:
        return None
    m = _PAGE_PATH.match(path)
    if not m or (m.group(1) and m.group(2) is None):
        return None
    page_lang = m.group(1) or 'sr'
    slug = (m.group(2) or '') if m.group(1) else m.group(3)
    fam = lang if lang in ('en', 'ru') else 'sr'
    if fam == page_lang == 'sr':
        return None

    def qs(ps):
        s = urllib.parse.urlencode(ps)
        return '?' + s if s else ''
    if fam == 'sr':
        return '/' + slug + qs(params)
    return '/' + fam + '/' + slug + qs([(k, v) for k, v in params if k != 'lang'])


REDIRECT_CASES = ['/kontakt?lang=en', '/?lang=ru', '/kontakt?paket=wallbox&lang=en', '/preporuka?ref=EVO-7K2QX&lang=ru',
                  '/kontakt?lang=en&lang=ru', '/kontakt?lang=sr-cyrl', '/kontakt?lang=SR-CYRL&paket=start',
                  '/kontakt?lang=sr', '/kontakt?lang=de', '/kontakt', '/en/kontakt', '/en/kontakt?lang=en',
                  '/en/kontakt?lang=ru&utm_source=x', '/ru/?lang=en', '/en/kontakt?lang=sr-cyrl&paket=wallbox',
                  '/ru/?lang=sr', '/en?lang=ru', '/_a/x.js?lang=en', '/f/6ab19bf9a3bb86f8fb7bba00?lang=en',
                  '/robots.txt?lang=en', '/kontakt/?lang=en', '/punjaci-za-hotele?utm_source=fb&lang=EN&utm_medium=cpc']


def check_redirect_port():
    """The Python rule above must give what the middleware gives (node runs the real module)."""
    js = ("import('%s').then(m => { const out = {}; for (const p of %s) out[p] = m.langRedirect('https://www.evolako.rs'"
          " + p); console.log(JSON.stringify(out)); });" % (
              'file://' + os.path.join(SITE_DIR, 'functions', '_middleware.js'), json.dumps(REDIRECT_CASES)))
    try:
        res = subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, timeout=60)
        got = json.loads(res.stdout)
    except Exception as e:  # noqa: BLE001
        sys.exit('could not run the middleware in node: %s' % e)
    bad = {p: (got.get(p), lang_redirect(*(p.split('?', 1) + [''])[:2])) for p in REDIRECT_CASES
           if got.get(p) != lang_redirect(*(p.split('?', 1) + [''])[:2])}
    if bad:
        sys.exit('the QA server and site/functions/_middleware.js redirect differently: %s' % bad)
    return len(REDIRECT_CASES)


# ------------------------------------------------------------------------------------------------ local servers
def make_handler(root, pages_mode):
    """pages_mode=True: Cloudflare Pages rules on dist. False: the snapshot pages at the same URLs (reference)."""
    root = os.path.realpath(root)
    rules = HeaderRules(os.path.join(root, '_headers')) if pages_mode else None

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_HEAD(self):
            self.serve(False)

        def do_GET(self):
            self.serve(True)

        def do_POST(self):
            self.send(404, b'{"code":404}', 'application/json')     # forms are tested by forms_e2e.py

        def send(self, code, data, ctype, extra=None, body=True, path='/'):
            hs = [['Content-Type', ctype], ['Content-Length', str(len(data))], ['Cache-Control', 'no-store']]
            for k, v in (extra or {}).items():
                hs.append([k, v])
            if rules is not None:
                hs = rules.apply('127.0.0.1', path, hs)
            self.send_response(code)
            for k, v in hs:
                self.send_header(k, v)
            self.end_headers()
            if body:
                try:
                    self.wfile.write(data)
                except (BrokenPipeError, ConnectionResetError):
                    pass                 # the browser left the page mid-response (a redirect, a language switch)

        def file(self, rel):
            p = os.path.realpath(os.path.join(root, rel.lstrip('/')))
            if not p.startswith(root + os.sep) or not os.path.isfile(p) or os.path.basename(p) in ('_headers',
                                                                                                 '_routes.json'):
                return None
            with open(p, 'rb') as f:
                return f.read(), TYPES.get(os.path.splitext(p)[1].lower()) or (
                    mimetypes.guess_type(p)[0] or 'application/octet-stream')

        def serve(self, body):
            u = urllib.parse.urlsplit(self.path)
            path, q = urllib.parse.unquote(u.path), ('?' + u.query if u.query else '')
            if pages_mode:
                to = lang_redirect(path, u.query)                   # site/functions/_middleware.js
                if to is not None and not self.headers.get('X-QA-No-Middleware'):
                    return self.send(301, b'', 'text/plain', {'Location': to}, body, path)
                if path.endswith('/index.html') and self.file(path):
                    return self.send(308, b'', 'text/plain', {'Location': path[:-len('index.html')] + q}, body, path)
                if path != '/' and path.endswith('/') and not self.file(path + 'index.html') and \
                        self.file(path.rstrip('/') + '.html'):
                    return self.send(308, b'', 'text/plain', {'Location': path.rstrip('/') + q}, body, path)
                if path.endswith('.html') and self.file(path):
                    return self.send(308, b'', 'text/plain', {'Location': path[:-5] + q}, body, path)
                if not path.endswith('/') and not self.file(path) and not self.file(path + '.html') and \
                        self.file(path + '/index.html'):
                    return self.send(308, b'', 'text/plain', {'Location': path + '/' + q}, body, path)
                if path.endswith('/'):
                    hit = self.file(path + 'index.html')
                else:
                    hit = self.file(path) or self.file(path + '.html')
                miss = self.file('404.html')
            else:
                slug = path.strip('/') or 'index'
                hit = self.file('pages/%s.html' % slug) if re.fullmatch(r'[a-z0-9-]+', slug) else None
                miss = self.file('pages/404.html')
            if hit:
                return self.send(200, hit[0], hit[1], body=body, path=path)
            return self.send(404, miss[0] if miss else b'not found', 'text/html; charset=utf-8', body=body, path=path)
    return H


def start_server(root, pages_mode):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), make_handler(root, pages_mode))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, srv.server_address[1]


# ------------------------------------------------------------------------------------------------ helpers
class TextOf(html.parser.HTMLParser):
    """Static text of <body> (no script/style/noscript/template), whitespace-normalized."""
    SKIP = {'script', 'style', 'noscript', 'template'}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.skip, self.body = [], 0, False

    def handle_starttag(self, tag, attrs):
        if tag == 'body':
            self.body = True
        elif tag in self.SKIP:
            self.skip += 1

    def handle_endtag(self, tag):
        if tag in self.SKIP and self.skip:
            self.skip -= 1

    def handle_data(self, d):
        if self.body and not self.skip:
            self.parts.append(d)

    def text(self):
        return re.sub(r'\s+', ' ', ' '.join(self.parts)).strip()


def static_text_len(path):
    p = TextOf()
    with open(path, encoding='utf-8') as f:
        p.feed(f.read())
    return len(p.text())


def url_key(u):
    p = urllib.parse.urlsplit(u)
    return p.netloc.lower() + urllib.parse.unquote(p.path) + ('?' + p.query if p.query else '')


def load_snapshot(snapshot):
    """Original URL key -> (bytes, content type) for every file of the snapshot (static, runtime, live) plus
    snapshot-fill; and the URL keys the built site leaves to live services and their embeds."""
    with open(os.path.join(snapshot, 'manifest.json'), encoding='utf-8') as f:
        m = json.load(f)
    fill = os.path.join(os.path.dirname(snapshot), 'snapshot-fill')
    out = {}
    for a in m['assets']:
        if not a.get('file'):
            continue
        for base in (snapshot, fill):
            p = os.path.join(base, a['file'])
            if os.path.isfile(p):
                with open(p, 'rb') as f:
                    out[url_key(a['url'])] = (f.read(), a.get('type') or 'application/octet-stream')
                break
    live = {url_key(a['url']) for a in m['assets'] if a.get('file') and (
        a.get('live') or urllib.parse.urlsplit(a['url']).hostname in LIVE_HOSTS)}
    # runtime files a live service started (e.g. the map library the BlokVolt embed takes from jsDelivr)
    embed, grew = set(), True
    while grew:
        grew = False
        for a in m['assets']:
            k = url_key(a['url'])
            if not a.get('runtime') or k in live or k in embed or not a.get('file'):
                continue
            if any(url_key(i) in live or url_key(i) in embed or urllib.parse.urlsplit(i).hostname in EMBED_HOSTS
                   for i in a.get('initiators') or []):
                embed.add(k)
                grew = True
    return out, live, embed, m


SCROLL_JS = """async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const H = () => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight);
  let y = 0;
  for (let i = 0; i < 80 && y < H(); i++) { y += Math.round(innerHeight * 0.8); window.scrollTo(0, y); await wait(110); }
  window.scrollTo(0, 0); await wait(500);
  try { await document.fonts.ready; } catch (e) {}
}"""

INIT_JS = """(() => {
  window.__cspv = [];
  document.addEventListener('securitypolicyviolation', e => window.__cspv.push({
    directive: e.effectiveDirective || e.violatedDirective, blocked: e.blockedURI,
    sample: (e.sample || '').slice(0, 80), source: e.sourceFile, line: e.lineNumber}));
})();"""

FORMS_JS = """() => Array.from(document.forms).map(f => ({
  dataName: f.getAttribute('data-name'), id: f.id || null, name: f.getAttribute('name'),
  action: f.getAttribute('action'), method: f.getAttribute('method'),
  turnstileSitekey: f.getAttribute('data-turnstile-sitekey'),
  turnstileWidget: !!f.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [id^="cf-chl-widget"]'),
  fields: Array.from(f.elements).filter(e => e.name).map(e => ({name: e.name, type: (e.type || e.tagName).toLowerCase(),
    hidden: e.type === 'hidden', required: !!e.required, value: e.type === 'hidden' ? e.value : undefined})),
  submits: Array.from(f.querySelectorAll('input[type=submit],button[type=submit],button:not([type])'))
    .map(b => ({text: (b.value || b.textContent || '').trim().slice(0, 40), disabled: b.disabled}))
}))"""

LINKS_JS = """() => {
  const out = new Set();
  document.querySelectorAll('[href],[src],[srcset]').forEach(e => {
    ['href', 'src'].forEach(a => { const v = e.getAttribute(a); if (v) out.add(v); });
    const s = e.getAttribute('srcset'); if (s) s.split(',').forEach(p => { const u = p.trim().split(/\\s+/)[0]; if (u) out.add(u); });
  });
  return Array.from(out);
}"""

FONT_JS = """async () => {
  const sample = 'evolako Punjač ŠĐČĆŽ šđčćž Пуњач ђћџљњј 0123';
  const W = [300, 350, 400, 500, 550, 600, 800];
  try { await Promise.all(W.map(w => document.fonts.load(w + ' 40px Onest', sample))); } catch (e) {}
  const c = document.createElement('canvas').getContext('2d'), widths = {};
  for (const w of W) { c.font = w + ' 40px Onest'; widths[w] = Math.round(c.measureText(sample).width * 100) / 100; }
  const evo = document.querySelector('.mega-nav__logo-evo, .v3-logo span:first-child, .v3-word span:first-child');
  let mark = null;
  if (evo) { const r = evo.getBoundingClientRect(), cs = getComputedStyle(evo);
    mark = {weight: cs.fontWeight, family: cs.fontFamily.slice(0, 40), width: Math.round(r.width * 100) / 100,
            x: Math.round(r.x), y: Math.round(r.y), h: Math.round(r.height)}; }
  const faces = [...document.fonts].filter(f => f.family.replace(/"/g, '') === 'Onest' && f.status === 'loaded')
    .map(f => f.weight + ' ' + f.unicodeRange.slice(0, 18));
  return {widths, distinct: new Set(Object.values(widths)).size, wordmark: mark, onest_faces_loaded: faces};
}"""


# every text a visitor of the page can see or a crawler reads: text nodes (visible or not: hidden menus, closed FAQ
# answers), alt/title/aria-label/placeholder, button values, the title, meta texts, JSON-LD strings (with their key)
STRINGS_JS = """() => {
  const out = [], norm = s => (s || '').replace(/\\s+/g, ' ').trim(), SKIP = {SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEMPLATE: 1};
  // 4th field: inside the BlokVolt map embed (#evm on /mapa-punjaca, a live service of www.blokvolt.rs)
  const emb = e => !!(e && e.closest && e.closest('#evm'));
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT,
    {acceptNode: n => (!n.parentNode || SKIP[n.parentNode.nodeName]) ? 2 : 1});
  let n;
  while ((n = w.nextNode())) {
    const t = norm(n.nodeValue); if (t.length < 2) continue;
    let vis = false; try { vis = n.parentElement.checkVisibility({checkVisibilityCSS: true}); } catch (e) {}
    out.push(['text', t, vis, emb(n.parentElement)]);
  }
  document.body.querySelectorAll('[alt],[title],[aria-label],[placeholder]').forEach(e => {
    ['alt', 'title', 'aria-label', 'placeholder'].forEach(a => { const v = norm(e.getAttribute(a)); if (v.length > 1) out.push(['attr:' + a, v, true, emb(e)]); }); });
  document.body.querySelectorAll('input[type=submit],input[type=button],input[type=reset]').forEach(e => {
    if (norm(e.value).length > 1) out.push(['value', norm(e.value), true]);
    if (norm(e.getAttribute('data-wait')).length > 1) out.push(['data-wait', norm(e.getAttribute('data-wait')), true]); });
  out.push(['title', norm(document.title), true]);
  document.querySelectorAll('meta[name=description],meta[property="og:title"],meta[property="og:description"],' +
    'meta[name="twitter:title"],meta[name="twitter:description"],meta[property="og:image:alt"],meta[property="og:site_name"]')
    .forEach(m => out.push(['meta:' + (m.getAttribute('name') || m.getAttribute('property')), norm(m.getAttribute('content')), true]));
  document.querySelectorAll('script[type="application/ld+json"]').forEach(s => {
    try { (function walk(x, k) { if (Array.isArray(x)) x.forEach(v => walk(v, k));
      else if (x && typeof x === 'object') Object.keys(x).forEach(kk => walk(x[kk], kk));
      else if (typeof x === 'string') out.push(['json-ld:' + k, norm(x), true]); })(JSON.parse(s.textContent), null);
    } catch (e) { out.push(['json-ld-error', String(e), true]); } });
  return out;
}"""

# JSON-LD blocks (raw) and the visible FAQ (<details><summary>question</summary>answer</details>)
SEO_JS = """() => {
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
  const faq = Array.from(document.querySelectorAll('details')).map(d => { const s = d.querySelector('summary');
    const c = d.cloneNode(true); const cs = c.querySelector('summary'); if (cs) cs.remove();
    return [norm(s ? s.textContent : ''), norm(c.textContent)]; });
  return {jsonld: Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(s => s.textContent),
          faq, canonical: (document.querySelector('link[rel=canonical]') || {}).href || null,
          alternates: Array.from(document.querySelectorAll('link[rel=alternate][hreflang]')).map(l => [l.hreflang, l.href]),
          ogLocale: (document.querySelector('meta[property="og:locale"]') || {content: null}).content,
          ogUrl: (document.querySelector('meta[property="og:url"]') || {content: null}).content,
          url: location.pathname + location.search, bvl: (() => { try { return localStorage.getItem('bvl'); } catch (e) { return null; } })(),
          app: Array.from(document.querySelectorAll('a[href^="https://app.evolako.rs"]')).map(a => a.getAttribute('href'))};
}"""


def resolves(dist, ref):
    """Does a root-relative URL (or an absolute one on www.evolako.rs) resolve on the built site?"""
    if ref.startswith((SITE, 'https://evolako.rs')):
        ref = urllib.parse.urlsplit(ref).path or '/'
    path = urllib.parse.unquote(urllib.parse.urlsplit(ref).path)
    if path in ('', '/'):
        return True
    p = os.path.join(dist, path.lstrip('/'))
    return os.path.isfile(p) or os.path.isfile(p.rstrip('/') + '.html') or (path.endswith('/') and
                                                                              os.path.isfile(p + 'index.html'))


def pixel_diff(a_path, b_path):
    try:
        from PIL import Image, ImageChops
    except ImportError:
        return None
    if not (os.path.isfile(a_path) and os.path.isfile(b_path)):     # a screenshot failed (reported as a page error)
        return None
    a, b = Image.open(a_path).convert('RGB'), Image.open(b_path).convert('RGB')
    w, h = min(a.width, b.width), min(a.height, b.height)
    if not w or not h:
        return None
    diff = ImageChops.difference(a.crop((0, 0, w, h)), b.crop((0, 0, w, h))).convert('L')
    changed = diff.point(lambda v: 255 if v > 40 else 0)
    n = changed.histogram()[255]
    box = changed.getbbox()
    return {'changed_pct': round(100.0 * n / (w * h), 3), 'changed_px': n, 'bbox': list(box) if box else None,
            'height_dist': a.height, 'height_ref': b.height}


def initiators_of(init):
    out = []
    if not init:
        return out
    if init.get('url'):
        out.append(init['url'])
    st = init.get('stack')
    while st:
        for fr in st.get('callFrames') or []:
            if fr.get('url'):
                out.append(fr['url'])
                break
        st = st.get('parent')
    return out


# ------------------------------------------------------------------------------------------------ one page load
def load(browser, url, viewport, shot, local_port, answers, answer_all, scroll=True, probe_fonts=False, stubs=None,
         actions=None, collect_strings=False, storage=None, referer=None, no_middleware=False):
    """answers: URL key -> (bytes, type). answer_all=False (dist): only live services and their embeds are answered
    (the keys given), everything else external is blocked. True (reference): every snapshot file is answered."""
    w, h = viewport
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=w < 800,
                              has_touch=w < 800, locale='sr-RS', service_workers='block',
                              extra_http_headers={'X-QA-No-Middleware': '1'} if no_middleware else None)
    rec = {'external': [], 'local_failed': [], 'console': [], 'page_errors': [], 'csp': [], 'answered': 0}
    initiators = {}

    def route(r):
        req = r.request
        u = urllib.parse.urlsplit(req.url)
        if u.scheme in ('data', 'blob') or (u.hostname == '127.0.0.1' and u.port == local_port):
            return r.continue_()
        host = (u.hostname or '').lower()
        hit = answers.get(url_key(req.url))
        if answer_all and TURNSTILE_API in req.url:
            hit = (TURNSTILE_STUB, 'application/javascript')
        for part, answer in (stubs or {}).items():
            if part in req.url:
                hit = answer
        rec['external'].append({'host': host, 'url': req.url, 'type': req.resource_type, 'method': req.method,
                                'answered': bool(hit), 'initiators': sorted(initiators.get(req.url, ()))[:4]})
        if hit and req.method in ('GET', 'POST'):
            rec['answered'] += 1
            return r.fulfill(status=200, body=hit[0], headers={'content-type': hit[1],
                                                               'access-control-allow-origin': '*'})
        return r.abort('blockedbyclient')

    ctx.route('**/*', route)
    ctx.add_init_script(INIT_JS)
    if storage:                                   # a remembered language (localStorage bvl) before the first load
        ctx.add_init_script('(() => { try { if (!sessionStorage.getItem("__qa_seeded")) { sessionStorage.setItem('
                            '"__qa_seeded", "1"); %s } } catch (e) {} })();' % ''.join(
                                'localStorage.setItem(%s, %s);' % (json.dumps(k), json.dumps(v))
                                for k, v in storage.items()))
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    cdp.send('Network.enable')
    cdp.send('Log.enable')

    def will_send(p):
        u = p.get('request', {}).get('url', '')
        if u:
            initiators.setdefault(u, set()).update(i for i in initiators_of(p.get('initiator'))
                                                   if not i.startswith('blob:'))

    def failed(p):
        if p.get('blockedReason') == 'csp' or 'BLOCKED_BY_CSP' in (p.get('errorText') or ''):
            rec['csp'].append({'kind': 'request blocked by CSP', 'id': p.get('requestId')})

    def log_entry(p):
        e = p.get('entry') or {}
        t = e.get('text') or ''
        if 'Content Security Policy' in t or 'Refused to' in t:
            rec['csp'].append({'kind': 'log', 'text': t[:300], 'url': e.get('url', '')})
    cdp.on('Network.requestWillBeSent', will_send)
    cdp.on('Network.loadingFailed', failed)
    cdp.on('Log.entryAdded', log_entry)
    page.on('console', lambda m: rec['console'].append({'type': m.type, 'text': m.text[:300],
                                                        'url': (m.location or {}).get('url', '')})
            if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: rec['page_errors'].append(str(e)[:300]))

    def on_resp(resp):
        u = urllib.parse.urlsplit(resp.url)
        if u.hostname == '127.0.0.1' and resp.status >= 400 and resp.url.split('?')[0].rstrip('/') != \
                url.split('?')[0].rstrip('/'):
            rec['local_failed'].append({'url': resp.url, 'status': resp.status})
    page.on('response', on_resp)
    page.on('requestfailed', lambda req: rec['local_failed'].append({'url': req.url, 'status': req.failure})
            if urllib.parse.urlsplit(req.url).hostname == '127.0.0.1' else None)
    t0 = time.time()
    try:
        resp = page.goto(url, wait_until='load', timeout=60000, referer=referer)
        rec['status'] = resp.status if resp else None
        rec['csp_header'] = (resp.headers.get('content-security-policy') if resp else None)
        try:
            page.wait_for_load_state('networkidle', timeout=8000)
        except Exception:  # noqa: BLE001 — a page that keeps polling is still measured
            pass
        if scroll:
            page.evaluate(SCROLL_JS)
        page.wait_for_timeout(300)
        if actions:
            rec['checks'] = actions(page) or []
        rec['text'] = page.evaluate("() => (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ').trim()")
        rec['text_len'] = len(rec['text'])
        rec['title'] = page.title()
        rec['html_lang'] = page.evaluate('() => document.documentElement.lang')
        rec['forms'] = page.evaluate(FORMS_JS)
        rec['links'] = page.evaluate(LINKS_JS)
        rec['seo'] = page.evaluate(SEO_JS)
        if collect_strings:
            rec['strings'] = page.evaluate(STRINGS_JS)
        if probe_fonts:
            rec['fonts'] = page.evaluate(FONT_JS)
        for v in page.evaluate('() => window.__cspv || []'):
            rec['csp'].append(dict(v, kind='event'))
        if shot:
            page.screenshot(path=shot, full_page=True, animations='disabled', timeout=90000)
    except Exception as e:  # noqa: BLE001
        rec['page_errors'].append('QA load failed: %s' % str(e)[:300])
    rec['seconds'] = round(time.time() - t0, 1)
    ctx.close()
    # console errors that only report a request this QA blocked are environment noise, not page errors; neither is
    # the 404 status of the 404 page itself
    blocked = {x['url'] for x in rec['external'] if not x['answered']}
    for c in rec['console']:
        c['blocked_request'] = c['url'] in blocked or 'ERR_BLOCKED_BY_CLIENT' in c['text'] or (
            rec.get('status') == 404 and c['url'].split('?')[0] == url.split('?')[0] and 'status of 404' in c['text'])
    return rec


def classify_external(rec, live, embed):
    """live / embed / forbidden / other for every external request of a dist load."""
    embed_urls = set()
    for x in rec['external']:
        if url_key(x['url']) in embed or any(urllib.parse.urlsplit(i).hostname in EMBED_HOSTS
                                             or url_key(i) in embed for i in x['initiators']):
            embed_urls.add(x['url'])
    for x in rec['external']:
        if x['host'] in LIVE_HOSTS or url_key(x['url']) in live:
            x['class'] = 'live'
        elif x['url'] in embed_urls:
            x['class'] = 'embed'
        elif is_forbidden(x['host']):
            x['class'] = 'forbidden'
        else:
            x['class'] = 'other'


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dist', default=os.path.join(SITE_DIR, 'dist'))
    ap.add_argument('--snapshot', default=os.path.join(SITE_DIR, 'snapshot'))
    ap.add_argument('--shots', help='screenshot folder, outside the repository')
    ap.add_argument('--pages', default='', help='comma-separated slugs (default: all + 404)')
    ap.add_argument('--modes', default=','.join(MODES))
    ap.add_argument('--widths', default='1440,390')
    ap.add_argument('--no-reference', action='store_true', help='skip the replay of the original Webflow pages')
    ap.add_argument('--keep-shots', choices=['all', 'changed'], default='changed')
    ap.add_argument('--shard', default='1/1', help='k/n: run every n-th load starting at k (parallel processes)')
    ap.add_argument('--no-interactions', action='store_true', help='skip the interaction checks')
    ap.add_argument('--interactions-only', default=None, metavar='TEXT',
                    help="run only the interaction checks whose name contains TEXT ('' = all), no page loads")
    ap.add_argument('--json', help='write the full result here')
    ap.add_argument('--merge', nargs='+', help='merge shard results (JSON files) and print the summary')
    args = ap.parse_args()

    if args.merge:
        results = []
        for p in args.merge:
            with open(p, encoding='utf-8') as f:
                results += json.load(f)['loads']
        return finish(results, args)

    if not args.shots:
        sys.exit('--shots is required')
    dist, snapshot, shots = (os.path.realpath(x) for x in (args.dist, args.snapshot, args.shots))
    if shots == REPO or shots.startswith(REPO + os.sep):
        sys.exit('--shots must be outside the repository (%s)' % REPO)
    os.makedirs(shots, exist_ok=True)
    print('middleware redirect rule: QA server = site/functions/_middleware.js on %d URLs' % check_redirect_port())
    from playwright.sync_api import sync_playwright
    langs = Languages(dist)
    slugs = sorted(f[:-5] for f in os.listdir(dist) if f.endswith('.html') and f != '404.html')
    if args.pages:
        want = set(args.pages.split(','))
        slugs = [s for s in slugs if s in want]
    modes = [m for m in args.modes.split(',') if m]
    widths = [int(x) for x in args.widths.split(',') if x]
    jobs = [(s, m, w) for s in slugs for m in modes for w in widths]
    if not args.pages or '404' in args.pages.split(','):
        jobs += [('404', 'sr', w) for w in widths]
    if args.interactions_only is not None:
        jobs = []
    k, n = (int(x) for x in args.shard.split('/'))
    jobs = jobs[k - 1::n]
    snap, live, embed, _ = load_snapshot(snapshot)
    dist_answers = {key: v for key, v in snap.items() if key in live or key in embed}
    srv, port = start_server(dist, True)
    ref_srv, ref_port = start_server(snapshot, False)
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for slug, mode, width in jobs:
            vp = VIEWPORTS[width]
            tag = '%s__%s__%d' % (slug, mode, width)
            shot = os.path.join(shots, tag + '.png')
            r = load(browser, 'http://127.0.0.1:%d%s' % (port, dist_path(slug, mode)), vp, shot, port, dist_answers,
                     False, probe_fonts=(mode == 'sr'), collect_strings=(mode in ('en', 'ru')))
            r.update({'page': slug, 'path': dist_path(slug, mode), 'mode': mode, 'viewport': '%dx%d' % vp})
            classify_external(r, live, embed)
            if slug != '404':
                r['text_static_snapshot'] = static_text_len(os.path.join(snapshot, 'pages', slug + '.html'))
                r['text_ratio_static'] = round(r.get('text_len', 0) / max(1, r['text_static_snapshot']), 3)
            if not args.no_reference and slug != '404':
                ref_shot = os.path.join(shots, tag + '__reference.png')
                ref = load(browser, 'http://127.0.0.1:%d%s' % (ref_port, ref_path(slug, mode)), vp, ref_shot, ref_port,
                           snap, True, probe_fonts=(mode == 'sr'))
                r['reference'] = {x: ref.get(x) for x in ('status', 'text_len', 'page_errors', 'seconds', 'answered',
                                                          'title', 'html_lang', 'fonts')}
                r['reference']['console_errors'] = [c for c in ref['console'] if c['type'] == 'error'
                                                    and not c['blocked_request']]
                r['reference']['external_unanswered'] = sorted({x['host'] for x in ref['external']
                                                                if not x['answered']})
                ref_text = ref.get('text') or ''
                if mode in ('en', 'ru', 'sr-cyrl'):   # sr-cyrl: the legal-data placeholder hidden in Cyrillic too
                    ref_text, r['explained'] = langs.explain(slug, mode, ref_text, r.get('text') or '')
                r['text_ratio_reference'] = round(r.get('text_len', 0) / max(1, len(ref_text) or 1), 3)
                r['text_same_as_reference'] = r.get('text') == ref_text
                if not r['text_same_as_reference']:
                    r['text_diff'] = text_diff(ref_text, r.get('text') or '')
                    r['text_chunks'] = chunks(ref_text, r.get('text') or '')[:40]
                r['title_reference'] = ref.get('title')
                r['pixels'] = pixel_diff(shot, ref_shot)
                if args.keep_shots == 'changed' and (r['pixels'] or {}).get('changed_pct', 100) <= PIXEL_KEEP:
                    for p in (shot, ref_shot):
                        if os.path.isfile(p):
                            os.remove(p)
            elif args.keep_shots == 'changed' and slug != '404' and os.path.isfile(shot):
                os.remove(shot)
            evaluate(r, dist)
            li, ln_ = check_languages(r, langs)
            r['issues'] += li
            r['notes'] += ln_
            r.pop('text', None)
            r.pop('strings', None)
            results.append(r)
            print(summary_line(r), flush=True)
        if not args.no_interactions and k == 1:
            results += run_interactions(browser, port, dist_answers, live, embed, dist, args.interactions_only or '')
        browser.close()
    srv.shutdown()
    ref_srv.shutdown()
    return finish(results, args)


def dist_path(slug, mode):
    """URL of a page version on the built site."""
    if slug == '404':
        return '/ova-stranica-ne-postoji-qa'
    base = '/' if slug == 'index' else '/' + slug
    if mode in ('en', 'ru'):
        return '/' + mode + base
    return base + ('?lang=sr-cyrl' if mode == 'sr-cyrl' else '')


def ref_path(slug, mode):
    """The original page (snapshot replay) in the same language: ?lang= switched it in the browser."""
    base = '/' if slug == 'index' else '/' + slug
    return base + ('' if mode == 'sr' else '?lang=' + mode)


# ------------------------------------------------------------------------------------------------ interactions
GA_STUB = (b'/* QA stub: nothing is sent */', 'application/javascript')
PHOTON_STUB = (json.dumps({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {
    'type': 'Point', 'coordinates': [19.8335, 45.2551]}, 'properties': {
    'name': 'Bulevar oslobođenja', 'housenumber': '10', 'city': 'Novi Sad', 'country': 'Srbija',
    'osm_key': 'place', 'type': 'house'}}]}).encode(), 'application/json')


SWITCH_PAGES = ['index', 'paketi-i-cene', 'cesta-pitanja', 'punjaci-za-hotele', 'kontakt']
HTML_OF_CODE = {'sr': 'sr', 'cy': 'sr-Cyrl', 'en': 'en', 'ru': 'ru'}


def page_url_of(slug, code):
    """Path a visitor ends on after choosing a language (Cyrillic: the Serbian page, the engine drops ?lang=)."""
    base = '/' if slug == 'index' else '/' + slug
    return '/' + code + base if code in ('en', 'ru') else base


def act_switch(slug, code, menu):
    """Choose a language in the header (1440) or footer (390) menu; expect the page in that language, at its URL,
    and the choice remembered (localStorage bvl)."""
    def act(page):
        sel = ('.mega-nav__bar-action.is--lang [data-evo-lang] .evo-lang__btn' if menu == 'header' else
               '.evo-lang--foot .evo-lang__btn')
        page.locator(sel).first.click()
        opt = page.locator('[data-evo-lang].is-open .evo-lang__opt[data-l="%s"]' % code).first
        href = opt.get_attribute('href')
        want_path = page_url_of(slug, code)
        before = page.evaluate('() => location.pathname')
        opt.click()
        try:
            page.wait_for_function('([p, l]) => location.pathname === p && document.documentElement.lang === l',
                                   arg=[want_path, HTML_OF_CODE[code]], timeout=15000)
            page.wait_for_load_state('load')
            page.wait_for_timeout(600)
        except Exception:  # noqa: BLE001
            pass
        got = page.evaluate("() => [location.pathname + location.search, document.documentElement.lang, "
                            "(() => { try { return localStorage.getItem('bvl'); } catch (e) { return null; } })()]")
        out = []
        if got[0] != want_path or got[1] != HTML_OF_CODE[code] or got[2] != code:
            out.append('%s -> %s via %s: at %s (lang %s, stored %s), expected %s (lang %s, stored %s); link %s' % (
                before, code, menu, got[0], got[1], got[2], want_path, HTML_OF_CODE[code], code, href))
        return out
    return act


def act_expect(path, lang, stored=None, extra=None):
    """After loading (and an optional step): where the visitor is, the page language, what is remembered."""
    def act(page):
        if extra:
            extra(page)
        page.wait_for_timeout(800)
        got = page.evaluate("() => [location.pathname + location.search, document.documentElement.lang, "
                            "(() => { try { return localStorage.getItem('bvl'); } catch (e) { return null; } })(), "
                            "(document.getElementById('bv-paket-note') || {}).textContent || '']")
        out = []
        if got[0] != path or got[1] != lang or (stored is not None and got[2] != stored):
            out.append('at %s (lang %s, stored %s), expected %s (lang %s%s)' % (
                got[0], got[1], got[2], path, lang, ', stored %s' % stored if stored is not None else ''))
        return out
    return act


def act_paket_note(path, lang, word):
    """The package choice of the link (?paket=) survives the move to another language URL."""
    base = act_expect(path, lang)

    def act(page):
        out = base(page)
        note = page.evaluate("() => (document.getElementById('bv-paket-note') || {}).textContent || ''")
        if word not in note:
            out.append('package note %r, expected %s' % (note, word))
        return out
    return act


def step_reload_with(stored):
    def step(page):
        page.evaluate("(v) => localStorage.setItem('bvl', v)", stored)
        page.reload(wait_until='load')
    return step


def step_menu_then_back(code):
    def step(page):
        page.locator('.mega-nav__bar-action.is--lang [data-evo-lang] .evo-lang__btn').first.click()
        page.locator('[data-evo-lang].is-open .evo-lang__opt[data-l="%s"]' % code).first.click()
        page.wait_for_url('**/%s/**' % code, timeout=15000)
        page.wait_for_load_state('load')
        page.go_back(wait_until='load')
    return step


def step_menu_then_reload(code):
    """Choose a language in the header menu, wait for that page, then reload it (the choice must survive)."""
    def step(page):
        page.locator('.mega-nav__bar-action.is--lang [data-evo-lang] .evo-lang__btn').first.click()
        page.locator('[data-evo-lang].is-open .evo-lang__opt[data-l="%s"]' % code).first.click()
        page.wait_for_function('(l) => document.documentElement.lang === l', arg=HTML_OF_CODE[code], timeout=15000)
        page.wait_for_load_state('load')
        page.wait_for_timeout(500)
        page.reload(wait_until='load')
    return step


def act_consent_allow(page):
    """Cookie banner: "Dozvoli" loads GA4 and the Meta pixel (stubbed here; the CSP must let them load)."""
    page.locator('#evo-ck .y').click()
    page.wait_for_timeout(1500)
    return [] if page.evaluate('() => !document.getElementById("evo-ck")') else ['the banner stayed']


def act_zgrada_flyer(page):
    """/prijavi-zgradu: address -> counter (app.evolako.rs/zgrada/broj, stubbed), A4 notice with its QR code."""
    page.fill('#email-form [name="Ulica"]', 'Bulevar oslobođenja')
    page.fill('#email-form [name="Broj"]', '10')
    page.fill('#email-form [name="Grad"]', 'Novi Sad')
    page.wait_for_timeout(1500)
    # leave the field first: its change event re-renders the side panel, which swallows a click that also blurs it
    # (the original page does the same — a first click right after typing does nothing there either)
    page.locator('#email-form [name="Grad"]').blur()
    page.wait_for_timeout(300)
    page.locator('[data-flyer]').first.click()
    try:
        page.wait_for_selector('#evf-qr svg', timeout=8000)
        return []
    except Exception:  # noqa: BLE001
        return ['no QR code in the A4 notice']


def act_map_search(page):
    """/mapa-punjaca: address search in the BlokVolt embed (photon.komoot.io, stubbed)."""
    try:
        page.wait_for_selector('#evm-q', timeout=10000)
    except Exception:  # noqa: BLE001
        return ['map search field missing']
    page.fill('#evm-q', 'Bulevar oslobođenja 10, Novi Sad')
    page.press('#evm-q', 'Enter')
    page.wait_for_timeout(2500)
    return []


# the card zooms the map: tiles the snapshot does not hold are answered empty (a valid empty vector tile)
MAP_STATION_STUBS = {'www.blokvolt.rs/assets/logos/': (b'\x89PNG\r\n\x1a\n', 'image/png'),
                     'tiles.openfreemap.org/planet/': (b'', 'application/x-protobuf')}


def act_map_station(page):
    """/mapa-punjaca: open a station card of a network with a logo (the logo comes from www.blokvolt.rs; the page's
    CSP must allow that image — a violation is reported by the load like every CSP problem)."""
    try:
        page.wait_for_selector('.evm-st', timeout=15000)
    except Exception:  # noqa: BLE001
        return ['map station list missing']
    page.locator('.evm-st', has_text='Charge&GO').first.click()
    page.wait_for_timeout(2000)
    shown = page.evaluate("() => Array.from(document.querySelectorAll('#evm img')).map(i => i.getAttribute('src'))")
    return [] if any('/logos/' in (s or '') for s in shown) else ['no network logo in the station card: %s' % shown[:3]]


INTERACTIONS = [
    # (name, path, action, stubs, widths, options: storage / referer path / no_middleware)
    ('consent-allow', '/kontakt', act_consent_allow, {'googletagmanager.com/gtag/js': GA_STUB,
                                                      'connect.facebook.net/en_US/fbevents.js': GA_STUB}, None, {}),
    ('consent-allow', '/en/kontakt', act_consent_allow, {'googletagmanager.com/gtag/js': GA_STUB,
                                                         'connect.facebook.net/en_US/fbevents.js': GA_STUB}, None, {}),
    ('zgrada-flyer', '/prijavi-zgradu', act_zgrada_flyer, {'app.evolako.rs/zgrada/broj': (b'{"count":2}',
                                                                                           'application/json')}, None,
     {}),
    ('zgrada-flyer', '/ru/prijavi-zgradu', act_zgrada_flyer, {'app.evolako.rs/zgrada/broj': (b'{"count":2}',
                                                                                              'application/json')},
     None, {}),
    ('map-search', '/mapa-punjaca', act_map_search, {'photon.komoot.io/': PHOTON_STUB}, None, {}),
    ('map-search', '/en/mapa-punjaca', act_map_search, {'photon.komoot.io/': PHOTON_STUB}, None, {}),
    ('map-station', '/mapa-punjaca', act_map_station, MAP_STATION_STUBS, [1440], {}),
    ('map-station', '/ru/mapa-punjaca', act_map_station, MAP_STATION_STUBS, [390], {}),
    # a remembered choice (localStorage bvl, as the old site stored it)
    ('stored en, from outside', '/kontakt?paket=wallbox', act_paket_note('/en/kontakt', 'en', 'WALLBOX'), {}, None,
     {'storage': {'bvl': 'en'}}),
    ('stored ru, from outside', '/paketi-i-cene', act_expect('/ru/paketi-i-cene', 'ru', 'ru'), {}, None,
     {'storage': {'bvl': 'ru'}}),
    ('stored en, from /en/', '/kontakt', act_expect('/kontakt', 'sr', 'sr'), {}, [1440],
     {'storage': {'bvl': 'en'}, 'referer': '/en/kontakt'}),
    ('stored en, from a Serbian page', '/kontakt', act_expect('/kontakt', 'sr', 'en'), {}, [1440],
     {'storage': {'bvl': 'en'}, 'referer': '/paketi-i-cene'}),
    ('stored en, reload', '/kontakt', act_expect('/kontakt', 'sr', 'en', step_reload_with('en')), {}, [1440],
     {'storage': {'bvl': 'sr'}}),
    ('menu en, then back', '/kontakt', act_expect('/kontakt', 'sr', 'en', step_menu_then_back('en')), {}, [1440],
     {'storage': {'bvl': 'sr'}}),
    # Cyrillic chosen on an English or Russian page survives a reload (the referrer of the reload is still /en/…)
    ('menu cy from /en/, reload', '/en/kontakt', act_expect('/kontakt', 'sr-Cyrl', 'cy', step_menu_then_reload('cy')),
     {}, [1440], {}),
    ('menu cy from /ru/, reload', '/ru/paketi-i-cene',
     act_expect('/paketi-i-cene', 'sr-Cyrl', 'cy', step_menu_then_reload('cy')), {}, [1440], {}),
    ('menu sr from /en/, reload', '/en/kontakt', act_expect('/kontakt', 'sr', 'sr', step_menu_then_reload('sr')),
     {}, [1440], {}),
    ('stored cy', '/kontakt', act_expect('/kontakt', 'sr-Cyrl', 'cy'), {}, None, {'storage': {'bvl': 'cy'}}),
    ('stored ru, on /en/', '/en/kontakt', act_expect('/en/kontakt', 'en', 'en'), {}, [1440],
     {'storage': {'bvl': 'ru'}}),
    ('stored en, the 404', '/nema-ove-stranice', act_expect('/nema-ove-stranice', 'en', 'en'), {}, [1440],
     {'storage': {'bvl': 'en'}}),
    # old ?lang= links: the middleware (301) and, without it, the engine itself
    ('?lang=en (301)', '/kontakt?lang=en&paket=wallbox', act_paket_note('/en/kontakt', 'en', 'WALLBOX'), {}, None,
     {}),
    ('?lang=ru (no middleware)', '/kontakt?lang=ru&paket=start', act_paket_note('/ru/kontakt', 'ru', 'START'), {},
     [1440], {'no_middleware': True}),
    ('?lang=sr-cyrl stays', '/kontakt?lang=sr-cyrl', act_expect('/kontakt', 'sr-Cyrl', 'cy'), {}, None, {}),
    ('?lang=ru on /en/ (301)', '/en/punjaci-za-hotele?lang=ru', act_expect('/ru/punjaci-za-hotele', 'ru', 'ru'), {},
     [1440], {}),
    ('?lang=sr on /ru/', '/ru/?lang=sr', act_expect('/', 'sr', 'sr'), {}, [1440], {}),
]
for _slug in SWITCH_PAGES:
    _base = '/' if _slug == 'index' else '/' + _slug
    for _start, _targets in (('sr', ('cy', 'en', 'ru')), ('cy', ('sr', 'en', 'ru')), ('en', ('sr', 'cy', 'ru')),
                             ('ru', ('sr', 'cy', 'en'))):
        _path = {'sr': _base, 'cy': _base + '?lang=sr-cyrl', 'en': '/en' + _base, 'ru': '/ru' + _base}[_start]
        for _code in _targets:
            for _w, _menu in ((1440, 'header'), (390, 'footer')):
                INTERACTIONS.append(('switch %s->%s (%s)' % (_start, _code, _menu), _path,
                                     act_switch(_slug, _code, _menu), {}, [_w], {}))


def check_http_redirects(port):
    """The QA server answers old ?lang= links the way the middleware does (301 + Location), pages as Pages does."""
    import http.client
    out = []
    cases = [('/kontakt?lang=en&paket=wallbox', 301, '/en/kontakt?paket=wallbox'), ('/?lang=ru', 301, '/ru/'),
             ('/kontakt?lang=sr-cyrl', 200, None), ('/en/kontakt?lang=ru', 301, '/ru/kontakt'),
             ('/en/', 200, None), ('/en', 308, '/en/'), ('/ru/index.html', 308, '/ru/'),
             ('/en/kontakt.html', 308, '/en/kontakt'), ('/en/kontakt/', 308, '/en/kontakt'), ('/en/kontakt', 200, None),
             ('/en/nema', 404, None), ('/sitemap.xml', 200, None)]
    for path, status, loc in cases:
        c = http.client.HTTPConnection('127.0.0.1', port, timeout=10)
        c.request('GET', path)
        r = c.getresponse()
        r.read()
        got_loc = r.getheader('Location')
        if r.status != status or (loc and got_loc != loc):
            out.append('%s: %s %s, expected %s %s' % (path, r.status, got_loc, status, loc))
        c.close()
    return len(cases), out


def run_interactions(browser, port, answers, live, embed, dist, only=''):
    out = []
    n, bad = check_http_redirects(port)
    print('http: %d redirect and routing cases, %s' % (n, 'OK' if not bad else 'ISSUES: ' + '; '.join(bad)))
    out.append({'page': 'http', 'path': '-', 'mode': '-', 'viewport': '-', 'interaction': 'http redirects',
                'issues': bad, 'external': [], 'console_errors': [], 'page_errors': [], 'local_failed': [],
                'csp': [], 'broken_links': [], 'forbidden': [], 'notes': []})
    for name, path, act, stubs, widths, opt in INTERACTIONS:
        if only and only not in name:
            continue
        for width in widths or (1440, 390):
            referer = 'http://127.0.0.1:%d%s' % (port, opt['referer']) if opt.get('referer') else None
            r = load(browser, 'http://127.0.0.1:%d%s' % (port, path), VIEWPORTS[width], None, port, answers, False,
                     scroll=False, stubs=stubs, actions=act, storage=opt.get('storage'), referer=referer,
                     no_middleware=opt.get('no_middleware'))
            r.update({'page': (path.split('?')[0].strip('/') or 'index'), 'path': path, 'mode': 'sr',
                      'viewport': '%dx%d' % VIEWPORTS[width], 'interaction': name})
            classify_external(r, live, embed)
            evaluate(r, dist)
            # page-load expectations do not apply (the page may be another language or the 404 by design)
            r['issues'] = [i for i in r['issues'] if not i.startswith(('text ', 'html lang', 'status 404'))] + \
                r.get('checks', [])
            r.pop('text', None)
            out.append(r)
            print('interaction %-34s %-34s %-8s %s' % (
                name, path, r['viewport'], 'OK' if not r['issues'] else 'ISSUES: ' + '; '.join(r['issues'])),
                flush=True)
    return out


def text_diff(a, b):
    """First difference between two texts, with a little context."""
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    return {'at': i, 'reference': a[max(0, i - 40):i + 60], 'dist': b[max(0, i - 40):i + 60]}


# ------------------------------------------------------------------------------------------------ languages
class Languages:
    """What the /en/ and /ru/ checks know: the Serbian source texts (keys of every dictionary the live pages load,
    of the site's own translations, and of every text of the built Serbian pages), the site's own translations,
    keep.json, and the texts whose live value depends on load timing."""

    def __init__(self, dist):
        sys.path.insert(0, HERE)
        from i18n_harvest import expand
        with open(os.path.join(SITE_DIR, 'i18n', 'harvest.json'), encoding='utf-8') as f:
            h = json.load(f)
        self.harvest = expand(h)
        self.known = set()
        for lang, names in h['values'].items():
            for name, d in names.items():
                self.known.update(d)
        self.own = {}
        for lang in PR.LANGS:
            self.own[lang], src = PR.load_i18n(os.path.join(SITE_DIR, 'i18n'), lang)
            self.own_sr = getattr(self, 'own_sr', {})
            self.own_sr.update(src)
            self.known.update(self.own[lang])
        self.keep = PR.load_keep(os.path.join(SITE_DIR, 'i18n'))
        self.known.update(self.keep)
        for f in os.listdir(dist):
            if f.endswith('.html'):
                with open(os.path.join(dist, f), encoding='utf-8') as fh:
                    doc = fh.read()
                PR.translate_body(doc, _Collect(self.known))
        self.timing = {}
        for slug, langs in self.harvest.items():
            for lang, v in langs.items():
                for name, keys in (v.get('timing') or {}).items():
                    for k, alts in keys.items():
                        canon = v['dicts'].get(name, {}).get(k)
                        for a in alts:
                            self.timing.setdefault((slug, lang), []).append((PR.bf(a), PR.bf(canon) if canon else None))

    def is_serbian(self, text, lang):
        """(True, why) when a text on a /lang/ page is Serbian that should have been translated."""
        t = PR.nm(text)
        if PR.looks_neutral(t):
            return False, None
        k = PR.key_of(t)
        if k in self.keep:
            return False, 'keep'
        if k in self.known:
            return True, 'a Serbian source text'
        if PR.looks_serbian(t):
            return True, 'looks Serbian'
        return False, None

    def explain(self, slug, lang, ref, dist):
        """Reference text with every difference that has a known reason replaced by what the built page shows, so
        that only unexplained differences remain. Returns (adjusted reference, [(kind, reference text, built text)]).

        The texts are compared word by word; each differing stretch (with up to a few equal words around it, so a
        replacement of several words fits) counts as explained only if the known reasons turn the reference stretch
        into exactly the built one: a translation the site adds (site/i18n/<lang>.json) for a text the live page left
        in Serbian, a text whose live value depends on load timing (harvest.json "timing": the build uses the
        first-visit value), the legal-data placeholder (hidden on the /en/ page and in Cyrillic as on the Serbian
        page). Nothing is
        replaced anywhere else, so a word that both versions keep (an address, a name) never becomes a difference."""
        import difflib
        pairs = sorted(((self.own_sr[k], v) for k, v in self.own.get(lang, {}).items()), key=lambda x: -len(x[0]))
        timing = [(alt, canon) for alt, canon in self.timing.get((slug, lang), []) if canon and alt != canon]
        a, b = ref.split(' '), dist.split(' ')
        ops = difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes()

        def fix(x, y):
            """(x with the known reasons applied, reasons) — the reasons only where they bring x closer to y."""
            why = []
            for alt, canon in timing:
                if alt in x and canon in y:
                    x = x.replace(alt, canon)
                    why.append(('live timing variant', alt, canon))
            for sr, tr in pairs:
                if sr in x and tr in y:
                    new = re.sub(r'(?<![\w])%s(?![\w])' % re.escape(sr), lambda m: tr, x)
                    if new != x:
                        why.append(('own translation', sr, tr))
                        x = new
            # the legal-data placeholder: the Serbian page hides it until the data are filled in; on the live English
            # page (and the live page opened in Cyrillic) the engine translated it before the hiding script ran, so it
            # shows — the /en/ page and the Cyrillic page hide it too (also after a switch in place on the live site)
            for m in list(re.finditer(r'\[(?:LEGAL-DATA|PRAVNI-PODACI|ПРАВНИ-ПОДАЦИ):[^\]]*\](?: · [^ ]+@[^ ]+)?', x)):
                if m.group(0) not in y:
                    x = x.replace(m.group(0), '', 1)
                    why.append(('legal-data placeholder hidden, as on the Serbian page', m.group(0), ''))
            return ' '.join(x.split()), why

        def explained(n, m):
            """The differing stretch from ops[n] to ops[m] (equal words between them included), with up to a few
            equal words around it: (reasons) if the known reasons turn it into the built text exactly, else None."""
            i1, j1, i2, j2 = ops[n][1], ops[n][3], ops[m][2], ops[m][4]
            before = ops[n - 1][2] - ops[n - 1][1] if n and ops[n - 1][0] == 'equal' else 0
            after = ops[m + 1][2] - ops[m + 1][1] if m + 1 < len(ops) and ops[m + 1][0] == 'equal' else 0
            for c in (0, 1, 2, 3, 5, 8):
                lo, hi = min(c, before), min(c, after)
                x = ' '.join(a[i1 - lo:i2 + hi])
                y = ' '.join(b[j1 - lo:j2 + hi])
                z, why = fix(x, y)
                if why and z == ' '.join(y.split()):
                    return why
            return None

        out, used, n = [], [], 0
        while n < len(ops):
            op, i1, i2, j1, j2 = ops[n]
            if op == 'equal':
                out += a[i1:i2]
                n += 1
                continue
            # a replacement can come out as several stretches around a word both keep ("Naplatna stanica Ruma" ->
            # "Ruma toll station"): try the stretches joined over short equal runs first, then one by one
            m = n
            while m + 2 < len(ops) and ops[m + 1][0] == 'equal' and ops[m + 1][2] - ops[m + 1][1] <= 3 and \
                    ops[m + 2][0] != 'equal':
                m += 2
            for last in range(m, n - 1, -2):
                why = explained(n, last)
                if why:
                    out += b[j1:ops[last][4]]
                    used += why
                    n = last + 1
                    break
            else:
                out += a[i1:i2]
                n += 1
        return ' '.join(out), used


class _Collect:
    """A Translator stand-in that only records the keys of the texts it is asked for."""

    def __init__(self, keys):
        self.keys = keys

    def tr(self, s, record=True):
        if PR.nm(s):
            self.keys.add(PR.key_of(s))
        return None


def chunks(ref, dist):
    """Word-level differences between two texts: [(reference words, dist words)]."""
    import difflib
    a, b = ref.split(' '), dist.split(' ')
    out = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op != 'equal':
            out.append((' '.join(a[i1:i2]), ' '.join(b[j1:j2])))
    return out


def check_languages(r, langs):
    """/en/ and /ru/ loads: Serbian left; every load: JSON-LD parses, FAQPage = visible FAQ."""
    seo = r.get('seo') or {}
    issues, notes = [], []
    blocks = []
    for raw in seo.get('jsonld') or []:
        try:
            blocks.append(json.loads(raw))
        except ValueError as e:
            issues.append('JSON-LD does not parse: %s' % e)
    r['jsonld_blocks'] = len(blocks)
    faq = [(q, a) for q, a in (seo.get('faq') or []) if q]
    visible = {q: a for q, a in faq}
    for b in blocks:
        for node in _nodes(b):
            # Cyrillic is the Serbian page transliterated in the browser: its JSON-LD stays Latin by design
            if node.get('@type') == 'FAQPage' and r['mode'] != 'sr-cyrl':
                for qn in node.get('mainEntity') or []:
                    q = PR.nm(qn.get('name') or '')
                    a = PR.nm(((qn.get('acceptedAnswer') or {}).get('text')) or '')
                    if q not in visible:
                        r.setdefault('faq_mismatch', []).append({'question': q, 'answer': None})
                    elif visible[q] != a:
                        r.setdefault('faq_mismatch', []).append({'question': q, 'answer_jsonld': a[:120],
                                                                 'answer_visible': visible[q][:120]})
                r['faq_checked'] = len(node.get('mainEntity') or [])
            lang_v = node.get('inLanguage')
            if lang_v and r['mode'] in ('en', 'ru') and lang_v != r['mode']:
                issues.append('JSON-LD inLanguage %s' % lang_v)
    if r.get('faq_mismatch'):
        msg = '%d FAQPage questions/answers differ from the visible ones' % len(r['faq_mismatch'])
        issues.append(msg)  # every language builds its FAQPage from the visible FAQ
    if r['mode'] in ('en', 'ru') and r['page'] != '404':
        left, kept, embed = {}, {}, {}
        for item in r.get('strings') or []:
            kind, text, vis = item[:3]
            in_embed = len(item) > 3 and item[3]
            if kind.startswith('json-ld:') and kind[8:] not in ('name', 'description', 'headline', 'text',
                                                                  'serviceType', 'unitText'):
                continue
            yes, why = langs.is_serbian(text, r['mode'])
            if yes and in_embed:
                # the BlokVolt map embed renders its own data (station names, addresses, operators) — a live
                # service; only that embed, in its own repository, decides its languages. Listed apart, not an issue
                embed[text] = why
            elif yes:
                left.setdefault(text, {'kinds': set(), 'why': why, 'visible': False})
                left[text]['kinds'].add(kind.split(':')[0] if not kind.startswith('json-ld') else kind)
                left[text]['visible'] |= bool(vis)
            elif why == 'keep':
                kept[text] = kind
        r['serbian_left'] = {t: {'kinds': sorted(v['kinds']), 'why': v['why'], 'visible': v['visible']}
                             for t, v in left.items()}
        r['kept'] = kept
        r['embed_serbian'] = embed
        if left:
            issues.append('%d Serbian texts left' % len(left))
        want = PR.page_url(SITE, r['mode'], r['page'])
        if seo.get('canonical') != want and not (r['page'] == 'index' and seo.get('canonical') == want):
            issues.append('canonical %s' % seo.get('canonical'))
        if seo.get('ogLocale') != PR.OG_LOCALE[r['mode']]:
            issues.append('og:locale %s' % seo.get('ogLocale'))
        if seo.get('ogUrl') != want:
            issues.append('og:url %s' % seo.get('ogUrl'))
    # links to the app (login, "My account") carry the site language (?lang=sr|en|ru; Cyrillic is sr)
    want_app = r['mode'] if r['mode'] in ('en', 'ru') else 'sr'
    bad_app = sorted({h for h in seo.get('app') or [] if urllib.parse.parse_qs(urllib.parse.urlsplit(h).query)
                      .get('lang') != [want_app]})
    r['app_links'] = len(seo.get('app') or [])
    if bad_app and not r.get('interaction'):
        issues.append('app links without lang=%s: %s' % (want_app, bad_app[:3]))
    if r['page'] != '404':
        alts = dict(seo.get('alternates') or [])
        exp = {h: PR.page_url(SITE, l, r['page']) for h, l in (('sr', 'sr'), ('en', 'en'), ('ru', 'ru'),
                                                                 ('x-default', 'sr'))}
        # the browser makes https://www.evolako.rs absolute as https://www.evolako.rs/
        norm = {h: (u if u != SITE else SITE + '/') for h, u in exp.items()}
        if {h: u for h, u in alts.items()} != norm:
            issues.append('hreflang alternates %s' % alts)
    return issues, notes


def _nodes(x):
    if isinstance(x, dict):
        yield x
        for v in x.values():
            yield from _nodes(v)
    elif isinstance(x, list):
        for v in x:
            yield from _nodes(v)


def evaluate(r, dist):
    issues = []
    want = 404 if r['page'] == '404' else 200
    if r.get('status') != want:
        issues.append('status %s (expected %d)' % (r.get('status'), want))
    if r['page_errors']:
        issues.append('%d uncaught errors' % len(r['page_errors']))
    errs = [c for c in r['console'] if c['type'] == 'error' and not c['blocked_request']]
    if errs:
        issues.append('%d console errors' % len(errs))
    if r['local_failed']:
        issues.append('%d failed local requests' % len(r['local_failed']))
    if r['csp']:
        issues.append('%d CSP violations' % len(r['csp']))
    if not r.get('csp_header'):
        issues.append('no Content-Security-Policy header')
    elif r['csp_header'].count('default-src') != 1:
        issues.append('%d Content-Security-Policy policies sent' % r['csp_header'].count('default-src'))
    forb = sorted({x['url'] for x in r['external'] if x['class'] == 'forbidden'})
    r['forbidden'] = forb
    if forb:
        issues.append('%d requests to forbidden hosts' % len(forb))
    if r.get('html_lang') != HTML_LANG[r['mode']] and r['page'] != '404':
        issues.append('html lang %s in mode %s' % (r.get('html_lang'), r['mode']))
    for f in r.get('forms') or []:
        if f.get('turnstileSitekey') or f.get('turnstileWidget'):
            issues.append('Turnstile left on a form')
    r['notes'] = []
    if r['page'] != '404':
        low = not TEXT_MIN <= r.get('text_ratio_static', 0) <= TEXT_MAX
        if 'text_ratio_reference' in r:
            if abs(1 - r['text_ratio_reference']) > REF_TOLERANCE:
                issues.append('text %.3f of the reference render' % r['text_ratio_reference'])
            elif low:
                r['notes'].append('visible text %.2f of the static snapshot text, same as the original page '
                                  '(text hidden by the page itself)' % r['text_ratio_static'])
        elif low:
            issues.append('text %.2f of the snapshot text' % r.get('text_ratio_static', 0))
    bad_links = sorted({u for u in r.get('links', []) if u.startswith('/') and not u.startswith('//')
                        and not resolves(dist, u)})
    r['broken_links'] = bad_links
    if bad_links:
        issues.append('%d broken links' % len(bad_links))
    fonts = r.get('fonts')
    if fonts and fonts.get('distinct', 0) < 7:
        issues.append('Onest weights 300-800 give only %d distinct widths' % fonts.get('distinct', 0))
    r['console_errors'] = errs
    r['issues'] = issues


def summary_line(r):
    px = r.get('pixels') or {}
    cls = {}
    for x in r['external']:
        cls[x['class']] = cls.get(x['class'], 0) + 1
    return '%-46s %-7s %-8s %s text %5s ref %-6s px %-7s ext %s %s%s' % (
        r['page'], r['mode'], r['viewport'], r.get('status'), r.get('text_len'), r.get('text_ratio_reference', '-'),
        px.get('changed_pct', '-'), '/'.join('%s:%d' % kv for kv in sorted(cls.items())) or '-',
        'OK' if not r['issues'] else 'ISSUES: ' + '; '.join(r['issues']),
        (' | note: ' + '; '.join(r['notes'])) if r['notes'] else '')


def finish(results, args):
    s = summarize(results)
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump({'loads': results, 'summary': s}, f, ensure_ascii=False, indent=1, sort_keys=True)
    print_summary(s)
    sys.exit(1 if s['loads_with_issues'] else 0)


def lid(r):
    return '%s %s %s%s' % (r['page'], r['mode'], r['viewport'], ' [%s]' % r['interaction'] if r.get('interaction')
                           else '')


def summarize(results):
    ext = {}
    for r in results:
        for x in r['external']:
            e = ext.setdefault((x['class'], x['host']), {'urls': {}, 'pages': set(), 'types': set(), 'loads': 0})
            e['urls'].setdefault(x['url'][:200], set()).add('%s:%s' % (r['mode'], r['page']))
            e['pages'].add(r['page'])
            e['types'].add(x['type'])
            e['loads'] += 1
    px = [((r.get('pixels') or {}).get('changed_pct', 0), r['page'], r['mode'], r['viewport']) for r in results
          if r.get('pixels')]
    fonts = {}
    for r in results:
        if r.get('fonts'):
            fonts.setdefault(r['viewport'], {'dist': r['fonts'], 'reference': (r.get('reference') or {}).get('fonts')})
    inter = [r for r in results if r.get('interaction')]
    return {
        'interactions': ['%s %s %s: %s' % (r['interaction'], r['path'], r['viewport'],
                                           'OK' if not r['issues'] else '; '.join(r['issues'])) for r in inter],
        'loads': len(results) - len(inter),
        'pages': len({r['page'] for r in results}),
        'modes': sorted({r['mode'] for r in results}),
        'viewports': sorted({r['viewport'] for r in results}),
        'loads_with_issues': sorted(lid(r) for r in results if r['issues']),
        'issues': {lid(r): r['issues'] for r in results if r['issues']},
        'console_errors': sum(len(r['console_errors']) for r in results),
        'page_errors': sum(len(r['page_errors']) for r in results),
        'failed_local_requests': sum(len(r['local_failed']) for r in results),
        'csp_violations': sum(len(r['csp']) for r in results),
        'csp_violation_examples': [dict(v, page=r['page'], mode=r['mode']) for r in results for v in r['csp']][:20],
        'broken_links': sorted({u for r in results for u in r['broken_links']}),
        'forbidden_requests': sorted({u for r in results for u in r['forbidden']}),
        'html_lang_mismatch': sorted('%s %s %s' % (r['page'], r['mode'], r.get('html_lang')) for r in results
                                     if r['page'] != '404' and not r.get('interaction') and
                                     r.get('html_lang') != HTML_LANG[r['mode']]),
        'external': {'%s %s' % k: {'loads': v['loads'], 'pages': len(v['pages']), 'types': sorted(v['types']),
                                   'what': KNOWN_HOSTS.get(k[1], ''),
                                   'urls': {u: len(p) for u, p in sorted(v['urls'].items())[:6]},
                                   'distinct_urls': len(v['urls'])} for k, v in sorted(ext.items())},
        'text_same_as_reference': sum(1 for r in results if r.get('text_same_as_reference')),
        'text_compared': sum(1 for r in results if 'text_same_as_reference' in r),
        'text_differences': [{'load': '%s %s %s' % (r['page'], r['mode'], r['viewport']), **r['text_diff']}
                             for r in results if r.get('text_diff')][:20],
        'max_text_ratio_deviation': max((abs(1 - r['text_ratio_reference']), r['page'], r['mode'], r['viewport'])
                                        for r in results if 'text_ratio_reference' in r) if any(
            'text_ratio_reference' in r for r in results) else None,
        'pixels': {'compared': len(px), 'identical': sum(1 for p in px if p[0] == 0),
                   'under_0.1%': sum(1 for p in px if 0 < p[0] <= 0.1),
                   'over_0.5%': sorted([list(p) for p in px if p[0] > 0.5], reverse=True)[:30],
                   'max': max(px) if px else None},
        'reference_console_errors': sorted({c['text'] for r in results
                                            for c in (r.get('reference') or {}).get('console_errors', [])}),
        'reference_page_errors': sorted({e for r in results for e in (r.get('reference') or {}).get('page_errors')
                                         or []}),
        'fonts': fonts,
        'console_error_texts': sorted({c['text'] for r in results for c in r['console_errors']})[:20],
        'page_error_texts': sorted({e for r in results for e in r['page_errors']})[:20],
        'serbian_left': serbian_left_summary(results),
        'kept': {lang: sorted({t for r in results if r['mode'] == lang for t in (r.get('kept') or {})})
                 for lang in ('en', 'ru')},
        'embed_serbian': {lang: sorted({t for r in results if r['mode'] == lang
                                        for t in (r.get('embed_serbian') or {})}) for lang in ('en', 'ru')},
        'explained': explained_summary(results),
        'text_unexplained': [{'load': lid(r), 'chunks': r.get('text_chunks')} for r in results
                             if r.get('text_chunks') and not r.get('interaction')],
        'jsonld_blocks': sum(r.get('jsonld_blocks', 0) for r in results),
        'faq_checked': sum(r.get('faq_checked', 0) for r in results),
        'faq_mismatch': sorted({'%s %s: %s' % (r['page'], r['mode'], m.get('question', '')[:60])
                                for r in results for m in r.get('faq_mismatch') or []}),
    }


def serbian_left_summary(results):
    out = {}
    for r in results:
        for text, v in (r.get('serbian_left') or {}).items():
            e = out.setdefault(r['mode'], {}).setdefault(text, {'pages': set(), 'kinds': set(), 'why': v['why'],
                                                                   'visible': False})
            e['pages'].add(r['page'])
            e['kinds'].update(v['kinds'])
            e['visible'] |= v['visible']
    return {lang: {t: {'pages': sorted(v['pages']), 'kinds': sorted(v['kinds']), 'why': v['why'],
                       'visible': v['visible'], 'key': PR.key_of(t)} for t, v in sorted(d.items())}
            for lang, d in out.items()}


def explained_summary(results):
    out = {}
    for r in results:
        for kind, a, b in r.get('explained') or []:
            e = out.setdefault(kind, {})
            e.setdefault('%s -> %s' % (a[:60], b[:60]), set()).add('%s %s' % (r['page'], r['mode']))
    return {k: {x: len(v) for x, v in sorted(d.items())} for k, d in out.items()}


def print_summary(s):
    for line in s['interactions']:
        print('interaction', line)
    print('\n%d loads (%d pages incl. 404 x modes %s x %s) + %d interaction checks; with issues: %d' % (
        s['loads'], s['pages'], ','.join(s['modes']), ','.join(s['viewports']), len(s['interactions']),
        len(s['loads_with_issues'])))
    for k, v in list(s['issues'].items())[:40]:
        print('  %s: %s' % (k, '; '.join(v)))
    print('console errors %d, uncaught errors %d, failed local requests %d, CSP violations %d, broken links %d, '
          'requests to forbidden hosts %d, html lang mismatches %d' % (
              s['console_errors'], s['page_errors'], s['failed_local_requests'], s['csp_violations'],
              len(s['broken_links']), len(s['forbidden_requests']), len(s['html_lang_mismatch'])))
    for v in s['csp_violation_examples'][:10]:
        print('   CSP:', json.dumps(v, ensure_ascii=False)[:300])
    for u in s['forbidden_requests'][:10]:
        print('   forbidden:', u)
    print('external requests by class and host:')
    for k, v in s['external'].items():
        print('  %-58s %5d loads, %2d pages, %3d URLs, %s%s' % (k, v['loads'], v['pages'], v['distinct_urls'],
                                                                 '/'.join(v['types']),
                                                                 (' — ' + v['what']) if v['what'] else ''))
    print('visible text identical to the reference in %d of %d loads; largest length deviation %s' % (
        s['text_same_as_reference'], s['text_compared'], s['max_text_ratio_deviation']))
    for d in s['text_differences'][:6]:
        print('   text differs: %s at %d: ref …%s… | dist …%s…' % (d['load'], d['at'], d['reference'][:80],
                                                                    d['dist'][:80]))
    p = s['pixels']
    print('pixels: %d pairs compared, %d identical, %d under 0.1 %%, %d over 0.5 %%, max %s' % (
        p['compared'], p['identical'], p['under_0.1%'], len(p['over_0.5%']), p['max']))
    for x in p['over_0.5%'][:10]:
        print('   %s %% %s %s %s' % tuple(x))
    for vp, f in sorted(s['fonts'].items()):
        print('fonts %s: dist widths %s (distinct %s), wordmark %s; reference widths %s, wordmark %s' % (
            vp, f['dist']['widths'], f['dist']['distinct'], f['dist']['wordmark'],
            (f['reference'] or {}).get('widths'), (f['reference'] or {}).get('wordmark')))
    for k in ('console_error_texts', 'page_error_texts', 'reference_console_errors', 'reference_page_errors'):
        if s[k]:
            print('%s (%d)%s' % (k, len(s[k]), ''.join('\n   ' + x[:200] for x in s[k][:8])))
    for lang in ('en', 'ru'):
        left = (s.get('serbian_left') or {}).get(lang) or {}
        print('Serbian left on /%s/ pages: %d distinct texts (%d visible)' % (
            lang, len(left), sum(1 for v in left.values() if v['visible'])))
        for t, v in list(left.items())[:25]:
            print('   %-8s %-60s %s %s %s' % (v['key'], t[:60], ','.join(v['kinds']), v['why'],
                                             ('%d pages' % len(v['pages'])) if len(v['pages']) > 2 else
                                             ','.join(v['pages'])))
        print('   kept as they are (site/i18n/keep.json): %d distinct' % len((s.get('kept') or {}).get(lang) or []))
        emb = (s.get('embed_serbian') or {}).get(lang) or []
        print('   inside the BlokVolt map embed (its own live data, as on the live page; not counted): %d distinct%s'
              % (len(emb), (', e.g. ' + '; '.join(t[:40] for t in emb[:5])) if emb else ''))
    for kind, d in (s.get('explained') or {}).items():
        print('explained text differences — %s: %d distinct, e.g. %s' % (kind, len(d), '; '.join(list(d)[:4])))
    print('JSON-LD blocks parsed: %d; FAQPage questions checked against the visible FAQ: %d, differing: %d' % (
        s['jsonld_blocks'], s['faq_checked'], len(s['faq_mismatch'])))
    for m in s['faq_mismatch'][:10]:
        print('   FAQ differs: ' + m)
    for d in s['text_unexplained'][:12]:
        print('   unexplained text differences %s: %s' % (d['load'], ' | '.join(
            '%r -> %r' % (a[:70], b[:70]) for a, b in (d['chunks'] or [])[:4])))


if __name__ == '__main__':
    main()

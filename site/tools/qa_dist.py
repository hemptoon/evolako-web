#!/usr/bin/env python3
"""Local QA of the static build site/dist (moving www.evolako.rs off Webflow). Nothing leaves this machine.

Serves site/dist on 127.0.0.1 the way Cloudflare Pages does — /slug -> slug.html, /slug.html and /slug/ -> 308 /slug,
an unknown path -> 404.html with status 404, and the rules of dist/_headers applied in file order the way Pages
applies them ("! Name" removes, a later rule sets again), so the browser enforces each page's Content-Security-Policy
— and opens every page + the 404 in Chromium (Playwright) in the four language modes (sr, ?lang=en, ?lang=ru,
?lang=sr-cyrl) at 1440x900 and 390x844:

  * HTTP status, console errors, uncaught exceptions, failed requests to the local server
  * CSP violations: securitypolicyviolation events, "Refused to ..." console/log entries, requests blocked by CSP
  * every request that leaves the site, with the script/document that started it (CDP initiator):
      - forbidden hosts (Webflow, its CDNs, Google Fonts/ajax, jsDelivr) must not be requested by the built site; the
        only exception is the BlokVolt map embed on /mapa-punjaca, a live service that loads its map library from
        jsDelivr itself ("embed", listed separately)
      - live services (app.evolako.rs, the exchange-rate file of evo-fx, the BlokVolt embed with its data and tiles)
        are answered with the copy the runtime capture saved, so every page runs complete offline
      - anything else is blocked and listed (e.g. Cloudflare Web Analytics, which the site loads on purpose)
  * visible text and pixels against the "reference": the original Webflow page from site/snapshot rendered the same
    way (same mode, same width), every file it asks for answered from the snapshot (static + runtime + live)
  * links: every root-relative href/src in the rendered page resolves in dist
  * fonts: width of a test string in Onest 300/350/400/500/550/600/800 (a variable font gives 7 different widths),
    weight and width of the wordmark "evo" (Onest 350)
  * forms: what the DOM holds after the page scripts ran (fields incl. hidden ones, honeypot, Turnstile left?)
Then interaction checks (shard 1 only; --no-interactions skips them), each at 1440 and 390 px with the same
CSP/request checks: the language menu (EN, Cyrillic, RU, back) on / and /mapa-punjaca, "Dozvoli" in the cookie banner
(GA4 and the Meta pixel answered by empty stubs: the CSP must let them load, nothing is sent), the A4 notice with its
QR code on /prijavi-zgradu (counter stubbed), the address search of the map (photon.komoot.io stubbed).
The forms themselves are sent by forms_e2e.py.

Screenshots go to --shots, which must be outside the repository (never committed). With --keep-shots changed (the
default) a pair of screenshots is kept only when the pixel difference is above 0.5 %.
Exit code: 1 = a load has an issue (see "issues"), 0 = clean.

Usage: python3 site/tools/qa_dist.py --shots /tmp/evo-shots [--pages index,kontakt] [--modes sr,en,ru,sr-cyrl]
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
import sys
import threading
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(SITE_DIR)
VIEWPORTS = {1440: (1440, 900), 390: (390, 844)}
MODES = ['sr', 'en', 'ru', 'sr-cyrl']
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
                self.wfile.write(data)

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
                if path != '/' and path.endswith('/') and self.file(path.rstrip('/') + '.html'):
                    return self.send(308, b'', 'text/plain', {'Location': path.rstrip('/') + q}, body, path)
                if path.endswith('.html') and self.file(path):
                    target = path[:-5] if path != '/index.html' else '/'
                    return self.send(308, b'', 'text/plain', {'Location': (target or '/') + q}, body, path)
                hit = self.file('index.html') if path == '/' else (self.file(path) or self.file(path + '.html'))
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


def resolves(dist, ref):
    """Does a root-relative URL resolve on the built site?"""
    path = urllib.parse.unquote(urllib.parse.urlsplit(ref).path)
    if path in ('', '/'):
        return True
    p = os.path.join(dist, path.lstrip('/'))
    return os.path.isfile(p) or os.path.isfile(p.rstrip('/') + '.html')


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
         actions=None):
    """answers: URL key -> (bytes, type). answer_all=False (dist): only live services and their embeds are answered
    (the keys given), everything else external is blocked. True (reference): every snapshot file is answered."""
    w, h = viewport
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=w < 800,
                              has_touch=w < 800, locale='sr-RS', service_workers='block')
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
        resp = page.goto(url, wait_until='load', timeout=60000)
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
    from playwright.sync_api import sync_playwright
    slugs = sorted(f[:-5] for f in os.listdir(dist) if f.endswith('.html') and f != '404.html')
    if args.pages:
        want = set(args.pages.split(','))
        slugs = [s for s in slugs if s in want]
    targets = [(s, '/' if s == 'index' else '/' + s) for s in slugs]
    if not args.pages or '404' in args.pages.split(','):
        targets.append(('404', '/ova-stranica-ne-postoji-qa'))
    modes = [m for m in args.modes.split(',') if m]
    widths = [int(x) for x in args.widths.split(',') if x]
    jobs = [(s, p, m, w) for s, p in targets for m in modes for w in widths]
    k, n = (int(x) for x in args.shard.split('/'))
    jobs = jobs[k - 1::n]
    snap, live, embed, _ = load_snapshot(snapshot)
    dist_answers = {key: v for key, v in snap.items() if key in live or key in embed}
    srv, port = start_server(dist, True)
    ref_srv, ref_port = start_server(snapshot, False)
    results = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        for slug, path, mode, width in jobs:
            vp = VIEWPORTS[width]
            q = '' if mode == 'sr' else '?lang=' + mode
            tag = '%s__%s__%d' % (slug, mode, width)
            shot = os.path.join(shots, tag + '.png')
            r = load(browser, 'http://127.0.0.1:%d%s%s' % (port, path, q), vp, shot, port, dist_answers, False,
                     probe_fonts=(mode == 'sr'))
            r.update({'page': slug, 'path': path, 'mode': mode, 'viewport': '%dx%d' % vp})
            classify_external(r, live, embed)
            if slug != '404':
                r['text_static_snapshot'] = static_text_len(os.path.join(snapshot, 'pages', slug + '.html'))
                r['text_ratio_static'] = round(r.get('text_len', 0) / max(1, r['text_static_snapshot']), 3)
            if not args.no_reference and slug != '404':
                ref_shot = os.path.join(shots, tag + '__reference.png')
                ref = load(browser, 'http://127.0.0.1:%d%s%s' % (ref_port, path, q), vp, ref_shot, ref_port, snap,
                           True, probe_fonts=(mode == 'sr'))
                r['reference'] = {x: ref.get(x) for x in ('status', 'text_len', 'page_errors', 'seconds', 'answered',
                                                          'title', 'html_lang', 'fonts')}
                r['reference']['console_errors'] = [c for c in ref['console'] if c['type'] == 'error'
                                                    and not c['blocked_request']]
                r['reference']['external_unanswered'] = sorted({x['host'] for x in ref['external']
                                                                if not x['answered']})
                r['text_ratio_reference'] = round(r.get('text_len', 0) / max(1, ref.get('text_len') or 1), 3)
                r['text_same_as_reference'] = r.get('text') == ref.get('text')
                if not r['text_same_as_reference']:
                    r['text_diff'] = text_diff(ref.get('text') or '', r.get('text') or '')
                r['pixels'] = pixel_diff(shot, ref_shot)
                if args.keep_shots == 'changed' and (r['pixels'] or {}).get('changed_pct', 100) <= PIXEL_KEEP:
                    for p in (shot, ref_shot):
                        if os.path.isfile(p):
                            os.remove(p)
            elif args.keep_shots == 'changed' and slug != '404' and os.path.isfile(shot):
                os.remove(shot)
            evaluate(r, dist)
            r.pop('text', None)
            results.append(r)
            print(summary_line(r), flush=True)
        if not args.no_interactions and k == 1:
            results += run_interactions(browser, port, dist_answers, live, embed, dist)
        browser.close()
    srv.shutdown()
    ref_srv.shutdown()
    return finish(results, args)


# ------------------------------------------------------------------------------------------------ interactions
GA_STUB = (b'/* QA stub: nothing is sent */', 'application/javascript')
PHOTON_STUB = (json.dumps({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {
    'type': 'Point', 'coordinates': [19.8335, 45.2551]}, 'properties': {
    'name': 'Bulevar oslobođenja', 'housenumber': '10', 'city': 'Novi Sad', 'country': 'Srbija',
    'osm_key': 'place', 'type': 'house'}}]}).encode(), 'application/json')


def act_language_menu(page):
    """Header language menu: EN, Cyrillic, RU, back to Latin — each switch loads its dictionaries locally."""
    out, texts = [], {}
    for code, want in (('en', 'en'), ('cy', 'sr-Cyrl'), ('ru', 'ru'), ('sr', 'sr')):
        page.locator('[data-evo-lang] .evo-lang__btn:visible').first.click()   # header (desktop) or footer (mobile)
        page.locator('[data-evo-lang].is-open .evo-lang__opt[data-l="%s"]' % code).first.click()
        page.wait_for_timeout(1200)
        lang = page.evaluate('() => document.documentElement.lang')
        texts[code] = page.evaluate("() => document.body.innerText.slice(0, 4000)")
        if lang != want:
            out.append('menu %s: html lang %s' % (code, lang))
    if len(set(texts.values())) < 4:
        out.append('the text did not change with every language')
    return out


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


INTERACTIONS = [
    ('language-menu', '/', act_language_menu, {}),
    ('language-menu', '/mapa-punjaca', act_language_menu, {}),
    ('consent-allow', '/kontakt', act_consent_allow, {'googletagmanager.com/gtag/js': GA_STUB,
                                                      'connect.facebook.net/en_US/fbevents.js': GA_STUB}),
    ('zgrada-flyer', '/prijavi-zgradu', act_zgrada_flyer, {'app.evolako.rs/zgrada/broj': (b'{"count":2}',
                                                                                           'application/json')}),
    ('map-search', '/mapa-punjaca', act_map_search, {'photon.komoot.io/': PHOTON_STUB}),
]


def run_interactions(browser, port, answers, live, embed, dist):
    out = []
    for name, path, act, stubs in INTERACTIONS:
        for width in (1440, 390):
            r = load(browser, 'http://127.0.0.1:%d%s' % (port, path), VIEWPORTS[width], None, port, answers, False,
                     scroll=False, stubs=stubs, actions=act)
            r.update({'page': path.strip('/') or 'index', 'path': path, 'mode': 'sr',
                      'viewport': '%dx%d' % VIEWPORTS[width], 'interaction': name})
            classify_external(r, live, embed)
            evaluate(r, dist)
            r['issues'] = [i for i in r['issues'] if not i.startswith(('text ', 'html lang'))] + r.get('checks', [])
            r.pop('text', None)
            out.append(r)
            print('interaction %-14s %-16s %-8s %s | external: %s' % (
                name, path, r['viewport'], 'OK' if not r['issues'] else 'ISSUES: ' + '; '.join(r['issues']),
                ', '.join(sorted({'%s %s' % (x['class'], x['host']) for x in r['external']}))), flush=True)
    return out


def text_diff(a, b):
    """First difference between two texts, with a little context."""
    i = 0
    while i < min(len(a), len(b)) and a[i] == b[i]:
        i += 1
    return {'at': i, 'reference': a[max(0, i - 40):i + 60], 'dist': b[max(0, i - 40):i + 60]}


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
                                     if r['page'] != '404' and r.get('html_lang') != HTML_LANG[r['mode']]),
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
    }


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


if __name__ == '__main__':
    main()

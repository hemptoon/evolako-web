#!/usr/bin/env python3
"""Local QA of the static build site/dist (step 2 of moving www.evolako.rs off Webflow). Nothing leaves this machine.

Serves site/dist on 127.0.0.1 the way Cloudflare Pages does (/slug -> slug.html, /slug.html and /slug/ -> 308 /slug,
an unknown path -> 404.html with status 404) and opens every page in Chromium (Playwright) at 1440x900 and 390x844:

  * HTTP status of the page, console errors, uncaught exceptions, failed requests to the local server
  * EVERY request to a host other than 127.0.0.1 is listed; only app.evolako.rs runtime endpoints are expected —
    anything else is a file the build did not copy, or a third-party service the page loads at runtime. External
    requests are blocked, except files on app.evolako.rs that the snapshot holds (evo-fx), which are answered with
    the snapshot copy, as the app would answer them
  * visible text (document.body.innerText) against the text of the snapshot page (parsed statically), and against the
    "reference": the original Webflow page from site/snapshot rendered the same way, with its CDN requests answered
    from snapshot/assets — so a difference is caused by the build, not by the offline environment
  * pixel difference against the reference screenshot (when Pillow is installed)
  * links: every root-relative href/src in the rendered page (incl. links added by scripts) resolves in dist
  * forms: what the DOM holds after the page scripts ran (fields incl. hidden ones, Turnstile, submit state)

Full-page screenshots go to --shots, which must be outside the repository (they are never committed).
--langs en,ru additionally opens every page with ?lang=en / ?lang=ru (desktop, no screenshots) to list what the i18n
scripts load at runtime. Exit code: 1 = a page has an issue (see "issues"), 2 = no issues, but pages request hosts
other than app.evolako.rs (listed under "external requests"), 0 = clean.

Usage: python3 site/tools/qa_dist.py --shots /tmp/evolako-dist-shots [--pages index,kontakt] [--langs en,ru]
                                     [--no-reference] [--json report.json]
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

from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
REPO = os.path.dirname(SITE_DIR)
VIEWPORTS = [(1440, 900), (390, 844)]
EXPECTED_HOSTS = {'app.evolako.rs'}     # runtime endpoints of the app; every other external request is reported
# What the other hosts are, for the report (they are still listed as findings)
KNOWN_HOSTS = {
    'cdn.prod.website-files.com': 'Webflow CDN: file built from a base URL at runtime, not in the snapshot',
    'challenges.cloudflare.com': 'Turnstile, loaded by webflow.js for forms with data-turnstile-sitekey',
    'static.cloudflareinsights.com': 'Cloudflare Web Analytics beacon (registered script evocfconsent1210)',
    'www.blokvolt.rs': 'BlokVolt map embed and its data (/mapa-punjaca)',
    'tiles.openfreemap.org': 'map tiles of the BlokVolt map embed',
    'cdn.jsdelivr.net': 'loaded at runtime by a third-party embed',
    'smcsmkkzdksocvroqekl.supabase.co': 'Evolako public content store (exchange rate for evo-fx)',
}
TEXT_MIN, TEXT_MAX = 0.5, 1.5          # dist innerText vs snapshot static text: outside = broken render
REF_TOLERANCE = 0.02                    # dist innerText vs reference innerText
TYPES = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript',
         '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
         '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
         '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.woff': 'font/woff', '.pdf': 'application/pdf'}


# ------------------------------------------------------------------------------------------------ local servers
def make_handler(root, pages_mode):
    """pages_mode=True: Cloudflare Pages rules on dist. False: the snapshot pages at the same URLs (reference)."""
    root = os.path.realpath(root)

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_HEAD(self):
            self.serve(False)

        def do_GET(self):
            self.serve(True)

        def send(self, code, data, ctype, extra=None, body=True):
            self.send_response(code)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if body:
                self.wfile.write(data)

        def file(self, rel):
            p = os.path.realpath(os.path.join(root, rel.lstrip('/')))
            if not p.startswith(root + os.sep) or not os.path.isfile(p):
                return None
            with open(p, 'rb') as f:
                return f.read(), TYPES.get(os.path.splitext(p)[1].lower()) or (
                    mimetypes.guess_type(p)[0] or 'application/octet-stream')

        def serve(self, body):
            u = urllib.parse.urlsplit(self.path)
            path, q = urllib.parse.unquote(u.path), ('?' + u.query if u.query else '')
            if pages_mode:
                if path != '/' and path.endswith('/') and self.file(path.rstrip('/') + '.html'):
                    return self.send(308, b'', 'text/plain', {'Location': path.rstrip('/') + q}, body)
                if path.endswith('.html') and self.file(path):
                    target = path[:-5] if path != '/index.html' else '/'
                    return self.send(308, b'', 'text/plain', {'Location': (target or '/') + q}, body)
                hit = self.file('index.html') if path == '/' else (self.file(path) or self.file(path + '.html'))
                miss = self.file('404.html')
            else:
                slug = path.strip('/') or 'index'
                hit = self.file('pages/%s.html' % slug) if re.fullmatch(r'[a-z0-9-]+', slug) else None
                miss = self.file('pages/404.html')
            if hit:
                return self.send(200, hit[0], hit[1], body=body)
            return self.send(404, miss[0] if miss else b'not found', 'text/html; charset=utf-8', body=body)
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


def load_reference_assets(snapshot):
    """Original asset URL -> (bytes, content type), from snapshot/assets plus snapshot-fill (sha256-checked by build)."""
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
    return out, m


SCROLL_JS = """async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const H = () => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight);
  let y = 0;
  for (let i = 0; i < 80 && y < H(); i++) { y += Math.round(innerHeight * 0.8); window.scrollTo(0, y); await wait(110); }
  window.scrollTo(0, 0); await wait(500);
  try { await document.fonts.ready; } catch (e) {}
}"""

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
    changed = diff.point(lambda v: 255 if v > 40 else 0).histogram()[255]
    return {'changed_pct': round(100.0 * changed / (w * h), 3), 'height_dist': a.height, 'height_ref': b.height}


# ------------------------------------------------------------------------------------------------ one page load
def load(browser, url, viewport, shot, local_port, answers=None, scroll=True):
    """answers: original URL key -> (bytes, type) served instead of the network. For dist these are only the files
    on the expected live hosts (app.evolako.rs/embed/evo-fx-*.js, same bytes as the app serves); for the reference
    every file of the snapshot. Requests to other hosts are blocked. Every external request is recorded."""
    w, h = viewport
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=w < 800,
                              has_touch=w < 800, locale='sr-RS', service_workers='block')
    rec = {'external': [], 'local_failed': [], 'console': [], 'page_errors': [], 'fulfilled_from_snapshot': 0}

    def route(r):
        req = r.request
        u = urllib.parse.urlsplit(req.url)
        if u.scheme in ('data', 'blob') or (u.hostname == '127.0.0.1' and u.port == local_port):
            return r.continue_()
        host = (u.hostname or '').lower()
        hit = (answers or {}).get(url_key(req.url))
        if host in EXPECTED_HOSTS or not hit:
            rec['external'].append({'host': host, 'url': req.url, 'type': req.resource_type,
                                    'answered_from_snapshot': bool(hit)})
        if hit:
            rec['fulfilled_from_snapshot'] += 1
            return r.fulfill(status=200, body=hit[0], headers={'content-type': hit[1],
                                                               'access-control-allow-origin': '*'})
        return r.abort('blockedbyclient')

    ctx.route('**/*', route)
    page = ctx.new_page()
    page.on('console', lambda m: rec['console'].append({'type': m.type, 'text': m.text[:300],
                                                        'url': (m.location or {}).get('url', '')})
            if m.type in ('error', 'warning') else None)
    page.on('pageerror', lambda e: rec['page_errors'].append(str(e)[:300]))

    def on_resp(resp):
        u = urllib.parse.urlsplit(resp.url)
        if u.hostname == '127.0.0.1' and resp.status >= 400 and resp.url.rstrip('/') != url.rstrip('/'):
            rec['local_failed'].append({'url': resp.url, 'status': resp.status})
    page.on('response', on_resp)
    page.on('requestfailed', lambda req: rec['local_failed'].append({'url': req.url, 'status': req.failure})
            if urllib.parse.urlsplit(req.url).hostname == '127.0.0.1' else None)
    t0 = time.time()
    try:
        resp = page.goto(url, wait_until='load', timeout=60000)
        rec['status'] = resp.status if resp else None
        try:
            page.wait_for_load_state('networkidle', timeout=8000)
        except Exception:  # noqa: BLE001 — a page that keeps polling is still measured
            pass
        if scroll:
            page.evaluate(SCROLL_JS)
        rec['text_len'] = page.evaluate("() => (document.body ? document.body.innerText : '').replace(/\\s+/g, ' ')"
                                        ".trim().length")
        rec['title'] = page.title()
        rec['html_lang'] = page.evaluate('() => document.documentElement.lang')
        rec['forms'] = page.evaluate(FORMS_JS)
        rec['links'] = page.evaluate(LINKS_JS)
        if shot:
            page.screenshot(path=shot, full_page=True, animations='disabled', timeout=90000)
    except Exception as e:  # noqa: BLE001
        rec['page_errors'].append('QA load failed: %s' % str(e)[:300])
    rec['seconds'] = round(time.time() - t0, 1)
    ctx.close()
    # console errors that only report a request this QA blocked are environment noise, not page errors; neither is
    # the 404 status of the 404 page itself
    blocked = {x['url'] for x in rec['external'] if not x['answered_from_snapshot']}
    for c in rec['console']:
        c['blocked_request'] = c['url'] in blocked or 'ERR_BLOCKED_BY_CLIENT' in c['text'] or (
            rec.get('status') == 404 and c['url'] == url and 'status of 404' in c['text'])
    return rec


# ------------------------------------------------------------------------------------------------ main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dist', default=os.path.join(SITE_DIR, 'dist'))
    ap.add_argument('--snapshot', default=os.path.join(SITE_DIR, 'snapshot'))
    ap.add_argument('--shots', required=True, help='screenshot folder, outside the repository')
    ap.add_argument('--pages', default='', help='comma-separated slugs (default: all)')
    ap.add_argument('--langs', default='', help='extra languages to open with ?lang= (e.g. en,ru)')
    ap.add_argument('--no-reference', action='store_true', help='skip the replay of the original Webflow pages')
    ap.add_argument('--allow-host', action='append', default=[], help='extra external host that is not an issue')
    ap.add_argument('--json', help='write the full result here')
    args = ap.parse_args()

    dist, snapshot, shots = (os.path.realpath(x) for x in (args.dist, args.snapshot, args.shots))
    if shots == REPO or shots.startswith(REPO + os.sep):
        sys.exit('--shots must be outside the repository (%s)' % REPO)
    os.makedirs(shots, exist_ok=True)
    allowed = EXPECTED_HOSTS | set(args.allow_host)
    slugs = sorted(f[:-5] for f in os.listdir(dist) if f.endswith('.html') and f != '404.html')
    if args.pages:
        want = set(args.pages.split(','))
        slugs = [s for s in slugs if s in want]
    srv, port = start_server(dist, True)
    ref_srv, ref_port = start_server(snapshot, False)
    snap_assets = load_reference_assets(snapshot)[0]
    live_answers = {k: v for k, v in snap_assets.items() if k.split('/', 1)[0] in EXPECTED_HOSTS}
    ref_assets = None if args.no_reference else snap_assets
    results, lang_results = [], []

    with sync_playwright() as p:
        browser = p.chromium.launch()
        targets = [(s, '/' if s == 'index' else '/' + s) for s in slugs] + [('404', '/ova-stranica-ne-postoji-qa')]
        for slug, path in targets:
            for vp in VIEWPORTS:
                tag = '%s__%d' % (slug, vp[0])
                r = load(browser, 'http://127.0.0.1:%d%s' % (port, path), vp,
                         os.path.join(shots, tag + '.png'), port, live_answers)
                r.update({'page': slug, 'path': path, 'viewport': '%dx%d' % vp})
                snap_page = os.path.join(snapshot, 'pages', slug + '.html')
                if slug != '404':
                    r['text_static_snapshot'] = static_text_len(snap_page)
                    r['text_ratio_static'] = round(r.get('text_len', 0) / max(1, r['text_static_snapshot']), 3)
                    if ref_assets is not None:
                        ref = load(browser, 'http://127.0.0.1:%d%s' % (ref_port, path), vp,
                                   os.path.join(shots, tag + '__reference.png'), ref_port, ref_assets)
                        r['reference'] = {k: ref.get(k) for k in ('status', 'text_len', 'page_errors', 'seconds',
                                                                   'fulfilled_from_snapshot', 'title', 'forms')}
                        r['reference']['console_errors'] = [c for c in ref['console'] if c['type'] == 'error'
                                                            and not c['blocked_request']]
                        r['reference']['external_hosts'] = sorted({x['host'] for x in ref['external']})
                        r['text_ratio_reference'] = round(r.get('text_len', 0) / max(1, ref.get('text_len') or 1), 3)
                        r['pixels'] = pixel_diff(os.path.join(shots, tag + '.png'),
                                                 os.path.join(shots, tag + '__reference.png'))
                evaluate(r, allowed, dist)
                results.append(r)
                print(summary_line(r), flush=True)
        for lang in [x for x in args.langs.split(',') if x and x != 'sr']:
            for slug, path in targets[:-1]:
                r = load(browser, 'http://127.0.0.1:%d%s?lang=%s' % (port, path, lang), VIEWPORTS[0], None, port,
                         live_answers, scroll=False)
                lang_results.append({'page': slug, 'lang': lang, 'html_lang': r.get('html_lang'),
                                     'external': r['external'], 'page_errors': r['page_errors'],
                                     'console_errors': [c for c in r['console'] if c['type'] == 'error'
                                                        and not c['blocked_request']]})
                print('lang %s /%s: html lang=%s, %d external requests' % (
                    lang, slug if slug != 'index' else '', r.get('html_lang'), len(r['external'])), flush=True)
        browser.close()
    srv.shutdown()
    ref_srv.shutdown()

    report = summarize(results, lang_results, allowed)
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump({'pages': results, 'langs': lang_results, 'summary': report}, f, ensure_ascii=False, indent=1,
                      sort_keys=True)
    print_summary(report)
    # 1 = a page has an issue; 2 = no issues, but pages request hosts other than the expected ones; 0 = clean
    sys.exit(1 if report['pages_with_issues'] else 2 if report['pages_with_other_external'] else 0)


def evaluate(r, allowed, dist):
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
    r['external_other'] = sorted({x['host'] for x in r['external']} - allowed)
    r['notes'] = []
    if r['page'] != '404':
        low = not TEXT_MIN <= r.get('text_ratio_static', 0) <= TEXT_MAX
        if 'text_ratio_reference' in r:
            # the reference render is the real test; a page that hides most of its text (collapsed FAQ answers, the
            # quiz screens after the first) is far below the static text in both renders
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
    r['console_errors'] = errs
    r['issues'] = issues


def summary_line(r):
    px = r.get('pixels') or {}
    return '%-48s %-8s %s text %5s/%-5s ref %-6s px %-7s ext %-2d %s%s' % (
        r['page'], r['viewport'], r.get('status'), r.get('text_len'), r.get('text_static_snapshot', '-'),
        r.get('text_ratio_reference', '-'), px.get('changed_pct', '-'), len(r['external']),
        'OK' if not r['issues'] else 'ISSUES: ' + '; '.join(r['issues']),
        (' | external: ' + ', '.join(r['external_other']) if r['external_other'] else '') +
        (' | note: ' + '; '.join(r['notes']) if r['notes'] else ''))


def summarize(results, lang_results, allowed):
    ext = {}
    for r in results:
        for x in r['external']:
            e = ext.setdefault(x['host'], {'urls': {}, 'pages': set(), 'types': set()})
            e['urls'].setdefault(x['url'], set()).add(r['page'])
            e['pages'].add(r['page'])
            e['types'].add(x['type'])
    lang_ext = {}
    for r in lang_results:
        for x in r['external']:
            lang_ext.setdefault(x['host'], {}).setdefault(x['url'], set()).add('%s:%s' % (r['lang'], r['page']))
    return {
        'loads': len(results),
        'pages_with_issues': sorted({r['page'] for r in results if r['issues']}),
        'pages_with_other_external': sorted({r['page'] for r in results if r['external_other']}),
        'issues': {'%s %s' % (r['page'], r['viewport']): r['issues'] for r in results if r['issues']},
        'external': {h: {'pages': len(v['pages']), 'expected': h in allowed, 'what': KNOWN_HOSTS.get(h, ''),
                         'types': sorted(v['types']),
                         'urls': {u: sorted(p) for u, p in sorted(v['urls'].items())}} for h, v in sorted(ext.items())},
        'external_lang': {h: {u: sorted(p) for u, p in sorted(v.items())} for h, v in sorted(lang_ext.items())},
        'console_errors_dist': sorted({c['text'] for r in results for c in r['console_errors']}),
        'console_errors_reference': sorted({c['text'] for r in results
                                            for c in (r.get('reference') or {}).get('console_errors', [])}),
        'page_errors_dist': sorted({e for r in results for e in r['page_errors']}),
        'page_errors_reference': sorted({e for r in results for e in (r.get('reference') or {}).get('page_errors')
                                         or []}),
        'lang_page_errors': sorted({e for r in lang_results for e in r['page_errors']}),
        'max_pixel_diff': max(((r.get('pixels') or {}).get('changed_pct', 0), r['page'], r['viewport'])
                              for r in results) if results else None,
    }


def print_summary(s):
    print('\n%d page loads; pages with issues: %s' % (s['loads'], ', '.join(s['pages_with_issues']) or 'none'))
    for k, v in s['issues'].items():
        print('  %s: %s' % (k, '; '.join(v)))
    print('pages requesting hosts other than %s: %d' % (', '.join(sorted(EXPECTED_HOSTS)),
                                                        len(s['pages_with_other_external'])))
    print('external requests:')
    for h, v in s['external'].items():
        print('  %s%s — %d pages, %s%s' % (h, ' [expected]' if v['expected'] else '', v['pages'],
                                           '/'.join(v['types']), ' — ' + v['what'] if v['what'] else ''))
        for u, pages in list(v['urls'].items())[:8]:
            print('      %s (%d pages)' % (u[:150], len(pages)))
    if s['external_lang']:
        print('external requests with ?lang=:')
        for h, v in s['external_lang'].items():
            print('  %s — %d distinct URLs' % (h, len(v)))
    for k in ('console_errors_dist', 'console_errors_reference', 'page_errors_dist', 'page_errors_reference',
              'lang_page_errors'):
        print('%s (%d)%s' % (k, len(s[k]), ''.join('\n   ' + x[:200] for x in s[k][:12])))
    print('largest pixel difference vs reference: %s' % (s['max_pixel_diff'],))


if __name__ == '__main__':
    main()

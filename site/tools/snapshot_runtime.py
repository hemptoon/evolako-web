#!/usr/bin/env python3
"""Runtime capture for the snapshot of www.evolako.rs (step 2b of moving the site off Webflow).

tools/snapshot.py copies every file the published HTML and CSS name. The pages also load files that no HTML names:
scripts whose URLs are built in the browser (the EN/RU dictionaries of the i18n engine and of its loader, the
cookie-consent pack, the i18n fixes) and whatever those load. This pass, run by the workflow right after the static
crawl, opens every page of the snapshot (sitemap pages + the 404) in headless Chromium in the four language modes —
Serbian (default, no parameter), ?lang=en, ?lang=ru, ?lang=sr-cyrl — at 1440x900 and 390x844, each load in a fresh
browser context (no language remembered from an earlier load). Per load: wait until the network is quiet, scroll
through the page, load every lazy image, wait again. Every request is recorded; the responses are saved into the
snapshot layout of snapshot.py (assets/<host>/<decoded path>[__<query hash>]) with manifest entries
  "runtime": true, "modes": [...], "viewports": [...], "pages": [...], "initiators": [...]
and files that stay on live services (app.evolako.rs embed, the BlokVolt map embed with its library, data and tiles,
the public exchange-rate file of evo-fx) are marked "live": true — the build never copies those, QA uses them to replay
the pages offline. Then the references the browser did not request are completed: url()/@import of runtime CSS
(all font subsets, not only those a page needed), absolute file URLs inside copied scripts, and file links in the
final DOM of every mode (e.g. a PDF link swapped by a dictionary).

Nothing is sent and nothing is counted:
  * every request that is not a GET is aborted (forms, the visit counter app.evolako.rs/s/p, Turnstile, beacons);
  * GETs are aborted for Cloudflare Web Analytics, Turnstile, any webflow.com endpoint (except the asset host
    uploads-ssl.webflow.com), Google/Meta/LinkedIn/... analytics, app.evolako.rs outside /embed/, and every other host
    unless the request is a stylesheet, image, font or media file (snapshot.py copies those from any host too);
  * no form is filled or submitted, the cookie banner is never answered (no "Dozvoli"), nothing is clicked.
The counter script also stays silent on its own: it skips browsers with navigator.webdriver set.

The capture reads and rewrites site/snapshot/manifest.json (it adds entries and a "runtime" summary). Usage, on the
runner (the only machine that reaches the live site):
  python3 site/tools/snapshot_runtime.py [--base https://www.evolako.rs] [--snapshot site/snapshot] [--workers 6]
For a local dry run without network, --replay answers every request from an existing snapshot instead of the network
(--base then points at a local server of snapshot/pages, e.g. the reference server of qa_dist.py).
"""
import argparse
import asyncio
import hashlib
import json
import os
import re
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from snapshot import ASSET_HOSTS, CHROME_UA, CSS_IMPORT, CSS_URL, FILE_RE, URL_IN_TEXT, fetch, local_path  # noqa: E402

from playwright.async_api import async_playwright  # noqa: E402

MODES = ['sr', 'en', 'ru', 'sr-cyrl']          # 'sr' = no parameter (the default the engine falls back to)
VIEWPORTS = [(1440, 900), (390, 844)]
PROBE_404 = '/__snapshot-404-probe'
# Files the build copies (self-hosts) when a page loads them; any host also counts for stylesheets/images/fonts/media
COPY_HOSTS = (ASSET_HOSTS - {'app.evolako.rs', 'www.evolako.rs', 'evolako.rs'}) | {
    'd8j0ntlcm91z4.cloudfront.net', 'app-assets.website-files.com'}
ANY_HOST_TYPES = {'stylesheet', 'image', 'font', 'media'}
# Live services the built site keeps using: saved only so that QA can replay the pages offline ("live": true)
LIVE_RULES = [
    ('app.evolako.rs', '/embed/'),                                   # evo-fx currency switch
    ('smcsmkkzdksocvroqekl.supabase.co', '/storage/v1/object/public/'),  # its public exchange-rate file
    ('www.blokvolt.rs', '/'), ('blokvolt.rs', '/'),                  # map embed on /mapa-punjaca and its data
    ('tiles.openfreemap.org', '/'),                                  # map style, tiles, glyphs, sprites
]
# Never requested during the capture (counted or sent something, or not needed to render)
ABORT_HOST_SUFFIXES = (
    'cloudflareinsights.com', 'challenges.cloudflare.com', 'google-analytics.com', 'googletagmanager.com',
    'analytics.google.com', 'doubleclick.net', 'googleadservices.com', 'googlesyndication.com', 'facebook.com',
    'facebook.net', 'linkedin.com', 'licdn.com', 'hotjar.com', 'clarity.ms', 'tiktok.com', 'posthog.com',
    'sentry.io', 'segment.io', 'mixpanel.com', 'plausible.io', 'yandex.ru', 'mc.yandex.com',
)
OWN = {'www.evolako.rs', 'evolako.rs'}

SCROLL_JS = """async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const H = () => Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement.scrollHeight);
  let y = 0;
  for (let i = 0; i < 90 && y < H(); i++) { y += Math.round(innerHeight * 0.8); window.scrollTo(0, y); await wait(120); }
  window.scrollTo(0, 0); await wait(300);
  document.querySelectorAll('img[loading="lazy"], iframe[loading="lazy"]').forEach(e => { e.loading = 'eager'; });
  try { await document.fonts.ready; } catch (e) {}
}"""
DOM_REFS_JS = """() => {
  const out = new Set();
  document.querySelectorAll('[href],[src],[srcset],[data-src],[poster]').forEach(e => {
    ['href', 'src', 'data-src', 'poster'].forEach(a => { const v = e.getAttribute(a); if (v) out.add(v); });
    const s = e.getAttribute('srcset'); if (s) s.split(',').forEach(p => { const u = p.trim().split(/\\s+/)[0]; if (u) out.add(u); });
  });
  return {refs: Array.from(out).map(u => { try { return new URL(u, location.href).href; } catch (e) { return ''; } }),
          lang: document.documentElement.lang, title: document.title};
}"""


def url_key(u):
    p = urllib.parse.urlsplit(u)
    return p.netloc.lower() + urllib.parse.unquote(p.path) + ('?' + p.query if p.query else '')


def sha256(b):
    return hashlib.sha256(b).hexdigest()


def classify(method, host, path, rtype):
    """'copy' | 'live' | 'own' | 'abort:<why>' for one request."""
    if method != 'GET':
        return 'abort:not a GET'
    if any(host == s or host.endswith('.' + s) for s in ABORT_HOST_SUFFIXES):
        return 'abort:analytics/beacon/challenge host'
    if (host == 'webflow.com' or host.endswith('.webflow.com')) and host != 'uploads-ssl.webflow.com':
        return 'abort:webflow.com endpoint'
    if host in OWN:
        return 'own'
    for h, prefix in LIVE_RULES:
        if host == h:
            return 'live' if path.startswith(prefix) else 'abort:live service outside the embed paths'
    if host in COPY_HOSTS:
        return 'copy'
    if rtype in ANY_HOST_TYPES:
        return 'copy'
    return 'abort:other host'


class State:
    def __init__(self, snapshot, manifest):
        self.snapshot = snapshot
        self.manifest = manifest
        self.static = {}                       # url_key -> static manifest entry
        for e in manifest['assets']:
            self.static[url_key(e['url'])] = e
        self.files = {e['file'] for e in manifest['assets'] if e.get('file')}
        self.new = {}                          # url_key -> runtime entry
        self.requests = {}                     # url -> {'decision', 'types', 'jobs', 'status'}
        self.initiators = {}                   # url -> set of initiator URLs (CDP)
        self.dom_refs = {}                     # url -> set of (page, mode) whose final DOM references it
        self.mismatch = []                     # static files whose runtime bytes differ
        self.errors = []
        self.langs = {}                        # mode -> set of html lang values seen
        self.loads = 0

    def note_request(self, url, method, rtype, decision, job):
        r = self.requests.setdefault(url, {'decision': decision, 'method': method, 'types': set(), 'jobs': set(),
                                           'status': set()})
        r['types'].add(rtype)
        r['jobs'].add(job)

    def add(self, url, body, ctype, kind, page=None, mode=None, viewport=None, rtype=None, initiators=()):
        """Save one response (or a completion fetch) into the snapshot. Returns the entry."""
        key = url_key(url)
        digest = sha256(body)
        st = self.static.get(key)
        if st is not None:
            rs = st.setdefault('runtime_seen', {'modes': [], 'viewports': []})
            if mode and mode not in rs['modes']:
                rs['modes'].append(mode)
            if viewport and viewport not in rs['viewports']:
                rs['viewports'].append(viewport)
            if st.get('sha256') != digest and url not in {m['url'] for m in self.mismatch}:
                self.mismatch.append({'url': url, 'static_sha256': st.get('sha256'), 'runtime_sha256': digest})
            return st
        e = self.new.get(key)
        if e is None:
            rel = local_path(url)
            if rel in self.files:                   # same local path, other URL spelling: keep both apart
                stem, dot, ext = rel.rpartition('.')
                rel = '%s__rt%s.%s' % (stem, digest[:8], ext) if dot and '/' not in ext else rel + '__rt' + digest[:8]
            full = os.path.join(self.snapshot, rel)
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, 'wb') as f:
                f.write(body)
            self.files.add(rel)
            e = {'url': url, 'file': rel, 'status': 200, 'bytes': len(body), 'type': (ctype or '').split(';')[0].strip(),
                 'sha256': digest, 'kinds': [], 'pages': [], 'page_count': 0, 'runtime': True, 'modes': [],
                 'viewports': [], 'initiators': []}
            if kind == 'live':
                e['live'] = True
            self.new[key] = e
        elif e['sha256'] != digest:
            e['varies'] = True                      # e.g. a data file that changed between two loads: first copy kept
        if rtype and rtype not in e['kinds']:
            e['kinds'].append(rtype)
        if page is not None and page not in e['pages']:
            e['pages'].append(page)
        if mode and mode not in e['modes']:
            e['modes'].append(mode)
        if viewport and viewport not in e['viewports']:
            e['viewports'].append(viewport)
        for i in initiators:
            if i and i not in e['initiators'] and len(e['initiators']) < 12:
                e['initiators'].append(i)
        return e

    def known(self, url):
        k = url_key(url)
        return k in self.static or k in self.new


def initiator_urls(init):
    """URLs of the script/stylesheet/document that started a request (CDP Network.Initiator)."""
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


async def load_one(browser, args, state, job, replay):
    path, mode, vp = job
    w, h = vp
    page_url = args.base + path + ('' if mode == 'sr' else ('?lang=' + mode))
    vps = '%dx%d' % vp
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, is_mobile=w < 800,
                                    has_touch=w < 800, locale='sr-RS', user_agent=CHROME_UA,
                                    service_workers='block')
    pending = []
    decided = {}
    fetching = [0]                                   # live-service fetches still running in route handlers

    async def route(r):
        try:
            await route_inner(r)
        except Exception as e:  # noqa: BLE001 — never leave a request hanging
            state.errors.append({'url': r.request.url[:200], 'error': 'route: %s' % str(e)[:160], 'page': path,
                                 'mode': mode})
            try:
                await r.abort('failed')
            except Exception:  # noqa: BLE001
                pass

    async def route_inner(r):
        req = r.request
        u = urllib.parse.urlsplit(req.url)
        host = (u.hostname or '').lower()
        if replay is not None and u.hostname == '127.0.0.1':
            decided[req.url] = 'own'
            return await r.continue_()
        d = classify(req.method, host, u.path, req.resource_type)
        decided[req.url] = d
        state.note_request(req.url, req.method, req.resource_type, d, (path, mode, vps))
        if d.startswith('abort'):
            return await r.abort('blockedbyclient')
        if replay is not None:                       # offline dry run: answer from the given snapshot
            hit = replay.get(url_key(req.url))
            if hit:
                if d == 'live':
                    state.add(req.url, hit[0], hit[1], 'live', page=path, mode=mode, viewport=vps,
                              rtype=req.resource_type, initiators=sorted(state.initiators.get(req.url, ())))
                return await r.fulfill(status=200, body=hit[0], headers={'content-type': hit[1],
                                                                         'access-control-allow-origin': '*'})
            return await r.fulfill(status=404, body=b'not in the replay snapshot')
        if d == 'live':
            # live services are fetched here and saved from the route: requests of web workers (the map tiles the
            # MapLibre worker loads) never reach page.on('response')
            fetching[0] += 1
            try:
                resp = await r.fetch()
                body = await resp.body()
            except Exception as e:  # noqa: BLE001
                state.errors.append({'url': req.url, 'error': 'fetch: %s' % str(e)[:120], 'page': path, 'mode': mode})
                return await r.abort('failed')
            finally:
                fetching[0] -= 1
            rec = state.requests.get(req.url)
            if rec is not None:
                rec['status'].add(resp.status)
            if resp.status == 200:
                state.add(req.url, body, resp.headers.get('content-type', ''), 'live', page=path, mode=mode,
                          viewport=vps, rtype=req.resource_type,
                          initiators=sorted(state.initiators.get(req.url, ())))
            return await r.fulfill(response=resp, body=body)
        return await r.continue_()

    async def save(resp):
        req = resp.request
        d = decided.get(req.url, '')
        rec = state.requests.get(req.url)
        if rec is not None:
            rec['status'].add(resp.status)
        if d not in ('copy', 'own') or req.method != 'GET' or resp.status != 200:
            return                                   # live services are saved by the route handler
        if d == 'own' and (req.resource_type == 'document' or not FILE_RE.search(urllib.parse.urlsplit(req.url).path)):
            return
        try:
            body = await resp.body()
        except Exception as e:  # noqa: BLE001 — redirects and discarded bodies have no body
            state.errors.append({'url': req.url, 'error': 'body: %s' % str(e)[:120], 'page': path, 'mode': mode})
            return
        state.add(req.url, body, resp.headers.get('content-type', ''), 'live' if d == 'live' else 'copy',
                  page=path, mode=mode, viewport=vps, rtype=req.resource_type,
                  initiators=sorted(state.initiators.get(req.url, ())))

    await ctx.route('**/*', route)
    page = await ctx.new_page()
    inflight = set()
    page.on('request', lambda r: inflight.add(r))
    page.on('requestfinished', lambda r: inflight.discard(r))
    page.on('requestfailed', lambda r: inflight.discard(r))

    async def quiet(max_s=15.0, idle_s=0.8):
        """Until no request of this page has been open for idle_s (networkidle fires only once per navigation,
        so it does not cover what scrolling starts)."""
        end, since = time.time() + max_s, None
        while time.time() < end:
            if inflight:
                since = None
            elif since is None:
                since = time.time()
            elif time.time() - since >= idle_s:
                return True
            await asyncio.sleep(0.1)
        return False

    cdp = await ctx.new_cdp_session(page)
    await cdp.send('Network.enable')

    def on_will_send(p):
        u = p.get('request', {}).get('url', '')
        if u and not u.startswith(('data:', 'blob:')):
            s = state.initiators.setdefault(u, set())
            for i in initiator_urls(p.get('initiator')):
                if not i.startswith('blob:'):
                    s.add(i.split('#')[0] if not i.startswith(args.base) else
                          args.base + urllib.parse.urlsplit(i).path)   # page URLs without ?lang=
    cdp.on('Network.requestWillBeSent', on_will_send)
    page.on('response', lambda resp: pending.append(asyncio.ensure_future(save(resp))))

    def on_failed(req):
        d = decided.get(req.url, '')
        if d in ('copy', 'live', 'own'):
            rec = state.requests.get(req.url)
            if rec is not None:
                rec['status'].add('failed: %s' % (req.failure or '')[:60])
    page.on('requestfailed', on_failed)
    try:
        await page.goto(page_url, wait_until='load', timeout=90000)
        await quiet()                                # a page that keeps a connection open is still captured
        await page.evaluate(SCROLL_JS)
        await quiet()
        info = await page.evaluate(DOM_REFS_JS)
        state.langs.setdefault(mode, set()).add(info.get('lang') or '')
        for ref in info.get('refs') or []:
            if ref.startswith('http'):
                state.dom_refs.setdefault(ref.split('#')[0], set()).add((path, mode))
    except Exception as e:  # noqa: BLE001
        state.errors.append({'url': page_url, 'error': 'load: %s' % str(e)[:200], 'page': path, 'mode': mode,
                             'viewport': vps})
    for _ in range(100):                             # let running fetches of the route handlers finish (10 s max)
        if not fetching[0]:
            break
        await asyncio.sleep(0.1)
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    try:
        await ctx.unroute_all(behavior='ignoreErrors')
        await ctx.close()
    except Exception as e:  # noqa: BLE001 — a context that cannot close cleanly must not stop the capture
        state.errors.append({'url': page_url, 'error': 'close: %s' % str(e)[:160], 'page': path, 'mode': mode})
    state.loads += 1


def complete(state, args, replay):
    """Fetch what the browser did not request: CSS references of runtime CSS, absolute file URLs inside copied
    scripts, file links in the final DOM. Several rounds, until nothing new turns up."""
    def get(u):
        if replay is not None:
            hit = replay.get(url_key(u))
            return (200, hit[1], hit[0]) if hit else (404, '', b'')
        st, ct, body, _ = fetch(u)
        return st, ct, body

    def wanted(u, kind):
        p = urllib.parse.urlsplit(u)
        host = (p.hostname or '').lower()
        if p.scheme not in ('http', 'https') or not p.path.strip('/') or state.known(u):
            return False
        if kind == 'css':          # CSS references: any host, like snapshot.py
            return classify('GET', host, p.path, 'stylesheet').startswith(('copy', 'live'))
        return host in COPY_HOSTS and bool(FILE_RE.search(p.path))

    todo = {}
    for u, where in state.dom_refs.items():
        if wanted(u, 'dom'):
            todo.setdefault(u, ('dom-ref', sorted({w[0] for w in where}), sorted({w[1] for w in where}), []))
    fetched, failed = 0, []
    for _ in range(4):
        for e in list(state.new.values()) + [e for e in state.manifest['assets'] if e.get('file')]:
            full = os.path.join(state.snapshot, e['file'])
            is_css = 'css' in (e.get('type') or '') or e['file'].endswith('.css')
            is_js = 'javascript' in (e.get('type') or '') or e['file'].endswith('.js')
            if not (is_css or is_js) or e.get('live'):
                continue
            try:
                with open(full, encoding='utf-8') as f:
                    text = f.read()
            except (OSError, UnicodeDecodeError):
                continue
            refs = []
            if is_css and e.get('runtime'):
                for m in list(CSS_URL.finditer(text)) + list(CSS_IMPORT.finditer(text)):
                    ref = (m.group(2) if m.re is CSS_URL else m.group(1)).strip()
                    if not ref.startswith('data:'):
                        refs.append((urllib.parse.urljoin(e['url'], ref).split('#')[0], 'css'))
            if is_js:
                refs += [(m.group(0), 'js') for m in URL_IN_TEXT.finditer(text)]
            for u, kind in refs:
                if wanted(u, kind):
                    todo.setdefault(u, ('css-ref' if kind == 'css' else 'js-ref', list(e.get('pages') or []),
                                        list(e.get('modes') or []), [e['url']]))
        if not todo:
            break
        batch, todo = todo, {}
        for u, (kind, pages, modes, inits) in sorted(batch.items()):
            st, ct, body = get(u)
            if st != 200:
                failed.append({'url': u, 'status': st, 'from': kind})
                continue
            host = (urllib.parse.urlsplit(u).hostname or '').lower()
            live = classify('GET', host, urllib.parse.urlsplit(u).path, 'other') == 'live'
            e = state.add(u, body, ct, 'live' if live else 'copy', rtype=kind, initiators=inits)
            for p in pages:
                if p not in e['pages']:
                    e['pages'].append(p)
            for m in modes:
                if m not in e.get('modes', []):
                    e.setdefault('modes', []).append(m)
            fetched += 1
    return fetched, failed


async def run(args):
    with open(os.path.join(args.snapshot, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    paths = sorted(p['path'] for p in manifest['pages'] if p['path'] != '404') + [PROBE_404]
    if args.pages:
        want = set(args.pages.split(','))
        paths = [p for p in paths if (p.strip('/') or 'index') in want or p in want]
    replay = None
    if args.replay:
        replay = load_replay(args.replay)
    state = State(args.snapshot, manifest)
    jobs = [(p, m, vp) for p in paths for m in MODES for vp in VIEWPORTS]
    t0 = time.time()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        version = browser.version
        sem = asyncio.Semaphore(args.workers)

        async def one(job):
            async with sem:
                await load_one(browser, args, state, job, replay)
                if state.loads % 24 == 0:
                    print('  %d/%d loads, %d new files, %.0fs' % (state.loads, len(jobs), len(state.new),
                                                                  time.time() - t0), flush=True)
        await asyncio.gather(*(one(j) for j in jobs))
        await browser.close()
    fetched, failed = complete(state, args, replay)
    write_manifest(state, manifest, args, jobs, version, fetched, failed, time.time() - t0)


def load_replay(snapshot):
    with open(os.path.join(snapshot, 'manifest.json'), encoding='utf-8') as f:
        m = json.load(f)
    out = {}
    for a in m['assets']:
        if a.get('file') and os.path.isfile(os.path.join(snapshot, a['file'])):
            with open(os.path.join(snapshot, a['file']), 'rb') as f:
                out[url_key(a['url'])] = (f.read(), a.get('type') or 'application/octet-stream')
    return out


def write_manifest(state, manifest, args, jobs, version, fetched, failed, seconds):
    by_host, aborted, external = {}, {}, {}
    for url, r in state.requests.items():
        host = urllib.parse.urlsplit(url).netloc
        if r['decision'].startswith('abort'):
            a = aborted.setdefault(host, {'requests': 0, 'why': set(), 'examples': []})
            a['requests'] += len(r['jobs'])
            a['why'].add(r['decision'][6:])
            if len(a['examples']) < 4:
                a['examples'].append('%s %s' % (r['method'], url[:160]))
        else:
            by_host[host] = by_host.get(host, 0) + 1
        if r['decision'] in ('copy', 'live') and r['status'] and 200 not in r['status']:
            external.setdefault('not_200', []).append({'url': url[:200], 'status': sorted(map(str, r['status'])),
                                                        'types': sorted(r['types'])})
    new = sorted(state.new.values(), key=lambda e: e['url'])
    for e in new:
        e['pages'] = sorted(e['pages'])[:60]
        e['page_count'] = len(e['pages'])
        e['modes'] = [m for m in MODES if m in e['modes']]
        e['viewports'] = sorted(e['viewports'])
        e['kinds'] = sorted(e['kinds'])
    for e in manifest['assets']:
        rs = e.get('runtime_seen')
        if rs:
            rs['modes'] = [m for m in MODES if m in rs['modes']]
            rs['viewports'] = sorted(rs['viewports'])
    manifest['assets'] = sorted(manifest['assets'] + new, key=lambda e: e['url'])
    live = [e for e in new if e.get('live')]
    manifest['runtime'] = {
        'taken': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'tool': 'site/tools/snapshot_runtime.py', 'browser': 'chromium ' + version, 'user_agent': CHROME_UA,
        'modes': MODES, 'viewports': ['%dx%d' % v for v in VIEWPORTS], 'pages': len({j[0] for j in jobs}),
        'loads': state.loads, 'seconds': round(seconds),
        'saved': len(new) - len(live), 'saved_bytes': sum(e['bytes'] for e in new if not e.get('live')),
        'saved_live': len(live), 'saved_live_bytes': sum(e['bytes'] for e in live),
        'completed_by_reference': fetched, 'completion_failed': failed[:50],
        'html_lang_by_mode': {m: sorted(v) for m, v in sorted(state.langs.items())},
        'requests_by_host': dict(sorted(by_host.items())),
        'aborted': {h: {'requests': v['requests'], 'why': sorted(v['why']), 'examples': v['examples']}
                    for h, v in sorted(aborted.items())},
        'not_200': external.get('not_200', [])[:50],
        'static_bytes_differ': state.mismatch[:50],
        'errors': state.errors[:50],
        'replay': bool(args.replay),
    }
    files = [a for a in manifest['assets'] if a.get('file')]
    manifest['summary'] = dict(manifest.get('summary') or {}, assets=len(files),
                               asset_bytes=sum(a['bytes'] for a in files), runtime_files=len(new) - len(live),
                               runtime_live_files=len(live))
    with open(os.path.join(args.snapshot, 'manifest.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(manifest, ensure_ascii=False, indent=1))
    r = manifest['runtime']
    print('runtime capture: %d loads in %ds (%s), %d files saved (%.1f MB) + %d live-service files (%.1f MB), '
          '%d completed from references, %d completion failures' % (
              r['loads'], r['seconds'], r['browser'], r['saved'], r['saved_bytes'] / 1e6, r['saved_live'],
              r['saved_live_bytes'] / 1e6, fetched, len(failed)))
    print('html lang by mode:', json.dumps(r['html_lang_by_mode']))
    print('requests by host (distinct URLs):', json.dumps(r['requests_by_host']))
    print('aborted:', json.dumps(r['aborted'], ensure_ascii=False)[:3000])
    for k in ('not_200', 'static_bytes_differ', 'errors', 'completion_failed'):
        if r[k]:
            print('%s (%d): %s' % (k, len(r[k]), json.dumps(r[k][:8], ensure_ascii=False)[:2000]))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--base', default='https://www.evolako.rs')
    ap.add_argument('--snapshot', default='site/snapshot')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--pages', default='', help='comma-separated slugs or paths (default: all + the 404)')
    ap.add_argument('--replay', help='offline dry run: answer every request from this snapshot folder')
    args = ap.parse_args()
    args.base = args.base.rstrip('/')
    if args.replay and os.path.realpath(args.replay) == os.path.realpath(args.snapshot):
        sys.exit('--replay must be another copy of the snapshot (the capture writes into --snapshot)')
    asyncio.run(run(args))


if __name__ == '__main__':
    main()

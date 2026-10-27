#!/usr/bin/env python3
"""Snapshot of the published www.evolako.rs (Webflow) — step 1 of moving the site to an own static build.

Runs in GitHub Actions (workflow "Site snapshot"), because only the runner can reach the live site. Standard library
only. Writes (relative to --out, default site/snapshot):

  pages/<path>.html       every page from sitemap.xml exactly as published (Serbian; the EN/RU texts are applied in the
                          browser by the i18n engine from the dictionaries inside the page), plus 404.html
  assets/<host>/<path>    every stylesheet, script, image, font and file the pages reference (src, href, srcset,
                          og:image, inline style/script URLs), and the url()/@import references inside the CSS
  extra/robots.txt, extra/sitemap.xml
  manifest.json           pages and assets: source URL, local file, HTTP status, bytes, content type, sha256, and
                          which pages use each asset — the map the build step uses to rewrite URLs

Google Fonts answers by User-Agent (static TTF for unknown clients, variable woff2 for browsers), so its CSS is
requested with a Chrome User-Agent: the copy then holds the same woff2 files the visitors' browsers get.
Files the pages only load at runtime (URLs built by scripts) are added by tools/snapshot_runtime.py, which the
workflow runs right after this crawl.

Nothing here is deployed and the live site is not changed. Usage:
  python3 site/tools/snapshot.py [--base https://www.evolako.rs] [--out site/snapshot]
"""
import argparse
import concurrent.futures as cf
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

UA = 'EvolakoSiteSnapshot/1.0 (+https://www.evolako.rs)'
# What a visitor's Chrome sends; used where the answer depends on the browser (Google Fonts: woff2, variable axes)
# and by the runtime capture, so both passes get the same bytes for the same URL.
CHROME_UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 '
             'Safari/537.36')
BROWSER_UA_HOSTS = {'fonts.googleapis.com'}
# Hosts whose files are copied. Anything else (YouTube, maps tiles, analytics) is only listed in the manifest.
ASSET_HOSTS = {
    'cdn.prod.website-files.com', 'assets-global.website-files.com', 'uploads-ssl.webflow.com',
    'd3e54v103j8qbb.cloudfront.net', 'ajax.googleapis.com', 'cdn.jsdelivr.net', 'unpkg.com',
    'fonts.googleapis.com', 'fonts.gstatic.com', 'app.evolako.rs', 'www.evolako.rs', 'evolako.rs',
}
FILE_RE = re.compile(r'\.(css|js|mjs|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|pdf|docx?|xlsx?|pptx?|zip|'
                     r'mp4|webm|mp3|json|txt|webmanifest|lottie)$', re.I)
URL_IN_TEXT = re.compile(r'https?://[A-Za-z0-9.-]+(?:/[^\s"\'<>()\\]*)?')
CSS_URL = re.compile(r'url\(\s*([\'"]?)([^\'")]+)\1\s*\)', re.I)
CSS_IMPORT = re.compile(r'@import\s+(?:url\()?\s*[\'"]([^\'"]+)[\'"]', re.I)
OWN = {'www.evolako.rs', 'evolako.rs'}  # plus the --base host, set in main()


def fetch(url, tries=4):
    """GET url → (status, content_type, bytes, final_url). Retries network errors and 5xx/429 with backoff."""
    last = None
    ua = CHROME_UA if urllib.parse.urlsplit(url).netloc.lower() in BROWSER_UA_HOSTS else UA
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': ua, 'Accept': '*/*'})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.status, r.headers.get('Content-Type', ''), r.read(), r.geturl()
        except urllib.error.HTTPError as e:
            body = e.read() if hasattr(e, 'read') else b''
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(2 ** i)
                last = e
                continue
            return e.code, e.headers.get('Content-Type', '') if e.headers else '', body, url
        except Exception as e:  # noqa: BLE001 — network errors are retried, then reported
            last = e
            time.sleep(2 ** i)
    return 0, '', str(last).encode(), url


class RefParser(HTMLParser):
    """Collects every URL a page references, with the attribute it came from."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.refs = []          # (url, kind)
        self._in = None         # 'style' | 'script' while inside an inline block
        self.inline = []        # (kind, text)
        self.title = ''
        self._title = False

    def handle_starttag(self, tag, attrs):
        a = {k: (v or '') for k, v in attrs}
        if tag == 'title':
            self._title = True
        for key in ('src', 'data-src', 'poster', 'data-poster-url', 'data-video-urls'):
            if a.get(key):
                for part in a[key].split(','):
                    self.refs.append((part.strip(), f'{tag}[{key}]'))
        for key in ('srcset', 'data-srcset'):
            if a.get(key):
                for part in a[key].split(','):
                    u = part.strip().split(' ')[0]
                    if u:
                        self.refs.append((u, f'{tag}[{key}]'))
        if tag == 'link' and a.get('href'):
            self.refs.append((a['href'], 'link[' + a.get('rel', '') + ']'))
        if tag == 'a' and a.get('href'):
            self.refs.append((a['href'], 'a[href]'))
        if tag == 'meta' and a.get('content') and (a.get('property', '') + a.get('name', '')).lower() in (
                'og:image', 'twitter:image', 'og:image:secure_url', 'msapplication-tileimage'):
            self.refs.append((a['content'], 'meta[' + (a.get('property') or a.get('name')) + ']'))
        if a.get('style'):
            for m in CSS_URL.finditer(a['style']):
                self.refs.append((m.group(2), f'{tag}[style]'))
        if tag in ('style', 'script') and not a.get('src'):
            self._in = tag

    def handle_endtag(self, tag):
        if tag == 'title':
            self._title = False
        if tag == self._in:
            self._in = None

    def handle_data(self, data):
        if self._title:
            self.title += data
        if self._in == 'style':
            self.inline.append(('style', data))
            for m in CSS_URL.finditer(data):
                self.refs.append((m.group(2), 'style'))
        elif self._in == 'script':
            self.inline.append(('script', data))
            for m in URL_IN_TEXT.finditer(data):
                self.refs.append((m.group(0), 'script'))


def local_path(url):
    """Stable file path for an asset URL: assets/<host>/<decoded path>[__<query hash>]."""
    p = urllib.parse.urlsplit(url)
    path = urllib.parse.unquote(p.path)  # Webflow encodes '/' as %2F inside registered-script names
    path = re.sub(r'[^A-Za-z0-9._/@+-]', '_', path).lstrip('/') or 'index'
    if path.endswith('/'):
        path += 'index'
    if p.query:
        stem, dot, ext = path.rpartition('.')
        q = hashlib.sha1(p.query.encode()).hexdigest()[:8]
        path = f'{stem}__{q}.{ext}' if dot and '/' not in ext else f'{path}__{q}'
    return f'assets/{p.netloc}/{path}'


def page_file(path):
    path = path.strip('/')
    return 'pages/' + (path or 'index') + '.html'


# Where a reference comes from decides whether a file on any host is copied: images and CSS-referenced files are
# copied wherever they live (some hero images sit on a third-party CDN), scripts and links only from ASSET_HOSTS.
ANY_HOST_KINDS = ('img[', 'source[', 'video[', 'style', 'css', 'meta[', 'link[icon', 'link[shortcut icon',
                  'link[apple-touch-icon')
SKIP_LINK_RELS = ('link[preconnect', 'link[dns-prefetch', 'link[canonical', 'link[alternate')


def is_asset(url, kind):
    p = urllib.parse.urlsplit(url)
    if p.scheme not in ('http', 'https') or not p.path.strip('/') or kind.startswith(SKIP_LINK_RELS):
        return False
    if p.netloc not in ASSET_HOSTS and p.netloc not in OWN:
        return kind.startswith(ANY_HOST_KINDS) or kind.endswith('[style]')
    if p.netloc in OWN:
        # own pages are pages, not assets; only files on the own domain count
        return bool(FILE_RE.search(p.path))
    if kind in ('a[href]', 'script'):
        return bool(FILE_RE.search(p.path))
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='https://www.evolako.rs')
    ap.add_argument('--out', default='site/snapshot')
    ap.add_argument('--workers', type=int, default=6)
    args = ap.parse_args()
    base = args.base.rstrip('/')
    OWN.add(urllib.parse.urlsplit(base).netloc)
    out = args.out
    os.makedirs(out, exist_ok=True)

    def save(rel, data):
        full = os.path.join(out, rel)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, 'wb') as f:
            f.write(data)

    manifest = {'base': base, 'taken': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'pages': [],
                'assets': [], 'external': [], 'errors': []}

    # 1. sitemap + robots
    st, ct, sm, _ = fetch(base + '/sitemap.xml')
    if st != 200:
        print('sitemap.xml failed', st, file=sys.stderr)
        sys.exit(1)
    save('extra/sitemap.xml', sm)
    st_r, _, robots, _ = fetch(base + '/robots.txt')
    if st_r == 200:
        save('extra/robots.txt', robots)
    paths = []
    for loc in re.findall(r'<loc>([^<]+)</loc>', sm.decode('utf-8', 'replace')):
        p = urllib.parse.urlsplit(loc.strip()).path or '/'
        if p not in paths:
            paths.append(p)
    paths.append('/__snapshot-404-probe')  # captures the 404 page

    # 2. pages
    refs = {}  # asset url -> {'kinds': set, 'pages': set}
    external = {}

    def get_page(p):
        return p, fetch(base + p)

    with cf.ThreadPoolExecutor(args.workers) as ex:
        for p, (st, ct, body, final) in ex.map(get_page, paths):
            is404 = p == '/__snapshot-404-probe'
            rel = 'pages/404.html' if is404 else page_file(p)
            if st != 200 and not (is404 and st == 404):
                manifest['errors'].append({'url': base + p, 'status': st})
                continue
            save(rel, body)
            text = body.decode('utf-8', 'replace')
            rp = RefParser()
            rp.feed(text)
            manifest['pages'].append({'path': p if not is404 else '404', 'file': rel, 'status': st,
                                      'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(),
                                      'title': rp.title.strip(), 'final_url': final})
            page_url = base + p
            for raw, kind in rp.refs:
                raw = raw.strip()
                if not raw or raw.startswith(('#', 'mailto:', 'tel:', 'javascript:', 'data:', 'viber:', 'sms:')):
                    continue
                u = urllib.parse.urljoin(page_url, raw)
                u = u.split('#')[0]
                if is_asset(u, kind):
                    r = refs.setdefault(u, {'kinds': set(), 'pages': set()})
                    r['kinds'].add(kind)
                    r['pages'].add(p)
                else:
                    host = urllib.parse.urlsplit(u).netloc
                    if host and host not in OWN:
                        e = external.setdefault(host, set())
                        e.add(kind)
            print(f'page {st} {p} {len(body)}')

    # 3. assets (+ CSS references, one level deep is enough for Webflow's shared CSS; loop until no new ones)
    done = {}
    queue = list(refs)

    def get_asset(u):
        return u, fetch(u)

    rounds = 0
    while queue and rounds < 4:
        rounds += 1
        new = []
        with cf.ThreadPoolExecutor(args.workers) as ex:
            for u, (st, ct, body, final) in ex.map(get_asset, queue):
                rel = local_path(u)
                done[u] = rel
                info = refs.get(u, {'kinds': set(), 'pages': set()})
                entry = {'url': u, 'file': rel, 'status': st, 'bytes': len(body), 'type': ct.split(';')[0],
                         'sha256': hashlib.sha256(body).hexdigest(), 'kinds': sorted(info['kinds']),
                         'pages': sorted(info['pages'])[:50], 'page_count': len(info['pages'])}
                if st != 200:
                    manifest['errors'].append({'url': u, 'status': st})
                    entry['file'] = None
                    manifest['assets'].append(entry)
                    continue
                save(rel, body)
                manifest['assets'].append(entry)
                if 'css' in ct or u.split('?')[0].endswith('.css'):
                    css = body.decode('utf-8', 'replace')
                    for m in list(CSS_URL.finditer(css)) + list(CSS_IMPORT.finditer(css)):
                        ref = m.group(2) if m.re is CSS_URL else m.group(1)
                        if ref.startswith('data:'):
                            continue
                        v = urllib.parse.urljoin(u, ref.strip()).split('#')[0]
                        h = urllib.parse.urlsplit(v).netloc
                        if v not in done and v not in refs and h and urllib.parse.urlsplit(v).path.strip('/'):
                            refs[v] = {'kinds': {'css'}, 'pages': set(info['pages'])}
                            new.append(v)
                print(f'asset {st} {len(body):>9} {u}')
        queue = new

    manifest['external'] = [{'host': h, 'kinds': sorted(k)} for h, k in sorted(external.items())]
    manifest['pages'].sort(key=lambda x: x['path'])
    manifest['assets'].sort(key=lambda x: x['url'])
    total = sum(a['bytes'] for a in manifest['assets'] if a['file'])
    manifest['summary'] = {'pages': len(manifest['pages']), 'assets': len([a for a in manifest['assets'] if a['file']]),
                           'asset_bytes': total, 'errors': len(manifest['errors'])}
    save('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=1).encode('utf-8'))
    print(json.dumps(manifest['summary']))
    if manifest['errors']:
        print('errors:', json.dumps(manifest['errors'][:30], ensure_ascii=False))


if __name__ == '__main__':
    main()

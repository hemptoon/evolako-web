#!/usr/bin/env python3
"""IndexNow for www.evolako.rs (decision 28.10.2026): after a production deploy, tell the search engines that take
IndexNow (Bing, Yandex, Seznam, Naver …; api.indexnow.org passes a submission on to all of them) which pages changed.
Google does not take IndexNow — it reads sitemap.xml as before.

  * The key: site/public/<key>.txt holds the key and nothing else (8–128 characters: letters, digits, "-"). The build
    copies site/public/* to the root of dist, so the file is served at https://www.evolako.rs/<key>.txt.
  * The manifest: the build writes dist/indexnow-pages.json — every page of the sitemap (sr, en, ru) with a
    fingerprint of what a search engine reads on it: the text, the head (title, meta, canonical, hreflang), JSON-LD,
    links and images. Scripts, styles and stylesheet/preload links are left out, so a deploy that only renames assets
    (a new snapshot of the shared CSS, say) changes no fingerprint.
  * The ping (.github/workflows/site-preview.yml): the workflow fetches the live manifest before the upload and, once
    the production smoke test passed, submits every URL whose fingerprint changed, is new, or is gone (IndexNow takes
    deleted URLs too, so the engines drop them). No live manifest yet (the first deploy with IndexNow) means every URL
    counts as new. A failure never fails the deploy: it is printed as a workflow warning.
  * Independent of the IndexNow of www.blokvolt.rs (its own key, host and workflow); the same protocol.

Usage:
  python3 site/tools/indexnow.py key                       # print the key (site/public/<key>.txt)
  python3 site/tools/indexnow.py diff --old OLD --new NEW  # the URLs a ping would submit, nothing sent
  python3 site/tools/indexnow.py ping --old OLD --new NEW  # check the live key file, then submit (Actions)
  python3 site/tools/indexnow.py selftest [--dist site/dist]  # offline: fingerprint, diff, payload, key, manifest
Standard library only.
"""
import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
PUBLIC_DIR = os.path.join(SITE_DIR, 'public')
SITE = 'https://www.evolako.rs'
HOST = 'www.evolako.rs'
ENDPOINT = 'https://api.indexnow.org/indexnow'
MANIFEST = 'indexnow-pages.json'
VERSION = 1                       # of the fingerprint: another version means "no previous manifest"
MAX_URLS = 10000                  # per request (protocol limit)
KEY_RX = re.compile(r'[A-Za-z0-9-]{8,128}')
UA = 'evolako-site-deploy (+https://www.evolako.rs/)'


# ------------------------------------------------------------------------------------------------ key
def find_key(public=PUBLIC_DIR):
    """The key of site/public/<key>.txt: exactly one such file, whose content is its name."""
    found = []
    for name in sorted(os.listdir(public)) if os.path.isdir(public) else []:
        root, ext = os.path.splitext(name)
        if ext == '.txt' and KEY_RX.fullmatch(root):
            with open(os.path.join(public, name), encoding='utf-8') as f:
                found.append((root, f.read()))
    if len(found) != 1:
        raise ValueError('site/public needs exactly one IndexNow key file <key>.txt, found %d' % len(found))
    key, text = found[0]
    if text.strip() != key or text != text.strip():
        raise ValueError('site/public/%s.txt must hold the key %s and nothing else' % (key, key))
    return key


# ------------------------------------------------------------------------------------------------ fingerprint
_SCRIPT = re.compile(r'<script\b(?![^>]*\btype="application/ld\+json")[^>]*>.*?</script>', re.S | re.I)
_STYLE = re.compile(r'<style\b[^>]*>.*?</style>', re.S | re.I)
_COMMENT = re.compile(r'<!--.*?-->', re.S)
_LINK = re.compile(r'<link\b(?![^>]*\brel="(?:canonical|alternate)")[^>]*>', re.I)
_ATTR = re.compile(r'\s(?:integrity|nonce|crossorigin)="[^"]*"')
_WS = re.compile(r'\s+')


def fingerprint(page_html):
    """16 hex digits of the sha256 of a page without its scripts (JSON-LD stays), styles, comments and stylesheet /
    preload links: what changes when the content, the head or a link changes, not when an asset is renamed."""
    t = _SCRIPT.sub('', page_html)
    t = _STYLE.sub('', t)
    t = _COMMENT.sub('', t)
    t = _LINK.sub('', t)
    t = _ATTR.sub('', t)
    t = _WS.sub(' ', t).strip()
    return hashlib.sha256(t.encode('utf-8')).hexdigest()[:16]


def manifest(pages, key):
    """{url: page html} -> the manifest's bytes (sorted, stable)."""
    data = {'version': VERSION, 'host': HOST, 'key': key,
            'pages': {u: fingerprint(t) for u, t in sorted(pages.items())}}
    return (json.dumps(data, ensure_ascii=False, indent=1, sort_keys=True) + '\n').encode('utf-8')


# ------------------------------------------------------------------------------------------------ diff and ping
def load(path):
    """A manifest from a file; {} when it is missing, not JSON, of another fingerprint version or another host."""
    try:
        with open(path, encoding='utf-8') as f:
            d = json.load(f)
    except (OSError, ValueError):
        return {}
    if not isinstance(d, dict) or d.get('version') != VERSION or d.get('host') != HOST or \
            not isinstance(d.get('pages'), dict):
        return {}
    return d


def changed(old, new):
    """(urls to submit, why) — new or changed fingerprints first (sorted), then pages that are gone."""
    o, n = old.get('pages') or {}, new.get('pages') or {}
    upd = sorted(u for u, h in n.items() if o.get(u) != h)
    gone = sorted(u for u in o if u not in n)
    why = {'new': sum(1 for u in upd if u not in o), 'changed': sum(1 for u in upd if u in o), 'gone': len(gone),
           'previous manifest': bool(o)}
    return upd + gone, why


def payload(key, urls):
    return {'host': HOST, 'key': key, 'keyLocation': '%s/%s.txt' % (SITE, key), 'urlList': list(urls)}


def batches(urls, n=MAX_URLS):
    return [urls[i:i + n] for i in range(0, len(urls), n)]


def warn(msg):
    # a GitHub Actions warning annotation; the deploy goes on
    print('::warning::IndexNow: ' + msg)


def http(url, data=None, timeout=30):
    req = urllib.request.Request(url, data=data, headers={'User-Agent': UA})
    if data is not None:
        req.add_header('Content-Type', 'application/json; charset=utf-8')
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except (urllib.error.URLError, OSError) as e:
        return None, str(e).encode('utf-8', 'replace')


MEANING = {200: 'submitted', 202: 'accepted — the key is new and still being verified; the engines take the URLs once '
                                  'it is', 400: 'invalid request', 403: 'key not valid for this host',
           422: 'URLs or key rejected', 429: 'too many requests'}


def ping(old_path, new_path, dry=False):
    new = load(new_path)
    if not new:
        warn('no manifest at %s — nothing submitted' % new_path)
        return 0
    key = new['key']
    urls, why = changed(load(old_path), new)
    print('IndexNow: %d URLs to submit (%d new, %d changed, %d gone; previous manifest: %s)' % (
        len(urls), why['new'], why['changed'], why['gone'], 'yes' if why['previous manifest'] else 'none — every URL is new'))
    for u in urls[:40]:
        print('   ' + u)
    if len(urls) > 40:
        print('   … and %d more' % (len(urls) - 40))
    if not urls or dry:
        return 0
    st, body = http('%s/%s.txt' % (SITE, key))
    if st != 200 or body.decode('utf-8', 'replace').strip() != key:
        warn('the key file %s/%s.txt is not live (status %s) — nothing submitted' % (SITE, key, st))
        return 0
    for part in batches(urls):
        st, body = http(ENDPOINT, json.dumps(payload(key, part)).encode('utf-8'))
        text = body.decode('utf-8', 'replace')[:300]
        if st in (200, 202):
            print('IndexNow: %d URLs -> %s %s (%s)' % (len(part), ENDPOINT, st, MEANING[st]))
        else:
            warn('%s answered %s (%s) for %d URLs: %s' % (ENDPOINT, st, MEANING.get(st, 'error'), len(part), text))
    return 0


# ------------------------------------------------------------------------------------------------ self-test
def selftest(dist):
    fails = []

    def ok(cond, what):
        if not cond:
            fails.append(what)
    page = ('<html><head><title>T</title><link rel="stylesheet" href="/_a/x.h0123456789.css" integrity="sha384-a"/>'
            '<link rel="canonical" href="https://www.evolako.rs/x"/><script src="/_a/y.js"></script>'
            '<script type="application/ld+json">{"name":"A"}</script><style>.a{}</style></head>'
            '<body><!-- c --><h1>Naslov</h1><p>Tekst</p><img src="/_a/i.webp"/></body></html>')
    fp = fingerprint(page)
    ok(fp == fingerprint(page.replace('x.h0123456789.css', 'x.h9876543210.css')), 'a renamed stylesheet changes the '
       'fingerprint')
    ok(fp == fingerprint(page.replace('/_a/y.js', '/_a/z.js').replace('.a{}', '.b{}')), 'scripts/styles count')
    ok(fp != fingerprint(page.replace('Tekst', 'Novi tekst')), 'a text change is not seen')
    ok(fp != fingerprint(page.replace('"A"', '"B"')), 'a JSON-LD change is not seen')
    ok(fp != fingerprint(page.replace('/x"', '/y"')), 'a canonical change is not seen')
    ok(fp != fingerprint(page.replace('i.webp', 'j.webp')), 'an image change is not seen')
    old = {'version': VERSION, 'host': HOST, 'key': 'k' * 8, 'pages': {SITE + '/a': '1', SITE + '/b': '2', SITE + '/c': '3'}}
    new = {'version': VERSION, 'host': HOST, 'key': 'k' * 8, 'pages': {SITE + '/a': '1', SITE + '/b': '9', SITE + '/d': '4'}}
    urls, why = changed(old, new)
    ok(urls == [SITE + '/b', SITE + '/d', SITE + '/c'], 'diff: %s' % urls)
    ok(why == {'new': 1, 'changed': 1, 'gone': 1, 'previous manifest': True}, 'diff counts: %s' % why)
    urls, why = changed({}, new)
    ok(len(urls) == 3 and not why['previous manifest'], 'no previous manifest: every URL is new')
    ok(changed(new, new)[0] == [], 'same manifest: nothing to submit')
    p = payload('k' * 8, [SITE + '/a'])
    ok(p == {'host': HOST, 'key': 'kkkkkkkk', 'keyLocation': SITE + '/kkkkkkkk.txt', 'urlList': [SITE + '/a']},
       'payload %s' % p)
    ok([len(b) for b in batches(list(range(20001)))] == [10000, 10000, 1], 'batches of 10.000')
    try:
        key = find_key()
        ok(KEY_RX.fullmatch(key) is not None, 'key format')
    except ValueError as e:
        fails.append(str(e))
        key = None
    if dist and key:
        kf = os.path.join(dist, key + '.txt')
        ok(os.path.isfile(kf) and open(kf, encoding='utf-8').read() == key, 'dist/%s.txt is missing or differs' % key)
        m = load(os.path.join(dist, MANIFEST))
        ok(bool(m) and m.get('key') == key, 'dist/%s is missing or names another key' % MANIFEST)
        with open(os.path.join(dist, 'sitemap.xml'), encoding='utf-8') as f:
            locs = set(re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', f.read()))
        ok(set((m or {}).get('pages') or {}) == locs, 'the manifest and sitemap.xml name different URLs')
        for u, h in sorted(((m or {}).get('pages') or {}).items()):
            rel = u[len(SITE) + 1:] or 'index'
            rel = rel + 'index' if rel.endswith('/') else rel
            with open(os.path.join(dist, rel + '.html'), encoding='utf-8') as f:
                if fingerprint(f.read()) != h:
                    fails.append('fingerprint of %s differs from the manifest' % u)
                    break
    for f in fails:
        print('FAIL ' + f)
    print('indexnow selftest: %s (%d pages in the manifest)' % ('ok' if not fails else '%d failures' % len(fails),
                                                                 len(((load(os.path.join(dist, MANIFEST)) if dist else {})
                                                                      or {}).get('pages') or {})))
    return 1 if fails else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=('key', 'diff', 'ping', 'selftest'))
    ap.add_argument('--old', help='the manifest of the live site before the upload (missing/invalid = none)')
    ap.add_argument('--new', default=os.path.join(SITE_DIR, 'dist', MANIFEST))
    ap.add_argument('--dist', default=os.path.join(SITE_DIR, 'dist'))
    a = ap.parse_args()
    if a.cmd == 'key':
        print(find_key())
        return 0
    if a.cmd == 'selftest':
        return selftest(a.dist if os.path.isdir(a.dist) else None)
    return ping(a.old or '', a.new, dry=(a.cmd == 'diff'))


if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env python3
"""EN/RU dictionaries of every page of www.evolako.rs, exactly as the i18n engine holds them on the live site —
input of the prerendered /en/ and /ru/ pages (site/build.py). Nothing leaves this machine.

The engine ("Evolako i18n v3") keeps its dictionaries in a closure; every one of them arrives through window.BVQ
(inline scripts of the page, script files the page names, files the engine, the i18n loader, the i18n-fix loader and
the page loaders of /preporuka and /mapa-punjaca add at runtime, and re-pushes on window "load"). BVQ is an array that
keeps every push in order, so folding it the way the engine does (ld(): later pairs overwrite earlier ones) gives the
engine's final state. This tool opens every page of the snapshot the way QA replays the original Webflow site
(tools/qa_dist.py: the snapshot pages on a local server, every other file answered from the snapshot) with ?lang=en
and ?lang=ru, waits until the page has settled, and folds window.BVQ.

Order matters: some keys are pushed by several files with different values (newer copy re-pushed on "load"), and on
the live site the order of inline pushes and of the scripts loaded at runtime depends on the network. The capture
therefore uses one fixed order: every script loaded at runtime (manifest "runtime": true) is answered after a delay,
i.e. after the page has been parsed — what a first visit over the network sees. Each page is captured twice with two
different delays; keys whose final value differs between the two runs are listed as "unstable" (the build stops if a
page uses one). The engine's own title of the page (document.title after it settled) is recorded as a check.

Output: site/i18n/harvest.json — per page and language the engine's two dictionaries for that language
('en2' + 'en', or 'ru2' + 'ru'), the translated title and the number of pushes; plus the sha256 of the snapshot
manifest it was taken from (the build refuses a harvest of another snapshot).
Usage: python3 site/tools/i18n_harvest.py [--pages index,kontakt] [--workers 6]
"""
import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import qa_dist  # noqa: E402

LANGS = ('en', 'ru')
DELAYS_MS = (600, 1500)          # two runs per page: dynamically loaded scripts answered after this delay
SETTLE_MS = 1500
VERSION = 1


def compact(pages):
    """Pages share most entries: one table per language and dictionary with the value most pages have, and per page
    the keys it has plus the values that differ from that table."""
    from collections import Counter
    votes = {}
    for slug, langs in pages.items():
        for lang, v in langs.items():
            for name, d in v['dicts'].items():
                for k, val in d.items():
                    votes.setdefault(lang, {}).setdefault(name, {}).setdefault(k, Counter())[val] += 1
    values = {lang: {name: {k: c.most_common(1)[0][0] for k, c in sorted(ks.items())} for name, ks in names.items()}
              for lang, names in votes.items()}
    out = {}
    for slug, langs in pages.items():
        for lang, v in langs.items():
            keys, own = {}, {}
            for name, d in v['dicts'].items():
                keys[name] = ' '.join(sorted(d))
                diff = {k: val for k, val in d.items() if values[lang][name][k] != val}
                if diff:
                    own[name] = diff
            out.setdefault(slug, {})[lang] = {'title': v['title'], 'pushes': v['pushes'], 'keys': keys, 'own': own,
                                              'unstable': v['unstable'], 'timing': v.get('timing') or {}}
    return {'values': values, 'pages': out}


def expand(h):
    """compact() undone: {slug: {lang: {'title', 'pushes', 'dicts', 'unstable'}}}."""
    pages = {}
    for slug, langs in h['pages'].items():
        for lang, v in langs.items():
            dicts = {}
            for name, ks in v['keys'].items():
                own = (v.get('own') or {}).get(name, {})
                dicts[name] = {k: own.get(k, h['values'][lang][name].get(k)) for k in ks.split()}
            pages.setdefault(slug, {})[lang] = {'title': v['title'], 'pushes': v['pushes'], 'dicts': dicts,
                                                'unstable': v.get('unstable') or {}, 'timing': v.get('timing') or {}}
    return pages


def fold(pushes, lang):
    """ld() of the engine over the whole BVQ log; only the dictionaries of one language."""
    d = {lang + '2': {}, lang: {}}
    for name, payload in pushes:
        if name not in d:
            continue
        parts = payload.split('§')
        for i in range(0, len(parts) - 1, 2):
            d[name][parts[i]] = parts[i + 1]
    return d


async def capture(browser, port, answers, runtime_js, slug, lang, delay_ms):
    ctx = await browser.new_context(viewport={'width': 1440, 'height': 900}, locale='sr-RS', service_workers='block')

    async def route(r):
        req = r.request
        u = urllib.parse.urlsplit(req.url)
        if u.hostname == '127.0.0.1' and u.port == port:
            return await r.continue_()
        key = qa_dist.url_key(req.url)
        hit = answers.get(key)
        if qa_dist.TURNSTILE_API in req.url:
            hit = (qa_dist.TURNSTILE_STUB, 'application/javascript')
        if hit and req.method == 'GET':
            if key in runtime_js:
                await asyncio.sleep(delay_ms / 1000)
            return await r.fulfill(status=200, body=hit[0], headers={'content-type': hit[1],
                                                                     'access-control-allow-origin': '*'})
        return await r.abort('blockedbyclient')

    await ctx.route('**/*', route)
    page = await ctx.new_page()
    path = '/' if slug == 'index' else '/' + slug
    await page.goto('http://127.0.0.1:%d%s?lang=%s' % (port, path, lang), wait_until='load', timeout=90000)
    try:
        await page.wait_for_load_state('networkidle', timeout=15000)
    except Exception:  # noqa: BLE001 — a page that keeps polling has still settled
        pass
    await page.wait_for_timeout(SETTLE_MS)
    data = await page.evaluate('() => ({q: JSON.stringify(window.BVQ || []), title: document.title, '
                               'lang: document.documentElement.lang})')
    await ctx.close()
    return json.loads(data['q']), data['title'], data['lang']


async def run(args):
    from playwright.async_api import async_playwright
    snapshot = os.path.realpath(args.snapshot)
    answers, live, embed, manifest = qa_dist.load_snapshot(snapshot)
    runtime_js = {qa_dist.url_key(a['url']) for a in manifest['assets']
                  if a.get('runtime') and a.get('file') and ('javascript' in (a.get('type') or '')
                                                             or a['file'].endswith('.js'))}
    slugs = sorted((p['path'].strip('/') or 'index') for p in manifest['pages'] if p['path'] != '404')
    if args.pages:
        want = set(args.pages.split(','))
        slugs = [s for s in slugs if s in want]
    srv, port = qa_dist.start_server(snapshot, False)
    out = {}
    problems = []
    t0 = time.time()
    async with async_playwright() as pw:
        browser = await pw.chromium.launch()
        sem = asyncio.Semaphore(args.workers)

        async def one(slug, lang):
            async with sem:
                runs = []
                for delay in DELAYS_MS:
                    runs.append(await capture(browser, port, answers, runtime_js, slug, lang, delay))
            timing = {}
            if args.timing_runs:                       # extra captures with no delay: what the live site may show
                canon = fold(runs[-1][0], lang)
                async with sem:
                    for _ in range(args.timing_runs):
                        q0, _, _ = await capture(browser, port, answers, runtime_js, slug, lang, 0)
                        f0 = fold(q0, lang)
                        for name, d in f0.items():
                            for k, val in d.items():
                                if canon[name].get(k) != val:
                                    timing.setdefault(name, {}).setdefault(k, [])
                                    if val not in timing[name][k]:
                                        timing[name][k].append(val)
            folded = [fold(q, lang) for q, _, _ in runs]
            unstable = {}
            for name in folded[0]:
                a, b = folded[0][name], folded[1][name]
                for k in sorted(set(a) | set(b)):
                    if a.get(k) != b.get(k):
                        unstable.setdefault(name, {})[k] = [a.get(k), b.get(k)]
            q, title, html_lang = runs[-1]
            if html_lang != lang:
                problems.append('%s %s: html lang %r — the language did not switch' % (slug, lang, html_lang))
            if runs[0][1] != title:
                unstable.setdefault('title', {})['document.title'] = [runs[0][1], title]
            out.setdefault(slug, {})[lang] = {'title': title, 'pushes': len(q), 'dicts': folded[-1],
                                              'unstable': unstable, 'timing': timing}
            print('  %-50s %s %3d pushes, %4d + %3d keys%s' % (
                slug, lang, len(q), len(folded[-1][lang + '2']), len(folded[-1][lang]),
                ', UNSTABLE %d' % sum(len(v) for v in unstable.values()) if unstable else ''), flush=True)

        await asyncio.gather(*(one(s, lang) for s in slugs for lang in LANGS))
        await browser.close()
    srv.shutdown()
    with open(os.path.join(snapshot, 'manifest.json'), 'rb') as f:
        manifest_sha = hashlib.sha256(f.read()).hexdigest()
    full = {s: out[s] for s in sorted(out)}
    if args.pages and os.path.isfile(args.out):              # partial run: keep the other pages of the same snapshot
        with open(args.out, encoding='utf-8') as f:
            old = json.load(f)
        if old.get('snapshot_manifest_sha256') == manifest_sha:
            prev = expand(old)
            prev.update(full)
            full = {s: prev[s] for s in sorted(prev)}
    result = compact(full)
    result.update({'version': VERSION, 'snapshot_manifest_sha256': manifest_sha, 'delays_ms': list(DELAYS_MS),
                   'tool': 'site/tools/i18n_harvest.py'})
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    with open(args.out, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write('\n')
    unstable = {(s, l): v['unstable'] for s, langs in full.items() for l, v in langs.items() if v['unstable']}
    print('harvest: %d pages x %d languages in %.0fs -> %s (%.0f KB); unstable keys on %d page/language pairs' % (
        len(out), len(LANGS), time.time() - t0, os.path.relpath(args.out), os.path.getsize(args.out) / 1024,
        len(unstable)))
    for (s, l), v in sorted(unstable.items()):
        for name, keys in v.items():
            for k, vals in keys.items():
                print('   unstable %s %s %s %s: %r | %r' % (s, l, name, k, (vals[0] or '')[:70], (vals[1] or '')[:70]))
    for p in problems:
        print('PROBLEM: ' + p)
    if problems:
        sys.exit(1)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--snapshot', default=os.path.join(SITE_DIR, 'snapshot'))
    ap.add_argument('--out', default=os.path.join(SITE_DIR, 'i18n', 'harvest.json'))
    ap.add_argument('--pages', default='')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--timing-runs', type=int, default=3,
                    help='captures without delay per page and language: keys whose live value can differ from the '
                         'fixed order are recorded as "timing" (QA treats those texts as known variants)')
    asyncio.run(run(ap.parse_args()))


if __name__ == '__main__':
    main()

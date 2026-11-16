#!/usr/bin/env python3
"""Names that stay the same in every language on the pages of site/klasteri.py — into site/i18n/keep.json.

The resort, car and charger pages carry texts that are not translated on purpose: a place name that English writes the
same way (Zlatibor), the name of a car, a version or a charger (Zoe Z.E. 50, TAC-W11), the title of a foreign-language
source cited as published. On an /en/ or /ru/ page QA reports every Serbian source text that is still there, unless
site/i18n/keep.json lists it with a reason. This tool adds the missing entries, each with its reason:

    python3 site/tools/klasteri_keep.py          # lists what is missing (exit 1 when something is)
    python3 site/tools/klasteri_keep.py --write  # adds it to site/i18n/keep.json

Run it after adding a place, a car or a charger. It never removes or changes an entry.
"""
import json
import os
import re
import sys

SITE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, SITE_DIR)
import content as C          # noqa: E402
import prerender as PR       # noqa: E402

SOURCE = re.compile(r'^[A-Z][\w. ]{1,40} — ')            # «Publisher — title»


def reason(text, slugs, places):
    where = ', '.join('/' + s for s in sorted(slugs)[:2]) + (' …' if len(slugs) > 2 else '')
    if text in places:
        return 'place name, the same in English (%s)' % where
    if SOURCE.match(text):
        return 'title of a foreign-language source, cited as published (%s)' % where
    if any(s.startswith('ugradnja-') or s == 'samo-ugradnja-punjaca' for s in slugs):
        return 'charger brand, range or model code, the same in every language (%s)' % where
    return 'car model or version name, the same in every language (%s)' % where


def main():
    sources, assets = C.snapshot_sources(os.path.join(SITE_DIR, 'snapshot'))
    c = C.Content(sources, assets)
    if c.errors():
        sys.exit('site/content has errors: %s' % c.errors()[:3])
    path = os.path.join(SITE_DIR, 'i18n', 'keep.json')
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    entries = data['entries']
    places = {pl['name'] for pl in (c.families.get('hoteli') or {}).get('places', [])}
    found = {}
    for name, mod in C.FAMILIES:
        if not c.families.get(name):
            continue
        for slug in mod.slugs(c.families[name]):
            for sr, en, ru in c.pairs[slug]:
                t = PR.nm(sr)
                if PR.looks_neutral(t) or PR.key_of(t) in entries:
                    continue
                if PR.nm(en) == t or PR.nm(ru) == t:
                    found.setdefault(t, set()).add(slug)
    for t in sorted(found):
        print('%s  %s  — %s' % (PR.key_of(t), t[:90], reason(t, found[t], places)))
    print('%d texts missing in site/i18n/keep.json' % len(found))
    if '--write' in sys.argv[1:] and found:
        for t in sorted(found):
            entries[PR.key_of(t)] = {'sr': t, 'why': reason(t, found[t], places)}
        data['entries'] = dict(sorted(entries.items()))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write('\n')
        print('written: %s (%d entries)' % (path, len(entries)))
        return 0
    return 1 if found else 0


if __name__ == '__main__':
    sys.exit(main())

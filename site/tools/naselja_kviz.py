#!/usr/bin/env python3
"""The list of places of the quiz's question «Gde je parking?» (/proveri-svoju-garazu, /preporuka): every naselje of
Serbia without Kosovo (Republički zavod za statistiku: 4709 naselja, 2022 census) with its opština, so a visitor finds
a village as easily as a town. Written to site/public/kviz-naselja.json, which the build serves at
/kviz-naselja.json; the quiz loads it only when the visitor focuses the field.

  python3 site/tools/naselja_kviz.py --src naselja-srbija.json [--syn naselja-sinonimi.json]   # write the JSON
  python3 site/tools/naselja_kviz.py --src … --check                                           # report only

Source records {n, c, o, r, p, …} (Latin name, Cyrillic name, opština, region, population; coordinates are not
used and not shipped). Shipped, compact, sorted by population (biggest first; p = 0 last):
  {"v": 1, "src": "Republički zavod za statistiku", "z": [zone codes], "o": [opštine], "oz": [zone of each opština],
   "d": [[n, opština index] | [n, opština index, extra search key]],
   "s": [[alias, index of its naselje in d] | [alias, index, 1 = show the naselje's own name]
         | [alias, index, 0 | 1, extra search key]]}
* Zone (what the quiz sends as «Kviz grad», as its four options did): r = Beograd -> beograd; opština Novi Sad or
  Petrovaradin -> novisad; r = Vojvodina -> vojvodina; else ostatak. Never shown to the visitor.
* Cyrillic: the quiz transliterates what is typed (Serbian and Russian Cyrillic) and folds diacritics (nz() below =
  nz() of the quiz script), so the official Cyrillic name c is matched without shipping it; a c that does not fold to
  the same key as n is shipped as the extra search key (none in the 2022 list).
* Synonyms (naselja-sinonimi.json: city districts and quarters people type instead of the naselje, city
  municipalities, spelling variants): --syn, a list of {"s": alias, "c": its Cyrillic, "n": naselje, "o": opština,
  "k": "deo grada" | "gradska opština" | "varijanta", "trap": true if the alias is also a naselje elsewhere}. A district
  is listed under its own name with the opština of its naselje («Zemun — Beograd», zone of Beograd); a variant
  («Bukoloram») under the naselje's name («Bukuloram — Prokuplje»). The quiz ranks a synonym right after its naselje,
  so a district of a big city comes before a small village of the same name (Rakovica — Beograd before Rakovica —
  Čajetina); the opština in the label tells them apart. An alias that adds no new search key is left out.
  Without --syn the file has no synonyms.
"""
import argparse
import gzip
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'public', 'kviz-naselja.json')
ZONES = ['beograd', 'novisad', 'vojvodina', 'ostatak']
NOVI_SAD = {'Novi Sad', 'Petrovaradin'}
SOURCE = 'Republički zavod za statistiku'
SOURCE_SYN = 'delovi grada: sr.wikipedia.org (CC BY-SA), 29.10.2026'
# names of the capital in other languages (shown as «Beograd»; Russian «Белград» does not transliterate to it)
EXONYMS = [{'s': a, 'c': '', 'n': 'Beograd', 'o': 'Beograd', 'k': 'varijanta'} for a in ('Belgrade', 'Belgrad', 'Белград')]
CY = {'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'ђ': 'd', 'е': 'e', 'ж': 'z', 'з': 'z', 'и': 'i', 'ј': 'j',
      'к': 'k', 'л': 'l', 'љ': 'lj', 'м': 'm', 'н': 'n', 'њ': 'nj', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
      'ћ': 'c', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'c', 'ч': 'c', 'џ': 'dz', 'ш': 's', 'й': 'j', 'ё': 'e', 'э': 'e',
      'ы': 'i', 'ю': 'ju', 'я': 'ja', 'щ': 'sc', 'ъ': '', 'ь': ''}


def nz(s):
    """The search key: lower case, Cyrillic transliterated, diacritics folded, đ/dj -> d, j dropped, punctuation ->
    spaces."""
    o = ''.join(CY.get(ch, ch) for ch in str(s or '').lower())
    o = o.replace('đ', 'd')
    o = re.sub('[čć]', 'c', o).replace('š', 's').replace('ž', 'z')
    o = ''.join(ch for ch in unicodedata.normalize('NFD', o) if not unicodedata.combining(ch))
    o = o.replace('dj', 'd').replace('j', '')         # Russian spellings drop it: Крагуевац, Кралево, Валево
    return re.sub(r'[^a-z0-9]+', ' ', o).strip()


def zone_of(r):
    if r['r'] == 'Beograd':
        return 'beograd'
    if r['r'] == 'Vojvodina':
        return 'novisad' if r['o'] in NOVI_SAD else 'vojvodina'
    return 'ostatak'


def build(src, syn=None):
    rows = json.load(open(src, encoding='utf-8'))
    for r in rows:
        missing = [k for k in ('n', 'c', 'o', 'r') if not r.get(k)]
        if missing:
            raise SystemExit('record without %s: %r' % (missing, r))
    rows = sorted(rows, key=lambda r: -(r.get('p') or 0))          # stable: the source order breaks ties
    ops, oz, idx = [], [], {}
    for r in rows:
        if r['o'] not in idx:
            idx[r['o']] = len(ops)
            ops.append(r['o'])
            oz.append(ZONES.index(zone_of(r)))
        elif ZONES[oz[idx[r['o']]]] != zone_of(r):
            raise SystemExit('opština %s spans two zones' % r['o'])
    pairs = set()
    d, extra = [], 0
    for r in rows:
        if (r['n'], r['o']) in pairs:
            raise SystemExit('two naselja %s in opština %s: the label «n — o» would not tell them apart' % (r['n'], r['o']))
        pairs.add((r['n'], r['o']))
        row = [r['n'], idx[r['o']]]
        if nz(r['c']) != nz(r['n']):
            row.append(r['c'])
            extra += 1
        d.append(row)
    s, at = [], {(r['n'], r['o']): i for i, r in enumerate(rows)}
    for x in (json.load(open(syn, encoding='utf-8')) if syn else []) + EXONYMS:
        alias, key = x['s'], (x['n'], x['o'])
        if key not in at:
            raise SystemExit('synonym %r: no naselje %s in opština %s' % (alias, x['n'], x['o']))
        if nz(x['n']) == nz(alias) or nz(x['n']).startswith(nz(alias) + ' '):
            continue                                   # the naselje is found under this name anyway
        row = [alias, at[key]]
        show = 1 if x.get('k') == 'varijanta' else 0
        cyr = x['c'] if x.get('c') and nz(x['c']) != nz(alias) else None
        if show or cyr:
            row.append(show)
        if cyr:
            row.append(cyr)
        s.append(row)
    out = {'v': 1, 'src': SOURCE, 'z': ZONES, 'o': ops, 'oz': oz, 'd': d, 's': s}
    if s:
        out['src_s'] = SOURCE_SYN
    data = (json.dumps(out, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')
    return data, rows, extra, len(s)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--src', required=True)
    ap.add_argument('--syn')
    ap.add_argument('--check', action='store_true')
    a = ap.parse_args()
    data, rows, extra, nsyn = build(a.src, a.syn)
    z = {}
    for r in rows:
        z[zone_of(r)] = z.get(zone_of(r), 0) + 1
    print('%d naselja (%d opštine), %d synonyms, %d extra Cyrillic keys; %d bytes, gzip %d bytes; zones %s' % (
        len(rows), len({r['o'] for r in rows}), nsyn, extra, len(data), len(gzip.compress(data, 9)), z))
    if not a.check:
        with open(OUT, 'wb') as f:
            f.write(data)
        print('wrote ' + OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())

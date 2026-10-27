#!/usr/bin/env python3
"""The prerender's copy of the i18n engine's text functions equals the engine itself — nothing leaves this machine.

site/prerender.py re-implements nm() (whitespace), bk()/bf() (Evolako hashed as BlokVolt), hs() (FNV-1a base36 over
UTF-16 code units), the month rule (rum() for Russian) and tr() (en2/ru2, month rule, en/ru). This test takes those
functions out of the engine as the built pages carry it (dist/index.html), runs them in node with the live
dictionaries of a page (site/i18n/harvest.json), and compares them with the Python results for every Serbian text of
the built Serbian pages (text nodes and attributes), the dictionary keys' own outputs, month phrases and random strings
(whitespace and non-BMP characters included). Exit code 1 on any difference.
Usage: python3 site/tools/i18n_selftest.py [--page index]
"""
import argparse
import json
import os
import random
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
sys.path.insert(0, SITE_DIR)
sys.path.insert(0, HERE)
import prerender as PR  # noqa: E402
from i18n_harvest import expand  # noqa: E402

FUNCS = ('nm', 'bk', 'bf', 'hs', 'rum', 'tr')


def engine_functions(doc):
    i = doc.find(PR.ENGINE_MARKER)
    body = doc[i:doc.find('</script>', i)]
    out = []
    for name in FUNCS:
        m = re.search(r'function %s\(' % name, body)
        if not m:
            sys.exit('function %s not found in the engine' % name)
        # the function ends where the next top-level "function " starts or at the next blank-line section
        j = m.start()
        depth, k = 0, body.index('{', j)
        while True:
            c = body[k]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    break
            k += 1
        out.append(body[j:k + 1])
    return '\n'.join(out)


class Strings(PR.Translator):
    def __init__(self):
        super().__init__('en', {})
        self.seen = []

    def tr(self, s, record=True):
        self.seen.append(s)
        return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dist', default=os.path.join(SITE_DIR, 'dist'))
    ap.add_argument('--page', default='index')
    args = ap.parse_args()
    with open(os.path.join(args.dist, 'index.html'), encoding='utf-8') as f:
        js = engine_functions(f.read())
    with open(os.path.join(SITE_DIR, 'i18n', 'harvest.json'), encoding='utf-8') as f:
        pages = expand(json.load(f))
    # texts: every Serbian text node and attribute of the built Serbian pages, translations, edge cases
    coll = Strings()
    for fn in sorted(os.listdir(args.dist)):
        if fn.endswith('.html'):
            with open(os.path.join(args.dist, fn), encoding='utf-8') as f:
                PR.translate_body(f.read(), coll)
    texts = list(dict.fromkeys(coll.seen))
    for lang in PR.LANGS:
        for d in pages[args.page][lang]['dicts'].values():
            texts += list(d.values())[:300]
    texts += ['%s mesec%s' % (n, s) for n in ('1', '2', '3', '5', '11', '12', '21', '22', '25', '2,5', '1.5', '0')
              for s in ('', 'a', 'i')] + ['3  MESECA', ' 7 meseci ', 'Evolako', 'EVOLAKO evolako Blokvolt']
    rnd = random.Random(7)
    alphabet = 'abcčćdđšžEvolako    \t\n﻿\x85😀ЖжЀ€0123456789.,-—§'
    texts += [''.join(rnd.choice(alphabet) for _ in range(rnd.randint(0, 30))) for _ in range(500)]
    failures, n = [], 0
    for lang in PR.LANGS:
        dicts = pages[args.page][lang]['dicts']
        tr = PR.Translator(lang, dicts)
        want = [[PR.nm(s), PR.key_of(s), tr.live(s)] for s in texts]
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, 't.json')
            with open(src, 'w', encoding='utf-8') as f:
                json.dump({'texts': texts, 'D': dicts, 'L': lang}, f, ensure_ascii=False)
            prog = ('const fs=require("fs");const I=JSON.parse(fs.readFileSync(%s,"utf8"));var D=I.D,L=I.L;\n%s\n'
                    'console.log(JSON.stringify(I.texts.map(s=>[nm(s),hs(bk(nm(s))),tr(s)])));' % (
                        json.dumps(src), js))
            res = subprocess.run(['node', '-e', prog], capture_output=True, text=True, timeout=120)
            if res.returncode:
                sys.exit('node failed: %s' % res.stderr[:500])
            got = json.loads(res.stdout)
        for s, w, g in zip(texts, want, got):
            n += 1
            if w != g:
                failures.append((lang, s[:60], w, g))
    print('i18n self-test: %d texts x %d languages compared with the engine of %s/index.html (%s), %d differences' % (
        len(texts), len(PR.LANGS), os.path.relpath(args.dist), ', '.join(FUNCS), len(failures)))
    for f in failures[:10]:
        print('   DIFF %s %r: python %r, engine %r' % f)
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Proof that a new build changes the Serbian site only where step 3 means to — nothing leaves this machine.

Compares site/dist with an earlier build of the same snapshot (e.g. the step-2b build): every Serbian page and the
404 must equal the earlier page with exactly the step-3 transformations of site/prerender.py applied, and nothing
else:
  * the i18n engine patched for real language URLs (ENGINE_PATCHES)
  * the path patches of inline scripts (INLINE_PATCHES: the Serbian path for scripts, menu selectors, the hidden
    legal-data placeholder in English too)
  * the language menu as links (header and footer chips: href + hreflang, the stale title "Uskoro" removed) and
    the four hreflang alternates after the canonical link (not on the 404)
Every other file must be byte-identical, except the copied scripts named in FILE_PATCHES (equal to the earlier file
with those patches), _headers and sitemap.xml (rewritten: the /en/ and /ru/ rules and URLs), and the new files
(en/, ru/, _a/evo-i18n/). Exit code 1 if anything else differs.

Usage: python3 site/tools/compare_builds.py --old <earlier dist> [--new site/dist]
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
sys.path.insert(0, SITE_DIR)
import prerender as PR  # noqa: E402

SITE = 'https://www.evolako.rs'


def expected_page(old, slug):
    doc, _ = PR.patch_engine(old, slug)
    doc = PR.patch_inline(doc, {})
    if slug == '404':
        return doc
    doc, n_menu, n_chips = PR.language_menu(doc, slug)
    i = doc.find('rel="canonical"')
    i = doc.rfind('<link', 0, i)
    j = doc.find('>', i) + 1
    return doc[:j] + PR.alternates(SITE, slug) + doc[j:]


def files(root):
    out = {}
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f)
            out[os.path.relpath(p, root)] = p
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--old', required=True)
    ap.add_argument('--new', default=os.path.join(SITE_DIR, 'dist'))
    args = ap.parse_args()
    old, new = files(args.old), files(args.new)
    problems, same, pages, patched, rewritten = [], 0, 0, [], []
    added = sorted(set(new) - set(old))
    removed = sorted(set(old) - set(new))
    for rel in removed:
        problems.append('missing in the new build: ' + rel)
    for rel in added:
        if not (rel.startswith(('en/', 'ru/', '_a/evo-i18n/'))):
            problems.append('new file outside en/, ru/, _a/evo-i18n/: ' + rel)
    file_patches = {}
    for name, a, b in PR.FILE_PATCHES:
        file_patches.setdefault(name, []).append((a, b))
    for rel in sorted(set(old) & set(new)):
        a = open(old[rel], 'rb').read()
        b = open(new[rel], 'rb').read()
        if '/' not in rel and rel.endswith('.html'):
            pages += 1
            want = expected_page(a.decode('utf-8'), rel[:-5])
            if b.decode('utf-8') != want:
                x, y = want, b.decode('utf-8')
                i = next((k for k in range(min(len(x), len(y))) if x[k] != y[k]), min(len(x), len(y)))
                problems.append('%s differs beyond the step-3 changes at %d: expected …%r… got …%r…' % (
                    rel, i, x[max(0, i - 60):i + 60], y[max(0, i - 60):i + 60]))
            continue
        if a == b:
            same += 1
            continue
        base = os.path.basename(rel)
        if base in file_patches:
            t = a.decode('utf-8')
            for x, y in file_patches[base]:
                t = t.replace(x, y)
            if t.encode('utf-8') == b:
                patched.append(base)
            else:
                problems.append('%s differs beyond its path patches' % rel)
            continue
        if rel in ('_headers', 'sitemap.xml'):
            rewritten.append(rel)
            continue
        problems.append('changed: ' + rel)
    print('compared %s (old) with %s (new): %d Serbian pages (with the 404) equal to the earlier ones with the step-3 changes '
          'only; %d other files byte-identical; patched scripts (FILE_PATCHES only): %s; rewritten: %s; new files: %d '
          '(%s)' % (args.old, args.new, pages, same, ', '.join(sorted(set(patched))) or 'none',
                    ', '.join(rewritten) or 'none', len(added),
                    ', '.join(sorted({r.split('/')[0] + ('/' + r.split('/')[1] if r.startswith('_a/') else '')
                                      for r in added}))))
    for p in problems:
        print('PROBLEM: ' + p)
    sys.exit(1 if problems else 0)


if __name__ == '__main__':
    main()

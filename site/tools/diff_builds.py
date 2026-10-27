#!/usr/bin/env python3
"""What a new build of www.evolako.rs changes against an earlier one — nothing leaves this machine.

For any change after step 3 (compare_builds.py is the step-3 proof). The content hash in the names of the files the
build changes (<name>.h<10 hex>.js / <name>.h<10 hex>-1.0.0.js) is taken out of paths and contents first, so a file
whose name moved only because a file it names moved does not count as changed. Then it lists the files only in one
build and the files whose content differs, with the first differences of each.

  --expect PATTERN   (repeatable) paths that may differ, as fnmatch patterns on the normalized path, e.g.
                     'cesta-pitanja.html' 'en/kontakt.html' '_a/*webflow.*.js'; exit code 1 if anything else differs
                     or a file appears or disappears outside the patterns too

Usage: python3 site/tools/diff_builds.py --old <earlier dist> [--new site/dist] [--expect PATTERN ...]
"""
import argparse
import fnmatch
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
# .h<hash> before the extension or a version suffix, or at the end of a runtime map entry '<assetId>/<name>.h<hash>'
HASHED = re.compile(r'\.h[0-9a-f]{10}(?=(?:-\d+\.\d+\.\d+)?\.[A-Za-z0-9]+(?![A-Za-z0-9])|["\'])')
TEXT = ('.html', '.js', '.css', '.xml', '.json', '.txt', '.svg', '_headers')


def files(root):
    out = {}
    for d, _, fs in os.walk(root):
        for f in fs:
            p = os.path.join(d, f)
            rel = os.path.relpath(p, root)
            key = HASHED.sub('', rel)
            if key in out:
                sys.exit('%s: two files normalize to %s' % (root, key))
            out[key] = p
    return out


def content(path):
    data = open(path, 'rb').read()
    if path.endswith(TEXT):
        return HASHED.sub('', data.decode('utf-8', 'replace')), True
    return data, False


def differences(a, b, n=3, ctx=70):
    out, i = [], 0
    while len(out) < n:
        k = next((k for k in range(i, min(len(a), len(b))) if a[k] != b[k]), None)
        if k is None:
            if len(a) != len(b):
                out.append('length %d -> %d, the rest: …%r… / …%r…' % (len(a), len(b), a[min(len(a), len(b)):][:ctx],
                                                                      b[min(len(a), len(b)):][:ctx]))
            break
        # end of this difference: the first point where the next 40 characters agree again (with a length shift)
        end_a, end_b = len(a), len(b)
        for j in range(k, min(len(a), len(b))):
            found = False
            for shift in range(-400, 401):
                jb = j + shift
                if 0 <= jb and jb + 40 <= len(b) and j + 40 <= len(a) and a[j:j + 40] == b[jb:jb + 40]:
                    end_a, end_b, found = j, jb, True
                    break
            if found:
                break
        out.append('at %d: …%r… -> …%r…' % (k, a[max(0, k - 20):min(end_a, k + ctx) + 20],
                                            b[max(0, k - 20):min(end_b, k + ctx) + 20]))
        if end_a >= len(a) or end_b >= len(b):
            break
        a, b, i = a[end_a:], b[end_b:], 0
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--old', required=True)
    ap.add_argument('--new', default=os.path.join(SITE_DIR, 'dist'))
    ap.add_argument('--expect', action='append', default=[])
    args = ap.parse_args()
    old, new = files(args.old), files(args.new)
    unexpected = 0

    def allowed(rel):
        return any(fnmatch.fnmatch(rel, p) for p in args.expect)

    for label, keys in (('only in the old build', sorted(set(old) - set(new))),
                        ('only in the new build', sorted(set(new) - set(old)))):
        for rel in keys:
            ok = allowed(rel)
            unexpected += not ok
            print('%s%s: %s' % ('' if ok else 'UNEXPECTED ', label, rel))
    same = renamed = 0
    for rel in sorted(set(old) & set(new)):
        a, text = content(old[rel])
        b, _ = content(new[rel])
        moved = os.path.relpath(old[rel], args.old) != os.path.relpath(new[rel], args.new)
        if a == b:
            same += 1
            renamed += moved
            continue
        ok = allowed(rel)
        unexpected += not ok
        print('%schanged: %s%s' % ('' if ok else 'UNEXPECTED ', rel,
                                   ' (now %s)' % os.path.relpath(new[rel], args.new) if moved else ''))
        if text:
            for d in differences(a, b):
                print('    ' + d)
    print('%d files equal after taking the content hash out of names (%d of them under a new name); %d unexpected '
          'differences' % (same, renamed, unexpected))
    sys.exit(1 if unexpected and args.expect else 0)


if __name__ == '__main__':
    main()

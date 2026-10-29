#!/usr/bin/env python3
"""
build.py — step 2 of the naselja build: assemble naselja-srbija.json from the tables extracted in the
browser (step 1: build_browser.js, step 1b: crosscheck_osm_browser.js).

    python3 build.py              # verify raw/ against raw/SHA256SUMS.browser, write naselja-srbija.json + build_stats.json
    python3 build.py --with-id    # also "id" = RZS settlement code (matični broj naselja) -> naselja-srbija.with-id.json
    python3 build.py --no-osm     # do not take any coordinate from OpenStreetMap: Wikidata points that fail the
                                  # boundary check become null (pure RZS + Wikidata/CC0 build) -> naselja-srbija.no-osm.json

Inputs (raw/, pipe-separated, UTF-8, verified against SHA256SUMS.browser):
  rzs_wd_settlements.psv   code|cyrillic|municipality code|wd lat|wd lon|pop 2022|type G/O|pop source|RZS Latin if it
                           differs from plain transliteration|other Wikidata coordinates (lat,lon;lat,lon)
  rzs_municipalities.psv   municipality code|name Cyrillic|name Latin|NSTJ oblast code|census 2022 population
  rzs_counts_1201.psv      unit|name|official number of settlements (RZS 1201IND01, latest year); NSTJ names; CITY points
  naselje_bbox_check.psv   every settlement whose (first) Wikidata point is NOT inside the bounding box of its official
                           boundary (OSM relation with ref:RS:naselje = RZS code; boundaries imported from RGZ):
                           code|cyr|mb|status|wd lat|wd lon|osm node lat|osm node lon|osm node inside (1/0)|bbox centre lat|lon|bbox
                           status ALTIN = another Wikidata point is inside; WDOUT = none is; WDNONE = no Wikidata point
  naselje_polygon_check.psv  (optional) every settlement whose point after the bbox step is NOT inside its own official
                           boundary polygon (Overpass is_in): code|settlements containing the old point|status|new lat|
                           new lon|old lat|old lon; status OSMIN / WDALTIN / BBCIN = that candidate point is inside,
                           INTERIOR = point computed inside the boundary geometry, KEEP = no fix found (point kept)
  osm_crosscheck_gt3km.psv (documentation only) Wikidata vs OSM place node > 3 km

Every rule that changes source data is a named constant below and is listed in report.md.
"""
import argparse, collections, gzip, hashlib, json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))

# ---------------------------------------------------------------------------------------------------------------
# Reference tables and documented corrections
# ---------------------------------------------------------------------------------------------------------------
OKRUG = {   # NSTJ oblast (= upravni okrug) -> "ok"
    'RS110': 'Grad Beograd',
    'RS121': 'Zapadnobački okrug', 'RS122': 'Južnobanatski okrug', 'RS123': 'Južnobački okrug',
    'RS124': 'Severnobanatski okrug', 'RS125': 'Severnobački okrug', 'RS126': 'Srednjobanatski okrug',
    'RS127': 'Sremski okrug',
    'RS211': 'Zlatiborski okrug', 'RS212': 'Kolubarski okrug', 'RS213': 'Mačvanski okrug', 'RS214': 'Moravički okrug',
    'RS215': 'Pomoravski okrug', 'RS216': 'Rasinski okrug', 'RS217': 'Raški okrug', 'RS218': 'Šumadijski okrug',
    'RS221': 'Borski okrug', 'RS222': 'Braničevski okrug', 'RS223': 'Zaječarski okrug', 'RS224': 'Jablanički okrug',
    'RS225': 'Nišavski okrug', 'RS226': 'Pirotski okrug', 'RS227': 'Podunavski okrug', 'RS228': 'Pčinjski okrug',
    'RS229': 'Toplički okrug',
}
REGION = {'RS11': 'Beograd', 'RS12': 'Vojvodina', 'RS21': 'Šumadija i Zapadna Srbija', 'RS22': 'Južna i Istočna Srbija'}
KOSOVO_PREFIX = '9'          # RZS codes 9xxxxx = AP Kosovo i Metohija (oblasti RS231-RS235); never extracted

# The RZS Cyrillic and Latin registers disagree, or the Cyrillic register has a technical defect
NAME_FIXES = {
    '707244': ('Đerekare', 'Ђерекаре', 'RZS Cyrillic "Ђерекари" vs RZS Latin "Đerekare"; the -e form is also used by the RGZ boundary and Wikidata'),
    '707350': ('Kovizle', 'Ковизле', 'RZS Cyrillic "Ковизла" vs RZS Latin "Kovizle"; the -e form is also used by the RGZ boundary and Wikidata'),
    '713937': ('Despotovac', 'Деспотовац', 'RZS Cyrillic keeps the old qualifier "Деспотовац (варошица)"; RZS Latin, RGZ boundary and Wikidata say "Despotovac" (no other settlement of that name in the municipality)'),
    '731960': ('Petrovac na Mlavi', 'Петровац на Млави', 'RZS Cyrillic "Петровац", RZS Latin and RGZ boundary "Petrovac na Mlavi" (name of the town and municipality); also tells it apart from 5 villages named Petrovac'),
    '804126': ('Zasavica I', 'Засавица I', 'Roman numeral written as Cyrillic "И" in the RZS Cyrillic register (RGZ boundary: "Засавица I")'),
    '804134': ('Zasavica II', 'Засавица II', 'Roman numeral written as Cyrillic "ИИ" in the RZS Cyrillic register (RGZ boundary: "Засавица II")'),
}
# Latin look-alike letters that slipped into the RZS Cyrillic register (e.g. "Власaница" with a Latin "a")
HOMOGLYPHS = str.maketrans({'a': 'а', 'e': 'е', 'o': 'о', 'p': 'р', 'c': 'с', 'x': 'х', 'y': 'у', 'j': 'ј',
                            'A': 'А', 'B': 'В', 'E': 'Е', 'K': 'К', 'M': 'М', 'H': 'Н', 'O': 'О', 'P': 'Р',
                            'C': 'С', 'T': 'Т', 'X': 'Х', 'J': 'Ј'})
# Second coordinate pass (naselje_polygon_check.psv): which replacement point was found inside the own boundary polygon
PIP_SRC = {'OSMIN': 'osm-node-polygon', 'WDALTIN': 'wd-alt-polygon', 'BBCIN': 'bbox-centre-polygon', 'INTERIOR': 'osm-interior'}
# Statistical parts of one urban settlement -> one row (as the official count of naselja does)
MERGE = {
    'Београд (': dict(n='Beograd', c='Београд', o='Beograd', city_cyr='Београд'),
    'Ниш (': dict(n='Niš', c='Ниш', o='Niš', city_cyr='Ниш'),
}

T = {'А': 'A', 'Б': 'B', 'В': 'V', 'Г': 'G', 'Д': 'D', 'Ђ': 'Đ', 'Е': 'E', 'Ж': 'Ž', 'З': 'Z', 'И': 'I', 'Ј': 'J', 'К': 'K',
     'Л': 'L', 'Љ': 'Lj', 'М': 'M', 'Н': 'N', 'Њ': 'Nj', 'О': 'O', 'П': 'P', 'Р': 'R', 'С': 'S', 'Т': 'T', 'Ћ': 'Ć', 'У': 'U',
     'Ф': 'F', 'Х': 'H', 'Ц': 'C', 'Ч': 'Č', 'Џ': 'Dž', 'Ш': 'Š'}
T.update({k.lower(): v.lower() for k, v in list(T.items())})


def translit(s):
    """Serbian Cyrillic -> Latin (Љ->Lj, Њ->Nj, Џ->Dž, Ђ->Đ, Ћ->Ć, Ч->Č, Ш->Š, Ж->Ž; LJ/NJ/DŽ before a capital)."""
    out = []
    for i, ch in enumerate(s):
        t = T.get(ch)
        if t is None:
            out.append(ch)
        elif len(t) == 2 and ch.isupper() and i + 1 < len(s) and s[i + 1].isupper() and s[i + 1] in T:
            out.append(t.upper())
        else:
            out.append(t)
    return ''.join(out)


# Serbian Latin alphabetical order (abeceda), computed on the Cyrillic spelling so that lj/nj/dž are single letters
ORDER = {ch: i for i, ch in enumerate('АБЦЧЋДЏЂЕФГХИЈКЛЉМНЊОПРСШТУВЗЖ')}


def sr_key(cyr):
    return tuple(-1 if ch == ' ' else ORDER.get(ch.upper(), 100 + ord(ch)) for ch in cyr)


def read_psv(path, ncols=None):
    rows = []
    for line in open(path, encoding='utf-8').read().split('\n'):
        if not line:
            continue
        f = line.split('|')
        if ncols and len(f) != ncols:
            raise SystemExit(f'{path}: bad line {line!r}')
        rows.append(f)
    return rows


def verify(raw):
    sums = {}
    for line in open(os.path.join(raw, 'SHA256SUMS.browser'), encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        h, name = line.split(None, 1)
        sums[name.strip()] = h
    ok = []
    for name, h in sums.items():
        p = os.path.join(raw, name)
        if os.path.exists(p):
            got = hashlib.sha256(open(p, 'rb').read()).hexdigest()
            if got != h:
                raise SystemExit(f'checksum mismatch for {name}: {got} != {h}')
            ok.append(name)
    return sorted(ok)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--raw', default=os.path.join(HERE, 'raw'))
    ap.add_argument('--out', default=HERE)
    ap.add_argument('--with-id', action='store_true', help='add "id" (RZS settlement code) to every object')
    ap.add_argument('--no-osm', action='store_true', help='never use OpenStreetMap coordinates (failed points -> null)')
    args = ap.parse_args()
    verified = verify(args.raw)

    # ---------------- load ----------------
    ops = {f[0]: dict(cyr=f[1], lat=f[2], nstj=f[3]) for f in read_psv(os.path.join(args.raw, 'rzs_municipalities.psv'), 5)}
    official, cities = {}, {}
    for f in read_psv(os.path.join(args.raw, 'rzs_counts_1201.psv')):
        if f[0] == 'CITY':
            lon, lat = f[3][len('Point('):-1].split()
            cities[f[1]] = (float(lat), float(lon), f[2])
        elif f[0] != 'NSTJ':
            official[f[0]] = (f[1], int(f[2]) if f[2] else 0)
    bbox = {f[0]: f for f in read_psv(os.path.join(args.raw, 'naselje_bbox_check.psv'))}
    pip_path = os.path.join(args.raw, 'naselje_polygon_check.psv')
    pip = {f[0]: f for f in read_psv(pip_path, 7)} if os.path.exists(pip_path) else {}

    log = collections.defaultdict(list)
    units = []
    for code, cyr, mb, la, lo, pop, typ, psrc, rzs_lat, alt in read_psv(os.path.join(args.raw, 'rzs_wd_settlements.psv'), 10):
        assert not code.startswith(KOSOVO_PREFIX)
        # names
        c = cyr
        if code in NAME_FIXES:
            n, c, why = NAME_FIXES[code]
            log['name_fix'].append((code, cyr, rzs_lat or translit(cyr), n, c, why))
        else:
            c2 = c.translate(HOMOGLYPHS)
            if c2 != c:
                log['homoglyph'].append((code, c, c2))
                c = c2
            n = rzs_lat or translit(c)
        assert translit(c) == n, (code, c, n)
        # population
        if pop:
            p = int(pop)
        elif psrc == 'C22':
            p = 0                                      # census 2022 status "M" (podaci ne mogu postojati) = no inhabitants
            log['zero_pop'].append((code, n, ops[mb]['lat']))
        else:
            p = None
        if psrc == 'M22':
            log['pop_from_municipality'].append((code, n, ops[mb]['lat'], p))
        # coordinates: Wikidata point validated against the official settlement boundary (bbox)
        src, ll = 'wd', (float(la), float(lo)) if la else None
        b = bbox.get(code)
        if b and b[3] == 'ALTIN':
            ll, src = (float(b[4]), float(b[5])), 'wd-alt'
            log['coord_wd_alt'].append((code, n, ops[mb]['lat'], (float(la), float(lo)), ll))
        elif b and b[3] == 'WDOUT' and not code.startswith('79'):
            wd_pt = (float(b[4]), float(b[5]))
            if args.no_osm:
                ll, src = None, 'none'
            elif b[8] == '1':
                ll, src = (float(b[6]), float(b[7])), 'osm-node'
            else:
                ll, src = (float(b[9]), float(b[10])), 'bbox-centre'
            log['coord_replaced'].append((code, n, ops[mb]['lat'], wd_pt, ll, src))
        # coordinates, second pass: is the point inside the official boundary polygon itself (not only its bbox)?
        pf = pip.get(code)
        if pf and ll is not None:
            frm = (float(pf[5]), float(pf[6]))
            if args.no_osm and src not in ('wd', 'wd-alt'):
                pass                                   # the point is already null in this variant
            else:
                assert abs(ll[0] - frm[0]) < 5e-6 and abs(ll[1] - frm[1]) < 5e-6, (code, ll, frm)
                if pf[2] in PIP_SRC and (pf[2] == 'WDALTIN' or not args.no_osm):
                    ll, src = (float(pf[3]), float(pf[4])), PIP_SRC[pf[2]]
                log['coord_polygon'].append((code, n, ops[mb]['lat'], frm, ll, pf[2], pf[1]))
        units.append(dict(code=code, cyr=cyr, c=c, n=n, mb=mb, p=p, typ=typ, ll=ll, src=src))

    # ---------------- assemble rows ----------------
    out, merged = [], collections.defaultdict(list)
    for u in units:
        key = next((k for k in MERGE if u['cyr'].startswith(k)), None)
        if key:
            merged[key].append(u)
            continue
        nstj = ops[u['mb']]['nstj']
        o = ops[u['mb']]['lat']
        t = 'grad' if u['typ'] == 'G' else 'selo'
        if t == 'selo' and u['n'] == o:               # seat of the opština / grad / gradska opština = town
            t = 'grad'
            log['seat_as_grad'].append((u['code'], u['n'], u['p']))
        out.append(dict(id=u['code'], n=u['n'], c=u['c'], o=o, ok=OKRUG[nstj], r=REGION[nstj[:4]],
                        lat=round(u['ll'][0], 5) if u['ll'] else None, lon=round(u['ll'][1], 5) if u['ll'] else None,
                        p=u['p'], t=t, mb=u['mb'], src=u['src'], rzs_type=u['typ']))
    for key, parts in merged.items():
        spec = MERGE[key]
        nstj = ops[parts[0]['mb']]['nstj']
        lat, lon, qid = cities[spec['city_cyr']]
        assert all(ops[p['mb']]['nstj'] == nstj for p in parts) and all(p['typ'] == 'G' for p in parts)
        mid, src = min(p['code'] for p in parts), 'wd-city'
        if mid in pip and pip[mid][2] in PIP_SRC and not args.no_osm:   # city point outside all of its parts
            lat, lon, src = float(pip[mid][3]), float(pip[mid][4]), PIP_SRC[pip[mid][2]]
        out.append(dict(id=mid, n=spec['n'], c=spec['c'], o=spec['o'], ok=OKRUG[nstj], r=REGION[nstj[:4]],
                        lat=round(lat, 5), lon=round(lon, 5), p=sum(p['p'] for p in parts), t='grad', mb=None,
                        src=src, rzs_type='G'))
        log['merged'].append((spec['n'], len(parts), sum(p['p'] for p in parts), [p['cyr'] for p in parts], qid))

    out.sort(key=lambda r: (-(r['p'] if r['p'] is not None else -1), sr_key(r['c']), r['o']))

    keys = (['id'] if args.with_id else []) + ['n', 'c', 'o', 'ok', 'r', 'lat', 'lon', 'p', 't']
    body = ',\n'.join(json.dumps({k: r[k] for k in keys}, ensure_ascii=False, separators=(',', ':')) for r in out)
    data = ('[\n' + body + '\n]\n').encode('utf-8')
    suffix = ('.with-id' if args.with_id else '') + ('.no-osm' if args.no_osm else '')
    fname = f'naselja-srbija{suffix}.json'
    with open(os.path.join(args.out, fname), 'wb') as fh:
        fh.write(data)

    # ---------------- statistics for report.md ----------------
    st = dict(file=fname, rows=len(out), bytes=len(data), gzip_bytes=len(gzip.compress(data, 9)), verified_inputs=verified)
    st['per_region'] = dict(collections.Counter(r['r'] for r in out))
    nstj_of_okrug = {v: k for k, v in OKRUG.items()}
    per_ok = collections.Counter(r['ok'] for r in out)
    st['okrug_vs_official'] = {ok: (per_ok[ok], official[nstj_of_okrug[ok]][1]) for ok in OKRUG.values()}
    st['region_vs_official'] = {REGION[k]: (st['per_region'].get(REGION[k], 0), official[k][1]) for k in REGION}
    st['official_total_RS'], st['official_kosovo'] = official['RS'][1], official['RS23'][1]
    st['official_without_kosovo'] = official['RS'][1] - official['RS23'][1]
    per_mb = collections.Counter(r['mb'] for r in out if r['mb'])
    st['municipality_mismatches'] = [(mb, ops[mb]['lat'], cnt, official.get(mb, (None, None))[1])
                                     for mb, cnt in sorted(per_mb.items()) if official.get(mb, (None, None))[1] != cnt]
    st['municipalities'] = len(per_mb)
    st['type'] = dict(collections.Counter(r['t'] for r in out))
    st['type_rzs'] = dict(collections.Counter(r['rzs_type'] for r in out))
    st['coord_source'] = dict(collections.Counter(r['src'] for r in out))
    st['population_sum'] = sum(r['p'] for r in out if r['p'])
    st['population_null'] = sum(1 for r in out if r['p'] is None)
    st['population_zero'] = sum(1 for r in out if r['p'] == 0)
    st['coords_null'] = sum(1 for r in out if r['lat'] is None)
    names = collections.Counter(r['n'] for r in out)
    dup = {n: c for n, c in names.items() if c > 1}
    st['duplicate_names'], st['rows_with_duplicate_name'] = len(dup), sum(dup.values())
    st['top_duplicates'] = sorted(dup.items(), key=lambda x: (-x[1], sr_key(x[0])))[:30]
    same_ok = collections.Counter((r['n'], r['ok']) for r in out)
    st['duplicate_name_same_okrug'] = sorted([(n, ok, c) for (n, ok), c in same_ok.items() if c > 1])
    st['duplicate_name_same_municipality'] = sorted([(n, o) for (n, o), c in collections.Counter((r['n'], r['o']) for r in out).items() if c > 1])
    st['big_selo'] = [(r['n'], r['o'], r['p']) for r in out if r['t'] == 'selo' and r['p'] and r['p'] >= 5000]
    st['small_grad'] = [(r['n'], r['o'], r['p']) for r in out if r['t'] == 'grad' and r['p'] is not None and r['p'] < 1000]
    st['qualifier_names'] = sorted(r['n'] for r in out if '(' in r['n'])
    st['top10'] = [(r['n'], r['o'], r['p']) for r in out[:10]]
    st['log'] = dict(log)
    with open(os.path.join(args.out, 'build_stats' + suffix + '.json'), 'w', encoding='utf-8') as fh:
        json.dump(st, fh, ensure_ascii=False, indent=1, default=list)
    print(json.dumps({k: st[k] for k in ('file', 'rows', 'bytes', 'gzip_bytes', 'per_region', 'type', 'coord_source', 'coords_null',
                                         'population_sum', 'population_zero', 'official_without_kosovo', 'duplicate_names',
                                         'rows_with_duplicate_name', 'municipality_mismatches')}, ensure_ascii=False))
    print('log:', {k: len(v) for k, v in log.items()})


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Public-charging facts of the city pages of www.evolako.rs (/ugradnja-punjaca-<grad>), from the charger map of
BlokVolt (github.com/hemptoon/blokvolt-rs — the same data the map on /mapa-punjaca shows).

The cities and their names (site/content/gradovi/gradovi.json, "cities": slug, names, regions) are written by hand;
this tool only refreshes each city's "public" block and the dates:

    git clone --depth 1 https://github.com/hemptoon/blokvolt-rs /tmp/bv   # read-only: nothing is committed there
    python3 site/tools/gradovi_data.py --blokvolt /tmp/bv [--date 2026-10-28]

It runs BlokVolt's build in that checkout (≈ 1,5 min, writes only its dist/) and counts, for every city, the stations
the BlokVolt town pages count: the map stations whose nearest town (scripts/map_data.py TOWNS, within 25 km) is the
city. Kept per city: how many, how many with a DC charger of 50 kW or more, the strongest DC charger confirmed on
the map (name, network, power, distance from the centre), the charging networks BlokVolt describes, the BlokVolt town page if there is one, and —
when the area has no confirmed DC charger of 50 kW or more — the nearest such charger anywhere.
Then `python3 site/build.py` and the checks of site/content/README.md.
"""
import argparse
import contextlib
import datetime
import io
import json
import os
import re
import runpy
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'content', 'gradovi', 'gradovi.json')


def clean_name(s, address):
    """Station names as networks write them, without the network's own prefix ("charge&go Stop Shop Vršac")."""
    n = re.sub(r'(?i)^\s*charge\s*&\s*go\s*[-–—]?\s*', '', s or '').strip()
    n = re.sub(r'(?i)\s*[-–—]\s*edrive app\s*$', '', n).strip()
    return n or (address or '').strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--blokvolt', required=True, help='a checkout of github.com/hemptoon/blokvolt-rs')
    ap.add_argument('--date', default=datetime.date.today().isoformat(), help='the date of the check (YYYY-MM-DD)')
    a = ap.parse_args()
    bv = os.path.abspath(a.blokvolt)
    commit = subprocess.run(['git', '-C', bv, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True,
                            check=True).stdout.strip()
    with open(DATA, encoding='utf-8') as f:
        data = json.load(f)
    cwd = os.getcwd()
    os.chdir(bv)
    sys.path.insert(0, bv)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            g = runpy.run_path(os.path.join(bv, 'build.py'), run_name='__main__')
    finally:
        os.chdir(cwd)
    stations, md = g['MAP']['stations'], g['map_data']
    ops = {o['slug']: o['name'] for o in g['operators']}
    xy = {t[0]: (t[1], t[2]) for t in md.TOWNS}
    town_urls = g['TOWN_URLS']

    def net(s):
        return ops.get(s.get('net') or '') or re.sub(r'\s*\(.*?\)', '', s.get('opn') or '').strip()

    def km(c, s):
        return round(md.dist_m({'latitude': xy[c][0], 'longitude': xy[c][1]},
                               {'latitude': s['lat'], 'longitude': s['lon']}) / 1000, 1)

    def entry(c, s):
        return {'name': clean_name(s.get('n'), s.get('a')), 'net': net(s), 'dc': s.get('dc') or 0, 'km': km(c, s),
                'town': s.get('t') or ''}

    for city in data['cities']:
        c = city['name']
        if c not in xy:
            sys.exit('%s is not a town of BlokVolt scripts/map_data.py TOWNS' % c)
        here = [s for s in stations if (s.get('t') or '') == c]
        fast = [s for s in here if (s.get('dc') or 0) >= 50 and (s.get('v') or {}).get('s') == 'ok']
        fast.sort(key=lambda s: (-(s.get('dc') or 0), not net(s), km(c, s)))
        nets = {}                  # the charging networks BlokVolt describes (content/operateri), not every owner
        for s in here:
            if ops.get(s.get('net') or ''):
                nets[ops[s['net']]] = nets.get(ops[s['net']], 0) + 1
        pub = {'n': len(here), 'n_dc50': sum(1 for s in here if (s.get('dc') or 0) >= 50),
               'nets': [k for k, _ in sorted(nets.items(), key=lambda x: (-x[1], x[0].lower()))],
               'best': entry(c, fast[0]) if fast else None,
               'bv_url': ('https://www.blokvolt.rs' + town_urls[c]) if c in town_urls else None}
        if not fast:
            anywhere = [s for s in stations if (s.get('dc') or 0) >= 50 and (s.get('v') or {}).get('s') == 'ok']
            pub['nearest_dc50'] = entry(c, min(anywhere, key=lambda s: km(c, s)))
        city['public'] = pub
    data['map'] = {'checked': g['MAP'].get('checked'), 'date': a.date, 'source': 'hemptoon/blokvolt-rs %s' % commit,
                   'stations': len(stations)}
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    for city in data['cities']:
        p = city['public']
        print('%-18s %3d stations, %2d DC ≥ 50 kW, best %s' % (city['name'], p['n'], p['n_dc50'],
                                                                  p['best'] or ('nearest %s' % p.get('nearest_dc50'))))
    print('map checked %s, %d stations (%s)' % (data['map']['checked'], len(stations), data['map']['source']))


if __name__ == '__main__':
    main()

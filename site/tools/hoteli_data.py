#!/usr/bin/env python3
"""Public-charging facts of the resort pages of www.evolako.rs (/punjaci-za-hotele-<mesto>, site/hoteli.py), from the
charger map of BlokVolt (github.com/hemptoon/blokvolt-rs — the data the map on /mapa-punjaca shows).

The places, their names and the routes (site/content/hoteli/mesta.json, "places") are written by hand; this tool only
refreshes each place's "public" block (the stations of its BlokVolt town area) and the "facts" of its routes:

    git clone --depth 1 https://github.com/hemptoon/blokvolt-rs /tmp/bv   # read-only: nothing is committed there
    python3 site/tools/hoteli_data.py --blokvolt /tmp/bv [--date 2026-11-16]

It runs BlokVolt's build in that checkout (≈ 1,5 min, writes only its dist/) — or reads a station list saved before
(--stations file.json: {"checked": "DD.MM.YYYY", "stations": [...], "operators": {slug: name}, "town_urls": {...}}).

Per place: how many locations the map has in its town area (the stations whose nearest BlokVolt town, within 25 km, is
the place), how many with a DC charger of 50 kW or more, the strongest confirmed one, the networks BlokVolt describes,
how many locations are at hotels and other places to stay (by the station name: STAY below, plus the hand-written
"stay_add" / "stay_not" ids of the place) and how many of those the map marks as for guests only (acc "customers").

Per route (from Beograd, from Novi Sad): "km" and "min" are the fastest route of routing.openstreetmap.de (OSRM on
OpenStreetMap data) on the day in "routing.date", and "along" lists the map stations with DC >= 50 kW within 5 km of
that route, from the 15th kilometre on, each with its kilometre — computed with corridor() below from the route's
polyline (in a browser on 16.11.2026, because the build machine had no access to the routing service; `--routes fetch`
repeats it where the service is reachable). The tool checks every listed station against the map of the day and
writes "facts": how many are still there with a confirmed DC charger, the last one before the place and how far the
place is after it.
"""
import argparse
import contextlib
import datetime
import io
import json
import math
import os
import re
import runpy
import subprocess
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), 'content', 'hoteli', 'mesta.json')
STAY = re.compile(r'(?i)\b(hotel|vila|villa|apartman\w*|apartments?|resort|guest house|chalet|camping|kamp|konak|lodge|pansion)\b')
ORIGINS = {'beograd': (44.8125, 20.4612), 'novi-sad': (45.2671, 19.8335)}   # BlokVolt scripts/map_data.py TOWNS
CORRIDOR_KM, SKIP_KM, AT_PLACE_KM = 5.0, 15.0, 10.0
ROUTER = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/%s,%s;%s,%s?overview=full&geometries=geojson'


def clean_name(s, address):
    """Station names as networks write them, without the network's own prefix ("charge&go Stop Shop Vršac")."""
    n = re.sub(r'(?i)^\s*charge\s*&\s*go\s*(\d+\s*)?[-–—]?\s*', '', s or '').strip()
    n = re.sub(r'(?i)^BS\s+', '', n).strip()
    n = re.sub(r'(?i)\s*[-–—]\s*edrive app\s*$', '', n).strip()
    return n or (address or '').strip()


def dist_km(lat1, lon1, lat2, lon2):
    la1, lo1, la2, lo2 = map(math.radians, (lat1, lon1, lat2, lon2))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def corridor(coords, route_km, stations):
    """Stations with DC >= 50 kW within CORRIDOR_KM of the polyline (coords: [[lon, lat], …]) from SKIP_KM on:
    [[id, km along the route]], in driving order. Flat-earth distances around 44° N, scaled to the route length."""
    r = math.pi / 180

    def xy(lon, lat):
        return lon * math.cos(44 * r) * 111.32, lat * 110.574
    c = [xy(*p) for p in coords]
    cum = [0.0]
    for i in range(1, len(c)):
        cum.append(cum[-1] + math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]))
    scale = route_km / cum[-1]
    hits = []
    for s in stations:
        if (s.get('dc') or 0) < 50:
            continue
        p = xy(s['lon'], s['lat'])
        best, at = 1e9, 0.0
        for i in range(1, len(c)):
            ax, ay, bx, by = c[i - 1][0], c[i - 1][1], c[i][0], c[i][1]
            dx, dy = bx - ax, by - ay
            ln = dx * dx + dy * dy
            t = max(0.0, min(1.0, ((p[0] - ax) * dx + (p[1] - ay) * dy) / ln)) if ln else 0.0
            d = math.hypot(p[0] - (ax + t * dx), p[1] - (ay + t * dy))
            if d < best:
                best, at = d, (cum[i - 1] + t * math.sqrt(ln)) * scale
        if best <= CORRIDOR_KM and round(at) >= SKIP_KM:
            hits.append([s['id'], int(round(at))])
    return sorted(hits, key=lambda h: h[1])


def load_map(a):
    if a.stations:
        with open(a.stations, encoding='utf-8') as f:
            d = json.load(f)
        return d['stations'], d['operators'], d.get('town_urls') or {}, d['checked'], d.get('source') or os.path.basename(a.stations)
    bv = os.path.abspath(a.blokvolt)
    commit = subprocess.run(['git', '-C', bv, 'rev-parse', '--short', 'HEAD'], capture_output=True, text=True,
                            check=True).stdout.strip()
    cwd = os.getcwd()
    os.chdir(bv)
    sys.path.insert(0, bv)
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            g = runpy.run_path(os.path.join(bv, 'build.py'), run_name='__main__')
    finally:
        os.chdir(cwd)
    return (g['MAP']['stations'], {o['slug']: o['name'] for o in g['operators']}, dict(g['TOWN_URLS']),
            g['MAP'].get('checked'), 'hemptoon/blokvolt-rs %s' % commit)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--blokvolt', help='a checkout of github.com/hemptoon/blokvolt-rs')
    ap.add_argument('--stations', help='a station list saved before, instead of --blokvolt')
    ap.add_argument('--date', default=datetime.date.today().isoformat(), help='the date of the check (YYYY-MM-DD)')
    ap.add_argument('--routes', choices=['keep', 'fetch'], default='keep',
                    help='fetch: ask routing.openstreetmap.de for the routes again and recompute "along"')
    a = ap.parse_args()
    if not a.blokvolt and not a.stations:
        ap.error('--blokvolt or --stations')
    stations, ops, town_urls, checked, source = load_map(a)
    by_id = {s['id']: s for s in stations}
    with open(DATA, encoding='utf-8') as f:
        data = json.load(f)

    def net(s):
        return ops.get(s.get('net') or '') or re.sub(r'\s*\(.*?\)', '', s.get('opn') or '').strip()

    def ok(s):
        return (s.get('v') or {}).get('s') == 'ok'

    for pl in data['places']:
        here = [s for s in stations if (s.get('t') or '') == pl['town']]
        if not here:
            sys.exit('%s: no station of the map has this BlokVolt town' % pl['town'])
        lat = sum(s['lat'] for s in here) / len(here)          # only for the distance of the strongest charger
        lon = sum(s['lon'] for s in here) / len(here)
        centre = pl.get('centre') or [round(lat, 4), round(lon, 4)]
        fast = sorted((s for s in here if (s.get('dc') or 0) >= 50 and ok(s)),
                      key=lambda s: (-(s.get('dc') or 0), dist_km(centre[0], centre[1], s['lat'], s['lon'])))
        nets = {}
        for s in here:
            if ops.get(s.get('net') or ''):
                nets[ops[s['net']]] = nets.get(ops[s['net']], 0) + 1
        stay = [s for s in here if (STAY.search(s.get('n') or '') or s['id'] in pl.get('stay_add', []))
                and s['id'] not in pl.get('stay_not', [])]
        pl['public'] = {
            'n': len(here), 'n_dc50': sum(1 for s in here if (s.get('dc') or 0) >= 50),
            'n_stay': len(stay), 'n_stay_guests': sum(1 for s in stay if s.get('acc') == 'customers'),
            'nets': [k for k, _ in sorted(nets.items(), key=lambda x: (-x[1], x[0].lower()))],
            'best': ({'name': clean_name(fast[0].get('n'), fast[0].get('a')), 'net': net(fast[0]), 'dc': fast[0]['dc'],
                      'km': round(dist_km(centre[0], centre[1], fast[0]['lat'], fast[0]['lon']), 1),
                      'address': (fast[0].get('a') or '').strip()} if fast else None),
            'bv_url': ('https://www.blokvolt.rs' + town_urls[pl['town']]) if pl['town'] in town_urls else None,
            'stay_names': sorted(clean_name(s.get('n'), s.get('a')) for s in stay)}
        for key, rt in pl['routes'].items():
            if a.routes == 'fetch':
                o = ORIGINS[key]
                with urllib.request.urlopen(ROUTER % (o[1], o[0], centre[1], centre[0]), timeout=60) as r:
                    j = json.load(r)
                best = j['routes'][0]
                rt['km'], rt['min'] = round(best['distance'] / 1000, 1), int(round(best['duration'] / 60))
                rt['along'] = corridor(best['geometry']['coordinates'], rt['km'], stations)
                data['routing']['date'] = a.date
            gone = [i for i, _ in rt['along'] if i not in by_id]
            live = [(by_id[i], km) for i, km in rt['along'] if i in by_id and (by_id[i].get('dc') or 0) >= 50 and ok(by_id[i])]
            if not live:
                sys.exit('%s %s: no confirmed fast charger along the route' % (pl['slug'], key))
            def entry(x):
                s, km = x
                return {'name': clean_name(s.get('n'), s.get('a')), 'net': net(s), 'dc': s['dc'], 'km': km,
                        'km_after': int(round(rt['km'] - km))}
            # "last": the last fast charger of the route; "at_place": it stands at the place itself (10 km or less to
            # go); "prev": the last one before that, i.e. the last stop on the way
            before = [x for x in live if rt['km'] - x[1] > AT_PLACE_KM]
            rt['facts'] = {'n_fast': len(live), 'gone': gone, 'last': entry(live[-1]),
                           'at_place': rt['km'] - live[-1][1] <= AT_PLACE_KM,
                           'prev': entry(before[-1]) if before else None}
    data['map'] = {'checked': checked, 'date': a.date, 'source': source, 'stations': len(stations)}
    with open(DATA, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')
    for pl in data['places']:
        p = pl['public']
        print('%-15s %2d locations, %d DC ≥ 50 kW, %d at places to stay (%d guests only), best %s; nets %s' % (
            pl['name'], p['n'], p['n_dc50'], p['n_stay'], p['n_stay_guests'], p['best'], ', '.join(p['nets'])))
        print('   stay: ' + '; '.join(p['stay_names']))
        for key, rt in pl['routes'].items():
            f_ = rt['facts']
            print('   %-9s %.1f km, %d min, %d fast along; last %s (%s, %s kW) at km %d, %d km to go%s; before it %s%s' % (
                key, rt['km'], rt['min'], f_['n_fast'], f_['last']['name'], f_['last']['net'], f_['last']['dc'],
                f_['last']['km'], f_['last']['km_after'], ' (at the place)' if f_['at_place'] else '',
                ('%s at km %d, %d km to go' % (f_['prev']['name'], f_['prev']['km'], f_['prev']['km_after'])) if f_['prev'] else '-',
                ('; GONE ' + ','.join(f_['gone'])) if f_['gone'] else ''))
    print('map checked %s, %d stations (%s)' % (checked, len(stations), source))


if __name__ == '__main__':
    main()

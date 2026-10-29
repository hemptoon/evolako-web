#!/usr/bin/env python3
"""
build_sinonimi.py — builds naselja-sinonimi.json: search aliases that point to a row of naselja-srbija.json.

    python3 build.py --with-id && python3 build_sinonimi.py

Every alias: {"s": Latin, "c": Cyrillic, "n": target naselje name, "o": target opština, "k": kind, "trap": true?}
  k = "gradska opština" | "deo grada" | "varijanta"
  trap = the alias text is also the name of a real naselje elsewhere (all of them < TRAP_MAX_POP = 1000 inhabitants), so
         the UI should show the alias target (city district) first and the village second.

Inputs
  naselja-srbija.with-id.json      targets (n, o) and the codes used below
  raw/kvartovi_wiki.psv            quarters from sr.wikipedia lists/categories, located with OSM/Wikipedia points and a
                                   point-in-polygon test against the official urban naselja (crosscheck in the browser,
                                   see report.txt §13): name Cyrillic|city|target code|how located|source|wiki title|note
  constants in this file           gradske opštine, RZS/RGZ spelling variants, a few manually verified quarters
"""
import collections, hashlib, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from build import translit, sr_key  # noqa: E402

TRAP_MAX_POP = 1000
BEOGRAD, NIS = '791016', '792012'      # ids of the merged rows in naselja-srbija.with-id.json

# (a) gradske opštine -> main urban naselje (Cyrillic name, target id). RZS statistical units for Beograd, Novi Sad,
#     Niš, Požarevac, Užice, Vranje; Kragujevac's five gradske opštine exist by the city statute (sr.wikipedia articles
#     "Градска општина Аеродром/Пивара/Станово/Стари град (Крагујевац)/Страгари") but are not RZS units.
GRADSKE_OPSTINE = [
    # Grad Beograd (17)
    ('Барајево', '703494'), ('Вождовац', BEOGRAD), ('Врачар', BEOGRAD), ('Гроцка', '703737'), ('Звездара', BEOGRAD),
    ('Земун', BEOGRAD), ('Лазаревац', '704091'), ('Младеновац', '704458'), ('Нови Београд', BEOGRAD),
    ('Обреновац', '704741'), ('Палилула', BEOGRAD), ('Раковица', BEOGRAD), ('Савски венац', BEOGRAD), ('Сопот', '705101'),
    ('Стари град', BEOGRAD), ('Сурчин', '703907'), ('Чукарица', BEOGRAD),
    # Grad Novi Sad (2)
    ('Нови Сад', '802824'), ('Петроварадин', '802832'),
    # Grad Niš (5)
    ('Црвени Крст', NIS), ('Медијана', NIS), ('Нишка Бања', '729370'), ('Палилула', NIS), ('Пантелеј', NIS),
    # Grad Požarevac, Grad Užice, Grad Vranje (2 each)
    ('Пожаревац', None), ('Костолац', None), ('Ужице', None), ('Севојно', None), ('Врање', None), ('Врањска Бања', None),
    # Grad Kragujevac (5, statute only)
    ('Аеродром', '718980'), ('Пивара', '718980'), ('Станово', '718980'), ('Стари град', '718980'), ('Страгари', None),
]
GO_BY_NAME = {'Пожаревац': ('Požarevac', 'Požarevac'), 'Костолац': ('Kostolac', 'Kostolac'), 'Ужице': ('Užice', 'Užice'),
              'Севојно': ('Sevojno', 'Sevojno'), 'Врање': ('Vranje', 'Vranje'), 'Врањска Бања': ('Vranjska Banja', 'Vranjska Banja'),
              'Страгари': ('Stragari', 'Kragujevac')}

# (c) other spellings of RZS names: RGZ boundary names (13) and the old RZS Cyrillic register forms (2)
VARIANTS = [
    ('Доброљупци', '700223'), ('Горње Пунушевце', '711373'), ('Доње Пунушевце', '711462'), ('Клашнице', '711608'),
    ('Оштра Глава', '711896'), ('Рибинце', '711993'), ('Мрча', '722294'), ('Паваштица', '722367'), ('Прекорађа', '722413'),
    ('Трпезе', '722642'), ('Буколорам', '735434'), ('Гргетег', '801879'), ('Зимонић', '802000'),
    ('Ђерекари', '707244'), ('Ковизла', '707350'),
]

# (b) quarters: post-filters on raw/kvartovi_wiki.psv and a few manually verified additions
DROP = {'Тараиш'}   # Wikipedia point (Barajevo hamlet) and the OSM node of the same name are 18 km apart
EXTRA_QUARTERS = [  # name, target id, source / how verified
    ('Депресија', '802824', 'sr.wikipedia Градске четврти Новог Сада §1 (Лиман 5 / Депресија)'),
    ('Стара радничка колонија', '718980', 'sr.wikipedia Категорија:Крагујевачка насеља'),
    ('Каленић', BEOGRAD, 'sr.wikipedia Шаблон:Београдска насеља (Врачар, градска насеља)'),
    ('Котеж', '803138', 'sr.wikipedia Панчево §Насеља Панчева (МЗ Котеж)'),
    ('Верушић', '804614', 'sr.wikipedia Суботица §Списак месних заједница (naselje Суботица)'),
    ('Жељезничко насеље', '804614', 'sr.wikipedia Суботица §Списак месних заједница (naselje Суботица)'),
    ('Бусије', '703915', 'sr.wikipedia Шаблон:Београдска насеља (приградска, Земун); OSM point is_in Угриновци'),
    ('Грмовац', '703915', 'sr.wikipedia Шаблон:Београдска насеља (приградска, Земун); OSM point is_in Угриновци'),
    ('Бесни Фок', '704911', 'sr.wikipedia Шаблон:Београдска насеља (приградска, Палилула); OSM point is_in Падинска Скела'),
    ('Врбовски', '704911', 'sr.wikipedia Шаблон:Београдска насеља (приградска, Палилула); OSM point is_in Падинска Скела'),
    ('Широка бара', '704911', 'sr.wikipedia Шаблон:Београдска насеља (приградска, Палилула); OSM point is_in Падинска Скела'),
    ('Прелив', '704911', 'sr.wikipedia Шаблон:Београдска насеља (приградска, Палилула); OSM point is_in Падинска Скела'),
]
K_ORDER = {'gradska opština': 0, 'deo grada': 1, 'varijanta': 2}
CYR = re.compile('[Ѐ-ӿ]')


def main():
    rows = json.load(open(os.path.join(HERE, 'naselja-srbija.with-id.json'), encoding='utf-8'))
    by_id = {r['id']: r for r in rows}
    by_no = {(r['n'], r['o']): r for r in rows}
    by_name = collections.defaultdict(list)
    for r in rows:
        by_name[r['n'].lower()].append(r)
    raw = open(os.path.join(HERE, 'raw', 'kvartovi_wiki.psv'), 'rb').read()
    sums = dict(reversed(line.split(None, 1)) for line in open(os.path.join(HERE, 'raw', 'SHA256SUMS.browser'), encoding='utf-8')
                if line.strip() and not line.startswith('#'))
    if hashlib.sha256(raw).hexdigest() != sums.get('kvartovi_wiki.psv\n', sums.get('kvartovi_wiki.psv')):
        raise SystemExit('raw/kvartovi_wiki.psv does not match raw/SHA256SUMS.browser')

    out, log = [], collections.defaultdict(list)

    def add(c, target, k, src):
        t = by_id[target] if isinstance(target, str) else by_no[target]
        out.append(dict(s=translit(c), c=c, n=t['n'], o=t['o'], k=k, src=src, p=t['p']))

    # (a)
    for c, tid in GRADSKE_OPSTINE:
        add(c, tid if tid else GO_BY_NAME[c], 'gradska opština', 'RZS SIFOPS / sr.wikipedia')
    # (b)
    for line in raw.decode('utf-8').split('\n'):
        name, city, code, how, src, title, note = line.split('|')
        if name in DROP:
            log['dropped'].append((name, city, 'conflict'))
            continue
        if name.startswith('Блок') or not CYR.search(name):
            log['dropped'].append((name, city, 'block / Latin duplicate'))
            continue
        add(name, code, 'deo grada', src)
    for name, code, src in EXTRA_QUARTERS:
        add(name, code, 'deo grada', src)
    # (c)
    for c, code in VARIANTS:
        add(c, code, 'varijanta', 'RGZ boundary name / RZS Cyrillic register')
    # (d) names with a qualifier in brackets -> bare name
    for r in rows:
        if '(' not in r['n']:
            continue
        bare_c = r['c'].split(' (')[0]
        bare_n = translit(bare_c)
        same = [x for x in by_name[bare_n.lower()]]
        if any(x['o'] == r['o'] for x in same):
            log['bare_skipped'].append((r['n'], r['o'], 'a naselje "%s" exists in the same opština' % bare_n))
            continue
        if same and r['t'] != 'grad':
            log['bare_skipped'].append((r['n'], r['o'], 'collides with %s' % ', '.join('%s (%s)' % (x['n'], x['o']) for x in same)))
            continue
        add(bare_c, (r['n'], r['o']), 'varijanta', 'bare name of RZS "%s"' % r['n'])

    # dedupe on (s, target): keep the kind with the lowest K_ORDER
    best = {}
    for a in sorted(out, key=lambda a: K_ORDER[a['k']]):
        key = (a['s'].lower(), a['n'], a['o'])
        if key in best:
            log['duplicates_merged'].append((a['s'], a['n'], a['o'], a['k']))
            continue
        best[key] = a
    final = list(best.values())

    # trap flags and checks
    alias_targets = collections.defaultdict(set)
    for a in final:
        alias_targets[a['s'].lower()].add((a['n'], a['o']))
    for a in final:
        assert (a['n'], a['o']) in by_no, a
        assert translit(a['c']) == a['s'], a
        if a['k'] != 'gradska opština':
            assert a['s'].lower() != a['n'].lower(), a
        homonyms = [x for x in by_name[a['s'].lower()] if (x['n'], x['o']) != (a['n'], a['o'])]
        if homonyms:
            mx = max(x['p'] for x in homonyms)
            if mx < TRAP_MAX_POP:
                a['trap'] = True
            else:
                log['homonym_bigger_naselje'].append((a['s'], a['n'], a['o'], [(x['n'], x['o'], x['p']) for x in homonyms]))
            a['homonyms'] = [(x['n'], x['o'], x['p']) for x in homonyms]
    final.sort(key=lambda a: (K_ORDER[a['k']], sr_key(a['c']), a['n'], a['o']))

    keys = ['s', 'c', 'n', 'o', 'k', 'trap']
    body = ',\n'.join(json.dumps({k: a[k] for k in keys if k in a}, ensure_ascii=False, separators=(',', ':')) for a in final)
    data = ('[\n' + body + '\n]\n').encode('utf-8')
    open(os.path.join(HERE, 'naselja-sinonimi.json'), 'wb').write(data)

    st = dict(total=len(final), bytes=len(data), per_kind=dict(collections.Counter(a['k'] for a in final)),
              trap=sum(1 for a in final if a.get('trap')),
              per_target=collections.Counter('%s (%s)' % (a['n'], a['o']) for a in final if a['k'] == 'deo grada').most_common(),
              alias_alias=sorted([(s, sorted(t)) for s, t in alias_targets.items() if len(t) > 1]),
              traps=sorted([(a['s'], a['n'], a['o'], a.get('homonyms')) for a in final if a.get('trap')]),
              log=dict(log))
    json.dump(st, open(os.path.join(HERE, 'sinonimi_stats.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1, default=list)
    print(json.dumps({k: st[k] for k in ('total', 'bytes', 'per_kind', 'trap')}, ensure_ascii=False))
    print('log:', {k: len(v) for k, v in log.items()}, 'alias-alias collisions:', len(st['alias_alias']))


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Resort pages (SEO plan §4.1 в, task SEO4, 16.11.2026): /punjaci-za-hotele-<mesto> — chargers for hotels, vacation
rentals and villas in one tourist place. B2B, tone «vi», on the template of the B2B guides.

What only this page has: the public chargers of the place on the BlokVolt map (how many, the strongest, the networks,
how many stand at places to stay — site/tools/hoteli_data.py), the drive from Beograd and Novi Sad with the last fast
charger before the place (routing.openstreetmap.de + the map), and what winter does to the range (ADAC, Recurrent).
The offer itself — per-spot prices, the examples, the steps — repeats /punjaci-za-hotele word for word where it can,
so the two never disagree; the subscription price is not named (the rule of the B2B kit).

Data: site/content/hoteli/mesta.json. Texts: place_texts(). JSON-LD: place_jsonld().
"""
import json
import os
import re

import klasteri as KL

T, num, dates, sr_word, ru_word = KL.T, KL.num, KL.dates, KL.sr_word, KL.ru_word
SITE = KL.SITE
PREFIX = 'punjaci-za-hotele-'
PARENT = 'punjaci-za-hotele'
B2B = 'punjaci-za-firme'
COVER = 12                       # an electric car charging outside a hotel at night
CALC = '/kalkulator-cene-punjaca?tip=hotel'
URL_BV_MAP = 'https://www.blokvolt.rs/mapa/'
URL_ROUTING = 'https://routing.openstreetmap.de/'
KICKER = T('Za firme · Hoteli i apartmani', 'For businesses · Hotels and vacation rentals', 'Для бизнеса · Отели и апартаменты')
FROM = {'beograd': T('Beograd', 'Belgrade', 'Белград'), 'novi-sad': T('Novi Sad', 'Novi Sad', 'Нови-Сад')}
FROM_GEN = {'beograd': T('Beograda', 'Belgrade', 'Белграда'), 'novi-sad': T('Novog Sada', 'Novi Sad', 'Нови-Сада')}


def load(content_dir):
    p = os.path.join(content_dir, 'hoteli', 'mesta.json')
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def km5(x):
    """Road distances as the pages write them: to the nearest 5 km."""
    return int(round(x / 5.0) * 5)


def cap(s):
    return s[0].upper() + s[1:]


def station(s, lang):
    unit = 'кВт' if lang == 'ru' else 'kW'
    return '%s (%s, DC %s %s)' % (s['name'], s['net'], num(s['dc']), unit) if s['net'] else \
        '%s (DC %s %s)' % (s['name'], num(s['dc']), unit)


def validate(data):
    """Errors of the data file (a list of strings)."""
    errs = []
    if not re.fullmatch(r'20\d\d-\d\d-\d\d', str(data.get('date'))) or not data.get('map', {}).get('checked'):
        errs.append('mesta.json needs "date" (YYYY-MM-DD) and "map.checked" (site/tools/hoteli_data.py)')
    seen = set()
    for pl in data.get('places', []):
        s = pl.get('slug', '')
        if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', s) or s in seen:
            errs.append('%r: slug must be lowercase ASCII and unique' % s)
        seen.add(s)
        for k in ('name', 'loc', 'dir', 'do', 'en', 'ru', 'kind', 'public', 'routes'):
            if k not in pl:
                errs.append('%s: "%s" is missing' % (s, k))
        if pl.get('kind') not in ('planina', 'banja'):
            errs.append('%s: kind must be planina or banja' % s)
        for key in ('beograd', 'novi-sad'):
            if 'facts' not in pl.get('routes', {}).get(key, {}):
                errs.append('%s: route %s has no "facts" (site/tools/hoteli_data.py)' % (s, key))
        if not pl.get('public', {}).get('best') or not pl.get('public', {}).get('bv_url'):
            errs.append('%s: "public" needs the strongest charger and the BlokVolt page of the place' % s)
    return errs


# ------------------------------------------------------------------------------------------------ texts
def place_texts(pl, data):
    """(docs, ld_names) of one place."""
    d = KL.Doc(PREFIX + pl['slug'], 'vi', 'b2b')
    pub, rt = pl['public'], pl['routes']
    n_sr, n_en, n_ru = pl['name'], pl['en']['name'], pl['ru']['name']
    loc, eloc, rloc = pl['loc'], pl['en']['loc'], pl['ru']['loc']
    checked = data['map']['checked']
    checked_en = KL.en_date(checked)
    bg, ns = rt['beograd'], rt['novi-sad']
    f_bg, f_ns = bg['facts'], ns['facts']
    w = data['winter']
    best, n, dc50 = pub['best'], pub['n'], pub['n_dc50']

    d.seo(T('Punjači za hotele i apartmane %s | Evolako' % loc, 'EV chargers for hotels & rentals %s | Evolako' % eloc,
            'Зарядки для отелей и апартаментов %s | Evolako' % rloc),
          T('Punjenje za goste hotela, apartmana i vila %s: javni punjači na mapi, put iz Beograda i Novog Sada zimi, '
            'cene po mestu i MID merenje.' % loc,
            'Guest EV charging at hotels, rentals and villas %s: public chargers, winter drive from Belgrade and '
            'Novi Sad, per-spot prices, MID metering.' % eloc,
            'Зарядка для гостей отелей, апартаментов и вилл %s: общественные зарядки, дорога из Белграда и '
            'Нови-Сада зимой, цены за место и MID-счётчик.' % rloc),
          T('Punjači za hotele i apartmane %s' % loc, 'EV chargers for hotels and vacation rentals %s' % eloc,
            'Зарядки для отелей и апартаментов %s' % rloc),
          T('Javni punjači %s, put iz Beograda i Novog Sada zimi i cene punjača po mestu za hotele, apartmane i vile.' % loc,
            'Public chargers %s, the winter drive from Belgrade and Novi Sad, and per-spot charger prices for hotels, '
            'vacation rentals and villas.' % eloc,
            'Общественные зарядки %s, дорога из Белграда и Нови-Сада зимой и цены зарядок за место для отелей, '
            'апартаментов и вилл.' % rloc))

    offer = T('Gostu koji dolazi električnim automobilom zato najviše znači punjenje preko noći u objektu: mesto sa '
              'wallboxom 11 kW i MID brojilom košta 104.000 RSD, konačna cena.',
              'That’s why, for a guest arriving in an electric car, overnight charging at the property is what matters '
              'most: a spot with an 11 kW wallbox and a MID meter costs 104.000 RSD, final price.',
              'Поэтому гостю на электромобиле важнее всего зарядка на ночь прямо на объекте: место с wallbox на 11 кВт и '
              'MID-счётчиком стоит 104.000 RSD, цена итоговая.')
    km_bg, km_ns = km5(bg['km']), km5(ns['km'])
    if f_bg['at_place']:
        first = T('Iz Beograda %s ima oko %d km, a %s mapa pokazuje %d %s za punjenje, od toga %d sa brzim punjačem.'
                  % (pl['do'], km_bg, loc, n, sr_word(n, 'lokaciju', 'lokacije', 'lokacija'), dc50),
                  'It’s about %d km from Belgrade %s; %s the map shows %d charging locations, %d of them with a fast charger.'
                  % (km_bg, pl['en']['dir'], eloc, n, dc50),
                  'От Белграда %s — около %d км; %s на карте %d %s для зарядки, из них %d — с быстрой зарядкой.'
                  % (pl['ru']['do'], km_bg, rloc, n, ru_word(n, 'локация', 'локации', 'локаций'), dc50))
    else:
        after = km5(f_bg['last']['km_after'])
        first = T('Iz Beograda %s ima oko %d km, a poslednji brzi punjač na tom putu je oko %d km pre odredišta.'
                  % (pl['do'], km_bg, after),
                  'It’s about %d km from Belgrade %s, and the last fast charger on that route is about %d km before the '
                  'destination.' % (km_bg, pl['en']['dir'], after),
                  'От Белграда %s — около %d км, а последняя быстрая зарядка на этом пути находится примерно за %d км '
                  'до места.' % (pl['ru']['do'], km_bg, after))
    d.hero(KICKER, T('Punjači za hotele i apartmane %s' % loc, 'EV chargers for hotels and vacation rentals %s' % eloc,
                     'Зарядки для отелей и апартаментов %s' % rloc),
           T(*['%s %s' % (first[k], offer[k]) for k in KL.LANGS]), data['date'])

    d.p(['Stranica je za vlasnike i upravnike hotela, apartmana i vila %s. Paketi, primeri cena i upit su na stranici ' % loc,
         {'a': 'punjači za hotele i apartmane', 'href': '/' + PARENT},
         ', a ovde su lokalni podaci: javni punjači, put iz Beograda i Novog Sada i šta gostu znači punjenje preko noći.'],
        ['This page is for owners and managers of hotels, vacation rentals and villas %s. Packages, price examples and '
         'the request form are on the page ' % eloc,
         {'a': 'chargers for hotels and vacation rentals', 'href': '/' + PARENT},
         '; here are the local facts: public chargers, the drive from Belgrade and Novi Sad, and what overnight charging '
         'means for a guest.'],
        ['Страница для тех, кто владеет или управляет отелями, апартаментами и виллами %s. Пакеты, примеры цен и заявка — '
         'на странице ' % rloc, {'a': 'зарядки для отелей и апартаментов', 'href': '/' + PARENT},
         ', а здесь — местные данные: общественные зарядки, дорога из Белграда и Нови-Сада и что даёт гостю зарядка на ночь.'])

    # 1. public chargers of the place
    d.h2('Javni punjači %s' % loc, 'Public chargers %s' % eloc, 'Общественные зарядки %s' % rloc)
    verb = 'su' if sr_word(n, 'one', 'few', 'many') == 'few' else 'je'
    far = {'sr': ', oko %d km od centra' % round(best['km']), 'en': ', about %d km from the center' % round(best['km']),
           'ru': ', примерно в %d км от центра' % round(best['km'])} if best['km'] > 5 else {'sr': '', 'en': '', 'ru': ''}
    d.p('%s i u okolini, do 25 km od centra, na mapi javnih punjača %s %d %s, od toga %d sa brzim DC punjačem od 50 kW '
        'ili jačim. Najjači punjač: %s%s.' % (cap(loc), verb, n, sr_word(n, 'lokacija', 'lokacije', 'lokacija'), dc50,
                                             station(best, 'sr'), far['sr']),
        '%s and nearby, within 25 km of the center, the public charging map shows %d locations; %d of them %s a fast '
        'DC charger of 50 kW or more. The most powerful charger: %s%s.' % (cap(eloc), n, dc50, 'has' if dc50 == 1 else 'have',
                                                                   station(best, 'en'), far['en']),
        '%s и в радиусе 25 км от центра на карте общественных зарядок — %d %s, из них %d с быстрой DC-зарядкой от 50 кВт. '
        'Самая мощная: %s%s.' % (cap(rloc), n, ru_word(n, 'локация', 'локации', 'локаций'), dc50, station(best, 'ru'),
                                far['ru']))
    ns_, ng = pub['n_stay'], pub['n_stay_guests']
    if ns_:
        sverb = 'su' if sr_word(ns_, 'one', 'few', 'many') == 'few' else 'je'
        if not ng:
            only = T('', '', '')
        elif ng == ns_ == 1:
            only = T(', a mapa navodi da je samo za goste', '; the map marks it as for guests only',
                     '; на карте указано, что она только для гостей')
        elif ng == ns_ == 2:
            only = T(', a za obe mapa navodi da su samo za goste', '; the map marks both as for guests only',
                     '; для обеих на карте указано, что они только для гостей')
        elif ng == ns_:
            only = T(', a za sve njih mapa navodi da su samo za goste', '; the map marks all of them as for guests only',
                     '; для всех них на карте указано, что они только для гостей')
        elif ng == 1:
            only = T('; za jednu od njih mapa navodi da je samo za goste', '; the map marks 1 of them as for guests only',
                     '; для одной из них на карте указано, что она только для гостей')
        else:
            only = T('; za %d od njih mapa navodi da su samo za goste' % ng, '; the map marks %d of them as for guests only' % ng,
                     '; для %d из них на карте указано, что они только для гостей' % ng)
        stay = (T('jedna je uz objekat za smeštaj', '1 is at a place to stay', 'одна — при объекте размещения') if ns_ == 1 else
                T('%d %s uz hotele, apartmane i druge objekte za smeštaj' % (ns_, sverb),
                  '%d are at hotels, vacation rentals and other places to stay' % ns_,
                  '%d — при отелях, апартаментах и других объектах размещения' % ns_))
        d.p('Od tih lokacija, %s%s. To znači da deo objekata već nudi punjenje gostima.' % (stay['sr'], only['sr']),
            'Of those locations, %s%s. So some properties already offer charging to their guests.' % (stay['en'], only['en']),
            'Из них %s%s. То есть часть объектов уже предлагает гостям зарядку.' % (stay['ru'], only['ru']))
    if pub['nets']:
        nets = ', '.join(pub['nets'])
        one_net = len(pub['nets']) == 1
        d.p('%s na tom području: %s. Stanje %s.' % ('Mreža' if one_net else 'Mreže', nets, checked),
            '%s in the area: %s. As of %s.' % ('Network' if one_net else 'Networks', nets, checked_en),
            '%s в этом районе: %s. Данные на %s.' % ('Сеть' if one_net else 'Сети', nets, checked))
    else:
        d.p('Stanje %s.' % checked, 'As of %s.' % checked_en, 'Данные на %s.' % checked)
    d.p(['Sve lokacije sa adresom, mrežom i snagom su u ', {'a': 'pregledu javnih punjača %s' % loc, 'href': pub['bv_url']},
         ', a punjači u ostatku Srbije na ', {'a': 'mapi punjača', 'href': '/mapa-punjaca'}, '.'],
        ['Every location with its address, network and power is in the ',
         {'a': 'overview of public chargers %s' % eloc, 'href': pub['bv_url']},
         ', and chargers in the rest of Serbia are on the ', {'a': 'charger map', 'href': '/mapa-punjaca'}, '.'],
        ['Все локации с адресом, сетью и мощностью — в ', {'a': 'обзоре общественных зарядок %s' % rloc, 'href': pub['bv_url']},
         ', а зарядки в остальной Сербии — на ', {'a': 'карте зарядок', 'href': '/mapa-punjaca'}, '.'])

    # 2. the drive
    d.h2('Put %s iz Beograda i Novog Sada' % pl['dir'], 'The drive %s from Belgrade and Novi Sad' % pl['en']['dir'],
         'Дорога %s из Белграда и Нови-Сада' % pl['ru']['dir'])
    items = []
    for key, r in (('beograd', bg), ('novi-sad', ns)):
        f = r['facts']
        last, after = f['last'], f['last']['km_after']
        if after < 3:
            where = T('poslednji brzi punjač je na odredištu: %s' % station(last, 'sr'),
                      'the last fast charger is at the destination: %s' % station(last, 'en'),
                      'последняя быстрая зарядка — на месте: %s' % station(last, 'ru'))
        else:
            a = km5(after) if after >= 10 else after
            where = T('poslednji brzi punjač je %s, oko %d km pre odredišta' % (station(last, 'sr'), a),
                      'the last fast charger is %s, about %d km before the destination' % (station(last, 'en'), a),
                      'последняя быстрая зарядка — %s, примерно за %d км до места' % (station(last, 'ru'), a))
        km = km5(r['km'])
        items.append(T('Iz %s: oko %d km, %s; %s.' % (FROM_GEN[key]['sr'], km, KL.drive_time(r['min'], 'sr'), where['sr']),
                       'From %s: about %d km, %s; %s.' % (FROM_GEN[key]['en'], km, KL.drive_time(r['min'], 'en'), where['en']),
                       'Из %s: около %d км, %s; %s.' % (FROM_GEN[key]['ru'], km, KL.drive_time(r['min'], 'ru'), where['ru'])))
    d.ul(items)
    d.p('Na putu iz Beograda mapa pokazuje %d %s sa brzim punjačem (DC 50 kW i više, do 5 km od rute), a iz Novog Sada %d.'
        % (f_bg['n_fast'], sr_word(f_bg['n_fast'], 'lokaciju', 'lokacije', 'lokacija'), f_ns['n_fast']),
        'On the route from Belgrade the map shows %d locations with a fast charger (DC 50 kW or more, within 5 km of the '
        'route), and from Novi Sad %d.' % (f_bg['n_fast'], f_ns['n_fast']),
        'На пути из Белграда на карте %d %s с быстрой зарядкой (DC от 50 кВт, не дальше 5 км от маршрута), из Нови-Сада — %d.'
        % (f_bg['n_fast'], ru_word(f_bg['n_fast'], 'локация', 'локации', 'локаций'), f_ns['n_fast']))
    for key, r in (('beograd', bg), ('novi-sad', ns)):
        f = r['facts']
        if f['at_place'] and f['prev'] and f['prev']['km_after'] >= 30:
            a = km5(f['prev']['km_after'])
            d.p('Na putu iz %s poslednji brzi punjač pre samog mesta je %s, oko %d km ranije.'
                % (FROM_GEN[key]['sr'], station(f['prev'], 'sr'), a),
                'On the route from %s, the last fast charger before the destination itself is %s, about %d km before '
                'you arrive.' % (FROM_GEN[key]['en'], station(f['prev'], 'en'), a),
                'На пути из %s последняя быстрая зарядка перед самим курортом — %s, примерно за %d км до него.'
                % (FROM_GEN[key]['ru'], station(f['prev'], 'ru'), a))
    rd = KL.ddmmyyyy(data['routing']['date'])
    d.p('Rastojanje i vreme vožnje su po najbržoj ruti servisa routing.openstreetmap.de na dan %s, bez zadržavanja i pauza '
        'za punjenje.' % rd,
        'Distance and driving time follow the fastest route of the routing.openstreetmap.de service as of %s, with no '
        'delays or charging stops.' % KL.en_date(rd),
        'Расстояние и время в пути — по самому быстрому маршруту сервиса routing.openstreetmap.de на %s, без задержек и '
        'остановок на зарядку.' % rd)

    # 3. winter
    d.h2('Zimi je domet manji', 'Range is shorter in winter', 'Зимой запас хода меньше')
    pa, pr, nm = w['adac']['pct'], w['recurrent']['pct'], w['recurrent']['models']
    asr, aen, aru = dates(w['adac']['published'])
    d.p('ADAC je u zimskom testu, objavljenom %s, pri 0 °C i autoputskoj brzini izmerio potrošnju u proseku %d%% veću od '
        'fabričke (WLTP). Po podacima kompanije Recurrent za %d modela, električni automobili oko 0 °C u proseku zadržavaju '
        '%d%% dometa koji imaju u idealnim uslovima.' % (asr.rstrip('.'), pa, nm, pr),
        'In its winter test, published on %s, ADAC measured consumption at 0 °C and highway speed that averaged %d%% above '
        'the official (WLTP) figure. According to Recurrent’s data on %d models, at freezing temperatures (around 0 °C) '
        'electric cars keep on average %d%% of the range they have in ideal conditions.' % (aen, pa, nm, pr),
        'В зимнем тесте, опубликованном %s, ADAC при 0 °C и движении по автомагистрали зафиксировал расход в среднем на '
        '%d%% выше паспортного (WLTP). По данным компании Recurrent по %d моделям, при температуре около 0 °C электромобили '
        'в среднем сохраняют %d%% запаса хода, который у них есть в идеальных условиях.'
        % (aru.replace(' г.', ' года'), pa, nm, pr))
    wl = w['example_wltp_km']
    real = km5(wl / (1 + pa / 100.0))
    head = T('Auto sa %d km dometa po WLTP-u bi, po tom proseku ADAC-a, na autoputu zimi prešao oko %d km.' % (wl, real),
             'A car with %d km of WLTP range would, at that ADAC average, cover about %d km on the highway in winter.' % (wl, real),
             'Машина с запасом хода %d км по WLTP при таком среднем показателе ADAC проедет зимой по автомагистрали около %d км.'
             % (wl, real))
    if km_bg >= real:
        mid = T('Iz Beograda je %s oko %d km, a iz Novog Sada oko %d km, pa takav auto ne stiže bez punjenja usput.'
                % (pl['do'], km_bg, km_ns),
                'It’s about %d km from Belgrade %s and about %d km from Novi Sad, so such a car doesn’t make it without '
                'charging on the way.' % (km_bg, pl['en']['dir'], km_ns),
                'От Белграда %s около %d км, от Нови-Сада — около %d км, так что без зарядки в пути такая машина не доедет.'
                % (pl['ru']['do'], km_bg, km_ns))
    else:
        res = real - km_bg
        tail_ns = (T('iz Novog Sada je oko %d km, pa mora da puni usput' % km_ns,
                     'from Novi Sad it’s about %d km, so it has to charge on the way' % km_ns,
                     'от Нови-Сада около %d км — придётся заряжаться в пути' % km_ns) if km_ns >= real else
                   T('iz Novog Sada je oko %d km' % km_ns, 'from Novi Sad it’s about %d km' % km_ns,
                     'от Нови-Сада около %d км' % km_ns))
        mid = T('Iz Beograda je %s oko %d km, pa takav auto stiže sa rezervom od oko %d km; %s.'
                % (pl['do'], km_bg, res, tail_ns['sr']),
                'It’s about %d km from Belgrade %s, so such a car arrives with a reserve of about %d km; %s.'
                % (km_bg, pl['en']['dir'], res, tail_ns['en']),
                'От Белграда %s около %d км — такая машина доедет с запасом примерно %d км; %s.'
                % (pl['ru']['do'], km_bg, res, tail_ns['ru']))
    cav = (T('Račun je okviran: zavisi od brzine, temperature i grejanja, a pred kraj puta je uspon.',
             'This is a rough calculation: it depends on speed, temperature and heating, and the last stretch is a climb.',
             'Расчёт приблизительный: всё зависит от скорости, температуры и отопления, а в конце пути — подъём.')
           if pl['kind'] == 'planina' else
           T('Račun je okviran: zavisi od brzine, temperature i grejanja.',
             'This is a rough calculation: it depends on speed, temperature and heating.',
             'Расчёт приблизительный: всё зависит от скорости, температуры и отопления.'))
    d.p(*['%s %s %s' % (head[k], mid[k], cav[k]) for k in KL.LANGS])
    d.p('Gost zato stiže sa malo energije u bateriji i treba da je dopuni pre povratka. Ako auto preko noći stoji na punjaču '
        'u objektu, ujutru kreće sa punom baterijom.',
        'So a guest arrives with little energy left in the battery and needs to recharge before the trip back. If the car '
        'spends the night on a charger at the property, it leaves in the morning with a full battery.',
        'Поэтому гость приезжает с низким зарядом батареи, и перед дорогой обратно её нужно зарядить. Если машина всю ночь '
        'стоит на зарядке на объекте, утром она уезжает с полной батареей.')

    # 4. what the property gets
    d.h2('Šta objekat dobija', 'What the property gets', 'Что получает объект')
    d.ul([
        T('Punjenje preko noći: gost se parkira uveče i kreće posle doručka, a za to vreme wallbox 11 kW napuni i praznu bateriju.',
          'Overnight charging: guests park in the evening and leave after breakfast, and in that time an 11 kW wallbox '
          'fills even an empty battery.',
          'Зарядка за ночь: гость ставит машину вечером и уезжает после завтрака, а wallbox на 11 кВт за это время заряжает '
          'даже пустую батарею.'),
        T('MID brojilo na svakom mestu: vidite koliko kWh troši svako mesto i koliko to košta po ceni sa vašeg računa za struju.',
          'A MID meter at every spot: you see how many kWh each spot uses and what that costs at the rate on your electricity bill.',
          'MID-счётчик на каждом месте: видно, сколько кВт·ч ушло на каждое место и сколько это стоит по цене из вашего '
          'счёта за электричество.'),
        T('Naplata gostu: punjenje može biti usluga bez posebne naplate, deo cene parkinga ili noćenja, ili posebna stavka '
          'na računu. Način naplate dogovaramo u ponudi.',
          'Billing the guest: charging can be a service at no extra charge, part of the parking or room rate, or a separate '
          'item on the bill. We agree on how guests pay as part of the quote.',
          'Расчёт с гостем: зарядка может входить в услуги без отдельной оплаты, в цену парковки или проживания либо идти '
          'отдельной строкой в счёте. Вариант согласуем в смете.'),
        T('Upravljanje snagom: kad kuhinja i klimatizacija rade punom snagom, punjači privremeno smanjuju snagu, a ostatak '
          'objekta radi normalno.',
          'Load management: when the kitchen and air conditioning run at full power, the chargers temporarily reduce their '
          'output, and the rest of the property runs normally.',
          'Управление мощностью: когда кухня и кондиционеры работают на полную, зарядки временно снижают мощность, а '
          'всё остальное на объекте работает как обычно.'),
        T('Samo za goste ili za sve: wallbox radi sa karticom koju gost dobija na recepciji ili slobodno, za svakog ko se parkira.',
          'For guests only or for everyone: the wallbox works with a card that guests get at the front desk, or it’s '
          'open to anyone who parks.',
          'Только для гостей или для всех: wallbox включается по карте, которую гость получает на ресепшене, или работает '
          'без карты для любого, кто встал на место.'),
        T('Uz pretplatu: mesečni obračun po mestu u PDF i CSV formatu, prioritetni servis i godišnja provera instalacije i opreme.',
          'With a subscription: a monthly per-spot statement in PDF and CSV, priority service and an annual check of the '
          'installation and equipment.',
          'С подпиской: ежемесячный расчёт по каждому месту в PDF и CSV, приоритетный сервис и ежегодная проверка '
          'электроустановки и оборудования.')])
    d.p('Struju plaćate vi, po svom računu, jer su punjači na priključku objekta. Mi struju ne prodajemo: MID brojilo meri '
        'potrošnju po mestu, pa trošak punjenja računate po ceni sa svog računa.',
        'You pay for the electricity on your own bill, because the chargers are on the property’s grid connection. We don’t '
        'sell electricity: the MID meter measures consumption per spot, so you calculate the charging cost at the rate on '
        'your own bill.',
        'За электричество платите вы — по своему счёту, ведь зарядки подключены к вводу объекта. Электричество мы не '
        'продаём: MID-счётчик показывает расход по каждому месту, а стоимость зарядки вы считаете по цене из того же счёта.')
    d.p('Punjač je i razlog da gost izabere baš vaš objekat: sajtovi za rezervacije imaju filter za smeštaj sa punjačem.',
        'A charger is also a reason for guests to choose your property: booking sites have a filter for places to stay '
        'with EV charging.',
        'Зарядка — ещё и повод выбрать именно ваш объект: на сайтах бронирования есть фильтр по наличию зарядки.')

    # 5. prices
    d.h2('Cene za hotel, apartmane i vilu', 'Prices for a hotel, vacation rentals or a villa',
         'Цены для отеля, апартаментов и виллы')
    d.p('Svako mesto košta kao paket. Za više mesta ili udaljenu razvodnu tablu dodaje se zajednička infrastruktura: podtabla '
        'sa upravljanjem snagom, trasa, dokumentacija o izvedenim radovima i provera instalacije. Cene su konačne.',
        'Each spot costs the same as a package. For several spots or a distant distribution board, shared infrastructure is '
        'added: a sub-panel with load management, the cable route, as-built documentation and an installation check. Prices '
        'are final.',
        'Каждое место стоит как пакет. Если мест несколько или щит далеко, добавляется общая инфраструктура: отдельный щит '
        'с управлением мощностью, кабельная трасса, исполнительная документация и проверка электроустановки. Цены итоговые.')
    d.table(T(['Šta', 'Cena', 'Napomena'], ['What', 'Price', 'Note'], ['Что', 'Цена', 'Примечание']), [
        T(['Mesto sa wallboxom 11 kW i MID brojilom', '104.000 RSD',
           'osnovna ugradnja pored razvodne table: do 2 m kabla, FID zaštita i automatski osigurač'],
          ['A spot with an 11 kW wallbox and a MID meter', '104.000 RSD',
           'basic installation next to the distribution board: up to 2 m of cable, an RCD (FID) and a circuit breaker'],
          ['Место с wallbox на 11 кВт и MID-счётчиком', '104.000 RSD',
           'базовый монтаж рядом с электрощитом: до 2 м кабеля, УЗО (FID) и автомат']),
        T(['Mesto sa pojačanom utičnicom i MID brojilom', '39.000 RSD',
           'za 1–2 mesta u apartmanima i vilama; gost puni svojim prenosnim punjačem'],
          ['A spot with a heavy-duty socket and a MID meter', '39.000 RSD',
           'for 1–2 spots at vacation rentals and villas; guests charge with their own portable charger'],
          ['Место с усиленной розеткой и MID-счётчиком', '39.000 RSD',
           'для 1–2 мест в апартаментах и виллах; гость заряжается своим переносным зарядным']),
        T(['Apartmani ili mali hotel, 2 mesta pored razvodne table', 'oko 219.000–242.000 RSD',
           '2 × wallbox 11 kW sa MID brojilom, razvodna tabla do 10 m od mesta'],
          ['Vacation rentals or a small hotel, 2 spots next to the distribution board', 'about 219.000–242.000 RSD',
           '2 × 11 kW wallbox with a MID meter, distribution board up to 10 m from the spots'],
          ['Апартаменты или небольшой отель, 2 места рядом с электрощитом', 'около 219.000–242.000 RSD',
           '2 × wallbox на 11 кВт с MID-счётчиком, электрощит не дальше 10 м от мест']),
        T(['Hotel, 4 mesta sa wallboxom u garaži', 'oko 640.000–842.000 RSD',
           'razvodna tabla na 10–30 m; po mestu oko 160.000–211.000 RSD'],
          ['Hotel, 4 wallbox spots in the garage', 'about 640.000–842.000 RSD',
           'distribution board 10–30 m away; about 160.000–211.000 RSD per spot'],
          ['Отель, 4 места с wallbox в гараже', 'около 640.000–842.000 RSD',
           'до электрощита 10–30 м; около 160.000–211.000 RSD за место']),
        T(['Hotel, 6 mesta na otvorenom parkingu', 'oko 1.048.000–1.302.000 RSD',
           'wallboxi na stubićima, razvodna tabla na 10–30 m; bez iskopa i asfalta'],
          ['Hotel, 6 spots in an outdoor parking lot', 'about 1.048.000–1.302.000 RSD',
           'wallboxes on pedestals, distribution board 10–30 m away; excavation and asphalt work not included'],
          ['Отель, 6 мест на открытой парковке', 'около 1.048.000–1.302.000 RSD',
           'wallbox на стойках, до электрощита 10–30 м; без земляных работ и асфальта'])])
    d.p('Sve preko osnovne ugradnje računamo posle procene, pre početka radova. Povećanje snage ili novi priključak plaćate '
        'Elektrodistribuciji Srbije po njenom cenovniku: zahtev podnosite vi, a trošak navodimo u ponudi posebnom stavkom, '
        'bez naše marže.',
        'Anything beyond basic installation is priced after the assessment, before any work starts. You pay EDS, the grid '
        'operator, for a power increase or a new grid connection per its price list: you file the request, and we list the '
        'cost in the quote as a separate line item with no markup.',
        'Всё, что сверх базового монтажа, считаем после оценки, до начала работ. Увеличение мощности или новое подключение '
        'вы оплачиваете EDS по её прейскуранту: заявку подаёте вы, а в смете мы указываем эти расходы отдельной строкой, '
        'без нашей наценки.')
    d.p(['Okvirnu cenu za svoj objekat izračunajte u ', {'a': 'kalkulatoru cene punjača', 'href': CALC}, '.'],
        ['Work out a rough price for your property in the ', {'a': 'charger price calculator', 'href': CALC}, '.'],
        ['Примерную стоимость для своего объекта рассчитайте в ', {'a': 'калькуляторе стоимости зарядок', 'href': CALC}, '.'])

    # 6. how it goes
    d.h2('Kako radimo %s' % loc, 'How we work %s' % eloc, 'Как мы работаем %s' % rloc)
    d.ul([
        T('Pošaljite broj parking mesta, lokaciju objekta i gde gosti parkiraju. Javljamo se u roku od 48 h.',
          'Send us the number of parking spots, the property’s location and where guests park. We’ll get back to you '
          'within 48 hours.',
          'Напишите число парковочных мест, где находится объект и где паркуются гости. Ответим в течение 48 часов.'),
        T('Po fotografijama razvodne table i parkinga, uz račun za struju, dajemo okvirnu cenu. Okvirna procena je besplatna.',
          'From photos of the distribution board and the parking area, plus an electricity bill, we give you an estimated '
          'price. The rough estimate is free.',
          'По фото электрощита и парковки и по счёту за электричество называем примерную цену. Предварительная оценка '
          'бесплатная.'),
        T('Procena na objektu: proveravamo razvodnu tablu, odobrenu snagu i trasu do parking mesta. Košta 2.990 RSD i '
          'uračunava se u cenu ugradnje, a termin dogovaramo u poruci.',
          'On-site assessment: we check the distribution board, the approved power and the cable route to the parking '
          'spots. It costs 2.990 RSD and is credited toward the installation; we arrange the date by message.',
          'Оценка на объекте: проверяем электрощит, разрешённую мощность и трассу до парковочных мест. Стоит 2.990 RSD и '
          'засчитывается в стоимость монтажа, а дату согласуем в переписке.'),
        T('Ponuda sa tačnom cenom i rokovima. U njoj je i način naplate za goste.',
          'A quote with the exact price and timeline. It also covers how guests pay.',
          'Смета с точной ценой и сроками. В ней же — как гости будут платить.'),
        T('Ugradnju rade licencirani električari i predaju dokumentaciju o izvedenim radovima. Jedno mesto opremamo za '
          'jedan radni dan.',
          'Licensed electricians do the installation and hand over the as-built documentation. One spot takes one '
          'working day.',
          'Монтаж делают электрики с лицензией и передают исполнительную документацию. Одно место оборудуем за один '
          'рабочий день.')])
    d.p('Koja odobrenja važe za vaš objekat, kažemo na proceni: dajemo tehnički opis radova, a odobrenje, ako je potrebno, '
        'pribavlja vlasnik objekta.',
        'At the assessment we tell you which permits apply to your property: we provide a technical description of the '
        'work, and the property owner obtains the permit if one is needed.',
        'Какие разрешения нужны вашему объекту, скажем на оценке: мы даём техническое описание работ, а разрешение, если '
        'оно требуется, получает владелец объекта.')

    # 7. questions
    d.question(T('Da li je gostima dovoljan punjač od 11 kW?', 'Is an 11 kW charger enough for guests?',
                 'Хватит ли гостям зарядки на 11 кВт?'),
               T('Za goste koji noće, da: wallbox 11 kW preko noći napuni i praznu bateriju. Punjač od 22 kW ima smisla tamo '
                 'gde auto stoji 1–3 sata i sam prima 22 kW.',
                 'For guests who stay overnight, yes: an 11 kW wallbox fills even an empty battery overnight. A 22 kW charger '
                 'makes sense where cars stay 1–3 hours and can accept 22 kW themselves.',
                 'Гостям, которые остаются на ночь, — да: wallbox на 11 кВт за ночь заряжает даже пустую батарею. Зарядка на '
                 '22 кВт имеет смысл там, где машина стоит 1–3 часа и сама принимает 22 кВт.'))
    d.question(T('Kako objekat naplaćuje punjenje gostu?', 'How does a property bill a guest for charging?',
                 'Как объекту брать с гостя плату за зарядку?'),
               T('Punjenje može biti usluga bez posebne naplate, deo cene parkinga ili noćenja, ili posebna stavka na računu. '
                 'MID brojilo pokazuje potrošnju po mestu, pa trošak računate po ceni sa svog računa za struju.',
                 'Charging can be a service at no extra charge, part of the parking or room rate, or a separate item on the '
                 'bill. The MID meter shows consumption per spot, so you work out the cost at the rate on your electricity bill.',
                 'Зарядка может входить в услуги без отдельной оплаты, в цену парковки или проживания либо идти отдельной '
                 'строкой в счёте. MID-счётчик показывает расход по каждому месту, а стоимость вы считаете по цене из своего '
                 'счёта за электричество.'))
    d.question(T('Šta ako objekat nema dovoljno snage na priključku?', 'What if the property’s grid connection doesn’t have enough power?',
                 'Что, если объекту не хватает мощности подключения?'),
               T('Upravljanje snagom često omogućava rad na postojećem priključku. Ako je povećanje ipak potrebno, zahtev '
                 'Elektrodistribuciji Srbije podnosite vi i plaćate ga po njenom cenovniku, a trošak navodimo u ponudi '
                 'posebnom stavkom, bez naše marže.',
                 'Load management often makes it possible to work with the existing grid connection. If an increase is needed '
                 'after all, you file the request with EDS, the grid operator, and pay per its price list; we list the cost in '
                 'the quote as a separate line item with no markup.',
                 'Часто хватает текущего подключения — за счёт управления мощностью. Если увеличить мощность всё же нужно, '
                 'заявку в EDS подаёте вы и платите по её прейскуранту, а в смете мы указываем эти расходы отдельной строкой, '
                 'без нашей наценки.'))
    d.question(T('Da li radite ugradnju %s?' % loc, 'Do you install chargers %s?' % eloc, 'Вы делаете монтаж %s?' % rloc),
               T('Da, radimo u celoj Srbiji. Okvirnu procenu dajemo po fotografijama, a termin procene na objektu i ugradnje '
                 'dogovaramo u poruci.',
                 'Yes, we work all over Serbia. We give a rough estimate from photos, and we arrange the dates of the on-site '
                 'assessment and the installation by message.',
                 'Да, мы работаем по всей Сербии. Предварительную оценку даём по фото, а даты оценки на объекте и монтажа '
                 'согласуем в переписке.'))
    d.question(T('Može li punjač da stoji na otvorenom parkingu?', 'Can a charger be installed in an outdoor parking lot?',
                 'Можно ли поставить зарядку на открытой парковке?'),
               T('Može: punjač stoji na stubiću pored mesta. Iskop i asfalt nisu uračunati u cenu, pa ih računamo posle procene.',
                 'Yes: the charger stands on a pedestal next to the spot. Excavation and asphalt work are not included in the '
                 'price, so we price them after the assessment.',
                 'Можно: зарядку ставим на стойку рядом с местом. Земляные работы и асфальт в цену не входят — их считаем '
                 'после оценки.'))
    d.faq_block(T('Česta pitanja', 'FAQ', 'Частые вопросы'))

    # 8. the other places
    others = [o for o in data['places'] if o is not pl]
    if others:
        d.h2('Druga turistička mesta', 'Other resorts', 'Другие курорты')
        segs = (['Iste podatke imamo i za druga mesta: '], ['We have the same facts for other places: '],
                ['Такие же данные есть и по другим местам: '])
        for j, o in enumerate(others):
            for i, nm_ in enumerate((o['name'], o['en']['name'], o['ru']['name'])):
                if j:
                    segs[i].append(', ')
                segs[i].append({'a': nm_, 'href': '/' + PREFIX + o['slug']})
        for i in range(3):
            segs[i].append('.')
        d.p(*segs)

    # sources, callout, cards
    d.source(T('Javni punjači %s i u okolini, sa adresom, mrežom i snagom (stanje %s)' % (loc, checked),
               'Public chargers %s and nearby, with address, network and power (as of %s)' % (eloc, checked_en),
               'Общественные зарядки %s и рядом: адрес, сеть и мощность (на %s)' % (rloc, checked)), pub['bv_url'])
    d.source(T('Mapa javnih punjača u Srbiji (stanje %s)' % checked, 'Map of public chargers in Serbia (as of %s)' % checked_en,
               'Карта общественных зарядок в Сербии (на %s)' % checked), URL_BV_MAP)
    d.source(T('routing.openstreetmap.de — najbrža ruta i vreme vožnje, podaci OpenStreetMap (%s)' % rd,
               'routing.openstreetmap.de — fastest route and driving time, OpenStreetMap data (%s)' % KL.en_date(rd),
               'routing.openstreetmap.de — самый быстрый маршрут и время в пути, данные OpenStreetMap (%s)' % rd), URL_ROUTING)
    d.source(T(*[w['adac']['title']] * 3), w['adac']['url'])
    d.source(T(*[w['recurrent']['title']] * 3), w['recurrent']['url'])
    d.callout(T('Cena za vaš objekat %s' % loc, 'A price for your property %s' % eloc, 'Цена для вашего объекта %s' % rloc),
              T('Kalkulator daje okvirnu cenu po broju mesta i udaljenosti razvodne table, a tačnu cenu dajemo posle procene.',
                'The calculator gives a rough price based on the number of spots and the distance to the distribution board; '
                'the exact price comes after the assessment.',
                'Калькулятор считает примерную цену по числу мест и расстоянию до электрощита, а точную называем после оценки.'),
              T('Izračunajte cenu', 'Calculate the price', 'Рассчитать стоимость'), CALC)
    d.links(T('Vodiči i srodne stranice', 'Guides and related pages', 'Гайды и похожие страницы'), [
        (T('Punjači za hotele i apartmane', 'Chargers for hotels and vacation rentals', 'Зарядки для отелей и апартаментов'),
         T('Paketi, primeri cena i upit.', 'Packages, price examples and the request form.', 'Пакеты, примеры цен и заявка.'),
         '/' + PARENT),
        (T('Punjači za hotel: koliko mesta, koja snaga i kako se računa struja',
           'Chargers for a hotel: how many spots, what power and how electricity costs are calculated',
           'Зарядки для отеля: сколько мест, какая мощность и как считать электричество'),
         T('Vodič o broju mesta, snazi punjača i trošku struje.',
           'A guide to the number of spots, charger power and electricity costs.',
           'Гайд: сколько нужно мест, какая мощность и сколько уйдёт на электричество.'), '/koliko-punjaca-treba-hotelu'),
        (T('Punjači za firme i zgrade', 'EV chargers for businesses and buildings', 'Зарядки для компаний и жилых домов'),
         T('Pregled za hotele, garaže, zgrade i firme.', 'An overview for hotels, garages, buildings and businesses.',
           'Обзор: отели, паркинги, жилые дома и компании.'), '/' + B2B)])
    docs = d.build()
    ld_names = [(n_sr, n_en, n_ru), ('Srbija', 'Serbia', 'Сербия'),
                ('Ugradnja punjača za električne automobile', 'EV charger installation', 'Установка зарядок для электромобилей'),
                ('Početna', 'Home', 'Главная'), ('Za firme i zgrade', 'For businesses and buildings', 'Для компаний и домов'),
                ('Hoteli i apartmani', 'Hotels and vacation rentals', 'Отели и апартаменты')]
    return docs, ld_names


def place_jsonld(pl, docs, same_as):
    url = SITE + '/' + PREFIX + pl['slug']
    sr = docs[0]
    return KL.graph(
        KL.org_node(same_as),
        {'@type': 'Service', '@id': url + '#service', 'name': sr['hero']['h1'],
         'serviceType': 'Ugradnja punjača za električne automobile', 'description': sr['seo']['description'],
         'provider': {'@id': SITE + '/#org'}, 'url': url,
         'areaServed': {'@type': 'Place', 'name': pl['name'], 'containedInPlace': {'@type': 'Country', 'name': 'Srbija'}}},
        KL.breadcrumb(url, [('Početna', ''), ('Za firme i zgrade', B2B), ('Hoteli i apartmani', PARENT), (pl['name'], None)]),
        KL.faq_node(url, sr))


def slugs(data):
    return [PREFIX + pl['slug'] for pl in data['places']]


def pages(data, same_as):
    """The pages of the family for site/content.py: slug, the three documents, the JSON-LD and how to render them."""
    out = []
    for pl in data['places']:
        docs, ld_names = place_texts(pl, data)
        card = ((docs[0]['hero']['h1'], docs[1]['hero']['h1'], docs[2]['hero']['h1']),
                ('Javni punjači, put iz Beograda i Novog Sada zimi i cene po mestu.',
                 'Public chargers, the winter drive from Belgrade and Novi Sad, and prices per spot.',
                 'Общественные зарядки, дорога из Белграда и Нови-Сада зимой и цены за место.'))
        out.append({'slug': PREFIX + pl['slug'], 'docs': docs, 'ld_names': ld_names, 'cover': COVER, 'kind': 'b2b',
                    'tone': 'vi', 'date': data['date'], 'checked': data.get('checked'),
                    'jsonld': place_jsonld(pl, docs, same_as),
                    'card_on': PARENT, 'card': card})
    return out

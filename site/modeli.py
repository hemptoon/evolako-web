#!/usr/bin/env python3
"""Car pages (SEO plan §4.1 г, task SEO4, 16.11.2026): /kucni-punjac-za-<auto> — a home charger for one car — and their
hub /kucni-punjac-po-modelu. Residents' kit, tone «ti».

What only this page has: the on-board AC charger of each version (power, phases) as the manufacturer states it, how
much of it a three-phase 11 kW wallbox can use, the charging time on START (2,3–3,7 kW) and on WALLBOX 11 kW, the
manufacturer's own times where it gives them, and what a full battery costs at the night tariff of EPS. From that
follows which package fits, said honestly: a single-phase car charges no faster on an 11 kW wallbox than on a 16 A
heavy-duty socket.

Calculation, the same on every page and written on it: time = battery capacity × 1,10 (charging losses) ÷ power, from
0 to 100%; cost = capacity × 1,10 × the night kWh of the blue zone with all fees and taxes. On a three-phase 11 kW
wallbox (16 A per phase) a car takes min(its charger, phases × 3,7 kW).

Data and the model-specific texts: site/content/modeli/modeli.json. Texts: model_texts(), hub_texts().
"""
import json
import os
import re

import klasteri as KL

GR = KL.GR
T, num, dates = KL.T, KL.num, KL.dates
SITE = KL.SITE
PREFIX = 'kucni-punjac-za-'
HUB = 'kucni-punjac-po-modelu'
COVERS = (7, 4, 14)              # wallbox with a MID meter; an electrician installing a wallbox; a car plugged in at home
COVER_HUB = 14
BV = 'https://www.blokvolt.rs'
URL_TARIFF = BV + '/podaci/tarife-eps/'
URL_LOSS = 'https://www.adac.de/rund-ums-fahrzeug/elektromobilitaet/laden/ladeverluste-elektroauto-studie/'
SRC_LOSS = T('ADAC — studija gubitaka pri punjenju na utičnici i wallboxu', 'ADAC — study of charging losses on a socket and a wallbox',
             'ADAC — исследование потерь при зарядке от розетки и от wallbox')
KICKER = T('Punjač po modelu auta', 'Chargers by car model', 'Зарядка по модели машины')
PHASE = {1: T('jednofazni', 'single-phase', 'однофазное'), 2: T('dvofazni', 'two-phase', 'двухфазное'),
         3: T('trofazni', 'three-phase', 'трёхфазное')}
KIND = {'bruto': T(' (bruto)', ' (gross)', ' (брутто)'), 'nominal': T(' (nominalno)', ' (nominal)', ' (номинал)')}
BASIS = {'do pune baterije': T('do pune baterije', 'to a full battery', 'до полной батареи'),
         'do 80%': T('do 80%', 'to 80%', 'до 80%')}
P_HI, P_LO, P_WB, P_PHASE = 3.7, 2.3, 11.0, 3.7


def load(content_dir):
    p = os.path.join(content_dir, 'modeli', 'modeli.json')
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def validate(data):
    errs = []
    if not re.fullmatch(r'20\d\d-\d\d-\d\d', str(data.get('date'))):
        errs.append('modeli.json needs "date" (YYYY-MM-DD)')
    t = data.get('tariff') or {}
    if not isinstance(t.get('rsd_kwh'), (int, float)) or not t.get('valid_from') or not t.get('checked') or not t.get('bv_updated'):
        errs.append('modeli.json needs "tariff": rsd_kwh, valid_from, checked, bv_updated')
    seen = set()
    for m in data.get('models', []):
        s = m.get('slug', '')
        if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', s) or s in seen:
            errs.append('%r: slug must be lowercase ASCII and unique' % s)
        seen.add(s)
        for k in ('name', 'za', 'en', 'ru', 'cls', 'versions', 'lead', 'facts', 'fit', 'faq', 'sources', 'bv'):
            if k not in m:
                errs.append('%s: "%s" is missing' % (s, k))
        for v in m.get('versions', []):
            if v.get('ph') not in (0, 1, 2, 3) or not v.get('kwh') or not v.get('ac'):
                errs.append('%s: version %r needs kwh, ac and ph (0–3)' % (s, v.get('name')))
            if v.get('kind') not in ('neto', 'bruto', 'nominal', 'pr', 'adac'):
                errs.append('%s: version %r: unknown kind %r' % (s, v.get('name'), v.get('kind')))
        if not 2 <= len(m.get('sources', [])):
            errs.append('%s: at least two sources' % s)
    return errs


# ------------------------------------------------------------------------------------------------ numbers
def unit(s, lang):
    """A Serbian fragment with units and decimals in the page's language: 35,8 kWh → 35.8 kWh → 35,8 кВт·ч."""
    if lang == 'en':
        return re.sub(r'(\d),(\d)', r'\1.\2', s)
    if lang == 'ru':
        return s.replace('kWh', 'кВт·ч').replace('kW', 'кВт')
    return s


def loc(x, lang):
    return x[lang] if isinstance(x, dict) else unit(x, lang)


def kw(p, lang):
    return unit('%s kW' % num(float(p)), lang)


def vname(v, lang, years=True):
    n = loc(v['name'], lang)
    if years and v.get('years'):
        n += ' (%s)' % loc(v['years'], lang)
    return n


def wb_power(v):
    """What the car takes on a three-phase 11 kW wallbox, 16 A per phase; None when the phases are not stated."""
    if 'wb' in v:
        return v['wb']
    if not v['ph']:
        return None
    return min(v['ac'], v['ph'] * P_PHASE, P_WB)


def t_full(v, p):
    return v['kwh'] * 1.1 / p


def battery(v, lang):
    if v.get('label'):
        return v['label'][lang]
    return unit('%s kWh' % num(float(v['kwh'])), lang) + (KIND[v['kind']][lang] if v['kind'] in KIND else '')


def fill(text, m):
    """{t37:i}, {t23:i}, {twb:i} in a model's own text: the computed time of version i, in the text's language."""
    def one(s, lang):
        def rep(mo):
            v = m['versions'][int(mo.group(2))]
            p = {'t37': min(P_HI, v['ac']), 't23': P_LO, 'twb': wb_power(v) or v['ac']}[mo.group(1)]
            return KL.hours(t_full(v, p), lang)
        return re.sub(r'\{(t37|t23|twb):(\d+)\}', rep, s)

    def walk(x, lang):
        if isinstance(x, str):
            return one(x, lang)
        if isinstance(x, list):
            return [walk(y, lang) for y in x]
        if isinstance(x, dict):
            return {k: (v if k == 'href' else walk(v, lang)) for k, v in x.items()}
        return x
    return {lang: walk(text[lang], lang) for lang in KL.LANGS}


# ------------------------------------------------------------------------------------------------ shared texts
ONE = T('Jednofazni punjač u autu koristi jednu fazu. WALLBOX 11 kW je trofazni, 16 A po fazi, pa takav auto na njemu prima '
        'najviše 3,7 kW.',
        'A single-phase on-board charger uses one phase. WALLBOX 11 kW is three-phase, 16 A per phase, so such a car takes '
        '3.7 kW at most on it.',
        'Однофазное бортовое зарядное использует одну фазу. WALLBOX 11 kW — трёхфазный, 16 А на фазу, поэтому такая машина '
        'берёт от него максимум 3,7 кВт.')
TWO = T('Dvofazni punjač koristi dve faze po 16 A, pa na trofaznom wallboxu od 11 kW prima punih 7,2 kW.',
        'A two-phase charger uses two phases at 16 A each, so on a three-phase 11 kW wallbox it takes its full 7.2 kW.',
        'Двухфазное зарядное использует две фазы по 16 А и от трёхфазного wallbox на 11 кВт берёт свои полные 7,2 кВт.')
BIG = T('Na wallboxu od 11 kW i auto koji prima više od 11 kW puni sa 11 kW.',
        'A car that accepts more than 11 kW charges at 11 kW on an 11 kW wallbox.',
        'Машина, которая принимает больше 11 кВт, от wallbox на 11 кВт заряжается на 11 кВт.')
SAME = T('Trofazni punjač od 11 kW u autu koristi punu snagu paketa WALLBOX 11 kW.',
         'A three-phase 11 kW on-board charger uses the full power of WALLBOX 11 kW.',
         'Трёхфазное бортовое зарядное на 11 кВт использует всю мощность WALLBOX 11 kW.')
METHOD = T('Vreme je naša računica za punjenje od 0 do 100%: kapacitet baterije uvećan za 10% gubitaka, podeljen snagom. Pri '
           'kraju punjenje usporava, a na utičnici su gubici veći (ADAC je merio 12,7–24,2% na 2,3 kW i 5,1–7,0% na wallboxu '
           'od 11 kW), pa stvarno vreme može biti duže.',
           'The times are our own calculation for charging from 0 to 100%: battery capacity plus 10% losses, divided by the '
           'power. Charging slows down toward the end, and losses are higher on a socket (ADAC measured 12.7–24.2% at 2.3 kW '
           'and 5.1–7.0% on an 11 kW wallbox), so the real time can be longer.',
           'Время — наш расчёт для зарядки от 0 до 100%: ёмкость батареи плюс 10% потерь, делённая на мощность. Под конец '
           'зарядка замедляется, а от розетки потери выше (ADAC намерил 12,7–24,2% на 2,3 кВт и 5,1–7,0% от wallbox на '
           '11 кВт), так что реальное время может быть больше.')
START = T('START je pojačana utičnica na posebnoj liniji, sa MID brojilom: auto puni svojim prenosnim punjačem, sa 2,3 kW '
          '(10 A) ili 3,7 kW (16 A), zavisno od prenosnog punjača.',
          'START is a heavy-duty socket on its own circuit, with a MID meter: the car charges through its portable charger, '
          'at 2.3 kW (10 A) or 3.7 kW (16 A), depending on the portable charger.',
          'START — усиленная розетка на отдельной линии, с MID-счётчиком: машина заряжается через своё переносное зарядное, '
          'на 2,3 кВт (10 А) или 3,7 кВт (16 А) — зависит от переносного зарядного.')
ZONE = T('Cena važi uz dvotarifno brojilo i potrošnju u plavoj zoni; u crvenoj zoni, iznad 1.200 kWh mesečno, kWh je skuplji. '
         'Na brzim javnim punjačima kWh je po računima iz avgusta i septembra 2026. koštao od 43 do 79 RSD.',
         'The price applies with a dual-tariff meter and consumption in the blue zone; in the red zone, above 1.200 kWh a '
         'month, a kWh costs more. On fast public chargers, receipts from August and September 2026 put a kWh at 43 to 79 RSD.',
         'Цена действует при двухтарифном счётчике и расходе в пределах синей зоны; в красной зоне, свыше 1.200 кВт·ч в месяц, '
         'кВт·ч дороже. На быстрых общественных зарядках, по чекам за август и сентябрь 2026 года, кВт·ч стоил от 43 до 79 RSD.')
BILL_LINK = T(['Koliko punjenje podiže mesečni račun, piše u vodiču ',
               {'a': 'koliko električni auto podiže račun za struju', 'href': '/koliko-elektricni-auto-podize-racun-za-struju'}, '.'],
              ['How much charging adds to the monthly bill is covered in the guide ',
               {'a': 'how much an electric car adds to your electricity bill', 'href': '/koliko-elektricni-auto-podize-racun-za-struju'}, '.'],
              ['Насколько зарядка увеличивает счёт за месяц — в гайде ',
               {'a': 'на сколько электромобиль увеличивает счёт за электричество', 'href': '/koliko-elektricni-auto-podize-racun-za-struju'}, '.'])
PRICE_A = T('START je 39.000 RSD, a WALLBOX 11 kW od 94.000 RSD (sa MID brojilom 104.000 RSD). Cena je konačna i uključuje '
            'osnovnu ugradnju pored razvodne table; sve preko toga računamo posle procene.',
            'START is 39.000 RSD, and WALLBOX 11 kW starts at 94.000 RSD (104.000 RSD with a MID meter). The price is final '
            'and includes basic installation next to the distribution board; anything beyond that is priced after the assessment.',
            'START — 39.000 RSD, WALLBOX 11 kW — от 94.000 RSD (с MID-счётчиком 104.000 RSD). Цена итоговая и включает базовый '
            'монтаж рядом с электрощитом; всё, что сверх этого, считаем после оценки.')
CTA_TEXT = T('Pošalji fotografije razvodne table i mesta za punjač — okvirna procena po fotografijama je besplatna, a odgovaramo '
             'u roku od 48 sati.',
             'Send photos of the distribution board and the spot for the charger — a rough estimate from photos is free, and '
             'we reply within 48 hours.',
             'Пришли фото электрощита и места для зарядки — предварительная оценка по фото бесплатная, отвечаем в течение 48 часов.')
CARD_PRICES = (T('Paketi i cene', 'Packages and prices', 'Пакеты и цены'),
               T('Svi paketi, šta je u ceni i pretplata.', 'All packages, what’s included and the subscription.',
                 'Все пакеты, что входит в цену, и подписка.'), '/paketi-i-cene')
CARD_TIMER = (T('Kako da auto puni samo noću', 'How to charge only at night', 'Как заряжать только ночью'),
              T('Tajmer u autu i na punjaču i sati niže tarife.', 'The timer in the car and on the charger, and the lower-tariff hours.',
                'Таймер в машине и на зарядке и часы ночного тарифа.'), '/punjenje-nocu-tajmer')
CARD_HUB = (T('Punjač po modelu auta', 'Chargers by car model', 'Зарядка по модели машины'),
            T('Ugrađeni punjač, vreme i cena punjenja po modelu.', 'On-board charger, charging time and cost by model.',
              'Бортовое зарядное, время и цена зарядки по моделям.'), '/' + HUB)
CARD_HOME = (T('Punjenje električnog auta kod kuće', 'Charging an electric car at home', 'Зарядка электромобиля дома'),
             T('Šta ti treba, koliko traje punjenje preko noći i koliko auto podiže račun za struju.',
               'What you need, how long overnight charging takes and how much a car adds to your power bill.',
               'Что нужно, сколько длится зарядка за ночь и насколько машина увеличивает счёт за электричество.'),
             '/punjenje-elektricnog-automobila-kod-kuce')


def prices(d):
    d.p(*KL.tri(GR.PRICES_INCLUDED))
    d.table(GR.PRICES_HEAD, GR.PRICES_ROWS)
    d.p(*KL.tri(GR.PRICES_MORE))


def tariff_line(data):
    t = data['tariff']
    r = num(float(t['rsd_kwh']))
    if ',' in r and len(r.split(',')[1]) == 1:
        r += '0'                                           # 5,70
    f = dates(t['valid_from'])
    return T('Noćni kWh u plavoj zoni, sa svim naknadama i porezima, košta oko 6 RSD — tačno %s RSD po cenovniku EPS-a koji '
             'važi od %s' % (r, f[0]),
             'A night kWh in the blue zone costs about 6 RSD with all fees and taxes — %s RSD to be exact, under the EPS price '
             'list in force since %s.' % (r.replace(',', '.'), f[1]),
             'Ночной кВт·ч в синей зоне со всеми сборами и налогами стоит около 6 RSD — точнее, %s RSD по прейскуранту EPS, '
             'действующему с %s' % (r, f[2].replace(' г.', ' года.')))


# ------------------------------------------------------------------------------------------------ one model
def en_the(m, name=None):
    """The English name with its article: «the Renault Zoe»; a page about a whole make («make»: true) says «a Tesla»."""
    name = name or m['en']
    return KL.a_an(name) if m.get('make') else 'the ' + name


def en_or(m):
    """«VW ID.3, ID.4 or ID.5»: one charger is for one of the cars the page covers."""
    return m['en'].replace(' and ', ' or ')


def title_of(m):
    def fit(bases, tails):
        """The first wording with a tail that fits into 60 characters; without a tail when none does."""
        for base in bases:
            for t in tails:
                s = base + t + ' | Evolako'
                if len(s) <= 60:
                    return s
        return bases[0] + ' | Evolako'
    return T(fit(['Kućni punjač za %s' % m['za']], (': snaga, vreme i cena punjenja', ': vreme i cena punjenja', ': vreme i cena')),
             fit(['Home charger for %s' % m['en'], '%s home charger' % m['en']],
                 (': power, charging time and cost', ': power, time and cost', ': charging time and cost', ': time and cost')),
             fit(['Домашняя зарядка для %s' % m['ru']], (': мощность, время и цена', ': время и цена зарядки', ': время и цена')))


def model_texts(m, data, idx=0):
    """(docs, ld_names) of one car."""
    d = KL.Doc(PREFIX + m['slug'], 'ti', 'vodic')
    vs = m['versions']
    short = {'sr': m.get('short', m['name']), 'en': m.get('short', m['en']), 'ru': m.get('short', m['ru'])}
    the = en_the(m)                                           # «the Renault Zoe», but «a Tesla» for a whole make
    h1 = m.get('h1') or T('Kućni punjač za %s' % m['za'], 'A home charger for %s' % the, 'Домашняя зарядка для %s' % m['ru'])
    cls = m['cls']
    en_desc = '%s: on-board charger %s. Charging time on a socket and an 11 kW wallbox, cost of a full battery' % (short['en'], cls['en'])
    en_desc += ' at night.' if len(en_desc) + 10 <= 155 else '.'
    d.seo(title_of(m),
          T('%s: punjač u autu %s. Vreme punjenja na utičnici i na wallboxu 11 kW i cena pune baterije noću.'
            % (short['sr'], cls['sr']),
            en_desc,
            '%s: бортовое зарядное %s. Время зарядки от розетки и от wallbox на 11 кВт, цена полной батареи ночью.'
            % (short['ru'], cls['ru'])),
          h1,
          T('Ugrađeni punjač, vreme punjenja na START i WALLBOX paketu i cena pune baterije noću za %s.' % m['za'],
            'On-board charger, charging time on the START and WALLBOX packages, and the cost of a full battery at night for '
            '%s.' % the,
            'Бортовое зарядное, время зарядки на пакетах START и WALLBOX и цена полной батареи ночью для %s.' % m['ru']))
    d.hero(KICKER, h1, m['lead'], data['date'])

    # 1. what the car takes
    d.h2('Koliko snage prima %s' % short['sr'], 'How much power %s takes' % en_the(m, short['en']),
         'Какую мощность принимает %s' % short['ru'])
    rows = []
    for v in vs:
        w = wb_power(v)
        row = {}
        for lang in KL.LANGS:
            ch = kw(v['ac'], lang) + ((', ' + PHASE[v['ph']][lang]) if v['ph'] else '')
            wbc = kw(w, lang) if w else {'sr': 'nije navedeno', 'en': 'not stated', 'ru': 'не указано'}[lang]
            row[lang] = [vname(v, lang), ch, wbc, battery(v, lang)]
        rows.append(row)
    # on a phone the tables scroll sideways and the first two columns are what shows
    d.table(T(['Verzija', 'Punjač u autu (AC)', 'Na wallboxu 11 kW', 'Baterija'],
              ['Version', 'On-board charger (AC)', 'On an 11 kW wallbox', 'Battery'],
              ['Версия', 'Бортовое зарядное (AC)', 'От wallbox на 11 кВт', 'Батарея']), rows)
    one = any(v['ph'] == 1 for v in vs)
    two = any(v['ph'] == 2 for v in vs)
    big = any(v['ph'] == 3 and v['ac'] > P_WB for v in vs)
    same = any(v['ph'] == 3 and v['ac'] == P_WB for v in vs)
    parts = [x for x, on in ((SAME, same), (ONE, one), (TWO, two), (BIG, big)) if on]
    d.p(*[' '.join(x[lang] for x in parts) for lang in KL.LANGS])
    for f in m['facts']:
        d.add('p', fill(f, m))

    # 2. how long
    d.h2('Koliko traje punjenje kod kuće', 'How long charging takes at home', 'Сколько длится зарядка дома')
    rows = []
    for v in vs:
        w = wb_power(v)
        row = {}
        for lang in KL.LANGS:
            if w:
                wbc = KL.hours(t_full(v, w), lang)
            else:
                wbc = {'sr': 'najmanje ', 'en': 'at least ', 'ru': 'не меньше '}[lang] + KL.dur(t_full(v, v['ac']), lang)
            cells = v.get('cells') or {}                     # the maker's own statement where the calculation would mislead
            row[lang] = [vname(v, lang, years=False), wbc,
                         cells['t37'][lang] if 't37' in cells else KL.hours(t_full(v, min(P_HI, v['ac'])), lang),
                         cells['t23'][lang] if 't23' in cells else KL.hours(t_full(v, P_LO), lang)]
        rows.append(row)
    d.table(T(['Verzija', 'WALLBOX 11 kW', 'START, 3,7 kW', 'START, 2,3 kW'], ['Version', 'WALLBOX 11 kW', 'START, 3.7 kW', 'START, 2.3 kW'],
              ['Версия', 'WALLBOX 11 kW', 'START, 3,7 кВт', 'START, 2,3 кВт']), rows)
    d.p(*KL.tri(METHOD))
    d.p(*KL.tri(START))
    made = [v for v in vs if v.get('maker')]
    if made:
        out = {'sr': 'Podaci proizvođača.', 'en': 'Manufacturer’s figures.', 'ru': 'Данные производителя.'}
        for v in made:
            mk = v['maker']
            for lang in KL.LANGS:
                basis = BASIS.get(mk['basis'], T(*[mk['basis']] * 3))[lang]
                ts = ', '.join('%s — %s' % (kw(float(p), lang), KL.hm(mk['t'][p], lang))
                               for p in sorted(mk['t'], key=float))
                out[lang] += ' %s, %s: %s.' % (vname(v, lang, years=False), basis, ts)
        d.p(out['sr'], out['en'], out['ru'])

    # 3. what a full battery costs
    d.h2('Koliko košta puna baterija noću', 'What a full battery costs at night', 'Сколько стоит полная батарея ночью')
    d.p(*KL.tri(tariff_line(data)))
    price = data['tariff']['rsd_kwh']
    rows = []
    for v in vs:
        e = v['kwh'] * 1.1
        rsd = int(round(e * price / 10.0) * 10)
        rows.append({lang: [vname(v, lang, years=False), '%s%s RSD' % (KL.ABOUT[lang], num(rsd)),
                            unit('%s%d kWh' % (KL.ABOUT[lang], round(e)), lang)] for lang in KL.LANGS})
    d.table(T(['Verzija', 'Cena noću', 'Iz mreže za punu bateriju'], ['Version', 'Cost at night', 'From the grid for a full battery'],
              ['Версия', 'Цена ночью', 'Из сети на полную батарею']), rows)
    d.p(*KL.tri(ZONE))
    d.p(*KL.tri(BILL_LINK))

    # 4. which package
    d.h2('Koji paket odgovara', 'Which package fits', 'Какой пакет подходит')
    for f in m['fit']:
        d.add('p', fill(f, m))
    prices(d)
    bv = m['bv']
    url = BV + bv['path']
    if bv['kind'] == 'model':
        d.p(['Cene, oprema i domet za %s u Srbiji su na ' % m['za'], {'a': 'stranici modela', 'href': url}, '.'],
            ['Prices, trims and range for %s in Serbia are on the ' % the, {'a': 'model page', 'href': url}, '.'],
            ['Цены, комплектации и запас хода %s в Сербии — на ' % m['ru'], {'a': 'странице модели', 'href': url}, '.'])
    elif bv['kind'] == 'brand':
        d.p(['Modeli, cene i uvoznik za marku %s u Srbiji su u ' % bv['brand'], {'a': 'pregledu marke', 'href': url}, '.'],
            ['Models, prices and the importer for %s in Serbia are in the ' % bv['brand'], {'a': 'brand overview', 'href': url}, '.'],
            ['Модели, цены и импортёр %s в Сербии — в ' % bv['brand'], {'a': 'обзоре марки', 'href': url}, '.'])
    else:
        d.p(['Ako tek kupuješ polovan auto, pogledaj gde se kupuje i šta treba proveriti: ',
             {'a': 'polovni i uvezeni električni automobili', 'href': url}, '.'],
            ['If you’re still shopping for a used car, see where to buy one and what to check: ',
             {'a': 'used and imported electric cars', 'href': url}, '.'],
            ['Если ты только выбираешь подержанную машину, посмотри, где их покупают и что проверять: ',
             {'a': 'подержанные и ввезённые электромобили', 'href': url}, '.'])

    # 5. questions
    for qa in m['faq']:
        d.question(fill(qa['q'], m), fill(qa['a'], m))
    d.question(T('Koliko košta ugradnja punjača za %s?' % m['za'],
                 'How much does it cost to install a charger for %s?' % KL.a_an(en_or(m)),
                 'Сколько стоит установка зарядки для %s?' % m['ru']), PRICE_A)
    d.faq_block(T('Česta pitanja', 'FAQ', 'Частые вопросы'))

    for s in m['sources']:
        d.source(s['t'], s['url'])
    t = data['tariff']
    d.source(GR.SRC_EPS, GR.URL_EPS)
    ck = KL.ddmmyyyy(t['bv_updated'])
    d.source(T('Cena struje za domaćinstva u Srbiji: zone, tarife i dažbine (stanje %s)' % ck,
               'Household electricity prices in Serbia: zones, tariffs and levies (as of %s)' % ck,
               'Цены на электричество для населения в Сербии: зоны, тарифы и сборы (на %s)' % ck), URL_TARIFF)
    d.source(SRC_LOSS, URL_LOSS)
    d.source(GR.SRC_DC, GR.URL_DC)
    d.callout(T('Punjač za %s' % m['za'], 'A charger for your %s' % en_or(m), 'Зарядка для %s' % m['ru']), CTA_TEXT,
              GR.CALL_BTN, '/kontakt')
    d.links(T('Pročitaj i ovo', 'Read next', 'Читай также'), [CARD_PRICES, CARD_HUB, CARD_TIMER])
    docs = d.build()
    ld_names = [('Srbija', 'Serbia', 'Сербия'),
                ('Ugradnja kućnog punjača za električni auto', 'Home EV charger installation',
                 'Установка домашней зарядки для электромобиля'),
                ('Početna', 'Home', 'Главная'), KL.tri(KICKER), (m['name'], m['en'], m['ru'])]
    return docs, ld_names


def model_jsonld(m, docs, same_as):
    url = SITE + '/' + PREFIX + m['slug']
    sr = docs[0]
    return KL.graph(
        KL.org_node(same_as),
        {'@type': 'Service', '@id': url + '#service', 'name': sr['hero']['h1'],
         'serviceType': 'Ugradnja kućnog punjača za električni auto', 'description': sr['seo']['description'],
         'provider': {'@id': SITE + '/#org'}, 'url': url, 'areaServed': {'@type': 'Country', 'name': 'Srbija'}},
        KL.breadcrumb(url, [('Početna', ''), (KICKER['sr'], HUB), (m['name'], None)]),
        KL.faq_node(url, sr))


# ------------------------------------------------------------------------------------------------ the hub
def hub_texts(data):
    d = KL.Doc(HUB, 'ti', 'vodic')
    d.seo(T('Kućni punjač po modelu auta: snaga i vreme | Evolako', 'Home charger by car model: power and time | Evolako',
            'Зарядка дома по модели машины: мощность и время | Evolako'),
          T('Koliko prima ugrađeni punjač, koliko traje punjenje kod kuće i koji paket odgovara — po modelima električnih '
            'automobila, sa podacima proizvođača.',
            'How much the on-board charger accepts, how long charging takes at home and which package fits — by electric car '
            'model, with the manufacturers’ figures.',
            'Сколько принимает бортовое зарядное, сколько длится зарядка дома и какой пакет подходит — по моделям '
            'электромобилей, с данными производителей.'),
          T('Kućni punjač po modelu auta', 'A home charger by car model', 'Домашняя зарядка по модели машины'),
          T('Ugrađeni punjač, vreme punjenja kod kuće i paket koji odgovara, po modelima električnih automobila.',
            'On-board charger, charging time at home and the package that fits, by electric car model.',
            'Бортовое зарядное, время зарядки дома и подходящий пакет — по моделям электромобилей.'))
    d.hero(T('Usluga', 'Service', 'Услуга'),
           T('Kućni punjač po modelu auta', 'A home charger by car model', 'Домашняя зарядка по модели машины'),
           T('Koliko brzo se auto puni kod kuće, određuje punjač ugrađen u auto, a ne samo punjač na zidu. Ovde su podaci '
             'proizvođača po modelima: koliko auto prima, koliko traje punjenje i koji paket ima smisla.',
             'How fast a car charges at home is set by the charger built into the car, not only by the one on the wall. Here '
             'are the manufacturers’ figures by model: how much each car accepts, how long charging takes and which package '
             'makes sense.',
             'Скорость зарядки дома зависит от бортового зарядного машины, а не только от настенной зарядки. Здесь — данные '
             'производителей по моделям: сколько принимает машина, сколько длится зарядка и какой пакет имеет смысл.'),
           data['date'])
    d.h2('Modeli', 'Models', 'Модели')
    items = []
    for m in data['models']:
        href = '/' + PREFIX + m['slug']
        items.append(T([{'a': m['name'], 'href': href}, ' — ' + m['cls']['sr']], [{'a': m['en'], 'href': href}, ' — ' + m['cls']['en']],
                       [{'a': m['ru'], 'href': href}, ' — ' + m['cls']['ru']]))
    d.ul(items)
    d.p('Uz svaki model su tabela sa ugrađenim punjačem po verzijama, vreme punjenja na pojačanoj utičnici i na wallboxu od '
        '11 kW i cena pune baterije noću.',
        'Each model comes with a table of the on-board charger by version, the charging time on a heavy-duty socket and on '
        'an 11 kW wallbox, and the cost of a full battery at night.',
        'По каждой модели — таблица с бортовым зарядным по версиям, время зарядки от усиленной розетки и от wallbox на 11 кВт '
        'и цена полной батареи ночью.')
    d.h2('Šta određuje brzinu punjenja', 'What sets the charging speed', 'От чего зависит скорость зарядки')
    d.p(*KL.tri(ONE))
    d.p(*KL.tri(TWO))
    d.p(*[SAME[k] + ' ' + BIG[k] for k in KL.LANGS])
    d.p(*KL.tri(START))
    d.p(['Kada 22 kW ima smisla, piše u vodiču ', {'a': 'punjač 11 ili 22 kW', 'href': '/punjac-11-ili-22-kw'}, '.'],
        ['When 22 kW makes sense is covered in the guide ', {'a': '11 or 22 kW charger', 'href': '/punjac-11-ili-22-kw'}, '.'],
        ['Когда 22 кВт оправданы — в гайде ', {'a': 'зарядка на 11 или 22 кВт', 'href': '/punjac-11-ili-22-kw'}, '.'])
    d.h2('Paketi i cene', 'Packages and prices', 'Пакеты и цены')
    prices(d)
    d.question(T('Kako da znam koliko moj auto prima?', 'How do I know how much my car accepts?', 'Как узнать, сколько принимает моя машина?'),
               T('U tehničkim podacima potraži ugrađeni punjač (AC) i broj faza. Jednofazni auto na trofaznom wallboxu od 11 kW '
                 'prima 3,7 kW, a trofazni sa punjačem od 11 kW svih 11 kW.',
                 'Look for the on-board charger (AC) and the number of phases in the technical data. A single-phase car takes '
                 '3.7 kW on a three-phase 11 kW wallbox, and a three-phase car with an 11 kW charger takes all 11 kW.',
                 'В техданных найди бортовое зарядное (AC) и число фаз. Однофазная машина берёт 3,7 кВт от трёхфазного wallbox '
                 'на 11 кВт, а трёхфазная с зарядным на 11 кВт — все 11 кВт.'))
    d.question(T('Mog modela nema na spisku. Šta da radim?', 'My model isn’t on the list. What do I do?', 'Моей модели нет в списке. Что делать?'),
               T('Pošalji nam marku, model i godište uz fotografije razvodne table i mesta za punjač, pa ti u odgovoru kažemo '
                 'koji paket ima smisla.',
                 'Send us the make, model and model year together with photos of the distribution board and the spot for the '
                 'charger, and in our reply we’ll tell you which package makes sense.',
                 'Пришли марку, модель и год выпуска вместе с фото электрощита и места для зарядки — в ответе скажем, какой '
                 'пакет имеет смысл.'))
    d.question(T('Da li wallbox od 11 kW odgovara svakom autu?', 'Does an 11 kW wallbox suit every car?', 'Подходит ли wallbox на 11 кВт любой машине?'),
               T('Odgovara svakom autu sa Type 2 priključkom, ali ga ne koristi svaki u celosti: jednofazni auto na njemu puni sa '
                 '3,7 kW. Za takav auto pojačana utičnica daje istu brzinu.',
                 'It suits every car with a Type 2 inlet, but not every car uses all of it: a single-phase car charges at 3.7 kW '
                 'on it. For such a car a heavy-duty socket gives the same speed.',
                 'Подходит любой машине с разъёмом Type 2, но не каждая использует его полностью: однофазная машина заряжается '
                 'от него на 3,7 кВт. Такой машине ту же скорость даёт усиленная розетка.'))
    d.faq_block(T('Česta pitanja', 'FAQ', 'Частые вопросы'))
    d.source(T('Električni automobili u Srbiji: marke, uvoznici, modeli i cene', 'Electric cars in Serbia: brands, importers, models and prices',
               'Электромобили в Сербии: марки, импортёры, модели и цены'), BV + '/elektricni-automobili/')
    d.source(SRC_LOSS, URL_LOSS)
    d.source(GR.SRC_EPS, GR.URL_EPS)
    d.callout(T('Punjač za tvoj auto', 'A charger for your car', 'Зарядка для твоей машины'), CTA_TEXT, GR.CALL_BTN, '/kontakt')
    d.links(T('Pročitaj i ovo', 'Read next', 'Читай также'), [CARD_PRICES, CARD_HOME, CARD_TIMER])
    docs = d.build()
    ld_names = [('Početna', 'Home', 'Главная')] + [(m['name'], m['en'], m['ru']) for m in data['models']]
    return docs, ld_names


def hub_jsonld(data, docs, same_as):
    url = SITE + '/' + HUB
    sr = docs[0]
    return KL.graph(
        KL.org_node(same_as),
        {'@type': 'CollectionPage', '@id': url + '#page', 'url': url, 'name': sr['hero']['h1'],
         'description': sr['seo']['description'], 'isPartOf': {'@id': SITE + '/#org'},
         'mainEntity': {'@type': 'ItemList', 'itemListElement': [
             {'@type': 'ListItem', 'position': i + 1, 'name': m['name'], 'url': SITE + '/' + PREFIX + m['slug']}
             for i, m in enumerate(data['models'])]}},
        KL.breadcrumb(url, [('Početna', ''), (sr['hero']['h1'], None)]),
        KL.faq_node(url, sr))


def slugs(data):
    return [HUB] + [PREFIX + m['slug'] for m in data['models']]


def pages(data, same_as):
    docs, ld = hub_texts(data)
    out = [{'slug': HUB, 'docs': docs, 'ld_names': ld, 'cover': COVER_HUB, 'kind': 'vodic', 'tone': 'ti', 'date': data['date'], 'checked': data.get('checked'),
            'jsonld': hub_jsonld(data, docs, same_as), 'footer': True}]
    for i, m in enumerate(data['models']):
        docs, ld = model_texts(m, data, i)
        out.append({'slug': PREFIX + m['slug'], 'docs': docs, 'ld_names': ld, 'cover': COVERS[i % len(COVERS)], 'kind': 'vodic',
                    'tone': 'ti', 'date': data['date'], 'checked': data.get('checked'), 'jsonld': model_jsonld(m, docs, same_as)})
    return out

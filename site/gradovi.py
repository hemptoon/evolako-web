#!/usr/bin/env python3
"""City pages of www.evolako.rs (decision 27.10.2026: Evolako works in the whole country): /ugradnja-punjaca (all
cities, by region) and /ugradnja-punjaca-<grad> for every city of Serbia («grad» by the law on territorial
organisation, art. 20, plus Belgrade). Data: site/content/gradovi/gradovi.json (names written by hand, the public-
charging facts by site/tools/gradovi_data.py from the BlokVolt charger map); texts: the templates below (sr «ti»,
en American, ru «ты»). site/content.py renders them on the guide template like a guide (head, hero, cover, sections,
JSON-LD), but they get no card on /vodici.

Rules the texts keep (check() enforces them): the copy rules of the kits (no "atest", discounts, 24/7, "odmah",
exclamation marks, surcharge amounts, no "we handle the paperwork"), no visit deadline (whether the 72 h of
/paketi-i-cene holds in the whole country is the founders' decision — not repeated here), no "PDV" (the preduzetnik is
outside the VAT system for now), no claim about a local electrician, no reviews or numbers of installations; every
number comes from the data file or the site's prices; every page has its own data (public chargers of the city, night-tariff hours of its area, local notes),
so the pages are not copies with another city name.
"""
import html as H
import json
import math
import os
import re

SITE = 'https://www.evolako.rs'
HUB = 'ugradnja-punjaca'
PREFIX = 'ugradnja-punjaca-'
COVER_CITY, COVER_HUB = 4, 0          # photos of the kits' table: electrician at a wall charger / garage with chargers

REGIONS = [  # statistical regions (NSTJ 2), in this order on the hub
    ('beograd', ('Beograd', 'Belgrade', 'Белград')),
    ('vojvodina', ('Vojvodina', 'Vojvodina', 'Воеводина')),
    ('sumadija', ('Šumadija i Zapadna Srbija', 'Šumadija and Western Serbia', 'Шумадия и Западная Сербия')),
    ('jug', ('Južna i Istočna Srbija', 'Southern and Eastern Serbia', 'Южная и Восточная Сербия')),
]
REGION_NAMES = dict(REGIONS)

e = lambda s: H.escape(s, quote=False)    # noqa: E731
q = lambda s: H.escape(s, quote=True)     # noqa: E731


def load(content_dir):
    p = os.path.join(content_dir, 'gradovi', 'gradovi.json')
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


# ------------------------------------------------------------------------------------------------ language helpers
def sr_word(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


ru_word = sr_word          # Russian agrees the same way: 1 локация, 2–4 локации, 5+ локаций


def num(x):
    """Numbers as the site writes them: 1.720, 2,3, 150."""
    if isinstance(x, float) and x != int(x):
        return ('%g' % x).replace('.', ',')
    n = int(round(x))
    return '{:,}'.format(n).replace(',', '.')


def km_txt(x, lang):
    v = int(round(x))
    return {'sr': 'oko %d km od centra' % v, 'en': 'about %d km from the center' % v, 'ru': 'примерно в %d км от центра' % v}[lang]


def dates(iso):
    y, m, d = (int(x) for x in iso.split('-'))
    sr = '%d. %s %d.' % (d, 'januara februara marta aprila maja juna jula avgusta septembra oktobra novembra decembra'.split()[m - 1], y)
    en = '%s %d, %d' % ('January February March April May June July August September October November December'.split()[m - 1], d, y)
    ru = '%d %s %d г.' % (d, 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'.split()[m - 1], y)
    return sr, en, ru


def dist_km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a['lat'], a['lon'], b['lat'], b['lon']))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


def fold(s):
    return s.lower().replace('č', 'c').replace('ć', 'c').replace('š', 's').replace('ž', 'z').replace('đ', 'dj')


def T(sr, en, ru):
    return {'sr': sr, 'en': en, 'ru': ru}


def tri(t):
    """{'sr','en','ru'} -> (sr, en, ru)."""
    return t['sr'], t['en'], t['ru']


# ------------------------------------------------------------------------------------------------ shared texts
# the price and the cost for 40 kWh in the second column: on a phone the tables scroll sideways and the first two
# columns are what shows
PRICES_HEAD = T(['Paket', 'Cena', 'Šta dobijaš'], ['Package', 'Price', 'What you get'], ['Пакет', 'Цена', 'Что получаешь'])
PRICES_ROWS = [
    T(['START', '39.000 RSD', 'pojačana utičnica sa MID brojilom, 2,3–3,7 kW'],
      ['START', '39.000 RSD', 'a heavy-duty socket with a MID meter, 2,3–3,7 kW'],
      ['START', '39.000 RSD', 'усиленная розетка с MID-счётчиком, 2,3–3,7 кВт']),
    T(['WALLBOX 11 kW', 'od 94.000 RSD', 'Iocharger 11 kW, kabl 5 m; sa MID brojilom 104.000 RSD'],
      ['WALLBOX 11 kW', 'from 94.000 RSD', 'Iocharger 11 kW, 5 m cable; with a MID meter 104.000 RSD'],
      ['WALLBOX 11 kW', 'от 94.000 RSD', 'Iocharger 11 кВт, кабель 5 м; с MID-счётчиком 104.000 RSD']),
    T(['ZGRADA', 'od 96.000 RSD po mestu', '2–6 mesta odjednom, MID merenje za svakog korisnika'],
      ['ZGRADA', 'from 96.000 RSD per space', '2–6 spaces at once, MID metering for every user'],
      ['ZGRADA', 'от 96.000 RSD за место', '2–6 мест одновременно, MID-учёт для каждого пользователя']),
    T(['Samo ugradnja', 'od 24.000 RSD', 'ugradnja punjača koji već imaš'],
      ['Installation only', 'from 24.000 RSD', 'we install a charger you already have'],
      ['Только монтаж', 'от 24.000 RSD', 'монтаж зарядки, которая у тебя уже есть']),
]
PRICES_INCLUDED = T(
    'Cena paketa je konačna i uključuje punjač i osnovnu ugradnju pored razvodne table: do 2 m kabla, FID zaštitu i '
    'automatski osigurač. Ako je mesto dalje od table, kabl i ostale radove računamo na proceni, pre početka radova.',
    'The package price is final and includes the charger and basic installation next to the distribution board: up to '
    '2 m of cable, an RCD (FID) and a circuit breaker. If your spot is farther from the board, the cable and other work '
    'are priced at the assessment, before any work starts.',
    'Цена пакета итоговая: в неё входят зарядка и базовый монтаж рядом с электрощитом — до 2 м кабеля, УЗО (FID) и '
    'автомат. Если место дальше от щита, кабель и остальные работы считаем на оценке, до начала работ.')
PRICES_MORE = T(['Wallbox Plus (od 115.000 RSD) i Wallbox Premium (155.000 RSD) opisani su na stranici ',
                 {'a': 'paketi i cene', 'href': '/paketi-i-cene'}, '.'],
                ['Wallbox Plus (from 115.000 RSD) and Wallbox Premium (155.000 RSD) are described under ',
                 {'a': 'packages and prices', 'href': '/paketi-i-cene'}, '.'],
                ['Wallbox Plus (от 115.000 RSD) и Wallbox Premium (155.000 RSD) — на странице ',
                 {'a': 'пакеты и цены', 'href': '/paketi-i-cene'}, '.'])
STEPS = [
    T('Pošalji poruku sa fotografijama razvodne table i mesta za punjač — okvirna procena po fotografijama je besplatna.',
      'Send us a message with photos of the distribution board and the spot for the charger — a rough estimate from '
      'photos is free.',
      'Напиши нам и пришли фото электрощита и места для зарядки — предварительная оценка по фото бесплатная.'),
    T('Procena na licu mesta: 72 h u Beogradu, Novom Sadu i Vojvodini, a u ostalim mestima termin dogovaramo u poruci. '
      'Košta 2.990 RSD i u celosti se uračunava u cenu ugradnje.',
      'The on-site assessment: 72 h in Belgrade, Novi Sad and Vojvodina; elsewhere we agree the date by message. It costs '
      '2.990 RSD and is fully credited toward the installation.',
      'Оценка на месте: 72 ч — Белград, Нови-Сад, Воеводина; в других местах срок согласуем в переписке. Она стоит '
      '2.990 RSD и полностью засчитывается в стоимость установки.'),
    T('Na proceni proveravamo instalaciju, snagu priključka i put kabla, a ti dobijaš tačnu ponudu pre bilo kakvog potpisa.',
      'At the assessment we check the wiring, the connection capacity and the cable route, and you get an exact quote '
      'before you sign anything.',
      'На оценке проверяем проводку, мощность подключения и трассу кабеля, а ты получаешь точное предложение до '
      'любой подписи.'),
    T('Ugradnju radi licencirani električar, za jedan radni dan.',
      'A licensed electrician does the installation in one working day.',
      'Монтаж делает лицензированный электрик за один рабочий день.'),
    T('MID brojilo meri samo tvoj punjač, pa uvek znaš koliko je struje otišlo na auto.',
      'The MID meter measures only your charger, so you always know how much electricity went into the car.',
      'MID-счётчик считает только твою зарядку, поэтому ты всегда знаешь, сколько электричества ушло на машину.'),
]
# the assessment step of a city page: inside the 72 h zone (Beograd, Vojvodina) a plain 72 h, elsewhere no promise
STEP_ZONE = T('Procena na licu mesta: u roku od 72 h, a tačan termin dogovaramo u poruci. Košta 2.990 RSD i u celosti '
              'se uračunava u cenu ugradnje.',
              'The on-site assessment: within 72 h; we agree the exact time by message. It costs 2.990 RSD and is fully '
              'credited toward the installation.',
              'Оценка на месте — в течение 72 ч, точное время согласуем в переписке. Она стоит 2.990 RSD и полностью '
              'засчитывается в стоимость установки.')
STEP_AWAY = T('Termin procene na licu mesta dogovaramo u poruci. Košta 2.990 RSD i u celosti se uračunava u cenu ugradnje.',
              'We agree the date of the on-site assessment by message. It costs 2.990 RSD and is fully credited toward '
              'the installation.',
              'Срок выезда на оценку согласуем в переписке. Она стоит 2.990 RSD и полностью засчитывается в стоимость '
              'установки.')
ZONE_72H = ('beograd', 'vojvodina')             # regions where the 72 h of the site hold (decision 28.10.2026)
SABLONI = '/sabloni-za-skupstinu'


def steps_of(c):
    s = list(STEPS)
    s[1] = STEP_ZONE if c['region'] in ZONE_72H else STEP_AWAY
    return s


BUILDING = T(
    'U kući punjač ide na tvoju instalaciju i dovoljna je procena. Za mesto u zajedničkoj garaži zgrade treba odluka '
    'skupštine stambene zajednice: Evolako daje tehnički opis ugradnje, šabloni (predlog odluke, tačka dnevnog reda, '
    'saglasnost vlasnika) su besplatni za sve, a stanari odlučuju i predaju papire sami.',
    'In a house, the charger goes on your own installation and the assessment is all it takes. For a space in a '
    'building’s shared garage, the residents’ assembly has to decide: Evolako provides a technical description of the '
    'installation, the templates (a draft decision, an agenda item, the owner’s consent) are free for everyone, and the '
    'residents decide and submit the papers themselves.',
    'В частном доме зарядка подключается к твоей проводке, и достаточно оценки. Для места в общем гараже многоэтажки '
    'нужно решение собрания жильцов: Evolako даёт техническое описание монтажа, шаблоны (проект решения, пункт '
    'повестки, согласие собственника) бесплатны для всех, а жильцы решают и подают документы сами.')
BUILDING_LINK = T(['Šabloni su na stranici ', {'a': 'šabloni za skupštinu', 'href': SABLONI},
                   ', a kako to ide korak po korak, objašnjeno je na stranici ',
                   {'a': 'punjači za stambene zgrade', 'href': '/punjaci-za-stambene-zgrade'}, '.'],
                  ['The templates are on the ', {'a': 'assembly templates', 'href': SABLONI},
                   ' page; step by step: see ', {'a': 'chargers for apartment buildings', 'href': '/punjaci-za-stambene-zgrade'},
                   '.'],
                  ['Шаблоны — на странице ', {'a': 'шаблоны для собрания', 'href': SABLONI}, ', а по шагам — на странице ',
                   {'a': 'зарядки для жилых домов', 'href': '/punjaci-za-stambene-zgrade'}, '.'])
SUBSCRIPTION = T(
    'Pretplata je opciona: 990 RSD mesečno, a prva 2 meseca su 0 RSD. Uz nju dobijaš mesečni obračun po MID brojilu, '
    'po ceni iz računa EPS-a i bez marže, uz izveštaj za vlasnika garaže ili zgradu, prioritetni servis, zimsku proveru '
    'i prenos kompleta pri selidbi. Otkazuješ bilo kog meseca, a punjač radi i bez pretplate.',
    'The subscription is optional: 990 RSD a month, and the first 2 months are 0 RSD. It gives you a monthly '
    'statement from the MID meter at the price on your EPS bill with no markup, with a report for the garage owner or '
    'the building, priority service, a winter check and moving the kit when you move. You can cancel in any month, and '
    'the charger works without it.',
    'Подписка — по желанию: 990 RSD в месяц, первые 2 месяца — 0 RSD. С ней ты получаешь ежемесячный расчёт по '
    'MID-счётчику по цене из счёта EPS без наценки и отчёт для владельца гаража или дома, приоритетный сервис, зимнюю '
    'проверку и перенос комплекта при переезде. Отменить можно в любом месяце, а зарядка работает и без подписки.')
HOME_COST = T(
    'Noćni kWh u plavoj zoni, sa svim naknadama i porezima, košta oko 6 RSD. Na brzim javnim punjačima kWh je po '
    'računima iz avgusta i septembra 2026. koštao od 43 do 79 RSD.',
    'A night kWh in the blue zone costs about 6 RSD with all fees and taxes. On fast public chargers, receipts from '
    'August and September 2026 put a kWh at 43 to 79 RSD.',
    'Ночной кВт·ч в синей зоне со всеми надбавками и налогами стоит около 6 RSD. На быстрых общественных зарядках, по '
    'чекам за август и сентябрь 2026 года, кВт·ч стоил от 43 до 79 RSD.')
COST_HEAD = T(['Gde puniš', 'Za 40 kWh', 'Cena kWh'], ['Where you charge', 'For 40 kWh', 'Price per kWh'],
              ['Где заряжаешь', 'За 40 кВт·ч', 'Цена кВт·ч'])
COST_ROWS = [T(['Kod kuće, noću (plava zona)', 'oko 240 RSD', 'oko 6 RSD'],
               ['At home, at night (blue zone)', 'about 240 RSD', 'about 6 RSD'],
               ['Дома, ночью (синяя зона)', 'около 240 RSD', 'около 6 RSD']),
             T(['Brzi javni punjač', '1.720–3.160 RSD', '43–79 RSD'],
               ['Fast public charger', '1.720–3.160 RSD', '43–79 RSD'],
               ['Быстрая общественная зарядка', '1.720–3.160 RSD', '43–79 RSD'])]
TIMER_LINK = T(['Kako da auto puni samo noću, piše u vodiču o ', {'a': 'tajmeru za noćno punjenje', 'href': '/punjenje-nocu-tajmer'}, '.'],
               ['How to make the car charge only at night: see the guide to the ',
                {'a': 'night charging timer', 'href': '/punjenje-nocu-tajmer'}, '.'],
               ['Как настроить зарядку только ночью — в гайде про ', {'a': 'таймер ночной зарядки', 'href': '/punjenje-nocu-tajmer'}, '.'])
EVERYDAY = T('Za put je dobro znati gde su. Za svakodnevnu vožnju je jednostavnije i jeftinije da auto puniš kod kuće, '
             'preko noći.',
             'They’re good to know for trips. For everyday driving it’s simpler and cheaper to charge at home, overnight.',
             'Это полезно знать для поездок. А в обычные дни проще и дешевле заряжать машину дома, ночью.')
EVERYDAY_NONE = T('Zato je za svakodnevnu vožnju najjednostavnije da auto puniš kod kuće, preko noći.',
                  'That’s why, for everyday driving, charging at home overnight is the simplest option.',
                  'Поэтому в обычные дни проще всего заряжать машину дома, ночью.')
MAP_LINK = T(['Sve lokacije su na ', {'a': 'mapi punjača', 'href': '/mapa-punjaca'}, '.'],
             ['All the locations are on the ', {'a': 'charger map', 'href': '/mapa-punjaca'}, '.'],
             ['Все локации — на ', {'a': 'карте зарядок', 'href': '/mapa-punjaca'}, '.'])
TARIFF_CAVEAT = T(' Tačno vreme zavisi od distributivnog područja, pa ga proveri u obaveštenju uz račun.',
                  ' The exact hours depend on the distribution area, so check the notice that comes with your bill.',
                  ' Точное время зависит от распределительного района — проверь его в уведомлении к счёту.')
KICKER = T('Gde radimo', 'Where we work', 'Где работаем')
SRC_EPS = T('EPS — cene električne energije za garantovano snabdevanje (od 1. oktobra 2025.)',
            'EPS — electricity prices for guaranteed supply (from October 1, 2025)',
            'EPS — цены на электроэнергию для гарантированного снабжения (с 1 октября 2025 г.)')
URL_EPS = 'https://www.eps.rs/cir/snabdevanje/Pages/cene.aspx'
SRC_DC = T('Brzo punjenje u Srbiji: od 43 do 79 dinara po kWh (22.09.2026.)',
           'Fast charging in Serbia: 43 to 79 dinars per kWh (22.09.2026)',
           'Быстрая зарядка в Сербии: от 43 до 79 динаров за кВт·ч (22.09.2026)')
URL_DC = 'https://www.blokvolt.rs/vesti/cena-brzog-punjenja-43-79-rsd-po-kwh/'
# titles of Serbian-language sources stay as published on every language (site/i18n/keep.json)
SRC_NT = T(*['Kurir — Tokom ovih sati struja je jeftinija: noćna tarifa nije ista za sve (05.01.2026.)'] * 3)
URL_NT = 'https://biznis.kurir.rs/novcanik/9878478/kad-pocinje-jeftina-struja'
SRC_NT2 = T(*['N1 — Jeftinija struja noću: tri zone u Srbiji (08.09.2023.)'] * 3)
URL_NT2 = 'https://n1info.rs/biznis/jeftinija-struja-nocu-tri-zone-u-srbiji-kad-pocinje/'
SRC_LAW = T('Zakon o teritorijalnoj organizaciji Republike Srbije, član 20 (Sl. glasnik RS 129/2007, 18/2016, 47/2018, 9/2020)',
            'Law on the Territorial Organization of the Republic of Serbia, Article 20 (Official Gazette 129/2007, 18/2016, 47/2018, 9/2020)',
            'Закон о территориальной организации Республики Сербии, статья 20 (Службени гласник 129/2007, 18/2016, 47/2018, 9/2020)')
URL_LAW = 'https://pravno-informacioni-sistem.rs/eli/rep/sgrs/skupstina/zakon/2007/129/1/reg'
URL_BV_MAP = 'https://www.blokvolt.rs/mapa/'
URL_BV_TOWNS = 'https://www.blokvolt.rs/gradovi/'
TRANS = ('Ova stranica je napisana uz pomoć AI alata na osnovu navedenih izvora, a podaci su provereni %s Ako vidiš grešku '
         'ili imaš noviji podatak, javi nam na hello@evolako.com — ispravke objavljujemo sa datumom.',
         'This page was written with the help of AI tools based on the sources listed, and the data were checked on %s. '
         'If you spot an error or have newer data, let us know at hello@evolako.com — we publish corrections with a date.',
         'Эта страница написана с помощью ИИ-инструментов на основе указанных источников, данные проверены %s Если '
         'видишь ошибку или у тебя есть более свежие данные, напиши нам на hello@evolako.com — исправления мы публикуем с датой.')
UPDATED = ('Ažurirano: %s', 'Updated: %s', 'Обновлено: %s')
CALL_BTN = T('Pošalji upit', 'Send a request', 'Отправить заявку')


def trans_line(date):
    sr, en, ru = dates(date)
    return TRANS[0] % sr, TRANS[1] % en, TRANS[2] % ru


# ------------------------------------------------------------------------------------------------ one city
def city_texts(c, data):
    """The three documents (sr, en, ru) of a city page in the guide schema, plus its JSON-LD inputs."""
    n_sr, n_en, n_ru = c['name'], c['en']['name'], c['ru']['name']
    loc_sr, loc_ru = c['loc'], c['ru']['loc']           # u Kragujevcu / в Крагуеваце (with the preposition)
    pub = c['public']
    checked = data['map']['checked']                   # DD.MM.YYYY
    docs = [dict() for _ in range(3)]

    def put(path, t):
        for i, lang in enumerate(('sr', 'en', 'ru')):
            d = docs[i]
            for k in path[:-1]:
                d = d.setdefault(k, {})
            d[path[-1]] = t[lang] if isinstance(t, dict) else t[i]

    slug = PREFIX + c['slug']
    for d in docs:
        d.update({'page': slug, 'slug': '/' + slug, 'tone': 'ti', 'kind': 'grad'})
    put(['seo', 'title'], T('Ugradnja kućnog punjača u %s | Evolako' % loc_sr,
                            'Home charger installation in %s | Evolako' % n_en,
                            'Установка домашней зарядки %s | Evolako' % loc_ru))
    put(['seo', 'description'], T(
        'Kućni punjač u %s: START 39.000 RSD, WALLBOX od 94.000 RSD, sa ugradnjom pored razvodne table. MID brojilo i '
        'mesečni obračun struje.' % loc_sr,
        'Home charger in %s: START 39.000 RSD, WALLBOX from 94.000 RSD, installed next to the distribution board. MID '
        'meter and a monthly statement.' % n_en,
        'Домашняя зарядка %s: START 39.000 RSD, WALLBOX от 94.000 RSD, с монтажом рядом с электрощитом. MID-счётчик и '
        'ежемесячный расчёт.' % loc_ru))
    put(['seo', 'og_title'], T('Kućni punjač u %s — Evolako' % loc_sr, 'Home charger in %s — Evolako' % n_en,
                               'Домашняя зарядка %s — Evolako' % loc_ru))
    put(['seo', 'og_description'], T(
        'Pojačana utičnica ili wallbox, MID brojilo i mesečni obračun struje — u %s i u celoj Srbiji.' % loc_sr,
        'A heavy-duty socket or a wallbox, a MID meter and a monthly electricity statement — in %s and all over '
        'Serbia.' % n_en,
        'Усиленная розетка или wallbox, MID-счётчик и ежемесячный расчёт за электричество — %s и по всей Сербии.' % loc_ru))
    put(['hero', 'kicker'], KICKER)
    put(['hero', 'h1'], T('Ugradnja kućnog punjača za električni auto u %s' % loc_sr,
                          'Home EV charger installation in %s' % n_en,
                          'Установка домашней зарядки для электромобиля %s' % loc_ru))
    put(['hero', 'lead'], T(
        'Evolako radi u celoj Srbiji, pa i u %s: pojačana utičnica ili wallbox sa ugradnjom pored razvodne table, MID '
        'brojilo i mesečni obračun struje po ceni iz tvog računa EPS-a, bez marže.' % loc_sr,
        'Evolako works all over Serbia, including %s: a heavy-duty socket or a wallbox installed next to your '
        'distribution board, a MID meter and a monthly electricity statement at the price on your EPS bill, with no '
        'markup.' % n_en,
        'Evolako работает по всей Сербии, в том числе %s: усиленная розетка или wallbox с монтажом рядом с '
        'электрощитом, MID-счётчик и ежемесячный расчёт за электричество по цене из твоего счёта EPS, без наценки.'
        % loc_ru))
    for i, s in enumerate(UPDATED):
        docs[i].setdefault('hero', {})['updated'] = s % dates(data['date'])[i]

    blocks = []

    def add(kind, t):
        blocks.append((kind, t))

    # 1. public charging in the area (the city's own data)
    add('h2', T('Javni punjači u %s i okolini' % loc_sr, 'Public chargers in and around %s' % n_en,
                'Общественные зарядки %s и рядом' % loc_ru))
    n, dc50, best = pub['n'], pub['n_dc50'], pub.get('best')
    # "U Kragujevcu i okolini, do 25 km od centra, na mapi javnih punjača …" (the BlokVolt town area: the map stations
    # whose nearest town is this city, within 25 km)
    where = T('U %s i okolini, do 25 km od centra, na mapi javnih punjača' % loc_sr,
              'In and around %s, within 25 km of the center, the public charging map shows' % n_en,
              '%s и в радиусе 25 км от центра на карте общественных зарядок' % (loc_ru[0].upper() + loc_ru[1:]))

    def station(s, lang, always=False):
        unit = 'кВт' if lang == 'ru' else 'kW'
        inner = ('%s, DC %s %s' % (s['net'], num(s['dc']), unit)) if s['net'] else 'DC %s %s' % (num(s['dc']), unit)
        return '%s (%s)' % (s['name'], inner) + ((', ' + km_txt(s['km'], lang)) if always or s['km'] > 5 else '')

    sr_verb = 'su' if sr_word(n, 'one', 'few', 'many') == 'few' else 'je'
    if best and n == 1:
        first = T('%s je samo jedna lokacija: %s.' % (where['sr'], station(best, 'sr')),
                  '%s only one location: %s.' % (where['en'], station(best, 'en')),
                  '%s — только одна локация: %s.' % (where['ru'], station(best, 'ru')))
    elif best:
        first = T('%s %s %d %s, od toga %d sa brzim DC punjačem od 50 kW ili jačim. Najjači punjač: %s.'
                  % (where['sr'], sr_verb, n, sr_word(n, 'lokacija', 'lokacije', 'lokacija'), dc50, station(best, 'sr')),
                  '%s %d %s; %d of them %s a fast DC charger of 50 kW or more. The most powerful: %s.'
                  % (where['en'], n, 'location' if n == 1 else 'locations', dc50, 'has' if dc50 == 1 else 'have',
                     station(best, 'en')),
                  '%s — %d %s, из них %d с быстрой DC-зарядкой от 50 кВт. Самая мощная: %s.'
                  % (where['ru'], n, ru_word(n, 'локация', 'локации', 'локаций'), dc50, station(best, 'ru')))
    else:
        near = pub['nearest_dc50']
        if n == 0:
            first = T('%s nema nijedne lokacije za punjenje. Najbliži brzi punjač: %s.'
                      % (where['sr'], station(near, 'sr', True)),
                      '%s no charging locations. The nearest fast charger: %s.' % (where['en'], station(near, 'en', True)),
                      '%s нет ни одной локации. Ближайшая быстрая зарядка: %s.' % (where['ru'], station(near, 'ru', True)))
        else:
            first = T('%s %s %d %s, ali bez brzog DC punjača od 50 kW. Najbliži brzi punjač: %s.'
                      % (where['sr'], sr_verb, n, sr_word(n, 'lokacija', 'lokacije', 'lokacija'), station(near, 'sr', True)),
                      '%s %d %s, but no fast DC charger of 50 kW. The nearest fast charger: %s.'
                      % (where['en'], n, 'location' if n == 1 else 'locations', station(near, 'en', True)),
                      '%s — %d %s, но без быстрой DC-зарядки от 50 кВт. Ближайшая быстрая зарядка: %s.'
                      % (where['ru'], n, ru_word(n, 'локация', 'локации', 'локаций'), station(near, 'ru', True)))
    add('p', first)
    if pub['nets']:
        nets = ', '.join(pub['nets'])
        add('p', T('Mreže na tom području: %s. Stanje %s.' % (nets, checked),
                   'Networks in the area: %s. As of %s.' % (nets, checked),
                   'Сети в этом районе: %s. Данные на %s.' % (nets, checked)))
    else:
        add('p', T('Stanje %s.' % checked, 'As of %s.' % checked, 'Данные на %s.' % checked))
    if c.get('note'):
        add('p', c['note']['text'])
    add('p', EVERYDAY if n else EVERYDAY_NONE)
    add('p', MAP_LINK)
    # 2. night tariff of the area
    add('h2', T('Koliko košta punjenje kod kuće u %s' % loc_sr, 'What charging at home costs in %s' % n_en,
                'Сколько стоит зарядка дома %s' % loc_ru))
    zone = c['tariff']
    if zone == 'beograd':
        tt = T('U Beogradu niža tarifa EPS-a traje od 24 do 8 časova.',
               'In Belgrade, the EPS lower tariff runs from midnight to 8 a.m.',
               'В Белграде ночной тариф EPS действует с 24 до 8 часов.')
    elif zone == 'vojvodina':
        tt = T('%s je u Vojvodini, gde niža tarifa EPS-a traje od 23 do 7 časova.' % n_sr,
               '%s is in Vojvodina, where the EPS lower tariff runs from 11 p.m. to 7 a.m.' % n_en,
               '%s — в Воеводине, где ночной тариф EPS действует с 23 до 7 часов.' % n_ru)
    else:
        tt = T('U %s, kao i u celoj Srbiji van Beograda i Vojvodine, niža tarifa EPS-a traje od 22 do 6 časova.' % loc_sr,
               'In %s, as everywhere in Serbia outside Belgrade and Vojvodina, the EPS lower tariff runs from 10 p.m. to '
               '6 a.m.' % n_en,
               '%s, как и везде в Сербии за пределами Белграда и Воеводины, ночной тариф EPS действует с 22 до 6 часов.'
               % (loc_ru[0].upper() + loc_ru[1:]))
    add('p', T(tt['sr'] + TARIFF_CAVEAT['sr'], tt['en'] + TARIFF_CAVEAT['en'], tt['ru'] + TARIFF_CAVEAT['ru']))
    add('p', HOME_COST)
    add('table', T({'head': COST_HEAD['sr'], 'rows': [r['sr'] for r in COST_ROWS]},
                   {'head': COST_HEAD['en'], 'rows': [r['en'] for r in COST_ROWS]},
                   {'head': COST_HEAD['ru'], 'rows': [r['ru'] for r in COST_ROWS]}))
    add('p', TIMER_LINK)
    # 3. packages
    add('h2', T('Paketi i cene', 'Packages and prices', 'Пакеты и цены'))
    add('p', PRICES_INCLUDED)
    add('table', T({'head': PRICES_HEAD['sr'], 'rows': [r['sr'] for r in PRICES_ROWS]},
                   {'head': PRICES_HEAD['en'], 'rows': [r['en'] for r in PRICES_ROWS]},
                   {'head': PRICES_HEAD['ru'], 'rows': [r['ru'] for r in PRICES_ROWS]}))
    add('p', PRICES_MORE)
    # 4. how it goes
    add('h2', T('Kako ide ugradnja u %s' % loc_sr, 'How the installation goes in %s' % n_en,
                'Как проходит установка %s' % loc_ru))
    st = steps_of(c)
    add('ul', T([s['sr'] for s in st], [s['en'] for s in st], [s['ru'] for s in st]))
    # 5. house or building
    add('h2', T('Kuća ili garaža zgrade', 'A house or a building garage', 'Частный дом или гараж многоэтажки'))
    add('p', BUILDING)
    add('p', BUILDING_LINK)
    # 6. subscription
    add('h2', T('Pretplata', 'Subscription', 'Подписка'))
    add('p', SUBSCRIPTION)
    # 7. nearby cities
    add('h2', T('Gradovi u blizini', 'Nearby cities', 'Города рядом'))
    others = sorted((o for o in data['cities'] if o is not c), key=lambda o: dist_km(c, o))[:4]
    segs = (['Radimo i u gradovima u blizini: '], ['We also work in nearby cities: '], ['Работаем и в соседних городах: '])
    for j, o in enumerate(others):
        for i, nm in enumerate((o['name'], o['en']['name'], o['ru']['name'])):
            if j:
                segs[i].append(', ')
            segs[i].append({'a': nm, 'href': '/' + PREFIX + o['slug']})
    for i, (tail, anchor, end) in enumerate(((' — i u ', 'svim ostalim mestima u Srbiji', '.'),
                                              (' — and in ', 'every other place in Serbia', '.'),
                                              (' — и во ', 'всех остальных местах Сербии', '.'))):
        segs[i].extend([tail, {'a': anchor, 'href': '/' + HUB}, end])
    add('p', T(*segs))
    for i, lang in enumerate(('sr', 'en', 'ru')):
        docs[i]['sections'] = [{'type': 'article', 'id': 'tekst', 'blocks': [{k: t[lang]} for k, t in blocks]}]
    # sources
    src = []
    if pub.get('bv_url'):
        src.append((T('Javni punjači u %s i okolini, sa adresom, mrežom i snagom (stanje %s.)' % (loc_sr, checked),
                      'Public chargers in and around %s, with address, network and power (as of %s)' % (n_en, checked),
                      'Общественные зарядки %s и рядом: адрес, сеть и мощность (на %s)' % (loc_ru, checked)),
                    pub['bv_url']))
    else:
        src.append((T('Mapa javnih punjača u Srbiji (stanje %s.)' % checked,
                      'Map of public chargers in Serbia (as of %s)' % checked,
                      'Карта общественных зарядок в Сербии (на %s)' % checked), URL_BV_MAP))
    if c.get('note'):
        src.append((c['note']['source'], c['note']['url']))
    src += [(SRC_NT, URL_NT), (SRC_NT2, URL_NT2), (SRC_EPS, URL_EPS), (SRC_DC, URL_DC)]
    for i, lang in enumerate(('sr', 'en', 'ru')):
        docs[i]['sections'].append({'type': 'sources', 'id': 'izvori', 'h2': ('Izvori', 'Sources', 'Источники')[i],
                                    'items': [{'title': t[lang], 'url': u} for t, u in src]})
        docs[i]['sections'].append({'type': 'callout', 'id': 'cta',
                                    'h2': ('Punjač u %s' % loc_sr, 'A charger in %s' % n_en, 'Зарядка %s' % loc_ru)[i],
                                    'text': ('Pošalji fotografije razvodne table i mesta za punjač — okvirna procena po '
                                             'fotografijama je besplatna, a odgovaramo u roku od 48 sati.',
                                             'Send photos of the distribution board and the spot for the charger — a '
                                             'rough estimate from photos is free, and we reply within 48 hours.',
                                             'Пришли фото электрощита и места для зарядки — предварительная оценка по '
                                             'фото бесплатная, отвечаем в течение 48 часов.')[i],
                                    'button': {'label': CALL_BTN[lang], 'href': '/kontakt'}})
        docs[i]['sections'].append({'type': 'links', 'id': 'srodni', 'h2': ('Pročitaj i ovo', 'Read next', 'Читай также')[i],
                                    'items': [
                                        {'title': ('Paketi i cene', 'Packages and prices', 'Пакеты и цены')[i],
                                         'text': ('Svi paketi, šta je u ceni i pretplata.',
                                                  'All packages, what’s included and the subscription.',
                                                  'Все пакеты, что входит в цену, и подписка.')[i],
                                         'href': '/paketi-i-cene'},
                                        {'title': ('Kako da auto puni samo noću', 'How to charge only at night',
                                                   'Как заряжать только ночью')[i],
                                         'text': ('Tajmer u autu i na punjaču i sati niže tarife.',
                                                  'The timer in the car and on the charger, and the lower-tariff hours.',
                                                  'Таймер в машине и на зарядке и часы ночного тарифа.')[i],
                                         'href': '/punjenje-nocu-tajmer'},
                                        {'title': ('Svi gradovi', 'All cities', 'Все города')[i],
                                         'text': ('Ugradnja kućnog punjača u celoj Srbiji.',
                                                  'Home charger installation all over Serbia.',
                                                  'Установка домашней зарядки по всей Сербии.')[i],
                                         'href': '/' + HUB}]})
    ld_names = [(n_sr, n_en, n_ru), ('Srbija', 'Serbia', 'Сербия'),
                ('Ugradnja kućnog punjača za električni auto', 'Home EV charger installation',
                 'Установка домашней зарядки для электромобиля'),
                ('Ugradnja punjača za električne automobile', 'EV charger installation', 'Установка зарядок для электромобилей'),
                ('Početna', 'Home', 'Главная'), ('Ugradnja punjača', 'Charger installation', 'Установка зарядок')]
    return docs, ld_names


def city_jsonld(c, docs):
    url = SITE + '/' + PREFIX + c['slug']
    org = {'@id': SITE + '/#org'}
    return {'@context': 'https://schema.org', '@graph': [
        {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Evolako', 'url': SITE + '/', 'email': 'hello@evolako.com',
         'sameAs': SAME_AS, 'areaServed': [{'@type': 'Country', 'name': 'Srbija'}], 'knowsLanguage': ['sr', 'ru', 'en']},
        {'@type': 'Service', '@id': url + '#service', 'name': 'Ugradnja kućnog punjača za električni auto',
         'serviceType': 'Ugradnja punjača za električne automobile', 'description': docs[0]['seo']['description'],
         'provider': org, 'url': url,
         'areaServed': {'@type': 'City', 'name': c['name'], 'containedInPlace': {'@type': 'Country', 'name': 'Srbija'}}},
        {'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Početna', 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Ugradnja punjača', 'item': SITE + '/' + HUB},
            {'@type': 'ListItem', 'position': 3, 'name': c['name']}]}]}


SAME_AS = []          # set by content.py from the kit (the profiles in the site footer)


# ------------------------------------------------------------------------------------------------ the hub
def hub_texts(data):
    docs = [dict() for _ in range(3)]
    for d in docs:
        d.update({'page': HUB, 'slug': '/' + HUB, 'tone': 'ti', 'kind': 'grad'})
    t = [T('Ugradnja kućnog punjača u celoj Srbiji | Evolako', 'Home charger installation all over Serbia | Evolako',
           'Установка домашней зарядки по всей Сербии | Evolako'),
         T('Kućni punjač za električni auto u celoj Srbiji: START 39.000 RSD, WALLBOX od 94.000 RSD, MID brojilo i '
           'mesečni obračun. Gradovi i kako ide ugradnja.',
           'Home EV charger all over Serbia: START 39.000 RSD, WALLBOX from 94.000 RSD, a MID meter and a monthly '
           'statement. Cities and how installation goes.',
           'Домашняя зарядка для электромобиля по всей Сербии: START 39.000 RSD, WALLBOX от 94.000 RSD, MID-счётчик и '
           'ежемесячный расчёт. Города и как проходит установка.'),
         T('Kućni punjač u celoj Srbiji — Evolako', 'Home charger all over Serbia — Evolako',
           'Домашняя зарядка по всей Сербии — Evolako'),
         T('Pojačana utičnica ili wallbox, MID brojilo i mesečni obračun struje — u svakom gradu Srbije.',
           'A heavy-duty socket or a wallbox, a MID meter and a monthly electricity statement — in every city of Serbia.',
           'Усиленная розетка или wallbox, MID-счётчик и ежемесячный расчёт за электричество — в любом городе Сербии.')]
    for i, lang in enumerate(('sr', 'en', 'ru')):
        docs[i]['seo'] = {'title': t[0][lang], 'description': t[1][lang], 'og_title': t[2][lang], 'og_description': t[3][lang]}
        docs[i]['hero'] = {'kicker': KICKER[lang],
                           'h1': ('Ugradnja kućnog punjača za električni auto u celoj Srbiji',
                                  'Home EV charger installation all over Serbia',
                                  'Установка домашней зарядки для электромобиля по всей Сербии')[i],
                           'lead': ('Evolako ugrađuje kućne punjače u celoj Srbiji: u kući, na mestu u garaži zgrade i za '
                                    'firme. Izaberi svoj grad — na njegovoj stranici su javni punjači u okolini, sati niže '
                                    'tarife i kako ide ugradnja.',
                                    'Evolako installs home chargers all over Serbia: in houses, at spaces in building '
                                    'garages and for companies. Pick your city — its page shows the public chargers '
                                    'nearby, the lower-tariff hours and how installation goes.',
                                    'Evolako устанавливает домашние зарядки по всей Сербии: в частных домах, на местах в '
                                    'гаражах многоэтажек и для компаний. Выбери свой город — на его странице '
                                    'общественные зарядки рядом, часы ночного тарифа и как проходит установка.')[i],
                           'updated': UPDATED[i] % dates(data['date'])[i]}
    by_region = {r: [] for r, _ in REGIONS}
    for c in data['cities']:
        by_region[c['region']].append(c)
    blocks = []
    for r, names in REGIONS:
        cities = sorted(by_region[r], key=lambda c: fold(c['name']))
        blocks.append(('h2', T(*names)))
        items = []
        for c in cities:
            n = c['public']['n']
            if n:
                tail = (' — %d %s na mapi' % (n, sr_word(n, 'javni punjač', 'javna punjača', 'javnih punjača')),
                        ' — %d public %s on the map' % (n, 'charger' if n == 1 else 'chargers'),
                        ' — %d %s на карте' % (n, ru_word(n, 'общественная зарядка', 'общественные зарядки',
                                                           'общественных зарядок')))
            else:
                tail = (' — na mapi još nema javnog punjača', ' — no public charger on the map yet',
                        ' — на карте пока нет общественных зарядок')
            items.append(T([{'a': c['name'], 'href': '/' + PREFIX + c['slug']}, tail[0]],
                           [{'a': c['en']['name'], 'href': '/' + PREFIX + c['slug']}, tail[1]],
                           [{'a': c['ru']['name'], 'href': '/' + PREFIX + c['slug']}, tail[2]]))
        blocks.append(('ul', T([x['sr'] for x in items], [x['en'] for x in items], [x['ru'] for x in items])))
    blocks.append(('h2', T('I u ostalim mestima', 'And everywhere else', 'И во всех остальных местах')))
    blocks.append(('p', T('Radimo i u mestima kojih nema na spisku. Pošalji poruku sa adresom i fotografijama razvodne '
                          'table i mesta za punjač, a procenu na licu mesta dogovaramo u poruci.',
                          'We also work in places that are not on the list. Send us the address and photos of the '
                          'distribution board and the spot for the charger, and we arrange the on-site assessment by message.',
                          'Работаем и там, чего нет в списке. Пришли адрес и фото электрощита и места для зарядки, а '
                          'о выезде на оценку договоримся в переписке.')))
    blocks.append(('h2', T('Kako ide ugradnja', 'How the installation goes', 'Как проходит установка')))
    blocks.append(('ul', T([s['sr'] for s in STEPS], [s['en'] for s in STEPS], [s['ru'] for s in STEPS])))
    blocks.append(('h2', T('Paketi i cene', 'Packages and prices', 'Пакеты и цены')))
    blocks.append(('p', PRICES_INCLUDED))
    blocks.append(('table', T({'head': PRICES_HEAD['sr'], 'rows': [r['sr'] for r in PRICES_ROWS]},
                              {'head': PRICES_HEAD['en'], 'rows': [r['en'] for r in PRICES_ROWS]},
                              {'head': PRICES_HEAD['ru'], 'rows': [r['ru'] for r in PRICES_ROWS]})))
    blocks.append(('p', PRICES_MORE))
    checked = data['map']['checked']
    for i, lang in enumerate(('sr', 'en', 'ru')):
        docs[i]['sections'] = [
            {'type': 'article', 'id': 'tekst', 'blocks': [{k: t[lang]} for k, t in blocks]},
            {'type': 'sources', 'id': 'izvori', 'h2': ('Izvori', 'Sources', 'Источники')[i], 'items': [
                {'title': SRC_LAW[lang], 'url': URL_LAW},
                {'title': ('Javni punjači po gradovima Srbije (stanje %s.)' % checked,
                           'Public chargers by city in Serbia (as of %s)' % checked,
                           'Общественные зарядки по городам Сербии (на %s)' % checked)[i], 'url': URL_BV_TOWNS},
                {'title': SRC_DC[lang], 'url': URL_DC}]},
            {'type': 'callout', 'id': 'cta', 'h2': ('Tvoj grad nije na spisku?', 'Your city is not on the list?',
                                                    'Твоего города нет в списке?')[i],
             'text': ('Pošalji poruku sa adresom — radimo u celoj Srbiji i odgovaramo u roku od 48 sati.',
                      'Send us a message with the address — we work all over Serbia and reply within 48 hours.',
                      'Напиши нам с адресом — мы работаем по всей Сербии и отвечаем в течение 48 часов.')[i],
             'button': {'label': CALL_BTN[lang], 'href': '/kontakt'}},
            {'type': 'links', 'id': 'srodni', 'h2': ('Pročitaj i ovo', 'Read next', 'Читай также')[i], 'items': [
                {'title': ('Paketi i cene', 'Packages and prices', 'Пакеты и цены')[i],
                 'text': ('Svi paketi, šta je u ceni i pretplata.', 'All packages, what’s included and the subscription.',
                          'Все пакеты, что входит в цену, и подписка.')[i], 'href': '/paketi-i-cene'},
                {'title': ('Proveri svoju garažu', 'Check your garage', 'Проверь свой гараж')[i],
                 'text': ('Tri pitanja i paket koji ti odgovara.', 'Three questions and the package that fits you.',
                          'Три вопроса — и подходящий пакет.')[i], 'href': '/proveri-svoju-garazu'},
                {'title': ('Punjači za stambene zgrade', 'Chargers for apartment buildings', 'Зарядки для жилых домов')[i],
                 'text': ('Skupština, zajednička linija i obračun po mestu.',
                          'The residents’ assembly, a shared line and billing per space.',
                          'Собрание жильцов, общая линия и расчёт по каждому месту.')[i],
                 'href': '/punjaci-za-stambene-zgrade'}]}]
    ld_names = [('Srbija', 'Serbia', 'Сербия'),
                ('Ugradnja kućnog punjača za električni auto', 'Home EV charger installation',
                 'Установка домашней зарядки для электромобиля'),
                ('Ugradnja punjača za električne automobile', 'EV charger installation', 'Установка зарядок для электромобилей'),
                ('Početna', 'Home', 'Главная'), ('Ugradnja punjača', 'Charger installation', 'Установка зарядок')]
    return docs, ld_names


def hub_jsonld(data, docs):
    url = SITE + '/' + HUB
    return {'@context': 'https://schema.org', '@graph': [
        {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Evolako', 'url': SITE + '/', 'email': 'hello@evolako.com',
         'sameAs': SAME_AS, 'areaServed': [{'@type': 'Country', 'name': 'Srbija'}], 'knowsLanguage': ['sr', 'ru', 'en']},
        {'@type': 'Service', '@id': url + '#service', 'name': 'Ugradnja kućnog punjača za električni auto',
         'serviceType': 'Ugradnja punjača za električne automobile', 'description': docs[0]['seo']['description'],
         'provider': {'@id': SITE + '/#org'}, 'url': url, 'areaServed': {'@type': 'Country', 'name': 'Srbija'}},
        {'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Početna', 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Ugradnja punjača'}]}]}


# ------------------------------------------------------------------------------------------------ rendering
def render_article(p, si, s):
    """The kits' article markup; list items may carry links too (the hub's list of cities)."""
    P = ['sections', si, 'blocks']
    chunks, cur = [], ''
    for i, b in enumerate(s['blocks']):
        k = list(b)[0]
        if k == 'h2' and cur:
            chunks.append(cur)
            cur = ''
        if k == 'h2':
            cur += '<h2 class="evb-ah2">%s</h2>' % p.t(P + [i, 'h2'])
        elif k == 'p':
            cur += '<p class="evb-ap">%s</p>' % p.para(P + [i, 'p'])
        elif k == 'ul':
            cur += '<ul class="evb-ul">' + ''.join('<li class="evb-li">%s</li>' % p.para(P + [i, 'ul', j])
                                                   for j in range(len(b['ul']))) + '</ul>'
        elif k == 'table':
            n = len(b['table']['head'])
            hd = ''.join('<div class="evb-th">%s</div>' % p.t(P + [i, 'table', 'head', j]) for j in range(n))
            rows = ''.join('<div class="evb-tr%d">%s</div>' % (n, ''.join(
                '<div class="evb-td">%s</div>' % p.t(P + [i, 'table', 'rows', r, j]) for j in range(n)))
                for r in range(len(b['table']['rows'])))
            cur += '<div class="evb-tblw"><div class="evb-tbl"><div class="evb-trh%d">%s</div>%s</div></div>' % (n, hd, rows)
    if cur:
        chunks.append(cur)
    sid = s.get('id', 'tekst')
    return [(('%s-%d' % (sid, j + 1)) if j else sid,
             '<section class="evb-sec-art" id="%s"><div class="w3"><div class="evb-art">%s</div></div></section>'
             % (('%s-%d' % (sid, j + 1)) if j else sid, c)) for j, c in enumerate(chunks)]


# ------------------------------------------------------------------------------------------------ checks
TONE_VI = [r'\b[Vv]i\b', r'\b[Vv]aš\w*', r'\b[Vv]am\b', r'\b[Vv]as\b', r'\bpišite\b', r'\bjavite\b', r'\bproverite\b']
NO_PROMISE = [r'72 sata', r'\bPDV', r'lokaln\w* električar', r'\bodmah\b', r'u roku od 7 dana']
ZONE_RX = r'72\s*h(?! u Beogradu, Novom Sadu i Vojvodini, a u ostalim mestima termin dogovaramo u poruci)'
TR_BANNED = {'en': [r'\batest', r'discount', r'24\s*/\s*7', r'plug\s*&\s*charge', r'\bimmediately\b', r'\bpaperwork\b',
                    r'\bVAT\b', r'72[- ]hour', r'\blocal electrician'],
             'ru': [r'атест', r'скидк', r'24\s*/\s*7', r'plug\s*&\s*charge', r'\bсразу\b', r'оформ\w*\s+документ',
                    r'бер[её]м на себя', r'НДС', r'72\s*час', r'\bвы\b', r'\bвас\b', r'\bвам\b', r'\bваш']}
_NUM = re.compile(r'\d+(?:[.,]\d+)+|\d{3,}')


def texts(doc, path=()):
    if isinstance(doc, dict):
        for k, v in doc.items():
            if k in ('href', 'url', 'page', 'slug', 'tone', 'kind', 'type', 'id'):
                continue
            yield from texts(v, path + (k,))
    elif isinstance(doc, list):
        for i, v in enumerate(doc):
            yield from texts(v, path + (i,))
    elif isinstance(doc, str):
        yield path, doc


def check(docs, kit, allowed_pages, zone=False):
    """Errors of one page (a list of strings). zone: a city inside the 72 h zone, whose page may promise a plain 72 h;
    anywhere else 72 h only comes with the zone wording of the site (deploy 4, 28.10.2026)."""
    errs = []
    sr, en, ru = docs
    seo = sr['seo']
    if not seo['title'].endswith(' | Evolako') or len(seo['title']) > 60:
        errs.append('seo.title must end with " | Evolako" and be ≤ 60 (%d)' % len(seo['title']))
    for d, lang in ((sr, 'sr'), (en, 'en'), (ru, 'ru')):
        n = len(d['seo']['description'])
        if not 70 <= n <= 160:
            errs.append('%s seo.description must be 70–160 chars (%d)' % (lang, n))
        if len(d['seo']['og_description']) > 200:
            errs.append('%s seo.og_description > 200' % lang)
    a, b, c = list(texts(sr)), list(texts(en)), list(texts(ru))
    if [p for p, _ in a] != [p for p, _ in b] or [p for p, _ in a] != [p for p, _ in c]:
        return errs + ['en/ru: structure differs from sr']
    for (p, s), (_, t_en), (_, t_ru) in zip(a, b, c):
        # a one-character piece of a paragraph between links is not translated: the page shows the Serbian one
        if isinstance(p[-1], int) and len(s.strip()) <= 1 and (t_en != s or t_ru != s):
            errs.append('%s: the piece %r must be the same in en/ru (%r, %r)' % ('.'.join(str(x) for x in p), s, t_en, t_ru))
    for (p, s), (_, t_en), (_, t_ru) in zip(a, b, c):
        where = '.'.join(str(x) for x in p)
        if not s.strip() and s != ' ':
            errs.append('%s: empty' % where)
        for rx in kit.FORBID + NO_PROMISE + ([] if zone else [ZONE_RX]):
            if re.search(rx, s, re.I):
                errs.append('%s: forbidden /%s/: %s' % (where, rx, s[:80]))
        for rx in TONE_VI:
            if re.search(rx, s):
                errs.append('%s: tone is «ti» — /%s/: %s' % (where, rx, s[:80]))
        if '"' in s:
            errs.append('%s: straight quotes' % where)
        for lang, t in (('en', t_en), ('ru', t_ru)):
            if not t.strip() and t != ' ':
                errs.append('%s %s: empty' % (lang, where))
            for rx in kit.TR_FORBID + TR_BANNED[lang]:
                if re.search(rx, t, re.I):
                    errs.append('%s %s: forbidden /%s/: %s' % (lang, where, rx, t[:80]))
            for nmb in _NUM.findall(s):
                if nmb not in t:
                    errs.append('%s %s: number %s missing: %s' % (lang, where, nmb, t[:80]))
    def walk(x, key=None):
        if isinstance(x, dict):
            for k, v in x.items():
                yield from walk(v, k)
        elif isinstance(x, list):
            for v in x:
                yield from walk(v, key)
        elif isinstance(x, str):
            yield key, x
    for key, v in walk(sr):
        if key == 'href' and not v.startswith('#') and v.split('?')[0].strip('/') not in allowed_pages and v != '/':
            errs.append('link target is not a page of the site: %s' % v)
        if key == 'url' and not v.startswith('https://'):
            errs.append('source url must be https://: %s' % v)
    return errs

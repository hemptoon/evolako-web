#!/usr/bin/env python3
"""Charger brand pages (SEO plan §4.1 д, task SEO4, 16.11.2026): /ugradnja-<punjač> — installing a charger the customer
already has (the installation-only package, od 24.000 RSD) — and their hub /samo-ugradnja-punjaca. Residents' kit, «ti».

What only this page has: the versions of the charger (power, phases, current), the protection, the conductors and the
warranty exactly as the manufacturer states them, what to check before buying it, and the product in shop.evolako.rs
where there is one. What Evolako does is the wording of /paketi-i-cene: installation next to the distribution board,
up to 2 m of cable, an RCD and a breaker; the charger must carry the CE mark and have 6 mA DC fault protection.

Not on these pages, on purpose: controlling the charger from the Evolako app (the app does not do it — each page
names the manufacturer's own app instead) and a monthly statement for a charger bought elsewhere (not offered).

Data and the brand's own texts: site/content/marke/marke.json. Texts shared by the pages: here.
"""
import json
import os
import re

import klasteri as KL

GR = KL.GR
T = KL.T
SITE = KL.SITE
PREFIX = 'ugradnja-'
HUB = 'samo-ugradnja-punjaca'
COVER_HUB = 9
KICKER = T('Samo ugradnja', 'Installation only', 'Только монтаж')
INCLUDED = T('Samo ugradnja je od 24.000 RSD, konačna cena: ugradnja pored razvodne table, do 2 m kabla, FID zaštita i automatski '
             'osigurač. Punjač mora imati CE oznaku i zaštitu od jednosmerne struje kvara (6 mA); ako je nema, FID tip B dodajemo '
             'u ponudi. Sve preko toga računamo posle procene, pre početka radova.',
             'Installation only starts at 24.000 RSD, final price: installation next to the distribution board, up to 2 m of '
             'cable, an RCD (FID) and a circuit breaker. The charger must carry the CE mark and have DC fault-current '
             'protection (6 mA); if it lacks that protection, we add a type B RCD to the quote. Anything beyond that is '
             'priced after the assessment, before any work starts.',
             'Только монтаж — от 24.000 RSD, цена итоговая: монтаж рядом с электрощитом, до 2 м кабеля, УЗО (FID) и автомат. У '
             'зарядки должны быть маркировка CE и защита от постоянного тока утечки (6 мА); если её нет, добавляем в смету УЗО '
             'типа B. Всё, что сверх этого, считаем после оценки, до начала работ.')
CABLE = T('U osnovnu ugradnju ulazi do 2 m kabla pored razvodne table. Presek biramo prema struji i dužini trase, a dužu trasu '
          'računamo posle procene.',
          'Basic installation includes up to 2 m of cable next to the distribution board. We choose the cross-section by the '
          'current and the length of the route, and a longer route is priced after the assessment.',
          'В базовый монтаж входит до 2 м кабеля рядом с электрощитом. Сечение подбираем по току и длине трассы, а более '
          'длинную трассу считаем после оценки.')
GUAR = T('Garanciju na punjač daje proizvođač, odnosno prodavac kod koga si ga kupio, pa sačuvaj račun.',
         'The warranty on the charger comes from the manufacturer or the seller you bought it from, so keep the receipt.',
         'Гарантию на зарядку даёт производитель или продавец, у которого ты её купил, так что сохрани чек.')
CTA_TEXT = T('Pošalji fotografije razvodne table, mesta za punjač i nalepnice sa oznakom punjača — okvirna procena po '
             'fotografijama je besplatna, a odgovaramo u roku od 48 sati.',
             'Send photos of the distribution board, the spot for the charger and the label with the charger’s model code — a '
             'rough estimate from photos is free, and we reply within 48 hours.',
             'Пришли фото электрощита, места для зарядки и наклейки с обозначением модели — предварительная оценка по фото '
             'бесплатная, отвечаем в течение 48 часов.')
CARD_PRICES = (T('Paketi i cene', 'Packages and prices', 'Пакеты и цены'),
               T('Svi paketi, šta je u ceni i pretplata.', 'All packages, what’s included and the subscription.',
                 'Все пакеты, что входит в цену, и подписка.'), '/paketi-i-cene')
CARD_HUB = (T('Samo ugradnja punjača', 'Installation only', 'Только монтаж зарядки'),
            T('Šta ulazi u cenu i šta proveriti pre kupovine punjača.', 'What the price includes and what to check before buying a charger.',
              'Что входит в цену и что проверить до покупки зарядки.'), '/' + HUB)
CARD_CABLE = (T('Wallbox sa kablom ili sa utičnicom', 'Wallbox with a cable or a socket', 'Wallbox с кабелем или с розеткой'),
              T('Po čemu se razlikuju, kada je koji bolji za garažu i kako da izmeriš potrebnu dužinu kabla.',
                'How they differ, which one suits your garage better and how to measure the cable length you need.',
                'Чем они отличаются, что лучше для гаража и как измерить нужную длину кабеля.'), '/wallbox-sa-kablom-ili-uticnicom')
CARD_MODEL = (T('Punjač po modelu auta', 'Chargers by car model', 'Зарядка по модели машины'),
              T('Ugrađeni punjač, vreme i cena punjenja po modelu.', 'On-board charger, charging time and cost by model.',
                'Бортовое зарядное, время и цена зарядки по моделям.'), '/kucni-punjac-po-modelu')


def load(content_dir):
    p = os.path.join(content_dir, 'marke', 'marke.json')
    if not os.path.isfile(p):
        return None
    with open(p, encoding='utf-8') as f:
        return json.load(f)


def validate(data):
    errs = []
    if not re.fullmatch(r'20\d\d-\d\d-\d\d', str(data.get('date'))):
        errs.append('marke.json needs "date" (YYYY-MM-DD)')
    if not str(data.get('shop', '')).startswith('https://shop.evolako.rs'):
        errs.append('marke.json needs "shop" (https://shop.evolako.rs)')
    seen = set()
    for b in data.get('brands', []):
        s = b.get('slug', '')
        if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', s) or s in seen:
            errs.append('%r: slug must be lowercase ASCII and unique' % s)
        seen.add(s)
        for k in ('name', 'h1', 'cls', 'lead', 'table', 'specs', 'protection', 'cable', 'check', 'warranty', 'faq', 'sources', 'cover'):
            if k not in b:
                errs.append('%s: "%s" is missing' % (s, k))
        if b.get('shop') and not re.fullmatch(r'/[a-z0-9-]+/', b['shop'].get('path', '')):
            errs.append('%s: shop.path must be /<product>/' % s)
    return errs


def steps(d):
    st = GR.STEPS[:4]
    d.ul(st)


# ------------------------------------------------------------------------------------------------ one brand
def brand_texts(b, data):
    d = KL.Doc(PREFIX + b['slug'], 'ti', 'vodic')
    n = b['name']
    h1 = b['h1']
    tt = b.get('title') or h1
    d.seo(T(*['%s | Evolako' % tt[k] for k in KL.LANGS]),
          T('%s: verzije i snaga, zaštita i presek kabla po uputstvu proizvođača, garancija i šta proveriti pre kupovine.' % n,
            '%s: versions and power, protection and cable cross-section per the manufacturer’s manual, warranty and what to '
            'check before buying.' % n,
            '%s: версии и мощность, защита и сечение кабеля по инструкции производителя, гарантия и что проверить до покупки.' % n),
          h1,
          T('Šta proizvođač navodi o snazi, zaštiti, kablu i garanciji za %s i šta ulazi u cenu ugradnje.' % n,
            'What the manufacturer states about power, protection, cable and warranty for the %s, and what the installation '
            'price includes.' % n,
            'Что производитель пишет о мощности, защите, кабеле и гарантии %s и что входит в цену монтажа.' % n))
    d.hero(KICKER, h1, b['lead'], data['date'])

    d.h2('Verzije i snaga', 'Versions and power', 'Версии и мощность')
    d.add('table', T(*[{'head': b['table']['head'][k], 'rows': [r[k] for r in b['table']['rows']]} for k in KL.LANGS]))
    for s in b['specs']:
        d.add('p', s)

    d.h2('Zaštita: šta traži proizvođač', 'Protection: what the manufacturer asks for', 'Защита: что требует производитель')
    for s in b['protection']:
        d.add('p', s)

    d.h2('Presek kabla', 'Cable cross-section', 'Сечение кабеля')
    d.add('p', b['cable'])
    d.p(*KL.tri(CABLE))

    d.h2('Šta proveriti pre kupovine', 'What to check before buying', 'Что проверить до покупки')
    d.add('ul', T(*[[c[k] for c in b['check']] for k in KL.LANGS]))

    d.h2('Garancija', 'Warranty', 'Гарантия')
    d.add('p', b['warranty'])
    d.p(*KL.tri(GUAR))

    d.h2('Šta ulazi u cenu ugradnje', 'What the installation price includes', 'Что входит в цену монтажа')
    d.p(*KL.tri(INCLUDED))
    steps(d)
    if b.get('extra'):
        d.add('p', b['extra'])
    if b.get('shop'):
        url = data['shop'] + b['shop']['path']
        pn = b['shop']['name']
        d.p(['Ako punjač tek kupuješ, možeš da ga rezervišeš u Evolako prodavnici: ', {'a': pn, 'href': url}, '.'],
            ['If you haven’t bought a charger yet, you can reserve one in the Evolako shop: ', {'a': KL_unit(pn, 'en'), 'href': url}, '.'],
            ['Если ты только собираешься покупать зарядку, её можно забронировать в магазине Evolako: ',
             {'a': KL_unit(pn, 'ru'), 'href': url}, '.'])

    for qa in b['faq']:
        d.question(qa['q'], qa['a'])
    d.question(T('Koliko košta ugradnja punjača %s?' % n, 'How much does it cost to install %s?' % KL.a_an(n),
                 'Сколько стоит монтаж %s?' % n),
               T('Od 24.000 RSD, konačna cena, za ugradnju pored razvodne table: do 2 m kabla, FID zaštita i automatski osigurač. '
                 'Sve preko toga računamo posle procene.',
                 'From 24.000 RSD, final price, for installation next to the distribution board: up to 2 m of cable, an RCD (FID) '
                 'and a circuit breaker. Anything beyond that is priced after the assessment.',
                 'От 24.000 RSD, цена итоговая, за монтаж рядом с электрощитом: до 2 м кабеля, УЗО (FID) и автомат. Всё, что сверх '
                 'этого, считаем после оценки.'))
    d.faq_block(T('Česta pitanja', 'FAQ', 'Частые вопросы'))

    for s in b['sources']:
        d.source(s['t'], s['url'])
    d.callout(T('Ugradnja punjača koji već imaš', 'Installing the charger you already have', 'Монтаж зарядки, которая у тебя уже есть'),
              CTA_TEXT, GR.CALL_BTN, '/kontakt')
    d.links(T('Pročitaj i ovo', 'Read next', 'Читай также'), [CARD_HUB, CARD_PRICES, CARD_CABLE])
    docs = d.build()
    ld_names = [('Srbija', 'Serbia', 'Сербия'),
                ('Ugradnja punjača za električne automobile', 'EV charger installation', 'Установка зарядок для электромобилей'),
                ('Početna', 'Home', 'Главная'), KL.tri(KICKER), (n, n, n)]
    return docs, ld_names


def KL_unit(s, lang):
    if lang == 'ru':
        return s.replace(' kW', ' кВт')
    return s


def brand_jsonld(b, docs, same_as):
    url = SITE + '/' + PREFIX + b['slug']
    sr = docs[0]
    return KL.graph(
        KL.org_node(same_as),
        {'@type': 'Service', '@id': url + '#service', 'name': sr['hero']['h1'],
         'serviceType': 'Ugradnja punjača za električne automobile', 'description': sr['seo']['description'],
         'provider': {'@id': SITE + '/#org'}, 'url': url, 'areaServed': {'@type': 'Country', 'name': 'Srbija'}},
        KL.breadcrumb(url, [('Početna', ''), (KICKER['sr'], HUB), (b['name'], None)]),
        KL.faq_node(url, sr))


# ------------------------------------------------------------------------------------------------ the hub
def hub_texts(data):
    d = KL.Doc(HUB, 'ti', 'vodic')
    h1 = T('Samo ugradnja punjača koji već imaš', 'Installation only: for a charger you already have',
           'Только монтаж: для зарядки, которая у тебя уже есть')
    d.seo(T('Samo ugradnja punjača koji već imaš | Evolako', 'Installing an EV charger you already have | Evolako',
            'Только монтаж зарядки, которая у тебя уже есть | Evolako'),
          T('Ugradnja wallboxa koji si kupio ili dobio uz auto: šta ulazi u konačnu cenu, šta punjač mora da ima i šta proveriti '
            'pre kupovine, po markama.',
            'Installing a wallbox you bought or got with the car: what the final price includes, what the charger must have and '
            'what to check before buying, by brand.',
            'Монтаж wallbox, который ты купил или получил с машиной: что входит в итоговую цену, что должно быть у зарядки и что '
            'проверить до покупки — по маркам.'),
          h1,
          T('Šta ulazi u cenu ugradnje punjača koji već imaš, šta punjač mora da ima i uputstva po markama.',
            'What’s included in the price of installing a charger you already have, what the charger must have, and notes by '
            'brand.',
            'Что входит в цену монтажа зарядки, которая у тебя уже есть, что должно быть у зарядки и памятки по маркам.'))
    d.hero(T('Usluga', 'Service', 'Услуга'), h1,
           T('Kupio si wallbox ili si ga dobio uz auto? Ugrađujemo ga od 24.000 RSD, konačna cena: pored razvodne table, do 2 m '
             'kabla, sa FID zaštitom i automatskim osiguračem. Punjač mora imati CE oznaku i zaštitu od jednosmerne struje kvara (6 mA).',
             'Bought a wallbox, or got one with the car? We install it from 24.000 RSD, final price: next to the distribution '
             'board, with up to 2 m of cable, an RCD (FID) and a circuit breaker. The charger must carry the CE mark and have DC '
             'fault-current protection (6 mA).',
             'Купил wallbox или получил его с машиной? Установим от 24.000 RSD, цена итоговая: рядом с электрощитом, до 2 м '
             'кабеля, с УЗО (FID) и автоматом. У зарядки должны быть маркировка CE и защита от постоянного тока утечки (6 мА).'),
           data['date'])
    d.h2('Šta ulazi u cenu', 'What the price includes', 'Что входит в цену')
    d.p(*KL.tri(INCLUDED))
    d.p(*KL.tri(CABLE))
    d.h2('Po markama', 'By brand', 'По маркам')
    d.p('Za ove punjače smo iz uputstava proizvođača izdvojili verzije, zaštitu, presek kabla i garanciju:',
        'For these chargers we have pulled the versions, protection, cable cross-section and warranty from the '
        'manufacturers’ manuals:',
        'Для этих зарядок мы выписали из инструкций производителей версии, защиту, сечение кабеля и гарантию:')
    items = []
    for b in data['brands']:
        href = '/' + PREFIX + b['slug']
        items.append(T([{'a': b['name'], 'href': href}, ' — ' + b['cls']['sr']], [{'a': b['name'], 'href': href}, ' — ' + b['cls']['en']],
                       [{'a': b['name'], 'href': href}, ' — ' + b['cls']['ru']]))
    d.ul(items)
    d.p('Punjač druge marke ugrađujemo pod istim uslovima, ako ima CE oznaku. Uz upit pošalji fotografiju nalepnice sa oznakom modela.',
        'We install a charger of another brand on the same terms, if it carries the CE mark. Send a photo of the label with the '
        'model code along with your request.',
        'Зарядку другой марки устанавливаем на тех же условиях, если у неё есть маркировка CE. К заявке приложи фото наклейки с '
        'обозначением модели.')
    d.h2('Šta proveriti pre kupovine punjača', 'What to check before buying a charger', 'Что проверить до покупки зарядки')
    d.ul([
        T('CE oznaka i zaštita od jednosmerne struje kvara (6 mA): bez nje se u ponudu dodaje FID tip B.',
          'The CE mark and DC fault-current protection (6 mA): without it, a type B RCD is added to the quote.',
          'Маркировка CE и защита от постоянного тока утечки (6 мА): без неё в смету добавляется УЗО типа B.'),
        T('Snaga prema priključku: 11 kW traži tri faze i 16 A po fazi, a 22 kW tri faze i 32 A.',
          'Power to match the connection: 11 kW needs three phases at 16 A each, and 22 kW three phases at 32 A.',
          'Мощность под подключение: для 11 кВт нужны три фазы по 16 А, для 22 кВт — три фазы по 32 А.'),
        T(['Kabl ili utičnica: razlika je opisana u vodiču ', {'a': 'wallbox sa kablom ili sa utičnicom', 'href': '/wallbox-sa-kablom-ili-uticnicom'}, '.'],
          ['Cable or socket: the difference is described in the guide ', {'a': 'wallbox with a cable or with a socket', 'href': '/wallbox-sa-kablom-ili-uticnicom'}, '.'],
          ['Кабель или розетка: разница описана в гайде ', {'a': 'wallbox с кабелем или с розеткой', 'href': '/wallbox-sa-kablom-ili-uticnicom'}, '.']),
        T(['Koliko tvoj auto prima: jednofazni auto na trofaznom wallboxu od 11 kW puni sa 3,7 kW. Podaci po modelima su na stranici ',
           {'a': 'punjač po modelu auta', 'href': '/kucni-punjac-po-modelu'}, '.'],
          ['How much your car accepts: a single-phase car charges at 3.7 kW on a three-phase 11 kW wallbox. The figures by model are on the page ',
           {'a': 'chargers by car model', 'href': '/kucni-punjac-po-modelu'}, '.'],
          ['Сколько принимает твоя машина: однофазная машина от трёхфазного wallbox на 11 кВт заряжается на 3,7 кВт. Данные по моделям — на странице ',
           {'a': 'зарядка по модели машины', 'href': '/kucni-punjac-po-modelu'}, '.']),
        T('MID brojilo: mnogi punjači ga nemaju ugrađeno, pa ako ti treba obračun sa vlasnikom garaže ili zgradom, proveri to pre kupovine.',
          'A MID meter: many chargers don’t have one built in, so if you need to settle electricity costs with a garage '
          'owner or the building, check that before you buy.',
          'MID-счётчик: у многих зарядок он не встроен, так что, если нужен расчёт с владельцем гаража или домом, проверь это до '
          'покупки.'),
        T('Garancija i račun: rok i uslove traži pismeno od prodavca.',
          'Warranty and receipt: ask the seller for the term and the conditions in writing.',
          'Гарантия и чек: срок и условия проси у продавца письменно.')])
    d.h2('Kako ide ugradnja', 'How the installation goes', 'Как проходит монтаж')
    steps(d)
    d.h2('Ako punjač tek biraš', 'If you’re still choosing a charger', 'Если зарядку ты только выбираешь')
    d.p('Paketi sa punjačem uključuju i punjač i osnovnu ugradnju.', 'The packages with a charger include both the charger and basic installation.',
        'Пакеты с зарядкой включают и зарядку, и базовый монтаж.')
    d.table(GR.PRICES_HEAD, GR.PRICES_ROWS)
    d.p(*KL.tri(GR.PRICES_MORE))
    d.question(T('Koliko košta ugradnja punjača koji već imam?', 'How much does it cost to install a charger I already have?',
                 'Сколько стоит монтаж зарядки, которая у меня уже есть?'),
               T('Od 24.000 RSD, konačna cena, za ugradnju pored razvodne table: do 2 m kabla, FID zaštita i automatski osigurač. '
                 'Sve preko toga računamo posle procene.',
                 'From 24.000 RSD, final price, for installation next to the distribution board: up to 2 m of cable, an RCD (FID) '
                 'and a circuit breaker. Anything beyond that is priced after the assessment.',
                 'От 24.000 RSD, цена итоговая, за монтаж рядом с электрощитом: до 2 м кабеля, УЗО (FID) и автомат. Всё, что сверх '
                 'этого, считаем после оценки.'))
    d.question(T('Koji punjač možete da ugradite?', 'Which chargers can you install?', 'Какую зарядку можно установить?'),
               T('Punjač sa CE oznakom i zaštitom od jednosmerne struje kvara (6 mA). Ako punjač tu zaštitu nema, FID tip B dodajemo u ponudi.',
                 'A charger with the CE mark and DC fault-current protection (6 mA). If the charger lacks that protection, we add a '
                 'type B RCD to the quote.',
                 'Зарядку с маркировкой CE и защитой от постоянного тока утечки (6 мА). Если такой защиты нет, добавляем в смету УЗО типа B.'))
    d.question(T('Ko daje garanciju na punjač koji sam kupio sam?', 'Who gives the warranty on a charger I bought myself?',
                 'Кто даёт гарантию на зарядку, которую я купил сам?'),
               T('Proizvođač, odnosno prodavac kod koga si ga kupio. Zato sačuvaj račun i garantni list.',
                 'The manufacturer, or the seller you bought it from. So keep the receipt and the warranty card.',
                 'Производитель или продавец, у которого ты её купил. Поэтому сохрани чек и гарантийный талон.'))
    d.faq_block(T('Česta pitanja', 'FAQ', 'Частые вопросы'))
    for b in data['brands']:
        s = b['sources'][0]
        d.source(s['t'], s['url'])
    d.callout(T('Ugradnja punjača koji već imaš', 'Installing the charger you already have', 'Монтаж зарядки, которая у тебя уже есть'),
              CTA_TEXT, GR.CALL_BTN, '/kontakt')
    d.links(T('Pročitaj i ovo', 'Read next', 'Читай также'), [CARD_PRICES, CARD_MODEL, CARD_CABLE])
    docs = d.build()
    ld_names = [('Početna', 'Home', 'Главная')] + [(b['name'], b['name'], b['name']) for b in data['brands']]
    return docs, ld_names


def hub_jsonld(data, docs, same_as):
    url = SITE + '/' + HUB
    sr = docs[0]
    return KL.graph(
        KL.org_node(same_as),
        {'@type': 'Service', '@id': url + '#service', 'name': sr['hero']['h1'],
         'serviceType': 'Ugradnja punjača za električne automobile', 'description': sr['seo']['description'],
         'provider': {'@id': SITE + '/#org'}, 'url': url, 'areaServed': {'@type': 'Country', 'name': 'Srbija'}},
        {'@type': 'ItemList', '@id': url + '#brands', 'itemListElement': [
            {'@type': 'ListItem', 'position': i + 1, 'name': b['name'], 'url': SITE + '/' + PREFIX + b['slug']}
            for i, b in enumerate(data['brands'])]},
        KL.breadcrumb(url, [('Početna', ''), (sr['hero']['h1'], None)]),
        KL.faq_node(url, sr))


def slugs(data):
    return [HUB] + [PREFIX + b['slug'] for b in data['brands']]


def pages(data, same_as):
    docs, ld = hub_texts(data)
    out = [{'slug': HUB, 'docs': docs, 'ld_names': ld + [('Srbija', 'Serbia', 'Сербия'), (
                'Ugradnja punjača za električne automobile', 'EV charger installation', 'Установка зарядок для электромобилей')],
            'cover': COVER_HUB, 'kind': 'vodic', 'tone': 'ti', 'date': data['date'], 'checked': data.get('checked'), 'jsonld': hub_jsonld(data, docs, same_as),
            'footer': True}]
    for b in data['brands']:
        docs, ld = brand_texts(b, data)
        out.append({'slug': PREFIX + b['slug'], 'docs': docs, 'ld_names': ld, 'cover': b['cover'], 'kind': 'vodic', 'tone': 'ti',
                    'date': data['date'], 'checked': data.get('checked'), 'jsonld': brand_jsonld(b, docs, same_as)})
    return out

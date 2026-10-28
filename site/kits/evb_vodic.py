#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""evb_vodic.py — Evolako B2B guide ("vodič") kit, v1.3 · 26.10.2026 (og:image and Article image for new guides; v1.2 10.10: new id of the template "Ažurirano" line; v1.1 30.09: parking segment, photo 2 v2, no subscription price).

Validates an article written in the B2B content schema (sr/en/ru JSON with identical structure),
renders it exactly like the 6 starter guides on www.evolako.rs, and writes ready-to-run Webflow MCP
steps (one JSON file per tool call). Every text node on the page is one SR string of the JSON; the page
footer gets the EN/RU dictionary keyed by the site's i18n hash, so EN/RU work without extra effort.

  python3 evb_vodic.py check <dir>                                  # <dir>/sr.json en.json ru.json
  python3 evb_vodic.py build <dir> --date 2026-10-08 --page-id <24-hex id of the duplicated draft page>
  python3 evb_vodic.py selftest

After `build`: <dir>/out/steps/NN_<tool>.json — {"tool", "pageId", "actions"}; pass "actions" verbatim.
<dir>/out/expected.json — what the verification step must find. Hub steps are separate (publish mode only).
"""
import html as H, json, os, re, sys, hashlib, argparse

SITE = 'https://www.evolako.rs'
SITE_ID = '6ab19bf9a3bb86f8fb7bba00'
DOMAINS = ['6ab1ac2688f3550afc2de01c', '6ab1ac2588f3550afc2ddff7']  # www.evolako.rs, evolako.rs
OG_IMAGE = '6ac75fd012abe8aa7733ad65'  # evolako-og-sr-blue-v3.png: the og:image of the site pages (PNG, so every link preview shows it); v1.3
SAME_AS = ['https://www.instagram.com/evolako', 'https://www.facebook.com/evolako.rs', 'https://www.linkedin.com/company/evolako',
           'https://www.youtube.com/@Evolako', 'https://x.com/evolakocom', 'https://t.me/evolako_rs']  # the profiles in the site footer (home page JSON-LD, 26.10.2026)
TEMPLATE_PAGE = '6abc9a1702e6978b8721fd6c'  # /koliko-punjaca-treba-hotelu — duplicate it (create_page duplicateOf, draft:true)
HUB_PAGE, HUB_GRID = '6abc9847b71664d48790e091', '09b92888-3f0a-86b1-7230-86517fe5d055'  # /punjaci-za-firme, #vodici .evb2-guides grid (redesign 30.09)
SEGMENTS = {  # segment page -> (page id, .evb2-guides grid of its #vodici section); the guide card is prepended there too
    '/punjaci-za-hotele': ('6abc98eeb71664d487913f7c', 'bc47d28f-3b97-c3e0-224a-4844a4d3f671'),
    '/punjaci-za-parking-garaze': ('6abc98ef8f8b691ddea6d5f5', '3d05f7a3-76d3-5d43-6660-5b02b71f718e'),
    '/punjaci-za-novogradnju': ('6abc98ef256d5b683185a12c', '291b3e46-bd61-c01d-142c-97ae29f5a9b8'),
    '/punjaci-za-stambene-zgrade': ('6abc98f1887d7324632648b0', 'b51a2a2b-a6db-e1e0-eea9-a7d7e99f9005'),
    '/punjaci-za-auto-salone': ('6abc98f11e775be9bccb0d98', '01fc699f-7846-a2ff-3fd1-d474d0b7a53d'),
    '/punjaci-za-sluzbena-vozila': ('6abc98f224bf688968707a4e', '884f7a73-56eb-cbfa-7969-d85e5915b91b'),
    '/punjaci-za-parkinge': ('6abd5e887955c6a8c98a2c7f', '593c2c09-de06-a6d9-7367-46f8a368612c')}  # 30.09 late: guarded/long-stay car parks
T = dict(H1='31d85823-1761-c5ab-18d0-3948dcd436a7', LEAD='31d85823-1761-c5ab-18d0-3948dcd436a9', KICK='d01256d6-8c3e-d044-e24f-ebe3221db0df',
         UPD='6ba6eec7-587d-a3bb-0ef2-2a7e52ae9028', FOOT='a1c7ff7a-fe24-a6b8-a685-c32b806a7976', PAGE='d1581f61-aebb-c1d2-8a33-6003ee21acbf',
         COVER='d8a8d6dc-e190-bde5-2ce7-2d6007433f09', COVER_IMG='6ebe6201-60ae-8d78-25ec-6017f1679b4f')  # cover photo under the hero (kept, photo swapped)
OLD_SECTIONS = ['53fa2542-9889-5297-ea9b-a535064e92fe', '16514ade-f958-fb1f-3e81-fdaaf2a64b25', 'c2a9ad6a-862e-520e-e8b2-b2bc0c203483',
                '7add76a5-471c-97ec-8dac-b726bd154312', 'a5111bdf-158a-3f7b-ab71-dfc757042a98', 'bf2de39e-13d1-d1b4-6528-68f56844d9c7',
                'd100a397-b117-2cab-1af5-180ed5050cda', '8baa14b8-b07b-494f-b6ee-7a1cb5edadd4', 'ffd38e05-b384-079b-d026-37a80d4bcb9e',
                '0399dd55-766c-5db6-cfe0-9f88ccd8d144', '6665ac61-ed51-2483-5b09-c73d98c07c2f']

FIXED = {  # strings every guide shares (kit overwrites them in all three files)
    'kicker': ('Vodič za firme i zgrade', 'Guide for businesses and buildings', 'Гайд для бизнеса и жилых домов'),
    'izvori': ('Izvori', 'Sources', 'Источники'),
    'srodni': ('Srodni vodiči', 'Related guides', 'Читайте также'),
}
MONTHS = {'sr': 'januara februara marta aprila maja juna jula avgusta septembra oktobra novembra decembra'.split(),
          'en': 'January February March April May June July August September October November December'.split(),
          'ru': 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря'.split()}


def dates(iso):
    y, m, d = (int(x) for x in iso.split('-'))
    sr, en, ru = f'{d}. {MONTHS["sr"][m-1]} {y}.', f'{MONTHS["en"][m-1]} {d}, {y}', f'{d} {MONTHS["ru"][m-1]} {y} г.'
    upd = (f'Ažurirano: {sr}', f'Updated: {en}', f'Обновлено: {ru}')
    trans = (f'Ovaj vodič je napisan uz pomoć AI alata na osnovu navedenih izvora i poslednji put proveren {sr[:-1]}. Ako ste našli grešku ili imate noviji podatak, javite nam na hello@evolako.com — ispravke objavljujemo sa datumom.',
             f'This guide was written with the help of AI tools based on the sources listed and was last checked on {en}. If you spot an error or have newer data, let us know at hello@evolako.com — we publish corrections with a date.',
             f'Этот гайд написан с помощью ИИ-инструментов на основе указанных источников и последний раз проверен {ru} Если вы нашли ошибку или у вас есть более свежие данные, напишите нам на hello@evolako.com — исправления мы публикуем с датой.')
    return upd, trans


# ---- site i18n hash (must match the engine in the site head; do not change) ----
def h(s):
    s = re.sub(r'\s+', ' ', s).strip()
    s = s.replace('Evolako', 'BlokVolt').replace('evolako', 'blokvolt').replace('EVOLAKO', 'BLOKVOLT')
    x, d = 2166136261, s.encode('utf-16-le')
    for i in range(0, len(d), 2):
        x ^= d[i] | (d[i + 1] << 8)
        x = (x * 16777619) & 0xFFFFFFFF
    out, digits = '', '0123456789abcdefghijklmnopqrstuvwxyz'
    while True:
        x, r = divmod(x, 36); out = digits[r] + out
        if x == 0: return out


assert h('Bezbednost i atest') == '1qbtlvx' and h('Kako radi') == '1odfjz3'

# ---- links allowed inside guides ----
B2B_PAGES = ['/punjaci-za-firme', '/punjaci-za-hotele', '/punjaci-za-parking-garaze', '/punjaci-za-novogradnju', '/punjaci-za-stambene-zgrade',
             '/punjaci-za-auto-salone', '/punjaci-za-sluzbena-vozila', '/punjaci-za-parkinge', '/kalkulator-cene-punjaca', '/prijavi-zgradu']
GUIDES = ['/punjaci-u-garazi-zgrade-plan-za-upravnike', '/koliko-punjaca-treba-hotelu', '/koliko-snage-treba-garazi-za-punjace',
          '/punjenje-sluzbenog-automobila-kod-kuce', '/novogradnja-garaza-spremna-za-punjace', '/cena-punjaca-po-parking-mestu']
SITE_PAGES = ['/', '/paketi-i-cene', '/proveri-svoju-garazu', '/cesta-pitanja', '/kontakt', '/mapa-punjaca']
CALC_TIP = re.compile(r'^/kalkulator-cene-punjaca\?tip=(hotel|garaza|zgrada|novogradnja|flota|salon|drugo)$')

# ---- photos (Webflow assets, uploaded 30.09.2026): index -> [full id, full url, w, h, thumb id, thumb url, w, h] ----
IMG = {
    0: ["6abd1e3add3a1a995e75143b", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3add3a1a995e75143b_evolako-garaza-zgrade-punjaci.webp", 1800, 1344, "6abd22302935343fde8c8648", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd22302935343fde8c8648_evolako-garaza-zgrade-punjaci-360.webp", 360, 269],
    1: ["6abd1e3a70e2d80652c8c215", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3a70e2d80652c8c215_evolako-hotel-punjac-parking.webp", 1800, 1195, "6abd223020d96f2059f946e1", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd223020d96f2059f946e1_evolako-hotel-punjac-parking-360.webp", 360, 239],
    2: ["6abd5da3a2aee6acc91975c6", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd5da3a2aee6acc91975c6_evolako-poslovna-garaza-punjaci-v2.webp", 1800, 1195, "6abd5da46cb0990272d4b166", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd5da46cb0990272d4b166_evolako-poslovna-garaza-punjaci-v2-360.webp", 360, 239],  # v2 30.09 late (old photo: car across two bays, floating cable)
    3: ["6abd1e3ae2eb0339acaea34c", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3ae2eb0339acaea34c_evolako-novogradnja-garaza-priprema.webp", 1800, 1195, None, None, None, None],
    4: ["6abd1e3add3a1a995e7514bb", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3add3a1a995e7514bb_evolako-elektricar-ugradnja-punjaca.webp", 1800, 1195, "6abd22312d12fca810ca79cf", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd22312d12fca810ca79cf_evolako-elektricar-ugradnja-punjaca-360.webp", 360, 239],
    5: ["6abd1e3b9d29440311fa404c", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3b9d29440311fa404c_evolako-auto-salon-kucni-punjac.webp", 1800, 1195, None, None, None, None],
    6: ["6abd1e3bdd3a1a995e751552", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3bdd3a1a995e751552_evolako-parking-firme-sluzbena-vozila.webp", 1800, 1195, "6abd224cb7fec184492b7bb1", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224cb7fec184492b7bb1_evolako-parking-firme-sluzbena-vozila-360.webp", 360, 239],
    7: ["6abd1e3b9d29440311fa40ec", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3b9d29440311fa40ec_evolako-punjac-mid-brojilo-detalj.webp", 1280, 1600, "6abd224ceba54cabc8638d09", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224ceba54cabc8638d09_evolako-punjac-mid-brojilo-detalj-360.webp", 360, 450],
    8: ["6abd1e3cfb3bf8bb117d7d2c", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1e3cfb3bf8bb117d7d2c_evolako-stambena-zgrada-novi-sad.webp", 1800, 1344, None, None, None, None],
    9: ["6abd1ea729f47364b3fc3225", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea729f47364b3fc3225_evolako-procena-na-lokaciji.webp", 1800, 1195, "6abd224deaba0b40777c94ec", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224deaba0b40777c94ec_evolako-procena-na-lokaciji-360.webp", 360, 239],
    10: ["6abd1ea719faec11491b5484", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea719faec11491b5484_evolako-komsije-prijava-zgrade.webp", 1800, 1344, "6abd224d1e4eea5a5ecf55ea", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224d1e4eea5a5ecf55ea_evolako-komsije-prijava-zgrade-360.webp", 360, 269],
    11: ["6abd1ea7eefe76feae6ea8d5", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea7eefe76feae6ea8d5_evolako-plan-garaze-upravnik.webp", 1800, 1018, "6abd224d1e4eea5a5ecf5619", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224d1e4eea5a5ecf5619_evolako-plan-garaze-upravnik-360.webp", 360, 204],
    12: ["6abd1ea719faec11491b552b", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea719faec11491b552b_evolako-hotel-punjenje-nocu.webp", 1800, 1018, "6abd224e69918d1cd39fb134", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224e69918d1cd39fb134_evolako-hotel-punjenje-nocu-360.webp", 360, 204],
    13: ["6abd1ea829f47364b3fc3283", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea829f47364b3fc3283_evolako-razvodni-orman-merenje.webp", 1800, 1018, "6abd224e5f70e46cc25a5f72", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224e5f70e46cc25a5f72_evolako-razvodni-orman-merenje-360.webp", 360, 204],
    14: ["6abd1ea8eba54cabc861ae7a", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea8eba54cabc861ae7a_evolako-sluzbeni-auto-kucna-garaza.webp", 1800, 1018, "6abd224ee2eb0339acafbf2c", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224ee2eb0339acafbf2c_evolako-sluzbeni-auto-kucna-garaza-360.webp", 360, 204],
    15: ["6abd1ea8eba54cabc861ae9b", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea8eba54cabc861ae9b_evolako-novogradnja-gradiliste.webp", 1800, 1018, "6abd224eedf2ad1dc43e8c47", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224eedf2ad1dc43e8c47_evolako-novogradnja-gradiliste-360.webp", 360, 204],
    16: ["6abd1ea8a774a4cb0e8d37a0", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd1ea8a774a4cb0e8d37a0_evolako-garaza-mesta-spremna-za-punjace.webp", 1800, 1018, "6abd224ef2dd835e83127436", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd224ef2dd835e83127436_evolako-garaza-mesta-spremna-za-punjace-360.webp", 360, 204],
    17: ["6abd7bea1968762596b1d93e", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd7bea1968762596b1d93e_evolako-cuvani-parking-punjaci-v2.webp", 1800, 1195, "6abd7beb9149571f4a724f0c", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd7beb9149571f4a724f0c_evolako-cuvani-parking-punjaci-v2-360.webp", 360, 239],
    18: ["6abd5da4a2aee6acc9197622", "https://cdn.prod.website-files.com/6ab19bf9a3bb86f8fb7bba00/6abd5da4a2aee6acc9197622_evolako-punjac-na-stubu-parking.webp", 1280, 1600, None, None, None, None]}
ALT = {  # alt text per photo, sr/en/ru (alt is translated by the i18n engine like any text)
    0: ["Garaža stambene zgrade sa zidnim punjačima i električnim automobilima", "Apartment building garage with wall-mounted chargers and electric cars", "Гараж жилого дома с настенными зарядками и электромобилями"],
    1: ["Električni automobil gosta puni se na zidnom punjaču ispred hotela", "A guest’s electric car charging at a wall charger outside a hotel", "Электромобиль гостя заряжается у настенной зарядки перед отелем"],
    2: ["Red zidnih punjača u poslovnoj garaži", "A row of wall chargers in a business garage", "Ряд настенных зарядок в бизнес-гараже"],
    3: ["Nova garaža sa razvodnim kutijama kod parking mesta i prvim punjačem", "A new garage with junction boxes at the parking spaces and the first charger", "Новый гараж с распределительными коробками у мест и первой зарядкой"],
    4: ["Električar ugrađuje zidni punjač u garaži stambene zgrade", "An electrician installing a wall charger in an apartment building garage", "Электрик устанавливает настенную зарядку в гараже жилого дома"],
    5: ["Auto salon sa električnim automobilom i zidnim punjačem", "A car showroom with an electric car and a wall charger", "Автосалон с электромобилем и настенной зарядкой"],
    6: ["Službeni električni automobili pune se na parkingu firme", "Company electric cars charging in the company car park", "Служебные электромобили заряжаются на парковке компании"],
    7: ["Zidni punjač i razvodna kutija sa MID brojilom", "A wall charger and an enclosure with a MID meter", "Настенная зарядка и щиток с MID-счётчиком"],
    8: ["Stambena zgrada u Novom Sadu u sumrak, sa ulazom u garažu", "An apartment building in Novi Sad at dusk, with the garage entrance", "Жилой дом в Нови-Саде в сумерках, со въездом в гараж"],
    9: ["Električar procenjuje razvodnu tablu i garažu", "An electrician assessing the distribution board and the garage", "Электрик оценивает распределительный щит и гараж"],
    10: ["Komšije u ulazu zgrade gledaju u telefon", "Neighbors in the building entrance looking at a phone", "Соседи в подъезде смотрят в телефон"],
    11: ["Plan garaže, tablet i kafa na stolu upravnika", "A garage floor plan, a tablet and coffee on a manager’s desk", "План гаража, планшет и кофе на столе управляющего"],
    12: ["Električni automobil puni se ispred hotela noću", "An electric car charging outside a hotel at night", "Электромобиль заряжается у отеля ночью"],
    13: ["Električar meri struju strujnim kleštima u razvodnoj tabli", "An electrician measuring current with a clamp meter in a distribution board", "Электрик измеряет ток токовыми клещами в щите"],
    14: ["Zaposleni priključuje službeni automobil na punjač u kućnoj garaži", "An employee plugging a company car into a charger in a home garage", "Сотрудник подключает служебный автомобиль к зарядке в домашнем гараже"],
    15: ["Gradilište stambene zgrade sa podzemnom garažom", "A residential building site with an underground garage", "Стройка жилого дома с подземным гаражом"],
    16: ["Parking mesta sa dva punjača i kutijama za buduće punjače", "Parking spaces with two chargers and boxes for future chargers", "Парковочные места с двумя зарядками и коробками для будущих зарядок"],
    17: ["Čuvani parking sa rampom, kućicom i punjačima na stubovima", "A guarded car park with a barrier, an attendant booth and chargers on pedestals", "Охраняемая парковка со шлагбаумом, будкой и зарядками на стойках"],
    18: ["Punjač na stubu i električni automobil na otvorenom parkingu u sumrak", "A charger on a pedestal and an electric car in an open-air car park at dusk", "Зарядка на стойке и электромобиль на открытой парковке в сумерках"]}
THUMB = {'/punjaci-u-garazi-zgrade-plan-za-upravnike': 11, '/koliko-punjaca-treba-hotelu': 12, '/koliko-snage-treba-garazi-za-punjace': 13,
         '/punjenje-sluzbenog-automobila-kod-kuce': 14, '/novogradnja-garaza-spremna-za-punjace': 15, '/cena-punjaca-po-parking-mestu': 16,
         '/punjaci-za-parking-garaze': 2, '/punjaci-za-firme': 0, '/punjaci-za-stambene-zgrade': 4, '/kalkulator-cene-punjaca': 9,
         '/punjaci-za-sluzbena-vozila': 6, '/punjaci-za-hotele': 1, '/paketi-i-cene': 7, '/prijavi-zgradu': 10,
         '/punjaci-za-novogradnju': 15, '/punjaci-za-auto-salone': 0, '/punjaci-za-parkinge': 17}
SEG_COVER = {'/punjaci-za-firme': 0, '/punjaci-za-hotele': 1, '/punjaci-za-parking-garaze': 2, '/punjaci-za-novogradnju': 3,
             '/punjaci-za-stambene-zgrade': 4, '/punjaci-za-auto-salone': 5, '/punjaci-za-sluzbena-vozila': 6,
             '/kalkulator-cene-punjaca': 9, '/prijavi-zgradu': 10, '/punjaci-za-parkinge': 17}  # CTA segment -> cover photo of a new guide
EXTRA_SEG = {}  # slug of a pipeline-made guide -> its CTA segment (filled from --extra-guides slug=segment)


def thumb_idx(i):
    return i if IMG[i][4] else {3: 15, 5: 0, 8: 4, 18: 17}[i]


def thumb_of(href):
    href = href.split('?')[0]
    if href in THUMB: return thumb_idx(THUMB[href])
    if href in EXTRA_SEG: return thumb_idx(SEG_COVER.get(EXTRA_SEG[href], 16))
    return 16


def img_tag(i, cls, alt=''):
    v = IMG[i]
    return f'<img class="{cls}" src="{v[5]}" alt="{alt}" width="{v[6]}" height="{v[7]}" loading="lazy">'


def seg_of(sr):
    return sr['sections'][2]['button']['href'].split('?')[0]

# ---- copy rules (B2B spec §2–§3, SEO research §10) ----
FORBID = [r'\batest', r'\bpopust', r'24/7', r'plug\s*&\s*charge', r'\bodmah\b', r'dolazimo u roku', r'nadzor sa alarm', r'znamo pre',
          r'evropski sertifikovan', r'tri koraka', r'produžen\w* garancij', r'izričito dozvolj', r'blokvolt', r'osiguranj\w* odgovornost',
          r'\brate\b', r'na rate', r'€', r'\bEUR\b', r'§', r'besplatn\w* infrastruktur', r'licenc\w* nije potrebn', r'\bpunionic',
          r'\bAndrej', r'\bAndrei', r'\bDanil', r'klikni ovde', r'kliknite ovde', r'sveobuhvatn', r'kompletan vodič', r'važno je napomenuti',
          r'ne samo\b.*\bveć i', r'!',
          r'(?<![\d.])(1\.690|6\.760|8\.450|16\.900|4\.950)(?!\d|\.\d)', r'pretplat\w*\s+(od\s+|je\s+|iznosi\s+|košta\s+)?\d',
          r'\b990\s*RSD\s*(/\s*mes|mesečno|po mestu)']  # subscription price is not named in new texts (owner, 30.09.2026)
WARN = [r'\bVi\b', r'\bVaš', r'\bVam\b', r'\bVas\b', r'besplatn', r'garantuj', r'najbolj', r'jedini u srbiji', r'nema konkurencij', r'uvek', r'nikada', r'\d+\s*%', r'\d\s*RSD\s*(/\s*mes|mesečno)']
TR_FORBID = [r'blokvolt', r'§', r'Андрей', r'Andrei', r'Andrej', r'Данил', r'Danila', r'€', r'(?<![\d.,])1[.,\u00a0\u202f ]?690(?!\d|[.,]\d)']
KNOWN_NUMBERS = set('''59.000 125.000 96.000 3.500 7.200 7.155 230 11 22 17,25 11,04 3×25 3×16 48 48h 4–10 1–2 2–4 2–3 1–3 7 2 3 5 10 20 30 40 50 60 100
740.000–956.000 250.000–264.000 1.205.000–1.476.000 1.668.000–2.083.000 2.058.000–2.443.000 625.000 1.233.000–1.427.000 500.000 240.000–456.000
185.000–239.000 167.000–208.000 129.000–190.000 195.000–256.000 105.000–151.000 171.000–217.000 96.000–119.000 161.000–185.000 1.301.000–1.678.000
20.000–30.000 2.867.000–3.650.000 16.000–24.000 773 980 207 535 232 9,6136 2,4034 14,4203 3,6051 28,8407 7,2102 990 2.000 200
2,3–3,7 180 60 1,5 138 27 130–150 43,5 12 3,6 0,1–0,3 15 70–91 500 5.000 250.000 240 10–30 30–60 1.250.000 44 45 145 210
62/2023 87/2023 76/2024 31/2024 59/2025 84/2023 81/2026 12/2026 86/2026 104/2016 9/2020
1.233.000–1.602.000 123.000–161.000 200.000–246.000 643.000–1.012.000 455.000–726.000 590.000 750.000'''.split())
NOTRANSLATE = {'page', 'slug', 'tone', 'kind', 'type', 'id', 'segment', 'href', 'url', 'cols'}
e = lambda s: H.escape(s, quote=False)
q = lambda s: H.escape(s, quote=True)


def walk(x, path=''):
    if isinstance(x, dict):
        for k, v in x.items(): yield from walk(v, f'{path}.{k}')
    elif isinstance(x, list):
        for i, v in enumerate(x): yield from walk(v, f'{path}[{i}]')
    else:
        yield path, x


def keyof(p):
    k = re.findall(r'\.([a-z_0-9]+)(?:\[\d+\])*$', p)
    return k[0] if k else ''


def texts(doc):
    for p, v in walk(doc):
        if isinstance(v, str) and keyof(p) not in NOTRANSLATE:
            yield p, v


def shape(x):
    if isinstance(x, dict): return {k: shape(v) for k, v in x.items()}
    if isinstance(x, list): return [shape(v) for v in x]
    return type(x).__name__


def load(d, date=None):
    docs = [json.load(open(os.path.join(d, f'{l}.json'), encoding='utf-8')) for l in ('sr', 'en', 'ru')]
    for i, doc in enumerate(docs):  # normalize the shared strings
        doc.setdefault('hero', {})['kicker'] = FIXED['kicker'][i]
        doc['kind'], doc['tone'] = 'article', 'vi'
        if date:
            doc['hero']['updated'] = dates(date)[0][i]
        for s in doc.get('sections', []):
            if s.get('type') == 'sources': s['h2'] = FIXED['izvori'][i]
            if s.get('type') == 'links': s['h2'] = FIXED['srodni'][i]
    return docs


def plain(v):
    if isinstance(v, str): return v
    if isinstance(v, list): return ''.join(x if isinstance(x, str) else x['a'] for x in v)
    return ''


def check(d, extra_guides=(), date='2026-01-01'):
    sr, en, ru = load(d, date)
    errs, warns, info = [], [], {}
    allowed = set(B2B_PAGES + GUIDES + SITE_PAGES + list(extra_guides))
    for k in ('page', 'slug', 'seo', 'hero', 'sections', 'card'):
        if k not in sr: errs.append(f'missing key {k}')
    if errs: return errs, warns, info
    if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', sr['page']) or len(sr['page']) > 60: errs.append('page must be a lowercase ASCII slug ≤ 60')
    if sr['slug'] != '/' + sr['page']: errs.append('slug must be "/" + page')
    if sr['slug'] in allowed: errs.append('slug already used by an existing page')
    seo = sr['seo']
    if not seo.get('title', '').endswith(' | Evolako') or len(seo['title']) > 60: errs.append(f'seo.title must end with " | Evolako" and be ≤ 60 ({len(seo.get("title", ""))})')
    if not 70 <= len(seo.get('description', '')) <= 155: errs.append(f'seo.description must be 70–155 chars ({len(seo.get("description", ""))})')
    for k in ('og_title', 'og_description'):
        if not seo.get(k): errs.append(f'seo.{k} missing')
    if len(seo.get('og_description', '')) > 200: errs.append('seo.og_description > 200')
    for k in ('h1', 'lead'):
        if not sr['hero'].get(k): errs.append(f'hero.{k} missing')
    if len(sr['hero'].get('lead', '')) > 420: warns.append('hero.lead is long (> 420 chars)')
    if set(sr['card']) != {'title', 'text'} or len(sr['card']['text']) > 120: errs.append('card must be {title, text} with text ≤ 120 chars')
    types = [s.get('type') for s in sr['sections']]
    if types != ['article', 'sources', 'callout', 'links']: errs.append(f'sections must be article, sources, callout, links — got {types}')
    else:
        art, src, cta, links = sr['sections']
        ids = [s.get('id') for s in sr['sections']]
        if ids != ['tekst', 'izvori', 'cta', 'srodni']: errs.append(f'section ids must be tekst, izvori, cta, srodni — got {ids}')
        blocks = art.get('blocks', [])
        kinds = [list(b)[0] for b in blocks]
        if any(len(b) != 1 or list(b)[0] not in ('h2', 'p', 'ul', 'note', 'table') for b in blocks): errs.append('each block is exactly one of h2/p/ul/note/table')
        if kinds and kinds[0] != 'p': warns.append('the body opens with a heading — fine if the hero lead already answers the question')
        n_h2 = kinds.count('h2'); info['h2'] = n_h2
        if not 4 <= n_h2 <= 7: (errs if not 3 <= n_h2 <= 8 else warns).append(f'{n_h2} H2 headings (target 4–7)')
        for b in blocks:
            if 'table' in b:
                t = b['table']
                if not 2 <= len(t['head']) <= 4 or any(len(r) != len(t['head']) for r in t['rows']): errs.append('table: 2–4 columns, every row as wide as the head')
        words = sum(len(plain(b.get('p', '')).split()) + sum(len(x.split()) for x in b.get('ul', [])) + len(b.get('note', '').split())
                    + sum(len(c.split()) for r in b.get('table', {}).get('rows', []) for c in r) + len(b.get('h2', '').split()) for b in blocks)
        info['words'] = words
        if not 900 <= words <= 1400: (errs if not 700 <= words <= 1800 else warns).append(f'{words} words in the body (target 900–1.400)')
        # money link in the first 150 words
        seen, ok = 0, False
        for b in blocks:
            if 'p' in b and isinstance(b['p'], list):
                for seg in b['p']:
                    if isinstance(seg, dict) and seg['href'].split('?')[0] in B2B_PAGES and seen <= 150: ok = True
                    seen += len((seg if isinstance(seg, str) else seg['a']).split())
            else:
                seen += len(plain(b.get('p', '')).split())
            if seen > 150: break
        if not ok: errs.append('no link to a B2B page (/punjaci-za-…, /kalkulator-cene-punjaca, /prijavi-zgradu) in the first 150 words')
        if not 2 <= len(src.get('items', [])) <= 12: errs.append('sources: 2–12 items')
        if not cta.get('button') or cta['button']['href'].split('?')[0] not in B2B_PAGES: errs.append('callout button must link to a B2B page')
        if len(links.get('items', [])) != 3: errs.append('srodni: exactly 3 items')
        for it in links.get('items', []):
            if it['href'] not in GUIDES + list(extra_guides) + B2B_PAGES: errs.append(f'srodni item must link to a guide or B2B page: {it["href"]}')
    for p, v in texts(sr):
        if not v.strip(): errs.append(f'{p}: empty string')
        for rx in FORBID:
            if re.search(rx, v, re.I): errs.append(f'{p}: forbidden /{rx}/: {v[:80]}')
        for rx in WARN:
            if re.search(rx, v, 0 if rx.startswith(r'\bV') else re.I): warns.append(f'{p}: check /{rx}/: {v[:80]}')
        if re.search(r'\d,\d{3}\b', v) and 'RSD' in v: errs.append(f'{p}: thousands separator must be ".": {v[:80]}')
        if re.search(r'\d(kW|kWh|RSD|km|A)\b', v): errs.append(f'{p}: missing space before unit: {v[:80]}')
        if '"' in v: errs.append(f'{p}: straight quotes — use „…“')
        if re.search(r'\s-\s', v): errs.append(f'{p}: use a dash " — " instead of " - "')
        for m in re.finditer(r'(?<![\w/])\d[\d.,×–/]*\d|(?<![\w/])\d', v):
            n = m.group(0)
            if n in KNOWN_NUMBERS or re.fullmatch(r'20[0-3]\d', n) or re.fullmatch(r'\d', n): continue
            if re.search(r'(čl\.|član\w*|st\.|tačk\w*|t\.)\s*$', v[:m.start()]): continue
            warns.append(f'{p}: number {n} is not in the fact base — keep it only if a source in "Izvori" states it')
    for p, v in walk(sr):
        if p.endswith('.href') and isinstance(v, str):
            if not (v in allowed or CALC_TIP.match(v)): errs.append(f'{p}: link target not allowed: {v}')
        if p.endswith('.url') and isinstance(v, str) and not v.startswith('https://'): errs.append(f'{p}: source url must be https://')
    for sec in sr.get('sections', []):
        for i, b in enumerate(sec.get('blocks', []) or []):
            segs = b.get('p')
            if isinstance(segs, list):
                links = [j for j, s in enumerate(segs) if isinstance(s, dict)]
                if len(links) > 1: errs.append(f'blocks[{i}]: more than one link in a paragraph')
                for j in links:
                    if set(segs[j]) != {'a', 'href'}: errs.append(f'blocks[{i}]: link segment must be {{"a","href"}}')
                    if any(not (isinstance(t, str) and re.fullmatch(r'[.:;,)]?', t.strip())) for t in segs[j + 1:]): errs.append(f'blocks[{i}]: link must end the sentence')
                if any(isinstance(s, str) and len(s.strip()) == 1 and s.strip() not in '.:;,)' for s in segs): errs.append(f'blocks[{i}]: stray 1-char segment')
    for name, tr in (('en', en), ('ru', ru)):
        if shape(sr) != shape(tr): errs.append(f'{name}: structure differs from sr (keys, array lengths, paragraph segments)'); continue
        for (pa, va), (pb, vb) in zip(walk(sr), walk(tr)):
            k = keyof(pa)
            if k in NOTRANSLATE and va != vb: errs.append(f'{name}{pb}: must equal sr ({va!r} vs {vb!r})')
            if isinstance(vb, str) and k not in NOTRANSLATE:
                if not vb.strip(): errs.append(f'{name}{pb}: empty')
                for rx in TR_FORBID:
                    if re.search(rx, vb, re.I): errs.append(f'{name}{pb}: forbidden /{rx}/')
                if va == vb and len(va) > 12 and not re.fullmatch(r'[\d.,–\- RSDkWhm×/%+]+', va): errs.append(f'{name}{pb}: looks untranslated: {va[:60]}')
        if name == 'ru' and re.search(r'\bты\b|\bтебе\b|\bтвой', json.dumps(tr, ensure_ascii=False), re.I): errs.append('ru: B2B guides use «вы», not «ты»')
    return errs, warns, info


# ---- rendering (identical markup to build/render.py of the B2B section) ----
class Page:
    def __init__(self, docs):
        self.sr, self.en, self.ru = docs
        self.pairs = []

    def t(self, path):
        a, b, c = self.sr, self.en, self.ru
        for k in path: a, b, c = a[k], b[k], c[k]
        assert isinstance(a, str), path
        self.pairs.append((a, b, c))
        return e(a)

    def para(self, path):
        a, b, c = self.sr, self.en, self.ru
        for k in path: a, b, c = a[k], b[k], c[k]
        if isinstance(a, str):
            self.pairs.append((a, b, c)); return e(a)
        out = ''
        for i, seg in enumerate(a):
            if isinstance(seg, str):
                if seg.strip() and len(seg.strip()) > 1: self.pairs.append((seg, b[i], c[i]))
                out += e(seg)
            else:
                self.pairs.append((seg['a'], b[i]['a'], c[i]['a']))
                out += f'<a class="evb-link" href="{q(seg["href"])}">{e(seg["a"])}</a>'
        return out


def sec(sid, inner, cls='evmk-sec'):
    return f'<section class="{cls}" id="{sid}"><div class="w3">{inner}</div></section>'


def render_article(p, si, s):
    P = ['sections', si, 'blocks']
    chunks, cur = [], ''
    for i, b in enumerate(s['blocks']):
        k = list(b)[0]
        if k == 'h2' and cur: chunks.append(cur); cur = ''
        if k == 'h2': cur += f'<h2 class="evb-ah2">{p.t(P + [i, "h2"])}</h2>'
        elif k == 'p': cur += f'<p class="evb-ap">{p.para(P + [i, "p"])}</p>'
        elif k == 'ul': cur += '<ul class="evb-ul">' + ''.join(f'<li class="evb-li">{p.t(P + [i, "ul", j])}</li>' for j in range(len(b['ul']))) + '</ul>'
        elif k == 'note': cur += f'<div class="evb-anote">{p.t(P + [i, "note"])}</div>'
        elif k == 'table':
            n = len(b['table']['head'])
            hd = ''.join(f'<div class="evb-th">{p.t(P + [i, "table", "head", j])}</div>' for j in range(n))
            rows = ''.join('<div class="evb-tr%d">%s</div>' % (n, ''.join(f'<div class="evb-td">{p.t(P + [i, "table", "rows", r, j])}</div>' for j in range(n)))
                           for r in range(len(b['table']['rows'])))
            cur += f'<div class="evb-tblw"><div class="evb-tbl"><div class="evb-trh{n}">{hd}</div>{rows}</div></div>'
    if cur: chunks.append(cur)
    sid = s.get('id', 'tekst')
    return [(f'{sid}-{j + 1}' if j else sid, sec(f'{sid}-{j + 1}' if j else sid, f'<div class="evb-art">{c}</div>', 'evb-sec-art')) for j, c in enumerate(chunks)]


def render_section(p, si, trans):
    s = p.sr['sections'][si]
    P, t, sid = ['sections', si], s['type'], s['id']
    if t == 'article': return render_article(p, si, s)
    if t == 'sources':
        lis = ''.join(f'<li class="evb-li"><a class="evb-link" href="{q(it["url"])}">{p.t(P + ["items", i, "title"])}</a></li>' for i, it in enumerate(s['items']))
        p.pairs.append(trans)
        return [(sid, sec(sid, f'<div class="evb-art"><h2 class="evb-ah2">{p.t(P + ["h2"])}</h2><ul class="evb-ul">{lis}</ul><p class="evb-trans">{e(trans[0])}</p></div>', 'evb-sec-art'))]
    if t == 'callout':
        btn = f'<a class="evmk-btn" href="{q(s["button"]["href"])}">{p.t(P + ["button", "label"])}</a>' if s.get('button') else ''
        txt = f'<p class="evb-callp">{p.t(P + ["text"])}</p>' if s.get('text') else ''
        return [(sid, sec(sid, f'<div class="evb-call"><div class="evb-callbody"><h2 class="evb-callh">{p.t(P + ["h2"])}</h2>{txt}</div>{btn}</div>'))]
    if t == 'links':
        items = ''
        for i, it in enumerate(s['items']):
            tx = f'<div class="evb-lx">{p.t(P + ["items", i, "text"])}</div>' if it.get('text') else ''
            items += (f'<a class="evb2-g" href="{q(it["href"])}">{img_tag(thumb_of(it["href"]), "evb2-gimg")}'
                      f'<div class="evb2-gb"><div class="evb-lt">{p.t(P + ["items", i, "title"])}</div>{tx}</div><div class="evb2-garr">→</div></a>')
        return [(sid, sec(sid, f'<h2 class="evmk-h2">{p.t(P + ["h2"])}</h2><div class="evb2-guides">{items}</div>'))]
    raise ValueError(t)


def dictionary(pairs):
    seen, order = {}, []
    for sr, en, ru in pairs:
        k = h(sr)
        if k in seen:
            if seen[k] != (en, ru): raise SystemExit(f'translation conflict for {sr!r}: {seen[k]} vs {(en, ru)}')
            continue
        for x in (en, ru): assert '§' not in x and 'blokvolt' not in x.lower(), x
        seen[k] = (en, ru); order.append(k)
    js = lambda i: json.dumps('§'.join(x for k in order for x in (k, seen[k][i])), ensure_ascii=False)
    return f'window.BVQ=window.BVQ||[];BVQ.push(["en2",{js(0)}]);BVQ.push(["ru2",{js(1)}]);', len(order)


def jsonld(d, date, cov):
    url, org = SITE + d['slug'], {'@id': SITE + '/#org'}
    cites = [it['url'] for s in d['sections'] if s['type'] == 'sources' for it in s['items']]
    return {'@context': 'https://schema.org', '@graph': [
        {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Evolako', 'url': SITE + '/', 'email': 'hello@evolako.com',
         'sameAs': SAME_AS,
         'areaServed': [{'@type': 'City', 'name': 'Beograd'}, {'@type': 'City', 'name': 'Novi Sad'}, {'@type': 'AdministrativeArea', 'name': 'Vojvodina'}],
         'knowsLanguage': ['sr', 'ru', 'en']},
        {'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': [
            {'@type': 'ListItem', 'position': 1, 'name': 'Početna', 'item': SITE + '/'},
            {'@type': 'ListItem', 'position': 2, 'name': 'Za firme i zgrade', 'item': SITE + '/punjaci-za-firme'},
            {'@type': 'ListItem', 'position': 3, 'name': d['hero']['h1']}]},
        {'@type': 'Article', '@id': url + '#article', 'headline': d['hero']['h1'], 'description': d['seo']['description'], 'inLanguage': 'sr-Latn',
         'datePublished': date, 'dateModified': date, 'mainEntityOfPage': url, 'author': org, 'publisher': org, 'citation': cites,
         'image': [IMG[cov][1]]}]}  # v1.3: the guide's own cover photo (full size)


def render(docs, date):
    p = Page(docs)
    d = p.sr
    hero = {'kicker': p.t(['hero', 'kicker']), 'h1': p.t(['hero', 'h1']), 'lead': p.t(['hero', 'lead'])}
    hero['updated_html'] = f'<div class="evb-upd">{p.t(["hero", "updated"])}</div>'
    p.t(['seo', 'title'])
    trans = dates(date)[1]
    sections = []
    for si in range(len(d['sections'])):
        sections += [{'id': a, 'html': b} for a, b in render_section(p, si, trans)]
    cov = SEG_COVER.get(seg_of(d), 16)
    p.pairs.append(tuple(ALT[cov]))  # cover photo alt (set on the template's cover image in build)
    dict_js, n = dictionary(p.pairs)
    head = (f'<meta property="og:url" content="{SITE}{d["slug"]}">\n<meta property="og:type" content="article">\n<meta property="og:site_name" content="Evolako">\n'
            '<meta property="og:locale" content="sr_RS">\n<meta name="twitter:card" content="summary_large_image">')
    dd = '.'.join(reversed(date.split('-')))
    foot = f'<script>\n/* Evolako · {d["slug"]} · EN/RU dictionaries for the i18n engine. {dd} */\n{dict_js}\n</script>'
    assert len(head) < 50000 and len(foot) < 50000
    card = Page(docs)
    card_html = (f'<a class="evb2-g" href="{q(d["slug"])}">{img_tag(thumb_idx(cov), "evb2-gimg")}<div class="evb2-gb"><div class="evb-lt">{card.t(["card", "title"])}</div>'
                 f'<div class="evb-lx">{card.t(["card", "text"])}</div></div><div class="evb2-garr">→</div></a>')
    hub_js = dictionary(card.pairs)[0]
    assert len(hub_js) <= 2000, len(hub_js)
    return dict(hero=hero, sections=sections, head=head, foot=foot, pairs=len(p.pairs), keys=n, jsonld=jsonld(d, date, cov), card_html=card_html, hub_js=hub_js,
                cover=cov, srodni_thumbs=[thumb_of(it['href']) for it in d['sections'][3]['items']])


def eid(pid, x): return {'component': pid, 'element': x}


def build(d, date, pid, extra_guides=()):
    errs, warns, info = check(d, extra_guides, date)
    if errs: raise SystemExit('check failed:\n  ' + '\n  '.join(errs))
    docs = load(d, date)
    sr = docs[0]
    r = render(docs, date)
    H1 = H.unescape
    steps = []
    steps.append(('data_whtml_builder', pid, [{'build_label': 'updated', 'parent_element_id': eid(pid, T['LEAD']), 'creation_position': 'after', 'html': r['hero']['updated_html']}]))
    acts = [{'label': 'rm-old-updated', 'remove_element': {'id': eid(pid, T['UPD'])}}]
    acts += [{'label': f'rm-old-sec{i + 1}', 'remove_element': {'id': eid(pid, x)}} for i, x in enumerate(OLD_SECTIONS)]
    acts += [{'label': 'h1', 'set_text': {'id': eid(pid, T['H1']), 'text': sr['hero']['h1']}},
             {'label': 'lead', 'set_text': {'id': eid(pid, T['LEAD']), 'text': sr['hero']['lead']}}]
    acts += [{'label': 'cover-photo', 'set_image_asset': {'id': eid(pid, T['COVER_IMG']), 'image_asset_id': IMG[r['cover']][0]}}]
    steps.append(('data_element_tool', pid, acts))
    steps.append(('data_element_settings_tool', pid, [{'label': 'cover-alt', 'set_settings': {'operations': [{'label': 'cover', 'element_id': eid(pid, T['COVER_IMG']),
                                                     'settings': [{'key': 'altText', 'static_text': {'value': ALT[r['cover']][0]}}]}]}}]))
    secs = [{'build_label': s['id'], 'parent_element_id': eid(pid, T['FOOT']), 'creation_position': 'before', 'html': s['html']} for s in r['sections']]
    for i in range(0, len(secs), 5): steps.append(('data_whtml_builder', pid, secs[i:i + 5]))
    # srodni photos: whtml inserts <img> without a managed asset -> query the 3 .evb2-gimg images (only srodni has them) and bind in DOM order
    steps.append(('data_element_tool', pid, [{'label': 'srodni-imgs', 'query_elements': {'queries': [{'label': 'imgs', 'element_filter': {'style': 'evb2-gimg'}, 'limit': 10}]}}]))
    steps.append(('data_element_tool', pid, [{'label': f'srodni-img{k + 1}', 'set_image_asset': {'id': eid(pid, f'@IMG{k + 1}@'), 'image_asset_id': IMG[x][4]}}
                                             for k, x in enumerate(r['srodni_thumbs'])]))
    steps.append(('data_scripts_tool', pid, [{'label': 'head', 'set_page_freeform_code': {'page_id': pid, 'location': 'head', 'content': r['head']}},
                                           {'label': 'footer', 'set_page_freeform_code': {'page_id': pid, 'location': 'footer', 'content': r['foot']}}]))
    seo = sr['seo']
    steps.append(('data_pages_tool', pid, [
        {'label': 'settings', 'update_page_settings': {'page_id': pid, 'title': sr['hero']['h1'], 'slug': sr['page'],
                                                       'seo': {'title': seo['title'], 'description': seo['description']},
                                                       'openGraph': {'title': seo['og_title'], 'titleCopied': False, 'description': seo['og_description'], 'descriptionCopied': False,
                                                                     'imageAssetId': OG_IMAGE}}},
        {'label': 'jsonld', 'bulk_update_pages_schema_markup': {'site_id': SITE_ID, 'pages': [{'id': pid, 'jsonLdSchema': r['jsonld']}]}}]))
    seg = SEGMENTS.get(sr['sections'][2]['button']['href'].split('?')[0])
    targets = [(HUB_PAGE, HUB_GRID, 'append')] + ([(seg[0], seg[1], 'prepend')] if seg else [])
    hub = [('data_scripts_tool', HUB_PAGE, [{'label': 'register', 'register_inline_script': {'site_id': SITE_ID, 'display_name': 'evohub' + h(sr['page']),
                                                                                              'version': '1.0.0', 'source_code': r['hub_js']}}])]
    hub += [('data_scripts_tool', pg, [{'label': 'apply', 'add_page_script': {'page_id': pg, 'script_id': '@SCRIPT_ID@', 'location': 'footer', 'version': '1.0.0'}}]) for pg, _, _ in targets]
    hub += [('data_whtml_builder', pg, [{'build_label': 'guide-card', 'parent_element_id': eid(pg, grid), 'creation_position': pos, 'html': r['card_html']}]) for pg, grid, pos in targets]
    # card photo: query the grid's .evb2-gimg images; the new card is the LAST match on the hub (append) and the FIRST on a segment page (prepend)
    for pg, grid, pos in targets:
        hub += [('data_element_tool', pg, [{'label': 'card-imgs', 'query_elements': {'queries': [{'label': 'imgs', 'scope_element_id': eid(pg, grid),
                                                                                                   'element_filter': {'style': 'evb2-gimg'}, 'limit': 50}]}}]),
                ('data_element_tool', pg, [{'label': 'card-img', 'set_image_asset': {'id': eid(pg, '@CARD_IMG@'), 'image_asset_id': IMG[thumb_idx(r['cover'])][4]}}])]
    hub += [('data_pages_tool', pid, [{'label': 'undraft', 'update_page_settings': {'page_id': pid, 'draft': False}}])]
    out = os.path.join(d, 'out'); os.makedirs(os.path.join(out, 'steps'), exist_ok=True)
    for f in os.listdir(os.path.join(out, 'steps')): os.remove(os.path.join(out, 'steps', f))
    for i, (tool, page, actions) in enumerate(steps):
        json.dump({'tool': 'mcp__Webflow__' + tool, 'pageId': page, 'actions': actions}, open(os.path.join(out, 'steps', f'{i + 1:02d}_{tool}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for i, (tool, page, actions) in enumerate(hub):
        json.dump({'tool': 'mcp__Webflow__' + tool, 'pageId': page, 'actions': actions}, open(os.path.join(out, 'steps', f'H{i + 1}_{tool}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    sha = lambda s: hashlib.sha256(s.encode()).hexdigest()[:16]
    expected = {'page_id': pid, 'slug': sr['slug'], 'h1': sr['hero']['h1'], 'lead': sr['hero']['lead'], 'updated': sr['hero']['updated'],
                'section_ids': ['tekst'] + [s['id'] for s in r['sections'][1:]], 'n_sections': len(r['sections']),
                'head_len': len(r['head']), 'foot_len': len(r['foot']), 'foot_head': r['foot'][:90], 'foot_tail': r['foot'][-60:],
                'foot_sha16': sha(r['foot']), 'dict_keys': r['keys'], 'jsonld_headline': sr['hero']['h1'],
                'seo_title': seo['title'], 'card_title': sr['card']['title'], 'hub_js_len': len(r['hub_js']), 'words': info.get('words'),
                'card_pages': [t[0] for t in targets], 'cover_asset': IMG[r['cover']][0], 'cover_alt': ALT[r['cover']][0],
                'srodni_assets': [IMG[x][4] for x in r['srodni_thumbs']], 'card_asset': IMG[thumb_idx(r['cover'])][4],
                'og_image_asset': OG_IMAGE, 'jsonld_image': IMG[r['cover']][1],
                'log_line': f'| {date} | {sr["slug"]} | {pid} | {info.get("words")} | {len(sr["sections"][1]["items"])} |'}
    json.dump(expected, open(os.path.join(out, 'expected.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return steps, hub, expected, warns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['check', 'build', 'selftest', 'preflight', 'verify'])
    ap.add_argument('dir', nargs='?')
    ap.add_argument('--date'); ap.add_argument('--page-id'); ap.add_argument('--extra-guides', default='')
    a = ap.parse_args()
    extra = []
    for x in [x for x in a.extra_guides.split(',') if x]:
        slug, _, seg = x.partition('=')
        extra.append(slug)
        if seg: EXTRA_SEG[slug] = seg
    if a.cmd == 'preflight':  # actions for data_element_tool on TEMPLATE_PAGE: every query must return total_matches 1
        ids = dict(T, **{f'SEC{i + 1}': x for i, x in enumerate(OLD_SECTIONS)})
        print(json.dumps({'siteId': SITE_ID, 'pageId': TEMPLATE_PAGE, 'actions': [{'label': 'preflight', 'query_elements': {'queries': [
            {'label': k, 'element_id': eid(TEMPLATE_PAGE, v)} for k, v in ids.items()]}}]}, ensure_ascii=False))
        return
    if a.cmd == 'verify':  # actions for data_element_tool on the new page; compare with out/expected.json
        exp = json.load(open(os.path.join(a.dir, 'out', 'expected.json'), encoding='utf-8'))
        pid = exp['page_id']
        print(json.dumps({'siteId': SITE_ID, 'pageId': pid, 'actions': [
            {'label': 'texts', 'query_elements': {'queries': [{'label': 'h1', 'element_id': eid(pid, T['H1']), 'children_depth': 1},
                                                              {'label': 'lead', 'element_id': eid(pid, T['LEAD']), 'children_depth': 1},
                                                              {'label': 'updated', 'element_filter': {'style': 'evb-upd'}, 'children_depth': 1},
                                                              {'label': 'sections', 'element_filter': {'type': 'Section'}, 'limit': 40}]}}]}, ensure_ascii=False))
        print('expect: h1 =', exp['h1']); print('expect: updated =', exp['updated'], '(exactly 1 match)')
        print('expect: sections in this order, each once:', ', '.join(exp['section_ids']))
        return
    if a.cmd == 'selftest':
        print('hash ok' if h('Kako radi') == '1odfjz3' else 'HASH BROKEN'); print(dates('2026-10-08')); return
    if a.cmd == 'check':
        errs, warns, info = check(a.dir, extra, a.date or '2026-01-01')
        print(f'{len(errs)} errors, {len(warns)} warnings, {info}')
        for x in errs: print('  ERR ', x)
        for x in warns: print('  warn', x)
        sys.exit(1 if errs else 0)
    assert a.date and re.fullmatch(r'\d{4}-\d\d-\d\d', a.date), '--date YYYY-MM-DD'
    assert a.page_id and re.fullmatch(r'[0-9a-f]{24}', a.page_id), '--page-id <24 hex>'
    steps, hub, exp, warns = build(a.dir, a.date, a.page_id, extra)
    for x in warns: print('  warn', x)
    for i, (tool, page, actions) in enumerate(steps): print(f'{i + 1:02d} {tool:22s} {len(json.dumps(actions, ensure_ascii=False)):6d} chars')
    for i, (tool, page, actions) in enumerate(hub): print(f'H{i + 1} {tool:22s} {len(json.dumps(actions, ensure_ascii=False)):6d} chars (publish mode only)')
    print(json.dumps({k: exp[k] for k in ('section_ids', 'foot_len', 'foot_sha16', 'dict_keys', 'words')}, ensure_ascii=False))


if __name__ == '__main__':
    main()

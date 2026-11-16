#!/usr/bin/env python3
"""Shared pieces of the three page families of 16.11.2026 (SEO plan §4.1 в, г, д; task SEO4):

  site/hoteli.py   /punjaci-za-hotele-<mesto>   chargers for hotels and apartments in a resort (B2B, tone «vi»)
  site/modeli.py   /kucni-punjac-za-<auto>      a home charger for one car, + the hub /kucni-punjac-po-modelu («ti»)
  site/marke.py    /ugradnja-<punjač>           installing a charger the customer already has, + the hub
                                                /samo-ugradnja-punjaca («ti»)

Each family keeps its facts in site/content/<family>/*.json (written by hand from the sources named there, the
public-charging facts by a tool) and its texts as templates (sr, en American, ru) filled with each page's own data,
like the city pages (site/gradovi.py). site/content.py renders them on the guide templates; this module holds what
the three share: the document builder, the article markup (with a visible FAQ and links to the two own sites), the
copy check and the JSON-LD pieces.

Rules the check enforces on every page (the build stops on an error): the copy rules of the kits (no "atest",
discounts, 24/7, "odmah", exclamation marks, surcharge amounts, "we handle the paperwork"), no "PDV" (prices are final), 72 h only with the wording of the site (Beograd, Novi Sad, Vojvodina), no reviews or
numbers of installations, the tone of the family («ti» or «vi»), every number of the Serbian text in the
translations, title ≤ 60 and description 70–155 in the three languages, links only to pages of the site or to
www.blokvolt.rs / shop.evolako.rs.
"""
import html as H
import importlib.util
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))


def load_module(name, path=None):
    spec = importlib.util.spec_from_file_location('evo_' + name, path or os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


GR = load_module('gradovi')          # helpers and the shared price / steps texts of the city pages
SITE = GR.SITE
T, tri, num, dates, sr_word, ru_word = GR.T, GR.tri, GR.num, GR.dates, GR.sr_word, GR.ru_word
e = lambda s: H.escape(s, quote=False)    # noqa: E731
q = lambda s: H.escape(s, quote=True)     # noqa: E731
LANGS = ('sr', 'en', 'ru')
EXTERNAL_OK = ('https://www.blokvolt.rs/', 'https://shop.evolako.rs/')   # the two own sites a paragraph may link to

UPDATED = GR.UPDATED
TRANS_TI = GR.TRANS
TRANS_VI = ('Ova stranica je napisana uz pomoć AI alata na osnovu navedenih izvora, a podaci su provereni %s Ako ste našli '
            'grešku ili imate noviji podatak, javite nam na hello@evolako.com — ispravke objavljujemo sa datumom.',
            'This page was written with the help of AI tools based on the sources listed, and the data were checked on %s. '
            'If you spot an error or have newer data, let us know at hello@evolako.com — we publish corrections with a date.',
            'Эта страница написана с помощью ИИ-инструментов на основе указанных источников, данные проверены %s Если вы '
            'нашли ошибку или у вас есть более свежие данные, напишите нам на hello@evolako.com — исправления мы публикуем с датой.')


def trans_line(date, tone):
    sr, en, ru = dates(date)
    t = TRANS_VI if tone == 'vi' else TRANS_TI
    return t[0] % sr, t[1] % en, t[2] % ru


def ddmmyyyy(iso):
    y, m, d = iso.split('-')
    return '%s.%s.%s' % (d, m, y)


_MONTHS_EN = 'January February March April May June July August September October November December'.split()
_DMY = re.compile(r'\b(\d{1,2})\.(\d{1,2})\.(20\d\d|19\d\d)\b')


def en_date(dmy):
    """«16.11.2026» -> «November 16, 2026»: the English pages write dates the American way, so that 06.10.2025 cannot be
    read as June 10."""
    d, m, y = (int(x) for x in dmy.rstrip('.').split('.'))
    return '%s %d, %d' % (_MONTHS_EN[m - 1], d, y)


_AN = ('Audi', 'ABB', 'MG', 'EV', 'ID.', 'i3', 'e-', 'Opel', 'Ioniq', 'Atto', 'Easee')


def a_an(name):
    """The English indefinite article by the sound the name starts with: an Audi, an MG4, an ABB; a BMW, a VW, a Tesla."""
    return ('an ' if name.startswith(_AN) else 'a ') + name


def en_dates(text):
    """Every dd.mm.yyyy of an English text in the American form."""
    return _DMY.sub(lambda m: en_date(m.group(0)), text)


_NOT_TEXT = ('page', 'slug', 'tone', 'kind', 'href', 'url', 'id', 'type')


def american(x, key=None):
    """An English document with every date in the American form (texts only: not links, ids or slugs)."""
    if isinstance(x, dict):
        return {k: american(v, k) for k, v in x.items()}
    if isinstance(x, list):
        return [american(v, key) for v in x]
    if isinstance(x, str) and key not in _NOT_TEXT:
        return en_dates(x)
    return x


def dur(h, lang):
    """A duration as the pages write it: «5 h 30 min», «17 h» (rounded to 30 minutes, from 10 h on to the hour)."""
    if h >= 10:
        v = '%d h' % int(h + 0.5)
    else:
        half = int(h * 2 + 0.5)
        v = ('%d h' % (half // 2)) + (' 30 min' if half % 2 else '')
        if half < 2:
            v = '%d min' % (int(h * 60 / 5 + 0.5) * 5)
    return v.replace(' h', ' ч').replace('min', 'мин') if lang == 'ru' else v


def hm(minutes, lang):
    """A duration a source states, to the minute: «5 h 20 min», «19 h»."""
    hh, mm = divmod(int(minutes), 60)
    v = (('%d h' % hh) if hh else '') + ((' %d min' % mm) if mm else '')
    v = v.strip()
    return v.replace(' h', ' ч').replace('h', 'ч').replace('min', 'мин') if lang == 'ru' else v


ABOUT = {'sr': 'oko ', 'en': 'about ', 'ru': 'около '}


def hours(h, lang):
    """Charging time with «oko»: «oko 5 h 30 min»."""
    return ABOUT[lang] + dur(h, lang)


def drive_time(minutes, lang):
    """«oko 3 h 50 min» — rounded to 10 minutes."""
    m = int(round(minutes / 10.0) * 10)
    hh, mm = divmod(m, 60)
    v = ('%d h' % hh) + ((' %d min' % mm) if mm else '')
    return {'sr': 'oko ' + v, 'en': 'about ' + v, 'ru': 'около ' + v.replace(' h', ' ч').replace('min', 'мин')}[lang]


# ------------------------------------------------------------------------------------------------ the document builder
class Doc:
    """The three documents (sr, en, ru) of one page in the guides' schema: seo, hero, an article of blocks (h2, p, ul,
    table, note, faq), sources, a callout and three link cards."""

    def __init__(self, page, tone, kind):
        self.page, self.tone = page, tone
        self.docs = [{'page': page, 'slug': '/' + page, 'tone': tone, 'kind': kind} for _ in LANGS]
        self.blocks = []
        self.faq = []
        self.src = []
        self.tail = []

    def _put(self, path, t):
        for i, lang in enumerate(LANGS):
            d = self.docs[i]
            for k in path[:-1]:
                d = d.setdefault(k, {})
            d[path[-1]] = t[lang] if isinstance(t, dict) else t[i]

    def seo(self, title, description, og_title, og_description):
        for k, v in (('title', title), ('description', description), ('og_title', og_title),
                     ('og_description', og_description)):
            self._put(['seo', k], v)

    def hero(self, kicker, h1, lead, date):
        self._put(['hero', 'kicker'], kicker)
        self._put(['hero', 'h1'], h1)
        self._put(['hero', 'lead'], lead)
        for i, s in enumerate(UPDATED):
            self.docs[i]['hero']['updated'] = s % dates(date)[i]

    def add(self, kind, t):
        """kind: h2, p, ul, table, note. t: {'sr','en','ru'}; a paragraph or list item may be a list of strings and
        {'a', 'href'} links."""
        self.blocks.append((kind, t))

    def h2(self, sr, en, ru):
        self.add('h2', T(sr, en, ru))

    def p(self, sr, en, ru):
        self.add('p', T(sr, en, ru))

    def ul(self, items):
        self.add('ul', T([x['sr'] for x in items], [x['en'] for x in items], [x['ru'] for x in items]))

    def table(self, head, rows):
        self.add('table', T({'head': head['sr'], 'rows': [r['sr'] for r in rows]},
                            {'head': head['en'], 'rows': [r['en'] for r in rows]},
                            {'head': head['ru'], 'rows': [r['ru'] for r in rows]}))

    def question(self, qt, at):
        """One visible question and its answer (plain text); the FAQPage of the page is made of exactly these."""
        self.faq.append((qt, at))

    def faq_block(self, h2):
        self.add('h2', h2)
        self.add('faq', T(*[[{'q': qt[lang], 'a': at[lang]} for qt, at in self.faq] for lang in LANGS]))

    def source(self, title, url):
        self.src.append((title if isinstance(title, dict) else T(*title), url))

    def callout(self, h2, text, label, href):
        self.tail.append(('callout', h2, text, label, href))

    def links(self, h2, items):
        """items: [(title T, text T, href)] — exactly three cards."""
        self.tail.append(('links', h2, items))

    def build(self):
        for i, lang in enumerate(LANGS):
            secs = [{'type': 'article', 'id': 'tekst', 'blocks': [{k: t[lang]} for k, t in self.blocks]},
                    {'type': 'sources', 'id': 'izvori', 'h2': ('Izvori', 'Sources', 'Источники')[i],
                     'items': [{'title': t[lang], 'url': u} for t, u in self.src]}]
            for item in self.tail:
                if item[0] == 'callout':
                    _, h2, text, label, href = item
                    secs.append({'type': 'callout', 'id': 'cta', 'h2': h2[lang], 'text': text[lang],
                                 'button': {'label': label[lang], 'href': href}})
                else:
                    _, h2, items = item
                    secs.append({'type': 'links', 'id': 'srodni', 'h2': h2[lang],
                                 'items': [{'title': a[lang], 'text': b[lang], 'href': href} for a, b, href in items]})
            self.docs[i]['sections'] = secs
        self.docs[1] = american(self.docs[1])    # English: «November 16, 2026», also in a title cited as published
        return self.docs


# ------------------------------------------------------------------------------------------------ rendering
def render_article(p, si, s):
    """The kits' article markup (as site/gradovi.py: list items may carry links), plus a visible FAQ: <details> blocks,
    which the build turns into the FAQPage of each language (prerender.faq_sr_from_visible) and QA compares."""
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
        elif k == 'note':
            cur += '<div class="evb-anote">%s</div>' % p.t(P + [i, 'note'])
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
        elif k == 'faq':
            cur += '<div class="vg-faq">' + ''.join(
                '<details open><summary>%s</summary><p class="evb-ans">%s</p></details>'
                % (p.t(P + [i, 'faq', j, 'q']), p.t(P + [i, 'faq', j, 'a'])) for j in range(len(b['faq']))) + '</div>'
        else:
            raise ValueError('unknown block %r' % k)
    if cur:
        chunks.append(cur)
    sid = s.get('id', 'tekst')
    return [(('%s-%d' % (sid, j + 1)) if j else sid,
             '<section class="evb-sec-art" id="%s"><div class="w3"><div class="evb-art">%s</div></div></section>'
             % (('%s-%d' % (sid, j + 1)) if j else sid, c)) for j, c in enumerate(chunks)]


# ------------------------------------------------------------------------------------------------ JSON-LD
def org_node(same_as):
    return {'@type': 'Organization', '@id': SITE + '/#org', 'name': 'Evolako', 'url': SITE + '/', 'email': 'hello@evolako.com',
            'sameAs': same_as, 'areaServed': [{'@type': 'Country', 'name': 'Srbija'}], 'knowsLanguage': ['sr', 'ru', 'en']}


def breadcrumb(url, trail):
    """trail: [(name, page or None)] — the last item is the page itself (no link)."""
    items = []
    for i, (name, page) in enumerate(trail):
        it = {'@type': 'ListItem', 'position': i + 1, 'name': name}
        if page is not None:
            it['item'] = SITE + '/' + page
        items.append(it)
    return {'@type': 'BreadcrumbList', '@id': url + '#breadcrumb', 'itemListElement': items}


def faq_node(url, doc_sr):
    """FAQPage of the visible questions of the Serbian document (the build rewrites it from the page in each language)."""
    qa = [x for s in doc_sr['sections'] if s['type'] == 'article' for b in s['blocks'] if 'faq' in b for x in b['faq']]
    if not qa:
        return None
    return {'@type': 'FAQPage', '@id': url + '#faq', 'mainEntity': [
        {'@type': 'Question', 'name': x['q'], 'acceptedAnswer': {'@type': 'Answer', 'text': x['a']}} for x in qa]}


def graph(*nodes):
    return {'@context': 'https://schema.org', '@graph': [n for n in nodes if n]}


# ------------------------------------------------------------------------------------------------ checks
TONE_VI = GR.TONE_VI + [r'\bpozovite\b', r'\bpošaljite\b', r'\bpogledajte\b', r'\bizračunajte\b']   # «vi» in a «ti» text
TONE_TI = [r'\b[Tt]i\b', r'\b[Tt]voj\w*', r'\b[Tt]ebi\b', r'\b[Tt]ebe\b', r'\bimaš\b', r'\bznaš\b', r'\bpuniš\b',
           r'\bpošalji\b', r'\bjavi\b', r'\bpogledaj\b', r'\bproveri\b', r'\bmožeš\b']   # «ti» in a «vi» text
RU_TI = [r'\bвы\b', r'\bвас\b', r'\bвам\b', r'\bваш']                    # «вы» in a «ты» text
RU_VI = [r'\bты\b', r'\bтебе\b', r'\bтебя\b', r'\bтво[йяеёию]']          # «ты» in a «вы» text
NO_PROMISE = [r'72 sata', r'lokaln\w* električar', r'\bodmah\b', r'u roku od 7 dana', r'besplatn\w* ugradnj',
              r'\brecenzij', r'zadovoljn\w* (kupac|kupaca|klijent)', r'\bugradili smo\b', r'\bnaš\w* klijent']
APP_CONTROL = [r'iz aplikacije Evolako', r'u aplikaciji Evolako', r'preko aplikacije Evolako',
               r'aplikacij\w+ Evolako\w* (upravlja|pokre|zaustav|podešava)']   # the app does not control a charger (APP1)
TR_BANNED = {'en': GR.TR_BANNED['en'] + [r'\breview', r'Evolako app (lets|controls|starts|stops)'],
             'ru': [x for x in GR.TR_BANNED['ru'] if 'вы' not in x and 'вас' not in x and 'вам' not in x
                    and 'ваш' not in x and 'НДС' not in x] + [r'отзыв', r'приложени\w+ Evolako (управля|запуска)']}
_NUM = re.compile(r'\d+(?:[.,]\d+)+|\d{3,}')


def texts(doc, path=()):
    yield from GR.texts(doc, path)


def check(docs, kit, allowed_pages, tone, zone=False):
    """Errors of one page (a list of strings). zone: the place is inside the 72 h zone of the site."""
    errs = []
    sr, en, ru = docs
    for d, lang in ((sr, 'sr'), (en, 'en'), (ru, 'ru')):
        seo = d['seo']
        if not seo['title'].endswith(' | Evolako') or len(seo['title']) > 60:
            errs.append('%s seo.title must end with " | Evolako" and be ≤ 60 (%d): %s' % (lang, len(seo['title']), seo['title']))
        if re.search(r'\d{2,}', seo['title'].replace('11 kW', '').replace('22 kW', '')) and not re.search(
                r'(ID\.\d|500e|i3|MG4|Model [3YSX])', seo['title']):
            errs.append('%s seo.title carries a number that can change: %s' % (lang, seo['title']))
        n = len(seo['description'])
        if not 70 <= n <= 155:
            errs.append('%s seo.description must be 70–155 chars (%d)' % (lang, n))
        if len(seo['og_description']) > 200:
            errs.append('%s seo.og_description > 200' % lang)
    a, b, c = list(texts(sr)), list(texts(en)), list(texts(ru))
    if [p for p, _ in a] != [p for p, _ in b] or [p for p, _ in a] != [p for p, _ in c]:
        return errs + ['en/ru: structure differs from sr']
    ru_all = ' '.join(t for _, t in c)
    for rx in (RU_TI if tone == 'ti' else RU_VI):
        m = re.search(rx, ru_all, re.I)
        if m:
            errs.append('ru: tone is «%s» — /%s/ near %r' % ('ты' if tone == 'ti' else 'вы', rx, ru_all[max(0, m.start() - 30):m.end() + 30]))
    for (p, s), (_, t_en), (_, t_ru) in zip(a, b, c):
        where = '.'.join(str(x) for x in p)
        if isinstance(p[-1], int) and len(s.strip()) <= 1 and (t_en != s or t_ru != s):
            errs.append('%s: the piece %r must be the same in en/ru (%r, %r)' % (where, s, t_en, t_ru))
        if not s.strip() and s != ' ':
            errs.append('%s: empty' % where)
        plain = s
        for rx in kit.FORBID + NO_PROMISE + APP_CONTROL + [r'\bPDV'] + ([] if zone else [GR.ZONE_RX]):
            if re.search(rx, plain, re.I):
                errs.append('%s: forbidden /%s/: %s' % (where, rx, s[:90]))
        for rx in (TONE_VI if tone == 'ti' else TONE_TI):
            if re.search(rx, s):
                errs.append('%s: tone is «%s» — /%s/: %s' % (where, tone, rx, s[:90]))
        if '"' in s:
            errs.append('%s: straight quotes' % where)
        if re.search(r'\d,\d{3}\b', s) and 'RSD' in s:
            errs.append('%s: thousands separator must be ".": %s' % (where, s[:90]))
        if re.search(r'\d(kW|kWh|RSD|km)\b', s):
            errs.append('%s: missing space before the unit: %s' % (where, s[:90]))
        if re.search(r'\s-\s', s):
            errs.append('%s: use a dash " — " instead of " - ": %s' % (where, s[:90]))
        for lang, t in (('en', t_en), ('ru', t_ru)):
            if not t.strip() and t != ' ':
                errs.append('%s %s: empty' % (lang, where))
            tt = t
            for rx in kit.TR_FORBID + TR_BANNED[lang] + ([r'\bVAT\b'] if lang == 'en' else [r'НДС']):
                if re.search(rx, tt, re.I):
                    errs.append('%s %s: forbidden /%s/: %s' % (lang, where, rx, t[:90]))
            for nmb in _NUM.findall(s):
                if nmb in t:
                    continue
                if lang == 'en' and re.fullmatch(r'\d{1,3},\d{1,2}', nmb) and nmb.replace(',', '.') in t:
                    continue    # EN decimal point: 2,3 kW → 2.3 kW
                if lang == 'en' and _DMY.fullmatch(nmb) and en_date(nmb) in t:
                    continue    # EN date: 16.11.2026 → November 16, 2026
                errs.append('%s %s: number %s missing: %s' % (lang, where, nmb, t[:90]))
            if lang == 'en' and _DMY.search(t):
                errs.append('en %s: a date must be written the American way (Doc.build does it): %s' % (where, t[:90]))

    def walk(x, key=None):
        if isinstance(x, dict):
            for k, v in x.items():
                yield from walk(v, k)
        elif isinstance(x, list):
            for v in x:
                yield from walk(v, key)
        elif isinstance(x, str):
            yield key, x
    for d in docs:
        for key, v in walk(d):
            if key == 'href' and not v.startswith(EXTERNAL_OK) and v != '/' and \
                    v.split('?')[0].split('#')[0].strip('/') not in allowed_pages:
                errs.append('link target is not a page of the site: %s' % v)
            if key == 'url' and not v.startswith('https://'):
                errs.append('source url must be https://: %s' % v)
    hrefs = [list(walk(d)) for d in docs]
    if [v for k, v in hrefs[0] if k in ('href', 'url')] != [v for k, v in hrefs[1] if k in ('href', 'url')] or \
            [v for k, v in hrefs[0] if k in ('href', 'url')] != [v for k, v in hrefs[2] if k in ('href', 'url')]:
        errs.append('links differ between the languages')
    return errs

#!/usr/bin/env python3
"""Own content of www.evolako.rs after the move off Webflow (switch 28.10.2026): guides for residents (/vodici), news
(/novosti) and B2B guides (/punjaci-za-firme + the segment pages), kept as JSON under site/content/ and applied by
site/build.py on top of the frozen Webflow snapshot. The scheduled tasks publish by committing JSON here (the push
deploys the site, .github/workflows/site-preview.yml); nothing is written to Webflow any more.

  site/content/vodici/<page>/sr.json en.json ru.json meta.json   guide for residents (kit site/kits/evc.py, tone «ti»)
  site/content/b2b/<page>/sr.json en.json ru.json meta.json      B2B guide (kit site/kits/evb_vodic.py, tone «vi»)
  site/content/novosti/<id>.json                                 one news item {"sr": …, "en": …, "ru": …} (evc.py)
  site/content/gradovi/gradovi.json                              city pages /ugradnja-punjaca-<grad> and the hub
                                                                 /ugradnja-punjaca (site/gradovi.py; 28.10.2026)
  meta.json = {"date": "YYYY-MM-DD"} — the publication date ("Ažurirano: …", the transparency line, JSON-LD dates).

The texts follow the same JSON schema and copy rules as on Webflow (the kits' check() and newscheck() run unchanged;
a check error stops the build). What changes is only where the HTML goes:
  * a new guide is a copy of a guide page of the snapshot (TEMPLATE: navigation, footer, scripts, styles exactly as
    published) with its own hero, cover photo, sections, head (title, meta, canonical, og:url, JSON-LD) — the markup
    of the kits, written the way Webflow publishes it (wf());
  * its card goes first into /vodici (B2B: last into the grid of /punjaci-za-firme and first into the segment page of
    its CTA), the hub JSON-LD ItemList gets it too; a news item goes on top of the list on /novosti (and its JSON-LD);
  * EN/RU: the pairs (Serbian, English, Russian) of every new text go to the build-time dictionaries of the page that
    shows it (prerendered /en/ and /ru/ pages); new pages carry no inline dictionary script, so they share the CSP of
    the site (no own _headers rule — Pages allows 100) — see site/build.py;
  * every photo is a file the snapshot holds (the kits' IMG table; a full-size photo the snapshot lacks is replaced by
    a close one, FULL_FALLBACK); sitemap.xml lists the new pages and the new lastmod of the pages that changed.
Deterministic, standard library only.

  python3 site/content.py check [<content item dir or news .json> …]   # all content, or the named items (verbose)
  python3 site/content.py list
"""
import copy
import html as H
import importlib.util
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONTENT_DIR = os.path.join(HERE, 'content')
SITE = 'https://www.evolako.rs'


def _kit(name):
    spec = importlib.util.spec_from_file_location('evo_kit_' + name, os.path.join(HERE, 'kits', name + '.py'))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


EVC = _kit('evc')          # residents: guides (tone «ti») and news
EVB = _kit('evb_vodic')    # B2B guides (tone «vi»)
_spec = importlib.util.spec_from_file_location('evo_gradovi', os.path.join(HERE, 'gradovi.py'))
GR = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(GR)   # city pages: texts, data, checks (site/gradovi.py)
GR.SAME_AS = EVC.SAME_AS
# One photo table for both kits: evb's (photo 2 v2 — the first version must never be shown again — and photos 17, 18).
EVC.IMG, EVC.ALT, EVC.thumb_idx = EVB.IMG, EVB.ALT, EVB.thumb_idx
EVC.THUMB = dict(EVC.THUMB, **{'/punjaci-za-parkinge': 17})
EVC.SEG_COVER = dict(EVC.SEG_COVER, **{'/punjaci-za-parkinge': 17})
if '/punjaci-za-parkinge' not in EVC.B2B_PAGES:
    EVC.B2B_PAGES.append('/punjaci-za-parkinge')

KINDS = ('vodic', 'b2b')
KIT = {'vodic': EVC, 'b2b': EVB}
DIRS = {'vodic': 'vodici', 'b2b': 'b2b'}
TEMPLATE = {'vodic': 'komsija-puni-iz-zajednicke-uticnice',   # newest guide of each kit in the snapshot (27.10/22.10)
            'b2b': 'garaza-za-izdavanje-sa-punjacem'}
HUB_VODICI, NEWS_PAGE, HUB_B2B = 'vodici', 'novosti', 'punjaci-za-firme'
# Guides published on Webflow (in the snapshot): consumer guide -> its cover photo (thumbnail of its cards);
# B2B guides made by the pipeline after the six starter ones -> their CTA segment (thumbnail).
B2C_SNAPSHOT = {'/punjenje-preko-suko-uticnice': 13, '/punjac-11-ili-22-kw': 7, '/punjenje-nocu-tajmer': 4,
                '/koliko-elektricni-auto-podize-racun-za-struju': 13, '/komsija-puni-iz-zajednicke-uticnice': 10,
                '/povecanje-snage-struje-eds': 9}
B2B_SNAPSHOT_EXTRA = {'/operativni-lizing-elektricnog-automobila-punjenje': '/punjaci-za-sluzbena-vozila',
                      '/garaza-za-izdavanje-sa-punjacem': '/punjaci-za-parking-garaze'}
# full-size photos the snapshot does not hold (no published page showed them) -> a close photo it holds
FULL_FALLBACK = {1: 12, 3: 15, 5: 0, 8: 4, 18: 17}
NEWS_JSONLD_MAX = 30                      # as the kit: the ItemList of /novosti names the 30 newest items

e = lambda s: H.escape(s, quote=False)    # noqa: E731 — the kits' escaping
q = lambda s: H.escape(s, quote=True)     # noqa: E731


class ContentError(ValueError):
    pass


def wf(s):
    """The kits' whtml markup as Webflow publishes it (attribute order, role="list", w-inline-block, img without
    width/height): checked against the published guides of the snapshot."""
    s = re.sub(r'<section class="([^"]*)" id="([^"]*)">', r'<section id="\2" class="\1">', s)
    s = re.sub(r'<div class="([^"]*)" id="([^"]*)">', r'<div id="\2" class="\1">', s)
    s = re.sub(r'<a class="evb2-g" href="([^"]*)">', r'<a href="\1" class="evb2-g w-inline-block">', s)
    s = re.sub(r'<a class="([^"]*)" href="([^"]*)">', r'<a href="\2" class="\1">', s)
    s = s.replace('<ul class="evb-ul">', '<ul role="list" class="evb-ul">')
    s = re.sub(r'<img class="([^"]*)" src="([^"]*)" alt="([^"]*)" width="\d+" height="\d+" loading="lazy">',
               r'<img src="\2" loading="lazy" alt="\3" class="\1"/>', s)
    left = re.findall(r'<(?:a|section|div|img)\b class="[^"]*" (?:href|id|src)=', s)
    if left:
        raise ContentError('markup not normalized: %s' % left[:3])
    return s


def one(text, pattern, what, flags=0):
    ms = list(re.finditer(pattern, text, flags))
    if len(ms) != 1:
        raise ContentError('%s: expected exactly one match, found %d' % (what, len(ms)))
    return ms[0]


def sub_one(text, pattern, repl, what, flags=0):
    m = one(text, pattern, what, flags)
    return text[:m.start()] + (repl(m) if callable(repl) else repl) + text[m.end():]


def jsonld_block(text, what):
    m = one(text, r'(<script type="application/ld\+json">)(.*?)(</script>)', what + ' JSON-LD', re.S)
    return m, json.loads(m.group(2))


def dump_jsonld(obj):
    return '\n' + json.dumps(obj, ensure_ascii=False, indent=2).replace('</', '<\\/') + '\n'


def pairs_of(docs, path):
    """(sr, en, ru) of one text path of the three documents."""
    a, b, c = docs
    for k in path:
        a, b, c = a[k], b[k], c[k]
    return a, b, c


def full_cover(i):
    return FULL_FALLBACK.get(i, i)


def PR_key(s):
    """The i18n engine's key of a Serbian text (= prerender.key_of, = the kits' h())."""
    return EVC.h(s)


# ------------------------------------------------------------------------------------------------ items
class Guide:
    """A guide (residents or B2B) of site/content."""

    def __init__(self, kind, path):
        self.kind, self.dir = kind, path
        self.kit = KIT[kind]
        self.page = os.path.basename(path.rstrip('/'))
        self.slug = '/' + self.page
        mp = os.path.join(path, 'meta.json')
        if not os.path.isfile(mp):
            raise ContentError('%s: meta.json is missing ({"date": "YYYY-MM-DD"})' % rel(path))
        with open(mp, encoding='utf-8') as f:
            meta = json.load(f)
        self.date = meta.get('date')
        if not isinstance(self.date, str) or not re.fullmatch(r'20\d\d-\d\d-\d\d', self.date):
            raise ContentError('%s: meta.json date must be "YYYY-MM-DD"' % rel(path))
        for lang in ('sr', 'en', 'ru'):
            if not os.path.isfile(os.path.join(path, lang + '.json')):
                raise ContentError('%s: %s.json is missing' % (rel(path), lang))
        self.docs = self.kit.load(path, self.date)
        self.sr = self.docs[0]
        if self.sr.get('page') != self.page:
            raise ContentError('%s: "page" is %r, the folder is %r' % (rel(path), self.sr.get('page'), self.page))
        self.segment = self.sr['sections'][2]['button']['href'].split('?')[0] if kind == 'b2b' else None

    def cover(self):
        """Photo index of the cover (kits' rules), before FULL_FALLBACK."""
        if self.kind == 'vodic':
            return EVC.cover_of(self.sr)
        return EVB.SEG_COVER.get(self.segment, 16)


class News:
    def __init__(self, path):
        self.path = path
        with open(path, encoding='utf-8') as f:
            self.item = json.load(f)
        if set(self.item) != {'sr', 'en', 'ru'}:
            raise ContentError('%s: a news item is {"sr": …, "en": …, "ru": …}' % rel(path))
        self.id = self.item['sr'].get('id')
        self.date = self.item['sr'].get('date')
        if os.path.basename(path) != '%s.json' % self.id:
            raise ContentError('%s: the file name must be <id>.json (id %r)' % (rel(path), self.id))


def rel(p):
    try:
        return os.path.relpath(p, os.path.dirname(HERE))
    except ValueError:
        return p


def scan(content_dir):
    """All items of the content folder: (guides, news). A file that is not valid JSON or misses the basic structure
    stops here with its path."""
    guides, news = [], []

    def load(make, *args):
        try:
            return make(*args)
        except ContentError:
            raise
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as ex:
            raise ContentError('%s: %s: %s' % (rel(args[-1]), type(ex).__name__, ex))
    for kind in KINDS:
        base = os.path.join(content_dir, DIRS[kind])
        if os.path.isdir(base):
            for name in sorted(os.listdir(base)):
                p = os.path.join(base, name)
                if os.path.isdir(p) and not name.startswith(('.', '_')):
                    guides.append(load(Guide, kind, p))
    base = os.path.join(content_dir, 'novosti')
    if os.path.isdir(base):
        for name in sorted(os.listdir(base)):
            if name.endswith('.json') and not name.startswith(('.', '_')):
                news.append(load(News, os.path.join(base, name)))
    return guides, news


# ------------------------------------------------------------------------------------------------ content
class Content:
    """The content of site/content applied to the snapshot pages.

    sources: {slug: html} of the published snapshot pages (as Webflow published them, before the build).
    asset_urls: URLs the snapshot holds (every photo the content shows must be one of them).

    After __init__: new_pages {slug: html}, patched {slug: html} (changed snapshot pages), pairs {slug: [(sr, en, ru)]}
    (texts of new and changed pages for the /en/ and /ru/ versions), template_of {new slug: template slug},
    lastmod {slug: date} (sitemap), errors / warnings per item (errors stop the build)."""

    def __init__(self, sources, asset_urls, content_dir=CONTENT_DIR, only=None):
        self.sources, self.asset_urls, self.content_dir = sources, asset_urls, content_dir
        self.new_pages, self.patched, self.pairs, self.template_of, self.lastmod = {}, {}, {}, {}, {}
        self.messages = []                 # (item, 'error'|'warning'|'info', text)
        self.guides, self.news = scan(content_dir) if os.path.isdir(content_dir) else ([], [])
        if only is not None:
            self.only = {os.path.realpath(p) for p in only}
        else:
            self.only = None
        self.gradovi = GR.load(content_dir) if os.path.isdir(content_dir) else None
        self.validate()
        if self.errors():
            return
        for g in self.guides:
            self.add_guide(g)
        self.apply_cards()
        self.apply_news()
        if self.gradovi:
            self.add_gradovi()

    def errors(self):
        return [(i, t) for i, k, t in self.messages if k == 'error']

    def say(self, item, kind, text):
        self.messages.append((item, kind, text))

    # ---------------------------------------------------------------- validation
    def validate(self):
        existing = {'/' if s == 'index' else '/' + s for s in self.sources}
        seen = {}
        for g in self.guides:
            if g.slug in existing:
                self.say(g.slug, 'error', 'slug %s is already a page of the site' % g.slug)
            if g.slug in seen:
                self.say(g.slug, 'error', 'slug %s is used by two content items' % g.slug)
            seen[g.slug] = g
        for kind in KINDS:
            if TEMPLATE[kind] not in self.sources:
                self.say('build', 'error', 'template page /%s is missing in the snapshot' % TEMPLATE[kind])
        for page in (HUB_VODICI, NEWS_PAGE, HUB_B2B):
            if page not in self.sources:
                self.say('build', 'error', 'page /%s is missing in the snapshot' % page)
        if self.gradovi:
            slugs = [GR.HUB] + [GR.PREFIX + c['slug'] for c in self.gradovi['cities']]
            for s in slugs:
                if s in self.sources or '/' + s in seen:
                    self.say('/' + s, 'error', 'slug /%s is already a page of the site' % s)
            if len(set(slugs)) != len(slugs):
                self.say('gradovi', 'error', 'a city slug is used twice')
            for c in self.gradovi['cities']:
                if c['region'] not in GR.REGION_NAMES or c['tariff'] not in ('beograd', 'vojvodina', 'centralna'):
                    self.say(c['slug'], 'error', 'unknown region or tariff area')
                if not re.fullmatch(r'[a-z0-9]+(-[a-z0-9]+)*', c['slug']) or 'public' not in c:
                    self.say(c['slug'], 'error', 'slug must be lowercase ASCII and "public" must be filled '
                                                 '(site/tools/gradovi_data.py)')
            if not re.fullmatch(r'20\d\d-\d\d-\d\d', str(self.gradovi.get('date'))) or \
                    not self.gradovi.get('map', {}).get('checked'):
                self.say('gradovi', 'error', 'gradovi.json needs "date" (YYYY-MM-DD) and "map.checked"')
        b2c = dict(B2C_SNAPSHOT)
        b2c.update({g.slug: g.cover() for g in self.guides if g.kind == 'vodic'})
        b2b = dict(B2B_SNAPSHOT_EXTRA)
        b2b.update({g.slug: g.segment for g in self.guides if g.kind == 'b2b'})
        self.b2c_cover, self.b2b_segment = b2c, b2b
        for g in self.guides:
            if self.only is not None and os.path.realpath(g.dir) not in self.only:
                continue
            self.check_guide(g, b2c, b2b)
        ids = {}
        for n in self.news:
            if n.id in ids:
                self.say(n.id, 'error', 'news id used twice')
            ids[n.id] = n
            if self.only is not None and os.path.realpath(n.path) not in self.only:
                continue
            self.set_kit_links(EVC, b2c, b2b, None)
            errs, warns = EVC.newscheck(n.item)
            for x in errs:
                self.say(n.id, 'error', x)
            for x in warns:
                self.say(n.id, 'warning', x)
            if not errs and n.date != n.id[:10]:
                self.say(n.id, 'error', 'date %s differs from the date in the id' % n.date)

    @staticmethod
    def set_kit_links(kit, b2c, b2b, self_slug):
        """The kits' link lists: every guide of the site (snapshot and content) except the one being checked."""
        if kit is EVC:
            EVC.B2C_GUIDES[:] = sorted(s for s in b2c if s != self_slug)
            EVC.B2C_COVER.clear()
            EVC.B2C_COVER.update({s: c for s, c in b2c.items() if s != self_slug})
            EVC.EXTRA_SEG.clear()
            EVC.EXTRA_SEG.update(b2b)
        else:
            EVB.EXTRA_SEG.clear()
            EVB.EXTRA_SEG.update({s: seg for s, seg in b2b.items() if s != self_slug})

    def check_guide(self, g, b2c, b2b):
        kit = g.kit
        self.set_kit_links(kit, b2c, b2b, g.slug)
        if kit is EVC:
            extra = sorted(s for s in b2b if s != g.slug) + ['/punjaci-za-parkinge']
        else:
            extra = sorted(s for s in b2b if s != g.slug)
        try:
            errs, warns, info = kit.check(g.dir, extra, g.date)
        except (KeyError, IndexError, TypeError, AssertionError) as ex:
            errs, warns, info = ['the JSON does not follow the schema (%s: %s)' % (type(ex).__name__, ex)], [], {}
        for x in errs:
            self.say(g.slug, 'error', x)
        for x in warns:
            self.say(g.slug, 'warning', x)
        if info:
            self.say(g.slug, 'info', 'words %s, H2 %s' % (info.get('words'), info.get('h2', '?')))

    def image(self, url, where):
        if url not in self.asset_urls:
            raise ContentError('%s: photo %s is not in the snapshot' % (where, url))
        return url

    # ---------------------------------------------------------------- guides
    def add_guide(self, g):
        kit = g.kit
        self.set_kit_links(kit, self.b2c_cover, self.b2b_segment, g.slug)
        docs = copy.deepcopy(g.docs)
        p = kit.Page(docs)
        d = p.sr
        kicker, h1 = p.t(['hero', 'kicker']), p.t(['hero', 'h1'])
        lead, updated = p.t(['hero', 'lead']), p.t(['hero', 'updated'])
        p.t(['seo', 'title'])
        trans = kit.dates(g.date)[1]
        sections = []
        for si in range(len(d['sections'])):
            sections += [html for _, html in kit.render_section(p, si, trans)]
        cov = full_cover(g.cover())
        p.pairs.append(tuple(kit.ALT[cov]))
        for k in ('description', 'og_title', 'og_description'):        # head: meta, og:, twitter:, JSON-LD
            p.pairs.append(pairs_of(docs, ['seo', k]))
        body = wf(''.join(sections))
        for src in re.findall(r'<img src="([^"]+)"', body):
            self.image(src, g.slug)
        cover_url = self.image(kit.IMG[cov][1], g.slug + ' cover')
        ld = kit.jsonld(d, g.date, cov)
        tpl_slug = TEMPLATE[g.kind]
        t = self.sources[tpl_slug]
        t = self.retarget(t, tpl_slug, g, d, ld, kicker, h1, lead, updated, cover_url, kit.ALT[cov][0], body)
        self.new_pages[g.page] = t
        self.template_of[g.page] = tpl_slug
        self.add_pairs(g.page, p.pairs)
        self.lastmod[g.page] = g.date
        self.say(g.slug, 'info', '%s %s: %d sections, %d texts, cover %d' % (
            g.kind, g.date, len(sections), len(p.pairs), cov))

    def retarget(self, t, tpl, g, d, ld, kicker, h1, lead, updated, cover_url, cover_alt, body):
        """The template page with this guide's head, hero, cover and sections; its own dictionary script dropped."""
        seo = d['seo']
        old_url, new_url = SITE + '/' + tpl, SITE + g.slug
        t = sub_one(t, r'<title>[^<]*</title>', '<title>%s</title>' % e(seo['title']), 'title')
        for attr, key, val in (('name', 'description', seo['description']), ('property', 'og:title', seo['og_title']),
                               ('property', 'og:description', seo['og_description']),
                               ('name', 'twitter:title', seo['og_title']),
                               ('name', 'twitter:description', seo['og_description'])):
            t = sub_one(t, r'<meta content="[^"]*" %s="%s"/>' % (attr, re.escape(key)),
                        '<meta content="%s" %s="%s"/>' % (q(val), attr, key), key)
        t = sub_one(t, r'<link href="%s" rel="canonical"/>' % re.escape(old_url),
                    '<link href="%s" rel="canonical"/>' % new_url, 'canonical')
        t = sub_one(t, r'<meta property="og:url" content="%s">' % re.escape(old_url),
                    '<meta property="og:url" content="%s">' % new_url, 'og:url')
        m, _ = jsonld_block(t, '/' + tpl)
        t = t[:m.start(2)] + dump_jsonld(ld) + t[m.end(2):]
        t = sub_one(t, r'<div class="v3-ph"><div class="w3"><div class="v3-kick">[^<]*</div><h1>[^<]*</h1><p>[^<]*</p>'
                       r'<div class="evb-upd">[^<]*</div></div></div>',
                    '<div class="v3-ph"><div class="w3"><div class="v3-kick">%s</div><h1>%s</h1><p>%s</p>'
                    '<div class="evb-upd">%s</div></div></div>' % (kicker, h1, lead, updated), 'hero')
        t = sub_one(t, r'<section class="evb2-cvsec"><div class="w3"><img src="[^"]*" loading="lazy" alt="[^"]*" '
                       r'class="evb2-cv"/></div></section>',
                    '<section class="evb2-cvsec"><div class="w3"><img src="%s" loading="lazy" alt="%s" class="evb2-cv"/>'
                    '</div></section>' % (cover_url, q(cover_alt)), 'cover')
        a = one(t, r'<section id="tekst" class="evb-sec-art">', 'first section').start()
        b = one(t, r'<div class="v3-foot">', 'footer').start()
        if not re.search(r'<section id="srodni" class="evmk-sec">', t[a:b]):
            raise ContentError('/%s: no "srodni" section before the footer' % tpl)
        t = t[:a] + body + t[b:]
        t = sub_one(t, r'<script>\s*/\* Evolako · /%s · EN/RU dictionaries for the i18n engine[^*]*\*/.*?</script>'
                    % re.escape(tpl), '', 'dictionary script', re.S)
        if re.search(r'/%s(?![a-z0-9-])' % re.escape(tpl), t):
            raise ContentError('%s: the template slug /%s is still on the page' % (g.slug, tpl))
        return t

    # ---------------------------------------------------------------- city pages (site/gradovi.py)
    def add_gradovi(self):
        data = self.gradovi
        EVC.THUMB.setdefault('/' + GR.HUB, 9)               # its card in "Pročitaj i ovo": the on-site assessment
        self.set_kit_links(EVC, self.b2c_cover, self.b2b_segment, None)
        allowed = set(self.sources) | set(self.new_pages) | {GR.HUB} | {GR.PREFIX + c['slug'] for c in data['cities']}
        allowed |= {s.split('#')[0] for s in ('index',)}
        pages = [(GR.HUB, GR.hub_texts(data), GR.COVER_HUB, None)]
        pages += [(GR.PREFIX + c['slug'], GR.city_texts(c, data), GR.COVER_CITY, c) for c in data['cities']]
        tpl_slug = TEMPLATE['vodic']
        for slug, (docs, ld_names), cov, city in pages:
            errs = GR.check(docs, EVC, allowed)
            for x in errs:
                self.say('/' + slug, 'error', x)
            if errs:
                continue
            p = EVC.Page(docs)
            d = p.sr
            kicker, h1 = p.t(['hero', 'kicker']), p.t(['hero', 'h1'])
            lead, updated = p.t(['hero', 'lead']), p.t(['hero', 'updated'])
            p.t(['seo', 'title'])
            trans = GR.trans_line(data['date'])
            parts = []
            for si, sec in enumerate(d['sections']):
                if sec['type'] == 'article':
                    parts += [h for _, h in GR.render_article(p, si, sec)]
                else:
                    parts += [h for _, h in EVC.render_section(p, si, trans)]
            cov = full_cover(cov)
            p.pairs.append(tuple(EVC.ALT[cov]))
            for k in ('description', 'og_title', 'og_description'):
                p.pairs.append(pairs_of(docs, ['seo', k]))
            p.pairs += ld_names
            body = wf(''.join(parts))
            for src in re.findall(r'<img src="([^"]+)"', body):
                self.image(src, '/' + slug)
            cover_url = self.image(EVC.IMG[cov][1], '/' + slug + ' cover')
            ld = GR.city_jsonld(city, docs) if city else GR.hub_jsonld(data, docs)
            g = type('Page', (), {'slug': '/' + slug})()
            t = self.retarget(self.sources[tpl_slug], tpl_slug, g, d, ld, kicker, h1, lead, updated, cover_url,
                              EVC.ALT[cov][0], body)
            if slug == GR.HUB:                   # the footer link "Ugradnja po gradovima" is the current page here
                cur = '<a href="/%s">' % GR.HUB
                if t.count(cur) == 1:
                    t = t.replace(cur, '<a href="/%s" aria-current="page" class="w--current">' % GR.HUB)
            self.new_pages[slug] = t
            self.template_of[slug] = tpl_slug
            self.add_pairs(slug, p.pairs)
            self.lastmod[slug] = data['date']
        self.say('gradovi', 'info', 'city pages %s: the hub and %d cities (map of %s)' % (
            data['date'], len(data['cities']), data['map']['checked']))

    # ---------------------------------------------------------------- cards
    def card(self, g):
        kit = g.kit
        self.set_kit_links(kit, self.b2c_cover, self.b2b_segment, None)
        docs = g.docs
        thumb = kit.thumb_idx(g.cover())          # as the kits: the thumbnail of the cover the CTA (or "cover") names
        img = self.image(kit.IMG[thumb][5], g.slug + ' card')
        c = docs[0]['card']
        html = wf('<a class="evb2-g" href="%s"><img class="evb2-gimg" src="%s" alt="" width="1" height="1" loading="lazy">'
                  '<div class="evb2-gb"><div class="evb-lt">%s</div><div class="evb-lx">%s</div></div>'
                  '<div class="evb2-garr">→</div></a>' % (q(g.slug), img, e(c['title']), e(c['text'])))
        return html, [pairs_of(docs, ['card', 'title']), pairs_of(docs, ['card', 'text'])]

    def patch(self, slug):
        return self.patched.get(slug, self.sources[slug])

    def add_pairs(self, slug, pairs):
        """Pairs of a page; the same Serbian text with two different translations on one page stops the build (the
        kits' dictionary() did the same on Webflow)."""
        have = {PR_key(sr): (en, ru) for sr, en, ru in self.pairs.get(slug, [])}
        for sr, en, ru in pairs:
            k = PR_key(sr)
            if k in have and have[k] != (en, ru):
                raise ContentError('/%s: %r is translated twice differently: %r / %r' % (slug, sr[:60], have[k], (en, ru)))
            have[k] = (en, ru)
        self.pairs.setdefault(slug, []).extend(pairs)

    def touch(self, slug, date):
        if date > self.lastmod.get(slug, ''):
            self.lastmod[slug] = date

    def apply_cards(self):
        b2c = sorted((g for g in self.guides if g.kind == 'vodic'), key=lambda g: (g.date, g.page))
        b2b = sorted((g for g in self.guides if g.kind == 'b2b'), key=lambda g: (g.date, g.page))
        if b2c:
            # /vodici: newest first at the top of "Svi vodiči"; the hub JSON-LD ItemList the same
            cards, pairs = [], []
            for g in reversed(b2c):
                h, p = self.card(g)
                cards.append(h)
                pairs += p
            t = self.patch(HUB_VODICI)
            m = one(t, r'<section id="svi-vodici" class="evmk-sec"><div class="w3"><h2 class="evmk-h2">Svi vodiči</h2>'
                       r'<div class="evb2-guides">', '/vodici grid')
            t = t[:m.end()] + ''.join(cards) + t[m.end():]
            m, ld = jsonld_block(t, '/vodici')
            lst = [n for n in ld['@graph'] if n.get('@type') == 'ItemList']
            if len(lst) != 1:
                raise ContentError('/vodici: JSON-LD without one ItemList')
            items = [{'@type': 'ListItem', 'name': g.sr['card']['title'], 'url': SITE + g.slug} for g in reversed(b2c)]
            items += lst[0]['itemListElement']
            for i, it in enumerate(items):
                it['position'] = i + 1
            lst[0]['itemListElement'] = items
            t = t[:m.start(2)] + dump_jsonld(ld) + t[m.end(2):]
            self.patched[HUB_VODICI] = t
            self.add_pairs(HUB_VODICI, pairs)
            self.touch(HUB_VODICI, b2c[-1].date)
        for g in b2b:
            # B2B: last in the hub grid (oldest first, as on Webflow), first on the segment page of its CTA
            h, p = self.card(g)
            t = self.patch(HUB_B2B)
            m = one(t, r'<section id="vodici" class="evmk-sec"><div class="w3"><div class="evmk-lbl">Vodiči</div>'
                       r'<h2 class="evmk-h2">[^<]*</h2><div class="evb2-guides">', '/punjaci-za-firme grid')
            pos = m.end()
            while True:
                c = re.match(r'<a href="[^"]*" class="evb2-g w-inline-block">.*?</a>', t[pos:], re.S)
                if not c:
                    break
                pos += c.end()
            if not t[pos:].startswith('</div>'):
                raise ContentError('/punjaci-za-firme: the guide grid does not end after its cards')
            self.patched[HUB_B2B] = t[:pos] + h + t[pos:]
            self.add_pairs(HUB_B2B, p)
            self.touch(HUB_B2B, g.date)
            seg = g.segment.strip('/')
            if g.segment in EVB.SEGMENTS:
                if seg not in self.sources:
                    raise ContentError('%s: segment page %s is not in the snapshot' % (g.slug, g.segment))
                t = self.patch(seg)
                m = one(t, r'<section id="vodici" class="evmk-sec"><div class="w3"><div class="evmk-lbl">Vodiči</div>'
                           r'<h2 class="evmk-h2">[^<]*</h2><div class="evb2-guides">', g.segment + ' grid')
                # newest first: a later guide goes in front of an earlier one
                self.patched[seg] = t[:m.end()] + h + t[m.end():]
                self.add_pairs(seg, p)
                self.touch(seg, g.date)

    # ---------------------------------------------------------------- news
    def apply_news(self):
        if not self.news:
            return
        items = sorted(self.news, key=lambda n: (n.date, n.id), reverse=True)     # newest first
        blocks, pairs = [], []
        for n in items:
            h, p = EVC.render_item(n.item)
            h = wf(h)
            for src in re.findall(r'<img src="([^"]+)"', h):
                self.image(src, n.id)
            blocks.append(h)
            pairs += p
        t = self.patch(NEWS_PAGE)
        m = one(t, r'<section id="novosti-lista" class="evb-sec-art"><div class="w3"><div>', '/novosti list')
        existing = re.findall(r'<div id="([^"]+)" class="evb-art evn-item">', t)
        for n in items:
            if n.id in existing:
                raise ContentError('news %s is already on /novosti' % n.id)
        t = t[:m.end()] + ''.join(blocks) + t[m.end():]
        m, ld = jsonld_block(t, '/novosti')
        lst = [x for x in ld['@graph'] if x.get('@type') == 'ItemList']
        if len(lst) != 1:
            raise ContentError('/novosti: JSON-LD without one ItemList')
        new = EVC.news_jsonld([n.item for n in items])['@graph'][1]['itemListElement']
        merged = (new + lst[0]['itemListElement'])[:NEWS_JSONLD_MAX]
        for i, it in enumerate(merged):
            it['position'] = i + 1
        lst[0]['itemListElement'] = merged
        t = t[:m.start(2)] + dump_jsonld(ld) + t[m.end(2):]
        self.patched[NEWS_PAGE] = t
        self.add_pairs(NEWS_PAGE, pairs)
        self.touch(NEWS_PAGE, items[0].date)
        for n in items:
            self.say(n.id, 'info', 'news %s: %d texts' % (n.date, len([1 for _ in EVC.render_item(n.item)[1]])))

    # ---------------------------------------------------------------- report
    def summary(self):
        g = [x for x in self.guides if x.kind == 'vodic']
        b = [x for x in self.guides if x.kind == 'b2b']
        cities = len(self.gradovi['cities']) if self.gradovi else 0
        new = sorted(s for s in self.new_pages if not s.startswith(GR.HUB))
        return ('content (site/content): %d guides, %d B2B guides, %d news items, %s — new pages: %s; changed pages: %s' % (
            len(g), len(b), len(self.news), ('the city hub and %d city pages (/%s, /%s<grad>)' % (
                cities, GR.HUB, GR.PREFIX)) if cities else 'no city pages',
            ', '.join('/' + s for s in new) or 'none', ', '.join('/' + s for s in sorted(self.patched)) or 'none'))


# ------------------------------------------------------------------------------------------------ CLI
def snapshot_sources(snapshot):
    with open(os.path.join(snapshot, 'manifest.json'), encoding='utf-8') as f:
        man = json.load(f)
    sources = {}
    for p in man['pages']:
        if p['path'] == '404':
            continue
        slug = p['path'].strip('/') or 'index'
        with open(os.path.join(snapshot, p['file']), encoding='utf-8') as f:
            sources[slug] = f.read()
    return sources, {a['url'] for a in man['assets'] if a.get('file')}


def main(argv):
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('cmd', choices=['check', 'list'])
    ap.add_argument('items', nargs='*')
    ap.add_argument('--content', default=CONTENT_DIR)
    ap.add_argument('--snapshot', default=os.path.join(HERE, 'snapshot'))
    a = ap.parse_args(argv)
    sources, assets = snapshot_sources(a.snapshot)
    try:
        c = Content(sources, assets, a.content, only=a.items or None)
    except ContentError as ex:
        print('ERROR ' + str(ex))
        return 1
    if a.cmd == 'list':
        for g in c.guides:
            print('%s  %-4s %s' % (g.date, g.kind, g.slug))
        for n in c.news:
            print('%s  news %s' % (n.date, n.id))
        return 0
    errs = c.errors()
    for item, kind, text in c.messages:
        if kind == 'warning' and not a.items:
            continue
        print('%-7s %s: %s' % (kind.upper(), item, text))
    print('%d errors%s; %s' % (len(errs), '' if a.items else ' (warnings: name the item)', c.summary()))
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

"""Real /en/ and /ru/ pages for the www.evolako.rs build (step 3 of moving the site off Webflow).

The live site has one URL per page: Serbian is the DOM master and the i18n engine ("Evolako i18n v3", an inline script
in every page head) swaps text nodes and four attributes in the browser, looking up FNV-1a(base36) of the normalized
Serbian text in dictionaries ('en2'/'ru2' first, then a month rule, then 'en'/'ru'). Search engines therefore only see
Serbian. This module writes the translated pages at build time:

  * the dictionaries are the ones the live page really has in that language, as the engine holds them once the page
    has settled (site/i18n/harvest.json, written by tools/i18n_harvest.py from the snapshot replay) — plus the
    translations the live site lacks (site/i18n/en.json, ru.json), consulted last, never overriding the live ones
  * every text node and placeholder / aria-label / alt / title attribute of <body> goes through the same steps as in
    the engine (same normalization, same "Evolako" -> "BlokVolt" hashing, same skip rules: [data-no-i18n], any class
    containing "logo", .v3-word, .fx-switch, script/style/noscript/iframe/template/code/pre/textarea, texts shorter
    than 2 characters), so a prerendered page shows exactly what the engine shows on the live page in that language
  * <title> as the engine sets it; meta description and the social titles/descriptions, JSON-LD strings: the same
    lookup (the engine never touched those, so most of them come from site/i18n/<lang>.json)

On the /en/ and /ru/ pages the engine still runs (dynamic widgets create Serbian text at runtime) but is locked to
the page's language; the build patches it (ENGINE_PATCHES) and the few scripts that read the page path or find links
by their Serbian href (INLINE_PATCHES, FILE_PATCHES).

Standard library only. Functions here mirror the JavaScript of the engine; tools/i18n_selftest.py compares them with
the engine's own code.
"""
import html
import json
import re

# ------------------------------------------------------------------------------------------------ engine functions
# JavaScript \s and trim() (ECMAScript WhiteSpace + LineTerminator); Python's \s differs (\x1c-\x1f and \x85 are
# whitespace there, ﻿ is not)
JS_WS = ('\t\n\x0b\x0c\r   ' + ''.join(chr(c) for c in range(0x2000, 0x200b)) +
         '    　﻿')
_WS_CLASS = '[%s]' % re.escape(JS_WS)
_WS_RUN = re.compile(_WS_CLASS + '+')
_WS_LEAD = re.compile('^' + _WS_CLASS + '*')
_WS_TAIL = re.compile(_WS_CLASS + '*$')
_MONTH = re.compile(r'^([0-9.,]+)' + _WS_CLASS + r'+mesec(?:a|i)?$', re.I)


def nm(s):
    """function nm(s){return s.replace(/\\s+/g,' ').trim()}"""
    return _WS_RUN.sub(' ', s).strip(JS_WS)


def bk(s):
    """"Evolako" is hashed as the old name, so the old dictionaries keep working."""
    return s.replace('Evolako', 'BlokVolt').replace('evolako', 'blokvolt').replace('EVOLAKO', 'BLOKVOLT')


def bf(s):
    if s is None:
        return s
    return re.sub('BlokVolt|Blokvolt', 'Evolako', s).replace('blokvolt', 'evolako').replace('BLOKVOLT', 'EVOLAKO')


def _base36(n):
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    if n == 0:
        return '0'
    out = ''
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out


def hs(s):
    """FNV-1a 32-bit over UTF-16 code units (charCodeAt), as base36 — the engine's key of a string."""
    x = 2166136261
    b = s.encode('utf-16-le')
    for i in range(0, len(b), 2):
        x ^= b[i] | (b[i + 1] << 8)
        x = (x * 16777619) & 0xFFFFFFFF
    return _base36(x)


def key_of(s):
    """Dictionary key of a Serbian text as the engine computes it: hs(bk(nm(s)))."""
    return hs(bk(nm(s)))


def _rum(n):
    if ',' in n or '.' in n:
        return 'месяца'
    m = re.match(r'[+-]?[0-9]+', n)
    v = int(m.group(0)) if m else float('nan')
    if v != v:                                   # parseInt gave NaN: every comparison is false -> 'месяцев'
        return 'месяцев'
    a, b = v % 100, v % 10
    if 10 < a < 20:
        return 'месяцев'
    if b == 1:
        return 'месяц'
    if 1 < b < 5:
        return 'месяца'
    return 'месяцев'


class Translator:
    """tr() of the engine for one page and language, plus the site's own additions consulted last.

    dicts: {'en2': {...}, 'en': {...}} as the engine holds them on that page (keys = hs(bk(nm(sr)))).
    extra: {key: translation} from site/i18n/<lang>.json."""

    def __init__(self, lang, dicts, extra=None):
        self.lang = lang
        self.d2 = dicts.get(lang + '2') or {}
        self.d1 = dicts.get(lang) or {}
        self.extra = extra or {}
        self.hits = {'d2': 0, 'month': 0, 'd1': 0, 'extra': 0}
        self.missing = {}                         # key -> normalized Serbian text the page wanted translated
        self.used_extra = set()
        self.used_live = set()                    # keys the live dictionaries answered

    def live(self, s):
        """Exactly what the engine on the live page returns (None = it leaves the text as it is)."""
        k = bk(nm(s))
        h = hs(k)
        if h in self.d2:
            self.hits['d2'] += 1
            self.used_live.add(h)
            return bf(self.d2[h])
        m = _MONTH.match(k)
        if m:
            self.hits['month'] += 1
            if self.lang == 'ru':
                return m.group(1) + ' ' + _rum(m.group(1))
            n = m.group(1).replace(',', '.') if re.fullmatch(r'[0-9]+,[0-9]+', m.group(1)) else m.group(1)
            return n + ' month' + ('' if n == '1' else 's')
        if h in self.d1:
            self.hits['d1'] += 1
            self.used_live.add(h)
            return bf(self.d1[h])
        return None

    def tr(self, s, record=True):
        v = self.live(s)
        if v is not None:
            return v
        h = key_of(s)
        if h in self.extra:
            self.hits['extra'] += 1
            self.used_extra.add(h)
            return bf(self.extra[h])
        if record:
            self.missing.setdefault(h, nm(s))
        return None

    def peek(self, s):
        """What the engine on this page (with the site's additions) returns for s, without counting."""
        k = bk(nm(s))
        h = hs(k)
        if h in self.d2:
            return bf(self.d2[h])
        m = _MONTH.match(k)
        if m:
            return 'month'
        if h in self.d1:
            return bf(self.d1[h])
        if h in self.extra:
            return bf(self.extra[h])
        return None


def ws_wrap(original, translated):
    """o.match(/^\\s*/)[0]+t+o.match(/\\s*$/)[0]"""
    return _WS_LEAD.match(original).group(0) + translated + _WS_TAIL.search(original).group(0)


# ------------------------------------------------------------------------------------------------ HTML
VOID = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr',
        'keygen'}
RAWTEXT = {'script', 'style', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'}   # scripting enabled: noscript too
RCDATA = {'textarea', 'title'}
SK = {'script', 'style', 'noscript', 'iframe', 'template', 'code', 'pre'}          # the engine's SK (HTML elements)
TR_ATTRS = ('placeholder', 'aria-label', 'alt', 'title')                            # the engine's A (EN/RU)
# start tags that close an open <p> (HTML "in body" rules, the ones that occur in practice)
CLOSES_P = {'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dir', 'div', 'dl',
            'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
            'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'ul', 'li', 'dd',
            'dt', 'listing', 'plaintext', 'search'}
_TAG = re.compile(r'<(/?)([A-Za-z][^\s/>]*)((?:[^>"\']|"[^"]*"|\'[^\']*\')*)>', re.S)
_ATTR = re.compile(r'([^\s"\'>/=]+)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'=<>`]+)))?', re.S)


class Element:
    __slots__ = ('tag', 'attrs', 'ns', 'parent', 'start', 'attr_spans')

    def __init__(self, tag, attrs, ns, parent, start, attr_spans):
        self.tag, self.attrs, self.ns, self.parent, self.start, self.attr_spans = tag, attrs, ns, parent, start, \
            attr_spans

    def chain(self):
        e = self
        while e is not None:
            yield e
            e = e.parent


def parse_attrs(raw, offset):
    """[(name, value, (start, end) of the value in the document, quote, (start, end) of the name)] — the value span
    is None for an attribute written without a value (then the value is '')."""
    out = []
    for m in _ATTR.finditer(raw):
        name = m.group(1).lower()
        nspan = (offset + m.start(1), offset + m.end(1))
        for g, q in ((2, '"'), (3, "'"), (4, '')):
            if m.group(g) is not None:
                out.append((name, html.unescape(m.group(g)), (offset + m.start(g), offset + m.end(g)), q, nspan))
                break
        else:
            out.append((name, '', None, None, nspan))
    return out


def walk(doc):
    """Events of an HTML document in order, with the open-element chain the browser builds for well-formed pages:
    ('start', element, end_of_tag) | ('end', element_or_None, span) | ('text', parent, raw, (start, end), in_body)
    | ('raw', element, (start, end)). Comments, doctype and CDATA are skipped."""
    pos, n = 0, len(doc)
    stack = []
    in_body = False

    def top():
        return stack[-1] if stack else None

    def close(tag):
        for i in range(len(stack) - 1, -1, -1):
            if stack[i].tag == tag:
                del stack[i:]
                return True
        return False

    while pos < n:
        lt = doc.find('<', pos)
        if lt < 0:
            lt = n
        if lt > pos:
            yield ('text', top(), doc[pos:lt], (pos, lt), in_body)
            pos = lt
            continue
        if doc.startswith('<!--', pos):
            end = doc.find('-->', pos + 4)
            pos = n if end < 0 else end + 3
            continue
        if doc.startswith('<!', pos) or doc.startswith('<?', pos):
            end = doc.find('>', pos)
            pos = n if end < 0 else end + 1
            continue
        m = _TAG.match(doc, pos)
        if not m:                                   # a lone "<" is text
            nxt = doc.find('<', pos + 1)
            nxt = n if nxt < 0 else nxt
            yield ('text', top(), doc[pos:nxt], (pos, nxt), in_body)
            pos = nxt
            continue
        closing, name, rest = m.group(1), m.group(2).lower(), m.group(3)
        if closing:
            el = None
            for i in range(len(stack) - 1, -1, -1):
                if stack[i].tag == name:
                    el = stack[i]
                    break
            if el is not None:
                close(name)
            if name == 'body':
                in_body = False
            yield ('end', el, (m.start(), m.end()))
            pos = m.end()
            continue
        parent = top()
        ns = parent.ns if parent is not None and parent.ns != 'html' else 'html'
        if name == 'svg':
            ns = 'svg'
        elif name == 'math':
            ns = 'math'
        if ns == 'svg' and parent is not None and parent.tag == 'foreignobject':
            ns = 'html'
        if ns == 'html':
            if name in CLOSES_P and any(e.tag == 'p' for e in stack):
                close('p')
            if name == 'li':
                close_li = next((e for e in reversed(stack) if e.tag in ('li', 'ul', 'ol')), None)
                if close_li is not None and close_li.tag == 'li':
                    close('li')
            if name in ('dt', 'dd'):
                prev = next((e for e in reversed(stack) if e.tag in ('dt', 'dd', 'dl')), None)
                if prev is not None and prev.tag in ('dt', 'dd'):
                    close(prev.tag)
            if name in ('option', 'optgroup') and top() is not None and top().tag == 'option':
                close('option')
        attrs = parse_attrs(rest, m.start(3))
        el = Element(name, {a[0]: a[1] for a in reversed(attrs)}, ns, top(), m.start(), attrs)
        if name == 'body':
            in_body = True
        self_closing = rest.rstrip().endswith('/')
        yield ('start', el, m.end())
        pos = m.end()
        if ns == 'html' and name in VOID or (ns != 'html' and self_closing):
            continue
        stack.append(el)
        if ns == 'html' and (name in RAWTEXT or name in RCDATA):
            end = re.compile(r'</%s[\s/>]' % name, re.I).search(doc, pos)
            end_at = n if not end else end.start()
            if name in RCDATA:
                yield ('text', el, doc[pos:end_at], (pos, end_at), in_body)
            else:
                yield ('raw', el, (pos, end_at))
            pos = end_at


def nox(el):
    """closest('[data-no-i18n],[class*="logo"],.v3-word,.fx-switch') — inclusive."""
    return nox_kind(el) is not None


def nox_kind(el):
    """None, 'logo' (only a class containing "logo" excludes it) or 'other' (data-no-i18n, .v3-word, .fx-switch)."""
    kind = None
    for e in el.chain():
        if 'data-no-i18n' in e.attrs:
            return 'other'
        cls = e.attrs.get('class')
        if cls is not None:
            words = cls.split()
            if 'v3-word' in words or 'fx-switch' in words:
                return 'other'
            if 'logo' in cls:
                kind = 'logo'
    return kind


def in_sk(el):
    """Inside an element the engine's TreeWalker rejects (or that element itself)."""
    return any(e.ns == 'html' and e.tag in SK for e in el.chain())


def esc_text(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def esc_attr(s, quote):
    s = s.replace('&', '&amp;')
    if quote == "'":
        return s.replace("'", '&#39;')
    return s.replace('"', '&quot;')


def translate_body(doc, tr, on_node=None):
    """Text nodes and placeholder/aria-label/alt/title of <body> through tr (a Translator), as the engine walks them.
    Returns the new document. on_node(kind, element, serbian, translation_or_None) is called for every candidate."""
    edits = []                                       # (start, end, replacement)
    for ev in walk(doc):
        if ev[0] == 'start':
            el = ev[1]
            if el.tag == 'body' or (el.parent is not None and _in_body(el)):
                if in_sk(el) or el.ns == 'html' and el.tag in SK:
                    continue
                # the engine skips logo containers to keep the wordmark as it is; their alt / aria-label / title
                # texts are only words for screen readers and image search, so the static page translates those
                # attributes (never the text inside); the engine at runtime leaves them alone
                if nox_kind(el) == 'other':
                    continue
                seen = set()
                for name, value, span, quote, nspan in el.attr_spans:
                    if name not in TR_ATTRS or name in seen:     # the first of duplicate attributes counts
                        continue
                    seen.add(name)
                    t = tr.tr(value, record=bool(nm(value)))
                    if on_node:
                        on_node('attr:' + name, el, value, t)
                    if t is None or t == value:
                        continue
                    if span is None:                             # <x title>: the attribute gets a value
                        edits.append((nspan[0], nspan[1], '%s="%s"' % (name, esc_attr(t, '"'))))
                    elif quote == '':
                        edits.append((span[0], span[1], '"' + esc_attr(t, '"') + '"'))
                    else:
                        edits.append((span[0], span[1], esc_attr(t, quote)))
        elif ev[0] == 'text':
            _, parent, raw, span, in_body = ev
            if not in_body or parent is None:
                continue
            if parent.ns == 'html' and (parent.tag in SK or parent.tag == 'textarea' or parent.tag == 'title'):
                continue
            if in_sk(parent):
                continue
            o = html.unescape(raw)
            if len(nm(o)) < 2:
                continue
            if nox(parent):
                continue
            t = tr.tr(o)
            if on_node:
                on_node('text', parent, o, t)
            if t is not None:
                v = ws_wrap(o, t)
                if v != o:
                    edits.append((span[0], span[1], esc_text(v)))
    return apply_edits(doc, edits)


def _in_body(el):
    return any(e.tag == 'body' for e in el.chain())


def apply_edits(doc, edits):
    edits.sort()
    out, pos = [], 0
    for s, e, r in edits:
        if s < pos:
            raise ValueError('overlapping edits at %d' % s)
        out.append(doc[pos:s])
        out.append(r)
        pos = e
    out.append(doc[pos:])
    return ''.join(out)


# ------------------------------------------------------------------------------------------------ pages and URLs
LANGS = ('en', 'ru')
OG_LOCALE = {'sr': 'sr_RS', 'en': 'en_US', 'ru': 'ru_RU'}
HREFLANG_OF_CODE = {'sr': 'sr', 'cy': 'sr-Cyrl', 'en': 'en', 'ru': 'ru'}   # data-l of the language menu -> hreflang


def page_path(lang, slug):
    """Root-relative URL of a page in a language: /, /kontakt, /en/, /en/kontakt."""
    tail = '/' if slug == 'index' else '/' + slug
    return tail if lang == 'sr' else '/' + lang + tail


def page_url(site, lang, slug):
    """Absolute URL. The Serbian home keeps the form of its published canonical (https://www.evolako.rs)."""
    if lang == 'sr' and slug == 'index':
        return site
    return site + page_path(lang, slug)


def menu_href(code, slug):
    """Where an entry of the language menu goes: sr / cy (Serbian Cyrillic, a mode of the Serbian page) / en / ru."""
    if code == 'cy':
        return page_path('sr', slug) + '?lang=sr-cyrl'
    return page_path(code, slug)


def alternates(site, slug):
    out = ['<link rel="alternate" hreflang="%s" href="%s"/>' % (h, page_url(site, l, slug))
           for h, l in (('sr', 'sr'), ('en', 'en'), ('ru', 'ru'), ('x-default', 'sr'))]
    return ''.join(out)


_INTERNAL = re.compile(r'^(https?://(?:www\.)?evolako\.rs)?(/[^?#]*)([?#][\s\S]*)?$')


def localize_href(href, lang):
    """An internal page link -> the same page in lang (/, /x, /x?q#h, /#h; absolute links on evolako.rs too).
    Files (/_a/...), the form endpoint, paths with a dot and links already in /en/ or /ru/ stay. Mirrors ln() of the
    engine, which does the same for links scripts add at runtime."""
    m = _INTERNAL.match(href)
    if not m:
        return None
    p = m.group(2)
    if p != '/' and not re.fullmatch(r'/[a-z0-9-]+', p) or re.fullmatch(r'/(?:en|ru)', p):
        return None
    return (m.group(1) or '') + '/' + lang + ('/' if p == '/' else p) + (m.group(3) or '')


def edit_attr(doc, el, name, value):
    """(start, end, replacement) that sets attribute name of a parsed start tag to value (added if missing)."""
    for n, v, span, quote, nspan in el.attr_spans:
        if n != name:
            continue
        if span is None:
            return (nspan[0], nspan[1], '%s="%s"' % (name, esc_attr(value, '"')))
        if quote == '':
            return (span[0], span[1], '"' + esc_attr(value, '"') + '"')
        return (span[0], span[1], esc_attr(value, quote))
    # add it right after the tag name
    at = el.start + 1 + len(el.tag)
    return (at, at, ' %s="%s"' % (name, esc_attr(value, '"')))


def remove_attr(doc, el, name):
    for n, v, span, quote, nspan in el.attr_spans:
        if n == name:
            end = span[1] + (1 if quote else 0) if span is not None else nspan[1]
            start = nspan[0]
            while start > 0 and doc[start - 1] in ' \t\n':
                start -= 1
            return (start, end, '')
    return None


def language_menu(doc, slug):
    """Every entry of the language menus becomes a real link to that language version of this page: the header menu
    (a.evo-lang__opt[data-l]) and the old footer chips (.v3-lang a: SR / EN / RU). Their stale title "Uskoro"
    ("coming soon") goes. The engine builds the footer dropdown at runtime and gives it the same links."""
    edits, n_menu, n_chips = [], 0, 0
    pending = None                                  # .v3-lang anchor waiting for its text (SR / EN / RU)
    for ev in walk(doc):
        if ev[0] == 'start':
            el = ev[1]
            if el.tag == 'a' and 'evo-lang__opt' in (el.attrs.get('class') or '').split() and el.attrs.get('data-l'):
                code = el.attrs['data-l']
                edits.append(edit_attr(doc, el, 'href', menu_href(code, slug)))
                edits.append(edit_attr(doc, el, 'hreflang', HREFLANG_OF_CODE[code]))
                n_menu += 1
            elif el.tag == 'a' and el.parent is not None and 'v3-lang' in (el.parent.attrs.get('class') or '').split():
                pending = el
        elif ev[0] == 'text' and pending is not None:
            code = nm(html.unescape(ev[2])).lower()
            if code in ('sr', 'en', 'ru'):
                edits.append(edit_attr(doc, pending, 'href', menu_href(code, slug)))
                edits.append(edit_attr(doc, pending, 'hreflang', HREFLANG_OF_CODE[code]))
                if pending.attrs.get('title') == 'Uskoro':
                    edits.append(remove_attr(doc, pending, 'title'))
                n_chips += 1
            pending = None
        elif ev[0] == 'end':
            pending = None
    return apply_edits(doc, [e for e in edits if e]), n_menu, n_chips


def localize_links(doc, lang):
    """Internal links of a page -> the same-language versions (anchors in <body>; the language menu keeps its
    hreflang links)."""
    edits, n = [], 0
    for ev in walk(doc):
        if ev[0] != 'start':
            continue
        el = ev[1]
        if el.tag != 'a' or 'hreflang' in el.attrs or 'href' not in el.attrs or not _in_body(el):
            continue
        new = localize_href(el.attrs['href'], lang)
        if new is not None and new != el.attrs['href']:
            edits.append(edit_attr(doc, el, 'href', new))
            n += 1
    return apply_edits(doc, edits), n


# ------------------------------------------------------------------------------------------------ head
TEXT_META = ('description', 'og:title', 'og:description', 'twitter:title', 'twitter:description')


def head_end(doc):
    i = doc.find('</head>')
    if i < 0:
        raise ValueError('no </head>')
    return i


def translate_jsonld(obj, tr, lang, site, slug, missing, keep):
    """Strings of a JSON-LD graph in lang: text through tr, inLanguage, page URLs (url/item/mainEntityOfPage and
    @id of page nodes) to the language version. The organization and the website keep their @id."""
    TEXT = {'name', 'description', 'headline', 'text', 'serviceType', 'unitText', 'alternateName', 'caption',
            'articleSection', 'abstract', 'keywords', 'jobTitle', 'disambiguatingDescription', 'slogan'}
    NON_TEXT = {'@context', '@type', 'applicationCategory', 'availability', 'availableLanguage', 'citation',
                'dateModified', 'datePublished', 'email', 'foundingDate', 'highPrice', 'image', 'knowsLanguage',
                'lowPrice', 'offerCount', 'operatingSystem', 'price', 'priceCurrency', 'sameAs', 'unitCode',
                'contactType', 'telephone', 'logo', 'contentUrl', 'thumbnailUrl', 'position', 'width', 'height'}
    URL_KEYS = {'url', 'item', 'mainEntityOfPage'}
    root_ids = {site + '/#org', site + '/#organization', site + '/#website'}

    def page_link(u):
        if not isinstance(u, str) or not u.startswith(site):
            return u
        rest = u[len(site):]
        path, frag = (rest.split('#', 1) + [''])[:2] if '#' in rest else (rest, None)
        if path in ('', '/'):
            new = site + '/' + lang + '/'
        elif re.fullmatch(r'/[a-z0-9-]+', path):
            new = site + '/' + lang + path
        else:
            return u
        return new + ('#' + frag if frag is not None else '')

    def walk_(x, key=None):
        if isinstance(x, dict):
            out = {}
            shared = x.get('@id') in root_ids or x.get('@type') in ('Organization', 'WebSite')
            for k, v in x.items():
                if k == '@id':
                    out[k] = v if v in root_ids else page_link(v)
                elif k == 'inLanguage':
                    out[k] = lang
                elif k in URL_KEYS:
                    # the organization and the website are the same entity in every language: their url stays
                    out[k] = (v if shared else page_link(v)) if isinstance(v, str) else walk_(v, k)
                else:
                    out[k] = walk_(v, k)
            return out
        if isinstance(x, list):
            return [walk_(v, key) for v in x]
        if isinstance(x, Final):
            return str(x)
        if isinstance(x, str):
            if key in NON_TEXT or key in URL_KEYS:
                return x
            if key not in TEXT:
                raise ValueError('JSON-LD key %r: neither text nor a known non-text key (value %r)' % (key, x[:60]))
            t = tr.tr(x, record=False)
            if t is not None:
                return t
            if key_of(x) in keep:
                return x
            missing.append(('json-ld ' + key, x))
            return x
        return x
    return walk_(obj)


def jsonld_dump(obj, pretty):
    s = json.dumps(obj, ensure_ascii=False, indent=2 if pretty else None,
                   separators=None if pretty else (',', ':'))
    return s.replace('</', '<\\/')


def make_lang_page(doc, slug, lang, tr, keep, site, extra_src, engine_marker):
    """The /<lang>/ version of a built Serbian page. Returns (html, report)."""
    rep = {'text': 0, 'attrs': 0, 'left': [], 'links': 0, 'missing_head': []}

    def on(kind, el, sr, t):
        if t is None:
            if key_of(sr) not in keep and not looks_neutral(sr):
                rep['left'].append((kind, nm(sr)))
            return
        if kind == 'text':
            rep['text'] += 1
        else:
            rep['attrs'] += 1
        again = tr.peek(t)                          # the engine of the page sees the translation as its original:
        if again is not None and again != t:        # it must not translate it once more
            rep.setdefault('chains', []).append((nm(sr), t, again))

    sr_doc = doc
    # <html lang>
    m = re.search(r'<html\b[^>]*>', doc)
    tag = m.group(0)
    if ' lang="sr"' not in tag:
        raise ValueError('%s: <html> without lang="sr"' % slug)
    doc = doc[:m.start()] + tag.replace(' lang="sr"', ' lang="%s"' % lang, 1) + doc[m.end():]
    # body: text nodes and attributes as the engine translates them
    doc = translate_body(doc, tr, on)
    doc, rep['links'] = localize_links(doc, lang)
    doc, rep['css_links'] = localize_css(doc, lang)
    # head
    end = head_end(doc)
    edits = []
    missing = rep['missing_head']
    for ev in walk(doc[:end]):
        if ev[0] == 'text' and ev[1] is not None and ev[1].tag == 'title' and ev[1].ns == 'html':
            sr = html.unescape(ev[2])
            t = tr.tr(sr, record=False)
            if t is None:
                missing.append(('title', nm(sr)))
            else:
                edits.append((ev[3][0], ev[3][1], esc_text(t)))
        elif ev[0] == 'start' and ev[1].tag == 'meta':
            el = ev[1]
            k = el.attrs.get('name') or el.attrs.get('property')
            if k in TEXT_META:
                sr = el.attrs.get('content') or ''
                t = tr.tr(sr, record=False)
                if t is None:
                    if key_of(sr) not in keep:
                        missing.append((k, nm(sr)))
                else:
                    edits.append(edit_attr(doc, el, 'content', t))
            elif k == 'og:url':
                edits.append(edit_attr(doc, el, 'content', page_url(site, lang, slug)))
            elif k == 'og:locale':
                edits.append(edit_attr(doc, el, 'content', OG_LOCALE[lang]))
        elif ev[0] == 'start' and ev[1].tag == 'link' and ev[1].attrs.get('rel') == 'canonical':
            edits.append(edit_attr(doc, ev[1], 'href', page_url(site, lang, slug)))
    doc = apply_edits(doc, edits)
    # JSON-LD
    out, pos = [], 0
    faq_sr, faq_lang = visible_faq(sr_doc), visible_faq(doc)
    for m in re.finditer(r'(<script\b[^>]*application/ld\+json[^>]*>)(.*?)(</script>)', doc, re.S):
        body = m.group(2)
        obj = json.loads(body)
        if faq_sr and len(faq_sr) == len(faq_lang):
            rep['faq'] = faq_from_visible(obj, faq_sr, faq_lang)
        new = translate_jsonld(obj, tr, lang, site, slug, missing, keep)
        pretty = '\n' in body.strip()
        lead = body[:len(body) - len(body.lstrip())]
        trail = body[len(body.rstrip()):]
        out.append(doc[pos:m.start(2)] + lead + jsonld_dump(new, pretty) + trail)
        pos = m.end(2)
    out.append(doc[pos:])
    doc = ''.join(out)
    # the site's own translations (consulted last by the engine) right after the engine
    i = doc.find(engine_marker)
    j = doc.find('</script>', i)
    if i < 0 or j < 0:
        raise ValueError('%s: i18n engine not found' % slug)
    j += len('</script>')
    doc = doc[:j] + '<script src="%s"></script>' % extra_src + doc[j:]
    return doc, rep


def extra_script(lang, entries):
    """JavaScript of the site's own translations: one push into BVQ under '<lang>x' (consulted after 'en2'/'en')."""
    pairs = []
    for k in sorted(entries):
        v = entries[k]
        if '§' in v:
            raise ValueError('a translation contains the separator §: %r' % v[:60])
        pairs.append(k + '§' + v)
    payload = json.dumps('§'.join(pairs), ensure_ascii=False).replace('</', '<\\/')
    return ('/* Evolako: translations the live dictionaries lack (site/i18n/%s.json), consulted by the i18n engine '
            'after its own; written by site/build.py */\n(window.BVQ=window.BVQ||[]).push(["%sx",%s]);\n'
            % (lang, lang, payload))


def load_i18n(i18n_dir, lang):
    """site/i18n/<lang>.json -> {key: translation}; checks that every key is hs(bk(nm(sr)))."""
    import os
    p = os.path.join(i18n_dir, lang + '.json')
    if not os.path.isfile(p):
        return {}, {}
    with open(p, encoding='utf-8') as f:
        data = json.load(f)
    out, src = {}, {}
    for k, e in (data.get('entries') or {}).items():
        if key_of(e['sr']) != k:
            raise ValueError('%s: key %s does not match its Serbian text %r (expected %s)' % (p, k, e['sr'][:60],
                                                                                           key_of(e['sr'])))
        if not e.get(lang):
            raise ValueError('%s: %s has no %s text' % (p, k, lang))
        out[k] = e[lang]
        src[k] = e['sr']
    return out, src


def load_keep(i18n_dir):
    import os
    p = os.path.join(i18n_dir, 'keep.json')
    if not os.path.isfile(p):
        return {}
    with open(p, encoding='utf-8') as f:
        data = json.load(f)
    out = {}
    for k, e in (data.get('entries') or {}).items():
        if key_of(e['sr']) != k:
            raise ValueError('%s: key %s does not match %r' % (p, k, e['sr'][:60]))
        out[k] = e
    return out


# ------------------------------------------------------------------------------------------------ script patches
ENGINE_MARKER = '/* Evolako i18n v3 (12.10.2026)'
# The engine ("Evolako i18n v3") on every page, changed for real language URLs. Exact replacements; each must match
# exactly once in the engine, or the build stops (a new snapshot with a changed engine needs a look).
ENGINE_ROUTES = r"""
/* Own site (27.10.2026): /en/ and /ru/ are real pages. The page's language is the lang attribute the build gives
   the html element: en/ru pages are locked to it; Serbian pages show Latin or Cyrillic in place, English and Russian
   are the page's alternate links (hreflang) — navigation. A page without alternates (the 404) keeps the old in-place
   switching. EVO_PATH = the Serbian path of this page, for the scripts that look at the path. */
var PL=(document.documentElement.getAttribute('lang')||'sr').toLowerCase().slice(0,2),LK=PL==='en'||PL==='ru',AL={},HA=0;
(function(){var ls=document.querySelectorAll('link[rel="alternate"][hreflang]'),i;for(i=0;i<ls.length;i++){try{AL[ls[i].getAttribute('hreflang')]=new URL(ls[i].href).pathname;HA=1}catch(e){}}})();
var EP=location.pathname.replace(/^\/(?:en|ru)(?=\/|$)/,'')||'/';window.EVO_PATH=EP;
function fam(l){return l==='cy'?'sr':l}
function pu(l){var p=AL[fam(l)]||(fam(l)==='sr'?AL['x-default']:null);return p?(l==='cy'?p+'?lang=sr-cyrl':p):null}
function jn(u,s){return s?u+(u.indexOf('?')<0?'?':'&')+s.replace(/^[?&]/,''):u}
function sv(l){try{localStorage.setItem('bvl',l)}catch(e){}}
function rp(){var r=document.referrer;if(!r)return null;try{var u=new URL(r);return u.origin===location.origin?u.pathname:null}catch(e){return null}}
function nt(){try{var n=performance.getEntriesByType('navigation')[0];if(n)return n.type==='navigate'}catch(e){}try{return performance.navigation.type===0}catch(e){}return true}
function sw(l){return HA&&fam(l)!==PL?pu(l):null}
function lh(r){if(!HA)return;var a=r.querySelectorAll('.evo-lang__opt[data-l],.v3-lang a'),i,l,u;for(i=0;i<a.length;i++){l=nl((a[i].getAttribute('data-l')||a[i].textContent).trim().toLowerCase());u=l&&pu(l);if(!u)continue;a[i].setAttribute('hreflang',l==='cy'?'sr-Cyrl':l);if(a[i].getAttribute('href')!==u)a[i].setAttribute('href',u)}}
function ln(h){var m=/^(https?:\/\/(?:www\.)?evolako\.rs)?(\/[^?#]*)([?#][\s\S]*)?$/.exec(h),p;if(!m)return null;p=m[2];if(p!=='/'&&!/^\/[a-z0-9-]+$/.test(p)||/^\/(?:en|ru)$/.test(p))return null;return(m[1]||'')+'/'+L+(p==='/'?'/':p)+(m[3]||'')}
function lnk(e){if(!LK||e.nodeName!=='A'||e.hasAttribute('hreflang'))return;var h=e.getAttribute('href'),n=h&&ln(h);if(n&&n!==h)e.setAttribute('href',n)}"""

ENGINE_PATCHES = [
    ('routing helpers', """var NOX='[data-no-i18n],[class*="logo"],.v3-word,.fx-switch';""",
     """var NOX='[data-no-i18n],[class*="logo"],.v3-word,.fx-switch';""" + ENGINE_ROUTES),
    ('own translations, consulted last', " if(d){v=d[h];if(v!==undefined)return bf(v)}\n return null}",
     " if(d){v=d[h];if(v!==undefined)return bf(v)}\n d=D[L+'x'];if(d){v=d[h];if(v!==undefined)return bf(v)}\n"
     " return null}"),
    ('links added at runtime on en/ru pages', "function ea(e){\n var m=AT.get(e)",
     "function ea(e){\n lnk(e);var m=AT.get(e)"),
    ('footer menu links', "w.innerHTML=MN;", "w.innerHTML=MN;lh(w);"),
    ('page dictionaries by the Serbian path', "var pg=MAP[location.pathname.replace(/\\/+$/,'')||'/'];",
     "var pg=MAP[EP.replace(/\\/+$/,'')||'/'];"),
    ('switching: navigation between language versions',
     "function set(l){l=nl(l);if(!l||l===L){cl();return}L=l;try{localStorage.setItem('bvl',l)}catch(e){}"
     "document.documentElement.lang=HL[l];need(l);ap();cl()}",
     "function set(l){l=nl(l);if(!l){cl();return}var u=sw(l);if(u){sv(l);cl();location.href=u;return}"
     "if(l===L){cl();return}L=l;sv(l);document.documentElement.lang=HL[l];need(l);ap();cl()}"),
    ('language of the page on load',
     "var q=nl((location.search.match(/[?&]lang=(sr-cyrl|sr-latn|cyr|cy|sr|en|ru)(?=&|#|$)/i)||[])[1]),st=null;\n"
     "try{st=localStorage.getItem('bvl')}catch(e){}\n"
     "L=q||nl(st)||'sr';\n"
     "if(q){try{localStorage.setItem('bvl',L)}catch(e){}\n"
     "try{history.replaceState(null,'',location.pathname+location.search.replace(/([?&])lang=[a-z-]{2,7}&?/i,'$1')"
     ".replace(/[?&]$/,'')+location.hash)}catch(e){}}\n",
     "var q=nl((location.search.match(/[?&]lang=(sr-cyrl|sr-latn|cyr|cy|sr|en|ru)(?=&|#|$)/i)||[])[1]),st=null,"
     "go=null,rf;\n"
     "try{st=nl(localStorage.getItem('bvl'))}catch(e){}\n"
     "var QS=location.search.replace(/([?&])lang=[a-z-]{2,7}&?/i,'$1').replace(/[?&]$/,'');\n"
     "if(!HA){L=q||st||'sr';if(q)sv(L)}\n"
     "else if(LK){L=PL;if(q&&fam(q)!==PL)go=pu(q);else sv(L)}\n"
     "else if(q==='en'||q==='ru'){L='sr';go=pu(q)}\n"
     "else if(q){L=q;sv(L)}\n"
     "else{rf=rp();\n"
     " if(rf!==null&&/^\\/(?:en|ru)(?:\\/|$)/.test(rf)&&nt()){L='sr';if(st!=='sr')sv('sr')}\n"
     " else if((st==='en'||st==='ru')&&rf===null&&nt()){L='sr';go=pu(st)}\n"
     " else L=st==='cy'?'cy':'sr'}\n"
     "if(go){try{location.replace(jn(go,QS)+location.hash)}catch(e){}}\n"
     "else if(q){try{history.replaceState(null,'',location.pathname+QS+location.hash)}catch(e){}}\n"),
    ('links whose href changes on en/ru pages',
     "else if(m.type==='attributes'){var e=m.target,an=m.attributeName,x=AT.get(e),cv=e.getAttribute(an);",
     "else if(m.type==='attributes'){var e=m.target,an=m.attributeName;if(an==='href'){lnk(e);continue}"
     "var x=AT.get(e),cv=e.getAttribute(an);"),
    ('observe href on en/ru pages', "attributeFilter:['placeholder','aria-label','alt','title','value','data-wait']});",
     "attributeFilter:['placeholder','aria-label','alt','title','value','data-wait'].concat(LK?['href']:[])});"),
    ('menu clicks with a modifier open the link',
     "if(!a)return;e.preventDefault();set((a.getAttribute('data-l')||a.textContent).trim().toLowerCase())},true);",
     "if(!a)return;if(e.ctrlKey||e.metaKey||e.shiftKey||e.altKey||e.button)return;e.preventDefault();"
     "set((a.getAttribute('data-l')||a.textContent).trim().toLowerCase())},true);"),
]

EP_JS = '(window.EVO_PATH||location.pathname)'
# Other scripts that read the path: they keep seeing the Serbian path on /en/ and /ru/ pages (same values as today:
# dictionaries by page, the form field Stranica, the career form's page, the counter, the lead event, the building
# share link). history.replaceState keeps the real path. The career "copy link" copies the clean URL of the page in
# its language (it used to add ?lang=xx to the Serbian URL).
INLINE_PATCHES = [
    # (name, regex, replacement function, minimum total count over all pages)
    ('i18n loader: page files by the Serbian path', re.escape("var p=location.pathname.replace(/^\\/+|\\/+$/g,'')"),
     lambda m: "var p=" + EP_JS + ".replace(/^\\/+|\\/+$/g,'')", 37),
    ('B2B widgets: Stranica = the Serbian path', r'\b([A-Za-z_$][\w$]*)\.Stranica\.value=location\.pathname',
     lambda m: m.group(1) + '.Stranica.value=' + EP_JS, 18),
    ('careers: in-page links of /karijera', re.escape("location.pathname.replace(/\\/$/,'')==='/karijera'"),
     lambda m: EP_JS + ".replace(/\\/$/,'')==='/karijera'", 4),
    ('careers: copy link = the page in its language',
     re.escape("var u=location.origin+location.pathname+(L()==='sr'?'':'?lang='+(L()==='cy'?'sr-cyrl':L()));"),
     lambda m: "var u=location.origin+location.pathname+(L()==='cy'?'?lang=sr-cyrl':'');", 4),
    ('careers: form field page', re.escape('page:location.pathname'), lambda m: 'page:' + EP_JS, 4),
    ('careers: in-page links also as /en/ and /ru/ links', re.escape('.kr a[href^="/karijera#"]\''),
     lambda m: '.kr a[href^="/karijera#"],.kr a[href^="/en/karijera#"],.kr a[href^="/ru/karijera#"]\'', 4),
    # the paragraph with the not yet filled legal data stays hidden on /en/ pages, where its text is the English one,
    # and in Cyrillic, where the engine has transliterated it before the hiding script runs (the live site shows
    # "[ПРАВНИ-ПОДАЦИ: …]" on a page opened in Cyrillic, but not after switching to Cyrillic on the page)
    ('legal-data placeholder hidden in English and Cyrillic too', re.escape(r"if(/\[PRAVNI|000 00 00/.test(p.textContent))"),
     lambda m: r"if(/\[PRAVNI|\[LEGAL-DATA|\[ПРАВНИ|000 00 00/.test(p.textContent))", 37),
]
FILE_PATCHES = [
    # (file name, old, new) — exactly once in that file
    ('evoformpack3-1.0.0.js', "var p=location.pathname.replace(/\\/+$/,'')||'/';",
     "var p=" + EP_JS + ".replace(/\\/+$/,'')||'/';"),
    ('evoappnav2809c-1.0.0.js', "/^\\/kontakt\\/?$/.test(location.pathname)",
     "/^\\/kontakt\\/?$/.test(" + EP_JS + ")"),
    ('evocounter0710-1.0.2.js', "p:L.pathname", "p:(window.EVO_PATH||L.pathname)"),
    ('evoleads1210-1.0.0.js', "page_path:location.pathname", "page_path:" + EP_JS),
    ('evosharezgrade3009-1.0.0.js', "u=location.origin+location.pathname", "u=location.origin+" + EP_JS),
    # scripts that find a footer link by its href: also the /en/ and /ru/ link (the "Karijera" and the cookie-settings
    # links are added next to it)
    # (never a language-menu link: those carry hreflang and also end in the page's path)
    ('evomedijakarijera2410-1.0.0.js', 'a[href="/medija-kit"]', 'a[href$="/medija-kit"]:not([hreflang])'),
    ('evomedijakarijera2410-1.0.0.js', 'a[href="/karijera"]', 'a[href$="/karijera"]:not([hreflang])'),
    ('evobanner1210-1.0.0.js', 'a[href="/politika-privatnosti"]', 'a[href$="/politika-privatnosti"]:not([hreflang])'),
]


def localize_css(doc, lang):
    """<style> rules that select a link by its Serbian href (the header hides two menu items at 992-1059 px) select
    the same link of an /en/ or /ru/ page."""
    n = [0]

    def style(m):
        def sel(s):
            n[0] += 1
            return 'a[href="/%s/%s"]' % (lang, s.group(1))
        return m.group(1) + re.sub(r'a\[href="/([a-z0-9-]+)"\]', sel, m.group(2)) + m.group(3)
    doc = re.sub(r'(<style\b[^>]*>)(.*?)(</style>)', style, doc, flags=re.S)
    return doc, n[0]


def patch_engine(doc, where):
    """Apply ENGINE_PATCHES to the engine script of a page. Returns (doc, number of engines patched: 0 or 1)."""
    i = doc.find(ENGINE_MARKER)
    if i < 0:
        return doc, 0
    s = doc.rfind('<script', 0, i)
    e = doc.find('</script>', i)
    body = doc[doc.find('>', s) + 1:e]
    for name, old, new in ENGINE_PATCHES:
        c = body.count(old)
        if c != 1:
            raise ValueError('%s: engine patch "%s" matches %d times (expected once)' % (where, name, c))
        body = body.replace(old, new)
    return doc[:doc.find('>', s) + 1] + body + doc[e:], 1


def patch_inline(doc, counts):
    for name, rx, fn, _ in INLINE_PATCHES:
        doc, n = re.subn(rx, fn, doc)
        counts[name] = counts.get(name, 0) + n
    return doc


# ------------------------------------------------------------------------------------------------ Serbian left?
SR_DIACRITICS = re.compile(r'[čćđšžČĆĐŠŽ]')
# Serbian function and core words that are not also English words
SR_WORDS = set('je se da od sa ili ako kao koji koja koje što nije su smo ste ovo kada kad gde jer ali već još samo '
               'sve bez pre posle iz kod uz prema između na za u mesto mesta punjač punjača punjenje zgrada zgrade '
               'cena cene ugradnja ugradnje brojilo brojila struja struje garaža garaže tvoj tvoja tvoje naš naša '
               'naše vaš vaša mesec meseci godina dana sati može mogu treba nema ima imaš'.split())
# texts that are the same in every language: numbers, prices, units, codes
NEUTRAL = re.compile(r'^(?:[\d\s.,:;%/×x+\-–—()·•|#№°*=<>…→←↑↓✓✔€$\'"’≈~]|RSD|EUR|USD|kWh?|kVA|km|MWh|Wh|[AVWh]|'
                     r'min|cm|mm|m²|m|mA|Hz|DC|AC|EV|MID|OCPP|PDV|VAT|ID|[0-9A-F]{6})*$')


def looks_neutral(text):
    t = nm(text)
    return (not re.search(r'[A-Za-zÀ-žА-яЁё]', t) or bool(NEUTRAL.match(t)) or
            bool(re.fullmatch(r'\S+@\S+\.\S+|https?://\S*|www\.\S+|[a-z0-9.-]+\.(?:rs|com)', t)))


def looks_serbian(text):
    """A lowercase word with Serbian letters (capitalized words with them are names and places: Niš, Vila Đokić), or
    at least two Serbian words among three or more (all-caps package names such as ZGRADA do not count)."""
    t = nm(text)
    # Serbian terms quoted in another language — (matični broj), «Službeni glasnik» — are meant to stay
    t = re.sub(r'\([^()]*\)|«[^«»]*»|“[^“”]*”|„[^„“”]*[“”]|"[^"]*"', ' ', t)
    words = re.findall(r'[A-Za-zčćđšžČĆĐŠŽ]+', t)
    if any(SR_DIACRITICS.search(w) and w[0].islower() for w in words):
        return True
    return len(words) >= 3 and sum(1 for w in words if w.lower() in SR_WORDS and not w.isupper()) >= 2


# ------------------------------------------------------------------------------------------------ FAQ
def visible_faq(doc):
    """[(question, answer)] of the <details><summary> blocks of a page, as the browser's textContent gives them
    (whitespace normalized)."""
    out = []
    for m in re.finditer(r'<details\b[^>]*>(.*?)</details>', doc, re.S):
        d = m.group(1)
        s = re.search(r'<summary\b[^>]*>(.*?)</summary>', d, re.S)
        if not s:
            continue
        q = nm(html.unescape(re.sub(r'<[^>]+>', '', s.group(1))))
        a = nm(html.unescape(re.sub(r'<[^>]+>', '', d[:s.start()] + d[s.end():])))
        out.append((q, a))
    return out


class Final(str):
    """A JSON-LD string that is already in the page's language (translate_jsonld leaves it)."""


def faq_from_visible(obj, faq_sr, faq_lang):
    """FAQPage questions of a page in another language: each structured question is matched to the visible Serbian
    <details> it stands for (question and answer similarity), and gets that block's visible text in the page's
    language — so the structured data equals what the page shows. Returns [(structured question, matched visible
    question, question similarity, answer similarity)]."""
    import difflib
    log = []
    for node in _jsonld_nodes(obj):
        if node.get('@type') != 'FAQPage':
            continue
        for qn in node.get('mainEntity') or []:
            q = nm(qn.get('name') or '')
            a = nm(((qn.get('acceptedAnswer') or {}).get('text')) or '')

            def score(i):
                vq, va = faq_sr[i]
                return (difflib.SequenceMatcher(None, q, vq).ratio() * 0.5 +
                        difflib.SequenceMatcher(None, a, va).ratio() * 0.5)
            ranked = sorted(range(len(faq_sr)), key=score, reverse=True)
            best = ranked[0]
            if score(best) < 0.4 or (len(ranked) > 1 and score(best) - score(ranked[1]) < 0.05):
                raise ValueError('FAQPage question %r matches no visible question clearly' % q[:60])
            log.append((q, faq_sr[best][0], round(difflib.SequenceMatcher(None, q, faq_sr[best][0]).ratio(), 2),
                        round(difflib.SequenceMatcher(None, a, faq_sr[best][1]).ratio(), 2)))
            qn['name'] = Final(faq_lang[best][0])
            qn.setdefault('acceptedAnswer', {'@type': 'Answer'})['text'] = Final(faq_lang[best][1])
    return log


def faq_sr_from_visible(doc):
    """The Serbian page's own FAQPage, the same way: each structured question takes the visible text of the Serbian
    <details> block it stands for (on the live site the embed's wording differs from the page in some questions).
    Returns (doc, [(structured question, matched visible question, question similarity, answer similarity)])."""
    faq = visible_faq(doc)
    if not faq:
        return doc, []
    out, pos, log = [], 0, []
    for m in re.finditer(r'(<script\b[^>]*application/ld\+json[^>]*>)(.*?)(</script>)', doc, re.S):
        body = m.group(2)
        obj = json.loads(body)
        if not any(n.get('@type') == 'FAQPage' for n in _jsonld_nodes(obj)):
            continue
        log += faq_from_visible(obj, faq, faq)
        pretty = '\n' in body.strip()
        lead = body[:len(body) - len(body.lstrip())]
        trail = body[len(body.rstrip()):]
        out.append(doc[pos:m.start(2)] + lead + jsonld_dump(obj, pretty) + trail)
        pos = m.end(2)
    out.append(doc[pos:])
    return ''.join(out), log


def _jsonld_nodes(x):
    if isinstance(x, dict):
        yield x
        for v in x.values():
            yield from _jsonld_nodes(v)
    elif isinstance(x, list):
        for v in x:
            yield from _jsonld_nodes(v)


# ------------------------------------------------------------------------------------------------ copy rules
# Words the Evolako copy never uses (project rules); checked on the site's own translations (the build stops) and
# reported for the live translations the prerendered pages show
BANNED = {
    'en': [r'\batest', r'discount', r'24\s*/\s*7', r'plug\s*&\s*charge', r'\bimmediately\b', r'\bpaperwork\b'],
    'ru': [r'атест', r'скидк', r'24\s*/\s*7', r'plug\s*&\s*charge', r'\bсразу\b', r'оформ\w*\s+документ',
           r'бер[её]м на себя'],
}
_NUM = re.compile(r'\d+(?:[.,]\d+)*')


def copy_problems(lang, sr, text):
    """Rule breaks in one translation: banned words, numbers of the Serbian text that are missing."""
    out = [('banned word', p) for p in BANNED[lang] if re.search(p, text, re.I)]
    have = set(_NUM.findall(text))
    for n in _NUM.findall(sr):
        if n not in have:
            out.append(('number missing', n))
    return out

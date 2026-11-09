"""Accessibility layer of the built pages (09.11.2026, owner's word «да, давай аудит и все остальные твои пункты»).

The pages come from the Webflow snapshot, so their markup has no landmarks, no skip link and no keyboard focus ring on
the form fields. This module adds, after the language pages are made and before the CSP and the files are written:

  * a «Preskoči na sadržaj» link as the first thing in <body> (visible only when focused by the keyboard), in the
    page's language;
  * role="main" and id="main" on the page wrapper (div.v2-page, one per page — the build stops if not), and names on
    the two <nav> landmarks (main menu, messengers in the footer);
  * a small <style id="evo-a11y">: a visible focus ring for every link, button and field, and colour fixes for the
    texts the axe audit found under 4.5:1 (WCAG 2.2 AA, 1.4.3);
  * a link «Pristupačnost» in the footer's legal line, next to the privacy policy.

No inline script is added. One inline script line is changed (the language button's name); build.py computes the CSP
hashes after this step, so they match. Styles are 'unsafe-inline' already.
Check: scripts/qa/a11y_check.py in hemptoon/blokvolt-rs (axe-core; --site evolako --base <local server of site/dist>),
nightly on www.evolako.rs by the «Accessibility» workflow of blokvolt-rs (RUNBOOK 3.41 there).
"""
import re

SKIP = {'sr': 'Preskoči na sadržaj', 'en': 'Skip to content', 'ru': 'Перейти к содержанию'}
NAV_MAIN = {'sr': 'Glavni meni', 'en': 'Main menu', 'ru': 'Главное меню'}
NAV_MSG = {'sr': 'Poruke', 'en': 'Messages', 'ru': 'Сообщения'}
COPY_EMAIL = {'sr': 'hello@evolako.com — kopiraj adresu', 'en': 'hello@evolako.com — copy the address',
              'ru': 'hello@evolako.com — скопировать адрес'}
LINK = {'sr': ('/pristupacnost', 'Pristupačnost'), 'en': ('/en/pristupacnost', 'Accessibility'),
        'ru': ('/ru/pristupacnost', 'Доступность')}
PAGE_SLUG = 'pristupacnost'

CSS = (
    '<style id="evo-a11y">'
    '.evo-skip{position:absolute;left:12px;top:-60px;z-index:10000;padding:10px 16px;border-radius:10px;'
    'background:#0B1220;color:#fff!important;font:600 15px/1.2 Onest,system-ui,sans-serif;text-decoration:none}'
    '.evo-skip:focus{top:12px;outline:2px solid #2E6BFF;outline-offset:2px}'
    '#main:focus{outline:none}'
    # focus ring: Webflow resets it on fields and many buttons
    ':where(a,button,input,select,textarea,summary,label,[role=button],[role=menuitem],[tabindex]:not([tabindex="-1"]))'
    ':focus-visible{outline:2px solid #2E6BFF!important;outline-offset:2px!important}'
    ':where(input,select,textarea):focus-visible{box-shadow:0 0 0 4px rgba(46,107,255,.25)!important}'
    # contrast (axe 09.11.2026): every value below is >= 4.5:1 on its background
    '.v3-kktiles>div:nth-child(3)>div:first-child{color:#fff!important}'          # on #2E6BFF: 4.5
    '.v3-zt>div:last-child .evb-more{color:#8FB0FF!important}'                   # the dark card, on #0B1220: 8.8
    '.v3-legal{color:#5A6478!important}'                                          # on #F1F4F9: 5.6
    '.v3-legal a{color:inherit;text-decoration:underline;text-underline-offset:2px}'
    '.evn-item .evb-upd{color:#5A6478!important}'                                 # news dates (light page)
    '.evmk-lbl{color:#1D4FD0!important}'                                          # on #F1F4F9: 6.0
    '.evb2-nn{color:#4E79F0!important}'                                           # big step numbers: 3.6 (large text)
    '.v3-b2b p:last-child,.vg-meta,.vh-meta{color:#5A6478!important}'               # on #E3EBFF: 5.0
    '.evb-trans,.evb-opt,.evb2-docn{color:#5A6478!important}'                     # small notes: 5.6 / 6.3
    'a[style*="color:#2E6BFF"]{color:#1D4FD0!important;border-color:#1D4FD0!important}'
    '@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;'
    'animation-iteration-count:1!important;transition-duration:.01ms!important;scroll-behavior:auto!important}}'
    '</style>'
)


class A11yError(ValueError):
    pass


def _one(pattern, text, what, page):
    found = re.findall(pattern, text, re.I)
    if len(found) != 1:
        raise A11yError('%s: expected one %s, found %d' % (page, what, len(found)))
    return found[0]


def _add_attrs(tag, attrs):
    """Add attributes to an opening tag unless it already has them."""
    for k, v in attrs:
        if re.search(r'\s%s=' % re.escape(k), tag):
            if k == 'id':
                tag = re.sub(r'\sid="[^"]*"', ' id="%s"' % v, tag, count=1)
            continue
        tag = tag[:-1] + ' %s="%s">' % (k, v)
    return tag


def apply(text, lang, page):
    """Return the page with the accessibility layer. lang: 'sr', 'en' or 'ru'."""
    if 'id="evo-a11y"' in text:
        raise A11yError('%s: the accessibility layer is already there' % page)
    # 1. style before </head>
    if text.count('</head>') != 1:
        raise A11yError('%s: expected one </head>' % page)
    text = text.replace('</head>', CSS + '</head>', 1)
    # 2. skip link right after <body>
    body = _one(r'<body\b[^>]*>', text, '<body>', page)
    text = text.replace(body, body + '<a class="evo-skip" href="#main">%s</a>' % SKIP[lang], 1)
    # 3. main landmark on the page wrapper
    wrap = _one(r'<div\b[^>]*\bclass="v2-page(?:\s[^"]*)?"[^>]*>', text, 'div.v2-page', page)
    text = text.replace(wrap, _add_attrs(wrap, [('id', 'main'), ('role', 'main'), ('tabindex', '-1')]), 1)
    # 4. names of the navigation landmarks
    nav = _one(r'<nav\b[^>]*\bclass="mega-nav"[^>]*>', text, 'nav.mega-nav', page)
    text = text.replace(nav, _add_attrs(nav, [('aria-label', NAV_MAIN[lang])]), 1)
    for m in set(re.findall(r'<nav\b[^>]*\bclass="v3-fmsgs"[^>]*>', text)):
        text = text.replace(m, _add_attrs(m, [('aria-label', NAV_MSG[lang])]))
    # 5. the copy-e-mail button: its name must contain what it shows (WCAG 2.5.3)
    text = re.sub(r'(<a\b[^>]*\bclass="copy-email-button"[^>]*\baria-label=")[^"]*(")|'
                  r'(<a\b[^>]*\baria-label=")[^"]*("[^>]*\bclass="copy-email-button")',
                  lambda m: (m.group(1) or m.group(3)) + COPY_EMAIL[lang] + (m.group(2) or m.group(4)), text)
    # 6. the language button: its name = what it shows + «Jezik» (WCAG 2.5.3). The inline script sets it at run time;
    #    the CSP hashes are computed after this step (build.py), so changing the script here is safe.
    old_js = "b.setAttribute('aria-label',JZ[L]+': '+NMS[L][1])"
    if old_js in text:
        text = text.replace(old_js, "b.setAttribute('aria-label',NMS[L][0]+' '+NMS[L][1]+' \u00b7 '+JZ[L])")
    # 7. /karijera: the job filter is a group of toggle buttons, not a tab list (ARIA 1.2: tablist needs tabs)
    text = text.replace('<div class="kr-filt" role="tablist">', '<div class="kr-filt" role="group">')
    # 8. «Pristupačnost» in the footer's legal line (after the privacy policy link when there is one)
    href, label = LINK[lang]
    legal = re.search(r'(<div\b[^>]*\bclass="v3-legal"[^>]*>)(.*?)(</div>)', text, re.S)
    if legal and page != PAGE_SLUG:
        inner = legal.group(2) + '<span data-evo-a11y=""> · <a href="%s">%s</a></span>' % (href, label)
        text = text[:legal.start()] + legal.group(1) + inner + legal.group(3) + text[legal.end():]
    return text

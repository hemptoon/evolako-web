#!/usr/bin/env python3
"""The two media-kit PDFs of www.evolako.rs (/medija-kit «Medija kit (PDF)»): A4, two pages, Serbian and English, made
from the texts of the built page itself (site/dist/medija-kit.html and site/dist/en/medija-kit.html), so the PDF says
what the page says. Layout of the Webflow-era generator (project doc claude/Evolako_Mediakit_Source_2026-09-29.md,
pdf.py of 10.10.2026), now fed by the page instead of a separate content.py.

  python3 site/tools/mediakit_pdf.py [--dist site/dist] [--out site/public]
      -> site/public/evolako-medija-kit-sr.pdf, site/public/evolako-medija-kit-en.pdf (the build copies site/public/*
         to the root of dist: https://www.evolako.rs/evolako-medija-kit-sr.pdf)

Order: build -> this script -> build again (the PDFs are committed files; the build only copies them).
Needs Playwright (Chromium), qpdf and the STATIC Onest fonts 400/700/800 (SIL OFL):
  npm pack @fontsource/onest && tar xzf fontsource-onest-*.tgz      # then ONEST_FILES=<dir>/package/files
Not the variable font: Chromium embeds a variable font as Type 3 glyph procedures, which PDF viewers draw slowly,
glyph by glyph; static weights are embedded as TrueType subsets. No transparency (solid colors only), and the file is
linearized with qpdf (fast web view). Checks: 2 pages each, only TrueType fonts, none of the banned words.
"""
import argparse
import html
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
SITE_DIR = HERE.parent
ASSETS = SITE_DIR / 'snapshot' / 'assets' / 'cdn.prod.website-files.com' / '6ab19bf9a3bb86f8fb7bba00'
LOGOS = {'logo': '6abb0e6f0cc361832998e89c_evolako-logo.svg',
         'dark': '6abb0e4201016e0e33e4f62c_evolako-logo-tamna-pozadina.svg',
         'mark': '6abb0e0aa56be930438598ab_evolako-znak.svg'}
WEIGHTS = (400, 700, 800)
RANGES = {
    'latin': 'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, '
             'U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    'latin-ext': 'U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, '
                 'U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF',
    'cyrillic': 'U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116',
    'cyrillic-ext': 'U+0460-052F, U+1C80-1C8A, U+20B4, U+2DE0-2DFF, U+A640-A69F, U+FE2E-FE2F',
}
# the site's copy rules, plus old prices and what the media kit must no longer say (VAT included, 48 h assessment)
BANNED = ['atest', 'popust', '24/7', 'plug&charge', 'odmah', 'скидк', 'paperwork', 'we handle', 'we prepare',
          'sa pdv', 'with vat', 'including vat', 'incl. vat', 'с ндс', '59.000', '125.000', '3.500', '3,500',
          'procena u roku od 48', 'assessment within 48']

CSS = """
@page { size: A4; margin: 13mm 14mm 13mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body { font-family: Onest, sans-serif; color: #0B1220; font-size: 9.6pt; line-height: 1.32;
       -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 7px;
       border-bottom: 1px solid #D9DFEA; margin-bottom: 10px; }
.top svg { height: 19px; width: auto; display: block; }
.top span { font-size: 8.3pt; color: #5A6478; }
h1 { font-size: 23pt; font-weight: 800; letter-spacing: -0.03em; line-height: 1.05; margin: 0 0 4px; }
.lead { font-size: 10.3pt; color: #5A6478; margin: 0 0 6px; max-width: 165mm; }
h2 { font-size: 13pt; font-weight: 800; letter-spacing: -0.01em; margin: 11px 0 5px; break-after: avoid; }
.lbl { font-size: 7.4pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #2E6BFF;
       margin: 10px 0 2px; }
.lbl + h2 { margin-top: 0; }
.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.fact { background: #F1F4F9; border-radius: 10px; padding: 6px 10px 7px; break-inside: avoid; }
.fact b, .partner b { display: block; font-size: 9.6pt; margin-bottom: 1px; }
.fact span, .partner span { color: #3E4759; font-size: 8.45pt; }
.partners { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; }
.partner { break-inside: avoid; }
.note { font-size: 8.4pt; color: #5A6478; margin: 7px 0 0; }
.press { display: grid; grid-template-columns: 1fr; gap: 6px; }
.pr { border: 1px solid #D9DFEA; border-radius: 10px; padding: 7px 10px 8px; break-inside: avoid; }
.pr b { font-size: 9.6pt; }
.pr .k { font-size: 7.2pt; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: #5A6478;
         margin: 5px 0 1px; }
.pr p { margin: 0; font-size: 8.45pt; color: #1F2737; }
.logos { display: grid; grid-template-columns: 1.25fr 1.25fr 0.7fr; gap: 7px; align-items: stretch; }
.lg { border-radius: 10px; padding: 12px; display: flex; align-items: center; justify-content: center;
      min-height: 58px; border: 1px solid #D9DFEA; }
.lg.dark { background: #0B1220; border-color: #0B1220; }
.lg svg { height: 22px; width: auto; }
.lg.mark svg { height: 32px; }
.sw { display: flex; gap: 14px; margin-top: 8px; font-size: 8.4pt; color: #3E4759; flex-wrap: wrap; }
.sw i { display: inline-block; width: 11px; height: 11px; border-radius: 3px; vertical-align: -1px; margin-right: 5px;
        border: 1px solid #E2E3E4; }
.two { display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 18px; }
.contact { background: #0B1220; color: #fff; border-radius: 12px; padding: 12px 14px; break-inside: avoid; }
.contact .row { display: grid; grid-template-columns: 22mm 1fr; gap: 6px; padding: 3px 0; font-size: 9.1pt; }
.contact .row span:first-child { color: #9DA4B1; }
.contact .reg { font-size: 8pt; color: #9DA4B1; margin: 7px 0 0; }
.page2 { break-before: page; }
.foot { margin-top: 10px; font-size: 8pt; color: #5A6478; }
"""


def norm(s):
    return re.sub(r'\s+', ' ', s or '').strip()


def texts(page):
    """Everything the PDF prints, read from one built /medija-kit page (Serbian or English)."""
    soup = BeautifulSoup(page.read_text(encoding='utf-8'), 'html.parser')
    t = lambda el: norm(el.get_text(' ')) if el else ''

    def sec(sid):
        s = soup.find(id=sid)
        if s is None:
            raise SystemExit('%s: no section #%s' % (page, sid))
        return s
    ph = soup.select_one('.v3-ph')
    f, x, lg, pa, k = sec('ukratko'), sec('tekstovi'), sec('logo'), sec('saradnja'), sec('kontakt-za-medije')
    cards = lambda s: [(t(c.select_one('.evmk-t')), t(c.select_one('.evmk-tx'))) for c in s.select('.evmk-card')]
    press = {}
    for c in x.select('.evmk-card'):
        ps = c.select('p.evmk-tx[lang]')
        press[ps[0]['lang']] = (t(c.select_one('.evmk-t')), t(ps[0]), t(ps[1]))
    subs = [t(e) for e in x.select('.evmk-sub')]
    notes = lambda s: [t(e) for e in s.select('.evmk-note')]
    out = {
        'kick': t(ph.select_one('.v3-kick')), 'h1': t(ph.select_one('h1')), 'lead': t(ph.select_one('p')),
        'f_lbl': t(f.select_one('.evmk-lbl')), 'f_h2': t(f.select_one('.evmk-h2')), 'facts': cards(f),
        't_lbl': t(x.select_one('.evmk-lbl')), 't_h2': t(x.select_one('.evmk-h2')), 't_p': t(x.select_one('.evmk-p')),
        'short': subs[0], 'long': subs[1], 'press': press,
        'l_lbl': t(lg.select_one('.evmk-lbl')), 'l_h2': t(lg.select_one('.evmk-h2')),
        'swatches': [(t(s.select_one('.evmk-swt')), t(s.select_one('.evmk-swv'))) for s in lg.select('.evmk-sw')],
        'logo_notes': notes(lg),
        'p_lbl': t(pa.select_one('.evmk-lbl')), 'p_h2': t(pa.select_one('.evmk-h2')), 'partners': cards(pa),
        'p_note': notes(pa)[0],
        'k_lbl': t(k.select_one('.evmk-lbl')), 'k_h2': t(k.select_one('.evmk-h2')),
        'contact': [(t(r.select_one('.evmk-k')), t(r.select_one('.evmk-v'))) for r in k.select('.evmk-row, .evmk-row-last')],
        'k_reg': notes(k)[0], 'stanje': notes(k)[-1],
    }
    if len(out['facts']) != 8 or len(out['press']) != 3 or len(out['partners']) < 4 or len(out['contact']) != 4:
        raise SystemExit('%s: unexpected page structure (facts %d, press %d, partners %d, contact %d)' % (
            page, len(out['facts']), len(out['press']), len(out['partners']), len(out['contact'])))
    return out


def svg(name):
    return (ASSETS / LOGOS[name]).read_text(encoding='utf-8').replace('<title>Evolako</title>', '')


def build_html(lang, d):
    e = lambda s: html.escape(s, quote=False)
    fonts = ''.join(
        "@font-face{font-family:Onest;font-style:normal;font-weight:%d;src:url('fonts/onest-%s-%d-normal.woff2') "
        "format('woff2');unicode-range:%s;}" % (w, sub, w, rng) for sub, rng in RANGES.items() for w in WEIGHTS)
    facts = ''.join('<div class="fact"><b>%s</b><span>%s</span></div>' % (e(a), e(b)) for a, b in d['facts'])
    partners = ''.join('<div class="partner"><b>%s</b><span>%s</span></div>' % (e(a), e(b)) for a, b in d['partners'])
    order = ['sr', 'en', 'ru'] if lang == 'sr' else ['en', 'sr', 'ru']
    press = ''.join('<div class="pr"><b>%s</b><div class="k">%s</div><p lang="%s">%s</p><div class="k">%s</div>'
                    '<p lang="%s">%s</p></div>' % (e(d['press'][k][0]), e(d['short']), k, e(d['press'][k][1]),
                                                   e(d['long']), k, e(d['press'][k][2])) for k in order)
    sw = ''.join('<span><i style="background:%s"></i>%s %s</span>' % (c, e(n), c) for n, c in d['swatches'])
    head = '<div class="top">%s<span>%s · www.evolako.rs · %s</span></div>' % (svg('logo'), e(d['kick']), e(d['stanje']))
    contact = ''.join('<div class="row"><span>%s</span><span>%s</span></div>' % (e(a), e(b)) for a, b in d['contact'])
    url = 'www.evolako.rs/medija-kit' if lang == 'sr' else 'www.evolako.rs/en/medija-kit'
    return ('<!doctype html><html lang="%s"><head><meta charset="utf-8"><title>Evolako — %s</title><style>%s%s</style>'
            '</head><body>\n%s\n<h1>%s</h1>\n<p class="lead">%s</p>\n<div class="lbl">%s</div><h2>%s</h2>\n'
            '<div class="facts">%s</div>\n<div class="lbl">%s</div><h2>%s</h2>\n<div class="partners">%s</div>\n'
            '<p class="note">%s</p>\n<div class="page2">\n%s\n<div class="lbl">%s</div><h2>%s</h2>\n'
            '<p class="note" style="margin:0 0 7px">%s</p>\n<div class="press">%s</div>\n<div class="two">\n<div>\n'
            '<div class="lbl">%s</div><h2>%s</h2>\n<div class="logos"><div class="lg">%s</div><div class="lg dark">%s'
            '</div><div class="lg mark">%s</div></div>\n<div class="sw">%s</div>\n<p class="note">%s</p>\n</div>\n'
            '<div>\n<div class="lbl">%s</div><h2>%s</h2>\n<div class="contact">%s<p class="reg">%s</p></div>\n'
            '<p class="foot">%s</p>\n</div>\n</div>\n</div>\n</body></html>') % (
        'sr-Latn' if lang == 'sr' else 'en', e(d['kick']), fonts, CSS, head, e(d['h1']), e(d['lead']), e(d['f_lbl']),
        e(d['f_h2']), facts, e(d['p_lbl']), e(d['p_h2']), partners, e(d['p_note']), head, e(d['t_lbl']), e(d['t_h2']),
        e(d['t_p']), press, e(d['l_lbl']), e(d['l_h2']), svg('logo'), svg('dark'), svg('mark'), sw,
        e(' '.join(d['logo_notes'])), e(d['k_lbl']), e(d['k_h2']), contact, e(d['k_reg']), e(url))


def check(pdf):
    """2 pages, only TrueType fonts (no Type 3), none of the banned words."""
    pages = int(subprocess.run(['qpdf', '--show-npages', str(pdf)], capture_output=True, text=True, check=True).stdout)
    fonts = subprocess.run(['pdffonts', str(pdf)], capture_output=True, text=True, check=True).stdout.splitlines()[2:]
    types = {' '.join(l.split()[1:-5]) for l in fonts}
    text = subprocess.run(['pdftotext', '-layout', str(pdf), '-'], capture_output=True, text=True, check=True).stdout
    flat = norm(text).lower()
    bad = [w for w in BANNED if w in flat]
    problems = (['%d pages, expected 2' % pages] if pages != 2 else []) + \
        (['fonts other than TrueType: %s' % sorted(types)] if not all('TrueType' in x for x in types) else []) + \
        (['banned: %s' % bad] if bad else [])
    return pages, sorted(types), problems


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dist', default=str(SITE_DIR / 'dist'))
    ap.add_argument('--out', default=str(SITE_DIR / 'public'))
    a = ap.parse_args()
    fonts = Path(os.environ.get('ONEST_FILES', ''))
    need = ['onest-%s-%d-normal.woff2' % (s, w) for s in RANGES for w in WEIGHTS]
    if not all((fonts / n).is_file() for n in need):
        raise SystemExit('set ONEST_FILES to the files/ folder of the static @fontsource/onest package (see --help)')
    data = {'sr': texts(Path(a.dist) / 'medija-kit.html'), 'en': texts(Path(a.dist) / 'en' / 'medija-kit.html')}
    ok = True
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as p:
        tmp = Path(tmp)
        (tmp / 'fonts').mkdir()
        for n in need:
            shutil.copy(fonts / n, tmp / 'fonts')
        b = p.chromium.launch()
        for lang in ('sr', 'en'):
            f = tmp / ('mk-%s.html' % lang)
            f.write_text(build_html(lang, data[lang]), encoding='utf-8')
            pg = b.new_page()
            pg.goto(f.as_uri(), wait_until='networkidle')
            pg.evaluate('document.fonts.ready')
            raw = tmp / ('raw-%s.pdf' % lang)
            pg.pdf(path=str(raw), format='A4', print_background=True, prefer_css_page_size=True)
            pg.close()
            out = Path(a.out) / ('evolako-medija-kit-%s.pdf' % lang)
            subprocess.run(['qpdf', '--linearize', '--object-streams=generate', str(raw), str(out)], check=True)
            pages, types, problems = check(out)
            ok &= not problems
            print('%s: %d KB, %d pages, fonts %s%s' % (out.name, out.stat().st_size // 1024, pages, ', '.join(types),
                                                       ' — ' + '; '.join(problems) if problems else ''))
        b.close()
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())

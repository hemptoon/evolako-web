#!/usr/bin/env python3
"""End-to-end test of the forms of the built www.evolako.rs — local only: nothing reaches the real bot or webflow.com.

Starts, with wrangler (WRANGLER=<path to a wrangler binary>, default `npx --yes wrangler@4.151.0`, the version
deploy.yml pins):
  * site/tools/fake_bot/worker.js as the worker "evolako-bot-qa-stub" — stands in for the CRM bot and records what it
    gets on POST /wf/<HOOK>
  * `wrangler pages dev dist` in site/ (so site/functions runs: the noindex middleware and the form endpoint
    /f/<site>), service binding BOT -> the stub, HOOK = a fake value, FORMS_ALLOW_PREVIEW=1 (local origin)
Then, in Chromium, for each scenario: open the page of the built site, fill realistic values like a visitor (quiz
steps, chips, calculator), wait the 5 s the validation script asks for, click the visible submit button, wait for the
success block, and read the JSON the stub received. The same steps run on the original Webflow page replayed from the
snapshot, where Turnstile is stubbed and the POST to webflow.com is caught in the browser and answered {"code":200}
(never sent). Checks:
  * one POST https://evolako-bot.internal/wf/<HOOK> per send, body {"triggerType":"form_submission","payload":
    {"siteId","id","name","data","submittedAt","source"}} with the site id, a 24-hex id, an ISO time, "evolako.rs"
  * name = the form's data-name, data = exactly the fields webflow.js sent to Webflow from the original page (same
    names, values and order; only the honeypot field is gone; the Kontakt form also sends the hidden Jezik the build
    adds, last) and the expected values of each scenario
  * the success block is shown and the form hidden; /prijavi-zgradu also shows the invite/share links
  * the home calculator form never sends anything; an invalid referral code blocks the send; a filled honeypot gets
    the success block but nothing reaches the bot; without FORMS_ALLOW_PREVIEW the local origin is refused (failure
    block, nothing sent)
Usage: python3 site/tools/forms_e2e.py [--only kontakt,kviz,...] [--json report.json]
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
SITE_DIR = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import qa_dist  # noqa: E402

SITE_ID = '6ab19bf9a3bb86f8fb7bba00'
HOOK = 'local-test-hook-not-a-secret'           # fake; the real secret lives only in the Pages project settings
STUB = 'evolako-bot-qa-stub'
BOT_URL = 'https://evolako-bot.internal/wf/' + HOOK
HONEYPOT = 'website'
VIEWPORT = {'width': 1440, 'height': 900}

PERSON = {'Ime': 'Marko Petrović', 'Telefon': '+381 64 123 4567', 'Email': 'marko.petrovic@example.com'}
B2B = {'Ime': 'Jelena Marković', 'Firma': 'Hotel Dunav d.o.o.', 'Telefon': '+381 21 555 0101', 'Grad': 'Novi Sad',
       'Email': 'jelena@hoteldunav.example', 'Broj mesta': '8',
       'Poruka': 'Zanima nas punjenje za goste hotela, garaža ispod zgrade.'}


def quiz(*opts):
    steps = [('click', '#kv-start')]
    for q, v in opts:
        steps.append(('click', '.v3-kvopt[data-q="%s"][data-val="%s"]' % (q, v)))
    return steps


def b2b(page, mode='sr', extra_steps=(), expect=None, chips=None):
    steps = list(extra_steps) + [('fill', 'form[data-name="B2B upit"] [name="%s"]' % k, v) for k, v in B2B.items()]
    if chips:
        steps.insert(0, ('click', 'form[data-name="B2B upit"] .evb-chip[data-v="%s"]' % chips))
    steps.append(('check', 'form[data-name="B2B upit"] [name="Saglasnost"]'))
    exp = {'Tip': 'b2b', 'Stranica': '/' + page, 'Jezik': mode}
    exp.update(expect or {})
    return {'id': 'b2b-' + page + ('' if mode == 'sr' else '-' + mode), 'path': '/' + page, 'mode': mode,
            'form': 'B2B upit', 'steps': steps, 'expect': exp}


SEGMENTS = {'punjaci-za-auto-salone': 'salon', 'punjaci-za-hotele': 'hotel', 'punjaci-za-novogradnju': 'novogradnja',
            'punjaci-za-parking-garaze': 'garaza', 'punjaci-za-parkinge': 'garaza',
            'punjaci-za-sluzbena-vozila': 'flota', 'punjaci-za-stambene-zgrade': 'zgrada'}

SCENARIOS = [
    {'id': 'kontakt', 'path': '/kontakt?paket=wallbox', 'form': 'Kontakt',
     'steps': [('fill', '#email-form [name="%s"]' % k, v) for k, v in PERSON.items()] +
              [('fill', '#email-form [name="Grad"]', 'Novi Sad'), ('check', '#email-form [name="Saglasnost"]')],
     'expect': {'Paket': 'wallbox', 'Ime': 'Marko Petrović', 'Grad': 'Novi Sad', 'Saglasnost': 'true'},
     'added': {'Jezik': 'sr'}},
    {'id': 'kviz', 'path': '/proveri-svoju-garazu', 'form': 'Kviz prijava',
     'steps': quiz(('tip', 'svoja'), ('grad', 'novisad'), ('struja', 'blizu')) +
              [('fill', '#email-form [name="%s"]' % k, v) for k, v in PERSON.items()] +
              [('check', '#email-form [name="Pismo"]'), ('check', '#email-form [name="Saglasnost"]')],
     'expect': {'Kviz tip': 'svoja', 'Kviz grad': 'novisad', 'Kviz struja': 'blizu', 'Preporuka': 'wallbox',
                'Jezik': 'sr', 'Pismo': 'true', 'Saglasnost': 'true'}},
    {'id': 'kviz-adresa', 'path': '/proveri-svoju-garazu', 'form': 'Kviz prijava',
     'steps': quiz(('tip', 'bezmesta'), ('parking', 'dvoriste'), ('grad', 'beograd')) +
              [('fill', '#email-form [name="%s"]' % k, v) for k, v in PERSON.items()] +
              [('fill', '#email-form [name="Adresa"]', 'Bulevar oslobođenja 10'),
               ('check', '#email-form [name="Saglasnost"]')],
     'expect': {'Kviz tip': 'dvoriste', 'Kviz grad': 'beograd', 'Kviz struja': '', 'Preporuka': 'zgrada',
                'Adresa': 'Bulevar oslobođenja 10', 'Pismo': 'false'}},
    {'id': 'preporuka', 'path': '/preporuka?ref=EVO-7K2QX', 'form': 'Preporuka prijava',
     'steps': quiz(('tip', 'zajednicka'), ('grad', 'beograd'), ('struja', 'dalje')) +
              [('fill', '#preporuka-form [name="%s"]' % k, v) for k, v in PERSON.items()] +
              [('check', '#preporuka-form [name="Saglasnost"]')],
     'expect': {'Kod preporuke': 'EVO-7K2QX', 'Kviz tip': 'zajednicka', 'Kviz grad': 'beograd',
                'Kviz struja': 'dalje', 'Jezik': 'sr'}},
    {'id': 'zgrada', 'path': '/prijavi-zgradu', 'form': 'Prijava zgrade',
     'steps': [('fill', '#email-form [name="Ulica"]', 'Bulevar oslobođenja'), ('fill', '#email-form [name="Broj"]', '10'),
               ('fill', '#email-form [name="Grad"]', 'Novi Sad'),
               ('fill', '#email-form [name="Ulaz ili stan"]', 'ulaz 2, stan 14'),
               ('click', '#evb-sg-chips [data-q="0"][data-v="Podzemna garaža"]'),
               ('click', '#evb-sg-chips [data-q="1"][data-v="15–30"]'),
               ('click', '#evb-sg-chips [data-q="2"][data-v="Vlasnik stana"]'),
               ('click', '#evb-sg-chips [data-q="3"][data-v="Imam električni auto"]')] +
              [('fill', '#email-form [name="%s"]' % k, v) for k, v in PERSON.items()] +
              [('check', '#email-form [name="Saglasnost"]')],
     'expect': {'Tip': 'zgrada', 'Jezik': 'sr', 'Stranica': '/prijavi-zgradu', 'Parking': 'Podzemna garaža',
                'Mesta u garazi': '15–30', 'Uloga': 'Vlasnik stana', 'Auto': 'Imam električni auto',
                'Ulica': 'Bulevar oslobođenja', 'Broj': '10', 'Ulaz ili stan': 'ulaz 2, stan 14'},
     'share': True},
    b2b('kalkulator-cene-punjaca', extra_steps=[
        ('click', '[data-k="seg"][data-v="hotel"]'), ('click', '[data-k="points"][data-d="1"]'),
        ('click', '[data-k="points"][data-d="1"]'), ('click', '[data-k="type"][data-v="wb"]'),
        ('click', '[data-k="loc"][data-v="in"]'), ('click', '[data-k="dist"][data-v="d30"]')],
        expect={'Segment': 'hotel', 'Kalk': '*', 'Kalkulator': '*'}),
    b2b('punjaci-za-firme', chips='flota', expect={'Segment': 'flota'}),
] + [b2b(p, expect={'Segment': s}) for p, s in sorted(SEGMENTS.items()) if p != 'punjaci-za-hotele'] + [
    b2b('punjaci-za-hotele', mode='ru', expect={'Segment': 'hotel'}),
]
# the /en/ and /ru/ pages (step 3): the built page at its own URL, the original page with ?lang= as the reference;
# Jezik = the page's language, Stranica stays the Serbian path (what the bot got from the original page)
SCENARIOS[-1].update(dist_path='/ru/punjaci-za-hotele')
SCENARIOS.append(dict(SCENARIOS[4], id='zgrada-en', mode='en', dist_path='/en/prijavi-zgradu',
                      expect=dict(SCENARIOS[4]['expect'], Jezik='en')))
SCENARIOS.append(dict(SCENARIOS[4], id='zgrada-ru', mode='ru', dist_path='/ru/prijavi-zgradu',
                      expect=dict(SCENARIOS[4]['expect'], Jezik='ru')))
SCENARIOS.append(dict(SCENARIOS[0], id='kontakt-en', mode='en', dist_path='/en/kontakt?paket=wallbox',
                      added={'Jezik': 'en'}))
SCENARIOS.append(dict(SCENARIOS[1], id='kviz-ru', mode='ru', dist_path='/ru/proveri-svoju-garazu',
                      expect=dict(SCENARIOS[1]['expect'], Jezik='ru')))
SCENARIOS.append(dict(b2b('punjaci-za-hotele', mode='en', expect={'Segment': 'hotel'}), id='b2b-punjaci-za-hotele-en',
                      dist_path='/en/punjaci-za-hotele'))
SCENARIOS.append(dict(SCENARIOS[3], id='preporuka-en', mode='en', dist_path='/en/preporuka?ref=EVO-7K2QX',
                      expect=dict(SCENARIOS[3]['expect'], Jezik='en')))


# ------------------------------------------------------------------------------------------------ processes
class Wrangler:
    def __init__(self, workdir):
        self.cmd = os.environ.get('WRANGLER', '').split() or ['npx', '--yes', 'wrangler@4.151.0']
        self.workdir = workdir
        self.procs = []
        self.env = dict(os.environ, XDG_CONFIG_HOME=os.path.join(workdir, 'xdg'), WRANGLER_SEND_METRICS='false')

    def start(self, args, cwd, log, port):
        f = open(os.path.join(self.workdir, log), 'w')
        p = subprocess.Popen(self.cmd + args, cwd=cwd, stdout=f, stderr=subprocess.STDOUT, env=self.env,
                             start_new_session=True)
        self.procs.append(p)
        for _ in range(120):
            try:
                urllib.request.urlopen('http://127.0.0.1:%d/__calls' % port if log.startswith('bot')
                                       else 'http://127.0.0.1:%d/' % port, timeout=2)
                return p
            except Exception:  # noqa: BLE001
                time.sleep(0.5)
            if p.poll() is not None:
                break
        raise SystemExit('wrangler did not start (%s): see %s' % (' '.join(args[:3]), os.path.join(self.workdir, log)))

    def stop(self, p):
        try:
            os.killpg(p.pid, signal.SIGTERM)
            p.wait(timeout=15)
        except Exception:  # noqa: BLE001
            try:
                os.killpg(p.pid, signal.SIGKILL)
            except Exception:  # noqa: BLE001
                pass
        if p in self.procs:
            self.procs.remove(p)

    def stop_all(self):
        for p in list(self.procs):
            self.stop(p)


def stub_calls(port):
    return json.load(urllib.request.urlopen('http://127.0.0.1:%d/__calls' % port, timeout=5))


def stub_reset(port):
    urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:%d/__reset' % port, data=b'', method='POST'),
                           timeout=5).read()


def free_port():
    import socket
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


# ------------------------------------------------------------------------------------------------ one send
def webflow_fields(body):
    """name and fields of a body webflow.js posted (the same decoding as the endpoint)."""
    name, fields = None, []
    for k, v in urllib.parse.parse_qsl(body, keep_blank_values=True):
        if k == 'name':
            name = v
        m = re.fullmatch(r'fields\[(.*)\]', k, re.S)
        if m:
            fields.append((urllib.parse.unquote(m.group(1)), v))
    return name, fields


def run(browser, base, sc, side, answers, ip=None, steps=None, submit=True, before_submit=None):
    """side: 'dist' (built site on wrangler) or 'reference' (original page, Webflow POST caught)."""
    ctx = browser.new_context(viewport=VIEWPORT, locale='sr-RS', service_workers='block',
                              extra_http_headers={'CF-Connecting-IP': ip} if ip else {})
    port = urllib.parse.urlsplit(base).port
    rec = {'posts': [], 'webflow': [], 'external_blocked': set(), 'console_errors': [], 'page_errors': []}

    def route(r):
        req = r.request
        u = urllib.parse.urlsplit(req.url)
        if u.hostname == '127.0.0.1' and u.port == port:
            if req.method == 'POST':
                rec['posts'].append({'url': req.url, 'body': req.post_data})
            return r.continue_()
        if u.hostname == 'webflow.com' and '/api/v1/form/' in u.path:
            rec['webflow'].append({'url': req.url, 'method': req.method, 'body': req.post_data})
            if req.method == 'OPTIONS':
                return r.fulfill(status=204, headers={'access-control-allow-origin': '*',
                                                      'access-control-allow-headers': '*',
                                                      'access-control-allow-methods': 'POST'})
            return r.fulfill(status=200, body='{"code":200,"msg":"ok"}', headers={
                'content-type': 'application/json', 'access-control-allow-origin': '*'})
        if qa_dist.TURNSTILE_API in req.url and side == 'reference':
            return r.fulfill(status=200, body=qa_dist.TURNSTILE_STUB, headers={'content-type': 'application/javascript'})
        if u.hostname == 'app.evolako.rs' and u.path == '/zgrada/broj':
            return r.fulfill(status=200, body='{"count":2}', headers={'content-type': 'application/json',
                                                                      'access-control-allow-origin': '*'})
        hit = answers.get(qa_dist.url_key(req.url))
        if hit and req.method == 'GET':
            return r.fulfill(status=200, body=hit[0], headers={'content-type': hit[1],
                                                               'access-control-allow-origin': '*'})
        rec['external_blocked'].add(u.hostname)
        return r.abort('blockedbyclient')

    ctx.route('**/*', route)
    page = ctx.new_page()
    page.on('pageerror', lambda e: rec['page_errors'].append(str(e)[:200]))
    page.on('console', lambda m: rec['console_errors'].append(m.text[:200]) if m.type == 'error' and
            'ERR_BLOCKED_BY_CLIENT' not in m.text else None)
    q = '' if sc.get('mode', 'sr') == 'sr' else ('&' if '?' in sc['path'] else '?') + 'lang=' + sc['mode']
    target = sc['dist_path'] if side == 'dist' and sc.get('dist_path') else sc['path'] + q
    page.goto(base + target, wait_until='load', timeout=60000)
    t0 = time.time()
    page.wait_for_timeout(400)
    for st in (steps if steps is not None else sc['steps']):
        kind, sel = st[0], st[1]
        loc = page.locator(sel).first
        if kind == 'click':
            loc.click()
            page.wait_for_timeout(150)
        elif kind == 'fill':
            loc.fill(st[2])
        elif kind == 'check':
            loc.check(force=True)
        elif kind == 'press':
            loc.press(st[2])
    form_sel = 'form[data-name="%s"]' % sc['form']
    if before_submit:
        page.evaluate(before_submit)
    rec['dom_fields'] = page.evaluate("""(sel) => { const f = document.querySelector(sel); return f ?
        Array.from(f.elements).filter(e => e.name).map(e => [e.name, e.type, e.type === 'checkbox' ? String(e.checked) : e.value]) : null }""",
                                      form_sel)
    if submit:
        wait = 5.6 - (time.time() - t0)                  # the validation script refuses a send within 5 s of load
        if wait > 0:
            page.wait_for_timeout(int(wait * 1000))
        page.locator(form_sel + ' [data-submit]').first.click()
        try:
            page.wait_for_function("""(sel) => { const f = document.querySelector(sel); if (!f) return false;
                const w = f.closest('.w-form'); const d = w && w.querySelector('.w-form-done'), x = w && w.querySelector('.w-form-fail');
                return (d && getComputedStyle(d).display !== 'none') || (x && getComputedStyle(x).display !== 'none'); }""",
                                   arg=form_sel, timeout=15000)
        except Exception:  # noqa: BLE001
            pass
        page.wait_for_timeout(600)
    rec['state'] = page.evaluate("""(sel) => { const f = document.querySelector(sel); const w = f && f.closest('.w-form');
        const vis = e => !!e && getComputedStyle(e).display !== 'none';
        const share = Array.from(document.querySelectorAll('.evs-share a')).map(a => a.textContent.trim());
        return {done: vis(w && w.querySelector('.w-form-done')), fail: vis(w && w.querySelector('.w-form-fail')),
                form: vis(f), url: location.pathname + location.search, share, lang: document.documentElement.lang,
                doneText: ((w && w.querySelector('.w-form-done')) || {}).innerText || '',
                side: (document.getElementById('evb-sg-side') || {}).innerText || ''}; }""", form_sel)
    ctx.close()
    rec['external_blocked'] = sorted(h for h in rec['external_blocked'] if h)
    return rec


def check_payload(call, sc, ref_name, ref_fields):
    problems = []
    if call['url'] != BOT_URL:
        problems.append('bot URL %s' % call['url'].replace(HOOK, '<HOOK>'))
    if (call.get('contentType') or '').split(';')[0] != 'application/json':
        problems.append('content type %s' % call.get('contentType'))
    j = json.loads(call['body'])
    if list(j) != ['triggerType', 'payload'] or j['triggerType'] != 'form_submission':
        problems.append('envelope %s' % list(j))
    p = j.get('payload') or {}
    if list(p) != ['siteId', 'id', 'name', 'data', 'submittedAt', 'source']:
        problems.append('payload keys %s' % list(p))
    if p.get('siteId') != SITE_ID:
        problems.append('siteId %s' % p.get('siteId'))
    if not re.fullmatch(r'[0-9a-f]{24}', p.get('id') or '') or p['id'].startswith('test'):
        problems.append('id %s' % p.get('id'))
    if not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z', p.get('submittedAt') or ''):
        problems.append('submittedAt %s' % p.get('submittedAt'))
    if p.get('source') != 'evolako.rs':
        problems.append('source %s' % p.get('source'))
    if p.get('name') != sc['form'] or p.get('name') != ref_name:
        problems.append('name %r (form %r, Webflow got %r)' % (p.get('name'), sc['form'], ref_name))
    data = p.get('data') or {}
    if HONEYPOT in data:
        problems.append('honeypot field forwarded')
    # fields the built form adds on purpose (the hidden Jezik of the Kontakt form), after the original ones
    want = list(ref_fields) + list((sc.get('added') or {}).items())
    if list(data.items()) != want:
        a, b = dict(want), data
        problems.append('data differs from what Webflow got: missing %s, extra %s, changed %s, order %s' % (
            sorted(set(a) - set(b)), sorted(set(b) - set(a)),
            sorted(k for k in set(a) & set(b) if a[k] != b[k]), [k for k, _ in want] != list(b)))
    for k, v in sc['expect'].items():
        if k not in data:
            problems.append('%s missing' % k)
        elif v == '*':
            if not data[k]:
                problems.append('%s empty' % k)
        elif data[k] != v:
            problems.append('%s = %r, expected %r' % (k, data[k], v))
    return problems, p


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--dist', default=os.path.join(SITE_DIR, 'dist'))
    ap.add_argument('--snapshot', default=os.path.join(SITE_DIR, 'snapshot'))
    ap.add_argument('--only', default='')
    ap.add_argument('--json')
    args = ap.parse_args()
    if os.path.realpath(args.dist) != os.path.realpath(os.path.join(SITE_DIR, 'dist')):
        sys.exit('pages dev runs in site/ (functions/ next to dist/): build into site/dist first')
    from playwright.sync_api import sync_playwright
    work = tempfile.mkdtemp(prefix='evo-forms-e2e-')
    wr = Wrangler(work)
    bot_port, pages_port = free_port(), free_port()
    snap, live, embed, _ = qa_dist.load_snapshot(args.snapshot)
    dist_answers = {k: v for k, v in snap.items() if k in live or k in embed}
    ref_srv, ref_port = qa_dist.start_server(args.snapshot, False)
    results, failures = [], 0
    pages_args = ['pages', 'dev', 'dist', '--port', str(pages_port), '--ip', '127.0.0.1', '--service', 'BOT=' + STUB,
                  '--binding', 'HOOK=' + HOOK, '--compatibility-date', '2026-10-01',
                  '--show-interactive-dev-session=false', '--persist-to', os.path.join(work, 'pages-state')]
    try:
        wr.start(['dev', 'worker.js', '--name', STUB, '--port', str(bot_port), '--ip', '127.0.0.1', '--var',
                  'HOOK:' + HOOK, '--compatibility-date', '2026-10-01', '--show-interactive-dev-session=false',
                  '--persist-to', os.path.join(work, 'bot-state')], os.path.join(HERE, 'fake_bot'), 'bot.log', bot_port)
        pages = wr.start(pages_args + ['--binding', 'FORMS_ALLOW_PREVIEW=1'], SITE_DIR, 'pages.log', pages_port)
        base, ref_base = 'http://127.0.0.1:%d' % pages_port, 'http://127.0.0.1:%d' % ref_port
        only = set(x for x in args.only.split(',') if x)
        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            for i, sc in enumerate(SCENARIOS):
                if only and sc['id'] not in only:
                    continue
                stub_reset(bot_port)
                d = run(browser, base, sc, 'dist', dist_answers, ip='198.51.100.%d' % (10 + i))
                calls = stub_calls(bot_port)
                ref = run(browser, ref_base, sc, 'reference', snap)
                ref_name, ref_fields = (webflow_fields(ref['webflow'][0]['body']) if ref['webflow'] else (None, []))
                problems = []
                if len(d['posts']) != 1 or not d['posts'][0]['url'].endswith('/f/' + SITE_ID):
                    problems.append('%d POSTs to /f/ from the page' % len(d['posts']))
                if len(calls) != 1:
                    problems.append('the bot got %d calls' % len(calls))
                if len(ref['webflow']) != 1:
                    problems.append('the original page sent %d forms to Webflow' % len(ref['webflow']))
                payload = None
                if calls and ref['webflow']:
                    p2, payload = check_payload(calls[0], sc, ref_name, ref_fields)
                    problems += p2
                if d['state'].get('lang') != {'sr': 'sr', 'en': 'en', 'ru': 'ru'}[sc.get('mode', 'sr')]:
                    problems.append('built page: html lang %s' % d['state'].get('lang'))
                csp = [c for c in d['console_errors'] if 'Content Security Policy' in c or 'Refused to' in c]
                if csp:
                    problems.append('built page: CSP blocked something: %s' % csp[:2])
                for side, r in (('built', d), ('original', ref)):
                    if not r['state']['done'] or r['state']['form'] or r['state']['fail']:
                        problems.append('%s page: success block %s, form %s, failure block %s' % (
                            side, r['state']['done'], r['state']['form'], r['state']['fail']))
                    if r['page_errors']:
                        problems.append('%s page: %s' % (side, r['page_errors'][:2]))
                if sc.get('share'):
                    for side, r in (('built', d), ('original', ref)):
                        if not {'Viber', 'WhatsApp', 'Telegram'} <= set(r['state']['share']):
                            problems.append('%s page: share links %s' % (side, r['state']['share']))
                    if d['state']['side'] != ref['state']['side']:
                        problems.append('the sign-up panel differs: %r vs %r' % (d['state']['side'][:80],
                                                                                ref['state']['side'][:80]))
                failures += bool(problems)
                shown = dict(payload or {}, id='<24 hex>', submittedAt='<ISO time>') if payload else None
                results.append({'id': sc['id'], 'path': sc.get('dist_path') or sc['path'], 'mode': sc.get('mode', 'sr'),
                                'form': sc['form'],
                                'ok': not problems, 'problems': problems, 'payload': shown,
                                'webflow_fields': ref_fields, 'dist_console_errors': d['console_errors'][:5],
                                'blocked_external': d['external_blocked']})
                print('%-34s %-18s %s %s' % (sc['id'], sc['form'], 'OK' if not problems else 'FAIL',
                                            '; '.join(problems)), flush=True)
                if shown:
                    print('    bot gets: ' + json.dumps({'triggerType': 'form_submission', 'payload': shown},
                                                        ensure_ascii=False), flush=True)

            # the home calculator form must never send anything
            stub_reset(bot_port)
            calc = {'id': 'home-calculator', 'path': '/', 'form': 'Html Form'}
            steps = [('press', '#kk-km', 'ArrowRight'), ('press', '#kk-km', 'ArrowRight'), ('press', '#kk-pot', 'ArrowLeft'),
                     ('press', '#kk-jav', 'End'), ('click', '#kk-a'), ('click', '#kk-b'), ('press', '#kk-km', 'Enter'),
                     ('press', '#kk-jav', 'Enter')]
            r = run(browser, base, calc, 'dist', dist_answers, ip='198.51.100.200', steps=steps, submit=False)
            time.sleep(1.5)
            problems = []
            if r['posts']:
                problems.append('%d POSTs from the home page' % len(r['posts']))
            if stub_calls(bot_port):
                problems.append('the bot got a call')
            if r['state']['url'] != '/':
                problems.append('the page navigated to %s' % r['state']['url'])
            results.append({'id': calc['id'], 'ok': not problems, 'problems': problems})
            failures += bool(problems)
            print('%-34s %-18s %s %s' % ('home-calculator', 'Html Form', 'OK (nothing sent)' if not problems
                                         else 'FAIL', '; '.join(problems)), flush=True)

            # an invalid referral code blocks the send
            stub_reset(bot_port)
            sc = dict(SCENARIOS[3], id='preporuka-invalid', path='/preporuka')
            steps = sc['steps'] + [('fill', '#preporuka-form [name="Kod preporuke"]', 'EVO-12')]
            r = run(browser, base, sc, 'dist', dist_answers, ip='198.51.100.201', steps=steps)
            problems = []
            if r['posts'] or stub_calls(bot_port):
                problems.append('sent despite the invalid code')
            if r['state']['done']:
                problems.append('success block shown')
            results.append({'id': sc['id'], 'ok': not problems, 'problems': problems})
            failures += bool(problems)
            print('%-34s %-18s %s %s' % (sc['id'], sc['form'], 'OK (blocked)' if not problems else 'FAIL',
                                         '; '.join(problems)), flush=True)

            # a filled honeypot: success block, nothing reaches the bot
            stub_reset(bot_port)
            sc = dict(SCENARIOS[0], id='kontakt-honeypot')
            r = run(browser, base, sc, 'dist', dist_answers, ip='198.51.100.202',
                    before_submit="() => { document.querySelector('#email-form [name=website]').value = "
                                  "'http://spam.example'; }")
            problems = []
            if len(r['posts']) != 1:
                problems.append('%d POSTs' % len(r['posts']))
            if stub_calls(bot_port):
                problems.append('forwarded to the bot')
            if not r['state']['done']:
                problems.append('no success block')
            results.append({'id': sc['id'], 'ok': not problems, 'problems': problems})
            failures += bool(problems)
            print('%-34s %-18s %s %s' % (sc['id'], sc['form'], 'OK (dropped quietly)' if not problems else 'FAIL',
                                         '; '.join(problems)), flush=True)

            # without FORMS_ALLOW_PREVIEW the local origin is refused: failure block, nothing sent
            wr.stop(pages)
            wr.start(pages_args, SITE_DIR, 'pages-noflag.log', pages_port)
            stub_reset(bot_port)
            sc = dict(SCENARIOS[0], id='kontakt-origin-refused')
            r = run(browser, base, sc, 'dist', dist_answers, ip='198.51.100.203')
            problems = []
            if stub_calls(bot_port):
                problems.append('forwarded to the bot')
            if not r['state']['fail'] or r['state']['done']:
                problems.append('failure block %s, success block %s' % (r['state']['fail'], r['state']['done']))
            results.append({'id': sc['id'], 'ok': not problems, 'problems': problems})
            failures += bool(problems)
            print('%-34s %-18s %s %s' % (sc['id'], sc['form'], 'OK (refused, failure block)' if not problems
                                         else 'FAIL', '; '.join(problems)), flush=True)
            browser.close()
        logs = ''
        for name in ('pages.log', 'pages-noflag.log', 'bot.log'):
            p = os.path.join(work, name)
            if os.path.isfile(p):
                logs += open(p, encoding='utf-8', errors='replace').read()
        leaked = HOOK in logs.replace('HOOK:' + HOOK, '').replace('HOOK=' + HOOK, '')
        print('\n%d checks, %d failed; function log lines: %d sent, %d refused/dropped; HOOK in the logs: %s' % (
            len(results), failures, logs.count('"evo_form":"sent"'),
            logs.count('"evo_form":"origin refused"') + logs.count('"evo_form":"honeypot"'), 'yes' if leaked else 'no'))
        if leaked:
            failures += 1
    finally:
        wr.stop_all()
        ref_srv.shutdown()
        shutil.rmtree(work, ignore_errors=True)
    if args.json:
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump(results, f, ensure_ascii=False, indent=1)
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()

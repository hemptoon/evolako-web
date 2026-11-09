#!/usr/bin/env python3
"""The publishing queue (docs/RUNBOOK.md 3.39) — the same file lives in hemptoon/blokvolt-rs and hemptoon/evolako-web.

The scheduled tasks of BlokVolt and Evolako cannot push to GitHub from their sessions. They write the finished files into
the D1 queue (tables outbox, outbox_files of the database "blokvolt", Cloudflare connector) with a publish_after time.
.github/workflows/outbox.yml runs this script every hour: it asks https://www.blokvolt.rs/api/outbox/next for due items
(proving who it is with the job's GitHub OIDC token — no shared secret), applies the files on the item's branch, runs the
site's own checks, commits, pushes with the job's GITHUB_TOKEN, starts the deploy workflow (a push made with
GITHUB_TOKEN does not start other workflows by itself) and reports the result to /api/outbox/done.

An item that fails a check is not committed; it is marked 'failed' with the end of the log, and the next item goes on.
Only the paths below may be written, so a queue entry can never touch code, workflows or secrets.

File ops (outbox_files.op):
  write    the whole file (enc 'text' or 'base64'); sha256 of the body as written by the task is verified when given
  patch    a unified diff for `git apply --3way` (blokvolt-rs: build.py and templates/ only, for the guide lists)
  i18n-en, i18n-ru   (blokvolt-rs) a JSON {sr: translation} for `scripts/i18n.py add <lang>`
  izmene   (blokvolt-rs) one Markdown list line for /izmene/ under today's heading; heading, its EN/RU translation and
           the dates of the page and of content/data/site.json are set here
Placeholders in 'write' bodies, replaced with the publish day (Belgrade): @PUBISO@ 2026-11-11, @PUBDATE@ 11.11.2026,
@NEXT30@ the day 30 days later as DD.MM.YYYY.

Usage: python3 scripts/outbox.py run [--max N]      (in GitHub Actions only: needs the OIDC request variables)
       python3 scripts/outbox.py selftest           (offline: path rules, placeholders, the /izmene/ heading)
"""
import base64, datetime as dt, hashlib, json, os, re, subprocess, sys, tempfile, urllib.request
from pathlib import Path
from zoneinfo import ZoneInfo

API = 'https://www.blokvolt.rs/api/outbox'
AUD = 'outbox.blokvolt.rs'
MONTHS_SR = ['januar', 'februar', 'mart', 'april', 'maj', 'jun', 'jul', 'avgust', 'septembar', 'oktobar', 'novembar', 'decembar']
MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
MONTHS_RU = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']

# repo → branch → what may be written and which checks must pass before the commit
CONFIG = {
    'hemptoon/blokvolt-rs': {
        'main': {
            'write': [r'content/(?!_drafts/).+\.(md|json|txt)', r'static/assets/img/[a-z0-9-]+\.(webp|jpg|png)'],
            'patch': [r'build\.py', r'templates/[a-z0-9_]+\.html', r'content/(?!_drafts/).+\.(md|json)'],
            'checks': [
                'python3 build.py',
                'python3 scripts/i18n.py todo | tee /tmp/todo.log && python3 -c "import re,sys; '
                "n={l.split()[0]: int(l.split()[1]) for l in open('/tmp/todo.log') if re.match(r'^(en|ru) \\d+ to translate', l)}; "
                'print(n); sys.exit(0 if n and not any(n.values()) else 1)"',
                'python3 scripts/check_links.py',
                'python3 scripts/check_images.py',
                'python3 scripts/app_layer.py --strict',
                'python3 scripts/lint_sr.py --all-news',
                'python3 scripts/gen_com.py',
            ],
            'dispatch': ['deploy.yml', 'site-checks.yml'],
        },
    },
    'hemptoon/evolako-web': {
        'site-migration': {
            'write': [r'site/content/(vodici|b2b)/[a-z0-9-]+/(sr|en|ru|meta)\.json', r'site/content/novosti/[a-z0-9-]+\.json'],
            'patch': [],
            'checks': [
                'python3 site/content.py check',
                'python3 site/build.py | tail -30',
                'python3 site/tools/content_selftest.py',
            ],
            'dispatch': ['site-preview.yml'],
        },
        'main': {
            'write': [r'public/posta/\d{4}-\d{2}\.json', r'public/posta/index\.json'],
            'patch': [],
            'checks': ['npm ci --no-audit --no-fund', 'npm test'],
            'dispatch': ['deploy.yml'],
        },
    },
}


def sh(cmd, check=True):
    p = subprocess.run(cmd, shell=True, text=True, capture_output=True)
    out = (p.stdout or '') + (p.stderr or '')
    print(f'$ {cmd}\n{out[-3000:]}', flush=True)
    if check and p.returncode:
        raise RuntimeError(f'`{cmd}` exited {p.returncode}\n{out[-2500:]}')
    return out


def oidc():
    url = os.environ['ACTIONS_ID_TOKEN_REQUEST_URL'] + '&audience=' + AUD
    r = urllib.request.Request(url, headers={'Authorization': 'bearer ' + os.environ['ACTIONS_ID_TOKEN_REQUEST_TOKEN']})
    return json.load(urllib.request.urlopen(r, timeout=30))['value']


def call(path, token, body=None):
    data = json.dumps(body or {}).encode()
    r = urllib.request.Request(API + path, data=data, method='POST', headers={
        'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'blokvolt-outbox'})
    return json.load(urllib.request.urlopen(r, timeout=60))


def pub_day(tz='Europe/Belgrade'):
    return dt.datetime.now(ZoneInfo(tz)).date()


def placeholders(text, d):
    n = d + dt.timedelta(days=30)
    return (text.replace('@PUBISO@', d.isoformat()).replace('@PUBDATE@', d.strftime('%d.%m.%Y'))
                .replace('@NEXT30@', n.strftime('%d.%m.%Y')))


def allowed(cfg, op, path):
    if '..' in path.split('/') or path.startswith('/'):
        return False
    rules = cfg['patch'] if op == 'patch' else cfg['write'] if op == 'write' else []
    return any(re.fullmatch(r, path) for r in rules)


def izmene_add(root, line, d):
    """Put a list line under today's heading of content/podaci/izmene.md (new heading on top if missing)."""
    f = root / 'content/podaci/izmene.md'
    s = f.read_text(encoding='utf-8')
    head = f'## {d.day}. {MONTHS_SR[d.month - 1]} {d.year}'
    line = line.strip()
    if not line.startswith('- '):
        line = '- ' + line
    fm_end = s.index('\n---\n', 4) + 5
    if head + '\n' in s:
        i = s.index(head + '\n') + len(head) + 1
        while s[i:i + 1] == '\n':
            i += 1
        s = s[:i] + line + '\n' + s[i:]
    else:
        s = s[:fm_end] + head + '\n\n' + line + '\n\n' + s[fm_end:].lstrip('\n')
    s = re.sub(r'(?m)^updated: .*$', 'updated: ' + d.strftime('%d.%m.%Y'), s, count=1)
    s = re.sub(r'(?m)^modified: .*$', 'modified: ' + d.isoformat(), s, count=1)
    f.write_text(s, encoding='utf-8')
    key = head[3:]
    need = {}
    for lang, months in (('en', MONTHS_EN), ('ru', MONTHS_RU)):
        p = root / f'content/i18n/{lang}.json'
        if key not in json.loads(p.read_text(encoding='utf-8')):
            need[lang] = {key: f'{d.day} {months[d.month - 1]} {d.year}'}
    sj = root / 'content/data/site.json'
    if sj.exists():
        site = sj.read_text(encoding='utf-8')
        site = re.sub(r'("updated"\s*:\s*")[^"]*(")', r'\g<1>' + d.strftime('%d.%m.%Y') + r'\g<2>', site, count=1)
        sj.write_text(site, encoding='utf-8')
    return need


def apply_item(root, repo, item, d):
    """Write the item's files; return the translation files to add after a build (i18n add needs the built site)."""
    i18n = []
    cfg = CONFIG[repo].get(item['branch'])
    if not cfg:
        raise RuntimeError(f"branch {item['branch']} is not allowed for {repo}")
    if not item.get('files'):
        raise RuntimeError('the item has no files')
    for f in item['files']:
        op, path, enc = f['op'], f['path'], f.get('enc') or 'text'
        raw = base64.b64decode(f['body']) if enc == 'base64' else f['body'].encode('utf-8')
        if f.get('sha256') and hashlib.sha256(raw).hexdigest() != f['sha256'].lower():
            raise RuntimeError(f'{op} {path}: sha256 differs from the one the task computed — the file was damaged in transit')
        if op in ('write', 'patch'):
            if not allowed(cfg, op, path):
                raise RuntimeError(f'{op} {path}: this path may not be changed through the queue')
        if op == 'write':
            if enc == 'text':
                raw = placeholders(raw.decode('utf-8'), d).encode('utf-8')
            t = root / path
            t.parent.mkdir(parents=True, exist_ok=True)
            t.write_bytes(raw)
        elif op == 'patch':
            with tempfile.NamedTemporaryFile('wb', suffix='.diff', delete=False) as tf:
                tf.write(raw)
            sh(f'git apply --3way --whitespace=nowarn {tf.name}')
        elif op in ('i18n-en', 'i18n-ru') and repo == 'hemptoon/blokvolt-rs':
            json.loads(raw)
            with tempfile.NamedTemporaryFile('wb', suffix='.json', delete=False) as tf:
                tf.write(raw)
            i18n.append((op[5:], tf.name))
        elif op == 'izmene' and repo == 'hemptoon/blokvolt-rs':
            for lang, tr in izmene_add(root, raw.decode('utf-8'), d).items():
                with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as tf:
                    json.dump(tr, tf, ensure_ascii=False)
                i18n.append((lang, tf.name))
        else:
            raise RuntimeError(f'unknown op {op}')
    return i18n


def run(max_items):
    repo = os.environ['GITHUB_REPOSITORY']
    root = Path.cwd()
    token = oidc()
    done = 0
    while done < max_items:
        res = call('/next', token)
        item = res.get('item')
        if not item:
            print('nothing due')
            break
        done += 1
        branch = item['branch']
        print(f"== item {item['id']} {item['kind']} {item['slug']} → {repo}@{branch}", flush=True)
        log, sha, ok = '', None, False
        try:
            sh(f'git fetch -q origin {branch}')
            sh(f'git checkout -q -B outbox-work origin/{branch}')
            sh('git clean -fdq -e node_modules -e .fonts')
            pending = apply_item(root, repo, item, pub_day())
            if pending:
                sh('python3 build.py > /dev/null')
                for lang, f in pending:
                    log += sh(f'python3 scripts/i18n.py add {lang} {f}')[-300:]
            if not sh('git status --porcelain'):
                raise RuntimeError('the files change nothing (already published?)')
            for c in CONFIG[repo][branch]['checks']:
                log += sh(c)[-600:]
            name, email = 'Evolako' if 'evolako' in repo else 'BlokVolt', 'hello@evolako.com' if 'evolako' in repo else 'hello@blokvolt.com'
            m = re.match(r'\s*(.+?)\s*<([^>]+)>\s*$', item.get('author') or '')
            if m:
                name, email = m.group(1), m.group(2)
            sh('git add -A')
            staged = sh('git diff --cached --name-only').split()
            bad = [f for f in staged if not any(allowed(CONFIG[repo][branch], o, f) for o in ('write', 'patch'))
                   and f not in ('content/i18n/en.json', 'content/i18n/ru.json', 'content/podaci/izmene.md', 'content/data/site.json')]
            if bad:
                raise RuntimeError('the checks left changes outside the allowed paths: ' + ', '.join(bad[:10]))
            msg = item['commit_msg'].rstrip() + f"\n\nPublished from the queue (outbox item {item['id']}, RUNBOOK 3.39).\n"
            with tempfile.NamedTemporaryFile('w', suffix='.txt', delete=False, encoding='utf-8') as tf:
                tf.write(msg)
            sh(f'git -c user.name="{name}" -c user.email="{email}" commit -q -F {tf.name}')
            for attempt in (1, 2):
                p = subprocess.run(f'git push origin HEAD:{branch}', shell=True, text=True, capture_output=True)
                print(p.stdout, p.stderr)
                if p.returncode == 0:
                    break
                if attempt == 2:
                    raise RuntimeError('push failed: ' + p.stderr[-800:])
                sh(f'git fetch -q origin {branch} && git rebase origin/{branch}')
            sha = sh('git rev-parse HEAD').strip().splitlines()[-1]
            for wf in CONFIG[repo][branch]['dispatch']:
                sh(f'gh workflow run {wf} --ref {branch}', check=False)
            ok = True
            log += f'\npushed {sha} to {branch}; started: ' + ', '.join(CONFIG[repo][branch]['dispatch'])
        except Exception as e:  # noqa: BLE001 — every failure goes back to the queue with its text
            log += f'\nFAILED: {e}'
            print(log[-3000:], flush=True)
            sh('git reset -q --hard && git clean -fdq -e node_modules -e .fonts', check=False)
        try:
            call('/done', token, {'id': item['id'], 'ok': ok, 'sha': sha, 'log': log[-3800:]})
        except Exception as e:  # noqa: BLE001
            print('could not report:', e)
    return 0


def selftest():
    c = CONFIG['hemptoon/blokvolt-rs']['main']
    assert allowed(c, 'write', 'content/javno/x-y.md')
    assert not allowed(c, 'write', 'content/_drafts/x.md')
    assert not allowed(c, 'write', '.github/workflows/deploy.yml')
    assert not allowed(c, 'write', 'worker/_worker.js')
    assert not allowed(c, 'write', 'content/../worker/_worker.js')
    assert not allowed(c, 'write', 'build.py') and allowed(c, 'patch', 'build.py')
    assert not allowed(c, 'patch', 'scripts/outbox.py')
    e = CONFIG['hemptoon/evolako-web']
    assert allowed(e['site-migration'], 'write', 'site/content/vodici/wallbox-sa-kablom-ili-uticnicom/sr.json')
    assert allowed(e['site-migration'], 'write', 'site/content/b2b/punjaci-na-cuvanom-parkingu/meta.json')
    assert allowed(e['site-migration'], 'write', 'site/content/novosti/2026-11-11-struja.json')
    assert not allowed(e['site-migration'], 'write', 'site/build.py')
    assert not allowed(e['site-migration'], 'write', 'site/content/vodici/x/evil.js')
    assert allowed(e['main'], 'write', 'public/posta/2026-12.json') and not allowed(e['main'], 'write', 'src/api/posta.ts')
    d = dt.date(2026, 11, 11)
    assert placeholders('published: @PUBISO@ updated: @PUBDATE@ next: @NEXT30@', d) == 'published: 2026-11-11 updated: 11.11.2026 next: 11.12.2026'
    with tempfile.TemporaryDirectory() as t:
        r = Path(t)
        (r / 'content/podaci').mkdir(parents=True)
        (r / 'content/i18n').mkdir(parents=True)
        (r / 'content/data').mkdir(parents=True)
        (r / 'content/podaci/izmene.md').write_text('---\ntitle: X\nupdated: 01.11.2026\nmodified: 2026-11-01\n---\n## 1. novembar 2026\n\n- old\n', encoding='utf-8')
        for l in ('en', 'ru'):
            (r / f'content/i18n/{l}.json').write_text('{}', encoding='utf-8')
        (r / 'content/data/site.json').write_text('{"updated": "01.11.2026", "x": 1}', encoding='utf-8')
        need = izmene_add(r, 'Novi vodič A', d)
        assert need == {'en': {'11. novembar 2026': '11 November 2026'}, 'ru': {'11. novembar 2026': '11 ноября 2026'}}, need
        izmene_add(r, '- Novi vodič B', d)
        s = (r / 'content/podaci/izmene.md').read_text(encoding='utf-8')
        assert s.index('## 11. novembar 2026\n\n- Novi vodič B\n- Novi vodič A\n') < s.index('## 1. novembar 2026'), s
        assert 'updated: 11.11.2026' in s and 'modified: 2026-11-11' in s
        assert '"updated": "11.11.2026"' in (r / 'content/data/site.json').read_text()
    print('outbox selftest: ok')
    return 0


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['selftest']:
        sys.exit(selftest())
    if a[:1] == ['run']:
        sys.exit(run(int(a[a.index('--max') + 1]) if '--max' in a else 3))
    print(__doc__)
    sys.exit(2)

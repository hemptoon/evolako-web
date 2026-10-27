// Unit test of the form endpoint site/functions/f/[site].js, with a fake BOT (nothing leaves this machine).
// Usage: node site/tools/forms_unit.mjs   (Node 20+; exit code 0 = all checks passed)
// The browser end-to-end test of every form is site/tools/forms_e2e.py.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const fn = await import(path.join(here, '..', 'functions', 'f', '[site].js'));
const { handleForm, parseWebflowBody, FORM_NAMES, HONEYPOT, SITE_ID, resetRateLimit, rateLimited } = fn;

const HOOK = 'local-test-hook-not-a-secret';   // fake, only for this test
const PROD = 'https://www.evolako.rs';

// jQuery.param of what webflow.js posts: field names are encodeURIComponent'ed by webflow.js, then the whole key
// fields[<name>] and every value once more by jQuery (spaces as +)
const enc = (s) => encodeURIComponent(s).replace(/%20/g, '+');
function webflowBody(name, fields, extra = {}) {
  const parts = [['name', name], ['pageId', '6ab19bf9a3bb86f8fb7bb9f2'], ['elementId', 'bcc2069f'], ['domain', ''],
    ['source', PROD + '/kontakt'], ['test', 'false']];
  for (const [k, v] of Object.entries(fields)) parts.push(['fields[' + encodeURIComponent(k) + ']', v]);
  parts.push(['dolphin', 'false']);
  for (const [k, v] of Object.entries(extra)) parts.push([k, v]);
  return parts.map(([k, v]) => enc(k) + '=' + enc(v == null ? '' : String(v))).join('&');
}

function fakeBot(answer = 'ok', status = 200, opts = {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      if (opts.throws) throw new Error('down');
      calls.push({ url: String(url), method: init.method, headers: init.headers, body: init.body });
      return new Response(answer, { status });
    },
  };
}

function req(body, { origin = PROD, site = 'same-origin', ctype = 'application/x-www-form-urlencoded; charset=UTF-8',
  ip = '198.51.100.7', method = 'POST', url = PROD + '/f/' + SITE_ID } = {}) {
  const headers = new Headers();
  if (origin) headers.set('origin', origin);
  if (site) headers.set('sec-fetch-site', site);
  if (ctype) headers.set('content-type', ctype);
  if (ip) headers.set('cf-connecting-ip', ip);
  return new Request(url, { method, headers, body: method === 'POST' ? body : undefined });
}

const logs = [];
const origLog = console.log;
console.log = (...a) => { logs.push(a.join(' ')); };

let n = 0;
async function check(title, fnc) {
  resetRateLimit();
  try {
    await fnc();
    n += 1;
  } catch (e) {
    console.log = origLog;
    console.error('FAIL: ' + title);
    throw e;
  }
}

const KONTAKT = { Ime: 'Marko Petrović', Telefon: '+381 64 123 4567', Grad: 'Novi Sad', Email: 'marko@example.com',
  Saglasnost: 'true', Paket: 'wallbox', [HONEYPOT]: '' };

await check('decodes the Webflow encoding of field names and values', async () => {
  const p = parseWebflowBody(webflowBody('Prijava zgrade', { 'Ulaz ili stan': 'ulaz 2, stan 14', 'Mesta u garazi': '15–30',
    'Kviz tip': 'zajednička', Saglasnost: 'true', Pismo: 'false', Adresa: '' }));
  assert.equal(p.name, 'Prijava zgrade');
  assert.deepEqual(p.data, { 'Ulaz ili stan': 'ulaz 2, stan 14', 'Mesta u garazi': '15–30', 'Kviz tip': 'zajednička',
    Saglasnost: 'true', Pismo: 'false', Adresa: '' });
});

await check('a valid form goes to the bot in the webhook format, honeypot removed', async () => {
  const bot = fakeBot();
  const before = Date.now();
  const r = await handleForm(req(webflowBody('Kontakt', KONTAKT)), { HOOK, BOT: bot }, SITE_ID);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { code: 200, msg: 'ok' });
  assert.equal(bot.calls.length, 1);
  const c = bot.calls[0];
  assert.equal(c.url, 'https://evolako-bot.internal/wf/' + HOOK);
  assert.equal(c.method, 'POST');
  const j = JSON.parse(c.body);
  assert.deepEqual(Object.keys(j), ['triggerType', 'payload']);
  assert.equal(j.triggerType, 'form_submission');
  assert.deepEqual(Object.keys(j.payload), ['siteId', 'id', 'name', 'data', 'submittedAt', 'source']);
  assert.equal(j.payload.siteId, '6ab19bf9a3bb86f8fb7bba00');
  assert.match(j.payload.id, /^[0-9a-f]{24}$/);
  assert.ok(!j.payload.id.startsWith('test'));
  assert.equal(j.payload.name, 'Kontakt');
  const { [HONEYPOT]: _hp, ...want } = KONTAKT;
  assert.deepEqual(j.payload.data, want);
  assert.equal(j.payload.source, 'evolako.rs');
  const t = Date.parse(j.payload.submittedAt);
  assert.ok(t >= before - 1000 && t <= Date.now() + 1000 && j.payload.submittedAt.endsWith('Z'));
});

await check('ids differ between submissions', async () => {
  const bot = fakeBot();
  for (let i = 0; i < 3; i++) await handleForm(req(webflowBody('Kontakt', KONTAKT), { ip: '203.0.113.' + i }), { HOOK, BOT: bot }, SITE_ID);
  const ids = bot.calls.map((c) => JSON.parse(c.body).payload.id);
  assert.equal(new Set(ids).size, 3);
});

await check('every known form name is accepted, others are not', async () => {
  for (const name of FORM_NAMES) {
    const bot = fakeBot();
    const r = await handleForm(req(webflowBody(name, { Ime: 'Ana' }), { ip: '192.0.2.' + name.length }), { HOOK, BOT: bot }, SITE_ID);
    assert.equal(r.status, 200, name);
    assert.equal(bot.calls.length, 1, name);
  }
  for (const name of ['Html Form', 'Untitled Form', '', 'kontakt']) {
    const bot = fakeBot();
    const r = await handleForm(req(webflowBody(name, { Field: '1500' })), { HOOK, BOT: bot }, SITE_ID);
    assert.equal(r.status, 400, name);
    assert.equal(bot.calls.length, 0, name);
  }
});

await check('origin rules', async () => {
  const cases = [
    [{ origin: 'https://evolako.rs' }, {}, 200],
    [{ origin: null }, {}, 403],
    [{ origin: 'https://evil.example' }, {}, 403],
    [{ origin: 'https://www.evolako.rs.evil.example' }, {}, 403],
    [{ site: 'cross-site' }, {}, 403],
    [{ site: null }, {}, 200],
    [{ origin: 'https://abc.evolako-site.pages.dev', url: 'https://abc.evolako-site.pages.dev/f/' + SITE_ID }, {}, 403],
    [{ origin: 'https://abc.evolako-site.pages.dev', url: 'https://abc.evolako-site.pages.dev/f/' + SITE_ID },
      { FORMS_ALLOW_PREVIEW: '1' }, 200],
    [{ origin: 'https://other.pages.dev', url: 'https://abc.evolako-site.pages.dev/f/' + SITE_ID },
      { FORMS_ALLOW_PREVIEW: '1' }, 403],
    [{ origin: 'http://127.0.0.1:8788', url: 'http://127.0.0.1:8788/f/' + SITE_ID }, {}, 403],
    [{ origin: 'http://127.0.0.1:8788', url: 'http://127.0.0.1:8788/f/' + SITE_ID }, { FORMS_ALLOW_PREVIEW: '1' }, 200],
    [{ origin: 'https://evil.example', url: 'http://127.0.0.1:8788/f/' + SITE_ID }, { FORMS_ALLOW_PREVIEW: '1' }, 403],
  ];
  let i = 0;
  for (const [o, env, want] of cases) {
    const bot = fakeBot();
    const r = await handleForm(req(webflowBody('Kontakt', KONTAKT), { ...o, ip: '198.51.100.' + (i += 1) }),
      { HOOK, BOT: bot, ...env }, SITE_ID);
    assert.equal(r.status, want, JSON.stringify(o) + JSON.stringify(env));
    assert.equal(bot.calls.length, want === 200 ? 1 : 0);
  }
});

await check('method, site id and content type', async () => {
  const bot = fakeBot();
  assert.equal((await handleForm(req('', { method: 'GET' }), { HOOK, BOT: bot }, SITE_ID)).status, 405);
  assert.equal((await handleForm(req(webflowBody('Kontakt', KONTAKT)), { HOOK, BOT: bot }, 'abc')).status, 404);
  assert.equal((await handleForm(req('{"name":"Kontakt"}', { ctype: 'application/json' }), { HOOK, BOT: bot }, SITE_ID)).status, 415);
  assert.equal(bot.calls.length, 0);
});

await check('size limits', async () => {
  const bot = fakeBot();
  const env = { HOOK, BOT: bot };
  const big = webflowBody('Kontakt', { ...KONTAKT, Poruka: 'x'.repeat(40000) });
  assert.equal((await handleForm(req(big), env, SITE_ID)).status, 413);
  const longValue = webflowBody('Kontakt', { ...KONTAKT, Poruka: 'ž'.repeat(5001) });
  assert.equal((await handleForm(req(longValue, { ip: '198.51.100.20' }), env, SITE_ID)).status, 413);
  const many = {};
  for (let i = 0; i < 41; i++) many['Polje ' + i] = 'v';
  assert.equal((await handleForm(req(webflowBody('Kontakt', many), { ip: '198.51.100.21' }), env, SITE_ID)).status, 413);
  const longName = webflowBody('Kontakt', { ['n'.repeat(81)]: 'v' });
  assert.equal((await handleForm(req(longName, { ip: '198.51.100.22' }), env, SITE_ID)).status, 413);
  const ok = webflowBody('Kontakt', { ...KONTAKT, Poruka: 'ž'.repeat(5000) });
  assert.equal((await handleForm(req(ok, { ip: '198.51.100.23' }), env, SITE_ID)).status, 200);
  assert.equal(bot.calls.length, 1);
});

await check('honeypot: success answer, nothing forwarded', async () => {
  const bot = fakeBot();
  const r = await handleForm(req(webflowBody('Kontakt', { ...KONTAKT, [HONEYPOT]: 'http://spam.example' })),
    { HOOK, BOT: bot }, SITE_ID);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { code: 200, msg: 'ok' });
  assert.equal(bot.calls.length, 0);
});

await check('missing configuration fails closed', async () => {
  for (const env of [{}, { BOT: fakeBot() }, { HOOK: 'short', BOT: fakeBot() }, { HOOK }]) {
    const r = await handleForm(req(webflowBody('Kontakt', KONTAKT), { ip: '198.51.100.' + Object.keys(env).length }), env, SITE_ID);
    assert.equal(r.status, 503);
  }
});

await check('bot answers', async () => {
  const cases = [['ok', 200, 200], ['duplicate', 200, 200], ['ignored', 200, 502], ['not found', 404, 502],
    ['ok', 500, 502]];
  let i = 0;
  for (const [answer, status, want] of cases) {
    const r = await handleForm(req(webflowBody('Kontakt', KONTAKT), { ip: '198.51.100.' + (100 + (i += 1)) }),
      { HOOK, BOT: fakeBot(answer, status) }, SITE_ID);
    assert.equal(r.status, want, answer + ' ' + status);
  }
  const r = await handleForm(req(webflowBody('Kontakt', KONTAKT)), { HOOK, BOT: fakeBot('ok', 200, { throws: true }) }, SITE_ID);
  assert.equal(r.status, 502);
});

await check('per-IP limit: 8 forms per 10 minutes per address (this isolate)', async () => {
  const bot = fakeBot();
  const env = { HOOK, BOT: bot };
  for (let i = 0; i < 8; i++) assert.equal((await handleForm(req(webflowBody('Kontakt', KONTAKT), { ip: '203.0.113.50' }), env, SITE_ID)).status, 200);
  assert.equal((await handleForm(req(webflowBody('Kontakt', KONTAKT), { ip: '203.0.113.50' }), env, SITE_ID)).status, 429);
  assert.equal((await handleForm(req(webflowBody('Kontakt', KONTAKT), { ip: '203.0.113.51' }), env, SITE_ID)).status, 200);
  resetRateLimit();
  const t0 = 1_000_000;
  for (let i = 0; i < 8; i++) assert.equal(rateLimited('x', t0 + i), false);
  assert.equal(rateLimited('x', t0 + 9), true);
  assert.equal(rateLimited('x', t0 + 10 * 60 * 1000 + 1), false);   // the window has moved on
});

console.log = origLog;
const leaked = logs.filter((l) => l.includes(HOOK) || l.includes('Petrović') || l.includes('marko@example.com'));
assert.equal(leaked.length, 0, 'the HOOK or a field value appeared in a log line');
console.log('forms_unit: %d checks passed (%d log lines, none with the HOOK or a field value)', n, logs.length);

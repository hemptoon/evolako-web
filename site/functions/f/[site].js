// POST /f/<siteId> — form endpoint of the www.evolako.rs static build; replaces Webflow's form backend.
//
// site/build.py points the local webflow.js at /f/ instead of https://webflow.com/api/v1/form/, so webflow.js keeps
// doing everything it did (collecting the fields incl. the hidden ones the widgets add, .w-form-done / .w-form-fail)
// and posts the form here as application/x-www-form-urlencoded: name=<the form's data-name>,
// fields[<encodeURIComponent(field name)>]=<value>, plus page metadata (pageId, elementId, source, test, ...).
// This function turns that into the JSON Webflow's form_submission webhook delivered to the CRM bot and hands it to
// the bot through the service binding BOT, so the bot does not change:
//   POST https://evolako-bot.internal/wf/<HOOK>
//   {"triggerType":"form_submission","payload":{"siteId":"6ab19bf9a3bb86f8fb7bba00","id":"<24 hex>",
//    "name":"<data-name>","data":{"<field>":"<value>",...},"submittedAt":"<ISO time>","source":"evolako.rs"}}
// The answer {"code":200} makes webflow.js show the success block; any other answer shows the failure block.
//
// Pages project settings (Production): service binding BOT -> the bot worker (evolako-bot); secret HOOK = the same
// value the bot has (at least 16 characters, URL-safe). Never written here, never logged.
// Optional variable FORMS_ALLOW_PREVIEW=1: also accept forms sent from this project's *.pages.dev hosts and from
// localhost — those then reach the real bot, so set it only for a deliberate end-to-end test, then remove it.
//
// Anti-spam without secrets:
//   * Origin must be https://www.evolako.rs or https://evolako.rs (browsers always send Origin on a POST), and
//     Sec-Fetch-Site, when the browser sends it, must be same-origin
//   * only the five known forms (FORM_NAMES; the build checks the list against the pages), at most MAX_FIELDS
//     fields, field names up to MAX_NAME characters, values up to MAX_VALUE characters, body up to MAX_BODY bytes
//   * honeypot: the build adds a hidden, unfocusable text input named "website" to every form; a filled one gets a
//     normal-looking success answer and is dropped
//   * per-IP limit, best effort: at most RATE_MAX forms per RATE_WINDOW_MS per client IP, counted in the memory of
//     the Cloudflare isolate that serves the request — every data center (and every isolate) counts on its own and
//     the count is lost when the isolate is recycled, so it only slows a flood from one address; a hard limit is a
//     zone rate-limiting rule for /f/* in the Cloudflare dashboard (optional, see site/README.md)
//   * the bot itself drops duplicates (payload.id, 30 days)

export const SITE_ID = '6ab19bf9a3bb86f8fb7bba00';
export const FORM_NAMES = ['B2B upit', 'Kontakt', 'Kviz prijava', 'Preporuka prijava', 'Prijava zgrade'];
export const HONEYPOT = 'website';
const PROD_ORIGINS = new Set(['https://www.evolako.rs', 'https://evolako.rs']);
const BOT_URL = 'https://evolako-bot.internal/wf/';
const MAX_BODY = 32 * 1024;
const MAX_FIELDS = 40;
const MAX_NAME = 80;
const MAX_VALUE = 5000;
const RATE_MAX = 8;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const BOT_TIMEOUT_MS = 10000;

const hits = new Map(); // client IP -> timestamps of recent forms (this isolate only)

function reply(status, msg) {
  return new Response(JSON.stringify({ code: status, msg }), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function log(result, extra = {}) {
  // no field values, no IP, never the HOOK
  console.log(JSON.stringify({ evo_form: result, ...extra }));
}

export function originAllowed(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  if (PROD_ORIGINS.has(origin)) return true;
  if (env && env.FORMS_ALLOW_PREVIEW === '1') {
    const self = new URL(request.url);
    const host = self.hostname;
    return origin === self.origin && (host.endsWith('.pages.dev') || host === 'localhost' || host === '127.0.0.1');
  }
  return false;
}

export function rateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  const over = recent.length >= RATE_MAX;
  if (!over) recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] >= RATE_WINDOW_MS) hits.delete(k);
    if (hits.size > 5000) hits.clear();
  }
  return over;
}

export function resetRateLimit() {
  hits.clear();
}

// Webflow's own encoding: webflow.js runs encodeURIComponent on every field name, jQuery.param then encodes the
// whole key fields[<name>] once more; URLSearchParams undoes the second step, decodeURIComponent the first.
export function parseWebflowBody(text) {
  const params = new URLSearchParams(text);
  let name = null;
  const data = {};
  let count = 0;
  for (const [key, value] of params) {
    if (key === 'name') {
      name = value;
      continue;
    }
    const m = /^fields\[(.*)\]$/s.exec(key);
    if (!m) continue;
    let field;
    try {
      field = decodeURIComponent(m[1]);
    } catch (e) {
      return { error: 'bad field name' };
    }
    if (!field || field.length > MAX_NAME) return { error: 'field name too long' };
    if (value.length > MAX_VALUE) return { error: 'field value too long' };
    if (!Object.prototype.hasOwnProperty.call(data, field)) count += 1;
    if (count > MAX_FIELDS) return { error: 'too many fields' };
    data[field] = value;
  }
  return { name, data };
}

export function newId(now = Date.now()) {
  const t = Math.floor(now / 1000).toString(16).padStart(8, '0');
  const r = new Uint8Array(8);
  crypto.getRandomValues(r);
  return t + Array.from(r, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function botPayload(name, data, now = new Date()) {
  return {
    triggerType: 'form_submission',
    payload: { siteId: SITE_ID, id: newId(now.getTime()), name, data, submittedAt: now.toISOString(), source: 'evolako.rs' },
  };
}

export async function handleForm(request, env, site) {
  if (request.method !== 'POST') {
    const r = reply(405, 'method not allowed');
    r.headers.set('allow', 'POST');
    return r;
  }
  if (site !== SITE_ID) return reply(404, 'not found');
  if (!originAllowed(request, env)) {
    log('origin refused');
    return reply(403, 'forbidden');
  }
  const ctype = (request.headers.get('content-type') || '').toLowerCase();
  if (!ctype.startsWith('application/x-www-form-urlencoded')) return reply(415, 'unsupported content type');
  const declared = Number(request.headers.get('content-length') || '0');
  if (declared > MAX_BODY) return reply(413, 'too large');
  const ip = request.headers.get('cf-connecting-ip') || '-';
  if (rateLimited(ip)) {
    log('rate limited');
    return reply(429, 'too many forms, try again later');
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return reply(413, 'too large');
  const parsed = parseWebflowBody(text);
  if (parsed.error) {
    log('refused', { why: parsed.error });
    return reply(413, parsed.error);
  }
  const { name, data } = parsed;
  if (!FORM_NAMES.includes(name)) {
    log('unknown form');
    return reply(400, 'unknown form');
  }
  const trap = Object.prototype.hasOwnProperty.call(data, HONEYPOT) ? String(data[HONEYPOT]) : '';
  delete data[HONEYPOT];
  if (trap.trim()) {
    log('honeypot', { form: name });
    return reply(200, 'ok'); // looks like success, nothing is forwarded
  }
  const hook = env && env.HOOK ? String(env.HOOK) : '';
  if (hook.length < 16 || !env.BOT || typeof env.BOT.fetch !== 'function') {
    log('not configured', { hook: hook.length >= 16, bot: !!(env && env.BOT) });
    return reply(503, 'form service not configured');
  }
  const body = JSON.stringify(botPayload(name, data));
  let res;
  let answer = '';
  try {
    res = await env.BOT.fetch(BOT_URL + hook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      signal: AbortSignal.timeout(BOT_TIMEOUT_MS),
    });
    answer = (await res.text()).trim().slice(0, 40);
  } catch (e) {
    log('bot unreachable', { form: name, error: String((e && e.name) || 'error') });
    return reply(502, 'try again later');
  }
  if (!res.ok || (answer !== 'ok' && answer !== 'duplicate')) {
    log('bot refused', { form: name, status: res.status, answer: answer.slice(0, 20) });
    return reply(502, 'try again later');
  }
  log('sent', { form: name, fields: Object.keys(data).length });
  return reply(200, 'ok');
}

export async function onRequest(context) {
  return handleForm(context.request, context.env, context.params.site);
}

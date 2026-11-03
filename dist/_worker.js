// Cloudflare Pages (advanced mode) for shop.evolako.rs.
// 1) Closed staging: until SHOP_MODE=live, visitors see a "coming soon" page; the founders open the real shop once via
//    /__preview/<key>, which sets a cookie. Everything is noindex while closed.
// 2) POST /api/upit: reservations, model requests and B2B requests. Each one is kept for 90 days in the KV binding LEADS
//    and forwarded, server to server, to the form endpoint of www.evolako.rs (site/functions/f/[site].js in
//    hemptoon/evolako-web, branch site-migration) as its "Kontakt" form with Paket = prodavnica | prodavnica-firma.
//    That endpoint hands it to the CRM bot (evolako-bot) through its own service binding and secret, so the shop needs
//    no secret and the bot no change; the request lands in the founders' Telegram topic «Заявки» like any site form.
//    POST /api/upit/resend with header x-key = preview key forwards the stored requests that were not delivered.
const PREVIEW_KEY = '';
const FIELDS = ['tip', 'proizvod', 'model', 'ime', 'kontakt', 'email', 'grad', 'kolicina', 'ugradnja', 'napomena', 'firma', 'pib',
  'stavke', 'page', 'lang'];

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  'x-frame-options': 'SAMEORIGIN',
};

const SOON = `<!doctype html><html lang="sr-Latn"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>Evolako prodavnica uskoro</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fff;color:#0B1220}
main{max-width:520px;padding:32px 20px}h1{font-size:28px;margin:0 0 12px;letter-spacing:-.02em}p{color:#465063;line-height:1.55;margin:0 0 10px}a{color:#1F4FD6}</style></head>
<body><main><h1>Evolako prodavnica uskoro</h1><p>Punjači za električne automobile sa dostavom po Srbiji i ugradnjom.</p>
<p>Do otvaranja: <a href="https://www.evolako.rs">evolako.rs</a>, hello@evolako.com</p></main></body></html>`;

function withHeaders(resp, extra) {
  const r = new Response(resp.body, resp);
  for (const [k, v] of Object.entries(SECURITY)) r.headers.set(k, v);
  for (const [k, v] of Object.entries(extra || {})) r.headers.set(k, v);
  return r;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const KEEP = 60 * 60 * 24 * 90;

const FORM_URL = 'https://www.evolako.rs/f/6ab19bf9a3bb86f8fb7bba00';
const TIP = { rezervacija: 'Rezervacija', model: 'Upit za model', b2b: 'Upit firme', obavesti: 'Obavesti me', korpa: 'Rezervacija' };

// The shop request as the fields of the evolako.rs "Kontakt" form (names as on that form; the rest are shown as they are).
function formFields(rec) {
  const f = {};
  const add = (k, v) => { if (v != null && String(v).trim() !== '') f[k] = String(v).slice(0, 1500); };
  add('Ime', rec.ime);
  const k = rec.kontakt || '';
  if (/^[+0-9][0-9 ()\/.-]{5,}$/.test(k.trim())) add('Telefon', k); else add('Kontakt', k);
  add('Email', rec.email);
  add('Grad', rec.grad);
  add('Paket', rec.tip === 'b2b' ? 'prodavnica-firma' : 'prodavnica');
  add('Prodavnica', [TIP[rec.tip] || rec.tip, rec.proizvod || rec.model].filter(Boolean).join(': '));
  add('Stavke', rec.stavke);
  add('Količina', rec.kolicina);
  add('Ugradnja', rec.ugradnja);
  add('Firma', rec.firma);
  add('PIB', rec.pib);
  add('Napomena', rec.napomena);
  add('Stranica', rec.page);
  add('Jezik', rec.lang);
  add('Saglasnost', 'true');
  return f;
}

async function forward(env, rec) {
  const url = env.FORM_URL || FORM_URL;
  const body = new URLSearchParams();
  body.set('name', 'Kontakt');
  for (const [k, v] of Object.entries(formFields(rec))) body.set(`fields[${encodeURIComponent(k)}]`, v);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8', origin: 'https://www.evolako.rs' },
      body: body.toString(),
      signal: AbortSignal.timeout(12000),
    });
    return r.ok;
  } catch { return false; }
}

async function upit(request, env) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: 'bad_json' }, 400); }
  if (data.website) return json({ ok: true }); // honeypot
  const rec = { source: 'shop', createdAt: new Date().toISOString() };
  for (const k of FIELDS) if (data[k] != null && data[k] !== '') rec[k] = String(data[k]).slice(0, 1200);
  if (!rec.ime || !(rec.kontakt || rec.email)) return json({ ok: false, error: 'missing_fields' }, 422);
  if (!data.saglasnost) return json({ ok: false, error: 'no_consent' }, 422);
  rec.id = rec.createdAt.replace(/[^0-9]/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 8);
  const key = 'lead:' + rec.id;
  let stored = false;
  if (env.LEADS) {
    try { await env.LEADS.put(key, JSON.stringify(rec), { expirationTtl: KEEP, metadata: { sent: false } }); stored = true; } catch {}
  }
  const sent = await forward(env, rec);
  if (sent && stored) {
    try { await env.LEADS.put(key, JSON.stringify(rec), { expirationTtl: KEEP, metadata: { sent: true } }); } catch {}
  }
  if (sent || stored) return json({ ok: true, sent });
  return json({ ok: false, error: 'upstream' }, 502);
}

async function resend(request, env) {
  if (!PREVIEW_KEY || request.headers.get('x-key') !== PREVIEW_KEY) return json({ ok: false }, 403);
  if (!env.LEADS) return json({ ok: false, error: 'no_kv' }, 503);
  let cursor, resent = 0, failed = 0, pending = 0;
  do {
    const page = await env.LEADS.list({ prefix: 'lead:', cursor });
    for (const k of page.keys) {
      if (k.metadata && k.metadata.sent) continue;
      pending++;
      const raw = await env.LEADS.get(k.name);
      if (!raw) continue;
      const rec = JSON.parse(raw);
      if (await forward(env, rec)) {
        await env.LEADS.put(k.name, raw, { expirationTtl: KEEP, metadata: { sent: true } });
        resent++;
      } else failed++;
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return json({ ok: true, pending, resent, failed });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const live = (env.SHOP_MODE || 'staging') === 'live';
    const cookie = request.headers.get('cookie') || '';
    const opened = PREVIEW_KEY && cookie.includes('evo_preview=' + PREVIEW_KEY);

    if (!live) {
      if (PREVIEW_KEY && url.pathname === '/__preview/' + PREVIEW_KEY) {
        return new Response(null, { status: 302, headers: {
          location: '/', 'set-cookie': `evo_preview=${PREVIEW_KEY}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`,
          'x-robots-tag': 'noindex, nofollow' } });
      }
      if (url.pathname === '/robots.txt') {
        return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
      }
      if (!opened) {
        return withHeaders(new Response(SOON, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } }),
          { 'x-robots-tag': 'noindex, nofollow', 'cache-control': 'no-store' });
      }
    }

    if (url.pathname === '/api/upit/resend' && request.method === 'POST') return resend(request, env);
    if (url.pathname === '/api/upit') {
      if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405);
      return upit(request, env);
    }

    const resp = await env.ASSETS.fetch(request);
    const extra = {};
    if (!live) { extra['x-robots-tag'] = 'noindex, nofollow'; extra['cache-control'] = 'no-store'; }
    else if (url.pathname.startsWith('/assets/')) extra['cache-control'] = 'public, max-age=31536000, immutable';
    return withHeaders(resp, extra);
  },
};

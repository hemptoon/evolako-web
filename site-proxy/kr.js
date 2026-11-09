// app.evolako.rs/kr/* — careers form of www.evolako.rs. Applications are taken only from visitors in Serbia (Andrei,
// 09.11.2026: we need Serbian speakers who live here). The country is Cloudflare's own (request.cf.country):
//   GET  /kr/zemlja  -> {"cc":"RS"} — the form asks this when it opens and, outside Serbia, shows a notice
//                      ("turn off your VPN") and does not let the visitor send;
//   POST /kr/apply   -> 403 {"ok":false,"err":"geo"} outside Serbia, the same notice shows; nothing reaches the bot.
// Everything else (and the apply from Serbia) goes on to the CRM bot unchanged, see bot.js. Without a country (local
// tests) nothing is refused. File uploads (/kr/file/<id>) need the id and token the bot gave to an accepted apply.
import { toBot } from './bot.js';

const ORIGINS = ['https://www.evolako.rs', 'https://evolako.rs'];
export const ALLOWED = ['RS'];

function json(request, status, body) {
  const h = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' };
  const o = request.headers.get('origin');
  if (o && ORIGINS.includes(o)) h['access-control-allow-origin'] = o;
  return new Response(JSON.stringify(body), { status, headers: h });
}

export async function careers(context) {
  const { request } = context;
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  const cc = String((request.cf && request.cf.country) || '').toUpperCase();
  if (path === '/kr/zemlja') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return json(request, 405, { ok: false });
    return json(request, 200, { cc: cc || null });
  }
  if (path === '/kr/apply' && request.method === 'POST' && cc && !ALLOWED.includes(cc)) {
    return json(request, 403, { ok: false, err: 'geo' });
  }
  return toBot(context);
}

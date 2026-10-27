// Cloudflare Pages Functions middleware of the www.evolako.rs static build (site/dist).
//
// 1. Old language links. Until the move off Webflow, English and Russian lived on the Serbian URLs (?lang=en|ru,
//    switched in the browser); now /en/<page> and /ru/<page> are real pages. A request for a page with ?lang= is
//    answered with a permanent redirect (301) to the URL of that language, keeping every other query parameter
//    (?paket=wallbox, ?ref=EVO-XXXXX, utm_…) and nothing else changes:
//      /kontakt?lang=en&paket=wallbox -> /en/kontakt?paket=wallbox        /?lang=ru -> /ru/
//      /en/kontakt?lang=ru            -> /ru/kontakt                      /en/kontakt?lang=en -> /en/kontakt
//      /en/kontakt?lang=sr            -> /kontakt?lang=sr  (the Serbian page stores the choice and drops the parameter)
//    ?lang=sr-cyrl (and sr, sr-latn, cyr, cy) on a Serbian page is left as it is: Serbian Cyrillic is a mode of the
//    Serbian pages that the i18n engine switches in the browser. Only page paths (/, /<slug>, /en/…, /ru/…) are
//    redirected; there is no redirect by Accept-Language or by IP.
// 2. Any host other than the production domains — the *.pages.dev alias, every preview deployment, a test domain —
//    gets "X-Robots-Tag: noindex, nofollow", so a copy of the site is never indexed next to www.evolako.rs.
//    Production responses pass through untouched (the cache and security headers come from dist/_headers).
// 3. The bare domain evolako.rs: every GET/HEAD gets a 301 to the same path and query on https://www.evolako.rs (the
//    canonical host, as on Webflow), in one step with the ?lang= redirect of 1. Other methods are not redirected.
// dist/_routes.json keeps /_a/* (copied files) out of Functions; dist/_headers marks *.pages.dev for those.

const PRODUCTION_HOSTS = new Set(['www.evolako.rs', 'evolako.rs']);
const CANONICAL_ORIGIN = 'https://www.evolako.rs';
const BARE_HOST = 'evolako.rs';
const LANG_PARAM = /^(sr-cyrl|sr-latn|cyr|cy|sr|en|ru)$/i;

// The URL (path + query) a page request with ?lang= should go to, or null when it stays where it is.
export function langRedirect(url) {
  const u = new URL(url);
  let lang = null;
  for (const [k, v] of u.searchParams) {
    if (k === 'lang' && LANG_PARAM.test(v)) {
      lang = v.toLowerCase();
      break;
    }
  }
  if (!lang) return null;
  const m = /^\/(?:(en|ru)(?:\/([a-z0-9-]*))?|([a-z0-9-]*))$/.exec(u.pathname);
  if (!m) return null; // files, the form endpoint, anything that is not a page path
  const pageLang = m[1] || 'sr';
  const slug = m[1] ? m[2] || '' : m[3];
  if (m[1] && m[2] === undefined) return null; // /en without the slash: Pages redirects to /en/ first
  const family = lang === 'en' || lang === 'ru' ? lang : 'sr';
  const rest = new URLSearchParams(u.search);
  if (family === pageLang && family === 'sr') return null; // Serbian (Latin or Cyrillic) on a Serbian page: as is
  if (family === 'sr') {
    // from /en/ or /ru/ to the Serbian page; the lang parameter stays so the page can store the choice
    return '/' + slug + qs(rest);
  }
  const others = new URLSearchParams();
  for (const [k, v] of rest) if (k !== 'lang') others.append(k, v);
  return '/' + family + '/' + slug + qs(others);
}

function qs(params) {
  const s = params.toString();
  return s ? '?' + s : '';
}

export async function onRequest(context) {
  const { request } = context;
  const host = new URL(request.url).hostname.toLowerCase().replace(/\.$/, '');
  const production = PRODUCTION_HOSTS.has(host);
  if (request.method === 'GET' || request.method === 'HEAD') {
    const to = langRedirect(request.url);
    if (host === BARE_HOST) {
      const u = new URL(request.url);
      const target = CANONICAL_ORIGIN + (to !== null ? to : u.pathname + u.search);
      return new Response(null, { status: 301, headers: { Location: target, 'Cache-Control': 'public, max-age=3600' } });
    }
    if (to !== null) {
      const r = new Response(null, { status: 301, headers: { Location: to, 'Cache-Control': 'public, max-age=3600' } });
      if (!production) r.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return r;
    }
  }
  const response = await context.next();
  if (production) return response;
  const marked = new Response(response.body, response);
  marked.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return marked;
}

// Cloudflare Pages Functions middleware of the www.evolako.rs static build (site/dist).
// Any host other than the production domains — the *.pages.dev alias, every preview deployment, a test domain —
// gets "X-Robots-Tag: noindex, nofollow", so a copy of the site is never indexed next to www.evolako.rs.
// Production responses pass through untouched (the cache and security headers come from dist/_headers).
// dist/_routes.json keeps /_a/* (copied files) out of Functions; dist/_headers marks *.pages.dev for those.

const PRODUCTION_HOSTS = new Set(['www.evolako.rs', 'evolako.rs']);

export async function onRequest(context) {
  const response = await context.next();
  const host = new URL(context.request.url).hostname.toLowerCase().replace(/\.$/, '');
  if (PRODUCTION_HOSTS.has(host)) return response;
  const marked = new Response(response.body, response);
  marked.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return marked;
}

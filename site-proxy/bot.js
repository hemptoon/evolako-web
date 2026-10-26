// First-party addresses on app.evolako.rs for the scripts of www.evolako.rs (Webflow): the pageview counter (/s/p),
// the building sign-up count (/zgrada/broj) and the careers form (/kr/apply, /kr/file/<id>). Each request goes on, as
// it came, to the CRM bot through the service binding BOT (Pages project evolako-app → Settings → Bindings → Service
// binding "BOT" → Worker "evolako-bot", production). So the bot's workers.dev address is neither in the site's code nor
// in this public repository, and the bot still sees the visitor's own headers (Origin, CF-Connecting-IP, User-Agent):
// its CORS rules, rate limits and visitor counting work exactly as before. Without the binding: 503, nothing else breaks.
export async function toBot({ request, env }) {
  if (!env || !env.BOT || typeof env.BOT.fetch !== 'function') {
    return new Response('unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
  }
  const u = new URL(request.url);
  return env.BOT.fetch(new Request('https://evolako-bot.internal' + u.pathname + u.search, request));
}

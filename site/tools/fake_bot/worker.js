// Local stand-in for the CRM bot, used only by site/tools/forms_e2e.py through `wrangler dev` (never deployed).
// It mirrors the bot's form route: POST /wf/<HOOK> (HOOK at least 16 characters) is recorded and answered "ok",
// like the real bot does; anything else gets 404 "not found". GET /__calls lists what was recorded,
// POST /__reset clears it. The HOOK is a fake value the test passes in; no real secret is ever used.
const calls = [];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hook = env.HOOK && String(env.HOOK).length >= 16 ? String(env.HOOK) : null;
    if (request.method === 'POST' && hook && url.pathname === `/wf/${hook}`) {
      calls.push({
        url: request.url,
        method: request.method,
        contentType: request.headers.get('content-type'),
        body: await request.text(),
        at: new Date().toISOString(),
      });
      return new Response('ok');
    }
    if (url.pathname === '/__calls') return Response.json(calls);
    if (url.pathname === '/__reset' && request.method === 'POST') {
      calls.length = 0;
      return new Response('reset');
    }
    return new Response('not found', { status: 404 });
  },
};

// Unit test of site/functions/_middleware.js: the redirects of old ?lang= links and the noindex header.
// Run: node site/tools/middleware_unit.mjs   (exit code 1 on a failure). Nothing leaves this machine.
import { langRedirect, onRequest } from '../functions/_middleware.js';

let failed = 0;
let passed = 0;
function eq(name, got, want) {
  if (got === want) {
    passed += 1;
    return;
  }
  failed += 1;
  console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const B = 'https://www.evolako.rs';
// [request path, expected Location or null (no redirect)]
const CASES = [
  ['/kontakt?lang=en', '/en/kontakt'],
  ['/kontakt?lang=ru', '/ru/kontakt'],
  ['/?lang=en', '/en/'],
  ['/?lang=ru', '/ru/'],
  ['/kontakt?paket=wallbox&lang=en', '/en/kontakt?paket=wallbox'],
  ['/kontakt?lang=en&paket=wallbox', '/en/kontakt?paket=wallbox'],
  ['/preporuka?ref=EVO-7K2QX&lang=ru', '/ru/preporuka?ref=EVO-7K2QX'],
  ['/punjaci-za-hotele?utm_source=fb&lang=EN&utm_medium=cpc', '/en/punjaci-za-hotele?utm_source=fb&utm_medium=cpc'],
  ['/kontakt?lang=en&lang=ru', '/en/kontakt'],
  ['/kontakt?lang=sr-cyrl', null],
  ['/kontakt?lang=sr-Cyrl&paket=start', null],
  ['/kontakt?lang=sr', null],
  ['/kontakt?lang=sr-latn', null],
  ['/kontakt?lang=cy', null],
  ['/kontakt?lang=de', null],
  ['/kontakt', null],
  ['/kontakt?paket=wallbox', null],
  ['/en/kontakt', null],
  ['/en/kontakt?paket=wallbox', null],
  ['/en/kontakt?lang=en', '/en/kontakt'],
  ['/en/kontakt?lang=en&paket=wallbox', '/en/kontakt?paket=wallbox'],
  ['/en/kontakt?lang=ru', '/ru/kontakt'],
  ['/ru/?lang=en', '/en/'],
  ['/en/kontakt?lang=sr', '/kontakt?lang=sr'],
  ['/en/kontakt?lang=sr-cyrl&paket=wallbox', '/kontakt?lang=sr-cyrl&paket=wallbox'],
  ['/ru/?lang=sr-cyrl', '/?lang=sr-cyrl'],
  ['/en?lang=ru', null],
  ['/_a/cdn.prod.website-files.com/x.js?lang=en', null],
  ['/f/6ab19bf9a3bb86f8fb7bba00?lang=en', null],
  ['/robots.txt?lang=en', null],
  ['/llms.txt?lang=ru', null],
  ['/sitemap.xml?lang=ru', null],
  ['/kontakt/?lang=en', null],
  ['/ru-novosti?lang=en', '/en/ru-novosti'],
];
for (const [path, want] of CASES) eq(path, langRedirect(B + path), want);

// the handler: 301 with Location, the noindex header off production, the page itself otherwise
function ctx(url, method = 'GET') {
  return {
    request: new Request(url, { method }),
    next: async () => new Response('page', { status: 200, headers: { 'content-type': 'text/html' } }),
  };
}
const r1 = await onRequest(ctx(B + '/kontakt?lang=en&paket=wallbox'));
eq('301 status', r1.status, 301);
eq('301 Location', r1.headers.get('location'), '/en/kontakt?paket=wallbox');
eq('301 on production: no noindex', r1.headers.get('x-robots-tag'), null);
const r2 = await onRequest(ctx('https://evolako-site.pages.dev/?lang=ru'));
eq('301 on pages.dev', r2.status, 301);
eq('301 on pages.dev: noindex', r2.headers.get('x-robots-tag'), 'noindex, nofollow');
const r3 = await onRequest(ctx(B + '/kontakt?lang=sr-cyrl'));
eq('sr-cyrl passes', r3.status, 200);
eq('sr-cyrl body', await r3.text(), 'page');
const r4 = await onRequest(ctx('https://evolako-site.pages.dev/en/kontakt'));
eq('preview page: noindex', r4.headers.get('x-robots-tag'), 'noindex, nofollow');
const r5 = await onRequest(ctx(B + '/en/kontakt'));
eq('production page: untouched', r5.headers.get('x-robots-tag'), null);
const r6 = await onRequest(ctx(B + '/kontakt?lang=en', 'POST'));
eq('POST is never redirected', r6.status, 200);
const r7 = await onRequest(ctx(B + '/kontakt?lang=en', 'HEAD'));
eq('HEAD redirected', r7.status, 301);

// the bare domain: one 301 to www (with the ?lang= target when there is one), GET/HEAD only
const A = 'https://evolako.rs';
for (const [path, want] of [
  ['/', 'https://www.evolako.rs/'],
  ['/kontakt?paket=wallbox', 'https://www.evolako.rs/kontakt?paket=wallbox'],
  ['/kontakt?lang=en&paket=wallbox', 'https://www.evolako.rs/en/kontakt?paket=wallbox'],
  ['/ru/paketi-i-cene', 'https://www.evolako.rs/ru/paketi-i-cene'],
  ['/kontakt?lang=sr-cyrl', 'https://www.evolako.rs/kontakt?lang=sr-cyrl'],
  ['/robots.txt', 'https://www.evolako.rs/robots.txt'],
  ['/nema-ove-stranice', 'https://www.evolako.rs/nema-ove-stranice'],
]) {
  const r = await onRequest(ctx(A + path));
  eq('bare ' + path + ' status', r.status, 301);
  eq('bare ' + path + ' Location', r.headers.get('location'), want);
  eq('bare ' + path + ' no noindex', r.headers.get('x-robots-tag'), null);
}
const r8 = await onRequest(ctx(A + '/kontakt', 'HEAD'));
eq('bare HEAD redirected', r8.status, 301);
const r9 = await onRequest(ctx(A + '/f/6ab19bf9a3bb86f8fb7bba00', 'POST'));
eq('bare POST is never redirected', r9.status, 200);
const r10 = await onRequest(ctx(B + '/kontakt'));
eq('www is not redirected', r10.status, 200);
const r11 = await onRequest(ctx('https://evolako.rs.:443/kontakt'.replace(':443', '')));
eq('bare with a trailing dot', r11.status, 301);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

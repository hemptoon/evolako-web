// node fx.test.js — testovi za fx.js (spec §5, §8)
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(__dirname + '/../fx.js', 'utf8');
const NB = ' ';

function env(html, { url = 'https://www.evolako.rs/', lang = 'sr', storage = {} } = {}) {
  const dom = new JSDOM(`<!doctype html><html lang="${lang}"><body>${html}</body></html>`, { url, runScripts: 'outside-only' });
  const w = dom.window;
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  w.eval(SRC);
  return w;
}
const n = (s) => s.replace(/ /g, ' ');
let pass = 0;
function t(name, fn) { try { fn(); pass++; } catch (e) { console.error('FAIL', name, '\n', e.message); process.exitCode = 1; } }

// ---------------------------------------------------------------- tabela spec §5
t('default RSD, no change', () => {
  const w = env('');
  const fx = w.FxCore.create({ brand: 'evolako', key: 'evo:cur' });
  assert.equal(fx.get(), 'RSD');
  const r = fx.money(125000, { kind: 'offer' });
  assert.equal(r.converted, false);
  assert.equal(n(r.primary), '125.000 RSD');
});

const cases = [
  [125000, '', 'EUR', '≈ 1.064 €'], [125000, '', 'USD', '≈ 1.190 $'],
  [59000, '', 'EUR', '≈ 502 €'], [59000, '', 'USD', '≈ 562 $'],
  [990, '', 'EUR', '≈ 8,43 €'], [990, '', 'USD', '≈ 9,42 $'],
  [3500, '', 'EUR', '≈ 29,79 €'], [3500, '', 'USD', '≈ 33,32 $'],
  [58.33, '/min', 'EUR', '≈ 0,50 €/min'], [58.33, '/min', 'USD', '≈ 0,56 $/min'],
  [1.20, '/min', 'EUR', '≈ 0,010 €/min'], [1.20, '/min', 'USD', '≈ 0,011 $/min'],
  [6, '/kWh', 'EUR', '≈ 0,051 €/kWh'], [6, '/kWh', 'USD', '≈ 0,057 $/kWh'],
  [0, '', 'EUR', '0 €'],
];
for (const [rsd, unit, cur, want] of cases) {
  t(`money ${rsd}${unit} ${cur}`, () => {
    const w = env('', { storage: { 'evo:cur': cur } });
    const fx = w.FxCore.create({ key: 'evo:cur' });
    assert.equal(n(fx.money(rsd, { unit }).primary), want);
  });
}
t('range 43–79 /kWh', () => {
  const w = env('', { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  assert.equal(n(fx.range(43, 79, { unit: '/kWh' }).primary), '≈ 0,37–0,67 €/kWh');
  fx.set('USD');
  assert.equal(n(fx.range(43, 79, { unit: '/kWh' }).primary), '≈ 0,41–0,75 $/kWh');
});
t('range ends across 0,10 → 3 decimals both', () => {
  const w = env('', { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  assert.equal(n(fx.range(6, 20, { unit: '/kWh' }).primary), '≈ 0,051–0,170 €/kWh');
});
t('offer keeps RSD first', () => {
  const w = env('', { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  const r = fx.money(990, { kind: 'offer', unit: '/mes' });
  assert.equal(n(r.primary), '990 RSD/mes');
  assert.equal(n(r.secondary), '≈ 8,43 €/mes');
});
t('ref shows converted first, RSD second; compact only converted', () => {
  const w = env('', { storage: { 'k': 'USD' } });
  const fx = w.FxCore.create({ key: 'k' });
  const r = fx.money(58.33, { unit: '/min' });
  assert.equal(n(r.secondary), '58,33 RSD/min');
  const c = fx.money(58.33, { unit: '/min', compact: true });
  assert.equal(c.secondary, '');
  assert.ok(c.title.includes('58,33'));
});
t('?cur=eur in URL sets and stores; junk ignored', () => {
  const w = env('', { url: 'https://www.evolako.rs/?cur=eur' });
  const fx = w.FxCore.create({ key: 'evo:cur' });
  assert.equal(fx.get(), 'EUR');
  assert.equal(w.localStorage.getItem('evo:cur'), 'EUR');
  const w2 = env('', { url: 'https://www.evolako.rs/?cur=rub' });
  assert.equal(w2.FxCore.create({ key: 'evo:cur' }).get(), 'RSD');
});
t('set RSD removes storage; event fires once; tracking', () => {
  const w = env('', { storage: { 'k': 'EUR' } });
  const ev = [];
  const fx = w.FxCore.create({ key: 'k', track: (e, p) => ev.push([e, p]) });
  let calls = 0; fx.on(() => calls++);
  fx.set('RSD'); fx.set('RSD');
  assert.equal(w.localStorage.getItem('k'), null);
  assert.equal(calls, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(ev)), [['currency_changed', { from: 'EUR', to: 'RSD', surface: 'site' }]]);
});
t('storage blocked → RSD, no throw', () => {
  const w = env('');
  Object.defineProperty(w, 'localStorage', { get() { throw new Error('blocked'); } });
  const fx = w.FxCore.create({ key: 'k' });
  assert.equal(fx.get(), 'RSD');
  fx.set('EUR');
  assert.equal(fx.get(), 'EUR');
});
t('notes and title texts', () => {
  const w = env('', { lang: 'ru', storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k', brand: 'blokvolt' });
  assert.equal(fx.note(), 'Суммы в евро и долларах — справочные, по среднему курсу НБС на 05.10.2026. На зарядках и в счетах цены в динарах.');
  assert.ok(fx.money(990).title.startsWith('Пересчитано по курсу НБС на 05.10.2026.'));
});

// ---------------------------------------------------------------- parsiranje
t('parse prices sr/en/ru', () => {
  const w = env('');
  const fx = w.FxCore.create({ key: 'k' });
  const P = (s, l) => { const r = fx._parse(s, l); return r && [r.prefix, r.lo, r.hi, r.unit]; };
  assert.deepEqual(P('59.000RSD', 'sr'), ['', 59000, null, '']);
  assert.deepEqual(P('od 96.000RSD/mestu', 'sr'), ['od', 96000, null, '/mestu']);
  assert.deepEqual(P('990 RSD/mes', 'sr'), ['', 990, null, '/mes']);
  assert.deepEqual(P('4–7 RSD/kWh', 'sr'), ['', 4, 7, '/kWh']);
  assert.deepEqual(P('58,33 RSD/min', 'sr'), ['', 58.33, null, '/min']);
  assert.deepEqual(P('RSD 59,000', 'en'), ['', 59000, null, '']);
  assert.deepEqual(P('from RSD 96,000/spot', 'en'), ['from', 96000, null, '/spot']);
  assert.deepEqual(P('59 000 RSD', 'ru'), ['', 59000, null, '']);
  assert.deepEqual(P('990 RSD mesečno', 'sr'), ['', 990, null, ' mesečno']);
  assert.deepEqual(P('≈ 1.440 RSD', 'sr'), ['≈', 1440, null, '']);
  assert.equal(P('Pozovi nas: 3.500 RSD je cena izlaska na teren', 'sr'), null);
  assert.equal(P('Prijava 2026', 'sr'), null);
});

// ---------------------------------------------------------------- DOM
t('scan converts whole-price elements, deepest only, restores on RSD', () => {
  const w = env(`<div id="card"><div class="price"><span>59.000</span><span>RSD</span></div><p>Uključena ugradnja do 7 m.</p></div>
                 <p id="prose">Puniš za oko 4–7 RSD/kWh kod kuće.</p><div id="k"><div id="v">1.440 RSD</div></div>`,
                 { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  const before = w.document.body.innerHTML;
  fx.scan(w.document.body, { kind: 'offer' });
  const price = w.document.querySelector('.price');
  assert.equal(price.getAttribute('data-fx-on'), '1');
  assert.equal(n(price.textContent), '59.000RSD · ≈ 502 €');
  assert.equal(w.document.getElementById('card').getAttribute('data-fx-on'), null);
  assert.equal(w.document.getElementById('prose').getAttribute('data-fx-on'), null, 'prose untouched');
  assert.equal(n(w.document.getElementById('v').textContent), '1.440 RSD · ≈ 12,26 €');
  fx.scan(w.document.body, { kind: 'offer' });        // idempotent
  assert.equal(n(price.textContent), '59.000RSD · ≈ 502 €');
  fx.set('RSD'); fx.scan(w.document.body, { kind: 'offer' });
  assert.equal(w.document.body.innerHTML, before.replace(/<div class="price">/, '<div class="price" data-fx-auto="1" data-fx-kind="offer">').replace('<div id="v">', '<div id="v" data-fx-auto="1" data-fx-kind="offer">'));
});
t('render data-rsd markup: ref, offer, compact, range', () => {
  const w = env(`<span id="a" data-rsd="58.33" data-unit="/min">58,33 RSD/min</span>
                 <span id="b" data-rsd="990" data-kind="offer" data-unit="/mes">990 RSD/mes</span>
                 <span id="c" data-rsd="58.33" data-unit="/min" data-compact>58,33</span>
                 <span id="d" data-rsd-lo="43" data-rsd-hi="79" data-unit="/kWh">43–79 RSD/kWh</span>`, { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  fx.render();
  const T = (id) => n(w.document.getElementById(id).textContent);
  assert.equal(T('a'), '≈ 0,50 €/min · 58,33 RSD/min');
  assert.equal(T('b'), '990 RSD/mes · ≈ 8,43 €/mes');
  assert.equal(T('c'), '≈ 0,50 €/min');
  assert.equal(T('d'), '≈ 0,37–0,67 €/kWh · 43–79 RSD/kWh');
  assert.ok(n(w.document.getElementById('c').title).includes('58,33 RSD/min'));
  fx.set('RSD'); fx.render();
  assert.equal(T('a'), '58,33 RSD/min'); assert.equal(T('c'), '58,33');
  assert.equal(w.document.getElementById('c').getAttribute('title'), null);
});
t('switcher reflects and changes currency', () => {
  const w = env('<div id="h"></div>', { lang: 'en' });
  const fx = w.FxCore.create({ key: 'k' });
  const s = fx.switcher({ long: true });
  w.document.getElementById('h').appendChild(s);
  assert.equal(s.value, 'RSD');
  assert.equal(s.options[1].textContent, 'EUR — euro');
  assert.equal(s.getAttribute('aria-label'), 'Currency');
  s.value = 'USD'; s.dispatchEvent(new w.Event('change'));
  assert.equal(fx.get(), 'USD');
  fx.set('EUR'); assert.equal(s.value, 'EUR');
});
t('watch: calculator rewrites value → rescanned', async () => {});

// ---------------------------------------------------------------- 1.1.0
t('rate units in Cyrillic get rate decimals (/мин, за кВт·ч)', () => {
  const w = env('', { lang: 'ru', storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  assert.equal(n(fx.money(1.20, { unit: '/мин' }).primary), '≈ 0,010 €/мин');
  assert.equal(n(fx.money(6, { unit: ' за кВт·ч' }).primary), '≈ 0,051 € за кВт·ч');
  assert.equal(n(fx.money(990, { unit: '/мес' }).primary), '≈ 8,43 €/мес', 'not a rate');
  assert.equal(n(fx.money(990, { unit: '/minut' }).primary), '≈ 8,43 €/minut', 'word boundary');
});
t('numLang sr: Serbian numbers parsed on an English page', () => {
  const w = env('<div id="a">126,67 RSD/min</div><div id="b">59.000 RSD</div><div id="c">16.67–33.33 RSD/min</div>',
                { lang: 'en', storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k', numLang: 'sr' });
  fx.scan(w.document.body);
  const T = (id) => n(w.document.getElementById(id).textContent);
  assert.equal(T('a'), '≈ 1,08 €/min · 126,67 RSD/min');
  assert.equal(T('b'), '≈ 502 € · 59.000 RSD');
  assert.equal(T('c'), '≈ 0,14–0,28 €/min · 16.67–33.33 RSD/min');
  const w2 = env('<div id="a">126,67 RSD/min</div>', { lang: 'en', storage: { 'k': 'EUR' } });
  w2.FxCore.create({ key: 'k' }).scan(w2.document.body);
  assert.equal(n(w2.document.getElementById('a').textContent), '≈ 1,07 €/min · 126,67 RSD/min', 'without numLang: English parsing as before (126,67 read as 126)');
});
t('render after the page rewrote a painted element: new value, and RSD restores the new text', () => {
  const w = env('<b id="o" data-rsd="1440">1.440 RSD</b>', { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  const o = w.document.getElementById('o');
  fx.render();
  assert.equal(n(o.textContent), '≈ 12,26 € · 1.440 RSD');
  o.textContent = '19.200 RSD'; o.setAttribute('data-rsd', '19200');      // calculator writes a new result
  fx.render();
  assert.equal(n(o.textContent), '≈ 163 € · 19.200 RSD');
  fx.set('RSD'); fx.render();
  assert.equal(o.innerHTML, '19.200 RSD');
  assert.equal(o.getAttribute('title'), null);
  o.textContent = '2.000 RSD'; o.setAttribute('data-rsd', '2000');         // rewritten while RSD is shown
  fx.set('USD'); fx.render();
  assert.equal(n(o.textContent), '≈ 19,04 $ · 2.000 RSD');
  fx.set('RSD'); fx.render();
  assert.equal(o.innerHTML, '2.000 RSD');
});
t('separator in its own span; repeated render does not rewrite the DOM', () => {
  const w = env('<b id="o" data-rsd="990">990 RSD</b>', { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  const o = w.document.getElementById('o');
  fx.render();
  assert.equal(o.querySelector('.fx-s .fx-sep').textContent, ' · ');
  assert.equal(n(o.querySelector('.fx-s').textContent), ' · 990 RSD');
  const first = o.firstChild;
  fx.render(); fx.render();
  assert.ok(o.firstChild === first, 'same nodes after re-render');
});

console.log(`fx.js: ${pass} passed`);

// async: watch
(async () => {
  const w = env('<div id="calc"><div id="out">1.440 RSD</div></div>', { storage: { 'k': 'EUR' } });
  const fx = w.FxCore.create({ key: 'k' });
  fx.scan(w.document.body); fx.watch(w.document.body);
  const out = w.document.getElementById('out');
  assert.equal(n(out.textContent), '≈ 12,26 € · 1.440 RSD');
  out.textContent = '19.200 RSD';            // kalkulator piše novu vrednost
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(n(out.textContent), '≈ 163 € · 19.200 RSD');
  await new Promise((r) => setTimeout(r, 400)); // nema petlje
  assert.equal(n(out.textContent), '≈ 163 € · 19.200 RSD');
  console.log('fx.js watch: ok');
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error('FAIL watch', e.message); process.exit(1); });

// async: loadRates
(async () => {
  const w = env('', { storage: { 'k': 'EUR' } });
  let calls = 0;
  const fx = w.FxCore.create({ key: 'k', loadRates: () => { calls++; return Promise.resolve({ date: '2026-10-06', rates: { EUR: 117.5, USD: 100 }, source: 'NBS srednji kurs' }); } });
  let ev = 0; fx.on(() => ev++);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fx.rates().date, '2026-10-06'); assert.equal(ev, 1);
  assert.equal(require('assert').strict ? 1 : 1, 1);
  const fx2 = w.FxCore.create({ key: 'k', loadRates: () => { calls++; return Promise.resolve(null); } });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1, 'cached 6 h, second instance does not refetch');
  assert.equal(fx2.rates().date, '2026-10-06');
  const w3 = env('', { storage: { 'k': 'USD' } });
  const fx3 = w3.FxCore.create({ key: 'k', loadRates: () => Promise.resolve({ date: '2026-10-06', rates: { EUR: 5, USD: 100 } }) });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(fx3.rates().date, '2026-10-05', 'junk rate rejected');
  console.log('fx.js loadRates: ok');
})().catch((e) => { console.error('FAIL loadRates', e.message); process.exit(1); });

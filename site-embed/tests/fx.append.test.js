// node fx.append.test.js — režim „dopiši“ za evolako.rs (Webflow, prevod u mestu)
const assert = require('assert');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const SRC = fs.readFileSync(__dirname + '/../fx.js', 'utf8');
const n = (s) => s.replace(/ /g, ' ');
(async () => {
  const dom = new JSDOM(`<!doctype html><html lang="sr"><body>
    <div class="card"><div id="p" class="price">59.000<span class="u">RSD</span></div><p>Ugradnja uključena.</p></div>
    <div id="z">od 96.000 RSD/mestu</div><div id="s">990 RSD/mes</div><p id="prose">Kod kuće 4–7 RSD/kWh, javno do 79.</p>
    <div id="calc"><div id="out">1.440 RSD</div></div></body></html>`, { url: 'https://www.evolako.rs/', runScripts: 'outside-only' });
  const w = dom.window; w.localStorage.setItem('evo:cur', 'EUR'); w.eval(SRC);
  const fx = w.FxCore.create({ brand: 'evolako', key: 'evo:cur', numLang: 'auto' });
  const D = (id) => w.document.getElementById(id);
  const before = { p: D('p').childNodes[0], u: D('p').querySelector('.u') };
  fx.scan(w.document.body, { append: true });
  assert.equal(n(D('p').textContent), '59.000RSD · ≈ 502 €');
  assert.strictEqual(D('p').childNodes[0], before.p, 'original text node kept');
  assert.strictEqual(D('p').querySelector('.u'), before.u, 'original span kept');
  assert.equal(n(D('z').textContent), 'od 96.000 RSD/mestu · ≈ 817 €/mestu');
  assert.equal(n(D('s').textContent), '990 RSD/mes · ≈ 8,43 €/mes');
  assert.equal(n(D('out').textContent), '1.440 RSD · ≈ 12,26 €');
  assert.equal(D('prose').querySelector('.fx-a'), null, 'prose untouched');
  assert.equal(w.document.querySelectorAll('.fx-a').length, 4);
  fx.scan(w.document.body, { append: true }); // idempotent
  assert.equal(w.document.querySelectorAll('.fx-a').length, 4);
  // i18n prevodi u mestu (EN): menja tekst čvora, naš span ostaje
  w.document.documentElement.lang = 'en';
  before.p.nodeValue = '59,000'; D('z').firstChild.nodeValue = 'from RSD 96,000/spot';
  fx.scan(w.document.body, { append: true });
  assert.equal(n(D('p').textContent), '59,000RSD · ≈ 502 €');
  assert.equal(n(D('z').textContent), 'from RSD 96,000/spot · ≈ 817 €/spot');
  D('s').firstChild.nodeValue = '990 RSD/mo'; D('calc').insertAdjacentHTML('beforeend', '<div id="sr">59.000 RSD</div><div id="rate">58.33 RSD/min</div><div id="ru">59 000 RSD</div>');
  fx.scan(w.document.body, { append: true });
  assert.equal(n(D('sr').textContent), '59.000 RSD · ≈ 502 €', 'serbian format on EN page');
  assert.equal(n(D('rate').textContent), '58.33 RSD/min · ≈ 0,50 €/min');
  assert.equal(n(D('ru').textContent), '59 000 RSD · ≈ 502 €');
  // kalkulator prepiše vrednost → watch ponovo dopiše
  fx.watch(w.document.body, { append: true });
  D('out').textContent = 'RSD 19,200';
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(n(D('out').textContent), 'RSD 19,200 · ≈ 163 €');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(w.document.querySelectorAll('#out .fx-a').length, 1, 'no loop, single span');
  // nazad na RSD: svi spanovi uklonjeni
  fx.set('RSD'); fx.scan(w.document.body, { append: true });
  assert.equal(w.document.querySelectorAll('.fx-a').length, 0);
  assert.equal(n(D('p').textContent), '59,000RSD');
  // place 'after' — velike cene: red ispod, kao sledeći element
  fx.set('EUR');
  D('calc').insertAdjacentHTML('beforeend', '<div id="big" class="big"><span>125.000</span><span>RSD</span></div>');
  fx.scan(w.document.body, { append: true, place: (el) => el.classList.contains('big') ? 'after' : 'inside' });
  const nx = D('big').nextElementSibling;
  assert.ok(nx && nx.classList.contains('fx-under'), 'span after');
  assert.equal(n(nx.textContent), '≈ 1.064 €');
  fx.scan(w.document.body, { append: true, place: (el) => el.classList.contains('big') ? 'after' : 'inside' });
  assert.equal(w.document.querySelectorAll('.fx-under').length, 1);
  fx.set('RSD'); fx.scan(w.document.body, { append: true, place: () => 'after' });
  assert.equal(w.document.querySelectorAll('.fx-a').length, 0);
  console.log('fx.js append: ok');
  setTimeout(() => process.exit(process.exitCode || 0), 500);
})().catch((e) => { console.error('FAIL append', e.message); process.exit(1); });

// trailing: „Oznaka: cena“
(async () => {
  const dom = new JSDOM(`<!doctype html><html lang="sr"><body>
    <div id="a">Zajednička infrastruktura: 240.000–456.000 RSD</div>
    <div id="b">Po mestu oko 185.000–239.000 RSD</div>
    <div id="c">Ukupno oko 740.000–956.000 RSD sa PDV-om</div>
    <div id="d">59.000 / 125.000 RSD</div>
    <div id="e">Zašto se procena plaća 3.500 RSD?</div>
    <p id="f">Noću ≈ 6 RSD po kWh, sa svim naknadama. Punjač u garaži tvoje zgrade, ugrađen jednom, puni svake noći.</p>
    <div id="g"><span>4 × wallbox 11 kW sa MID brojilom: 500.000 RSD</span></div>
    <div id="h">Mesto: <b>59.000 RSD</b></div></body></html>`, { url: 'https://www.evolako.rs/', runScripts: 'outside-only' });
  const w = dom.window; w.localStorage.setItem('evo:cur', 'EUR'); w.eval(SRC);
  const fx = w.FxCore.create({ brand: 'evolako', key: 'evo:cur', numLang: 'auto' });
  fx.scan(w.document.body, { append: true });
  const T = (id) => n(w.document.getElementById(id).textContent);
  assert.equal(T('a'), 'Zajednička infrastruktura: 240.000–456.000 RSD · ≈ 2.043–3.881 €');
  assert.equal(T('b'), 'Po mestu oko 185.000–239.000 RSD · ≈ 1.575–2.034 €');
  assert.equal(T('c'), 'Ukupno oko 740.000–956.000 RSD sa PDV-om · ≈ 6.298–8.137 €');
  assert.equal(T('d'), '59.000 / 125.000 RSD · ≈ 502 / 1.064 €', 'slash pair');
  assert.equal(T('e'), 'Zašto se procena plaća 3.500 RSD?', 'question untouched');
  assert.ok(!T('f').includes('€'), 'prose untouched');
  assert.equal(T('g'), '4 × wallbox 11 kW sa MID brojilom: 500.000 RSD · ≈ 4.256 €');
  assert.equal(w.document.querySelectorAll('#g .fx-a').length, 1, 'only deepest');
  assert.equal(T('h'), 'Mesto: 59.000 RSD · ≈ 502 €');
  assert.equal(w.document.querySelectorAll('#h .fx-a').length, 1);
  fx.scan(w.document.body, { append: true });
  assert.equal(w.document.querySelectorAll('.fx-a').length, 6);
  console.log('fx.js trailing: ok');
})().catch((e) => { console.error('FAIL trailing', e.message); process.exit(1); });

(async () => {
  const dom = new JSDOM(`<!doctype html><html lang="sr"><body><span id="k" style="display:flex"><span>0
1
2
3
4
5
6
7
8
9
</span><span> </span><span>R</span><span>S</span><span>D</span><span>/</span><span>k</span><span>m</span></span>
  <div id="k2">0 1 2 3 4 5 6 7 8 9 RSD/km</div></body></html>`, { url: 'https://www.evolako.rs/', runScripts: 'outside-only' });
  const w = dom.window; w.localStorage.setItem('evo:cur', 'EUR'); w.eval(SRC);
  const fx = w.FxCore.create({ brand: 'evolako', key: 'evo:cur', numLang: 'auto' });
  fx.scan(w.document.body, { append: true });
  assert.equal(w.document.querySelectorAll('.fx-a').length, 0, 'counters untouched');
  console.log('fx.js counters: ok');
})().catch((e) => { console.error('FAIL counters', e.message); process.exit(1); });

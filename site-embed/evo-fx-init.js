/*! evo-fx-init 1.0.0 — valuta prikaza na www.evolako.rs (Webflow). Treba fx.js (FxCore) pre ovoga.
 * Dinari ostaju prvi (prodajni sajt, Zakon o trgovini čl. 35); kod cene se dopisuje „· ≈ 502 €“.
 * Kurs: dokument `fx` iz javnog sadržaja Evolako (Supabase storage), bez njega — rezervni kurs iz fx.js. */
(function () {
  'use strict';
  if (window.EvoFx || !window.FxCore) return;
  var BASE = 'https://smcsmkkzdksocvroqekl.supabase.co/storage/v1/object/public/content/';

  function loadRates() {
    if (typeof fetch !== 'function') return null;
    return fetch(BASE + 'v1/manifest.json', { credentials: 'omit', cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) {
        var f = m && m.files && m.files.fx;
        if (!f || !/^v1\/[\w.-]+\.json$/.test(f.path || '')) return null;
        return fetch(BASE + f.path, { credentials: 'omit' }).then(function (r) { return r.ok ? r.json() : null; });
      });
  }

  var fx = window.FxCore.create({
    brand: 'evolako', key: 'evo:cur', numLang: 'auto', loadRates: loadRates,
    lang: function () { return document.documentElement.lang; }
  });
  window.EvoFx = fx;

  var css = '' +
    '.fx-a{white-space:nowrap;opacity:.72;font-weight:inherit}' +
    '.fx-a.fx-under{display:block;white-space:normal;font-size:14px;line-height:1.3;margin-top:4px;font-weight:500;letter-spacing:0}' +
    '.fx-switch{font:inherit;font-size:12px;font-weight:600;line-height:1;color:inherit;background-color:transparent;border:0;' +
      'border-left:1px solid rgba(127,127,127,.35);border-radius:0;padding:3px 18px 3px 9px;margin-left:6px;cursor:pointer;opacity:.8;' +
      '-webkit-appearance:none;appearance:none;' +
      'background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);' +
      'background-position:calc(100% - 9px) 55%,calc(100% - 5px) 55%;background-size:4px 4px,4px 4px;background-repeat:no-repeat}' +
    '.fx-switch:hover,.fx-switch:focus-visible{opacity:1}' +
    '.fx-switch option{color:#0B1220;background:#fff}' +
    '#evo-fx-note{max-width:1120px;margin:24px auto 0;padding:0 20px;font-size:13px;line-height:1.5;opacity:.7}' +
    '#evo-fx-note[hidden]{display:none}';
  var st = document.createElement('style');
  st.id = 'evo-fx-css';
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  var switches = [];
  function mountSwitchers() {
    var spots = document.querySelectorAll('.mega-nav__lang, .v3-lang');
    for (var i = 0; i < spots.length; i++) {
      var spot = spots[i];
      if (spot.querySelector('.fx-switch')) continue;
      var s = fx.switcher();
      spot.appendChild(s);
      switches.push(s);
    }
  }

  // velika cena (kartica paketa, 24px i više) — preračun ide u red ispod, sitnije
  function place(el) {
    var fs = parseFloat(getComputedStyle(el).fontSize) || 16;
    for (var c = el.firstElementChild; c && fs < 24; c = c.nextElementSibling) {
      if (!c.classList.contains('fx-a')) fs = Math.max(fs, parseFloat(getComputedStyle(c).fontSize) || 0);
    }
    return fs >= 24 ? 'after' : 'inside';
  }

  function note() {
    var el = document.getElementById('evo-fx-note');
    var need = fx.get() !== 'RSD' && !!document.querySelector('.fx-a');
    if (!need) { if (el) el.hidden = true; return; }
    if (!el) {
      el = document.createElement('p');
      el.id = 'evo-fx-note';
      el.setAttribute('translate', 'no');
      el.setAttribute('data-fx-skip', '');
      var foot = document.querySelector('footer, .v3-footer, .footer');
      if (foot && foot.parentNode) foot.parentNode.insertBefore(el, foot); else document.body.appendChild(el);
    }
    el.textContent = fx.note();
    el.hidden = false;
  }

  // Prevod (i18n) menja tekstualne čvorove u mestu; naš <span class="fx-a"> je poseban čvor i prevod ga ne dira.
  // Cene usred rečenice se ne preračunavaju (spec §7) — gde je cena važna, u Webflow-u je u svom <span>.
  function run() {
    fx.scan(document.body, { append: true, place: place });
    note();
  }

  function start() {
    mountSwitchers();
    run();
    fx.watch(document.body, { append: true, place: place });
    fx.on(function () { run(); });
    // prevod se menja u mestu (SR/EN/RU): osveži nazive u prekidaču, napomenu i iznose
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        for (var i = 0; i < switches.length; i++) if (switches[i].fxRefill) switches[i].fxRefill();
        setTimeout(run, 300);
      }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    }
    setTimeout(run, 700);   // posle i18n i animacija pri učitavanju
    setTimeout(run, 2500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

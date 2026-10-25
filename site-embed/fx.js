/*! fx.js 1.2.0 — valuta prikaza (RSD / EUR / USD) za sajtove Evolako i BlokVolt.
 * Spec: VALUTA_SPEC_2026-10-06.md. Default je uvek RSD; EUR/USD samo kad korisnik izabere.
 * Iznos u stranoj valuti je informativan (≈), po srednjem kursu NBS; plaća se u dinarima.
 *
 *   var fx = FxCore.create({brand:'evolako'|'blokvolt', key:'evo:cur', ratesUrl:'https://www.blokvolt.rs/api/kurs',
 *                           lang:function(){return 'sr'|'en'|'ru'},
 *                           numLang:'sr'   // opciono: brojevi u tekstu su na svim jezicima u srpskom formatu (BlokVolt);
 *                                          // 'auto' — tačka/zarez iza 3 cifre = hiljade (Webflow evolako.rs, mešoviti prevodi)
 *                          });
 *   fx.get() → 'RSD'|'EUR'|'USD';  fx.set('EUR');  fx.on(fn)
 *   fx.money(125000, {kind:'offer'|'ref', unit:'/kWh', compact:false}) → {primary, secondary, title, converted}
 *   fx.range(43, 79, {unit:'/kWh'})
 *   fx.render(root)   — elementi sa data-rsd (vidi dole)
 *   fx.scan(root,opt) — elementi čiji je ceo tekst cena („59.000 RSD“, „od 96.000 RSD/mestu“, „4–7 RSD/kWh“)
 * Izgled: <span class="fx-p">≈ 1.064 €</span><span class="fx-s"><span class="fx-sep"> · </span>125.000 RSD</span>
 * (fx-sep posebno, da CSS u uskim ćelijama može da spusti dinare u novi red bez tačke na početku).
 */
(function (root) {
  'use strict';

  var CODES = ['RSD', 'EUR', 'USD'];
  var SYM = { EUR: '€', USD: '$' };
  var NB = ' ';
  var FALLBACK = { base: 'RSD', source: 'NBS srednji kurs', date: '2026-10-05',
                   rates: { EUR: 117.4948, USD: 105.0468 }, stale: true, fallback: true };
  var BOUNDS = { EUR: [100, 140], USD: [80, 140] };
  // jedinice „po nečemu“: stope sa 2 (ili 3) decimale; ostalo (mesečno, po mestu) su iznosi.
  // Kraj reči proveravamo i za ćirilicu („/мин“, „за кВт·ч“): \b u JS regexu bez /u vidi samo latinicu.
  var PER_UNIT = /^\s*(?:\/|po\s+|per\s+|за\s+|в\s+)?(kwh|kw·h|квт·ч|min|мин|h|ч|km|км|l|л|litr|liter|литр)(?![a-z0-9а-яё])/i;

  var TX = {
    note: {
      evolako: {
        sr: 'Iznosi u evrima i dolarima su informativni, po srednjem kursu NBS na {d}. Plaćaš uvek u dinarima.',
        en: 'Amounts in euros and dollars are for reference, at the National Bank of Serbia middle rate on {d}. You always pay in dinars.',
        ru: 'Суммы в евро и долларах — справочные, по среднему курсу НБС на {d}. Платишь всегда в динарах.'
      },
      blokvolt: {
        sr: 'Iznosi u evrima i dolarima su informativni, po srednjem kursu NBS na {d}. Na punjačima i u računima cene su u dinarima.',
        en: 'Amounts in euros and dollars are for reference, at the National Bank of Serbia middle rate on {d}. Chargers and bills charge in dinars.',
        ru: 'Суммы в евро и долларах — справочные, по среднему курсу НБС на {d}. На зарядках и в счетах цены в динарах.'
      }
    },
    title: {
      sr: 'Preračunato po kursu NBS na {d}. Cena u dinarima: {rsd}.',
      en: 'Converted at the NBS rate on {d}. Price in dinars: {rsd}.',
      ru: 'Пересчитано по курсу НБС на {d}. Цена в динарах: {rsd}.'
    },
    label: { sr: 'Valuta', en: 'Currency', ru: 'Валюта' },
    names: {
      sr: { RSD: 'RSD — dinar', EUR: 'EUR — evro', USD: 'USD — dolar' },
      en: { RSD: 'RSD — Serbian dinar', EUR: 'EUR — euro', USD: 'USD — US dollar' },
      ru: { RSD: 'RSD — динар', EUR: 'EUR — евро', USD: 'USD — доллар' }
    }
  };

  // ------------------------------------------------------------------ brojevi (srpski format)

  function roundHalfUp(v, d) {
    var f = Math.pow(10, d);
    var r = Math.round(Number((Math.abs(v) * f).toPrecision(15))) / f;
    return (v < 0 ? -r : r) || 0;
  }
  function num(v, d) {
    var r = roundHalfUp(v, d);
    var parts = Math.abs(r).toFixed(d).split('.');
    var s = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.') + (parts[1] ? ',' + parts[1] : '');
    return (r < 0 ? '−' : '') + s;
  }
  function decimalsFor(v, isRate) {
    var a = Math.abs(v);
    if (isRate) return a < 0.10 ? 3 : 2;
    return a >= 100 ? 0 : 2;
  }
  function rsdText(v, unit) {
    var a = Math.abs(v);
    var d = (Math.round(a) === a) ? 0 : 2;
    return num(v, d) + NB + 'RSD' + (unit || '');
  }
  function ddmmyyyy(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
    return m ? m[3] + '.' + m[2] + '.' + m[1] : '';
  }
  function isRateUnit(unit) { return !!unit && PER_UNIT.test(unit.replace(/^\s*\//, '/')); }

  // Parsiranje cene iz teksta stranice. Jezik određuje separatore: sr/ru „1.440“/„1 440“ i „58,33“; en „1,440“ i „58.33“.
  function parseNumber(s, lang) {
    s = String(s).replace(/[\s  ]/g, '');
    if (lang === 'au') {
      // „auto“: separator iza kog su tačno 3 cifre je hiljadarski, iza 1–2 cifre decimalni (cene u RSD nemaju 3 decimale)
      s = s.replace(/[.,](?=\d{3}(\D|$))/g, '').replace(',', '.');
    } else if (lang === 'en') s = s.replace(/,(?=\d{3}(\D|$))/g, '');
    else s = s.replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    var v = parseFloat(s);
    return isFinite(v) ? v : null;
  }

  // ------------------------------------------------------------------ jezgro

  function create(cfg) {
    cfg = cfg || {};
    var brand = cfg.brand === 'blokvolt' ? 'blokvolt' : 'evolako';
    var key = cfg.key || 'fx:cur';
    var rateKey = key + ':kurs';
    var listeners = [];
    var rates = FALLBACK;
    var cur = 'RSD';

    function lang() {
      var l = (cfg.lang ? cfg.lang() : (document.documentElement.lang || 'sr')) || 'sr';
      l = String(l).slice(0, 2).toLowerCase();
      return l === 'en' || l === 'ru' ? l : 'sr';
    }
    // Format brojeva u tekstu stranice (scan): po jeziku stranice, osim kad sajt na svim jezicima piše srpski
    // format („5.000 RSD“ i na /en/) — tada cfg.numLang: 'sr'.
    function numLang() {
      var l = typeof cfg.numLang === 'function' ? cfg.numLang() : cfg.numLang;
      l = String(l || '').slice(0, 2).toLowerCase();
      return l === 'sr' || l === 'en' || l === 'ru' || l === 'au' ? l : lang();
    }
    function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
    function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
    function valid(r) {
      if (!r || !r.rates || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '')) return false;
      for (var c in BOUNDS) {
        var v = Number(r.rates[c]);
        if (!(v >= BOUNDS[c][0] && v <= BOUNDS[c][1])) return false;
      }
      return true;
    }

    // izbor: ?cur= u adresi > sačuvano > RSD
    (function init() {
      var fromUrl = null;
      try { fromUrl = new URLSearchParams(location.search).get('cur'); } catch (e) {}
      if (fromUrl) {
        fromUrl = fromUrl.toUpperCase();
        if (CODES.indexOf(fromUrl) >= 0) store(key, fromUrl === 'RSD' ? null : fromUrl);
      }
      var saved = (load(key) || '').toUpperCase();
      cur = CODES.indexOf(saved) >= 0 ? saved : 'RSD';
      try {
        var cached = JSON.parse(load(rateKey) || 'null');
        if (cached && valid(cached.r)) rates = cached.r;
      } catch (e) {}
    })();

    function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](cur, rates); } catch (e) {} } }

    // Kurs: cfg.ratesUrl (JSON po spec §2) ili cfg.loadRates() → Promise; keš 6 h, i neuspeh se pamti 1 h.
    function refreshRates() {
      if (!cfg.ratesUrl && !cfg.loadRates) return;
      var cached = null;
      try { cached = JSON.parse(load(rateKey) || 'null'); } catch (e) {}
      if (cached && valid(cached.r) && Date.now() - cached.t < 6 * 3600 * 1000) return;
      var tried = Number(load(rateKey + ':try') || 0);
      if (Date.now() - tried < 3600 * 1000) return;
      store(rateKey + ':try', String(Date.now()));
      var p = cfg.loadRates ? cfg.loadRates()
        : (typeof fetch === 'function' ? fetch(cfg.ratesUrl, { mode: 'cors', credentials: 'omit' })
            .then(function (r) { return r.ok ? r.json() : null; }) : null);
      if (!p || typeof p.then !== 'function') return;
      p.then(function (r) {
        if (!valid(r)) return;
        var changed = r.date !== rates.date || Number(r.rates.EUR) !== rates.rates.EUR || Number(r.rates.USD) !== rates.rates.USD;
        rates = { base: 'RSD', source: r.source || 'NBS srednji kurs', date: r.date,
                  rates: { EUR: Number(r.rates.EUR), USD: Number(r.rates.USD) }, stale: !!r.stale };
        store(rateKey, JSON.stringify({ t: Date.now(), r: rates }));
        store(rateKey + ':try', null);
        if (changed && cur !== 'RSD') emit();
      }).catch(function () {});
    }

    function convert(rsd) { return cur === 'RSD' ? rsd : rsd / rates.rates[cur]; }

    function title(rsdStr) {
      return TX.title[lang()].replace('{d}', ddmmyyyy(rates.date)).replace('{rsd}', rsdStr);
    }

    // jedna suma → {primary, secondary, title, converted}
    function money(rsd, o) {
      o = o || {};
      var unit = o.unit || '';
      var orig = o.rsdText || rsdText(rsd, unit);
      if (cur === 'RSD' || rsd == null || !isFinite(rsd)) return { primary: orig, secondary: '', title: '', converted: false };
      var v = convert(rsd);
      var isRate = o.rate != null ? o.rate : isRateUnit(unit);
      var fx = (v === 0 ? '' : '≈' + NB) + num(v, v === 0 ? 0 : decimalsFor(v, isRate)) + NB + SYM[cur] + unit;
      return pack(fx, orig, o);
    }
    function range(lo, hi, o) {
      o = o || {};
      var unit = o.unit || '';
      var orig = o.rsdText || (num(lo, lo % 1 ? 2 : 0) + '–' + rsdText(hi, unit));
      if (cur === 'RSD') return { primary: orig, secondary: '', title: '', converted: false };
      var a = convert(lo), b = convert(hi);
      if (num(a, 2) === num(b, 2)) return money(lo, o);
      var isRate = o.rate != null ? o.rate : isRateUnit(unit);
      var d = decimalsFor(Math.min(Math.abs(a), Math.abs(b)), isRate);
      var fx = '≈' + NB + num(a, d) + '–' + num(b, d) + NB + SYM[cur] + unit;
      return pack(fx, orig, o);
    }
    function pack(fx, orig, o) {
      var t = title(orig);
      if (o.compact) return { primary: fx, secondary: '', title: t, converted: true };
      if (o.kind === 'offer') return { primary: orig, secondary: fx, title: t, converted: true };
      return { primary: fx, secondary: orig, title: t, converted: true };
    }

    // ---------------------------------------------------------------- DOM

    var ORIG = typeof WeakMap === 'function' ? new WeakMap() : null;
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    // ORIG: el → {html, title: original pre preračuna; cur: sadržaj koji element sada treba da ima; out: naš poslednji HTML}.
    // Ako je stranica u međuvremenu sama prepisala element (kalkulator piše novi iznos), njen novi sadržaj je novi original —
    // inače bi povratak na RSD vratio stari iznos.
    function paint(el, res) {
      var saved = ORIG ? ORIG.get(el) : null;
      if (saved && el.innerHTML !== saved.cur) {
        saved = { html: el.innerHTML, title: el.getAttribute('data-fx-on') === '1' ? saved.title : el.getAttribute('title') };
        el.removeAttribute('data-fx-on');
        ORIG.set(el, saved);
      }
      if (ORIG && !saved) { saved = { html: el.innerHTML, title: el.getAttribute('title') }; ORIG.set(el, saved); }
      if (!res.converted) {
        if (saved && el.getAttribute('data-fx-on') === '1') {
          el.innerHTML = saved.html;
          if (saved.title == null) el.removeAttribute('title'); else el.setAttribute('title', saved.title);
        }
        el.removeAttribute('data-fx-on');
        if (saved) { saved.cur = el.innerHTML; saved.out = null; }
        return;
      }
      var kind = el.getAttribute('data-kind') || el.getAttribute('data-fx-kind') || 'ref';
      var sep = '<span class="fx-sep"> · </span>';
      var html;
      if (kind === 'offer' && saved && !el.hasAttribute('data-compact')) {
        html = saved.html + '<span class="fx-s" translate="no">' + sep + esc(res.secondary) + '</span>';
      } else {
        html = '<span class="fx-p" translate="no">' + esc(res.primary) + '</span>' +
               (res.secondary ? '<span class="fx-s" translate="no">' + sep + esc(res.secondary) + '</span>' : '');
      }
      if (!saved || saved.out !== html || el.getAttribute('data-fx-on') !== '1') {
        el.innerHTML = html;
        if (saved) { saved.out = html; saved.cur = el.innerHTML; }
      }
      if (el.getAttribute('title') !== res.title) el.setAttribute('title', res.title);
      el.setAttribute('data-fx-on', '1');
    }

    // <span data-rsd="125000" data-kind="offer" data-unit="/mes">125.000 RSD/mes</span>
    // <span data-rsd-lo="43" data-rsd-hi="79" data-unit="/kWh">43–79 RSD/kWh</span>   data-compact — samo preračun
    function render(scope) {
      scope = scope || document;
      var els = scope.querySelectorAll('[data-rsd],[data-rsd-lo]');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        var o = { kind: el.getAttribute('data-kind') || 'ref', unit: el.getAttribute('data-unit') || '',
                  compact: el.hasAttribute('data-compact') };
        if (el.getAttribute('data-rate') != null) o.rate = el.getAttribute('data-rate') !== '0';
        var res = el.hasAttribute('data-rsd-lo')
          ? range(Number(el.getAttribute('data-rsd-lo')), Number(el.getAttribute('data-rsd-hi')), o)
          : money(Number(el.getAttribute('data-rsd')), o);
        paint(el, res);
      }
    }

    // Prepoznavanje cena u gotovom tekstu (Webflow): element čiji je CEO tekst jedna cena.
    var NUMRE = '\\d{1,3}(?:[.,\\s\\u00a0\\u202f]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?';
    // jedinica („/kWh“, „po kWh“, „/mes“) i najviše tri reči posle nje („mesečno“, „sa PDV-om“)
    var UNITRE = '((?:\\s*(?:\\/\\s*[\\p{L}·.]+|po\\s+[\\p{L}·]+|per\\s+[\\p{L}·]+|за\\s+[\\p{L}·]+|в\\s+[\\p{L}·]+))?(?:\\s+[\\p{L}][\\p{L}-]*){0,3})';
    var PRICE_RE;
    try {
      PRICE_RE = new RegExp('^(od|from|от|do|up to|до|≈|~)?\\s*(?:RSD\\s*)?(' + NUMRE + ')(?:\\s*[–-]\\s*(' + NUMRE + '))?\\s*(RSD)?' + UNITRE + '\\s*$', 'iu');
    } catch (e) { PRICE_RE = null; }

    // „Oznaka: 240.000–456.000 RSD“, „Po mestu oko 185.000 RSD“: kratak tekst koji se ZAVRŠAVA cenom
    var TRAIL_RE;
    try {
      TRAIL_RE = new RegExp('(?:^|\\s)((?:' + NUMRE + ')(?:\\s*[–-]\\s*(?:' + NUMRE + '))?\\s*RSD(?:\\s*\\/\\s*[\\p{L}·.]+)?)(?:\\s+[\\p{L}][\\p{L}-]*){0,3}\\s*$', 'u');
    } catch (e) { TRAIL_RE = null; }
    // „59.000 / 125.000 RSD“ → „≈ 502 / 1.064 €“
    var SLASH_RE;
    try { SLASH_RE = new RegExp('^((?:' + NUMRE + '))\\s*\\/\\s*((?:' + NUMRE + '))\\s*RSD\\s*$', 'u'); } catch (e) { SLASH_RE = null; }
    function slashPrice(text, l) {
      if (!SLASH_RE || cur === 'RSD') return null;
      var t = text.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
      var m = SLASH_RE.exec(t);
      if (!m) return null;
      var a = parseNumber(m[1], l), b = parseNumber(m[2], l);
      if (a == null || b == null) return null;
      var ca = convert(a), cb = convert(b), d = decimalsFor(Math.min(ca, cb), false);
      return { converted: true, primary: t, secondary: '\u2248' + NB + num(ca, d) + ' / ' + num(cb, d) + NB + SYM[cur], title: title(t) };
    }
    function trailingPrice(text, l) {
      if (!TRAIL_RE) return null;
      var t = text.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
      if (t.length > 90 || (t.match(/RSD/g) || []).length !== 1) return null;
      var m = TRAIL_RE.exec(t);
      if (!m) return null;
      var before = t.slice(0, m.index);
      if ( /[\/×x]\s*$/.test(before.trim()) || /\d\s*\/?\s*$/.test(before)) return null;   // „59.000 / 125.000“, brojač „0 1 2 … 9“
      return parsePrice(m[1], l);
    }

    function parsePrice(text, l) {
      if (!PRICE_RE) return null;
      var t = text.replace(/[\s  ]+/g, ' ').trim();
      if (!/RSD/.test(t) || t.length > 48) return null;
      var m = PRICE_RE.exec(t);
      if (!m) return null;
      var lo = parseNumber(m[2], l), hi = m[3] ? parseNumber(m[3], l) : null;
      if (lo == null) return null;
      var u = (m[5] || '').replace(/\s+/g, ' ').trim();
      if (u && u.charAt(0) === '/') u = u.replace(/^\/\s*/, '/');
      else if (u) u = ' ' + u;
      return { prefix: m[1] || '', lo: lo, hi: hi, unit: u };
    }

    var SKIP = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|BUTTON|svg|SVG)$/;

    // Režim „dopiši“ (opt.append, za Webflow sa prevodom u mestu): originalni čvorovi elementa se ne diraju —
    // na kraj se dodaje <span class="fx-s fx-a"> · ≈ 502 €</span>. Dinari ostaju prvi (kao kind 'offer').
    function textOf(el) {
      var t = el.textContent || '';
      var a = el.querySelectorAll('.fx-a');
      for (var i = 0; i < a.length; i++) t = t.replace(a[i].textContent, '');
      return t;
    }
    // place: 'inside' (na kraj elementa) ili 'after' (odmah posle elementa — za velike cene u flex redovima)
    // „/mestu sa PDV“ → „/mestu“, „ po kWh“ ostaje, „ mesečno“/„ sa PDV“ → ''
    function unitOnly(u) {
      if (!u) return '';
      var m = /^\/[^\s]+/.exec(u); if (m) return m[0].replace(/[.,;:]+$/, '');
      m = /^\s(?:po|per|за|в)\s+[^\s]+/i.exec(u); return m ? m[0] : '';
    }
    function findAppend(el) {
      for (var c = el.lastElementChild; c; c = c.previousElementSibling) {
        if (c.classList && c.classList.contains('fx-a')) return c;
      }
      var nx = el.nextElementSibling;
      return nx && nx.classList && nx.classList.contains('fx-a') && nx.getAttribute('data-fx-for') === '1' ? nx : null;
    }
    function paintAppend(el, res, place) {
      var span = findAppend(el);
      if (!res.converted) {
        if (span) span.parentNode.removeChild(span);
        el.removeAttribute('data-fx-on');
        return;
      }
      var after = place === 'after';
      if (span && (span.parentNode === el) === after) { span.parentNode.removeChild(span); span = null; }
      if (!span) {
        span = document.createElement(after ? 'div' : 'span');
        span.className = 'fx-s fx-a' + (after ? ' fx-under' : '');
        span.setAttribute('translate', 'no');
        span.setAttribute('data-fx-skip', '');
        if (after) { span.setAttribute('data-fx-for', '1'); el.insertAdjacentElement('afterend', span); }
        else el.appendChild(span);
      }
      var html = (after ? '' : '<span class="fx-sep"> · </span>') + esc(res.secondary);
      if (span.innerHTML !== html) span.innerHTML = html;
      if (span.getAttribute('title') !== res.title) span.setAttribute('title', res.title);
      if (el.getAttribute('data-fx-on') !== '1') el.setAttribute('data-fx-on', '1');
    }

    function scan(scope, opt) {
      opt = opt || {};
      scope = scope || document.body;
      if (!scope) return;
      if (cur === 'RSD' && !scope.querySelector('[data-fx-on]')) return;
      var l = numLang();
      var all = scope.querySelectorAll(opt.selector || '*');
      if (opt.append) {
        for (var j = 0; j < all.length; j++) {
          var e = all[j];
          if (SKIP.test(e.tagName) || e.closest('[data-fx-skip],.fx-s,.fx-p,.fx-switch')) continue;
          var tx = textOf(e);
          if (tx.indexOf('RSD') < 0) continue;
          // animirani brojači / „split text“ (svako slovo u svom elementu) — ne diramo
          var singles = 0;
          for (var c1 = e.firstElementChild; c1 && singles < 4; c1 = c1.nextElementSibling) if ((c1.textContent || '').trim().length === 1) singles++;
          if (singles >= 4 || /\d\s*\n\s*\d/.test(tx)) continue;
          var pp = parsePrice(tx, l), trail = false;
          var kk = e.children, dd = false;
          if (!pp && opt.trailing !== false) {
            for (var q0 = 0; q0 < kk.length; q0++) {
              if (kk[q0].classList && kk[q0].classList.contains('fx-a')) continue;
              if (textOf(kk[q0]).indexOf('RSD') >= 0) { dd = true; break; }   // samo najdublji element sa cenom
            }
            if (!dd) { pp = trailingPrice(tx, l); trail = !!pp; }
          }
          if (!pp) {
            var sp = !dd && slashPrice(tx, l);
            if (sp) { paintAppend(e, sp, opt.place ? opt.place(e) : 'inside'); continue; }
            if (e.getAttribute('data-fx-on') === '1') paintAppend(e, { converted: false });
            continue;
          }
          for (var q = 0; q < kk.length && !trail; q++) {
            if (kk[q].classList && kk[q].classList.contains('fx-a')) continue;
            if (parsePrice(textOf(kk[q]), l)) { dd = true; break; }
          }
          if (dd) continue;
          var oo = { kind: 'offer', unit: unitOnly(pp.unit), rsdText: tx.replace(/\s+/g, ' ').trim().replace(/(\d)(RSD)/, '$1 $2') };
          if (trail) oo.rsdText = (pp.hi != null ? pp.lo + '–' + pp.hi : '' + pp.lo).replace('.', ',') + ' RSD' + (pp.unit || '');
          paintAppend(e, pp.hi != null ? range(pp.lo, pp.hi, oo) : money(pp.lo, oo), trail ? 'inside' : (opt.place ? opt.place(e) : 'inside'));
        }
        return;
      }
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        if (SKIP.test(el.tagName) || el.closest('[data-fx-skip],.fx-s,.fx-p,.fx-switch')) continue;
        if (el.hasAttribute('data-rsd') || el.hasAttribute('data-rsd-lo')) continue;
        var auto = el.getAttribute('data-fx-auto');
        var sv = ORIG ? ORIG.get(el) : null;
        var text = auto === '1' && sv && el.getAttribute('data-fx-on') === '1' && el.innerHTML === sv.cur
          ? (function () { var d = document.createElement('div'); d.innerHTML = sv.html; return d.textContent; })()
          : el.textContent;
        if (!text || text.indexOf('RSD') < 0) continue;
        // najdublji element: nijedno dete samo za sebe nije cela cena
        var p = parsePrice(text, l);
        if (!p) continue;
        if (auto !== '1') {
          var kids = el.children, deeper = false;
          for (var k = 0; k < kids.length; k++) { if (parsePrice(kids[k].textContent || '', l)) { deeper = true; break; } }
          if (deeper) continue;
        }
        el.setAttribute('data-fx-auto', '1');
        var o = { kind: opt.kind || el.getAttribute('data-fx-kind') || 'ref', unit: p.unit, rsdText: text.replace(/\s+/g, ' ').trim() };
        if (opt.compact) o.compact = true;
        var res = p.hi != null ? range(p.lo, p.hi, o) : money(p.lo, o);
        if (res.converted && p.prefix && !/^[≈~]$/.test(p.prefix) && o.kind !== 'offer' && !o.compact) res.primary = p.prefix + ' ' + res.primary;
        if (o.kind === 'offer') el.setAttribute('data-fx-kind', 'offer');
        paint(el, res);
      }
    }

    // Dinamični sadržaj (kalkulatori, karta): ponovo skeniraj posle izmena; tuđa izmena našeg elementa → zaboravi original.
    function watch(scope, opt) {
      if (typeof MutationObserver !== 'function') return null;
      scope = scope || document.body;
      var timer = null;
      var mo = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var t = records[i].target;
          var el = t.nodeType === 1 ? t : t.parentElement;
          var host = el && el.closest ? el.closest('[data-fx-on]') : null;
          if (host && !host.querySelector('.fx-p,.fx-s') && ORIG) {
            ORIG.delete(host); host.removeAttribute('data-fx-on'); host.removeAttribute('data-fx-auto');
          }
        }
        clearTimeout(timer);
        timer = setTimeout(function () { scan(scope, opt); render(scope); mo.takeRecords(); }, 120);
      });
      mo.observe(scope, { childList: true, characterData: true, subtree: true });
      return mo;
    }

    function note() {
      return TX.note[brand][lang()].replace('{d}', ddmmyyyy(rates.date));
    }

    function set(code) {
      code = String(code || '').toUpperCase();
      if (CODES.indexOf(code) < 0 || code === cur) return;
      var from = cur;
      cur = code;
      store(key, code === 'RSD' ? null : code);
      if (cfg.track) { try { cfg.track('currency_changed', { from: from, to: code, surface: 'site' }); } catch (e) {} }
      emit();
    }

    // Prekidač: <select class="fx-switch"> sa RSD / EUR / USD (kratko u polju, puni nazivi u listi)
    function switcher(o) {
      o = o || {};
      var s = document.createElement('select');
      s.className = 'fx-switch' + (o.className ? ' ' + o.className : '');
      s.setAttribute('translate', 'no');
      s.setAttribute('data-fx-skip', '');
      function fill() {
        var l = lang(), names = TX.names[l];
        s.setAttribute('aria-label', TX.label[l]);
        s.title = TX.label[l];
        s.innerHTML = '';
        for (var i = 0; i < CODES.length; i++) {
          var op = document.createElement('option');
          op.value = CODES[i];
          op.textContent = o.long ? names[CODES[i]] : CODES[i];
          if (CODES[i] === cur) op.selected = true;
          s.appendChild(op);
        }
      }
      fill();
      s.addEventListener('change', function () { set(s.value); });
      on(function () { if (s.value !== cur) s.value = cur; });
      s.fxRefill = fill;
      return s;
    }

    function on(fn) { listeners.push(fn); }

    refreshRates();

    return {
      get: function () { return cur; }, set: set, on: on, rates: function () { return rates; },
      money: money, range: range, render: render, scan: scan, watch: watch, note: note, switcher: switcher,
      lang: lang, refreshRates: refreshRates,
      _num: num, _parse: parsePrice, _parseNumber: parseNumber
    };
  }

  var api = { create: create, CODES: CODES, FALLBACK: FALLBACK, TX: TX, _num: num };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FxCore = api;
})(typeof window !== 'undefined' ? window : this);

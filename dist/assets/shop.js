/* Evolako shop: reservation list, compare, filters, search, overnight calculator, finder, forms.
   Plain JS, no dependencies. Storage is a convenience: every read and write is guarded. */
(function () {
  'use strict';
  var D = {};
  try { D = JSON.parse(document.getElementById('evo-data').textContent); } catch (e) { return; }
  var T = D.t, LANG = D.lang, IDX = D.idx || [], BY = {}, onIdx = [], SPR = D.spr || '';
  function indexBy() { BY = {}; IDX.forEach(function (p) { BY[p.id] = p; }); }
  indexBy();
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  // ---------- storage ----------
  var mem = {};
  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return mem[k] || d; } }
  function save(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  // ---------- formatting ----------
  function fmt(n) {
    var s = String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, LANG === 'sr' ? '.' : (LANG === 'ru' ? ' ' : ','));
    return LANG === 'en' ? 'RSD ' + s : s + ' RSD';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function ill(p, cls) {
    if (p.img) return '<img class="ill-photo ' + (cls || '') + '" src="' + p.img + '" alt="" loading="lazy" decoding="async">';
    return '<svg class="ill ' + (cls || '') + '" viewBox="0 0 240 240" style="' + p.sv + '" aria-hidden="true"><use href="' + SPR + '#ill-' + p.form + '"/></svg>';
  }

  // ---------- toast ----------
  var toast = $('#toast'), toastTimer;
  function showToast(html) {
    if (!toast) return;
    toast.innerHTML = html; toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 3600);
  }

  // ---------- reservation list ----------
  function cart() { return load('evo_cart', []); }
  function setCart(c) { save('evo_cart', c); renderCount(); }
  function renderCount() {
    var n = cart().reduce(function (a, l) { return a + (l.q || 1); }, 0);
    $$('[data-cart-count]').forEach(function (el) { el.textContent = n; el.setAttribute('data-n', n); });
  }
  function addToCart(id, inst) {
    var c = cart(), found = null;
    c.forEach(function (l) { if (l.id === id && !!l.i === !!inst) found = l; });
    if (found) found.q = Math.min(20, (found.q || 1) + 1); else c.push({ id: id, q: 1, i: !!inst });
    setCart(c);
    showToast('<span>' + esc(T.toast_added) + '</span><a href="' + D.urls.cart + '">' + esc(T.toast_view) + '</a>');
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-add]');
    if (!b) return;
    ev.preventDefault();
    var inst = false;
    var form = b.closest('[data-buy]');
    if (form) { var r = form.querySelector('input[name="opt"]:checked'); inst = !!(r && r.value === 'inst'); }
    addToCart(b.getAttribute('data-add'), inst);
  });
  renderCount();

  // ---------- compare ----------
  function cmp() { return load('evo_cmp', []); }
  function setCmp(c) { save('evo_cmp', c); syncCmp(); }
  function syncCmp() {
    var c = cmp();
    $$('[data-cmp]').forEach(function (b) {
      var on = c.indexOf(b.getAttribute('data-cmp')) >= 0;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.setAttribute('aria-label', on ? T.cmp_rm : T.cmp_add);
      b.title = on ? T.cmp_rm : T.cmp_add;
    });
    var tray = $('#tray');
    if (tray && !document.body.hasAttribute('data-page-compare')) {
      tray.classList.toggle('show', c.length > 0);
      $('.thumbs', tray).innerHTML = c.map(function (id) { return BY[id] ? '<span>' + ill(BY[id]) + '</span>' : ''; }).join('');
      $('[data-tray-n]', tray).textContent = c.length;
    }
  }
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-cmp]');
    if (b) {
      ev.preventDefault();
      var id = b.getAttribute('data-cmp'), c = cmp(), i = c.indexOf(id);
      if (i >= 0) c.splice(i, 1);
      else { if (c.length >= 4) { showToast('<span>' + esc(T.cmp_max) + '</span>'); return; } c.push(id); }
      setCmp(c);
      return;
    }
    if (ev.target.closest('[data-cmp-clear]')) { ev.preventDefault(); setCmp([]); renderCompare(); }
  });
  syncCmp();
  onIdx.push(syncCmp);

  // ---------- drawers (menu, filters) ----------
  function openDrawer(id) {
    var d = document.getElementById(id); if (!d) return;
    d.classList.add('open'); document.documentElement.style.overflow = 'hidden';
    var f = d.querySelector('a,button,input'); if (f) f.focus();
  }
  function closeDrawers() {
    $$('.drawer.open').forEach(function (d) { d.classList.remove('open'); });
    $$('.search.open').forEach(function (d) { d.classList.remove('open'); });
    document.documentElement.style.overflow = '';
  }
  document.addEventListener('click', function (ev) {
    var o = ev.target.closest('[data-open]');
    if (o) { ev.preventDefault(); if (o.getAttribute('data-open') === 'search') openSearch(); else openDrawer(o.getAttribute('data-open')); return; }
    if (ev.target.closest('[data-close]') || ev.target.classList.contains('drawer-scrim')) { ev.preventDefault(); closeDrawers(); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closeDrawers(); });

  // ---------- search ----------
  var sBox = $('#search'), sIn = $('#search-q'), sRes = $('#search-res');
  function norm(s) { return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'dj'); }
  function openSearch() { if (!sBox) return; sBox.classList.add('open'); document.documentElement.style.overflow = 'hidden'; sIn.value = ''; runSearch(); setTimeout(function () { sIn.focus(); }, 30); }
  function runSearch() {
    var q = norm(sIn.value.trim());
    var words = q.split(/\s+/).filter(Boolean);
    var list = IDX.filter(function (p) {
      if (!words.length) return p.feat;
      var hay = norm(p.name + ' ' + p.brand + ' ' + p.model + ' ' + p.facts.join(' ') + ' ' + p.catn);
      return words.every(function (w) { return hay.indexOf(w.replace(',', '.')) >= 0 || hay.indexOf(w) >= 0; });
    }).slice(0, 8);
    sRes.innerHTML = list.length ? list.map(function (p, i) {
      return '<a href="' + p.url + '"' + (i === 0 ? ' class="active"' : '') + '><span class="stage">' + ill(p) + '</span><span class="t"><b>' + esc(p.name) + '</b><span>' + esc(p.facts.slice(0, 3).join(', ')) + '</span></span><span class="p">' + esc(p.ptxt) + '</span></a>';
    }).join('') : '<p class="muted" style="padding:12px 8px">' + esc(T.search_none) + '</p>';
  }
  if (sIn) {
    sIn.addEventListener('input', runSearch);
    sIn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { var a = sRes.querySelector('a'); if (a) location.href = a.href; } });
  }

  // ---------- listing v7: facets, price range, quick picks, chips, sort, URL ----------
  var listing = $('[data-listing]');
  var CD = null;
  try { CD = JSON.parse(($('#cat-data') || {}).textContent || 'null'); } catch (e) { CD = null; }
  if (listing && CD) (function () {
    var L = CD.l, items = CD.items, ITEM = {}, cardOf = {};
    items.forEach(function (it) { ITEM[it.id] = it; });
    $$('.card[data-id]', listing).forEach(function (c) { cardOf[c.getAttribute('data-id')] = c; });
    var grid = $('[data-grid]', listing), panel = $('#fpanel'), countEl = $('[data-count]', listing), sortSel = $('[data-sort]', listing);
    var facets = {}; CD.facets.forEach(function (f) { facets[f.key] = f; });
    var sel = {}, price = null, sortMode = 'rec';
    var range = $('[data-range]', listing), pr = facets.price || null;
    var fmtN = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, LANG === 'sr' ? '.' : (LANG === 'ru' ? ' ' : ',')); };

    function matches(it, skip) {
      for (var k in sel) {
        if (k === skip || !sel[k].length) continue;
        var vals = it.f[k] || [];
        if (!sel[k].some(function (x) { return vals.indexOf(x) >= 0; })) return false;
      }
      if (price && skip !== 'price') {
        if (!it.price || it.price < price[0] || it.price > price[1]) return false;
      }
      return true;
    }
    function selCount() { var n = 0; for (var k in sel) n += sel[k].length; return n + (price ? 1 : 0); }

    function apply(push) {
      var shown = 0;
      items.forEach(function (it) { var ok = matches(it); var c = cardOf[it.id]; if (c) c.hidden = !ok; if (ok) shown++; });
      // live counts per option: what you would get if you also ticked it
      $$('input[data-f]', panel).forEach(function (inp) {
        var k = inp.getAttribute('data-f'), v = inp.value, n = 0;
        items.forEach(function (it) { if ((it.f[k] || []).indexOf(v) >= 0 && matches(it, k)) n++; });
        var lab = inp.closest('.fo'); var ne = $('[data-n]', lab);
        if (ne) ne.textContent = n;
        lab.classList.toggle('zero', n === 0 && !inp.checked);
        inp.disabled = n === 0 && !inp.checked;
      });
      $$('details.fgroup', panel).forEach(function (d) {
        var k = d.getAttribute('data-group'), g = $('[data-gsel]', d), n = k === 'price' ? (price ? 1 : 0) : (sel[k] || []).length;
        if (g) g.textContent = n ? String(n) : '';
      });
      if (range) hist();
      var total = items.length, any = selCount() > 0;
      if (countEl) countEl.textContent = any ? L.count_f.replace('{n}', shown).replace('{t}', total) : L.count_all.replace('{n}', total).replace('{w}', plural(total, CD.nprod));
      $$('[data-show]').forEach(function (b) { b.textContent = shown ? L.show_n.replace('{n}', shown) : L.show_0; b.disabled = !shown; });
      var badge = $('[data-fbadge]', listing); if (badge) { badge.hidden = !any; badge.textContent = selCount(); }
      var empty = $('[data-empty]', listing); if (empty) empty.classList.toggle('show', shown === 0);
      chips(); quickState(); sortCards();
      if (push !== false) writeUrl();
    }

    function chips() {
      var box = $('[data-applied]', listing), list = $('[data-applied-list]', listing), html = '';
      for (var k in sel) sel[k].forEach(function (v) {
        var t = (facets[k] && facets[k].opts && facets[k].opts[v]) || v;
        html += '<button class="achip" type="button" data-rm-k="' + esc(k) + '" data-rm-v="' + esc(v) + '" aria-label="' + esc(L.rm.replace('{x}', t)) + '">' + esc(t) + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>';
      });
      if (price) {
        var pt = fmtN(price[0]) + ' – ' + fmtN(price[1]) + ' RSD';
        html += '<button class="achip" type="button" data-rm-k="price" aria-label="' + esc(L.rm.replace('{x}', pt)) + '">' + esc(pt) + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>';
      }
      if (list) list.innerHTML = html;
      if (box) box.hidden = !html;
    }

    function quickState() {
      $$('[data-qk]', listing).forEach(function (b) {
        var k = b.getAttribute('data-qk'), v = b.getAttribute('data-qv'), on;
        if (k === 'price') on = !!price && price[1] === +v && price[0] === pr.min;
        else on = (sel[k] || []).indexOf(v) >= 0;
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    }

    function leadOf(id) { return (ITEM[id] || {}).lead || 999; }
    function sortCards() {
      var cards = items.map(function (it) { return cardOf[it.id]; }).filter(Boolean);
      var m = sortMode;
      cards.sort(function (a, b) {
        var A = ITEM[a.getAttribute('data-id')], B = ITEM[b.getAttribute('data-id')];
        var pa = A.price || 0, pb = B.price || 0;
        if (m === 'pa') return (pa || 1e12) - (pb || 1e12) || A.rank - B.rank;
        if (m === 'pd') return (pb || -1) - (pa || -1) || A.rank - B.rank;
        if (m === 'kw') return (B.kw - A.kw) || (pa || 1e12) - (pb || 1e12);
        if (m === 'lead') return (A.lead - B.lead) || (pa || 1e12) - (pb || 1e12);
        return A.rank - B.rank || (pa || 1e12) - (pb || 1e12);
      });
      cards.forEach(function (c) { grid.appendChild(c); });
    }

    // --- price range with a small histogram of the products that match the other filters
    var lo, hi, loIn, hiIn;
    if (range && pr) {
      lo = $('[data-lo]', range); hi = $('[data-hi]', range); loIn = $('[data-lo-in]', range); hiIn = $('[data-hi-in]', range);
      var setFill = function () {
        var a = (+lo.value - pr.min) / (pr.max - pr.min), b = (+hi.value - pr.min) / (pr.max - pr.min);
        range.style.setProperty('--a', a.toFixed(4)); range.style.setProperty('--b', b.toFixed(4));
      };
      var fromSliders = function (which) {
        var a = +lo.value, b = +hi.value;
        if (a > b) { if (which === 'lo') lo.value = b; else hi.value = a; a = +lo.value; b = +hi.value; }
        loIn.value = fmtN(a); hiIn.value = fmtN(b); setFill();
        price = (a <= pr.min && b >= pr.max) ? null : [a, b];
      };
      lo.addEventListener('input', function () { fromSliders('lo'); apply(false); });
      hi.addEventListener('input', function () { fromSliders('hi'); apply(false); });
      lo.addEventListener('change', function () { writeUrl(); }); hi.addEventListener('change', function () { writeUrl(); });
      var fromInputs = function () {
        var a = parseInt(String(loIn.value).replace(/\D/g, ''), 10), b = parseInt(String(hiIn.value).replace(/\D/g, ''), 10);
        if (isNaN(a)) a = pr.min; if (isNaN(b)) b = pr.max;
        a = Math.max(pr.min, Math.min(a, pr.max)); b = Math.max(pr.min, Math.min(b, pr.max)); if (a > b) { var t = a; a = b; b = t; }
        lo.value = a; hi.value = b; loIn.value = fmtN(a); hiIn.value = fmtN(b); setFill();
        price = (a <= pr.min && b >= pr.max) ? null : [a, b]; apply();
      };
      [loIn, hiIn].forEach(function (i) { i.addEventListener('change', fromInputs); i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); fromInputs(); } }); });
      loIn.value = fmtN(pr.min); hiIn.value = fmtN(pr.max); setFill();
      range._sync = function () {
        lo.value = price ? price[0] : pr.min; hi.value = price ? price[1] : pr.max;
        loIn.value = fmtN(+lo.value); hiIn.value = fmtN(+hi.value); setFill();
      };
    }
    function hist() {
      var h = $('[data-hist]', range); if (!h || !pr) return;
      var bins = 24, cnt = new Array(bins).fill(0), max = 1;
      items.forEach(function (it) {
        if (!it.price || !matches(it, 'price')) return;
        var i = Math.min(bins - 1, Math.floor((it.price - pr.min) / (pr.max - pr.min + 1) * bins)); cnt[i]++; if (cnt[i] > max) max = cnt[i];
      });
      var a = price ? price[0] : pr.min, b = price ? price[1] : pr.max;
      h.innerHTML = cnt.map(function (c, i) {
        var x0 = pr.min + (pr.max - pr.min) * i / bins, x1 = pr.min + (pr.max - pr.min) * (i + 1) / bins;
        return '<i style="height:' + (c ? 18 + 82 * c / max : 0) + '%"' + (x1 < a || x0 > b ? ' class="out"' : '') + '></i>';
      }).join('');
    }

    // --- events
    listing.addEventListener('change', function (e) {
      var i = e.target.closest('input[data-f]'); if (!i) return;
      var k = i.getAttribute('data-f'); sel[k] = sel[k] || [];
      var at = sel[k].indexOf(i.value);
      if (i.checked && at < 0) sel[k].push(i.value); else if (!i.checked && at >= 0) sel[k].splice(at, 1);
      apply();
    });
    function syncInputs() {
      $$('input[data-f]', panel).forEach(function (i) { i.checked = (sel[i.getAttribute('data-f')] || []).indexOf(i.value) >= 0; });
      if (range && range._sync) range._sync();
    }
    function clearAll() { sel = {}; price = null; syncInputs(); apply(); }
    document.addEventListener('click', function (e) {
      var t;
      if ((t = e.target.closest('[data-clear]'))) { e.preventDefault(); clearAll(); return; }
      if ((t = e.target.closest('[data-rm-k]'))) {
        var k = t.getAttribute('data-rm-k');
        if (k === 'price') price = null; else { var v = t.getAttribute('data-rm-v'); sel[k] = (sel[k] || []).filter(function (x) { return x !== v; }); }
        syncInputs(); apply(); return;
      }
      if ((t = e.target.closest('[data-qk]'))) {
        var qk = t.getAttribute('data-qk'), qv = t.getAttribute('data-qv'), on = t.getAttribute('aria-pressed') === 'true';
        if (qk === 'price') price = on ? null : [pr.min, +qv];
        else { sel[qk] = sel[qk] || []; if (on) sel[qk] = sel[qk].filter(function (x) { return x !== qv; }); else sel[qk].push(qv); }
        syncInputs(); apply(); return;
      }
      if ((t = e.target.closest('[data-more]'))) {
        var box = t.closest('.fopts'), open = box.classList.toggle('unfold');
        t.textContent = open ? t.getAttribute('data-less-t') : t.getAttribute('data-more-t'); return;
      }
      if (e.target.closest('[data-fopen]')) { e.preventDefault(); openPanel(); return; }
      if (e.target.closest('[data-fclose]')) { e.preventDefault(); closePanel(); return; }
      if (e.target.classList && e.target.classList.contains('fscrim')) closePanel();
    });
    if (sortSel) sortSel.addEventListener('change', function () { sortMode = sortSel.value; sortCards(); writeUrl(); });

    // --- mobile: the same panel becomes a full-height sheet
    var scrim = document.createElement('div'); scrim.className = 'fscrim'; document.body.appendChild(scrim);
    var lastFocus = null;
    function openPanel() { lastFocus = document.activeElement; panel.classList.add('sheet-open'); scrim.classList.add('on'); document.documentElement.style.overflow = 'hidden'; var f = $('summary', panel); if (f) f.focus(); }
    function closePanel() { if (!panel.classList.contains('sheet-open')) return; panel.classList.remove('sheet-open'); scrim.classList.remove('on'); document.documentElement.style.overflow = ''; if (lastFocus) lastFocus.focus(); }
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePanel(); });

    // --- URL: ?kw=11,22&brand=easee&price=50000-120000&sort=pa  (shareable; the canonical stays clean)
    var KEYS = Object.keys(facets).filter(function (k) { return k !== 'price'; });
    function writeUrl() {
      try {
        var q = new URLSearchParams(location.search);
        KEYS.forEach(function (k) { if (sel[k] && sel[k].length) q.set(k, sel[k].join(',')); else q.delete(k); });
        if (price) q.set('price', price[0] + '-' + price[1]); else q.delete('price');
        if (sortMode !== 'rec') q.set('sort', sortMode); else q.delete('sort');
        var s = q.toString(); history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
      } catch (e) {}
    }
    function readUrl() {
      try {
        var q = new URLSearchParams(location.search);
        KEYS.forEach(function (k) {
          var v = q.get(k); if (!v) return;
          var ok = Object.keys(facets[k].opts || {});
          sel[k] = v.split(',').filter(function (x) { return ok.indexOf(x) >= 0; });
        });
        var p = q.get('price');
        if (p && pr) { var m = p.split('-').map(Number); if (m.length === 2 && !isNaN(m[0]) && !isNaN(m[1])) price = [Math.max(pr.min, m[0]), Math.min(pr.max, m[1])]; }
        var so = q.get('sort'); if (so && sortSel && $('option[value="' + so + '"]', sortSel)) { sortMode = so; sortSel.value = so; }
      } catch (e) {}
    }
    readUrl(); syncInputs(); apply(false);
  })();

  // ---------- card photos: move the mouse across to see the other photos, swipe on touch ----------
  function wakeImgs(root) {
    $$('img[data-src]', root).forEach(function (im) { im.srcset = im.getAttribute('data-srcset') || ''; im.src = im.getAttribute('data-src'); im.removeAttribute('data-src'); im.removeAttribute('data-srcset'); });
  }
  $$('[data-media]').forEach(function (m) {
    var n = +m.getAttribute('data-n'), fr = $('.frames', m), dots = $$('.dots i', m), cur = 0;
    if (n < 2 || !fr) return;
    function show(i) { if (i === cur) return; cur = i; dots.forEach(function (d, j) { d.classList.toggle('on', j === i); }); }
    var card = m.closest('.card') || m;
    card.addEventListener('pointerenter', function (e) { if (e.pointerType === 'mouse') wakeImgs(m); });
    card.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = m.getBoundingClientRect();
      if (e.clientY < r.top || e.clientY > r.bottom) return;
      var i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / r.width * n)));
      if (i !== cur) { fr.scrollLeft = i * fr.clientWidth; show(i); }
    });
    card.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { fr.scrollLeft = 0; show(0); } });
    fr.addEventListener('touchstart', function () { wakeImgs(m); }, { passive: true });
    var raf = 0;
    fr.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; show(Math.round(fr.scrollLeft / Math.max(1, fr.clientWidth))); });
    }, { passive: true });
  });

  // ---------- product page gallery + full-screen view ----------
  var pg = $('[data-pgal]');
  if (pg) (function () {
    var strip = $('[data-strip]', pg), slides = $$('.pslide', pg), thumbs = $$('[data-thumb]', pg), cnt = $('[data-pcount]', pg), i = 0, n = slides.length;
    function go(k, smooth) {
      i = (k + n) % n;
      strip.scrollTo({ left: i * strip.clientWidth, behavior: smooth === false ? 'auto' : 'smooth' });
      mark();
    }
    function mark() {
      thumbs.forEach(function (t, j) { if (j === i) t.setAttribute('aria-current', 'true'); else t.removeAttribute('aria-current'); });
      if (cnt) cnt.textContent = (i + 1) + ' / ' + n;
    }
    var raf = 0;
    strip.addEventListener('scroll', function () {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; var k = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth)); if (k !== i) { i = k; mark(); } });
    }, { passive: true });
    pg.addEventListener('click', function (e) {
      var t = e.target.closest('[data-thumb]'); if (t) { go(+t.getAttribute('data-thumb')); return; }
      if (e.target.closest('[data-prev]')) { go(i - 1); return; }
      if (e.target.closest('[data-next]')) { go(i + 1); return; }
      if (e.target.closest('[data-zoom]') || e.target.closest('.pslide')) openLb();
    });
    strip.setAttribute('tabindex', '0');
    strip.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') { e.preventDefault(); go(i + 1); } if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); } });

    // full-screen view: arrows, Esc, click to zoom 2x and move the mouse to look around
    var lb = null, lbImg, lbCnt, zoomed = false;
    function openLb() {
      if (!lb) {
        lb = document.createElement('div'); lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-modal', 'true');
        lb.innerHTML = '<div class="lb-stage"><img alt=""></div>' +
          '<button class="lb-btn lb-close" type="button" aria-label="' + esc(pg.getAttribute('data-lb-close')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button>' +
          (n > 1 ? '<button class="lb-btn lb-prev" type="button" aria-label="' + esc(pg.getAttribute('data-lb-prev')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><button class="lb-btn lb-next" type="button" aria-label="' + esc(pg.getAttribute('data-lb-next')) + '"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><span class="lb-count"></span>' : '');
        document.body.appendChild(lb);
        lbImg = $('img', lb); lbCnt = $('.lb-count', lb);
        lb.addEventListener('click', function (e) {
          if (e.target.closest('.lb-close')) return closeLb();
          if (e.target.closest('.lb-prev')) return lbGo(i - 1);
          if (e.target.closest('.lb-next')) return lbGo(i + 1);
          if (e.target === lbImg) { zoomed = !zoomed; lb.classList.toggle('zoomed', zoomed); pan(e); return; }
          if (e.target.classList.contains('lb-stage')) closeLb();
        });
        lb.addEventListener('mousemove', function (e) { if (zoomed) pan(e); });
        var sx = null;
        lb.addEventListener('touchstart', function (e) { sx = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
        lb.addEventListener('touchend', function (e) { if (sx === null || zoomed) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) lbGo(i + (dx < 0 ? 1 : -1)); }, { passive: true });
      }
      lbShow(); lb.classList.add('open'); document.documentElement.style.overflow = 'hidden';
      document.addEventListener('keydown', lbKey); $('.lb-close', lb).focus();
    }
    function pan(e) { var r = lbImg.getBoundingClientRect(); lbImg.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%'; }
    function lbShow() { var im = $('img', slides[i]); lbImg.src = im.getAttribute('data-full') || im.src; lbImg.alt = im.alt; zoomed = false; lb.classList.remove('zoomed'); if (lbCnt) lbCnt.textContent = (i + 1) + ' / ' + n; }
    function lbGo(k) { i = (k + n) % n; lbShow(); go(i, false); }
    function lbKey(e) { if (e.key === 'Escape') closeLb(); else if (e.key === 'ArrowRight') lbGo(i + 1); else if (e.key === 'ArrowLeft') lbGo(i - 1); }
    function closeLb() { lb.classList.remove('open'); document.documentElement.style.overflow = ''; document.removeEventListener('keydown', lbKey); var z = $('[data-zoom]', pg); if (z) z.focus(); }
  })();

  function plural(n, f) {
    if (LANG === 'en') return n === 1 ? f[0] : f[1];
    var a = n % 10, b = n % 100;
    if (a === 1 && b !== 11) return f[0];
    if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return f[1];
    return f[2];
  }

  // ---------- product page: option price + overnight calculator + sticky bar ----------
  var buy = $('[data-buy]');
  if (buy) {
    var base = +buy.getAttribute('data-price'), out = $('[data-total]', buy);
    $$('input[name="opt"]', buy).forEach(function (r) {
      r.addEventListener('change', function () {
        if (!out || !base) return;
        out.textContent = r.value === 'inst' ? T.from + ' ' + fmt(base + 24000) : fmt(base);
      });
    });
    var sticky = $('.sticky-buy');
    if (sticky && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (es) { es.forEach(function (e) { sticky.classList.toggle('show', !e.isIntersecting); }); }, { threshold: 0 }).observe($('.buy-ctas', buy));
    }
  }
  var calc = $('[data-calc]');
  if (calc) {
    var kw = +calc.getAttribute('data-kw');
    function hhmm(h) {
      var tm = (Math.ceil((22 + h) * 60 / 5 - 1e-9) * 5) % 1440, H = Math.floor(tm / 60), M = tm % 60;
      if (LANG === 'en') { var s = H < 12 ? 'am' : 'pm', h12 = H % 12 || 12; return h12 + ':' + (M < 10 ? '0' : '') + M + ' ' + s; }
      return (H < 10 ? '0' : '') + H + ':' + (M < 10 ? '0' : '') + M;
    }
    function dur(h) { var t = Math.round(h * 60), H = Math.floor(t / 60), M = t % 60; return LANG === 'ru' ? H + ' ч ' + M + ' мин' : H + ' h ' + M + ' min'; }
    function upd() {
      var batt = +$('#c-batt', calc).value, car = +$('#c-car', calc).value;
      var eff = Math.min(kw, car) * 0.9, need = batt * 0.6, h = need / eff, win = 9;
      var bar = $('.nb', calc);
      bar.style.setProperty('--fill', Math.min(100, h / win * 100) + '%');
      bar.classList.toggle('partial', h > win);
      $('[data-o="full"]', calc).textContent = h <= win ? hhmm(h) : T.not_by_morning;
      $('[data-o="dur"]', calc).textContent = dur(h);
      $('[data-o="km"]', calc).textContent = Math.round(eff / 0.18) + ' ' + (T.km_u || 'km');
    }
    $$('select', calc).forEach(function (s) { s.addEventListener('change', upd); });
    upd();
  }

  // ---------- forms ----------
  $$('form[data-form]').forEach(function (f) {
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = $('.form-err', f.parentNode);
      if (err) err.classList.remove('show');
      if (!f.reportValidity()) return;
      var mail = f.querySelector('[name="email"]'), msg = f.querySelector('[name="kontakt"]');
      if (mail && msg && !mail.value.trim() && !msg.value.trim()) { if (err) { err.textContent = T.f_need_contact; err.classList.add('show'); } return; }
      var data = {}; new FormData(f).forEach(function (v, k) { data[k] = v; });
      data.page = location.pathname; data.lang = LANG;
      if (f.getAttribute('data-form') === 'cart') {
        data.stavke = cart().map(function (l) { var p = BY[l.id]; return (p ? p.name : l.id) + ' × ' + (l.q || 1) + (l.i ? ' + ugradnja' : ''); }).join('; ');
      }
      function done() {
        f.hidden = true;
        var ok = $('.form-done', f.parentNode); if (ok) { ok.classList.add('show'); ok.setAttribute('tabindex', '-1'); ok.focus(); }
        if (f.getAttribute('data-form') === 'cart') setCart([]);
      }
      if (!D.endpoint) { done(); return; }
      fetch(D.endpoint, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); done(); })
        .catch(function () { if (err) { err.textContent = T.f_err; err.classList.add('show'); } });
    });
  });

  // ---------- reservation page ----------
  var cartBox = $('[data-cart]');
  function renderCart() {
    if (!cartBox) return;
    if (!IDX.length && D.idxUrl) return;
    var c = cart().filter(function (l) { return BY[l.id]; });
    var lines = $('.lines', cartBox), sum = $('.summary', cartBox), emptyBox = $('.cart-empty', cartBox), formBox = $('.cart-form', cartBox);
    if (!c.length) { lines.innerHTML = ''; sum.hidden = true; emptyBox.hidden = false; if (formBox) formBox.hidden = true; return; }
    emptyBox.hidden = true; sum.hidden = false; if (formBox) formBox.hidden = false;
    var goods = 0, inst = 0, unknown = false;
    lines.innerHTML = c.map(function (l, i) {
      var p = BY[l.id], q = l.q || 1;
      if (p.price) goods += p.price * q; else unknown = true;
      if (l.i) inst += 24000 * q;
      var instRow = p.cat === 'kucni' ? '<label class="inst"><input type="checkbox" data-li="' + i + '"' + (l.i ? ' checked' : '') + '> ' + esc(T.line_inst) + '</label>' : '';
      return '<div class="line"><a class="stage" href="' + p.url + '" tabindex="-1" aria-hidden="true">' + ill(p) + '</a><div><h3><a href="' + p.url + '">' + esc(p.name) + '</a></h3><p class="meta">' + esc(p.lead) + '</p>' +
        '<div class="ctl"><span class="qty" role="group" aria-label="' + esc(T.qty) + '"><button type="button" data-q="' + i + '" data-d="-1" aria-label="' + esc(T.qty_dec) + '">−</button><output>' + q + '</output><button type="button" data-q="' + i + '" data-d="1" aria-label="' + esc(T.qty_inc) + '">+</button></span>' +
        '<button type="button" class="link-btn" data-rm="' + i + '">' + esc(T.remove) + '</button></div>' + instRow + '</div><div class="lp">' + (p.price ? fmt(p.price * q) : esc(T.price_ask)) + '</div></div>';
    }).join('');
    $('[data-s="goods"]', sum).textContent = fmt(goods) + (unknown ? ' +' : '');
    var ir = $('[data-s-row="inst"]', sum); ir.hidden = !inst; $('[data-s="inst"]', sum).textContent = fmt(inst);
    $('[data-s="total"]', sum).textContent = fmt(goods + inst);
  }
  if (cartBox) {
    cartBox.addEventListener('click', function (ev) {
      var q = ev.target.closest('[data-q]'), rm = ev.target.closest('[data-rm]'), c = cart().filter(function (l) { return BY[l.id]; });
      if (q) { var i = +q.getAttribute('data-q'); c[i].q = Math.max(1, Math.min(20, (c[i].q || 1) + (+q.getAttribute('data-d')))); setCart(c); renderCart(); }
      if (rm) { c.splice(+rm.getAttribute('data-rm'), 1); setCart(c); renderCart(); }
    });
    cartBox.addEventListener('change', function (ev) {
      var t = ev.target; if (!t.hasAttribute('data-li')) return;
      var c = cart().filter(function (l) { return BY[l.id]; }); c[+t.getAttribute('data-li')].i = t.checked; setCart(c); renderCart();
    });
    renderCart();
    onIdx.push(renderCart);
  }

  // ---------- compare page ----------
  var cmpBox = $('[data-compare]');
  function renderCompare() {
    if (!cmpBox) return;
    if (!IDX.length && D.idxUrl) return;
    var full = D.cmp || {}, ids = cmp().filter(function (id) { return full[id] && BY[id]; });
    var wrap = $('.cmp-wrap', cmpBox), emptyBox = $('.cmp-empty', cmpBox), tools = $('.cmp-tools', cmpBox);
    if (!ids.length) { wrap.innerHTML = ''; emptyBox.hidden = false; tools.hidden = true; return; }
    emptyBox.hidden = true; tools.hidden = false;
    var onlyDiff = $('#only-diff').checked;
    var head = '<thead><tr><th scope="row"></th>' + ids.map(function (id) {
      var p = BY[id];
      return '<td><a class="stage" href="' + p.url + '" tabindex="-1" aria-hidden="true">' + ill(p) + '</a><a class="pname" href="' + p.url + '">' + esc(p.name) + '</a>' +
        '<div class="price" style="font-size:17px;margin-top:6px">' + esc(p.ptxt) + '</div><button type="button" class="link-btn rm" data-cmp="' + id + '">' + esc(T.cmp_rm) + '</button></td>';
    }).join('') + '</tr></thead>';
    var rows = (D.cmpRows || []).map(function (r) {
      var vals = ids.map(function (id) { return full[id][r[0]] || '—'; });
      var same = vals.every(function (v) { return v === vals[0]; });
      if (vals.every(function (v) { return v === '—'; })) return '';
      if (onlyDiff && same && ids.length > 1) return '';
      return '<tr class="' + (!same ? 'diff' : '') + '"><th scope="row">' + esc(r[1]) + '</th>' + vals.map(function (v) { return '<td>' + esc(v) + '</td>'; }).join('') + '</tr>';
    }).join('');
    wrap.innerHTML = '<table class="cmp">' + head + '<tbody>' + rows + '</tbody></table>';
    syncCmp();
  }
  if (cmpBox) {
    renderCompare();
    onIdx.push(renderCompare);
    $('#only-diff').addEventListener('change', renderCompare);
    document.addEventListener('click', function (ev) { if (ev.target.closest('[data-cmp]')) setTimeout(renderCompare, 0); });
  }

  // ---------- finder ----------
  var fd = $('[data-finder]');
  if (fd) {
    function val(n) { var r = fd.querySelector('input[name="' + n + '"]:checked'); return r ? r.value : ''; }
    function vals(n) { return $$('input[name="' + n + '"]:checked', fd).map(function (i) { return i.value; }); }
    function score(p, a) {
      var s = 0, why = [];
      var carKw = a.car === '7' ? 7.4 : (a.car === '22' ? 22 : 11);
      if (a.where === 'svuda') { if (p.cat !== 'prenosni') return null; s += 30; why.push(T.why.portable); }
      else if (p.cat !== 'kucni') { if (p.cat === 'prenosni') { s -= 10; } else return null; }
      var eff = p.kw;
      if (a.ph === '1') {
        // portable units in this catalog plug into a red three-phase CEE socket: no use on a single-phase supply
        if (p.cat === 'prenosni' && /^cee/.test(p.plug || '')) return null;
        if (p.ph === 1) { s += 25; why.push(T.why.kw_ok_1ph); }
        else if (p.cat === 'kucni') {
          // a three-phase wallbox on one phase: 32 A units give 7.4 kW, 16 A units only 3.7 kW
          if ((p.amps || 16) >= 32) { eff = 7.4; s += 10; why.push(T.why.ph1_32); } else { eff = 3.7; s -= 8; why.push(T.why.ph1_16); }
        }
        carKw = Math.min(carKw, 7.4);
      }
      if (eff >= carKw - 0.05) { s += 20; if (a.ph !== '1') why.push(T.why.kw_ok); } else s -= (carKw - eff) * 3;
      if (a.ph !== '1' && p.kw > carKw && carKw <= 11) s -= 4;
      if (a.conn === 'cable' && p.conn === 'cable') { s += 12; why.push(T.why.cable); }
      if (a.conn === 'socket' && p.conn === 'socket') { s += 12; why.push(T.why.socket); }
      if (a.conn && a.conn !== 'any' && p.conn && p.conn !== a.conn) s -= 12;
      a.need.forEach(function (n) {
        if (n === 'mid') { if (p.mid) { s += 18; why.push(T.why.mid); } else if (p.cat === 'kucni') { s += 4; why.push(T.why.mid_opt); } }
        if (n === 'lte') { if (p.lte) { s += 18; why.push(T.why.lte); } else s -= 10; }
        if (n === 'rfid') { if (p.rfid) { s += 14; why.push(T.why.rfid); } else s -= 6; }
      });
      if (p.status === 'rezervacija') { s += 6; why.push(T.why.batch); }
      var priceW = a.need.indexOf('price') >= 0 ? 0.00045 : 0.00012;
      s -= (p.price || 300000) * priceW;
      return { p: p, s: s, why: why };
    }
    function runFinder() {
      if (!IDX.length && D.idxUrl) return;
      var a = { where: val('where'), ph: val('ph'), car: val('car'), conn: val('conn'), need: vals('need') };
      var rs = IDX.filter(function (p) { return p.aud === 'b2c' && (p.price || D.stage === 'katalog') && (p.cat === 'kucni' || p.cat === 'prenosni'); })
        .map(function (p) { return score(p, a); }).filter(Boolean).sort(function (x, y) { return y.s - x.s; });
      if (a.need.indexOf('price') >= 0 && rs.length && D.stage !== 'katalog') {
        var cheapest = rs.slice(0, 4).reduce(function (m, r) { return !m || r.p.price < m.p.price ? r : m; }, null);
        if (cheapest) cheapest.why.unshift(T.why.cheap);
      }
      var top = [], seen = {};
      rs.forEach(function (r) { if (top.length < 3 && !seen[r.p.brand]) { top.push(r); seen[r.p.brand] = 1; } });
      rs.forEach(function (r) { if (top.length < 3 && top.indexOf(r) < 0) top.push(r); });
      var adv = [];
      if (a.ph === '1') adv.push(T.fd_adv_1ph);
      if (a.ph === 'x') adv.push(T.fd_adv_x);
      if (a.where === 'svuda' && a.ph !== '1') adv.push(T.fd_adv_go);
      if (!top.length) adv.unshift(T.fd_none);
      $('[data-results]', fd).innerHTML = top.map(function (r, i) {
        var p = r.p, why = r.why.filter(function (w, j, arr) { return arr.indexOf(w) === j; }).slice(0, 3);
        return '<article class="rec"><span class="stage">' + ill(p) + '</span><div><span class="tag">' + esc(i === 0 ? T.fd_best : T.fd_also) + '</span><h3><a href="' + p.url + '">' + esc(p.name) + '</a></h3>' +
          '<p class="why">' + esc(why.join('. ')) + (why.length ? '.' : '') + '</p><span class="price">' + esc(p.ptxt) + '</span></div></article>';
      }).join('') + adv.map(function (t) { return '<p class="advice">' + esc(t) + '</p>'; }).join('');
    }
    fd.addEventListener('change', runFinder);
    // preset from query (home quick form)
    try {
      var qs = new URLSearchParams(location.search);
      ['where', 'ph', 'car', 'conn'].forEach(function (k) { var v = qs.get(k); if (v) { var i = fd.querySelector('input[name="' + k + '"][value="' + v + '"]'); if (i) i.checked = true; } });
    } catch (e) {}
    runFinder();
    onIdx.push(runFinder);
  }

  // ---------- shared product index (deploy: separate cached file) ----------
  if (!D.idx && D.idxUrl) {
    fetch(D.idxUrl).then(function (r) { return r.json(); }).then(function (x) { IDX = x; indexBy(); onIdx.forEach(function (fn) { fn(); }); }).catch(function () {});
  }
})();

/*
 * build_browser.js — step 1 of the naselja build (data extraction).
 *
 * Run it in a browser tab opened at  https://opendata.stat.gov.rs/odata/
 * (paste into the DevTools console). The RZS REST API is same-origin there;
 * the Wikidata Query Service allows CORS. Nothing is downloaded to disk:
 * everything is fetched into memory with fetch().
 *
 * Sources (all GET, read-only):
 *   RZS open data REST  https://opendata.stat.gov.rs/data/WcfJsonRestService.Service1.svc/dataset/<ID>/<lang>/json
 *     SIFNAS/1, SIFNAS/2          — official settlement code list (Cyrillic / Latin), MBNAS -> name, MBOPS
 *     SIFOPS/1, SIFOPS/2          — municipalities/cities, MBOPS -> name, IDNSTJ (oblast = okrug)
 *     NSTJ/2                      — NSTJ territorial units (regions, oblasti)
 *     3104020201IND01/2           — Census 2022, population by age and sex, by settlement (+ settlement type G/O)
 *     31010101IND01/2             — Census series 1948–2022, population by settlement (cross-check)
 *     1201IND01/2                 — area and number of settlements by territorial unit (official counts)
 *   Wikidata (WDQS)             — items with P13776 "Serbian settlement ID" (= RZS MBNAS): P625 coordinates,
 *                                 sr label, P131 -> P3727 municipality ID (for cross-checks)
 *
 * Result: window.NAS = { tsv, opsTsv, cntTsv, checks } ; these pipe-separated tables are what build.py consumes
 * (raw/rzs_wd_settlements.psv, raw/rzs_municipalities.psv, raw/rzs_counts_1201.psv). Next: crosscheck_osm_browser.js.
 * Run 2026-10-29: 4721 statistical units outside Kosovo (1449 Kosovo settlements skipped), 1201IND01 latest year 2025.
 */
(async () => {
  const BASE = 'https://opendata.stat.gov.rs/data/WcfJsonRestService.Service1.svc/dataset/';
  const WDQS = 'https://query.wikidata.org/sparql?format=json&query=';

  // RZS returns small datasets as plain JSON and large ones as a ZIP holding one JSON file.
  async function getJson(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(url + ' -> HTTP ' + resp.status);
    const buf = new Uint8Array(await resp.arrayBuffer());
    const dv = new DataView(buf.buffer);
    let text;
    if (buf.length >= 4 && dv.getUint32(0, true) === 0x04034b50) {
      const method = dv.getUint16(8, true), flags = dv.getUint16(6, true);
      let comp = dv.getUint32(18, true);
      const nlen = dv.getUint16(26, true), xlen = dv.getUint16(28, true);
      const start = 30 + nlen + xlen;
      if (comp === 0 || (flags & 8)) {               // sizes in the central directory
        for (let i = buf.length - 22; i >= 0; i--) {
          if (dv.getUint32(i, true) === 0x06054b50) { comp = dv.getUint32(dv.getUint32(i + 16, true) + 20, true); break; }
        }
      }
      const data = buf.slice(start, start + comp);
      text = method === 0 ? new TextDecoder().decode(data)
        : await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
    } else {
      text = new TextDecoder().decode(buf);
    }
    return JSON.parse(text);
  }
  async function sparql(q) {
    for (let attempt = 1; ; attempt++) {           // WDQS sometimes answers 502/503/429: retry
      const r = await fetch(WDQS + encodeURIComponent(q), { headers: { Accept: 'application/sparql-results+json' } });
      if (r.ok) return (await r.json()).results.bindings;
      if (attempt >= 5) throw new Error('WDQS HTTP ' + r.status);
      await new Promise(res => setTimeout(res, 5000 * attempt));
    }
  }

  // raw RZS tables are cached in window.RZS so that a re-run does not download them again
  const RZS = window.RZS = window.RZS || {};
  for (const k of ['SIFNAS/1', 'SIFNAS/2', 'SIFOPS/1', 'SIFOPS/2', 'NSTJ/2', '3104020201IND01/2', '31010101IND01/2', '1201IND01/2'])
    if (!RZS[k]) RZS[k] = await getJson(BASE + k + '/json');
  const sifC = RZS['SIFNAS/1'], sifL = RZS['SIFNAS/2'], opsC = RZS['SIFOPS/1'], opsL = RZS['SIFOPS/2'], nstjL = RZS['NSTJ/2'];
  const census = RZS['3104020201IND01/2'], series = RZS['31010101IND01/2'], c1201 = RZS['1201IND01/2'];

  // ---- Census 2022 totals per territorial unit: { '0': total, G: urban, O: other } ----
  const cen = {};
  for (const r of census) {
    if (r.IDStarGrupa !== '0' || r.IDPol !== 0) continue;  // all ages, both sexes
    (cen[r.IDTer] = cen[r.IDTer] || {})[r.IDTipNaselja] = r.vrednost;
  }
  // ---- Census series: 2022 value per unit ----
  const ser22 = {};
  for (const r of series) if (r.god === '2022') ser22[r.IDTer] = r.vrednost;
  // ---- Official number of settlements per unit, latest year ----
  const lastYear = Math.max(...c1201.map(r => +r.god));
  const cnt = {};
  for (const r of c1201) if (+r.god === lastYear && r.IDVrPod === 2) cnt[r.IDTer] = [r.nTer.trim(), r.vrednost];

  // ---- Wikidata: items carrying P13776 ----
  const WD = window.WDRAW = window.WDRAW || {};
  if (!WD.coords) WD.coords = await sparql(`SELECT ?item ?id ?coord WHERE { ?item wdt:P13776 ?id . OPTIONAL { ?item wdt:P625 ?coord } }`);
  if (!WD.labels) WD.labels = await sparql(`SELECT ?item ?id ?srl WHERE { ?item wdt:P13776 ?id . ?item rdfs:label ?srl FILTER(LANG(?srl) = "sr") }`);
  if (!WD.mids) WD.mids = await sparql(`SELECT ?item ?id ?mid WHERE { ?item wdt:P13776 ?id . ?item wdt:P131 ?m . ?m wdt:P3727 ?mid }`);
  // coordinates of the city articles (used for the merged urban settlements Beograd and Niš)
  if (!WD.cities) WD.cities = await sparql(`SELECT ?item ?name ?coord WHERE {
      VALUES ?name { "Београд"@sr "Ниш"@sr "Нови Сад"@sr }
      ?art schema:about ?item ; schema:isPartOf <https://sr.wikipedia.org/> ; schema:name ?name .
      ?item wdt:P625 ?coord }`);
  const wd = {};
  for (const b of [...WD.coords, ...WD.labels, ...WD.mids]) {
    const id = b.id.value;
    const e = wd[id] = wd[id] || { q: new Set(), coords: new Set(), labels: new Set(), mids: new Set() };
    e.q.add(b.item.value.split('/').pop());
    if (b.coord) e.coords.add(b.coord.value);
    if (b.srl) e.labels.add(b.srl.value);
    if (b.mid) e.mids.add(b.mid.value);
  }

  // ---- Serbian Cyrillic -> Latin ----
  const T = { 'А':'A','Б':'B','В':'V','Г':'G','Д':'D','Ђ':'Đ','Е':'E','Ж':'Ž','З':'Z','И':'I','Ј':'J','К':'K','Л':'L','Љ':'Lj','М':'M','Н':'N','Њ':'Nj','О':'O','П':'P','Р':'R','С':'S','Т':'T','Ћ':'Ć','У':'U','Ф':'F','Х':'H','Ц':'C','Ч':'Č','Џ':'Dž','Ш':'Š',
              'а':'a','б':'b','в':'v','г':'g','д':'d','ђ':'đ','е':'e','ж':'ž','з':'z','и':'i','ј':'j','к':'k','л':'l','љ':'lj','м':'m','н':'n','њ':'nj','о':'o','п':'p','р':'r','с':'s','т':'t','ћ':'ć','у':'u','ф':'f','х':'h','ц':'c','ч':'č','џ':'dž','ш':'š' };
  const translit = s => [...s].map((ch, i, a) => {
    const t = T[ch];
    if (t === undefined) return ch;
    if (t.length === 2 && ch === ch.toUpperCase() && a[i + 1] && /[А-ЯЂЈЉЊЋЏ]/.test(a[i + 1])) return t.toUpperCase();
    return t;
  }).join('');

  // ---- Join ----
  const latByCode = {}; for (const r of sifL) latByCode[r.MBNAS] = r.nNAS;
  const rows = [], checks = { translitDiff: [], censusVsSeries: [], noCensus: [], noWd: [], multiCoord: [], wdLabelDiff: [], wdMuniDiff: [], kosovoSkipped: 0 };
  for (const r of sifC) {
    const code = r.MBNAS;
    if (code[0] === '9') { checks.kosovoSkipped++; continue; }   // 9xxxxx = AP Kosovo i Metohija
    const cyr = r.nNAS.trim(), lat = (latByCode[code] || '').trim(), mb = r.MBOPS;
    if (translit(cyr) !== lat) checks.translitDiff.push([code, cyr, lat, translit(cyr)]);
    let pop = null, typ = '', psrc = '';
    const c = cen[code];
    if (c) {
      const ks = Object.keys(c).filter(k => k !== '0');
      typ = ks.length === 1 ? ks[0] : '?';
      pop = c[typ];
      psrc = 'C22';
      if (ser22[code] !== undefined && ser22[code] !== pop) checks.censusVsSeries.push([code, cyr, pop, ser22[code]]);
    } else {
      // no settlement row in the census table: take the series value, else the municipality total when the
      // municipality consists of this one settlement only
      const siblings = sifC.filter(x => x.MBOPS === mb);
      const m = cen[mb];
      if (ser22[code] !== undefined && ser22[code] !== null) { pop = ser22[code]; psrc = 'S22'; }
      else if (siblings.length === 1 && m) { pop = m['0']; psrc = 'M22'; }
      if (m && siblings.length === 1) typ = (m.G === m['0']) ? 'G' : (m.O === m['0'] ? 'O' : '?');
      checks.noCensus.push([code, cyr, mb, pop, psrc, typ, siblings.length, JSON.stringify(m || null), ser22[code]]);
    }
    let la = '', lo = '', q = '', alt = '';
    const w = wd[code];
    if (w) {
      q = [...w.q].join('/');
      const pts = [...w.coords].map(s => s.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/)).filter(Boolean).map(m => [+m[2], +m[1]]);
      if (pts.length > 1) checks.multiCoord.push([code, cyr, q, JSON.stringify(pts)]);
      if (pts.length) { la = pts[0][0].toFixed(5); lo = pts[0][1].toFixed(5); }
      alt = pts.slice(1).map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';');   // other WD candidates
      const lbl = [...w.labels].map(s => s.replace(/\s*\(.*\)\s*$/, '').trim());
      const cyrBase = cyr.replace(/\s*\(.*\)\s*$/, '').trim();
      if (lbl.length && !lbl.includes(cyrBase) && !lbl.includes(cyr)) checks.wdLabelDiff.push([code, cyr, q, [...w.labels].join('|')]);
      if (w.mids.size && !w.mids.has(mb)) checks.wdMuniDiff.push([code, cyr, mb, q, [...w.mids].join('|')]);
    } else checks.noWd.push([code, cyr, mb]);
    rows.push({ code, cyr, lat, mb, la, lo, pop, typ, psrc, q, alt });
  }

  const opsLat = {}; for (const r of opsL) opsLat[r.MBOPS] = r.nOPS.trim();
  const nstjLat = {}; for (const r of nstjL) nstjLat[r.IDNSTJ] = r.nNSTJ.trim();
  const opsUsed = [...new Set(rows.map(r => r.mb))].sort();

  // Pipe-separated tables for build.py (no field contains '|'):
  // raw/rzs_wd_settlements.psv: code|cyrillic|municipality code|lat|lon|pop2022|type(G/O)|pop source|
  //                             RZS Latin name when it differs from plain transliteration (else empty)|other WD coordinates
  const tsv = rows.map(r => [r.code, r.cyr, r.mb, r.la, r.lo, r.pop === null ? '' : r.pop, r.typ, r.psrc,
    translit(r.cyr) === r.lat ? '' : r.lat, r.alt].join('|')).join('\n');
  // raw/rzs_wd_qids.psv: code|Wikidata item(s)   (traceability only, not needed by build.py)
  const qidTsv = rows.map(r => r.code + '|' + r.q).join('\n');
  // raw/rzs_municipalities.psv: MBOPS|name Cyrillic|name Latin|IDNSTJ (oblast)|census 2022 population
  const opsTsv = opsC.filter(r => opsUsed.includes(r.MBOPS) || /^RS/.test(r.IDNSTJ || ''))
    .map(r => [r.MBOPS, r.nOPS.trim(), opsLat[r.MBOPS] || '', r.IDNSTJ || '', cen[r.MBOPS] ? cen[r.MBOPS]['0'] : ''].join('|')).join('\n');
  // raw/rzs_counts_1201.psv: unit|name|number of settlements (1201IND01, latest year); NSTJ names; CITY coordinates
  const cntTsv = Object.keys(cnt).sort().map(k => [k, cnt[k][0], cnt[k][1]].join('|')).join('\n')
    + '\n' + Object.keys(nstjLat).sort().map(k => ['NSTJ', k, nstjLat[k]].join('|')).join('\n')
    + '\n' + WD.cities.map(b => ['CITY', b.name.value, b.item.value.split('/').pop(), b.coord.value].join('|')).join('\n');

  window.NAS = { rows, tsv, qidTsv, opsTsv, cntTsv, checks, lastYear, cen, ser22, wd, translit,
                 totals: { RS: cen.RS && cen.RS['0'], settlementsSkippedKosovo: checks.kosovoSkipped } };
  // Copy the tables out with e.g.  copy(NAS.tsv)  in the DevTools console into raw/*.psv (UTF-8, no trailing newline)
  // and record their SHA-256 in raw/SHA256SUMS.browser; build.py refuses to run when a file does not match.
  console.log('NAS ready', rows.length, 'rows; 1201 year', lastYear);
})().catch(e => { window.NAS_ERR = String(e); console.error(e); });
// When pasted into the console the work continues in the background; poll  window.NAS  (or window.NAS_ERR).

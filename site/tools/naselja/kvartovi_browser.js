/*
 * kvartovi_browser.js — collects city quarters for naselja-sinonimi.json (result = raw/kvartovi_wiki.psv).
 *
 * Paste into the console of a tab opened at https://sr.wikipedia.org/ (MediaWiki API is same-origin there, Overpass
 * allows CORS). Read-only GET requests; nothing is downloaded to disk. Run 2026-10-29.
 *
 * 1. Candidates (window.CANDS) from sr.wikipedia:
 *      Шаблон:Београдска насеља (navbox: "Градска насеља" and "Приградска и сеоска насеља" per gradska opština),
 *      Градске четврти Новог Сада §1–3, Зрењанин §3 (Градска насеља), Панчево §12 (Насеља Панчева),
 *      Градске четврти, месне заједнице и приградска насеља Суботице §15 (Списак градских четврти),
 *      categories: 17 × "Насеља у Београду по општинама", Градска насеља Ниша, Градске четврти Новог Сада,
 *      Градске четврти Зрењанина, Градске четврти Панчева, Крагујевачка насеља, Насеља и месне заједнице Суботице.
 *    Run 2026-10-29: 694 candidates (Beograd 448, Novi Sad 119, Subotica 42, Niš 29, Zrenjanin 23, Pančevo 22, Kragujevac 11).
 * 2. A point for every candidate: Wikipedia coordinates (prop=coordinates; 436 of 658 titles) and OSM place objects with
 *    the same name inside the city bbox (one Overpass query, 1184 objects).
 * 3. Geometry of the 42 urban naselja (t = grad) of these cities from the RGZ boundaries in OSM, local point-in-polygon:
 *    the quarter is assigned to the naselje its point lies in; points outside every urban naselje are dropped.
 * 4. classify() applies the exclusions (squares, parks, embankments, blocks, numbered parts, generic words…) and writes
 *    window.RES = raw/kvartovi_wiki.psv:  name|city|target RZS code|how located|source|wiki title|note
 *    (791016 = merged Beograd, 792012 = merged Niš). Run 2026-10-29: 372 lines, SHA-256 7d7b8dc7…057f.
 * build_sinonimi.py then drops 9 more lines (blocks, 2 Latin-script duplicates, Taraiš) and adds the manual entries.
 */
const N = s => (s || '').toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/[„“”"]/g, '').replace(/\s+/g, ' ').trim();
window.NORM = N;
window.wt = async function (page, section) {
  const p = {action: 'parse', format: 'json', page, prop: 'wikitext', redirects: '1'}; if (section !== undefined) p.section = String(section);
  const j = await fetch('/w/api.php?' + new URLSearchParams(p).toString()).then(r => r.json());
  return j.parse ? j.parse.wikitext['*'] : '';
};
window.parseList = function (text, city, source, extra) {
  const out = []; const parents = []; let group = '';
  for (const line of text.split('\n')) {
    const g = line.match(/^\|\s*group\d+\s*=\s*\[\[[^|\]]+\|?([^\]]*)\]\]/); if (g) { group = g[1]; continue; }
    const s = line.match(/^\|\s*sect(\d+)\s*=\s*(.*)$/); if (s) { extra = Object.assign({}, extra, {sect: s[2].trim()}); continue; }
    const hdr = line.match(/^\s*(М|M)З\s+(.+?):\s*$/); if (hdr) { group = 'МЗ ' + hdr[2]; continue; }
    const m = line.match(/^(\*+)\s*(.*)$/); if (!m) continue;
    const depth = m[1].length; const rest = m[2];
    const links = [...rest.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)].map(x => ({title: x[1].trim(), label: (x[2] || x[1]).trim()}));
    let name, title = null;
    if (links.length) { name = links[0].label; title = links[0].title; } else { name = rest.replace(/\(.*?\)/g, '').replace(/'{2,}/g, '').trim(); }
    const alt = ((rest.replace(/\[\[[^\]]+\]\]/g, '').match(/\(([^)]+)\)/) || [])[1] || '').trim();
    parents[depth] = name;
    out.push(Object.assign({city, source, name, title, parent: depth > 1 ? parents[depth - 1] : null, alt, group, more: links.slice(1).map(l => l.label + '=>' + l.title).join(';')}, extra || {}));
  }
  return out;
};
window.catMembers = async function (cat) {
  let cont = {}; const got = [];
  for (let guard = 0; guard < 20; guard++) {
    const params = new URLSearchParams(Object.assign({action: 'query', format: 'json', list: 'categorymembers', cmtitle: 'Категорија:' + cat, cmlimit: 'max', cmnamespace: '0'}, cont));
    const j = await fetch('/w/api.php?' + params.toString()).then(r => r.json());
    if (j.query) for (const m of j.query.categorymembers) got.push(m.title);
    if (j.continue) cont = j.continue; else break;
  }
  return got;
};

async function collect() {
  window.CANDS = [];
  window.CANDS.push(...window.parseList(await window.wt('Шаблон:Београдска насеља'), 'Beograd', 'sr.wikipedia Шаблон:Београдска насеља', {}));
  for (const s of [1, 2, 3]) window.CANDS.push(...window.parseList(await window.wt('Градске четврти Новог Сада', s), 'Novi Sad', 'sr.wikipedia Градске четврти Новог Сада §' + s, {}));
  window.CANDS.push(...window.parseList(await window.wt('Зрењанин', 3), 'Zrenjanin', 'sr.wikipedia Зрењанин §Градска насеља', {}));
  window.CANDS.push(...window.parseList(await window.wt('Панчево', 12), 'Pančevo', 'sr.wikipedia Панчево §Насеља Панчева', {}));
  const sub = await window.wt('Градске четврти, месне заједнице и приградска насеља Суботице', 15);
  for (const line of sub.split('\n')) {
    const m = line.match(/^\|\s*\d+\s*\|\|\s*(.+?)\s*\|\|\s*(.*)$/); if (!m) continue;
    const l = m[1].match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    window.CANDS.push({city: 'Subotica', source: 'sr.wikipedia Градске четврти, месне заједнице и приградска насеља Суботице §Списак градских четврти', name: l ? (l[2] || l[1]).trim() : m[1].replace(/'{2,}/g, '').trim(), title: l ? l[1].trim() : null, parent: null, alt: (m[2].match(/\(([^)]+)\)/) || [])[1] || '', group: '', more: ''});
  }
  const cats = [['Барајевска насеља','Beograd'],['Вождовачка насеља','Beograd'],['Врачарска насеља','Beograd'],['Грочанска насеља','Beograd'],['Звездарска насеља','Beograd'],['Земунска насеља','Beograd'],['Лазаревачка насеља','Beograd'],['Младеновачка насеља','Beograd'],['Новобеоградска насеља','Beograd'],['Обреновачка насеља','Beograd'],['Насеља општине Палилула (Београд)','Beograd'],['Раковичка насеља','Beograd'],['Насеља на Савском венцу','Beograd'],['Сопотска насеља','Beograd'],['Насеља на Старом граду (Београд)','Beograd'],['Сурчинска насеља','Beograd'],['Чукаричка насеља','Beograd'],['Градска насеља Ниша','Niš'],['Градске четврти Новог Сада','Novi Sad'],['Градске четврти Зрењанина','Zrenjanin'],['Градске четврти Панчева','Pančevo'],['Крагујевачка насеља','Kragujevac'],['Насеља и месне заједнице Суботице','Subotica']];
  const have = new Set(window.CANDS.filter(c => c.title).map(c => c.city + '|' + c.title));
  for (const [cat, city] of cats) for (const t of await window.catMembers(cat)) {
    if (have.has(city + '|' + t)) continue; have.add(city + '|' + t);
    window.CANDS.push({city, source: 'sr.wikipedia Категорија:' + cat, name: t.replace(/\s*\(.*\)\s*$/, ''), title: t, parent: null, alt: '', group: cat, more: '', sect: 'cat'});
  }
  // Wikipedia coordinates (redirects resolved)
  const titles = [...new Set(window.CANDS.filter(c => c.title).map(c => c.title))];
  window.TCOORD = {};
  for (let i = 0; i < titles.length; i += 50) {
    const chunk = titles.slice(i, i + 50);
    const j = await fetch('/w/api.php?' + new URLSearchParams({action: 'query', format: 'json', prop: 'coordinates', colimit: 'max', redirects: '1', titles: chunk.join('|')}).toString()).then(r => r.json());
    const map = {}; for (const t of chunk) map[t] = t;
    for (const n of (j.query.normalized || [])) for (const k in map) if (map[k] === n.from) map[k] = n.to;
    for (const r of (j.query.redirects || [])) for (const k in map) if (map[k] === r.from) map[k] = r.to;
    const byTitle = {}; for (const p of Object.values(j.query.pages)) byTitle[p.title] = p;
    for (const t of chunk) { const p = byTitle[map[t]]; window.TCOORD[t] = p ? {final: p.title, missing: p.missing !== undefined, lat: p.coordinates ? p.coordinates[0].lat : null, lon: p.coordinates ? p.coordinates[0].lon : null} : {final: map[t], missing: true, lat: null, lon: null}; }
  }
}

// OSM place objects inside the city boxes and the urban naselja polygons (Overpass, with exponential backoff)
window.BOXES = {Beograd: [44.30, 20.00, 45.05, 20.85], 'Novi Sad': [45.17, 19.70, 45.35, 19.97], 'Niš': [43.25, 21.78, 43.40, 22.05], Kragujevac: [43.95, 20.83, 44.07, 21.00], Subotica: [46.03, 19.58, 46.14, 19.76], Zrenjanin: [45.33, 20.33, 45.43, 20.46], 'Pančevo': [44.83, 20.60, 44.92, 20.73]};
window.UCODES = ['791016','791024','791032','791059','791067','791075','791083','791091','791105','791113','704865','704091','704741','704458','703907','703494','703737','703869','705195','705136','703621','704903','703648','705101','705144','705152','802824','802883','802832','802867','792012','792039','792047','792055','729370','718980','804614','804592','801542','803138','803146','803111'];
async function overpass(q) {
  let wait = 20000;
  for (let a = 0; a < 8; a++) {
    try { const r = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q)); if (r.status === 200) return await r.json(); } catch (e) { /* retry */ }
    await new Promise(res => setTimeout(res, wait)); wait = Math.min(wait * 2, 240000);
  }
  throw new Error('Overpass unavailable');
}
async function osmAndGeometry() {
  let q = '[out:json][timeout:180];('; for (const b of Object.values(window.BOXES)) q += `nwr["place"]["name"](${b.join(',')});`; q += ');out center tags;';
  window.OSMQ = (await overpass(q)).elements;
  window.UGEO = {};
  for (let i = 0; i < window.UCODES.length; i += 14) {
    const j = await overpass('[out:json][timeout:180];rel["ref:RS:naselje"~"^(' + window.UCODES.slice(i, i + 14).join('|') + ')$"];out geom;');
    for (const e of j.elements) window.UGEO[e.tags['ref:RS:naselje']] = e;
  }
}
window.makePoly = function (rel) {   // even-odd rule over all member ways
  const segs = [];
  for (const m of rel.members) if (m.type === 'way' && m.geometry) { const g = m.geometry; for (let i = 0; i + 1 < g.length; i++) if (g[i] && g[i + 1]) segs.push([g[i].lat, g[i].lon, g[i + 1].lat, g[i + 1].lon]); }
  const inside = (la, lo) => { let c = false; for (const s of segs) { if ((s[0] > la) !== (s[2] > la)) { const x = s[1] + (la - s[0]) * (s[3] - s[1]) / (s[2] - s[0]); if (x > lo) c = !c; } } return c; };
  return {segs, inside, b: rel.bounds};
};
function locate() {
  window.POLYS = {}; for (const c in window.UGEO) window.POLYS[c] = window.makePoly(window.UGEO[c]);
  window.whichUrban = (la, lo) => { for (const c in window.POLYS) { const P = window.POLYS[c]; if (la < P.b.minlat || la > P.b.maxlat || lo < P.b.minlon || lo > P.b.maxlon) continue; if (P.inside(la, lo)) return /^791/.test(c) ? '791016' : /^792/.test(c) ? '792012' : c; } return ''; };
  const inBox = (b, la, lo) => la >= b[0] && la <= b[2] && lo >= b[1] && lo <= b[3];
  const idx = {};
  for (const e of window.OSMQ) {
    const la = e.lat ?? (e.center && e.center.lat), lo = e.lon ?? (e.center && e.center.lon); if (la == null) continue;
    const names = new Set([e.tags.name, e.tags['name:sr']].filter(Boolean).map(N));
    for (const [city, b] of Object.entries(window.BOXES)) if (inBox(b, la, lo)) for (const n of names) ((idx[city] = idx[city] || {})[n] = (idx[city][n] || [])).push({la, lo, place: e.tags.place});
  }
  window.OSMIDX = idx;
  for (const c of window.CANDS) {
    const tc = c.title ? window.TCOORD[c.title] : null;
    c.wikiT = tc && tc.lat !== null ? window.whichUrban(tc.lat, tc.lon) : null;     // '' = outside every urban naselje
    c.osmT = ((idx[c.city] || {})[N(c.name)] || []).map(o => window.whichUrban(o.la, o.lo) + ':' + o.place).join(';');
  }
}

// window.SCOPE_NAMES (Cyrillic names of all naselja of each city) and window.TMAP (target code -> [n, o, c]) are built
// from naselja-srbija.with-id.json and pasted before classify(); see report.txt §13.
function classify() {
  window.SCOPE_SET = {}; for (const [k, v] of Object.entries(window.SCOPE_NAMES)) window.SCOPE_SET[k] = new Set(v.map(N));
  const EX = new Set(['центар','центар 1','центар 2','центар 3','центар i','центар ii','центар iii','болница','житни трг','буџин булевар','булевар','стари центар','нови центар','депонија','индустријска зона југ','индустријска зона север','индустријске зоне у новом саду','марија снежна','радна зона север 3','радна зона север 4','западна привредна зона','универзитетски кампус у новом саду','кампус новосадског универзитета','каменичко острво','рибарско острво','ратно острво','врбак','нови сад на води','петроварадинска тврђава','петроварадинска ада','ново гробље','кинеска четврт','градске четврти новог сада','градска насеља ниша','градске четврти, месне заједнице и приградска насеља суботице','париске комуне','икарус','академија','сава','газела','савски кеј','земунски кеј','дунавски кеј','бежанијски блокови','партизански блок','ушће','стари аеродром','дунав сити','карађорђев парк','мостарска петља','стадион','привредна механа','београдска тврђава','калемегдански парк','студентски трг','теразије','теразијска тераса','трг николе пашића','трг републике','цветни трг','славија','безистан','андрићев венац','зелени венац','вељко влаховић','кожара','глогоњски рит','јабучки рит','јабучки рит /железничка станица/','месне заједнице новог београда','west 65','ерпорт сити београд','београд на води','савски насип','централна зона новог београда','улица зелено брдо','градска општина сурчин','а блок','белвил','ада хуја','лондон','врагова башта']);
  const exByCity = {'Pančevo': new Set(['топола']), 'Beograd': new Set(['младост'])};
  const unlocOkGroups = new Set(['Нови Београд', 'Савски венац', 'Стари град', 'Врачар', 'Звездара', 'Раковица']);
  const unlocManual = new Set(['ташмајдан', 'нова карабурма', 'карабурма-дунав', 'марија бурсаћ']);
  const explicitQuarterSrc = s => /Градске четврти Новог Сада §|Суботице §Списак|Зрењанин §|Панчево §|Градска насеља Ниша/.test(s);
  const ALTS = {'Novi Sad|ново насеље': ['Бистрица'], 'Novi Sad|авијатичарско насеље': ['Авијација'], 'Subotica|дудова шума': ['Радијалац'], 'Subotica|кер': ['Керско насеље'], 'Subotica|велики радановац': ['Радановац'], 'Beograd|пашино брдо': ['Лекино брдо']};
  const cityOf = {}; for (const c of window.UCODES) cityOf[/^791/.test(c) ? '791016' : /^792/.test(c) ? '792012' : c] = null;
  const cityOfTarget = {'791016':'Beograd','704865':'Beograd','704091':'Beograd','704741':'Beograd','704458':'Beograd','703907':'Beograd','703494':'Beograd','703737':'Beograd','703869':'Beograd','705195':'Beograd','705136':'Beograd','703621':'Beograd','704903':'Beograd','703648':'Beograd','705101':'Beograd','705144':'Beograd','705152':'Beograd','802824':'Novi Sad','802883':'Novi Sad','802832':'Novi Sad','802867':'Novi Sad','792012':'Niš','729370':'Niš','718980':'Kragujevac','804614':'Subotica','804592':'Subotica','801542':'Zrenjanin','803138':'Pančevo','803146':'Pančevo','803111':'Pančevo'};
  const res = [], skip = [], resolved = {};
  for (const c of window.CANDS) {
    const nm = N(c.name);
    const why = r => skip.push([c.city, c.name, r, c.source.replace('sr.wikipedia ', ''), c.title || ''].join('|'));
    if (!nm) { why('empty'); continue; }
    if (EX.has(nm) || (exByCity[c.city] && exByCity[c.city].has(nm)) || /^блок\b/.test(nm) || /^blok\b/.test(nm) || /\s(i|ii|iii|iv|\d)$/.test(nm)) { why('excluded-type'); continue; }
    let T = null, how = '';
    const wiki = c.wikiT;
    const osmCodes = (c.osmT || '').split(';').filter(Boolean).map(x => x.split(':')[0]);
    const osmUrban = osmCodes.filter(x => x && cityOfTarget[x] === c.city);
    if (wiki && cityOfTarget[wiki] === c.city) { T = wiki; how = 'wiki'; if (osmUrban.length && !osmUrban.includes(wiki)) how = 'wiki(osm-differs:' + osmUrban.join(',') + ')'; }
    else if (wiki === '' && osmUrban.length) { T = osmUrban[0]; how = 'osm(wiki-out)'; }
    else if (wiki === '') { why('outside-urban'); continue; }
    else if (osmUrban.length) { T = osmUrban[0]; how = 'osm'; }
    else if (osmCodes.length && osmCodes.every(x => !x)) { why('outside-urban(osm)'); continue; }
    else if (c.parent && resolved[c.city + '|' + N(c.parent)]) { T = resolved[c.city + '|' + N(c.parent)]; how = 'parent'; }
    else if (c.city === 'Beograd' && c.sect === 'Градска насеља' && (unlocOkGroups.has(c.group) || unlocManual.has(nm))) { T = '791016'; how = 'list-unlocated'; }
    else if (c.city !== 'Beograd' && explicitQuarterSrc(c.source)) {
      if (c.city === 'Novi Sad' && /§3/.test(c.source)) { why('unlocated-srem'); continue; }
      T = {'Niš': '792012', 'Novi Sad': '802824', Subotica: '804614', Zrenjanin: '801542', 'Pančevo': '803138', Kragujevac: '718980'}[c.city]; how = 'list-unlocated';
    }
    else { why('no-location'); continue; }
    resolved[c.city + '|' + nm] = T;
    if (nm === N(window.TMAP[T][2])) { why('identity'); continue; }
    const sameCityNaselje = window.SCOPE_SET[c.city].has(nm);
    if (sameCityNaselje && !/градска четврт/.test(c.title || '')) { why('separate-naselje'); continue; }
    res.push([c.name, c.city, T, how, c.source.replace('sr.wikipedia ', ''), c.title || '', sameCityNaselje ? 'same-city-naselje' : ''].join('|'));
    for (const a of (ALTS[c.city + '|' + nm] || [])) res.push([a, c.city, T, how + '+alt', c.source.replace('sr.wikipedia ', ''), c.title || '', ''].join('|'));
  }
  window.RES = res; window.SKIP = skip;
  return {res: res.length, skip: skip.length};
}
// Usage: await collect(); await osmAndGeometry(); locate(); /* paste SCOPE_NAMES, TMAP */ classify();  copy(RES.join('\n'))

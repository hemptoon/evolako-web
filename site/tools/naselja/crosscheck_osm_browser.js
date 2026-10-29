/*
 * crosscheck_osm_browser.js — step 1b: independent coordinate check against OpenStreetMap.
 *
 * Run in the same tab as build_browser.js, after window.NAS exists (paste into the DevTools console).
 * Reads all place nodes of Serbia from the Overpass API (read-only GET, CORS-enabled), matches every
 * settlement to an OSM node (first by the node's wikidata=* tag = the Wikidata item that carries the
 * RZS code, otherwise by the Cyrillic name within 40 km) and measures the distance between the Wikidata
 * and the OSM point.
 *
 * Result: window.XC (all rows) and window.XCBIG (rows that differ by more than 3 km or were matched by
 * name) = raw/osm_crosscheck_gt3km.psv:
 *   code|cyrillic|municipality|wd lat|wd lon|osm lat|osm lon|distance km|match (Q = wikidata tag, N2 = name)|osm name|osm place
 *
 * Run 2026-10-29: 9102 OSM place nodes; 4707 settlements matched (4692 by wikidata tag, 15 by name);
 * WD vs OSM distance: median 0.34 km, p90 1.68 km, p95 2.44 km, p99 17.05 km; 1010 > 1 km, 178 > 3 km, 63 > 10 km.
 * OSM data © OpenStreetMap contributors, ODbL. build.py uses OSM points only to replace Wikidata points
 * that are demonstrably wrong (see report.md), i.e. an insubstantial extract.
 */
window.OSM = undefined; window.OSM_ERR = undefined;
const OVERPASS_Q = '[out:json][timeout:180];area["ISO3166-1"="RS"]["admin_level"="2"]->.a;' +
  'node["place"~"^(city|town|village|hamlet|suburb|isolated_dwelling|locality|neighbourhood|quarter)$"](area.a);out body qt;';
fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(OVERPASS_Q))
  .then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status))
  .then(j => { window.OSM = j.elements; crossCheck(); })
  .catch(e => { window.OSM_ERR = String(e); });

function crossCheck() {
  const toRad = Math.PI / 180;
  const dist = (a, b) => { const x = (b[1] - a[1]) * toRad * Math.cos((a[0] + b[0]) / 2 * toRad), y = (b[0] - a[0]) * toRad; return 6371 * Math.hypot(x, y); };
  const nodes = window.OSM.filter(e => e.tags && e.tags.name);
  const byQ = {}; for (const e of nodes) if (e.tags.wikidata) (byQ[e.tags.wikidata] = byQ[e.tags.wikidata] || []).push(e);
  const byName = {}; for (const e of nodes) { for (const nm of new Set([e.tags.name, e.tags['name:sr']].filter(Boolean))) (byName[nm] = byName[nm] || []).push(e); }
  const strip = s => s.replace(/\s*\(.*\)\s*$/, '').trim();
  const res = []; const stat = { q: 0, name: 0, none: 0, nameAmb: 0 };
  for (const r of window.NAS.rows) {
    if (/^79/.test(r.code)) continue;                      // parts of Beograd / Niš (merged in build.py)
    const wd = (r.la !== '') ? [+r.la, +r.lo] : null;
    let m = null, meth = '';
    for (const q of (r.q || '').split('/').filter(Boolean)) { if (byQ[q]) { m = byQ[q][0]; meth = 'Q'; break; } }
    if (!m) {
      const cands = [...(byName[r.cyr] || []), ...(byName[strip(r.cyr)] || [])].filter(e => /^(village|town|city|hamlet|suburb|isolated_dwelling|locality)$/.test(e.tags.place));
      const near = wd ? cands.filter(e => dist(wd, [e.lat, e.lon]) < 40) : [];
      if (near.length) { near.sort((a, b) => dist(wd, [a.lat, a.lon]) - dist(wd, [b.lat, b.lon])); m = near[0]; meth = near.length > 1 ? 'N2' : 'N'; }
    }
    if (!m) { stat.none++; res.push([r.code, r.cyr, r.mb, r.la, r.lo, '', '', '', 'none', '', ''].join('|')); continue; }
    if (meth === 'Q') stat.q++; else stat.name++;
    if (meth === 'N2') stat.nameAmb++;
    const d = wd ? dist(wd, [m.lat, m.lon]) : -1;
    res.push([r.code, r.cyr, r.mb, r.la, r.lo, m.lat.toFixed(5), m.lon.toFixed(5), d.toFixed(2), meth, m.tags.name, m.tags.place].join('|'));
  }
  window.XC = res; window.XC_STAT = stat;
  window.XCBIG = res.filter(l => +l.split('|')[7] > 3 || l.split('|')[8] !== 'Q').join('\n');
  console.log('cross-check ready', stat);
}

/*
 * Step 1c — bounding-box check against the official settlement boundaries.
 * OSM carries the RGZ settlement boundaries (admin_level=9) with ref:RS:naselje = RZS settlement code and
 * population:census:2022. Their bounding boxes are read with one light query (no geometry), and every Wikidata
 * point is tested against the bbox of its own settlement (tolerance 0.003 deg, about 300 m).
 * Result window.BBCHK = raw/naselje_bbox_check.psv (only rows that need attention):
 *   code|cyr|mb|status|wd lat|wd lon|osm node lat|osm node lon|osm node inside bbox (1/0)|bbox centre lat|bbox centre lon|bbox
 *   ALTIN  = the first Wikidata point is outside, another Wikidata point of the same item is inside (that point is given)
 *   WDOUT  = no Wikidata point is inside the bbox
 *   WDNONE = no Wikidata point at all (only the statistical parts of Beograd and Nis)
 * Run 2026-10-29: 4721 boundaries for 4721 statistical units (no unit without boundary); first WD point inside 4496,
 * other WD point inside 4, outside 214, none 7; OSM place node inside 4695, outside 12; boundary name differs from
 * the RZS Cyrillic name 25 times (see report.md); population:census:2022 equal to RZS for all 4720 that carry it.
 */
function runBboxQuery() {
  window.NBB = undefined; window.NBB_ERR = undefined;
  const q = '[out:json][timeout:180];rel["ref:RS:naselje"];out tags bb;';
  fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q)).then(r => r.ok ? r.json() : Promise.reject('HTTP ' + r.status)).then(j => { window.NBB = j.elements; }).catch(e => { window.NBB_ERR = String(e); });
}

function bboxCheck() {   // after window.NBB, window.XC and window.NAS exist
  const bb = {}; for (const e of window.NBB) bb[e.tags['ref:RS:naselje']] = [e.bounds.minlat, e.bounds.minlon, e.bounds.maxlat, e.bounds.maxlon, e.tags.name, e.id];
  const osmPt = {}; for (const l of window.XC) { const f = l.split('|'); if (f[5]) osmPt[f[0]] = [+f[5], +f[6], f[9]]; }
  const tol = 0.003;
  const inside = (p, b) => p && b && p[0] >= b[0]-tol && p[0] <= b[2]+tol && p[1] >= b[1]-tol && p[1] <= b[3]+tol;
  const stat = {rows:0, noBB:0, wdIn:0, wdInAlt:0, wdOut:0, wdNone:0, osmIn:0, osmOut:0, nameDiff:0};
  const out = [];
  for (const r of window.NAS.rows) {
    stat.rows++;
    const b = bb[r.code];
    if (!b) { stat.noBB++; out.push([r.code, r.cyr, r.mb, 'NOBB'].join('|')); continue; }
    if (b[4] !== r.cyr) stat.nameDiff++;
    const w = window.NAS.wd[r.code];
    const cands = w ? [...w.coords].map(s => s.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/)).filter(Boolean).map(m => [+m[2], +m[1]]) : [];
    const first = cands[0] || null;
    const o = osmPt[r.code] || null;
    const oIn = inside(o, b); if (o) { if (oIn) stat.osmIn++; else stat.osmOut++; }
    if (!first) { stat.wdNone++; out.push([r.code, r.cyr, r.mb, 'WDNONE', '', '', o?o[0]:'', o?o[1]:'', oIn?1:0, ((b[0]+b[2])/2).toFixed(5), ((b[1]+b[3])/2).toFixed(5), b.slice(0,4).join(',')].join('|')); continue; }
    if (inside(first, b)) { stat.wdIn++; continue; }
    const alt = cands.find(c => inside(c, b));
    if (alt) { stat.wdInAlt++; out.push([r.code, r.cyr, r.mb, 'ALTIN', alt[0].toFixed(5), alt[1].toFixed(5), o?o[0]:'', o?o[1]:'', oIn?1:0, '', '', ''].join('|')); continue; }
    stat.wdOut++;
    out.push([r.code, r.cyr, r.mb, 'WDOUT', first[0].toFixed(5), first[1].toFixed(5), o?o[0].toFixed(5):'', o?o[1].toFixed(5):'', oIn?1:0, ((b[0]+b[2])/2).toFixed(5), ((b[1]+b[3])/2).toFixed(5), b.slice(0,4).map(x=>x.toFixed(4)).join(',')].join('|'));
  }
  window.BBCHK = out.join('\n');
  (async()=>{ window.BBCHK_SHA = await window.sha(window.BBCHK); })();
  return JSON.stringify(stat) + ' outLines ' + out.length;
}

/*
 * Step 1d — point-in-polygon check against the official settlement boundaries.
 * 1. finalPoints() rebuilds exactly the points build.py writes after step 1c (verified: same SHA-256 of the sorted
 *    "code,lat,lon" list as naselja-srbija.with-id.json of that build).
 * 2. ambiguity(): a point that lies inside the bbox of its own settlement and of no other settlement is necessarily
 *    inside its own polygon, because the naselja tile the whole territory. Only the other points are sent to Overpass.
 * 3. runPip(store, points, workers) asks Overpass, 80 points per GET, which ref:RS:naselje areas contain each point:
 *      [out:csv(c,r;false;"|")][timeout:180];is_in(<lat>,<lon>);make m c="<id>",r=set(t["ref:RS:naselje"]);out;
 * 4. For every point outside its own polygon the boundary geometry is fetched (fetchGeo, 40 relations per query:
 *    rel["ref:RS:naselje"~"^(c1|c2|...)$"];out geom;) and round2Geo() checks locally (even-odd rule) the candidates in
 *    this order: OSM place node, other Wikidata points, bbox centre; if none is inside, interiorPoint() takes the point
 *    of a 40x40 grid (refined 20x20) that is inside and farthest from the boundary.
 * Result window.PIPCHK = raw/naselje_polygon_check.psv, one line per settlement whose step-1c point is not inside its
 * own polygon:
 *   code|naselja containing the old point (;-separated)|OSMIN / WDALTIN / BBCIN / INTERIOR / KEEP|new lat|new lon|old lat|old lon
 * Run 2026-10-29 (overpass-api.de was at capacity, so 1-2 workers with exponential backoff, about 1.5 h):
 *   4709 points: 1580 inside their own bbox only, 3129 ambiguous; is_in on all 3129 + 280 of the 1580 as a control
 *   (280/280 inside, which supports step 2). Every tested point lay in exactly one naselje. 291 points (6.2 %) were in
 *   a neighbouring naselje — among them the towns Bor (WD point in Krivelj, 5.8 km off), Nova Varoš, Babušnica,
 *   Despotovac, Bojnik, Lučani, Varvarin, Baljevac. Local geometry confirmed all 291; fixes: OSM node 285, bbox centre 6,
 *   other WD point 0, interior point 0. Shift: median 1.3 km, p90 2.3 km, max 5.8 km.
 */
function finalPoints() {
  const bbl = {}; for (const l of window.BBCHK.split('\n')) { const f = l.split('|'); bbl[f[0]] = f; }
  const city = {}; for (const l of window.NAS.cntTsv.split('\n').filter(l => l.startsWith('CITY'))) { const f = l.split(/[|\t]/); const m = f[3].match(/Point\(([-\d.]+) ([-\d.]+)\)/); city[f[1]] = [+m[2], +m[1]]; }
  const pts = [];
  for (const r of window.NAS.rows) {
    if (/^79/.test(r.code)) continue;                      // parts of Beograd / Nis: merged, city point below
    let la = r.la !== '' ? +r.la : null, lo = r.lo !== '' ? +r.lo : null;
    const b = bbl[r.code];
    if (b && b[3] === 'ALTIN') { la = +b[4]; lo = +b[5]; }
    else if (b && b[3] === 'WDOUT') { if (b[8] === '1') { la = +b[6]; lo = +b[7]; } else { la = +b[9]; lo = +b[10]; } }
    pts.push([r.code, la.toFixed(5), lo.toFixed(5)]);
  }
  pts.push(['791016', city['Београд'][0].toFixed(5), city['Београд'][1].toFixed(5)]);
  pts.push(['792012', city['Ниш'][0].toFixed(5), city['Ниш'][1].toFixed(5)]);
  return (window.FINPTS = pts);
}
window.pipSleep = ms => new Promise(r => setTimeout(r, ms));
window.runPip = function (store, pts, workers) {
  store.queue = []; store.res = store.res || {}; store.tries = {}; store.errors = []; store.active = 0; store.finished = false; store.started = Date.now(); store.endpoints = {};
  const B = 80;                                            // about 8.7 kB of URL per GET
  for (let i = 0; i < pts.length; i += B) store.queue.push(pts.slice(i, i + B));
  const worker = async (ep, name) => {
    store.active++;
    const st = store.endpoints[name] = {ok: 0, fail: 0, dead: false, lastMs: 0};
    while (store.queue.length) {
      const batch = store.queue.shift();
      let q = '[out:csv(c,r;false;"|")][timeout:180];';
      for (const [c, la, lo] of batch) q += `is_in(${la},${lo});make m c="${c}",r=set(t["ref:RS:naselje"]);out;`;
      let ok = false; const t0 = Date.now();
      try {
        const res = await fetch(ep + '?data=' + encodeURIComponent(q));
        const txt = await res.text();
        if (res.status === 200) {
          const want = new Set(batch.map(p => p[0])); const got = {};
          for (const line of txt.split('\n')) { const i = line.indexOf('|'); if (i > 0 && want.has(line.slice(0, i))) got[line.slice(0, i)] = line.slice(i + 1); }
          for (const k in got) store.res[k] = got[k];
          const missing = batch.filter(p => !(p[0] in got));
          for (const p of missing) store.tries[p[0]] = (store.tries[p[0]] || 0) + 1;
          const retry = missing.filter(p => store.tries[p[0]] <= 4);
          for (const p of missing) if (store.tries[p[0]] > 4) store.res[p[0]] = 'ERR';
          if (retry.length) store.queue.push(retry);
          ok = true; st.ok++; st.lastMs = Date.now() - t0;
        } else { st.fail++; store.errors.push(name + ' HTTP ' + res.status); }
      } catch (e) { st.fail++; store.errors.push(name + ' ' + String(e)); }
      if (!ok) { store.queue.push(batch); if (st.fail >= 6 && st.ok === 0) { st.dead = true; break; } await window.pipSleep(20000); }
    }
    store.active--; if (store.active === 0) store.finished = true;
  };
  for (let i = 0; i < workers; i++) worker('https://overpass-api.de/api/interpreter', 'de' + i);
  return store.queue.length;
};
// a Beograd / Nis city point is "own" when it lies in any statistical part of that city
window.pipIsOwn = (code, refs) => { const a = (refs || '').split(';').filter(Boolean); if (code === '791016') return a.some(x => /^79(10|11)/.test(x)); if (code === '792012') return a.some(x => /^7920/.test(x)); return a.includes(code); };
function ambiguity() {
  const bbs = window.NBB.map(e => [e.tags['ref:RS:naselje'], e.bounds.minlat, e.bounds.minlon, e.bounds.maxlat, e.bounds.maxlon]);
  window.AMB = []; window.BBONLY = [];
  for (const [c, las, los] of window.FINPTS) {
    const la = +las, lo = +los;
    const hit = bbs.filter(b => la >= b[1] && la <= b[3] && lo >= b[2] && lo <= b[4]).map(b => b[0]);
    if (hit.length === 1 && window.pipIsOwn(c, hit[0])) window.BBONLY.push(c); else window.AMB.push(c);
  }
  return {bbOnly: window.BBONLY.length, ambiguous: window.AMB.length};
}
window.GEO = window.GEO || {};
window.fetchGeo = async function (codes, store) {
  store.done = 0; store.errs = []; store.finished = false;
  for (let i = 0; i < codes.length; i += 40) {
    const chunk = codes.slice(i, i + 40).filter(c => !window.GEO[c]);
    if (chunk.length) {
      const q = '[out:json][timeout:180];rel["ref:RS:naselje"~"^(' + chunk.join('|') + ')$"];out geom;';
      let wait = 30000;
      for (;;) {
        try {
          const r = await fetch('https://overpass-api.de/api/interpreter?data=' + encodeURIComponent(q));
          if (r.status === 200) { const j = await r.json(); for (const e of j.elements) window.GEO[e.tags['ref:RS:naselje']] = e; break; }
          store.errs.push(r.status);
        } catch (e) { store.errs.push(String(e).slice(0, 30)); }
        await window.pipSleep(wait); wait = Math.min(wait * 2, 320000);
      }
    }
    store.done += chunk.length;
  }
  store.finished = true;
};
window.makePoly = function (rel) {               // even-odd rule over all member ways (outer and inner rings)
  const segs = [];
  for (const m of rel.members) if (m.type === 'way' && m.geometry) { const g = m.geometry; for (let i = 0; i + 1 < g.length; i++) if (g[i] && g[i + 1]) segs.push([g[i].lat, g[i].lon, g[i + 1].lat, g[i + 1].lon]); }
  const inside = (la, lo) => { let c = false; for (const s of segs) { if ((s[0] > la) !== (s[2] > la)) { const x = s[1] + (la - s[0]) * (s[3] - s[1]) / (s[2] - s[0]); if (x > lo) c = !c; } } return c; };
  return {segs, inside};
};
window.round2Geo = function () {
  const R = window.PIP.res;
  const fails = Object.keys(R).filter(k => R[k] !== 'ERR' && !window.pipIsOwn(k, R[k]));
  const fin = {}; for (const p of window.FINPTS) fin[p[0]] = p;
  const osmPt = {}; for (const l of window.XC) { const f = l.split('|'); if (f[5]) osmPt[f[0]] = [+f[5], +f[6]]; }
  const lines = [], stat = {fails: fails.length, OSMIN: 0, WDALTIN: 0, BBCIN: 0, INTERIOR: 0, KEEP: 0, noGeo: 0};
  for (const k of fails) {
    const rel = window.GEO[k]; const f = fin[k];
    if (!rel) { stat.noGeo++; continue; }
    const P = window.makePoly(rel);
    const fl = [+f[1], +f[2]]; const same = p => Math.abs(p[0] - fl[0]) < 5e-6 && Math.abs(p[1] - fl[1]) < 5e-6;
    let pick = null;
    const o = osmPt[k]; if (o && !same(o) && P.inside(o[0], o[1])) pick = ['OSMIN', o];
    if (!pick) { const w = window.NAS.wd[k]; if (w) for (const s of w.coords) { const m = s.match(/Point\(([-\d.eE]+) ([-\d.eE]+)\)/); if (!m) continue; const p = [+m[2], +m[1]]; if (!same(p) && P.inside(p[0], p[1])) { pick = ['WDALTIN', p]; break; } } }
    if (!pick) { const b = rel.bounds; const p = [(b.minlat + b.maxlat) / 2, (b.minlon + b.maxlon) / 2]; if (P.inside(p[0], p[1])) pick = ['BBCIN', p]; }
    if (!pick) { const ip = window.interiorPoint(rel); if (ip) pick = ['INTERIOR', [ip.lat, ip.lon]]; }
    if (!pick) pick = ['KEEP', fl];
    stat[pick[0]]++;
    lines.push([k, R[k], pick[0], pick[1][0].toFixed(5), pick[1][1].toFixed(5), f[1], f[2]].join('|'));
  }
  lines.sort();
  window.PIPCHK = lines.join('\n');
  return stat;
};
window.interiorPoint = function (rel) {          // rel = Overpass relation with "out geom"
  const segs = [];
  for (const m of rel.members) if (m.type === 'way' && m.geometry) { const g = m.geometry; for (let i = 0; i + 1 < g.length; i++) if (g[i] && g[i + 1]) segs.push([g[i].lat, g[i].lon, g[i + 1].lat, g[i + 1].lon]); }
  const b = rel.bounds; const lat0 = (b.minlat + b.maxlat) / 2; const kx = Math.cos(lat0 * Math.PI / 180);
  const inside = (la, lo) => { let c = false; for (const s of segs) { if ((s[0] > la) !== (s[2] > la)) { const x = s[1] + (la - s[0]) * (s[3] - s[1]) / (s[2] - s[0]); if (x > lo) c = !c; } } return c; };
  const dseg = (la, lo, s) => { const px = lo * kx, py = la, ax = s[1] * kx, ay = s[0], bx = s[3] * kx, by = s[2]; const dx = bx - ax, dy = by - ay; const L = dx * dx + dy * dy; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const qx = ax + t * dx - px, qy = ay + t * dy - py; return Math.sqrt(qx * qx + qy * qy); };
  const dmin = (la, lo) => { let m = Infinity; for (const s of segs) { const d = dseg(la, lo, s); if (d < m) m = d; } return m; };
  let best = null, bestD = -1; const N = 40;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const la = b.minlat + (b.maxlat - b.minlat) * i / N, lo = b.minlon + (b.maxlon - b.minlon) * j / N;
    if (!inside(la, lo)) continue; const d = dmin(la, lo); if (d > bestD) { bestD = d; best = [la, lo]; }
  }
  if (best) { const sx = (b.maxlat - b.minlat) / N, sy = (b.maxlon - b.minlon) / N; const c0 = best.slice();
    for (let i = -10; i <= 10; i++) for (let j = -10; j <= 10; j++) { const la = c0[0] + sx * i / 10, lo = c0[1] + sy * j / 10; if (!inside(la, lo)) continue; const d = dmin(la, lo); if (d > bestD) { bestD = d; best = [la, lo]; } } }
  return best ? {lat: best[0], lon: best[1], dKm: bestD * 111.195, segs: segs.length} : null;
};
// Usage: finalPoints(); ambiguity();
//        window.PIP = {}; runPip(window.PIP, window.FINPTS.filter(p => window.AMB.includes(p[0])), 2);  -> poll window.PIP.finished
//        window.GEOST = {}; fetchGeo(Object.keys(PIP.res).filter(k => !pipIsOwn(k, PIP.res[k])), window.GEOST);  -> poll .finished
//        round2Geo()  -> window.PIPCHK (copy into raw/naselje_polygon_check.psv, add its SHA-256 to raw/SHA256SUMS.browser)

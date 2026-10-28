#!/usr/bin/env node
/* Real-image benchmark: loads your own gel photographs and scans in the app (Chromium, as in
 * tests/run.mjs) exactly as a user would, and reports what the automatic analysis found against
 * what you labelled: the number of lanes (and their positions), which wells hold the ladders, the
 * keystone, and the time. The images and the labels stay on your machine (bench/real/ is
 * ignored by git); docs/benchmark.md describes the label file.
 *   node tools/real-bench.mjs                  # bench/real/labels.json
 *   node tools/real-bench.mjs path/to/labels.json
 * Exit code 1 when any gel misses a label. */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const root = process.cwd();
const labelsFile = path.resolve(process.argv[2] || 'bench/real/labels.json');
if (!fs.existsSync(labelsFile)) { console.error(`no label file at ${labelsFile}; see docs/benchmark.md`); process.exit(2); }
const labels = JSON.parse(fs.readFileSync(labelsFile, 'utf8'));
const dir = path.dirname(labelsFile);
const gels = (labels.gels || []).filter(g => { const ok = fs.existsSync(path.join(dir, g.file)); if (!ok) console.log(`skip ${g.file}: not found`); return ok; });
if (!gels.length) { console.error('no images to bench'); process.exit(2); }
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = u.startsWith('/__bench/') ? path.join(dir, u.slice(9)) : path.join(root, u.replace(/^\/$/, '/index.html'));
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const port = srv.address().port;
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.env.PLAYWRIGHT_BROWSERS_PATH ? process.env.PLAYWRIGHT_BROWSERS_PATH + '/chromium' : undefined);
const b = await chromium.launch(exe && fs.existsSync(exe) ? { executablePath: exe } : {});
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
await pg.goto(`http://localhost:${port}/index.html?demo=1&notutorial=1`);
await pg.waitForFunction(() => window.App && App.S, null, { timeout: 60000 });
const res = await pg.evaluate(async (gels) => {
  if (window.Tour && Tour.stop) Tour.stop();
  const E = window.Engine, out = [];
  for (const g of gels) {
    const blob = await (await fetch('/__bench/' + encodeURIComponent(g.file))).blob();
    App.setPref('byType', {});   // no remembered ladder: every gel starts from its type's default
    const t0 = performance.now();
    let error = null;
    try { await App.load(new File([blob], g.file, { type: blob.type }), g.type || undefined); } catch (e) { error = String(e && e.message || e); }
    const ms = Math.round(performance.now() - t0);
    if (error) { out.push({ file: g.file, error, ms }); continue; }
    const S = App.S, P = S.lanePitch || 0;
    // a labelled lane position (original image pixels) in the working frame: the rotation about the
    // centre, then the geometry grid (output <- source, so its inverse)
    const toWork = (x, y) => { const M = App.rotM(S), r = E.M3.apply(M, x, y); return S.geom ? E.Grid.inv(S.geom.grid, r.x, r.y) : r; };
    const yRef = g.laneY != null ? g.laneY : App.src.h / 2;
    const xs = S.lanes.map(l => l.x);
    const laneHits = (g.laneX || []).map(x => toWork(x, yRef).x).filter(x => xs.some(l => Math.abs(l - x) < Math.max(6, P * 0.3))).length;
    const ladders = S.markers.map(m => m.lane + 1);
    const want = g.ladders || [];
    const ladderHit = want.filter(k => ladders.includes(k)).length;
    const geom = S.geom || {};
    const geomSteps = (App.autoGeometry.debug || []).map(d => ({ ...d, combDbg: undefined, crop: undefined, xs: undefined }));
    const r = {
      file: g.file, ms, lanes: S.lanes.length, geomSteps, lanesWant: g.lanes != null ? g.lanes : (g.laneX ? g.laneX.length : null),
      laneHits: g.laneX ? `${laneHits}/${g.laneX.length}` : '', ladders: ladders.join(','), laddersWant: want.join(','), ladderHit, ladderExtra: ladders.length - ladderHit,
      ladderId: S.markers.map(m => m.ladderId).join(','), keystone: geom.lanesPct != null ? +geom.lanesPct.toFixed(1) : null, keystoneWant: g.keystonePct != null ? g.keystonePct : null,
      bendPx: geom.bendPx != null ? +geom.bendPx.toFixed(1) : null, rotation: +(S.rotation || 0).toFixed(2)
    };
    const okLanes = r.lanesWant == null || (r.lanes === r.lanesWant && (!g.laneX || laneHits === g.laneX.length));
    const okLadders = !want.length || (ladderHit === want.length && ladders.length === want.length);
    // the keystone is stated over the box's rows: a label measured over a taller box (keystoneRows)
    // is scaled to the rows the app framed
    if (r.keystoneWant != null && g.keystoneRows) r.keystoneWant = +(r.keystoneWant * S.crop.h / g.keystoneRows).toFixed(1);
    const okKeystone = r.keystoneWant == null || r.keystone == null || Math.abs(r.keystone - r.keystoneWant) <= (g.keystoneTol || 4);
    r.ok = okLanes && okLadders && okKeystone;
    r.miss = [!okLanes && 'lanes', !okLadders && 'ladders', !okKeystone && 'keystone'].filter(Boolean).join(' ');
    out.push(r);
  }
  return out;
}, gels);
await b.close(); srv.close();
const pad = (s, n) => String(s == null ? '' : s).padEnd(n);
let allOk = true;
for (const r of res) {
  if (r.error) { allOk = false; console.log(`FAIL ${pad(r.file, 28)} ${r.error}`); continue; }
  if (!r.ok) allOk = false;
  if (process.env.GEOM_DEBUG) console.log('  geometry steps:', JSON.stringify(r.geomSteps));
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${pad(r.file, 28)} lanes ${pad(r.lanes, 3)}${r.lanesWant != null ? `(want ${r.lanesWant}) ` : ''}${r.laneHits ? `at ${r.laneHits} ` : ''} ladders ${pad(r.ladders || '-', 8)}${r.laddersWant ? `(want ${r.laddersWant}) ` : ''} keystone ${pad(r.keystone != null ? r.keystone + '%' : 'none', 7)}${r.keystoneWant != null ? `(want ${r.keystoneWant}%) ` : ''} bend ${pad(r.bendPx != null ? r.bendPx + 'px' : '-', 6)} ${r.ms} ms${r.miss ? '   missed: ' + r.miss : ''}`);
}
console.log(allOk ? `${res.length} gels as labelled` : 'some gels differ from their labels');
process.exit(allOk ? 0 : 1);

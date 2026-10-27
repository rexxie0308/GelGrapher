/* Marker-lane benchmark: which lane does the automatic draft take for the ladder on synthetic gels, including
 * crowded lysate gels, a mirrored gel (ladder last) and a faint ladder? Truth is the ladder's x position, since
 * the lattice may add an empty lane at an edge. Run: node tools/marker-bench.mjs (Chromium as in tests/run.mjs).
 * 2026-10: GelFigure 0.6.1's explained-fraction score (fit × matched / clear bands) was compared with the
 * band-count / band-strength rule here. With the remembered ladder reset before every gel (App.setPref) both
 * give 16 / 19 exactly right and the same 9 extra marker lanes; without the reset the run order decides, which
 * is why the comparison must reset. The three misses are the 90-band lysate gels, where the lane lattice itself
 * finds 8–9 of 10 lanes, a lane-detection limit rather than a marker-scoring one. The rule was kept. */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const root = process.cwd();
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); }); }).listen(0);
const port = srv.address().port;
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.env.PLAYWRIGHT_BROWSERS_PATH ? process.env.PLAYWRIGHT_BROWSERS_PATH + '/chromium' : undefined);
const b = await chromium.launch(exe && fs.existsSync(exe) ? { executablePath: exe } : {});
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
await pg.goto(`http://localhost:${port}/index.html?demo=1&notutorial=1`);
await pg.waitForFunction(() => window.App && App.S, null, { timeout: 60000 });
const RULE = process.env.RULE || 'explained';   // a label for the run (compare rules by running two checkouts)
const res = await pg.evaluate(async (RULE) => {
  if (window.Tour && Tour.stop) Tour.stop();
  const variants = [];
  const add = (name, opts, type, tweak) => variants.push({ name, opts, type, tweak });
  add('dna', { preset: 'dna' }, 'dna-agarose');
  add('dna mirrored (ladder last)', { preset: 'dna' }, 'dna-agarose', 'mirror');
  add('dna faint ladder 35%', { preset: 'dna' }, 'dna-agarose', 'faint');
  add('dna faint 20%', { preset: 'dna' }, 'dna-agarose', 'faint20');
  for (const seed of [5, 11, 23]) for (const lb of [30, 60, 90]) add(`sds lysate ${lb} bands, seed ${seed}`, { preset: 'sds', lysateBands: lb, seed }, 'sds-page');
  add('sds faint ladder 35%', { preset: 'sds', lysateBands: 60, seed: 5 }, 'sds-page', 'faint');
  add('sds mirrored', { preset: 'sds', lysateBands: 60, seed: 11 }, 'sds-page', 'mirror');
  add('sds faint 20%', { preset: 'sds', lysateBands: 60, seed: 23 }, 'sds-page', 'faint20');
  add('western', { preset: 'western' }, 'western');
  add('western mirrored', { preset: 'western' }, 'western', 'mirror');
  add('western faint 35%', { preset: 'western' }, 'western', 'faint');
  const out = [];
  for (const v of variants) {
    const g = Demo.makeGel(v.opts), w = g.width, h = g.height, truth = g.truth;
    let data = g.data, ladder = 0, truthX = truth.x0;
    if (v.tweak === 'mirror') { data = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = g.data[y * w + (w - 1 - x)]; ladder = truth.lanes - 1; truthX = w - 1 - truth.x0; }
    if (v.tweak === 'faint' || v.tweak === 'faint20') {
      const f = v.tweak === 'faint' ? 0.35 : 0.2, x0 = Math.round(truth.x0 - 30), x1 = Math.round(truth.x0 + 30);
      data = Float32Array.from(g.data);
      for (let x = x0; x <= x1; x++) { const col = []; for (let y = 0; y < h; y++) col.push(data[y * w + x]); const s = col.slice().sort((a, b) => a - b), med = s[s.length >> 1]; for (let y = 0; y < h; y++) data[y * w + x] = med + (data[y * w + x] - med) * f; }
    }
    const tif = Demo.encodeTiff16({ width: w, height: h, data });
    for (const rule of [RULE]) {
      App.setPref('byType', {});   // no remembered ladder: every variant starts from the type's default
      const t0 = performance.now();
      await App.load(new File([tif], 'v.tif', { type: 'image/tiff' }), v.type);
      const ms = Math.round(performance.now() - t0);
      const S = App.S, picked = S.markers.map(m => m.lane), nl = S.lanes.length;
      const dx = picked.map(i => Math.round(S.lanes[i].x - truthX));
      const hit = dx.filter(d => Math.abs(d) < truth.pitch / 2).length, ok = picked.length === 1 && hit === 1;
      out.push({ variant: v.name, rule, lanes: nl, picked: picked.join(','), dx: dx.join(','), hit, extra: picked.length - hit, ok, ms, ladderId: S.markers.map(m => m.ladderId).join(',') });
    }
  }
  return out;
}, RULE);
await b.close(); srv.close();
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('variant', 32), pad('rule', 10), pad('lanes', 6), pad('picked', 8), pad('dx', 14), pad('hit', 4), pad('extra', 6), pad('ok', 6), pad('ms', 5), 'ladder');
for (const r of res) console.log(pad(r.variant, 32), pad(r.rule, 10), pad(r.lanes, 6), pad(r.picked, 8), pad(r.dx, 14), pad(r.hit, 4), pad(r.extra, 6), pad(r.ok, 6), pad(r.ms, 5), r.ladderId);
const sum = (rule, k) => res.filter(r => r.rule === rule).reduce((n, r) => n + (k === 'ok' ? (r.ok ? 1 : 0) : k === 'miss' ? (r.hit ? 0 : 1) : r.extra), 0);
for (const rule of [RULE]) console.log(`${rule}: ${sum(rule, 'ok')} / ${res.length} exactly right; ladder missed ${sum(rule, 'miss')}; extra marker lanes ${sum(rule, 'extra')}`);

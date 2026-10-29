/* Densitometry bench (calculation version 2): is the measure linear, how much does it move with the choices a
 * user makes, and does a broad band read what it holds? Synthetic images only: a PASS here means the arithmetic
 * and the background model do what they claim on images whose truth is known. It is not an experimental
 * validation; that needs blanks and dilution series imaged on your own system (docs/benchmark.md).
 *
 * 1. Dilution series: synthetic DNA gels with a two-fold series of one band in lanes 1-8 (peak 0.0025 to 0.32 of
 *    full scale above the background), at three noise levels, with and without an uneven haze. For each measure
 *    and background it reports:
 *      slope    log-log slope of the value against the amount over the lanes at or above their 10 sigma threshold
 *      faint    the ratio of lane 2 to lane 1 (2 = linear) for the two faintest lanes
 *      >=10s    how many of the 8 lanes are at or above their 10 sigma noise threshold
 *      width %  the largest change of the mid-series value when the region is made wider (70 -> 85 and 100 % of
 *               the lane spacing; the band is 65 % wide, so every region holds it)
 *      height % the same when it is made taller (1.25 and 1.5 times the automatic region)
 *      3 sigma % the mid-series value's own noise: 3 x its estimated sigma, in per cent of the value
 *      blank    the mean signed value of the empty lane over the noise levels (should be about 0)
 * 2. Broad band (the "Lane 4" case): the broad-band example, whose lane 4 band holds 2.9 x lane 2's protein in a
 *    band three times as tall: lane 4 / lane 2 with the region fitted to a narrow band (background from the
 *    region's end rows, as before version 2; local regions), and with local regions and a region as tall as the band.
 *
 * Pass / fail (the default: whole region, local background above and below), exit code 1 on a failure:
 *   slope 0.95-1.05 at every noise level and haze; faint ratio 1.5-2.5 at noise <= 0.012; width and height
 *   changes <= 3 % (or the value's 3 sigma when that is larger: a bigger region adds noise); the blank's mean
 *   within 3 standard errors of 0; broad band: the tall region within 10 % of the
 *   true ratio and the highest lane, the short end-row background flagged for review.
 * Run: node tools/quant-bench.mjs (Chromium as in tests/run.mjs). */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const root = process.cwd();
const srv = http.createServer((q, r) => { const f = path.join(root, decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/, '/index.html')); fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(d); }); }).listen(0);
const port = srv.address().port;
const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || (process.env.PLAYWRIGHT_BROWSERS_PATH ? process.env.PLAYWRIGHT_BROWSERS_PATH + '/chromium' : undefined);
const b = await chromium.launch(exe && fs.existsSync(exe) ? { executablePath: exe } : {});
const pg = await b.newPage({ viewport: { width: 1400, height: 900 } });
await pg.goto(`http://localhost:${port}/index.html?demo=1`);
await pg.waitForFunction(() => window.App && window.Quant && window.UI, null, { timeout: 60000 });
const res = await pg.evaluate(async () => {
  const amounts = [0.0025, 0.005, 0.01, 0.02, 0.04, 0.08, 0.16, 0.32], out = [], blanks = {};
  const fit = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, c) => a + c, 0) / n, my = ys.reduce((a, c) => a + c, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } return sxx ? sxy / sxx : NaN; };
  for (const noise of [0.006, 0.012, 0.03]) for (const haze of [0, 0.08]) {
    const samples = [null, ...amounts.map(a => [[3000, a]]), []];
    const g = Demo.makeGel({ preset: 'dna', tilt: 0, lanes: 10, samples, seed: 9, clean: true, noise, haze });
    App.setPref('byType', {});
    await App.load(new File([Demo.encodeTiff16(g)], 'series.tif'), 'dna-agarose');
    // the lanes where the synthetic gel put them (detection is not under test here), no rotation or geometry
    const S = App.S, q = S.quant;
    S.rotation = 0; S.geom = null; S.flip = { h: false, v: false }; App.applyFlip(); App.rot = null; App.ensureRot();
    S.lanes = Array.from({ length: 10 }, (_, k) => ({ x: g.truth.x0 + g.truth.pitch * k, name: String(k + 1), hidden: false, id: 'L' + (k + 1) }));
    S.lanePitch = g.truth.pitch; S.laneHalfW = g.truth.pitch * 0.3; S.markers = [];
    const li = amounts.map((a, k) => k + 1);
    Object.assign(q, { version: 2, frames: {}, region: { x: 0, y: 0, w: App.rot.w - 1, h: App.rot.h - 1 }, norm: 'none', normBand: null, output: 'corrected', ref: null, bgSides: 'ab', bgGap: 2, bgSize: 0 });
    const box = Quant.bandBox(App, S.lanes[li[7]].x, g.truth.yOf(3000)), c0 = (box.y0 + box.y1) / 2, h0 = (box.y1 - box.y0) / 2;
    // a region at width wf (of the lane spacing) and height hf (times the automatic one), placed afresh
    const place = (wf, hf) => { q.wFrac = wf; q.rows = [Quant.placeRow(App, { name: 'series' }, Math.round(c0 - h0 * hf), Math.round(c0 + h0 * hf))]; };
    for (const [mode, bg] of [['box', 'local'], ['box', 'edge'], ['box', 'rolling'], ['band', 'local']]) {
      q.mode = mode; q.bg = bg; place(0.7, 1);
      const M = Quant.measure(App), cells = li.map(i => M.cells[0][M.lanes.indexOf(i)]);
      const okIdx = cells.map((c, k) => (c.value != null && c.value > 0 && !(c.flags && c.flags.below) ? k : -1)).filter(k => k >= 0);
      const slope = okIdx.length >= 2 ? fit(okIdx.map(k => Math.log(amounts[k])), okIdx.map(k => Math.log(cells[k].value))) : NaN;
      const faint = cells[0].value > 0 ? cells[1].value / cells[0].value : Infinity;
      if (mode === 'box' && bg === 'local') (blanks[noise] = blanks[noise] || []).push(M.cells[0][M.lanes.indexOf(9)].value);
      const at = (wf, hf) => { place(wf, hf); const M2 = Quant.measure(App); return M2.values.corrected[0][M2.lanes.indexOf(li[4])]; };
      const ref = at(0.7, 1), dev = v => Math.abs(v / ref - 1) * 100;
      const Mr = Quant.measure(App), cr = Mr.cells[0][Mr.lanes.indexOf(li[4])], noisePct = 3 * cr.sigmaSum / Math.abs(cr.value) * 100;
      const roiW = Math.max(dev(at(0.85, 1)), dev(at(1, 1))), roiH = Math.max(dev(at(0.7, 1.25)), dev(at(0.7, 1.5)));
      out.push({ noise, haze, mode, bg, slope: +slope.toFixed(3), faint: isFinite(faint) ? +faint.toFixed(2) : 'inf', okN: okIdx.length, roiW: +roiW.toFixed(1), roiH: +roiH.toFixed(1), noisePct: +noisePct.toFixed(1) });
    }
  }
  // 2. the broad band
  await UI.loadExample('broad');
  const q = App.S.quant, fl = UI.figLanes(), T = Demo.makeGel({ preset: 'broad' }).truth, truth = T.amounts[2] / T.amounts[0];
  const ratioOf = () => { const M = Quant.measure(App), j = M.lanes.indexOf(fl[3]), v = M.values.corrected[0]; return { ratio: v[j] / v[0], highest: v[j] === Math.max(...v.filter(x => x != null)), review: M.cells[0][j].review.length > 0 }; };
  const broad = { truth };
  q.bg = 'edge'; broad.edgeShort = ratioOf();
  q.bg = 'local'; broad.localShort = ratioOf();
  const r = q.rows[0], sp = Quant.rowSpan(App, r), c = Math.round((sp.y0 + sp.y1) / 2);
  Quant.editRow(App, r, c - 28, c + 28); broad.localTall = ratioOf();
  return { rows: out, blanks, broad };
});
const pad = (s, n) => String(s).padEnd(n);
console.log('1. Dilution series (value of the region; lanes at or above their 10 sigma threshold)');
console.log(pad('noise', 7), pad('haze', 6), pad('measure', 11), pad('bg', 9), pad('slope', 7), pad('faint', 7), pad('>=10s', 6), pad('width %', 8), pad('height %', 9), '3 sigma %');
for (const r of res.rows) console.log(pad(r.noise, 7), pad(r.haze, 6), pad(r.mode === 'box' ? 'whole' : 'thresholded', 11), pad(r.bg, 9), pad(r.slope, 7), pad(r.faint, 7), pad(r.okN + '/8', 6), pad(r.roiW, 8), pad(r.roiH, 9), r.noisePct);
const allB = Object.values(res.blanks).flat(), mB = allB.reduce((a, c) => a + c, 0) / allB.length, sB = Math.sqrt(allB.reduce((a, c) => a + (c - mB) ** 2, 0) / Math.max(1, allB.length - 1));
console.log(`blank lane, whole region + local background: mean ${mB.toFixed(3)}, sd ${sB.toFixed(3)} over ${allB.length} images (signed; a few below zero is expected)`);
const B = res.broad, f = x => `${x.ratio.toFixed(2)} x${x.highest ? ' (highest)' : ''}${x.review ? ' [needs review]' : ''}`;
console.log(`\n2. Broad band (example "broad"): lane 4 / lane 2, truth ${B.truth.toFixed(2)} x`);
console.log(`   region fitted to a narrow band, background from its end rows: ${f(B.edgeShort)}`);
console.log(`   same region, local background regions:                         ${f(B.localShort)}`);
console.log(`   local background regions, region as tall as the band:          ${f(B.localTall)}`);
// pass / fail for the default measure
const def = res.rows.filter(r => r.mode === 'box' && r.bg === 'local'), fails = [];
def.forEach(r => {
  if (!(Math.abs(r.slope - 1) <= 0.05)) fails.push(`slope ${r.slope} at noise ${r.noise}, haze ${r.haze}`);
  if (r.noise <= 0.012 && !(r.faint >= 1.5 && r.faint <= 2.5)) fails.push(`faint ratio ${r.faint} at noise ${r.noise}, haze ${r.haze}`);
  // a bigger region adds pixels and their noise: the limit is 3 % or the value's own 3 sigma, whichever is larger
  if (r.roiW > Math.max(3, r.noisePct)) fails.push(`width change ${r.roiW} % at noise ${r.noise}, haze ${r.haze}`);
  if (r.roiH > Math.max(3, r.noisePct)) fails.push(`height change ${r.roiH} % at noise ${r.noise}, haze ${r.haze}`);
});
if (Math.abs(mB) > 3 * sB / Math.sqrt(allB.length)) fails.push(`blank bias ${mB.toFixed(3)} (sd ${sB.toFixed(3)}, n ${allB.length})`);
if (!(Math.abs(B.localTall.ratio / B.truth - 1) <= 0.1 && B.localTall.highest)) fails.push(`broad band ${B.localTall.ratio.toFixed(2)} x vs ${B.truth.toFixed(2)} x`);
if (!B.edgeShort.review) fails.push('broad band read with the end-row background is not flagged for review');
console.log(fails.length ? `\nFAIL (default measure): ${fails.join('; ')}` : '\nPASS (default measure: whole region, local background): slope, faint ratio, region width and height, blank bias, broad band');
await b.close(); srv.close();
process.exit(fails.length ? 1 : 0);

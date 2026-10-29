/* Densitometry bench: is the measure linear, and how much does it move with the choices a user makes?
 * Synthetic DNA gels with a two-fold dilution series of one band in lanes 1-8 (peak 0.0025 to 0.32 of full
 * scale above the background), at three noise levels and with and without an uneven haze. For each measure
 * (whole box, thresholded) and background method it reports:
 *   slope    log-log slope of the measured value against the amount over the quantifiable lanes (1 = linear)
 *   faint    the measured ratio of lane 2 to lane 1 (2 = linear) for the two faintest lanes
 *   >=LOQ    how many of the 8 lanes are at or above their limit of quantification
 *   width %  the largest change of the mid-series value when a box that contains the band is made wider
 *            (70 -> 85 and 100 % of the lane spacing)
 *   height % the same when it is made taller (1.25 and 1.5 times the automatic box)
 * Run: node tools/quant-bench.mjs (Chromium as in tests/run.mjs). Nothing here replaces a dilution series
 * on your own imager: tools/real-bench.mjs takes a "dilution" label for that (docs/benchmark.md). */
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
const res = await pg.evaluate(async () => {
  if (window.Tour && Tour.stop) Tour.stop();
  const amounts = [0.0025, 0.005, 0.01, 0.02, 0.04, 0.08, 0.16, 0.32], out = [];
  const fit = (xs, ys) => { const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; } return sxx ? sxy / sxx : NaN; };
  for (const noise of [0.006, 0.012, 0.03]) for (const haze of [0, 0.08]) {
    const samples = [null, ...amounts.map(a => [[3000, a]]), []];
    const opts = { preset: 'dna', tilt: 0, lanes: 10, samples, seed: 9, clean: true, noise, haze };
    const g = Demo.makeGel(opts);
    App.setPref('byType', {});
    await App.load(new File([Demo.encodeTiff16(g)], 'series.tif'), 'dna-agarose');
    // the lanes where the synthetic gel put them (detection is not under test here; the faintest lanes of a
    // dilution series need not be found by it)
    const S = App.S, q = S.quant;
    S.lanes = Array.from({ length: 10 }, (_, k) => ({ x: g.truth.x0 + g.truth.pitch * k, name: String(k + 1), hidden: false }));
    S.lanePitch = g.truth.pitch; S.laneHalfW = g.truth.pitch * 0.3; S.markers = [];
    const li = amounts.map((a, k) => k + 1);
    const box = Quant.bandBox(App, S.lanes[li[7]].x, g.truth.yOf(3000));
    const row = { y0: box.y0, y1: box.y1, name: 'series' };
    q.rows = [row]; q.region = Object.assign({}, S.crop); q.norm = 'none';
    S.lanes.forEach(l => { delete l.noMeasure; });
    for (const mode of ['box', 'band']) for (const bg of ['edge', 'border', 'rolling']) {
      q.mode = mode; q.bg = bg; q.rows = [row]; q.wFrac = 0.7;
      const M = Quant.measure(App), cells = li.map(i => M.cells[0][M.lanes.indexOf(i)]);
      const okIdx = cells.map((c, k) => (c.vol >= c.loq && c.vol > 0 ? k : -1)).filter(k => k >= 0);
      const slope = okIdx.length >= 2 ? fit(okIdx.map(k => Math.log(amounts[k])), okIdx.map(k => Math.log(cells[k].vol))) : NaN;
      const faint = cells[0].vol > 0 ? cells[1].vol / cells[0].vol : Infinity;
      // region sensitivity on the mid-series lane (amount 0.04), for boxes that contain the band (the synthetic
      // band is 65 % of the lane spacing wide): width 70-100 % of the spacing, height 1-1.5 times the auto box
      const at = (wf, hf) => { const c = (row.y0 + row.y1) / 2, hh = (row.y1 - row.y0) / 2 * hf; q.wFrac = wf; q.rows = [{ y0: c - hh, y1: c + hh, name: 'r' }]; const M2 = Quant.measure(App); return M2.vol[0][M2.lanes.indexOf(li[4])]; };
      const ref = at(0.7, 1), dev = v => Math.abs(v / ref - 1) * 100;
      const roiW = Math.max(dev(at(0.85, 1)), dev(at(1, 1))), roiH = Math.max(dev(at(0.7, 1.25)), dev(at(0.7, 1.5)));
      out.push({ noise, haze, mode, bg, slope: +slope.toFixed(3), faint: isFinite(faint) ? +faint.toFixed(2) : 'inf', loqOk: okIdx.length, roiW: +roiW.toFixed(1), roiH: +roiH.toFixed(1) });
    }
  }
  return out;
});
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('noise', 7), pad('haze', 6), pad('measure', 8), pad('bg', 9), pad('slope', 7), pad('faint', 7), pad('>=LOQ', 6), pad('width %', 8), 'height %');
for (const r of res) console.log(pad(r.noise, 7), pad(r.haze, 6), pad(r.mode, 8), pad(r.bg, 9), pad(r.slope, 7), pad(r.faint, 7), pad(r.loqOk + '/8', 6), pad(r.roiW, 8), r.roiH);
await b.close(); srv.close();

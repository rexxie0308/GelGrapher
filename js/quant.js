/* Densitometry and band calling.
 *
 * Band boxes ("rows") span the analysed lanes at one height, e.g. the target band and the loading
 * control of a Western blot. For every lane the signal inside a box of fixed width is integrated on
 * the ORIGINAL pixel values (each box outline mapped back through the rotation and the geometry
 * correction; App.readRegion), after subtracting a background:
 *   edge    - straight line between the profile at the top and bottom edge of the box (the usual
 *             "close the peak" method of ImageJ's gel analyser)
 *   border  - the median of a 3-pixel border around the box (the "median" background of Image Studio
 *             and Image Lab), one level for the whole box
 *   rolling - rolling-ball-like baseline (morphological opening) of the lane profile over the analysis area
 *   none    - raw integrated density
 * Measure (quant.mode): 'box' (default) sums every pixel of the box after background subtraction,
 * which is linear in the amount of signal; 'band' (thresholded signal) counts only the pixels above
 * 3 sigma of the background noise plus a small offset: it ignores the box's empty margins but loses
 * the faint part of every band, so a faint band reads disproportionately low (doubling a band near the
 * threshold can more than double its value). It is kept for continuity, not as the default.
 * Every box carries its limits: sd = per-pixel noise of the two rows at each box edge (around each
 * row's own mean), sigma_vol = sd * sqrt(n + n^2 / m) for n pixels in the box and m pixels used for
 * its background, LOD = 3 sigma_vol, LOQ = 10 sigma_vol. A value below the LOQ is reported but flagged;
 * it never serves as a denominator or as the reference. This assumes independent pixel noise: a
 * smoothed or compressed image has correlated noise and wider real limits, so validate with a
 * dilution series on your system.
 * Normalization (quant.norm): 'none' until chosen; 'control' divides every other box by the ticked
 * box of the same lane (a loading control: valid only when it is stable across conditions and in its
 * linear range); 'lane' divides by the lane's signal over the analysis area (total-protein
 * normalization only when the image is a total-protein stain or stain-free image: quant.laneTotal).
 * The analysis area (quant.region) and the analysed lanes (lane.noMeasure) are set apart from the
 * figure: a cosmetic change of the figure never changes a number.
 * Dark-band images (Coomassie, silver, X-ray film) are inverted first so that more protein / probe
 * always means more signal. Values are arbitrary units: compare lanes of the same image only.
 */
(function (G) {
  'use strict';
  const E = G.Engine;

  function boxHalfWidth(S) {
    const pitch = S.lanePitch || S.laneHalfW / 0.3;
    return Math.max(1, pitch * (S.quant.wFrac || 0.7) / 2);
  }
  // the analysis area: set from the figure box when the first band box is drawn (App.finishRegion),
  // the figure box itself until then
  function region(S) { return S.quant.region || S.crop; }
  // lanes that are measured: inside the analysis area, not a ladder, not left out of the analysis.
  // Leaving a lane out of the FIGURE (lane.hidden) does not leave it out of the analysis.
  function quantLanes(App) {
    const S = App.S, g = region(S), mk = new Set(S.markers.map(m => m.lane)), out = [];
    S.lanes.forEach((l, i) => { if (!mk.has(i) && !l.noMeasure && l.x >= g.x && l.x <= g.x + g.w) out.push(i); });
    return out;
  }

  /* Integrated density of one box. Returns {vol, raw, bg, sat, n, px (pixels counted), floor (the
   * threshold of the thresholded measure), sd, lod, loq, x0, x1, y0, y1}. */
  function measureBox(App, lane, row, method, mode) {
    const S = App.S, full = App.ensureRot(), bright = S.bright;
    const hw = boxHalfWidth(S), cx = S.lanes[lane].x;
    const x0 = E.clamp(Math.round(cx - hw), 0, full.w - 1), x1 = E.clamp(Math.round(cx + hw), 0, full.w - 1);
    const y0 = E.clamp(Math.round(Math.min(row.y0, row.y1)), 0, full.h - 1), y1 = E.clamp(Math.round(Math.max(row.y0, row.y1)), 0, full.h - 1);
    const reg = App.readRegion(), val = v => (bright ? v : 1 - v);
    const box = reg(x0, x1, y0, y1);
    const empty = { vol: 0, raw: 0, bg: 0, sat: 0, n: 0, px: 0, floor: 0, sd: 0, lod: 0, loq: 0, x0, x1, y0, y1 };
    if (!box.length) return empty;
    const clipped = App.satPredicate ? App.satPredicate() : null;
    let sat = 0; if (clipped) box.forEach(r => { for (let i = 0; i < r.v.length; i++) if (clipped(r.v[i])) sat++; });
    // per row: the sum of the band signal and the number of pixels
    const p = box.map(r => { let t = 0; for (let i = 0; i < r.v.length; i++) t += val(r.v[i]); return t; }), nr = box.map(r => r.v.length);
    const perPx = k => (nr[k] ? p[k] / nr[k] : 0);
    const edges = [...new Set([0, Math.min(1, box.length - 1), Math.max(0, box.length - 2), box.length - 1])];
    let bl, m;   // background of row k as a sum over the row's pixels; m = pixels the background is estimated from
    if (method === 'none') { bl = () => 0; m = Infinity; }
    else if (method === 'border') {
      // median of the pixels in a 3-px border around the box (top, bottom and both sides), as one level
      const B = 3, vals = [];
      [reg(x0, x1, y0 - B, y0 - 1), reg(x0, x1, y1 + 1, y1 + B), reg(x0 - B, x0 - 1, y0, y1), reg(x1 + 1, x1 + B, y0, y1)].forEach(rows => rows.forEach(r => { for (let i = 0; i < r.v.length; i++) vals.push(val(r.v[i])); }));
      vals.sort((a, b) => a - b);
      const med = vals.length ? vals[vals.length >> 1] : 0;
      bl = k => med * nr[k]; m = Math.max(1, vals.length);
    } else if (method === 'rolling') {
      // baseline of the lane over the analysis area, radius ~ 1.5 box heights, on the per-pixel row means
      const g = region(S), ca = Math.min(Math.round(g.y), y0), cb = Math.max(Math.round(g.y + g.h - 1), y1);
      const strip = reg(x0, x1, ca, cb), prof = Float32Array.from(strip.map(r => { let t = 0; for (let i = 0; i < r.v.length; i++) t += val(r.v[i]); return r.v.length ? t / r.v.length : 0; }));
      const b = E.baseline(prof, Math.max(5, Math.round(1.5 * (y1 - y0 + 1))));
      // the box's rows within the strip: matched by their y (the strip's rows are the same source rows)
      const at = new Map(strip.map((r, i) => [r.y, b[i]]));
      bl = k => (at.has(box[k].y) ? at.get(box[k].y) : perPx(k)) * nr[k];
      // the baseline at a row is set by the few rows where the opening touches the profile, not by the whole
      // strip: its uncertainty is counted like the edge method's four rows (and an opening of a noisy profile
      // sits low, so it reads faint bands too high: tools/quant-bench.mjs)
      m = Math.max(1, 4 * (x1 - x0 + 1));
    } else {
      // a straight line between the two rows at each box edge (per pixel)
      const e0 = (perPx(0) + perPx(Math.min(1, box.length - 1))) / 2, e1 = (perPx(box.length - 1) + perPx(Math.max(0, box.length - 2))) / 2, n = Math.max(1, box.length - 1);
      bl = k => (e0 + (e1 - e0) * k / n) * nr[k];
      m = Math.max(1, edges.reduce((a, k) => a + nr[k], 0));
    }
    // per-pixel noise: the spread of the edge rows' pixels around each row's own mean
    let ss = 0, cnt = 0;
    edges.forEach(k => { const r = box[k], mu = perPx(k); for (let i = 0; i < r.v.length; i++) { const d = val(r.v[i]) - mu; ss += d * d; cnt++; } });
    const sd = Math.sqrt(ss / Math.max(1, cnt - edges.length));
    let vol = 0, raw = 0, bg = 0, px = 0, floor = 0, n = 0;
    if (mode === 'band') {
      // thresholded signal: only the pixels more than 3 sd (plus a small offset) above the background count
      floor = 3 * sd + 0.004;
      box.forEach((r, k) => {
        const b = bl(k), bp = nr[k] ? b / nr[k] : 0; raw += p[k]; bg += b; n += nr[k];
        for (let i = 0; i < r.v.length; i++) { const d = val(r.v[i]) - bp; if (d > floor) { vol += d; px++; } }
      });
    } else {
      box.forEach((r, k) => { const b = bl(k); raw += p[k]; bg += b; vol += Math.max(0, p[k] - b); n += nr[k]; });
      px = n;
    }
    const sigma = sd * Math.sqrt(n + (isFinite(m) ? n * n / m : 0));
    return { vol, raw, bg, sat, n, px, floor, sd, lod: 3 * sigma, loq: 10 * sigma, x0, x1, y0, y1 };
  }

  /* Whole table: rows x lanes, plus normalisation and the reference lane. Each cell carries its own
   * flags: sat (clipped pixels), lod / loq (below the limit of detection / quantification); a
   * normalized value whose denominator is clipped or below its LOQ is not given (den: 'sat' | 'weak'). */
  function measure(App) {
    const S = App.S, q = S.quant, lanes = quantLanes(App), rows = q.rows;
    const normMode = q.norm === 'lane' ? 'lane' : q.norm === 'control' ? 'control' : 'none';
    const ctl = normMode === 'control' && q.control >= 0 && q.control < rows.length ? q.control : -1;
    const ref = lanes.includes(q.ref) ? q.ref : lanes[0];
    const mode = q.mode === 'band' ? 'band' : 'box';
    const cells = rows.map(r => lanes.map(i => measureBox(App, i, r, q.bg, mode)));
    const vol = cells.map(r => r.map(c => c.vol));
    // the lane's whole signal over the analysis area (the whole box, with the same background method)
    const g = region(S);
    const totalCells = normMode === 'lane' ? lanes.map(i => measureBox(App, i, { y0: g.y, y1: g.y + g.h - 1 }, q.bg, 'box')) : null;
    const totals = totalCells ? totalCells.map(c => c.vol) : null;
    const below = c => (c.vol < c.lod ? 'lod' : c.vol < c.loq ? 'loq' : null);
    const denOf = (k, j) => (ctl >= 0 && k !== ctl ? cells[ctl][j] : totalCells && k !== ctl ? totalCells[j] : null);
    const denIssue = c => (!c ? null : c.sat ? 'sat' : c.vol <= 0 || c.vol < c.loq ? 'weak' : null);
    const flags = cells.map((r, k) => r.map((c, j) => ({ sat: c.sat > 0, below: below(c), den: denIssue(denOf(k, j)) })));
    const norm = vol.map((r, k) => r.map((v, j) => { const d = denOf(k, j); return !d ? v : denIssue(d) ? null : v / d.vol; }));
    const normLabel = ctl >= 0 ? (rows[ctl].name || `Band ${ctl + 1}`) : normMode === 'lane' ? (q.laneTotal ? 'total protein' : 'lane signal') : null;
    const ri = lanes.indexOf(ref);
    // a relative value needs a reference lane whose own value is quantifiable (at or above its LOQ, not
    // clipped) and whose denominator is usable
    const refOk = norm.map((r, k) => ri >= 0 && r[ri] != null && r[ri] > 0 && !flags[k][ri].below && !flags[k][ri].sat);
    const rel = norm.map((r, k) => r.map(v => (v != null && refOk[k] ? v / r[ri] : null)));
    const satLanes = new Set();
    cells.forEach(r => r.forEach((c, j) => { if (c.sat > 0) satLanes.add(lanes[j]); }));
    if (totalCells) totalCells.forEach((c, j) => { if (c.sat > 0) satLanes.add(lanes[j]); });
    return { lanes, names: lanes.map(i => S.lanes[i].name || String(i + 1)), rows: rows.map((r, k) => ({ name: r.name || `Band ${k + 1}`, control: k === ctl })),
      cells, vol, norm, rel, refOk, flags, control: ctl, ref, method: q.bg, mode, normMode, normLabel, laneTotal: !!q.laneTotal, totals, totalCells,
      region: Object.assign({}, g), halfWidthPx: boxHalfWidth(S), saturatedLanes: [...satLanes] };
  }

  const BG_TEXT = { edge: 'a straight-line background between the box edges', border: 'the median of a 3-pixel border around the box as background', rolling: 'a rolling-ball background under the lane profile', none: 'no background subtraction' };
  const MODE_TEXT = {
    box: 'every pixel of the box after background subtraction (whole box)',
    band: 'only the pixels more than 3 σ of the background noise (plus 0.004 of full scale) above the background (thresholded signal; this loses the faint part of every band, so faint bands read disproportionately low)'
  };
  /* One description of what was measured, shared by the analysis window, the CSV, the methods text and
   * the processing log, so all four say the same thing. */
  function describe(App, R) {
    const S = App.S, rot = !!S.rotation, geo = !!(S.geom && S.geom.grid);
    const pixels = rot || geo
      ? `the original pixel values: each box outline was mapped back through the ${[rot ? 'rotation' : '', geo ? 'geometry correction stated in the legend' : ''].filter(Boolean).join(' and the ')}, and every original pixel whose centre lies inside it was summed once (no resampled value; no contrast setting)`
      : 'the original pixel values (no rotation or geometry correction; no contrast setting)';
    const g = R.region, ref = R.ref, refName = R.names[R.lanes.indexOf(ref)];
    const norm = R.control >= 0
      ? `each band was divided by the ${R.rows[R.control].name} band of the same lane (loading control; valid only if it is stable across the conditions and within its linear range)`
      : R.normMode === 'lane'
        ? (R.laneTotal ? 'each band was divided by the total signal of its lane over the analysis area of this total-protein-stained (or stain-free) image (total-protein normalization)'
          : 'each band was divided by the integrated signal of its lane over the analysis area; this is total-protein normalization only if the image is a total-protein stain or stain-free image')
        : 'values were not normalized';
    return {
      pixels,
      measure: MODE_TEXT[R.mode] || R.mode,
      background: BG_TEXT[R.method] || R.method,
      limits: 'limits per box from the noise of its edge rows: LOD = 3 σ, LOQ = 10 σ of the box total (σ from the per-pixel noise and the pixels used for the background, assuming independent pixel noise); values below the LOQ are flagged and are never used as a denominator or a reference',
      area: `analysis area x ${Math.round(g.x)}–${Math.round(g.x + g.w)}, y ${Math.round(g.y)}–${Math.round(g.y + g.h)} px of the working frame, set apart from the figure crop`,
      normalization: norm,
      reference: R.refOk.some(Boolean) ? `relative values are given against lane ${ref + 1}${refName && refName !== String(ref + 1) ? ` (${refName.replace(/\*/g, '')})` : ''}, set to 1.00` : 'no relative values (the reference lane has no quantifiable band)',
      saturation: App.satReport().text
    };
  }
  /* A methods paragraph for the manuscript, from what was actually done. */
  function methodsText(App, R) {
    const S = App.S, A = G.App, bits = S.file.bits ? `${S.file.bits}-bit ` : '', D = describe(App, R);
    const sat = R.saturatedLanes.length ? ` Lanes ${R.saturatedLanes.map(i => i + 1).join(', ')} contained clipped pixels and are underestimated.` : '';
    return `Band intensities were quantified in ${A.NAME} ${A.VERSION} on the raw ${bits}image, from ${D.pixels}. ` +
      `Boxes ${Math.round(R.halfWidthPx * 2)} px wide (${Math.round((S.quant.wFrac || 0.7) * 100)} % of the lane spacing) were placed at the same height in every analysed lane (${R.rows.map(r => r.name).join(', ')}); the value of a box is the integrated density of ${D.measure}, with ${D.background}. ` +
      `${D.limits[0].toUpperCase() + D.limits.slice(1)}. ${D.normalization[0].toUpperCase() + D.normalization.slice(1)}; ${D.reference}.${sat} ${D.saturation} Values are arbitrary units and compare lanes of this image only.`;
  }

  /* A box around the band nearest (x, y): the band edges are where the lane profile falls to 15 % of
   * the peak above its baseline; padded a little so the edges sit on background. */
  function bandBox(App, xAbs, yAbs) {
    const S = App.S;
    if (!S.lanes.length) return null;
    let lane = 0, bd = Infinity;
    S.lanes.forEach((l, i) => { const d = Math.abs(l.x - xAbs); if (d < bd) { bd = d; lane = i; } });
    const yc = App.snapBandY(S.lanes[lane].x, yAbs, Math.max(10, S.crop.h * 0.04));
    const y = yc != null ? yc : yAbs;
    const strip = App.bandStrip();
    const prof = E.laneProfile(strip, S.bright, S.lanes[lane].x, S.laneHalfW);
    const sm = E.gaussSmooth(prof, 1), b = E.baseline(sm, Math.max(6, Math.round(sm.length / 12)));
    const k = E.clamp(Math.round(y - S.crop.y), 0, sm.length - 1), peak = sm[k] - b[k];
    let a = k, z = k;
    const lim = Math.max(4, Math.round(S.crop.h * 0.08));
    if (peak > 0) {
      while (a > 0 && k - a < lim && sm[a - 1] - b[a - 1] > peak * 0.15 && sm[a - 1] <= sm[a] + peak * 0.05) a--;
      while (z < sm.length - 1 && z - k < lim && sm[z + 1] - b[z + 1] > peak * 0.15 && sm[z + 1] <= sm[z] + peak * 0.05) z++;
    } else { a = k - 4; z = k + 4; }
    const pad = Math.max(2, Math.round((z - a) * 0.35));
    return { y0: S.crop.y + Math.max(0, a - pad), y1: S.crop.y + Math.min(sm.length - 1, z + pad), lane };
  }

  /* Bands in every figure lane with their estimated sizes. */
  function bandSizes(App) {
    const S = App.S, lanes = App.figureLanes(), mk = new Set(S.markers.map(m => m.lane));
    App._peakCrop = App.bandStrip();
    try {
      const peaks = lanes.map(i => App.lanePeaks(i));
      const gmax = Math.max(1e-9, ...peaks.map(p => Math.max(0, ...p.map(q => q.v))));
      // the well row sits at the very top of the crop, above every ladder band: not a band
      const topMk = Math.min(Infinity, ...S.markers.flatMap(m => m.bands.filter(b => b.matched || b.manual).map(b => b.y - S.crop.y)));
      const wellZone = Math.max(8, S.crop.h * 0.035);
      const isWell = y => y < wellZone && y < topMk - 3;
      return lanes.map((i, j) => {
        const lmax = Math.max(0, ...peaks[j].filter(q => !isWell(q.y)).map(q => q.v));
        const bands = mk.has(i) ? [] : peaks[j].filter(q => !isWell(q.y) && q.v >= lmax * 0.1 && q.v >= gmax * 0.05).map(q => {
          const y = q.y + S.crop.y, e = App.estimateInfo(y);
          return { y, size: e ? e.bp : null, extrap: e ? e.extrap : null, strength: q.v / gmax };
        });
        return { lane: i, name: S.lanes[i].name || String(i + 1), marker: mk.has(i), bands };
      });
    } finally { App._peakCrop = null; }
  }

  // ---------- export helpers ----------
  const num = (v, d) => (v == null || !isFinite(v) ? '' : (+v).toFixed(d));
  function csv(rows) { return rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n') + '\r\n'; }
  // a cell's flags in words, for the CSV and the table's tooltips
  function flagText(f) {
    return [f.sat ? 'clipped pixels' : '', f.below === 'lod' ? 'below LOD' : f.below === 'loq' ? 'below LOQ' : '',
      f.den === 'sat' ? 'denominator clipped' : f.den === 'weak' ? 'denominator below its LOQ' : ''].filter(Boolean).join('; ');
  }
  function quantCSV(App, R) {
    const S = App.S, out = [], D = describe(App, R);
    out.push(['# GelGrapher densitometry', S.file.name, 'SHA-256 ' + S.file.sha256]);
    out.push(['# measure', D.measure]);
    out.push(['# pixels', D.pixels]);
    out.push(['# background', D.background]);
    out.push(['# limits', D.limits]);
    out.push(['# area', D.area]);
    out.push(['# normalization', D.normalization]);
    out.push(['# reference', D.reference]);
    out.push(['# saturation', D.saturation]);
    out.push(['# box width (px)', num(R.halfWidthPx * 2, 1), 'values', 'integrated density, arbitrary units']);
    const head = ['well', 'lane'];
    R.rows.forEach(r => { head.push(`${r.name} volume`); head.push(`${r.name} LOQ`); head.push(`${r.name} clipped px`); head.push(`${r.name} flags`); });
    if (R.totals) head.push(`${R.normLabel} (denominator)`);
    R.rows.forEach((r, k) => { if (R.normLabel && k !== R.control) head.push(`${r.name} / ${R.normLabel}`); });
    R.rows.forEach((r, k) => { if (k !== R.control) head.push(`${r.name} relative`); });
    out.push(head);
    R.lanes.forEach((i, j) => {
      const line = [i + 1, R.names[j]];
      R.rows.forEach((r, k) => { const c = R.cells[k][j]; line.push(num(c.vol, 3)); line.push(num(c.loq, 3)); line.push(c.sat); line.push(flagText(R.flags[k][j])); });
      if (R.totals) line.push(num(R.totals[j], 3));
      R.rows.forEach((r, k) => { if (R.normLabel && k !== R.control) line.push(num(R.norm[k][j], 4)); });
      R.rows.forEach((r, k) => { if (k !== R.control) line.push(num(R.rel[k][j], 4)); });
      out.push(line);
    });
    return csv(out);
  }
  function sizesCSV(App, T) {
    const out = [['well', 'lane', 'band', `size (${App.baseUnit()})`, 'extrapolated', 'relative strength']];
    T.forEach(l => l.bands.forEach((b, k) => out.push([l.lane + 1, l.name, k + 1, b.size == null ? '' : num(b.size, App.baseUnit() === 'kDa' ? 1 : 0), b.extrap ? 'yes' : 'no', num(b.strength, 3)])));
    return csv(out);
  }

  /* Publication bar chart (SVG in pt, same look as the figure): relative intensity per lane. */
  function chartSVG(App, R) {
    const st = App.S.style, pt = st.fontPt, lw = st.lineWidthPt, MM = G.Render.MM, measure = G.Render.measure;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tgt = R.rows.map((r, k) => k).filter(k => k !== R.control);
    if (!tgt.length || !R.lanes.length) return null;
    const P = Object.assign({ type: 'bar', values: false, refLine: true, ylabel: '', title: '' }, App.S.quant.plot || {});
    // relative to the reference lane when every box has a real band there; otherwise the values themselves
    const useRel = tgt.every(k => R.refOk[k]);
    const vals = tgt.map(k => (useRel ? R.rel[k] : R.norm[k]));
    const vmax = Math.max(1, ...vals.flat().filter(v => v != null));
    // nice axis: 1, 2, 2.5 or 5 x 10^n steps, 3-6 ticks
    const raw = vmax * 1.1 / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
    const top = Math.ceil(vmax * 1.05 / step) * step;
    const groupW = Math.max(4.5 * MM, tgt.length * 2.6 * MM), barW = groupW * 0.72 / tgt.length;
    const PW = groupW * R.lanes.length, PH = 38 * MM;
    const fills = ['#3a3a3a', '#a6a6a6', '#ffffff', '#6e6e6e'];
    const names = R.names.map(n => n.replace(/\*/g, ''));
    const maxName = Math.max(...names.map(n => measure(n, pt)));
    const tilt = maxName > groupW * 0.95;
    const els = [];
    // axes
    els.push(`<line x1="0" y1="0" x2="0" y2="${PH}" stroke="#000" stroke-width="${lw}"/>`);
    els.push(`<line x1="0" y1="${PH}" x2="${PW}" y2="${PH}" stroke="#000" stroke-width="${lw}"/>`);
    let tickW = 0;
    for (let v = 0; v <= top + 1e-9; v += step) {
      const y = PH - v / top * PH, t = +v.toFixed(6) + '';
      tickW = Math.max(tickW, measure(t, pt));
      els.push(`<line x1="${-2.5}" y1="${y}" x2="0" y2="${y}" stroke="#000" stroke-width="${lw}"/>`);
      els.push(`<text x="${-4}" y="${y + pt * 0.35}" font-size="${pt}" text-anchor="end">${esc(t)}</text>`);
    }
    // reference level
    if (P.refLine && useRel && top >= 1) els.push(`<line x1="0" y1="${PH - PH / top}" x2="${PW}" y2="${PH - PH / top}" stroke="#808080" stroke-width="${lw}" stroke-dasharray="2,1.5"/>`);
    R.lanes.forEach((lane, j) => {
      const gx = j * groupW + groupW * 0.14;
      tgt.forEach((k, t) => {
        const v = vals[t][j];
        if (v == null) return;
        const h = v / top * PH, bx = gx + t * barW;
        // below its limit of quantification: dashed outline (the hint under the plot options says so)
        const blq = R.flags && R.flags[tgt[t]] && R.flags[tgt[t]][j].below, dash = blq ? ` stroke-dasharray="${(lw * 3).toFixed(2)},${(lw * 2).toFixed(2)}"` : '';
        if (P.type === 'point') els.push(`<circle cx="${bx + barW / 2}" cy="${PH - h}" r="${Math.min(barW * 0.42, pt * 0.42)}" fill="${blq ? '#ffffff' : fills[t % fills.length]}" stroke="#000" stroke-width="${lw}"${dash}/>`);
        else els.push(`<rect x="${bx}" y="${PH - h}" width="${barW}" height="${h}" fill="${blq ? '#ffffff' : fills[t % fills.length]}" stroke="#000" stroke-width="${lw}"${dash}/>`);
        if (P.values) els.push(`<text x="${bx + barW / 2}" y="${PH - h - pt * 0.5}" font-size="${pt * 0.85}" text-anchor="middle">${esc(v >= 100 ? String(Math.round(v)) : v.toPrecision(3))}</text>`);
      });
      const cx = j * groupW + groupW / 2;
      els.push(tilt
        ? `<g transform="translate(${cx + pt * 0.3},${PH + 3 + pt * 0.2}) rotate(-45)"><text x="0" y="0" font-size="${pt}" text-anchor="end">${esc(names[j])}</text></g>`
        : `<text x="${cx}" y="${PH + 3 + pt}" font-size="${pt}" text-anchor="middle">${esc(names[j])}</text>`);
    });
    const ctl = R.normLabel;
    const yLabel = P.ylabel ? P.ylabel : useRel
      ? (tgt.length === 1 ? (ctl ? `${R.rows[tgt[0]].name} / ${ctl} (relative)` : `${R.rows[tgt[0]].name} (relative intensity)`) : (ctl ? `Relative level (normalized to ${ctl})` : 'Relative intensity'))
      : (tgt.length === 1 ? (ctl ? `${R.rows[tgt[0]].name} / ${ctl}` : `${R.rows[tgt[0]].name} (integrated density, a.u.)`) : (ctl ? `Normalized to ${ctl}` : 'Integrated density (a.u.)'));
    const ylx = -4 - tickW - pt * 0.9;
    els.push(`<g transform="translate(${ylx},${PH / 2}) rotate(-90)"><text x="0" y="0" font-size="${pt}" text-anchor="middle">${esc(yLabel)}</text></g>`);
    // legend for several targets
    let legH = 0;
    if (tgt.length > 1) {
      let x = 0;
      tgt.forEach((k, t) => {
        els.push(`<rect x="${x}" y="${-pt * 1.6}" width="${pt * 0.8}" height="${pt * 0.8}" fill="${fills[t % fills.length]}" stroke="#000" stroke-width="${lw}"/>`);
        els.push(`<text x="${x + pt * 1.1}" y="${-pt * 0.85}" font-size="${pt}" text-anchor="start">${esc(R.rows[k].name)}</text>`);
        x += pt * 1.6 + measure(R.rows[k].name, pt);
      });
      legH = pt * 2;
    }
    if (P.title) { els.push(`<text x="${PW / 2}" y="${-legH - pt * 0.9}" font-size="${pt * 1.15}" text-anchor="middle" font-weight="bold">${esc(P.title)}</text>`); legH += pt * 2.1; }
    const bottom = tilt ? 3 + maxName * 0.71 + pt : 3 + pt * 1.4;
    const vx = ylx - pt * 1.2, vy = -legH - 3, vw = PW - vx + 4, vh = PH + bottom + legH + 6;
    const body = els.join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(vw / MM).toFixed(2)}mm" height="${(vh / MM).toFixed(2)}mm" viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}" font-family="${esc(G.Render.FONTS[G.Render.fontName(st.font)])}" fill="#000">` +
      `<rect x="${vx.toFixed(2)}" y="${vy.toFixed(2)}" width="${vw.toFixed(2)}" height="${vh.toFixed(2)}" fill="#fff"/>` + body + '</svg>';
    return { svg, w: vw, h: vh };
  }

  G.Quant = { measure, measureBox, bandBox, bandSizes, quantCSV, sizesCSV, chartSVG, quantLanes, region, boxHalfWidth, methodsText, describe, flagText, BG_TEXT, MODE_TEXT };
})(window);

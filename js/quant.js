/* Densitometry and band calling.
 *
 * Band boxes ("rows") span the figure lanes at one height, e.g. the target band and the loading
 * control of a Western blot. For every lane the signal inside a box of fixed width is integrated
 * on the RAW pixel values (rotation only; the display contrast never enters the numbers), after
 * subtracting a background:
 *   edge    - straight line between the profile at the top and bottom edge of the box (the usual
 *             "close the peak" method of ImageJ's gel analyser)
 *   rolling - rolling-ball-like baseline (morphological opening) of the whole lane profile
 *   none    - raw integrated density
 * Dark-band images (Coomassie, silver, X-ray film) are inverted first so that more protein / probe
 * always means more signal. Values are arbitrary units: compare lanes of the same image only.
 */
(function (G) {
  'use strict';
  const E = G.Engine;
  const SAT = 0.998;

  // pixel-sum profile of one lane window, rows ya..yb (absolute rotated px)
  function profile(img, bright, x0, x1, ya, yb) {
    const out = new Float64Array(yb - ya + 1);
    for (let y = ya; y <= yb; y++) {
      let s = 0;
      const row = y * img.w;
      for (let x = x0; x <= x1; x++) { const v = img.data[row + x]; s += bright ? v : 1 - v; }
      out[y - ya] = s;
    }
    return out;
  }
  const mean = (a, i0, i1) => { let s = 0, n = 0; for (let i = Math.max(0, i0); i <= Math.min(a.length - 1, i1); i++) { s += a[i]; n++; } return n ? s / n : 0; };

  function boxHalfWidth(S) {
    const pitch = S.lanePitch || S.laneHalfW / 0.3;
    return Math.max(1, pitch * (S.quant.wFrac || 0.7) / 2);
  }
  // lanes that are quantified: in the figure, not markers
  function quantLanes(App) {
    const mk = new Set(App.S.markers.map(m => m.lane));
    return App.figureLanes().filter(i => !mk.has(i));
  }

  /* Integrated density of one box. Returns {vol, raw, bg, sat, n}. */
  function measureBox(App, lane, row, method) {
    const S = App.S, img = App.ensureRot(), bright = S.bright;
    const hw = boxHalfWidth(S), cx = S.lanes[lane].x;
    const x0 = E.clamp(Math.round(cx - hw), 0, img.w - 1), x1 = E.clamp(Math.round(cx + hw), 0, img.w - 1);
    const y0 = E.clamp(Math.round(Math.min(row.y0, row.y1)), 0, img.h - 1), y1 = E.clamp(Math.round(Math.max(row.y0, row.y1)), 0, img.h - 1);
    let sat = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const v = img.data[y * img.w + x]; if (bright ? v >= SAT : v <= 1 - SAT) sat++; }
    const p = profile(img, bright, x0, x1, y0, y1);
    let bl;
    if (method === 'none') bl = () => 0;
    else if (method === 'rolling') {
      // baseline of the lane over the analysis region (crop rows), radius ~ 1.5 box heights
      const ca = E.clamp(Math.round(Math.min(S.crop.y, y0)), 0, img.h - 1), cb = E.clamp(Math.round(Math.max(S.crop.y + S.crop.h - 1, y1)), 0, img.h - 1);
      const full = Float32Array.from(profile(img, bright, x0, x1, ca, cb));
      const b = E.baseline(full, Math.max(5, Math.round(1.5 * (y1 - y0 + 1))));
      bl = y => b[y - ca];
    } else {
      const e0 = mean(p, 0, 1), e1 = mean(p, p.length - 2, p.length - 1), n = Math.max(1, y1 - y0);
      bl = y => e0 + (e1 - e0) * (y - y0) / n;
    }
    let vol = 0, raw = 0, bg = 0;
    for (let y = y0; y <= y1; y++) { const v = p[y - y0], b = bl(y); raw += v; bg += b; vol += Math.max(0, v - b); }
    return { vol, raw, bg, sat, n: (x1 - x0 + 1) * (y1 - y0 + 1) };
  }

  /* Whole table: rows x lanes, plus normalisation to the loading-control row and the reference lane. */
  function measure(App) {
    const S = App.S, q = S.quant, lanes = quantLanes(App), rows = q.rows;
    const ctl = q.control >= 0 && q.control < rows.length ? q.control : -1;
    const ref = lanes.includes(q.ref) ? q.ref : lanes[0];
    const cells = rows.map(r => lanes.map(i => measureBox(App, i, r, q.bg)));
    const vol = cells.map(r => r.map(c => c.vol));
    const norm = vol.map((r, k) => (ctl >= 0 && k !== ctl ? r.map((v, j) => (vol[ctl][j] > 0 ? v / vol[ctl][j] : null)) : r.slice()));
    const ri = lanes.indexOf(ref);
    const rel = norm.map(r => r.map(v => (v != null && ri >= 0 && r[ri] > 0 ? v / r[ri] : null)));
    const satLanes = new Set();
    cells.forEach(r => r.forEach((c, j) => { if (c.sat > 0) satLanes.add(lanes[j]); }));
    return { lanes, names: lanes.map(i => S.lanes[i].name || String(i + 1)), rows: rows.map((r, k) => ({ name: r.name || `Band ${k + 1}`, control: k === ctl })),
      cells, vol, norm, rel, control: ctl, ref, method: q.bg, halfWidthPx: boxHalfWidth(S), saturatedLanes: [...satLanes] };
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
  function quantCSV(App, R) {
    const S = App.S, out = [];
    out.push(['# GelGrapher densitometry', S.file.name, 'SHA-256 ' + S.file.sha256]);
    out.push(['# background', R.method, 'box width (px)', num(R.halfWidthPx * 2, 1), 'reference lane', R.ref + 1, 'loading control', R.control >= 0 ? R.rows[R.control].name : 'none']);
    out.push(['# integrated density of raw pixel values (rotation only, no contrast) after background subtraction; arbitrary units']);
    const head = ['well', 'lane'];
    R.rows.forEach(r => { head.push(`${r.name} volume`); head.push(`${r.name} saturated px`); });
    R.rows.forEach((r, k) => { if (R.control >= 0 && k !== R.control) head.push(`${r.name} / ${R.rows[R.control].name}`); });
    R.rows.forEach((r, k) => { if (k !== R.control) head.push(`${r.name} relative`); });
    out.push(head);
    R.lanes.forEach((i, j) => {
      const line = [i + 1, R.names[j]];
      R.rows.forEach((r, k) => { line.push(num(R.vol[k][j], 3)); line.push(R.cells[k][j].sat); });
      R.rows.forEach((r, k) => { if (R.control >= 0 && k !== R.control) line.push(num(R.norm[k][j], 4)); });
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
    const vals = tgt.map(k => R.rel[k]);
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
    if (top >= 1) els.push(`<line x1="0" y1="${PH - PH / top}" x2="${PW}" y2="${PH - PH / top}" stroke="#808080" stroke-width="${lw}" stroke-dasharray="2,1.5"/>`);
    R.lanes.forEach((lane, j) => {
      const gx = j * groupW + groupW * 0.14;
      tgt.forEach((k, t) => {
        const v = vals[t][j];
        if (v == null) return;
        const h = v / top * PH;
        els.push(`<rect x="${gx + t * barW}" y="${PH - h}" width="${barW}" height="${h}" fill="${fills[t % fills.length]}" stroke="#000" stroke-width="${lw}"/>`);
      });
      const cx = j * groupW + groupW / 2;
      els.push(tilt
        ? `<g transform="translate(${cx + pt * 0.3},${PH + 3 + pt * 0.2}) rotate(-45)"><text x="0" y="0" font-size="${pt}" text-anchor="end">${esc(names[j])}</text></g>`
        : `<text x="${cx}" y="${PH + 3 + pt}" font-size="${pt}" text-anchor="middle">${esc(names[j])}</text>`);
    });
    const ctl = R.control >= 0 ? R.rows[R.control].name : null;
    const yLabel = tgt.length === 1
      ? (ctl ? `${R.rows[tgt[0]].name} / ${ctl} (relative)` : `${R.rows[tgt[0]].name} (relative intensity)`)
      : (ctl ? `Relative level (normalized to ${ctl})` : 'Relative intensity');
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
    const bottom = tilt ? 3 + maxName * 0.71 + pt : 3 + pt * 1.4;
    const vx = ylx - pt * 1.2, vy = -legH - 3, vw = PW - vx + 4, vh = PH + bottom + legH + 6;
    const body = els.join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(vw / MM).toFixed(2)}mm" height="${(vh / MM).toFixed(2)}mm" viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}" font-family="Arial, Helvetica, sans-serif" fill="#000">` +
      `<rect x="${vx.toFixed(2)}" y="${vy.toFixed(2)}" width="${vw.toFixed(2)}" height="${vh.toFixed(2)}" fill="#fff"/>` + body + '</svg>';
    return { svg, w: vw, h: vh };
  }

  G.Quant = { measure, measureBox, bandBox, bandSizes, quantCSV, sizesCSV, chartSVG, quantLanes, boxHalfWidth };
})(window);

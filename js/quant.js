/* Densitometry and band calling.
 *
 * WHAT IS MEASURED (calculation version 2; projects measured before keep version 1 (measureLegacy, below)
 * until the user updates them, and say so)
 * A band ("row": a target band, a loading control) has, in every lane, a SIGNAL REGION and BACKGROUND
 * REGIONS fixed in the ORIGINAL decoded pixels. The box is drawn in the working frame (the image as shown:
 * rotated, flipped, geometry-corrected) and placed in that frame once; the frame is kept with it
 * (row.frame -> quant.frames). A later rotation, flip, geometry correction, crop, lane move or figure change
 * moves its outline on screen, never the pixels it measures. Only an explicit edit of the box (dragging it,
 * its width, its background, "Re-centre on lanes") places it again, in the frame then shown (row.placed
 * counts the placements; the edit is undoable like any other).
 * The pixels of a region are those whose centres lie inside its outline mapped to the original image
 * (Engine.boxPixels / rasterPoly): each counted once, weight 1 (no fractional coverage, nothing resampled),
 * grouped in rows along the lane (one working-frame pixel each) for the background and the profile.
 * Signal per pixel: s = I for bright bands, s = 1 - I for dark bands, I = the pixel value on the file's full
 * scale (0..1). Measure-bands-as (S.bright) is set apart from how the figure is displayed (inverted or not),
 * which never changes a value. s is not optical density and not an amount: it is the image's response, and
 * compares lanes of this image only.
 * Corrected signal = sum over the signal region of (s_i - b_i), SIGNED: uncorrected sum U = sum s_i,
 * background contribution B = sum b_i, corrected = U - B (checked). Nothing is clamped at zero: a blank reads
 * around zero, sometimes below, and is reported as measured.
 * Background b (quant.bg):
 *   local   - background regions OUTSIDE the signal region (quant.bgSides: 'ab' above and below (default),
 *             'above', 'below' or 'beside'), quant.bgGap px away from it, quant.bgSize px deep (0 = 40 % of
 *             the region's height, 3 to 12 px). Level: the median of each region's pixels; above and below:
 *             the straight line between the two medians along the lane; one side: that median; beside: the
 *             median of the pixels beside each row and its two neighbours on each side. Sides, gap and depth
 *             can be set for one lane (row.lanes[id].bg, recorded as an override).
 *   edge    - "line between region ends": the straight line between the mean of the first two and of the last
 *             two rows INSIDE the signal region (ImageJ's gel analyser). It assumes those rows hold no band; a
 *             band that reaches them is subtracted from itself, so a broad band can read lower than a narrow
 *             one: flagged whenever the band reaches the region's ends.
 *   rolling - "rolling baseline": a morphological opening (rolling minimum, then maximum, radius 1.5 region
 *             heights) of the lane's row means over the analysis area's height, then smoothed. It can sit low
 *             on a noisy profile (reads faint bands high) and inside a broad band.
 *   border  - the median of a 3 px ring around the signal region, one level (kept for earlier projects).
 *   none    - b = 0.
 *   manual  - in one lane (row.lanes[id].manual = {a, b, la, lb}): integration limits a..b (rows of the band's
 *             frame) and a straight baseline from level la at a to lb at b, drawn by the user on the lane's
 *             profile (manual integration, as in chromatography software). It replaces that lane's region rows
 *             and background; the baseline is taken as exact (no background pixels), the background regions
 *             only give the noise estimate. Reported as manual everywhere (table, CSV, log, methods).
 * Measure (quant.mode): 'box' = whole region (above); 'band' = thresholded signal: only the residuals of the
 * pixels more than 3 sigma_px + 0.004 above their background count. Exploratory: not linear for faint bands.
 * Noise thresholds (ESTIMATED, not assay detection or quantification limits): sigma_px = 1.4826 x the median
 * absolute deviation of the local background pixels about their level; f = the inflation for neighbouring
 * pixels being correlated, (1 + rho_x)/(1 - rho_x) x (1 + rho_y)/(1 - rho_y) from horizontal and vertical
 * neighbour pairs of those residuals (rho clamped to 0..0.95); sigma_sum = sigma_px sqrt(f (n + c n^2 / m)) for
 * n signal and m background pixels (c = pi/2 for a median level, 1 for a mean); thresholds 3 and 10 sigma_sum.
 * They assume the background regions show only noise; blanks and dilution series on your system validate them.
 * Diagnostics per lane: the band reaching the region's ends; background rows rising towards the band
 * (contamination); a background region that is not flat (another band, a smear); two peaks in the region (a
 * neighbouring band); a background region over another measured band;
 * pixels off the image; the value's change when the region is made taller or the background moved away
 * (sensitivity). Clipping: signal pixels at the file's digital limit, or piled up at an extreme below it
 * (probable), at the band end of the scale.
 * Output (quant.output): 'corrected' (background-corrected signal), 'normalized' (divided by a reference band
 * of the same lane, quant.normBand, or by the lane's total signal, quant.norm = 'lane'), 'fold' (versus a
 * reference lane, quant.ref, a lane id the user chose). A result that cannot be given (no reference, a clipped
 * or weak divisor) is not given, with the reason; the output is never switched silently.
 */
(function (G) {
  'use strict';
  const E = G.Engine;
  const VERSION = 2;

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

  /* ---------- frames and placement ---------- */
  const frameKeyOf = f => {
    let sum = 0; const g = f.grid;
    if (g) for (let i = 0; i < g.pts.length; i += 7) sum += g.pts[i] * (i % 13 + 1);
    return `${f.rot}|${f.fh ? 1 : 0}${f.fv ? 1 : 0}|${g ? g.nx + 'x' + g.ny + ':' + sum.toFixed(4) : ''}`;
  };
  function currentFrame(App) { const S = App.S; return { rot: S.rotation || 0, fh: !!(S.flip && S.flip.h), fv: !!(S.flip && S.flip.v), grid: App.geomGrid(S) }; }
  // the frame shown now, kept in quant.frames; returns its key
  function storeFrame(App) {
    const q = App.S.quant, f = currentFrame(App), k = frameKeyOf(f);
    q.frames = q.frames || {};
    if (!q.frames[k]) q.frames[k] = { rot: f.rot, fh: f.fh, fv: f.fv, grid: f.grid ? { nx: f.grid.nx, ny: f.grid.ny, W: f.grid.W, H: f.grid.H, pts: f.grid.pts.slice() } : null };
    return k;
  }
  // frames no band refers to any more are dropped (they can be large: a geometry grid each)
  function pruneFrames(q, keep) {
    if (!q.frames) return;
    const used = new Set(q.rows.map(r => r.frame).filter(Boolean));
    if (keep && keep.frame) used.add(keep.frame);   // a band being placed may not be in the table yet
    Object.keys(q.frames).forEach(k => { if (!used.has(k)) delete q.frames[k]; });
  }
  const mapCache = new Map();
  function frameMapOf(App, key) {
    const q = App.S.quant, f = q.frames && q.frames[key];
    if (!f) return null;
    const ck = key + '|' + App.src0.w + 'x' + App.src0.h;
    let m = mapCache.get(ck);
    if (!m) { m = E.frameMap(Object.assign({ W: App.src0.w, H: App.src0.h }, f)); mapCache.set(ck, m); if (mapCache.size > 40) mapCache.delete(mapCache.keys().next().value); }
    return m;
  }
  const curMap = App => E.frameMap(Object.assign({ W: App.src0.w, H: App.src0.h }, currentFrame(App)));
  const newId = p => p + Math.random().toString(36).slice(2, 8);
  /* Place a band in the frame shown now, rows y0..y1 of it (inclusive), in every lane of the analysis area
   * (ladders aside; lanes left out of the analysis are placed too, so ticking them back needs no edit). A lane's
   * own adjustments (dx, dy0, dy1, background) are kept. An explicit analysis change: undoable, counted. */
  function placeRow(App, row, y0, y1) {
    const S = App.S, g = region(S), mk = new Set(S.markers.map(m => m.lane)), old = row.lanes || {};
    row.frame = storeFrame(App);
    row.y0 = Math.round(Math.min(y0, y1)); row.y1 = Math.round(Math.max(y0, y1));
    row.hw = boxHalfWidth(S);
    row.strip = [Math.min(row.y0, Math.round(g.y)), Math.max(row.y1, Math.round(g.y + g.h - 1))];
    row.lanes = {};
    S.lanes.forEach((l, i) => {
      if (mk.has(i) || l.x < g.x || l.x > g.x + g.w) return;
      const id = App.laneId(i), o = old[id] || {}, L = { cx: l.x };
      ['dx', 'dy0', 'dy1', 'bg'].forEach(k => { if (o[k] != null) L[k] = o[k]; });
      row.lanes[id] = L;
    });
    row.placed = (row.placed || 0) + 1;
    if (!row.id) row.id = newId('b');
    pruneFrames(S.quant, row);
    return row;
  }
  // the band's rows in the frame shown now, at its middle lane: {y0, y1} (for drawing, dragging, labels)
  function rowSpan(App, row) {
    if (!row.frame) return { y0: Math.min(row.y0, row.y1), y1: Math.max(row.y0, row.y1) };
    const fm = frameMapOf(App, row.frame), cm = curMap(App), xs = Object.values(row.lanes || {}).map(L => L.cx).sort((a, b) => a - b);
    const cx = xs.length ? xs[xs.length >> 1] : App.S.crop.x + App.S.crop.w / 2;
    if (!fm) return { y0: row.y0, y1: row.y1 };
    const a = fm.to(cx, row.y0 - 0.5), b = fm.to(cx, row.y1 + 0.5), p = cm.from(a.x, a.y), q = cm.from(b.x, b.y);
    return { y0: Math.min(p.y, q.y) + 0.5, y1: Math.max(p.y, q.y) - 0.5 };
  }
  // an explicit edit of a band's rows (in the frame shown now): the band is placed again in that frame
  function editRow(App, row, y0, y1) { placeRow(App, row, y0, y1); }
  // a lane that has no region in a band yet (added or detected later) is placed into the band's own frame
  function placeLane(App, row, i) {
    const S = App.S, fm = frameMapOf(App, row.frame); if (!fm) return;
    const sp = rowSpan(App, row), cm = curMap(App), p = cm.to(S.lanes[i].x, (sp.y0 + sp.y1) / 2), q = fm.from(p.x, p.y);
    row.lanes[App.laneId(i)] = { cx: q.x };
    row.placed = (row.placed || 0) + 1;
  }
  // bands drawn without a frame (by code, or by an earlier session) are placed in the frame shown now
  function ensurePlaced(App) {
    const q = App.S.quant;
    if (q.version !== VERSION) return;
    q.rows.forEach(r => { if (!r.frame || !r.lanes) placeRow(App, r, r.y0, r.y1); });
  }
  // how far each measured lane's line has moved from its region (working-frame px): a reason to re-centre
  function laneDrift(App, row, i) {
    const L = row.lanes && row.lanes[App.laneId(i)], fm = frameMapOf(App, row.frame);
    if (!L || !fm) return 0;
    const sp = rowSpan(App, row), cm = curMap(App), p = cm.to(App.S.lanes[i].x, (sp.y0 + sp.y1) / 2), q = fm.from(p.x, p.y);
    return Math.abs(q.x - (L.cx + (L.dx || 0)));
  }

  /* ---------- one lane of one band ---------- */
  const median = a => { if (!a.length) return NaN; const b = Float64Array.from(a).sort(); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
  // the region rectangle in the band's frame; d widens it at both ends by d rows (the sensitivity check)
  // a lane's manual integration: limits a..b (rows of the band's frame) and the baseline's levels la, lb there
  const manualOf = L => (L && L.manual && isFinite(L.manual.a) && isFinite(L.manual.b) && L.manual.b > L.manual.a && isFinite(L.manual.la) && isFinite(L.manual.lb) ? L.manual : null);
  function rectOf(row, L, d) {
    const man = manualOf(L), cx = L.cx + (L.dx || 0), hw = row.hw;
    const a = (man ? man.a : row.y0 + (L.dy0 || 0)) - (d || 0), b = (man ? man.b : row.y1 + (L.dy1 || 0)) + (d || 0);
    return { xa: Math.round(cx - hw) - 0.5, xb: Math.round(cx + hw) + 0.5, ya: Math.min(a, b) - 0.5, yb: Math.max(a, b) + 0.5, cx };
  }
  function bgSpec(q, L, rect, extraGap) {
    const o = (L && L.bg) || {}, K = Math.round(rect.yb - rect.ya);
    const sides = ['ab', 'above', 'below', 'beside'].includes(o.sides) ? o.sides : ['ab', 'above', 'below', 'beside'].includes(q.bgSides) ? q.bgSides : 'ab';
    const gap = Math.max(0, Math.round((o.gap != null ? o.gap : q.bgGap != null ? q.bgGap : 2) + (extraGap || 0)));
    const size = Math.max(2, Math.round(o.size || q.bgSize || Math.min(12, Math.max(3, 0.4 * K))));
    return { sides, gap, size, override: !!(L && L.bg) };
  }
  function bgRects(r, spec, method) {
    const { xa, xb, ya, yb } = r, K = Math.round(yb - ya);
    if (method === 'border') {
      const t = 3;
      return [{ side: 'above', xa: xa - t, xb: xb + t, ya: ya - t, yb: ya, v0: -t }, { side: 'below', xa: xa - t, xb: xb + t, ya: yb, yb: yb + t, v0: K },
        { side: 'left', xa: xa - t, xb: xa, ya, yb, v0: 0 }, { side: 'right', xa: xb, xb: xb + t, ya, yb, v0: 0 }];
    }
    const g = spec.gap, z = spec.size, out = [];
    if (spec.sides === 'ab' || spec.sides === 'above') out.push({ side: 'above', xa, xb, ya: ya - g - z, yb: ya - g, v0: -g - z });
    if (spec.sides === 'ab' || spec.sides === 'below') out.push({ side: 'below', xa, xb, ya: yb + g, yb: yb + g + z, v0: K + g });
    if (spec.sides === 'beside') out.push({ side: 'left', xa: xa - g - z, xb: xa - g, ya, yb, v0: 0 }, { side: 'right', xa: xb + g, xb: xb + g + z, ya, yb, v0: 0 });
    return out;
  }
  // the original pixels of a rectangle of frame fm, per row, as raw values and pixel indices
  function gather(App, fm, r) {
    const src = App.src0, W = src.w, d = src.data, P = E.boxPixels(fm, W, src.h, r.xa, r.xb, r.ya, r.yb, r.v0 || 0);
    P.bins.forEach(b => {
      const raw = new Float32Array(b.n), idx = new Int32Array(b.n); let k = 0;
      b.runs.forEach(([Y, X0, X1]) => { for (let X = X0; X <= X1; X++) { idx[k] = Y * W + X; raw[k++] = d[Y * W + X]; } });
      b.raw = raw; b.idx = idx;
    });
    P.rect = r;
    return P;
  }
  const corners = (fm, r) => [[r.xa, r.ya], [r.xb, r.ya], [r.xb, r.yb], [r.xa, r.yb]].map(([x, y]) => { const p = fm.to(x, y); return [+p.x.toFixed(2), +p.y.toFixed(2)]; });
  const cache = new WeakMap();
  function cacheFor(App) { let c = cache.get(App.src0); if (!c) { c = new Map(); cache.set(App.src0, c); } return c; }

  /* One lane of one band: { value (the corrected signal, or null with `unavailable`), U, B, n, nb, sigmaPx, f,
   * t3, t10, clip: {n, kind}, flags, review: [reasons], sens, prof, prov }. opts: {d, gapAdd, bare} (bare: the
   * value only, for the sensitivity check). */
  function measureCell(App, row, lid, opts) {
    opts = opts || {};
    const S = App.S, q = S.quant, mode = q.mode === 'band' ? 'band' : 'box';
    const L = row.lanes && row.lanes[lid], fm = L && frameMapOf(App, row.frame);
    if (!L || !fm) return { value: null, unavailable: 'No measurement region in this lane yet (Re-centre on lanes places one).', flags: { unplaced: true }, review: [], n: 0 };
    // a baseline drawn on the lane's profile replaces the band's background method in this lane
    const man = manualOf(L), method = man ? 'manual' : ['local', 'edge', 'rolling', 'border', 'none'].includes(q.bg) ? q.bg : 'local';
    const key = JSON.stringify([row.frame, row.y0, row.y1, row.hw, row.strip, L, method, mode, q.bgSides, q.bgGap, q.bgSize, S.bright, opts.d || 0, opts.gapAdd || 0, !!opts.bare]);
    const C = cacheFor(App);
    if (C.has(key)) return C.get(key);
    const bright = S.bright, val = bright ? v => v : v => 1 - v;
    const rect = rectOf(row, L, opts.d), K = Math.round(rect.yb - rect.ya), spec = bgSpec(q, L, rect, opts.gapAdd);
    const sig = gather(App, fm, rect);
    // the local background regions: subtracted with the local method, and the noise and contamination
    // diagnostics of every method
    const loc = bgRects(rect, spec, 'local').map(r => Object.assign(gather(App, fm, r), { side: r.side }));
    const sv = b => { const o = new Float64Array(b.raw.length); for (let i = 0; i < o.length; i++) o[i] = val(b.raw[i]); return o; };
    const sideVals = side => { const out = []; side.bins.forEach(b => { const v = sv(b); for (let i = 0; i < v.length; i++) out.push(v[i]); }); return out; };
    // the local model: level(v) at a row centre v (rows of the signal region are v = 0.5 .. K - 0.5)
    const A = loc.find(r => r.side === 'above'), Bw = loc.find(r => r.side === 'below'), lat = loc.filter(r => r.side === 'left' || r.side === 'right');
    let localLev = null, oneSide = false, mLocal = 0, cLocal = Math.PI / 2;
    if (spec.sides === 'beside') {
      const all = []; lat.forEach(r => all.push(...sideVals(r))); mLocal = all.length;
      if (all.length) {
        const g = median(all), per = [];
        for (let j = 0; j < K; j++) { const w = []; lat.forEach(r => { for (let t = Math.max(0, j - 2); t <= Math.min(K - 1, j + 2); t++) { const v = sv(r.bins[t]); for (let i = 0; i < v.length; i++) w.push(v[i]); } }); per.push(w.length >= 5 ? median(w) : g); }
        localLev = v => per[E.clamp(Math.floor(v), 0, K - 1)];
        cLocal = Math.PI / 2 * Math.max(1, K / 5);
      }
    } else {
      const va = A ? sideVals(A) : [], vb = Bw ? sideVals(Bw) : [];
      mLocal = va.length + vb.length;
      const ma = median(va), mb = median(vb), cA = -spec.gap - spec.size / 2, cB = K + spec.gap + spec.size / 2;
      if (va.length && vb.length) localLev = v => ma + (mb - ma) * (v - cA) / (cB - cA);
      else if (va.length || vb.length) { const m0 = va.length ? ma : mb; localLev = () => m0; oneSide = spec.sides === 'ab'; }
    }
    // the method's level per signal row, and the pixels it rests on
    let lev = null, m = Infinity, c = 0, ring = null;
    const binMean = b => { const v = sv(b); let t = 0; for (let i = 0; i < v.length; i++) t += v[i]; return v.length ? t / v.length : NaN; };
    if (method === 'manual') { const K1 = Math.max(1, K - 1); lev = j => man.la + (man.lb - man.la) * j / K1; m = Infinity; c = 0; }
    else if (method === 'local') { if (localLev) { lev = j => localLev(j + 0.5); m = Math.max(1, mLocal); c = cLocal; } }
    else if (method === 'edge') {
      const e = idx => { let t = 0, n = 0; idx.forEach(k => { const b = sig.bins[k]; const v = sv(b); for (let i = 0; i < v.length; i++) t += v[i]; n += v.length; }); return n ? t / n : 0; };
      const first = [0, Math.min(1, K - 1)], last = [Math.max(0, K - 2), K - 1], e0 = e([...new Set(first)]), e1 = e([...new Set(last)]);
      lev = j => e0 + (e1 - e0) * j / Math.max(1, K - 1);
      m = Math.max(1, [...new Set(first.concat(last))].reduce((a, k) => a + sig.bins[k].n, 0)); c = 1;
    } else if (method === 'rolling') {
      const y0 = Math.min(row.strip ? row.strip[0] : rect.ya + 0.5, rect.ya + 0.5), y1 = Math.max(row.strip ? row.strip[1] : rect.yb - 0.5, rect.yb - 0.5);
      const st = gather(App, fm, { xa: rect.xa, xb: rect.xb, ya: y0 - 0.5, yb: y1 + 0.5 });
      const prof = Float32Array.from(st.bins.map(b => { const v = binMean(b); return isNaN(v) ? 0 : v; }));
      const base = E.baseline(prof, Math.max(5, Math.round(1.5 * K))), off = Math.round(rect.ya + 0.5 - y0);
      lev = j => base[E.clamp(off + j, 0, base.length - 1)];
      m = Math.max(1, 4 * Math.round(rect.xb - rect.xa)); c = 1;
    } else if (method === 'border') {
      ring = bgRects(rect, spec, 'border').map(r => Object.assign(gather(App, fm, r), { side: r.side }));
      const all = []; ring.forEach(r => all.push(...sideVals(r)));
      if (all.length) { const md = median(all); lev = () => md; m = all.length; c = Math.PI / 2; }
    } else { lev = () => 0; m = Infinity; c = 0; }
    // the signal: per row sums, the signed corrected sum, and (thresholded) the counted residuals
    let U = 0, Bsum = 0, n = 0;
    const prof = [];
    sig.bins.forEach((b, j) => { const v = sv(b); let t = 0; for (let i = 0; i < v.length; i++) t += v[i]; const lv = lev ? lev(j) : NaN; prof.push({ v: j + 0.5, n: v.length, mean: v.length ? t / v.length : NaN, bg: lv }); U += t; n += v.length; if (lev) Bsum += v.length * lv; });
    // noise from the local background regions' residuals about their level
    const resid = new Map(); let rs = [];
    if (localLev) loc.forEach(r => r.bins.forEach(b => { const v = sv(b), lv = localLev(b.v + 0.5); for (let i = 0; i < v.length; i++) { const e = v[i] - lv; resid.set(b.idx[i], e); rs.push(e); } }));
    const mr = rs.length ? median(rs) : 0, sigmaPx = rs.length >= 5 ? 1.4826 * median(rs.map(e => Math.abs(e - mr))) : NaN;
    const W = App.src0.w, corr = dx => { let sab = 0, saa = 0, sbb = 0, k = 0; resid.forEach((e, i) => { const o = resid.get(i + dx); if (o != null && (dx !== 1 || (i % W) + 1 < W)) { sab += (e - mr) * (o - mr); saa += (e - mr) ** 2; sbb += (o - mr) ** 2; k++; } }); return k >= 20 && saa > 0 && sbb > 0 ? E.clamp(sab / Math.sqrt(saa * sbb), 0, 0.95) : 0; };
    const rx = corr(1), ry = corr(W), f = Math.min(25, (1 + rx) / (1 - rx) * (1 + ry) / (1 - ry));
    let value = lev ? U - Bsum : null, counted = n, floor = 0;
    if (value != null && mode === 'band') {
      floor = 3 * (isFinite(sigmaPx) ? sigmaPx : 0) + 0.004; value = 0; counted = 0;
      sig.bins.forEach((b, j) => { const v = sv(b), lv = lev(j); let t = 0; for (let i = 0; i < v.length; i++) { const d = v[i] - lv; if (d > floor) { value += d; counted++; t += d; } } prof[j].counted = v.length ? t / v.length : 0; });
    }
    const unavailable = !lev ? (method === 'local' || method === 'border' ? 'No background region inside the image for this lane.' : 'No background.')
      : !n ? 'The region lies outside the image.' : null;
    if (unavailable) value = null;
    if (opts.bare) { const out = { value }; C.set(key, out); return out; }
    const sigmaSum = isFinite(sigmaPx) ? sigmaPx * Math.sqrt(f * (n + (isFinite(m) ? c * n * n / m : 0))) : NaN;
    // clipping: signal pixels at the band end of the scale where this file clips
    const clipT = App.satPredicate ? App.satPredicate() : null;
    let clipN = 0; if (clipT) sig.bins.forEach(b => { for (let i = 0; i < b.raw.length; i++) if (clipT(b.raw[i])) clipN++; });
    const a = App.acq, side = a ? (bright ? a.hi : a.lo) : null;
    const clipKind = clipN ? (side && side.kind === 'pileup' ? 'pileup' : 'limit') : null;
    // diagnostics on the residual profile above the LOCAL level (whatever the method subtracts: the line between
    // the region's ends passes through its end rows by construction, so it cannot show a band reaching them)
    const lvAt = j => (method === 'manual' ? lev(j) : localLev ? localLev(j + 0.5) : lev ? lev(j) : 0);
    prof.forEach((p, j) => { p.local = localLev ? localLev(j + 0.5) : null; });
    const pr = prof.map((p, j) => (isNaN(p.mean) ? 0 : p.mean - lvAt(j))), peak = Math.max(0, ...pr), tiny = isFinite(sigmaPx) ? 3 * sigmaPx : 0;
    // a band worth checking: above 3 sigma of the pixel noise and above 0.2 % of full scale
    const strong = peak > Math.max(tiny, 0.002);
    const boundary = strong && K >= 3 ? [pr[0] > 0.25 * peak ? 'top' : '', pr[K - 1] > 0.25 * peak ? 'bottom' : ''].filter(Boolean) : [];
    // a background region whose rows rise towards the band holds some of it
    const contaminated = [];
    if (strong) [A, Bw].forEach(r => {
      if (!r || r.bins.length < 2) return;
      const meds = r.bins.map(b => median(Array.from(sv(b)))), near = r.side === 'above' ? meds.slice(Math.ceil(meds.length / 2)) : meds.slice(0, Math.floor(meds.length / 2));
      const far = r.side === 'above' ? meds.slice(0, Math.floor(meds.length / 2)) : meds.slice(Math.ceil(meds.length / 2));
      const mean = v => v.filter(x => !isNaN(x)).reduce((s, x, _, w) => s + x / w.length, 0), npx = r.n / 2;
      if (near.length && far.length && mean(near) - mean(far) > Math.max(3 * (isFinite(sigmaPx) ? sigmaPx : 0) / Math.sqrt(Math.max(1, npx)), 0.1 * peak)) contaminated.push(r.side);
    });
    // a background region that is not flat (another band, a smear, a speck): a row's median strays from the local
    // model by more than 10 % of the band's peak and 4 standard errors of a row median
    const uneven = [];
    if (strong && localLev) loc.forEach(r => {
      if (contaminated.includes(r.side) || r.side === 'left' || r.side === 'right') return;
      const off = r.bins.some(b => { if (b.n < 3) return false; const md = median(Array.from(sv(b))), se = 1.2533 * (isFinite(sigmaPx) ? sigmaPx : 0) / Math.sqrt(b.n); return Math.abs(md - localLev(b.v + 0.5)) > Math.max(4 * se, 0.1 * peak); });
      if (off) uneven.push(r.side);
    });
    // two peaks in the region: a neighbouring band, or a doublet
    let peaks = 0;
    if (strong) { for (let j = 1; j < K - 1; j++) if (pr[j] >= pr[j - 1] && pr[j] > pr[j + 1] && pr[j] > 0.3 * peak) { let lo = pr[j]; for (let t = j - 1; t >= 0 && pr[t] <= pr[j]; t--) lo = Math.min(lo, pr[t]); if (pr[j] - lo > 0.25 * peak || peaks === 0) peaks++; } }
    if (strong && K >= 3) { if (pr[0] > pr[1] && pr[0] > 0.3 * peak) peaks++; if (pr[K - 1] > pr[K - 2] && pr[K - 1] > 0.3 * peak) peaks++; }
    // the background over another band: another band's region of this lane in the same frame
    const overlap = [];
    q.rows.forEach(o => { if (o === row || o.frame !== row.frame || !o.lanes || !o.lanes[lid]) return; const r2 = rectOf(o, o.lanes[lid]); loc.forEach(b => { if (b.rect.ya < r2.yb && b.rect.yb > r2.ya && b.rect.xa < r2.xb && b.rect.xb > r2.xa) overlap.push(`${b.side} overlaps ${o.name || 'another band'}`); }); });
    // sensitivity: the region made taller (the band was cut off?) and the background moved away (it held band?)
    let sens = null;
    if (value != null && mode === 'box' && method !== 'manual') {
      const dd = Math.max(1, Math.round(0.2 * K)), tall = measureCell(App, row, lid, { d: dd, bare: true }).value;
      const away = method === 'local' ? measureCell(App, row, lid, { gapAdd: Math.max(2, Math.round(0.3 * K)), bare: true }).value : null;
      sens = { taller: tall, tallerRows: dd, away, awayPx: method === 'local' ? Math.max(2, Math.round(0.3 * K)) : 0 };
    }
    const tol = v => Math.max(0.1 * Math.abs(value), 3 * (isFinite(sigmaSum) ? sigmaSum : 0));
    const unstable = sens ? [sens.taller != null && Math.abs(sens.taller - value) > tol() ? 'taller' : '', sens.away != null && Math.abs(sens.away - value) > tol() ? 'away' : ''].filter(Boolean) : [];
    const t3 = 3 * sigmaSum, t10 = 10 * sigmaSum;
    // background regions that hold band give no noise estimate (the band's slope reads as scatter): no threshold
    // call then; the lane is marked for review instead
    const noiseOk = !contaminated.length && !uneven.length;
    const below = value == null || !isFinite(sigmaSum) || !noiseOk ? null : value < t3 ? 't3' : value < t10 ? 't10' : null;
    // a drawn baseline does not use the background regions: their checks only qualify the noise estimate
    const own = method !== 'manual';
    const flags = { clip: clipKind, below, noise: noiseOk ? null : contaminated.length ? 'background holds band' : 'background not flat', boundary: boundary.length ? boundary : null, contaminated: own && contaminated.length ? contaminated : null, uneven: own && uneven.length ? uneven : null, twoPeaks: peaks >= 2,
      outside: sig.outside > 0 || (own && loc.some(r => r.outside > 0)) ? { signal: sig.outside, background: own ? loc.reduce((s2, r) => s2 + r.outside, 0) : 0 } : null,
      overlap: own && overlap.length ? overlap : null, oneSide: own && oneSide, unstable: unstable.length ? unstable : null, override: spec.override || !own, edgeMethod: method === 'edge', manual: !own };
    const review = [];
    if (flags.boundary) review.push(method === 'manual' ? 'the peak continues beyond the drawn ' + boundary.map(b => (b === 'top' ? 'start' : 'end')).join(' and ') : method === 'edge' ? 'the band reaches the region\'s ends, where this background is sampled: it subtracts part of the band' : 'the band reaches the region\'s ' + boundary.join(' and ') + ' edge: part of it may lie outside');
    if (flags.contaminated) review.push(`the background ${contaminated.join(' and ')} rises towards the band: it holds part of the band`);
    if (flags.uneven) review.push(`the background ${uneven.join(' and ')} is not flat: another band or a smear may lie in it`);
    if (flags.twoPeaks) review.push('two peaks in the region: a neighbouring band or a doublet may be included');
    if (flags.overlap) review.push('background region ' + overlap.join(', '));
    if (flags.outside && flags.outside.signal) review.push('part of the region lies outside the image');
    if (flags.unstable) review.push(unstable.map(u => (u === 'taller' ? `the value changes by more than 10 % when the region is ${sens.tallerRows} rows taller at each end` : `the value changes by more than 10 % when the background is moved ${sens.awayPx} px further away`)).join('; '));
    if (flags.oneSide) review.push('only one background side lies inside the image');
    const src = S.file || {};
    const out = {
      value, unavailable, U: lev ? U : null, B: lev ? Bsum : null, n, counted, floor, nb: method === 'local' ? mLocal : method === 'border' ? (ring || []).reduce((s2, r) => s2 + r.n, 0) : method === 'edge' ? m : 0, method,
      sigmaPx, f, rho: [rx, ry], sigmaSum, t3, t10, lod: t3, loq: t10, clip: { n: clipN, kind: clipKind }, flags, review, sens, prof,
      // the rows of the local background regions (the profile shows exactly the pixels the background came from)
      bgProf: loc.flatMap(r => r.bins.map(b => ({ v: b.v + 0.5, side: r.side, n: b.n, mean: binMean(b) }))),
      prov: { image: src.name, sha256: src.sha256, version: VERSION, method, mode, polarity: bright ? 'bright bands: s = I' : 'dark bands: s = 1 - I',
        signal: { corners: corners(fm, rect), px: n, outsidePx: sig.outside, rows: K },
        background: (method === 'border' ? ring : method === 'local' ? loc : []).map(r => ({ side: r.side, corners: corners(fm, r.rect), px: r.n })),
        noiseRegions: loc.map(r => ({ side: r.side, corners: corners(fm, r.rect), px: r.n })),
        manual: man ? { rows: [man.a, man.b], levels: [+man.la.toFixed(6), +man.lb.toFixed(6)] } : undefined,
        spec, frame: row.frame, placed: row.placed || 1, laneId: lid, override: ['dx', 'dy0', 'dy1', 'bg', 'manual'].filter(k => L[k] != null) }
    };
    C.set(key, out);
    return out;
  }
  // the lane's whole signal over the analysis area's height, at the band's lane position (lane normalization)
  function laneTotalCell(App, row, lid) {
    const L = row.lanes && row.lanes[lid];
    if (!L) return { value: null, unavailable: 'No region in this lane.', flags: {}, review: [] };
    const st = row.strip || [row.y0, row.y1];
    const pseudo = { frame: row.frame, y0: st[0], y1: st[1], hw: row.hw, strip: st, lanes: { [lid]: { cx: L.cx, dx: L.dx } }, name: 'lane total' };
    return measureCell(App, pseudo, lid);
  }

  /* The lane's profile around a band, for drawing and for manual integration: the mean signal (s, the same units
   * as the value) of each row of the lane's region width, over the region and its own height above and below
   * (at least 12 rows), in rows of the band's frame. { rows: [{y, mean}], region: [first, last], baseline:
   * [{y, b}] (what the calculation subtracts), bgRows: [{y, mean, side}] (rows of the background regions),
   * manual, method }. */
  function laneProfile(App, row, lid) {
    const L = row.lanes && row.lanes[lid], fm = L && frameMapOf(App, row.frame);
    if (!fm) return null;
    // the window is anchored on the band's own region (a drawn baseline does not move it, unless it reaches past it)
    const c = measureCell(App, row, lid), rect = rectOf(row, L), auto = rectOf(row, Object.assign({}, L, { manual: null })), K = Math.round(auto.yb - auto.ya), M = Math.max(12, K);
    const wa = Math.min(auto.ya - M, rect.ya - 4), wb = Math.max(auto.yb + M, rect.yb + 4);
    const key = JSON.stringify(['lp', row.frame, row.hw, L.cx, L.dx || 0, wa, wb, App.S.bright]), C = cacheFor(App);
    let rows = C.get(key);
    if (!rows) {
      const val = App.S.bright ? v => v : v => 1 - v, w = gather(App, fm, { xa: rect.xa, xb: rect.xb, ya: wa, yb: wb, v0: 0 });
      rows = w.bins.map((b, t) => { let s2 = 0; for (let i = 0; i < b.raw.length; i++) s2 += val(b.raw[i]); return { y: wa + 0.5 + t, mean: b.raw.length ? s2 / b.raw.length : NaN }; });
      C.set(key, rows);
    }
    return { rows, region: [rect.ya + 0.5, rect.yb - 0.5], method: c.method || App.S.quant.bg,
      baseline: (c.prof || []).map(p => ({ y: rect.ya + p.v, b: p.bg })), bgRows: c.method === 'manual' ? [] : (c.bgProf || []).map(p => ({ y: rect.ya + p.v, mean: p.mean, side: p.side })),
      manual: manualOf(L), cell: c };
  }
  // the profile's level at row y (mean of rows y-1..y+1), to put a drawn baseline's end on the curve
  function levelAt(P, y) {
    const near = P.rows.filter(r => Math.abs(r.y - y) <= 1.01 && !isNaN(r.mean));
    return near.length ? near.reduce((s2, r) => s2 + r.mean, 0) / near.length : NaN;
  }
  /* Manual integration in one lane: limits a..b (rows of the band's frame, inclusive) and a straight baseline from
   * level la at a to lb at b; the lane's own edge shifts give way to it. An explicit, undoable analysis change. */
  function setManual(App, row, lid, a, b, la, lb) {
    const L = row.lanes && row.lanes[lid];
    if (!L) return false;
    a = Math.round(a); b = Math.round(b);
    if (b - a < 2 || !isFinite(la) || !isFinite(lb)) return false;
    L.manual = { a, b, la: +la.toFixed(6), lb: +lb.toFixed(6) };
    delete L.dy0; delete L.dy1;
    return true;
  }
  // the same limits in every lane of the band, each baseline end on that lane's own profile
  function manualAll(App, row, a, b) {
    let n = 0;
    Object.keys(row.lanes || {}).forEach(id => {
      const L = row.lanes[id], keep = L.manual; L.manual = { a, b, la: 0, lb: 0 };
      const P = laneProfile(App, row, id), la = P ? levelAt(P, a) : NaN, lb = P ? levelAt(P, b) : NaN;
      if (isFinite(la) && isFinite(lb) && setManual(App, row, id, a, b, la, lb)) n++; else if (keep) L.manual = keep; else delete L.manual;
    });
    return n;
  }
  // back to the band's own region and background in this lane
  function resetLane(App, row, lid) { const L = row.lanes && row.lanes[lid]; if (!L) return; ['manual', 'dx', 'dy0', 'dy1', 'bg'].forEach(k => { delete L[k]; }); }

  /* ---------- the whole table ---------- */
  const OUTPUTS = ['corrected', 'normalized', 'fold'];
  function measure(App) {
    const S = App.S, q = S.quant;
    if (q.version !== VERSION) return measureLegacy(App);
    ensurePlaced(App);
    const lanes = quantLanes(App), ids = lanes.map(i => App.laneId(i)), rows = q.rows;
    const cells = rows.map((r, k) => lanes.map((i, j) => Object.assign({ lane: i, k, j }, measureCell(App, r, ids[j]))));
    const normMode = q.norm === 'band' || q.norm === 'lane' ? q.norm : 'none';
    const nb = normMode === 'band' ? rows.findIndex(r => r.id === q.normBand) : -1;
    const totals = normMode === 'lane' && rows.length ? lanes.map((i, j) => Object.assign({ lane: i, j }, laneTotalCell(App, rows[0], ids[j]))) : null;
    const output = OUTPUTS.includes(q.output) ? q.output : 'corrected';
    const divisorIssue = (d, what) => (!d ? `${what} not measured in this lane` : d.value == null ? `${what}: ${d.unavailable}` : d.flags.clip ? `${what} clipped in this lane` : !(d.value > 0) ? `${what} is not above zero in this lane` : d.flags.below ? `${what} below its 10σ noise threshold in this lane` : null);
    const corrected = cells.map(r => r.map(c => c.value)), whyC = cells.map(r => r.map(c => c.unavailable || null));
    const normalized = [], whyN = [];
    rows.forEach((r, k) => {
      normalized.push([]); whyN.push([]);
      lanes.forEach((i, j) => {
        const c = cells[k][j];
        let v = null, why = null;
        if (normMode === 'none') why = 'No normalization chosen';
        else if (normMode === 'band' && nb < 0) why = 'Choose the reference band';
        else if (k === nb) why = 'This is the reference band (the divisor)';
        else if (c.value == null) why = c.unavailable;
        else { const d = normMode === 'band' ? cells[nb][j] : totals[j], iss = divisorIssue(d, normMode === 'band' ? `Reference band (${rows[nb].name || 'Band ' + (nb + 1)})` : 'Lane total'); if (iss) why = iss; else v = c.value / d.value; }
        normalized[k].push(v); whyN[k].push(why);
      });
    });
    // a divisor or reference that needs review makes every ratio resting on it need review too (given, marked)
    const revOf = c => !!(c && c.review && c.review.length);
    const caveatN = rows.map((r, k) => lanes.map((i, j) => {
      if (normMode === 'none' || normalized[k][j] == null) return null;
      const d = normMode === 'band' ? cells[nb][j] : totals[j];
      return revOf(d) ? (normMode === 'band' ? 'the reference band needs review in this lane' : 'the lane total needs review') : null;
    }));
    const refJ = q.ref != null ? ids.indexOf(q.ref) : -1;
    const base = normMode === 'none' ? corrected : normalized, baseWhy = normMode === 'none' ? whyC : whyN;
    const fold = [], whyF = [], refOk = [];
    rows.forEach((r, k) => {
      fold.push([]); whyF.push([]);
      let refIssue = null;
      if (q.ref == null) refIssue = 'Choose a reference lane';
      else if (refJ < 0) refIssue = 'The reference lane is not measured';
      else if (base[k][refJ] == null) refIssue = `Reference lane: ${baseWhy[k][refJ]}`;
      else { const rc = cells[k][refJ]; refIssue = rc.flags.clip ? 'Reference lane clipped' : !(base[k][refJ] > 0) ? 'Reference lane value is not above zero' : rc.flags.below ? 'Reference lane below its 10σ noise threshold' : null; }
      refOk.push(!refIssue);
      lanes.forEach((i, j) => {
        let v = null, why = k === nb ? 'This is the reference band (the divisor)' : refIssue;
        if (!why) { if (base[k][j] == null) why = baseWhy[k][j]; else v = base[k][j] / base[k][refJ]; }
        fold[k].push(v); whyF[k].push(why);
      });
    });
    const caveatF = rows.map((r, k) => lanes.map((i, j) => {
      if (fold[k][j] == null) return null;
      const own = normMode !== 'none' ? caveatN[k][j] : null, rc = refJ >= 0 ? cells[k][refJ] : null, rd = refJ >= 0 && normMode !== 'none' ? caveatN[k][refJ] : null;
      return [own, j !== refJ && (revOf(rc) || rd) ? 'the reference lane needs review' : null].filter(Boolean).join('; ') || null;
    }));
    const values = { corrected, normalized, fold }, why = { corrected: whyC, normalized: whyN, fold: whyF };
    const caveat = { corrected: rows.map(() => lanes.map(() => null)), normalized: caveatN, fold: caveatF };
    const satLanes = new Set(); cells.forEach(r => r.forEach(c => { if (c.flags && c.flags.clip) satLanes.add(c.lane); }));
    if (totals) totals.forEach(c => { if (c.flags && c.flags.clip) satLanes.add(c.lane); });
    const reviewLanes = new Set(); cells.forEach(r => r.forEach(c => { if (c.review && c.review.length) reviewLanes.add(c.lane); }));
    const manualLanes = new Set(); cells.forEach(r => r.forEach(c => { if (c.flags && c.flags.manual) manualLanes.add(c.lane); }));
    const normLabel = nb >= 0 ? (rows[nb].name || `Band ${nb + 1}`) : normMode === 'lane' ? (q.laneTotal ? 'total protein (lane)' : 'total lane signal') : null;
    return {
      version: VERSION, lanes, ids, names: lanes.map(i => S.lanes[i].name || String(i + 1)), rows: rows.map((r, k) => ({ id: r.id, name: r.name || `Band ${k + 1}`, ref: k === nb })),
      cells, totals, values, why, caveat, output, shown: values[output], shownWhy: why[output], shownCaveat: caveat[output], vol: corrected, norm: normalized, rel: fold, refOk,
      normMode, normBand: nb, control: nb, normLabel, laneTotal: !!q.laneTotal, ref: refJ >= 0 ? lanes[refJ] : null, refId: q.ref, refJ,
      method: q.bg, mode: q.mode === 'band' ? 'band' : 'box', region: Object.assign({}, region(S)), halfWidthPx: rows.length ? rows[0].hw : boxHalfWidth(S),
      saturatedLanes: [...satLanes], reviewLanes: [...reviewLanes], manualLanes: [...manualLanes].sort((x, y) => x - y), flags: cells.map(r => r.map(c => c.flags || {}))
    };
  }

  /* ---------- version 1 (projects measured before 2026-11), kept so their numbers do not change unseen ----------
   * Band rows in the working frame; the box's pixels read through App.readRegion; background 'edge' from the
   * box's own first and last two source rows; whole-box rows clamped at zero. Reported with a notice and an
   * "Update to the current method" action (updateToCurrent). */
  /* Integrated density of one box. Returns {vol, raw, bg, sat, n, px (pixels counted), floor (the
   * threshold of the thresholded measure), sd, lod, loq, x0, x1, y0, y1}. */
  function measureBoxV1(App, lane, row, method, mode) {
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
  function measureV1(App) {
    const S = App.S, q = S.quant, lanes = quantLanes(App), rows = q.rows;
    const normMode = q.norm === 'lane' ? 'lane' : q.norm === 'control' ? 'control' : 'none';
    const ctl = normMode === 'control' && q.control >= 0 && q.control < rows.length ? q.control : -1;
    const ref = lanes.includes(q.ref) ? q.ref : lanes[0];
    const mode = q.mode === 'band' ? 'band' : 'box';
    const cells = rows.map(r => lanes.map(i => measureBoxV1(App, i, r, q.bg, mode)));
    const vol = cells.map(r => r.map(c => c.vol));
    // the lane's whole signal over the analysis area (the whole box, with the same background method)
    const g = region(S);
    const totalCells = normMode === 'lane' ? lanes.map(i => measureBoxV1(App, i, { y0: g.y, y1: g.y + g.h - 1 }, q.bg, 'box')) : null;
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

  // the version-1 result in the shape of the current one (values, reasons, flags), marked legacy
  function measureLegacy(App) {
    const R = measureV1(App), q = App.S.quant;
    const cells = R.cells.map((r, k) => r.map((c, j) => ({ lane: R.lanes[j], k, j, value: c.vol, U: c.raw, B: c.bg, n: c.n, t3: c.lod, t10: c.loq, lod: c.lod, loq: c.loq, sigmaPx: c.sd,
      clip: { n: c.sat, kind: c.sat ? 'limit' : null }, flags: { clip: c.sat ? 'limit' : null, below: R.flags[k][j].below === 'lod' ? 't3' : R.flags[k][j].below === 'loq' ? 't10' : null, legacy: true }, review: [], prov: { version: 1, method: R.method, mode: R.mode } })));
    const why = (arr, msg) => arr.map(r => r.map(v => (v == null ? msg : null)));
    const output = OUTPUTS.includes(q.output) ? q.output : (R.control >= 0 || R.normMode === 'lane' ? 'normalized' : 'corrected');
    const values = { corrected: R.vol, normalized: R.normMode === 'none' ? R.vol.map(r => r.map(() => null)) : R.norm, fold: R.rel };
    const whys = { corrected: why(R.vol, 'Not measured'), normalized: R.normMode === 'none' ? R.vol.map(r => r.map(() => 'No normalization chosen')) : why(R.norm, 'Divisor clipped or below its limit'), fold: why(R.rel, 'Reference lane not quantifiable') };
    return Object.assign(R, { version: 1, legacy: true, ids: R.lanes.map(i => App.laneId(i)), cells, values, why: whys, output, shown: values[output], shownWhy: whys[output],
      rows: R.rows.map((r, k) => ({ id: q.rows[k] && q.rows[k].id, name: r.name, ref: r.control })), normBand: R.control, refJ: R.lanes.indexOf(R.ref), reviewLanes: [], flags: cells.map(r => r.map(c => c.flags)) });
  }
  /* Update a version-1 analysis to the current calculation: every band is placed in the frame shown now (where
   * its rows live), the loading-control box becomes the reference band, the reference lane keeps its lane, and
   * the background 'edge' becomes local regions (the reason for the update). Explicit and undoable. */
  function updateToCurrent(App) {
    const S = App.S, q = S.quant;
    if (q.version === VERSION) return false;
    q.rows.forEach(r => { if (!r.id) r.id = newId('b'); });
    const ctl = q.control >= 0 && q.rows[q.control] ? q.rows[q.control].id : null;
    q.version = VERSION; q.frames = {};
    q.rows.forEach(r => { delete r.frame; delete r.lanes; placeRow(App, r, r.y0, r.y1); });
    if (q.norm === 'control') { q.norm = ctl ? 'band' : 'none'; q.normBand = ctl; }
    q.ref = q.ref >= 0 && S.lanes[q.ref] ? App.laneId(q.ref) : null;
    if (q.bg === 'edge') q.bg = 'local';
    q.output = q.ref != null ? 'fold' : q.norm !== 'none' ? 'normalized' : 'corrected';
    delete q.control;
    return true;
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
          const y = q.y + S.crop.y, e = App.estimateInfo(y, S.lanes[i].x);
          return { y, size: e ? e.bp : null, extrap: e ? e.extrap : null, strength: q.v / gmax };
        });
        return { lane: i, name: S.lanes[i].name || String(i + 1), marker: mk.has(i), bands };
      });
    } finally { App._peakCrop = null; }
  }

  // ---------- one description, every output ----------
  const BG_TEXT = {
    local: 'local background regions outside the band region (see background regions)',
    edge: 'a straight line between the first two and the last two rows inside the band region (line between region ends)',
    rolling: 'a rolling baseline (morphological opening, radius 1.5 region heights) of the lane\'s row means over the analysis area',
    border: 'the median of a 3-pixel ring around the band region, one level',
    none: 'no background correction'
  };
  const BG_SHORT = { local: 'Local background', edge: 'Line between region ends', rolling: 'Rolling baseline', border: 'Border median', none: 'No background', manual: 'Manual baseline' };
  const SIDES_TEXT = { ab: 'above and below', above: 'above', below: 'below', beside: 'beside' };
  const MODE_TEXT = {
    box: 'the sum over every pixel of the region of the signal minus its background (whole region, signed)',
    band: 'the sum of the background-corrected signal of only the pixels more than 3 σ (plus 0.004 of full scale) above the background (thresholded signal; exploratory: it loses the faint part of every band, so it is not linear)'
  };
  const OUTPUT_TEXT = { corrected: 'background-corrected signal (a.u.)', normalized: 'normalized signal (ratio)', fold: 'fold change versus the reference lane' };
  function bgLabel(q) {
    const b = q.bg || 'local';
    return b === 'local' ? `Local background (${SIDES_TEXT[q.bgSides || 'ab']}, ${q.bgGap != null ? q.bgGap : 2} px gap)` : BG_SHORT[b] || b;
  }
  function normShort(R) { return R.normMode === 'band' ? `Normalized to ${R.normLabel || 'a reference band'}` : R.normMode === 'lane' ? `Normalized to the ${R.normLabel}` : 'No normalization'; }
  /* One description of what was measured, shared by the analysis window, the clipboard, the CSV, the methods
   * text, the processing log and the summary sent to Claude, so all of them say the same thing. */
  function describe(App, R) {
    const S = App.S, q = S.quant, rot = !!S.rotation, geo = !!(S.geom && S.geom.grid), fl = S.flip && (S.flip.h || S.flip.v);
    const v2 = R.version === VERSION;
    const pixels = v2
      ? `the original pixel values of the decoded file: each region was placed on the image as shown${rot || geo || fl ? ` (${[fl ? 'flipped' : '', rot ? 'rotated' : '', geo ? 'geometry-corrected' : ''].filter(Boolean).join(', ')})` : ''} and mapped back to the original pixels once; every original pixel whose centre lies inside it was counted once with weight 1 (no resampled value, no contrast setting); later display changes do not move it`
      : (rot || geo ? `the original pixel values: each box outline was mapped back through the ${[rot ? 'rotation' : '', geo ? 'geometry correction' : ''].filter(Boolean).join(' and the ')} (no resampled value; no contrast setting)` : 'the original pixel values (no contrast setting)');
    const g = R.region, refName = R.ref != null ? (S.lanes[R.ref].name || `lane ${R.ref + 1}`).replace(/\*/g, '') : null;
    const norm = R.normMode === 'band'
      ? (R.normBand >= 0 ? `each band was divided by the ${R.normLabel} band of the same lane (a reference band: valid only if it is stable across the conditions and within its linear range)` : 'a reference band was to be chosen; no normalized value was given')
      : R.normMode === 'lane'
        ? (R.laneTotal ? 'each band was divided by the total signal of its lane over the analysis area of this total-protein-stained (or stain-free) image (total-protein normalization)'
          : 'each band was divided by the total signal of its lane over the analysis area of this image; this is total-protein normalization only if the image is a total-protein stain or stain-free image')
        : 'values were not normalized';
    const summary = [R.mode === 'band' ? 'Thresholded signal (exploratory)' : 'Whole region', v2 ? bgLabel(q) : BG_SHORT[R.method] || R.method, normShort(R), `Output: ${OUTPUT_TEXT[R.output]}`].join(' · ');
    return {
      version: v2 ? `calculation version ${VERSION}` : 'calculation version 1 (an earlier method: background from the box\'s own edge rows, negative rows set to zero)',
      summary,
      pixels,
      signal: S.bright ? 'bright bands: signal = pixel value on the file\'s full scale (0–1)' : 'dark bands: signal = 1 − pixel value on the file\'s full scale (0–1); the display inversion does not change it',
      measure: MODE_TEXT[R.mode] || R.mode,
      background: v2 && R.method === 'local' ? `local background regions ${SIDES_TEXT[q.bgSides || 'ab']} the band region, ${q.bgGap != null ? q.bgGap : 2} px from it (median of each; above and below: a straight line between the two along the lane)` : BG_TEXT[R.method] || R.method,
      limits: v2 ? 'noise thresholds per lane (estimated, not assay limits): 3 σ and 10 σ of the region\'s sum, σ from the spread of the local background pixels (median absolute deviation), allowing for correlated neighbouring pixels; values below 10 σ are flagged and never used as a divisor or a reference'
        : 'limits per box from the noise of its edge rows: LOD = 3 σ, LOQ = 10 σ of the box total; values below the LOQ are flagged',
      area: `analysis area x ${Math.round(g.x)}–${Math.round(g.x + g.w)}, y ${Math.round(g.y)}–${Math.round(g.y + g.h)} px of the working frame, set apart from the figure crop`,
      normalization: norm,
      output: OUTPUT_TEXT[R.output],
      reference: R.output === 'fold' || R.refId != null ? (refName ? `fold changes are given against lane ${R.ref + 1}${refName !== String(R.ref + 1) ? ` (${refName})` : ''}` : 'no reference lane was chosen; no fold change was given') : 'no reference lane',
      saturation: App.satReport().text,
      units: 'arbitrary units of this image; compare lanes of this image only'
    };
  }
  /* A methods paragraph for the manuscript, from what was actually done. */
  function methodsText(App, R) {
    const S = App.S, A = G.App, bits = S.file.bits ? `${S.file.bits}-bit ` : '', D = describe(App, R), cap = t => t[0].toUpperCase() + t.slice(1);
    const sat = R.saturatedLanes.length ? ` Lanes ${R.saturatedLanes.map(i => i + 1).join(', ')} contained clipped pixels; their values are underestimated and were not used as divisors or references.` : '';
    const rev = R.reviewLanes && R.reviewLanes.length ? ` Lanes ${R.reviewLanes.map(i => i + 1).join(', ')} were flagged for review (region or background).` : '';
    const man = R.manualLanes && R.manualLanes.length ? ` In lane${R.manualLanes.length > 1 ? 's' : ''} ${R.manualLanes.map(i => i + 1).join(', ')} the integration limits and a straight baseline were drawn by hand on the lane profile (manual integration; the background regions were not used there).` : '';
    return `Band intensities were quantified in ${A.NAME} ${A.VERSION} (${D.version}) on the ${bits}image, from ${D.pixels}. ` +
      `${cap(D.signal)}. Regions ${Math.round(R.halfWidthPx * 2)} px wide were placed at the same height in every analysed lane (${R.rows.map(r => r.name).join(', ')}); the value of a region is ${D.measure}, with ${D.background}. ` +
      `${cap(D.limits)}. ${cap(D.normalization)}; ${D.reference}.${sat}${rev}${man} ${D.saturation} Values are ${D.units}; inverted or raw grey values are not calibrated optical density or amount.`;
  }

  // ---------- export helpers ----------
  const num = (v, d) => (v == null || !isFinite(v) ? '' : (+v).toFixed(d));
  function csv(rows) { return rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return /[",\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n') + '\r\n'; }
  // a cell's flags in words, for the table, the CSV and the clipboard
  function flagText(f, c) {
    f = f || {};
    return [f.clip === 'limit' ? 'clipped (digital limit)' : f.clip === 'pileup' ? 'probably clipped (pile-up)' : '',
      f.below === 't3' ? 'below 3σ noise threshold' : f.below === 't10' ? 'below 10σ noise threshold' : '',
      f.boundary ? (f.edgeMethod ? 'band reaches the background rows' : 'band reaches region edge') : '',
      f.contaminated ? 'background holds band' : '', f.uneven ? 'background not flat' : '', f.twoPeaks ? 'two peaks' : '', f.overlap ? 'background over another band' : '',
      f.outside && f.outside.signal ? 'partly outside image' : '', f.unstable ? 'sensitive to region' : '', f.oneSide ? 'one background side' : '',
      f.noise ? `noise not estimated (${f.noise})` : '', f.manual ? 'manual baseline (drawn)' : f.override ? 'lane-specific region' : '', f.unplaced ? 'no region' : '', f.legacy ? 'earlier method' : '',
      c && c.unavailable ? 'unavailable' : ''].filter(Boolean).join('; ');
  }
  const outLabel = (R, k) => (R.output === 'fold' ? `${R.rows[k].name} fold change vs lane ${R.ref != null ? R.ref + 1 : '?'}` : R.output === 'normalized' ? `${R.rows[k].name} / ${R.normLabel || 'divisor'}` : `${R.rows[k].name} corrected signal (a.u.)`);
  // the rows of the table as data: one per lane, the same numbers everywhere (clipboard, CSV)
  function tableRows(App, R, opts) {
    const full = opts && opts.full, out = [];
    const head = ['Well', 'Lane', 'Lane id'];
    R.rows.forEach((r, k) => {
      head.push(`${r.name} corrected (a.u.)`);
      if (full) head.push(`${r.name} uncorrected sum`, `${r.name} background sum`, `${r.name} signal px`, `${r.name} background px`, `${r.name} 3σ threshold`, `${r.name} 10σ threshold`, `${r.name} clipped px`);
      if (R.normMode !== 'none') head.push(`${r.name} / ${R.normLabel || 'divisor'}`);
      if (R.output === 'fold' || R.refId != null) head.push(`${r.name} fold vs lane ${R.ref != null ? R.ref + 1 : '?'}`);
      head.push(`${r.name} flags`, `${r.name} unavailable because`);
    });
    if (R.totals) head.push('Lane total (a.u.)');
    out.push(head);
    R.lanes.forEach((i, j) => {
      const line = [i + 1, R.names[j].replace(/\*/g, ''), R.ids[j]];
      R.rows.forEach((r, k) => {
        const c = R.cells[k][j];
        line.push(num(R.values.corrected[k][j], 4));
        if (full) line.push(num(c.U, 4), num(c.B, 4), c.n || 0, c.nb || 0, num(c.t3, 4), num(c.t10, 4), c.clip ? c.clip.n : 0);
        if (R.normMode !== 'none') line.push(num(R.values.normalized[k][j], 5));
        if (R.output === 'fold' || R.refId != null) line.push(num(R.values.fold[k][j], 4));
        const reasons = [R.why.corrected[k][j], R.output !== 'corrected' ? R.shownWhy[k][j] : null].filter(Boolean);
        const cav = R.shownCaveat ? R.shownCaveat[k][j] : null;
        line.push([flagText(c.flags, c), cav].filter(Boolean).join('; '), [...new Set(reasons)].join('; '));
      });
      if (R.totals) line.push(num(R.totals[j].value, 4));
      out.push(line);
    });
    return out;
  }
  function quantCSV(App, R) {
    const S = App.S, D = describe(App, R), out = [];
    out.push(['# GelGrapher densitometry', S.file.name, 'SHA-256 ' + S.file.sha256]);
    out.push(['# method', D.summary]);
    out.push(['# calculation', D.version]);
    out.push(['# signal', D.signal]);
    out.push(['# measure', D.measure]);
    out.push(['# pixels', D.pixels]);
    out.push(['# background', D.background]);
    out.push(['# thresholds', D.limits]);
    out.push(['# area', D.area]);
    out.push(['# normalization', D.normalization]);
    out.push(['# output', D.output]);
    out.push(['# reference', D.reference]);
    out.push(['# saturation', D.saturation]);
    out.push(['# units', D.units]);
    tableRows(App, R, { full: true }).forEach(r => out.push(r));
    // where every region is, in original pixels (x, y of its corners), for the record
    out.push([]);
    out.push(['# regions (original pixel coordinates, corners)', 'band', 'lane id', 'signal corners', 'signal px', 'background', 'frame', 'placed']);
    R.cells.forEach((r, k) => r.forEach((c, j) => { const p = c.prov || {}; if (!p.signal) return; out.push(['', R.rows[k].name, R.ids[j], p.signal.corners.map(q => q.join(' ')).join('; '), p.signal.px, p.manual ? `manual baseline from row ${p.manual.rows[0]} (level ${p.manual.levels[0]}) to row ${p.manual.rows[1]} (level ${p.manual.levels[1]}) of the band's frame` : (p.background || []).map(b => `${b.side} ${b.px} px: ${b.corners.map(q => q.join(' ')).join('; ')}`).join(' | '), p.frame, p.placed]); }));
    return csv(out);
  }
  // the clipboard: the table as shown, with units, flags and the reference, tab-separated
  function quantTSV(App, R) {
    const D = describe(App, R), rows = tableRows(App, R, { full: false });
    const lines = [`# ${App.S.file.name} · ${D.summary}`, `# ${D.units}; ${D.reference}`].concat(rows.map(r => r.map(c => String(c == null ? '' : c).replace(/\t/g, ' ')).join('\t')));
    return lines.join('\n');
  }
  function sizesCSV(App, T) {
    const out = [['well', 'lane', 'band', `size (${App.baseUnit()})`, 'extrapolated', 'relative strength']];
    T.forEach(l => l.bands.forEach((b, k) => out.push([l.lane + 1, l.name, k + 1, b.size == null ? '' : num(b.size, App.baseUnit() === 'kDa' ? 1 : 0), b.extrap ? 'yes' : 'no', num(b.strength, 3)])));
    return csv(out);
  }

  /* Publication chart (SVG in pt, the figure's look): the selected output per lane. A value that cannot be
   * given is written "n/a", never drawn as a zero bar; negative values go below the zero line; flagged values
   * are drawn open (below 10 σ: dashed), hatched (clipped) or marked ? (needs review), and a legend says so. */
  function chartSVG(App, R) {
    const st = App.S.style, pt = st.fontPt, lw = st.lineWidthPt, MM = G.Render.MM, measure = G.Render.measure;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tgt = R.rows.map((r, k) => k).filter(k => !(R.rows[k].ref && R.output !== 'corrected'));
    if (!tgt.length || !R.lanes.length) return null;
    const P = Object.assign({ type: 'bar', values: false, refLine: true, ylabel: '', title: '' }, App.S.quant.plot || {});
    const vals = tgt.map(k => R.shown[k]);
    const fin = vals.flat().filter(v => v != null && isFinite(v));
    const vmax = Math.max(R.output === 'fold' ? 1 : 0, ...fin, 1e-9), vmin = Math.min(0, ...fin);
    const span = (vmax - vmin) || 1, raw = span * 1.1 / 4, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s2 => s2 >= raw);
    const top = Math.ceil(vmax * 1.05 / step) * step, bot = vmin < 0 ? Math.floor(vmin * 1.05 / step) * step : 0;
    const groupW = Math.max(4.5 * MM, tgt.length * 2.6 * MM), barW = groupW * 0.72 / tgt.length;
    const PW = groupW * R.lanes.length, PH = 38 * MM, Y = v => PH - (v - bot) / (top - bot) * PH, Y0 = Y(0);
    const fills = ['#3a3a3a', '#a6a6a6', '#ffffff', '#6e6e6e'];
    const names = R.names.map(n => n.replace(/\*/g, ''));
    const maxName = Math.max(...names.map(n => measure(n, pt)));
    const tilt = maxName > groupW * 0.95;
    const els = [], used = new Set();
    els.push(`<defs><pattern id="qhatch" patternUnits="userSpaceOnUse" width="${(pt * 0.5).toFixed(2)}" height="${(pt * 0.5).toFixed(2)}" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="${(pt * 0.5).toFixed(2)}" stroke="#000" stroke-width="${(lw * 0.8).toFixed(2)}"/></pattern></defs>`);
    els.push(`<line x1="0" y1="0" x2="0" y2="${PH}" stroke="#000" stroke-width="${lw}"/>`);
    els.push(`<line x1="0" y1="${Y0}" x2="${PW}" y2="${Y0}" stroke="#000" stroke-width="${lw}"/>`);
    let tickW = 0;
    for (let v = bot; v <= top + 1e-9; v += step) {
      const y = Y(v), t = +v.toFixed(6) + '';
      tickW = Math.max(tickW, measure(t, pt));
      els.push(`<line x1="${-2.5}" y1="${y}" x2="0" y2="${y}" stroke="#000" stroke-width="${lw}"/>`);
      els.push(`<text x="${-4}" y="${y + pt * 0.35}" font-size="${pt}" text-anchor="end">${esc(t)}</text>`);
    }
    if (P.refLine && R.output === 'fold' && top >= 1) els.push(`<line x1="0" y1="${Y(1)}" x2="${PW}" y2="${Y(1)}" stroke="#808080" stroke-width="${lw}" stroke-dasharray="2,1.5"/>`);
    R.lanes.forEach((lane, j) => {
      const gx = j * groupW + groupW * 0.14;
      tgt.forEach((k, t) => {
        const v = vals[t][j], bx = gx + t * barW, f = (R.cells[k][j] && R.cells[k][j].flags) || {}, cell = R.cells[k][j] || {};
        if (v == null || !isFinite(v)) { used.add('na'); els.push(`<text x="${bx + barW / 2}" y="${Y0 - pt * 0.4}" font-size="${pt * 0.75}" text-anchor="middle">n/a</text>`); return; }
        const yv = Y(v), y1 = Math.min(yv, Y0), h = Math.abs(Y0 - yv), weak = !!f.below, clip = !!f.clip, rev = (cell.review && cell.review.length) || !!(R.shownCaveat && R.shownCaveat[k][j]);
        if (weak) used.add('weak'); if (clip) used.add('clip'); if (rev) used.add('rev');
        const dash = weak ? ` stroke-dasharray="${(lw * 3).toFixed(2)},${(lw * 2).toFixed(2)}"` : '', fill = clip ? 'url(#qhatch)' : weak ? '#ffffff' : fills[t % fills.length];
        if (P.type === 'point') els.push(`<circle data-lane="${lane}" cx="${bx + barW / 2}" cy="${yv}" r="${Math.min(barW * 0.42, pt * 0.42)}" fill="${fill}" stroke="#000" stroke-width="${lw}"${dash}/>`);
        else els.push(`<rect data-lane="${lane}" x="${bx}" y="${y1}" width="${barW}" height="${Math.max(h, lw * 0.5)}" fill="${fill}" stroke="#000" stroke-width="${lw}"${dash}/>`);
        const mark = (clip ? '‡' : '') + (rev ? '?' : '');   // marks the PDF's standard fonts can set
        const label = (P.values ? (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toPrecision(3)) : '') + mark;
        if (label) els.push(`<text x="${bx + barW / 2}" y="${(v >= 0 ? y1 - pt * 0.35 : y1 + h + pt * 0.95)}" font-size="${pt * 0.8}" text-anchor="middle">${esc(label)}</text>`);
      });
      const cx = j * groupW + groupW / 2, ly = Math.max(PH, Y0) + 3;
      els.push(tilt
        ? `<g transform="translate(${cx + pt * 0.3},${ly + pt * 0.2}) rotate(-45)"><text x="0" y="0" font-size="${pt}" text-anchor="end">${esc(names[j])}</text></g>`
        : `<text x="${cx}" y="${ly + pt}" font-size="${pt}" text-anchor="middle">${esc(names[j])}</text>`);
    });
    const one = tgt.length === 1 ? R.rows[tgt[0]].name : null;
    const yLabel = P.ylabel ? P.ylabel : R.output === 'fold' ? `Fold change vs lane ${R.ref != null ? R.ref + 1 : '?'}` : R.output === 'normalized' ? `Normalized signal (/${R.normLabel || 'divisor'})` : 'Corrected signal (a.u.)';
    const ylx = -4 - tickW - pt * 0.9;
    els.push(`<g transform="translate(${ylx},${PH / 2}) rotate(-90)"><text x="0" y="0" font-size="${pt}" text-anchor="middle">${esc(yLabel)}</text></g>`);
    // title, legend of the targets, the method in a line or two above the plot and the marks used below it, both
    // wrapped to the plot's width (a long single line would widen the drawing and shrink the plot)
    const D = describe(App, R), marks = [used.has('weak') ? 'open/dashed: below 10σ noise threshold' : '', used.has('clip') ? 'hatched ‡: clipped pixels' : '', used.has('rev') ? '?: region or background needs review' : '', used.has('na') ? 'n/a: not available' : ''].filter(Boolean).join('; ');
    const fs = pt * 0.75, lh = fs * 1.3, maxW = Math.max(PW, 45 * MM);
    const wrap = text => { const out = []; let cur = ''; text.split(' ').forEach(w => { const t = cur ? cur + ' ' + w : w; if (cur && measure(t, fs) > maxW) { out.push(cur); cur = w; } else cur = t; }); if (cur) out.push(cur); return out; };
    const subLines = wrap(D.summary.replace(/ · Output: .*$/, '')), markLines = marks ? wrap(marks) : [];
    let legH = 0;
    subLines.slice().reverse().forEach((t, i) => els.push(`<text x="0" y="${(-pt * 0.6 - i * lh).toFixed(2)}" font-size="${fs.toFixed(2)}" text-anchor="start" fill="#333">${esc(t)}</text>`));
    legH = pt * 0.6 + subLines.length * lh;
    if (tgt.length > 1) {
      let x = 0;
      tgt.forEach((k, t) => {
        els.push(`<rect x="${x}" y="${-legH - pt * 1.4}" width="${pt * 0.8}" height="${pt * 0.8}" fill="${fills[t % fills.length]}" stroke="#000" stroke-width="${lw}"/>`);
        els.push(`<text x="${x + pt * 1.1}" y="${-legH - pt * 0.65}" font-size="${pt}" text-anchor="start">${esc(R.rows[k].name)}</text>`);
        x += pt * 1.6 + measure(R.rows[k].name, pt);
      });
      legH += pt * 1.8;
    }
    const title = P.title || one;
    if (title) { els.push(`<text x="${PW / 2}" y="${-legH - pt * 0.9}" font-size="${pt * 1.15}" text-anchor="middle" font-weight="bold">${esc(title)}</text>`); legH += pt * 2.1; }
    const below0 = (Math.max(PH, Y0) - PH) + (tilt ? 3 + maxName * 0.71 + pt : 3 + pt * 1.4);
    markLines.forEach((t, i) => els.push(`<text x="0" y="${(PH + below0 + fs + i * lh).toFixed(2)}" font-size="${fs.toFixed(2)}" text-anchor="start" fill="#333">${esc(t)}</text>`));
    const bottom = below0 + (markLines.length ? markLines.length * lh + fs * 0.5 : 0);
    const textW = Math.max(0, ...subLines.concat(markLines).map(t => measure(t, fs)));
    const vx = ylx - pt * 1.2, vy = -legH - 3, vw = Math.max(PW, textW) - vx + 4, vh = PH + bottom + legH + 6;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(vw / MM).toFixed(2)}mm" height="${(vh / MM).toFixed(2)}mm" viewBox="${vx.toFixed(2)} ${vy.toFixed(2)} ${vw.toFixed(2)} ${vh.toFixed(2)}" font-family="${esc(G.Render.FONTS[G.Render.fontName(st.font)])}" fill="#000">` +
      `<rect x="${vx.toFixed(2)}" y="${vy.toFixed(2)}" width="${vw.toFixed(2)}" height="${vh.toFixed(2)}" fill="#fff"/>` + els.join('') + '</svg>';
    return { svg, w: vw, h: vh };
  }

  // a band's background regions and signal region per lane, as outlines in the frame shown now (for the editor)
  function outlines(App, row, lid) {
    const q = App.S.quant, L = row.lanes && row.lanes[lid], fm = L && frameMapOf(App, row.frame);
    if (!fm) return null;
    const cm = curMap(App), rect = rectOf(row, L), spec = bgSpec(q, L, rect);
    const ring = r => { const pts = [], st = 6, M = Math.max(1, Math.ceil((r.xb - r.xa) / st)), Nv = Math.max(1, Math.ceil((r.yb - r.ya) / st));
      for (let i = 0; i <= M; i++) pts.push([r.xa + (r.xb - r.xa) * i / M, r.ya]);
      for (let i = 1; i <= Nv; i++) pts.push([r.xb, r.ya + (r.yb - r.ya) * i / Nv]);
      for (let i = M - 1; i >= 0; i--) pts.push([r.xa + (r.xb - r.xa) * i / M, r.yb]);
      for (let i = Nv - 1; i > 0; i--) pts.push([r.xa, r.ya + (r.yb - r.ya) * i / Nv]);
      return pts.map(([x, y]) => { const p = fm.to(x, y), c = cm.from(p.x, p.y); return [c.x, c.y]; }); };
    const method = q.bg || 'local';
    const man = !!manualOf(L);
    return { signal: ring(rect), background: !man && (method === 'local' || method === 'border') ? bgRects(rect, spec, method === 'border' ? 'border' : 'local').map(r => ({ side: r.side, pts: ring(r) })) : [], override: spec.override || man, manual: man };
  }

  G.Quant = { VERSION, measure, measureCell, bandBox, bandSizes, quantCSV, quantTSV, sizesCSV, chartSVG, quantLanes, region, boxHalfWidth, methodsText, describe, flagText, tableRows,
    placeRow, editRow, placeLane, ensurePlaced, rowSpan, laneDrift, outlines, updateToCurrent, pruneFrames, laneProfile, levelAt, setManual, manualAll, resetLane, BG_TEXT, BG_SHORT, MODE_TEXT, OUTPUT_TEXT, SIDES_TEXT, bgLabel, outLabel };
})(window);

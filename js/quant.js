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

  /* ---------- frames and placement ----------
   * A frame is identified by its whole transform: rotation, flips, the source image's size and every value of the
   * geometry grid (Engine.hashNums over the exact numbers, no rounding). storeFrame also compares the stored
   * content and takes another key on a collision, so a band is never mapped through another transform. Keys of
   * earlier projects (a sampled checksum) stay valid as names: a band always reads the frame stored under its key,
   * and every cache is keyed by that frame's content. */
  const frameKeyOf = (f, W, H) => { const g = f.grid; return `f2|${f.rot || 0}|${f.fh ? 1 : 0}${f.fv ? 1 : 0}|${W}x${H}|${g ? `${g.nx}x${g.ny}@${g.W}x${g.H}:${E.hashNums(g.pts)}` : '-'}`; };
  const sameFrame = (a, b) => {
    if ((a.rot || 0) !== (b.rot || 0) || !!a.fh !== !!b.fh || !!a.fv !== !!b.fv || (a.W != null && b.W != null && (a.W !== b.W || a.H !== b.H))) return false;
    const g = a.grid, h = b.grid;
    if (!g || !h) return !g && !h;
    if (g.nx !== h.nx || g.ny !== h.ny || g.W !== h.W || g.H !== h.H || g.pts.length !== h.pts.length) return false;
    for (let i = 0; i < g.pts.length; i++) if (g.pts[i] !== h.pts[i]) return false;
    return true;
  };
  function currentFrame(App) { const S = App.S; return { rot: S.rotation || 0, fh: !!(S.flip && S.flip.h), fv: !!(S.flip && S.flip.v), grid: App.geomGrid(S) }; }
  // the frame shown now, kept in quant.frames; returns its key
  function storeFrame(App) {
    const q = App.S.quant, f = currentFrame(App), W = App.src0.w, H = App.src0.h, base = frameKeyOf(f, W, H);
    const stored = { rot: f.rot, fh: f.fh, fv: f.fv, W, H, grid: f.grid ? { nx: f.grid.nx, ny: f.grid.ny, W: f.grid.W, H: f.grid.H, pts: Array.from(f.grid.pts) } : null };
    q.frames = q.frames || {};
    let k = base, n = 1;
    while (q.frames[k] && !sameFrame(q.frames[k], stored)) k = `${base}~${++n}`;
    if (!q.frames[k]) q.frames[k] = stored;
    return k;
  }
  // frames no band (and no total-lane region) refers to any more are dropped (they can be large: a grid each)
  function pruneFrames(q, keep) {
    if (!q.frames) return;
    const used = new Set(q.rows.map(r => r.frame).filter(Boolean));
    if (keep && keep.frame) used.add(keep.frame);   // a band being placed may not be in the table yet
    if (q.normRegions && q.normRegions.frame) used.add(q.normRegions.frame);
    Object.keys(q.frames).forEach(k => { if (!used.has(k)) delete q.frames[k]; });
  }
  // a stored frame's content identity (memoised per stored object: undo and project files make new objects)
  const contentIds = new WeakMap();
  function frameContentId(App, key) {
    const f = App.S.quant.frames && App.S.quant.frames[key];
    if (!f) return null;
    let id = contentIds.get(f);
    if (!id) { id = frameKeyOf(f, f.W || App.src0.w, f.H || App.src0.h); contentIds.set(f, id); }
    return id;
  }
  const mapCache = new Map();
  function frameMapOf(App, key) {
    const q = App.S.quant, f = q.frames && q.frames[key];
    if (!f) return null;
    const ck = frameContentId(App, key) + '|' + App.src0.w + 'x' + App.src0.h;
    let m = mapCache.get(ck);
    if (!m) { m = E.frameMap(Object.assign({}, f, { W: App.src0.w, H: App.src0.h })); mapCache.set(ck, m); if (mapCache.size > 40) mapCache.delete(mapCache.keys().next().value); }
    return m;
  }
  const curMap = App => E.frameMap(Object.assign({ W: App.src0.w, H: App.src0.h }, currentFrame(App)));
  const newId = p => p + Math.random().toString(36).slice(2, 8);
  // the lanes whose drawn baseline a placement in the frame shown now would remove (their limits are rows of the
  // band's own frame, meaningless in another one); the interface asks before
  function placementDropsManual(App, row) {
    if (!row.lanes) return [];
    const f = currentFrame(App), cur = { rot: f.rot, fh: f.fh, fv: f.fv, grid: f.grid }, st = row.frame && App.S.quant.frames && App.S.quant.frames[row.frame];
    const same = st && sameFrame(Object.assign({}, st, { W: null }), cur);
    return same ? [] : Object.keys(row.lanes).filter(id => row.lanes[id].manual);
  }
  /* Place a band in the frame shown now, rows y0..y1 of it (inclusive), in every lane of the analysis area
   * (ladders aside; lanes left out of the analysis are placed too, so ticking them back needs no edit). A lane's
   * own adjustments (dx, dy0, dy1, background) are kept; a drawn baseline is kept when the band stays in the same
   * frame (Height, Re-centre and the region width then leave it alone) and removed otherwise (see
   * placementDropsManual). An explicit analysis change: undoable, counted. */
  function placeRow(App, row, y0, y1) {
    const S = App.S, g = region(S), mk = new Set(S.markers.map(m => m.lane)), old = row.lanes || {}, drop = new Set(placementDropsManual(App, row));
    row.frame = storeFrame(App);
    row.y0 = Math.round(Math.min(y0, y1)); row.y1 = Math.round(Math.max(y0, y1));
    row.hw = boxHalfWidth(S);
    row.strip = [Math.min(row.y0, Math.round(g.y)), Math.max(row.y1, Math.round(g.y + g.h - 1))];
    row.lanes = {};
    S.lanes.forEach((l, i) => {
      if (mk.has(i) || l.x < g.x || l.x > g.x + g.w) return;
      const id = App.laneId(i), o = old[id] || {}, L = { cx: l.x };
      ['dx', 'dy0', 'dy1', 'bg'].forEach(k => { if (o[k] != null) L[k] = o[k]; });
      if (o.manual && !drop.has(id)) L.manual = o.manual;
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
  /* An explicit edit of a band's rows (in the frame shown now): the band is placed again in that frame. A lane's
   * drawn baseline follows the band's edges as its start and end shifts do: its limits move by as many rows as the
   * band's start and end, and its line stays the same line (its ends slide along it). Returns the lanes whose
   * baselines could not be carried (the band was placed in another frame: see placementDropsManual). */
  function editRow(App, row, y0, y1) {
    const oy0 = row.y0, oy1 = row.y1, dropped = placementDropsManual(App, row);
    placeRow(App, row, y0, y1);
    const da = row.y0 - oy0, db = row.y1 - oy1;
    if ((da || db) && isFinite(da) && isFinite(db)) Object.keys(row.lanes).forEach(id => {
      const m = row.lanes[id].manual; if (!m) return;
      const a = m.a + da, b = m.b + db; if (b - a < 2) return;
      const at = y => m.la + (m.lb - m.la) * (y - m.a) / Math.max(1, m.b - m.a);
      row.lanes[id].manual = { a, b, la: +at(a).toFixed(6), lb: +at(b).toFixed(6) };
    });
    return dropped;
  }
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
  /* Cache of pixel calculations, per decoded image, least recently used dropped first (interactive edits of
   * regions and baselines would otherwise pile up arrays). It holds only what depends on the cell's own pixels and
   * settings; whatever depends on other bands (overlap), on the placement count (provenance) or on variants
   * (sensitivity) is put together fresh on every call, so a warm and a cold cache give the same result. */
  const cache = new WeakMap(), CACHE_MAX = 400;
  function cacheFor(App) { let c = cache.get(App.src0); if (!c) { c = new Map(); cache.set(App.src0, c); } return c; }
  function cacheGet(App, key) { const C = cacheFor(App); if (!C.has(key)) return undefined; const v = C.get(key); C.delete(key); C.set(key, v); return v; }
  function cacheSet(App, key, v) { const C = cacheFor(App); C.set(key, v); while (C.size > CACHE_MAX) C.delete(C.keys().next().value); return v; }
  function clearCache(App) { cache.delete(App.src0); }
  const cacheSize = App => cacheFor(App).size;

  // noise states: only 'estimated' allows a threshold call
  const NOISE_TEXT = { estimated: 'estimated', unavailable: 'no background samples inside the image', insufficient: 'too few background samples', contaminated: 'background not flat' };
  /* The pixel part of one lane of one band (cached): the integration, the local background model, the noise and
   * its state, clipping and its state, and the diagnostics that depend only on these pixels. */
  function cellBase(App, row, lid, L, fm, opts) {
    const S = App.S, q = S.quant, mode = q.mode === 'band' ? 'band' : 'box';
    const man = manualOf(L), method = man ? 'manual' : ['local', 'edge', 'rolling', 'border', 'none'].includes(q.bg) ? q.bg : 'local';
    const key = JSON.stringify(['cell', frameContentId(App, row.frame), row.y0, row.y1, row.hw, row.strip, L, method, mode, q.bgSides, q.bgGap, q.bgSize, S.bright, opts.d || 0, opts.gapAdd || 0, !!opts.bare]);
    const hit = cacheGet(App, key);
    if (hit) return hit;
    const bright = S.bright, val = bright ? v => v : v => 1 - v;
    const rect = rectOf(row, L, opts.d), K = Math.round(rect.yb - rect.ya), spec = bgSpec(q, L, rect, opts.gapAdd);
    const sig = gather(App, fm, rect);
    // the local background regions: subtracted with the local method; the noise estimate and the coverage
    // diagnostics of every method (a drawn baseline's variants skip them: they only need the value)
    const loc = opts.bare && method === 'manual' ? [] : bgRects(rect, spec, 'local').map(r => Object.assign(gather(App, fm, r), { side: r.side }));
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
    // correlated neighbouring pixels: the variance of a sum is sigma^2 n f, f = the sum of the residuals'
    // autocorrelation over lags up to 2 pixels in x and y (a direct estimate; a separable first-order model overstated
    // short-range correlation: 25 instead of 9 for a 3 x 3 blur); f is at least 1 and at most 25
    const W = App.src0.w, corr = (dx, dy) => { let sab = 0, saa = 0, sbb = 0, k = 0; const off = dy * W + dx; resid.forEach((e, i) => { const x = i % W; if (x + dx < 0 || x + dx >= W) return; const o = resid.get(i + off); if (o != null) { sab += (e - mr) * (o - mr); saa += (e - mr) ** 2; sbb += (o - mr) ** 2; k++; } }); return k >= 20 && saa > 0 && sbb > 0 ? E.clamp(sab / Math.sqrt(saa * sbb), -0.5, 0.98) : 0; };
    let fsum = 1; for (let dy = 0; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { if (dy === 0 && dx <= 0) continue; fsum += 2 * corr(dx, dy); }
    const rx = corr(1, 0), ry = corr(0, 1), f = E.clamp(fsum, 1, 25);
    let value = lev ? U - Bsum : null, counted = n, floor = 0;
    if (value != null && mode === 'band') {
      floor = 3 * (isFinite(sigmaPx) ? sigmaPx : 0) + 0.004; value = 0; counted = 0;
      sig.bins.forEach((b, j) => { const v = sv(b), lv = lev(j); let t = 0; for (let i = 0; i < v.length; i++) { const d = v[i] - lv; if (d > floor) { value += d; counted++; t += d; } } prof[j].counted = v.length ? t / v.length : 0; });
    }
    const unavailable = !lev ? (method === 'local' || method === 'border' ? 'No background region inside the image for this lane.' : 'No background.')
      : !n ? 'The region lies outside the image.' : null;
    if (unavailable) value = null;
    if (opts.bare) return cacheSet(App, key, { value });
    const sigmaSum = isFinite(sigmaPx) ? sigmaPx * Math.sqrt(f * (n + (isFinite(m) ? c * n * n / m : 0))) : NaN;
    // clipping: signal pixels at the band end of the scale where this file clips; 'unknown' when the file has no
    // limit to test against (floating point): not the same as "checked, none"
    const clipT = App.satPredicate ? App.satPredicate() : null;
    let clipN = 0; if (clipT) sig.bins.forEach(b => { for (let i = 0; i < b.raw.length; i++) if (clipT(b.raw[i])) clipN++; });
    const a = App.acq, side = a ? (bright ? a.hi : a.lo) : null;
    const clipKind = clipN ? (side && side.kind === 'pileup' ? 'pileup' : 'limit') : null, clipState = clipT ? 'checked' : 'unknown';
    // coverage diagnostics on the residual profile above the LOCAL level, whatever the method subtracts (the line
    // between the region's ends, or a drawn baseline, passes through its end rows by construction, so it cannot
    // show a band reaching them); the method's own level only when there is no local level
    const lvAt = j => (localLev ? localLev(j + 0.5) : lev ? lev(j) : 0);
    prof.forEach((p, j) => { p.local = localLev ? localLev(j + 0.5) : null; });
    const pr = prof.map((p, j) => (isNaN(p.mean) ? 0 : p.mean - lvAt(j))), peak = Math.max(0, ...pr), tiny = isFinite(sigmaPx) ? 3 * sigmaPx : 0;
    // a band worth checking: above 3 sigma of the pixel noise and above 0.2 % of full scale
    const strong = peak > Math.max(tiny, 0.002);
    const boundary = strong && K >= 3 ? [pr[0] > 0.25 * peak ? 'top' : '', pr[K - 1] > 0.25 * peak ? 'bottom' : ''].filter(Boolean) : [];
    // a background region whose rows rise towards the band holds some of it
    const contaminated = [];
    if (strong) [A, Bw].forEach(r => {
      if (!r || r.bins.length < 2) return;
      const half = (arr, nearSide) => (r.side === 'above') === nearSide ? arr.slice(Math.ceil(arr.length / 2)) : arr.slice(0, Math.floor(arr.length / 2));
      const meds = r.bins.map(b => median(Array.from(sv(b)))), near = half(meds, true), far = half(meds, false);
      // what the local model itself expects between the two halves (a linear gradient along the lane is not band)
      const model = r.bins.map(b => (localLev ? localLev(b.v + 0.5) : 0)), mNear = half(model, true), mFar = half(model, false);
      const mean = v => v.filter(x => !isNaN(x)).reduce((s, x, _, w) => s + x / w.length, 0), npx = r.n / 2, noiseD = 3 * (isFinite(sigmaPx) ? sigmaPx : 0) * Math.sqrt(f / Math.max(1, npx));
      const d = mean(near) - mean(far) - (mean(mNear) - mean(mFar));
      // rising towards the band by 10 % of its peak, or by enough to move the value by 3 % (a smear, a tail: a region
      // that rises by d over half its depth gives a level about d too high, on the order of n pixels)
      const impact = d * n;
      if (near.length && far.length && d > noiseD && (d > 0.1 * peak || (value != null && impact > 0.03 * Math.abs(value)))) contaminated.push(r.side);
    });
    // a background region that is not flat (another band, a smear, a speck): a row's median strays from the local
    // model by more than 10 % of the band's peak and 4 standard errors of a row median
    const uneven = [];
    if (strong && localLev) loc.forEach(r => {
      if (contaminated.includes(r.side) || r.side === 'left' || r.side === 'right') return;
      const off = r.bins.some(b => { if (b.n < 3) return false; const md = median(Array.from(sv(b))), se = 1.2533 * (isFinite(sigmaPx) ? sigmaPx : 0) / Math.sqrt(b.n); return Math.abs(md - localLev(b.v + 0.5)) > Math.max(4 * se, 0.1 * peak); });
      if (off) uneven.push(r.side);
    });
    // the noise estimate's state: a threshold call needs 'estimated'
    const noise = !localLev || !rs.length || !isFinite(sigmaPx) ? 'unavailable' : rs.length < 30 ? 'insufficient' : contaminated.length || uneven.length ? 'contaminated' : 'estimated';
    // a drawn baseline's ends against the background beside them: an end above it holds band signal (the line then
    // cuts through the band), an end below it adds background to the band
    // The background beside the limits may itself lie on the band's tails, so the ends are also compared with
    // background regions further out (the lower of the two for "above", the higher for "below"); judged by what the
    // difference does to the value: more than 5 % of it and 3 sigma of the sum.
    let endpoints = null;
    if (man) {
      const farSpec = bgSpec(q, L, rect, Math.max(4, Math.round(0.5 * K))), far = bgRects(rect, farSpec, 'local').map(r => Object.assign(gather(App, fm, r), { side: r.side }));
      const fA = far.find(r => r.side === 'above'), fB = far.find(r => r.side === 'below'), fva = fA ? sideVals(fA) : [], fvb = fB ? sideVals(fB) : [];
      let farLev = null;
      if (fva.length && fvb.length) { const ma = median(fva), mb = median(fvb), cA = -farSpec.gap - farSpec.size / 2, cB = K + farSpec.gap + farSpec.size / 2; farLev = v => ma + (mb - ma) * (v - cA) / (cB - cA); }
      else if (fva.length || fvb.length) { const m0 = median(fva.length ? fva : fvb); farLev = () => m0; }
      const levs = v => [localLev, farLev].filter(Boolean).map(fn => fn(v));
      if (!localLev && !farLev) endpoints = { unchecked: true };
      else {
        const sumSig = isFinite(sigmaPx) ? sigmaPx * Math.sqrt(f * n) : 0, need = Math.max(0.05 * Math.abs(value || 0), 3 * sumSig, 1e-9);
        const hi = [man.la - Math.min(...levs(0.5)), man.lb - Math.min(...levs(K - 0.5))], lo = [Math.max(...levs(0.5)) - man.la, Math.max(...levs(K - 0.5)) - man.lb];
        const impHi = (Math.max(0, hi[0]) + Math.max(0, hi[1])) / 2 * n, impLo = (Math.max(0, lo[0]) + Math.max(0, lo[1])) / 2 * n;
        const se = isFinite(sigmaPx) ? 1.2533 * sigmaPx / Math.sqrt(Math.max(1, n / Math.max(1, K))) : 0;
        endpoints = { start: impHi > need && hi[0] > 2 * se ? 'high' : impLo > need && lo[0] > 2 * se ? 'low' : null, end: impHi > need && hi[1] > 2 * se ? 'high' : impLo > need && lo[1] > 2 * se ? 'low' : null,
          share: Math.max(impHi, impLo) / Math.max(1e-12, Math.abs(value || 0)) };
      }
    }
    // two peaks in the region: a neighbouring band, or a doublet
    let peaks = 0;
    if (strong) { for (let j = 1; j < K - 1; j++) if (pr[j] >= pr[j - 1] && pr[j] > pr[j + 1] && pr[j] > 0.3 * peak) { let lo = pr[j]; for (let t = j - 1; t >= 0 && pr[t] <= pr[j]; t--) lo = Math.min(lo, pr[t]); if (pr[j] - lo > 0.25 * peak || peaks === 0) peaks++; } }
    if (strong && K >= 3) { if (pr[0] > pr[1] && pr[0] > 0.3 * peak) peaks++; if (pr[K - 1] > pr[K - 2] && pr[K - 1] > 0.3 * peak) peaks++; }
    // pixel indices for the overlap check in source coordinates (any frame)
    const idxOf = g => { const out = new Int32Array(g.bins.reduce((s2, b) => s2 + b.idx.length, 0)); let o = 0; g.bins.forEach(b => { out.set(b.idx, o); o += b.idx.length; }); return out; };
    const base = {
      value, unavailable, U: lev ? U : null, B: lev ? Bsum : null, n, counted, floor, method, mode, K, rect, spec, man,
      nb: method === 'local' ? mLocal : method === 'border' ? (ring || []).reduce((s2, r) => s2 + r.n, 0) : method === 'edge' ? m : 0, nNoise: rs.length,
      sigmaPx, f, rho: [rx, ry], sigmaSum, noise, clipN, clipKind, clipState, boundary, contaminated, uneven, peaks, peak, oneSide, endpoints,
      sigOutside: sig.outside, locOutside: loc.reduce((s2, r) => s2 + r.outside, 0), prof,
      bgProf: loc.flatMap(r => r.bins.map(b => ({ v: b.v + 0.5, side: r.side, n: b.n, mean: binMean(b) }))),
      sigIdx: idxOf(sig), locIdx: loc.map(r => ({ side: r.side, idx: idxOf(r) })),
      corners: { signal: corners(fm, rect), background: (method === 'border' ? ring : method === 'local' ? loc : []).map(r => ({ side: r.side, corners: corners(fm, r.rect), px: r.n })), noise: loc.map(r => ({ side: r.side, corners: corners(fm, r.rect), px: r.n })) }
    };
    return cacheSet(App, key, base);
  }

  /* One lane of one band: { value (the corrected signal, or null with `unavailable`), U, B, n, nb, sigmaPx, f,
   * t3, t10, clip: {n, kind, state}, flags, review: [reasons], sens, prof, prov }. opts: {d, gapAdd, bare, total}
   * (bare: the value only, for the sensitivity checks; total: a total-lane region, no band context). */
  function measureCell(App, row, lid, opts) {
    opts = opts || {};
    const S = App.S, q = S.quant;
    const L = row.lanes && row.lanes[lid], fm = L && frameMapOf(App, row.frame);
    if (!L || !fm) return { value: null, unavailable: 'No measurement region in this lane yet (Re-centre on lanes places one).', flags: { unplaced: true, noise: 'unavailable', clipState: 'unknown' }, review: [], n: 0 };
    const b = cellBase(App, row, lid, L, fm, opts);
    if (opts.bare) return { value: b.value };
    const { value, method, mode, K, man } = b, own = method !== 'manual';
    // the background over another band: any other band's region in this lane, compared in source pixels (bands
    // placed in different frames can still cover the same pixels)
    const overlap = [];
    if (!opts.total && b.locIdx.length) q.rows.forEach(o => {
      if (o === row || !o.frame || !o.lanes || !o.lanes[lid]) return;
      const ofm = frameMapOf(App, o.frame); if (!ofm) return;
      const ob = cellBase(App, o, lid, o.lanes[lid], ofm, {}), set = ob.sigSet || (ob.sigSet = new Set(ob.sigIdx));
      b.locIdx.forEach(r => { for (let i = 0; i < r.idx.length; i++) if (set.has(r.idx[i])) { overlap.push(`${r.side} overlaps ${o.name || 'another band'}`); return; } });
    });
    // sensitivity: the region made taller (the band was cut off?) and the background moved away (it held band?);
    // for a drawn baseline: its ends moved by 2 rows and its levels by a little (where it is drawn matters how much?)
    let sens = null, msens = null;
    const bare = (rw, LL, o2) => cellBase(App, rw, lid, LL, fm, Object.assign({ bare: true }, o2)).value;
    if (!opts.total && value != null && mode === 'box' && own) {
      const dd = Math.max(1, Math.round(0.2 * K)), tall = bare(row, L, { d: dd });
      const away = method === 'local' ? bare(row, L, { gapAdd: Math.max(2, Math.round(0.3 * K)) }) : null;
      sens = { taller: tall, tallerRows: dd, away, awayPx: method === 'local' ? Math.max(2, Math.round(0.3 * K)) : 0 };
    }
    if (!opts.total && value != null && man) {
      const dLev = Math.max(isFinite(b.sigmaPx) ? b.sigmaPx : 0, 0.02 * Math.max(b.peak, 0.01)), var_ = mm => bare(row, Object.assign({}, L, { manual: Object.assign({}, man, mm) }), {});
      const pos = [{ a: man.a - 2 }, { a: man.a + 2 }, { b: man.b - 2 }, { b: man.b + 2 }].filter(mm => (mm.b != null ? mm.b : man.b) - (mm.a != null ? mm.a : man.a) >= 2).map(var_).filter(v => v != null);
      const lv = [{ la: man.la - dLev }, { la: man.la + dLev }, { lb: man.lb - dLev }, { lb: man.lb + dLev }].map(var_).filter(v => v != null);
      msens = { dPos: 2, dLev, pos: pos.length ? [Math.min(...pos), Math.max(...pos)] : null, lev: lv.length ? [Math.min(...lv), Math.max(...lv)] : null };
    }
    const sigmaSum = b.sigmaSum, tolv = Math.max(0.1 * Math.abs(value), 3 * (isFinite(sigmaSum) ? sigmaSum : 0));
    const unstable = sens ? [sens.taller != null && Math.abs(sens.taller - value) > tolv ? 'taller' : '', sens.away != null && Math.abs(sens.away - value) > tolv ? 'away' : ''].filter(Boolean) : [];
    const msDev = msens ? Math.max(0, ...[].concat(msens.pos || [], msens.lev || []).map(v => Math.abs(v - value))) : 0;
    const baselineSensitive = !!msens && msDev > tolv;
    const t3 = 3 * sigmaSum, t10 = 10 * sigmaSum, noiseOk = b.noise === 'estimated';
    // a threshold call only with an estimated noise: "could not estimate" is never "passed"
    const below = value == null || !noiseOk || !isFinite(sigmaSum) ? null : value < t3 ? 't3' : value < t10 ? 't10' : null;
    const ends = b.endpoints, endHigh = ends && ['start', 'end'].filter(e => ends[e] === 'high'), endLow = ends && ['start', 'end'].filter(e => ends[e] === 'low');
    const flags = { clip: b.clipKind, clipState: b.clipState, below, belowUnknown: value != null && !noiseOk, noise: b.noise,
      boundary: b.boundary.length ? b.boundary : null, contaminated: b.contaminated.length ? b.contaminated : null, uneven: b.uneven.length ? b.uneven : null, twoPeaks: b.peaks >= 2,
      outside: b.sigOutside > 0 || (own && b.locOutside > 0) ? { signal: b.sigOutside, background: own ? b.locOutside : 0 } : null,
      overlap: own && overlap.length ? overlap : null, oneSide: own && b.oneSide, unstable: unstable.length ? unstable : null, override: b.spec.override || !own, edgeMethod: method === 'edge',
      manual: !own, endpoints: endHigh && endHigh.length ? endHigh : null, endpointsLow: endLow && endLow.length ? endLow : null, endpointsUnchecked: !!(ends && ends.unchecked), baselineSensitive };
    const review = [];
    const endWord = e => (e === 'top' ? 'start' : 'end');
    if (flags.boundary) review.push(!own ? `the band continues beyond the drawn ${b.boundary.map(endWord).join(' and ')} (compared with the background beside the limits): part of it is left out`
      : method === 'edge' ? 'the band reaches the region\'s ends, where this background is sampled: it subtracts part of the band' : 'the band reaches the region\'s ' + b.boundary.join(' and ') + ' edge: part of it may lie outside');
    const pct = ends && isFinite(ends.share) ? ` (about ${Math.round(100 * ends.share)} % of the value)` : '';
    if (flags.endpoints) review.push(`the baseline's ${flags.endpoints.join(' and ')} ${flags.endpoints.length > 1 ? 'lie' : 'lies'} above the background beyond the limits: the endpoint holds band signal, so the line cuts through the band${pct}`);
    if (flags.endpointsLow) review.push(`the baseline's ${flags.endpointsLow.join(' and ')} ${flags.endpointsLow.length > 1 ? 'lie' : 'lies'} below the background beyond the limits: background is counted as band${pct}`);
    if (flags.endpointsUnchecked) review.push('the baseline\'s ends could not be compared with the background (no background samples beside the limits)');
    if (flags.contaminated) review.push(own ? `the background ${b.contaminated.join(' and ')} rises towards the band: it holds part of the band` : `the profile just ${b.contaminated.map(sd => (sd === 'above' ? 'before the start' : 'after the end')).join(' and ')} still rises towards the band: the band may continue beyond the limits`);
    if (flags.uneven) review.push(`the background ${b.uneven.join(' and ')} is not flat: another band or a smear may lie in it`);
    if (flags.twoPeaks) review.push('two peaks in the region: a neighbouring band or a doublet may be included');
    if (flags.overlap) review.push('background region ' + overlap.join(', '));
    if (flags.outside && flags.outside.signal) review.push('part of the region lies outside the image');
    if (flags.unstable) review.push(unstable.map(u => (u === 'taller' ? `the value changes by more than 10 % when the region is ${sens.tallerRows} rows taller at each end` : `the value changes by more than 10 % when the background is moved ${sens.awayPx} px further away`)).join('; '));
    if (baselineSensitive) review.push(`the value depends on where the baseline is drawn: moving its ends by ${msens.dPos} rows or its levels by ${fmtN(msens.dLev)} changes it by up to ${Math.round(100 * msDev / Math.max(1e-12, Math.abs(value)))} %`);
    if (flags.oneSide) review.push('only one background side lies inside the image');
    if (value != null && !noiseOk) review.push(`the noise could not be estimated (${NOISE_TEXT[b.noise]}): no 3σ / 10σ check was made`);
    const src = S.file || {};
    return {
      value, unavailable: b.unavailable, U: b.U, B: b.B, n: b.n, counted: b.counted, floor: b.floor, nb: b.nb, method, nNoise: b.nNoise,
      sigmaPx: b.sigmaPx, f: b.f, rho: b.rho, sigmaSum, t3, t10, lod: t3, loq: t10, clip: { n: b.clipN, kind: b.clipKind, state: b.clipState }, flags, review, sens, msens,
      prof: b.prof, bgProf: b.bgProf, y0: b.rect.ya + 0.5,
      prov: { image: src.name, sha256: src.sha256, version: VERSION, build: (G.App && G.App.BUILD) || 'dev', method, mode, polarity: S.bright ? 'bright bands: s = I' : 'dark bands: s = 1 - I',
        signal: { corners: b.corners.signal, px: b.n, outsidePx: b.sigOutside, rows: K, frameRows: [b.rect.ya + 0.5, b.rect.yb - 0.5], frameCols: [b.rect.xa + 0.5, b.rect.xb - 0.5] },
        background: own ? b.corners.background : [], noiseRegions: b.corners.noise,
        manual: man ? { rows: [man.a, man.b], levels: [+man.la.toFixed(6), +man.lb.toFixed(6)], note: 'integrated relative to a user-defined baseline' } : undefined,
        spec: b.spec, frame: row.frame, placed: row.placed || 1, laneId: lid, override: ['dx', 'dy0', 'dy1', 'bg', 'manual'].filter(k => L[k] != null) }
    };
  }
  const fmtN = v => (v == null || !isFinite(v) ? '–' : Math.abs(v) >= 100 ? v.toFixed(1) : v.toPrecision(3));

  /* ---------- total-lane regions (lane normalization) ----------
   * One region per lane, of its own: rows y0..y1 of their frame, the lane's centre, a half-width, kept in
   * quant.normRegions with stable lane ids. Placed from the analysis area when the user chooses total lane signal
   * or asks to update them; band order, band deletion and the analysis area itself never move them. */
  function placeNormRegions(App) {
    const S = App.S, q = S.quant, g = region(S), mk = new Set(S.markers.map(m => m.lane)), lanes = {};
    S.lanes.forEach((l, i) => { if (!mk.has(i) && l.x >= g.x && l.x <= g.x + g.w) lanes[App.laneId(i)] = { cx: l.x }; });
    q.normRegions = { frame: storeFrame(App), y0: Math.round(g.y), y1: Math.round(g.y + g.h - 1), hw: boxHalfWidth(S), lanes, placed: ((q.normRegions && q.normRegions.placed) || 0) + 1, from: 'analysis area' };
    pruneFrames(q);
    return q.normRegions;
  }
  function laneTotalCell(App, lid) {
    const nr = App.S.quant.normRegions, L = nr && nr.lanes && nr.lanes[lid];
    if (!nr) return { value: null, unavailable: 'No total-lane regions yet (Update the total-lane regions from the analysis area).', flags: { noise: 'unavailable', clipState: 'unknown' }, review: [] };
    if (!L) return { value: null, unavailable: 'This lane has no total-lane region (Update the total-lane regions from the analysis area).', flags: { noise: 'unavailable', clipState: 'unknown' }, review: [] };
    const pseudo = { frame: nr.frame, y0: nr.y0, y1: nr.y1, hw: nr.hw, strip: [nr.y0, nr.y1], lanes: { [lid]: { cx: L.cx, dx: L.dx } }, name: 'lane total' };
    return measureCell(App, pseudo, lid, { total: true });
  }

  /* The lane's profile around a band, for drawing and for manual integration: the mean signal per pixel (s, the
   * value's units) of each row of the lane's region width, with the row's pixel count, over the region and its own
   * height above and below (at least 12 rows), in rows of the band's frame. { rows: [{y, mean, n}], region:
   * [first, last], baseline: [{y, b}] (what the calculation subtracts), bgRows: [{y, mean, side}] (rows the
   * background came from), manual, method }. Rows with no pixel (off the image) have mean NaN: a gap, not zero. */
  function laneProfile(App, row, lid) {
    const L = row.lanes && row.lanes[lid], fm = L && frameMapOf(App, row.frame);
    if (!fm) return null;
    // the window is anchored on the band's own region (a drawn baseline does not move it, unless it reaches past it)
    const c = measureCell(App, row, lid), rect = rectOf(row, L), auto = rectOf(row, Object.assign({}, L, { manual: null })), K = Math.round(auto.yb - auto.ya), M = Math.max(12, K);
    const wa = Math.min(auto.ya - M, rect.ya - 4), wb = Math.max(auto.yb + M, rect.yb + 4);
    const key = JSON.stringify(['lp', frameContentId(App, row.frame), row.hw, L.cx, L.dx || 0, wa, wb, App.S.bright]);
    let rows = cacheGet(App, key);
    if (!rows) {
      const val = App.S.bright ? v => v : v => 1 - v, w = gather(App, fm, { xa: rect.xa, xb: rect.xb, ya: wa, yb: wb, v0: 0 });
      rows = cacheSet(App, key, w.bins.map((b, t) => { let s2 = 0; for (let i = 0; i < b.raw.length; i++) s2 += val(b.raw[i]); return { y: wa + 0.5 + t, mean: b.raw.length ? s2 / b.raw.length : NaN, n: b.raw.length }; }));
    }
    return { rows, region: [rect.ya + 0.5, rect.yb - 0.5], method: c.method || App.S.quant.bg,
      baseline: (c.prof || []).map(p => ({ y: rect.ya + p.v, b: p.bg, n: p.n })), bgRows: c.method === 'manual' ? [] : (c.bgProf || []).map(p => ({ y: rect.ya + p.v, mean: p.mean, side: p.side })),
      manual: manualOf(L), cell: c };
  }
  // the profile's level at row y (mean of rows y-1..y+1), to put a drawn baseline's end on the curve
  function levelAt(P, y) {
    const near = P.rows.filter(r => Math.abs(r.y - y) <= 1.01 && !isNaN(r.mean));
    return near.length ? near.reduce((s2, r) => s2 + r.mean, 0) / near.length : NaN;
  }
  /* Manual integration in one lane: limits a..b (rows of the band's frame, inclusive) and a straight baseline from
   * level la at a to lb at b, relative to which the region is integrated; the lane's own start / end shifts give
   * way to it. An explicit, undoable analysis change (the interface's "Edit baseline…"). */
  function setManual(App, row, lid, a, b, la, lb) {
    const L = row.lanes && row.lanes[lid];
    if (!L) return false;
    a = Math.round(a); b = Math.round(b);
    if (b - a < 2 || !isFinite(la) || !isFinite(lb)) return false;
    L.manual = { a, b, la: +la.toFixed(6), lb: +lb.toFixed(6) };
    delete L.dy0; delete L.dy1;
    return true;
  }
  // a lane's integration limits (rows of the band's frame, inclusive): its drawn baseline's, else its region's
  function limitsOf(row, lid) {
    const L = row.lanes && row.lanes[lid]; if (!L) return null;
    const m = manualOf(L); if (m) return [m.a, m.b];
    const r = rectOf(row, L); return [Math.round(r.ya + 0.5), Math.round(r.yb - 0.5)];
  }
  /* Copy integration limits: rows a..b in each target lane, each keeping its own background method (local regions,
   * or whatever the band uses); a target lane with a drawn baseline keeps it unless replaceManual (it then goes
   * back to the band's background, with these limits). Returns the lanes changed and the lanes left alone. */
  function copyLimits(App, row, targets, a, b, opts) {
    const done = [], kept = [];
    targets.forEach(id => {
      const L = row.lanes && row.lanes[id]; if (!L) return;
      if (L.manual && !(opts && opts.replaceManual)) { kept.push(id); return; }
      delete L.manual; L.dy0 = Math.round(a) - row.y0; L.dy1 = Math.round(b) - row.y1; if (!L.dy0) delete L.dy0; if (!L.dy1) delete L.dy1;
      done.push(id);
    });
    return { done, kept };
  }
  /* Endpoint baseline in the target lanes: each lane is integrated between its own limits relative to the straight
   * line joining its own profile at those two rows. Valid only when both ends lie on background; where they do not
   * (a broad band reaching them) the lane is flagged, never silently accepted. A target with a drawn baseline is
   * replaced only with replaceManual. */
  function endpointBaseline(App, row, targets, opts) {
    const done = [], kept = [];
    targets.forEach(id => {
      const L = row.lanes && row.lanes[id]; if (!L) return;
      if (L.manual && !(opts && opts.replaceManual)) { kept.push(id); return; }
      const lim = limitsOf(row, id), P = laneProfile(App, row, id), la = P ? levelAt(P, lim[0]) : NaN, lb = P ? levelAt(P, lim[1]) : NaN;
      if (setManual(App, row, id, lim[0], lim[1], la, lb)) done.push(id); else kept.push(id);
    });
    return { done, kept };
  }
  // +1 when a step of +1 in the band's frame moves the lane's region to the right on the screen now, -1 when it
  // moves it to the left (a flip or a rotation past 90 degrees since the band was placed)
  function screenSign(App, row, lid) {
    const L = row.lanes && row.lanes[lid], fm = L && frameMapOf(App, row.frame); if (!fm) return 1;
    const cm = curMap(App), y = (row.y0 + row.y1) / 2, p0 = fm.to(L.cx, y), p1 = fm.to(L.cx + 1, y), a = cm.from(p0.x, p0.y), b = cm.from(p1.x, p1.y);
    return b.x >= a.x ? 1 : -1;
  }
  // back to the automatic background in one lane, keeping its integration limits and its other adjustments
  function useAutoBackground(App, row, lid) {
    const L = row.lanes && row.lanes[lid], m = manualOf(L); if (!m) return false;
    delete L.manual; L.dy0 = m.a - row.y0; L.dy1 = m.b - row.y1; if (!L.dy0) delete L.dy0; if (!L.dy1) delete L.dy1;
    return true;
  }
  // every adjustment of one lane (the list says what): back to the band's own region and background
  const LANE_ADJ = { manual: 'drawn baseline', dx: 'horizontal shift', dy0: 'start', dy1: 'end', bg: 'lane background settings' };
  function laneAdjustments(row, lid) { const L = row.lanes && row.lanes[lid]; return L ? Object.keys(LANE_ADJ).filter(k => L[k] != null).map(k => LANE_ADJ[k]) : []; }
  function resetLaneAll(App, row, lid) { const L = row.lanes && row.lanes[lid]; if (!L) return []; const was = laneAdjustments(row, lid); Object.keys(LANE_ADJ).forEach(k => { delete L[k]; }); return was; }
  /* What a bulk change would do, before doing it: the targets' values and quality now and after (the change is
   * applied to the band's lanes, measured, and taken back; nothing is committed). */
  function preview(App, row, targets, apply) {
    const take = () => { const R = measure(App), k = App.S.quant.rows.indexOf(row), o = {}; targets.forEach(id => { const j = R.ids.indexOf(id), c = j >= 0 && k >= 0 ? R.cells[k][j] : null; o[id] = c ? { value: c.value, review: c.review || [], flags: c.flags || {}, unavailable: c.unavailable } : null; }); return o; };
    const saved = JSON.stringify(row.lanes), before = take();
    let res = null, after = {};
    try { res = apply(); after = take(); } finally { row.lanes = JSON.parse(saved); }
    return { before, after, result: res };
  }
  /* ---------- review checked by the user ----------
   * A cell flagged for review can be marked as checked once the user has looked at it: the mark holds a signature
   * of the reasons it was given for, so any change that alters them (an edit, another band, other settings) makes
   * the cell need review again. It changes no value and no flag: exports keep every reason and say it was checked. */
  // what a cell is flagged for: its review reasons, clipped pixels, or why it has no value
  function issuesOf(c) { if (!c) return []; if (c.value == null) return c.unavailable ? [c.unavailable] : []; return (c.review || []).concat(c.flags && c.flags.clip ? ['clipped pixels: the value is underestimated'] : []); }
  // the mark covers the reasons and everything the lane's value rests on: its region, adjustments and baseline, the
  // band's rows and frame, the background settings and the polarity
  function checkKey(App, row, L, issues) {
    const q = App.S.quant;
    return reviewSig(issues, [row.frame, row.y0, row.y1, row.hw, L.cx, L.dx, L.dy0, L.dy1, L.bg, L.manual, q.bg, q.bgSides, q.bgGap, q.bgSize, q.mode, App.S.bright]);
  }
  function reviewSig(review, ctx) { let h = 5381; const t = (review || []).join('|') + (review && review.length && ctx ? '#' + JSON.stringify(ctx) : ''); for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0; return t ? 'r' + h.toString(36) + t.length.toString(36) : ''; }
  function setChecked(App, row, lid, on) {
    const L = row && row.lanes && row.lanes[lid]; if (!L) return false;
    if (!on) { delete L.checked; return true; }
    const is = issuesOf(measureCell(App, row, lid)); if (!is.length) return false;
    L.checked = checkKey(App, row, L, is); return true;
  }
  /* ---------- the whole table ---------- */
  const OUTPUTS = ['corrected', 'normalized', 'fold'];
  function measure(App) {
    const S = App.S, q = S.quant;
    if (q.version !== VERSION) return measureLegacy(App);
    ensurePlaced(App);
    const lanes = quantLanes(App), ids = lanes.map(i => App.laneId(i)), rows = q.rows;
    const cells = rows.map((r, k) => lanes.map((i, j) => Object.assign({ lane: i, k, j }, measureCell(App, r, ids[j]))));
    cells.forEach((r, k) => r.forEach((c, j) => { const L = rows[k].lanes && rows[k].lanes[ids[j]]; c.checked = !!(L && L.checked && L.checked === checkKey(App, rows[k], L, issuesOf(c))); }));
    const normMode = q.norm === 'band' || q.norm === 'lane' ? q.norm : 'none';
    const nb = normMode === 'band' ? rows.findIndex(r => r.id === q.normBand) : -1;
    // total-lane denominators come from each lane's own total-lane region (never from a band, so band order,
    // deletion and renaming cannot change them)
    const totals = normMode === 'lane' ? lanes.map((i, j) => Object.assign({ lane: i, j }, laneTotalCell(App, ids[j]))) : null;
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
    // a divisor or reference that needs review, or whose noise or clipping could not be checked, makes every ratio
    // resting on it need review too (given, marked unverified, never an ordinary qualified result)
    const revOf = c => !!(c && c.review && c.review.length && !c.checked);
    const unverified = (c, what) => (!c || !c.flags ? null : c.flags.noise && c.flags.noise !== 'estimated' ? `${what}'s noise could not be estimated (unverified)` : c.flags.clipState === 'unknown' ? `${what}'s clipping could not be checked (unverified)` : null);
    const caveatN = rows.map((r, k) => lanes.map((i, j) => {
      if (normMode === 'none' || normalized[k][j] == null) return null;
      const d = normMode === 'band' ? cells[nb][j] : totals[j], what = normMode === 'band' ? 'the reference band' : 'the lane total';
      return [revOf(d) ? `${what} needs review in this lane` : null, unverified(d, what)].filter(Boolean).join('; ') || null;
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
      return [own, j !== refJ && (revOf(rc) || rd) ? 'the reference lane needs review' : null, j !== refJ ? unverified(rc, 'the reference lane') : null].filter(Boolean).join('; ') || null;
    }));
    const values = { corrected, normalized, fold }, why = { corrected: whyC, normalized: whyN, fold: whyF };
    const caveat = { corrected: rows.map(() => lanes.map(() => null)), normalized: caveatN, fold: caveatF };
    const satLanes = new Set(); cells.forEach(r => r.forEach(c => { if (c.flags && c.flags.clip) satLanes.add(c.lane); }));
    if (totals) totals.forEach(c => { if (c.flags && c.flags.clip) satLanes.add(c.lane); });
    const reviewLanes = new Set(), checkedLanes = new Set(); cells.forEach(r => r.forEach(c => { if (c.review && c.review.length) (c.checked ? checkedLanes : reviewLanes).add(c.lane); }));
    const manualLanes = new Set(); cells.forEach(r => r.forEach(c => { if (c.flags && c.flags.manual) manualLanes.add(c.lane); }));
    const noiseUnknownLanes = new Set(); cells.forEach(r => r.forEach(c => { if (c.flags && c.flags.belowUnknown) noiseUnknownLanes.add(c.lane); }));
    const clipUnknown = cells.some(r => r.some(c => c.flags && c.flags.clipState === 'unknown'));
    const normLabel = nb >= 0 ? (rows[nb].name || `Band ${nb + 1}`) : normMode === 'lane' ? (q.laneTotal ? 'total protein (lane)' : 'total lane signal') : null;
    return {
      version: VERSION, lanes, ids, names: lanes.map(i => S.lanes[i].name || String(i + 1)), rows: rows.map((r, k) => ({ id: r.id, name: r.name || `Band ${k + 1}`, ref: k === nb })),
      cells, totals, values, why, caveat, output, shown: values[output], shownWhy: why[output], shownCaveat: caveat[output], vol: corrected, norm: normalized, rel: fold, refOk,
      normMode, normBand: nb, control: nb, normLabel, laneTotal: !!q.laneTotal, ref: refJ >= 0 ? lanes[refJ] : null, refId: q.ref, refJ,
      method: q.bg, mode: q.mode === 'band' ? 'band' : 'box', region: Object.assign({}, region(S)), halfWidthPx: rows.length ? rows[0].hw : boxHalfWidth(S),
      saturatedLanes: [...satLanes], reviewLanes: [...reviewLanes].sort((x, y) => x - y), checkedLanes: [...checkedLanes].filter(i => !reviewLanes.has(i)).sort((x, y) => x - y), manualLanes: [...manualLanes].sort((x, y) => x - y), noiseUnknownLanes: [...noiseUnknownLanes].sort((x, y) => x - y), clipUnknown,
      normRegions: normMode === 'lane' ? q.normRegions || null : null, flags: cells.map(r => r.map(c => c.flags || {}))
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
    if (q.norm === 'lane') placeNormRegions(App);
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
  // how a stored frame relates to the decoded image, in words
  function frameText(f) {
    if (!f) return 'an unknown frame';
    const parts = [f.rot ? `rotated ${f.rot}°` : '', f.fh && f.fv ? 'rotated by 180°' : f.fh ? 'flipped horizontally' : f.fv ? 'flipped vertically' : '', f.grid ? `geometry-corrected (grid ${f.grid.nx} × ${f.grid.ny})` : ''].filter(Boolean);
    return parts.length ? parts.join(', ') : 'as decoded';
  }
  // the pixel columns a lane's region spans in its placement frame (centre-inclusion rule), per band
  function widthText(R) {
    const ws = new Set(); R.cells.forEach(r => r.forEach(c => { const fc = c.prov && c.prov.signal && c.prov.signal.frameCols; if (fc) ws.add(fc[1] - fc[0] + 1); }));
    const a = [...ws].sort((x, y) => x - y);
    return a.length ? (a.length === 1 ? `${a[0]} px` : `${a[0]}–${a[a.length - 1]} px`) : `${Math.round(R.halfWidthPx * 2) + 1} px`;
  }
  /* One description of what was measured, shared by the analysis window, the clipboard, the CSV, the methods
   * text, the processing log and the summary sent to Claude, so all of them say the same thing. The placement is
   * read from each band's stored frame, never from how the image is shown now. */
  function describe(App, R) {
    const S = App.S, q = S.quant, v2 = R.version === VERSION;
    let pixels;
    if (v2) {
      const byFrame = new Map(); q.rows.forEach((r, k) => { const t = frameText(q.frames && q.frames[r.frame]); byFrame.set(t, (byFrame.get(t) || []).concat(R.rows[k] ? R.rows[k].name : r.name || `Band ${k + 1}`)); });
      const where = byFrame.size <= 1 ? `on the image ${[...byFrame.keys()][0] || 'as decoded'}` : [...byFrame].map(([t, names]) => `${names.join(', ')} on the image ${t}`).join('; ');
      pixels = `the original pixel values of the decoded file: each region was placed once (${where}) and mapped back to the original pixels; every original pixel whose centre lies inside it was counted once with weight 1 (no resampled value, no contrast setting); later display changes do not move it`;
    } else {
      const rot = !!S.rotation, geo = !!(S.geom && S.geom.grid);
      pixels = rot || geo ? `the original pixel values: each box outline was mapped back through the ${[rot ? 'rotation' : '', geo ? 'geometry correction' : ''].filter(Boolean).join(' and the ')} (no resampled value; no contrast setting)` : 'the original pixel values (no contrast setting)';
    }
    const g = R.region, refName = R.ref != null ? (S.lanes[R.ref].name || `lane ${R.ref + 1}`).replace(/\*/g, '') : null, nr = q.normRegions;
    const norm = R.normMode === 'band'
      ? (R.normBand >= 0 ? `each band was divided by the ${R.normLabel} band of the same lane (a reference band: valid only if it is stable across the conditions and within its linear range)` : 'a reference band was to be chosen; no normalized value was given')
      : R.normMode === 'lane'
        ? `each band was divided by its lane's total signal over that lane's total-lane region (rows ${nr ? `${nr.y0}–${nr.y1}` : '–'} of the frame they were placed in, ${nr ? frameText(q.frames && q.frames[nr.frame]) : '–'}; set from the analysis area, kept apart from the bands)` + (R.laneTotal ? '; the image is a total-protein stain or stain-free image (total-protein normalization)' : '; this is total-protein normalization only if the image is a total-protein stain or stain-free image')
        : 'values were not normalized';
    const summary = [R.mode === 'band' ? 'Thresholded signal (exploratory)' : 'Whole region', v2 ? bgLabel(q) : BG_SHORT[R.method] || R.method, normShort(R), `Output: ${OUTPUT_TEXT[R.output]}`].join(' · ');
    return {
      version: v2 ? `calculation version ${VERSION}` : 'calculation version 1 (an earlier method: background from the box\'s own edge rows, negative rows set to zero)',
      build: (G.App && G.App.BUILD) || 'dev',
      summary,
      pixels,
      signal: S.bright ? 'bright bands: signal = pixel value on the file\'s full scale (0–1)' : 'dark bands: signal = 1 − pixel value on the file\'s full scale (0–1); the display inversion does not change it',
      measure: MODE_TEXT[R.mode] || R.mode,
      background: v2 && R.method === 'local' ? `local background regions ${SIDES_TEXT[q.bgSides || 'ab']} the band region, ${q.bgGap != null ? q.bgGap : 2} px from it (median of each; above and below: a straight line between the two along the lane)` : BG_TEXT[R.method] || R.method,
      limits: v2 ? 'noise thresholds per lane (estimated, not assay limits): 3 σ and 10 σ of the region\'s sum, σ from the spread of the local background pixels (median absolute deviation), allowing for correlated neighbouring pixels; values below 10 σ are flagged and never used as a divisor or a reference; where the noise could not be estimated no threshold check was made and the lane is flagged'
        : 'limits per box from the noise of its edge rows: LOD = 3 σ, LOQ = 10 σ of the box total; values below the LOQ are flagged',
      area: `analysis area x ${Math.round(g.x)}–${Math.round(g.x + g.w)} px of the working frame: it decides which lanes are measured; band regions and total-lane regions keep their own extent`,
      normalization: norm,
      output: OUTPUT_TEXT[R.output],
      reference: R.refId != null ? (refName ? `fold changes are given against lane ${R.ref + 1}${refName !== String(R.ref + 1) ? ` (${refName})` : ''}` : 'the reference lane chosen is not measured; no fold change was given') : 'no reference lane was chosen; no fold change was given',
      saturation: App.satReport().text,
      units: 'arbitrary units of this image; compare lanes of this image only'
    };
  }
  /* A methods paragraph for the manuscript, from what was actually done (per band, per lane). */
  function methodsText(App, R) {
    const S = App.S, A = G.App, bits = S.file.bits ? `${S.file.bits}-bit ` : '', D = describe(App, R), cap = t => t[0].toUpperCase() + t.slice(1), lanesOf = a => a.map(i => i + 1).join(', ');
    const pl = a => a.length > 1, sat = R.saturatedLanes.length ? ` Lane${pl(R.saturatedLanes) ? 's' : ''} ${lanesOf(R.saturatedLanes)} contained clipped pixels; ${pl(R.saturatedLanes) ? 'their values are' : 'its value is'} underestimated and ${pl(R.saturatedLanes) ? 'were' : 'was'} not used as ${pl(R.saturatedLanes) ? 'divisors or references' : 'a divisor or reference'}.` : '';
    const rev = (R.reviewLanes && R.reviewLanes.length ? ` Lane${pl(R.reviewLanes) ? 's' : ''} ${lanesOf(R.reviewLanes)} ${pl(R.reviewLanes) ? 'were' : 'was'} flagged for review (region, background or noise).` : '')
      + (R.checkedLanes && R.checkedLanes.length ? ` In lane${R.checkedLanes.length > 1 ? 's' : ''} ${lanesOf(R.checkedLanes)} the review flags were inspected on the lane profile and the values kept by the user (the flags are listed with the results).` : '');
    const man = R.manualLanes && R.manualLanes.length ? ` In lane${R.manualLanes.length > 1 ? 's' : ''} ${lanesOf(R.manualLanes)} the region was integrated relative to a user-defined baseline drawn on the lane profile (start and end rows and levels recorded); the noise estimate excludes the uncertainty in where that baseline was drawn.` : '';
    const nz = R.noiseUnknownLanes && R.noiseUnknownLanes.length ? ` In lane${R.noiseUnknownLanes.length > 1 ? 's' : ''} ${lanesOf(R.noiseUnknownLanes)} the noise could not be estimated, so no threshold check was made.` : '';
    const adj = new Set(); R.cells.forEach(r => r.forEach(c => { if (c.prov && c.prov.override && c.prov.override.some(k => k !== 'manual')) adj.add(c.lane); }));
    const heights = adj.size ? `the band's rows in every lane except lane${adj.size > 1 ? 's' : ''} ${lanesOf([...adj].sort((a, b) => a - b))} (lane-specific start, end, shift or background)` : 'the band\'s rows in every lane';
    return `Band intensities were quantified in ${A.NAME} ${A.VERSION} (build ${D.build}; ${D.version}) on the ${bits}image, from ${D.pixels}. ` +
      `${cap(D.signal)}. Each band (${R.rows.map(r => r.name).join(', ')}) was measured over regions ${widthText(R)} wide and ${heights}; the value of a region is ${D.measure}, with ${D.background}.${man} ` +
      `${cap(D.limits)}.${nz} ${cap(D.normalization)}; ${D.reference}.${sat}${rev} ${D.saturation} Values are ${D.units}; inverted or raw grey values are not calibrated optical density or amount.`;
  }

  // ---------- export helpers ----------
  const num = (v, d) => (v == null || !isFinite(v) ? '' : (+v).toFixed(d));
  function csv(rows) { return rows.map(r => r.map(c => { const s = String(c == null ? '' : c); return /[",\n\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n') + '\r\n'; }
  // a cell's flags in words, for the table, the CSV and the clipboard
  function flagText(f, c) {
    f = f || {};
    return [f.clip === 'limit' ? 'clipped (digital limit)' : f.clip === 'pileup' ? 'probably clipped (pile-up)' : '', f.clipState === 'unknown' ? 'clipping not checkable' : '',
      f.below === 't3' ? 'below 3σ noise threshold' : f.below === 't10' ? 'below 10σ noise threshold' : '',
      f.noise && f.noise !== 'estimated' ? `noise not estimated (${NOISE_TEXT[f.noise] || f.noise}; no threshold check)` : '',
      f.boundary ? (f.manual ? 'band continues beyond the limits' : f.edgeMethod ? 'band reaches the background rows' : 'band reaches region edge') : '',
      f.endpoints ? 'baseline end on band' : '', f.endpointsLow ? 'baseline end below background' : '', f.endpointsUnchecked ? 'baseline ends not checked' : '', f.baselineSensitive ? 'sensitive to the baseline' : '',
      f.contaminated ? (f.manual ? 'band beyond the limits' : 'background holds band') : '', f.uneven ? 'background not flat' : '', f.twoPeaks ? 'two peaks' : '', f.overlap ? 'background over another band' : '',
      f.outside && f.outside.signal ? 'partly outside image' : '', f.unstable ? 'sensitive to region' : '', f.oneSide ? 'one background side' : '',
      f.manual ? 'user-defined baseline' : f.override ? 'lane-specific region' : '', f.unplaced ? 'no region' : '', f.legacy ? 'earlier method' : '',
      c && c.unavailable ? 'unavailable' : ''].filter(Boolean).join('; ');
  }
  const outLabel = (R, k) => (R.output === 'fold' ? `${R.rows[k].name} fold change vs lane ${R.ref != null ? R.ref + 1 : '?'}` : R.output === 'normalized' ? `${R.rows[k].name} / ${R.normLabel || 'divisor'}` : `${R.rows[k].name} corrected signal (a.u.)`);
  /* The rows of the table as data: one per lane. Every quantity has its own value, reason when it is not given and
   * caveat, whatever output is selected for display (the selection changes what the window shows, never what is
   * exported). Clipboard and CSV share it. */
  function tableRows(App, R, opts) {
    const full = opts && opts.full, out = [], hasN = R.normMode !== 'none', hasF = R.refId != null;
    const head = ['Well', 'Lane', 'Lane id'];
    R.rows.forEach(r => {
      head.push(`${r.name} corrected (a.u.)`);
      if (full) head.push(`${r.name} uncorrected sum`, `${r.name} background sum`, `${r.name} signal px`, `${r.name} background px`, `${r.name} noise`, `${r.name} 3σ threshold`, `${r.name} 10σ threshold`, `${r.name} clipped px`, `${r.name} clipping`);
      head.push(`${r.name} corrected unavailable because`, `${r.name} flags`, `${r.name} review`);
      if (hasN) head.push(`${r.name} / ${R.normLabel || 'divisor'}`, `${r.name} normalized unavailable because`, `${r.name} normalized caveat`);
      if (hasF) head.push(`${r.name} fold vs lane ${R.ref != null ? R.ref + 1 : '?'}`, `${r.name} fold unavailable because`, `${r.name} fold caveat`);
    });
    if (R.totals) head.push('Lane total (a.u.)', 'Lane total unavailable because', 'Lane total flags');
    out.push(head);
    R.lanes.forEach((i, j) => {
      const line = [i + 1, R.names[j].replace(/\*/g, ''), R.ids[j]];
      R.rows.forEach((r, k) => {
        const c = R.cells[k][j], f = c.flags || {};
        line.push(num(R.values.corrected[k][j], 4));
        if (full) line.push(num(c.U, 4), num(c.B, 4), c.n || 0, c.nb || 0, f.noise || '', num(c.t3, 4), num(c.t10, 4), c.clip ? c.clip.n : 0, f.clipState === 'unknown' ? 'not checkable' : f.clipState ? 'checked' : '');
        const is = c.value == null ? [] : issuesOf(c);
        line.push(R.why.corrected[k][j] || '', flagText(f, c), is.length ? `${c.checked ? 'checked by the user' : 'needs review'}: ${is.join('; ')}` : '');
        if (hasN) line.push(num(R.values.normalized[k][j], 5), R.why.normalized[k][j] || '', R.caveat.normalized[k][j] || '');
        if (hasF) line.push(num(R.values.fold[k][j], 4), R.why.fold[k][j] || '', R.caveat.fold[k][j] || '');
      });
      if (R.totals) { const t = R.totals[j]; line.push(num(t.value, 4), t.unavailable || '', flagText(t.flags, t)); }
      out.push(line);
    });
    return out;
  }
  function quantCSV(App, R) {
    const S = App.S, D = describe(App, R), out = [];
    out.push(['# GelGrapher densitometry', S.file.name, 'SHA-256 ' + S.file.sha256]);
    out.push(['# build', `${G.App.NAME} ${G.App.VERSION} build ${D.build}`]);
    out.push(['# method', D.summary]);
    out.push(['# calculation', D.version]);
    out.push(['# signal', D.signal]);
    out.push(['# measure', D.measure]);
    out.push(['# pixels', D.pixels]);
    out.push(['# background', D.background]);
    out.push(['# thresholds', D.limits]);
    out.push(['# area', D.area]);
    out.push(['# normalization', D.normalization]);
    out.push(['# output shown', D.output]);
    out.push(['# reference', D.reference]);
    out.push(['# saturation', D.saturation]);
    out.push(['# units', D.units]);
    out.push(['# specification', 'the densitometry specification (JSON) holds every frame, region, lane adjustment, baseline and setting; with the original image it recomputes these values']);
    tableRows(App, R, { full: true }).forEach(r => out.push(r));
    // where every region is: its rows and columns in its placement frame, its corners in original pixels
    out.push([]);
    out.push(['# regions', 'band', 'lane id', 'frame', 'frame rows', 'frame columns', 'signal corners (original x y)', 'signal px', 'background or baseline', 'lane adjustments', 'placed']);
    R.cells.forEach((r, k) => r.forEach((c, j) => { const p = c.prov || {}; if (!p.signal) return; out.push(['', R.rows[k].name, R.ids[j], p.frame, (p.signal.frameRows || []).join('–'), (p.signal.frameCols || []).join('–'), p.signal.corners.map(q => q.join(' ')).join('; '), p.signal.px, p.manual ? `user-defined baseline from row ${p.manual.rows[0]} (level ${p.manual.levels[0]}) to row ${p.manual.rows[1]} (level ${p.manual.levels[1]})` : (p.background || []).map(b => `${b.side} ${b.px} px: ${b.corners.map(q => q.join(' ')).join('; ')}`).join(' | '), (p.override || []).join(' '), p.placed]); }));
    return csv(out);
  }
  // the clipboard: the table with units, flags, reasons and the reference, tab-separated
  function quantTSV(App, R) {
    const D = describe(App, R), rows = tableRows(App, R, { full: false });
    const lines = [`# ${App.S.file.name} · ${D.summary}`, `# ${D.units}; ${D.reference}`].concat(rows.map(r => r.map(c => String(c == null ? '' : c).replace(/\t/g, ' ')).join('\t')));
    return lines.join('\n');
  }
  /* The reproducible analysis specification: everything the values depend on besides the image itself (frames in
   * full, every band with its lanes' regions, adjustments and drawn baselines, the settings, the total-lane
   * regions, the pixel rule). applySpec on the same image (checked by its SHA-256) gives the same values. */
  const PIXEL_RULE = 'A region is a quadrilateral strip per row of its placement frame (columns round(cx + dx - hw) - 0.5 to round(cx + dx + hw) + 0.5, rows y0 - 0.5 to y1 + 0.5), mapped to the decoded image through the frame (inverse grid, then inverse rotation about ((W - 1) / 2, (H - 1) / 2), then flips) at points at most 6 px apart; every pixel whose centre lies inside (even-odd rule, half-open scanlines) is counted once with weight 1.';
  function spec(App) {
    const S = App.S, q = S.quant, copy = o => JSON.parse(JSON.stringify(o));
    return { format: 'gelgrapher-densitometry-spec', specVersion: 1, calculationVersion: q.version, app: `${G.App.NAME} ${G.App.VERSION}`, build: (G.App && G.App.BUILD) || 'dev',
      image: { name: S.file.name, sha256: S.file.sha256, width: App.src0.w, height: App.src0.h }, pixelRule: PIXEL_RULE, signal: S.bright ? 'bright: s = I' : 'dark: s = 1 - I', bright: !!S.bright,
      settings: { mode: q.mode, bg: q.bg, bgSides: q.bgSides, bgGap: q.bgGap, bgSize: q.bgSize, wFrac: q.wFrac }, normalization: { norm: q.norm, normBand: q.normBand, laneTotal: !!q.laneTotal, normRegions: copy(q.normRegions || null) },
      output: q.output, ref: q.ref, region: copy(q.region || null), frames: copy(q.frames || {}), bands: copy(q.rows),
      lanes: S.lanes.map((l, i) => ({ id: App.laneId(i), well: i + 1, x: l.x, name: l.name, noMeasure: !!l.noMeasure, ladder: S.markers.some(m => m.lane === i) })) };
  }
  function applySpec(App, sp) {
    const S = App.S, q = S.quant;
    if (!sp || sp.format !== 'gelgrapher-densitometry-spec') throw new Error('Not a densitometry specification.');
    if (sp.image && sp.image.sha256 && S.file.sha256 && sp.image.sha256 !== S.file.sha256) throw new Error('The specification belongs to another image (SHA-256 differs).');
    const copy = o => JSON.parse(JSON.stringify(o));
    S.bright = !!sp.bright;
    // the lanes as specified (ladder lanes are never measured: they are left out of the analysis here)
    S.lanes = sp.lanes.map(l => { const o = { x: l.x, name: l.name || '', hidden: false, id: l.id }; if (l.noMeasure || l.ladder) o.noMeasure = true; return o; });
    S.markers = S.markers.filter(m => sp.lanes[m.lane] && sp.lanes[m.lane].ladder);
    Object.assign(q, copy(sp.settings), { version: sp.calculationVersion, norm: sp.normalization.norm, normBand: sp.normalization.normBand, laneTotal: sp.normalization.laneTotal, normRegions: copy(sp.normalization.normRegions),
      output: sp.output, ref: sp.ref, region: copy(sp.region), frames: copy(sp.frames), rows: copy(sp.bands) });
    clearCache(App);
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
        const yv = Y(v), y1 = Math.min(yv, Y0), h = Math.abs(Y0 - yv), weak = !!f.below, clip = !!f.clip, rev = (cell.review && cell.review.length && !cell.checked) || !!(R.shownCaveat && R.shownCaveat[k][j]);
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
    const D = describe(App, R), marks = [used.has('weak') ? 'open/dashed: below 10σ noise threshold' : '', used.has('clip') ? 'hatched ‡: clipped pixels' : '', used.has('rev') ? '?: needs review (region, background, noise or an unverified divisor)' : '', used.has('na') ? 'n/a: not available' : ''].filter(Boolean).join('; ');
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
    placeRow, editRow, placeLane, ensurePlaced, rowSpan, laneDrift, outlines, updateToCurrent, pruneFrames, laneProfile, levelAt, setManual, limitsOf, copyLimits, endpointBaseline,
    useAutoBackground, resetLaneAll, screenSign, setChecked, reviewSig, issuesOf, resetLane: resetLaneAll, laneAdjustments, preview, placementDropsManual, placeNormRegions, laneTotalCell, spec, applySpec, clearCache, cacheSize, frameText, NOISE_TEXT, PIXEL_RULE, BG_TEXT, BG_SHORT, MODE_TEXT, OUTPUT_TEXT, SIDES_TEXT, bgLabel, outLabel };
})(window);

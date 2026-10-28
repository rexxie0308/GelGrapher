/* Image processing engine. Pure functions on {w, h, data: Float32Array} images.
 * All adjustments are non-destructive: the source image is never modified.
 */
(function (G) {
  'use strict';

  // ---------- basic helpers ----------
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function percentiles(data, ps, step) {
    // histogram based, data assumed ~0..1
    const BINS = 65536;
    const hist = new Uint32Array(BINS);
    step = step || 1;
    let n = 0;
    for (let i = 0; i < data.length; i += step) {
      hist[clamp((data[i] * (BINS - 1)) | 0, 0, BINS - 1)]++; n++;
    }
    return ps.map(p => {
      const target = p / 100 * n;
      let acc = 0;
      for (let b = 0; b < BINS; b++) { acc += hist[b]; if (acc >= target) return b / (BINS - 1); }
      return 1;
    });
  }

  function gaussSmooth(arr, sigma) {
    if (sigma < 0.5) return Float32Array.from(arr);
    const r = Math.ceil(sigma * 3), k = new Float32Array(2 * r + 1);
    let s = 0;
    for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); s += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= s;
    const n = arr.length, out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (let j = -r; j <= r; j++) v += arr[clamp(i + j, 0, n - 1)] * k[j + r];
      out[i] = v;
    }
    return out;
  }

  // sliding window min (or max) over 1D array, window = 2r+1, O(n)
  function slide(arr, r, isMax) {
    const n = arr.length, out = new Float32Array(n), dq = new Int32Array(n);
    let h = 0, t = 0, j = 0;
    for (let i = 0; i < n; i++) {
      const hi = Math.min(n - 1, i + r);
      while (j <= hi) {
        while (t > h && (isMax ? arr[dq[t - 1]] <= arr[j] : arr[dq[t - 1]] >= arr[j])) t--;
        dq[t++] = j++;
      }
      while (dq[h] < i - r) h++;
      out[i] = arr[dq[h]];
    }
    return out;
  }

  // 1D baseline: rolling min followed by rolling max (morphological opening) then smoothing
  function baseline(arr, r) {
    return gaussSmooth(slide(slide(arr, r, false), r, true), Math.max(1, r / 3));
  }

  function downsample(img, maxDim) {
    const f = Math.max(1, Math.ceil(Math.max(img.w, img.h) / maxDim));
    if (f === 1) return { w: img.w, h: img.h, data: img.data, f: 1 };
    const w = Math.floor(img.w / f), h = Math.floor(img.h / f), d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < f; dy++) {
        const row = (y * f + dy) * img.w + x * f;
        for (let dx = 0; dx < f; dx++) s += img.data[row + dx];
      }
      d[y * w + x] = s / (f * f);
    }
    return { w, h, data: d, f };
  }

  // ---------- geometry ----------
  // Rotate around image centre, same canvas size, edges clamped. Bilinear.
  function rotate(img, deg) {
    if (!deg) return img;
    const { w, h, data } = img, out = new Float32Array(w * h);
    const a = -deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    for (let y = 0; y < h; y++) {
      const dy = y - cy;
      for (let x = 0; x < w; x++) {
        const dx = x - cx;
        let sx = c * dx - s * dy + cx, sy = s * dx + c * dy + cy;
        sx = clamp(sx, 0, w - 1.001); sy = clamp(sy, 0, h - 1.001);
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
        out[y * w + x] = (data[i] * (1 - fx) + data[i + 1] * fx) * (1 - fy) + (data[i + w] * (1 - fx) + data[i + w + 1] * fx) * fy;
      }
    }
    return { w, h, data: out };
  }

  /* ---------- projective geometry (keystone correction) ----------
   * 3 x 3 matrices as row-major arrays of 9; points are (x, y, 1). */
  const M3 = {
    I: () => [1, 0, 0, 0, 1, 0, 0, 0, 1],
    mul(A, B) {
      const o = new Array(9);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
      return o;
    },
    inv(m) {
      const [a, b, c, d, e, f, g, h, i] = m;
      const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
      const det = a * A + b * B + c * C;
      if (!det) return null;
      return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
    },
    apply(m, x, y) {
      const w = m[6] * x + m[7] * y + m[8];
      return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w };
    },
    // the rotation that rotate(img, deg) applies, as the forward map from source to output pixels
    rotation(deg, cx, cy) {
      const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      return [c, -s, cx - c * cx + s * cy, s, c, cy - s * cx - c * cy, 0, 0, 1];
    },
    isIdentity: m => m.every((v, i) => Math.abs(v - (i % 4 === 0 ? 1 : 0)) < 1e-9)
  };

  // Resample img through the forward map M (source -> output), same canvas size, edges clamped,
  // bilinear: the one resampling of the whole pipeline (rotation and keystone composed in M)
  function warp(img, M) {
    if (M3.isIdentity(M)) return img;
    const { w, h, data } = img, out = new Float32Array(w * h), inv = M3.inv(M);
    if (!inv) return img;
    const [a, b, c, d, e, f, g, hh, i] = inv;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ww = g * x + hh * y + i;
        let sx = (a * x + b * y + c) / ww, sy = (d * x + e * y + f) / ww;
        sx = clamp(sx, 0, w - 1.001); sy = clamp(sy, 0, h - 1.001);
        const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, k = y0 * w + x0;
        out[y * w + x] = (data[k] * (1 - fx) + data[k + 1] * fx) * (1 - fy) + (data[k + w] * (1 - fx) + data[k + w + 1] * fx) * fy;
      }
    }
    return { w, h, data: out };
  }

  /* The direction of every lane: in nBands horizontal bands of the crop the lane's centre is the
   * centroid of the band's presence profile within 0.45 pitch of its line; a weighted
   * least-squares line x = a + b (y - yc) through them. Passes: the first searches at the lane's
   * x, the next near the line's prediction, so a lane that drifts over the crop (a keystoned
   * photograph) is followed. Bands without signal (above or below the gel) and lanes with fewer
   * than 4 bands or scattering more than 0.12 pitch about their line give null. */
  function laneLines(img, bright, crop, laneXs, pitch, nBands) {
    nBands = nBands || 12;
    const yc = crop.y + crop.h / 2;
    const rows = laneRows(img, bright, crop, nBands);
    const fit = pts => {
      if (pts.length < 4) return null;
      let W = 0, sy = 0, sx = 0, syy = 0, sxy = 0;
      pts.forEach(p => { const dy = p.y - yc; W += p.w; sy += p.w * dy; sx += p.w * p.x; syy += p.w * dy * dy; sxy += p.w * dy * p.x; });
      const den = W * syy - sy * sy;
      if (den <= 0) return null;
      const b = (W * sxy - sy * sx) / den, a = (sx - b * sy) / W;
      let res = 0, worst = -1; pts.forEach((p, i) => { const e = Math.abs(p.x - (a + b * (p.y - yc))); if (e > res) { res = e; worst = i; } });
      return { a, b, n: pts.length, res, worst };
    };
    return laneXs.map(x0 => {
      // the lane is followed outward from the middle row, so a lane that drifts by more than its
      // own width over the crop (a strong keystone) is still found at the ends
      let pts = trackLane(rows, x0, crop, pitch, 0.45);
      // a few rows off the line (sheared well pockets, a smear joining the neighbour) are dropped,
      // never more than a third of them: a lane that is not straight gives no line
      let line = fit(pts);
      const keep = Math.max(4, Math.ceil(pts.length * 2 / 3));
      while (line && line.res > pitch * 0.12 && pts.length > keep) { pts = pts.filter((p, i) => i !== line.worst); line = fit(pts); }
      return line && line.res <= pitch * 0.12 ? { a: line.a, b: line.b, n: line.n, res: line.res } : null;
    });
  }

  // the presence profile of nBands horizontal bands of the crop (shared by laneLines and laneTraces)
  // yMin: rows above it (the wells and their pockets, whose dark walls sit between the lanes) are left out
  function laneRows(img, bright, crop, nBands, yMin) {
    const bh = crop.h / nBands, rows = [];
    for (let k = 0; k < nBands; k++) {
      const band = cropImg(img, { x: crop.x, y: crop.y + k * bh, w: crop.w, h: bh });
      const q = gaussSmooth(presenceProfile(signal(band, bright), crop.w), Math.max(1, crop.w / 250));
      let mx = 0; for (const v of q) mx = Math.max(mx, v);
      if (yMin != null && crop.y + k * bh < yMin) mx = 0;
      rows.push({ y: crop.y + (k + 0.5) * bh, q, mx });
    }
    rows.gmx = Math.max(1e-9, ...rows.map(r => r.mx));
    return rows;
  }
  // the lane near x0 followed band by band from the middle row outward: each row's centroid is
  // looked for within ±half a pitch of the previous row's; rows without a lane (above the wells,
  // below the dye front) are skipped. Returns points {y, x, w}.
  /* The lane near x0 followed down the crop as a chain of bands. In every horizontal band the
   * candidates are the peaks of the presence profile within 1.2 pitch of the lane's lattice
   * position (refined to their centroid, with their strength and width); the chain through them is
   * the best path of a Viterbi search whose prior says that a lane keeps its direction: the step
   * from one band to the next should repeat the previous step (a lane that leans keeps leaning, a
   * bend is gradual), a band may be missing at a price, and a weak pull towards the lattice
   * position keeps the chain from wandering into the neighbour. So a ladder that leans by most of
   * a lane spacing is followed band by band instead of being cut by a vertical line.
   * Returns the chosen points {y, x, w, ext, s} (bands without a band are left out). */
  function trackLane(rows, x0, crop, pitch, half) {
    const gmx = rows.gmx, W = pitch * 1.2, n = rows.length;
    const refine = (r, pk, a, b, lo) => {
      const ra = Math.max(a, pk - Math.round(pitch * 0.3)), rb = Math.min(b, pk + Math.round(pitch * 0.3));
      let sw = 0, sxw = 0; for (let x = ra; x <= rb; x++) { const v = Math.max(0, r.q[x] - lo); sw += v; sxw += v * x; }
      const cx = sw > 0 ? sxw / sw : pk;
      const ci = clamp(Math.round(cx), 0, r.q.length - 1);
      let top = 0; for (let x = Math.max(a, ci - Math.round(pitch * 0.15)); x <= Math.min(b, ci + Math.round(pitch * 0.15)); x++) top = Math.max(top, r.q[x]);
      const th = lo + (top - lo) * 0.5;
      let l = ci, rr = ci; while (l > a && r.q[l - 1] >= th) l--; while (rr < b && r.q[rr + 1] >= th) rr++;
      return { y: r.y, x: cx + crop.x, w: Math.sqrt(Math.max(0, r.q[pk] - lo)), s: Math.max(0, r.q[pk] - lo) / gmx, ext: rr - l + 1 };
    };
    // candidates per band (the strongest six)
    const cand = rows.map(r => {
      if (r.mx < gmx * 0.15) return [];
      const a = clamp(Math.round(x0 - crop.x - W), 0, r.q.length - 1), b = clamp(Math.round(x0 - crop.x + W), 0, r.q.length - 1);
      let lo = Infinity; for (let x = a; x <= b; x++) lo = Math.min(lo, r.q[x]);
      const out = [];
      for (let x = a + 1; x < b; x++) if (r.q[x] > r.q[x - 1] && r.q[x] >= r.q[x + 1] && r.q[x] - lo >= gmx * 0.06) out.push(refine(r, x, a, b, lo));
      return out.sort((p, q) => q.s - p.s).slice(0, 6);
    });
    // Viterbi over pairs (candidate at the band before, candidate at this band); -1 = missing
    const MISS = 1.3, SLOPE = 0.25 * pitch, STEP = 0.5 * pitch, PULL = 1.5 * pitch;
    const unary = (k, j) => (j < 0 ? MISS : (1 - Math.min(1, cand[k][j].s)) + 0.2 * ((cand[k][j].x - x0) / PULL) ** 2);
    const X = (k, j) => cand[k][j].x;
    const trans = (k, h, i, j) => {   // h at k-2, i at k-1, j at k
      if (j < 0) return 0;
      if (i >= 0 && h >= 0) { const d = (X(k, j) - X(k - 1, i)) - (X(k - 1, i) - X(k - 2, h)); return (d / SLOPE) ** 2; }
      if (i >= 0) return ((X(k, j) - X(k - 1, i)) / STEP) ** 2;
      if (h >= 0) return ((X(k, j) - X(k - 2, h)) / (2 * STEP)) ** 2;
      return 0;
    };
    const states = k => [-1].concat(cand[k].map((c, j) => j));
    // dp[k] maps "i,j" -> {cost, back: "h,i"}
    let dp = new Map();
    if (n < 2) return [];
    for (const i of states(0)) for (const j of states(1)) {
      const c = unary(0, i) + unary(1, j) + (i >= 0 && j >= 0 ? ((X(1, j) - X(0, i)) / STEP) ** 2 : 0);
      dp.set(i + ',' + j, { cost: c, back: null, i, j });
    }
    const hist = [dp];
    for (let k = 2; k < n; k++) {
      const next = new Map();
      for (const [key, st] of dp) for (const j of states(k)) {
        const c = st.cost + unary(k, j) + trans(k, st.i, st.j, j);
        const nk = st.j + ',' + j, cur = next.get(nk);
        if (!cur || c < cur.cost) next.set(nk, { cost: c, back: key, i: st.j, j });
      }
      dp = next; hist.push(dp);
    }
    let best = null; for (const st of dp.values()) if (!best || st.cost < best.cost) best = st;
    if (!best) return [];
    // backtrack: the chosen candidate per band
    const chosen = new Array(n).fill(-1);
    // hist[k - 1] holds the pairs ending at band k; a pair's back key is in the map before it
    for (let st = best, k = n - 1; st && k >= 1; k--) { chosen[k] = st.j; if (k === 1) { chosen[0] = st.i; break; } st = hist[k - 2].get(st.back); }
    const pts = [];
    chosen.forEach((j, k) => { if (j >= 0) pts.push(cand[k][j]); });
    return pts;
  }

  /* The lane comb down the crop: in every horizontal band the lanes are fitted together as one
   * equally spaced family x = c + p i (i = the lane's index in the comb, c the position of lane 0,
   * p the pitch), tracked band by band from the middle outward (each band's lanes looked for at
   * the previous band's prediction). A camera angle makes c and p linear in y: the pitch grows
   * towards the near edge. Because every band is fitted with two parameters over all the lanes,
   * a smear, a torn lane or a sheared well pocket moves no single lane. Returns null when fewer
   * than five bands could be fitted, else { rows, change, se, point, p0, p1, c0, c1 } in the same
   * shape as vanishing(): change is the relative change of the lane spacing over the crop
   * height, point (null when not significant at three standard errors or below 0.5 %) is where the
   * lane lines meet ({ along: y, across: x }); sigma (default 3) is the significance required. */
  function laneComb(img, bright, crop, laneXs, pitch, nBands, sigma, yMin) {
    nBands = nBands || 16; sigma = sigma || 3;
    const xs = laneXs.slice().sort((a, b) => a - b);
    if (xs.length < 4) return null;
    // the pitch from the lanes themselves (median gap), not from a lattice estimate that may be
    // stale or a compromise over a keystoned gel
    { const gaps = xs.slice(1).map((x, k) => x - xs[k]).sort((a, b) => a - b); const med = gaps[gaps.length >> 1]; if (med > 0) pitch = med; }
    if (!(pitch > 0)) return null;
    // the comb index of every lane from the gaps between neighbours (a missing lane leaves a gap,
    // a doubled lane is one tooth); the gaps, not the distance from the first lane, so a pitch
    // estimate a tenth off over a dozen lanes does not shift the far teeth by one
    // two teeth closer than 0.6 pitch (a torn or compressed edge of the slab) are one lane of the comb
    let idx = [{ i: 0, x: xs[0] }];
    for (let k = 1; k < xs.length; k++) { const d = xs[k] - idx[idx.length - 1].x; if (d < pitch * 0.6) continue; const g = Math.round(d / pitch); if (g >= 1) idx.push({ i: idx[idx.length - 1].i + g, x: xs[k] }); }
    if (idx.length < 4) return null;
    const rows = laneRows(img, bright, crop, nBands, yMin), gmx = rows.gmx, yc = crop.y + crop.h / 2;
    laneComb.debug = [];
    const centroidNear = (r, xp, half) => {
      const a = clamp(Math.round(xp - crop.x - pitch * half), 0, r.q.length - 1), b = clamp(Math.round(xp - crop.x + pitch * half), 0, r.q.length - 1);
      let lo = Infinity; for (let x = a; x <= b; x++) lo = Math.min(lo, r.q[x]);
      let sw = 0, sxw = 0; for (let x = a; x <= b; x++) { const v = r.q[x] - lo; sw += v; sxw += v * x; }
      if (sw <= 0 || sw / (b - a + 1) < gmx * 0.06) return null;
      const cx = sxw / sw + crop.x;
      return Math.abs(cx - xp) > pitch * (half - 0.05) ? null : { x: cx, w: Math.sqrt(sw) };
    };
    // one band: the family through the lanes found near the prediction (c, p); at least four lanes
    // and half of them, a lane further than 0.2 pitch from the fitted family is dropped once
    const fitRow = (r, c, p, half) => {
      let pts = idx.map(l => { const m = centroidNear(r, c + p * l.i, half || 0.35); return m && { i: l.i, x: m.x, w: m.w }; }).filter(Boolean);
      const lsq = P => {
        let W = 0, si = 0, sx = 0, sii = 0, six = 0;
        P.forEach(q => { W += q.w; si += q.w * q.i; sx += q.w * q.x; sii += q.w * q.i * q.i; six += q.w * q.i * q.x; });
        const den = W * sii - si * si;
        if (den <= 0) return null;
        const pp = (W * six - si * sx) / den, cc = (sx - pp * si) / W;
        return { c: cc, p: pp, n: P.length };
      };
      // on an SDS gel a lysate lane has bands in some rows only: a third of the lanes (at least three) fit a row
      const need = Math.max(3, Math.ceil(idx.length * 0.3));
      const dbg = [Math.round(r.y), pts.length]; laneComb.debug.push(dbg);
      if (pts.length < need) return null;
      // the first family is robust (the median pitch over all pairs of teeth, the median offset),
      // so one or two teeth off the comb (a torn, compressed edge of the slab) cannot bias it
      let f = null;
      { const sl = []; for (let u = 0; u < pts.length; u++) for (let v = u + 1; v < pts.length; v++) if (pts[v].i !== pts[u].i) sl.push((pts[v].x - pts[u].x) / (pts[v].i - pts[u].i));
        if (sl.length) { sl.sort((a, b) => a - b); const pm = sl[sl.length >> 1]; const off = pts.map(q => q.x - pm * q.i).sort((a, b) => a - b); f = { c: off[off.length >> 1], p: pm, n: pts.length }; } }
      if (!f) f = lsq(pts);
      if (!f) return null;
      // teeth off the family (a lane in a torn region) are dropped in two passes
      let kept = pts;
      for (let pass = 0; pass < 2; pass++) {
        const k2 = kept.filter(q => Math.abs(q.x - (f.c + f.p * q.i)) <= pitch * 0.15);
        if (k2.length < need) return null;
        if (k2.length === kept.length) break;
        kept = k2; f = lsq(kept) || f;
      }
      dbg.push(kept.length, +f.p.toFixed(1), Math.round(f.c));
      // the spread of the kept teeth about their mean index: the information a band's pitch carries
      // (the variance of a least-squares slope is 1 / this), so a band fitted on four teeth near one
      // another weighs little against one fitted across twelve
      let Wk = 0, si = 0, sii = 0, ss = 0; kept.forEach(q => { Wk += q.w; si += q.w * q.i; sii += q.w * q.i * q.i; ss += q.w * (q.x - (f.c + f.p * q.i)) ** 2; });
      const spread = Wk > 0 ? sii - si * si / Wk : 0;
      // the teeth's scatter about the family (weighted variance per unit weight), the noise behind
      // this band's pitch: its variance is this over the spread
      const s2 = kept.length > 2 ? ss / (kept.length - 2) : null;
      return f && f.p > pitch * 0.5 && f.p < pitch * 1.5 ? Object.assign(f, { pts, spread, s2 }) : null;
    };
    // p and c linear in y by least squares over every fitted band (no band trimmed, so the standard
    // error is not optimistic; a Theil-Sen slope was tried and swung the estimate on a gel whose
    // spacing changes faster at the bottom than at the top)
    // a line v = b0 + b1 (y - yc) through the bands, weighted by what each band knows: for the
    // pitch the spread of its teeth (inverse variance of a slope), for the offset the teeth count
    const line = (F, key) => {
      const n = F.length, wt = f => (key === 'p' ? (f.spread || 1) : (f.n || 1));
      let sw = 0, sy = 0, sv = 0, syy = 0, syv = 0;
      F.forEach(f => { const t = f.y - yc, w = wt(f); sw += w; sy += w * t; sv += w * f[key]; syy += w * t * t; syv += w * t * f[key]; });
      const den = sw * syy - sy * sy;
      if (den <= 0 || n < 2) return null;
      const b1 = (sw * syv - sy * sv) / den, b0 = (sv - b1 * sy) / sw;
      let ss = 0; F.forEach(f => { ss += wt(f) * (f[key] - (b0 + b1 * (f.y - yc))) ** 2; });
      const se = n > 2 ? Math.sqrt(ss / (n - 2) / (syy - sy * sy / sw)) : Infinity;
      return { b0, b1, se, n };
    };
    // the family through the lanes of idx in every band, tracked from the middle outward
    const track = () => {
      // the family through the detected lanes (their own spacing, not the pitch estimate), snapped
      // to the middle band in three passes with a wide window: on a keystoned gel the lattice found
      // over the whole crop is a compromise and its outer teeth sit off the lanes of any one band
      let c0m = idx[0].x, p0m = pitch;
      { let W = 0, si = 0, sx = 0, sii = 0, six = 0; idx.forEach(l => { W++; si += l.i; sx += l.x; sii += l.i * l.i; six += l.i * l.x; }); const den = W * sii - si * si; if (den > 0) { p0m = (W * six - si * sx) / den; c0m = (sx - p0m * si) / W; } }
      const mid = rows.length >> 1, fits = [];
      let first = null;
      for (let k = mid, tries = 0; k >= 0 && k < rows.length && tries < 3; k++, tries++) {
        const r = rows[k];
        if (r.mx < gmx * 0.15) continue;
        let f = null;
        for (let pass = 0; pass < 3; pass++) { const g = fitRow(r, f ? f.c : c0m, f ? f.p : p0m, pass ? 0.35 : 0.45); if (!g) break; f = g; }
        if (f) { first = { k, c: f.c, p: f.p }; break; }
      }
      if (!first) return null;
      for (const dir of [1, -1]) {
        const own = [];   // this direction's fits, for the prediction across bands without lanes
        for (let k = dir > 0 ? first.k : first.k - 1; k >= 0 && k < rows.length; k += dir) {
          const r = rows[k];
          if (r.mx < gmx * 0.15) continue;   // no lane in this band (above the wells, below the front)
          // predicted from the trend of the fits so far (the last one alone when there are fewer than
          // three), so a stretch without bands between the wells and the first band is crossed
          let c = first.c, p = first.p;
          if (own.length >= 3) { const lp = line(own, 'p'), lc = line(own, 'c'); if (lp && lc) { c = lc.b0 + lc.b1 * (r.y - yc); p = lp.b0 + lp.b1 * (r.y - yc); } }
          else if (own.length) { c = own[own.length - 1].c; p = own[own.length - 1].p; }
          // two passes: the second looks around the first's own family, so the search windows no
          // longer pull the centroids towards the prediction
          let f = fitRow(r, c, p);
          if (f) f = fitRow(r, f.c, f.p) || f;
          if (f) { const e = { y: r.y, c: f.c, p: f.p, n: f.n, pts: f.pts, spread: f.spread, s2: f.s2 }; fits.push(e); own.push(e); }
        }
      }
      return fits.length >= 5 ? fits : null;
    };
    let fits = track();
    if (!fits) return null;
    // A lane whose offset from the family drifts down the gel (the lane in a torn corner, an outer
    // lane that leans) is not a camera angle: a keystone moves every lane alike and leaves no such
    // drift. Such a lane (drift over the crop height above 0.15 pitch, measured in at least four
    // bands) is left out and the bands are fitted again without it, at most two lanes, at least
    // four kept; the per-lane straightening deals with it afterwards. Reported in `excluded`.
    const excluded = [];
    for (let iter = 0; iter < 2 && idx.length > 4; iter++) {
      let worst = null;
      for (const l of idx) {
        const pts = [];
        fits.forEach(f => { const q = f.pts.find(t => t.i === l.i); if (q) pts.push({ y: f.y, e: q.x - (f.c + f.p * l.i) }); });
        if (pts.length < 4) continue;
        const le = line(pts, 'e');
        if (!le) continue;
        // a drift is a lean only when it is clear of the scatter of the lane's own teeth (three
        // standard errors): a lysate lane's smeared bands wander without leaning
        const drift = Math.abs(le.b1 * crop.h);
        if (drift > Math.max(pitch * 0.15, 3 * le.se * crop.h) && (!worst || drift > worst.drift)) worst = { l, drift };
      }
      if (!worst) break;
      const idx2 = idx.filter(l => l !== worst.l);
      const prev = { idx, fits };
      idx = idx2;
      const f2 = track();
      if (!f2) { idx = prev.idx; fits = prev.fits; break; }
      fits = f2; excluded.push({ x: Math.round(worst.l.x), i: worst.l.i, drift: +worst.drift.toFixed(1) });
    }
    let F = fits.map(f => ({ y: f.y, c: f.c, p: f.p, n: f.n, spread: f.spread, s2: f.s2 })), lp = line(F, 'p'), lc = line(F, 'c');
    if (!lp || !lc) return null;
    // lack of fit: a camera angle changes the spacing linearly down the gel. The bands' pitches
    // scatter about the line by chi2 per degree of freedom (each band's pitch variance is its
    // teeth's scatter over their spread); a gel compressed near its wells or torn at the bottom
    // scatters far more than its teeth explain, and its spacing change is not a keystone
    const lof = (G, L) => { let chi = 0, m = 0; G.forEach(f => { if (f.s2 == null || !f.spread) return; chi += (f.p - (L.b0 + L.b1 * (f.y - yc))) ** 2 * f.spread / Math.max(1e-9, f.s2); m++; }); return m > 2 ? chi / (m - 2) : null; };
    // a band whose pitch sits far off the line through the others (beyond three times the median
    // scatter and 2 % of the pitch) is a local feature of the gel, not of the camera: the dark walls
    // of deep well pockets, a torn or compressed bottom; with six or more bands it is dropped and the
    // line fitted again, once (at least five bands stay). Reported in `dropped`.
    const dropped = [];
    if (F.length >= 6) {
      const res = F.map(f => f.p - (lp.b0 + lp.b1 * (f.y - yc))), abs = res.map(Math.abs).sort((a, b) => a - b);
      const scale = 1.4826 * abs[abs.length >> 1], lim = Math.max(3 * scale, 0.02 * lp.b0);
      const keep = F.filter((f, k) => Math.abs(res[k]) <= lim);
      if (keep.length >= 5 && keep.length < F.length) {
        F.forEach((f, k) => { if (Math.abs(res[k]) > lim) dropped.push({ y: Math.round(f.y), p: +f.p.toFixed(1), n: f.n }); });
        const lp2 = line(keep, 'p'), lc2 = line(keep, 'c');
        if (lp2 && lc2) { F = keep; lp = lp2; lc = lc2; }
      }
    }
    const p0 = lp.b0, p1 = lp.b1, c0 = lc.b0, c1 = lc.b1;
    const change = p1 * crop.h / p0, se = lp.se * crop.h / p0;
    const chi2 = lof(F, lp);
    const out = { rows: F, change, se, p0, p1, c0, c1, n: F.length, point: null, excluded, dropped, teeth: idx.length, chi2 };
    if (Math.abs(change) >= 0.005 && Math.abs(p1) >= sigma * lp.se) {
      // the lines meet where the pitch would vanish
      const ty = -p0 / p1;
      out.point = { along: yc + ty, across: c0 + c1 * ty };
    }
    return out;
  }

  /* Vanishing point of a family of nearly parallel lines x = a + b (y - yc) (lanes) or
   * y = a + b (x - xc) (band rows): the slope grows linearly with the position, b = b0 + b1 a,
   * and the lines meet at distance -1/b1 from the centre. Returns null when there are fewer than
   * five lines, and point: null when the convergence is not significant (|b1| below three times its standard error
   * or below 0.5 % of spacing change over the extent). */
  function vanishing(lines, centre, extent) {
    const L = lines.filter(Boolean);
    if (L.length < 5) return null;
    const reg = P => {
      const n = P.length;
      let sa = 0, sb = 0, saa = 0, sab = 0;
      P.forEach(l => { sa += l.a; sb += l.b; saa += l.a * l.a; sab += l.a * l.b; });
      const den = n * saa - sa * sa;
      if (den <= 0) return null;
      const b1 = (n * sab - sa * sb) / den, b0 = (sb - b1 * sa) / n;
      let ss = 0; P.forEach(l => { ss += (l.b - (b0 + b1 * l.a)) ** 2; });
      return { b0, b1, se: n > 2 ? Math.sqrt(ss / (n - 2) / (saa - sa * sa / n)) : Infinity, n };
    };
    const r = reg(L);
    if (!r) return null;
    // lanes bent by the gel itself (smears, a torn corner, contraction) are kept, not trimmed:
    // their scatter is what tells a real keystone (every lane converging alike) from a gel that
    // is simply distorted, which must come out as "not significant"
    const { b0, b1, se, n } = r;
    // spacing change over the extent: lines spaced s at the centre are spaced s (1 ± b1 extent / 2) at the ends
    const change = b1 * extent;
    if (Math.abs(change) < 0.005 || Math.abs(b1) < 3 * se) return { point: null, b0, b1, se, change, n };
    // the point: along the family's axis at centre - 1/b1, across it at -b0/b1
    return { point: { along: centre - 1 / b1, across: -b0 / b1 }, b0, b1, se, change, n };
  }

  /* The homography that makes the lane family vertical and the band family horizontal: V is the
   * lanes' vanishing point (x, y) or null (already parallel), U the band rows' (x, y) or null.
   * The line through U and V becomes the line at infinity; an affine part then turns the two
   * directions vertical and horizontal, keeps the centre c where it is and the scale there 1. */
  function keystoneH(V, U, c) {
    const Vh = V ? [V.x, V.y, 1] : [0, 1, 0], Uh = U ? [U.x, U.y, 1] : [1, 0, 0];
    if (!V && !U) return M3.I();
    // line at infinity l = U x V, scaled so l . c = 1 (the centre keeps w = 1)
    let l = [Uh[1] * Vh[2] - Uh[2] * Vh[1], Uh[2] * Vh[0] - Uh[0] * Vh[2], Uh[0] * Vh[1] - Uh[1] * Vh[0]];
    const lc = l[0] * c.x + l[1] * c.y + l[2];
    if (Math.abs(lc) < 1e-12) return M3.I();
    l = l.map(v => v / lc);
    const Hp = [1, 0, 0, 0, 1, 0, l[0], l[1], l[2]];
    // directions after Hp (points at infinity): columns of D
    const dir = P => { const r = [Hp[0] * P[0] + Hp[1] * P[1] + Hp[2] * P[2], Hp[3] * P[0] + Hp[4] * P[1] + Hp[5] * P[2]]; const n = Math.hypot(r[0], r[1]) || 1; return [r[0] / n, r[1] / n]; };
    let dv = dir(Vh), du = dir(Uh);
    if (dv[1] < 0) dv = [-dv[0], -dv[1]];
    if (du[0] < 0) du = [-du[0], -du[1]];
    // A maps du -> (1, 0) and dv -> (0, 1): A = inverse of [du dv]
    const det = du[0] * dv[1] - dv[0] * du[1];
    if (Math.abs(det) < 1e-6) return M3.I();
    const A = [dv[1] / det, -dv[0] / det, 0, -du[1] / det, du[0] / det, 0, 0, 0, 1];
    let H = M3.mul(A, Hp);
    // unit scale at the centre: the Jacobian's determinant there becomes 1
    const e = 1e-3, p0 = M3.apply(H, c.x, c.y), px = M3.apply(H, c.x + e, c.y), py = M3.apply(H, c.x, c.y + e);
    const J = ((px.x - p0.x) * (py.y - p0.y) - (py.x - p0.x) * (px.y - p0.y)) / (e * e);
    const sc = 1 / Math.sqrt(Math.abs(J) || 1);
    H = M3.mul([sc, 0, 0, 0, sc, 0, 0, 0, 1], H);
    const q = M3.apply(H, c.x, c.y);
    return M3.mul([1, 0, c.x - q.x, 0, 1, c.y - q.y, 0, 0, 1], H);
  }

  // how much the correction does, for the legend and the panel: the change of horizontal spacing
  // between the top and the bottom of the crop and of vertical spacing between its left and right
  function keystoneReport(H, crop) {
    const e = 1, sx = y => { const a = M3.apply(H, crop.x + crop.w / 2, y), b = M3.apply(H, crop.x + crop.w / 2 + e, y); return Math.hypot(b.x - a.x, b.y - a.y); };
    const sy = x => { const a = M3.apply(H, x, crop.y + crop.h / 2), b = M3.apply(H, x, crop.y + crop.h / 2 + e); return Math.hypot(b.x - a.x, b.y - a.y); };
    const top = sx(crop.y), bot = sx(crop.y + crop.h), left = sy(crop.x), right = sy(crop.x + crop.w);
    return { lanesPct: +((bot / top - 1) * 100).toFixed(1), bandsPct: +((right / left - 1) * 100).toFixed(1) };
  }

  /* ---------- displacement grid: the general geometry of a corrected image ----------
   * A grid of nx x ny nodes over the output canvas (W x H); node (i, j) holds the SOURCE
   * coordinate (in the rotated frame) of output point (i W/(nx-1), j H/(ny-1)). Between nodes the
   * source coordinate is bilinear. One grid holds a keystone (sampled from a homography), the
   * per-lane straightening (a smooth displacement field), or both composed; the image is
   * resampled once through it. {nx, ny, W, H, pts: [sx0, sy0, sx1, sy1, ...]} */
  const Grid = {
    identity(W, H, nx, ny) {
      nx = nx || 33; ny = ny || 33;
      const pts = new Array(nx * ny * 2);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { pts[(j * nx + i) * 2] = i * W / (nx - 1); pts[(j * nx + i) * 2 + 1] = j * H / (ny - 1); }
      return { nx, ny, W, H, pts };
    },
    // the source coordinate of output point (x, y)
    at(g, x, y) {
      const fx = clamp(x / g.W * (g.nx - 1), 0, g.nx - 1 - 1e-9), fy = clamp(y / g.H * (g.ny - 1), 0, g.ny - 1 - 1e-9);
      const i = fx | 0, j = fy | 0, tx = fx - i, ty = fy - j, p = g.pts, k = (j * g.nx + i) * 2, k2 = k + g.nx * 2;
      return {
        x: (p[k] * (1 - tx) + p[k + 2] * tx) * (1 - ty) + (p[k2] * (1 - tx) + p[k2 + 2] * tx) * ty,
        y: (p[k + 1] * (1 - tx) + p[k + 3] * tx) * (1 - ty) + (p[k2 + 1] * (1 - tx) + p[k2 + 3] * tx) * ty
      };
    },
    // the output point of source point (x, y): the inverse, by iteration (the displacements are
    // smooth and small compared with the node spacing, so a few steps converge)
    inv(g, x, y) {
      let qx = x, qy = y;
      for (let k = 0; k < 12; k++) {
        const s = Grid.at(g, qx, qy), ex = x - s.x, ey = y - s.y;
        qx += ex; qy += ey;
        if (Math.abs(ex) + Math.abs(ey) < 1e-3) break;
      }
      return { x: qx, y: qy };
    },
    // the grid of a homography H (source -> output): nodes hold H^-1(output)
    fromH(H, W, Hh, nx, ny) {
      const g = Grid.identity(W, Hh, nx, ny), inv = M3.inv(H);
      if (!inv) return g;
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const k = (j * g.nx + i) * 2, p = M3.apply(inv, g.pts[k], g.pts[k + 1]); g.pts[k] = p.x; g.pts[k + 1] = p.y; }
      return g;
    },
    // output -> source through g2 after g1: the grid of "g1 applied first, then g2" (g2's source frame is g1's output frame)
    compose(g1, g2) {
      const g = Grid.identity(g2.W, g2.H, g2.nx, g2.ny);
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const k = (j * g.nx + i) * 2, m = Grid.at(g2, g.pts[k], g.pts[k + 1]), p = Grid.at(g1, m.x, m.y); g.pts[k] = p.x; g.pts[k + 1] = p.y; }
      return g;
    },
    // the same geometry after the frame turned by the point map T (3 x 3): T . grid . T^-1
    conjugate(g, T) {
      const inv = M3.inv(T), out = Grid.identity(g.W, g.H, g.nx, g.ny);
      for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const k = (j * g.nx + i) * 2, q = M3.apply(inv, out.pts[k], out.pts[k + 1]), p = Grid.at(g, q.x, q.y), r = M3.apply(T, p.x, p.y); out.pts[k] = r.x; out.pts[k + 1] = r.y; }
      return out;
    },
    isIdentity(g) { for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const k = (j * g.nx + i) * 2; if (Math.abs(g.pts[k] - i * g.W / (g.nx - 1)) > 1e-6 || Math.abs(g.pts[k + 1] - j * g.H / (g.ny - 1)) > 1e-6) return false; } return true; },
    // the largest local scale change of the grid (max |d source / d output| - 1), a plausibility bound
    maxScale(g) {
      let mx = 0;
      for (let j = 0; j < g.ny; j++) for (let i = 1; i < g.nx; i++) { const k = (j * g.nx + i) * 2; mx = Math.max(mx, Math.abs(Math.hypot(g.pts[k] - g.pts[k - 2], g.pts[k + 1] - g.pts[k - 1]) / (g.W / (g.nx - 1)) - 1)); }
      for (let j = 1; j < g.ny; j++) for (let i = 0; i < g.nx; i++) { const k = (j * g.nx + i) * 2, k0 = ((j - 1) * g.nx + i) * 2; mx = Math.max(mx, Math.abs(Math.hypot(g.pts[k] - g.pts[k0], g.pts[k + 1] - g.pts[k0 + 1]) / (g.H / (g.ny - 1)) - 1)); }
      return mx;
    }
  };

  // Resample img through the grid g (output -> source in the frame of img) composed with the
  // point map M (that frame -> img's own frame, e.g. the inverse rotation), bilinear, edges clamped
  function warpGrid(img, g, M) {
    const { w, h, data } = img, out = new Float32Array(w * h);
    const useM = M && !M3.isIdentity(M);
    // inside one grid cell the source coordinate is bilinear in (x, y), so along a row it is linear
    // in x; when M is affine (a rotation) so is the composition: the row is stepped cell by cell
    // from two evaluations instead of one object per pixel
    const affine = !useM || (Math.abs(M[6]) < 1e-12 && Math.abs(M[7]) < 1e-12 && Math.abs(M[8] - 1) < 1e-9);
    const map = (x, y) => { let s = Grid.at(g, x, y); if (useM) s = M3.apply(M, s.x, s.y); return s; };
    const cw = g.W / (g.nx - 1);
    const sample = (o, sx, sy) => {
      sx = clamp(sx, 0, w - 1.001); sy = clamp(sy, 0, h - 1.001);
      const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, k = y0 * w + x0;
      out[o] = (data[k] * (1 - fx) + data[k + 1] * fx) * (1 - fy) + (data[k + w] * (1 - fx) + data[k + w + 1] * fx) * fy;
    };
    for (let y = 0; y < h; y++) {
      const row = y * w;
      if (!affine) { for (let x = 0; x < w; x++) { const s = map(x, y); sample(row + x, s.x, s.y); } continue; }
      for (let i = 0; i < g.nx - 1; i++) {
        const xa = Math.ceil(i * cw - 1e-9), xb = Math.min(w - 1, Math.ceil((i + 1) * cw - 1e-9) - 1);
        if (xb < xa) continue;
        const sa = map(xa, y), sb = xb > xa ? map(xb, y) : sa, nn = xb - xa;
        const dsx = nn ? (sb.x - sa.x) / nn : 0, dsy = nn ? (sb.y - sa.y) / nn : 0;
        let sx = sa.x, sy = sa.y;
        for (let x = xa; x <= xb; x++, sx += dsx, sy += dsy) sample(row + x, sx, sy);
      }
    }
    return { w, h, data: out };
  }

  /* The slab's four corners from the gel outline: on a small copy the image is split at the level
   * half-way between the gel (around `inside`, the crop centre) and the background (the frame's
   * border ring; inside.win = {x0, x1, y0, y1} limits the search to a window around the crop); the connected region that holds `inside` is the gel,
   * and its left, right, top and bottom boundary points are fitted with robust lines (the
   * quarter of the points farthest from a first fit dropped: torn corners and comb teeth do
   * not bend them). Returns [TL, TR, BR, BL] in full-resolution pixels, or null when the gel
   * fills the frame (nothing to find), the region is tiny, or the quad is not convex. */
  function slabQuad(img, inside) {
    const sm = downsample(img, 500), f = sm.f || 1, { w, h, data } = sm;
    // the gel's level (median around `inside`) against the background's (median of the frame's
    // border ring): bands are outliers to both medians. Otsu on the whole histogram would split
    // bands from everything else instead.
    const med = arr => { const a = Float32Array.from(arr).sort(); return a.length ? a[a.length >> 1] : 0; };
    const cx = clamp(Math.round(inside.x / f), 0, w - 1), cy = clamp(Math.round(inside.y / f), 0, h - 1);
    const ring = Math.max(2, Math.round(Math.min(w, h) * 0.04)), border = [], core = [];
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) { if (x < ring || y < ring || x >= w - ring || y >= h - ring) border.push(data[y * w + x]); }
    const r = Math.max(4, Math.round(Math.min(w, h) * 0.12));
    for (let y = Math.max(0, cy - r); y < Math.min(h, cy + r); y++) for (let x = Math.max(0, cx - r); x < Math.min(w, cx + r); x++) core.push(data[y * w + x]);
    const bg = med(border), gel = med(core);
    if (Math.abs(gel - bg) < 0.015) return null;   // no visible slab: the gel fills the frame
    // nearer the gel's level than the background's: stains and shadows around a photographed gel
    // sit between the two, and the slab's interior must not leak into them
    // (with a strong contrast, as in a photograph on a tray; a faint slab on a scanner or an imager
    // has nothing between it and the background, and the midpoint is the safer cut)
    const t = gel + (bg - gel) * (Math.abs(bg - gel) > 0.1 ? 0.35 : 0.5), gelClass = gel > bg;
    // the region holding the centre (flood fill), after a light closing so a lane does not split it
    // only within a window around the crop (the slab holds the crop; nothing of it is far outside)
    const win = inside.win ? { x0: clamp(Math.round(inside.win.x0 / f), 0, w - 1), x1: clamp(Math.round(inside.win.x1 / f), 0, w - 1), y0: clamp(Math.round(inside.win.y0 / f), 0, h - 1), y1: clamp(Math.round(inside.win.y1 / f), 0, h - 1) } : { x0: 0, x1: w - 1, y0: 0, y1: h - 1 };
    const cls = new Uint8Array(w * h);
    for (let y = win.y0; y <= win.y1; y++) for (let x = win.x0; x <= win.x1; x++) { const i = y * w + x; cls[i] = (data[i] > t) === gelClass ? 1 : 0; }
    // an opening (erode, dilate; square, ~2 % of the frame) cuts the thin tails that tie the slab
    // to stains and shadows around it, and the comb teeth left on the top edge
    const ro = Math.max(2, Math.round(Math.min(w, h) * 0.02));
    const morph = (src, isMax) => {
      const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) { const row = slide(Float32Array.from(src.subarray(y * w, y * w + w)), ro, isMax); for (let x = 0; x < w; x++) tmp[y * w + x] = row[x]; }
      const col = new Float32Array(h);
      for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) col[y] = tmp[y * w + x]; const r2 = slide(col, ro, isMax); for (let y = 0; y < h; y++) out[y * w + x] = r2[y]; }
      return out;
    };
    const opened = morph(morph(cls, false), true);
    for (let i = 0; i < cls.length; i++) cls[i] = opened[i];
    const reg = new Uint8Array(w * h), stack = [cy * w + cx];
    if (!cls[stack[0]]) return null;
    reg[stack[0]] = 1;
    let n = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    while (stack.length) {
      const i = stack.pop(), x = i % w, y = (i / w) | 0; n++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && cls[i - 1] && !reg[i - 1]) { reg[i - 1] = 1; stack.push(i - 1); }
      if (x < w - 1 && cls[i + 1] && !reg[i + 1]) { reg[i + 1] = 1; stack.push(i + 1); }
      if (y > 0 && cls[i - w] && !reg[i - w]) { reg[i - w] = 1; stack.push(i - w); }
      if (y < h - 1 && cls[i + w] && !reg[i + w]) { reg[i + w] = 1; stack.push(i + w); }
    }
    if (n < w * h * 0.05) return null;
    if ((maxX - minX) >= w * 0.97 && (maxY - minY) >= h * 0.97) return null;   // the gel fills the frame
    // boundary points: per row the first / last region pixel, per column the top / bottom one
    // boundary points, from the rows / columns where the region is at least half as wide / tall as
    // at its widest (a torn strip or the comb teeth do not define an edge)
    const L = [], R = [], T = [], B = [], rowExt = [], colExt = [];
    for (let y = minY; y <= maxY; y++) { let a = -1, b = -1; for (let x = minX; x <= maxX; x++) if (reg[y * w + x]) { if (a < 0) a = x; b = x; } rowExt.push([y, a, b]); }
    for (let x = minX; x <= maxX; x++) { let a = -1, b = -1; for (let y = minY; y <= maxY; y++) if (reg[y * w + x]) { if (a < 0) a = y; b = y; } colExt.push([x, a, b]); }
    const maxRow = Math.max(...rowExt.map(([, a, b]) => (a >= 0 ? b - a : 0))), maxCol = Math.max(...colExt.map(([, a, b]) => (a >= 0 ? b - a : 0)));
    // and only from the middle 60 % of the region's height / width: a slab's edges are straight, so
    // the corners follow by extrapolation, while the ends (torn corners, teeth, shading) do not count
    const y0 = minY + (maxY - minY) * 0.2, y1 = maxY - (maxY - minY) * 0.2, x0 = minX + (maxX - minX) * 0.2, x1 = maxX - (maxX - minX) * 0.2;
    rowExt.forEach(([y, a, b]) => { if (a >= 0 && b - a >= maxRow * 0.5 && y >= y0 && y <= y1) { L.push([a, y]); R.push([b, y]); } });
    colExt.forEach(([x, a, b]) => { if (a >= 0 && b - a >= maxCol * 0.5 && x >= x0 && x <= x1) { T.push([x, a]); B.push([x, b]); } });
    // robust line x = a + b y (for L, R) or y = a + b x (for T, B): fit, drop the farthest quarter, fit
    const fitLine = (pts, swap) => {
      const P = swap ? pts.map(([x, y]) => [y, x]) : pts;   // fit v = a + b u with u = pts[.][1]
      const lsq = Q => { let n = Q.length, su = 0, sv = 0, suu = 0, suv = 0; Q.forEach(([v, u]) => { su += u; sv += v; suu += u * u; suv += u * v; }); const den = n * suu - su * su; if (den <= 0) return null; const b = (n * suv - su * sv) / den; return { a: (sv - b * su) / n, b }; };
      // Q entries are [v, u]
      const Q = P.map(([v, u]) => [v, u]);
      let l = lsq(Q); if (!l) return null;
      const keep = Q.slice().sort((p, q) => Math.abs(p[0] - (l.a + l.b * p[1])) - Math.abs(q[0] - (l.a + l.b * q[1]))).slice(0, Math.max(4, Math.ceil(Q.length * 0.75)));
      return lsq(keep) || l;
    };
    // L / R: x = a + b y (v = x, u = y); T / B: y = a + b x (v = y, u = x)
    const lL = fitLine(L.map(([x, y]) => [x, y])), lR = fitLine(R.map(([x, y]) => [x, y])), lT = fitLine(T.map(([x, y]) => [y, x])), lB = fitLine(B.map(([x, y]) => [y, x]));
    slabQuad.debug = { f, w, h, bg, gel, n, box: [minX, maxX, minY, maxY], nL: L.length, nT: T.length, lL, lR, lT, lB, L0: L.slice(0, 3), Lend: L.slice(-3) };
    if (!lL || !lR || !lT || !lB) return null;
    // intersection of x = a1 + b1 y and y = a2 + b2 x
    const meet = (lx, ly) => { const y = (ly.a + ly.b * lx.a) / (1 - ly.b * lx.b), x = lx.a + lx.b * y; return [x * f, y * f]; };
    const q = [meet(lL, lT), meet(lR, lT), meet(lR, lB), meet(lL, lB)];
    // convex, with a sensible size
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const signs = [0, 1, 2, 3].map(i => Math.sign(cross(q[i], q[(i + 1) % 4], q[(i + 2) % 4])));
    if (!signs.every(v => v === signs[0]) || signs[0] === 0) return null;
    return q;
  }

  /* The homography that sends a quadrilateral (TL, TR, BR, BL, source) to the rectangle of the
   * same centre whose width and height are the means of the quad's opposite sides (DLT, 4 points). */
  function homographyFromQuad(q) {
    const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4;
    const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2, h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
    const r = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]];
    // solve the 8 x 8 system A h = b for h = [h11 h12 h13 h21 h22 h23 h31 h32], h33 = 1
    const A = [], b = [];
    for (let k = 0; k < 4; k++) {
      const [x, y] = q[k], [u, v] = r[k];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const n = 8;
    for (let c = 0; c < n; c++) {
      let piv = c; for (let rr = c + 1; rr < n; rr++) if (Math.abs(A[rr][c]) > Math.abs(A[piv][c])) piv = rr;
      [A[c], A[piv]] = [A[piv], A[c]]; [b[c], b[piv]] = [b[piv], b[c]];
      if (Math.abs(A[c][c]) < 1e-12) return null;
      for (let rr = 0; rr < n; rr++) if (rr !== c) { const f = A[rr][c] / A[c][c]; for (let cc = c; cc < n; cc++) A[rr][cc] -= f * A[c][cc]; b[rr] -= f * b[c]; }
    }
    const hh = b.map((v, i) => v / A[i][i]);
    return [hh[0], hh[1], hh[2], hh[3], hh[4], hh[5], hh[6], hh[7], 1];
  }

  /* Lane traces: the path of every lane down the crop as a chain of bands (trackLane: the best
   * chain of band candidates under a keep-your-direction prior), lightly smoothed and joined by
   * straight segments, held beyond the first and last band. Lanes with fewer than 4 bands or a
   * jittery chain give null. */
  function laneTraces(img, bright, crop, laneXs, pitch, nBands, yMin) {
    nBands = nBands || 16;
    const yc = crop.y + crop.h / 2, rows = laneRows(img, bright, crop, nBands, yMin);
    const sg = signal(cropImg(img, crop), bright);
    return laneXs.map(x0 => {
      let pts = trackLane(rows, x0, crop, pitch, 0.4).sort((p, q) => p.y - q.y);
      if (pts.length < 4) return null;
      // the trace follows the chain: each point replaced by the weighted mean of itself and its two
      // neighbours (a band's centroid jitters, the lane does not), joined by straight segments and
      // held beyond the first and last band. A point further than 0.2 pitch from the smoothed chain
      // is a wrong band and is dropped once.
      // five-point weighted mean (1 2 3 2 1, times the band's strength), applied twice: it follows a
      // lean and a gradual bend but not the jitter of single centroids, so a straight lane measures
      // straight and is not "straightened" on noise
      const smooth1 = P => P.map((p, k) => { let sw = 0, sx = 0; [[-2, 1], [-1, 2], [0, 3], [1, 2], [2, 1]].forEach(([d, g]) => { const q = P[k + d]; if (q) { sw += g * q.w; sx += g * q.w * q.x; } }); return { y: p.y, x: sw > 0 ? sx / sw : p.x, w: p.w }; });
      const smooth = P => smooth1(smooth1(P));
      let sm = smooth(pts);
      const dev = pts.map((p, k) => Math.abs(p.x - sm[k].x));
      if (Math.max(...dev) > pitch * 0.2) { const kw = dev.indexOf(Math.max(...dev)); pts = pts.filter((p, k) => k !== kw); if (pts.length < 4) return null; sm = smooth(pts); }
      let res = 0; pts.forEach((p, k) => { res = Math.max(res, Math.abs(p.x - sm[k].x)); });
      if (res > pitch * 0.15) return null;
      const at = y => {
        if (y <= sm[0].y) return sm[0].x;
        if (y >= sm[sm.length - 1].y) return sm[sm.length - 1].x;
        let k = 0; while (k < sm.length - 2 && sm[k + 1].y < y) k++;
        const f = (y - sm[k].y) / (sm[k + 1].y - sm[k].y);
        return sm[k].x * (1 - f) + sm[k + 1].x * f;
      };
      const t0 = sm[0].y - yc, t1 = sm[sm.length - 1].y - yc, a = at(yc);
      const bw = bandWidths(sg, crop, pitch, at);
      let w0 = 0, w1 = 0, nb = bw.length;
      if (nb) { let W = 0, st = 0, se = 0, stt = 0, ste = 0; bw.forEach(p => { const t = p.y - yc; W += p.v; st += p.v * t; se += p.v * p.w; stt += p.v * t * t; ste += p.v * t * p.w; });
        w0 = W > 0 ? se / W : 0;
        const den = W * stt - st * st;
        if (nb >= 4 && den > 0 && w0 > 0) {
          const k1 = (W * ste - st * se) / den, k0 = (se - k1 * st) / W;
          let ss = 0; bw.forEach(p => { ss += p.v * (p.w - (k0 + k1 * (p.y - yc))) ** 2; });
          const scatter = Math.sqrt(ss / W);
          if (Math.abs(k1) * (t1 - t0) >= 0.15 * w0 && scatter < 0.35 * w0) { w0 = k0; w1 = k1; }
        } }
      const wAt = y => Math.max(w0 * 0.3, w0 + w1 * clamp(y - yc, t0, t1));
      // b: the mean lean (px per px of height) over the chain, for callers that want a slope
      const b = sm.length > 1 ? (sm[sm.length - 1].x - sm[0].x) / Math.max(1, sm[sm.length - 1].y - sm[0].y) : 0;
      return { a, b, c: 0, n: pts.length, res, y0: t0 + yc, y1: t1 + yc, w0, w1, nb, wTrend: w0 > 0 ? +(w1 * (t1 - t0) / w0).toFixed(3) : 0, at, wAt, chain: sm };
    });
  }

  // the clear bands of one lane (peaks of its profile along the trace) and the horizontal extent of
  // each: rows y ± 2 averaged, the extent above half the peak over the floor within ± 0.6 pitch.
  // sg is the signal of the crop; at(y) the lane's trace in image coordinates.
  function bandWidths(sg, crop, pitch, at) {
    const { w, h, data } = sg;
    const hw = Math.max(2, Math.round(pitch * 0.3));
    const prof = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      const cx = clamp(Math.round(at(y + crop.y) - crop.x), 0, w - 1), a = Math.max(0, cx - hw), b = Math.min(w - 1, cx + hw);
      let s = 0; for (let x = a; x <= b; x++) s += data[y * w + x];
      prof[y] = s / (b - a + 1);
    }
    const bands = detectBands(prof), vmax = Math.max(0, ...bands.map(p => p.v));
    const out = [], R = Math.round(pitch * 0.6);
    bands.filter(p => p.v >= vmax * 0.15).forEach(p => {
      const cx = clamp(Math.round(at(p.y + crop.y) - crop.x), 0, w - 1), a = Math.max(0, cx - R), b = Math.min(w - 1, cx + R);
      const row = new Float32Array(b - a + 1);
      for (let y = Math.max(0, p.y - 2); y <= Math.min(h - 1, p.y + 2); y++) for (let x = a; x <= b; x++) row[x - a] += data[y * w + x];
      let lo = Infinity, pk = 0; for (let x = 0; x < row.length; x++) lo = Math.min(lo, row[x]);
      for (let x = Math.max(0, cx - a - 3); x <= Math.min(row.length - 1, cx - a + 3); x++) pk = Math.max(pk, row[x]);
      if (pk <= lo) return;
      const th = lo + (pk - lo) * 0.5;
      let l = cx - a, r = cx - a; while (l > 0 && row[l - 1] >= th) l--; while (r < row.length - 1 && row[r + 1] >= th) r++;
      if (l > 0 && r < row.length - 1) out.push({ y: p.y + crop.y, w: r - l + 1, v: p.v });   // an extent reaching the window's edge is a smear, not a band
    });
    return out;
  }

  /* The grid that straightens the lanes: every traced lane is moved to a vertical line at its
   * position in the middle of the crop; between lanes the shift is interpolated linearly in x,
   * beyond the outermost lanes it is held; above and below the crop it fades to zero over half
   * the crop height (or sooner, within band {y0, y1} when the gel has several rows of wells).
   * rows: optional ladder band rows [{at: x => y, yc}] (the same for y, from the markers only).
   * Returns {grid, maxShift}. */
  function straightenGrid(W, H, crop, traces, rows, nx, ny, band) {
    if (straightenGrid.useWidths == null) straightenGrid.useWidths = false;
    const g = Grid.identity(W, H, nx, ny), yc = crop.y + crop.h / 2, xc = crop.x + crop.w / 2;
    const T = traces.filter(Boolean).sort((p, q) => p.a - q.a);
    // every lane as its two edges (centre ∓ half its width), each pulled to a vertical line at its
    // mean position, so a lane that widens down the gel (a stretched corner) is narrowed back as well
    // as shifted; a trace without a width is its centre twice
    // A width trend is only believed when a neighbouring lane shows one of the same sign and at
    // least a third as strong: a stretched region of the gel widens adjacent lanes alike, while an
    // overloaded band that bleeds sideways widens one lane only.
    // The width trends are measured and reported (straightenGrid.widthLanes), but only applied to
    // the pixels with straightenGrid.useWidths: on the sanity-check photograph they did not respond
    // to their own correction (a lane measured as widening by 100 % was still measured so after
    // being narrowed), which means the extent of a smeared, lane-wide band is what was measured,
    // not a stretch of the gel; moving pixels on such a measure would distort data.
    const coherent = k => { const t = T[k], tr = t.wTrend || 0; if (!tr) return false; return [T[k - 1], T[k + 1]].some(u => u && u.wTrend && Math.sign(u.wTrend) === Math.sign(tr) && Math.abs(u.wTrend) >= Math.abs(tr) / 3); };
    const Ed = [];
    T.forEach((t, k) => { const hw = (t.w0 || 0) / 2, wAt = t.wAt && straightenGrid.useWidths && coherent(k) ? t.wAt : (() => t.w0 || 0); Ed.push({ x0: t.a - hw, at: y => t.at(y) - wAt(y) / 2 }); Ed.push({ x0: t.a + hw, at: y => t.at(y) + wAt(y) / 2 }); });
    straightenGrid.widthLanes = T.filter((t, k) => t.wAt && coherent(k)).map(t => ({ x: Math.round(t.a), trend: t.wTrend }));
    Ed.sort((p, q) => p.x0 - q.x0);
    const R = (rows || []).filter(Boolean).sort((p, q) => p.yc - q.yc);
    // band {y0, y1}: the rows of the image this crop may use (a gel with several rows of wells: its
    // own row and the space up to its neighbours); the fade then ends there, so the correction of
    // one row never reaches into the next
    const spanUp = band ? Math.max(1, Math.min(crop.h / 2, crop.y - band.y0)) : crop.h / 2;
    const spanDown = band ? Math.max(1, Math.min(crop.h / 2, band.y1 - crop.y - crop.h)) : crop.h / 2;
    const fadeY = y => { if (y < crop.y) return Math.max(0, 1 - (crop.y - y) / spanUp); if (y > crop.y + crop.h) return Math.max(0, 1 - (y - crop.y - crop.h) / spanDown); return 1; };
    const fadeX = x => { const d = Math.max(0, Math.max(crop.x - x, x - crop.x - crop.w)); return Math.max(0, 1 - d / (crop.w / 2)); };
    const dxAt = (x, y) => {
      if (!Ed.length) return 0;
      const sh = Ed.map(e => e.at(y) - e.x0);
      if (x <= Ed[0].x0) return sh[0];
      if (x >= Ed[Ed.length - 1].x0) return sh[sh.length - 1];
      let i = 0; while (i < Ed.length - 1 && Ed[i + 1].x0 < x) i++;
      const d = Ed[i + 1].x0 - Ed[i].x0;
      if (d < 1e-6) return sh[i];
      const f = (x - Ed[i].x0) / d;
      return sh[i] * (1 - f) + sh[i + 1] * f;
    };
    // a vertical shift is capped at 0.3 of the local row spacing: a larger one would move a sample
    // band past its neighbouring ladder band, which no smile does
    const dyAt = (x, y) => {
      if (!R.length) return 0;
      const sh = R.map(r => r.at(x) - r.yc);
      let i = 0; while (i < R.length - 1 && R[i + 1].yc < y) i++;
      const sp = R.length > 1 ? Math.abs(R[Math.min(i + 1, R.length - 1)].yc - R[Math.max(0, Math.min(i, R.length - 2))].yc) : Infinity;
      const cap = v => Math.max(-0.3 * sp, Math.min(0.3 * sp, v));
      if (y <= R[0].yc) return cap(sh[0]);
      if (y >= R[R.length - 1].yc) return cap(sh[sh.length - 1]);
      const f = (y - R[i].yc) / (R[i + 1].yc - R[i].yc);
      return cap(sh[i] * (1 - f) + sh[i + 1] * f);
    };
    let maxShift = 0, maxDx = 0, maxDy = 0;
    for (let j = 0; j < g.ny; j++) for (let i = 0; i < g.nx; i++) {
      const k = (j * g.nx + i) * 2, x = g.pts[k], y = g.pts[k + 1];
      const dx = dxAt(x, y) * fadeY(y), dy = dyAt(x, y) * fadeX(x);
      maxDx = Math.max(maxDx, Math.abs(dx)); maxDy = Math.max(maxDy, Math.abs(dy));
      maxShift = Math.max(maxShift, Math.abs(dx), Math.abs(dy));
      g.pts[k] = x + dx; g.pts[k + 1] = y + dy;
    }
    // the field must not fold (a cell's source quadrilateral turned inside out) and must not scale any
    // cell inside the crop by more than a quarter: either would be a wrong trace, not a bend
    let folded = false, scaleMax = 0;
    const cw = g.W / (g.nx - 1), ch = g.H / (g.ny - 1);
    for (let j = 0; j < g.ny - 1; j++) for (let i = 0; i < g.nx - 1; i++) {
      const X = i * cw, Y = j * ch;
      if (X + cw < crop.x || X > crop.x + crop.w || Y + ch < crop.y || Y > crop.y + crop.h) continue;
      const k = (j * g.nx + i) * 2, kr = k + 2, kd = k + g.nx * 2;
      const ax = g.pts[kr] - g.pts[k], ay = g.pts[kr + 1] - g.pts[k + 1], bx = g.pts[kd] - g.pts[k], by = g.pts[kd + 1] - g.pts[k + 1];
      if (ax * by - ay * bx <= 0) folded = true;
      scaleMax = Math.max(scaleMax, Math.abs(Math.hypot(ax, ay) / cw - 1), Math.abs(Math.hypot(bx, by) / ch - 1));
    }
    return { grid: g, maxShift, maxDx, maxDy, folded, scaleMax, lanes: T.length, rows: R.length, xc, yc };
  }

  function cropImg(img, r) {
    const x0 = clamp(Math.round(r.x), 0, img.w - 1), y0 = clamp(Math.round(r.y), 0, img.h - 1);
    const w = clamp(Math.round(r.w), 1, img.w - x0), h = clamp(Math.round(r.h), 1, img.h - y0);
    const d = new Float32Array(w * h);
    for (let y = 0; y < h; y++) d.set(img.data.subarray((y0 + y) * img.w + x0, (y0 + y) * img.w + x0 + w), y * w);
    return { w, h, data: d, x0, y0 };
  }

  // ---------- intensity ----------
  // Bands bright on dark background (EtBr/SYBR, iBright default) or dark on light?
  function detectBright(img) {
    const [p05, p50, p995] = percentiles(img.data, [0.5, 50, 99.5], Math.max(1, (img.data.length / 400000) | 0));
    return (p995 - p50) >= (p50 - p05);
  }

  function autoLevels(img) {
    const [lo, hi] = percentiles(img.data, [0.05, 99.95], Math.max(1, (img.data.length / 1000000) | 0));
    return { black: lo, white: Math.max(hi, lo + 0.005) };
  }

  function saturation(img, satLevel) {
    let n = 0;
    for (let i = 0; i < img.data.length; i++) if (img.data[i] >= satLevel) n++;
    return n;
  }

  // Map to 8-bit grayscale RGBA. levels in raw domain; gamma applied after linear stretch.
  function toImageData(img, lv, out) {
    const n = img.w * img.h;
    const id = out || new ImageData(img.w, img.h);
    const px = id.data, lut = new Uint8ClampedArray(4096);
    for (let i = 0; i < 4096; i++) {
      let t = i / 4095;
      if (lv.gamma && lv.gamma !== 1) t = Math.pow(t, 1 / lv.gamma);
      if (lv.invert) t = 1 - t;
      lut[i] = Math.round(t * 255);
    }
    const lo = lv.black, sc = 4095 / Math.max(1e-6, lv.white - lv.black);
    for (let i = 0; i < n; i++) {
      let k = ((img.data[i] - lo) * sc) | 0;
      k = k < 0 ? 0 : k > 4095 ? 4095 : k;
      const v = lut[k], j = i * 4;
      px[j] = px[j + 1] = px[j + 2] = v; px[j + 3] = 255;
    }
    return id;
  }

  function signal(img, bright) {
    if (bright) return img;
    const d = new Float32Array(img.data.length);
    for (let i = 0; i < d.length; i++) d[i] = 1 - img.data[i];
    return { w: img.w, h: img.h, data: d };
  }

  // ---------- auto deskew ----------
  function deskew(img, bright) {
    const sm = signal(downsample(img, 800), bright);
    const { w, h, data } = sm, cx = (w - 1) / 2, cy = (h - 1) / 2;
    const med = percentiles(data, [50])[0];
    const sig = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) sig[i] = Math.max(0, data[i] - med);
    // sharpness of row/column projections after rotating by deg (bilinear sampling)
    const score = (deg) => {
      const a = -deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
      const col = new Float32Array(w), row = new Float32Array(h);
      for (let y = 0; y < h; y++) {
        const dy = y - cy;
        for (let x = 0; x < w; x++) {
          const dx = x - cx;
          const sx = c * dx - s * dy + cx, sy = s * dx + c * dy + cy;
          if (sx < 0 || sy < 0 || sx >= w - 1 || sy >= h - 1) continue;
          const x0 = sx | 0, y0 = sy | 0, fx = sx - x0, fy = sy - y0, i = y0 * w + x0;
          const v = (sig[i] * (1 - fx) + sig[i + 1] * fx) * (1 - fy) + (sig[i + w] * (1 - fx) + sig[i + w + 1] * fx) * fy;
          col[x] += v; row[y] += v;
        }
      }
      let e = 0;
      for (let i = 1; i < w; i++) e += (col[i] - col[i - 1]) ** 2 / h;
      for (let i = 1; i < h; i++) e += (row[i] - row[i - 1]) ** 2 / w;
      return e;
    };
    const search = (lo, hi, step) => {
      let best = lo, bestS = -1;
      const S = new Map();
      for (let d = lo; d <= hi + 1e-6; d += step) { const v = score(d); S.set(Math.round(d * 1000), v); if (v > bestS) { bestS = v; best = d; } }
      return { best, S };
    };
    // the correction that maximises projection sharpness is what rotate() needs
    let r = search(-15, 15, 1);
    r = search(r.best - 1, r.best + 1, 0.1);
    // parabolic sub-step refinement
    const b = r.best, s0 = r.S.get(Math.round((b - 0.1) * 1000)), s1 = r.S.get(Math.round(b * 1000)), s2 = r.S.get(Math.round((b + 0.1) * 1000));
    let best = b;
    if (s0 != null && s2 != null) { const den = s0 - 2 * s1 + s2; if (den < 0) best = b + 0.1 * 0.5 * (s0 - s2) / den; }
    return Math.round(best * 10) / 10;
  }

  // ---------- auto crop: find region containing bands / wells ----------
  // band: optional {y0, y1} (full-resolution rows) that the crop must stay inside: one row of wells on
  // a gel that carries several
  // The working image is the photograph brought to about 700 px across: every filter size and
  // threshold below is a fraction of that width, so the routine sees every gel at one scale and the
  // box is mapped back to full-resolution pixels exactly (a box edge is set to the nearest working
  // pixel, 2-3 image pixels on a phone photograph). Drawing the box again at a finer scale, or on
  // the region around the first box, was tried and reverted: the filters then changed their size
  // relative to the gel and cut faint lanes and short gels. A gel that fills a small part of a large
  // photograph is better cropped by hand (or photographed closer).
  /* The red box, coarse to fine. The first pass looks at the whole frame brought to about 700 px
   * across, and every filter in it is a fraction of the frame: the gel's own scale when the gel
   * fills the frame. A gel photographed small in a large frame (a phone photograph with the tray
   * around it) is then a hundred or two pixels wide with its lanes a few pixels apart, and the
   * filters see the tray's texture rather than the bands: the box lands on the wrong rows, or far
   * too wide. So when the box found is small against the frame, the analysis is run again on the
   * window around that box (half the box's larger side beyond it on every side), where the frame
   * is the gel's neighbourhood and every filter is at the gel's scale; and again while the window
   * still moves (a box pressed against the window's edge widens it there). A pass is kept only
   * when its box overlaps the one it refines; a gel that fills its frame takes one pass. */
  function autoCrop(img, bright, band) {
    let r = autoCropAt(img, bright, band, 700);
    const passes = [{ f: autoCrop.debug ? autoCrop.debug.f : 1, rect: r }];
    let meta = autoCrop.meta, rows = autoCrop.rows, debug = autoCrop.debug, last = null;
    for (let pass = 0; pass < 3; pass++) {
      if (r.w >= img.w - 1 && r.h >= img.h - 1) break;
      const m = 0.5 * Math.max(r.w, r.h);
      let win = { x0: Math.max(0, Math.round(r.x - m)), y0: Math.max(0, Math.round(r.y - m)), x1: Math.min(img.w, Math.round(r.x + r.w + m)), y1: Math.min(img.h, Math.round(r.y + r.h + m)) };
      let ww = win.x1 - win.x0, wh = win.y1 - win.y0, inner = false;
      if (ww >= img.w * 0.8 && wh >= img.h * 0.8) {
        // the frame is the gel's neighbourhood already; but a large box may be a light box or a
        // tray with the gel inside it: one pass inside the box, kept only when it finds something
        // much smaller (a gel that fills its frame finds itself again and keeps the first box)
        if (r.w < img.w * 0.6 || pass) break;
        const mx = r.w * 0.1, my = r.h * 0.1;
        win = { x0: Math.max(0, Math.round(r.x - mx)), y0: Math.max(0, Math.round(r.y - my)), x1: Math.min(img.w, Math.round(r.x + r.w + mx)), y1: Math.min(img.h, Math.round(r.y + r.h + my)) };
        ww = win.x1 - win.x0; wh = win.y1 - win.y0; inner = true;
      }
      if (last && Math.abs(win.x0 - last.x0) < ww * 0.05 && Math.abs(win.x1 - last.x1) < ww * 0.05 && Math.abs(win.y0 - last.y0) < wh * 0.05 && Math.abs(win.y1 - last.y1) < wh * 0.05) break;
      last = win;
      const sub = cropImg(img, { x: win.x0, y: win.y0, w: ww, h: wh });
      const r2 = autoCropAt(sub, bright, band ? { y0: band.y0 - win.y0, y1: band.y1 - win.y0 } : undefined, 700);
      if (r2.w >= sub.w - 1 && r2.h >= sub.h - 1) break;   // nothing found in the window: keep the box
      r2.x += win.x0; r2.y += win.y0;
      const ix = Math.min(r.x + r.w, r2.x + r2.w) - Math.max(r.x, r2.x), iy = Math.min(r.y + r.h, r2.y + r2.h) - Math.max(r.y, r2.y);
      const overlap = ix > 0 && iy > 0 ? ix * iy / Math.min(r.w * r.h, r2.w * r2.h) : 0;
      passes.push({ f: autoCrop.debug ? autoCrop.debug.f : 1, win, inner, rect: r2, overlap: +overlap.toFixed(2) });
      if (overlap < 0.3 || (inner && r2.w > r.w * 0.7)) break;
      r = r2;
      meta = autoCrop.meta; rows = autoCrop.rows; debug = autoCrop.debug;
      if (meta) { if (meta.wellY != null) meta.wellY += win.y0; meta.bandTop += win.y0; meta.bandBottom += win.y0; meta.contentX0 += win.x0; meta.contentX1 += win.x0; }
      if (rows) rows.forEach(q => { q.y0 += win.y0; q.y1 += win.y0; });
      if (debug) debug.win = win;
    }
    autoCrop.meta = meta; autoCrop.rows = rows; autoCrop.debug = debug; autoCrop.passes = passes;
    return r;
  }
  function autoCropAt(img, bright, band, maxDim) {
    const sm = signal(downsample(img, maxDim), bright);
    const { w, h, data, f } = Object.assign({ f: 1 }, sm, { f: Math.max(1, Math.ceil(Math.max(img.w, img.h) / maxDim)) });
    // morphological top-hat (rows then columns) to remove gel/background gradient
    const r = Math.max(4, Math.round(Math.min(w, h) / 25));
    const open = new Float32Array(w * h);
    const tmp = new Float32Array(w * h);
    const line = new Float32Array(Math.max(w, h));
    for (let y = 0; y < h; y++) {
      const a = data.subarray(y * w, y * w + w);
      tmp.set(slide(a, r, false), y * w);
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) line[y] = tmp[y * w + x];
      const m = slide(slide(line.subarray(0, h), r, false), r, true);
      for (let y = 0; y < h; y++) open[y * w + x] = m[y];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) line[x] = open[y * w + x];
      const m = slide(line.subarray(0, w), r, true);
      for (let x = 0; x < w; x++) tmp[y * w + x] = Math.max(0, data[y * w + x] - m[x]);
    }
    // ignore a thin frame at the image border (tray edges, vignetting artefacts)
    const bx = Math.round(w * 0.01), by = Math.round(h * 0.01);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < bx || y < by || x >= w - bx || y >= h - by) tmp[y * w + x] = 0;
    // remove long continuous horizontal structures (gel/tray edges, glare lines): bands never are,
    // because neighbouring lanes are separated by dark gaps
    const r2 = Math.max(4, Math.round(w / 25));
    for (let y = 0; y < h; y++) {
      const rowT = tmp.subarray(y * w, y * w + w);
      const o = slide(slide(rowT, r2, false), r2, true);
      for (let x = 0; x < w; x++) rowT[x] = Math.max(0, rowT[x] - o[x]);
    }
    // likewise long vertical structures (gel side edges) that run most of the image height
    const r3 = Math.max(8, Math.round(h * 0.3)), colT = new Float32Array(h);
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) colT[y] = tmp[y * w + x];
      const o = slide(slide(colT, r3, false), r3, true);
      for (let y = 0; y < h; y++) tmp[y * w + x] = Math.max(0, colT[y] - o[y]);
    }
    // soft maximum (mean of the top fraction) along a line; a lane with one bright band scores high,
    // faint wells, gel edges and isolated dust specks score low
    const topMean = (vals, frac) => {
      const k = Math.max(3, Math.round(vals.length * frac));
      const s = Float32Array.from(vals).sort();
      let t = 0; for (let i = s.length - k; i < s.length; i++) t += s[i];
      return t / k;
    };
    const colP = new Float32Array(w), colBuf = new Float32Array(h);
    for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) colBuf[y] = tmp[y * w + x]; colP[x] = topMean(colBuf, 0.01); }
    // runs above threshold; returns [{s,e,mass}]
    const runs = (prof, t, gap) => {
      const out = []; let cur = null, last = -1e9;
      for (let i = 0; i < prof.length; i++) if (prof[i] > t) {
        if (cur && i - last <= gap) { cur.e = i; cur.mass += prof[i]; } else { cur = { s: i, e: i, mass: prof[i] }; out.push(cur); }
        last = i;
      }
      return out;
    };
    // heaviest run, then absorb neighbours carrying real signal that are not too far away. Weak runs
    // in between never block the next real one; with farFrac, a strong run (>= 10 % of the heaviest)
    // is reached across a wider gap: on a protein gel a few faint lanes (wash, flow-through) must not
    // cut the marker and lysate lanes off the crop.
    const grow = (segs, n, gapFrac, spanFrac, minMassFrac, farFrac) => {
      if (!segs.length) return null;
      const total = segs.reduce((a, s) => a + s.mass, 0), heavy = Math.max(...segs.map(s => s.mass));
      const real = s => s.mass > total * minMassFrac;
      const reach = (s, gap, lim) => real(s) && (gap <= lim || (farFrac && s.mass >= heavy * 0.1 && gap <= n * farFrac));
      let lo = segs.reduce((bi, s, i) => (s.mass > segs[bi].mass ? i : bi), 0), hi = lo;
      for (let changed = true; changed;) {
        changed = false;
        const span = segs[hi].e - segs[lo].s + 1, lim = Math.max(n * gapFrac, span * spanFrac);
        let li = lo - 1; while (li >= 0 && !real(segs[li])) li--;
        let ri = hi + 1; while (ri < segs.length && !real(segs[ri])) ri++;
        if (li >= 0 && reach(segs[li], segs[lo].s - segs[li].e, lim)) { lo = li; changed = true; }
        if (ri < segs.length && reach(segs[ri], segs[ri].s - segs[hi].e, lim)) { hi = ri; changed = true; }
      }
      return { s: segs[lo].s, e: segs[hi].e, segs: segs.slice(lo, hi + 1).filter(real) };
    };
    const FULL = { x: 0, y: 0, w: img.w, h: img.h };
    // 5x5 box blur: dust specks (1-2 px) drop ~10x, bands and lanes keep their level
    {
      const rb = 2, t2 = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        let s = 0;
        for (let x = -rb; x <= rb; x++) s += tmp[y * w + clamp(x, 0, w - 1)];
        for (let x = 0; x < w; x++) {
          t2[y * w + x] = s / (2 * rb + 1);
          s += tmp[y * w + clamp(x + rb + 1, 0, w - 1)] - tmp[y * w + clamp(x - rb, 0, w - 1)];
        }
      }
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let y = -rb; y <= rb; y++) s += t2[clamp(y, 0, h - 1) * w + x];
        for (let y = 0; y < h; y++) {
          tmp[y * w + x] = s / (2 * rb + 1);
          s += t2[clamp(y + rb + 1, 0, h - 1) * w + x] - t2[clamp(y - rb, 0, h - 1) * w + x];
        }
      }
    }
    if (autoCrop.keepDebugImage) autoCrop.debugImg = { w, h, data: Float32Array.from(tmp) };
    const xRange = (prof, thrFrac) => {
      const cp = gaussSmooth(prof, 1), m = Math.max(...cp);
      if (m <= 0) return null;
      return grow(runs(cp, m * thrFrac, 1).filter(r => r.e - r.s >= 2), w, 0.12, 0.6, 0.01, 0.4);
    };
    // pass 1: columns over the whole height (strong signal only)
    const xr1 = xRange(colP, 0.35);
    if (!xr1) return FULL;
    // rows: soft max across those columns
    const rowP = new Float32Array(h), rowBuf = new Float32Array(xr1.e - xr1.s + 1);
    for (let y = 0; y < h; y++) { for (let x = xr1.s; x <= xr1.e; x++) rowBuf[x - xr1.s] = tmp[y * w + x]; rowP[y] = topMean(rowBuf, 0.03); }
    const rp0 = gaussSmooth(rowP, 1), rmx = Math.max(...rp0);
    /* Rows of wells: clusters of band signal down the gel. A light cluster right above a heavy one is
     * that row's well line and belongs to it. Reported in full-resolution rows for the caller. */
    {
      const all = runs(rp0, rmx * 0.08, 2), gap = Math.max(4, h * 0.05), cl = [];
      all.forEach(r => { const c = cl[cl.length - 1]; if (c && r.s - c.e <= gap) { c.e = r.e; c.mass += r.mass; } else cl.push({ s: r.s, e: r.e, mass: r.mass }); });
      // a light cluster (a well line, a lone small band) joins the nearer of its neighbours
      for (let changed = true; changed;) {
        changed = false;
        for (let i = 0; i < cl.length; i++) {
          const c = cl[i], p = cl[i - 1], n = cl[i + 1];
          const heavyNb = Math.max(p ? p.mass : 0, n ? n.mass : 0);
          if (c.mass >= 0.3 * heavyNb) continue;
          const gp = p ? c.s - p.e : Infinity, gn = n ? n.s - c.e : Infinity;
          const into = gp <= gn ? p : n, gap = Math.min(gp, gn);
          if (!into || gap > h * 0.12) continue;
          into.s = Math.min(into.s, c.s); into.e = Math.max(into.e, c.e); into.mass += c.mass; cl.splice(i, 1); changed = true; break;
        }
      }
      const heavy = Math.max(1e-9, ...cl.map(c => c.mass));
      autoCrop.rows = cl.filter(c => c.mass >= heavy * 0.15 && c.e - c.s >= h * 0.02).map(c => ({ y0: c.s * f, y1: (c.e + 1) * f }));
    }
    let rp = rp0;
    if (band) { rp = Float32Array.from(rp0); const b0 = Math.max(0, Math.floor(band.y0 / f)), b1 = Math.min(h - 1, Math.ceil(band.y1 / f)); for (let y = 0; y < h; y++) if (y < b0 || y > b1) rp[y] = 0; }
    const yr = grow(runs(rp, rmx * 0.08, 2), h, 0.05, 0.25, 0.004);
    if (!yr) return FULL;
    let y0 = yr.s;
    const y1 = yr.e, span = y1 - y0 + 1;
    // pass 2: columns restricted to the band rows (wells excluded) with a lower threshold, so lanes
    // holding a single faint band are kept
    const colP2 = new Float32Array(w), cb2 = new Float32Array(span);
    for (let x = 0; x < w; x++) { for (let y = y0; y <= y1; y++) cb2[y - y0] = tmp[y * w + x]; colP2[x] = topMean(cb2, 0.015); }
    const xr = xRange(colP2, 0.1) || xr1;
    const laneW = xr.segs.map(r => r.e - r.s + 1).sort((a, b) => a - b)[xr.segs.length >> 1];
    // pad by roughly the inter-lane gap, so neighbouring empty wells are not pulled in
    const gaps = [];
    for (let i = 1; i < xr.segs.length; i++) gaps.push(xr.segs[i].s - xr.segs[i - 1].e);
    const gapW = gaps.length ? gaps.sort((a, b) => a - b)[gaps.length >> 1] : laneW * 0.4;
    const padX = Math.round(Math.min(laneW * 0.5, Math.max(2, gapW * 0.8))) + 2;
    const X0 = clamp(xr.s - padX, 0, w - 1), X1 = clamp(xr.e + padX, 0, w - 1);
    // include the well row: nearest clear row-peak above the bands (never the gel edge beyond it)
    let padTop = Math.round(span * 0.04) + 2, well = null;
    const a = Math.max(band ? Math.floor(band.y0 / f) : 0, 0, Math.round(y0 - span * 0.6));
    if (y0 - a > 4) {
      const win = rp.slice(a, y0);
      const pk = findPeaks(win, 3, rmx * 0.015);
      if (pk.length) {
        const best = Math.max(...pk.map(p => p.prom));
        // the well row is the clear peak closest to the bands (the gel's top edge, further up, is often stronger)
        const cand = pk.filter(p => p.prom >= best * 0.15);
        const p = cand[cand.length - 1];
        // walk up to the half-prominence edge of the well peak
        let s = p.i; const half = p.v - p.prom / 2;
        while (s > 0 && win[s - 1] > half) s--;
        well = a + p.i;
        y0 = a + s;
        padTop = Math.max(2, Math.round(span * 0.02));
      }
    }
    const Y0 = clamp(y0 - padTop, 0, h - 1), Y1 = clamp(y1 + Math.round(span * 0.05) + 3, 0, h - 1);
    autoCrop.debug = { f, w, h, xsegs1: xr1.segs.map(r => [r.s, r.e]), xsegs: xr.segs.map(r => [r.s, r.e]), laneW, yr: [yr.s, yr.e], well };
    const rect = { x: X0 * f, y: Y0 * f, w: (X1 - X0 + 1) * f, h: (Y1 - Y0 + 1) * f };
    rect.w = Math.min(rect.w, img.w - rect.x); rect.h = Math.min(rect.h, img.h - rect.y);
    if (rect.w < img.w * 0.03 || rect.h < img.h * 0.05) return { x: 0, y: 0, w: img.w, h: img.h };
    // where things are, for the lane lattice (full-resolution pixels)
    autoCrop.meta = { wellY: well != null ? well * f : null, bandTop: yr.s * f, bandBottom: yr.e * f, contentX0: xr.s * f, contentX1: xr.e * f };
    return rect;
  }

  // ---------- lanes ----------
  function findPeaks(p, minDist, minProm) {
    const n = p.length, cand = [];
    // a saturated band is a plateau: its peak is the plateau's centre, not its first row
    for (let i = 1; i < n - 1; i++) {
      if (!(p[i] > p[i - 1])) continue;
      let j = i; while (j + 1 < n && p[j + 1] === p[i]) j++;
      if (j + 1 < n && p[j + 1] > p[i]) continue;
      cand.push((i + j) >> 1);
    }
    // prominence
    const out = [];
    for (const i of cand) {
      let l = p[i], r = p[i];
      for (let j = i - 1; j >= 0 && p[j] <= p[i]; j--) l = Math.min(l, p[j]);
      for (let j = i + 1; j < n && p[j] <= p[i]; j++) r = Math.min(r, p[j]);
      const prom = p[i] - Math.max(l, r);
      if (prom >= minProm) out.push({ i, v: p[i], prom });
    }
    out.sort((a, b) => b.prom - a.prom);
    const kept = [];
    for (const c of out) if (kept.every(k => Math.abs(k.i - c.i) >= minDist)) kept.push(c);
    return kept.sort((a, b) => a.i - b.i);
  }

  // Column profile of lane "presence": per-row top-hat (radius ~ a lane pitch of the reference
  // width), compressed with sqrt so faint lanes and wells count, then per column the mean of the
  // top ~3 % of rows (a lane with a single band counts as much as a full ladder) plus the 75th and
  // 50th percentiles (a lysate or Coomassie lane is stained along its whole length, and only
  // these see the narrow gap between two such lanes, which the strongest bands smear across)
  function presenceProfile(sig, refW) {
    const { w, h, data } = sig;
    const r = Math.max(3, Math.round((refW || w) / 12)), r2 = Math.max(1, Math.round((refW || w) / 80));
    const step = Math.max(1, (h / 500) | 0);
    const nr = Math.ceil(h / step);
    const th = new Float32Array(w * nr), row = new Float32Array(w);
    for (let y = 0, j = 0; y < h; y += step, j++) {
      for (let x = 0; x < w; x++) row[x] = data[y * w + x];
      // a small opening first: a band runs across its lane, so it survives; the slanted cut edge
      // of a gel, a fold, dust or a bubble is only a few pixels wide in a row and is removed
      const o = slide(slide(row, r2, false), r2, true);
      const b = slide(slide(o, r, false), r, true);
      for (let x = 0; x < w; x++) th[x * nr + j] = Math.sqrt(Math.max(0, o[x] - b[x]));
    }
    const k = Math.max(2, Math.round(nr * 0.03)), p = new Float32Array(w), band = new Float32Array(w);
    for (let x = 0; x < w; x++) {
      const col = th.subarray(x * nr, x * nr + nr).sort();
      let s = 0;
      for (let i = nr - k; i < nr; i++) s += col[i];
      p[x] = s / k + col[(nr * 0.75) | 0] + col[nr >> 1];
      band[x] = s / k - col[nr >> 1];
    }
    // .band: the top rows above the column's median, i.e. bands; a torn gel edge or a fold is
    // dark along its whole length and has none
    p.band = band;
    return p;
  }

  // width at half prominence of the feature nearest c (lanes and wells are wide, gel edges and
  // glare lines thin); P = lane pitch
  function featureWidth(pr, c, P) {
    const n = pr.length, a = clamp(Math.round(c - P * 0.3), 0, n - 1), b = clamp(Math.round(c + P * 0.3), 0, n - 1);
    let pk = a; for (let x = a; x <= b; x++) if (pr[x] > pr[pk]) pk = x;
    let lo = Infinity;
    for (let x = clamp(Math.round(c - P * 0.65), 0, n - 1); x <= clamp(Math.round(c + P * 0.65), 0, n - 1); x++) lo = Math.min(lo, pr[x]);
    const half = lo + (pr[pk] - lo) / 2;
    let l = pk, r = pk;
    while (l > 0 && pr[l - 1] > half && pk - l < P) l--;
    while (r < n - 1 && pr[r + 1] > half && r - pk < P) r++;
    return r - l;
  }

  /* Lane pitch by a comb fit: for every pitch p (and phase o) the sum of the profile at the comb
   * teeth minus the sum half-way between them, over the region [x0, x1) (the gel), minus a
   * penalty for every peak of the profile the comb does not explain (a tooth within 0.15 p). The
   * true pitch scores highest: twice the pitch puts teeth and gaps on lanes alike (~0), half the
   * pitch alternates (~0), and a pitch that fits only the strong lanes leaves the weak ones
   * between them unexplained. Unlike a pitch read from the gaps between found peaks, it does
   * not double when weak lanes next to strong ones are missed. */
  function combPitch(q, pMin, pMax, x0, x1, peaks, mx) {
    const w = q.length;
    x0 = clamp(Math.round(x0 == null ? 0 : x0), 0, w - 1); x1 = clamp(Math.round(x1 == null ? w : x1), x0 + 1, w);
    const pk = (peaks || []).filter(k => k.i >= x0 && k.i < x1).map(k => k.i);
    const lam = (mx || 1) * 0.3;
    let best = { p: 0, o: 0, s: -Infinity };
    const score = (p, o) => {
      let s = 0;
      for (let x = o; x < x1; x += p) {
        s += q[Math.round(x)];
        const m = x + p / 2;
        if (m < x1) s -= q[Math.round(m)];
      }
      let miss = 0;
      for (const i of pk) { const d = ((i - o) % p + p) % p; if (Math.min(d, p - d) > p * 0.2) miss++; }
      return s - lam * miss;
    };
    const tryP = (p, step) => {
      for (let o = x0; o < x0 + p; o += step) { const s = score(p, o); if (s > best.s) best = { p, o, s }; }
    };
    for (let p = Math.max(4, Math.round(pMin)); p <= pMax; p += 1) tryP(p, Math.max(1, p / 24));
    if (!best.p) return best;
    const p0 = best.p;
    for (let p = p0 - 1; p <= p0 + 1; p += 0.1) tryP(p, 0.5);
    return best;
  }

  /* Lane centres (crop coordinates) of one image: the comb pitch, then every tooth of the comb
   * between the first and the last one that carries a lane (a wide feature of the presence
   * profile), refined to the centroid of its signal; teeth without a lane keep the lattice
   * position (empty wells). refW: the width the parameters scale with — the crop width when the
   * image is a strip across the whole frame, so a gel photographed small in a large frame is
   * analysed at its own scale; region [x0, x1): where the pitch is measured (the crop), the comb
   * is then continued over the whole image. */
  function detectLanes(cropped, bright, refW, region) {
    const sig = signal(cropped, bright);
    const w = sig.w;
    const R0 = refW || w;
    let R = R0;
    const x0 = region ? region[0] : 0, x1 = region ? region[1] : w;
    // The presence profile's top-hat radius is R / 12: right for a gel of ten or more lanes. A strip
    // of two or three lanes has a pitch of a third of its width, and a top-hat that narrow cuts
    // the lanes themselves (a lane wider than its window is background to it; what is left are
    // the two shoulders of every lane, and the comb then reads their spacing as the pitch). So:
    // when the features the comb found are wider on the plain column mean than the top-hat
    // window, the profile is made again at a coarse scale (as if the crop held two lanes), and
    // the scale is then set from the pitch found, never finer than the crop's own, until the two
    // agree. A gel with ten or more lanes across the crop keeps its first profile.
    let raw, q, mx, band, peaks, comb, colMean = null, coarse = false;
    for (let round = 0; round < 4; round++) {
      raw = presenceProfile(sig, R);
      const q0 = gaussSmooth(raw, Math.max(1, R / 250));
      const bl = baseline(q0, Math.round(R / 8));
      q = new Float32Array(w);
      mx = 0;
      for (let i = 0; i < w; i++) { q[i] = Math.max(0, q0[i] - bl[i]); mx = Math.max(mx, q[i]); }
      band = gaussSmooth(raw.band, Math.max(1, R / 250));
      const bb = baseline(band, Math.round(R / 8));
      for (let i = 0; i < w; i++) band[i] = Math.max(0, band[i] - bb[i]);
      if (mx <= 0) return { centers: [], pitch: R / 10, profile: q, profileMax: 0, band };
      peaks = findPeaks(q, Math.max(3, R / 70), mx * 0.12);
      comb = combPitch(gaussSmooth(q, Math.max(1, R / 400)), R / 60, R / 2, x0, x1, peaks, mx);
      if (!comb.p) break;
      if (!coarse) {
        const r = Math.max(3, Math.round(R / 12));
        if (!colMean) {
          colMean = new Float32Array(w);
          const step = Math.max(1, (sig.h / 500) | 0); let n = 0;
          for (let y = 0; y < sig.h; y += step, n++) for (let x = 0; x < w; x++) colMean[x] += sig.data[y * w + x];
          for (let x = 0; x < w; x++) colMean[x] /= Math.max(1, n);
        }
        const widths = peaks.filter(k => k.i >= x0 && k.i < x1).map(k => featureWidth(colMean, k.i, 6 * r)).sort((p, q) => p - q);
        if (widths.length && widths[widths.length >> 1] > 1.6 * r) { coarse = true; R = 4.4 * R0; continue; }
      }
      const R2 = Math.max(R0, 9.6 * comb.p);
      if (Math.abs(R2 - R) < R * 0.1) break;
      R = R2;
    }
    detectLanes.debug = { peaks: peaks.map(k => [k.i, +(k.prom / mx).toFixed(2)]), pitch: comb.p, combScore: comb.s, refW: Math.round(R), coarse };
    if (!comb.p || peaks.length < 1) return { centers: peaks.map(k => k.i), pitch: comb.p || R / 10, profile: q, profileMax: mx, band };
    let P = comb.p, O = comb.o;
    // evidence at a tooth: a wide feature (a lane, not an edge line) with signal in the lane core
    const coreMean = (c, p) => {
      const a = clamp(Math.round(c - p * 0.25), 0, w - 1), b = clamp(Math.round(c + p * 0.25), 0, w - 1);
      let s = 0; for (let x = a; x <= b; x++) s += q[x];
      return s / (b - a + 1);
    };
    // the centroid of the lane's own feature: the run above half its prominence around the
    // strongest point near the tooth, so a neighbouring feature across a dip (the bright
    // background beyond the cut edge of a strip, a glare line) does not pull it
    const centroid = (c, p) => {
      const a = clamp(Math.round(c - p * 0.45), 0, w - 1), b = clamp(Math.round(c + p * 0.45), 0, w - 1);
      let lo = Infinity, pk = clamp(Math.round(c), a, b);
      for (let x = a; x <= b; x++) lo = Math.min(lo, q[x]);
      for (let x = clamp(Math.round(c - p * 0.3), a, b); x <= clamp(Math.round(c + p * 0.3), a, b); x++) if (q[x] > q[pk]) pk = x;
      const half = lo + (q[pk] - lo) / 2;
      let l = pk, r = pk;
      while (l > a && q[l - 1] > half) l--;
      while (r < b && q[r + 1] > half) r++;
      let sw = 0, sxw = 0;
      for (let x = l; x <= r; x++) { const v = q[x] - lo; sw += v; sxw += v * x; }
      let cx = sw > 0 ? sxw / sw : c;
      if (Math.abs(cx - c) > p * 0.25) cx = c;
      return cx;
    };
    const hasLane = (c, p) => coreMean(c, p) > mx * 0.06 && featureWidth(q, c, p) >= p * 0.28;
    // a comb at half the true pitch puts a tooth in every gap between lanes: its teeth then alternate
    // strong (a lane) and weak (a gap) along the whole crop. When one phase of alternate teeth is
    // clearly weaker than the other, the pitch is doubled and the comb kept on the strong phase.
    if (P * 2 <= R / 2) {
      const t = []; for (let x = O; x < Math.min(w, x1); x += P) if (x >= x0) t.push(coreMean(x, P));
      if (t.length >= 6) {
        let e = 0, o = 0, ne = 0, no = 0; t.forEach((v, k) => { if (k % 2) { o += v; no++; } else { e += v; ne++; } });
        e /= Math.max(1, ne); o /= Math.max(1, no);
        // ...and the weak teeth must be no lanes of their own (alternate loading, every second well empty
        // with a faint lane in it, keeps every tooth)
        const weakIdx = o > e ? 0 : 1; let empty = 0, nw = 0; t.forEach((v, k) => { if (k % 2 === weakIdx) { nw++; if (v < mx * 0.06) empty++; } });
        if (Math.min(e, o) < Math.max(e, o) * 0.55 && empty >= nw * 0.7) { if (o > e) O += P; P *= 2; detectLanes.debug.halfPitch = true; }
      }
    }
    // two passes: teeth with a lane give centroids, a least-squares lattice through them refines
    // pitch and phase (a comb fitted at 1 px drifts over many lanes), then the teeth are placed again
    for (let pass = 0; pass < 2; pass++) {
      const pts = [];
      for (let x = O; x < w; x += P) if (hasLane(x, P)) pts.push([Math.round((x - O) / P), centroid(x, P)]);
      if (pts.length < 2) break;
      let n = pts.length, sk = 0, sx = 0, skk = 0, skx = 0;
      pts.forEach(([k, x]) => { sk += k; sx += x; skk += k * k; skx += k * x; });
      const den = n * skk - sk * sk;
      if (den > 0) {
        const P2 = (n * skx - sk * sx) / den, O2 = (sx - P2 * sk) / n;
        if (Math.abs(P2 - P) < P * 0.15) { P = P2; O = O2; }
      }
    }
    // the comb's first tooth may sit far left of the gel: walk the teeth, keep those from the first
    // to the last with a lane; teeth between them without one are empty wells
    const teeth = [];
    for (let x = O - P * Math.ceil(O / P); x < w; x += P) if (x >= -P * 0.3) teeth.push(x);
    const flags = teeth.map(x => hasLane(x, P));
    let first = flags.indexOf(true), last = flags.lastIndexOf(true);
    if (first < 0) return { centers: peaks.map(k => k.i), pitch: P, profile: q, profileMax: mx, band };
    const centers = [];
    for (let k = first; k <= last; k++) {
      const c = teeth[k];
      centers.push(Math.round((flags[k] ? centroid(c, P) : c) * 10) / 10);
    }
    // lanes cut by the crop edge (only a sliver of a neighbouring empty well) are not real lanes
    while (centers.length > 1 && centers[0] < P * 0.3) centers.shift();
    while (centers.length > 1 && centers[centers.length - 1] > w - P * 0.3) centers.pop();
    return { centers, pitch: P, profile: q, profileMax: mx, band, hasLane: c => hasLane(c, P) };
  }

  /* Lane lattice over the WHOLE gel: every well gets a lane, numbered left to right like the
   * lab notebook. The crop then only chooses which lanes appear in the figure.
   * Evidence per lattice position = well signal (row of wells) or band signal; positions without
   * either (gel edges, glare) are trimmed, real wells beyond the detected range are added. */
  function detectLaneLattice(img, bright, crop, meta) {
    const bx = Math.round(img.w * 0.01);
    const strip = cropImg(img, { x: bx, y: crop.y, w: img.w - 2 * bx, h: crop.h });
    // the parameters scale with the crop (the gel), not with the frame the gel was photographed in
    const region = [crop.x - bx, crop.x + crop.w - bx], refW = Math.max(crop.w, 40);
    const L = detectLanes(strip, bright, refW, region);
    if (L.centers.length < 2) return null;
    const P = L.pitch, q = L.profile, W = strip.w;
    const wide = (pr, c) => featureWidth(pr, c, P) >= P * 0.28;
    // band evidence: mean band signal (rows above the lane's own median) within the lane core,
    // 0 for thin line-like features and for a torn edge that is dark along its whole length
    const qb = L.band;
    // a lane is a bump of the presence profile at its tooth: the tail of a strong neighbour (the
    // margin beside a ladder) is not
    const bumpIn = (pr, c) => {
      const at = x => pr[clamp(Math.round(x), 0, W - 1)];
      let top = 0; for (let x = c - P * 0.1; x <= c + P * 0.1; x++) top = Math.max(top, at(x));
      let l = Infinity, r = Infinity;
      for (let d = P * 0.2; d <= P * 0.5; d++) { l = Math.min(l, at(c - d)); r = Math.min(r, at(c + d)); }
      return top > l * 1.05 && top > r * 1.05;
    };
    const bump = (c) => bumpIn(q, c) || bumpIn(qb, c);
    // strict (outside the crop): the tooth must also be a bump; inside the crop the user's or the
    // auto crop vouches for the gel, and lanes that touch (keystone, lysates) show no dip
    const bandAt = (c, strict) => {
      const a = clamp(Math.round(c - P * 0.25), 0, W - 1), b = clamp(Math.round(c + P * 0.25), 0, W - 1);
      let s = 0, t = 0; for (let x = a; x <= b; x++) { s += qb[x]; t += q[x]; }
      // a few blotches in the margin have band contrast but hardly any presence
      if (t / (b - a + 1) < L.profileMax * 0.08) return 0;
      return wide(q, c) && (!strict || bump(c)) ? s / (b - a + 1) : 0;
    };
    const sig = signal(img, bright);
    const bandRefAll = Math.max(1e-9, ...L.centers.map(c => bandAt(c)));
    // gel slab: left/right boundary = strongest opposite-signed steps of the column median over band rows
    let slabL = 0, slabR = img.w - 1;
    {
      const ys0 = clamp(Math.round(crop.y), 0, img.h - 1), ys1 = clamp(Math.round(crop.y + crop.h), 0, img.h - 1);
      const stepY = Math.max(1, ((ys1 - ys0) / 120) | 0), col = [];
      const m = new Float32Array(img.w);
      for (let x = 0; x < img.w; x++) {
        col.length = 0;
        for (let y = ys0; y <= ys1; y += stepY) col.push(sig.data[y * img.w + x]);
        col.sort((a, b) => a - b); m[x] = col[col.length >> 1];
      }
      const ms = gaussSmooth(m, Math.max(2, P / 6)), g = new Float32Array(img.w);
      for (let x = 1; x < img.w - 1; x++) g[x] = (ms[x + 1] - ms[x - 1]) / 2;
      const absg = Array.from(g, Math.abs).sort((a, b) => a - b), med = absg[absg.length >> 1] || 1e-9;
      // the slab edge: walking outward from the outermost loaded lane of the crop, the first strong
      // step down to a lower level (the background) with no loaded lane beyond it. The frame's
      // own border, further out, is a step up to the dark frame and is not it.
      const span = Math.max(3, Math.round(P * 1.5)), half = Math.round(P * 0.5);
      const meanSig = (a, b) => { a = clamp(a, 0, img.w - 1); b = clamp(b, 0, img.w - 1); let t = 0; for (let x = a; x <= b; x++) t += ms[x]; return t / Math.max(1, b - a + 1); };
      const loadedIn = L.centers.map(c => c + bx).filter(c => c >= crop.x && c <= crop.x + crop.w && bandAt(c - bx) > bandRefAll * 0.3);
      const teethBeyond = (a, b) => L.centers.some(c => c + bx >= a && c + bx <= b && bandAt(c, true) > bandRefAll * 0.12);
      if (loadedIn.length) {
        const cL = loadedIn[0], cR = loadedIn[loadedIn.length - 1];
        // a lane's own edge (a loaded lane within 0.6 pitch on the near side) is not the slab's
        const near = Math.round(P * 0.6);
        for (let x = Math.round(cL - P * 0.3); x > 1; x--) {
          if (g[x] > med * 6 && meanSig(x + half, x + span) - meanSig(x - span, x - half) > med * 10 && !teethBeyond(x - span, x - half) && !teethBeyond(x, x + near)) { slabL = x; break; }
        }
        for (let x = Math.round(cR + P * 0.3); x < img.w - 1; x++) {
          if (-g[x] > med * 6 && meanSig(x - span, x - half) - meanSig(x + half, x + span) > med * 10 && !teethBeyond(x + half, x + span) && !teethBeyond(x - near, x)) { slabR = x; break; }
        }
      }
    }
    // well template: average well-row profile around loaded lanes; NCC against it at each position
    let wellNcc = () => 0;
    if (meta && meta.wellY != null) {
      const hw = Math.max(3, Math.round(P * 0.18));
      const y0 = clamp(Math.round(meta.wellY - hw), 0, img.h - 1), y1 = clamp(Math.round(meta.wellY + hw), 0, img.h - 1);
      const wp = new Float32Array(img.w);
      for (let y = y0; y <= y1; y++) for (let x = 0; x < img.w; x++) wp[x] += sig.data[y * img.w + x];
      // segments are detrended (the line through their ends), so the smooth vignetting of a
      // photograph cannot pass for a well
      const R = Math.round(P * 0.6), seg = (c) => {
        const out = new Float32Array(2 * R + 1);
        for (let k = -R; k <= R; k++) out[k + R] = wp[clamp(Math.round(c) + k, 0, img.w - 1)];
        const e = Math.max(1, Math.round(R * 0.2));
        let a = 0, b = 0; for (let k = 0; k < e; k++) { a += out[k]; b += out[out.length - 1 - k]; } a /= e; b /= e;
        for (let k = 0; k < out.length; k++) out[k] -= a + (b - a) * k / (out.length - 1);
        return out;
      };
      const loadedAbs = L.centers.filter(c => bandAt(c) > bandRefAll * 0.12).map(c => c + bx)
        .filter(c => c > slabL + P * 0.45 && c < slabR - P * 0.45);
      if (loadedAbs.length) {
        const tpl = new Float32Array(2 * R + 1);
        loadedAbs.forEach(c => seg(c).forEach((v, i) => { tpl[i] += v / loadedAbs.length; }));
        const ncc = (a, b) => {
          let ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; }
          ma /= a.length; mb /= b.length;
          let sab = 0, saa = 0, sbb = 0;
          for (let i = 0; i < a.length; i++) { const da = a[i] - ma, db = b[i] - mb; sab += da * db; saa += da * da; sbb += db * db; }
          return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : 0;
        };
        // the template is a well only if the loaded lanes agree with it: a well row found on
        // background (a photograph where the "well row" is above the slab) gives segments that
        // correlate with their own average but not with one another
        const self = loadedAbs.map(c => ncc(seg(c), tpl)).sort((a, b) => a - b);
        let ext = 0; for (let i = 1; i < tpl.length; i++) if (Math.abs(tpl[i]) > Math.abs(tpl[ext])) ext = i;
        const agree = (loadedAbs.length < 2 || self[self.length >> 1] >= 0.5) && Math.abs(ext - R) <= P * 0.3;
        // allow a small shift so slightly irregular combs still match
        if (agree) wellNcc = (cAbs) => { let best = -1; for (let d = -Math.round(P * 0.12); d <= Math.round(P * 0.12); d += 2) best = Math.max(best, ncc(seg(cAbs + d), tpl)); return best; };
      }
    }
    const inSlab = c => c > slabL + P * 0.45 && c < slabR - P * 0.45;
    // lattice positions extended across the slab, then kept outward from the loaded lanes while
    // each step still has a well (or bands)
    const O = L.centers[0] + bx;
    const all = [];
    for (let k = -40; k <= 80; k++) { const c = O + k * P; if (c > P * 0.4 && c < img.w - P * 0.4 && inSlab(c)) all.push(c); }
    const snap = c => { const j = L.centers.findIndex(x => Math.abs(x + bx - c) < P * 0.3); return j >= 0 ? L.centers[j] + bx : c; };
    const pos = all.map(snap);
    // the loaded lanes of the crop (the gel the user framed); a loaded-looking tooth far outside
    // with nothing between is not reached
    // (a tooth in the gel's margin, nearer than 0.75 pitch to the slab edge, is the margin's
    // blotches or the smile of the last ladder, not a well: it counts only when clearly loaded)
    const margin = c => c > slabL + P * 0.75 && c < slabR - P * 0.75;
    const loadedIdx = pos.map((c, i) => (c >= crop.x && c <= crop.x + crop.w && bandAt(c - bx) > bandRefAll * (margin(c) ? 0.12 : 0.3) ? i : -1)).filter(i => i >= 0);
    let cs;
    if (!loadedIdx.length) cs = L.centers.map(c => c + bx).filter(inSlab);
    else {
      let lo = loadedIdx[0], hi = loadedIdx[loadedIdx.length - 1];
      // empty wells look a bit different from loaded ones, so the bar is low; a flat gel gives ~0
      const ok = i => margin(pos[i]) && (bandAt(pos[i] - bx, true) > bandRefAll * 0.12 || wellNcc(pos[i]) >= 0.25);
      // a clearly loaded tooth (a ladder beside a torn or empty well) one or two teeth beyond an
      // empty one is still a lane: the empty wells between are kept so the numbering stays right
      const loaded = i => i >= 0 && i < pos.length && margin(pos[i]) && bandAt(pos[i] - bx, true) > bandRefAll * 0.3;
      const reach = (i, dir) => { if (ok(i)) return i; for (let k = 1; k <= 2; k++) { const j = i + k * dir; if (j < 0 || j >= pos.length || !margin(pos[j])) return -1; if (loaded(j)) return j; } return -1; };
      for (let j; lo - 1 >= 0 && (j = reach(lo - 1, -1)) >= 0;) lo = j;
      for (let j; hi + 1 < pos.length && (j = reach(hi + 1, 1)) >= 0;) hi = j;
      cs = pos.slice(lo, hi + 1);
    }
    detectLaneLattice.debug = { slabL, slabR, pos: pos.map(c => `${Math.round(c)}:b${(bandAt(c - bx) / bandRefAll).toFixed(2)}/w${wellNcc(c).toFixed(2)}/q${(q[clamp(Math.round(c - bx), 0, W - 1)] / L.profileMax).toFixed(2)}${wide(q, c - bx) ? 'W' : '-'}${bump(c - bx) ? 'B' : '-'}`) };
    if (!cs.length) return null;
    const bandRef = bandRefAll;
    const withBand = cs.filter(c => bandAt(c - bx) > bandRef * 0.12);
    // lane half-width from the band profile of loaded lanes (width at half height)
    const halves = [];
    withBand.forEach(cAbs => {
      const c = Math.round(cAbs - bx), v = q[c] || 0;
      if (v <= 0) return;
      let l = c, r2 = c;
      while (l > 0 && q[l - 1] > v / 2 && c - l < P) l--;
      while (r2 < W - 1 && q[r2 + 1] > v / 2 && r2 - c < P) r2++;
      halves.push((r2 - l) / 2);
    });
    halves.sort((a, b) => a - b);
    const halfW = halves.length ? clamp(halves[halves.length >> 1] * 0.8, P * 0.15, P * 0.4) : P * 0.3;
    return { centers: cs.map(c => Math.round(c * 10) / 10), pitch: P, halfW, loaded: withBand };
  }

  function evenLanes(n, w, first, last) {
    if (n <= 0) return [];
    if (first === undefined) { const step = w / n; return Array.from({ length: n }, (_, i) => (i + 0.5) * step); }
    if (n === 1) return [(first + last) / 2];
    return Array.from({ length: n }, (_, i) => first + (last - first) * i / (n - 1));
  }

  // ---------- bands in a lane ----------
  function laneProfile(cropped, bright, cx, halfW) {
    const sig = signal(cropped, bright);
    const { w, h, data } = sig;
    const x0 = clamp(Math.round(cx - halfW), 0, w - 1), x1 = clamp(Math.round(cx + halfW), 0, w - 1);
    const p = new Float32Array(h);
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let x = x0; x <= x1; x++) s += data[y * w + x];
      p[y] = s / (x1 - x0 + 1);
    }
    return p;
  }

  function detectBands(profile) {
    const h = profile.length;
    const sm = gaussSmooth(profile, Math.max(0.8, h / 400));
    const b = baseline(sm, Math.round(h / 12));
    const q = new Float32Array(h);
    let mx = 0;
    for (let i = 0; i < h; i++) { q[i] = Math.max(0, sm[i] - b[i]); mx = Math.max(mx, q[i]); }
    return findPeaks(q, Math.max(2, h / 150), mx * 0.03).map(k => ({ y: k.i, v: k.prom }));
  }

  // ---------- ladder matching ----------
  // All marker lanes of one gel share a migration curve y = a + b·x + c·x², x = ln(bp).
  // Lane input: {peaks:[{y,v}], sizes:[bp, descending], anchors:[{k, y}] (user-placed bands)}
  function prepLane(L) {
    const vmax = Math.max(0, ...L.peaks.map(p => p.v));
    // weak peaks (well edges, dust, smear ripples) are not ladder bands
    const P = L.peaks.filter(p => p.v >= vmax * 0.12).sort((a, b) => b.v - a.v).slice(0, 32).sort((a, b) => a.y - b.y);
    return { ys: P.map(p => p.y), vs: P.map(p => p.v), X: L.sizes.map(s => Math.log(s)), n: L.sizes.length, anchors: L.anchors || [] };
  }
  const predict = (m, x) => m.a + m.b * x + m.c * x * x + (m.d || 0) * x * x * x;
  const slopeAt = (m, x) => m.b + 2 * m.c * x + 3 * (m.d || 0) * x * x;

  // Order-preserving alignment of ladder sizes to peaks (dynamic programming): sizes run top->bottom
  // like the peaks, so a size can never take a peak below a smaller size's peak.
  function assign(m, D, h, tolFrac) {
    const { X, n, ys } = D, np = ys.length, tolBase = h * 0.04;
    const anch = new Map(D.anchors.map(a => [a.k, a.y]));
    const yp = X.map(x => predict(m, x)), tol = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const nb = [k - 1, k + 1].filter(j => j >= 0 && j < n).map(j => Math.abs(yp[j] - yp[k]));
      tol[k] = Math.max(1, Math.min(tolBase, Math.min(...nb) * tolFrac));
    }
    const SKIP_SIZE = 1, SKIP_PEAK = 0.35, W = np + 1;
    const cost = new Float32Array((n + 1) * W), from = new Uint8Array((n + 1) * W);
    for (let i = 1; i <= np; i++) { cost[i] = i * SKIP_PEAK; from[i] = 2; }
    for (let k = 1; k <= n; k++) {
      const fixed = anch.has(k - 1);
      cost[k * W] = cost[(k - 1) * W] + (fixed ? 0 : SKIP_SIZE); from[k * W] = 1;
      for (let i = 1; i <= np; i++) {
        let best = cost[(k - 1) * W + i] + (fixed ? 0 : SKIP_SIZE), how = 1;
        const c2 = cost[k * W + i - 1] + SKIP_PEAK;
        if (c2 < best) { best = c2; how = 2; }
        if (!fixed) {
          const d = Math.abs(yp[k - 1] - ys[i - 1]) / tol[k - 1];
          if (d <= 2.5) { const c3 = cost[(k - 1) * W + i - 1] + 0.5 * d * d; if (c3 < best) { best = c3; how = 3; } }
        }
        cost[k * W + i] = best; from[k * W + i] = how;
      }
    }
    const match = new Int32Array(n).fill(-1);
    for (let k = n, i = np; k > 0 || i > 0;) {
      const how = from[k * W + i];
      if (how === 3) { match[k - 1] = i - 1; k--; i--; } else if (how === 2) i--; else k--;
    }
    const res = [], pairs = [];
    let inl = 0, err = 0;
    for (let k = 0; k < n; k++) {
      if (anch.has(k)) { const y = anch.get(k); res.push({ y, matched: false, anchored: true }); pairs.push([X[k], y, 3]); continue; }
      const i = match[k];
      if (i >= 0) {
        const d = Math.abs(yp[k] - ys[i]) / tol[k];
        res.push({ y: ys[i], matched: true }); pairs.push([X[k], ys[i], d <= 1 ? 1 : 0.3]);
        inl += d <= 1 ? 1 : 0.6; err += Math.min(d, 2.5);
      } else res.push({ y: yp[k], matched: false });
    }
    return { res, pairs, inl, err };
  }

  // candidate linear models from one lane (RANSAC over peak/size pairs), best first
  function ransacModels(D, h, keep) {
    const { ys, X, n, anchors } = D;
    const cands = [];
    const tryModel = (y1, x1, y2, x2) => {
      if (x1 === x2) return;
      const b = (y1 - y2) / (x1 - x2);
      if (b >= 0) return;
      const m = { a: y1 - b * x1, b, c: 0 };
      const r = assign(m, D, h, 0.4);
      cands.push({ m, s: r.inl - 0.3 * r.err });
    };
    if (anchors.length >= 2) tryModel(anchors[0].y, X[anchors[0].k], anchors[1].y, X[anchors[1].k]);
    if (anchors.length) {
      for (const an of anchors) for (let i = 0; i < ys.length; i++) for (let q = 0; q < n; q++) if (q !== an.k) tryModel(an.y, X[an.k], ys[i], X[q]);
    } else {
      // models from the twelve strongest peaks only, and from size pairs that span at least a third of
      // the ladder with a plausible slope (the ladder's log range covers between a fifteenth and the
      // whole of the lane height): a fraction of the pairs, the same models that win
      const vs = D.vs || [], order = ys.map((y, i) => i).sort((a, b) => (vs[b] || 0) - (vs[a] || 0)).slice(0, 12).sort((a, b) => a - b);
      const span = Math.max(1, Math.floor(n / 3)), bMin = -h, bMax = -h / 15 / Math.max(1e-9, X[0] - X[n - 1]) * (X[0] - X[n - 1]);
      for (let ii = 0; ii < order.length; ii++) for (let jj = ii + 1; jj < order.length; jj++) {
        const i = order[ii], j = order[jj];
        for (let p = 0; p < n; p++) for (let q = p + span; q < n; q++) {
          const b = (ys[i] - ys[j]) / (X[p] - X[q]);
          if (b < bMin || b > bMax) continue;
          tryModel(ys[i], X[p], ys[j], X[q]);
        }
      }
    }
    cands.sort((a, b) => b.s - a.s);
    const out = [];
    for (const c of cands) {
      if (out.length >= (keep || 20)) break;
      if (out.every(o => Math.abs(o.a - c.m.a) > 2 || Math.abs(o.b - c.m.b) > 0.5)) out.push(c.m);
    }
    return out;
  }

  // weighted polynomial least squares in x (centred for conditioning), degree 1..3
  function fitWeighted(pts, deg) {
    const d = deg + 1, x0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const A = Array.from({ length: d }, () => new Array(d + 1).fill(0));
    for (const [x, y, w] of pts) {
      const u = x - x0, v = [1, u, u * u, u * u * u];
      for (let i = 0; i < d; i++) { A[i][d] += w * v[i] * y; for (let j = 0; j < d; j++) A[i][j] += w * v[i] * v[j]; }
    }
    const s = solveN(A, d);
    if (!s) return null;
    const [p0, p1, p2 = 0, p3 = 0] = s;
    // expand back from (x - x0) to x
    return {
      a: p0 - p1 * x0 + p2 * x0 * x0 - p3 * x0 * x0 * x0,
      b: p1 - 2 * p2 * x0 + 3 * p3 * x0 * x0,
      c: p2 - 3 * p3 * x0,
      d: p3
    };
  }
  function solveN(M, n) {
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      if (Math.abs(M[p][i]) < 1e-12) return null;
      [M[i], M[p]] = [M[p], M[i]];
      for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c]; }
    }
    return Array.from({ length: n }, (_, i) => M[i][n] / M[i][i]);
  }

  // migration must stay monotonic (bigger fragments higher) over the fitted range
  function monotone(m, pts) {
    const xs = pts.map(p => p[0]), lo = Math.min(...xs) - 0.3, hi = Math.max(...xs) + 0.3;
    for (let k = 0; k <= 10; k++) if (slopeAt(m, lo + (hi - lo) * k / 10) >= 0) return false;
    return true;
  }

  function refine(m, Ds, h) {
    for (let it = 0; it < 4; it++) {
      const pts = [];
      Ds.forEach(D => assign(m, D, h, 0.45).pairs.forEach(p => pts.push(p)));
      if (pts.length < 2) break;
      const span = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
      // more flexible curves only when there are enough bands over a wide enough size range
      const degs = pts.length >= 9 && span > 2.2 ? [3, 2, 1] : pts.length >= 5 ? [2, 1] : [1];
      let next = null;
      for (const dg of degs) { const q = fitWeighted(pts, dg); if (q && monotone(q, pts)) { next = q; break; } }
      if (!next) break;
      m = next;
    }
    return m;
  }

  /* Final assignment as a smooth chain: pick increasing (size, peak) pairs so that the local
   * migration slope (px per ln bp) changes gradually between neighbouring bands. The shared curve
   * m only restricts the search window and acts as a weak prior, so compressed regions (top of the
   * gel, small fragments) follow the data rather than the global fit. */
  function chainAssign(m, D, h, ref) {
    const { X, n } = D;
    const anch = new Map(D.anchors.map(a => [a.k, a.y]));
    // peaks (+ anchors as forced pseudo-peaks)
    const pk = D.ys.map((y, j) => ({ y, v: D.vs ? D.vs[j] : 1, anchorOf: -1 }));
    anch.forEach((y, k) => pk.push({ y, v: 1, anchorOf: k }));
    pk.sort((a, b) => a.y - b.y);
    const np = pk.length, vmax = Math.max(1e-9, ...pk.map(p => p.v));
    const yp = X.map(x => predict(m, x));
    const win = Math.max(h * 0.12, 12);
    const pairs = [];
    for (let k = 0; k < n; k++) for (let i = 0; i < np; i++) {
      if (anch.has(k) ? pk[i].anchorOf !== k : pk[i].anchorOf >= 0) continue;
      if (!anch.has(k) && Math.abs(pk[i].y - yp[k]) > win) continue;
      pairs.push({ k, i });
    }
    const NP = pairs.length;
    if (!NP) return null;
    const inGel = k => yp[k] >= 0 && yp[k] <= h;
    const skipSize = k => (anch.has(k) ? 100 : 1.0);
    const endSize = k => (anch.has(k) ? 100 : inGel(k) ? 0.8 : 0.15);
    const skipPeak = i => (pk[i].anchorOf >= 0 ? 100 : 0.25 + 0.75 * pk[i].v / vmax);
    const sumSize = (a, b, f) => { let s = 0; for (let k = a; k < b; k++) s += f(k); return s; };
    const sumPeak = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += skipPeak(i); return s; };
    const slope = (p, q) => (pk[q.i].y - pk[p.i].y) / (X[p.k] - X[q.k]);
    const prior = (p, q) => {
      const sm = -slopeAt(m, (X[p.k] + X[q.k]) / 2), s = slope(p, q);
      return sm > 0 && s > 0 ? 0.6 * Math.log(s / sm) ** 2 : 2;
    };
    const SMOOTH = 4;
    // optional reference from another lane of the same gel: the same size should run to the same height
    const sig = Math.max(6, h * 0.02);
    const pc = pairs.map(p => {
      const ry = ref ? ref(X[p.k]) : null;
      return ry == null ? 0 : 0.5 * ((pk[p.i].y - ry) / sig) ** 2;
    });
    const start = pairs.map((p, c) => sumSize(0, p.k, endSize) + sumPeak(0, p.i) + pc[c]);
    const dp = new Float64Array(NP * NP).fill(Infinity), back = new Int32Array(NP * NP).fill(-1);
    for (let c = 0; c < NP; c++) {
      const C = pairs[c];
      for (let b = 0; b < c; b++) {
        const B = pairs[b];
        if (B.k >= C.k || B.i >= C.i) continue;
        const sBC = slope(B, C);
        if (!(sBC > 0)) continue;
        const local = sumSize(B.k + 1, C.k, skipSize) + sumPeak(B.i + 1, C.i) + prior(B, C) + pc[c];
        let best = start[b], arg = -1;
        for (let a = 0; a < b; a++) {
          const v = dp[a * NP + b];
          if (v === Infinity) continue;
          const t = v + SMOOTH * Math.log(sBC / slope(pairs[a], B)) ** 2;
          if (t < best) { best = t; arg = a; }
        }
        dp[b * NP + c] = best + local; back[b * NP + c] = arg;
      }
    }
    // best chain end (single-pair chains allowed)
    const tail = p => sumSize(p.k + 1, n, endSize) + sumPeak(p.i + 1, np);
    let bestV = Infinity, bb = -1, bc = -1;
    pairs.forEach((p, c) => { const v = start[c] + tail(p); if (v < bestV) { bestV = v; bb = -1; bc = c; } });
    for (let b = 0; b < NP; b++) for (let c = b + 1; c < NP; c++) {
      const v = dp[b * NP + c];
      if (v === Infinity) continue;
      const t = v + tail(pairs[c]);
      if (t < bestV) { bestV = t; bb = b; bc = c; }
    }
    const chain = [pairs[bc]];
    for (let b = bb, c = bc; b >= 0;) { chain.unshift(pairs[b]); const a = back[b * NP + c]; c = b; b = a; }
    // positions: matched / anchored from the chain, the rest interpolated in ln(bp) or extrapolated
    const res = new Array(n).fill(null);
    chain.forEach(p => { res[p.k] = pk[p.i].anchorOf >= 0 ? { y: pk[p.i].y, matched: false, anchored: true } : { y: pk[p.i].y, matched: true }; });
    const ks = chain.map(p => p.k);
    for (let k = 0; k < n; k++) {
      if (res[k]) continue;
      const lo = ks.filter(q => q < k).pop(), hi = ks.find(q => q > k);
      let y;
      if (lo != null && hi != null) y = res[lo].y + (X[lo] - X[k]) / (X[lo] - X[hi]) * (res[hi].y - res[lo].y);
      else {
        // extrapolate with the slope of the nearest two chain points, falling back to the curve
        const two = lo != null ? ks.filter(q => q < k).slice(-2) : ks.filter(q => q > k).slice(0, 2);
        if (two.length === 2) {
          const s = (res[two[1]].y - res[two[0]].y) / (X[two[0]] - X[two[1]]), ref = lo != null ? two[1] : two[0];
          y = res[ref].y + s * (X[ref] - X[k]);
        } else y = yp[k] + (two.length ? res[two[0]].y - yp[two[0]] : 0);
      }
      res[k] = { y, matched: false };
    }
    return res;
  }

  // piecewise-linear y(ln bp) through a lane's matched bands; null outside their range
  function refCurve(res, X) {
    const pts = res.map((r, k) => [X[k], r.y, r.matched || r.anchored]).filter(p => p[2]).sort((a, b) => a[0] - b[0]);
    if (pts.length < 3) return null;
    return x => {
      if (x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
      for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        return y0 + (x - x0) / (x1 - x0 || 1) * (y1 - y0);
      }
      return null;
    };
  }

  function finalize(m, D, h, chain, ref) {
    const res = (chain && chainAssign(m, D, h, ref)) || assign(m, D, h, 0.45).res;
    const inRange = res.filter(r => r.y >= -2 && r.y <= h + 2).length;
    const nm = res.filter(r => r.matched).length;
    let mono = true;
    for (let k = 1; k < res.length; k++) if (res[k].y <= res[k - 1].y) mono = false;
    res.score = mono ? (nm + res.filter(r => r.anchored).length) / Math.max(D.ys.length, inRange, 1) : 0;
    res.matchedCount = nm;
    return res;
  }

  /* Match several marker lanes against one shared curve. lanes: [{peaks, sizes, anchors?, models?}]
   * Returns per-lane arrays [{y, matched, anchored}] with .score / .matchedCount, plus .model. */
  function matchMulti(lanes, h) {
    const Ds = lanes.map(prepLane);
    const fallback = () => lanes.map(L => {
      const n = L.sizes.length, r = L.sizes.map((s, i) => ({ y: h * (0.1 + 0.8 * i / Math.max(1, n - 1)), matched: false }));
      r.score = 0; r.matchedCount = 0; return r;
    });
    let cands = [];
    Ds.forEach((D, i) => {
      if (D.ys.length + D.anchors.length < 2 || D.n < 2) return;
      cands = cands.concat(lanes[i].models || ransacModels(D, h));
    });
    if (!cands.length) return fallback();
    let best = null, bestS = -Infinity;
    for (const c of cands) {
      const m = refine(c, Ds, h);
      const rs = Ds.map(D => finalize(m, D, h));
      const s = rs.reduce((a, r) => a + r.score, 0) / rs.length;
      if (s > bestS) { bestS = s; best = rs; best.model = m; best.score = s; }
    }
    // the shared curve fixes the window; the final per-lane assignment is the smooth chain
    if (!matchMulti.fast) {
      const model = best.model;
      Ds.forEach((D, i) => { best[i] = finalize(model, D, h, true); });
      if (Ds.length > 1) {
        // the most confident lane becomes the reference for the others
        const r0 = best.reduce((bi, r, i) => (r.score > best[bi].score ? i : bi), 0);
        const ref = refCurve(best[r0], Ds[r0].X);
        if (ref) Ds.forEach((D, i) => { if (i !== r0) best[i] = finalize(model, D, h, true, ref); });
      }
      best.model = model;
      best.score = best.reduce((a, r) => a + r.score, 0) / best.length;
    }
    return best;
  }

  function matchLadder(peaks, sizes, h, anchors) {
    const r = matchMulti([{ peaks, sizes, anchors }], h);
    const out = r[0];
    out.model = r.model;
    return out;
  }

  // Count of distinct sharp bands: used to recognise ladder lanes
  function sharpBandCount(peaks) {
    const vmax = Math.max(0, ...peaks.map(p => p.v));
    return peaks.filter(p => p.v >= vmax * 0.2).length;
  }

  /* Pick ladders for the marker lanes of one gel jointly (they must agree on one migration curve).
   * Returns [{id, score}] per lane, with .score for the combination. */
  // favourite ladders get a bonus per lane: enough to win near-ties, not enough to override a clear misfit
  const FAV_BONUS = 0.05;
  function jointLadders(peaksList, ladders, h, preferIds) {
    matchMulti.fast = true;
    try { return jointLaddersFast(peaksList, ladders, h, preferIds); } finally { matchMulti.fast = false; }
  }
  function jointLaddersFast(peaksList, ladders, h, preferIds) {
    const fav = new Set(Array.isArray(preferIds) ? preferIds : preferIds ? [preferIds] : []);
    const bonus = id => (fav.has(id) ? FAV_BONUS : 0);
    const per = peaksList.map(pk => ladders.map(l => {
      const D = prepLane({ peaks: pk, sizes: l.sizes });
      const models = D.ys.length >= 2 ? ransacModels(D, h, 12) : [];
      const r = models.length ? matchMulti([{ peaks: pk, sizes: l.sizes, models }], h) : null;
      return { id: l.id, sizes: l.sizes, models, score: r ? r.score : 0 };
    }).filter(c => c.score >= 0.4).sort((a, b) => (b.score + bonus(b.id)) - (a.score + bonus(a.id))).slice(0, 7));
    if (per.some(c => !c.length)) return null;
    const combos = per.reduce((acc, cands) => {
      const out = [];
      acc.forEach(a => cands.forEach(c => out.push(a.concat([c]))));
      return out;
    }, [[]]);
    let best = null, bestObj = -Infinity;
    for (const combo of combos) {
      const r = combo.length === 1 ? null : matchMulti(combo.map((c, i) => ({ peaks: peaksList[i], sizes: c.sizes, models: c.models })), h);
      const s = r ? r.score : combo[0].score;
      const obj = s + combo.reduce((a, c) => a + bonus(c.id), 0) / combo.length;
      if (jointLadders.trace) jointLadders.trace.push([combo.map(c => c.id).join('+'), +s.toFixed(3)]);
      if (obj > bestObj) { bestObj = obj; best = combo.map((c, i) => ({ id: c.id, score: r ? r[i].score : c.score })); best.score = s; }
    }
    return best;
  }

  // Rank ladder presets by fit to the detected peaks of one lane
  function rankLadders(peaks, ladders, h) {
    return ladders.map(l => {
      const m = matchLadder(peaks, l.sizes, h);
      return { id: l.id, score: m.score, matched: m.matchedCount };
    }).sort((a, b) => (b.score - a.score) || (b.matched - a.matched));
  }

  function fitQuad(pairs) {
    // normal equations for y = a + b x + c x^2
    let S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], T = [0, 0, 0];
    for (const [x, y] of pairs) {
      const v = [1, x, x * x];
      for (let i = 0; i < 3; i++) { T[i] += v[i] * y; for (let j = 0; j < 3; j++) S[i][j] += v[i] * v[j]; }
    }
    const sol = solve3(S, T);
    if (!sol) return null;
    return { a: sol[0], b: sol[1], c: sol[2] };
  }
  function solve3(A, b) {
    const M = A.map((r, i) => r.concat([b[i]]));
    for (let i = 0; i < 3; i++) {
      let p = i;
      for (let r = i + 1; r < 3; r++) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r;
      if (Math.abs(M[p][i]) < 1e-12) return null;
      [M[i], M[p]] = [M[p], M[i]];
      for (let r = 0; r < 3; r++) if (r !== i) {
        const f = M[r][i] / M[i][i];
        for (let c = i; c < 4; c++) M[r][c] -= f * M[i][c];
      }
    }
    return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
  }

  // Estimate size (bp) at row y from marker bands [{bp, y}] by piecewise log-linear interpolation.
  // Outside the band range it extrapolates from the end segment and says so.
  function estimateSizeInfo(y, bands) {
    const B = bands.filter(b => b.y != null).slice().sort((a, b) => a.y - b.y);
    if (B.length < 2) return null;
    let i = 0;
    while (i < B.length - 2 && y > B[i + 1].y) i++;
    const a = B[i], b = B[i + 1];
    if (b.y === a.y) return null;
    const t = (y - a.y) / (b.y - a.y);
    const tol = 2;   // px: a band sitting right on the outermost marker band is not extrapolated
    return {
      bp: Math.exp(Math.log(a.bp) + t * (Math.log(b.bp) - Math.log(a.bp))),
      extrap: y < B[0].y - tol || y > B[B.length - 1].y + tol,
      range: [B[B.length - 1].bp, B[0].bp]
    };
  }
  function estimateSize(y, bands) { const r = estimateSizeInfo(y, bands); return r ? r.bp : null; }

  /* Exposure quality of one capture of a gel (for picking the best of several exposures).
   * Works on a downsampled copy inside the auto-detected band region. Not "darker is better":
   * clipping is punished hardest, but a short exposure loses on dynamic range use and SNR. */
  const EXPO_W = { clip: 0.45, range: 0.25, snr: 0.30 };
  function exposureScore(img) {
    const sm = downsample(img, 600);
    const s = { w: sm.w, h: sm.h, data: sm.data };
    const bright = detectBright(s);
    const r = autoCrop(s, bright);
    const c = cropImg(s, r), sig = signal(c, bright).data, n = c.data.length;
    let clipped = 0;
    for (let i = 0; i < n; i++) if (c.data[i] >= 0.998) clipped++;
    const clipFrac = clipped / n;
    const [p50, p999] = percentiles(sig, [50, 99.9]);
    // noise: robust spread of horizontal neighbour differences (bands are smooth along x)
    const diffs = new Float32Array(Math.max(1, n - c.h));
    let k = 0;
    for (let y = 0; y < c.h; y++) for (let x = 1; x < c.w; x++) diffs[k++] = Math.abs(sig[y * c.w + x] - sig[y * c.w + x - 1]);
    const mad = percentiles(diffs.subarray(0, k), [50])[0];
    const noise = Math.max(1e-5, 1.4826 * mad / Math.SQRT2);
    const snr = (p999 - p50) / noise;
    const rangeUse = Math.min(1, Math.max(0, p999 - p50) / 0.75);
    const snrScore = Math.min(1, Math.max(0, Math.log10(Math.max(1, snr)) / 2.5));
    const clipScore = Math.max(0, 1 - clipFrac / 0.005);   // 0.5 % clipped pixels = 0
    const score = EXPO_W.clip * clipScore + EXPO_W.range * rangeUse + EXPO_W.snr * snrScore;
    return { score, clipFrac, rangeUse, snr, bright };
  }

  G.Engine = {
    clamp, percentiles, gaussSmooth, downsample, rotate, cropImg, detectBright, autoLevels, saturation,
    toImageData, deskew, autoCrop, baseline, findPeaks, detectLanes, evenLanes, laneProfile, detectBands, matchLadder, estimateSize, estimateSizeInfo, exposureScore,sharpBandCount, rankLadders, jointLadders, matchMulti, detectLaneLattice, combPitch, presenceProfile, featureWidth, signal, M3, warp, laneLines, laneComb, vanishing, keystoneH, keystoneReport, Grid, warpGrid, homographyFromQuad, slabQuad, laneTraces, straightenGrid
  };
})(window);

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
  function autoCrop(img, bright, band) {
    const sm = signal(downsample(img, 700), bright);
    const { w, h, data, f } = Object.assign({ f: 1 }, sm, { f: Math.max(1, Math.ceil(Math.max(img.w, img.h) / 700)) });
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
    for (let i = 1; i < n - 1; i++) if (p[i] > p[i - 1] && p[i] >= p[i + 1]) cand.push(i);
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
    const w = sig.w, R = refW || w;
    const x0 = region ? region[0] : 0, x1 = region ? region[1] : w;
    const raw = presenceProfile(sig, R);
    const q0 = gaussSmooth(raw, Math.max(1, R / 250));
    const bl = baseline(q0, Math.round(R / 8));
    const q = new Float32Array(w);
    let mx = 0;
    for (let i = 0; i < w; i++) { q[i] = Math.max(0, q0[i] - bl[i]); mx = Math.max(mx, q[i]); }
    const band = gaussSmooth(raw.band, Math.max(1, R / 250)), bb = baseline(band, Math.round(R / 8));
    for (let i = 0; i < w; i++) band[i] = Math.max(0, band[i] - bb[i]);
    if (mx <= 0) return { centers: [], pitch: R / 10, profile: q, profileMax: 0, band };
    const peaks = findPeaks(q, Math.max(3, R / 70), mx * 0.12);
    const comb = combPitch(gaussSmooth(q, Math.max(1, R / 400)), R / 60, R / 2, x0, x1, peaks, mx);
    detectLanes.debug = { peaks: peaks.map(k => [k.i, +(k.prom / mx).toFixed(2)]), pitch: comb.p, combScore: comb.s };
    if (!comb.p || peaks.length < 1) return { centers: peaks.map(k => k.i), pitch: comb.p || R / 10, profile: q, profileMax: mx, band };
    let P = comb.p, O = comb.o;
    // evidence at a tooth: a wide feature (a lane, not an edge line) with signal in the lane core
    const coreMean = (c, p) => {
      const a = clamp(Math.round(c - p * 0.25), 0, w - 1), b = clamp(Math.round(c + p * 0.25), 0, w - 1);
      let s = 0; for (let x = a; x <= b; x++) s += q[x];
      return s / (b - a + 1);
    };
    const centroid = (c, p) => {
      const a = clamp(Math.round(c - p * 0.45), 0, w - 1), b = clamp(Math.round(c + p * 0.45), 0, w - 1);
      let lo = Infinity, sw = 0, sxw = 0;
      for (let x = a; x <= b; x++) lo = Math.min(lo, q[x]);
      for (let x = a; x <= b; x++) { const v = q[x] - lo; sw += v; sxw += v * x; }
      let cx = sw > 0 ? sxw / sw : c;
      if (Math.abs(cx - c) > p * 0.25) cx = c;
      return cx;
    };
    const hasLane = (c, p) => coreMean(c, p) > mx * 0.06 && featureWidth(q, c, p) >= p * 0.28;
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
    const L = detectLanes(strip, bright, Math.max(crop.w, 40), [crop.x - bx, crop.x + crop.w - bx]);
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
    const loadedIdx = pos.map((c, i) => (c >= crop.x && c <= crop.x + crop.w && bandAt(c - bx) > bandRefAll * 0.12 ? i : -1)).filter(i => i >= 0);
    let cs;
    if (!loadedIdx.length) cs = L.centers.map(c => c + bx).filter(inSlab);
    else {
      let lo = loadedIdx[0], hi = loadedIdx[loadedIdx.length - 1];
      // empty wells look a bit different from loaded ones, so the bar is low; a flat gel gives ~0
      // (a tooth in the gel's margin, nearer than 0.75 pitch to the slab edge, is the margin's
      // blotches or the smile of the last ladder, not a well)
      const margin = c => c > slabL + P * 0.75 && c < slabR - P * 0.75;
      const ok = i => margin(pos[i]) && (bandAt(pos[i] - bx, true) > bandRefAll * 0.12 || wellNcc(pos[i]) >= 0.25);
      while (lo - 1 >= 0 && ok(lo - 1)) lo--;
      while (hi + 1 < pos.length && ok(hi + 1)) hi++;
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
      for (let i = 0; i < ys.length; i++) for (let j = i + 1; j < ys.length; j++)
        for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) tryModel(ys[i], X[p], ys[j], X[q]);
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
    toImageData, deskew, autoCrop, baseline, findPeaks, detectLanes, evenLanes, laneProfile, detectBands, matchLadder, estimateSize, estimateSizeInfo, exposureScore,sharpBandCount, rankLadders, jointLadders, matchMulti, detectLaneLattice, combPitch, presenceProfile, featureWidth, signal
  };
})(window);

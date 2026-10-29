/* Interactive raw-image editor: crop box, lane lines, marker bands, arrows. Zoom / pan. */
(function (G) {
  'use strict';
  const App = G.App;
  const cv = document.getElementById('editor');
  const box = document.getElementById('editorBox');
  const ctx = cv.getContext('2d');
  const view = { s: 1, ox: 0, oy: 0 };
  let dpr = 1, drag = null, hover = null, spaceDown = false, gridOn = false, creating = null, cornersOn = false, origOn = false;
  const HIT = 7;

  const toImg = (sx, sy) => ({ x: (sx - view.ox) / view.s, y: (sy - view.oy) / view.s });
  const toScr = (x, y) => ({ x: x * view.s + view.ox, y: y * view.s + view.oy });

  function resize() {
    dpr = window.devicePixelRatio || 1;
    const r = box.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    draw();
  }

  function fit(rect) {
    const r = box.getBoundingClientRect(), pad = 34;
    if (r.width < 10 || r.height < 10) return;
    view.s = Math.min((r.width - 2 * pad) / rect.w, (r.height - 2 * pad) / rect.h);
    view.ox = (r.width - rect.w * view.s) / 2 - rect.x * view.s;
    view.oy = (r.height - rect.h * view.s) / 2 - rect.y * view.s;
    draw(); refreshZoom();
  }
  function fitFull() { if (App.src) { const r = App.ensureRot(); fit({ x: 0, y: 0, w: r.w, h: r.h }); } }
  function fitCrop() { if (App.S) { const c = App.S.crop, m = Math.max(c.w, c.h) * 0.08; fit({ x: c.x - m, y: c.y - m * 2, w: c.w + 2 * m, h: c.h + 3 * m }); } }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  function draw() {
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!App.S) return;
    // the Original view: the image as decoded, fitted to the editor, with no overlay and nothing to drag
    if (origOn) {
      const oc = App.originalCanvas(), s = Math.min((w - 40) / oc.width, (h - 40) / oc.height);
      ctx.imageSmoothingEnabled = s < 2;
      ctx.drawImage(oc, (w - oc.width * s) / 2, (h - oc.height * s) / 2, oc.width * s, oc.height * s);
      ctx.font = '600 12px -apple-system, Segoe UI, Arial, sans-serif'; ctx.textAlign = 'left';
      const t = 'Original, as decoded: no flip, rotation, geometry or overlay';
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(t, 12, 20); ctx.fillStyle = '#152229'; ctx.fillText(t, 12, 20);
      return;
    }
    App.renderFull();
    const S = App.S, rot = App.rot;
    ctx.imageSmoothingEnabled = view.s < 2;
    ctx.save();
    ctx.translate(view.ox, view.oy); ctx.scale(view.s, view.s);
    ctx.drawImage(App.fullCanvas, 0, 0);
    // white-light marker image of a Western, laid over the blot to check the ladder positions
    if (App.hasMarkerImage() && document.getElementById('mkOverlay').checked) {
      ctx.globalAlpha = (+document.getElementById('mkOpacity').value || 45) / 100; ctx.drawImage(App.markerCanvas(), 0, 0); ctx.globalAlpha = 1;
    }
    if (document.getElementById('showSat').checked) ctx.drawImage(App.getSatCanvas(), 0, 0);
    ctx.restore();

    const c = S.crop, a = toScr(c.x, c.y), b = toScr(c.x + c.w, c.y + c.h);
    // dim outside the crop
    const ia = toScr(0, 0), ib = toScr(rot.w, rot.h);
    ctx.fillStyle = 'rgba(18,24,32,0.5)';
    ctx.beginPath(); ctx.rect(ia.x, ia.y, ib.x - ia.x, ib.y - ia.y); ctx.rect(a.x, b.y, b.x - a.x, a.y - b.y); ctx.fill('evenodd');

    // the manual geometry box: four free corners (round handles) dragged onto the gel's corners and
    // four sides (square handles) that slide along their own perpendicular; while it is being placed
    // nothing else is drawn, so a corner is never under a lane line or a band
    if (cornersOn) {
      const q = (drag && (drag.h.type === 'corner' || drag.h.type === 'edge')) ? drag.corners : App.geomCornersWork();
      ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); q.forEach(([x, y], i) => { const p = toScr(x, y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.stroke();
      for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4], p = toScr((a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 5, p.y - 5, 10, 10); ctx.strokeRect(p.x - 5, p.y - 5, 10, 10); }
      q.forEach(([x, y]) => { const p = toScr(x, y); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
      return;
    }

    // straightening grid: horizontal/vertical reference lines to judge wells and bands by eye
    if (gridOn) {
      const step = Math.max(24, Math.min(80, (ib.x - ia.x) / 16));
      ctx.save();
      ctx.beginPath(); ctx.rect(ia.x, ia.y, ib.x - ia.x, ib.y - ia.y); ctx.clip();
      ctx.strokeStyle = 'rgba(0,200,255,.45)'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath();
      for (let y = a.y % step; y < h; y += step) { ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(w, Math.round(y) + 0.5); }
      for (let x = a.x % step; x < w; x += step) { ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, h); }
      ctx.stroke(); ctx.restore();
    }

    // strips (teal) and densitometry band boxes (green): two layers. The one that belongs to the open view (strips
    // with the figure, band boxes with the Densitometry view) is drawn on top and can be dragged; the other is a faint outline
    ctx.font = '600 11px -apple-system, Segoe UI, Arial, sans-serif';
    const q = quantLayer();
    const drawStrips = () => S.strips.forEach((t, k) => {
      const p0 = toScr(c.x, Math.min(t.y0, t.y1)), p1 = toScr(c.x + c.w, Math.max(t.y0, t.y1));
      const hov = !q && hover && hover.type === 'sedge' && hover.k === k;
      ctx.globalAlpha = q ? 0.35 : 1;
      if (!q) { ctx.fillStyle = 'rgba(14,143,143,.10)'; ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); }
      ctx.strokeStyle = '#0e8f8f'; ctx.lineWidth = hov ? 2.4 : q ? 1 : 1.4; ctx.setLineDash(q ? [2, 4] : [6, 3]);
      ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y); ctx.setLineDash([]);
      // name just above the strip's top right corner, outside the crop (band-box names sit beside their box)
      const t1 = 'Strip' + ' ' + (k + 1) + (t.label ? ': ' + t.label : '');
      ctx.textAlign = 'right'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.strokeText(t1, p1.x - 4, p0.y - 5); ctx.fillStyle = '#0b6e6e'; ctx.fillText(t1, p1.x - 4, p0.y - 5);
      ctx.globalAlpha = 1;
    });
    const qhw = App.S.quant.rows.length ? G.Quant.boxHalfWidth(S) : 0;
    const qLanes = G.Quant.quantLanes(App);
    const R = q && G.QuantUI && G.QuantUI.lastResults ? G.QuantUI.lastResults() : null;
    // a band placed in the original pixels (version 2): each lane's region and its background regions are drawn
    // where they lie now, from their stored outlines (they do not move with the image; the outlines do)
    const poly = (pts, fill, stroke) => { ctx.beginPath(); pts.forEach(([x, y], i) => { const p = toScr(x, y); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); }); ctx.closePath(); if (fill) ctx.fill(); if (stroke) ctx.stroke(); };
    const drawRegions = (r, k) => {
      const hov = q && hover && (hover.type === 'qedge' || hover.type === 'qbody') && hover.k === k, isRef = S.quant.norm === 'band' && r.id === S.quant.normBand;
      const col = isRef ? '#7a8b00' : '#1f9d55';
      ctx.globalAlpha = q ? 1 : 0.35;
      let labelAt = null;
      qLanes.forEach(i => {
        const lid = App.laneId(i), o = G.Quant.outlines(App, r, lid);
        if (!o) return;
        const sel = q && App.selLanes.has(i), j = R ? R.lanes.indexOf(i) : -1, cell = R && R.cells[k] && j >= 0 ? R.cells[k][j] : null;
        if (q) { ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); o.background.forEach(b => poly(b.pts, null, true)); ctx.setLineDash([]); }
        ctx.fillStyle = isRef ? 'rgba(122,139,0,.12)' : 'rgba(31,157,85,.12)'; ctx.strokeStyle = col; ctx.lineWidth = sel ? 2.4 : hov ? 2 : q ? 1.2 : 1;
        if (!q) ctx.setLineDash([2, 4]);
        poly(o.signal, q, true); ctx.setLineDash([]);
        const top = o.signal.reduce((a, p) => (p[1] < a[1] ? p : a), o.signal[0]), right = o.signal.reduce((a, p) => (p[0] > a[0] ? p : a), o.signal[0]);
        if (!labelAt || right[0] > labelAt[0]) labelAt = [right[0], (top[1] + o.signal.reduce((a, p) => Math.max(a, p[1]), -Infinity)) / 2];
        // a lane that needs review (or has no value) is marked on the image, in words as well as colour
        if (q && cell && ((cell.review && cell.review.length) || cell.value == null || cell.flags.clip)) {
          const p = toScr(top[0], top[1]); ctx.font = '700 12px -apple-system, Segoe UI, Arial, sans-serif'; ctx.textAlign = 'center';
          const t = cell.value == null ? 'n/a' : cell.flags.clip ? '⚠' : '?';
          ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(t, p.x, p.y - 4); ctx.fillStyle = '#9F4E0C'; ctx.fillText(t, p.x, p.y - 4);
          ctx.font = '600 11px -apple-system, Segoe UI, Arial, sans-serif';
        }
      });
      if (labelAt) {
        const p = toScr(labelAt[0], labelAt[1]), t2 = (r.name || `Band ${k + 1}`) + (isRef ? ' (reference)' : '');
        ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
        ctx.strokeText(t2, p.x + 8, p.y + 4); ctx.fillStyle = isRef ? '#5c6900' : '#14713a'; ctx.fillText(t2, p.x + 8, p.y + 4);
      }
      ctx.globalAlpha = 1;
    };
    const drawBoxes = () => S.quant.rows.forEach((r, k) => {
      if (r.frame) { drawRegions(r, k); return; }
      const ya = toScr(0, Math.min(r.y0, r.y1)).y, yb = toScr(0, Math.max(r.y0, r.y1)).y;
      const hov = q && hover && (hover.type === 'qedge' || hover.type === 'qbody') && hover.k === k, ctl = k === S.quant.control;
      ctx.globalAlpha = q ? 1 : 0.35;
      ctx.strokeStyle = ctl ? '#7a8b00' : '#1f9d55'; ctx.lineWidth = hov ? 2 : q ? 1.2 : 1;
      ctx.fillStyle = ctl ? 'rgba(122,139,0,.12)' : 'rgba(31,157,85,.12)';
      if (!q) ctx.setLineDash([2, 4]);
      qLanes.forEach(i => {
        const x0 = toScr(S.lanes[i].x - qhw, 0).x, x1 = toScr(S.lanes[i].x + qhw, 0).x;
        if (q) ctx.fillRect(x0, ya, x1 - x0, yb - ya);
        ctx.strokeRect(x0, ya, x1 - x0, yb - ya);
      });
      ctx.setLineDash([]);
      const t2 = r.name || `Band ${k + 1}`;
      ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.strokeText(t2, b.x + 8, (ya + yb) / 2 + 4); ctx.fillStyle = ctl ? '#5c6900' : '#14713a'; ctx.fillText(t2, b.x + 8, (ya + yb) / 2 + 4);
      ctx.globalAlpha = 1;
    });
    // the analysis area (dashed green) when it is set apart from the figure box: the band boxes measure inside it
    const ga = S.quant.region;
    if (q && ga && (ga.x !== c.x || ga.y !== c.y || ga.w !== c.w || ga.h !== c.h)) {
      const g0 = toScr(ga.x, ga.y), g1 = toScr(ga.x + ga.w, ga.y + ga.h);
      ctx.strokeStyle = '#1f9d55'; ctx.lineWidth = 1.2; ctx.setLineDash([8, 4]);
      ctx.strokeRect(g0.x, g0.y, g1.x - g0.x, g1.y - g0.y); ctx.setLineDash([]);
      ctx.textAlign = 'left'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.strokeText('Analysis area', g0.x + 4, g1.y + 14); ctx.fillStyle = '#14713a'; ctx.fillText('Analysis area', g0.x + 4, g1.y + 14);
    }
    if (q) { drawStrips(); drawBoxes(); } else { drawBoxes(); drawStrips(); }
    if (creating) {
      const ya = toScr(0, Math.min(creating.y0, creating.y1)).y, yb = toScr(0, Math.max(creating.y0, creating.y1)).y;
      ctx.fillStyle = creating.mode === 'strip' ? 'rgba(14,143,143,.18)' : 'rgba(31,157,85,.18)';
      ctx.fillRect(a.x, ya, b.x - a.x, yb - ya);
    }

    // crop rect + handles
    ctx.strokeStyle = '#ff4d4f'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff4d4f';
    for (const [hx, hy] of handles()) {
      const p = toScr(hx, hy);
      roundRect(ctx, p.x - 5, p.y - 5, 10, 10, 2.5); ctx.fill(); ctx.stroke();
    }

    const half = S.laneHalfW;
    ctx.font = '600 11px -apple-system, Segoe UI, Arial, sans-serif';
    ctx.textAlign = 'center';
    const mkLanes = new Set(S.markers.map(m => m.lane));
    // many lanes at a small zoom: number chips would pile up, so only every n-th is drawn (plus the
    // selected lane and the first / last), and the chips shrink
    const pitchScr = (S.lanePitch || S.laneHalfW / 0.3) * view.s, every = Math.max(1, Math.ceil(24 / Math.max(1, pitchScr)));
    const crowded = every > 1;
    if (crowded) ctx.font = '600 10px -apple-system, Segoe UI, Arial, sans-serif';
    // the lane about to be added follows the pointer
    if (App.mode === 'lane' && hover && hover.type === 'laneGhost') {
      const p = toScr(hover.x, c.y);
      ctx.strokeStyle = '#2f6feb'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, a.y - 14); ctx.lineTo(p.x, b.y + 14); ctx.stroke();
      ctx.setLineDash([]);
    }
    S.lanes.forEach((l, i) => {
      const p = toScr(l.x, c.y), sel = App.selLanes.has(i), hov = hover && hover.type === 'lane' && hover.i === i;
      const isM = mkLanes.has(i), out = l.x < c.x || l.x > c.x + c.w;
      ctx.globalAlpha = out ? 0.45 : 1;
      if (sel) { ctx.fillStyle = 'rgba(47,111,235,.10)'; ctx.fillRect(p.x - half * view.s, a.y, 2 * half * view.s, b.y - a.y); }
      ctx.strokeStyle = l.hidden ? 'rgba(255,90,90,.85)' : sel ? '#2f6feb' : isM ? 'rgba(236,178,0,.9)' : 'rgba(47,111,235,.55)';
      ctx.lineWidth = sel || hov ? 2.2 : 1.2;
      ctx.setLineDash(l.hidden ? [5, 4] : isM ? [] : [6, 4]);
      ctx.beginPath(); ctx.moveTo(p.x, a.y); ctx.lineTo(p.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
      // above the crop: the well number in a chip, and the lane's name (when it has one) in a lighter pill above it
      const nb = S.lanes.length > 1 ? Math.abs((S.lanes[i + 1] || S.lanes[i - 1]).x - l.x) * view.s : 999;
      const lab = String(i + 1);
      if (crowded && !sel && !l.hidden && i % every && i !== S.lanes.length - 1) { ctx.globalAlpha = 1; return; }
      const tw = ctx.measureText(lab).width + (crowded ? 8 : 12);
      const anyName = S.lanes.some(x => x.name), cy = Math.max(anyName ? 47 : 12, a.y - 14);
      ctx.fillStyle = l.hidden ? 'rgba(190,30,45,.9)' : sel ? '#2f6feb' : 'rgba(24,32,44,.72)';
      roundRect(ctx, p.x - tw / 2, cy - 9, tw, 18, 6); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(l.hidden ? lab + ' ✕' : lab, p.x, cy + 3.8);
      if (l.name) {
        // the name pill sits above the number; when neighbours are close, names alternate between two rows so that
        // each may be twice as wide, and only then are they shortened
        let nm = trunc(l.name.replace(/\*/g, ''), 16), nw = ctx.measureText(nm).width + 10;
        const row = !sel && nw > nb - 2 ? i % 2 : 0, room = row || (!sel && nw > nb - 2) ? 2 * nb - 4 : nb - 2;
        if (!sel && nw > room) { nm = trunc(nm, Math.max(2, Math.floor(nm.length * (room - 10) / (nw - 10)))); nw = ctx.measureText(nm).width + 10; }
        const ny = cy - 27 - row * 17;
        ctx.fillStyle = sel ? 'rgba(47,111,235,.85)' : 'rgba(255,255,255,.88)';
        roundRect(ctx, p.x - nw / 2, ny, nw, 16, 5); ctx.fill();
        ctx.fillStyle = sel ? '#fff' : '#18202c';
        ctx.fillText(nm, p.x, ny + 11.8);
      }
      ctx.globalAlpha = 1;
    });
    if (App.mode === 'arrow' && hover && hover.snapY != null) {
      const y = toScr(0, hover.snapY).y;
      ctx.strokeStyle = '#c026d3'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(b.x, y); ctx.stroke(); ctx.setLineDash([]);
    }

    // marker bands
    S.markers.forEach((mk, mi) => {
      if (!S.lanes[mk.lane]) return;
      const mx = S.lanes[mk.lane].x;
      const x0 = toScr(mx - half * 1.4, 0).x, x1 = toScr(mx + half * 1.4, 0).x;
      const right = mx > S.crop.x + S.crop.w / 2;
      ctx.textAlign = right ? 'left' : 'right';
      ctx.font = '11px -apple-system, Segoe UI, Arial, sans-serif';
      mk.bands.forEach((bd, k) => {
        const y = toScr(0, bd.y).y;
        if (y < -20 || y > h + 20) return;
        const hov = hover && hover.type === 'band' && hover.m === mi && hover.i === k;
        ctx.strokeStyle = bd.show ? '#e0a800' : 'rgba(224,168,0,.42)';
        ctx.lineWidth = hov ? 2.6 : 1.6;
        ctx.setLineDash(bd.matched || bd.manual ? [] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
        ctx.setLineDash([]);
        if (bd.show || hov) {
          const txt = G.Ladders.fmt(bd.bp, App.baseUnit());
          const tx = right ? x1 + 5 : x0 - 5, ty = y + 3.8;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(255,255,255,.85)';
          ctx.textAlign = right ? 'left' : 'right';
          ctx.strokeText(txt, tx, ty);
          ctx.fillStyle = bd.show ? '#8a6100' : 'rgba(138,97,0,.62)';
          ctx.fillText(txt, tx, ty);
          ctx.lineWidth = bd.matched || bd.manual ? 1.6 : 1.6;
        }
      });
    });

    // arrows
    ctx.textAlign = 'left'; ctx.font = '600 11px -apple-system, Segoe UI, Arial, sans-serif';
    S.arrows.forEach((ar, k) => {
      const y = toScr(0, ar.y).y, sel = k === App.selArrow;
      ctx.strokeStyle = '#c026d3'; ctx.lineWidth = sel ? 2.4 : 1.4; ctx.setLineDash([7, 4]);
      ctx.beginPath(); ctx.moveTo(a.x, y); ctx.lineTo(b.x, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#c026d3';
      ctx.beginPath(); ctx.moveTo(b.x + 2, y); ctx.lineTo(b.x + 13, y - 5.5); ctx.lineTo(b.x + 13, y + 5.5); ctx.fill();
      const est = App.estimateBp(ar.y);
      const t = (ar.text || 'Arrow') + (est ? `  ≈${App.fmtSize(est)}` : '');
      const tw = ctx.measureText(t).width;
      ctx.fillStyle = 'rgba(192,38,211,.12)';
      roundRect(ctx, b.x + 17, y - 9, tw + 12, 18, 6); ctx.fill();
      ctx.fillStyle = '#86198f';
      ctx.fillText(t, b.x + 23, y + 3.8);
    });
  }
  function trunc(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  function handles() {
    const c = App.S.crop, mx = c.x + c.w / 2, my = c.y + c.h / 2;
    return [[c.x, c.y, 'nw'], [mx, c.y, 'n'], [c.x + c.w, c.y, 'ne'], [c.x + c.w, my, 'e'], [c.x + c.w, c.y + c.h, 'se'], [mx, c.y + c.h, 's'], [c.x, c.y + c.h, 'sw'], [c.x, my, 'w']];
  }

  // the editing layer chosen with the Editing switch above the image: band boxes ('quant') or the figure's
  // lanes, ladder bands and strips
  const quantLayer = () => !!(G.QuantUI && G.QuantUI.layer && G.QuantUI.layer() === 'quant');
  function hitTest(sx, sy, shift) {
    if (origOn) return null;
    const S = App.S; if (!S) return null;
    const c = S.crop, p = toImg(sx, sy), tol = HIT / view.s;
    if (spaceDown) return { type: 'pan' };
    if (cornersOn) {
      const q = App.geomCornersWork();
      for (let k = 0; k < 4; k++) if (Math.hypot(p.x - q[k][0], p.y - q[k][1]) <= tol * 1.6) return { type: 'corner', k };
      for (let k = 0; k < 4; k++) { const a = q[k], b = q[(k + 1) % 4]; if (Math.hypot(p.x - (a[0] + b[0]) / 2, p.y - (a[1] + b[1]) / 2) <= tol * 1.6) return { type: 'edge', k }; }
      return { type: 'pan' };
    }
    for (const [hx, hy, k] of handles()) if (Math.abs(p.x - hx) <= tol * 1.3 && Math.abs(p.y - hy) <= tol * 1.3) return { type: 'crop', k };
    const inX = p.x >= c.x - tol && p.x <= c.x + c.w + tol, inY = p.y >= c.y - tol && p.y <= c.y + c.h + tol;
    for (let k = 0; k < S.arrows.length; k++) if (Math.abs(p.y - S.arrows[k].y) <= tol && inX) return { type: 'arrow', i: k };
    for (let mi = 0; mi < S.markers.length; mi++) {
      const mk = S.markers[mi];
      if (!S.lanes[mk.lane] || Math.abs(p.x - S.lanes[mk.lane].x) > S.laneHalfW * 1.5) continue;
      let best = -1, bd = tol;
      mk.bands.forEach((b, k) => { const d = Math.abs(p.y - b.y); if (d <= bd) { bd = d; best = k; } });
      if (best >= 0) return { type: 'band', m: mi, i: best };
    }
    // edges of band boxes and strips (drag up / down); inside a band box = move it. Only the layer of the open view
    // responds: band boxes with the Densitometry view, strips with the figure
    if (inX) {
      const q = quantLayer();
      const spanOf = r => (r.frame ? G.Quant.rowSpan(App, r) : { y0: Math.min(r.y0, r.y1), y1: Math.max(r.y0, r.y1) });
      if (q) for (let k = 0; k < S.quant.rows.length; k++) { const sp = spanOf(S.quant.rows[k]); for (const e of ['y0', 'y1']) if (Math.abs(p.y - (S.quant.rows[k].frame ? (e === 'y0' ? sp.y0 - 0.5 : sp.y1 + 0.5) : S.quant.rows[k][e])) <= tol) return { type: 'qedge', k, e }; }
      if (!q) for (let k = 0; k < S.strips.length; k++) for (const e of ['y0', 'y1']) if (Math.abs(p.y - S.strips[k][e]) <= tol) return { type: 'sedge', k, e };
      const ga = G.Quant.region(S);
      if (q) for (let k = 0; k < S.quant.rows.length; k++) { const sp = spanOf(S.quant.rows[k]); if (p.y > sp.y0 && p.y < sp.y1 && p.x >= ga.x && p.x <= ga.x + ga.w) return { type: 'qbody', k }; }
    }
    if (inY) for (let i = 0; i < S.lanes.length; i++) if (Math.abs(p.x - S.lanes[i].x) <= tol) return { type: 'lane', i };
    if (inY && Math.abs(p.x - c.x) <= tol) return { type: 'crop', k: 'w' };
    if (inY && Math.abs(p.x - c.x - c.w) <= tol) return { type: 'crop', k: 'e' };
    if (inX && Math.abs(p.y - c.y) <= tol) return { type: 'crop', k: 'n' };
    if (inX && Math.abs(p.y - c.y - c.h) <= tol) return { type: 'crop', k: 's' };
    if (shift && inX && inY) return { type: 'cropmove' };
    if (inX && inY) return { type: 'inside' };
    return { type: 'pan' };
  }

  const CURSORS = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' };
  function cursorFor(h) {
    if (!h) return 'default';
    if (h.type === 'crop') return CURSORS[h.k];
    if (h.type === 'corner' || h.type === 'edge') return 'move';
    if (h.type === 'lane') return 'ew-resize';
    if (h.type === 'band' || h.type === 'arrow' || h.type === 'qedge' || h.type === 'sedge') return 'ns-resize';
    if (h.type === 'qbody') return 'move';
    if (h.type === 'cropmove') return 'move';
    return 'grab';
  }

  /* Pointer input (mouse, pen and touch). Two fingers pinch-zoom and pan; one finger behaves like
   * the mouse. Strip / band-box modes create a region by dragging (or a click: a box sized to the band). */
  const touches = new Map();
  let pinch = null;
  const setCreating = c => { creating = c; };
  cv.addEventListener('pointerdown', (e) => {
    if (!App.S) return;
    box.focus({ preventScroll: true });
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2) {
        // a second finger turns any drag into a pinch
        drag = null; creating = null;
        const [p1, p2] = [...touches.values()], r = cv.getBoundingClientRect();
        pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, mx: (p1.x + p2.x) / 2 - r.left, my: (p1.y + p2.y) / 2 - r.top, view0: Object.assign({}, view) };
        e.preventDefault(); return;
      }
    }
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ }
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const p = toImg(sx, sy);
    // placing a target-band arrow: one click, snapped to the band under the cursor
    if (App.mode === 'arrow') {
      const c = App.S.crop;
      if (p.y >= c.y && p.y <= c.y + c.h && App.placeArrow) App.placeArrow(p.x, p.y);
      e.preventDefault();
      return;
    }
    if (App.mode === 'strip' || App.mode === 'quant') {
      const c = App.S.crop;
      if (p.y >= c.y && p.y <= c.y + c.h) { setCreating({ mode: App.mode, y0: p.y, y1: p.y, x: p.x, sy }); draw(); }
      e.preventDefault();
      return;
    }
    // adding a lane: one click places the line where the pointer is (lanes are global, so a click
    // outside the red box adds a well outside the figure range); Shift keeps the tool armed
    if (App.mode === 'lane') {
      if (p.x >= 0 && p.x <= App.rot.w) {
        App.selLane = App.addLane(Math.round(p.x * 10) / 10);
        App.commit();
        if (!e.shiftKey && G.FigEdit) G.FigEdit.setMode(null);
      }
      e.preventDefault();
      return;
    }
    const h = hitTest(sx, sy, e.shiftKey);
    drag = { h, sx, sy, p0: p, crop0: Object.assign({}, App.S.crop), moved: false, view0: Object.assign({}, view) };
    if ((h.type === 'crop' || h.type === 'cropmove') && App.onCropStart) App.onCropStart();   // a pending re-detection waits for this drag
    if (h.type === 'corner' || h.type === 'edge') drag.corners = App.geomCornersWork().map(c => c.slice());
    if (h.type === 'lane') {
      // Shift / Ctrl + click adds the lane to the selection (or takes it out); a drag moves every selected lane together
      const multi = e.shiftKey || e.ctrlKey || e.metaKey;
      if (multi) { const s = new Set(App.selLanes); if (s.has(h.i)) s.delete(h.i); else s.add(h.i); App.selectLanes([...s], h.i); }
      else if (!App.selLanes.has(h.i)) App.selLane = h.i;
      else App._selLane = h.i;
      App.selArrow = -1;
      drag.lanes = (App.selLanes.has(h.i) ? [...App.selLanes] : [h.i]).map(i => [App.S.lanes[i], App.S.lanes[i].x]);
      App.emit('select');
    }
    else if (h.type === 'arrow') { App.selArrow = h.i; App.selLane = -1; drag.y0 = App.S.arrows[h.i].y; App.emit('select'); }
    else if (h.type === 'band') { drag.y0 = App.S.markers[h.m].bands[h.i].y; }
    else if (h.type === 'qedge') { const r = App.S.quant.rows[h.k]; if (r.frame) { const sp = G.Quant.rowSpan(App, r); drag.span = [sp.y0, sp.y1]; drag.y0 = h.e === 'y0' ? sp.y0 : sp.y1; drag.placed = r.placed || 1; } else drag.y0 = r[h.e]; }
    else if (h.type === 'sedge') { drag.y0 = App.S.strips[h.k][h.e]; }
    else if (h.type === 'qbody') { const q = App.S.quant.rows[h.k]; if (q.frame) { const sp = G.Quant.rowSpan(App, q); drag.q0 = [sp.y0, sp.y1]; drag.placed = q.placed || 1; } else drag.q0 = [q.y0, q.y1]; }
    if (h.type === 'inside' || h.type === 'qbody') {
      let best = -1, bd = Infinity;
      App.S.lanes.forEach((l, i) => { const d = Math.abs(l.x - p.x); if (d < bd) { bd = d; best = i; } });
      drag.pickLane = bd <= App.S.laneHalfW * 1.6 ? best : -1;
    }
    cv.style.cursor = (h.type === 'pan' || h.type === 'inside') ? 'grabbing' : cursorFor(h);
    e.preventDefault();
  });

  window.addEventListener('pointermove', (e) => {
    if (!App.S) return;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (pinch) {
      if (touches.size < 2) return;
      const [p1, p2] = [...touches.values()], d = Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1;
      const mx = (p1.x + p2.x) / 2 - r.left, my = (p1.y + p2.y) / 2 - r.top, v0 = pinch.view0;
      const ns = Math.max(0.02, Math.min(40, v0.s * d / pinch.d));
      view.s = ns; view.ox = mx - (pinch.mx - v0.ox) * ns / v0.s; view.oy = my - (pinch.my - v0.oy) * ns / v0.s;
      draw(); refreshZoom(); return;
    }
    if (creating) {
      const p = toImg(sx, sy), c = App.S.crop;
      creating.y1 = Math.max(c.y, Math.min(c.y + c.h, p.y));
      if (Math.abs(sy - creating.sy) > 4) creating.moved = true;
      draw(); return;
    }
    if (!drag) {
      if (e.target !== cv) return;
      if (App.mode === 'arrow') {
        const p = toImg(sx, sy), c = App.S.crop;
        const inC = p.y >= c.y && p.y <= c.y + c.h && p.x >= c.x && p.x <= c.x + c.w;
        hover = { type: 'arm', snapY: inC ? (App.snapBandY(p.x, p.y) ?? p.y) : null };
        cv.style.cursor = 'crosshair'; draw();
        return;
      }
      if (App.mode === 'strip' || App.mode === 'quant') { cv.style.cursor = 'crosshair'; return; }
      if (App.mode === 'lane') { hover = { type: 'laneGhost', x: toImg(sx, sy).x }; cv.style.cursor = 'crosshair'; draw(); return; }
      const h = hitTest(sx, sy, e.shiftKey);
      const changed = JSON.stringify(h) !== JSON.stringify(hover);
      hover = h; cv.style.cursor = cursorFor(h);
      if (changed) draw();
      return;
    }
    const p = toImg(sx, sy), dx = p.x - drag.p0.x, dy = p.y - drag.p0.y;
    if (Math.abs(sx - drag.sx) + Math.abs(sy - drag.sy) > 2) drag.moved = true;
    const S = App.S, h = drag.h, rot = App.rot;
    if (h.type === 'pan' || h.type === 'inside') { view.ox = drag.view0.ox + (sx - drag.sx); view.oy = drag.view0.oy + (sy - drag.sy); draw(); return; }
    if (h.type === 'corner') { drag.corners[h.k] = [E_clamp(p.x, 0, rot.w), E_clamp(p.y, 0, rot.h)]; draw(); return; }
    if (h.type === 'edge') {
      // the side slides along its own normal by the pointer's travel projected on it
      const q0 = App.geomCornersWork(), a = q0[h.k], b = q0[(h.k + 1) % 4], ex = b[0] - a[0], ey = b[1] - a[1], len = Math.hypot(ex, ey) || 1, nx = -ey / len, ny = ex / len;
      const d = dx * nx + dy * ny;
      drag.corners[h.k] = [E_clamp(a[0] + d * nx, 0, rot.w), E_clamp(a[1] + d * ny, 0, rot.h)];
      drag.corners[(h.k + 1) % 4] = [E_clamp(b[0] + d * nx, 0, rot.w), E_clamp(b[1] + d * ny, 0, rot.h)];
      draw(); return;
    }
    if (h.type === 'crop' || h.type === 'cropmove') {
      const c0 = drag.crop0;
      let x0 = c0.x, y0 = c0.y, x1 = c0.x + c0.w, y1 = c0.y + c0.h;
      if (h.type === 'cropmove') {
        const mdx = E_clamp(dx, -x0, rot.w - x1), mdy = E_clamp(dy, -y0, rot.h - y1);
        x0 += mdx; x1 += mdx; y0 += mdy; y1 += mdy;
      } else {
        // left/right edges snap to the gap between lanes (Alt = free)
        const sn = v => (e.altKey ? v : App.snapCropX(v));
        if (h.k.includes('w')) x0 = Math.min(x1 - 10, Math.max(0, sn(c0.x + dx)));
        if (h.k.includes('e')) x1 = Math.max(x0 + 10, Math.min(rot.w, sn(c0.x + c0.w + dx)));
        if (h.k.includes('n')) y0 = Math.min(y1 - 10, Math.max(0, c0.y + dy));
        if (h.k.includes('s')) y1 = Math.max(y0 + 10, Math.min(rot.h, c0.y + c0.h + dy));
      }
      S.crop = { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    } else if (h.type === 'lane') {
      drag.lanes.forEach(([l, x0]) => { l.x = Math.max(0, Math.min(rot.w, x0 + dx)); });
    } else if (h.type === 'band') {
      const b = S.markers[h.m].bands[h.i];
      b.y = Math.max(0, Math.min(rot.h, drag.y0 + dy)); b.manual = true; b.matched = false;
    } else if (h.type === 'arrow') {
      S.arrows[h.i].y = Math.max(0, Math.min(rot.h, drag.y0 + dy));
    } else if (h.type === 'qedge') {
      const r = S.quant.rows[h.k], v = Math.max(0, Math.min(rot.h, drag.y0 + dy));
      // editing a band places it again in the frame shown now: an explicit analysis change (one, however long the drag)
      if (drag.span) { const ny = h.e === 'y0' ? [v, drag.span[1]] : [drag.span[0], v]; G.Quant.editRow(App, r, ny[0], ny[1]); r.placed = drag.placed + 1; }
      else r[h.e] = v;
    } else if (h.type === 'sedge') {
      S.strips[h.k][h.e] = Math.max(0, Math.min(rot.h, drag.y0 + dy));
    } else if (h.type === 'qbody') {
      const q = S.quant.rows[h.k], d = E_clamp(dy, -Math.min(...drag.q0), rot.h - Math.max(...drag.q0));
      if (drag.placed != null) { G.Quant.editRow(App, q, drag.q0[0] + d, drag.q0[1] + d); q.placed = drag.placed + 1; }
      else { q.y0 = drag.q0[0] + d; q.y1 = drag.q0[1] + d; }
    }
    draw(); App.refresh();
  });
  function E_clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function endPointer(e) {
    if (e && e.pointerType === 'touch') { touches.delete(e.pointerId); if (pinch) { if (touches.size < 2) pinch = null; return; } }
    if (creating) {
      const c = creating; creating = null;
      if (App.finishRegion) App.finishRegion(c.mode, c.moved ? Math.min(c.y0, c.y1) : null, c.moved ? Math.max(c.y0, c.y1) : null, c.x, c.y0);
      draw();
      return;
    }
    if (!drag) return;
    const d = drag; drag = null;
    const S = App.S;
    if (!d.moved) {
      if (d.h.type === 'inside' || d.h.type === 'qbody') { App.selLane = d.pickLane; App.selArrow = -1; App.emit('select'); draw(); }
      if (d.h.type === 'pan') { App.selLane = -1; App.selArrow = -1; App.emit('select'); draw(); }
      cv.style.cursor = cursorFor(hover);
      return;
    }
    if (d.h.type === 'crop' || d.h.type === 'cropmove') { App.updateSaturation(); if (App.onCropDone) App.onCropDone(); else if (App.afterRangeChange) App.afterRangeChange(); }
    if (d.h.type === 'corner' || d.h.type === 'edge') { App.pendingCorners = d.corners; draw(); return; }   // applied with the Apply button
    if (d.h.type === 'lane') { const prim = S.lanes[d.h.i], objs = d.lanes.map(([l]) => l); objs.forEach(o => { o.manual = true; }); App.sortLanesIfNeeded(); App.selectLanes(objs.map(o => S.lanes.indexOf(o)), S.lanes.indexOf(prim)); }
    // a dragged arrow takes its size from where it now sits: a typed size no longer applies
    if (d.h.type === 'arrow') { const a = S.arrows[d.h.i]; if (a && a.sizeText && App.parseSize(a.sizeText) != null) a.sizeText = ''; }
    if (d.h.type === 'band') App.matchMarkers(false);
    if (d.h.type !== 'pan' && d.h.type !== 'inside') App.commit();
    cv.style.cursor = cursorFor(hover);
  }
  window.addEventListener('pointerup', endPointer);
  window.addEventListener('pointercancel', e => { if (e.pointerType === 'touch') touches.delete(e.pointerId); pinch = null; if (creating) { creating = null; draw(); } });

  cv.addEventListener('dblclick', (e) => {
    if (!App.S) return;
    const r = cv.getBoundingClientRect(), p = toImg(e.clientX - r.left, e.clientY - r.top), c = App.S.crop;
    if (p.x < c.x || p.x > c.x + c.w || p.y < c.y || p.y > c.y + c.h) return;
    App.selLane = App.addLane(p.x);
    App.commit();
  });

  cv.addEventListener('wheel', (e) => {
    if (!App.S) return;
    e.preventDefault();
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    const ns = Math.max(0.02, Math.min(40, view.s * k));
    view.ox = sx - (sx - view.ox) * ns / view.s; view.oy = sy - (sy - view.oy) * ns / view.s; view.s = ns;
    draw(); refreshZoom();
  }, { passive: false });

  // space = temporary pan mode
  window.addEventListener('keydown', e => {
    if (e.code === 'Space' && !spaceDown && !/input|textarea|select/i.test((e.target.tagName || ''))) {
      spaceDown = true; cv.style.cursor = 'grab'; e.preventDefault();
    }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') { spaceDown = false; cv.style.cursor = cursorFor(hover); }
  });

  // deleting / nudging only when the image area itself has focus — never while typing anywhere
  box.addEventListener('keydown', (e) => {
    if (!App.S || e.target !== box) return;
    if (e.key === 'Delete') {
      if (App.selLanes.size) { [...App.selLanes].sort((a, b) => b - a).forEach(i => App.removeLane(i)); App.selLane = -1; App.commit(); e.preventDefault(); }
      else if (App.selArrow >= 0) { App.S.arrows.splice(App.selArrow, 1); App.selArrow = -1; App.commit(); e.preventDefault(); }
    }
    // H: cut the selected lane from the figure / bring it back (splice gap added automatically)
    if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && App.selLane >= 0 && App.toggleLaneHidden) {
      const l = App.S.lanes[App.selLane];
      App.toggleLaneHidden(App.selLane, !l.hidden).then(ok => { if (ok) App.commit(); });
      e.preventDefault();
    }
    if (App.selLanes.size && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const d = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1);
      App.selLanes.forEach(i => { App.S.lanes[i].x += d; });
      App.commit(); e.preventDefault();
    }
  });

  ['dragenter', 'dragover'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.add('drag'); }));
  // the drop itself bubbles to the window-level handler (ui.js), which loads every dropped file
  ['dragleave', 'drop'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.remove('drag'); }));

  function refreshZoom() { const el = document.getElementById('zoomLabel'); if (el) el.textContent = Math.round(view.s * 100) + '%'; }

  new ResizeObserver(resize).observe(box);
  App.on(w => {
    if (w === 'loaded') { document.getElementById('dropHint').classList.add('hidden'); resize(); fitCrop(); }
    else draw();
  });

  function setGrid(on) { if (gridOn !== !!on) { gridOn = !!on; draw(); } }
  // toScreen / toImage: canvas pixel <-> rotated-image pixel (used by the self-tests to click real positions)
  G.Editor = { draw, resize, fitFull, fitCrop, zoom: () => view.s, refreshZoom, setGrid, toScreen: toScr, toImage: toImg, hit: (sx, sy) => hitTest(sx, sy, false), hoverType: () => (hover ? hover.type : null), setCorners: on => { cornersOn = !!on; draw(); }, setOriginal: on => { origOn = !!on; draw(); }, original: () => origOn };
})(window);

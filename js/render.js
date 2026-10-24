/* Figure renderer: project state -> publication SVG (units = pt, 1 pt = 1/72 in).
 * Gel image is embedded as a raster; every label, line and tick is vector.
 */
(function (G) {
  'use strict';
  const MM = 72 / 25.4;
  /* Figure typefaces: names only, installed system fonts, never downloaded or embedded. One list serves
   * measurement, the SVG, the PDF (Arial and Helvetica share metrics; Times New Roman = Times) and
   * imported styles; anything else falls back to Arial. */
  const FONTS = Object.freeze({ Arial: 'Arial, Helvetica, sans-serif', Helvetica: 'Helvetica, Arial, sans-serif', 'Times New Roman': '"Times New Roman", Times, serif' });
  const fontName = n => (Object.prototype.hasOwnProperty.call(FONTS, n) ? n : 'Arial');
  let family = 'Arial';   // the figure font of the last build(); measure() and the PDF writer follow it
  const setFont = n => { family = fontName(n); };
  // a lane-name angle: 'auto' or a whole number of degrees 0–90
  const labelAngle = v => (v === 'auto' || v == null || v === '' || !isFinite(+v) ? 'auto' : Math.max(0, Math.min(90, Math.round(+v))));

  const mctx = document.createElement('canvas').getContext('2d');
  // label markup: *italic* segments
  function parseRuns(text) {
    const parts = String(text).split('*');
    return parts.map((t, i) => ({ t, it: i % 2 === 1 })).filter(r => r.t.length);
  }
  function measure(text, pt, bold) {
    let w = 0;
    for (const r of parseRuns(text)) {
      mctx.font = `${r.it ? 'italic ' : ''}${bold ? 'bold ' : ''}${pt * 4}px ${FONTS[family]}`;
      w += mctx.measureText(r.t).width / 4;
    }
    return w;
  }
  /* ---- group labels: typed line breaks, then wrap / shrink / keep one line (after GelFigure 0.6.5) ----
   * Tokens: a CJK character breaks anywhere; other text breaks after a space, "-" or "/". */
  const CJK = '\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef';
  const TOKENS = new RegExp(`[${CJK}]|[^\\s\\-\\/${CJK}]+[-\\/]?|[-\\/]|\\s+`, 'g');
  const MIN_PT = 5;
  function greedyLines(text, maxW, pt) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const toks = para.match(TOKENS) || [];
      let line = '', lw = 0;
      for (const tk of toks) {
        const sp = /^\s+$/.test(tk);
        if (!line && sp) continue;
        const tw = measure(tk.replace(/\*/g, ''), pt);
        if (line && !sp && lw + tw > maxW + 1e-6) { out.push(line.trimEnd()); line = ''; lw = 0; }
        line += tk; lw += tw;
      }
      out.push(line.trimEnd());
    }
    // *italic* markup continues across a break: close it at the end of a line and reopen on the next
    let open = false;
    return out.map(l => {
      let t = open ? '*' + l : l;
      if ((t.split('*').length - 1) % 2) { t += '*'; open = true; } else open = false;
      return t;
    });
  }
  // the fewest lines that fit, then the narrowest width that still gives that many, so the lines come out even
  function wrapLines(text, maxW, pt) {
    const k = greedyLines(text, maxW, pt).length;
    if (k < 2) return greedyLines(text, maxW, pt);
    let lo = maxW * 0.2, hi = maxW;
    for (let i = 0; i < 14; i++) { const mid = (lo + hi) / 2; if (greedyLines(text, mid, pt).length > k) lo = mid; else hi = mid; }
    return greedyLines(text, hi, pt);
  }
  /* lines and font size for one group label of width `room` under `fit` ('wrap' | 'shrink' | 'line') */
  function fitLabel(text, room, pt, fit) {
    const typed = String(text).split('\n');
    const widest = ls => Math.max(...ls.map(l => measure(l, pt)));
    if (fit === 'wrap') return { lines: wrapLines(text, Math.max(room, pt * 1.5), pt), pt };
    if (fit === 'shrink') { const w = widest(typed); return { lines: typed, pt: w > room ? Math.max(MIN_PT, pt * room / w) : pt }; }
    return { lines: typed, pt };
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function textEl(text, x, y, pt, anchor, extra) {
    const runs = parseRuns(text).map(r => r.it ? `<tspan font-style="italic">${esc(r.t)}</tspan>` : esc(r.t)).join('');
    return `<text x="${f(x)}" y="${f(y)}" font-size="${f(pt)}" text-anchor="${anchor}"${extra || ''}>${runs}</text>`;
  }
  function f(v) { return (Math.round(v * 100) / 100).toString(); }

  // Lane column boundaries in crop pixels
  function laneBounds(lanes, cropW) {
    const xs = lanes.map(l => l.x);
    return xs.map((x, i) => [
      i === 0 ? Math.max(0, x - (xs.length > 1 ? (xs[1] - x) / 2 : cropW)) : (xs[i - 1] + x) / 2,
      i === xs.length - 1 ? Math.min(cropW, x + (xs.length > 1 ? (x - xs[i - 1]) / 2 : cropW)) : (x + xs[i + 1]) / 2
    ]);
  }

  // Segments of consecutive visible lanes (hidden lanes are cut out, splice marked with a gap/line)
  function segments(S, cropW) {
    const lanes = S.lanes;
    if (!lanes.length || !lanes.some(l => l.hidden)) return [{ x0: 0, x1: cropW, lanes: lanes.map((_, i) => i) }];
    const b = laneBounds(lanes, cropW);
    const segs = [];
    let cur = null;
    lanes.forEach((l, i) => {
      if (l.hidden) { cur = null; return; }
      if (!cur) { cur = { x0: b[i][0], x1: b[i][1], lanes: [i] }; segs.push(cur); }
      else { cur.x1 = b[i][1]; cur.lanes.push(i); }
    });
    if (segs.length) {
      if (segs[0].lanes[0] === 0) segs[0].x0 = 0;
      const last = segs[segs.length - 1];
      if (last.lanes[last.lanes.length - 1] === lanes.length - 1) last.x1 = cropW;
    }
    return segs;
  }

  // Compose processed gel (canvas of the crop) into final panel raster, cutting hidden lanes and, when
  // strips are set, stacking only those horizontal regions with a white gap between them.
  // Returns {canvas, map(xCropPx) -> x in panel px, mapY(yCropPx) -> y in panel px or null, segs, vsegs, gapPx}
  function composeGel(S, cropCanvas, scalePtPerPx) {
    const W = cropCanvas.width, H = cropCanvas.height;
    const segs = segments(S, W);
    const st = S.style;
    const gapPx = segs.length > 1 ? Math.max(1, Math.round((st.spliceStyle === 'line' ? 0 : st.spliceGapPt) / scalePtPerPx)) : 0;
    let total = 0;
    segs.forEach(s => { s.px0 = Math.round(s.x0); s.px1 = Math.round(s.x1); s.off = total; total += s.px1 - s.px0 + gapPx; });
    total -= gapPx;
    const strips = (S.strips || []).length ? S.strips : [{ y0: 0, y1: H, label: '' }];
    const vgap = strips.length > 1 ? Math.max(1, Math.round((st.stripGapPt != null ? st.stripGapPt : 3) / scalePtPerPx)) : 0;
    let totalH = 0;
    const vsegs = strips.map(r => {
      const v = { py0: Math.max(0, Math.round(r.y0)), py1: Math.min(H, Math.round(r.y1)), label: r.label, k: r.k };
      v.off = totalH; totalH += v.py1 - v.py0 + vgap;
      return v;
    });
    totalH -= vgap;
    const c = document.createElement('canvas');
    c.width = Math.max(1, total); c.height = Math.max(1, totalH);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    vsegs.forEach(v => segs.forEach(s => ctx.drawImage(cropCanvas, s.px0, v.py0, s.px1 - s.px0, v.py1 - v.py0, s.off, v.off, s.px1 - s.px0, v.py1 - v.py0)));
    const map = (x) => {
      for (const s of segs) if (x >= s.px0 - 0.5 && x <= s.px1 + 0.5) return s.off + (x - s.px0);
      return x;
    };
    const mapY = (y) => {
      for (const v of vsegs) if (y >= v.py0 - 0.5 && y <= v.py1 + 0.5) return v.off + (y - v.py0);
      return null;
    };
    return { canvas: c, map, mapY, segs, vsegs, gapPx, vgap };
  }

  function autoAngle(labels, pitchPt, pt) {
    const maxW = Math.max(0, ...labels.map(t => measure(t, pt)));
    if (maxW <= pitchPt * 0.9) return 0;
    if (pitchPt >= pt * 1.6) return 45;
    return 90;
  }

  // Assign tiers so overlapping groups stack: by extent in points (the line, or the label when it is
  // wider), narrowest first so it sits closest to the gel
  function groupTiers(ext, pad) {
    const tiers = [];
    const sorted = ext.map((e, i) => ({ i, a: e[0] - pad, b: e[1] + pad })).sort((p, q) => (p.b - p.a) - (q.b - q.a));
    const out = new Array(ext.length).fill(0);
    for (const s of sorted) {
      let t = 0;
      while ((tiers[t] || []).some(o => !(s.b < o.a || s.a > o.b))) t++;
      (tiers[t] = tiers[t] || []).push(s);
      out[s.i] = t;
    }
    return out;
  }

  /* Build SVG. imgHref = data URL / blob URL of composed gel raster. Returns {svg, w, h, warnings} */
  function build(S, gel, imgHref) {
    const st = S.style, pt = st.fontPt, lw = st.lineWidthPt;
    setFont(st.font);
    const warnings = [], overlaps = [];
    const overlap = msg => { warnings.push(msg); overlaps.push(msg); };
    let minPt = Infinity;   // the smallest text actually printed (a shrunk group label can go below the figure font)
    const Wpx = gel.canvas.width, Hpx = gel.canvas.height;
    const W = st.gelWidthMm * MM, sc = W / Wpx, H = Hpx * sc;
    const els = [];
    const box = { x0: 0, y0: 0, x1: W, y1: H };
    const grow = (x0, y0, x1, y1) => { box.x0 = Math.min(box.x0, x0); box.y0 = Math.min(box.y0, y0); box.x1 = Math.max(box.x1, x1); box.y1 = Math.max(box.y1, y1); };

    els.push(`<image ${S.preview ? 'data-edit="gel" ' : ''}x="0" y="0" width="${f(W)}" height="${f(H)}" preserveAspectRatio="none" href="${imgHref}" xlink:href="${imgHref}"/>`);
    const vsegs = gel.vsegs || [{ off: 0, py0: 0, py1: Hpx }];
    const mapY = gel.mapY || (y => y);
    // splice marker lines (one piece per strip: a line never crosses the gap between strips)
    if (gel.segs.length > 1 && st.spliceStyle === 'line') {
      gel.segs.slice(1).forEach(s => {
        const x = s.off * sc;
        vsegs.forEach(v => els.push(`<line x1="${f(x)}" y1="${f(v.off * sc)}" x2="${f(x)}" y2="${f((v.off + v.py1 - v.py0) * sc)}" stroke="${S.levels.invert ? '#000' : '#fff'}" stroke-width="${f(lw)}"/>`));
      });
    }
    if (st.frame) vsegs.forEach(v => els.push(`<rect x="0" y="${f(v.off * sc)}" width="${f(W)}" height="${f((v.py1 - v.py0) * sc)}" fill="none" stroke="#000" stroke-width="${f(lw)}"/>`));

    const vis = S.lanes.map((l, i) => ({ l, i })).filter(o => !o.l.hidden);
    const X = (i) => gel.map(S.lanes[i].x) * sc;
    let pitch = Infinity;
    for (let k = 1; k < vis.length; k++) pitch = Math.min(pitch, X(vis[k].i) - X(vis[k - 1].i));
    if (!isFinite(pitch)) pitch = W;

    // ---- top stack (y grows negative) ----
    let yTop = -st.labelGapPt;
    // lane numbers
    if (st.laneNumbers && vis.length) {
      // default: the well number, so the figure matches the notebook even after lanes are cut
      let n = 0;
      vis.forEach(o => { n++; const num = st.laneNumberMode === 'seq' ? n : (o.l.src != null ? o.l.src : o.i) + 1; els.push(textEl(String(num), X(o.i), yTop, pt, 'middle')); });
      yTop -= pt * 1.25;
    }
    // condition rows (+/- matrix), bottom row closest to gel
    // preview mode: editable elements carry data-edit, empty slots show grey placeholders
    const P = !!S.preview;
    const ed = (attrs, inner) => P ? `<g ${attrs} class="ed">${inner}</g>` : inner;
    const phStyle = ' fill="#b4bcc6"';
    const conds = (S.conditions || []).map((c, r) => Object.assign({ r }, c)).filter(c => P || c.name || c.values.some(v => v));
    const rowNameX = -st.labelGapPt * 2;
    for (let k = conds.length - 1; k >= 0; k--) {
      const c = conds[k];
      vis.forEach(o => {
        const v = c.values[o.i], src = o.l.src != null ? o.l.src : o.i;
        if ((S.markers || []).some(m => m.lane === src)) return;   // a ladder lane has no condition
        // a wide invisible hit area makes each cell easy to click in the preview
        const hit = P ? `<rect x="${f(X(o.i) - Math.min(pitch, 20) * 0.45)}" y="${f(yTop - pt)}" width="${f(Math.min(pitch, 20) * 0.9)}" height="${f(pt * 1.25)}" fill="transparent"/>` : '';
        if (v) els.push(ed(`data-edit="cond" data-r="${c.r}" data-src="${src}"`, hit + textEl(v, X(o.i), yTop, pt, 'middle')));
        else if (P) els.push(ed(`data-edit="cond" data-r="${c.r}" data-src="${src}"`, hit + textEl('·', X(o.i), yTop, pt, 'middle', phStyle)));
      });
      const nm = c.name || (P ? 'Condition' : '');
      if (nm) {
        els.push(ed(`data-edit="condname" data-r="${c.r}"`, textEl(nm, rowNameX, yTop, pt, 'end', c.name ? '' : phStyle)));
        grow(rowNameX - measure(nm, pt), yTop - pt, 0, yTop);
      }
      yTop -= pt * 1.3;
    }
    // lane names (placeholders in preview: the well number)
    const names = vis.map(o => o.l.name || (P ? String((o.l.src != null ? o.l.src : o.i) + 1) : ''));
    const hasNames = names.some(t => t.trim());
    let angle = 0;
    // baseline of the lane-name row: the (bp) unit header is aligned to this, not to the marker labels
    const unitRowY = yTop;
    if (hasNames) {
      angle = labelAngle(st.labelAngle) === 'auto' ? autoAngle(names, pitch, pt) : labelAngle(st.labelAngle);
      const rad = angle * Math.PI / 180, sn = Math.sin(rad), cs = Math.cos(rad);
      let hMax = pt;
      vis.forEach((o, vi) => {
        const t = names[vi];
        if (!t.trim()) return;
        const extra = o.l.name ? '' : phStyle, src = o.l.src != null ? o.l.src : o.i;
        const tw = measure(t, pt), x = X(o.i);
        if (angle === 0 || !o.l.name) {
          // placeholders stay horizontal: a rotated lone digit reads like a stray glyph
          els.push(ed(`data-edit="lane" data-src="${src}"`, textEl(t, x, yTop, pt, 'middle', extra)));
          grow(x - tw / 2, yTop - pt, x + tw / 2, yTop);
        } else {
          // rotated text grows up-right from the lane centre; offset so the text's centre line sits on the lane
          const ox = x + pt * 0.35 * sn, oy = yTop;
          els.push(ed(`data-edit="lane" data-src="${src}"`, `<g transform="translate(${f(ox)},${f(oy)}) rotate(${-angle})">${textEl(t, 0, 0, pt, 'start', extra)}</g>`));
          hMax = Math.max(hMax, tw * sn + pt * cs * 0.8);
          grow(ox - pt * sn, oy - tw * sn - pt * cs, ox + tw * cs + pt * sn * 0.2, oy);
        }
      });
      if (angle !== 0 && pitch < pt * 1.15) overlap('Lanes are too narrow: even 90° labels overlap; use a smaller font or a wider figure');
      if (angle === 0 && labelAngle(st.labelAngle) !== 'auto' && Math.max(...names.map(t => measure(t, pt))) > pitch * 1.02) overlap('Horizontal lane labels overlap; use "Auto" or a tilted angle');
      yTop -= (angle === 0 ? pt * 1.3 : hMax + pt * 0.35);
    }
    // groups: line spanning lanes + shared text above
    const groups = (S.groups || []).filter(g => g.from != null && g.to != null && S.lanes[g.from] && S.lanes[g.to]);
    if (groups.length) {
      const base = yTop - pt * 0.15, fit = st.groupFit || 'wrap';
      // geometry first: line pieces, then the label's lines and size, so wide labels can move up a tier
      const geo = groups.map(g => {
        const a = Math.min(g.from, g.to), b = Math.max(g.from, g.to);
        const half = Math.min(pitch, W) * 0.42;
        // one line over the whole group (the splice gap itself shows that a lane was removed), or, with
        // "Group lines break at splice gaps", one line piece per spliced segment
        const runs = [];
        gel.segs.forEach(sg => {
          const ins = (sg.lanes || []).filter(i => i >= a && i <= b && !S.lanes[i].hidden);
          if (ins.length) runs.push([X(ins[0]) - half, X(ins[ins.length - 1]) + half]);
        });
        if (!runs.length) runs.push([X(a) - half, X(b) + half]);
        if (!st.groupSplit && runs.length > 1) runs.splice(0, runs.length, [runs[0][0], runs[runs.length - 1][1]]);
        const x0 = runs[0][0], x1 = runs[runs.length - 1][1], cx = (x0 + x1) / 2;
        const gt = g.text || (P ? 'Click to type' : '');
        const lab = gt ? fitLabel(gt, x1 - x0 - pt * 0.3, pt, g.text ? fit : 'line') : { lines: [], pt };
        const tw = lab.lines.length ? Math.max(...lab.lines.map(l => measure(l, lab.pt))) : 0;
        const h = pt * 1.7 + Math.max(0, lab.lines.length - 1) * lab.pt * 1.15;   // one tier: line + one text line
        return { runs, x0, x1, cx, gt, lines: lab.lines, gp: lab.pt, tw, h, ext: [Math.min(x0, cx - tw / 2), Math.max(x1, cx + tw / 2)] };
      });
      const tiers = groupTiers(geo.map(q => q.ext), pt * 0.25);
      const tierH = [];
      geo.forEach((q, k) => { tierH[tiers[k]] = Math.max(tierH[tiers[k]] || 0, q.h); });
      const tierY = []; let acc = 0;
      tierH.forEach((hh, t) => { tierY[t] = base - acc; acc += hh; });
      groups.forEach((g, k) => {
        const q = geo[k], y = tierY[tiers[k]];
        q.runs.forEach(([r0, r1]) => {
          els.push(`<line x1="${f(r0)}" y1="${f(y)}" x2="${f(r1)}" y2="${f(y)}" stroke="#000" stroke-width="${f(lw)}"/>`);
          if (st.groupTicks) {
            els.push(`<line x1="${f(r0)}" y1="${f(y)}" x2="${f(r0)}" y2="${f(y + pt * 0.35)}" stroke="#000" stroke-width="${f(lw)}"/>`);
            els.push(`<line x1="${f(r1)}" y1="${f(y)}" x2="${f(r1)}" y2="${f(y + pt * 0.35)}" stroke="#000" stroke-width="${f(lw)}"/>`);
          }
        });
        if (q.lines.length) {
          const n = q.lines.length, lh = q.gp * 1.15;
          // one <text> per line, bottom line just above the group line (the PDF writer reads them as lines)
          const txt = q.lines.map((l, j) => textEl(l, q.cx, y - pt * 0.3 - (n - 1 - j) * lh, q.gp, 'middle', g.text ? '' : phStyle)).join('');
          els.push(ed(`data-edit="group" data-k="${g.k != null ? g.k : k}"`, txt));
          grow(q.cx - q.tw / 2, y - pt * 0.3 - (n - 1) * lh - q.gp, q.cx + q.tw / 2, y);
          if (q.gp < pt) minPt = Math.min(minPt, q.gp);
          if (q.tw > q.x1 - q.x0 + pt) overlap(`Group label “${q.gt.replace(/\n/g, ' ')}” is wider than its line; choose "wrap" under Layout or shorten it`);
        }
        grow(q.x0, y - pt, q.x1, y);
      });
      yTop = base - acc;
    }

    // ---- marker size labels (one column per marker; left/right of the gel) ----
    const tick = st.tickLenPt;
    const markers = (S.markers || []).filter(mk => mk.bands && mk.bands.length && S.lanes[mk.lane]);
    const sides = markers.map(mk => mk.side !== 'auto' ? mk.side : (S.lanes[mk.lane].x < S.crop.w / 2 ? 'left' : 'right'));
    // two auto markers on the same side: send the outer one to the other side
    if (markers.length === 2 && sides[0] === sides[1]) {
      if (markers[0].side === 'auto') sides[0] = 'left';
      if (markers[1].side === 'auto') sides[1] = 'right';
    }
    const extent = { left: 0, right: 0 };   // how far labels already reach beyond the gel edge
    markers.forEach((mk, mi) => {
      const side = sides[mi];
      const off = extent[side] ? extent[side] + 3 : 0;  // a second column on the same side sits further out
      const shown = mk.bands.filter(b => b.show && b.y != null && mapY(b.y) != null);
      let maxTw = 0;
      shown.forEach(b => {
        const y = mapY(b.y) * sc, label = G.Ladders.fmt(b.bp, mk.unit);
        const tw = measure(label, pt); maxTw = Math.max(maxTw, tw);
        if (side === 'left') {
          if (!off) els.push(`<line x1="${f(-tick - 1)}" y1="${f(y)}" x2="${f(-1)}" y2="${f(y)}" stroke="#000" stroke-width="${f(lw)}"/>`);
          els.push(textEl(label, -tick - 2.5 - off, y + pt * 0.35, pt, 'end'));
          grow(-tick - 2.5 - off - tw, y - pt, 0, y + pt);
        } else {
          if (!off) els.push(`<line x1="${f(W + 1)}" y1="${f(y)}" x2="${f(W + 1 + tick)}" y2="${f(y)}" stroke="#000" stroke-width="${f(lw)}"/>`);
          els.push(textEl(label, W + tick + 2.5 + off, y + pt * 0.35, pt, 'start'));
          grow(W, y - pt, W + tick + 2.5 + off + tw, y + pt);
        }
      });
      for (let k = 1; k < shown.length; k++) if (Math.abs(mapY(shown[k].y) - mapY(shown[k - 1].y)) * sc < pt * 0.95) {
        overlap('Some marker labels are too close and overlap; click "Thin labels" or untick some'); break;
      }
      const head = G.Ladders.unitHeader(mk.unit);
      if (st.unitHeader && shown.length && head) {
        const ux = side === 'left' ? -tick - 2.5 - off : W + tick + 2.5 + off;
        const uy = unitRowY, hw = measure(head, pt);
        els.push(textEl(head, ux, uy, pt, side === 'left' ? 'end' : 'start'));
        grow(side === 'left' ? ux - hw : ux, uy - pt * 1.2, side === 'left' ? 0 : ux + hw, uy + pt * 0.3);
      }
      extent[side] = tick + 2.5 + off + Math.max(maxTw, st.unitHeader && head ? measure(head, pt) : 0);
    });

    // ---- strip labels (protein / probe names) to the right of each strip ----
    const stripLab = (S.strips || []).length ? vsegs.map(v => ({ v, t: v.label || (P ? 'Click to name' : '') })) : [];
    if (stripLab.some(o => o.t)) {
      const off = extent.right ? extent.right + 3 : 0, x = W + 3 + off;
      let maxW = 0;
      stripLab.forEach(({ v, t }) => {
        if (!t) return;
        const y = (v.off + (v.py1 - v.py0) / 2) * sc + pt * 0.35, tw = measure(t, pt);
        maxW = Math.max(maxW, tw);
        els.push(ed(`data-edit="strip" data-k="${v.k}"`, textEl(t, x, y, pt, 'start', v.label ? '' : phStyle)));
        grow(W, y - pt, x + tw, y + pt * 0.3);
      });
      extent.right = 3 + off + maxW;
    }

    // ---- arrows (expected product): free side preferred, otherwise outside the marker labels ----
    const arrows = (S.arrows || []).filter(a => a.y != null);
    const defSide = !extent.right ? 'right' : !extent.left ? 'left' : 'right';
    // labels of arrows on the same side that would overlap are spread apart (the arrowhead stays on
    // its band; a label that had to move gets a short leader line)
    const placed = arrows.map((a, k) => ({ a, k, y: mapY(a.y) == null ? null : mapY(a.y) * sc, side: a.side || defSide })).filter(o => o.y != null);
    ['left', 'right'].forEach(side => {
      const col = placed.filter(o => o.side === side).sort((p, q) => p.y - q.y), gap = pt * 1.15;
      col.forEach(o => { o.ty = o.y; });
      for (let i = 1; i < col.length; i++) if (col[i].ty - col[i - 1].ty < gap) col[i].ty = col[i - 1].ty + gap;
      // centre the spread group back on its bands, but never above the first band's own row
      if (col.length > 1) {
        const shift = (col[col.length - 1].ty - col[col.length - 1].y) / 2;
        col.forEach(o => { o.ty -= shift; });
        for (let i = 1; i < col.length; i++) if (col[i].ty - col[i - 1].ty < gap) col[i].ty = col[i - 1].ty + gap;
      }
    });
    placed.forEach(({ a, k, y, side, ty }) => {
      const s = pt * 0.75, label = a.label != null ? a.label : (a.text || '');
      const off = extent[side] ? extent[side] + 2 : 0;
      const attrs = `data-edit="arrow" data-k="${a.k != null ? a.k : k}"`;
      const moved = Math.abs(ty - y) > 0.3;
      if (side === 'right') {
        const x = W + 1.5 + off, tw = measure(label, pt), lx = x + s * 1.3 + 2;
        const hit = P ? `<rect x="${f(x - 1)}" y="${f(Math.min(y, ty) - pt * 0.8)}" width="${f(s * 1.3 + 4 + tw)}" height="${f(Math.abs(ty - y) + pt * 1.6)}" fill="transparent"/>` : '';
        els.push(ed(attrs, hit + `<path d="M${f(x)},${f(y)} L${f(x + s * 1.3)},${f(y - s * 0.6)} L${f(x + s * 1.3)},${f(y + s * 0.6)} Z" fill="#000"/>` +
          (label && moved ? `<line x1="${f(x + s * 1.3)}" y1="${f(y)}" x2="${f(lx - 0.5)}" y2="${f(ty)}" stroke="#000" stroke-width="${f(lw)}"/>` : '') +
          (label ? textEl(label, lx, ty + pt * 0.35, pt, 'start') : '')));
        grow(W, Math.min(y, ty) - pt, lx + tw, Math.max(y, ty) + pt);
      } else {
        const x = -1.5 - off, tw = measure(label, pt), lx = x - s * 1.3 - 2;
        const hit = P ? `<rect x="${f(x - s * 1.3 - 3 - tw)}" y="${f(Math.min(y, ty) - pt * 0.8)}" width="${f(s * 1.3 + 4 + tw)}" height="${f(Math.abs(ty - y) + pt * 1.6)}" fill="transparent"/>` : '';
        els.push(ed(attrs, hit + `<path d="M${f(x)},${f(y)} L${f(x - s * 1.3)},${f(y - s * 0.6)} L${f(x - s * 1.3)},${f(y + s * 0.6)} Z" fill="#000"/>` +
          (label && moved ? `<line x1="${f(x - s * 1.3)}" y1="${f(y)}" x2="${f(lx + 0.5)}" y2="${f(ty)}" stroke="#000" stroke-width="${f(lw)}"/>` : '') +
          (label ? textEl(label, lx, ty + pt * 0.35, pt, 'end') : '')));
        grow(lx - tw, Math.min(y, ty) - pt, 0, Math.max(y, ty) + pt);
      }
    });

    // panel letter
    if (st.panelLetter) {
      const px = box.x0 - 2, py = box.y0 - 1;
      els.push(textEl(st.panelLetter, px, py + st.panelPt, st.panelPt, 'end', ' font-weight="bold"'));
      grow(px - measure(st.panelLetter, st.panelPt, true), py, px, py + st.panelPt);
    }

    const m = 2;
    const vx = box.x0 - m, vy = box.y0 - m, vw = box.x1 - box.x0 + 2 * m, vh = box.y1 - box.y0 + 2 * m;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
      `width="${f(vw / MM)}mm" height="${f(vh / MM)}mm" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" ` +
      `font-family="${esc(FONTS[family])}" fill="#000">` +
      `<rect x="${f(vx)}" y="${f(vy)}" width="${f(vw)}" height="${f(vh)}" fill="#fff"/>` +
      els.join('') + `</svg>`;
    return { svg, w: vw, h: vh, angle, warnings, overlaps, minPt: Math.min(minPt, pt), scale: sc, vx, vy, gelW: W, gelH: H };
  }

  // the legend notes as a block of wrapped text under a built figure (for exports and printing when asked for)
  function withNotes(fig, notes, pt) {
    const text = String(notes || '').trim();
    if (!text) return fig;
    const m = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(fig.svg);
    if (!m) return fig;
    const [vx, vy, vw, vh] = m.slice(1).map(Number), size = Math.max(6, pt || 7), lh = size * 1.3, maxW = vw - 4;
    const lines = [];
    text.split(/\s+/).forEach(w => {
      const last = lines[lines.length - 1];
      if (last != null && measure(last + ' ' + w, size) <= maxW) lines[lines.length - 1] = last + ' ' + w; else lines.push(w);
    });
    const top = vy + vh + size * 0.6, nh = vh + size * 0.6 + lines.length * lh + 2;
    const els = lines.map((l, k) => textEl(l, vx + 2, top + size + k * lh, size, 'start', ' fill="#000"')).join('');
    const svg = fig.svg
      .replace(/width="[-\d.]+mm" height="[-\d.]+mm" viewBox="[-\d. ]+"/, `width="${f(vw / MM)}mm" height="${f(nh / MM)}mm" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(nh)}"`)
      .replace(/(<rect x="[-\d.]+" y="[-\d.]+" width="[-\d.]+" height=")[-\d.]+(" fill="#fff"\/>)/, `$1${f(nh)}$2`)
      .replace(/<\/svg>$/, els + '</svg>');
    return Object.assign({}, fig, { svg, h: nh, notes: lines.length });
  }
  G.Render = { build, composeGel, measure, MM, laneBounds, withNotes, FONTS, fontName, setFont, font: () => family, labelAngle };
})(window);

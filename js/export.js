/* Export: PNG (DPI + sRGB + embedded processing summary), TIFF (LZW), SVG, PDF (vector), uncropped
 * figure-matched image, untouched original data, JSON processing log, densitometry CSV / chart. */
(function (G) {
  'use strict';

  // file types a Claude artifact viewer saves directly; anything else is handed over inside a .zip
  const HOST_TYPES = new Set(['gif', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'json', 'md', 'csv', 'html', 'svg', 'pdf', 'xlsx', 'zip', 'docx', 'pptx']);
  /* Save a file. Inside a Claude artifact the viewer is asked to confirm (the page itself may not
   * download); elsewhere it is an ordinary browser download. Resolves 'saved' | 'declined' | 'failed'. */
  async function download(blob, name) {
    if (!(blob instanceof Blob)) blob = new Blob([blob]);
    const dl = await G.Host.downloads();
    if (dl) {
      let data = blob, fname = name;
      const ext = (name.split('.').pop() || '').toLowerCase();
      if (!HOST_TYPES.has(ext)) { data = await G.Zip.make([{ name, data: blob }]); fname = name + '.zip'; }
      try { await dl.save({ filename: fname, data }); return 'saved'; } catch (e) {
        const code = e && e.code;
        if (code === 'declined') return 'declined';
        if (code === 'rate_limited') { if (G.UI) G.UI.toast('Another save prompt is still open; answer it first'); return 'failed'; }
        if (code === 'too_large') { if (G.App) G.App.notify('The file is too large to save here; try a lower export resolution'); return 'failed'; }
        // unavailable in this view: fall back to an ordinary download below
      }
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return 'saved';
  }

  // ---- PNG chunks ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function chunk(type, data) {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  }
  const latin1 = s => Uint8Array.from(String(s), ch => { const c = ch.charCodeAt(0); return c < 256 ? c : 63; });
  // iTXt keeps UTF-8 (Chinese lane names survive)
  function itxt(key, text) {
    const k = latin1(key), t = new TextEncoder().encode(text);
    const d = new Uint8Array(k.length + 5 + t.length);
    d.set(k, 0); d.set(t, k.length + 5);   // keyword\0, compression flag 0, method 0, empty lang\0, empty translated\0
    return chunk('iTXt', d);
  }
  /* Insert pHYs (dpi), sRGB and text metadata right after IHDR. dpi is the pixel density of THIS
   * raster (text and lines really are rendered at it); the gel's own effective dpi is written as
   * text and checked before export, never passed off as the raster density. */
  async function pngDecorate(blob, dpi, texts) {
    const src = new Uint8Array(await blob.arrayBuffer());
    const ppm = Math.round(dpi / 0.0254), ph = new Uint8Array(9), dv = new DataView(ph.buffer);
    dv.setUint32(0, ppm); dv.setUint32(4, ppm); ph[8] = 1;
    const parts = [chunk('pHYs', ph), chunk('sRGB', Uint8Array.of(0))];
    Object.entries(texts || {}).forEach(([k, v]) => parts.push(itxt(k, v)));
    // copy the encoder's chunks, dropping the ones we replace (each may appear only once; iCCP and
    // sRGB are mutually exclusive) and inserting ours right after IHDR
    const keep = [src.subarray(0, 33)];
    for (let p = 33; p + 8 <= src.length;) {
      const len = ((src[p] << 24) | (src[p + 1] << 16) | (src[p + 2] << 8) | src[p + 3]) >>> 0;
      const type = String.fromCharCode(src[p + 4], src[p + 5], src[p + 6], src[p + 7]);
      if (!['pHYs', 'sRGB', 'iCCP', 'gAMA', 'cHRM'].includes(type)) keep.push(src.subarray(p, p + 12 + len));
      p += 12 + len;
    }
    return new Blob([keep[0], ...parts, ...keep.slice(1)], { type: 'image/png' });
  }

  /* Browsers refuse or silently blank out very large canvases: Safari, and every browser on iOS and
   * iPadOS, above about 16.7 million pixels; others at 16384 px a side. A double-column figure at
   * 1200 dpi is past the first limit, so the size is checked before anything is drawn. */
  function rasterLimit() {
    const ua = navigator.userAgent || '';
    const apple = navigator.vendor === 'Apple Computer, Inc.' || /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    return apple ? { maxPixels: 16777216, maxSide: 32767, browser: 'Safari' } : { maxPixels: 268435456, maxSide: 16384, browser: 'this browser' };
  }
  // the pixel size of a raster export and whether this browser can draw it; fitsDpi = the largest offered
  // resolution that fits (null when even 300 dpi does not)
  function rasterSize(wPt, hPt, dpi) {
    const lim = rasterLimit();
    const fits = d => { const w = Math.round(wPt * d / 72), h = Math.round(hPt * d / 72); return w * h <= lim.maxPixels && w <= lim.maxSide && h <= lim.maxSide; };
    const w = Math.round(wPt * dpi / 72), h = Math.round(hPt * dpi / 72);
    return { w, h, px: w * h, ok: fits(dpi), fitsDpi: [1200, 600, 300].find(fits) || null, browser: lim.browser, maxPixels: lim.maxPixels };
  }
  const tooBig = (rs, dpi, what) => `${what} would be ${rs.w} × ${rs.h} px at ${dpi} dpi, more than ${rs.browser} can draw. ` + (rs.fitsDpi ? `Export at ${rs.fitsDpi} dpi.` : 'Make the figure smaller, or export SVG or PDF.');

  function loadSvg(svg) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not rasterise the SVG')); };
      img.src = url;
    });
  }
  async function svgToCanvas(svg, wPt, hPt, dpi) {
    const img = await loadSvg(svg), scale = dpi / 72;
    const c = document.createElement('canvas');
    c.width = Math.round(wPt * scale); c.height = Math.round(hPt * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  }
  // the SVG drawn in horizontal bands of a few million pixels each and read back as 8-bit grey, so a
  // TIFF can be larger than one canvas may be (only the width is bounded by the canvas side limit)
  async function svgToGray(svg, wPt, hPt, dpi) {
    const img = await loadSvg(svg), scale = dpi / 72, lim = rasterLimit();
    const w = Math.round(wPt * scale), h = Math.round(hPt * scale);
    const rows = Math.max(1, Math.min(h, Math.floor(Math.min(lim.maxPixels / 2, 8e6) / w)));
    const g = new Uint8Array(w * h);
    const c = document.createElement('canvas'); c.width = w; c.height = rows;
    const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
    for (let y0 = 0; y0 < h; y0 += rows) {
      const hh = Math.min(rows, h - y0);
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, rows);
      ctx.drawImage(img, 0, -y0, w, h);
      const id = ctx.getImageData(0, 0, w, hh).data, n = w * hh, base = y0 * w;
      for (let i = 0; i < n; i++) g[base + i] = Math.round(0.299 * id[i * 4] + 0.587 * id[i * 4 + 1] + 0.114 * id[i * 4 + 2]);
    }
    return { gray: g, w, h };
  }

  // minimal summary embedded in exported rasters: the figure carries its own audit trail
  function summaryText(S) {
    const A = G.App, k = A.clipStats();
    return JSON.stringify({
      tool: A.NAME + ' ' + A.VERSION, experiment: S.gelType, source: S.file.name, sha256: S.file.sha256,
      rotationDeg: S.rotation, flip: flipText(S), geometry: keystoneText(S) || null, levels: S.levels, effectiveGelDpi: Math.round(A.effectiveDpi()),
      bandEndClippedFrac: +k.sensorFrac.toFixed(5), saturation: A.satReport().kind, levelClippedFrac: +A.bandClipFrac().toFixed(5),
      splicedLanes: S.lanes.map((l, i) => (l.hidden ? i + 1 : null)).filter(v => v != null),
      disclosure: legendHints(S).join(' ')
    });
  }

  async function exportPNG(svg, wPt, hPt, dpi, name, S) {
    const rs = rasterSize(wPt, hPt, dpi);
    if (!rs.ok) { G.App.notify(tooBig(rs, dpi, 'The PNG')); return 'failed'; }
    const c = await svgToCanvas(svg, wPt, hPt, dpi);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return download(await pngDecorate(blob, dpi, S ? { Software: G.App.NAME + ' ' + G.App.VERSION, Description: summaryText(S) } : {}), name);
  }

  // ---- TIFF (8-bit grayscale, LZW, with resolution) ----
  function lzwEncode(bytes) {
    const out = []; let acc = 0, nacc = 0, width = 9;
    const emit = c => { acc = (acc << width) | c; nacc += width; while (nacc >= 8) { out.push((acc >>> (nacc - 8)) & 255); nacc -= 8; } acc &= (1 << nacc) - 1; };
    let dict = new Map(), next = 258;
    emit(256);
    let w = bytes[0];
    for (let i = 1; i < bytes.length; i++) {
      const c = bytes[i], key = w * 256 + c;
      const hit = dict.get(key);
      if (hit !== undefined) { w = hit; continue; }
      emit(w);
      dict.set(key, next++);
      if (next > (1 << width) - 1 && width < 12) width++;
      if (next >= 4094) { emit(256); dict = new Map(); next = 258; width = 9; }
      w = c;
    }
    emit(w); emit(257);
    if (nacc) out.push((acc << (8 - nacc)) & 255);
    return Uint8Array.from(out);
  }
  // one strip per ~64 KB of pixels keeps every LZW stream small and readers happy
  function encodeTiffGray(gray, w, h, dpi, desc) {
    const rps = Math.max(1, Math.floor(65536 / w)), nStrips = Math.ceil(h / rps);
    const strips = [];
    for (let s = 0; s < nStrips; s++) strips.push(lzwEncode(gray.subarray(s * rps * w, Math.min(h, (s + 1) * rps) * w)));
    const d = latin1(desc || ''), sw = latin1(G.App.NAME + ' ' + G.App.VERSION);
    const tags = 14;
    let off = 8 + 2 + tags * 12 + 4;
    const resOff = off; off += 16;
    const soOff = off; off += 4 * nStrips;
    const sbOff = off; off += 4 * nStrips;
    const descOff = off; off += d.length + 1;
    const swOff = off; off += sw.length + 1;
    const dataOff = off;
    const total = dataOff + strips.reduce((n, s) => n + s.length, 0);
    const buf = new ArrayBuffer(total), dv = new DataView(buf), u8 = new Uint8Array(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    let p = 8; dv.setUint16(p, tags, true); p += 2;
    const tag = (t, type, count, val) => { dv.setUint16(p, t, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true); if (type === 3 && count === 1) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true); p += 12; };
    tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 8); tag(259, 3, 1, 5); tag(262, 3, 1, 1);
    tag(270, 2, d.length + 1, descOff);
    tag(273, 4, nStrips, nStrips === 1 ? dataOff : soOff);
    tag(277, 3, 1, 1); tag(278, 4, 1, rps);
    tag(279, 4, nStrips, nStrips === 1 ? strips[0].length : sbOff);
    tag(282, 5, 1, resOff); tag(283, 5, 1, resOff + 8); tag(296, 3, 1, 2);
    tag(305, 2, sw.length + 1, swOff);
    dv.setUint32(p, 0, true);
    dv.setUint32(resOff, dpi, true); dv.setUint32(resOff + 4, 1, true); dv.setUint32(resOff + 8, dpi, true); dv.setUint32(resOff + 12, 1, true);
    u8.set(d, descOff); u8.set(sw, swOff);
    let q = dataOff;
    strips.forEach((s, i) => { if (nStrips > 1) { dv.setUint32(soOff + 4 * i, q, true); dv.setUint32(sbOff + 4 * i, s.length, true); } u8.set(s, q); q += s.length; });
    return buf;
  }
  async function exportTIFF(svg, wPt, hPt, dpi, name, S) {
    const rs = rasterSize(wPt, hPt, dpi), lim = rasterLimit();
    if (rs.w > lim.maxSide || rs.w * rs.h > 1.5e9) { G.App.notify(tooBig(rs, dpi, 'The TIFF')); return 'failed'; }
    const r = await svgToGray(svg, wPt, hPt, dpi);   // drawn in bands: not bound by the canvas pixel limit
    return download(new Blob([encodeTiffGray(r.gray, r.w, r.h, dpi, summaryText(S))], { type: 'image/tiff' }), name);
  }

  function exportSVG(svg, name) {
    return download(new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n' + svg], { type: 'image/svg+xml' }), name);
  }
  // editable PowerPoint: text and lines as native shapes, the gel as recroppable pictures (opts: crop, gel)
  async function exportPPTX(svg, name, S, opts) {
    const r = await G.PPTX.fromFigure(svg, Object.assign({ title: S ? S.file.name : 'Figure', subject: S ? summaryText(S) : '' }, opts || {}));
    return download(r.blob, name);
  }
  // vector PDF; resolves {status, missing: characters the standard PDF fonts cannot show}
  async function exportPDF(svg, name, S, title) {
    const r = await G.PDF.fromSVG(svg, { title: title || (S ? S.file.name : 'Figure'), subject: S ? summaryText(S) : '' });
    return { status: await download(r.blob, name), missing: r.missing };
  }

  /* Uncropped image for the supplement, processed exactly like the figure (Nature asks for the
   * same contrast and orientation), with the crop box and well numbers; cut lanes are marked X. */
  async function exportUncropped(S, fullCanvas, name) {
    const W = fullCanvas.width, H = fullCanvas.height;
    const fs = Math.max(14, Math.round(W / 70));
    const top = fs * 4, bottom = fs * 3.2;
    const lim = rasterLimit();
    if (W * (H + top + bottom) > lim.maxPixels || W > lim.maxSide) { G.App.notify(`The uncropped image (${W} × ${Math.round(H + top + bottom)} px) is more than ${lim.browser} can draw.`); return 'failed'; }
    const c = document.createElement('canvas');
    c.width = W; c.height = H + top + bottom;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(fullCanvas, 0, top);
    const r = S.crop;
    ctx.strokeStyle = '#e53935'; ctx.lineWidth = Math.max(2, W / 600);
    ctx.setLineDash([fs * 0.6, fs * 0.4]);
    ctx.strokeRect(r.x, r.y + top, r.w, r.h);
    // strips shown in the figure (Western panels)
    ctx.strokeStyle = '#0e8f8f'; ctx.setLineDash([fs * 0.3, fs * 0.3]);
    (S.strips || []).forEach(st => { const y0 = Math.min(st.y0, st.y1), y1 = Math.max(st.y0, st.y1); ctx.strokeRect(r.x, y0 + top, r.w, y1 - y0); });
    ctx.setLineDash([]);
    ctx.font = `${fs}px Arial`; ctx.textAlign = 'center';
    S.lanes.forEach((l, i) => {
      ctx.fillStyle = l.hidden ? '#e53935' : '#000';
      ctx.fillText(l.hidden ? 'X' : String(i + 1), l.x, top - fs * 0.5);   // lane x is already absolute
    });
    ctx.fillStyle = '#000'; ctx.textAlign = 'left';
    ctx.font = `bold ${fs}px Arial`;
    ctx.fillText('Uncropped image (same processing as figure)', fs * 0.5, fs * 1.3);
    ctx.font = `${fs * 0.8}px Arial`;
    const lv = S.levels;
    const info = `${S.file.name} · SHA-256 ${String(S.file.sha256 || '').slice(0, 16)}… · ${S.file.bits}-bit · rotation ${S.rotation}°${flipText(S) ? ' · ' + flipText(S) : ''}${keystoneText(S) ? ' · geometry-corrected' : ''} · levels ${(lv.black * 100).toFixed(2)}–${(lv.white * 100).toFixed(2)}% (linear${lv.gamma !== 1 ? ', gamma ' + lv.gamma : ''})${lv.invert ? ' · inverted' : ''}`;
    ctx.fillText(info, fs * 0.5, H + top + fs * 1.2, W - fs);
    const key = S.lanes.map((l, i) => `${l.hidden ? 'X' : i + 1}: ${l.name || '—'}`).join('   ');
    ctx.fillText(key, fs * 0.5, H + top + fs * 2.4, W - fs);
    const dpi = Math.round(S.file.dpi) || 300;
    const b = await new Promise(res => c.toBlob(res, 'image/png'));
    return download(await pngDecorate(b, dpi, { Software: G.App.NAME + ' ' + G.App.VERSION, Description: summaryText(S) }), name);
  }

  // the untouched bytes of the source file (byte-identical to what the imager wrote); a Western
  // marker image travels along in the same archive
  async function exportOriginal(S, buffer, marker) {
    const ext = (S.file.name.match(/\.[^.]+$/) || ['.tif'])[0];
    const nm = S.file.name.replace(/\.[^.]+$/, '') + `_original_sha256-${String(S.file.sha256).slice(0, 12)}${ext}`;
    if (!marker) return download(new Blob([buffer]), nm);
    const mext = (marker.name.match(/\.[^.]+$/) || ['.tif'])[0];
    const mn = marker.name.replace(/\.[^.]+$/, '') + `_marker_sha256-${String(marker.sha256).slice(0, 12)}${mext}`;
    return download(await G.Zip.make([{ name: nm, data: buffer }, { name: mn, data: marker.buffer }]), S.file.name.replace(/\.[^.]+$/, '') + '_original_data.zip');
  }

  function processingLog(S) {
    const A = G.App, k = A.clipStats(), r = A.laneRange(), unit = A.baseUnit();
    const bounds = G.Render.laneBounds(S.lanes, A.src.w);
    const rnd = v => (v == null ? null : unit === 'kDa' ? Math.round(v * 10) / 10 : Math.round(v));
    const log = {
      tool: A.NAME, version: A.VERSION, build: A.BUILD, basedOn: 'GelFigure 0.5.0 (MIT, github.com/poplarity/GelFigure)', exportedAt: new Date().toISOString(),
      experiment: { type: S.gelType, name: A.gelType().name(), sizeUnit: unit },
      environment: { userAgent: navigator.userAgent, figureFont: 'Arial, Helvetica, sans-serif (vector text)' },
      source: { file: S.file.name, sha256: S.file.sha256, bytes: S.file.size, width: A.src.w, height: A.src.h, bitDepth: S.file.bits, dpi: S.file.dpi || null },
      markerImage: A.hasMarkerImage() ? { file: S.markerImage.name, sha256: S.markerImage.sha256, use: 'marker band positions only; not shown in the figure' } : null,
      rotationDeg: S.rotation, autoRotationDeg: A.autoRotation, flip: Object.assign({ description: flipText(S) }, S.flip),
      geometry: S.geom && S.geom.grid ? { description: keystoneText(S), mode: S.geom.mode, lanesPct: S.geom.lanesPct, bandsPct: S.geom.bandsPct, bendPx: S.geom.bendPx, corners: S.geom.corners, H: S.geom.H ? S.geom.H.map(v => +v.toPrecision(8)) : null, grid: { nx: S.geom.grid.nx, ny: S.geom.grid.ny, pts: S.geom.grid.pts.map(v => +v.toFixed(2)) }, note: 'grid: source coordinate (rotated frame, pixels) of every node of a nx x ny lattice over the working image; H: the keystone part; rotation and geometry are composed and the pixels are resampled once, bilinear' } : null,
      crop: S.crop, figureWells: r ? [r[0] + 1, r[1] + 1] : null,
      wellRows: S.gelRows ? { count: S.gelRows.length, shown: S.gelRow + 1, rows: S.gelRows.map(x => ({ yFrom: Math.round(x.y0), yTo: Math.round(x.y1) })) } : null,
      strips: (S.strips || []).map(t => ({ label: t.label, yFrom: Math.round(Math.min(t.y0, t.y1)), yTo: Math.round(Math.max(t.y0, t.y1)) })),
      levels: Object.assign({ note: 'linear whole-image stretch; values are fractions of full scale' }, S.levels),
      clipping: {
        bandEndClippedPixels: k.sensor, bandEndClippedFrac: k.sensorFrac, saturation: A.satReport(),
        acquisition: A.acq ? { bits: A.acq.bits, floatingPoint: A.acq.float, lossy: A.acq.lossy, colourConvertedToGrey: !!A.acq.colour, top: A.acq.hi, bottom: A.acq.lo, largestStoredValue: A.acq.rawMax, looksBits: A.acq.effBits } : null,
        levelClippedHighPixels: k.high, levelClippedLowPixels: k.low,
        levelClippedOnBandSideFrac: A.bandClipFrac(), pixelsInCrop: k.n
      },
      resolution: { gelWidthMm: A.gelWidthMm(), gelPixelsAcross: A.visibleWidthPx(), effectiveGelDpi: Math.round(A.effectiveDpi()), exportDpi: S.style.dpi },
      lanes: S.lanes.map((l, i) => ({ well: i + 1, x: Math.round(l.x * 10) / 10, name: l.name, removedFromFigure: !!l.hidden,
        removal: l.hidden ? { reason: l.hiddenReason || 'manual', xFrom: Math.round(bounds[i][0]), xTo: Math.round(bounds[i][1]) } : undefined })),
      markers: S.markers.map(m => ({ well: m.lane + 1, ladder: (G.Ladders.get(m.ladderId) || {}).name, ladderConfirmedByUser: !!m.confirmed, fitScore: m.score, unit: m.unit,
        bands: m.bands.map(b => ({ size: b.bp, y: Math.round(b.y * 10) / 10, autoMatched: b.matched, manual: b.manual, labelled: b.show })) })),
      arrows: S.arrows.map(a => {
        const e = A.estimateInfo(a.y, a.x);
        return { text: a.text, y: Math.round(a.y * 10) / 10, label: A.arrowLabel(a), userSize: a.sizeText || null,
          estimatedSize: e ? rnd(e.bp) : null, unit, extrapolated: e ? e.extrap : null, markersUsed: e ? e.used.map(i => i + 1) : [], sizing: e ? e.how : null,
          perMarker: e ? e.perMarker.map(p => ({ well: p.lane + 1, size: rnd(p.bp), extrapolated: p.extrap })) : [] };
      }),
      groups: S.groups.map(g => ({ fromWell: Math.min(g.from, g.to) + 1, toWell: Math.max(g.from, g.to) + 1, text: g.text })),
      conditions: S.conditions, style: S.style,
      legendHints: legendHints(S)
    };
    if (S.quant.rows.length) {
      // the same result and the same words as the table, the CSV, the clipboard and the methods (G.Quant.measure / describe)
      const R = G.Quant.measure(A), D = G.Quant.describe(A, R), r4 = v => (v == null || !isFinite(v) ? null : +v.toFixed(5));
      log.densitometry = {
        calculationVersion: R.version, method: Object.assign({ mode: R.mode === 'box' ? 'whole region' : 'thresholded signal (exploratory)', backgroundMethod: R.method,
          backgroundRegions: R.version === 2 ? { sides: S.quant.bgSides, gapPx: S.quant.bgGap, depthPx: S.quant.bgSize || 'auto' } : undefined, regionWidthPx: Math.round(R.halfWidthPx * 20) / 10 }, D),
        output: R.output, normalizationMode: R.normMode, referenceBand: R.normBand >= 0 ? R.rows[R.normBand].name : null, laneTotalIsTotalProteinStain: R.normMode === 'lane' ? R.laneTotal : null,
        referenceLane: R.ref != null ? { well: R.ref + 1, id: R.refId } : null, analysisArea: { x: Math.round(R.region.x), y: Math.round(R.region.y), w: Math.round(R.region.w), h: Math.round(R.region.h) },
        lanesLeftOutOfAnalysis: S.lanes.map((l, i) => (l.noMeasure ? i + 1 : null)).filter(v => v != null),
        bands: S.quant.rows.map(q => ({ id: q.id, name: q.name, frame: q.frame || null, rows: q.frame ? [q.y0, q.y1] : [Math.round(Math.min(q.y0, q.y1)), Math.round(Math.max(q.y0, q.y1))], placed: q.placed || null })),
        lanes: R.lanes.map((i, j) => ({ well: i + 1, id: R.ids[j], name: R.names[j], laneTotal: R.totals ? r4(R.totals[j].value) : undefined,
          values: R.rows.map((row, k2) => { const c = R.cells[k2][j]; return { band: row.name, corrected: r4(c.value), uncorrectedSum: r4(c.U), backgroundSum: r4(c.B), signalPx: c.n, backgroundPx: c.nb,
            threshold3sigma: r4(c.t3), threshold10sigma: r4(c.t10), clippedPixels: c.clip ? c.clip.n : 0, flags: G.Quant.flagText(c.flags, c) || null, review: c.review && c.review.length ? c.review : undefined,
            noise: c.flags ? c.flags.noise : undefined, clipping: c.flags ? c.flags.clipState : undefined,
            // each quantity with its own reason and caveat, whatever output the window shows
            correctedUnavailable: R.why.corrected[k2][j] || undefined,
            normalized: r4(R.values.normalized[k2][j]), normalizedUnavailable: R.normMode !== 'none' ? R.why.normalized[k2][j] || undefined : undefined, normalizedCaveat: R.caveat.normalized[k2][j] || undefined,
            foldChange: r4(R.values.fold[k2][j]), foldUnavailable: R.refId != null ? R.why.fold[k2][j] || undefined : undefined, foldCaveat: R.caveat.fold[k2][j] || undefined,
            baselineSensitivity: c.msens || undefined,
            region: c.prov && c.prov.signal ? { signalCorners: c.prov.signal.corners, background: c.prov.background, manualBaseline: c.prov.manual } : undefined }; }) })),
        clippedWells: R.saturatedLanes.map(i => i + 1), reviewWells: (R.reviewLanes || []).map(i => i + 1), manuallyIntegratedWells: (R.manualLanes || []).map(i => i + 1)
      };
    }
    return log;
  }

  // 'rotated by 180°' / 'flipped horizontally' / 'flipped vertically' / '' (as imaged)
  function flipText(S) { const f = S.flip || {}; return f.h && f.v ? 'rotated by 180°' : f.h ? 'flipped horizontally' : f.v ? 'flipped vertically' : ''; }
  // the geometry correction, in words, for the legend notes, the log and the methods
  function keystoneText(S) {
    const g = S.geom;
    if (!g || !g.grid) return '';
    const pct = v => `${v > 0 ? '+' : ''}${v} %`, parts = [];
    if (g.mode === 'manual') parts.push(`one projective (perspective) transform of the whole image from four slab corners marked by hand: the lane spacing at the bottom of the figure area was ${pct(g.lanesPct)} of the top, the band spacing at the right ${pct(g.bandsPct)} of the left`);
    else {
      if (Math.abs(g.lanesPct) >= 0.5 || Math.abs(g.bandsPct) >= 0.5) parts.push(`one projective (perspective) transform of the whole image ${g.slab ? 'from the outline of the slab, checked against the lane lines' : `estimated from the lane lines${g.rows ? ' and the ladder bands' : ''}`}: the lane spacing at the bottom of the figure area was ${pct(g.lanesPct)} of the top, the band spacing at the right ${pct(g.bandsPct)} of the left`);
      if (g.rowsFrom === 'slab edges') parts.push('the band rows\' convergence read from the slab\'s top and bottom edges');
      if (g.bendPx >= 0.5) parts.push(`a smooth displacement field that straightens the traced lanes (${g.lanes} lanes, largest horizontal shift ${g.bendPx.toFixed(1)} px)${g.rows ? ` and levels ${g.rows} ladder band rows across the marker lanes (largest vertical shift ${(g.dyPx || 0).toFixed(1)} px, capped at 0.3 of the row spacing)` : ''}; sample bands were not used as anchors`);
    }
    return parts.join(', and ') + (g.residualPct != null || g.scaleMax != null ? `; after it the lanes converge by ${g.residualPct != null ? g.residualPct : '?'} % and the map scales no cell by more than ${g.scaleMax != null ? g.scaleMax : '?'} %` : '');
  }
  const KIND_LADDER = { dna: 'DNA ladders', rna: 'RNA ladders', protein: 'protein molecular-weight markers', native: 'native protein markers' };
  function legendHints(S) {
    const h = [], A = G.App;
    const cut = S.lanes.map((l, i) => (l.hidden ? i + 1 : null)).filter(v => v != null);
    const what = A.gelType().western || S.gelType === 'southern' ? 'blot' : 'gel';
    if (cut.length) h.push(`Lane${cut.length > 1 ? 's' : ''} ${cut.join(', ')} ${cut.length > 1 ? 'were' : 'was'} removed from the same ${what}; splice sites are indicated by ` + (S.style.spliceStyle === 'line' ? 'lines.' : 'white gaps.'));
    const strips = (S.strips || []).filter(t => Math.abs(t.y1 - t.y0) >= 2);
    if (strips.length > 1) h.push(`The ${strips.length} panels are regions of the same ${what} image${strips.some(t => t.label) ? ` (${strips.map(t => t.label || '–').join(', ')})` : ''}; intervening regions were omitted and are shown in the uncropped image.`);
    if (flipText(S)) h.push(`The image was ${flipText(S)} (orientation only; lane order follows the figure).`);
    if (keystoneText(S)) h.push(`Geometry-corrected: ${keystoneText(S)}; applied together with the straightening in one resampling and stated in the processing log.`);
    if (S.levels.invert) h.push('Image colours were inverted for display.');
    if (S.levels.gamma !== 1) h.push(`A non-linear gamma adjustment (γ = ${S.levels.gamma}) was applied to the whole image.`);
    const lads = S.markers.map(m => G.Ladders.get(m.ladderId)).filter(Boolean);
    const short = n => n.replace(/\s*\([^()]*\)\s*$/, '');   // the name without its trailing catalogue numbers
    const names = [...new Set(lads.map(l => short(l.name)))];
    const unconfirmed = S.markers.some(m => !m.confirmed);
    if (names.length === 1) h.push(`M, ${names[0]}${unconfirmed ? ' (identified from the band pattern; not confirmed)' : ''}.`);
    else if (names.length > 1) h.push(`M, ${KIND_LADDER[A.kind()]} (${S.markers.map(m => `lane ${m.lane + 1}: ${short(G.Ladders.get(m.ladderId).name)}`).join('; ')}).`);
    if (A.hasMarkerImage() && S.markers.length) h.push('Marker positions were taken from a white-light image of the same membrane captured in the same position.');
    if (S.markers.length && A.kind() === 'native') h.push('Sizes on a native gel are apparent: mobility depends on shape and charge as well as mass.');
    if (lads.some(l => l.id === 'nebscextend')) h.push('The supercoiled ladder sizes supercoiled plasmid DNA only; linear and nicked or relaxed forms run differently.');
    if (S.markers.length >= 2 && S.arrows.some(a => a.size && !a.sizeText)) h.push('Sizes were interpolated between the ladder lanes on either side of each lane.');
    if (S.arrows.some(a => a.size && !a.sizeText && (A.estimateInfo(a.y, a.x) || {}).extrap)) h.push('Sizes marked ≈ were extrapolated beyond the ladder range.');
    if (S.quant.rows.length) {
      // the same words as the methods text and the CSV (G.Quant.describe), shortened for a legend
      const R = G.Quant.measure(A), bg = G.Quant.BG_TEXT[R.method] || R.method;
      const ctl = R.normMode === 'band' && R.normBand >= 0 ? `, divided by ${R.rows[R.normBand].name} in the same lane` : R.normMode === 'lane' ? (R.laneTotal ? ', normalized to total protein (lane signal of this total-protein image)' : ', divided by the total lane signal of this image') : '';
      const how = R.mode === 'box' ? 'background-corrected signal summed over a fixed region of the original pixel values in each lane' : 'thresholded signal (pixels above 3 σ of the background; exploratory) over a fixed region of the original pixel values';
      const blq = R.flags.flat().some(f => f && f.below) ? ' Values below the estimated 10σ noise threshold are marked.' : '';
      const rev = R.reviewLanes && R.reviewLanes.length ? ` Lanes ${R.reviewLanes.map(i => i + 1).join(', ')} were flagged for review.` : '';
      const man = R.manualLanes && R.manualLanes.length ? ` Lane${R.manualLanes.length > 1 ? 's' : ''} ${R.manualLanes.map(i => i + 1).join(', ')} ${R.manualLanes.length > 1 ? 'were' : 'was'} integrated manually (limits and baseline drawn on the lane profile).` : '';
      h.push(`Band intensities were quantified by densitometry (${how}, ${bg})${ctl}` + (R.output === 'fold' && R.refOk.some(Boolean) ? ` and expressed as fold change versus lane ${R.ref + 1}.` : '.') + blq + rev + man);
    }
    return h;
  }

  // densitometry chart: PNG / TIFF / SVG / PDF / PPTX
  async function exportChart(chart, fmt, base, dpi, S) {
    if (fmt === 'svg') return exportSVG(chart.svg, base + '.svg');
    if (fmt === 'pdf') return (await exportPDF(chart.svg, base + '.pdf', S, 'Densitometry')).status;
    if (fmt === 'pptx') return exportPPTX(chart.svg, base + '.pptx', S, {});
    if (fmt === 'tiff') return exportTIFF(chart.svg, chart.w, chart.h, dpi, base + `_${dpi}dpi.tif`, S);
    return exportPNG(chart.svg, chart.w, chart.h, dpi, base + `_${dpi}dpi.png`, S);
  }

  // PNG bytes of an SVG at dpi, with the resolution and summary chunks (null when the canvas limit forbids it)
  async function pngBlob(svg, wPt, hPt, dpi, S) {
    if (!rasterSize(wPt, hPt, dpi).ok) return null;
    const c = await svgToCanvas(svg, wPt, hPt, dpi), blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return pngDecorate(blob, dpi, S ? { Software: G.App.NAME + ' ' + G.App.VERSION, Description: summaryText(S) } : {});
  }
  /* Everything in one ZIP: the figure (PNG, PDF, SVG), the chart (PNG, SVG), the measurements and band sizes
   * (CSV), the processing log and the methods text. fig = {svg, w, h}; chart = {svg, w, h} or null. */
  /* opts.archive: { original: {name, buffer, sha256}, marker: {name, buffer, sha256} | null, project: Blob }:
   * the complete archive adds the original file(s), byte-identical, and the project file that reopens it all */
  async function packageBlob(S, base, fig, chart, dpi, opts) {
    const A = G.App, files = [], add = (name, data) => files.push({ name: `${base}/${name}`, data });
    const figPng = await pngBlob(fig.svg, fig.w, fig.h, dpi, S);
    if (figPng) add(`${base}_figure_${dpi}dpi.png`, figPng);
    add(`${base}_figure.pdf`, (await G.PDF.fromSVG(fig.svg, { title: S.file.name, subject: summaryText(S) })).blob);
    add(`${base}_figure.svg`, '<?xml version="1.0" encoding="UTF-8"?>\n' + fig.svg);
    let R = null;
    if (S.quant.rows.length) {
      R = G.Quant.measure(A);
      if (chart) {
        const chPng = await pngBlob(chart.svg, chart.w, chart.h, dpi, S);
        if (chPng) add(`${base}_chart_${dpi}dpi.png`, chPng);
        add(`${base}_chart.svg`, '<?xml version="1.0" encoding="UTF-8"?>\n' + chart.svg);
      }
      add(`${base}_densitometry.csv`, G.Quant.quantCSV(A, R));
      // the reproducible specification: with the original image it recomputes every value (G.Quant.applySpec)
      if (R.version === G.Quant.VERSION) add(`${base}_densitometry_spec.json`, JSON.stringify(G.Quant.spec(A), null, 1));
    }
    if (S.markers.length) add(`${base}_band_sizes.csv`, G.Quant.sizesCSV(A, G.Quant.bandSizes(A)));
    add(`${base}_processing_log.json`, JSON.stringify(processingLog(S), null, 2));
    add(`${base}_methods.txt`, `Legend notes\n${legendHints(S).join(' ') || '(none)'}\n\nMethods\n${R ? G.Quant.methodsText(A, R) : 'No densitometry.'}\n\nSource: ${S.file.name} (SHA-256 ${S.file.sha256})\nMade with ${A.NAME} ${A.VERSION} (build ${A.BUILD})\n`);
    const ar = opts && opts.archive;
    if (ar) {
      const keep = f => { const ext = (f.name.match(/\.[^.]+$/) || ['.tif'])[0]; return f.name.replace(/\.[^.]+$/, '') + `_sha256-${String(f.sha256).slice(0, 12)}${ext}`; };
      add(`original/${keep(ar.original)}`, ar.original.buffer);
      if (ar.marker) add(`original/${keep(ar.marker)}`, ar.marker.buffer);
      if (ar.project) add(`${base}.gelfig`, ar.project);
      add('README.txt', `${base}: complete archive made with ${A.NAME} ${A.VERSION} (build ${A.BUILD})\n\n` +
        `Three levels, from the summary to everything:\n` +
        `1. Results summary   the figure, chart, *_densitometry.csv (values with their reasons and flags), band sizes, methods text\n` +
        `2. Reproducible analysis specification   *_densitometry_spec.json and *_processing_log.json: every measurement frame in full, every region in its placement frame with each lane's adjustments and drawn baselines, the settings and the pixel-inclusion rule; with the original image they recompute every value\n` +
        `3. Complete archive with the original data   original/: the source image${ar.marker ? ' and the marker image' : ''}, byte-identical (the SHA-256 in the name; check it with any SHA-256 tool); ${base}.gelfig: the project, to open in ${A.NAME} (Open / Save > Project file) and continue exactly where this was exported\n`);
    }
    return { blob: await G.Zip.make(files), files: files.map(f => f.name) };
  }

  G.Export = { flipText, keystoneText, download, exportPNG, exportTIFF, exportSVG, exportPDF, exportPPTX, exportChart, packageBlob, exportUncropped, exportOriginal, processingLog, legendHints, summaryText, svgToCanvas, svgToGray, rasterSize, rasterLimit, encodeTiffGray, pngDecorate };
})(window);

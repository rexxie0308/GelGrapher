/* Application state, processing pipeline, undo history and preview refresh.
 * Coordinates: lane x / band y / arrow y are stored in ROTATED-IMAGE pixels (absolute),
 * so moving the crop never shifts annotations relative to the gel.
 */
(function (G) {
  'use strict';
  const E = G.Engine;
  const SAT = 0.998;
  const PREF_KEY = 'gelfig.prefs';

  const defaultStyle = () => ({
    gelWidthMm: 45, autoWidth: true, mmPerLane: 5.5, fontPt: 7, lineWidthPt: 0.5, labelAngle: 'auto', font: 'Arial', laneNumbers: false, frame: false,
    panelLetter: '', panelPt: 8, spliceStyle: 'gap', spliceGapPt: 1.5, tickLenPt: 2.5, labelGapPt: 2.5,
    unitHeader: true, groupTicks: false, groupSplit: false, groupFit: 'wrap', dpi: 600, laneNumberMode: 'well', stripGapPt: 3
  });
  // densitometry settings: band boxes (rows), background method, box width as a fraction of the lane pitch
  const defaultPlot = () => ({ type: 'bar', values: false, refLine: true, ylabel: '', title: '' });
  // mode: 'band' = pixels above the noise floor only, 'box' = the whole box; norm: 'control' | 'lane' | 'none'
  const defaultQuant = () => ({ rows: [], bg: 'edge', mode: 'band', wFrac: 0.7, control: -1, ref: -1, norm: 'control', plot: defaultPlot() });

  const App = {
    S: null,            // serialisable state
    src: null, rot: null, rotFor: null,
    fullCanvas: document.createElement('canvas'),
    satCanvas: null,
    listeners: [],
    hist: [], future: [],
    _selLane: -1, selLanes: new Set(), selArrow: -1,   // selected lane(s) on the raw image: selLane is the primary, selLanes every one
  };

  // preferences live in localStorage when the browser allows it, in memory otherwise
  let prefMem = null;
  function prefs() {
    if (!prefMem) { try { prefMem = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch (e) { prefMem = {}; } }
    return JSON.parse(JSON.stringify(prefMem));
  }
  function writePrefs(p) { prefMem = p; try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch (e) { /* storage blocked */ } }
  // ladder, label unit and band look are remembered per experiment type (a Western is not a PCR gel)
  function typePrefs(type) { return (prefs().byType || {})[type] || {}; }
  function savePrefs() {
    const S = App.S; if (!S) return;
    const m0 = S.markers[0] || {}, p = prefs();
    p.byType = p.byType || {};
    p.byType[S.gelType] = { ladderId: m0.ladderId || App.prefLadder, unit: m0.unit || App.prefUnit, darkBands: App.darkBands() };
    p.style = S.style; p.gelType = S.gelType;
    writePrefs(p);
  }

  function busy(on, text) {
    document.getElementById('busy').classList.toggle('hidden', !on);
    const t = document.getElementById('busyText'); if (t && on) t.textContent = text || 'Working…';
  }
  App.busy = busy;
  // progress text during a long automatic step (the interface shows it in the busy overlay) and a
  // yield to the browser so that it is painted; both are no-ops outside the interface
  App.progress = function (text) { const t = document.getElementById('busyText'); if (t && text) t.textContent = text; };
  App.yield = () => new Promise(r => setTimeout(r, 0));
  App.defaultStyle = defaultStyle;
  App.onDropFile = null;   // set by the UI layer

  App.NAME = 'GelGrapher';
  App.VERSION = '1.1.0';
  App.prefs = prefs;
  App.setPref = function (k, v) { const p = prefs(); p[k] = v; writePrefs(p); };
  App.notify = function (msg) { if (G.UI && G.UI.alert) G.UI.alert(msg); else console.error(msg); };

  // ---------- experiment type ----------
  App.gelType = function () { return G.Gels.get(App.S ? App.S.gelType : prefs().gelType); };
  App.kind = function () { return App.gelType().kind; };
  // unit the sizes are stored in (bp / nt / kDa)
  App.baseUnit = function () { return G.Ladders.KIND_UNIT[App.kind()]; };
  // true when the figure shows dark bands on a light background
  App.darkBands = function () { const S = App.S; return S.bright ? !!S.levels.invert : !S.levels.invert; };
  App.setDarkBands = function (dark) { App.S.levels.invert = !!dark === App.S.bright; };
  /* Detection polarity by hand: bright = bands brighter than the background. Everything that reads the
   * pixels (crop, lanes, bands, ladders, densitometry) runs on this, so it is detected again from the
   * crop on; a geometry correction made with the wrong polarity is dropped. The figure keeps its look. */
  App.setBright = async function (bright) {
    const S = App.S, dark = S.levels.invert === S.bright;   // the figure shows dark bands?
    S.bright = !!bright; S.levels.invert = dark === S.bright;
    if (S.geom) App.setGeom(null);
    await App.autoAll(false);
  };
  function typeDefaults(type, bright) {
    const t = G.Gels.get(type), tp = typePrefs(t.id);
    const lad = G.Ladders.get(tp.ladderId);
    App.prefLadder = lad && lad.kind === t.kind ? tp.ladderId : t.ladder;
    App.prefUnit = tp.unit && G.Ladders.unitsFor(t.kind).includes(tp.unit) ? tp.unit : G.Gels.unitOf(t.id);
    App.invertInherited = tp.darkBands != null;
    const dark = tp.darkBands != null ? tp.darkBands : t.darkBands != null ? t.darkBands : !bright;
    return { invert: dark === bright };
  }
  /* Switch the experiment type of the open image: ladders come from the new library, labels use its
   * unit and the default band look follows the type. Lanes, names and annotations stay. */
  App.setGelType = function (id) {
    const S = App.S, t = G.Gels.get(id), prevKind = App.kind();
    S.gelType = t.id;
    S.levels.invert = typeDefaults(t.id, S.bright).invert;
    App.setPref('gelType', t.id);
    if (t.kind !== prevKind) {
      const lanes = S.markers.map(m => m.lane);
      App.autoMarkers();
      // nothing in the new library fits on its own: keep the marker lanes with the type's default ladder
      if (!S.markers.length && lanes.length) { S.markers = lanes.map(l => App.newMarker(l, App.prefLadder)); App.matchMarkers(true); }
    }
    S.markers.forEach(m => { m.unit = App.prefUnit; });
  };

  // ---------- hashing ----------
  App.sha256 = async function (buffer) {
    // forceJsHash: headless test runs (off-thread WebCrypto does not hold their virtual clock)
    if (window.crypto && crypto.subtle && !App.forceJsHash) {
      try { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map(b => b.toString(16).padStart(2, '0')).join(''); } catch (e) { /* fall through */ }
    }
    return sha256js(new Uint8Array(buffer));
  };
  // small pure-JS fallback (file:// in some browsers has no crypto.subtle)
  function sha256js(m) {
    const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const l = m.length, nb = ((l + 9 + 63) >> 6) << 6, p = new Uint8Array(nb);
    p.set(m); p[l] = 0x80;
    const dv = new DataView(p.buffer);
    dv.setUint32(nb - 8, Math.floor(l / 0x20000000)); dv.setUint32(nb - 4, (l << 3) >>> 0);
    const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
      for (let i = 16; i < 64; i++) {
        const s0 = r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return [...H].map(x => x.toString(16).padStart(8, '0')).join('');
  }

  // ---------- loading ----------
  // read + decode one input (File or {name, buffer})
  App.readInput = async function (file) {
    const buffer = file.buffer || await file.arrayBuffer();
    const img = await G.TIFF.decodeBuffer(buffer, file.name);
    return { name: file.name, buffer, img, sha256: await App.sha256(buffer) };
  };

  // install a decoded image as the current source and run the automatic pipeline
  async function startFrom(input, gelType) {
    App._libSkip = null;
    const img = input.img;
    App.src0 = App.src = { w: img.width, h: img.height, data: img.data };
    App._flipKey = '';
    App.srcBuffer = input.buffer;
    App.rot = null; App.satCanvas = null; App._display = null; App._clipKey = null; App._emptyKey = null;
    App.clearMarkerImage(true);
    const p = prefs(), type = G.Gels.get(gelType || p.gelType).id, bright = E.detectBright(App.src);
    App.S = {
      gelType: type,
      file: { name: input.name, bits: img.bits, dpi: img.dpi, actualMax: img.actualMax, sha256: input.sha256, size: input.buffer.byteLength },
      bright,
      rotation: 0,
      levels: { black: 0, white: 1, gamma: 1, invert: typeDefaults(type, bright).invert },
      crop: { x: 0, y: 0, w: img.width, h: img.height },
      lanes: [], laneHalfW: 10,
      markers: [],
      groups: [], conditions: [], arrows: [], strips: [],
      quant: defaultQuant(), markerImage: null, flip: { h: false, v: false },
      gelRows: null, gelRow: 0, rowStash: {},
      geom: null,
      style: Object.assign(defaultStyle(), p.style || {}),
      saturatedInCrop: 0
    };
    App.loadWarnings = img.warnings || [];
    App.hist = []; App.future = [];
    await App.autoAll(true);
    // the state right after automatic processing: target of "reset everything"
    App.initial = App.snapshot();
    App.autoRotation = App.S.rotation;
  }

  // file: File or {name, buffer}; or an array of them (several exposures of one gel)
  // gelType: optional experiment type for this image (default: the last one used)
  App.load = async function (file, gelType) {
    if (Array.isArray(file) && file.length > 1) return App.loadMany(file, gelType);
    if (Array.isArray(file)) file = file[0];
    busy(true, 'Reading and detecting…');
    await new Promise(r => setTimeout(r, 30));
    try {
      const input = await App.readInput(file);
      App.exposures = null;
      App.isExample = false;
      await startFrom(input, gelType);
      App.emit('loaded');
    } catch (e) {
      console.error(e);
      App.notify(readError(file, e));
    } finally { busy(false); }
  };
  // why a file could not be opened, with what would work
  function readError(file, e) {
    const name = file && file.name ? `"${file.name}"` : 'this file';
    const formats = 'Supported: TIFF (8 / 16-bit), PNG, JPG, BMP, .gelfig project files and a .zip containing them.';
    return `Could not read ${name}: ${e.message}. ` + formats;
  }

  /* Several exposures of one gel: score each on a downsampled copy, open the best. Only the chosen
   * image is kept decoded; the others keep their file bytes and are decoded again when picked. */
  App.loadMany = async function (files, gelType) {
    busy(true, `Scoring ${files.length} exposures…`);
    await new Promise(r => setTimeout(r, 30));
    try {
      const list = [];
      let bestInput = null;
      for (let k = 0; k < files.length; k++) {
        busy(true, `Scoring exposure ${k + 1} / ${files.length}…`);
        await new Promise(r => setTimeout(r, 0));
        const input = await App.readInput(files[k]);
        const img = { w: input.img.width, h: input.img.height, data: input.img.data };
        const q = E.exposureScore(img);
        list.push({ name: input.name, buffer: input.buffer, sha256: input.sha256, w: img.w, h: img.h, bits: input.img.bits,
          score: q.score, clipFrac: q.clipFrac, snr: q.snr, rangeUse: q.rangeUse, thumb: thumbnail(img, q.bright) });
        // keep decoded pixels only for the current best; the rest live on as file bytes
        if (!bestInput || q.score > bestInput.score) { if (bestInput) bestInput.img = null; bestInput = Object.assign(input, { score: q.score, k }); }
        else input.img = null;
      }
      const order = list.map((e, i) => i).sort((a, b) => list[b].score - list[a].score);
      list.forEach((e, i) => { e.rank = order.indexOf(i) + 1; });
      App.exposures = list;
      App.expIdx = bestInput.k;
      App.isExample = false;
      await startFrom(bestInput, gelType);
      App.emit('loaded');
    } catch (e) {
      console.error(e);
      App.notify(readError(files[0], e));
    } finally { busy(false); }
  };

  function thumbnail(img, bright) {
    const sm = E.downsample(img, 140), lv = E.autoLevels(sm);
    const c = document.createElement('canvas'); c.width = sm.w; c.height = sm.h;
    c.getContext('2d').putImageData(E.toImageData(sm, { black: lv.black, white: lv.white, gamma: 1, invert: !bright ? false : true }), 0, 0);
    return c.toDataURL('image/jpeg', 0.8);
  }

  /* Switch to another exposure of the same gel. Same pixel size = same framing: everything typed is
   * kept, only the pixels and contrast change. Different size: re-detect, names carried in order. */
  App.switchExposure = async function (k) {
    const ex = App.exposures && App.exposures[k];
    if (!ex || k === App.expIdx) return { ok: true };
    busy(true, 'Switching exposure…');
    await new Promise(r => setTimeout(r, 20));
    try {
      const img = await G.TIFF.decodeBuffer(ex.buffer, ex.name);
      const S = App.S;
      App.expIdx = k;
      if (img.width === App.src.w && img.height === App.src.h) {
        App.src0 = { w: img.width, h: img.height, data: img.data };
        App._flipKey = null; App.applyFlip();
        App.srcBuffer = ex.buffer;
        App.rot = null; App.satCanvas = null; App._display = null; App._clipKey = null;
        S.file = { name: ex.name, bits: img.bits, dpi: img.dpi, actualMax: img.actualMax, sha256: ex.sha256, size: ex.buffer.byteLength };
        App.autoLevels();
        App.updateSaturation();
        App.refineMarkers();   // same geometry: keep band assignments
        App.commit();
        return { ok: true, kept: true };
      }
      const names = App.figureLanes().map(i => S.lanes[i].name);
      await startFrom({ name: ex.name, buffer: ex.buffer, img, sha256: ex.sha256 }, S.gelType);
      const fl = App.figureLanes();
      const same = fl.length === names.length;
      if (same) { fl.forEach((i, j) => { App.S.lanes[i].name = names[j]; }); App.commit(); }
      App.emit('loaded');
      return { ok: true, kept: false, namesCarried: same };
    } finally { busy(false); }
  };

  // lanes that appear in the figure, left to right
  App.figureLanes = function () {
    const r = App.laneRange(); if (!r) return [];
    const out = []; for (let i = r[0]; i <= r[1]; i++) if (!App.S.lanes[i].hidden) out.push(i);
    return out;
  };

  // ---------- pipeline ----------
  /* ---------- flips ----------
   * A gel imaged with the wells at the bottom, or through the tray (mirrored), is put the right way
   * round by flipping the SOURCE; App.src is always App.src0 flipped as S.flip says. Every annotation
   * lives in the rotated frame, where a flip is a mirror and the rotation angle changes sign. */
  function flipImg(img, h, v) {
    if (!h && !v) return img;
    const { w, data } = img, hh = img.h, out = new Float32Array(w * hh);
    for (let y = 0; y < hh; y++) {
      const sy = v ? hh - 1 - y : y, row = sy * w, orow = y * w;
      if (h) for (let x = 0; x < w; x++) out[orow + x] = data[row + w - 1 - x];
      else out.set(data.subarray(row, row + w), orow);
    }
    return { w, h: hh, data: out };
  }
  const flipKey = S => (S.flip && S.flip.h ? 'h' : '') + (S.flip && S.flip.v ? 'v' : '');
  App.applyFlip = function () {
    const S = App.S, k = flipKey(S);
    if (App._flipKey === k && App.src) return;
    App.src = flipImg(App.src0, S.flip.h, S.flip.v);
    if (App.markerSrc0) { App.markerSrc = flipImg(App.markerSrc0, S.flip.h, S.flip.v); App.markerRot = null; App._markerDisplay = null; }
    App._flipKey = k;
    App.rot = null; App.satCanvas = null; App._display = null; App._clipKey = null; App._emptyKey = null;
  };
  App.flip = function (axis) {
    const S = App.S, W = App.src.w, H = App.src.h;
    const mirror = A => {
      const c = A.crop;
      if (axis === 'h') {
        A.lanes.forEach(l => { l.x = W - 1 - l.x; });
        A.crop = { x: Math.round(Math.max(0, W - (c.x + c.w))), y: c.y, w: c.w, h: c.h };
      } else {
        A.markers.forEach(m => m.bands.forEach(b => { b.y = H - 1 - b.y; }));
        A.arrows.forEach(a => { a.y = H - 1 - a.y; });
        A.strips.concat(A.quant.rows).forEach(r => { const y0 = H - 1 - r.y1, y1 = H - 1 - r.y0; r.y0 = y0; r.y1 = y1; });
        A.crop = { x: c.x, y: Math.round(Math.max(0, H - (c.y + c.h))), w: c.w, h: c.h };
      }
    };
    mirror(S);
    Object.values(S.rowStash || {}).forEach(A => { mirror(A); if (axis === 'h') A.lanes.sort((p, q) => p.x - q.x); });
    if (axis === 'v' && S.gelRows) { S.gelRows = S.gelRows.map(r => ({ y0: H - r.y1, y1: H - r.y0 })).reverse(); S.gelRow = S.gelRows.length - 1 - S.gelRow; const st = {}; Object.entries(S.rowStash).forEach(([k, v]) => { st[S.gelRows.length - 1 - k] = v; }); S.rowStash = st; }
    S.flip[axis] = !S.flip[axis];
    S.rotation = -S.rotation;
    if (App.autoRotation != null) App.autoRotation = -App.autoRotation;
    App.applyFlip();
    App.sortLanesIfNeeded();
    App.ensureRot();
    App.afterRotation();
  };

  /* The working frame: the source rotated by S.rotation and, when the geometry correction is on,
   * sent through S.geom.grid (a displacement grid over the canvas, output -> rotated-frame
   * source: a keystone, the per-lane straightening, or both composed), composed with the
   * rotation so the pixels are resampled once. Every annotation lives in this frame. */
  App.geomGrid = function (S) { S = S || App.S; return S.geom && S.geom.grid ? S.geom.grid : null; };
  /* The original pixels for densitometry. sourceRegion() returns null when the working frame is the
   * source itself (no rotation, no geometry); otherwise a function (xa, xb, ya, yb) -> rows that maps
   * the working-frame rectangle [xa, xb) x [ya, yb) back to the source (geometry grid, then the
   * inverse rotation) as a quadrilateral of its four corners and returns, for every source row the
   * quadrilateral crosses, the raw values of the source pixels whose centres lie inside it
   * ({ y, v: Float32Array }): every original pixel once, none resampled. */
  App.sourceRegion = function () {
    const S = App.S, g = App.geomGrid(S), R = App.rotM(S);
    if (!g && E.M3.isIdentity(R)) return null;
    App.applyFlip();
    const Ri = E.M3.inv(R), src = App.src, w = src.w, h = src.h;
    const map = (x, y) => { const s = g ? E.Grid.at(g, x, y) : { x, y }; return E.M3.apply(Ri, s.x, s.y); };
    return (xa, xb, ya, yb) => {
      const q = [map(xa, ya), map(xb, ya), map(xb, yb), map(xa, yb)];
      const Y0 = Math.max(0, Math.floor(Math.min(...q.map(p => p.y)))), Y1 = Math.min(h - 1, Math.ceil(Math.max(...q.map(p => p.y))));
      const rows = [];
      for (let Y = Y0; Y <= Y1; Y++) {
        // the quadrilateral's span on the line through the row's pixel centres
        const yc = Y + 0.5; let xl = Infinity, xr = -Infinity;
        for (let k = 0; k < 4; k++) {
          const a = q[k], b = q[(k + 1) % 4];
          if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) { const x = a.x + (b.x - a.x) * (yc - a.y) / (b.y - a.y); xl = Math.min(xl, x); xr = Math.max(xr, x); }
        }
        if (xr < xl) continue;
        const X0 = Math.max(0, Math.ceil(xl - 0.5)), X1 = Math.min(w - 1, Math.floor(xr - 0.5));
        if (X1 < X0) continue;
        rows.push({ y: Y, v: src.data.subarray(Y * w + X0, Y * w + X1 + 1) });
      }
      return rows;
    };
  };
  App.rotM = function (S) { S = S || App.S; const W = App.src.w, H = App.src.h; return E.M3.rotation(S.rotation, (W - 1) / 2, (H - 1) / 2); };
  App.frameKey = function (S) {
    S = S || App.S; const g = App.geomGrid(S);
    let sum = 0; if (g) for (let i = 0; i < g.pts.length; i += 7) sum += g.pts[i] * (i % 13 + 1);
    return `${S.rotation}|${g ? g.nx + 'x' + g.ny + ':' + sum.toFixed(3) : ''}`;
  };
  App.ensureRot = function () {
    App.applyFlip();
    const key = App.frameKey(App.S);
    if (!App.rot || App.rotFor !== key) {
      const g = App.geomGrid(App.S), R = App.rotM(App.S);
      App.rot = g ? E.warpGrid(App.src, g, E.M3.inv(R)) : E.warp(App.src, R);
      App.rotFor = key;
      App.satCanvas = null;
      App._display = null;
    }
    return App.rot;
  };
  App.markerSrc = null;
  App.hasMarkerImage = function () { return !!(App.markerSrc && App.S && App.S.markerImage); };
  App.setMarkerImage = function (input) {
    const img = input.img;
    if (img.width !== App.src.w || img.height !== App.src.h) {
      throw new Error(`The marker image is ${img.width}×${img.height} px but the blot is ${App.src.w}×${App.src.h} px; use the white-light image taken in the same position`);
    }
    App.markerSrc0 = { w: img.width, h: img.height, data: img.data };
    App.markerSrc = flipImg(App.markerSrc0, App.S.flip.h, App.S.flip.v);
    App.markerBuffer = input.buffer;
    App.markerBright = E.detectBright(App.markerSrc);
    App.markerRot = null; App._markerDisplay = null;
    App.S.markerImage = { name: input.name, sha256: input.sha256, bits: img.bits };
  };
  // quiet: only drop the pixels (a new main image is being loaded)
  App.clearMarkerImage = function (quiet) {
    App.markerSrc = App.markerSrc0 = null; App.markerBuffer = null; App.markerRot = null; App._markerDisplay = null;
    if (!quiet && App.S) App.S.markerImage = null;
  };
  App.ensureMarkerRot = function () {
    if (!App.markerSrc) return null;
    if (!App.markerRot || App.markerRotFor !== App.S.rotation) {
      App.markerRot = E.rotate(App.markerSrc, App.S.rotation);
      App.markerRotFor = App.S.rotation;
      App._markerDisplay = null;
    }
    return App.markerRot;
  };
  // the marker image as a display canvas (auto contrast, bands dark), for the overlay on the raw image
  App.markerCanvas = function () {
    const r = App.ensureMarkerRot();
    if (!r) return null;
    if (App._markerDisplay && App._markerDisplay.rot === App.S.rotation) return App._markerDisplay.c;
    const lv = E.autoLevels(r), c = document.createElement('canvas');
    c.width = r.w; c.height = r.h;
    c.getContext('2d').putImageData(E.toImageData(r, { black: lv.black, white: lv.white, gamma: 1, invert: App.markerBright }), 0, 0);
    App._markerDisplay = { rot: App.S.rotation, c };
    return c;
  };

  App.renderFull = function () {
    const rot = App.ensureRot(), lv = App.S.levels;
    const key = [App.frameKey(App.S), lv.black, lv.white, lv.gamma, lv.invert].join('|');
    if (App._display === key) return;
    App._display = key;
    const c = App.fullCanvas;
    c.width = rot.w; c.height = rot.h;
    c.getContext('2d').putImageData(E.toImageData(rot, lv), 0, 0);
    App._gelKey = null;
  };

  App.getSatCanvas = function () {
    if (App.satCanvas) return App.satCanvas;
    const rot = App.ensureRot();
    const c = document.createElement('canvas'); c.width = rot.w; c.height = rot.h;
    const id = new ImageData(rot.w, rot.h);
    for (let i = 0; i < rot.data.length; i++) if (rot.data[i] >= SAT) { id.data[i * 4] = 255; id.data[i * 4 + 3] = 255; }
    c.getContext('2d').putImageData(id, 0, 0);
    return (App.satCanvas = c);
  };

  App.cropImg = function () { return E.cropImg(App.ensureRot(), App.S.crop); };

  App.updateSaturation = function () {
    const c = App.cropImg();
    App.S.saturatedInCrop = E.saturation(c, SAT);
  };

  App.AUTO_ROT_LIMIT = 15;
  App.MAX_ROT = 45;
  // returns the detected angle; on a non-fresh image every annotation is carried along
  App.autoDeskew = function () {
    const a = E.deskew(App.src, App.S.bright);
    App.setRotation(a);
    return a;
  };

  /* Change the rotation and move everything with the gel. All coordinates live in the rotated frame;
   * going from angle d1 to d2 maps a point p to R(d2-d1)(p - centre) + centre (same canvas size).
   * Lanes are vertical lines, so they are mapped at the crop's vertical centre; marker bands at
   * their lane; arrows at the crop's horizontal centre. Nothing is re-detected, nothing is lost. */
  App.setRotation = function (deg) {
    const S = App.S;
    deg = Math.max(-App.MAX_ROT, Math.min(App.MAX_ROT, Math.round((+deg || 0) * 10) / 10));
    const d = deg - S.rotation;
    if (!d) return;
    const W = App.src.w, H = App.src.h, cx = (W - 1) / 2, cy = (H - 1) / 2;
    const Rd = E.M3.rotation(d, cx, cy);
    // with the perspective correction on, the homography follows the rotation (conjugated), so
    // the frame everything lives in turns by exactly Rd
    if (S.geom && S.geom.grid) { S.geom.grid = E.Grid.conjugate(S.geom.grid, Rd); if (S.geom.corners) S.geom.corners = S.geom.corners.map(([x, y]) => { const q = E.M3.apply(Rd, x, y); return [q.x, q.y]; }); }
    App.carryFrame(Rd);
    S.rotation = deg;
    App.sortLanesIfNeeded();
    App.ensureRot();
  };
  // move every annotation from the current working frame to a new one by the point map T (a 3 x 3 matrix or a function (x, y) -> {x, y})
  App.carryFrame = function (T) {
    const S = App.S, W = App.src.w, H = App.src.h, cx = (W - 1) / 2;
    const P = typeof T === 'function' ? T : (x, y) => E.M3.apply(T, x, y);
    // one set of annotations (the shown row, or a stashed one): everything moves with its crop
    const carry = A => {
      const c = A.crop, ccx = c.x + c.w / 2, ccy = c.y + c.h / 2;
      const laneX0 = A.lanes.map(l => l.x);
      A.markers.forEach(m => { const lx = laneX0[m.lane]; if (lx == null) return; m.bands.forEach(b => { b.y = P(lx, b.y).y; }); });
      A.arrows.forEach(a => { a.y = P(ccx, a.y).y; });
      // strips and band boxes span the crop: carried at its horizontal centre like arrows
      A.strips.concat(A.quant.rows).forEach(r => { r.y0 = P(ccx, r.y0).y; r.y1 = P(ccx, r.y1).y; });
      A.lanes.forEach(l => { l.x = P(l.x, ccy).x; });
      // the crop is carried by the midpoints of its four sides, so a keystone that spreads the lanes
      // spreads the box with them (carried by its centre at a fixed size, its sides cut into the
      // outer lanes after a correction); a rotation moves the midpoints hardly at all
      const x0 = P(c.x, ccy).x, x1 = P(c.x + c.w, ccy).x, y0 = P(ccx, c.y).y, y1 = P(ccx, c.y + c.h).y;
      const cx0 = Math.max(0, Math.min(x0, x1)), cx1 = Math.min(W, Math.max(x0, x1)), cy0 = Math.max(0, Math.min(y0, y1)), cy1 = Math.min(H, Math.max(y0, y1));
      A.crop = { x: Math.round(cx0), y: Math.round(cy0), w: Math.max(10, Math.round(cx1 - cx0)), h: Math.max(10, Math.round(cy1 - cy0)) };
    };
    carry(S);
    Object.values(S.rowStash || {}).forEach(carry);
    if (S.gelRows) S.gelRows.forEach(r => { r.y0 = P(cx, r.y0).y; r.y1 = P(cx, r.y1).y; });
  };

  /* ---------- geometry correction: perspective (keystone) and lane straightening ----------
   * S.geom = null (off) or { mode: 'auto' | 'manual', grid, H, corners, lanesPct, bandsPct, bendPx, lanes, rows }:
   * grid maps the working frame to the rotated frame (E.Grid); H is the keystone part (rotated
   * frame -> working frame) for the report; corners the four slab corners of a manual box (rotated
   * frame); bendPx the largest per-lane shift of the straightening; lanes / rows what it used. */
  App.setGeom = function (next) {
    const S = App.S, W = App.src.w, H = App.src.h;
    const G0 = App.geomGrid(S), G1 = next && next.grid ? next.grid : null;
    const f = (x, y) => {
      const r = G0 ? E.Grid.at(G0, x, y) : { x, y };
      return G1 ? E.Grid.inv(G1, r.x, r.y) : r;
    };
    App.carryFrame(f);
    // the well line found by the auto crop follows the frame too (the comb and the traces stop above it)
    if (App.cropMeta && App.cropMeta.wellY != null) App.cropMeta.wellY = f(S.crop.x + S.crop.w / 2, App.cropMeta.wellY).y;
    S.geom = next && next.grid ? next : null;
    App.sortLanesIfNeeded();
    App.ensureRot();
  };
  App.afterGeom = function () { App.afterRotation(); };
  App.geomReport = function () {
    const S = App.S, g = S.geom;
    if (!g) return { lanesPct: 0, bandsPct: 0, bendPx: 0 };
    const r = g.H ? E.keystoneReport(E.M3.inv(g.H), S.crop) : { lanesPct: 0, bandsPct: 0 };
    return { lanesPct: r.lanesPct, bandsPct: r.bandsPct, bendPx: g.bendPx || 0 };
  };
  /* The band rows of the ladders: every size matched in two or more marker lanes gives a line
   * y = a + b (x - xc) through those bands; their vanishing point (or null), and the rows
   * themselves (for the straightening: {at: x => y, yc}). */
  App.bandRows = function () {   // ladder band rows across the marker lanes (the vertical reference of the straightening)
    const S = App.S, c = S.crop, xc = c.x + c.w / 2;
    // only markers that fit their ladder well anchor the geometry
    const mk = S.markers.filter(m => S.lanes[m.lane] && (m.score == null || m.score >= 0.6));
    if (mk.length < 2) return { lines: [], rows: [] };
    // the vertical levelling (rows) needs three ladders: a row through two points has no residual to
    // judge it by, and one mis-assigned band would tilt every sample band between the ladders
    const rowsOk = mk.length >= 3;
    const bySize = new Map();
    mk.forEach(m => m.bands.forEach(b => {
      if (!(b.matched || b.manual) || b.bp == null) return;
      if (!bySize.has(b.bp)) bySize.set(b.bp, []);
      bySize.get(b.bp).push({ x: S.lanes[m.lane].x, y: b.y });
    }));
    const lines = [], rows = [];
    bySize.forEach(pts => {
      if (pts.length < 2) return;
      let n = pts.length, sx = 0, sy = 0, sxx = 0, sxy = 0;
      pts.forEach(q => { const dx = q.x - xc; sx += dx; sy += q.y; sxx += dx * dx; sxy += dx * q.y; });
      const den = n * sxx - sx * sx;
      if (den <= 0) return;
      const b = (n * sxy - sx * sy) / den, a = (sy - b * sx) / n;
      lines.push({ a, b, n });
      if (!rowsOk) return;
      const x0 = Math.min(...pts.map(q => q.x)), x1 = Math.max(...pts.map(q => q.x)), cl = x => Math.max(x0, Math.min(x1, x));   // held beyond the outermost marker
      // a straight row through the markers (never an exact fit through three points); its residual is
      // judged below against the spacing of the neighbouring rows
      let res = 0; pts.forEach(q => { res = Math.max(res, Math.abs(q.y - (a + b * (q.x - xc)))); });
      rows.push({ yc: a, res, at: x => a + b * (cl(x) - xc) });
    });
    // a row whose markers scatter by more than 0.3 of the local band spacing is a mis-assigned band, not a smile
    rows.sort((p, q) => p.yc - q.yc);
    const kept = rows.filter((r, i) => {
      const sp = Math.min(i > 0 ? r.yc - rows[i - 1].yc : Infinity, i < rows.length - 1 ? rows[i + 1].yc - r.yc : Infinity);
      return sp !== Infinity && r.res <= 0.3 * sp;
    });
    return { lines, rows: kept.length >= 3 ? kept : [] };

  };
  /* The band rows' vanishing point from the slab's top and bottom edges (the four corners of the
   * outline): the two edges meet where the band rows would; used when fewer than three ladders can
   * give it. Null unless the gel's height differs by at least 2 % between the crop's left and right. */
  App.slabRowVanishing = function (q, c) {
    const [TL, TR, BR, BL] = q;
    const top = x => TL[1] + (TR[1] - TL[1]) * (x - TL[0]) / Math.max(1e-9, TR[0] - TL[0]), bot = x => BL[1] + (BR[1] - BL[1]) * (x - BL[0]) / Math.max(1e-9, BR[0] - BL[0]);
    const hL = bot(c.x) - top(c.x), hR = bot(c.x + c.w) - top(c.x + c.w), change = (hR - hL) / Math.max(1e-9, (hR + hL) / 2);
    if (!(Math.abs(change) >= 0.02) || hL <= 0 || hR <= 0) return null;
    // intersection of the two edge lines
    const d1 = [TR[0] - TL[0], TR[1] - TL[1]], d2 = [BR[0] - BL[0], BR[1] - BL[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 1e-9) return null;
    const t = ((BL[0] - TL[0]) * d2[1] - (BL[1] - TL[1]) * d2[0]) / den;
    return { change, point: { x: TL[0] + d1[0] * t, y: TL[1] + d1[1] * t } };
  };
  App.bandRowVanishing = function () { const r = App.bandRows(); return r.lines.length >= 3 ? E.vanishing(r.lines, App.S.crop.x + App.S.crop.w / 2, App.S.crop.w) : null; };
  /* After the lanes are rebuilt (fn), find the marker lanes again but keep the ladder the user chose
   * for a marker that is still at (about) the same position. Returns what fn returned. */
  App.relaneMarkers = function (fn) {
    const S = App.S, tol = (S.lanePitch || 40) * 0.5;
    const prev = S.markers.map(m => ({ x: S.lanes[m.lane] ? S.lanes[m.lane].x : -1e9, ladderId: m.ladderId, unit: m.unit, side: m.side }));
    const n = fn();
    // the ladder already in use is the usual one for this search (no library-wide search again)
    const keepPref = App.prefLadder; if (prev.length && prev[0].ladderId) App.prefLadder = prev[0].ladderId;
    try { App.autoMarkers(); } finally { App.prefLadder = keepPref; }
    let changed = false;
    S.markers.forEach(m => {
      const q = prev.find(q => Math.abs(q.x - S.lanes[m.lane].x) < tol);
      if (q) { if (m.ladderId !== q.ladderId) changed = true; Object.assign(m, { ladderId: q.ladderId, unit: q.unit, side: q.side }); }
    });
    if (changed) App.matchMarkers(true);
    return n;
  };
  /* Automatic geometry, recursive: in every round (at most 5) the keystone is estimated from the
   * lane lines (and the ladder band rows across two or more markers) and applied when significant;
   * then every lane is traced down the crop and the traces are made straight and vertical (the
   * ladder band rows horizontal) by a smooth displacement grid; the lanes are detected again on
   * the corrected image (names kept by position) and the round repeats until the lane count and
   * positions settle and the lanes bend by less than 3 % of the pitch. The markers are then found
   * again, keeping any ladder chosen by hand. Returns { applied, rounds, lanes, bendPx, lanesPct, bandsPct, converged, message }. */
  /* Lane resolution in the column density over the crop: {peak, valley, ratio}. peak = the mean
   * presence at the lanes, valley = the mean half-way between neighbouring lanes, ratio = valley /
   * peak (lower = lanes better separated). Null with fewer than two lanes in the crop. */
  App.laneContrast = function () {
    const S = App.S, c = S.crop, img = App.ensureRot(), P = S.lanePitch || (S.laneHalfW / 0.3);
    const xs = S.lanes.map(l => l.x).filter(x => x >= c.x - P * 0.5 && x <= c.x + c.w + P * 0.5).sort((a, b) => a - b);
    if (xs.length < 2) return null;
    const x0 = Math.max(0, Math.round(c.x - P)), band = E.cropImg(img, { x: x0, y: c.y, w: c.w + 2 * P, h: c.h });
    const q = E.presenceProfile(E.signal(band, S.bright), c.w), at = x => { const i = Math.round(x - x0); return i >= 0 && i < q.length ? q[i] : 0; };
    let pk = 0, va = 0; xs.forEach((x, k) => { pk += at(x); if (k) va += at((x + xs[k - 1]) / 2); });
    pk /= xs.length; va /= xs.length - 1;
    return { peak: pk, valley: va, ratio: pk > 0 ? va / pk : null };
  };
  App.autoGeometry = async function () {
    App.autoGeometry.debug = []; const tStart = performance.now(); App.autoGeometry.debug.ms = () => Math.round(performance.now() - tStart);
    // S is re-read after every restore of a snapshot (App.S is replaced by the restore)
    let S = App.S;
    const W = App.src.w, Hh = App.src.h, lanes0 = S.lanes.length;
    let applied = false, rounds = 0, converged = false, lines = 0, bendBefore = 0, lastChange = null, roundSnap = null, Hk = (S.geom && S.geom.H) || E.M3.I();
    let grid = App.geomGrid(S), slab = null, qSlab = null, rowsFrom = null;
    const inCrop = () => { const c = S.crop, P = S.lanePitch || (S.laneHalfW / 0.3); return S.lanes.map(l => l.x).filter(x => x >= c.x - P * 0.5 && x <= c.x + c.w + P * 0.5); };
    // the wells and their pockets (down to 1.5 pitch below the well line) are not lanes: their dark
    // walls sit between the lanes and would offset the comb by half a pitch
    // (2.5 pitches: on the sanity-check photograph the pockets are deep, and the band 1.5-3 pitches
    // below the well row reads a pitch 6 % below the gel's, which no camera angle removes)
    const yMin = () => { const P = S.lanePitch || (S.laneHalfW / 0.3); return App.cropMeta && App.cropMeta.wellY != null ? App.cropMeta.wellY + P * 2.5 : null; };
    // 32 bands for the comb: with 16 the estimate on that photograph swung between 12 and 24 % with
    // the box's rows (which bands got a fit decided the slope); with 32, weighted by what each band
    // knows, the four boxes tried agree within a point
    const COMB_BANDS = 32;
    const hook = async (l, text) => { App.autoGeometry.debug.push({ step: l, ms: App.autoGeometry.debug.ms() }); if (App.autoGeometry.onStep) App.autoGeometry.onStep(l); if (text) { App.progress(text); await App.yield(); } };
    // the resolution of the lanes in the column density: the mean density half-way between
    // neighbouring lanes divided by the mean at the lanes (lower = lanes better separated)
    const contrast = () => { const r = App.laneContrast(); return r ? r.ratio : null; };
    // convergence of the lane lines in the current frame (null when too few lanes are measurable)
    const convergence = () => {
      const img = App.ensureRot(), c = S.crop, xs = inCrop(), P = S.lanePitch || (S.laneHalfW / 0.3);
      if (xs.length < 4) return null;
      const v = E.laneComb(img, S.bright, c, xs, P, COMB_BANDS, 3, yMin());
      return v ? v.change : null;
    };
    /* 0. the slab outline. A gel photographed at an angle may drift by a whole lane pitch over its
     * height, which merges neighbouring lanes in the column profile before any lane line can be
     * measured; the outline of the slab needs no lanes. Its four corners give a perspective that
     * is kept only when it leaves the lane lines straighter than before (or straight enough when
     * they could not be measured before). */
    if (!grid) {
      App.progress('Gel shape: measuring the slab outline…'); await App.yield();
      const c = S.crop, q = E.slabQuad(App.ensureRot(), { x: c.x + c.w / 2, y: c.y + c.h / 2, win: { x0: c.x - c.w * 0.5, x1: c.x + c.w * 1.5, y0: c.y - c.h * 0.5, y1: c.y + c.h * 1.5 } });
      qSlab = q;
      const Hq = q && E.homographyFromQuad(q);
      // a global homography that scales any cell by more than a fifth is not a camera angle
      if (Hq && E.Grid.maxScale(E.Grid.fromH(Hq, W, Hh)) < 0.2) {
        const before = convergence(), snap = App.snapshot();
        App.setGeom({ mode: 'auto', grid: E.Grid.fromH(Hq, W, Hh), H: Hq, corners: q, lanesPct: 0, bandsPct: 0, bendPx: 0, lanes: 0, rows: 0 });
        App.autoLanes();
        const after = convergence();
        // kept only when it fixes a real convergence: lanes that converged must converge less than half
        // as much; lanes that were already parallel need nothing
        // (the outline alone is no evidence: a gel whose lanes cannot be measured is left as it is)
        const ok = before != null && after != null && Math.abs(before) >= 0.03 && Math.abs(after) < Math.abs(before) * 0.5;
        App.autoGeometry.debug.push({ slab: true, before: before != null ? +before.toFixed(4) : null, after: after != null ? +after.toFixed(4) : null, ok, report: E.keystoneReport(Hq, c) });
        if (ok) { applied = true; grid = App.geomGrid(S); Hk = Hq; slab = q; await hook('slab', 'Gel shape: slab outline mapped, lanes detected again…'); }
        else { App.S = S = JSON.parse(snap); App.rot = null; App.ensureRot(); grid = null; }
      }
    }
    /* 1. the keystone, iterated: the lane comb is measured on the corrected image after every
     * round (the lanes detected again), until it reports the lanes parallel. A global transform
     * first; the local straightening comes after it, never before (straightened lanes are parallel
     * by construction, so a keystone fitted after them would only re-bend the gel). */
    const centre = c => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });
    for (; rounds < 4; rounds++) {
      // only the lanes of the framed gel: a lane left outside the box is not part of its geometry
      const img = App.ensureRot(), c = S.crop, xs = inCrop(), P = S.lanePitch || (S.laneHalfW / 0.3);
      if (xs.length < 4) break;
      // the first round must be sure (three standard errors: an undistorted gel gets nothing); the
      // later ones refine a keystone already found and need less
      // (three standard errors in every round: the refinement rounds once asked 1.5, and on the
      // sanity-check photograph a 2 % residual at 2 standard errors then added a 5 % round)
      const v = E.laneComb(img, S.bright, c, xs, P, COMB_BANDS, 3, yMin()), u = App.bandRowVanishing();
      lines = v ? v.n : 0;
      const V = v && v.point ? { x: v.point.across, y: v.point.along } : null;
      let U = u && u.point ? { x: u.point.along, y: u.point.across } : null;
      if (U) rowsFrom = 'ladder band rows';
      // without three ladders the band rows' convergence is read from the slab's top and bottom
      // edges (the well line and the slab bottom are straight lines of the gel, not sample bands)
      // (tried at load and withheld: on the synthetic Western example the outline's top edge is fitted
      // on the comb teeth and its tilt read as a 10 % row convergence on an undistorted gel; it needs a
      // test that the two edges are straight and agree with the well line before it can be trusted)
      if (!U && !rounds && qSlab && App.slabRowsFromOutline) { const su = App.slabRowVanishing(qSlab, c); if (su) { U = su.point; rowsFrom = 'slab edges'; } }
      App.autoGeometry.debug.push({ round: rounds, keystone: true, frame: App.frameKey(S), xs: xs.map(Math.round), P: +P.toFixed(1), crop: c, bands: lines, combDbg: E.laneComb.debug, lanes: v && +v.change.toFixed(4), lanesSig: v && v.se ? +(Math.abs(v.change) / v.se).toFixed(1) : null, rows: u && +u.change.toFixed(4) });
      // a first-round keystone must move the far lane by at least 0.1 pitch over the crop (a smaller
      // one is within the comb's own noise and would only put a spurious line into the legend)
      if (V && Math.abs(v.change) < 0.2 / Math.max(1, xs.length - 1)) { converged = true; break; }
      if (!V && !U) { converged = true; break; }
      // a spacing that would more than double over the crop is not a camera angle
      if (v && v.point && Math.abs(v.change) > 0.6) { converged = true; break; }
      // the remaining convergence must shrink from round to round and keep its sign: an estimate that
      // grows, or flips its sign by more than half of the last one, says the gel is not a keystone
      // (torn, locally compressed), and the rounds stop
      // ...and a round after which the lanes converge no less than before (or the other way, by more
      // than half) made things worse, not better: it is taken back, not kept
      if (v && v.point && lastChange != null && (Math.abs(v.change) >= Math.abs(lastChange) || (Math.sign(v.change) !== Math.sign(lastChange) && Math.abs(v.change) > Math.abs(lastChange) * 0.5))) {
        if (roundSnap) { App.S = S = JSON.parse(roundSnap.snap); App.rot = null; App.ensureRot(); grid = roundSnap.grid; Hk = roundSnap.Hk; applied = roundSnap.applied; rounds--; App.autoGeometry.debug.push({ round: rounds, reverted: true, before: +lastChange.toFixed(4), after: +v.change.toFixed(4) }); }
        converged = true; break;
      }
      lastChange = v && v.point ? v.change : null;
      roundSnap = { snap: App.snapshot(), grid, Hk, applied };
      const Hi = E.keystoneH(V, U, centre(c)), step = E.Grid.fromH(Hi, W, Hh);
      Hk = E.M3.mul(Hi, Hk); grid = grid ? E.Grid.compose(grid, step) : step;
      App.setGeom({ mode: 'auto', grid, H: Hk, corners: slab, lanesPct: 0, bandsPct: 0, bendPx: 0, lanes: 0, rows: 0, slab: !!slab });
      applied = true;
      App.autoLanes();   // the lanes again on the corrected image
      await hook('keystone ' + (rounds + 1), `Gel shape: camera angle round ${rounds + 1} (${v && v.change > 0 ? '+' : ''}${v ? (v.change * 100).toFixed(1) : '?'} %), lanes detected again…`);
    }
    /* 2. per-lane straightening, once, on the keystone-corrected image: traces that scatter more
     * than a tenth of the pitch (a faint ladder under a smear, a torn lane) are not trusted and
     * follow their neighbours' shift; the bend of the gel is the median over lanes, so one bad lane
     * neither drives nor hides the correction; the round is kept only when the median bend falls. */
    if (!S.markers.length) { App.progress('Gel shape: finding the ladders…'); await App.yield(); App.autoMarkers(); }   // once per load: the ladders (for the row levelling and the figure)
    {
      App.progress('Gel shape: tracing the lanes…'); await App.yield();
      const img = App.ensureRot(), c = S.crop, xs = inCrop(), P = S.lanePitch || (S.laneHalfW / 0.3);
      const trusted = T => T.map(t => (t && t.res <= P * 0.1 ? t : null));
      const bendOf = T => { const b = T.filter(Boolean).map(t => Math.max(Math.abs(t.at(c.y + c.h * 0.1) - t.a), Math.abs(t.at(c.y + c.h * 0.9) - t.a))).sort((p, q) => p - q); return b.length ? b[b.length >> 1] : 0; };
      const tr = xs.length >= 3 ? trusted(E.laneTraces(img, S.bright, c, xs, P, 16, yMin())) : [];
      bendBefore = bendOf(tr);
      const rows = App.bandRows().rows;
      // a bend worth straightening is more than noise: 5 % of the pitch and at least 3 px
      // the grid's nodes sit closer than half a lane pitch, so the field between lanes is realised and
      // not blurred over a lane (33 x 33 over a photograph is 60 px apart)
      const nx = Math.max(33, Math.min(129, Math.ceil(2 * W / P) + 1)), ny = Math.max(33, Math.min(65, Math.ceil(2 * Hh / P) + 1));
      // a gel with several rows of wells: the correction fades out within this row's band, never into the next
      const band = S.gelRows ? App.rowBand(S.gelRow) : null;
      let sg = tr.filter(Boolean).length >= 3 && bendBefore > Math.max(3, P * 0.05) ? E.straightenGrid(W, Hh, c, tr, rows, nx, ny, band) : null;
      if (sg && sg.maxShift > P) sg = null;   // a shift of more than a lane pitch is a wrong trace, not a bend
      if (sg && (sg.folded || sg.scaleMax > 0.25)) { App.autoGeometry.debug.push({ straighten: true, rejected: 'fold or local scale', scaleMax: sg.scaleMax, folded: sg.folded }); sg = null; }
      if (sg) {
        const cBefore = contrast();
        const snapRound = App.snapshot(), gridBefore = grid, g = grid ? E.Grid.compose(grid, sg.grid) : sg.grid;
        App.setGeom({ mode: 'auto', grid: g, H: Hk, corners: slab, lanesPct: 0, bandsPct: 0, bendPx: sg.maxShift, dyPx: sg.maxDy, lanes: tr.filter(Boolean).length, rows: rows.length, slab: !!slab });
        const tr2 = trusted(E.laneTraces(App.ensureRot(), S.bright, S.crop, inCrop(), P, 16, yMin()));
        const bendAfter = bendOf(tr2);
        App.autoGeometry.debug.push({ round: rounds, straighten: true, widthLanes: E.straightenGrid.widthLanes, bendBefore: +bendBefore.toFixed(1), bendAfter: +bendAfter.toFixed(1), shift: +sg.maxShift.toFixed(1), traces: tr.filter(Boolean).length, traces2: tr2.filter(Boolean).length,
          before: tr.map(t => t ? [Math.round(t.a), +(t.at(c.y + c.h * 0.1) - t.a).toFixed(1), +(t.at(c.y + c.h * 0.9) - t.a).toFixed(1), t.n, +t.res.toFixed(1), Math.round(t.w0), t.wTrend] : null), after: tr2.map(t => t ? [Math.round(t.a), +(t.at(S.crop.y + S.crop.h * 0.1) - t.a).toFixed(1), +(t.at(S.crop.y + S.crop.h * 0.9) - t.a).toFixed(1), t.n, +t.res.toFixed(1), Math.round(t.w0), t.wTrend] : null) });
        // kept only when the median bend falls AND the lanes come out better separated in the
        // column density (an independent test: a warp built from the chains always flattens the
        // chains, but only a real straightening sharpens the lanes)
        const cAfter = contrast();
        App.autoGeometry.debug[App.autoGeometry.debug.length - 1].contrast = [cBefore, cAfter];
        if (bendAfter > bendBefore * 0.9 || (cBefore != null && cAfter != null && cAfter > cBefore - 0.005)) { App.S = S = JSON.parse(snapRound); App.rot = null; App.ensureRot(); grid = gridBefore; }
        else { grid = g; applied = true; rounds++; App.autoLanes(); await hook('straighten', 'Gel shape: lanes straightened, lanes detected again…'); }
      }
    }
    // after a straightening the lanes are cleaner: the ladders are looked for once more, which is
    // cheap now that the gel's ladder is known (a lane that fits it names itself); otherwise re-fitted
    if (applied && S.geom) {
      if (slab) S.geom.slab = true;
      if (rowsFrom) S.geom.rowsFrom = rowsFrom;
      if (S.markers.length && !(S.geom.bendPx > 0)) App.matchMarkers(true); else App.relaneMarkers(() => 0);
      Object.assign(S.geom, App.geomReport());
      // disclosed with the correction: what remains of the lane convergence, and the largest local scale of the map
      const P = S.lanePitch || (S.laneHalfW / 0.3), vf = inCrop().length >= 4 ? E.laneComb(App.ensureRot(), S.bright, S.crop, inCrop(), P, COMB_BANDS, 3, yMin()) : null;
      S.geom.residualPct = vf ? +(vf.change * 100).toFixed(1) : null;
      S.geom.scaleMax = +(E.Grid.maxScale(S.geom.grid) * 100).toFixed(1);
      // the box is framed again on the lanes it holds: the lanes were detected again on the corrected
      // image, and a side of the box must sit in the gap beside the outer lane, never on the lane
      App.reframeCrop();
    }
    S.geomChecked = true;   // the panel says "checked, none needed" rather than "off" when nothing was applied
    const k = S.geom, dl = S.lanes.length - lanes0;
    if (!applied) return { applied: false, rounds, lanes: S.lanes.length, converged, message: S.lanes.length < 3 ? 'Geometry needs at least three lanes (add them with "+ Add lane" or "Space evenly", then try again)' : `No correction needed: the lanes run straight and parallel (${lines} bands of lanes measured, largest bend ${bendBefore.toFixed(1)} px).` };
    const parts = [];
    if (Math.abs(k.lanesPct) >= 0.5 || Math.abs(k.bandsPct) >= 0.5) parts.push(`perspective${k.slab ? ' from the slab outline' : ''}: lane spacing at the bottom ${k.lanesPct > 0 ? '+' : ''}${k.lanesPct} % of the top, band spacing at the right ${k.bandsPct > 0 ? '+' : ''}${k.bandsPct} % of the left`);
    if (k.bendPx >= 0.5) parts.push(`lanes straightened (largest shift ${k.bendPx.toFixed(1)} px, ${k.lanes} lane traces${k.rows ? `, ${k.rows} ladder band rows` : ''})`);
    return { applied: true, rounds, lanes: S.lanes.length, bendPx: k.bendPx, lanesPct: k.lanesPct, bandsPct: k.bandsPct, converged,
      message: `Geometry corrected in ${rounds} round${rounds === 1 ? '' : 's'}: ${parts.join('; ')}; lanes detected again: ${S.lanes.length} wells${dl ? ` (${dl > 0 ? '+' : ''}${dl})` : ''}, markers re-fitted${converged ? '' : ' (not fully settled after 4 rounds)'}` };
  };
  /* Manual geometry: four slab corners (TL, TR, BR, BL) in the working frame are mapped to a
   * rectangle of the same centre and mean side lengths (one projective transform). Corners are
   * kept in the rotated frame so a later rotation carries them. */
  App.setGeomCorners = function (cornersWork) {
    const S = App.S, W = App.src.w, Hh = App.src.h, G0 = App.geomGrid(S);
    const rot = cornersWork.map(([x, y]) => { const r = G0 ? E.Grid.at(G0, x, y) : { x, y }; return [r.x, r.y]; });
    const H = E.homographyFromQuad(rot);
    if (!H) return false;
    App.setGeom({ mode: 'manual', grid: E.Grid.fromH(H, W, Hh), H, corners: rot, lanesPct: 0, bandsPct: 0, bendPx: 0, lanes: 0, rows: 0 });
    Object.assign(S.geom, App.geomReport());
    return true;
  };
  // the corners of the manual box in the working frame (for the editor): the box being placed, else
  // the corners of the correction in force, else the crop's corners
  App.pendingCorners = null;
  App.geomCornersWork = function () {
    const S = App.S, g = S.geom;
    if (App.pendingCorners) return App.pendingCorners.map(c => c.slice());
    if (g && g.corners && g.grid) return g.corners.map(([x, y]) => { const q = E.Grid.inv(g.grid, x, y); return [q.x, q.y]; });
    const c = S.crop; return [[c.x, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]];
  };
  // after the crop was dragged, the geometry settled or a manual box was placed: lanes inside the
  // crop and the markers again, keeping names (by position) and chosen ladders
  App.redetectAll = function () {
    const S = App.S;
    if (!S.lanes.length) return;
    App.relaneMarkers(() => App.redetectLanesInCrop());
  };
  // after a rotation is committed: refresh things that depend on pixels
  App.afterRotation = function () {
    App.updateSaturation();
    App.refineMarkers();
  };
  /* Carried band positions are already close; re-matching from scratch could re-assign a band to a
   * different peak on a hard gel. Only snap each band to a detected peak nearby, keep assignments. */
  App.refineMarkers = function () {
    const S = App.S;
    if (!S.markers.some(m => m.bands.length)) { App.matchMarkers(false); return; }
    App._mkCrop = App.markerStrip();
    try {
      S.markers.forEach(m => {
        if (!S.lanes[m.lane] || !m.bands.length) return;
        const peaks = App.markerPeaks(m.lane).map(p => p.y + S.crop.y);
        const ys = m.bands.map(b => b.y).sort((a, b) => a - b);
        m.bands.forEach(b => {
          if (!(b.matched || b.manual)) return;
          // never further than a third of the way to the neighbouring band
          let gap = Infinity; ys.forEach(y => { if (y !== b.y) gap = Math.min(gap, Math.abs(y - b.y)); });
          const tol = Math.max(2, Math.min(8, gap / 3));
          let best = null; peaks.forEach(y => { if (Math.abs(y - b.y) <= tol && (best == null || Math.abs(y - b.y) < Math.abs(best - b.y))) best = y; });
          if (best != null) b.y = best;
        });
      });
    } finally { App._mkCrop = null; }
  };

  // ---------- resets ----------
  App.initialState = function () { return App.initial ? JSON.parse(App.initial) : null; };
  // contrast back to what the import produced (automatic linear levels, gamma 1); polarity untouched
  App.resetLevels = function () {
    const I = App.initialState(), lv = App.S.levels;
    if (I) { lv.black = I.levels.black; lv.white = I.levels.white; } else { lv.black = 0; lv.white = 1; }
    lv.gamma = 1;
  };
  App.resetLayout = function () { App.S.style = Object.assign(defaultStyle(), { dpi: App.S.style.dpi }); };
  App.resetRotation = function () { App.setRotation(App.autoRotation || 0); App.afterRotation(); };
  // everything back to the moment after import; the undo chain starts again from there
  App.resetAll = function () {
    if (!App.initial) return;
    App.S = JSON.parse(App.initial);
    App.rot = null; App.ensureRot();
    App.hist = [App.initial]; App.future = [];
    savePrefs();
    App.emit('change');
  };

  /* Clipping in the crop, as two different things:
   *  - sensor: the camera itself saturated (raw ≥ 0.998)
   *  - levels: pixels pushed past the black / white point by the contrast setting (display only,
   *    but a band core flattened this way is just as lost in the figure) */
  App.clipStats = function () {
    const S = App.S, lv = S.levels;
    const key = [S.rotation, S.crop.x, S.crop.y, S.crop.w, S.crop.h, lv.black, lv.white].join('|');
    if (App._clipKey === key) return App._clip;
    const c = App.cropImg(), d = c.data, n = d.length;
    let sensor = 0, high = 0, low = 0;
    for (let i = 0; i < n; i++) { const v = d[i]; if (v >= SAT) sensor++; if (v > lv.white) high++; else if (v < lv.black) low++; }
    App._clipKey = key;
    // "high" is what turns pure white on screen when not inverted, pure black when inverted
    return (App._clip = { n, sensor, high, low, highFrac: high / n, lowFrac: low / n, sensorFrac: sensor / n });
  };
  // the band side of the levels: bright bands are clipped at the white point, dark bands at black
  App.bandClipFrac = function () { const k = App.clipStats(); return App.S.bright ? k.highFrac : k.lowFrac; };

  // ---------- resolution ----------
  // pixels of the gel actually placed per inch of the printed figure (no upsampling)
  App.effectiveDpi = function () { return App.visibleWidthPx() / (App.gelWidthMm() / 25.4); };
  App.maxSafeWidthMm = function (dpi) { return Math.floor(App.visibleWidthPx() / (dpi || 300) * 25.4); };
  App.autoCrop = function (band) {
    App.S.crop = E.autoCrop(App.ensureRot(), App.S.bright, band);
    App.cropMeta = E.autoCrop.meta || null;
    App.updateSaturation();
  };

  /* ---------- gels with several rows of wells ----------
   * Each row is analysed on its own; the figure shows one row at a time. Annotations of the rows not
   * shown wait in S.rowStash, so switching back and forth loses nothing. */
  const ROW_KEYS = ['crop', 'lanes', 'laneHalfW', 'lanePitch', 'markers', 'groups', 'conditions', 'arrows', 'strips', 'quant'];
  // the image band one row may use: its own extent plus room for its wells above, never into a neighbour
  App.rowBand = function (k) {
    const rows = App.S.gelRows, r = rows[k], H = App.ensureRot().h, rh = r.y1 - r.y0;
    const prev = rows[k - 1], next = rows[k + 1];
    const up = prev ? Math.min(rh * 0.45, (r.y0 - prev.y1) * 0.5) : rh * 0.45;
    const down = next ? Math.min(rh * 0.15, (next.y0 - r.y1) * 0.5) : rh * 0.15;
    return { y0: Math.max(0, r.y0 - up), y1: Math.min(H, r.y1 + down) };
  };
  App.rowCount = function () { return App.S.gelRows ? App.S.gelRows.length : 1; };
  function analyseRow(k) {
    App.autoCrop(App.rowCount() > 1 ? App.rowBand(k) : undefined);
    App.autoLevels();
    App.autoLanes();
    const loaded = App.loadedLaneRange();
    if (loaded) App.setLaneRange(loaded[0], loaded[1]);
    App.autoMarkers();
    App.fixIndices();
    App.updateSaturation();
  }
  App.setGelRow = function (k) {
    const S = App.S;
    if (!S.gelRows || k === S.gelRow || !S.gelRows[k]) return false;
    S.rowStash[S.gelRow] = JSON.parse(JSON.stringify(Object.fromEntries(ROW_KEYS.map(key => [key, S[key]]))));
    S.gelRow = k;
    const st = S.rowStash[k];
    if (st) { ROW_KEYS.forEach(key => { S[key] = st[key]; }); delete S.rowStash[k]; App.updateSaturation(); }
    else { S.groups = []; S.conditions = []; S.arrows = []; S.strips = []; S.quant = defaultQuant(); S.markers = []; S.lanes = []; analyseRow(k); }
    App._emptyKey = null;
    return true;
  };
  App.autoLevels = function () {
    const lv = E.autoLevels(App.cropImg());
    App.S.levels.black = lv.black; App.S.levels.white = lv.white;
  };

  /* Lanes are global: one per well across the whole gel, numbered like the notebook. The crop only
   * chooses which of them appear in the figure, so cropping never adds/removes lanes. */
  App.autoLanes = function () {
    const S = App.S, rot = App.ensureRot();
    const L = E.detectLaneLattice(rot, S.bright, S.crop, App.cropMeta);
    let xs, half, pitch;
    if (L && L.centers.length) { xs = L.centers; half = L.halfW; pitch = L.pitch; }
    else {
      const c = App.cropImg(), r = E.detectLanes(c, S.bright);
      xs = (r.centers.length >= 2 ? r.centers : E.evenLanes(Math.max(S.lanes.length, 10), c.w)).map(x => x + S.crop.x);
      pitch = r.pitch || c.w / 10; half = pitch * 0.3;
    }
    App.replaceLanes(xs);
    S.laneHalfW = Math.max(2, half);
    S.lanePitch = pitch;
  };

  // swap in new lane positions, carrying names / markers / groups / conditions over by position
  App.replaceLanes = function (xs) {
    const S = App.S, old = S.lanes, tol = (S.lanePitch || 40) * 0.45;
    const near = x => { let bi = -1, bd = tol; old.forEach((l, i) => { const d = Math.abs(l.x - x); if (d < bd) { bd = d; bi = i; } }); return bi; };
    const fromOld = xs.map(near);                 // new index -> old index (or -1)
    const toNew = new Map(); fromOld.forEach((o, n) => { if (o >= 0 && !toNew.has(o)) toNew.set(o, n); });
    const nearestNew = o => { if (toNew.has(o)) return toNew.get(o); let bi = 0, bd = Infinity; xs.forEach((x, n) => { const d = Math.abs(x - (old[o] ? old[o].x : 0)); if (d < bd) { bd = d; bi = n; } }); return bi; };
    S.lanes = xs.map((x, n) => { const o = fromOld[n] >= 0 ? old[fromOld[n]] : null; return { x, name: o ? o.name : '', hidden: o ? !!o.hidden : false }; });
    S.markers = S.markers.filter(m => toNew.has(m.lane)).map(m => Object.assign(m, { lane: toNew.get(m.lane) }));
    if (S.quant.ref >= 0) S.quant.ref = toNew.has(S.quant.ref) ? toNew.get(S.quant.ref) : -1;
    S.groups.forEach(g => { g.from = nearestNew(g.from); g.to = nearestNew(g.to); });
    S.conditions.forEach(c => { const v = c.values.slice(); c.values = xs.map((x, n) => (fromOld[n] >= 0 ? v[fromOld[n]] || '' : '')); });
    App.fixIndices();
  };

  /* Re-do the lanes using ONLY the pixels inside the crop: lanes outside stay untouched, lanes
   * inside are replaced. Names typed for the in-crop lanes are kept in left-to-right order, so a
   * wrong first detection never has to be corrected lane by lane. */
  function replaceInCrop(insideXs, pitch) {
    const S = App.S, c = S.crop, inC = l => l.x >= c.x && l.x <= c.x + c.w;
    const oldNames = S.lanes.filter(inC).map(l => l.name);
    const oldHidden = S.lanes.filter(inC).map(l => !!l.hidden);
    const outside = S.lanes.filter(l => !inC(l)).map(l => l.x);
    App.replaceLanes(outside.concat(insideXs).sort((a, b) => a - b));
    S.lanes.filter(inC).forEach((l, k) => { l.name = oldNames[k] || ''; l.hidden = oldHidden[k] || false; });
    S.lanePitch = pitch;
    S.laneHalfW = Math.max(2, pitch * 0.3);
  }
  App.redetectLanesInCrop = function () {
    const S = App.S, c = App.cropImg();
    const r = E.detectLanes(c, S.bright);
    if (!r.centers.length) return 0;
    // the crop is the user's statement of where the lanes are: keep edge lanes it deliberately includes
    replaceInCrop(r.centers.map(x => x + S.crop.x), r.pitch);
    return r.centers.length;
  };
  // n lanes spread evenly across the crop width (default: keep the current in-crop count)
  App.evenLanesInCrop = function (n) {
    const S = App.S, c = S.crop;
    n = Math.max(1, Math.min(60, Math.round(n || S.lanes.filter(l => l.x >= c.x && l.x <= c.x + c.w).length || 1)));
    const p = c.w / n;
    replaceInCrop(Array.from({ length: n }, (_, k) => c.x + (k + 0.5) * p), p);
    S.lanes.forEach(l => { if (l.x >= c.x && l.x <= c.x + c.w) l.manual = true; });   // spaced by hand
    return n;
  };

  // indices of lanes whose centre lies inside the crop
  App.laneRange = function () {
    const S = App.S, c = S.crop, idx = [];
    S.lanes.forEach((l, i) => { if (l.x >= c.x && l.x <= c.x + c.w) idx.push(i); });
    return idx.length ? [idx[0], idx[idx.length - 1]] : null;
  };
  // horizontal crop boundary half-way between lane a and its neighbour on side `dir` (-1 left, +1 right)
  App.laneEdge = function (a, dir) {
    const S = App.S, l = S.lanes, p = S.lanePitch || (S.laneHalfW / 0.3);
    const nb = l[a + dir];
    const x = nb ? (l[a].x + nb.x) / 2 : l[a].x + dir * p * 0.5;
    return Math.max(0, Math.min(App.ensureRot().w, x));
  };
  // the box's sides moved to the gaps beside the outer lanes whose centres it holds (y untouched)
  App.reframeCrop = function () {
    const S = App.S, c = S.crop, inside = S.lanes.map((l, i) => (l.x >= c.x && l.x <= c.x + c.w ? i : -1)).filter(i => i >= 0);
    if (inside.length) App.setLaneRange(inside[0], inside[inside.length - 1]);
    return inside.length;
  };
  // the box's top and bottom moved to the bands: just above the highest band and just below the
  // lowest over the loaded lanes it holds (the ladders' assigned bands and each lane's clear peaks),
  // with 0.6 lane spacing of margin; the wells and the empty gel above and below are left out, as
  // a box drawn by hand would. Kept as it is when fewer than a lane spacing of bands is found.
  App.reframeCropRows = function () {
    const S = App.S, c = S.crop, P = S.lanePitch || (S.laneHalfW / 0.3), H = App.ensureRot().h;
    const strip = App.bandStrip();
    const inside = S.lanes.map((l, i) => (l.x >= c.x && l.x <= c.x + c.w ? i : -1)).filter(i => i >= 0);
    // per lane: the ladder's assigned bands when the lane is a marker, plus the lane's own clear
    // peaks, from below the well pockets (2.5 spacings under the well row)
    const yMin = App.cropMeta && App.cropMeta.wellY != null ? App.cropMeta.wellY + P * 2.5 : -Infinity;
    // only the lane's own peaks (App.laneLocalPeaks: an outline or the dye front is as dark in the gaps)
    const peaksOf = inside.map(i => App.laneLocalPeaks(strip, S.bright, S.lanes[i].x, S.laneHalfW, P).filter(q => c.y + q.y >= yMin));
    const mx = Math.max(0, ...peaksOf.flat().map(q => q.v));
    let top = Infinity, bot = -Infinity;
    const lanes = [];
    inside.forEach((i, k) => {
      const pk = peaksOf[k], lm = Math.max(0, ...pk.map(q => q.v));
      // a lane counts when loaded (its strongest band a sixth of the gel's); only its clear bands (a
      // third of its own strongest) count: the faint tail of a smear or the foot of a heavy band is not a band
      const cand = lm >= mx * 0.15 ? pk.filter(q => q.v >= lm * 0.3).map(q => ({ y: c.y + q.y, v: q.v / lm })) : [];
      // a ladder's assigned band counts when it sits on one of the lane's own peaks (the matcher
      // may have put a size on an outline)
      S.markers.forEach(m => { if (m.lane === i) m.bands.forEach(b => { if (b.y == null) return; const q = pk.find(q => Math.abs(c.y + q.y - b.y) <= P * 0.1); if (q) cand.push({ y: b.y, v: q.v / Math.max(1e-9, lm) }); }); });
      cand.sort((p, q) => p.y - q.y);
      // the same row from the ladder's assignment and the lane's own peak counts once
      for (let j = cand.length - 1; j > 0; j--) if (cand[j].y - cand[j - 1].y < P * 0.1) cand.splice(j, 1);
      // bands come in a run; the outline of a pocket's bottom (above the first band, with nothing
      // above it and a long empty stretch below it) and the dye front far below the last band do
      // not. An end candidate is dropped when its gap to its neighbour is over 2.2 times the next
      // gap along the lane and over 1.5 lane spacings (the top two bands of a ladder are spaced
      // like the bands below them), and when it is no stronger than the lane's typical band (a
      // heavy band standing alone at the bottom of a sparse lane stays); two close peaks both stay
      const dropped = [];
      const weak = k => { const others = cand.filter((q, j) => j !== k).map(q => q.v).sort((p, q) => p - q); return cand[k].v <= 0.8 * others[others.length >> 1]; };
      for (let pass = 0; pass < 2 && cand.length >= 3; pass++) {
        const n = cand.length, ys = cand.map(q => q.y), g0 = ys[1] - ys[0], g1 = ys[2] - ys[1], gN = ys[n - 1] - ys[n - 2], gM = ys[n - 2] - ys[n - 3];
        if (g0 > Math.max(2.2 * g1, 1.5 * P) && weak(0)) dropped.push(cand.shift().y);
        else if (gN > Math.max(2.2 * gM, 1.5 * P) && weak(n - 1)) dropped.push(cand.pop().y);
        else break;
      }
      lanes.push({ lane: i, n: cand.length, rows: cand.map(q => Math.round(q.y)), dropped: dropped.map(Math.round) });
    });
    // lanes with a run of three or more bands set the extent; a lane with fewer (two peaks, one of
    // which may be an outline that passed every test) cannot extend it. Only when no lane has a
    // run (a blot with one or two bands per lane) do all lanes count.
    const runs = lanes.filter(l => l.n >= 3), use = runs.length ? runs : lanes;
    use.forEach(l => { if (l.n) { top = Math.min(top, l.rows[0]); bot = Math.max(bot, l.rows[l.n - 1]); } });
    App.reframeCropRows.debug = { top: Math.round(top), bot: Math.round(bot), lanes };
    if (!isFinite(top) || bot - top < P) return false;
    const m = P * 0.6, y0 = Math.round(Math.max(0, top - m)), y1 = Math.round(Math.min(H, bot + m));
    if (y1 - y0 < 10) return false;
    S.crop = { x: c.x, y: y0, w: c.w, h: y1 - y0 };
    App.updateSaturation();
    return true;
  };
  // show lanes a..b: crop x follows the lane boundaries, y untouched
  App.setLaneRange = function (a, b) {
    const S = App.S, n = S.lanes.length;
    if (!n) return;
    a = Math.max(0, Math.min(n - 1, a)); b = Math.max(0, Math.min(n - 1, b));
    if (a > b) [a, b] = [b, a];
    const x0 = Math.round(App.laneEdge(a, -1)), x1 = Math.round(App.laneEdge(b, 1));
    S.crop = { x: x0, y: S.crop.y, w: Math.max(10, x1 - x0), h: S.crop.h };
    App.updateSaturation();
  };
  // snap a crop x edge to the nearest lane boundary
  App.snapCropX = function (x) {
    const S = App.S, l = S.lanes;
    if (l.length < 2) return x;
    const edges = [App.laneEdge(0, -1)];
    for (let i = 0; i < l.length - 1; i++) edges.push((l[i].x + l[i + 1].x) / 2);
    edges.push(App.laneEdge(l.length - 1, 1));
    // gentle snap: if the lanes themselves are wrong, the user must still be able to frame freely
    let best = x, bd = (S.lanePitch || 40) * 0.2;
    edges.forEach(e => { const d = Math.abs(e - x); if (d < bd) { bd = d; best = e; } });
    return best;
  };

  // full-width image strip over the crop rows: band profiles for any lane, inside the crop or not
  App.bandStrip = function () {
    const S = App.S, rot = App.ensureRot();
    return E.cropImg(rot, { x: 0, y: S.crop.y, w: rot.w, h: S.crop.h });
  };
  // snap a row to the nearest detected band in the lane closest to x (null if nothing near)
  App.snapBandY = function (xAbs, yAbs, tolPx) {
    const S = App.S;
    if (!S.lanes.length) return null;
    let li = 0, bd = Infinity;
    S.lanes.forEach((l, i) => { const d = Math.abs(l.x - xAbs); if (d < bd) { bd = d; li = i; } });
    const strip = App.bandStrip();
    const pk = E.detectBands(E.laneProfile(strip, S.bright, S.lanes[li].x, S.laneHalfW));
    const vmax = Math.max(0, ...pk.map(p => p.v));
    let best = null, d0 = tolPx || Math.max(8, S.crop.h * 0.025);
    pk.filter(p => p.v >= vmax * 0.08).forEach(p => { const d = Math.abs(p.y + S.crop.y - yAbs); if (d < d0) { d0 = d; best = p.y + S.crop.y; } });
    return best;
  };

  App.evenLanes = function () {
    const S = App.S, xs = S.lanes.map(l => l.x).sort((a, b) => a - b);
    if (xs.length < 2) return;
    const pos = E.evenLanes(xs.length, 0, xs[0], xs[xs.length - 1]);
    S.lanes.sort((a, b) => a.x - b.x).forEach((l, i) => { l.x = pos[i]; });
  };

  App.addLane = function (x) {
    const S = App.S;
    S.lanes.push({ x, name: '', hidden: false, manual: true });   // placed by hand: a red-box drag never replaces it
    const order = S.lanes.map((l, i) => i).sort((a, b) => S.lanes[a].x - S.lanes[b].x);
    App.reorderLanes(order);
    return S.lanes.findIndex(l => l.x === x);
  };

  App.removeLane = function (i) {
    const S = App.S;
    if (i < 0 || i >= S.lanes.length) return;
    S.lanes.splice(i, 1);
    const shift = k => (k > i ? k - 1 : k);
    S.groups = S.groups.filter(g => !(g.from === i && g.to === i)).map(g => ({ ...g, from: Math.min(shift(g.from), S.lanes.length - 1), to: Math.min(shift(g.to), S.lanes.length - 1) }));
    S.conditions.forEach(c => c.values.splice(i, 1));
    S.markers = S.markers.filter(m => m.lane !== i);
    S.markers.forEach(m => { m.lane = shift(m.lane); });
    S.quant.ref = S.quant.ref === i ? -1 : shift(S.quant.ref);
    App.fixIndices();
  };

  // apply permutation (order[newIdx] = oldIdx) to lanes and every index that references lanes
  App.reorderLanes = function (order) {
    const S = App.S, inv = [];
    order.forEach((o, n) => { inv[o] = n; });
    S.lanes = order.map(o => S.lanes[o]);
    S.groups.forEach(g => { g.from = inv[g.from] ?? g.from; g.to = inv[g.to] ?? g.to; });
    S.conditions.forEach(c => { const v = c.values.slice(); c.values = order.map(o => v[o] || ''); });
    S.markers.forEach(m => { m.lane = inv[m.lane] ?? m.lane; });
    if (S.quant.ref >= 0) S.quant.ref = inv[S.quant.ref] ?? S.quant.ref;
  };

  App.fixIndices = function () {
    const S = App.S, n = S.lanes.length;
    S.groups.forEach(g => { g.from = Math.min(g.from, n - 1); g.to = Math.min(g.to, n - 1); });
    S.conditions.forEach(c => { c.values.length = n; for (let i = 0; i < n; i++) c.values[i] = c.values[i] || ''; });
    S.markers = S.markers.filter(m => m.lane != null && m.lane < n);
    if (S.quant.ref >= n) S.quant.ref = -1;
  };

  App.sortLanesIfNeeded = function () {
    const S = App.S;
    const order = S.lanes.map((l, i) => i).sort((a, b) => S.lanes[a].x - S.lanes[b].x);
    if (order.some((o, i) => o !== i)) App.reorderLanes(order);
  };

  // ---------- markers (one or more ladder lanes, matched jointly: same gel = same migration curve) ----------
  App.newMarker = function (lane, ladderId) {
    const kind = App.kind();
    return { lane, ladderId: ladderId || G.Ladders.favorites(kind)[0] || App.prefLadder || App.gelType().ladder, unit: App.prefUnit || App.baseUnit(), side: 'auto', bands: [] };
  };

  /* The bands of a lane: the peaks of its profile that are the lane's own. A band is strong at the
   * lane and weak in the gaps beside it; the dark outlines of the well pockets, the gel's edges and
   * the dye front cross every lane and are as dark half a lane spacing to either side (the walls
   * between the pockets, the edge itself). A peak whose baseline-corrected height at the lane is not
   * 1.4 times what the gaps show at that row is left out, so the framing of the box never takes an
   * outline for a band. (Tried for the ladder matching too and withdrawn: the changed peak lists
   * let an empty lane's noise win the ladder on the sanity-check photograph.) */
  App.laneLocalPeaks = function (strip, bright, x, halfW, P) {
    const prof = E.laneProfile(strip, bright, x, halfW), h = prof.length, r = Math.round(h / 12);
    const resid = p => { const b = E.baseline(p, r), q = new Float32Array(p.length); for (let y = 0; y < p.length; y++) q[y] = Math.max(0, p[y] - b[y]); return q; };
    const q = resid(prof), gw = Math.max(2, halfW * 0.5);
    const gl = resid(E.laneProfile(strip, bright, x - P / 2, gw)), gr = resid(E.laneProfile(strip, bright, x + P / 2, gw));
    // the clearer of the two gaps decides: an outline, an edge or the dye front is dark on both sides,
    // while an outer lane has the slab's margin or a torn corner on one side only (and a wide ladder
    // band reaches into one gap)
    const side = (g, y) => { let m = 0; for (let k = Math.max(0, y - 2); k <= Math.min(h - 1, y + 2); k++) m = Math.max(m, g[k]); return m; };
    const gapAt = y => Math.min(side(gl, y), side(gr, y));
    // a faint band's gaps hold only noise: the gaps must show a real feature (a tenth of the lane's
    // strongest band) before they can disqualify a peak
    let qmax = 0; for (let y = 0; y < h; y++) qmax = Math.max(qmax, q[y]);
    return E.detectBands(prof).filter(k => { const g = gapAt(k.y); return g < qmax * 0.1 || q[k.y] > 1.4 * g; });
  };
  App.lanePeaks = function (i) {
    const S = App.S, c = App._peakCrop || App.bandStrip();
    return E.detectBands(E.laneProfile(c, S.bright, S.lanes[i].x, S.laneHalfW));
  };
  // where marker bands are looked for: the marker image when one is loaded, the gel otherwise
  App.markerStrip = function () {
    const r = App.hasMarkerImage() && App.ensureMarkerRot();
    return r ? E.cropImg(r, { x: 0, y: App.S.crop.y, w: r.w, h: App.S.crop.h }) : App.bandStrip();
  };
  App.markerPeaks = function (i) {
    const S = App.S, c = App._mkCrop || App.markerStrip();
    return E.detectBands(E.laneProfile(c, App.hasMarkerImage() ? App.markerBright : S.bright, S.lanes[i].x, S.laneHalfW));
  };

  // find ladder lanes (many sharp bands) and pick ladders for them
  App.autoMarkers = function () {
    const S = App.S, kind = App.kind();
    App._mkCrop = App.markerStrip();
    try {
      const peaks = S.lanes.map((l, i) => App.markerPeaks(i));
      const counts = peaks.map(p => E.sharpBandCount(p));
      const rg = App.laneRange() || [0, S.lanes.length - 1];
      // only lanes that will be in the figure
      let lanes = counts.map((c, i) => i).filter(i => i >= rg[0] && i <= rg[1] && counts[i] >= App.gelType().minMarkerBands);
      const all = G.Ladders.all(kind), favs = G.Ladders.favorites(kind);
      // "my ladders" get a bonus; without favourites the last used ladder plays that role
      const prefer = favs.length ? favs : [App.prefLadder];
      const h = App._mkCrop.h;
      /* Many bands alone do not make a ladder: cell lysates on a protein gel have more bands than any
       * marker. A ladder lane (1) fits a likely ladder (the preferred ones and the type's usual one),
       * (2) has about as many clear bands as that ladder, not many more, and (3) has bands of similar
       * strength, while a lysate's bands vary a lot. Lanes far below the best on all three drop out. */
      let starLib = null;
      if (lanes.length > 1) {
        // every ladder of the kind is a candidate (the preferred ones first): a gel run with a ladder
        // the user has not used before must still find its ladder lanes
        const memo = new Map();
        const ladderness = (i, lib) => {
          const key = i + '|' + lib.map(l => l.id).join(',');
          if (memo.has(key)) return memo.get(key);
          const v = ladderness0(i, lib); memo.set(key, v); return v;
        };
        const ladderness0 = (i, lib) => {
          const r = lib.length ? E.jointLadders([peaks[i]], lib, h, prefer) : null;
          if (!r) return { v: 0, id: null };
          const vmax = Math.max(0, ...peaks[i].map(p => p.v));
          const clear = peaks[i].filter(p => p.v >= vmax * 0.08), top = clear.filter(p => p.v >= vmax * 0.12).map(p => p.v / vmax);
          const mean = top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
          const cv = Math.sqrt(top.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, top.length)) / Math.max(1e-9, mean);
          return { v: r.score * Math.min(1, G.Ladders.get(r[0].id).sizes.length / Math.max(1, clear.length)) * (1 - Math.min(0.2, Math.max(0, cv - 0.45))), id: r[0].id };
        };
        // one ladder per gel: the lane that looks most like a ladder of the whole library names the
        // ladder, and the other lanes are kept only when they fit THAT ladder about as well. A lysate
        // lane that happens to resemble some other ladder is not a marker; a ladder the user has not
        // used before is still found.
        // the usual ladders (preferred, the type's default) name it when one of them fits a lane well;
        // otherwise the whole library does
        const likely = [...new Set(prefer.concat([App.gelType().ladder]))].map(G.Ladders.get).filter(l => l && l.kind === kind);
        // the whole library is only tried when no usual ladder fits (it costs a second per lane)
        const fitL = new Map(lanes.map(i => [i, ladderness(i, likely)])), fitAll = new Map(), allOf = i => { if (!fitAll.has(i)) fitAll.set(i, ladderness(i, all)); return fitAll.get(i); };
        let bestL = lanes[0];
        lanes.forEach(i => { if (fitL.get(i).v > fitL.get(bestL).v) bestL = i; });
        let starId = null;
        if (fitL.get(bestL).v >= 0.7) starId = fitL.get(bestL).id;
        else {
          // the ladder that explains the candidate lanes jointly: every lane's own best ladder is tried,
          // and the one with the most clear fits (above 0.45) across lanes wins, so three ladder lanes
          // of one product beat one lane that happens to fit another product a little better
          const ids = [...new Set(lanes.map(i => allOf(i).id).filter(Boolean))];
          // the excess over 0.55, squared: two lanes fitting one ladder well beat five lysate lanes
          // that loosely resemble another
          let bestSum = -1; App.autoMarkers.sums = {};
          ids.forEach(id => { const lib = [G.Ladders.get(id)]; let sum = 0; lanes.forEach(i => { sum += Math.max(0, ladderness(i, lib).v - 0.55) ** 2; }); App.autoMarkers.sums[id] = +sum.toFixed(3); if (sum > bestSum) { bestSum = sum; starId = id; } });
        }
        const star = starId ? [G.Ladders.get(starId)] : [];
        const fit = new Map(lanes.map(i => [i, star.length ? ladderness(i, star).v : allOf(i).v]));
        const best = Math.max(...fit.values());
        App.autoMarkers.debug = { sums: App.autoMarkers.sums, candidates: lanes.slice(), fitL: lanes.map(i => [i, +fitL.get(i).v.toFixed(2), fitL.get(i).id]), starId, fit: lanes.map(i => [i, +fit.get(i).toFixed(2)]), counts: lanes.map(i => counts[i]) };
        if (best >= 0.45) lanes = lanes.filter(i => fit.get(i) >= best * 0.8);
        if (best >= 0.45 && starId) starLib = [G.Ladders.get(starId)];
      }
      // keep at most 3 (the lanes with the most bands), in lane order
      lanes = lanes.sort((a, b) => counts[b] - counts[a]).slice(0, 3).sort((a, b) => a - b);
      const pk = lanes.map(i => peaks[i]);
      let picks = null;
      App.ladderNotice = null;
      // the ladder the lanes agreed on is fitted jointly on its own first: trying every ladder of the
      // library in every combination of three lanes takes seconds
      if (lanes.length) {
        if (favs.length && prefs().onlyFavLadders) {
          picks = E.jointLadders(pk, favs.map(G.Ladders.get), h, favs);
          // never lock in a clearly wrong favourite: a partial fit (e.g. a 100 bp ladder matching the
          // lower half of a 1 kb ladder) still scores fairly, so compare with the whole library
          const full = E.jointLadders(pk, all, h, favs);
          if (full && (!picks || picks.score < 0.55 || full.score > picks.score + 0.08)) {
            picks = full; App.ladderNotice = `None of your favourite ladders fits; using ${full.map(p => G.Ladders.get(p.id).name).join(', ')}`;
          }
        } else picks = (starLib && E.jointLadders(pk, starLib, h, prefer)) || E.jointLadders(pk, all, h, prefer);
      }
      if (picks && lanes.length === 1) {
        // a single lane cannot tell ladders apart well: stay with a preferred ladder unless it clearly misfits
        let bestPref = null;
        prefer.forEach(id => { const l = G.Ladders.get(id); if (!l) return; const s = E.matchLadder(peaks[lanes[0]], l.sizes, h).score; if (!bestPref || s > bestPref.score) bestPref = { id, score: s }; });
        if (bestPref && bestPref.score >= picks[0].score - 0.12) picks = [bestPref];
      }
      if (picks && favs.length && picks.some(p => !favs.includes(p.id)) && !App.ladderNotice)
        App.ladderNotice = `Detected ladder is not among your favourites: ${picks.filter(p => !favs.includes(p.id)).map(p => G.Ladders.get(p.id).name).join(', ')} — please check`;
      S.markers = lanes.map((ln, k) => App.newMarker(ln, picks ? picks[k].id : prefer[0]));
      App.matchMarkers(true);
      // a lane that fits its ladder poorly next to one that fits well is a sample lane, not a marker
      if (S.markers.some(m => m.score >= 0.7)) S.markers = S.markers.filter(m => m.score == null || m.score >= 0.45);
      // the name M follows the markers: a lane in the range named M by an earlier detection that is no
      // longer one loses it (lanes outside the figure keep their names for when the range widens again)
      S.lanes.forEach((l, i) => { if (l.name === 'M' && i >= rg[0] && i <= rg[1] && !S.markers.some(m => m.lane === i)) l.name = ''; });
      S.markers.forEach(m => { if (!S.lanes[m.lane].name) S.lanes[m.lane].name = 'M'; });
    } finally { App._mkCrop = null; }
  };

  // match all markers jointly; manually placed bands are kept as anchors
  App.matchMarkers = function (fresh) {
    const S = App.S, c = App._mkCrop || App.markerStrip();
    const ms = S.markers.filter(m => G.Ladders.get(m.ladderId) && S.lanes[m.lane]);
    S.markers.forEach(m => { if (!ms.includes(m)) m.bands = []; });
    if (!ms.length) return;
    App._mkCrop = c;
    try {
      const input = ms.map(m => {
        const lad = G.Ladders.get(m.ladderId);
        const anchors = fresh ? [] : m.bands.filter(b => b.manual && lad.sizes.includes(b.bp)).map(b => ({ k: lad.sizes.indexOf(b.bp), y: b.y - S.crop.y }));
        return { peaks: App.markerPeaks(m.lane), sizes: lad.sizes, anchors };
      });
      const res = E.matchMulti(input, c.h);
      ms.forEach((m, i) => {
        const lad = G.Ladders.get(m.ladderId), r = res[i];
        const prev = new Map(m.bands.map(b => [b.bp, b]));
        m.bands = lad.sizes.map((bp, k) => {
          const p = prev.get(bp);
          return {
            bp, y: r[k].y + S.crop.y, matched: r[k].matched, manual: !!r[k].anchored,
            show: p && !fresh ? p.show : true, ref: lad.ref.includes(bp)
          };
        });
        m.score = r.score;
        // bands predicted outside the crop are not shown by default
        m.bands.forEach(b => { if (b.y < S.crop.y - 2 || b.y > S.crop.y + S.crop.h + 2) b.show = false; });
        if (fresh || !prev.size) App.thinMarkerLabels(m, true);
      });
    } finally { App._mkCrop = null; }
  };

  // hide labels that would collide in the final figure; keep reference bands first
  App.thinMarkerLabels = function (m, keepHidden) {
    const S = App.S, st = S.style;
    const scale = (App.gelWidthMm() * G.Render.MM) / Math.max(1, App.visibleWidthPx());
    const minGap = st.fontPt * 1.05 / scale; // in image px
    const inStrip = y => !S.strips.length || S.strips.some(r => y >= Math.min(r.y0, r.y1) && y <= Math.max(r.y0, r.y1));
    const B = m.bands.filter(b => b.y >= S.crop.y && b.y <= S.crop.y + S.crop.h && inStrip(b.y) && (!keepHidden || b.show));
    const order = B.slice().sort((a, b) => (b.ref - a.ref) || ((b.matched || b.manual) - (a.matched || a.manual)) || (b.bp % 1000 === 0) - (a.bp % 1000 === 0));
    const kept = [];
    order.forEach(b => { if (kept.every(k => Math.abs(k.y - b.y) >= minGap)) kept.push(b); });
    m.bands.forEach(b => { b.show = kept.includes(b); });
  };

  // gel image width: fixed by the user, or ~5 mm per visible lane
  App.gelWidthMm = function () {
    const S = App.S, st = S.style;
    if (!st.autoWidth) return st.gelWidthMm;
    const n = S.lanes.filter(l => !l.hidden && l.x >= S.crop.x && l.x <= S.crop.x + S.crop.w).length || 8;
    return Math.max(22, Math.min(160, Math.round(n * st.mmPerLane)));
  };

  App.visibleWidthPx = function () {
    const S = App.S;
    if (!S.lanes.some(l => l.hidden)) return S.crop.w;
    const R = App.renderState();
    const b = G.Render.laneBounds(R.lanes, S.crop.w);
    let hidden = 0;
    R.lanes.forEach((l, i) => { if (l.hidden) hidden += b[i][1] - b[i][0]; });
    return Math.max(1, S.crop.w - hidden);
  };

  App.autoAll = async function (fresh) {
    const S = App.S;
    const T = (s) => { if (App.debug) document.title = 'STAGE ' + s; };
    T('deskew');
    if (fresh) App.autoDeskew();
    T('crop');
    // the whole gel first: that is where the rows of wells are counted
    App.autoCrop();
    const rows = E.autoCrop.rows || [];
    S.gelRows = rows.length > 1 ? rows : null;
    S.gelRow = 0; S.rowStash = {};
    if (S.gelRows) App.autoCrop(App.rowBand(0));
    T('levels');
    App.autoLevels();
    T('lanes');
    App.autoLanes();
    // frame the crop on the lanes that carry bands, edges half-way between lanes
    const loaded = App.loadedLaneRange();
    if (loaded) App.setLaneRange(loaded[0], loaded[1]);
    T('marker');
    // the ladder search runs once: inside the geometry (after the keystone rounds) when that runs
    const geometry = fresh && !App.noAutoGeometry;
    if (!geometry) App.autoMarkers();
    T('geometry');
    if (geometry) {
      try { await App.autoGeometry(); } catch (e) { console.error(e); }
      // the lanes were detected again on the corrected image: the box is framed again on the lanes
      // that carry bands (a ladder that the first box missed is in now)
      const loaded2 = App.loadedLaneRange();
      if (loaded2) App.setLaneRange(loaded2[0], loaded2[1]);
    }
    if (!S.markers.length && geometry) App.autoMarkers();
    // and its rows on the bands (the well row served the detection; the figure starts at the bands);
    // the geometry's figures are stated over the box, so they are worked out again for the new rows
    if (fresh && App.reframeCropRows() && S.geom) Object.assign(S.geom, App.geomReport());
    T('fix');
    App.fixIndices();
    App.updateSaturation();
    App.commit();
  };

  // first..last lane with visible bands (over the crop rows)
  App.loadedLaneRange = function () {
    const S = App.S;
    if (!S.lanes.length) return null;
    App._peakCrop = App.bandStrip();
    try {
      const strength = S.lanes.map((l, i) => { const p = App.lanePeaks(i); return p.length ? Math.max(...p.map(q => q.v)) : 0; });
      const mx = Math.max(...strength);
      if (mx <= 0) return null;
      const idx = strength.map((v, i) => (v > mx * 0.15 ? i : -1)).filter(i => i >= 0);
      // a lane whose only "band" is a weak smear still counts if its neighbours are loaded; gaps of
      // empty lanes inside the run are kept (they are part of the experiment)
      return idx.length ? [idx[0], idx[idx.length - 1]] : null;
    } finally { App._peakCrop = null; }
  };

  // short label for a size: 1.5 kb / 480 bp / 850 nt / 53 kDa
  App.fmtSize = function (v) {
    if (!v) return '';
    const kind = App.kind();
    if (kind === 'protein' || kind === 'native') return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + ' kDa';
    if (v >= 995) { const kb = Math.round(v / 100) / 10; return (kb % 1 ? kb.toFixed(1) : kb.toFixed(0)) + ' kb'; }
    return (v >= 200 ? Math.round(v / 10) * 10 : Math.round(v)) + (kind === 'rna' ? ' nt' : ' bp');
  };
  // exact value in the base unit (popover, logs, tables)
  App.fmtExact = function (v) { return v == null ? '' : (App.baseUnit() === 'kDa' ? (Math.round(v * 10) / 10) : Math.round(v)) + ' ' + App.baseUnit(); };
  App.arrowLabel = function (a) {
    let sz = '';
    if (a.size) {
      if (a.sizeText) sz = a.sizeText;
      else {
        const info = App.estimateInfo(a.y);
        // outside the marker range the number is an extrapolation: say so on the figure
        if (info) sz = (info.extrap || info.disagree ? '≈' : '') + App.fmtSize(info.bp);
      }
    }
    if (a.text && sz) return `${a.text} (${sz})`;
    return a.text || sz;
  };

  /* Size at a row from every marker that can see it. Markers inside their band range are preferred
   * over extrapolating ones; the result is the geometric mean of those used. */
  App.estimateInfo = function (yAbs) {
    const S = App.S;
    const per = S.markers.map(m => {
      const r = E.estimateSizeInfo(yAbs, m.bands.filter(b => b.matched || b.manual).map(b => ({ bp: b.bp, y: b.y })));
      return r && { lane: m.lane, ladderId: m.ladderId, bp: r.bp, extrap: r.extrap, range: r.range };
    }).filter(Boolean);
    if (!per.length) return null;
    const inside = per.filter(p => !p.extrap), used = inside.length ? inside : per;
    const bp = Math.exp(used.reduce((s, p) => s + Math.log(p.bp), 0) / used.length);
    const lo = Math.min(...used.map(p => p.bp)), hi = Math.max(...used.map(p => p.bp));
    return { bp, extrap: !inside.length, disagree: used.length > 1 && hi / lo > 1.1, perMarker: per, used: used.map(p => p.lane) };
  };
  Object.defineProperty(App, 'selLane', { configurable: true, get() { return App._selLane; }, set(v) { App._selLane = v; App.selLanes = v >= 0 ? new Set([v]) : new Set(); } });
  // several lanes at once (Shift / Ctrl + click on the raw image): `primary` is the one the keyboard and the list follow
  App.selectLanes = function (list, primary) {
    const l = [...new Set(list)].filter(i => i >= 0 && i < App.S.lanes.length);
    App.selLanes = new Set(l); App._selLane = primary != null && l.includes(primary) ? primary : (l.length ? l[l.length - 1] : -1);
  };
  // the lanes strictly between two selected ones get even spacing (drag the ends onto their lanes first)
  App.spreadBetween = function (i, j) {
    const S = App.S, a = Math.min(i, j), b = Math.max(i, j), n = b - a;
    if (n < 2) return false;
    const x0 = S.lanes[a].x, x1 = S.lanes[b].x;
    for (let k = 1; k < n; k++) { S.lanes[a + k].x = x0 + (x1 - x0) * k / n; S.lanes[a + k].manual = true; }
    return true;
  };
  App.estimateBp = function (yAbs) { const r = App.estimateInfo(yAbs); return r ? r.bp : null; };

  /* The inverse: the image row where a size would run, from the same marker bands (piecewise-linear in ln(size),
   * extrapolated beyond the outermost bands), averaged over the markers that bracket it. Null without two bands. */
  App.yForSize = function (bp) {
    if (!(bp > 0)) return null;
    const ys = [], inside = [];
    App.S.markers.forEach(m => {
      const B = m.bands.filter(b => (b.matched || b.manual) && b.y != null).slice().sort((a, b) => a.y - b.y);
      if (B.length < 2) return;
      let i = 0;
      while (i < B.length - 2 && bp < B[i + 1].bp) i++;   // sizes fall down the lane
      const a = B[i], b = B[i + 1];
      if (a.bp === b.bp) return;
      const t = (Math.log(bp) - Math.log(a.bp)) / (Math.log(b.bp) - Math.log(a.bp)), y = a.y + t * (b.y - a.y);
      ys.push(y); if (bp <= B[0].bp && bp >= B[B.length - 1].bp) inside.push(y);
    });
    const use = inside.length ? inside : ys;
    return use.length ? use.reduce((s, v) => s + v, 0) / use.length : null;
  };
  // a typed size ("12", "12 kDa", "1.5 kb", "452 bp", "300 nt") in the base unit of the experiment, or null
  App.parseSize = function (text) {
    const m = /^\s*[~≈]?\s*([\d.,]+)\s*([a-zA-Zµ]*)\s*$/.exec(String(text || ''));
    if (!m) return null;
    const v = parseFloat(m[1].replace(',', '.'));
    if (!(v > 0)) return null;
    const u = m[2].toLowerCase(), base = App.baseUnit();
    if (!u) return v;
    if (base === 'kDa') return u === 'kda' || u === 'kd' ? v : u === 'da' ? v / 1000 : null;
    if (u === 'kb' || u === 'knt') return v * 1000;
    if (u === 'bp' || u === 'nt' || u === 'b') return v;
    if (u === 'mb') return v * 1e6;
    return null;
  };
  // the arrow follows a typed size when the markers can place it; returns true when it moved
  App.arrowToSize = function (k, text) {
    const a = App.S.arrows[k]; if (!a) return false;
    const bp = App.parseSize(text), y = bp != null ? App.yForSize(bp) : null;
    if (y == null) return false;
    const c = App.S.crop;
    a.y = Math.max(c.y, Math.min(c.y + c.h, y));
    return true;
  };

  /* Lanes in the figure range with no real band signal (excluding markers and lanes already cut).
   * Only a suggestion: empty wells are usually part of the experiment (NTC, blank). */
  App.emptyLanes = function () {
    const S = App.S, r = App.laneRange();
    if (!r) return [];
    const key = [S.file.sha256, S.rotation, S.crop.y, S.crop.h, S.lanes.map(l => Math.round(l.x)).join()].join('|');
    if (App._emptyKey !== key) {
      App._peakCrop = App.bandStrip();
      try { App._laneStrength = S.lanes.map((l, i) => { const p = App.lanePeaks(i); return p.length ? Math.max(...p.map(q => q.v)) : 0; }); }
      finally { App._peakCrop = null; }
      App._emptyKey = key;
    }
    const st = App._laneStrength, mk = new Set(S.markers.map(m => m.lane));
    const mx = Math.max(0, ...st.slice(r[0], r[1] + 1));
    const out = [];
    for (let i = r[0]; i <= r[1]; i++) if (!mk.has(i) && !S.lanes[i].hidden && st[i] < mx * 0.15) out.push(i);
    return out;
  };
  // cut / restore one lane; refuses silently losing a marker (caller confirms)
  App.setLaneHidden = function (i, hidden, reason) {
    const l = App.S.lanes[i]; if (!l) return;
    l.hidden = !!hidden;
    if (hidden) l.hiddenReason = reason || 'manual'; else delete l.hiddenReason;
  };

  // ---------- derived state for rendering (crop-relative, lanes outside crop dropped) ----------
  App.renderState = function (preview) {
    const S = App.S, cx = S.crop.x, cy = S.crop.y;
    const keep = [];
    S.lanes.forEach((l, i) => { if (l.x >= cx && l.x <= cx + S.crop.w) keep.push(i); });
    const remap = new Map(keep.map((o, n) => [o, n]));
    const groups = S.groups.map((g, k) => {
      const a = Math.min(g.from, g.to), b = Math.max(g.from, g.to);
      const ins = keep.filter(i => i >= a && i <= b);
      return ins.length ? { from: remap.get(ins[0]), to: remap.get(ins[ins.length - 1]), text: g.text, k } : null;
    }).filter(Boolean);
    // strips: horizontal regions shown stacked (Western panels); none = the whole crop height
    const strips = S.strips.map((r, k) => ({ y0: Math.max(0, Math.min(r.y0, r.y1) - cy), y1: Math.min(S.crop.h, Math.max(r.y0, r.y1) - cy), label: r.label || '', k }))
      .filter(r => r.y1 - r.y0 >= 2).sort((a, b) => a.y0 - b.y0);
    return {
      preview: !!preview, kind: App.kind(), strips,
      crop: S.crop, levels: S.levels, style: Object.assign({}, S.style, { gelWidthMm: App.gelWidthMm() }), file: S.file,
      lanes: keep.map(i => ({ x: S.lanes[i].x - cx, name: S.lanes[i].name, hidden: S.lanes[i].hidden, src: i })),
      conditions: S.conditions.map(c => ({ name: c.name, values: keep.map(i => c.values[i] || '') })),
      groups,
      markers: S.markers.filter(m => remap.has(m.lane) && !S.lanes[m.lane].hidden).map(m => Object.assign({}, m, {
        lane: remap.get(m.lane),
        bands: m.bands.map(b => Object.assign({}, b, { y: b.y - cy }))
      })),
      arrows: S.arrows.map((a, k) => Object.assign({}, a, { y: a.y - cy, k, label: App.arrowLabel(a) })).filter(a => a.y >= 0 && a.y <= S.crop.h)
    };
  };

  // ---------- figure ----------
  App.buildFigure = function (preview) {
    App.renderFull();
    const S = App.S, R = App.renderState(preview);
    const cc = document.createElement('canvas');
    const r = S.crop;
    cc.width = Math.max(1, Math.round(r.w)); cc.height = Math.max(1, Math.round(r.h));
    cc.getContext('2d').drawImage(App.fullCanvas, Math.round(r.x), Math.round(r.y), cc.width, cc.height, 0, 0, cc.width, cc.height);
    const approxScale = App.gelWidthMm() * G.Render.MM / App.visibleWidthPx();
    const gel = G.Render.composeGel(R, cc, approxScale);
    const key = [App._display, r.x, r.y, r.w, r.h, gel.canvas.width, gel.canvas.height, R.lanes.map(l => l.hidden ? 'h' + l.x : '').join(), R.strips.map(t => t.y0 + '-' + t.y1).join()].join('|');
    if (App._gelKey !== key) { App._gelKey = key; App._gelHref = gel.canvas.toDataURL('image/png'); }
    App._lastGel = gel; App._lastCrop = cc;
    const out = G.Render.build(R, gel, App._gelHref);
    if (S.saturatedInCrop > 0) out.warnings.push(App.saturationText());
    const bc = App.bandClipFrac();
    const pctBc = (bc * 100).toFixed(2), toWhite = S.bright !== !!S.levels.invert;
    if (bc > 0.001) out.warnings.push(`The contrast setting clips ${pctBc}% of the pixels in the crop to pure ${toWhite ? 'white' : 'black'}, which can flatten band cores; pull the ${S.bright ? 'white' : 'black'} point back or click "Reset contrast"`);
    const eff = App.effectiveDpi();
    if (eff < 300) out.warnings.push(`The gel is only ${Math.round(eff)} dpi at this size (below 300) and will be upscaled; the largest gel width without upscaling is ${App.maxSafeWidthMm(300)} mm`);
    if (S.markers.some(m => S.lanes[m.lane] && S.lanes[m.lane].hidden)) out.warnings.push('A marker lane has been removed; its size labels are not shown');
    S.arrows.forEach(a => {
      if (!a.size || a.sizeText) return;
      const info = App.estimateInfo(a.y);
      if (info && info.extrap) out.warnings.push(`Arrow${a.text ? ' “' + a.text + '”' : ''} lies outside the marker range; its size is extrapolated (marked ≈)`);
    });
    return out;
  };

  /* Pre-flight before export: problems a reviewer or a journal check would catch.
   * level 'block' items are asked about before exporting; 'warn' items are listed. */
  App.preflight = function () {
    const S = App.S, st = S.style, out = [];
    const add = (level, text, fix) => out.push({ level, text, fix });
    const eff = App.effectiveDpi();
    const safe = App.maxSafeWidthMm(300);
    if (eff < 300) add('block', `The gel is ${Math.round(eff)} dpi at this size (< 300). Exporting at ${st.dpi} dpi only enlarges the pixels.`,
      { label: `Set gel width to ${safe} mm`, run: () => { st.autoWidth = false; st.gelWidthMm = safe; } });
    const k = App.clipStats(), bc = App.bandClipFrac();
    const sp = (k.sensorFrac * 100).toFixed(2), bp = (bc * 100).toFixed(2);
    if (k.sensorFrac > 0.0005) add('warn', `Camera saturation: ${sp}% of the pixels in the crop are saturated. Consider a shorter exposure.`);
    if (bc > 0.001) add('block', `Contrast clipping: ${bp}% of the pixels are flattened by the contrast setting.`, { label: 'Reset contrast', run: () => App.resetLevels() });
    if (st.fontPt < 5) add('warn', `Font size ${st.fontPt} pt is small (most journals ask for ≥ 5–6 pt).`, { label: 'Use 6 pt', run: () => { st.fontPt = 6; } });
    if (st.lineWidthPt < 0.25) add('warn', `Line width ${st.lineWidthPt} pt is too thin.`, { label: 'Use 0.5 pt', run: () => { st.lineWidthPt = 0.5; } });
    const fig = App.buildFigure(false), wmm = fig.w / G.Render.MM;
    const rs = G.Export.rasterSize(fig.w, fig.h, st.dpi);
    if (!rs.ok) add('warn', `At ${st.dpi} dpi the PNG would be ${rs.w} × ${rs.h} px, more than ${rs.browser} can draw (TIFF, SVG and PDF still export).`, rs.fitsDpi ? { label: `Use ${rs.fitsDpi} dpi`, run: () => { st.dpi = rs.fitsDpi; } } : undefined);
    if (fig.minPt < 5 && st.fontPt >= 5) add('warn', `A group label is shrunk to ${fig.minPt.toFixed(1)} pt to fit its line (most journals ask for ≥ 5–6 pt).`, { label: 'Wrap long labels', run: () => { st.groupFit = 'wrap'; } });
    if (wmm > 183) add('warn', `The figure is ${wmm.toFixed(0)} mm wide, wider than a double column (about 180 mm).`);
    (fig.overlaps || []).forEach(w => add('warn', w));
    if (S.levels.gamma !== 1) add('warn', `Gamma = ${S.levels.gamma}: a non-linear adjustment that must be stated in the legend.`);
    if (S.lanes.some(l => l.hidden)) add('info', 'Lanes were removed: splice gaps are added; state this in the legend (see "Legend notes").');
    if (S.arrows.some(a => a.size && !a.sizeText && (App.estimateInfo(a.y) || {}).extrap)) add('info', 'Some arrow sizes are extrapolated (marked ≈).');
    if (!S.markers.length) add('warn', 'The figure has no marker lane.');
    return out;
  };

  App.saturationText = function () {
    const S = App.S, n = S.saturatedInCrop;
    const where = `${n} saturated pixels in the crop: band intensities are distorted and reviewers may question them. `;
    return S.file.bits <= 8
      ? where + 'This is an 8-bit image: export the 16-bit raw TIFF from the imager (more dynamic range) or re-image with a shorter exposure'
      : where + 'Consider re-imaging with a shorter exposure';
  };

  // ---------- change notifications / undo ----------
  App.on = function (fn) { App.listeners.push(fn); };
  App.emit = function (what) { App.listeners.forEach(fn => fn(what)); };

  let raf = 0;
  App.refresh = function () {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; App.emit('refresh'); });
  };

  App.snapshot = function () { return JSON.stringify(App.S); };
  App.commit = function () {
    if (!App.S) return;
    const snap = App.snapshot();
    if (App.hist[App.hist.length - 1] !== snap) {
      App.hist.push(snap);
      if (App.hist.length > 100) App.hist.shift();
      App.future = [];
    }
    savePrefs();
    App.saveDraftSoon();
    App.emit('change');
  };
  App.undo = function () {
    if (App.hist.length < 2) return;
    App.future.push(App.hist.pop());
    App.S = JSON.parse(App.hist[App.hist.length - 1]);
    App.saveDraftSoon();
    App.emit('change');
  };
  App.redo = function () {
    if (!App.future.length) return;
    const s = App.future.pop();
    App.hist.push(s);
    App.S = JSON.parse(s);
    App.saveDraftSoon();
    App.emit('change');
  };

  // ---------- templates ----------
  // templates are relative to the first lane of the figure, so they fit the next gel wherever it was loaded
  App.template = function () {
    const S = App.S, r = App.laneRange() || [0, S.lanes.length - 1], rel = i => i - r[0];
    const lanes = [];
    for (let i = r[0]; i <= r[1]; i++) {
      const m = S.markers.find(x => x.lane === i);
      lanes.push({ name: S.lanes[i].name, hidden: !!S.lanes[i].hidden, marker: m ? { ladderId: m.ladderId, unit: m.unit, side: m.side } : null });
    }
    return { gelfigTemplate: 3, app: App.NAME + ' ' + App.VERSION, gelType: S.gelType, lanes,
      // custom ladders travel with the template, so another computer gets the same Markers
      ladders: G.Ladders.defsFor(S.markers.map(m => m.ladderId)),
      groups: S.groups.map(g => ({ from: rel(g.from), to: rel(g.to), text: g.text })),
      conditions: S.conditions.map(c => ({ name: c.name, values: lanes.map((l, k) => c.values[r[0] + k] || '') })),
      arrows: S.arrows.map(a => ({ text: a.text, side: a.side, size: !!a.size, sizeText: a.sizeText || '', bp: App.estimateBp(a.y) })),
      // recorded for reference only: each gel is straightened on its own
      rotation: S.rotation,
      style: S.style };
  };
  // facts the UI needs before applying (lane-count mismatch, ladders that cannot be resolved)
  App.checkTemplate = function (t) {
    if (!t || !t.gelfigTemplate) throw new Error('Not a GelFigure style file');
    const tl = t.lanes || t.laneNames || [];
    const fig = App.figureLanes().length + App.S.lanes.filter((l, i) => { const r = App.laneRange(); return r && i >= r[0] && i <= r[1] && l.hidden; }).length;
    const defs = new Map((t.ladders || []).map(d => [d.id, d]));
    const missing = (t.lanes || []).filter(l => l.marker && !G.Ladders.get(l.marker.ladderId) && !defs.has(l.marker.ladderId)).map(l => l.marker.ladderId);
    return { templateLanes: tl.length, figureLanes: fig, missingLadders: [...new Set(missing)] };
  };
  App.applyTemplate = function (t) {
    const S = App.S;
    if (!t || !t.gelfigTemplate) throw new Error('Not a GelFigure style file');
    const imported = (t.ladders || []).filter(d => G.Ladders.importDef(d)).map(d => d.name);
    if (t.gelType && t.gelType !== S.gelType) App.setGelType(t.gelType);
    const chk = App.checkTemplate(t);
    if (chk.missingLadders.length) throw new Error(`The style uses ladders that are not on this computer and carries no definition for them: ${chk.missingLadders.join(', ')}. Add them under "Custom ladder" first.`);
    // v1 files stored absolute lanes: treat them as starting at the figure's first lane
    const tl = t.lanes || (t.laneNames || []).map((name, i) => ({ name, hidden: !!(t.hidden || [])[i], marker: null }));
    let r = App.laneRange() || [0, S.lanes.length - 1];
    if (tl.length && r[0] + tl.length - 1 !== r[1]) { App.setLaneRange(r[0], Math.min(S.lanes.length - 1, r[0] + tl.length - 1)); r = App.laneRange(); }
    const abs = k => Math.min(S.lanes.length - 1, r[0] + k);
    tl.forEach((l, k) => { const i = abs(k); S.lanes[i].name = l.name || ''; S.lanes[i].hidden = !!l.hidden; });
    const mk = tl.map((l, k) => (l.marker ? Object.assign(App.newMarker(abs(k), l.marker.ladderId), { unit: l.marker.unit || App.prefUnit || App.baseUnit(), side: l.marker.side || 'auto' }) : null)).filter(Boolean);
    if (mk.length) S.markers = mk;
    S.groups = (t.groups || []).map(g => ({ from: abs(g.from), to: abs(g.to), text: g.text || '' }));
    S.conditions = (t.conditions || []).map(c => ({ name: c.name, values: S.lanes.map((l, i) => (i >= r[0] && i - r[0] < (c.values || []).length ? c.values[i - r[0]] : '')) }));
    S.style = Object.assign(defaultStyle(), t.style || {});
    App.fixIndices();
    App.matchMarkers(true);
    S.arrows = (t.arrows || []).map(a => {
      let y = S.crop.y + S.crop.h / 2;
      const b = (S.markers[0] || { bands: [] }).bands.filter(k => k.matched);
      if (a.bp && b.length >= 2) { const pred = predictY(a.bp, b); if (pred != null) y = pred; }
      return { text: a.text, side: a.side, size: a.size !== false, sizeText: a.sizeText || '', y };
    });
    App.commit();
    return { importedLadders: imported };
  };

  // ---------- project files (.gelfig: gzip JSON with the source bytes inside) ----------
  function b64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  async function gz(text, inflate) {
    if (typeof CompressionStream === 'undefined') return null;
    const stream = new Blob([text]).stream().pipeThrough(inflate ? new DecompressionStream('gzip') : new CompressionStream('gzip'));
    return new Response(stream)[inflate ? 'text' : 'blob']();
  }
  App.projectData = function () {
    const S = App.S;
    return {
      gelfigProject: 1, app: App.NAME + ' ' + App.VERSION, savedAt: new Date().toISOString(),
      source: { name: S.file.name, sha256: S.file.sha256, bytes: b64(App.srcBuffer) },
      markerSource: App.hasMarkerImage() ? { name: S.markerImage.name, sha256: S.markerImage.sha256, bytes: b64(App.markerBuffer) } : null,
      ladders: G.Ladders.defsFor(S.markers.map(m => m.ladderId)),
      initial: App.initial, autoRotation: App.autoRotation,
      state: S
    };
  };
  App.projectBlob = async function () {
    const json = JSON.stringify(App.projectData());
    return (await gz(json)) || new Blob([json], { type: 'application/json' });
  };
  App.openProject = async function (buffer) {
    const u = new Uint8Array(buffer, 0, 2);
    const text = u[0] === 0x1f && u[1] === 0x8b ? await gz(new Blob([buffer]), true) : new TextDecoder().decode(buffer);
    const P = JSON.parse(text);
    if (!P.gelfigProject) throw new Error('Not a GelFigure project file');
    (P.ladders || []).forEach(d => G.Ladders.importDef(d));
    const raw = unb64(P.source.bytes);
    const input = { name: P.source.name, buffer: raw, img: await G.TIFF.decodeBuffer(raw, P.source.name), sha256: await App.sha256(raw) };
    if (P.source.sha256 && input.sha256 !== P.source.sha256) throw new Error('The original image inside the project fails its SHA-256 check; the file may be damaged');
    let marker = null;
    if (P.markerSource && P.markerSource.bytes) {
      const mb = unb64(P.markerSource.bytes);
      marker = { name: P.markerSource.name, buffer: mb, img: await G.TIFF.decodeBuffer(mb, P.markerSource.name), sha256: await App.sha256(mb) };
    }
    restore(input, P.state, P.initial, P.autoRotation, marker);
  };
  // states written by GelFigure or older versions lack the newer fields
  function normalize(S) {
    S.gelType = G.Gels.get(S.gelType).id;
    S.style = Object.assign(defaultStyle(), S.style || {});
    S.strips = S.strips || [];
    S.quant = Object.assign(defaultQuant(), S.quant || {});
    S.quant.plot = Object.assign(defaultPlot(), S.quant.plot || {});
    if (S.markerImage === undefined) S.markerImage = null;
    S.flip = Object.assign({ h: false, v: false }, S.flip || {});
    if (S.gelRows === undefined) S.gelRows = null;
    if (S.gelRow == null) S.gelRow = 0;
    S.rowStash = S.rowStash || {};
    const g = S.geom && S.geom.grid;
    if (!g || !Array.isArray(g.pts) || g.pts.length !== g.nx * g.ny * 2) S.geom = null;
    delete S.keystone;
    return S;
  }
  App.normalizeState = normalize;
  function restore(input, state, initial, autoRotation, marker) {
    App.src0 = { w: input.img.width, h: input.img.height, data: input.img.data };
    App.srcBuffer = input.buffer;
    App.rot = null; App.satCanvas = null; App._display = null; App._clipKey = null; App._emptyKey = null;
    App.exposures = null; App.isExample = false; App._libSkip = null;
    App.S = normalize(state);
    App._flipKey = null; App.applyFlip();
    App.clearMarkerImage(true);
    if (marker) { App.setMarkerImage(marker); } else App.S.markerImage = null;
    App.loadWarnings = input.img.warnings || [];
    if (initial) { try { App.initial = JSON.stringify(normalize(JSON.parse(initial))); } catch (e) { App.initial = App.snapshot(); } } else App.initial = App.snapshot();
    App.autoRotation = autoRotation != null ? autoRotation : state.rotation;
    App.hist = [App.snapshot()]; App.future = [];
    App.ensureRot();
    App.emit('loaded');
    App.emit('change');
  }

  // ---------- library (IndexedDB): every gel you open is kept with its latest state and reopens as you left it ----------
  // 'gels' holds one small record per image (state, thumbnail, names), 'blobs' the file bytes once per image
  // (and once per marker image), so a state save after each change never rewrites the image.
  const DB = 'gelgrapher', META = 'gels', BLOBS = 'blobs', OLD = 'drafts';
  // some browsers never answer indexedDB.open for file:// pages; give up instead of hanging
  let dbP = null;
  function idb() {
    if (!dbP) dbP = new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no indexedDB'));
      const t = setTimeout(() => rej(new Error('indexedDB timeout')), 3000);
      let rq;
      try { rq = indexedDB.open(DB, 2); } catch (e) { clearTimeout(t); return rej(e); }
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(OLD)) db.createObjectStore(OLD);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'sha256' });
        if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS);
      };
      rq.onsuccess = () => { clearTimeout(t); res(rq.result); };
      rq.onerror = () => { clearTimeout(t); rej(rq.error); };
      rq.onblocked = () => { clearTimeout(t); rej(new Error('indexedDB blocked')); };
    });
    dbP.catch(() => { dbP = null; });
    return dbP;
  }
  // fn gets one object store per name and may return a request, whose result is resolved when the transaction completes
  async function idbDo(stores, mode, fn) {
    const db = await idb();
    return new Promise((res, rej) => {
      const tx = db.transaction(stores, mode), names = [].concat(stores);
      const r = fn(...names.map(n => tx.objectStore(n)));
      tx.oncomplete = () => res(r && typeof r === 'object' && 'result' in r ? r.result : r);
      tx.onerror = () => rej(tx.error);
    });
  }
  // the one draft of earlier versions becomes a library entry on first use
  let migrated = null;
  function migrateOld() {
    if (!migrated) migrated = (async () => {
      try {
        const meta = await idbDo(OLD, 'readonly', o => o.get('meta'));
        if (!meta) return;
        const src = await idbDo(OLD, 'readonly', o => o.get('src'));
        const msrc = meta.marker ? await idbDo(OLD, 'readonly', o => o.get('msrc')) : null;
        if (src) {
          let gelType = null; try { gelType = JSON.parse(meta.state).gelType; } catch (e) { /* unknown */ }
          await idbDo([META, BLOBS], 'readwrite', (g, b) => {
            g.put({ sha256: meta.sha256, name: meta.name, title: '', gelType, state: meta.state, initial: meta.initial, autoRotation: meta.autoRotation,
              savedAt: meta.savedAt, createdAt: meta.savedAt, marker: meta.marker || null, ladders: meta.ladders || [], size: src.byteLength + (msrc ? msrc.byteLength : 0), thumb: null });
            b.put(src, meta.sha256);
            if (msrc && meta.marker) b.put(msrc, meta.marker.sha256);
          });
        }
        await idbDo(OLD, 'readwrite', o => { o.delete('meta'); o.delete('src'); o.delete('msrc'); });
      } catch (e) { /* best effort */ }
    })();
    return migrated;
  }
  // a small picture of the crop as it is displayed now
  function libThumb() {
    try {
      const S = App.S, c = App.cropImg(), sm = E.downsample({ w: c.w, h: c.h, data: c.data }, 200);
      const cv = document.createElement('canvas'); cv.width = sm.w; cv.height = sm.h;
      cv.getContext('2d').putImageData(E.toImageData(sm, { black: S.levels.black, white: S.levels.white, gamma: S.levels.gamma || 1, invert: !!S.levels.invert }), 0, 0);
      return cv.toDataURL('image/jpeg', 0.8);
    } catch (e) { return null; }
  }
  // libGen changes when the open gel is removed from the library or another one is opened: a save that
  // was already due or under way must not write it back afterwards; _libSkip keeps a removed gel out until it is loaded again
  let libTimer = 0, libGen = 0;
  const savedBlobs = new Set();
  App.saveDraftSoon = function () {
    clearTimeout(libTimer);
    libTimer = setTimeout(App.saveDraft, 800);
  };
  // close the open gel: the workspace returns to the start screen; the gel stays in the library with its last state
  App.close = async function () {
    if (!App.S) return;
    clearTimeout(libTimer);
    if (!App.isExample && App._libSkip !== App.S.file.sha256 && App.srcBuffer) await App.saveDraft();   // a save that was due runs now
    libGen++;
    App.S = null; App.src0 = App.src = null; App.srcBuffer = null; App.rot = null; App.satCanvas = null; App._display = null; App._clipKey = null; App._emptyKey = null;
    App.exposures = null; App.isExample = false; App._libSkip = null; App.initial = null; App.hist = []; App.future = [];
    App.selLane = -1; App.selArrow = -1; App.mode = null;
    App.clearMarkerImage(true);
    App.emit('closed');
  };
  App.saveDraft = async function () {
    // the synthetic examples are not kept: they are one click away
    if (!App.S || !App.srcBuffer || App.isExample || App._libSkip === App.S.file.sha256) return;
    const gen = libGen, S = App.S, sha = S.file.sha256, mk = App.hasMarkerImage() ? S.markerImage : null;
    const meta = { sha256: sha, name: S.file.name, gelType: S.gelType, lanes: S.lanes.length, w: App.src0.w, h: App.src0.h, bits: S.file.bits,
      size: App.srcBuffer.byteLength + (mk && App.markerBuffer ? App.markerBuffer.byteLength : 0),
      state: App.snapshot(), initial: App.initial, autoRotation: App.autoRotation, savedAt: Date.now(),
      marker: mk && { name: mk.name, sha256: mk.sha256 }, ladders: G.Ladders.defsFor(S.markers.map(m => m.ladderId)), thumb: libThumb() };
    try {
      await migrateOld();
      await idbDo([META, BLOBS], 'readwrite', (gels, blobs) => {
        if (gen !== libGen) return;
        const prev = gels.get(sha);
        prev.onsuccess = () => { const p = prev.result; meta.createdAt = (p && p.createdAt) || meta.savedAt; meta.title = (p && p.title) || ''; gels.put(meta); };
        const need = [[sha, App.srcBuffer]].concat(mk && App.markerBuffer ? [[mk.sha256, App.markerBuffer]] : []);
        need.forEach(([k, buf]) => {
          if (savedBlobs.has(k)) return;
          const c = blobs.count(k);
          c.onsuccess = () => { if (!c.result) blobs.put(buf, k); savedBlobs.add(k); };
        });
      });
      if (navigator.storage && navigator.storage.persist && !App._persistAsked) { App._persistAsked = true; navigator.storage.persist().catch(() => {}); }
      App.emit('library');
    } catch (e) { /* private mode etc.: the library is best-effort */ }
  };
  App.library = {
    // newest first
    list: async () => { await migrateOld(); const all = await idbDo(META, 'readonly', g => g.getAll()); return (all || []).sort((a, b) => b.savedAt - a.savedAt); },
    open: async sha => {
      clearTimeout(libTimer); libGen++;
      const meta = await idbDo(META, 'readonly', g => g.get(sha)), buf = await idbDo(BLOBS, 'readonly', b => b.get(sha));
      if (!meta || !buf) throw new Error('This gel is no longer in the library');
      (meta.ladders || []).forEach(d => G.Ladders.importDef(d));
      const input = { name: meta.name, buffer: buf, img: await G.TIFF.decodeBuffer(buf, meta.name), sha256: sha };
      let marker = null;
      if (meta.marker) {
        const mb = await idbDo(BLOBS, 'readonly', b => b.get(meta.marker.sha256));
        if (mb) { marker = { name: meta.marker.name, buffer: mb, img: await G.TIFF.decodeBuffer(mb, meta.marker.name), sha256: meta.marker.sha256 }; savedBlobs.add(mb && meta.marker.sha256); }
      }
      savedBlobs.add(sha);
      restore(input, JSON.parse(meta.state), meta.initial, meta.autoRotation, marker);
    },
    rename: async (sha, title) => {
      await idbDo(META, 'readwrite', g => { const rq = g.get(sha); rq.onsuccess = () => { if (rq.result) { rq.result.title = title; g.put(rq.result); } }; });
      App.emit('library');
    },
    remove: async sha => {
      const open = !!(App.S && App.S.file.sha256 === sha);
      if (open) { clearTimeout(libTimer); libGen++; App._libSkip = sha; }
      await idbDo([META, BLOBS], 'readwrite', (g, b) => {
        const all = g.getAll();
        all.onsuccess = () => {
          const me = all.result.find(e => e.sha256 === sha);
          g.delete(sha); b.delete(sha); savedBlobs.delete(sha);
          // a marker image is shared by every gel that used it; its bytes go with the last of them
          if (me && me.marker && !all.result.some(e => e.sha256 !== sha && e.marker && e.marker.sha256 === me.marker.sha256)) { b.delete(me.marker.sha256); savedBlobs.delete(me.marker.sha256); }
        };
      });
      if (open) await App.close();   // a gel removed from the library leaves the workspace too
      App.emit('library');
    },
    clear: async () => {
      clearTimeout(libTimer); libGen++; if (App.S && App.S.file) App._libSkip = App.S.file.sha256;
      await idbDo([META, BLOBS], 'readwrite', (g, b) => { g.clear(); b.clear(); }); savedBlobs.clear();
      if (App.S && !App.isExample) await App.close();
      App.emit('library');
    }
  };
  // the single-draft calls of earlier versions, kept for the self-test: the most recently saved gel
  App.peekDraft = async function () { try { return (await App.library.list())[0] || null; } catch (e) { return null; } };
  App.restoreDraft = async function () { const l = await App.library.list(); if (!l.length) throw new Error('No draft to restore'); await App.library.open(l[0].sha256); };
  App.dropDraft = async function () { if (App.S && App.S.file) await App.library.remove(App.S.file.sha256); };
  function predictY(bp, bands) {
    const B = bands.slice().sort((a, b) => b.bp - a.bp);
    for (let i = 0; i < B.length - 1; i++) if (bp <= B[i].bp && bp >= B[i + 1].bp) {
      const t = (Math.log(bp) - Math.log(B[i].bp)) / (Math.log(B[i + 1].bp) - Math.log(B[i].bp));
      return B[i].y + t * (B[i + 1].y - B[i].y);
    }
    return null;
  }

  G.App = App;
})(window);

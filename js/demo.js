/* Synthetic gels (16-bit, slightly tilted) for the example buttons and self-tests.
 *   dna      agarose gel, GeneRuler 1 kb Plus, PCR / digest products (the GelFigure test gel)
 *   sds      Coomassie-stained SDS-PAGE of a His-tag purification (dark bands on a light gel)
 *   western  chemiluminescence blot, p53 rising over a time course with a GAPDH loading control;
 *            the true band amounts are kept in .truth so densitometry can be checked */
(function (G) {
  'use strict';

  function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  const PRESETS = {
    dna: {
      ladder: 'gr1kbplus', range: [20000, 75], gelType: 'dna-agarose', bandSigma: 4, ladderSigma: 3.2, wellAmp: 0.10,
      samples: [
        null, // ladder
        [[1500, 0.55]], [[1500, 0.6]], [[1500, 0.5], [60, 0.15]], [],
        [[850, 0.5]], [[850, 0.45], [3000, 0.12]], [[480, 0.65]], [[480, 0.62]],
        [[2200, 0.4], [700, 0.4]], [[60, 0.2]], []
      ],
      extra: [{ lane: 7, size: 480, a: 1.4, s: 3.5 }]   // a saturating band
    },
    sds: {
      ladder: 'pr26619', range: [300, 8], gelType: 'sds-page', lanes: 10, bandSigma: 3.6, ladderSigma: 3, wellAmp: 0.06, dark: true, seed: 5,
      names: ['M', 'Lysate', 'Soluble', 'Pellet', 'Flow-through', 'Wash', 'Elution 1', 'Elution 2', 'Elution 3', ''],
      samples: null   // built below: lysates have many bands, elutions one strong band at 45 kDa
    },
    western: {
      ladder: 'pr26619', range: [300, 8], gelType: 'western', lanes: 9, bandSigma: 5, ladderSigma: 3.4, wellAmp: 0, seed: 21, haze: 0.05,
      names: ['M', '0 h', '1 h', '2 h', '4 h', '8 h', '12 h', '24 h', '48 h'],
      target: { name: 'p53', size: 53, amounts: [0.10, 0.17, 0.30, 0.52, 0.78, 0.70, 0.46, 0.27] },
      control: { name: 'GAPDH', size: 37, amounts: [0.50, 0.53, 0.47, 0.51, 0.55, 0.49, 0.52, 0.50] }
    }
  };

  function sdsSamples(rnd, nb) {
    // a lysate: many proteins, most of them faint, a few abundant ones
    const lysate = scale => Array.from({ length: nb }, () => [8 + Math.exp(rnd() * Math.log(250)), (0.03 + rnd() * rnd() * 0.25) * scale]);
    return [
      null,
      lysate(1).concat([[45, 0.28]]), lysate(0.85).concat([[45, 0.25]]), lysate(0.55).concat([[45, 0.06]]),
      lysate(0.9), lysate(0.12).concat([[45, 0.05]]),
      [[45, 0.95], [66, 0.07], [28, 0.05]], [[45, 0.62], [66, 0.04]], [[45, 0.24]], []
    ];
  }

  function makeGel(opts) {
    const kind = (opts && opts.preset) || 'dna';
    const P = PRESETS[kind];
    opts = Object.assign({ w: 1400, h: 1000, lanes: 12, tilt: 1.2, seed: 7 }, P, opts || {});
    // row2: a second comb further down the same slab ({dy, lanes})
    const row2 = opts.row2 || null;
    if (row2) opts.h = 1000 + row2.dy;
    const { w, h } = opts, rnd = rng(opts.seed);
    const d = new Float32Array(w * h);
    const gx0 = 140, gx1 = 1260, gy0 = 90, gy1 = 900 + (row2 ? row2.dy : 0);
    const pitch = 80, laneW = 52, x0 = 260, wellY = 150;
    // migration: y = A + B ln(size)
    const yTop = 200, yBot = 840, [hi, lo] = opts.range, B = (yBot - yTop) / (Math.log(lo) - Math.log(hi)), A = yTop - B * Math.log(hi);
    const yOf = s => A + B * Math.log(s);
    const lad = G.Ladders.get(opts.ladder);
    let samples = opts.samples;
    const truth = { pitch, x0, lanes: opts.lanes, yOf, gel: [gx0, gy0, gx1, gy1], gelType: opts.gelType, names: opts.names || null };
    if (kind === 'sds') samples = sdsSamples(rnd, opts.lysateBands || 30);
    if (kind === 'western') {
      samples = [null].concat(opts.target.amounts.map((t, k) => [[opts.target.size, t], [opts.control.size, opts.control.amounts[k]], [75, 0.05 + 0.02 * rnd()]]));
      truth.target = opts.target; truth.control = opts.control;
      truth.relative = opts.target.amounts.map((t, k) => (t / opts.control.amounts[k]) / (opts.target.amounts[0] / opts.control.amounts[0]));
    }
    const bands = [];
    for (let Ln = 0; Ln < opts.lanes; Ln++) {
      const cx = x0 + Ln * pitch;
      if (Ln === 0) lad.sizes.forEach(s => bands.push({ cx, y: yOf(s), a: lad.ref.includes(s) ? 0.75 : 0.38, s: opts.ladderSigma }));
      else (samples[Ln] || []).forEach(([s, a]) => bands.push({ cx, y: yOf(s), a, s: opts.bandSigma }));
      if (opts.wellAmp) bands.push({ cx, y: wellY, a: opts.wellAmp, s: 5, well: true });
    }
    if (!opts.clean) (opts.extra || []).forEach(e => bands.push({ cx: x0 + e.lane * pitch, y: yOf(e.size), a: e.a, s: e.s }));   // clean: no saturating band (the tutorial's practice gel)
    if (row2) {
      for (let Ln = 0; Ln < row2.lanes; Ln++) {
        const cx = x0 + Ln * pitch;
        if (Ln === 0) lad.sizes.forEach(s => bands.push({ cx, y: yOf(s) + row2.dy, a: lad.ref.includes(s) ? 0.75 : 0.38, s: opts.ladderSigma }));
        else (samples[Ln] || []).forEach(([s, a]) => bands.push({ cx, y: yOf(s) + row2.dy, a, s: opts.bandSigma }));
        if (opts.wellAmp) bands.push({ cx, y: wellY + row2.dy, a: opts.wellAmp, s: 5, well: true });
      }
      truth.rows = [{ lanes: opts.lanes, yOf }, { lanes: row2.lanes, yOf: v => yOf(v) + row2.dy }];
    }
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = 0.035 + 0.012 * (x / w) + 0.008 * Math.sin(y / 170);
        if (x > gx0 && x < gx1 && y > gy0 && y < gy1) v += 0.03;
        if (opts.haze) v += opts.haze * Math.exp(-(((x - 700) / 700) ** 2 + ((y - 520) / 420) ** 2));
        d[y * w + x] = v;
      }
    }
    for (const b of bands) {
      const hw = laneW / 2, ry = Math.ceil(b.s * 4);
      for (let y = Math.max(0, Math.floor(b.y - ry - 4)); y < Math.min(h, b.y + ry + 4); y++) {
        for (let x = Math.max(0, Math.floor(b.cx - hw - 3)); x < Math.min(w, b.cx + hw + 3); x++) {
          const dx = (x - b.cx) / hw;
          const smile = 2.5 * dx * dx;
          const edge = 1 / (1 + Math.exp((Math.abs(x - b.cx) - hw) / 1.2));
          const dy = y - (b.y - smile);
          d[y * w + x] += b.a * edge * Math.exp(-dy * dy / (2 * b.s * b.s));
        }
      }
    }
    for (let i = 0; i < d.length; i++) {
      let v = Math.min(1, Math.max(0, d[i] + (rnd() - 0.5) * 0.012));
      if (opts.dark) v = Math.min(1, Math.max(0, 0.93 - v * 0.9));   // stained gel scanned in white light
      d[i] = v;
    }
    let img = { w, h, data: d };
    if (opts.tilt) img = G.Engine.rotate(img, opts.tilt);
    return { width: w, height: h, data: img.data, truth };
  }

  // Uncompressed 16-bit grayscale TIFF encoder
  function encodeTiff16(img) {
    const { width: w, height: h, data } = img;
    const nTags = 11, ifdOff = 8, ifdSize = 2 + nTags * 12 + 4, dataOff = ifdOff + ifdSize + 16;
    const buf = new ArrayBuffer(dataOff + w * h * 2), dv = new DataView(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
    let p = ifdOff; dv.setUint16(p, nTags, true); p += 2;
    const resOff = ifdOff + ifdSize;
    const tag = (t, type, count, val) => { dv.setUint16(p, t, true); dv.setUint16(p + 2, type, true); dv.setUint32(p + 4, count, true); if (type === 3 && count === 1) dv.setUint16(p + 8, val, true); else dv.setUint32(p + 8, val, true); p += 12; };
    tag(256, 4, 1, w); tag(257, 4, 1, h); tag(258, 3, 1, 16); tag(259, 3, 1, 1); tag(262, 3, 1, 1);
    tag(273, 4, 1, dataOff); tag(277, 3, 1, 1); tag(278, 4, 1, h); tag(279, 4, 1, w * h * 2);
    tag(282, 5, 1, resOff); tag(296, 3, 1, 2);
    dv.setUint32(p, 0, true);
    dv.setUint32(resOff, 300, true); dv.setUint32(resOff + 4, 1, true);
    for (let i = 0; i < w * h; i++) dv.setUint16(dataOff + i * 2, Math.round(data[i] * 65535), true);
    return buf;
  }

  /* Two rows of wells on one slab (two combs): a 12-lane DNA row and, 850 px lower, an 8-lane row. */
  function makeTwoRowGel(opts) {
    const g = makeGel(Object.assign({ preset: 'dna', tilt: 0.8, row2: { dy: 850, lanes: 8 } }, opts || {}));
    return g;
  }

  G.Demo = { makeGel, makeTwoRowGel, encodeTiff16, PRESETS };
})(window);

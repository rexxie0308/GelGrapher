/* Vector PDF from the figure SVG. Only the vocabulary GelGrapher itself writes is understood:
 * <g transform="translate() rotate()">, <rect>, <line> (with dash), <path d="M L H V Z">, <text> with
 * italic <tspan>s, and one embedded raster <image> (the gel, embedded losslessly at its own pixels).
 * Text uses the standard PDF fonts (Helvetica = Arial metrics); Greek letters and maths signs that
 * WinAnsi lacks (β, α, −, ≈ …) are set in the Symbol font, so lane names like "β-actin" stay text.
 * Units: the SVG is already in points, so coordinates carry over 1:1. */
(function (G) {
  'use strict';
  const CP1252 = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E,
    0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  const winAnsi = cp => (cp >= 0x20 && cp < 0x7F) || (cp >= 0xA0 && cp <= 0xFF) ? cp : (CP1252[cp] != null ? CP1252[cp] : -1);
  const GREEK = 'ΑΒΧΔΕΦΓΗΙ ΚΛΜΝΟΠΘΡΣΤΥ ΩΞΨΖ', greek = 'αβχδεφγηι κλμνοπθρστυ ωξψζ';
  const SYMBOL = {};
  [...GREEK].forEach((c, i) => { if (c !== ' ') SYMBOL[c] = 0x41 + i; });
  [...greek].forEach((c, i) => { if (c !== ' ') SYMBOL[c] = 0x61 + i; });
  Object.assign(SYMBOL, { 'ϑ': 0x4A, 'ς': 0x56, 'ϕ': 0x6A, '−': 0x2D, '≈': 0xBB, '≤': 0xA3, '≥': 0xB3, '≠': 0xB9, '∞': 0xA5, '→': 0xAE, '←': 0xAC, '↑': 0xAD, '↓': 0xAF, '∆': 0x44, '′': 0xA2, '″': 0xB2, '•': 0xB7, '∼': 0x7E });

  const n = v => (Math.round(v * 1000) / 1000).toString();
  function pdfStr(bytes) {
    let s = '(';
    for (const b of bytes) s += b === 0x28 || b === 0x29 || b === 0x5C ? '\\' + String.fromCharCode(b) : b < 32 || b > 126 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b);
    return s + ')';
  }
  function color(c) {
    if (!c || c === 'none' || c === 'transparent') return null;
    let h = c.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  }
  function parseTransform(t) {
    const out = [];
    (t || '').replace(/(translate|rotate|scale)\s*\(([^)]*)\)/g, (_, k, a) => {
      const v = a.split(/[\s,]+/).filter(Boolean).map(Number);
      if (k === 'translate') out.push([1, 0, 0, 1, v[0] || 0, v[1] || 0]);
      else if (k === 'scale') out.push([v[0], 0, 0, v[1] != null ? v[1] : v[0], 0, 0]);
      else { const r = (v[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); out.push([c, s, -s, c, 0, 0]); }
    });
    return out;
  }
  // split a run of text into pieces that one standard font can encode
  function encodeRuns(text, italic, bold, missing) {
    const pieces = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      let font, code = winAnsi(cp);
      if (code >= 0) font = bold ? (italic ? 'F4' : 'F3') : (italic ? 'F2' : 'F1');
      else if (SYMBOL[ch] != null) { font = 'F5'; code = SYMBOL[ch]; } else { font = bold ? 'F3' : 'F1'; code = 0x3F; missing.add(ch); }
      const last = pieces[pieces.length - 1];
      if (last && last.font === font) last.bytes.push(code); else pieces.push({ font, bytes: [code] });
    }
    return pieces;
  }

  async function imagePixels(href) {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('image')); img.src = href; });
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data, np = c.width * c.height;
    let gray = true;
    for (let i = 0; i < np && gray; i++) if (d[i * 4] !== d[i * 4 + 1] || d[i * 4] !== d[i * 4 + 2]) gray = false;
    const out = new Uint8Array(np * (gray ? 1 : 3));
    for (let i = 0; i < np; i++) { if (gray) out[i] = d[i * 4]; else { out[i * 3] = d[i * 4]; out[i * 3 + 1] = d[i * 4 + 1]; out[i * 3 + 2] = d[i * 4 + 2]; } }
    return { w: c.width, h: c.height, gray, data: out };
  }
  async function deflate(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  }

  /* svg: string; meta: {title, subject}. Resolves {blob, missing: [chars set as '?']} */
  async function fromSVG(svg, meta) {
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    const vb = (root.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number);
    const [vx, vy, vw, vh] = vb;
    const ops = [], images = [], missing = new Set();
    ops.push(`1 0 0 -1 0 ${n(vh)} cm`, `1 0 0 1 ${n(-vx)} ${n(-vy)} cm`);
    const measure = G.Render.measure;
    const attr = (el, k, d) => (el.hasAttribute(k) ? el.getAttribute(k) : d);
    async function walk(el, inh) {
      const tag = el.localName;
      const st = Object.assign({}, inh);
      ['fill', 'stroke', 'stroke-width', 'font-size', 'text-anchor', 'font-weight', 'font-style', 'stroke-dasharray'].forEach(k => { if (el.hasAttribute(k)) st[k] = el.getAttribute(k); });
      const tf = parseTransform(el.getAttribute('transform'));
      if (tf.length) { ops.push('q'); tf.forEach(m => ops.push(m.map(n).join(' ') + ' cm')); }
      if (tag === 'svg' || tag === 'g') { for (const c of el.children) await walk(c, st); }
      else if (tag === 'rect') {
        const x = +attr(el, 'x', 0), y = +attr(el, 'y', 0), w = +attr(el, 'width', 0), h = +attr(el, 'height', 0);
        const f = color(st.fill), s = el.hasAttribute('stroke') ? color(st.stroke) : null;
        if (f) ops.push(`${f.map(n).join(' ')} rg ${n(x)} ${n(y)} ${n(w)} ${n(h)} re f`);
        if (s) ops.push(`${s.map(n).join(' ')} RG ${n(+st['stroke-width'] || 1)} w [] 0 d ${n(x)} ${n(y)} ${n(w)} ${n(h)} re S`);
      } else if (tag === 'line') {
        const s = color(st.stroke);
        if (s) {
          const dash = st['stroke-dasharray'] ? `[${st['stroke-dasharray'].split(/[\s,]+/).map(Number).map(n).join(' ')}] 0 d` : '[] 0 d';
          ops.push(`${s.map(n).join(' ')} RG ${n(+st['stroke-width'] || 1)} w ${dash} ${n(+attr(el, 'x1', 0))} ${n(+attr(el, 'y1', 0))} m ${n(+attr(el, 'x2', 0))} ${n(+attr(el, 'y2', 0))} l S`);
        }
      } else if (tag === 'path') {
        const f = color(st.fill);
        const toks = (el.getAttribute('d') || '').match(/[MLHVZmlhvz]|-?[\d.]+(?:e-?\d+)?/g) || [];
        let cmd = '', cx = 0, cy = 0;
        const pathOps = [];
        for (let i = 0; i < toks.length;) {
          if (/[A-Za-z]/.test(toks[i])) cmd = toks[i++];
          if (cmd === 'Z' || cmd === 'z') { pathOps.push('h'); continue; }
          if (cmd === 'H') { cx = +toks[i++]; pathOps.push(`${n(cx)} ${n(cy)} l`); continue; }
          if (cmd === 'V') { cy = +toks[i++]; pathOps.push(`${n(cx)} ${n(cy)} l`); continue; }
          cx = +toks[i++]; cy = +toks[i++];
          pathOps.push(`${n(cx)} ${n(cy)} ${cmd === 'M' ? 'm' : 'l'}`);
          if (cmd === 'M') cmd = 'L';
        }
        if (f && pathOps.length) ops.push(`${f.map(n).join(' ')} rg ${pathOps.join(' ')} f`);
      } else if (tag === 'text') {
        const size = +st['font-size'] || 7, bold = st['font-weight'] === 'bold';
        const runs = [];
        for (const c of el.childNodes) {
          if (c.nodeType === 3) runs.push({ t: c.textContent, it: st['font-style'] === 'italic' });
          else if (c.localName === 'tspan') runs.push({ t: c.textContent, it: (c.getAttribute('font-style') || st['font-style']) === 'italic' });
        }
        const text = runs.map(r => r.t).join('');
        if (text.length) {
          const w = measure(runs.map(r => r.it ? `*${r.t}*` : r.t).join(''), size, bold);
          const anchor = st['text-anchor'] || 'start';
          const x = +attr(el, 'x', 0) - (anchor === 'middle' ? w / 2 : anchor === 'end' ? w : 0), y = +attr(el, 'y', 0);
          const f = color(st.fill) || [0, 0, 0];
          let body = '';
          runs.forEach(r => encodeRuns(r.t, r.it, bold, missing).forEach(p => { body += `/${p.font} ${n(size)} Tf ${pdfStr(p.bytes)} Tj `; }));
          ops.push(`BT ${f.map(n).join(' ')} rg 1 0 0 -1 ${n(x)} ${n(y)} Tm ${body}ET`);
        }
      } else if (tag === 'image') {
        const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
        if (href && href.startsWith('data:')) {
          const px = await imagePixels(href), name = 'Im' + (images.length + 1);
          images.push(Object.assign(px, { name }));
          const x = +attr(el, 'x', 0), y = +attr(el, 'y', 0), w = +attr(el, 'width', px.w), h = +attr(el, 'height', px.h);
          ops.push(`q ${n(w)} 0 0 ${n(-h)} ${n(x)} ${n(y + h)} cm /${name} Do Q`);
        }
      }
      if (tf.length) ops.push('Q');
    }
    await walk(root, { fill: root.getAttribute('fill') || '#000' });

    // ---- assemble the file ----
    const enc = new TextEncoder(), chunks = [], offsets = [];
    let len = 0;
    const push = u8 => { chunks.push(u8); len += u8.length; };
    const pushS = s => push(enc.encode(s));
    const obj = (id, body, stream) => {
      offsets[id] = len;
      if (stream) { pushS(`${id} 0 obj\n${body}\nstream\n`); push(stream); pushS('\nendstream\nendobj\n'); }
      else pushS(`${id} 0 obj\n${body}\nendobj\n`);
    };
    const utf16 = s => '<FEFF' + [...String(s)].map(ch => { const c = ch.codePointAt(0); if (c > 0xFFFF) { const h = Math.floor((c - 0x10000) / 0x400) + 0xD800, l = (c - 0x10000) % 0x400 + 0xDC00; return h.toString(16).padStart(4, '0') + l.toString(16).padStart(4, '0'); } return c.toString(16).padStart(4, '0'); }).join('') + '>';
    pushS('%PDF-1.4\n');
    push(new Uint8Array([0x25, 0xE2, 0xE3, 0xCF, 0xD3, 0x0A]));   // binary marker comment
    const fontIds = { F1: 5, F2: 6, F3: 7, F4: 8, F5: 9 }, firstImg = 10, infoId = firstImg + images.length;
    const xobj = images.map((im, i) => `/${im.name} ${firstImg + i} 0 R`).join(' ');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(vw)} ${n(vh)}] /Contents 4 0 R /Resources << /Font << ${Object.entries(fontIds).map(([k, v]) => `/${k} ${v} 0 R`).join(' ')} >>${xobj ? ` /XObject << ${xobj} >>` : ''} >> >>`);
    const content = enc.encode(ops.join('\n'));
    const cz = await deflate(content);
    obj(4, `<< /Length ${(cz || content).length}${cz ? ' /Filter /FlateDecode' : ''} >>`, cz || content);
    const base = { F1: 'Helvetica', F2: 'Helvetica-Oblique', F3: 'Helvetica-Bold', F4: 'Helvetica-BoldOblique' };
    Object.entries(base).forEach(([k, f]) => obj(fontIds[k], `<< /Type /Font /Subtype /Type1 /BaseFont /${f} /Encoding /WinAnsiEncoding >>`));
    obj(fontIds.F5, '<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>');
    for (let i = 0; i < images.length; i++) {
      const im = images[i], z = await deflate(im.data);
      obj(firstImg + i, `<< /Type /XObject /Subtype /Image /Width ${im.w} /Height ${im.h} /ColorSpace /${im.gray ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Length ${(z || im.data).length}${z ? ' /Filter /FlateDecode' : ''} >>`, z || im.data);
    }
    const d = new Date(), pad = v => String(v).padStart(2, '0');
    const when = `D:${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    obj(infoId, `<< /Producer ${utf16((G.App ? G.App.NAME + ' ' + G.App.VERSION : 'GelGrapher'))} /Title ${utf16((meta && meta.title) || 'Figure')} /Subject ${utf16((meta && meta.subject) || '')} /CreationDate (${when}) >>`);
    const xref = len, count = infoId + 1;
    let x = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    pushS(x + `trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return { blob: new Blob(chunks, { type: 'application/pdf' }), missing: [...missing] };
  }

  G.PDF = { fromSVG };
})(window);

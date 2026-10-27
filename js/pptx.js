/* Editable PowerPoint (.pptx) from the figure SVG. Only the vocabulary GelGrapher itself writes is
 * understood: <rect>, <line> (with dashes), <path d="M L Z"> (arrow heads), <text> with italic <tspan>s,
 * <g transform="translate() rotate()"> and the gel <image>. Text becomes text boxes, lines and arrow
 * heads native shapes, so they stay editable in PowerPoint; the gel is one picture per shown block
 * (lane segment × strip), each a native crop of the whole processed crop, so a picture can be
 * recropped in PowerPoint to show more of the gel. One slide, sized to the figure. No dependencies:
 * the ZIP is G.Zip (stored). Fonts are referenced by name, never embedded. */
(function (G) {
  'use strict';
  const EMU = 12700;                         // per point
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const emu = v => Math.round(v * EMU);
  const hex = c => {
    if (!c || c === 'none' || c === 'transparent') return null;
    let h = c.trim().replace('#', '');
    if (h.length === 3) h = h.split('').map(x => x + x).join('');
    return /^[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : '000000';
  };
  const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  function parseTransform(t) {
    let m = [1, 0, 0, 1, 0, 0];
    (t || '').replace(/(translate|rotate|scale)\s*\(([^)]*)\)/g, (_, k, a) => {
      const v = a.split(/[\s,]+/).filter(Boolean).map(Number);
      if (k === 'translate') m = mul(m, [1, 0, 0, 1, v[0] || 0, v[1] || 0]);
      else if (k === 'scale') m = mul(m, [v[0], 0, 0, v[1] != null ? v[1] : v[0], 0, 0]);
      else { const r = (v[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); m = mul(m, [c, s, -s, c, 0, 0]); }
    });
    return m;
  }
  // DrawingML rotation of a matrix (clockwise positive, in 60000ths of a degree, 0..360)
  const rotOf = m => { const d = Math.atan2(m[1], m[0]) * 180 / Math.PI; return Math.round(((d % 360) + 360) % 360 * 60000); };

  let nextId;
  const id = () => nextId++;
  // a shape placed by the centre of its local box (x, y, w, h under matrix m), so rotation works like SVG's
  function xfrm(m, x, y, w, h) {
    const c = apply(m, x + w / 2, y + h / 2), rot = rotOf(m);
    return `<a:xfrm${rot ? ` rot="${rot}"` : ''}><a:off x="${emu(c[0] - w / 2)}" y="${emu(c[1] - h / 2)}"/><a:ext cx="${Math.max(1, emu(w))}" cy="${Math.max(1, emu(h))}"/></a:xfrm>`;
  }
  const solid = h => `<a:solidFill><a:srgbClr val="${h}"/></a:solidFill>`;
  function lineXml(stroke, width, dash) {
    const h = hex(stroke);
    if (!h) return '<a:ln><a:noFill/></a:ln>';
    return `<a:ln w="${Math.max(1, emu(width || 1))}" cap="flat">${solid(h)}${dash ? '<a:prstDash val="dash"/>' : ''}</a:ln>`;
  }
  function sp(name, geom, m, x, y, w, h, fill, stroke, width, dash) {
    const f = hex(fill);
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id()}" name="${esc(name)}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(m, x, y, w, h)}${geom}${f ? solid(f) : '<a:noFill/>'}${lineXml(stroke, width, dash)}</p:spPr></p:sp>`;
  }
  function connector(m, x1, y1, x2, y2, stroke, width, dash) {
    const a = apply(m, x1, y1), b = apply(m, x2, y2);
    const x = Math.min(a[0], b[0]), y = Math.min(a[1], b[1]), w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
    const flipH = (b[0] < a[0]) !== (b[1] < a[1]) && w > 0 && h > 0;   // the line runs from top-right to bottom-left
    return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id()}" name="Line"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr><a:xfrm${flipH ? ' flipH="1"' : ''}><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>${lineXml(stroke, width, dash)}</p:spPr></p:cxnSp>`;
  }
  // a closed polygon (arrow head) as custom geometry in its own box
  function polygon(m, pts, fill) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 0.1, h = Math.max(...ys) - y0 || 0.1;
    const path = pts.map((p, i) => `<a:${i ? 'lnTo' : 'moveTo'}><a:pt x="${emu(p[0] - x0)}" y="${emu(p[1] - y0)}"/></a:${i ? 'lnTo' : 'moveTo'}>`).join('') + '<a:close/>';
    const geom = `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="${emu(w)}" h="${emu(h)}">${path}</a:path></a:pathLst></a:custGeom>`;
    return sp('Arrow head', geom, m, x0, y0, w, h, fill, null);
  }
  function textBox(m, runs, x, baseline, size, anchor, bold, fill, font, measure) {
    const text = runs.map(r => r.t).join('');
    const w = measure(runs.map(r => (r.it ? `*${r.t}*` : r.t)).join(''), size, bold) + size * 0.25, h = size * 1.25;
    const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w + size * 0.125 : x - size * 0.125;
    const algn = anchor === 'middle' ? 'ctr' : anchor === 'end' ? 'r' : 'l';
    const body = runs.map(r => `<a:r><a:rPr lang="en-US" sz="${Math.round(size * 100)}"${bold ? ' b="1"' : ''}${r.it ? ' i="1"' : ''} dirty="0">${solid(hex(fill) || '000000')}<a:latin typeface="${esc(font)}"/><a:cs typeface="${esc(font)}"/></a:rPr><a:t>${esc(r.t)}</a:t></a:r>`).join('');
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id()}" name="${esc(text.slice(0, 40) || 'Text')}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(m, x0, baseline - size, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
      `<p:txBody><a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></a:bodyPr><a:lstStyle/><a:p><a:pPr algn="${algn}"/>${body}</a:p></p:txBody></p:sp>`;
  }
  function picture(m, x, y, w, h, rId, src) {
    const rect = src ? `<a:srcRect l="${src.l}" t="${src.t}" r="${src.r}" b="${src.b}"/>` : '';
    return `<p:pic><p:nvPicPr><p:cNvPr id="${id()}" name="Gel"/><p:cNvPicPr><a:picLocks noChangeAspect="0"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/>${rect}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(m, x, y, w, h)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
  }

  const dataUrlBytes = href => { const b = atob(href.split(',')[1]); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

  /* svg: the figure; opts: {title, subject, crop: canvas of the whole processed crop, gel: composeGel()
   * result (segs / vsegs in crop pixels), scale: figure points per crop pixel}. Without crop + gel the
   * composed gel in the SVG is embedded as one picture. Resolves a Blob. */
  async function fromFigure(svg, opts) {
    opts = opts || {};
    const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.localName !== 'svg') throw new Error('Not an SVG figure');
    const [vx, vy, vw, vh] = (root.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number);
    if (vw > 4032 || vh > 4032) throw new Error('The figure is wider than 56 inches, PowerPoint’s largest slide');
    const font = G.Render.font ? G.Render.font() : 'Arial';   // the typeface of the last build, as the SVG root carries it
    const measure = G.Render.measure;
    nextId = 2;
    const shapes = [];
    let gelBytes = null, nPics = 0;
    // the gel: one picture per block, each a crop of the whole processed crop
    const crop = opts.crop, gel = opts.gel;
    const blocks = crop && gel && gel.segs && gel.vsegs ? gel.vsegs.flatMap(v => gel.segs.map(s => ({ s, v }))) : null;
    const attr = (el, k, d) => (el.hasAttribute(k) ? el.getAttribute(k) : d);
    function walk(el, inh, m) {
      const tag = el.localName, st = Object.assign({}, inh);
      ['fill', 'stroke', 'stroke-width', 'font-size', 'text-anchor', 'font-weight', 'font-style', 'stroke-dasharray'].forEach(k => { if (el.hasAttribute(k)) st[k] = el.getAttribute(k); });
      if (el.hasAttribute('transform')) m = mul(m, parseTransform(el.getAttribute('transform')));
      if (tag === 'svg' || tag === 'g') { for (const c of el.children) walk(c, st, m); return; }
      if (tag === 'rect') {
        const x = +attr(el, 'x', 0), y = +attr(el, 'y', 0), w = +attr(el, 'width', 0), h = +attr(el, 'height', 0);
        const fill = st.fill, stroke = el.hasAttribute('stroke') ? st.stroke : null;
        if (hex(fill) === 'FFFFFF' && !hex(stroke) && w >= vw - 0.01 && h >= vh - 0.01) return;   // the page background
        if (fill === 'transparent') return;                                                        // editor hit areas
        shapes.push(sp('Frame', '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>', m, x, y, w, h, fill, stroke, +st['stroke-width'] || 1, !!st['stroke-dasharray']));
      } else if (tag === 'line') {
        if (!hex(st.stroke)) return;
        shapes.push(connector(m, +attr(el, 'x1', 0), +attr(el, 'y1', 0), +attr(el, 'x2', 0), +attr(el, 'y2', 0), st.stroke, +st['stroke-width'] || 1, !!st['stroke-dasharray']));
      } else if (tag === 'path') {
        const toks = (el.getAttribute('d') || '').match(/[MLZmlz]|-?[\d.]+(?:e-?\d+)?/g) || [];
        const pts = [];
        for (let i = 0; i < toks.length;) {
          if (/[A-Za-z]/.test(toks[i])) { const c = toks[i++]; if (c === 'Z' || c === 'z') continue; if (c !== 'M' && c !== 'L') throw new Error('Unsupported path command ' + c); continue; }
          pts.push([+toks[i++], +toks[i++]]);
        }
        if (pts.length >= 3) shapes.push(polygon(m, pts, st.fill));
      } else if (tag === 'text') {
        const size = +st['font-size'] || 7, bold = st['font-weight'] === 'bold';
        const runs = [];
        for (const c of el.childNodes) {
          if (c.nodeType === 3) { if (c.textContent) runs.push({ t: c.textContent, it: st['font-style'] === 'italic' }); }
          else if (c.localName === 'tspan' && c.textContent) runs.push({ t: c.textContent, it: (c.getAttribute('font-style') || st['font-style']) === 'italic' });
        }
        if (!runs.length) return;
        shapes.push(textBox(m, runs, +attr(el, 'x', 0), +attr(el, 'y', 0), size, st['text-anchor'] || 'start', bold, st.fill, font, measure));
      } else if (tag === 'image') {
        const x = +attr(el, 'x', 0), y = +attr(el, 'y', 0), w = +attr(el, 'width', 0), h = +attr(el, 'height', 0);
        if (blocks) {
          const sc = w / gel.canvas.width, W = crop.width, H = crop.height, pc = v => Math.round(v * 100000);
          blocks.forEach(({ s, v }) => {
            shapes.push(picture(m, x + s.off * sc, y + v.off * sc, (s.px1 - s.px0) * sc, (v.py1 - v.py0) * sc, 'rId2',
              { l: pc(s.px0 / W), t: pc(v.py0 / H), r: pc(1 - s.px1 / W), b: pc(1 - v.py1 / H) }));
            nPics++;
          });
        } else {
          const href = el.getAttribute('href') || el.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || '';
          if (!href.startsWith('data:image/png')) throw new Error('The gel image is not an embedded PNG');
          gelBytes = dataUrlBytes(href);
          shapes.push(picture(m, x, y, w, h, 'rId2', null)); nPics++;
        }
      } else throw new Error('Unsupported SVG element <' + tag + '>');
    }
    walk(root, {}, [1, 0, 0, 1, -vx, -vy]);
    if (blocks) gelBytes = await new Promise((res, rej) => crop.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('Could not encode the gel image'))), 'image/png'));
    // slide size: the figure, at least one inch (PowerPoint's smallest slide)
    const cx = emu(Math.max(72, vw)), cy = emu(Math.max(72, vh));
    const title = esc(opts.title || 'Figure'), subject = esc(opts.subject || ''), app = esc((G.App ? G.App.NAME + ' ' + G.App.VERSION : 'GelGrapher'));
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
    const rels = list => X + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([i, t, g]) => `<Relationship Id="${i}" Type="http://schemas.openxmlformats.org/${t}" Target="${g}"/>`).join('')}</Relationships>`;
    const theme = X + `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="GelGrapher"><a:themeElements>` +
      `<a:clrScheme name="GelGrapher"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F2A30"/></a:dk2><a:lt2><a:srgbClr val="EEF2F4"/></a:lt2><a:accent1><a:srgbClr val="176D7C"/></a:accent1><a:accent2><a:srgbClr val="B7791F"/></a:accent2><a:accent3><a:srgbClr val="2F855A"/></a:accent3><a:accent4><a:srgbClr val="6B7280"/></a:accent4><a:accent5><a:srgbClr val="9CA3AF"/></a:accent5><a:accent6><a:srgbClr val="4B5563"/></a:accent6><a:hlink><a:srgbClr val="176D7C"/></a:hlink><a:folHlink><a:srgbClr val="6B7280"/></a:folHlink></a:clrScheme>` +
      `<a:fontScheme name="GelGrapher"><a:majorFont><a:latin typeface="${esc(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="${esc(font)}"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
      `<a:fmtScheme name="GelGrapher"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
      `<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
      `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
      `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
    const master = X + `<p:sldMaster ${NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="1800"/></a:lvl1pPr></p:titleStyle><p:bodyStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:bodyStyle><p:otherStyle><a:lvl1pPr><a:defRPr sz="1200"/></a:lvl1pPr></p:otherStyle></p:txStyles></p:sldMaster>`;
    const layout = X + `<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
    const slide = X + `<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${shapes.join('')}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
    const presentation = X + `<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr></p:defaultTextStyle></p:presentation>`;
    const types = X + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
    const core = X + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${title}</dc:title><dc:subject>${subject}</dc:subject><dc:creator>${app}</dc:creator><cp:lastModifiedBy>${app}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    const appXml = X + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>${app}</Application><Slides>1</Slides></Properties>`;
    const files = [
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rels([['rId1', 'officeDocument/2006/relationships/officeDocument', 'ppt/presentation.xml'], ['rId2', 'package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', 'officeDocument/2006/relationships/extended-properties', 'docProps/app.xml']]) },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: appXml },
      { name: 'ppt/presentation.xml', data: presentation },
      { name: 'ppt/_rels/presentation.xml.rels', data: rels([['rId1', 'officeDocument/2006/relationships/slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'officeDocument/2006/relationships/slide', 'slides/slide1.xml'], ['rId3', 'officeDocument/2006/relationships/theme', 'theme/theme1.xml']]) },
      { name: 'ppt/slideMasters/slideMaster1.xml', data: master },
      { name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([['rId1', 'officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'officeDocument/2006/relationships/theme', '../theme/theme1.xml']]) },
      { name: 'ppt/slideLayouts/slideLayout1.xml', data: layout },
      { name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', data: rels([['rId1', 'officeDocument/2006/relationships/slideMaster', '../slideMasters/slideMaster1.xml']]) },
      { name: 'ppt/theme/theme1.xml', data: theme },
      { name: 'ppt/slides/slide1.xml', data: slide },
      { name: 'ppt/slides/_rels/slide1.xml.rels', data: rels([['rId1', 'officeDocument/2006/relationships/slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'officeDocument/2006/relationships/image', '../media/gel.png']]) },
      { name: 'ppt/media/gel.png', data: gelBytes || new Uint8Array(0) }
    ];
    const zip = await G.Zip.make(files);
    return { blob: new Blob([zip], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), shapes: shapes.length, pictures: nPics, slideW: vw, slideH: vh };
  }

  G.PPTX = { fromFigure };
})(window);

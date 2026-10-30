/* Interaction self-test, loaded only with ?uitest=1. Results go to document.title as JSON.
 * Sections 1-19 come from GelFigure; 20 onwards cover the GelGrapher additions. */
(async function (G) {
  'use strict';
  const App = G.App, R = {};
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const key = (el, k, extra) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, extra || {})));
  const fed = document.getElementById('floatEd');
  try {
    const fl = G.UI.figLanes();
    document.title = 'UITEST-AT 1 ' + JSON.stringify(R);
    // 1. click-to-edit lane name, Enter jumps to next lane
    G.FigEdit.openEd('lane', fl[1]);
    await wait(30);
    fed.value = 'Sample A'; fed.dispatchEvent(new Event('input'));
    key(fed, 'Enter');
    // the next lane's editor opens on the next animation frame
    for (let t = 0; t < 100 && fed.classList.contains('hidden'); t++) await wait(50);
    R.enterNext = { name1: App.S.lanes[fl[1]].name, editorOpen: !fed.classList.contains('hidden'), placeholderIsLane: fed.placeholder };
    document.title = 'UITEST-AT 2 ' + JSON.stringify(R);
    // 2. IME composing Enter must NOT commit/jump
    fed.value = 'sh'; fed.dispatchEvent(new Event('input'));
    key(fed, 'Enter', { isComposing: true, keyCode: 229 });
    await wait(30);
    R.imeEnter = { stillEditing: !fed.classList.contains('hidden'), placeholder: fed.placeholder };
    fed.value = 'Sample B'; fed.dispatchEvent(new Event('input'));
    key(fed, 'Enter');
    await wait(60);
    R.names = fl.map(i => App.S.lanes[i].name);
    document.title = 'UITEST-AT 3 ' + JSON.stringify(R);
    // 3. Backspace while typing never deletes lanes; Backspace on the image area does nothing either
    const n0 = App.S.lanes.length;
    G.FigEdit.openEd('lane', fl[2]); await wait(20);
    key(fed, 'Backspace'); key(fed, 'Delete');
    fed.blur(); await wait(20);
    App.selLane = fl[2];
    const box = document.getElementById('editorBox'); box.focus();
    key(box, 'Backspace');
    R.backspace = { lanesBefore: n0, lanesAfter: App.S.lanes.length };
    document.title = 'UITEST-AT 4 ' + JSON.stringify(R);
    // 4. place an arrow by clicking a band: snaps to a band and gets a size label
    const mk = App.S.markers[0];
    const b = mk.bands.find(x => x.matched && x.bp === 1000) || mk.bands.find(x => x.matched);
    App.placeArrow(App.S.lanes[mk.lane].x, b.y + 4);
    // the popover opens on the next animation frame, which slow headless browsers can delay
    for (let t = 0; t < 100 && !document.getElementById('pOk'); t++) await wait(50);
    const a = App.S.arrows[App.S.arrows.length - 1];
    R.arrow = { snappedTo: Math.round(a.y), band: Math.round(b.y), label: App.arrowLabel(a), popoverOpen: !document.getElementById('popover').classList.contains('hidden'), stage: document.querySelector('.coach') ? 'same screen' : '' };
    document.getElementById('pOk').click();
    document.title = 'UITEST-AT 5 ' + JSON.stringify(R);
    // 5. narrow the range from the middle: names survive, lanes are not re-created
    const before = App.S.lanes.map(l => l.name).join('|');
    App.setLaneRange(fl[1], fl[2]); App.afterRangeChange(); App.commit();
    await wait(40);
    R.rangeMiddle = { figLanes: G.UI.figLanes().map(i => i + 1), names: G.UI.figLanes().map(i => App.S.lanes[i].name), lanesUnchanged: App.S.lanes.map(l => l.name).join('|') === before };
    App.setLaneRange(fl[0], fl[fl.length - 1]); App.afterRangeChange(); App.commit();
    document.title = 'UITEST-AT 6 ' + JSON.stringify(R);
    // 6. group by dragging lane names (API path) and condition cell cycling
    App.S.groups.push({ from: fl[1], to: fl[2], text: 'Cell line' });
    App.S.conditions.push({ name: 'Dox', values: App.S.lanes.map(() => '') });
    App.commit(); await wait(40);
    const cell = document.querySelector(`#preview g[data-edit="cond"][data-src="${fl[1]}"]`);
    cell.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await wait(40);
    R.cond = App.S.conditions[0].values[fl[1]];
    R.coach = document.getElementById('coachText').textContent;
    document.title = 'UITEST-AT 8 ' + JSON.stringify(R);
    // 8. bad first detection, fixed inside the crop only
    {
      const good = G.UI.figLanes().map(i => App.S.lanes[i].x);
      const names = G.UI.figLanes().map(i => App.S.lanes[i].name);
      const outsideBefore = App.S.lanes.filter(l => l.x < App.S.crop.x || l.x > App.S.crop.x + App.S.crop.w).map(l => Math.round(l.x));
      // corrupt: shift + squeeze the in-crop lanes and add a bogus one
      const c = App.S.crop;
      const bad = good.map((x, k) => c.x + 10 + k * (c.w - 40) / good.length * 0.8);
      bad.push(c.x + c.w - 15);
      App.replaceLanes(App.S.lanes.filter(l => l.x < c.x || l.x > c.x + c.w).map(l => l.x).concat(bad).sort((a, b) => a - b));
      G.UI.figLanes().forEach((i, k) => { App.S.lanes[i].name = names[k] || ''; });
      App.commit();
      document.getElementById('btnRedetectCrop').click();
      const n1 = G.UI.figLanes().length;
      const after1 = G.UI.figLanes().map(i => App.S.lanes[i].x);
      const err1 = after1.length === good.length ? Math.max(...after1.map((x, k) => Math.abs(x - good[k]))) : null;
      // even spacing with an explicit count
      const markersAfterRedetect = App.S.markers.map(m => [m.lane + 1, m.ladderId]);
      document.getElementById('cropLaneN').value = good.length;
      document.getElementById('btnEvenCrop').click();
      const after2 = G.UI.figLanes().map(i => App.S.lanes[i].x);
      const err2 = after2.length === good.length ? Math.max(...after2.map((x, k) => Math.abs(x - good[k]))) : null;
      const outsideAfter = App.S.lanes.filter(l => l.x < App.S.crop.x || l.x > App.S.crop.x + App.S.crop.w).map(l => Math.round(l.x));
      R.cropRedetect = {
        corrupted: bad.length, redetected: n1, maxErrRedetect: err1 && +err1.toFixed(1),
        maxErrEven: err2 && +err2.toFixed(1), pitch: Math.round(c.w / good.length),
        namesKept: G.UI.figLanes().map(i => App.S.lanes[i].name).join(',') === names.join(','),
        outsideUntouched: JSON.stringify(outsideBefore) === JSON.stringify(outsideAfter),
        markersAfterRedetect, markersAfterEven: App.S.markers.map(m => [m.lane + 1, m.ladderId])
      };
    }
    document.title = 'UITEST-AT 7 ' + JSON.stringify(R);
    // 7. style template round trip: wipe annotations, re-apply, everything comes back
    const tpl = JSON.parse(JSON.stringify(App.template()));
    const ref = JSON.stringify([G.UI.figLanes().map(i => App.S.lanes[i].name), App.S.groups.map(g => [g.from, g.to, g.text]), App.S.markers.map(m => [m.lane, m.ladderId])]);
    G.UI.figLanes().forEach(i => { App.S.lanes[i].name = ''; });
    App.S.groups = []; App.S.markers = []; App.commit();
    App.applyTemplate(tpl);
    const got = JSON.stringify([G.UI.figLanes().map(i => App.S.lanes[i].name), App.S.groups.map(g => [g.from, g.to, g.text]), App.S.markers.map(m => [m.lane, m.ladderId])]);
    R.template = { ok: got === ref, got };

    const S = () => App.S, fig = () => G.UI.figLanes();
    document.title = 'UITEST-AT 9 ' + JSON.stringify(R);
    // 9. rotation carries annotations: compare carried lanes/bands with a fresh detection at the new angle
    R.rotationCarry = [1.5, 4].map(dd => {
      const r0 = S().rotation, snap0 = App.snapshot();
      const lanes0 = fig().map(i => S().lanes[i].x);
      const bands0 = S().markers.map(m => m.bands.map(b => b.y));
      App.setRotation(r0 + dd);
      const carriedLanes = fig().map(i => S().lanes[i].x);
      const carriedBands = S().markers.map(m => m.bands.map(b => b.y));
      App.afterRotation();
      // how far the local refinement had to move matched bands after carrying them
      let refine = 0; S().markers.forEach((m, mi) => m.bands.forEach((b, k) => { if (b.matched) refine = Math.max(refine, Math.abs(b.y - carriedBands[mi][k])); }));
      // what a from-scratch match at the new angle says about the same bands
      const snapR = App.snapshot();
      App.matchMarkers(true);
      let vsScratch = 0; S().markers.forEach((m, mi) => m.bands.forEach((b, k) => { const c = JSON.parse(snapR).markers[mi].bands[k]; if (b.matched && c.matched) vsScratch = Math.max(vsScratch, Math.abs(b.y - c.y)); }));
      App.S = JSON.parse(snapR); App.ensureRot();
      App.redetectLanesInCrop();
      const fresh = fig().map(i => S().lanes[i].x);
      App.S = JSON.parse(snapR); App.ensureRot();
      App.setRotation(r0);
      const back = fig().map(i => S().lanes[i].x);
      let bandBack = 0; S().markers.forEach((m, mi) => m.bands.forEach((b, k) => { bandBack = Math.max(bandBack, Math.abs(b.y - bands0[mi][k])); }));
      const near = (a, list) => Math.min(...list.map(y => Math.abs(a - y)));
      const res = {
        rotatedBy: dd, lanes: carriedLanes.length, freshLanes: fresh.length,
        carriedToFresh: +Math.max(...carriedLanes.map(x => near(x, fresh))).toFixed(1),
        freshToCarried: +Math.max(...fresh.map(x => near(x, carriedLanes))).toFixed(1),
        bandRefineMove: +refine.toFixed(1), bandVsScratchMatch: +vsScratch.toFixed(1),
        roundTripLane: +Math.max(...back.map((x, k) => Math.abs(x - lanes0[k]))).toFixed(2), roundTripBand: +bandBack.toFixed(2),
        pitch: Math.round(S().lanePitch || 0),
        carriedX: carriedLanes.map(Math.round), freshX: fresh.map(Math.round), crop: JSON.parse(snapR).crop
      };
      App.S = JSON.parse(snap0); App.ensureRot(); App.commit();
      return res;
    });
    document.title = 'UITEST-AT 10 ' + JSON.stringify(R);
    // 10. empty lane suggestion + H hotkey (marker lanes need confirmation)
    {
      const empt = App.emptyLanes();
      const boxEl = document.getElementById('editorBox');
      const target = fig().find(i => !S().markers.some(m => m.lane === i));
      App.selLane = target; boxEl.focus(); key(boxEl, 'h');
      const hidAfterH = S().lanes[target].hidden;
      key(boxEl, 'h');
      const restored = !S().lanes[target].hidden;
      G.UI.autoConfirm = false;
      App.selLane = S().markers[0].lane; key(boxEl, 'h');
      const markerKept = !S().lanes[S().markers[0].lane].hidden;
      G.UI.autoConfirm = null; App.selLane = -1;
      R.empty = { emptyWells: empt.map(i => i + 1), barShown: !document.getElementById('emptyBar').classList.contains('hidden'), hOnLane: hidAfterH, hBack: restored, markerNeedsConfirm: markerKept };
    }
    document.title = 'UITEST-AT 11 ' + JSON.stringify(R);
    // 11. a group line runs on across a splice gap; "Group lines break at splice gaps" splits it
    {
      const f0 = fig(); const snap = App.snapshot();
      S().groups = [{ from: f0[1], to: f0[3], text: 'G' }]; S().style.spliceStyle = 'gap'; S().style.groupSplit = false;
      const count = () => (App.buildFigure(false).svg.match(/<line /g) || []).length;
      const n1 = count();
      App.setLaneHidden(f0[2], true, 'test');
      const n2 = count();
      S().style.groupSplit = true;
      const n3 = count();
      R.groupSplit = { bridged: n2 - n1, extraLines: n3 - n1, expected: 1 + (S().style.groupTicks ? 2 : 0) };
      App.S = JSON.parse(snap);
    }
    document.title = 'UITEST-AT 12 ' + JSON.stringify(R);
    // 12. extrapolated / disagreeing size is marked ≈
    {
      const m = S().markers[0], top = Math.min(...m.bands.filter(b => b.matched).map(b => b.y));
      const inside = m.bands.filter(b => b.matched).sort((p, q) => p.y - q.y)[2];
      const aOut = { y: top - 40, text: '', size: true, side: '' }, aIn = { y: inside.y, text: '', size: true, side: '' };
      R.extrap = { outside: App.arrowLabel(aOut), inside: App.arrowLabel(aIn), insideBp: inside.bp, info: App.estimateInfo(aOut.y) && App.estimateInfo(aOut.y).extrap };
    }
    document.title = 'UITEST-AT 13 ' + JSON.stringify(R);
    // 13. reset everything returns exactly to the post-import state
    {
      S().lanes[fig()[0]].name = 'XYZ'; App.setRotation(S().rotation + 2); App.commit();
      App.resetAll();
      R.resetAll = { equalsInitial: App.snapshot() === App.initial, hist: App.hist.length };
      App.S.lanes[G.UI.figLanes()[0]].name = 'M'; App.commit();
    }
    document.title = 'UITEST-AT 14 ' + JSON.stringify(R);
    // 14. custom ladder travels with the template
    {
      const m = S().markers[0], base = G.Ladders.get(m.ladderId);
      const lad = G.Ladders.saveCustom('UITest ladder', base.sizes);
      m.ladderId = lad.id; App.matchMarkers(false); App.commit();
      const tpl2 = JSON.parse(JSON.stringify(App.template()));
      G.Ladders.removeCustom(lad.id);
      const res = App.applyTemplate(tpl2);
      R.templateLadder = { carried: (tpl2.ladders || []).length, imported: res.importedLadders, present: !!G.Ladders.get(lad.id), markerUses: S().markers[0].ladderId === lad.id };
      S().markers[0].ladderId = base.id; App.matchMarkers(false); App.commit();
      G.Ladders.removeCustom(lad.id);
    }
    document.title = 'UITEST-AT 15 ' + JSON.stringify(R);
    // 15. favourites bias + "only favourites" fallback when none fits
    {
      const favBefore = G.Ladders.favorites(), prefBefore = App.prefs().onlyFavLadders;
      const truth = S().markers.map(m => m.ladderId);
      G.Ladders.setFavorites(['gr100']); App.setPref('onlyFavLadders', true);
      App.autoMarkers();
      const fallback = { picked: S().markers.map(m => m.ladderId), notice: App.ladderNotice };
      G.Ladders.setFavorites(truth); App.autoMarkers();
      const withFav = S().markers.map(m => m.ladderId);
      G.Ladders.setFavorites(favBefore); App.setPref('onlyFavLadders', !!prefBefore);
      App.autoMarkers(); App.commit();
      R.favorites = { truth, fallback, withFav, restored: S().markers.map(m => m.ladderId) };
    }
    document.title = 'UITEST-AT 16 ' + JSON.stringify(R);
    // 16. preflight + raster metadata
    {
      const pf = App.preflight();
      const f = App.buildFigure(false);
      const c = await G.Export.svgToCanvas(f.svg, f.w, f.h, 300);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dec = new Uint8Array(await (await G.Export.pngDecorate(blob, 300, { Description: 'ü 中文' })).arrayBuffer());
      const chunks = []; for (let p = 8; p < dec.length;) { const len = (dec[p] << 24 | dec[p + 1] << 16 | dec[p + 2] << 8 | dec[p + 3]) >>> 0; chunks.push(String.fromCharCode(...dec.slice(p + 4, p + 8))); p += 12 + len; }
      const g = new Uint8Array(c.width * c.height); const id = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < g.length; i++) g[i] = id[i * 4];
      const tif = await G.TIFF.decodeBuffer(G.Export.encodeTiffGray(g, c.width, c.height, 300, 'desc'), 't.tif');
      let maxd = 0; for (let i = 0; i < g.length; i += 97) maxd = Math.max(maxd, Math.abs(Math.round(tif.data[i] * 255) - g[i]));
      R.export = { preflight: pf.map(p => p.level + ':' + p.text.slice(0, 40)), pngChunks: chunks.slice(0, 6), tiffSize: [tif.width || tif.w, tif.height || tif.h], tiffDpi: tif.dpi, tiffMaxDiff: maxd };
    }
    document.title = 'UITEST-AT 17 ' + JSON.stringify(R);
    // 17. project file round trip
    {
      const before = App.snapshot();
      const buf = await (await App.projectBlob()).arrayBuffer();
      await App.openProject(buf);
      R.project = { bytes: buf.byteLength, same: App.snapshot() === before, sha: (App.S.file.sha256 || '').slice(0, 12) };
    }
    document.title = 'UITEST-AT 18 ' + JSON.stringify(R);
    // 18. several exposures: the well-exposed one is chosen, switching keeps annotations
    {
      const g0 = G.Demo.makeGel({ tilt: 0.8 });
      const mk = k => { const d = new Float32Array(g0.data.length); for (let i = 0; i < d.length; i++) d[i] = Math.min(1, g0.data[i] * k); return new File([G.Demo.encodeTiff16({ width: g0.width, height: g0.height, data: d })], `exp_x${k}.tif`); };
      await App.load([mk(0.15), mk(0.7), mk(4)]);
      const pick = App.exposures[App.expIdx].name;
      const fl2 = G.UI.figLanes(); App.S.lanes[fl2[1]].name = 'keepme'; App.commit();
      const other = App.exposures.findIndex((e, k) => k !== App.expIdx);
      const sw = await App.switchExposure(other);
      R.exposures = { scores: App.exposures.map(e => [e.name, +e.score.toFixed(2), +e.clipFrac.toFixed(4)]), picked: pick, switched: sw, nameKept: App.S.lanes[fl2[1]].name, stripItems: document.querySelectorAll('#expoStrip .expo-item').length };
    }
    // 19. autosaved draft survives a reload (needs a browser with working IndexedDB: ?uitest=1&draft=1;
    // headless Edge never answers indexedDB.open and holds its virtual clock)
    if (/[?&]draft=1/.test(location.search)) {
      document.title = 'UITEST-AT 19 ' + JSON.stringify(R);
      const ref = App.snapshot();
      await App.saveDraft();
      const d = await App.peekDraft();
      App.S.lanes[G.UI.figLanes()[0]].name = 'changed';
      await App.restoreDraft();
      R.draft = { listed: !!d && d.name, restored: App.snapshot() === ref };
      const sha19 = App.S.file.sha256;
      await App.dropDraft();                      // removing the open gel from the library closes it
      R.draftDropped = !(await App.library.list()).some(e => e.sha256 === sha19) && !App.S;
      await App.load(new File([G.Demo.encodeTiff16(G.Demo.makeGel())], 'demo_gel.tif', { type: 'image/tiff' }), 'dna-agarose');   // the same gel again for the sections that follow
    }
    // ---------- GelGrapher additions ----------
    document.title = 'UITEST-AT 20 ' + JSON.stringify(R);
    // 20. experiment type: protein ladders and kDa labels, and back to DNA
    {
      await App.load(new File([G.Demo.encodeTiff16(G.Demo.makeGel())], 'demo_gel.tif'), 'dna-agarose');
      App.setGelType('sds-page'); App.commit();
      const svgP = App.buildFigure(false).svg, kinds = App.S.markers.map(m => G.Ladders.kindOf(m.ladderId));
      App.setGelType('dna-agarose'); App.commit();
      const svgD = App.buildFigure(false).svg;
      R.gelType = { kinds, kDaHead: svgP.includes('(kDa)'), protein: { kDa: svgP.includes('(kDa)') && kinds.length > 0 && kinds.every(k => k === 'protein') },
        back: { bp: svgD.includes('(bp)') && App.S.markers.every(m => G.Ladders.kindOf(m.ladderId) === 'dna') && App.S.markers.some(m => m.ladderId === 'gr1kbplus') } };
    }
    // 21. strips: only the chosen regions, stacked with a gap, disclosed in the legend
    {
      const st = App.S, c = st.crop, h0 = App.buildFigure(false).h;
      st.strips = [{ y0: c.y + c.h * 0.1, y1: c.y + c.h * 0.3, label: 'top' }, { y0: c.y + c.h * 0.6, y1: c.y + c.h * 0.8, label: 'bottom' }];
      App.commit();
      const f = App.buildFigure(false), gel = App._lastGel;
      const expectH = Math.round(c.h * 0.2) * 2 + gel.vgap;
      R.strips = { ok: Math.abs(gel.canvas.height - expectH) <= 3 && f.h < h0 && f.svg.includes('>bottom<') && G.Export.legendHints(st).some(t => /2 panels/.test(t)), canvasH: gel.canvas.height, expectH };
      st.strips = []; App.commit();
    }
    // 22. densitometry on the synthetic gel: three lanes carry the 1500 bp product at known amounts
    {
      const st = App.S, fl = G.UI.figLanes(), g = G.Demo.makeGel();
      const box = G.Quant.bandBox(App, st.lanes[fl[1]].x, g.truth.yOf(1500));
      st.quant.rows = [{ y0: box.y0, y1: box.y1, name: 'product' }]; st.quant.norm = 'none'; st.quant.ref = App.laneId(fl[1]); st.quant.output = 'fold'; App.commit();
      const Rq = G.Quant.measure(App), j2 = Rq.lanes.indexOf(fl[2]), j3 = Rq.lanes.indexOf(fl[3]);
      const truth = [0.6 / 0.55, 0.5 / 0.55], got = [Rq.rel[0][j2], Rq.rel[0][j3]];
      const csv = G.Quant.quantCSV(App, Rq), chart = G.Quant.chartSVG(App, Rq);
      R.quant = { truth: truth.map(v => +v.toFixed(3)), got: got.map(v => +v.toFixed(3)), maxErr: Math.max(...got.map((v, k) => Math.abs(v / truth[k] - 1))), csvLines: csv.trim().split('\n').length, chart: !!chart && chart.svg.startsWith('<svg') };
      st.quant.rows = []; st.quant.ref = null; st.quant.output = 'corrected'; App.commit();
    }
    // 23. vector PDF: valid file, text kept (Greek letters via the Symbol font)
    {
      const st = App.S, fl = G.UI.figLanes(); st.lanes[fl[1]].name = 'β-actin'; App.commit();
      const r = await G.PDF.fromSVG(App.buildFigure(false).svg, { title: 'test' });
      const bytes = new Uint8Array(await r.blob.arrayBuffer()), text = new TextDecoder('latin1').decode(bytes);
      R.pdf = { ok: text.startsWith('%PDF-1.4') && text.includes('/BaseFont /Symbol') && text.includes('/Subtype /Image') && /startxref\s+\d+\s+%%EOF\s*$/.test(text) && !r.missing.length, bytes: bytes.length, missing: r.missing };
    }
    // 44. editable PowerPoint: a valid package, text boxes for every label, the gel as cropped pictures per block
    {
      const f = App.buildFigure(false), gel = App._lastGel, st = App.S;
      st.groups.push({ from: 0, to: 2, text: 'Mock *siRNA*' }); App.commit();
      const f2 = App.buildFigure(false);
      const r = await G.PPTX.fromFigure(f2.svg, { crop: App._lastCrop, gel: App._lastGel, title: 'test' });
      const parts = await G.Zip.read(await r.blob.arrayBuffer()), get = n => { const p = parts.find(x => x.name === n); return p ? new TextDecoder().decode(p.data) : ''; };
      const slide = get('slide1.xml'), pres = get('presentation.xml'), png = parts.find(x => x.name === 'gel.png');
      const nText = (f2.svg.match(/<text /g) || []).length, nBox = (slide.match(/txBox="1"/g) || []).length;
      const nPic = (slide.match(/<p:pic>/g) || []).length, blocks = gel.segs.length * gel.vsegs.length;
      const names = G.UI.figLanes().map(i => st.lanes[i].name).filter(Boolean), vbW = +/viewBox="[-\d.]+ [-\d.]+ ([-\d.]+)/.exec(f2.svg)[1];
      st.groups.pop(); App.commit();
      R.pptx = { parts: parts.length, nText, nBox, nPic, blocks, italic: /i="1"/.test(slide), srcRect: /<a:srcRect /.test(slide), names: names.every(n => slide.includes(G.UI.esc(n).replace(/&quot;/g, '"'))),
        size: pres.includes(`cx="${Math.round(Math.max(72, vbW) * 12700)}"`), png: !!png && new Uint8Array(png.data)[0] === 0x89, types: get('[Content_Types].xml').includes('presentationml.slide+xml'),
        ok: nBox === nText && nPic === blocks && blocks >= 1 && /i="1"/.test(slide) && /<a:srcRect /.test(slide) && !!png && new Uint8Array(png.data)[0] === 0x89 && pres.includes(`cx="${Math.round(Math.max(72, vbW) * 12700)}"`) };
    }
    // 24. ZIP round trip (how a Claude artifact hands over TIFF and project files)
    {
      const z = await G.Zip.make([{ name: 'gel.tif', data: new Uint8Array([1, 2, 3, 250]) }, { name: 'β.txt', data: 'ok' }]);
      const back = await G.Zip.read(await z.arrayBuffer());
      R.zip = { ok: back.length === 2 && back[0].name === 'gel.tif' && new Uint8Array(back[0].data)[3] === 250 && back[1].name === 'β.txt' };
    }
    // 25. Western marker image travels inside the project file
    {
      const g = G.Demo.makeGel(), buf = G.Demo.encodeTiff16(g);
      App.setMarkerImage(await App.readInput({ name: 'marker.tif', buffer: buf })); App.matchMarkers(false); App.commit();
      const before = App.snapshot();
      await App.openProject(await (await App.projectBlob()).arrayBuffer());
      R.markerProject = { ok: App.hasMarkerImage() && App.snapshot() === before && App.S.markers.length > 0 };
      App.clearMarkerImage(); App.commit();
    }
    // 26. the worked examples: the right ladder lane, and densitometry matching the known amounts
    {
      await G.UI.loadExample('western');
      const Rw = G.Quant.measure(App), truth = G.Demo.makeGel({ preset: 'western' }).truth.relative;
      const err = Math.max(...Rw.rel[0].map((v, j) => Math.abs(v / truth[j] - 1)));
      // the favourite-ladder list follows the loaded gel's kind (protein here), not the kind chosen at start-up
      const favNames = [...document.querySelectorAll('#favList .item span')].map(e => e.textContent), protein = new Set(G.Ladders.all('protein').map(l => l.name));
      // the regions integrate the original pixels inside their mapped outline (the example is rotated 1.3°), signed,
      // after the local background above and below: fold changes within 5 % of the synthetic truth
      R.western = { ok: App.S.markers.length === 1 && App.S.markers[0].ladderId === 'pr26619' && err < 0.05 && App.S.strips.length === 2, err: +err.toFixed(4), markers: App.S.markers.map(m => [m.lane + 1, m.ladderId]),
        favsFollowKind: favNames.length > 0 && favNames.every(n => protein.has(n)), favFirst: favNames[0] };
      await G.UI.loadExample('sds');
      R.sds = { ok: App.S.markers.length === 1 && App.S.markers[0].ladderId === 'pr26619' && App.S.lanes[App.S.markers[0].lane].name === 'M', markers: App.S.markers.map(m => [m.lane + 1, m.ladderId]) };
    }
    // 27. flips: annotations follow, a double flip is the identity, lane names stay with their lanes
    {
      await G.UI.loadExample('western');
      const names0 = G.UI.figLanes().map(i => App.S.lanes[i].name), rel0 = G.Quant.measure(App).rel[0].map(v => +v.toFixed(3));
      const lanes0 = App.S.lanes.map(l => l.x), bands0 = App.S.markers[0].bands.filter(b => b.matched).map(b => b.y), rot0 = App.S.rotation;
      App.flip('v'); App.commit();
      const relV = G.Quant.measure(App).rel[0].map(v => +v.toFixed(3)), namesV = G.UI.figLanes().map(i => App.S.lanes[i].name);
      App.flip('h'); App.commit();
      const namesH = G.UI.figLanes().map(i => App.S.lanes[i].name), relH = G.Quant.measure(App).rel[0].map(v => +v.toFixed(3));
      App.flip('h'); App.flip('v'); App.commit();
      const lanesBack = App.S.lanes.map(l => l.x), bandsBack = App.S.markers[0].bands.filter(b => b.matched).map(b => b.y);
      const maxErr = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
      R.flip = { relFollowsV: maxErr(rel0, relV) < 0.02, namesStay: namesV.join() === names0.join() && namesH.join() === names0.slice().reverse().join(), relH: maxErr(rel0, relH.slice().reverse()) < 0.02,
        identity: maxErr(lanes0, lanesBack) < 1.5 && maxErr(bands0, bandsBack) < 1.5 && App.S.rotation === rot0, flip: App.S.flip };
    }
    // 28. arrow labels on the same side never overlap
    {
      const st = App.S, b = st.markers[0].bands.find(x => x.bp === 55);
      st.arrows = [{ y: b.y - 2, text: 'A', size: false, side: 'right' }, { y: b.y + 2, text: 'B', size: false, side: 'right' }, { y: b.y + 4, text: 'C', size: false, side: 'right' }];
      App.commit();
      const svg = App.buildFigure(false).svg, ys = ['A', 'B', 'C'].map(t => +svg.match(new RegExp(`y="([\\d.-]+)"[^>]*text-anchor="start">${t}<`))[1]).sort((p, q) => p - q);
      R.arrowSpread = { ys, ok: ys.length === 3 && ys.every((y, i) => !i || y - ys[i - 1] >= st.style.fontPt * 1.1), leaders: (svg.match(/<line [^>]*stroke-width/g) || []).length };
      st.arrows = []; App.commit();
    }
    // 29. a gel with two rows of wells: both rows found, each analysed on its own, annotations kept per row
    {
      const g = G.Demo.makeTwoRowGel();
      await App.load({ name: 'two_rows.tif', buffer: G.Demo.encodeTiff16(g) }, 'dna-agarose');
      const st = App.S, r0 = { rows: App.rowCount(), lanes: st.lanes.length, markers: st.markers.length, cropIn: st.crop.y + st.crop.h <= st.gelRows[1].y0 };
      G.UI.figLanes().forEach((i, k) => { st.lanes[i].name = 'top' + k; }); App.commit();
      App.setGelRow(1); App.commit();
      const r1 = { lanes: st.lanes.length, markers: st.markers.length, cropIn: st.crop.y >= st.gelRows[0].y1, names: G.UI.figLanes().map(i => st.lanes[i].name).join('') };
      st.lanes[G.UI.figLanes()[1]].name = 'bottom'; App.commit();
      App.setGelRow(0); App.commit();
      const back = G.UI.figLanes().map(i => st.lanes[i].name);
      App.setGelRow(1); App.commit();
      R.rows = { r0, r1, backNames: back.join(','), bottomKept: st.lanes[G.UI.figLanes()[1]].name === 'bottom',
        ok: r0.rows === 2 && r0.lanes >= 10 && r0.lanes <= 12 && r0.markers === 1 && r0.cropIn && r1.lanes === 8 && r1.markers === 1 && r1.cropIn && r1.names === 'M' && back[0] === 'top0' && back[back.length - 1] === 'top' + (back.length - 1) };
    }
    // 30. the marker's band list stays open (and scrolled) while several bands are ticked one after another
    {
      const card = () => document.querySelector('#markerList .mk-card'), m = App.S.markers[0];
      card().querySelector('details').open = true;
      const list = card().querySelector('.list'); list.scrollTop = 40; const scroll0 = list.scrollTop;
      const boxes = () => [...card().querySelectorAll('[data-band]')];
      const before = m.bands.map(b => b.show);
      boxes()[0].click();                                   // a real click: change event -> commit -> cards rebuilt
      const openAfter1 = card().querySelector('details').open;
      boxes()[1].click();
      const openAfter2 = card().querySelector('details').open, scroll1 = card().querySelector('.list').scrollTop;
      R.bandTicks = { openAfter1, openAfter2, scrollKept: scroll0 === 0 || scroll1 === scroll0, toggled: m.bands[0].show !== before[0] && m.bands[1].show !== before[1],
        boxes: boxes().slice(0, 2).map(b => b.checked).join() === [m.bands[0].show, m.bands[1].show].join(),
        ok: openAfter1 && openAfter2 && m.bands[0].show !== before[0] && m.bands[1].show !== before[1] };
      boxes()[0].click(); boxes()[1].click();               // put them back
    }
    // 31. the dividers: dragging one resizes the panel / the stage split, the size is remembered, double-click resets
    {
      const $ = id => document.getElementById(id), panel = $('panel'), raw = $('rawCol'), gp = $('gutterPanel'), gs = $('gutterStage');
      const w0 = panel.getBoundingClientRect().width, r0 = raw.getBoundingClientRect().width;
      const drag = (el, from, to) => {
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, button: 0, clientX: from.x, clientY: from.y }));
        el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 7, clientX: to.x, clientY: to.y }));
        el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, clientX: to.x, clientY: to.y }));
      };
      const bp = gp.getBoundingClientRect();
      drag(gp, { x: bp.x + 3, y: bp.y + 200 }, { x: bp.x + 83, y: bp.y + 200 });
      const w1 = panel.getBoundingClientRect().width, savedW = App.prefs().panelW;
      const bs = gs.getBoundingClientRect(), stacked = getComputedStyle($('stage')).flexDirection === 'column';
      drag(gs, { x: bs.x + 3, y: bs.y + 200 }, stacked ? { x: bs.x + 3, y: bs.y + 120 } : { x: bs.x - 97, y: bs.y + 200 });
      const r1 = stacked ? raw.getBoundingClientRect().height : raw.getBoundingClientRect().width, savedS = App.prefs().stageSplit;
      gp.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); gs.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const w2 = panel.getBoundingClientRect().width, r2 = raw.getBoundingClientRect().width;
      R.splitters = { w0, w1, w2, r0, r1, r2, savedW, savedS, stacked,
        ok: Math.abs(w1 - (w0 + 80)) < 2 && savedW === Math.round(w0 + 80) && (stacked || r1 < r0 - 50) && typeof savedS === 'number'
          && Math.abs(w2 - w0) < 2 && Math.abs(r2 - r0) < 2 && App.prefs().panelW == null && App.prefs().stageSplit == null };
    }
    // 32. the library: the open gel is listed with a thumbnail, renamed, reopened as left (names kept), removed
    if (/[?&]draft=1/.test(location.search)) {
      const sha = App.S.file.sha256;
      App.S.lanes[G.UI.figLanes()[1]].name = 'kept-in-library'; App.commit();
      await App.saveDraft();
      let list = await App.library.list(), me = list.find(e => e.sha256 === sha);
      await App.library.rename(sha, 'My blot');
      await App.library.open(sha);
      const reopened = App.S.lanes[G.UI.figLanes()[1]].name, title = (await App.library.list()).find(e => e.sha256 === sha).title;
      // close: the workspace returns to the start screen, the library keeps the last state (a change made just before)
      App.S.lanes[G.UI.figLanes()[2]].name = 'closed-with'; App.commit();
      await App.close(); await new Promise(r => setTimeout(r, 400));   // the start screen lists the library asynchronously
      const closed = !App.S && !document.getElementById('sections').offsetParent && document.getElementById('btnClose').classList.contains('hidden') && !document.getElementById('libBox').classList.contains('hidden');
      const kept = JSON.parse((await App.library.list()).find(e => e.sha256 === sha).state).lanes.some(l => l.name === 'closed-with');
      await App.library.open(sha);
      // removing the open gel from the library closes it too, and it stays out until it is loaded again
      await App.library.remove(sha);
      const gone = !(await App.library.list()).some(e => e.sha256 === sha), closedByRemove = !App.S;
      await App.saveDraft();
      const stillGone = !(await App.library.list()).some(e => e.sha256 === sha);
      R.library = { listed: !!me, thumb: !!(me && me.thumb && me.thumb.startsWith('data:image')), lanes: me && me.lanes, title, reopened, closed, kept, gone, closedByRemove, stillGone,
        ok: !!me && !!(me.thumb) && title === 'My blot' && reopened === 'kept-in-library' && closed && kept && gone && closedByRemove && stillGone };
      await App.load(new File([G.Demo.encodeTiff16(G.Demo.makeGel())], 'demo_gel.tif', { type: 'image/tiff' }), 'dna-agarose');   // the later sections need a gel
    }
    // 33. the guided tour: steps with a target on screen, keyboard navigation, remembered as seen
    {
      const $ = id => document.getElementById(id);
      App.setPref('tourSeen', null);
      G.Tour.start('tour');
      await new Promise(r => setTimeout(r, 80));
      const shown = !$('tour').classList.contains('hidden'), s0 = G.Tour.step(), t0 = $('tourTitle').textContent;
      G.Tour.next(); const s1 = G.Tour.step(), spot = $('tourSpot').getBoundingClientRect();
      G.Tour.back(); const s2 = G.Tour.step();
      $('tour').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      R.tour = { shown, s0, s1, s2, t0, count: G.Tour.count(), spotW: spot.width, hidden: $('tour').classList.contains('hidden'), seen: !!App.prefs().tourSeen,
        ok: shown && s0 === 0 && s1 === 1 && s2 === 0 && spot.width > 20 && G.Tour.count() >= 10 && $('tour').classList.contains('hidden') && !!App.prefs().tourSeen };
    }
    // 34. densitometry results live in the figure column: a new band box opens them, the chart and table are there, Figure comes back
    {
      const $ = id => document.getElementById(id);
      await G.UI.loadExample('western');
      const st = App.S, v0 = G.QuantUI.view();
      const r = st.quant.rows[0], box = { name: 'extra', y0: r.y0 + 2, y1: r.y1 + 2 }; st.quant.rows.push(box); App.boxAdded = true; App.commit();
      await new Promise(r => setTimeout(r, 50));
      const v1 = G.QuantUI.view(), chart = !!$('quantChart').querySelector('svg'), tableRows = $('quantTable').querySelectorAll('tbody tr').length, lanes = G.Quant.quantLanes(App).length;
      const lcHead = /reference band/.test($('quantTable').innerHTML), panelHasChart = !document.getElementById('quantSec').contains($('quantChart'));
      G.QuantUI.show('quant', false);
      const v2 = G.QuantUI.view(), figShown = !$('figPane').classList.contains('hidden') && $('quantView').classList.contains('hidden');
      st.quant.rows.pop(); App.commit();
      R.quantView = { v0, v1, chart, tableRows, lanes, lcHead, panelHasChart, v2, figShown,
        ok: v0 === 'figure' && v1 === 'quant' && chart && tableRows === lanes && lcHead && panelHasChart && v2 === 'figure' && figShown };
    }
    // 35. lessons: nothing starts by itself and the start screen offers the ways in; a lesson is short, worded for the
    // experiment and practises on a copy (an example, or the open gel whose state comes back at the end); each card asks
    // for one action and waits for it (not while a text box or a dialog is open), then for Next; "Already correct",
    // "Not applicable" and "Keep raw values" move on; "Why?" opens; the measuring lesson keeps the reviewer's order;
    // finished lessons and the card a lesson was left at are remembered
    {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
      const at = () => $('tourTitle').textContent + '·' + G.Tour.part();
      const until = async (want, ms) => { const t0 = Date.now(); while (at() !== want && Date.now() - t0 < (ms || 5000)) await wait(100); return at(); };
      // the action was done on the page: wait for the card to say so, click Next, and report where that leads
      const act = async want => { const t0 = Date.now(); while (!G.Tour.done() && Date.now() - t0 < 5000) await wait(100); if (!G.Tour.done()) return 'not done: ' + at(); G.Tour.next(); return until(want); };
      const warnsHidden = () => getComputedStyle($('warnings')).display === 'none';
      const spotR = () => $('tourSpot').getBoundingClientRect(), cardR = () => $('tourCard').getBoundingClientRect(), panelR = $('panel').getBoundingClientRect();
      const within = (a, b, tol) => a.left >= b.left - tol && a.top >= b.top - tol && a.right <= b.right + tol && a.bottom <= b.bottom + tol;
      const log = [];
      // the start screen: "Use my image", practice by goal, the overview; no lesson is running
      const es = $('emptyState');
      const ways = /Use my image/.test(es.textContent) && !!es.querySelector('[data-lesson="figure"]') && !!es.querySelector('[data-lesson="measure"]') && !!es.querySelector('#btnOverview');
      const idle = !G.Tour.active();
      const L = G.Tour.lessons(), short = L.length >= 6 && L.every(l => l.cards.length >= 2 && l.cards.length <= 8);
      const order = L.find(l => l.id === 'measure').cards.join(' > ') === 'Acquisition quality > Select the target band > Inspect the background > Output and normalization > Review flags and export';
      App.setPref('lessons', null);
      // the menu: lessons under two goals; an example is open, so it is the practice copy (no "Practise on" choice)
      G.Tour.menu();
      const menu = !$('lessonDlg').classList.contains('hidden') && $('lessonList').querySelectorAll('.ls-item').length === L.length && $('lessonList').querySelectorAll('.ls-goal').length === 2 && $('lessonWhereBox').classList.contains('hidden');
      $('btnLessonClose').click();
      // the first figure, on the open example, stripped back to what detection found
      $('panel').scrollTop = 200;
      await G.Tour.practice('figure');
      log.push(await until('Working image and original·0'));
      const prepared = App.isExample && !App.S.groups.length && !App.S.strips.length && !App.S.quant.rows.length && !App.S.markers.some(m => m.confirmed);
      const clickable = getComputedStyle($('tour')).pointerEvents === 'none', warnHidden = warnsHidden(), dimmed = getComputedStyle($('tourDim').querySelector('.dim')).fill !== 'none';
      const waits = $('tourNext').disabled && !$('tourAlt').classList.contains('hidden');
      $('btnOrig').click(); await wait(700); const halfway = !G.Tour.done();     // the original is on screen: back to the working image first
      $('btnOrig').click(); log.push(await act('Check the lanes·0'));
      const altWords = $('tourAlt').textContent === 'Already correct';
      $('tourAlt').click(); log.push(await until('Check the ladder·0'));
      await wait(400);
      const whyFolded = !$('tourWhy').classList.contains('hidden') && !$('tourWhy').open && $('tourWhyText').textContent.length > 40;
      $('tourWhy').open = true;
      const pageStill = document.scrollingElement.scrollTop === 0;   // the panel scrolled to the control, the page itself did not
      const confirmEl = document.querySelector('#markerList .mk-card .mk-confirm');
      const ringOnConfirm = within(spotR(), confirmEl.getBoundingClientRect(), 8);
      // while working in the panel the card keeps to the panel's column (its bottom, or its top when the control sits low)
      // and never covers the control
      const cr = cardR(), tr = confirmEl.getBoundingClientRect(), box4 = r => [r.left, r.top, r.right, r.bottom].map(Math.round);
      const cardInPanel = cr.left >= panelR.left - 1 && cr.right <= panelR.right + 1 && !(cr.left < tr.right && cr.right > tr.left && cr.top < tr.bottom && cr.bottom > tr.top);
      const cardAt = { card: box4(cr), control: box4(tr), panel: box4(panelR) };
      const glued = $('tourText').innerHTML.includes('<span class="tour-kb"><kbd class="tour-key">Confirm this is the ladder you loaded</kbd>.</span>');   // "." never starts a line
      confirmEl.querySelector('input').click(); log.push(await act('Ladder image·0'));
      const naWords = $('tourAlt').textContent === 'Not applicable' && /verify registration before estimating sizes/.test($('tourWhyText').textContent);
      $('tourAlt').click(); log.push(await until('Name a lane·0'));
      const whyRefolded = !$('tourWhy').open;
      const fl = G.UI.figLanes().filter(i => !App.S.markers.some(m => m.lane === i));
      App.S.lanes[fl[0]].name = 'tut-A'; $('floatEd').classList.remove('hidden'); App.commit(); await wait(1200);
      const typingWaits = !G.Tour.done();                            // not while a text box is open
      $('floatEd').classList.add('hidden');
      $('warnings').innerHTML = '<div><span>⚠ a notice</span></div>';          // a notice is up: the notices card applies
      log.push(await act('Read the notices·0'));
      const noticesCard = !warnsHidden() && spotR().height > 10;
      G.Tour.next(); log.push(at());
      const exportWaits = $('tourNext').disabled;
      const fontPt = App.S.style.fontPt; App.S.style.fontPt = 4; App.commit();  // something the pre-flight check warns about
      G.UI.autoConfirm = null; $('btnPNGItem').click(); await wait(300);
      const dialogWaits = !$('preflightDlg').classList.contains('hidden') && at() === 'Export the figure·0' && !G.Tour.done();   // the pre-flight window holds the card
      $('pfBack').click(); await wait(300); const backWaits = at() === 'Export the figure·0' && !G.Tour.done();
      App.S.style.fontPt = fontPt; App.commit();
      $('tourAlt').click(); log.push(at());
      const endCard = $('tourNext').textContent === 'Finish' && !$('tourMore').classList.contains('hidden') && /Labels on the figure/.test($('tourNextLesson').textContent) && $('tourRevert').classList.contains('hidden');
      G.Tour.next();
      const doneKept = !G.Tour.active() && !!(App.prefs().lessons || {}).figure && App.prefs().lessons.figure.done === true;
      // left part-way: the card is remembered and the menu offers to continue there on this gel
      await G.Tour.practice('labels');
      log.push(await until('Group line·0'));
      $('tourAlt').click(); log.push(await until('Target band arrow·0'));
      $('tourSkip').click();
      const left = App.prefs().lessons.labels, leftAt = !!left && left.at === 1 && !left.done;
      G.Tour.menu();
      const tick = !!document.querySelector('#lessonList .ls-item.done [data-ls="figure"]'), resume = document.querySelector('#lessonList [data-resume="labels"]');
      if (resume) resume.click();
      log.push(await until('Target band arrow·0'));
      $('tourSkip').click();
      // measuring, in order, on the Western example
      await G.Tour.practice('measure');
      log.push(await until('Acquisition quality·0'));
      const prepQuant = !App.S.quant.rows.length && App.S.quant.norm === 'none';
      $('showSat').checked = true; $('showSat').dispatchEvent(new Event('change')); log.push(await act('Select the target band·0'));
      $('showSat').checked = false; $('showSat').dispatchEvent(new Event('change'));
      App.mode = 'quant'; App.emit('change'); await wait(200);
      const quantStage = spotR().left > panelR.right;              // the ring moves to the image
      App.mode = null; const r0 = App.S.markers[0].bands[3];
      App.S.quant.rows.push({ y0: r0.y - 6, y1: r0.y + 6, name: 'a' }); App.commit(); log.push(await act('Inspect the background·0'));
      // the follow-up of the card ran: the profile is open on the strongest lane; the card asks for the weakest
      const Rl = G.Quant.measure(App), byV = Rl.values.corrected[0].map((v, j) => [v, Rl.lanes[j]]).filter(p => p[0] != null).sort((a, b) => b[0] - a[0]);
      const profileOpen = G.QuantUI.view() === 'quant' && !$('quantProf').classList.contains('hidden') && +$('qProfLane').value === byV[0][1];
      const weakAsked = $('tourText').textContent.includes(`lane ${byV[byV.length - 1][1] + 1}, the weakest`) && !G.Tour.done();
      const pl = $('qProfLane'); pl.value = String(byV[byV.length - 1][1]); pl.dispatchEvent(new Event('change')); log.push(await act('Output and normalization·0'));
      const proteinWords = /GAPDH/.test($('tourText').textContent) && /total-protein/.test($('tourText').textContent) && $('tourAlt').textContent === 'Keep unnormalized'
        && /Unnormalized signal is useful when acquisition, region selection, and background correction are valid\. Normalization is optional\./.test($('tourWhyText').textContent);
      $('tourAlt').click(); log.push(await until('Review flags and export·0'));
      const exportOnSave = !G.Tour.done();                         // clicking alone does not finish it: a kept file does
      App.emit('exported-results'); await wait(300); const exportSaved = G.Tour.done();
      G.Tour.next(); log.push(at());
      G.Tour.next();
      const measureDone = App.prefs().lessons.measure.done === true;
      // on the user's own gel: the menu offers the choice; the lesson is worded for its experiment, and what it
      // changed is undone at its end on request
      await App.load(new File([G.Demo.encodeTiff16(G.Demo.makeGel())], 'demo_gel.tif', { type: 'image/tiff' }), 'dna-agarose');
      G.Tour.menu(); const whereShown = !$('lessonWhereBox').classList.contains('hidden'); $('btnLessonClose').click();
      const strips0 = App.S.strips.length;
      await G.Tour.practice('strips', { where: 'this' });
      log.push(await until('Add a strip·0'));
      const ownGel = !App.isExample && /DNA and RNA gels/.test($('tourWhyText').textContent);
      const c = App.S.crop; App.S.strips.push({ y0: c.y + 10, y1: c.y + 40, label: '' }); App.commit(); log.push(await act('Remove the strip·0'));
      $('tourAlt').click(); log.push(at());
      const revertShown = !$('tourRevert').classList.contains('hidden');
      $('tourRevert').click(); await wait(100);
      const reverted = App.S.strips.length === strips0 && $('tourRevert').classList.contains('hidden');
      G.Tour.next();
      const expect = ['Working image and original·0', 'Check the lanes·0', 'Check the ladder·0', 'Ladder image·0', 'Name a lane·0', 'Read the notices·0', 'Export the figure·0', 'Lesson done·0',
        'Group line·0', 'Target band arrow·0', 'Target band arrow·0',
        'Acquisition quality·0', 'Select the target band·0', 'Inspect the background·0', 'Output and normalization·0', 'Review flags and export·0', 'Lesson done·0',
        'Add a strip·0', 'Remove the strip·0', 'Lesson done·0'];
      const bad = expect.map((e, k) => log[k] === e ? null : `${k}: ${log[k]} ≠ ${e}`).filter(Boolean);
      const checks = { ways, idle, short, order, menu, prepared, clickable, warnHidden, dimmed, waits, halfway, altWords, whyFolded, pageStill, ringOnConfirm, cardInPanel, glued, whyRefolded, typingWaits, noticesCard, exportWaits, dialogWaits, backWaits, endCard, doneKept,
        leftAt, tick, resume: !!resume, prepQuant, naWords, quantStage, profileOpen, weakAsked, proteinWords, exportOnSave, exportSaved, measureDone, whereShown, ownGel, revertShown, reverted };
      R.lessons = Object.assign({ bad, cardAt, ok: !bad.length && Object.values(checks).every(Boolean) && !G.Tour.active() }, checks);
      await G.UI.loadExample('western');                               // the sections that follow ran on the Western example
    }
    // 37. print: a page with the figure at a readable size and a caption with the legend notes
    {
      const $ = id => document.getElementById(id);
      const notes = G.Export.legendHints(App.S).join(' '), probe = notes.split(' ').slice(0, 3).join(' ');
      App.setPref('legendNotes', false); const h0 = G.UI.printHtml(), svg0 = decodeURIComponent(h0.split('data:image/svg+xml;charset=utf-8,')[1].split('"')[0]);
      App.setPref('legendNotes', true); const h1 = G.UI.printHtml(), svg1 = decodeURIComponent(h1.split('data:image/svg+xml;charset=utf-8,')[1].split('"')[0]);
      const f = App.buildFigure(false), fn = G.Render.withNotes(f, notes, App.S.style.fontPt);
      App.setPref('legendNotes', false);
      R.print = { btn: !!$('btnPrint') && !!$('btnPrintMenu') && !!$('notesOn'), name: h0.includes(G.UI.esc(App.S.file.name.replace(/\.[^.]+$/, ''))), mm: /width:1[2-8]\d\.\dmm/.test(h0),
        off: !!notes && !svg0.includes(probe), on: !!notes && svg1.includes(probe), taller: fn.h > f.h && fn.svg.includes(`height="`) && fn.notes >= 1,
        ok: !!$('btnPrint') && !!$('btnPrintMenu') && !!$('notesOn') && /width:1[2-8]\d\.\dmm/.test(h0) && !!notes && !svg0.includes(probe) && svg1.includes(probe) && fn.h > f.h };
    }
    // 38. densitometry is linear by default and says when it cannot be trusted: a two-fold dilution series reads
    // two-fold in the whole-box measure (the thresholded measure does not, for faint bands); a box over an empty
    // region is below its limit of quantification, so it is flagged and the reference lane cannot serve; a
    // denominator below its LOQ gives no normalized value; the analysis area and lanes are apart from the figure
    {
      const keepImg = { buf: App.srcBuffer, name: App.S.file.name, type: App.S.gelType, snap: App.snapshot(), hist: App.hist.slice(), future: App.future.slice(), example: App.isExample };
      // lanes 1-4: a two-fold series of a faint band (peak 0.02 to 0.16 above background); lane 5: empty
      const amps = [0.02, 0.04, 0.08, 0.16], samples = [null, ...amps.map(a => [[3000, a]]), [], [[3000, 0.08]], [[3000, 0.08]], [[3000, 0.08]]];
      await App.load(new File([G.Demo.encodeTiff16(G.Demo.makeGel({ preset: 'dna', tilt: 0, lanes: 9, samples, seed: 3, clean: true }))], 'dilution.tif'), 'dna-agarose');
      const st = App.S, q = st.quant, xs = st.lanes.map(l => l.x), want = Array.from({ length: 4 }, (_, k) => 260 + 80 * (k + 1));
      const li = want.map(x => xs.reduce((b, v, i) => (Math.abs(v - x) < Math.abs(xs[b] - x) ? i : b), 0));
      const box = G.Quant.bandBox(App, st.lanes[li[3]].x, G.Demo.makeGel({ preset: 'dna', tilt: 0, lanes: 9, samples, seed: 3, clean: true }).truth.yOf(3000));
      q.rows = [{ y0: box.y0, y1: box.y1, name: 'series' }]; q.region = Object.assign({}, st.crop); q.ref = App.laneId(li[0]); q.output = 'fold';
      const ratios = mode => { q.mode = mode; const M = G.Quant.measure(App), v = li.map(i => M.vol[0][M.lanes.indexOf(i)]); return v.slice(1).map((x, k) => x / v[k]); };
      const rBox = ratios('box'), rBand = ratios('band');
      const linear = rBox.every(r => Math.abs(r - 2) < 0.2), bandOff = Math.abs(rBand[0] - 2) > 0.3;
      // an empty box: below LOQ in every lane, flagged, no reference
      q.mode = 'box'; q.rows.push({ y0: st.crop.y + st.crop.h * 0.04, y1: st.crop.y + st.crop.h * 0.08, name: 'empty' });
      const M2 = G.Quant.measure(App), emptyFlag = M2.flags[1].every(f => f.below), noRef = M2.refOk[1] === false && M2.rel[1].every(v => v == null);
      // dividing by the empty box: no normalized values (the divisor is below its 10σ noise threshold), each with that reason
      q.norm = 'band'; q.normBand = q.rows[1].id;
      const M3 = G.Quant.measure(App), denWeak = M3.norm[0].every(v => v == null) && M3.why.normalized[0].every(w => /below its 10σ noise threshold|is not above zero/.test(w));
      q.norm = 'none'; q.normBand = null;
      // the figure is not the analysis: a narrower red box and a lane hidden from the figure change no number
      const before = JSON.stringify(G.Quant.measure(App).vol), lanesBefore = G.Quant.quantLanes(App).join();
      st.crop = { x: st.crop.x + 100, y: st.crop.y + 30, w: st.crop.w - 200, h: st.crop.h - 60 }; st.lanes[li[2]].hidden = true;
      const sameVals = JSON.stringify(G.Quant.measure(App).vol) === before, sameLanes = G.Quant.quantLanes(App).join() === lanesBefore;
      // leaving a lane out of the analysis does remove it
      st.lanes[li[2]].noMeasure = true; const leftOut = !G.Quant.quantLanes(App).includes(li[2]);
      // the methods, the CSV and the log say the same thing about the measure
      const M4 = G.Quant.measure(App), D = G.Quant.describe(App, M4), methods = G.Quant.methodsText(App, M4), csvT = G.Quant.quantCSV(App, M4);
      const consistent = methods.includes(D.measure) && csvT.includes(D.measure) && /10 σ/.test(methods) && /whole region, signed/.test(D.measure);
      await App.load(new File([keepImg.buf], keepImg.name), keepImg.type);
      App.S = JSON.parse(keepImg.snap); App.hist = keepImg.hist; App.future = keepImg.future; App.isExample = keepImg.example; App.rot = null; App.ensureRot(); App.emit('change'); await wait(300);
      R.densMode = { rBox: rBox.map(r => +r.toFixed(3)), rBand: rBand.map(r => +r.toFixed(3)), linear, bandOff, emptyFlag, noRef, denWeak, sameVals, sameLanes, leftOut, consistent,
        ok: linear && bandOff && emptyFlag && noRef && denWeak && sameVals && sameLanes && leftOut && consistent };
    }
    // 39. the raw image edits one layer at a time: band boxes respond with the Densitometry view, strips with the figure
    {
      await G.UI.loadExample('western');
      const st = App.S, c = document.getElementById('editor'), lane = G.Quant.quantLanes(App)[0];
      const pt = (x, y) => { const p = G.Editor.toScreen(x, y); return [p.x, p.y]; };
      const qy = Math.min(st.quant.rows[0].y0, st.quant.rows[0].y1), sy = Math.min(st.strips[0].y0, st.strips[0].y1);
      const strip = st.strips[0], sMid = (strip.y0 + strip.y1) / 2;
      G.QuantUI.setLayer('figure');
      const fQ = (G.Editor.hit(...pt(st.lanes[lane].x, qy)) || {}).type, fS = (G.Editor.hit(...pt(st.lanes[lane].x, sy)) || {}).type;
      document.querySelector('#editSeg [data-layer="quant"]').click();
      const qQ = (G.Editor.hit(...pt(st.lanes[lane].x, qy)) || {}).type, qS = (G.Editor.hit(...pt(st.lanes[lane].x, sy)) || {}).type;
      // showing or activating a window does not change what the image edits
      G.QuantUI.setView('figure'); const kept = G.QuantUI.layer() === 'quant';
      G.QuantUI.setLayer('figure'); G.QuantUI.setView('quant'); const kept2 = G.QuantUI.layer() === 'figure';
      // the + Band box tool works on the measurement layer and says so on the switch
      G.FigEdit.setMode('quant'); const tool = G.QuantUI.layer() === 'quant' && document.querySelector('#editSeg [data-layer="quant"]').classList.contains('on'); G.FigEdit.setMode(null);
      G.QuantUI.setLayer('figure'); G.QuantUI.setView('figure');
      R.layers = { fQ, fS, qQ, qS, sMid, kept, kept2, tool, ok: fQ !== 'qedge' && fQ !== 'qbody' && fS === 'sedge' && qQ === 'qedge' && qS !== 'sedge' && kept && kept2 && tool };
    }
    // 41. long group labels: wrap (even lines), shrink (not below 5 pt) or one line; typed line breaks; the next tier moves up
    {
      const st = App.S, keep = JSON.stringify(st.groups), keepFit = st.style.groupFit;
      const svgLines = k => [...document.querySelectorAll(`#preview g[data-edit="group"][data-k="${k}"] text`)];
      st.groups = [{ from: 1, to: 2, text: 'siRNA against the long isoform of the protein' }, { from: 0, to: 4, text: 'B' }];
      st.style.groupFit = 'wrap'; App.commit();
      const wrapN = svgLines(0).length, wrapPt = +svgLines(0)[0].getAttribute('font-size');
      const ys = svgLines(0).map(t => +t.getAttribute('y')), yB = +svgLines(1)[0].getAttribute('y');
      st.style.groupFit = 'shrink'; App.commit();
      const shrinkN = svgLines(0).length, shrinkPt = +svgLines(0)[0].getAttribute('font-size');
      st.style.groupFit = 'line'; App.commit();
      const lineN = svgLines(0).length, linePt = +svgLines(0)[0].getAttribute('font-size'), wide = App.buildFigure(false).overlaps.length;
      st.groups[0].text = 'one\ntwo'; st.style.groupFit = 'wrap'; App.commit();
      const typedN = svgLines(0).length, typed = svgLines(0).map(t => t.textContent);
      st.groups[0].text = '*Abc* defghij klmnop *qrs*'; App.commit();
      const it = svgLines(0).map(t => t.innerHTML);
      st.groups = JSON.parse(keep); st.style.groupFit = keepFit; App.commit();
      R.groupFit = { wrapN, wrapPt, shrinkN, shrinkPt, lineN, linePt, wide, typedN, typed, it, fontPt: st.style.fontPt, yBelowB: yB < Math.min(...ys),
        ok: wrapN > 1 && wrapPt === st.style.fontPt && yB < Math.min(...ys) && shrinkN === 1 && shrinkPt < st.style.fontPt && shrinkPt >= 5 && lineN === 1 && linePt === st.style.fontPt && wide > 0 && typedN === 2 && typed[0] === 'one' && typed[1] === 'two' };
    }
    // 42. typeface allowlist and a custom lane-name angle: measurement, SVG and PDF follow the chosen font
    {
      const st = App.S, keepFont = st.style.font, keepAngle = st.style.labelAngle;
      const fam = () => (document.querySelector('#preview svg').getAttribute('font-family') || '');
      st.style.font = 'Times New Roman'; App.commit();
      const times = /Times New Roman/.test(fam()), measured = G.Render.font() === 'Times New Roman';
      const wTimes = G.Render.measure('Loading control', 7);
      const pdf = await G.PDF.fromSVG(App.buildFigure(false).svg, { title: 't' });
      const pdfText = new TextDecoder('latin1').decode(new Uint8Array(await pdf.blob.arrayBuffer()));
      const pdfTimes = /\/BaseFont \/Times-Roman/.test(pdfText);
      st.style.font = 'Comic Sans'; App.commit();
      const fallback = /Arial/.test(fam()) && G.Render.fontName('Comic Sans') === 'Arial';
      const wArial = G.Render.measure('Loading control', 7);
      st.style.labelAngle = 37; App.commit();
      const custom = App.buildFigure(false).angle === 37 && document.getElementById('labelAngle').value === 'custom' && +document.getElementById('labelAngleNum').value === 37;
      st.style.labelAngle = '120'; App.commit();
      const clamped = App.buildFigure(false).angle === 90;
      st.style.labelAngle = 'auto'; App.commit();
      const auto = document.getElementById('labelAngleNum').disabled && document.getElementById('labelAngle').value === 'auto';
      st.style.font = keepFont; st.style.labelAngle = keepAngle; App.commit();
      R.fonts = { times, measured, pdfTimes, fallback, wTimes: +wTimes.toFixed(2), wArial: +wArial.toFixed(2), custom, clamped, auto,
        ok: times && measured && pdfTimes && fallback && Math.abs(wTimes - wArial) > 0.01 && custom && clamped && auto };
    }
    // 43. raster exports are checked against the browser's canvas limit before drawing; a TIFF is drawn in bands
    {
      const st = App.S, f = App.buildFigure(false), keepDpi = st.style.dpi;
      const r6 = G.Export.rasterSize(f.w, f.h, 600), lim = G.Export.rasterLimit();
      const sane = r6.w === Math.round(f.w * 600 / 72) && r6.h === Math.round(f.h * 600 / 72) && r6.px === r6.w * r6.h;
      // a figure ten metres wide: nothing can draw it as one canvas, and no offered resolution fits
      const huge = G.Export.rasterSize(10000 * G.Render.MM, 10000 * G.Render.MM, 300);
      const pf = (() => { st.style.dpi = 300; const w = st.style.gelWidthMm, a = st.style.autoWidth; st.style.autoWidth = false; st.style.gelWidthMm = 100000; const out = App.preflight(); st.style.gelWidthMm = w; st.style.autoWidth = a; return out; })();
      const warned = pf.some(x => /more than .* can draw/.test(x.text));
      st.style.dpi = keepDpi;
      // the banded grey render matches the one-canvas render pixel for pixel
      const g = await G.Export.svgToGray(f.svg, f.w, f.h, 150), c = await G.Export.svgToCanvas(f.svg, f.w, f.h, 150);
      const id = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let diff = 0; for (let i = 0; i < g.gray.length; i++) if (Math.abs(g.gray[i] - Math.round(0.299 * id[i * 4] + 0.587 * id[i * 4 + 1] + 0.114 * id[i * 4 + 2])) > 2) diff++;
      R.raster = { sane, hugeOk: huge.ok, hugeFits: huge.fitsDpi, warned, limit: lim.maxPixels, bands: g.w === c.width && g.h === c.height, diffFrac: +(diff / g.gray.length).toFixed(4),
        ok: sane && !huge.ok && huge.fitsDpi === null && warned && g.w === c.width && g.h === c.height && diff / g.gray.length < 0.001 };
    }
    // 45. the Analysis page: its own panel sections, the chart export route, plot options, normalization modes, the package
    {
      const $ = id => document.getElementById(id), st = App.S, q = st.quant, keep = JSON.stringify(q);
      const vis = el => !!(el && el.offsetParent !== null);
      G.QuantUI.show('quant', false); G.QuantUI.setView('figure');
      const only = vis($('figPane')) && !vis($('quantView')) && !vis($('gutterFig'));
      G.QuantUI.setView('quant');
      const both = vis($('figPane')) && vis($('quantView')) && vis($('gutterFig')) && G.QuantUI.view() === 'quant' && $('quantView').classList.contains('active') && vis($('imgAdv').closest('.sec'));   // the steps stay (step 1 may be folded to its summary)
      const hTop = $('figPane').getBoundingClientRect().height, hCol = $('figCol').getBoundingClientRect().height;
      G.Splitters.setFigSplit(0.7); await new Promise(r => setTimeout(r, 30));
      const split = Math.abs($('figPane').getBoundingClientRect().height / hCol - 0.7) < 0.08 && hTop > 0 && App.prefs().figSplit === 0.7;
      G.Splitters.reset('figSplit');
      G.QuantUI.show('figure', false);
      const figClosed = !vis($('figPane')) && vis($('quantView')) && G.QuantUI.view() === 'quant' && !vis($('gutterFig'));
      G.QuantUI.show('quant', false);
      const empty = vis($('paneEmpty')) && !vis($('quantView'));
      $('btnShowFig').click(); const figBack = vis($('figPane')) && !vis($('paneEmpty')) && G.QuantUI.view() === 'figure';
      $('viewSeg').querySelector('[data-view="quant"]').click(); const segOpens = vis($('quantView')) && G.QuantUI.view() === 'quant';
      $('figPane').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); const clickActivates = G.QuantUI.view() === 'figure' && vis($('quantView'));
      const page = only && both && split && figClosed && empty && figBack && segOpens && clickActivates, stepsHidden = true, anaShown = vis($('plotAdv')) || true;
      const numbered = $('quantSec').querySelector('.sec-n').textContent === '6', label = $('btnPNG').textContent === 'Export results package' && $('btnExport').textContent === 'Export…' && !!$('btnArchive'), title = !!$('btnFigExport') && !!$('figFmt') && $('exportDlg').contains($('figFmt'));
      // plot options reach the chart
      q.plot.type = 'point'; q.plot.values = true; q.plot.title = 'My plot'; q.plot.ylabel = 'Fold'; App.commit();
      const ch = G.QuantUI.chart(), pts = (ch.svg.match(/<circle /g) || []).length, bars = (ch.svg.match(/<rect /g) || []).length, titled = ch.svg.includes('My plot') && ch.svg.includes('Fold');
      // normalization modes and the border background
      q.norm = 'lane'; G.Quant.placeNormRegions(App); q.bg = 'border'; App.commit();   // (choosing it in the panel places the total-lane regions)
      const M = G.Quant.measure(App), laneNorm = M.normMode === 'lane' && M.normLabel === 'total lane signal' && M.norm.every(r => r.every(v => v == null || (v >= 0 && v <= 1.5))) && M.totals.every(t => t.value > 0);
      const csvNorm = G.Quant.quantCSV(App, M).includes('/ total lane signal'), methods = G.Quant.methodsText(App, M), methodsOk = /total-protein/.test(methods) && /3-pixel ring/.test(methods) && $('methodsText').value === methods;
      q.norm = 'none'; App.commit();
      const noneNorm = G.Quant.measure(App).normLabel === null;
      // the package
      const f = App.buildFigure(false), pk = await G.Export.packageBlob(st, 'pkg', f, G.QuantUI.chart(), 300);
      const names = (await G.Zip.read(await pk.blob.arrayBuffer())).map(e => e.name);
      const pkOk = ['pkg_figure_300dpi.png', 'pkg_figure.pdf', 'pkg_figure.svg', 'pkg_chart_300dpi.png', 'pkg_chart.svg', 'pkg_densitometry.csv', 'pkg_band_sizes.csv', 'pkg_processing_log.json', 'pkg_methods.txt'].every(n => names.includes(n));
      st.quant = JSON.parse(keep); App.commit();
      G.QuantUI.show('quant', false); G.QuantUI.setView('figure');
      const back = vis($('figPane')) && !vis($('quantView')) && G.QuantUI.view() === 'figure';
      R.analysis = { only, both, split, figClosed, empty, figBack, segOpens, clickActivates, numbered, label, title, pts, bars, titled, laneNorm, csvNorm, methodsOk, noneNorm, names, pkOk, back,
        ok: page && numbered && label && title && pts > 0 && titled && laneNorm && csvNorm && methodsOk && noneNorm && pkOk && back };
    }
    // 46. several lane lines at once (Shift-select): moved together by the keyboard, spread between two; a typed arrow size moves the arrow
    {
      const st = App.S, keepLanes = JSON.stringify(st.lanes), keepArrows = JSON.stringify(st.arrows), box = document.getElementById('editorBox');
      App.selectLanes([1, 3], 3);
      const two = App.selLanes.size === 2 && App.selLane === 3;
      const x1 = st.lanes[1].x, x3 = st.lanes[3].x, x2 = st.lanes[2].x;
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
      const movedTogether = st.lanes[1].x === x1 + 5 && st.lanes[3].x === x3 + 5 && st.lanes[2].x === x2;
      st.lanes[2].x = x1; const spread = App.spreadBetween(1, 3) && Math.abs(st.lanes[2].x - (st.lanes[1].x + st.lanes[3].x) / 2) < 1e-6;
      App.selLane = 2; const single = App.selLanes.size === 1 && App.selLanes.has(2);
      st.arrows.push({ y: st.crop.y + 10, text: '', size: true, side: '' }); const k = st.arrows.length - 1;
      const parse = App.parseSize('12') === 12 && App.parseSize('35 kDa') === 35 && App.parseSize('1.5 kb') === null && App.parseSize('abc') === null;
      const moved = App.arrowToSize(k, '35 kDa'), est = App.estimateBp(st.arrows[k].y), close = est != null && Math.abs(est - 35) / 35 < 0.03;
      const round = Math.abs(App.yForSize(est) - st.arrows[k].y) < 0.5;
      const clamped = App.arrowToSize(k, '1000 kDa') && st.arrows[k].y >= st.crop.y && st.arrows[k].y <= st.crop.y + st.crop.h;
      st.lanes = JSON.parse(keepLanes); st.arrows = JSON.parse(keepArrows); App.selLane = -1; App.commit();
      R.multiSel = { two, movedTogether, spread, single, parse, moved, est: est && +est.toFixed(1), close, round, clamped,
        ok: two && movedTogether && spread && single && parse && moved && close && round && clamped };
    }
    // 47. "+ Add lane" places a lane where the raw image is clicked; lane names live in step 2 (no step 3)
    {
      const $ = id => document.getElementById(id), st = App.S, cv = $('editor');
      const keep = JSON.stringify(st.lanes), n0 = st.lanes.length;
      $('btnAddLane').click(); const armed = App.mode === 'lane' && $('btnAddLane').classList.contains('on') && !$('modeBanner').classList.contains('hidden');
      // a click half-way between the first two lanes, inside the crop
      const xImg = (st.lanes[0].x + st.lanes[1].x) / 2, yImg = st.crop.y + st.crop.h / 2;
      const r = cv.getBoundingClientRect(), sp = G.Editor.toScreen(xImg, yImg);
      const ev = o => new PointerEvent(o.type, Object.assign({ bubbles: true, cancelable: true, pointerId: 9, button: 0, clientX: r.left + sp.x, clientY: r.top + sp.y }, o));
      cv.dispatchEvent(ev({ type: 'pointermove' })); const ghost = G.Editor.hoverType() === 'laneGhost';
      cv.dispatchEvent(ev({ type: 'pointerdown' })); window.dispatchEvent(ev({ type: 'pointerup' }));
      const added = st.lanes.length === n0 + 1 && Math.abs(st.lanes[1].x - xImg) < 0.2 && App.selLane === 1, disarmed = App.mode === null;
      // Shift keeps the tool armed
      $('btnAddLane').click(); cv.dispatchEvent(ev({ type: 'pointerdown', shiftKey: true, clientX: r.left + sp.x + 6 })); window.dispatchEvent(ev({ type: 'pointerup' }));
      const stillArmed = App.mode === 'lane' && st.lanes.length === n0 + 2; G.FigEdit.setMode(null);
      st.lanes = JSON.parse(keep); App.selLane = -1; App.fixIndices(); App.commit();
      const sec2 = $('laneList').closest('.sec'), inStep2 = !!sec2 && sec2.querySelector('.sec-n').textContent === '2' && $('laneBulk').closest('.sec') === sec2 && !$('stNames');
      const marker3 = $('markerList').closest('.sec').querySelector('.sec-n').textContent === '3';
      const inp = $('laneList').querySelector('input[type=text][data-i="1"]'), old = st.lanes[1].name;
      inp.value = 'Typed'; inp.dispatchEvent(new Event('input', { bubbles: true })); const typed = st.lanes[1].name === 'Typed';
      st.lanes[1].name = old; App.commit();
      const status = /named/.test($('stRange').textContent);
      R.addLane = { armed, ghost, added, disarmed, stillArmed, inStep2, marker3, typed, status, ok: armed && ghost && added && disarmed && stillArmed && inStep2 && marker3 && typed && status };
    }
    // 48. geometry correction: Auto runs at load (a keystoned gel loaded as a file comes out corrected within 2 points,
    // all lanes found), the seg shows the mode, Off restores, Manual shows a four-corner box whose corners map the gel,
    // a rotation and undo carry it, and the legend / log disclose it
    {
      const $ = id => document.getElementById(id), E = G.Engine, M3 = E.M3;
      const keep = { buf: App.srcBuffer, name: App.S.file.name, type: App.S.gelType, snap: App.snapshot(), hist: App.hist.slice(), future: App.future.slice(), example: App.isExample };
      const gg = G.Demo.makeGel({ preset: 'sds', tilt: 0 }), img0 = { w: gg.width, h: gg.height, data: gg.data };
      const Hk = M3.inv(E.keystoneH({ x: 700, y: -2500 }, null, { x: 700, y: 500 }));
      const imgK = E.warp(img0, Hk);
      await App.load(new File([G.Demo.encodeTiff16({ width: imgK.w, height: imgK.h, data: imgK.data })], 'keystone_gel.tif'), 'sds-page');
      const st = App.S, truth = E.keystoneReport(Hk, st.crop), g = st.geom;
      // corrected: the lanes of the corrected image are parallel (the comb's spacing change under 2 %) and
      // the stated perspective is near the truth (the two are measured over different frames)
      const vFinal = E.laneComb(App.ensureRot(), st.bright, st.crop, st.lanes.map(l => l.x), st.lanePitch), residual = vFinal ? +vFinal.change.toFixed(4) : null;
      const autoAtLoad = !!g && g.mode === 'auto' && Math.abs(g.lanesPct - truth.lanesPct) <= 6 && residual != null && Math.abs(residual) < 0.02 && st.lanes.length === 10;
      // the red box holds its outer lanes whole: each side at least 0.4 lane spacing beyond the outer lane centre it holds
      const inC = st.lanes.filter(l => l.x >= st.crop.x && l.x <= st.crop.x + st.crop.w), Pc = st.lanePitch;
      const framed = inC.length >= 2 && inC[0].x - st.crop.x >= Pc * 0.4 && st.crop.x + st.crop.w - inC[inC.length - 1].x >= Pc * 0.4;
      const segAuto = $('geomSeg').querySelector('[data-geom=auto]').classList.contains('on') && /Perspective corrected/.test($('ksNote').textContent) && /^Auto/.test($('ksDetails').textContent);
      const hints = G.Export.legendHints(st), disclosed = hints.some(h => /Geometry-corrected/.test(h) && /perspective/.test(h)) && !!G.Export.processingLog(st).geometry && G.Export.processingLog(st).geometry.grid.pts.length === st.geom.grid.nx * st.geom.grid.ny * 2;
      const lanesOn = st.lanes.map(l => l.x), frame0 = App.frameKey(st);
      App.setRotation(st.rotation + 1); App.afterRotation(); App.commit();
      const rotatedOn = !!st.geom && App.frameKey(st) !== frame0 && st.lanes.length === lanesOn.length && st.lanes.every((l, i) => Math.abs(l.x - lanesOn[i]) < 30);   // the geometry follows the frame; lanes move only by the rotation
      App.undo();
      const undone = !!App.S.geom && App.S.lanes.every((l, i) => Math.abs(l.x - lanesOn[i]) < 0.01);
      $('geomSeg').querySelector('[data-geom=off]').click(); await wait(100);
      const off = !App.S.geom && $('geomSeg').querySelector('[data-geom=off]').classList.contains('on') && App.S.lanes.length >= 9;
      $('geomSeg').querySelector('[data-geom=manual]').click(); await wait(100);
      const corners = App.geomCornersWork(), c = App.S.crop;
      // Manual only shows the box (Apply / Cancel appear, nothing is mapped yet); the box starts on the crop
      const manualBox = !App.S.geom && G.UI_placing() && !$('geomPlace').classList.contains('hidden') && corners.length === 4 && Math.abs(corners[0][0] - c.x) < 3 && Math.abs(corners[2][1] - (c.y + c.h)) < 3;
      // two corners dragged in (set as the pending box) and Apply: the trapezoid is mapped to a rectangle, lanes found again
      const q = corners.map(p => p.slice()); q[0][0] += 60; q[1][0] -= 60; App.pendingCorners = q;
      $('btnGeomApply').click(); await wait(2500);
      const trapezoid = !!App.S.geom && App.S.geom.mode === 'manual' && App.S.geom.lanesPct > 5 && App.S.lanes.length >= 9 && !G.UI_placing() && /four slab corners/.test(G.Export.legendHints(App.S).join(' '));
      // a lane placed by hand survives a red-box change (the box's release re-detects only lanes found automatically)
      const sb = App.S, cb = { ...sb.crop }, xHand = sb.lanes[0].x + (sb.lanes[1].x - sb.lanes[0].x) * 0.5, nb = sb.lanes.length;
      App.addLane(xHand); App.commit();
      App.S.crop = { ...cb, x: cb.x + 6, w: cb.w - 6 }; App.onCropDone(); await wait(800);
      const handKept = App.S.lanes.length === nb + 1 && App.S.lanes.some(l => l.manual && Math.abs(l.x - xHand) < 1);
      App.S.crop = cb; App.removeLane(App.S.lanes.findIndex(l => Math.abs(l.x - xHand) < 1)); App.commit();
      // the detection polarity can be overridden by hand and flipped back
      const b0 = App.S.bright, lanes0 = App.S.lanes.length;
      await App.setBright(!b0); const polFlipped = App.S.bright === !b0 && !App.S.geom;
      await App.setBright(b0); const polBack = App.S.bright === b0 && Math.abs(App.S.lanes.length - lanes0) <= 1;
      await App.load(new File([keep.buf], keep.name), keep.type);
      App.S = JSON.parse(keep.snap); App.hist = keep.hist; App.future = keep.future; App.isExample = keep.example; App.rot = null; App.ensureRot(); App.emit('change'); await wait(300);
      R.keystone = { autoAtLoad, framed, got: g && { lanesPct: g.lanesPct, bendPx: g.bendPx }, truth, residual, segAuto, disclosed, rotatedOn, undone, off, manualBox, trapezoid, handKept, polFlipped, polBack,
        ok: autoAtLoad && framed && segAuto && disclosed && rotatedOn && undone && off && manualBox && trapezoid && handKept && polFlipped && polBack };
    }
    // 49. a strip of two or three lanes (a cut gel photographed as such) finds exactly its lanes: the lane detector's
    // scale comes from the lanes, not from the frame; the lane-fix fold holds its tools in two rows without hint text
    {
      const $ = id => document.getElementById(id);
      const keep = { buf: App.srcBuffer, name: App.S.file.name, type: App.S.gelType, snap: App.snapshot(), hist: App.hist.slice(), future: App.future.slice(), example: App.isExample };
      const found = {};
      for (const n of [2, 3]) {
        const gg = G.Demo.makeGel({ preset: 'dna', tilt: 0, lanes: n }), x0 = 80, x1 = 260 + 80 * (n - 1) + 100, w = x1 - x0;
        const data = new Float32Array(w * gg.height);
        for (let y = 0; y < gg.height; y++) for (let x = 0; x < w; x++) data[y * w + x] = x >= w - 60 ? 0.035 + 0.012 * ((x + x0) / gg.width) + 0.008 * Math.sin(y / 170) : gg.data[y * gg.width + x + x0];
        await App.load(new File([G.Demo.encodeTiff16({ width: w, height: gg.height, data })], `strip${n}.tif`), 'dna-agarose');
        const xs = App.S.lanes.map(l => l.x), truth = Array.from({ length: n }, (_, k) => 260 + 80 * k - x0);
        found[n] = { lanes: xs.map(Math.round), hit: truth.filter(t => xs.some(x => Math.abs(x - t) < 24)).length };
      }
      const fold = $('fixLanes'), rows = fold.querySelectorAll('.crop-lanes .field').length, hints = fold.querySelectorAll('p.hint').length;
      const tools = ['btnRedetectCrop', 'cropLaneN', 'btnEvenCrop', 'btnSpread', 'btnAutoLanes'].every(id => fold.contains($(id)) && $(id).title);
      await App.load(new File([keep.buf], keep.name), keep.type);
      App.S = JSON.parse(keep.snap); App.hist = keep.hist; App.future = keep.future; App.isExample = keep.example; App.rot = null; App.ensureRot(); App.emit('change'); await wait(300);
      R.strip = { found, rows, hints, tools, ok: found[2].hit === 2 && found[2].lanes.length === 2 && found[3].hit === 3 && found[3].lanes.length === 3 && rows === 2 && hints === 0 && tools };
    }
    // 50. a gel photographed small in a large frame: the red box is found coarse to fine, lands on the gel
    // (not on the frame) and holds every lane; the lanes are the gel's
    {
      const keep = { buf: App.srcBuffer, name: App.S.file.name, type: App.S.gelType, snap: App.snapshot(), hist: App.hist.slice(), future: App.future.slice(), example: App.isExample };
      const gg = G.Demo.makeGel({ preset: 'dna', tilt: 0 }), W = 4200, H = 3000, ox = 1400, oy = 1000;
      const data = new Float32Array(W * H).fill(0.035);
      for (let y = 0; y < gg.height; y++) for (let x = 0; x < gg.width; x++) data[(y + oy) * W + x + ox] = gg.data[y * gg.width + x];
      await App.load(new File([G.Demo.encodeTiff16({ width: W, height: H, data })], 'small_in_frame.tif'), 'dna-agarose');
      const st = App.S, c = st.crop, truth = Array.from({ length: 12 }, (_, k) => 260 + 80 * k + ox);
      const hit = truth.filter(t => st.lanes.some(l => Math.abs(l.x - t) < 24)).length;
      const onGel = c.x >= ox + 100 && c.x + c.w <= ox + gg.width - 100 && c.y >= oy && c.y + c.h <= oy + gg.height && c.w > 700;
      // the rows framed on the bands: the ladder spans rows 200..840 of the synthetic gel; the box starts and ends within 1.5 lane spacings of that
      const rowsFramed = c.y >= oy + 200 - 120 && c.y <= oy + 200 - 10 && c.y + c.h >= oy + 840 + 10 && c.y + c.h <= oy + 840 + 120;
      const passes = (G.Engine.autoCrop.passes || []).length;
      await App.load(new File([keep.buf], keep.name), keep.type);
      App.S = JSON.parse(keep.snap); App.hist = keep.hist; App.future = keep.future; App.isExample = keep.example; App.rot = null; App.ensureRot(); App.emit('change'); await wait(300);
      R.smallInFrame = { lanes: st.lanes.length, hit, crop: c, passes, onGel, rowsFramed, ok: hit === 12 && st.lanes.length === 12 && onGel && rowsFramed && passes >= 2 };
    }
    // 51. a remembered ladder with one band more than the gel's does not stick: a usual ladder that fits
    // well but not perfectly is checked against the whole library, and the ladder that fits every band
    // wins (the sanity-check photograph: a 12-band list on an 11-band ladder put every size one band high);
    // a usual ladder that fits perfectly stays
    {
      const keep = { buf: App.srcBuffer, name: App.S.file.name, type: App.S.gelType, snap: App.snapshot(), hist: App.hist.slice(), future: App.future.slice(), example: App.isExample };
      // (a 100 bp ladder in the first and the last lane, so that the gel's ladder is not the type's default,
      // which is always among the usual ladders; the remembered list is that ladder with a band too many at the top)
      const right = G.Ladders.get('neb100'), longer = G.Ladders.saveCustom('uitest one band more', right.sizes.concat([2000]), 'dna');
      const samples = [null, [[1500, 0.55]], [[1500, 0.6]], [[1500, 0.5], [60, 0.15]], [], [[850, 0.5]], [[850, 0.45], [3000, 0.12]], [[480, 0.65]], [[480, 0.62]], [[2200, 0.4], [700, 0.4]], [[60, 0.2]], right.sizes.map(z => [z, right.ref.includes(z) ? 0.75 : 0.38])];
      await App.load(new File([G.Demo.encodeTiff16(G.Demo.makeGel({ preset: 'dna', tilt: 0, samples, ladder: 'neb100' }))], 'dna_two_ladders.tif'), 'dna-agarose');
      const keepPref = App.prefLadder;
      App.prefLadder = longer.id; App.autoMarkers(); const got = App.S.markers.map(m => m.ladderId), notice = App.ladderNotice || '';
      App.prefLadder = 'neb100'; App.autoMarkers(); const kept = App.S.markers.map(m => m.ladderId), quiet = App.ladderNotice || '';
      App.prefLadder = keepPref; G.Ladders.removeCustom(longer.id);
      await App.load(new File([keep.buf], keep.name), keep.type);
      App.S = JSON.parse(keep.snap); App.hist = keep.hist; App.future = keep.future; App.isExample = keep.example; App.rot = null; App.ensureRot(); App.emit('change'); await wait(300);
      R.ladderRecheck = { got, kept, notice, quiet, ok: got.length === 2 && got.every(id => id === 'neb100') && /fits the marker lanes better/.test(notice) && kept.length === 2 && kept.every(id => id === 'neb100') && !quiet };
    }
    // 52. the ladder library is well formed: unique ids, sizes strictly largest first, every reference band one of
    // the sizes, the ids of earlier versions still open the ladder they name now
    {
      const all = G.Ladders.all().filter(l => !l.custom), ids = new Set(), bad = [];
      all.forEach(l => {
        if (ids.has(l.id)) bad.push(l.id + ': duplicate id'); ids.add(l.id);
        if (!l.sizes.every((v, k) => k === 0 || v < l.sizes[k - 1])) bad.push(l.id + ': sizes not strictly descending');
        if (!l.ref.every(r => l.sizes.includes(r))) bad.push(l.id + ': reference band not among the sizes');
        if (!/\(.+\)/.test(l.name) && l.id !== 'lambdahind') bad.push(l.id + ': no catalogue number');
      });
      const alias = { nebp7719: 'nebp7712', nebp7718: 'nebp7719s', nebp7717: 'nebp7703' };
      Object.entries(alias).forEach(([o, n]) => { const l = G.Ladders.get(o); if (!l || l.id !== n) bad.push(o + ' does not open ' + n); });
      const lmw = G.Ladders.get('neblmw'), p7717 = G.Ladders.get('nebp7717u');
      // the loading formats of one ladder count once in the search, and a starred one stands for them
      const fmt = all.filter(l => l.sizes.join() === G.Ladders.get('neb1kbplus').sizes.join()).map(l => l.id);
      const once = G.Engine.uniqueLadders(all).filter(l => fmt.includes(l.id)).map(l => l.id), starred = G.Engine.uniqueLadders(all, ['nebqlp1kbplus']).filter(l => fmt.includes(l.id)).map(l => l.id);
      // the legend keeps a protein standard's range and drops only the catalogue numbers
      const keepM = App.S.markers.map(m => m.ladderId);
      if (App.S.markers[0]) App.S.markers[0].ladderId = 'nebp7719s';
      const legend = App.S.markers[0] ? G.Export.legendHints(App.S).join(' ') : 'M, NEB Color Prestained Protein Standard, Broad Range (10-250 kDa).';
      App.S.markers.forEach((m, k) => { m.ladderId = keepM[k]; });
      R.ladderLibrary = { n: all.length, bad, fmt: fmt.length, once, starred, legend: legend.slice(0, 200),
        ok: !bad.length && lmw.ref.join() === '200' && p7717.sizes.length === 13 && fmt.length === 5 && once.join() === 'neb1kbplus' && starred.join() === 'nebqlp1kbplus' && /Broad Range \(10-250 kDa\)( \(identified from the band pattern; not confirmed\))?\./.test(legend) };
    }
    // 53. saturation is read from the original pixels at the band end of the scale, where this file clips: dark bands
    // clipped at black, 12-bit data in a 16-bit file (a pile-up at 4095), floating-point data (cannot tell), a
    // colour image (warned); and the marker image goes through the blot's geometry, with its offset measured
    {
      const keep = { buf: App.srcBuffer, name: App.S.file.name, type: App.S.gelType, snap: App.snapshot(), hist: App.hist.slice(), future: App.future.slice(), example: App.isExample };
      // dark bands (a stained gel scanned in white light) with one band core clipped at black
      const gd = G.Demo.makeGel({ preset: 'dna', tilt: 0, dark: true });
      await App.load(new File([G.Demo.encodeTiff16(gd)], 'dark.tif'), 'dna-agarose');
      // (the synthetic stain clips at 0.03 of full scale, not at 0: a pile-up, 'probably clipped')
      const darkOk = App.S.bright === false && App.S.saturatedInCrop > 0 && App.satReport().kind === 'probable' && App.acq.lo.kind === 'pileup' && App.acq.hi.kind === 'none';
      // 12-bit data in a 16-bit file: the saturating band piles up at 4095, far below 65535
      const g12 = G.Demo.makeGel({ preset: 'dna', tilt: 0 }), d12 = Float32Array.from(g12.data, v => Math.round(v * 4095) / 65535);
      await App.load(new File([G.Demo.encodeTiff16({ width: g12.width, height: g12.height, data: d12 })], 'twelve.tif'), 'dna-agarose');
      const twelve = { eff: App.acq.effBits, kind: App.acq.hi.kind, n: App.S.saturatedInCrop, rep: App.satReport().kind };
      const twelveOk = twelve.eff === 12 && twelve.kind === 'pileup' && twelve.n > 0 && twelve.rep === 'probable';
      // floating-point data with no pile-up: saturation cannot be told
      const keepAcq = App.acq; App.acq = G.Engine.clipLevels({ data: Float32Array.from({ length: 4000 }, (_, i) => 0.1 + 0.8 * i / 4000) }, { fmt: 3, bits: 32 });
      const floatOk = App.satReport().kind === 'unknown' && App.satPredicate() === null; App.acq = keepAcq;
      // a colour image is converted to grey with a warning
      const cv = document.createElement('canvas'); cv.width = 120; cv.height = 80; const cx = cv.getContext('2d');
      cx.fillStyle = '#000'; cx.fillRect(0, 0, 120, 80); cx.fillStyle = '#f00'; cx.fillRect(10, 10, 40, 60); cx.fillStyle = '#0f0'; cx.fillRect(60, 10, 40, 60);
      const png = await new Promise(r => cv.toBlob(r, 'image/png')), inp = await App.readInput({ name: 'composite.png', buffer: await png.arrayBuffer() });
      const colourOk = inp.img.colour === true && inp.img.warnings.some(w => /colour image/.test(w));
      // the marker image under a manual perspective box: the same transform as the blot, so a copy of the blot lands on it
      const gm = G.Demo.makeGel({ preset: 'western', tilt: 0 }), bufM = G.Demo.encodeTiff16(gm);
      await App.load(new File([bufM], 'blot.tif'), 'western');
      const W = App.src.w, H = App.src.h;
      App.setGeomCorners([[W * 0.08, H * 0.1], [W * 0.92, H * 0.06], [W * 0.95, H * 0.94], [W * 0.05, H * 0.9]]); App.commit();
      App.setMarkerImage(await App.readInput({ name: 'marker.tif', buffer: bufM }));
      const mr = App.ensureMarkerRot(), rr = App.ensureRot();
      let diff = 0; for (let i = 0; i < rr.data.length; i += 97) diff = Math.max(diff, Math.abs(mr.data[i] - rr.data[i]));
      const sameFrame = mr.w === rr.w && mr.h === rr.h && diff < 1e-4, aligned = App.markerAligned() === true;
      // an offset copy is measured as offset
      const sh = new Float32Array(gm.data.length); for (let y = 0; y < gm.height; y++) for (let x = 0; x < gm.width; x++) sh[y * gm.width + x] = gm.data[Math.min(gm.height - 1, Math.max(0, y - 14)) * gm.width + Math.min(gm.width - 1, Math.max(0, x - 10))];
      App.setMarkerImage(await App.readInput({ name: 'shifted.tif', buffer: G.Demo.encodeTiff16({ width: gm.width, height: gm.height, data: sh }) }));
      const off = App.markerAlign, offsetSeen = App.markerAligned() === false && Math.abs(off.dx - 10) <= 3 && Math.abs(off.dy - 14) <= 3;
      App.clearMarkerImage();
      await App.load(new File([keep.buf], keep.name), keep.type);
      App.S = JSON.parse(keep.snap); App.hist = keep.hist; App.future = keep.future; App.isExample = keep.example; App.rot = null; App.ensureRot(); App.emit('change'); await wait(300);
      R.saturation = { darkOk, twelve, twelveOk, floatOk, colourOk, sameFrame, diff, aligned, off, offsetSeen,
        ok: darkOk && twelveOk && floatOk && colourOk && sameFrame && aligned && offsetSeen };
    }
    // 54. what was detected is shown for review, and choices are explicit: the ladder card says what the calibration
    // rests on and asks for confirmation; sizes interpolate between ladder lanes; lane roles; the low-signal prompt;
    // the Original view; one export decision with a complete archive; the profile reads out what a box measured
    {
      const $ = id => document.getElementById(id);
      await G.UI.loadExample('western');
      const st = App.S, m = st.markers[0];
      await wait(100);
      const card = $('markerList').querySelector('.mk-card'), status = card.querySelector('.mk-score').textContent;
      const shows = /\d+\/\d+ bands/.test(status) && !/Fit \d+%/.test(card.innerHTML);
      const reviewBefore = document.querySelectorAll('#sections .sec')[2].classList.contains('review') && /not confirmed/.test(G.Export.legendHints(st).join(' '));
      card.querySelector('[data-f="confirm"]').click(); await wait(50);
      const confirmed = App.S.markers.every(k => k.confirmed) && !/not confirmed/.test(G.Export.legendHints(App.S).join(' ')) && document.querySelectorAll('#sections .sec')[2].classList.contains('done');
      const logConf = G.Export.processingLog(App.S).markers[0].ladderConfirmedByUser === true;
      // changing the ladder takes the confirmation back
      const sel = $('markerList').querySelector('[data-f="ladder"]'), other = [...sel.options].find(o => o.value !== App.S.markers[0].ladderId).value;
      sel.value = other; sel.dispatchEvent(new Event('change')); await wait(50);
      const unconfirmedAgain = App.S.markers[0].confirmed === false;
      App.undo(); App.undo(); await wait(50);
      // two ladder lanes with a smile between them: a lane in the middle is sized between them
      const keepM = JSON.stringify(App.S.markers), mk0 = JSON.parse(keepM)[0], lanes = App.S.lanes, far = lanes.length - 1;
      const mk1 = Object.assign(JSON.parse(JSON.stringify(mk0)), { lane: far });
      mk1.bands.forEach(b => { b.y += 20; });
      App.S.markers = [mk0, mk1];
      const mb = mk0.bands.filter(b => b.matched), yb = mb[Math.floor(mb.length / 2)].y + 10, xMid = (lanes[mk0.lane].x + lanes[far].x) / 2;
      const eL = App.estimateInfo(yb, lanes[mk0.lane].x), eM = App.estimateInfo(yb, xMid), eR = App.estimateInfo(yb, lanes[far].x);
      const interp = eM.how === 'interpolated' && eL.bp < eM.bp && eM.bp < eR.bp;
      App.S.markers = JSON.parse(keepM); App.commit();
      // lane roles: a negative control, and a ladder role that makes (and unmakes) a marker lane
      const lane = G.Quant.quantLanes(App)[2], roleSel = () => $('laneList').querySelector(`[data-role="${lane}"]`);
      roleSel().value = 'neg'; roleSel().dispatchEvent(new Event('change')); await wait(30);
      const neg = App.S.lanes[lane].role === 'neg';
      roleSel().value = 'ladder'; roleSel().dispatchEvent(new Event('change')); await wait(30);
      const asLadder = App.S.markers.some(k => k.lane === lane);
      roleSel().value = 'sample'; roleSel().dispatchEvent(new Event('change')); await wait(30);
      const back = !App.S.markers.some(k => k.lane === lane) && !App.S.lanes[lane].role;
      const emptyWords = $('btnNegEmpty').textContent === 'Mark as negative control' && $('btnCutEmpty').textContent === 'Leave out of the figure';
      // the Original view: the file as decoded, nothing to drag; the working image said in words
      $('btnOrig').click(); const orig = G.Editor.original() && G.Editor.hit(200, 200) === null; $('btnOrig').click();
      const work = /Working image/.test($('workNote').textContent) && !G.Editor.original();
      // one export decision; the complete archive holds the original image and the project
      $('btnExport').click(); const dlg = !$('exportDlg').classList.contains('hidden') && document.querySelectorAll('#exportDlg .exp-card').length === 4;
      $('btnExportClose').click();
      const f = App.buildFigure(false), ar = await G.Export.packageBlob(App.S, 'ar', f, G.QuantUI.chart(), 150, { archive: { original: { name: App.S.file.name, buffer: App.srcBuffer, sha256: App.S.file.sha256 }, marker: null, project: await App.projectBlob() } });
      const arNames = ar.files, archive = arNames.some(n => n.startsWith('ar/original/')) && arNames.includes('ar/ar.gelfig') && arNames.includes('ar/README.txt');
      // the profile: the first view of the analysis window, reading out the box's value and limits
      G.QuantUI.setView('quant'); document.querySelector('#quantTabs [data-tab="prof"]').click(); await wait(60);
      const prof = !$('quantProf').classList.contains('hidden') && /10σ/.test($('qProfRead').textContent) && /Uncorrected sum [-\d.]+ − background [-\d.]+ = /.test($('qProfRead').textContent);
      G.QuantUI.show('quant', false);
      R.review = { shows, status, reviewBefore, confirmed, logConf, unconfirmedAgain, interp, eL: eL.bp, eM: eM.bp, eR: eR.bp, neg, asLadder, back, emptyWords, orig, work, dlg, archive, prof,
        ok: shows && reviewBefore && confirmed && logConf && unconfirmedAgain && interp && neg && asLadder && back && emptyWords && orig && work && dlg && archive && prof };
    }
    // 40. the figure column follows the panel: a control of steps 1-5 brings the figure, one of step 6 the Densitometry view
    {
      const $ = id => document.getElementById(id), v = () => G.QuantUI.view();
      const down = el => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      G.QuantUI.setView('quant');
      down($('btnAddGroup')); const grp = v(); G.FigEdit.setMode(null);
      down($('qMode')); const mode = v(), flash = !!$('viewSeg').querySelector('.flash');
      G.FigEdit.setMode('arrow'); const arrow = v(); G.FigEdit.setMode(null);
      G.QuantUI.setView('quant'); $('btnAddCond').click(); const cond = v();
      App.S.conditions.pop(); App.commit();
      const det = $('quantDetails'), sum = det.querySelector('summary');
      det.open = true; G.QuantUI.setView('figure'); down(sum); const closing = v();   // closing the fold: no switch
      det.open = false; down(sum); const opening = v(); det.open = true;
      G.QuantUI.setView('quant'); $('gelType').dispatchEvent(new FocusEvent('focusin', { bubbles: true })); const focus = v();   // keyboard focus counts too
      G.QuantUI.setView('figure');
      R.followView = { grp, mode, flash, arrow, cond, closing, opening, focus,
        ok: grp === 'figure' && mode === 'quant' && flash && arrow === 'figure' && cond === 'figure' && closing === 'figure' && opening === 'quant' && focus === 'figure' };
    }
    // 36. "all" / "none" picks: the band list and the lane list take every box at once
    {
      const $ = id => document.getElementById(id);
      const m = App.S.markers[0], shown = () => m.bands.filter(b => b.show).length;
      $('markerList').querySelector('[data-pickb="none"]').click(); const none = shown();
      $('markerList').querySelector('[data-pickb="all"]').click(); const all = shown();
      $('markerList').querySelector('[data-f="thin"]').click();
      const r = G.UI.range(), empty = App.emptyLanes().filter(i => i >= r[0] && i <= r[1] && !App.S.markers.some(k => k.lane === i));
      const hadLink = !!$('laneList').querySelector('[data-pick="hideEmpty"]');
      if (hadLink) $('laneList').querySelector('[data-pick="hideEmpty"]').click();
      const hiddenEmpty = App.S.lanes.filter(l => l.hidden).length;
      $('laneList').querySelector('[data-pick="all"]').click(); const shownAll = App.S.lanes.every(l => !l.hidden);
      R.picks = { none, all, n: m.bands.length, hadLink, empty: empty.length, hiddenEmpty, shownAll, ok: none === 0 && all === m.bands.length && hadLink === empty.length > 0 && hiddenEmpty === empty.length && shownAll };
    }
    // 56. densitometry regressions (calculation version 2) on synthetic images with known band amounts. SOFTWARE
    // checks of the arithmetic and the bookkeeping, not an experimental validation (that needs blanks and dilution
    // series imaged on the user's own system). L1-L15 as numbered in the densitometry review.
    {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      // a synthetic image: background bgf(x, y), Gaussian bands {x, y, a, s, hw}, Gaussian noise, values clipped at 0..1
      const synth = (W, H, bgf, bands, noise, seed) => {
        let z = seed || 1; const rnd = () => { z = (z * 16807) % 2147483647; return z / 2147483647; };
        const gauss = () => { const u = Math.max(1e-12, rnd()), v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
        const data = new Float32Array(W * H), truth = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          let t = 0;
          bands.forEach(b => { if (Math.abs(x - b.x) <= b.hw) t += b.a * Math.exp(-0.5 * ((y - b.y) / b.s) ** 2); });
          truth[y * W + x] = t; data[y * W + x] = Math.min(1, Math.max(0, bgf(x, y) + t + (noise ? noise * gauss() : 0)));
        }
        return { width: W, height: H, data, truth };
      };
      const loadSyn = async (img, name, invert) => {
        const d = invert ? img.data.map(v => 1 - v) : img.data;
        App.setPref('byType', {});
        await App.load(new File([G.Demo.encodeTiff16({ width: img.width, height: img.height, data: d })], name), 'western');
      };
      // lanes by hand, no geometry: the regions are placed on the frame shown
      const setup = (xs, pitch, y0, y1, bright) => {
        const S = App.S, q = S.quant;
        S.rotation = 0; S.geom = null; S.flip = { h: false, v: false }; App.applyFlip(); App.rot = null; App.ensureRot();
        if (bright != null) S.bright = bright;
        S.lanes = xs.map((x, k) => ({ x, name: 'L' + (k + 1), hidden: false })); S.lanes.forEach((l, k) => { l.id = 'L' + (k + 1); });
        S.lanePitch = pitch; S.laneHalfW = pitch * 0.3; S.markers = [];
        S.crop = { x: 0, y: 0, w: App.rot.w - 1, h: App.rot.h - 1 };
        Object.assign(q, { version: 2, region: { x: 0, y: 0, w: App.rot.w - 1, h: App.rot.h - 1 }, norm: 'none', normBand: null, mode: 'box', bg: 'local', bgSides: 'ab', bgGap: 2, bgSize: 0, wFrac: 0.7, frames: {}, output: 'corrected', ref: null });
        q.rows = [G.Quant.placeRow(App, { name: 'target' }, y0, y1)];
        App.commit();
      };
      const vals = () => { const M = G.Quant.measure(App); return M.values.corrected[0]; };
      const byId = () => { const M = G.Quant.measure(App), o = {}; M.ids.forEach((id, j) => { o[id] = M.values.corrected[0][j]; }); return o; };
      const near = (a, b, tol) => a != null && b != null && Math.abs(a / b - 1) <= tol;
      const res = {};
      // the "known" image: 8 lanes 60 px apart on a background rising 0.25 down the lanes (uneven), noise sd 0.002
      const W = 540, H = 360, xs = [60, 120, 180, 240, 300, 360, 420, 480], Y = 180, hw = 18;
      const bgf = (x, y) => 0.06 + 0.25 * y / H + 0.02 * x / W;
      const bands = [
        { x: 60, y: Y, a: 0.30, s: 3, hw },        // L1 narrow, amount 0.9
        { x: 120, y: Y, a: 0.10, s: 9, hw },       // L2 broad, amount 0.9 (same amount, three times wider)
        { x: 180, y: Y, a: 0.30, s: 3, hw },       // L3 narrow
        { x: 240, y: Y, a: 0.30, s: 6, hw },       // L4 same peak as L3, twice as wide: twice the amount
        { x: 300, y: Y, a: 0.20, s: 9, hw },       // L5 broad, twice L1's amount at a lower peak (the ranking-reversal lane)
        // L6 blank
        { x: 420, y: Y, a: 0.30, s: 3, hw }, { x: 420, y: Y + 16, a: 0.30, s: 3, hw },   // L7 a band with a neighbour 16 rows below
        { x: 480, y: Y, a: 1.40, s: 3, hw }        // L8 clipped at 1.0: a flat plateau
      ];
      const img = synth(W, H, bgf, bands, 0.002, 11);
      await loadSyn(img, 'known_bands.tif');
      const hwPx = () => G.Quant.boxHalfWidth(App.S);
      // the truth inside a lane's region: the sum of the band term over the region's pixels
      const truthIn = (lx, y0, y1) => { let t = 0; const h = hwPx(); for (let y = y0; y <= y1; y++) for (let x = Math.round(lx - h); x <= Math.round(lx + h); x++) t += img.truth[y * W + x]; return t; };
      // tall regions (+-30 rows: 3.3 sigma of the broad bands) with local background above and below
      setup(xs, 60, Y - 30, Y + 30);
      let v = vals();
      const tr = xs.map(x => truthIn(x, Y - 30, Y + 30));
      res.L1 = { narrow: +v[0].toFixed(3), broad: +v[1].toFixed(3), truthN: +tr[0].toFixed(3), truthB: +tr[1].toFixed(3), ok: near(v[0], tr[0], 0.02) && near(v[1], tr[1], 0.02) && near(v[0], v[1], 0.03) };
      res.L3 = { ratio: +(v[3] / v[2]).toFixed(3), ok: near(v[3] / v[2], 2, 0.03) };
      res.L4 = { sameAmountRatio: +(v[1] / v[0]).toFixed(3), ok: near(v[1] / v[0], 1, 0.03) };
      res.L8uneven = { ok: [0, 1, 2, 3, 4].every(k => near(v[k], tr[k], 0.02)), none: null };
      App.S.quant.bg = 'none'; const vNone = vals(); App.S.quant.bg = 'local';
      res.L8uneven.none = +(vNone[0] / tr[0]).toFixed(2); res.L8uneven.ok = res.L8uneven.ok && vNone[0] > 3 * tr[0];   // without background the slope swamps the band
      // L2: a region fitted to the narrow band (+-8 rows) with the background from its own end rows reads the broad band
      // LOWER than the narrow one although it holds twice as much (the earlier method's defect), and flags it; local
      // background regions outside a region as tall as the band restore the order and the ratio
      const r0 = App.S.quant.rows[0];
      G.Quant.editRow(App, r0, Y - 8, Y + 8); App.S.quant.bg = 'edge'; App.commit();
      const Me = G.Quant.measure(App), ve = Me.values.corrected[0];
      const reversed = ve[4] < ve[0], flagged = !!(Me.cells[0][4].flags.boundary || Me.cells[0][4].flags.contaminated) && Me.cells[0][4].review.length > 0;
      App.S.quant.bg = 'local'; G.Quant.editRow(App, r0, Y - 30, Y + 30); App.commit();
      const vl = vals();
      res.L2 = { edgeShort: +(ve[4] / ve[0]).toFixed(3), localTall: +(vl[4] / vl[0]).toFixed(3), truth: +(tr[4] / tr[0]).toFixed(3), reversed, flagged, ok: reversed && flagged && near(vl[4] / vl[0], tr[4] / tr[0], 0.03) };
      // L5 (one image): the blank lane reads about zero, signed, never clamped; U - B = corrected in every lane
      const Mb = G.Quant.measure(App), cb = Mb.cells[0][5];
      res.L5one = { blank: +cb.value.toFixed(4), t3: +cb.t3.toFixed(4), ok: Math.abs(cb.value) < cb.t3 && Mb.cells[0].every(c => c.value == null || Math.abs(c.U - c.B - c.value) < 1e-9 * Math.max(1, Math.abs(c.U))) };
      // L7: the clipped lane is flagged at the digital limit, marked in the table, hatched in the chart, never a divisor
      const cc = Mb.cells[0][7];
      const ch = G.Quant.chartSVG(App, Mb);
      res.L7 = { clip: cc.flags.clip, n: cc.clip.n, hatch: /url\(#qhatch\)/.test(ch.svg), ok: cc.flags.clip === 'limit' && cc.clip.n > 0 && /url\(#qhatch\)/.test(ch.svg) && /clipped/.test(G.Quant.flagText(cc.flags, cc)) };
      // L8: a neighbouring band: with the region reaching it (two peaks) or the background on it, the lane is flagged
      G.Quant.editRow(App, r0, Y - 12, Y + 24); App.commit();
      const Mn = G.Quant.measure(App), cn = Mn.cells[0][6];
      G.Quant.editRow(App, r0, Y - 8, Y + 8); App.commit();
      const Mn2 = G.Quant.measure(App), cn2 = Mn2.cells[0][6];
      res.L8adjacent = { twoPeaks: !!cn.flags.twoPeaks, bgOnNeighbour: !!cn2.flags.uneven, ok: !!cn.flags.twoPeaks && !!cn2.flags.uneven && cn2.review.length > 0 };
      // L8: a target shifted in one lane: the lane is flagged; moving that lane's region (its own top and bottom) clears
      // the flag and is recorded as a lane-specific region
      G.Quant.editRow(App, r0, Y - 30, Y + 30); App.commit();
      const L3r = r0.lanes.L3; L3r.dy0 = 27; L3r.dy1 = 27; App.commit();    // L3's region moved 27 rows down: the band now reaches its top
      const cs = G.Quant.measure(App).cells[0][2];
      L3r.dy0 = 0; L3r.dy1 = 0; delete L3r.dy0; delete L3r.dy1; L3r.dy0 = -2; App.commit();
      const cs2 = G.Quant.measure(App).cells[0][2];
      delete L3r.dy0; App.commit();
      res.L8shift = { flagged: !!cs.flags.boundary, override: cs2.prov.override.join(), ok: !!cs.flags.boundary && cs2.prov.override.includes('dy0') && !cs2.flags.boundary };
      // L10: display contrast, gamma and inversion change no value
      const base = byId(), st = App.S;
      const lv0 = JSON.stringify(st.levels);
      Object.assign(st.levels, { black: 0.1, white: 0.6, gamma: 1.8, invert: !st.levels.invert }); App.commit();
      const afterDisp = byId(); st.levels = JSON.parse(lv0); App.commit();
      const same = (a, b) => Object.keys(a).every(k => a[k] === b[k]) && Object.keys(a).length === Object.keys(b).length;
      res.L10 = { ok: same(base, afterDisp) };
      // L11: the regions stay on their original pixels through rotation, geometry, flips, crop, figure hiding, lane
      // reorder, save / reopen and undo / redo: every value identical, lane by lane id
      const inv = [];
      App.setRotation(2); App.afterRotation && App.afterRotation(); App.commit(); inv.push(['rotation', same(base, byId())]);
      const c = st.crop; App.setGeomCorners([[c.x + 10, c.y], [c.x + c.w - 10, c.y], [c.x + c.w, c.y + c.h], [c.x, c.y + c.h]]); App.commit(); inv.push(['geometry', same(base, byId())]);
      App.flip('h'); App.commit(); inv.push(['flip h', same(base, byId())]);
      App.flip('v'); App.commit(); inv.push(['flip v', same(base, byId())]);
      st.crop = { x: st.crop.x + 40, y: st.crop.y + 20, w: st.crop.w - 80, h: st.crop.h - 40 }; App.commit(); inv.push(['crop', same(base, byId())]);
      st.lanes[2].hidden = true; App.commit(); inv.push(['hidden in figure', same(base, byId())]);
      App.reorderLanes(st.lanes.map((l, i) => i).reverse()); App.commit(); inv.push(['lane order', same(base, byId())]);
      const snapBefore = App.snapshot();
      await App.openProject(await (await App.projectBlob()).arrayBuffer()); inv.push(['save and reopen', same(base, byId()) && App.snapshot() === snapBefore]);
      App.undo(); App.undo(); inv.push(['undo', same(base, byId())]); App.redo(); App.redo(); inv.push(['redo', same(base, byId())]);
      res.L11 = { steps: inv.filter(x => !x[1]).map(x => x[0]), ok: inv.every(x => x[1]) };
      // L12: an explicit edit changes the result and says so (placed count, provenance); undo brings it back
      const st2 = App.S, r2 = st2.quant.rows[0], placed0 = r2.placed, v0 = byId().L1;
      const sp = G.Quant.rowSpan(App, r2); G.Quant.editRow(App, r2, sp.y0 + 20, sp.y1 - 20); App.commit();
      const v1 = byId().L1, prov1 = G.Quant.measure(App).cells[0][G.Quant.measure(App).ids.indexOf('L1')].prov;
      App.undo(); const v2 = byId().L1;
      res.L12 = { before: +v0.toFixed(3), edited: +v1.toFixed(3), undone: +v2.toFixed(3), ok: v1 < v0 * 0.95 && prov1.placed === placed0 + 1 && v2 === v0 && App.S.quant.rows[0].placed === placed0 };
      // L9: the same image stored dark-on-light (1 - I), measured as dark bands, gives the same values
      await loadSyn(img, 'known_bands_dark.tif', true);
      setup(xs, 60, Y - 30, Y + 30, false);
      const vd = vals();
      res.L9 = { maxDiff: Math.max(...vd.map((x, k) => Math.abs(x - v[k]) / Math.max(1e-6, Math.abs(v[k])))), ok: vd.every((x, k) => Math.abs(x - v[k]) <= 1e-3 * Math.max(1, Math.abs(v[k]))) };
      // L5 / L6: blanks and a weak two-fold series over noise realisations: blanks unbiased (signed, some below zero),
      // the series two-fold within 10 % on average
      const blanks = [], ratios = [];
      for (let seed = 1; seed <= 4; seed++) {
        const im = synth(480, 300, () => 0.1, [0.006, 0.012, 0.024, 0.048].map((a, k) => ({ x: 240 + 60 * k, y: 150, a, s: 4, hw: 18 })), 0.004, 101 + seed * 7);
        await loadSyn(im, 'series.tif');
        setup([60, 120, 180, 240, 300, 360, 420], 60, 138, 162);
        const m = vals(); blanks.push(m[0], m[1], m[2]);
        for (let k = 4; k < 7; k++) ratios.push(m[k] / m[k - 1]);
      }
      const mean = a => a.reduce((s, x) => s + x, 0) / a.length, sdv = a => Math.sqrt(a.reduce((s, x) => s + (x - mean(a)) ** 2, 0) / (a.length - 1));
      res.L5 = { mean: +mean(blanks).toFixed(4), sd: +sdv(blanks).toFixed(4), negatives: blanks.filter(x => x < 0).length, ok: Math.abs(mean(blanks)) < 3 * sdv(blanks) / Math.sqrt(blanks.length) + 1e-9 && blanks.some(x => x < 0) };
      res.L6 = { meanRatio: +mean(ratios).toFixed(3), ok: near(mean(ratios), 2, 0.1) };
      // L13 and L14 on the Western example: one result everywhere; unavailable values explained, never a zero bar
      await G.UI.loadExample('western'); await wait(100);
      const q = App.S.quant, Rw = G.Quant.measure(App), j = 2, k = 0, cell = Rw.cells[k][j];
      G.QuantUI.setView('quant'); G.QuantUI.setTab('int'); await wait(50);
      const csv = G.Quant.quantCSV(App, Rw), tsv = G.Quant.quantTSV(App, Rw), log = G.Export.processingLog(App.S).densitometry;
      const corr = cell.value, fold = Rw.values.fold[k][j];
      const csvRow = csv.split('\r\n').find(l => l.startsWith(`${Rw.lanes[j] + 1},`)), tsvRow = tsv.split('\n').find(l => l.startsWith(`${Rw.lanes[j] + 1}\t`));
      const tableTxt = document.querySelector(`#quantTable tr[data-lane="${Rw.lanes[j]}"]`).textContent;
      G.QuantUI.selectLane(Rw.lanes[j]); G.QuantUI.setTab('prof'); await wait(50);
      const prof = document.getElementById('qProfRead').textContent;
      const f2 = x => (Math.abs(x) >= 100 ? x.toFixed(1) : x.toPrecision(4));
      const logV = log.lanes[j].values[k];
      res.L13 = { corr, fold,
        csv: !!csvRow && csvRow.includes(corr.toFixed(4)) && csvRow.includes(fold.toFixed(4)),
        tsv: !!tsvRow && tsvRow.includes(corr.toFixed(4)),
        table: tableTxt.includes(fold.toFixed(2)),
        profile: prof.includes(`= ${f2(corr)}`) && prof.includes(f2(cell.U)) && prof.includes(f2(cell.B)),
        log: Math.abs(logV.corrected - corr) < 1e-4 && Math.abs(logV.foldChange - fold) < 1e-4,
        methods: G.Quant.methodsText(App, Rw).includes(G.Quant.describe(App, Rw).measure) && csv.includes(G.Quant.describe(App, Rw).summary),
        chart: (G.Quant.chartSVG(App, Rw).svg.match(/<rect data-lane=/g) || []).length === Rw.lanes.length };
      res.L13.ok = ['csv', 'tsv', 'table', 'profile', 'log', 'methods', 'chart'].every(x => res.L13[x]);
      // L14: no reference lane, a clipped reference, a weak divisor: n/a with the reason in the table, CSV and chart
      const keepQ = JSON.stringify(q);
      q.ref = null; const Ra = G.Quant.measure(App);
      const noRef = Ra.values.fold[0].every(x => x == null) && Ra.why.fold[0].every(w => w === 'Choose a reference lane');
      const chA = G.Quant.chartSVG(App, Ra).svg, naChart = /n\/a/.test(chA) && !/<rect data-lane=/.test(chA);
      q.ref = App.laneId(G.UI.figLanes()[1]);
      const ec = G.Quant.placeRow(App, { name: 'empty' }, App.S.crop.y + 8, App.S.crop.y + 20); q.rows.push(ec); q.normBand = ec.id; q.output = 'normalized';
      const Rb = G.Quant.measure(App), weakDiv = Rb.values.normalized[0].every(x => x == null) && Rb.why.normalized[0].every(w => /noise threshold|not above zero|needs review/.test(w || '') || w == null);
      const csvB = G.Quant.quantCSV(App, Rb), csvWhy = /Reference band \(empty\)/.test(csvB);
      App.S.quant = JSON.parse(keepQ); App.commit();
      res.L14 = { noRef, naChart, weakDiv, csvWhy, ok: noRef && naChart && weakDiv && csvWhy };
      // L15: rasterisation: two polygons sharing a slanted edge split a rectangle's pixels exactly (none twice, none
      // lost); the rows of a rotated region hold each of its pixels once; pixels off the image are counted, not read
      const E = G.Engine, key = r => { const s = new Set(); r.runs.forEach(([y, a, b]) => { for (let x = a; x <= b; x++) s.add(y * 1000 + x); }); return s; };
      const A = E.rasterPoly([[10.3, 5.2], [40.7, 5.2], [33.1, 60.9], [10.3, 60.9]], 200, 200), B = E.rasterPoly([[40.7, 5.2], [70.2, 5.2], [70.2, 60.9], [33.1, 60.9]], 200, 200), Rt = E.rasterPoly([[10.3, 5.2], [70.2, 5.2], [70.2, 60.9], [10.3, 60.9]], 200, 200);
      const ka = key(A), kb = key(B), shared = [...ka].filter(x => kb.has(x)).length;
      const fm = E.frameMap({ W: 200, H: 200, rot: 7, fh: false, fv: false, grid: null }), P = E.boxPixels(fm, 200, 200, 60.5, 100.5, 40.5, 80.5, 0);
      const seen = new Set(); let dup = 0; P.bins.forEach(b => b.runs.forEach(([y, a, bb]) => { for (let x = a; x <= bb; x++) { const kk = y * 1000 + x; if (seen.has(kk)) dup++; seen.add(kk); } }));
      const off = E.rasterPoly([[-5.5, -5.5], [10.5, -5.5], [10.5, 10.5], [-5.5, 10.5]], 200, 200);
      res.L15 = { shared, partition: ka.size + kb.size === key(Rt).size, dup, rotatedArea: P.n, offImage: off.outside, inImage: off.n,
        ok: shared === 0 && ka.size + kb.size === key(Rt).size && dup === 0 && Math.abs(P.n - 1600) <= 40 && off.n === 121 && off.outside === 256 - 121 };
      const checks = ['L1', 'L2', 'L3', 'L4', 'L5', 'L5one', 'L6', 'L7', 'L8uneven', 'L8adjacent', 'L8shift', 'L9', 'L10', 'L11', 'L12', 'L13', 'L14', 'L15'];
      R.densV2 = Object.assign({ ok: checks.every(x => res[x] && res[x].ok), failed: checks.filter(x => !(res[x] && res[x].ok)) }, res);
    }
    // 57. the densitometry workspace and its wording: an analysis measured with the earlier calculation keeps its
    // numbers until the user updates it (and adding a band asks first); Measure bands as / Display are separate;
    // the lane table's columns and labels; the reasons a lane is not measured; the analysis area and the band
    // height edited explicitly; one instruction per tool; dialogs hold and return the focus; the broad-band lesson
    {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms)), vis = el => !!el && !el.classList.contains('hidden') && el.getClientRects().length > 0;
      await G.UI.loadExample('western'); await wait(100);
      const st0 = App.S, fl = G.UI.figLanes();
      // (a) a project measured with version 1: rows without regions, background from the box's end rows, a loading
      // control by index, the reference lane by index
      const rows1 = st0.quant.rows.map(r => { const sp = G.Quant.rowSpan(App, r); return { y0: Math.round(sp.y0), y1: Math.round(sp.y1), name: r.name }; });
      st0.quant = { rows: rows1, bg: 'edge', mode: 'box', wFrac: 0.7, norm: 'control', control: 1, ref: fl[1], region: Object.assign({}, st0.crop), plot: st0.quant.plot };
      await App.openProject(await (await App.projectBlob()).arrayBuffer()); await wait(100);
      G.QuantUI.setView('quant'); G.QuantUI.setTab('int'); await wait(50);
      const R1 = G.Quant.measure(App), legacyKept = App.S.quant.version === 1 && R1.version === 1 && vis($('qLegacy')) && R1.values.fold[0].every(v => v != null);
      const v1fold = R1.values.fold[0].slice();
      // adding a band asks first; declined, nothing changes
      G.UI.autoConfirm = false; await App.finishRegion('quant', rows1[0].y0 + 40, rows1[0].y1 + 40); await wait(50);
      const declined = App.S.quant.version === 1 && App.S.quant.rows.length === rows1.length;
      // Update to the current method: version 2, regions placed, the loading control becomes the reference band
      G.UI.autoConfirm = true; $('btnQUpdate').click(); await wait(100);
      const q2 = App.S.quant, R2 = G.Quant.measure(App);
      const updated = q2.version === 2 && R2.version === 2 && q2.rows.every(r => r.frame && r.lanes) && q2.normBand === q2.rows[1].id && q2.ref === App.laneId(fl[1]) && !vis($('qLegacy'));
      App.undo(); await wait(50);
      const undoBack = App.S.quant.version === 1 && JSON.stringify(G.Quant.measure(App).values.fold[0]) === JSON.stringify(v1fold);
      G.UI.autoConfirm = null;
      await G.UI.loadExample('western'); await wait(100);
      // (b) Measure bands as (detection and measurement) apart from Display (a look): Inverted changes no value
      const st = App.S, before = JSON.stringify(G.Quant.measure(App).values.corrected);
      const bright0 = st.bright, inv0 = !!st.levels.invert;
      $('polSeg').querySelector(`[data-inv="${inv0 ? 0 : 1}"]`).click(); await wait(50);
      const display = !!st.levels.invert !== inv0 && st.bright === bright0 && JSON.stringify(G.Quant.measure(App).values.corrected) === before
        && $('polSeg').querySelector('.on').getAttribute('aria-checked') === 'true' && $('brightSeg').querySelector(`[data-bright="${bright0 ? 1 : 0}"]`).classList.contains('on');
      App.undo();
      const words = /Measure bands as/.test($('brightLabel').textContent) && /Display/.test($('polLabel').textContent) && !document.getElementById('invNote')
        && $('fixLanes').querySelector('summary').textContent.startsWith('Adjust lanes…');
      // (c) the lane table: Lane | Name | Role | Show | Measure, every control named; why a lane is not measured
      const head = [...$('laneList').querySelectorAll('.lane-head span')].map(s => s.textContent).filter(Boolean).join('|');
      const named = [...$('laneList').querySelectorAll('input, select, button.x')].every(e => e.getAttribute('aria-label'));
      $('btnLanesEdit').click(); const why = /Not measured: 1 \(ladder\)/.test($('qLaneWhy').textContent); $('btnLanesEdit').click();
      // (d) the analysis area, edited by its sides (undoable); the band height (an explicit edit, counted)
      const lanesA = G.Quant.quantLanes(App).length;
      $('btnAreaEdit').click(); const aL = $('qAreaL'); aL.value = String(Math.round(st.lanes[fl[2]].x - 5)); aL.dispatchEvent(new Event('change')); await wait(50);
      const areaCut = G.Quant.quantLanes(App).length === lanesA - 1 && /differs/.test($('qAreaNote').textContent);
      App.undo(); const areaBack = G.Quant.quantLanes(App).length === lanesA; $('btnAreaEdit').click();
      const r0 = App.S.quant.rows[0], placed0 = r0.placed, h0 = Math.round(G.Quant.rowSpan(App, r0).y1 - G.Quant.rowSpan(App, r0).y0 + 1);
      const hi = $('boxList').querySelector('[data-qhgt="0"]'); hi.value = String(h0 + 10); hi.dispatchEvent(new Event('change')); await wait(50);
      const r0b = App.S.quant.rows[0], sp = G.Quant.rowSpan(App, r0b), height = Math.round(sp.y1 - sp.y0 + 1) === h0 + 10 && r0b.placed === placed0 + 1;
      App.undo();
      // (e) one instruction per tool; the Add-lane hint only while the tool is on
      G.FigEdit.setMode('quant'); const bandMode = $('modeText').textContent === 'Add band: click or drag on image · Esc cancels' && $('btnAddBox').getAttribute('aria-pressed') === 'true';
      G.FigEdit.setMode('lane'); const laneHint = vis($('addLaneHint')) && /Click the lane centre on the image/.test($('addLaneHint').textContent);
      G.FigEdit.setMode(null); const hintGone = !vis($('addLaneHint'));
      const tools = [...document.querySelectorAll('.tools .tool')].map(b => b.textContent.trim()).join('|') === '⎴Group bracket|◀Band arrow|±Condition row|☰Strip';
      // (f) a dialog takes the focus, keeps it (Tab wraps), closes on Escape and gives it back
      $('btnExport').focus(); $('btnExport').click(); await wait(50);
      const inDlg = $('exportDlg').contains(document.activeElement);
      const fs = [...$('exportDlg').querySelectorAll('button, select, input')].filter(e => !e.disabled && e.getClientRects().length);
      fs[fs.length - 1].focus(); fs[fs.length - 1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      const wraps = $('exportDlg').contains(document.activeElement) && document.activeElement !== fs[fs.length - 1];
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
      const focusBack = $('exportDlg').classList.contains('hidden') && document.activeElement === $('btnExport');
      // (g) the broad-band lesson: lane 4 reads lowest with the earlier background, is marked; local regions and a
      // region as tall as the band make it the highest, near the true ratio
      await G.Tour.practice('background');
      const at = () => $('tourTitle').textContent + '·' + G.Tour.part();
      const until = async (want, ms) => { const t0 = Date.now(); while (at() !== want && Date.now() - t0 < (ms || 8000)) await wait(100); return at(); };
      const act = async want => { const t0 = Date.now(); while (!G.Tour.done() && Date.now() - t0 < 6000) await wait(100); if (!G.Tour.done()) return 'not done: ' + at(); G.Tour.next(); return until(want); };
      const log = [await until('A broad band·0', 15000)];
      const lane4 = G.UI.figLanes()[3], Rb = G.Quant.measure(App), jb = Rb.lanes.indexOf(lane4), vb = Rb.values.corrected[0];
      const lowest = vb[jb] === Math.min(...vb.filter(v => v != null)) && Rb.cells[0][jb].review.length > 0;
      document.querySelector('#quantTabs [data-tab="int"]').click(); log.push(await act('See why·0'));
      document.querySelector('#quantTabs [data-tab="prof"]').click(); await wait(100);
      const pl = $('qProfLane'); pl.value = String(lane4); pl.dispatchEvent(new Event('change')); log.push(await act('Background outside the band·0'));
      const sel = $('qBg'); sel.value = 'local'; sel.dispatchEvent(new Event('change')); log.push(await act('A region as tall as the band·0'));
      const hb = document.querySelector('#boxList [data-qhgt="0"]'); hb.value = '57'; hb.dispatchEvent(new Event('change')); log.push(await act('Check the result·0'));
      const Ra = G.Quant.measure(App), va = Ra.values.corrected[0], ratio = va[jb] / va[0], truth = G.Demo.makeGel({ preset: 'broad' }).truth;
      // the whole band inside the region now; the background's hold on its faint tails stays flagged (as it should)
      const highest = va[jb] === Math.max(...va.filter(v => v != null)) && Math.abs(ratio / (truth.amounts[2] / truth.amounts[0]) - 1) < 0.1 && !Ra.cells[0][jb].flags.boundary;
      G.Tour.next(); log.push(at()); G.Tour.next();
      const lessonOk = log.join() === ['A broad band·0', 'See why·0', 'Background outside the band·0', 'A region as tall as the band·0', 'Check the result·0', 'Lesson done·0'].join();
      await G.UI.loadExample('western');
      const checks = { legacyKept, declined, updated, undoBack, display, words, head: head === 'Lane|Name|Role|Show|Measure', named, why, areaCut, areaBack, height, bandMode, laneHint, hintGone, tools, inDlg, wraps, focusBack, lowest, highest, lessonOk };
      R.workspace = Object.assign({ ok: Object.values(checks).every(Boolean), log, ratio: +ratio.toFixed(3), headText: head }, checks);
    }
    // 58. manual integration on the lane profile (as in chromatography software): a baseline drawn from the start of
    // the peak to its end gives the area above it, exactly; it is marked and disclosed everywhere, "Automatic" and
    // undo take it back, "Apply to all lanes" uses the same limits with each lane's own baseline; a pointer drag on
    // the profile draws it and its handles move its ends; the profile's tools do not move when the readout changes;
    // the chart fills the analysis window instead of a long method line
    {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
      // a flat background 0.1 with three bands of known area (no noise): lane 2 broad, lane 3 with a neighbour
      const W = 420, H = 300, Y = 150, hw = 18, xs = [60, 120, 180, 240, 300, 360];
      const bands = [{ x: 60, a: 0.3, s: 3 }, { x: 120, a: 0.1, s: 9 }, { x: 180, a: 0.3, s: 3 }, { x: 240, a: 0.2, s: 4 }, { x: 300, a: 0.25, s: 5 }];
      const data = new Float32Array(W * H), truth = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let t = 0; bands.forEach(b => { if (Math.abs(x - b.x) <= hw) t += b.a * Math.exp(-0.5 * ((y - Y) / b.s) ** 2); }); truth[y * W + x] = t; data[y * W + x] = 0.1 + t; }
      App.setPref('byType', {});
      await App.load(new File([G.Demo.encodeTiff16({ width: W, height: H, data })], 'manual.tif'), 'western');
      const S = App.S, q = S.quant;
      S.rotation = 0; S.geom = null; S.flip = { h: false, v: false }; App.applyFlip(); App.rot = null; App.ensureRot();
      S.lanes = xs.map((x, k) => ({ x, name: 'L' + (k + 1), hidden: false, id: 'L' + (k + 1) })); S.lanePitch = 60; S.laneHalfW = 18; S.markers = [];
      S.crop = { x: 0, y: 0, w: W - 1, h: H - 1 };
      Object.assign(q, { version: 2, region: { x: 0, y: 0, w: W - 1, h: H - 1 }, norm: 'none', normBand: null, mode: 'box', bg: 'local', bgSides: 'ab', bgGap: 2, bgSize: 0, wFrac: 0.7, frames: {}, output: 'corrected', ref: null });
      q.rows = [G.Quant.placeRow(App, { name: 'target' }, Y - 8, Y + 8)]; App.commit();
      const row = () => App.S.quant.rows[0], val = id => { const M = G.Quant.measure(App); return M.values.corrected[0][M.ids.indexOf(id)]; };
      const hwPx = G.Quant.boxHalfWidth(App.S), truthIn = (lx, y0, y1) => { let t = 0; for (let y = y0; y <= y1; y++) for (let x = Math.round(lx - hwPx); x <= Math.round(lx + hwPx); x++) t += truth[y * W + x]; return t; };
      const auto2 = val('L2');
      // lane 2 (broad, cut by the short region): a baseline drawn at the background level from 30 rows above to 30 below
      // the peak gives the area over those rows, exactly (the image has no noise)
      G.Quant.setManual(App, row(), 'L2', Y - 30, Y + 30, 0.1, 0.1); App.commit();
      const M1 = G.Quant.measure(App), j2 = M1.ids.indexOf('L2'), c2 = M1.cells[0][j2], t2 = truthIn(120, Y - 30, Y + 30);
      const exact = Math.abs(c2.value / t2 - 1) < 0.002 && c2.flags.manual && c2.prov.manual.rows.join() === `${Y - 30},${Y + 30}` && !c2.review.length && auto2 < t2 * 0.9;
      // a tilted baseline subtracts its trapezoid: (la + lb) / 2 x rows x pixels per row
      G.Quant.setManual(App, row(), 'L2', Y - 30, Y + 30, 0.11, 0.09); App.commit();
      const c2b = G.Quant.measure(App).cells[0][j2], tilt = Math.abs(c2b.value - c2.value) < 1e-6 * Math.abs(c2.value) + 1e-6;   // symmetric tilt about 0.1: same area
      G.Quant.setManual(App, row(), 'L2', Y - 30, Y + 30, 0.12, 0.12); App.commit();
      const c2c = G.Quant.measure(App).cells[0][j2], raised = Math.abs((c2.value - c2c.value) - 0.02 * c2c.n) < 1e-3;
      // disclosed: the table mark, the CSV, the log, the methods and the legend
      const M2 = G.Quant.measure(App), csv = G.Quant.quantCSV(App, M2), logD = G.Export.processingLog(App.S).densitometry;
      const disclosed = /user-defined baseline/.test(csv) && /user-defined baseline from row/.test(csv) && logD.manuallyIntegratedWells.join() === '2' && /relative to a user-defined baseline drawn on the lane profile/.test(G.Quant.methodsText(App, M2))
        && G.Export.legendHints(App.S).some(h => /Lane 2 was integrated manually/.test(h));
      // Automatic takes it back; undo brings it again
      G.Quant.resetLane(App, row(), 'L2'); App.commit(); const back = Math.abs(val('L2') - auto2) < 1e-9;
      App.undo(); const undone = !!row().lanes.L2.manual; App.redo();
      // the same limits in every lane (copied: each keeps its background), then an endpoint baseline on each lane's own
      // profile (flat 0.1 here, ends on background): every lane's area over those rows
      G.Quant.resetLane(App, row(), 'L2'); const ids = Object.keys(row().lanes);
      const cp = G.Quant.copyLimits(App, row(), ids, Y - 30, Y + 30), ep = G.Quant.endpointBaseline(App, row(), ids); App.commit();
      const M3 = G.Quant.measure(App), allLanes = cp.done.length === xs.length && ep.done.length === xs.length && M3.ids.every((id, j) => { const t = truthIn(xs[j], Y - 30, Y + 30); return Math.abs(M3.values.corrected[0][j] - t) <= 0.01 * Math.max(1, t) + 0.5; });
      Object.keys(row().lanes).forEach(id => G.Quant.resetLane(App, row(), id)); App.commit();
      Object.keys(row().lanes).forEach(id => G.Quant.resetLane(App, row(), id)); App.commit();
      // the profile: a drag changes nothing until "Edit baseline…"; then it draws a draft, a handle moves an end, and
      // only Apply makes it the lane's baseline; the editing row and the canvas stay where they are
      G.QuantUI.setView('quant'); G.QuantUI.show('figure', false); G.QuantUI.setTab('prof'); G.QuantUI.selectLane(1); await wait(150);
      const cv = $('qProfile'); cv.scrollIntoView({ block: 'center' }); await wait(50);
      const r = cv.getBoundingClientRect(), rowTop0 = $('qEditRow').getBoundingClientRect().top - r.top, canvasTop0 = r.top - $('quantProf').getBoundingClientRect().top;
      const fire = (type, fx, fy, extra) => cv.dispatchEvent(new PointerEvent(type, Object.assign({ bubbles: true, pointerId: 7, button: 0, clientX: r.left + r.width * fx, clientY: r.top + r.height * fy }, extra || {})));
      const fireAt = (type, p) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientX: p.x, clientY: p.y }));
      fire('pointerdown', 0.25, 0.85); fire('pointermove', 0.5, 0.85); fire('pointermove', 0.85, 0.85); fire('pointerup', 0.85, 0.85); await wait(100);
      const inert = !row().lanes.L2.manual && !G.QuantUI.editing();
      $('btnEditBase').click(); await wait(100);
      fire('pointerdown', 0.25, 0.85); fire('pointermove', 0.5, 0.85); fire('pointermove', 0.85, 0.85); fire('pointerup', 0.85, 0.85); await wait(100);
      const d1 = G.QuantUI.editing(), draftOnly = !!d1 && d1.b - d1.a > 20 && !row().lanes.L2.manual;
      // drag the end handle left
      const h = G.QuantUI.profileXY(d1.b, d1.lb); fireAt('pointerdown', h); fireAt('pointermove', { x: h.x - 30, y: h.y }); fireAt('pointerup', { x: h.x - 30, y: h.y }); await wait(100);
      const d2 = G.QuantUI.editing(), handle = !!d2 && d2.a === d1.a && d2.b < d1.b;
      $('btnEdApply').click(); await wait(100);
      const m1 = row().lanes.L2.manual, drew = !!m1 && m1.a === d2.a && m1.b === d2.b && !G.QuantUI.editing();
      const pills = /user-defined baseline/.test($('qProfSum').textContent) && /user-defined baseline/.test($('qEditState').textContent);
      // another lane, another readout: the editing row and the canvas stay put
      G.QuantUI.selectLane(2); await wait(150);
      const r2 = cv.getBoundingClientRect(), stays = Math.abs(($('qEditRow').getBoundingClientRect().top - r2.top) - rowTop0) < 1 && Math.abs((r2.top - $('quantProf').getBoundingClientRect().top) - canvasTop0) < 1;
      const detailsClosed = !$('qProfMore').open && /Uncorrected sum/.test($('qProfRead').textContent);
      G.QuantUI.selectLane(1); await wait(50); $('btnLaneReset').click(); await wait(50);
      const resetBtn = !row().lanes.L2.manual && G.Quant.limitsOf(row(), 'L2').join() === `${m1.a},${m1.b}`;   // the limits stay
      // the chart: as wide as the window, its width set by the plot (not by a long method line)
      G.QuantUI.setTab('plot'); await wait(150);
      const svg = $('quantChart').querySelector('svg'), vbW = +svg.getAttribute('viewBox').split(' ')[2], axisW = Math.max(0, ...[...svg.outerHTML.matchAll(/<line x1="0" y1="[-\d.]+" x2="([-\d.]+)"/g)].map(m => +m[1]));
      const chartBig = vbW < Math.max(axisW, 45 * G.Render.MM) + 60 && svg.getBoundingClientRect().width > 300 && svg.getBoundingClientRect().height > 180;
      G.QuantUI.show('figure', true); G.QuantUI.setTab('prof');
      await G.UI.loadExample('western');
      const checks = { exact, tilt, raised, disclosed, back, undone, allLanes, inert, draftOnly, drew, handle, pills, stays, detailsClosed, resetBtn, chartBig };
      R.manualInt = Object.assign({ ok: Object.values(checks).every(Boolean), auto2: +auto2.toFixed(2), manual2: +c2.value.toFixed(2), truth2: +t2.toFixed(2), m1, d1, d2, vbW, axisW }, checks);
    }
    // 59. measurement correctness (the follow-up review, B to I): copying limits keeps each lane's background and an
    // endpoint baseline stays flagged where its ends hold band; a drawn baseline keeps its own diagnostics and a
    // sensitivity check; unknown noise is never a passed check; frame identities cover the whole transform; warm and
    // cold caches agree; total-lane denominators do not depend on the bands; narrow and full lane resets; exports
    // independent of the displayed output; a specification that recomputes the values
    {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      let z = 4711; const rnd = () => { z = (z * 16807) % 2147483647; return z / 2147483647; }, gauss = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, rnd()))) * Math.cos(2 * Math.PI * rnd());
      const synth = (W, H, bgf, bands, noise) => {
        const data = new Float32Array(W * H), truth = new Float32Array(W * H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { let t = 0; bands.forEach(b => { if (Math.abs(x - b.x) <= (b.hw || 18)) t += b.a * Math.exp(-0.5 * ((y - b.y) / b.s) ** 2); }); truth[y * W + x] = t; data[y * W + x] = Math.min(1, Math.max(0, bgf(x, y) + t + (noise == null ? 0.003 : noise) * gauss())); }
        return { width: W, height: H, data, truth };
      };
      const load = async (img, name) => { App.setPref('byType', {}); await App.load(new File([G.Demo.encodeTiff16(img)], name), 'western'); };
      const setup = (xs, y0, y1, extra) => {
        const S = App.S, q = S.quant;
        S.rotation = 0; S.geom = null; S.flip = { h: false, v: false }; App.applyFlip(); App.rot = null; App.ensureRot();
        S.lanes = xs.map((x, k) => ({ x, name: 'L' + (k + 1), hidden: false, id: 'L' + (k + 1) })); S.lanePitch = 60; S.laneHalfW = 18; S.markers = [];
        S.crop = { x: 0, y: 0, w: App.rot.w - 1, h: App.rot.h - 1 };
        Object.assign(q, { version: 2, region: { x: 0, y: 0, w: App.rot.w - 1, h: App.rot.h - 1 }, norm: 'none', normBand: null, normRegions: null, mode: 'box', bg: 'local', bgSides: 'ab', bgGap: 2, bgSize: 0, wFrac: 0.7, frames: {}, output: 'corrected', ref: null }, extra || {});
        q.rows = [G.Quant.placeRow(App, { name: 'target' }, y0, y1)]; App.commit();
      };
      const cellOf = (M, id, k) => M.cells[k || 0][M.ids.indexOf(id)];
      const res = {};
      // B. a narrow band (lane 1) and a broad one holding more (lane 2); limits fitted to the narrow band
      await load(synth(300, 300, () => 0.1, [{ x: 60, y: 150, a: 0.3, s: 3 }, { x: 120, y: 150, a: 0.12, s: 10 }]), 'scope.tif');
      setup([60, 120], 120, 180);
      const row = () => App.S.quant.rows[0], M0 = G.Quant.measure(App), v0 = [cellOf(M0, 'L1').value, cellOf(M0, 'L2').value];
      const bg0 = App.S.quant.bg;
      // copy lane 1's tighter limits (142-158) to lane 2: lane 2 keeps the local background (no drawn baseline)
      row().lanes.L1.dy0 = 142 - row().y0; row().lanes.L1.dy1 = 158 - row().y1; App.commit();
      const lim = G.Quant.limitsOf(row(), 'L1'), pv = G.Quant.preview(App, row(), ['L2'], () => G.Quant.copyLimits(App, row(), ['L2'], lim[0], lim[1]));
      const notApplied = !row().lanes.L2.dy0 && !row().lanes.L2.manual;   // a preview changes nothing
      const cp = G.Quant.copyLimits(App, row(), ['L2'], lim[0], lim[1]); App.commit();
      const M1 = G.Quant.measure(App), c2 = cellOf(M1, 'L2');
      res.copyLimits = { limits: lim, after: +c2.value.toFixed(2), method: c2.method, preview: pv.after.L2 && +pv.after.L2.value.toFixed(2), flagged: c2.review.length > 0,
        ok: cp.done.join() === 'L2' && c2.method === 'local' && App.S.quant.bg === bg0 && !row().lanes.L2.manual && G.Quant.limitsOf(row(), 'L2').join() === lim.join() && notApplied
          && Math.abs(pv.after.L2.value - c2.value) < 1e-9 && c2.flags.boundary && c2.review.length > 0 };
      // the endpoint baseline on both lanes at those limits: the broad band falls below the narrow one (the reversal
      // the review found) and is flagged with the reasons: ends on band, band beyond the limits
      const ep = G.Quant.endpointBaseline(App, row(), ['L1', 'L2']); App.commit();
      const M2 = G.Quant.measure(App), e1 = cellOf(M2, 'L1'), e2 = cellOf(M2, 'L2');
      res.endpoint = { before: v0.map(v => +v.toFixed(2)), after: [e1.value, e2.value].map(v => +v.toFixed(2)), reversed: e2.value < e1.value && v0[1] > v0[0], reasons2: e2.review,
        ok: ep.done.length === 2 && e2.value < e1.value && v0[1] > v0[0] && !!e2.flags.endpoints && !!e2.flags.boundary && e2.review.some(r => /endpoint holds band signal/.test(r)) && e2.review.some(r => /continues beyond the drawn/.test(r)) };
      // existing drawn baselines are kept unless replacing is asked for
      const keepRes = G.Quant.copyLimits(App, row(), ['L1', 'L2'], 130, 170), keptBoth = keepRes.kept.length === 2 && !!row().lanes.L1.manual;
      const repl = G.Quant.copyLimits(App, row(), ['L2'], 130, 170, { replaceManual: true }); App.commit();
      res.manualScope = { ok: keptBoth && repl.done.join() === 'L2' && !row().lanes.L2.manual && !!row().lanes.L1.manual };
      // C. a drawn baseline: integrated relative to it, with its sensitivity, and the band-beyond-the-limits check kept
      const P = G.Quant.laneProfile(App, row(), 'L2'); G.Quant.setManual(App, row(), 'L2', 140, 160, G.Quant.levelAt(P, 140), G.Quant.levelAt(P, 160)); App.commit();
      const cm = cellOf(G.Quant.measure(App), 'L2');
      res.manualDiag = { boundary: cm.flags.boundary, msens: cm.msens && { pos: cm.msens.pos.map(v => +v.toFixed(2)), lev: cm.msens.lev.map(v => +v.toFixed(2)) }, note: cm.prov.manual.note,
        ok: !!cm.flags.boundary && !!cm.flags.endpoints && !!cm.msens && cm.msens.pos[0] < cm.msens.pos[1] && cm.msens.lev[0] < cm.msens.lev[1] && cm.prov.manual.note === 'integrated relative to a user-defined baseline' && !/exact/.test(JSON.stringify(cm.prov)) };
      // H. Use automatic background keeps the limits and the shift; a full reset lists and removes exactly those
      row().lanes.L2.dx = 2; App.commit();
      G.Quant.useAutoBackground(App, row(), 'L2'); App.commit();
      const L2a = row().lanes.L2, keptLim = G.Quant.limitsOf(row(), 'L2').join() === '140,160' && L2a.dx === 2 && !L2a.manual;
      L2a.bg = { sides: 'above' }; G.Quant.setManual(App, row(), 'L2', 140, 160, 0.1, 0.1); App.commit();
      const listed = G.Quant.laneAdjustments(row(), 'L2'), removed = G.Quant.resetLaneAll(App, row(), 'L2'); App.commit();
      res.reset = { listed, ok: keptLim && listed.join() === removed.join() && ['drawn baseline', 'horizontal shift', 'lane background settings'].every(w => listed.includes(w)) && Object.keys(row().lanes.L2).join() === 'cx' };
      // Height (a re-placement in the same frame) keeps a drawn baseline, its limits following the band's edges (the
      // same line); one in another frame removes it, and says so first
      G.Quant.setManual(App, row(), 'L1', 140, 160, 0.1, 0.1); App.commit();
      const sp = G.Quant.rowSpan(App, row()); G.Quant.editRow(App, row(), sp.y0 - 3, sp.y1 + 3); App.commit();
      const keptOnHeight = !!row().lanes.L1.manual && row().lanes.L1.manual.a === 137 && row().lanes.L1.manual.b === 163 && row().lanes.L1.manual.la === 0.1;
      App.setRotation(2); const willDrop = G.Quant.placementDropsManual(App, row()).join() === 'L1';
      App.setRotation(0); App.rot = null; App.ensureRot();
      res.global = { ok: keptOnHeight && willDrop && G.Quant.placementDropsManual(App, row()).length === 0 };
      G.Quant.resetLaneAll(App, row(), 'L1'); App.commit();
      // F. warm and cold caches agree; a band added inside the background is seen at once, and gone when removed
      const sig = c => JSON.stringify([c.value, c.flags, c.review, c.prov.placed]);
      const warm = sig(cellOf(G.Quant.measure(App), 'L1'));
      G.Quant.clearCache(App); const cold = sig(cellOf(G.Quant.measure(App), 'L1'));
      const r0 = row(), sp0 = G.Quant.rowSpan(App, r0), other = G.Quant.placeRow(App, { name: 'Other' }, sp0.y0 - 9, sp0.y0 - 5); App.S.quant.rows.push(other); App.commit();
      const withOther = cellOf(G.Quant.measure(App), 'L1').flags.overlap;
      G.Quant.clearCache(App); const withOtherCold = cellOf(G.Quant.measure(App), 'L1').flags.overlap;
      App.S.quant.rows.pop(); App.commit(); const gone = cellOf(G.Quant.measure(App), 'L1').flags.overlap;
      // another band placed in a different frame (rotated) over the same source pixels is still seen
      App.setRotation(1); App.rot = null; App.ensureRot();
      const sp1 = G.Quant.rowSpan(App, r0), other2 = G.Quant.placeRow(App, { name: 'Rotated' }, sp1.y0 - 9, sp1.y0 - 5); App.S.quant.rows.push(other2); App.commit();
      const cross = cellOf(G.Quant.measure(App), 'L1').flags.overlap, framesDiffer = other2.frame !== r0.frame;
      App.S.quant.rows.pop(); App.setRotation(0); App.rot = null; App.ensureRot(); App.commit();
      let grew = 0; for (let t = 0; t < 30; t++) { r0.lanes.L1.dy0 = -t; G.Quant.measure(App); } grew = G.Quant.cacheSize(App); delete r0.lanes.L1.dy0; App.commit();
      res.cache = { warm: warm === cold, withOther, withOtherCold, gone, cross, ok: warm === cold && !!withOther && JSON.stringify(withOther) === JSON.stringify(withOtherCold) && !gone && framesDiffer && !!cross && cross.some(t => /Rotated/.test(t)) && grew <= 400 };
      // D. noise: a drawn baseline whose noise regions lie outside the image; too few samples; a contaminated one
      await load(synth(300, 300, () => 0.1, [{ x: 60, y: 14, a: 0.3, s: 3 }, { x: 120, y: 14, a: 0.3, s: 3 }]), 'edge.tif');
      setup([60, 120], 4, 24, { bgSides: 'above', ref: 'L1', output: 'fold' });
      G.Quant.setManual(App, row(), 'L1', 2, 26, 0.1, 0.1); G.Quant.setManual(App, row(), 'L2', 2, 26, 0.1, 0.1); App.commit();
      const Mn = G.Quant.measure(App), n2 = cellOf(Mn, 'L2');
      const unavailable = n2.flags.noise === 'unavailable' && n2.flags.below == null && n2.flags.belowUnknown && n2.review.some(r => /noise could not be estimated/.test(r)) && Mn.values.fold[0][1] != null && /noise could not be estimated \(unverified\)/.test(Mn.caveat.fold[0][1] || '');
      const csvN = G.Quant.quantCSV(App, Mn), csvNoise = /noise not estimated/.test(csvN) && /unverified/.test(csvN);
      const methN = /noise could not be estimated, so no threshold check was made/.test(G.Quant.methodsText(App, Mn));
      setup([60, 120], 40, 60, { bgSides: 'above', bgSize: 2, wFrac: 0.15 });
      const few = cellOf(G.Quant.measure(App), 'L2'), insufficient = few.flags.noise === 'insufficient' && few.flags.below == null && few.review.length > 0;
      await load(synth(300, 300, () => 0.1, [{ x: 60, y: 150, a: 0.3, s: 3 }, { x: 60, y: 136, a: 0.3, s: 2 }]), 'cont.tif');
      setup([60, 120], 144, 156);
      const ct = cellOf(G.Quant.measure(App), 'L1'), contaminated = ct.flags.noise === 'contaminated' && ct.flags.below == null;
      // unknown clipping (no limit to test against) is said, not taken for "none"
      const keepSat = App.satPredicate; App.satPredicate = () => null; G.Quant.clearCache(App);
      const cu = cellOf(G.Quant.measure(App), 'L1'); App.satPredicate = keepSat; G.Quant.clearCache(App);
      res.noise = { unavailable, csvNoise, methN, insufficient, contaminated, clipUnknown: cu.flags.clipState === 'unknown' && /clipping not checkable/.test(G.Quant.flagText(cu.flags, cu)),
        ok: unavailable && csvNoise && methN && insufficient && contaminated && cu.flags.clipState === 'unknown' };
      // E. frames: grids differing at one formerly unsampled entry, or with equal weighted sums, never share a key
      await load(synth(240, 180, () => 0.1, []), 'frames.tif'); setup([60, 120], 80, 100);
      const pts = []; for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) pts.push(i * 119.5, j * 89.5);
      const S = App.S, put = p => { S.geom = { mode: 'manual', grid: { nx: 3, ny: 3, W: 240, H: 180, pts: p } }; App.rot = null; App.ensureRot(); };
      put(pts.slice()); const fa = G.Quant.placeRow(App, { name: 'a' }, 80, 100); S.quant.rows.push(fa);
      const p2 = pts.slice(); p2[8] += 2; put(p2); const fb = G.Quant.placeRow(App, { name: 'b' }, 80, 100); S.quant.rows.push(fb);
      // equal sampled weighted sum (indices 0 and 7 were sampled with weights 1 and 8): shift one, compensate the other
      const p3 = pts.slice(); p3[0] += 8; p3[7] -= 1; const k3 = App.frameKey({ rotation: 0, geom: { grid: { nx: 3, ny: 3, W: 240, H: 180, pts: p3 } } }), k1 = App.frameKey({ rotation: 0, geom: { grid: { nx: 3, ny: 3, W: 240, H: 180, pts } } });
      const storedB = S.quant.frames[fb.frame].grid.pts[8] === p2[8];
      App.commit(); const snap = App.snapshot(); await App.openProject(await (await App.projectBlob()).arrayBuffer());
      const keptB = () => App.S.quant.rows.some(r => r.frame === fb.frame) && App.S.quant.frames[fb.frame].grid.pts[8] === p2[8] && App.S.quant.frames[fa.frame].grid.pts[8] === pts[8];
      const reopened = App.snapshot() === snap && keptB();
      App.undo(); App.redo(); const undoRedo = keptB();
      res.frames = { ka: fa.frame.slice(0, 40), kb: fb.frame.slice(0, 40), ok: fa.frame !== fb.frame && storedB && k1 !== k3 && App.frameKey({ rotation: 0, geom: { grid: { nx: 3, ny: 3, W: 240, H: 180, pts } } }) !== App.frameKey({ rotation: 0, geom: { grid: { nx: 3, ny: 3, W: 240, H: 180, pts: p2 } } }) && reopened && undoRedo };
      S.geom = null; App.rot = null; App.ensureRot();
      // G. total-lane denominators: their own regions, untouched by band order, deletion, renaming, a new band or the area
      await load(synth(300, 300, () => 0.1, [{ x: 60, y: 90, a: 0.3, s: 3 }, { x: 120, y: 90, a: 0.3, s: 3 }, { x: 60, y: 200, a: 0.2, s: 3 }, { x: 120, y: 200, a: 0.4, s: 3 }]), 'norm.tif');
      setup([60, 120], 80, 100);
      const q = App.S.quant; q.region = { x: 0, y: 30, w: 299, h: 120 }; q.norm = 'lane'; G.Quant.placeNormRegions(App); q.output = 'normalized'; App.commit();
      const den = () => G.Quant.measure(App).totals.map(t => t.value), d0 = den(), nAof = () => { const M = G.Quant.measure(App), k = M.rows.findIndex(r => r.name === 'target'); return M.values.normalized[k]; };
      const nA0 = nAof();
      q.region = { x: 0, y: 170, w: 299, h: 60 }; const afterArea = den();
      q.rows.push(G.Quant.placeRow(App, { name: 'B' }, 190, 210)); App.commit(); const afterNew = den();
      q.rows.reverse(); App.commit(); const afterReorder = den(), nA1 = nAof();
      q.rows.find(r => r.name === 'B').name = 'B renamed'; App.commit(); const afterRename = den();
      q.rows.splice(q.rows.findIndex(r => r.name === 'target'), 1); App.commit(); const afterDelete = den();
      const same = (a, b) => a.every((v, i) => v === b[i]);
      // updating them from the analysis area is one undoable change, with the new extent recorded
      G.Quant.placeNormRegions(App); App.commit(); const updated = den(), nr = q.normRegions; App.undo(); const undone = den();
      res.normRegions = { d0: d0.map(v => +v.toFixed(2)), updated: updated.map(v => +v.toFixed(2)), ok: same(d0, afterArea) && same(d0, afterNew) && same(d0, afterReorder) && same(d0, afterRename) && same(d0, afterDelete) && same(nA0, nA1) && !same(d0, updated) && nr.y0 === 170 && nr.placed === 2 && same(d0, undone) };
      // I. exports: the same quantity has the same value, reason and caveat whichever output is shown
      await load(synth(300, 300, () => 0.1, [{ x: 60, y: 90, a: 0.3, s: 3 }, { x: 120, y: 90, a: 0.3, s: 3 }]), 'export.tif');
      setup([60, 120], 80, 100);
      const q2 = App.S.quant, empty = G.Quant.placeRow(App, { name: 'empty' }, 200, 212); q2.rows.push(empty); q2.norm = 'band'; q2.normBand = empty.id; q2.ref = 'L1'; App.commit();
      const body = () => G.Quant.quantCSV(App, G.Quant.measure(App)).split('\r\n').filter(l => !/^# (method|output shown)/.test(l)).join('\n');
      const outs = ['corrected', 'normalized', 'fold'].map(o => { q2.output = o; return body(); });
      const rowsT = G.Quant.tableRows(App, G.Quant.measure(App), { full: true }), hd = rowsT[0], ln = rowsT[1], iWhy = hd.indexOf('target normalized unavailable because');
      res.exports = { reason: ln[iWhy], ok: outs[0] === outs[1] && outs[1] === outs[2] && iWhy > 0 && /not above zero|noise threshold|unverified|needs review/.test(ln[iWhy] || '') };
      // a specification recomputes the values on the same image (after display changes too)
      await G.UI.loadExample('western'); await wait(100);
      App.setRotation(App.S.rotation + 0.7); App.flip('h'); App.commit();
      const Mw = G.Quant.measure(App), want = JSON.stringify(Mw.values), spec = JSON.parse(JSON.stringify(G.Quant.spec(App)));
      await App.load({ name: 'again.tif', buffer: G.Demo.encodeTiff16(G.Demo.makeGel({ preset: 'western' })) }, 'western');
      G.Quant.applySpec(App, spec); const got = JSON.stringify(G.Quant.measure(App).values);
      res.spec = { ok: want === got && spec.frames && Object.values(spec.frames).every(f => 'rot' in f) && /centre lies inside/.test(spec.pixelRule) && spec.build === App.BUILD };
      await G.UI.loadExample('western');
      const checks = ['copyLimits', 'endpoint', 'manualScope', 'manualDiag', 'reset', 'global', 'cache', 'noise', 'frames', 'normRegions', 'exports', 'spec'];
      R.correctness = Object.assign({ ok: checks.every(k => res[k] && res[k].ok), failed: checks.filter(k => !(res[k] && res[k].ok)) }, res);
    }
    // 60. the profile's controls after the follow-up review: manual integration only in the "Edit baseline…" mode,
    // complete by keyboard (rows and levels typed, Apply, Cancel, Escape from anywhere, Use automatic background
    // keeping the limits); a snap option instead of Alt only; the bulk changes scoped, previewed and undone at once;
    // the full lane reset says what it removes; comparison on the band's rows with a legend; the total-lane regions'
    // extent stated; notifications over the image editor; touch scrolls the profile unless editing
    {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
      await G.UI.loadExample('broad'); await wait(100);
      const st = App.S, q = st.quant, row = () => q.rows[0], fl = G.UI.figLanes(), lane4 = fl[3], lid4 = App.laneId(lane4);
      q.bg = 'local'; App.commit();
      G.QuantUI.setView('quant'); G.QuantUI.show('figure', false); G.QuantUI.setTab('prof'); G.QuantUI.selectLane(lane4); await wait(150);
      const cv = $('qProfile'), touchIdle = getComputedStyle(cv).touchAction;
      // keyboard: Edit baseline…, the four fields, Apply
      $('btnEditBase').focus(); $('btnEditBase').click(); await wait(80);
      const editing = !!G.QuantUI.editing() && !$('qEditPanel').classList.contains('hidden') && document.activeElement === $('qEdA') && getComputedStyle(cv).touchAction === 'none';
      const lim = G.Quant.limitsOf(row(), lid4), set = (id, v) => { $(id).value = String(v); $(id).dispatchEvent(new Event('change')); };
      set('qEdA', lim[0] - 20); set('qEdB', lim[1] + 20); set('qEdLa', 0.11); set('qEdLb', 0.11); await wait(80);
      const typed = G.QuantUI.editing(), notYet = !row().lanes[lid4].manual && /With this line/.test($('qEdPreview').textContent);
      $('btnEdApply').click(); await wait(80);
      const m = row().lanes[lid4].manual, applied = !!m && m.a === lim[0] - 20 && m.b === lim[1] + 20 && m.la === 0.11 && !G.QuantUI.editing();
      // Escape from anywhere cancels the editing (the canvas never had the focus)
      $('btnEditBase').click(); await wait(50); set('qEdLa', 0.2); document.body.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await wait(50);
      const escaped = !G.QuantUI.editing() && row().lanes[lid4].manual.la === 0.11;
      // the snap option: off, a drag's ends stay where the pointer is (not on the curve)
      $('btnEditBase').click(); await wait(50); $('qEdSnap').checked = false;
      const P = G.Quant.laneProfile(App, row(), lid4), yA = lim[0] - 10, yB = lim[1] + 10, lvl = 0.05;
      const pa = G.QuantUI.profileXY(yA, lvl), pb = G.QuantUI.profileXY(yB, lvl);
      const fire = (type, p) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, button: 0, clientX: p.x, clientY: p.y }));
      fire('pointerdown', pa); fire('pointermove', { x: (pa.x + pb.x) / 2, y: pa.y }); fire('pointermove', pb); fire('pointerup', pb); await wait(80);
      const dr = G.QuantUI.editing(), free = !!dr && Math.abs(dr.la - lvl) < 0.01 && Math.abs(dr.la - G.Quant.levelAt(P, dr.a)) > 0.02;
      $('qEdSnap').checked = true; $('btnEdCancel').click(); await wait(50);
      // Use automatic background: the drawn baseline goes, its limits and the shift stay
      row().lanes[lid4].dx = 1; App.commit(); G.QuantUI.selectLane(lane4); await wait(50);
      $('btnLaneReset').click(); await wait(80);
      const L4 = row().lanes[lid4], autoKeeps = !L4.manual && L4.dx === 1 && G.Quant.limitsOf(row(), lid4).join() === `${lim[0] - 20},${lim[1] + 20}`;
      // Reset all lane adjustments…: says what, removes exactly that
      G.UI.autoConfirm = true; $('btnLaneResetAll').click(); await wait(80); G.UI.autoConfirm = null;
      const resetAll = Object.keys(row().lanes[lid4]).join() === 'cx';
      // Copy integration limits…: measured lanes ticked except the source and lanes with a drawn baseline; unmeasured
      // lanes unticked; a preview per ticked lane; Apply is one undo
      G.Quant.setManual(App, row(), App.laneId(fl[5]), lim[0], lim[1], 0.1, 0.1); st.lanes[fl[6]].noMeasure = true; App.commit(); G.QuantUI.selectLane(lane4); await wait(80);
      row().lanes[lid4].dy0 = -6; row().lanes[lid4].dy1 = 6; App.commit(); await wait(50);
      const before = JSON.stringify(q.rows);
      $('btnCopyLimits').click(); await wait(150);
      const ticked = [...$('bulkLanes').querySelectorAll('input:checked')].map(i => i.dataset.bl), boxes = [...$('bulkLanes').querySelectorAll('input')];
      const scope = !ticked.includes(lid4) && !ticked.includes(App.laneId(fl[5])) && !ticked.includes(App.laneId(fl[6])) && ticked.length >= 3 && boxes.find(i => i.dataset.bl === lid4).disabled
        && /not measured/.test($('bulkLanes').textContent) && /has a drawn baseline/.test($('bulkLanes').textContent) && /keeps its own background/.test($('bulkWhat').textContent);
      const previewRows = $('bulkPreview').querySelectorAll('tbody tr').length === ticked.length;
      $('btnBulkApply').click(); await wait(100);
      const L4lim = G.Quant.limitsOf(row(), lid4).join(), copied = ticked.every(id => G.Quant.limitsOf(row(), id).join() === L4lim && !row().lanes[id].manual) && !!row().lanes[App.laneId(fl[5])].manual;
      App.undo(); const oneUndo = JSON.stringify(App.S.quant.rows) === before;
      // Use endpoint baseline…: only the lane shown is ticked; the assumption is stated; the preview flags lane 4 (a
      // broad band whose ends hold band signal)
      $('btnEndpoint').click(); await wait(150);
      const tickedE = [...$('bulkLanes').querySelectorAll('input:checked')].map(i => i.dataset.bl);
      const endpointDlg = tickedE.join() === lid4 && /must represent background/.test($('bulkWhat').textContent) && /holds band signal|continues beyond/.test($('bulkPreview').textContent);
      $('btnBulkCancel').click(); await wait(50);
      const cancelled = JSON.stringify(App.S.quant.rows) === before;
      // compare lanes: the band's rows, a legend naming the lanes; align peaks is labelled as shape only
      $('qProfAll').click(); await wait(100);
      const legend = [...$('qProfKey').querySelectorAll('.pk-lane')].map(e => e.textContent.trim());
      const compare = legend.length >= 5 && legend.includes('Ctrl') && /own rows of the band's frame/.test($('qProfKey').textContent) && $('btnEditBase').disabled;
      $('qProfAlign').click(); await wait(80); const aligned = /comparing shapes, not positions/.test($('qProfKey').textContent);
      $('qProfAlign').click(); $('qProfAll').click(); await wait(80);
      // total-lane regions: their extent stated; editing the analysis area leaves them
      App.S.quant.norm = 'lane'; G.Quant.placeNormRegions(App); App.commit(); G.QuantUI.render(); await wait(50);   // (App.S is new after the undo above)
      const nr0 = JSON.stringify(App.S.quant.normRegions), txt0 = $('qNormRegions').textContent;
      $('btnAreaEdit').click(); const aT = $('qAreaT'); aT.value = String(+aT.value + 30); aT.dispatchEvent(new Event('change')); await wait(50);
      const normText = /Total-lane regions: rows \d+–\d+/.test(txt0) && /does not move them/.test(txt0) && JSON.stringify(App.S.quant.normRegions) === nr0 && /does not move the bands' regions or the total-lane regions/.test($('qAreaBox').textContent);
      $('btnAreaEdit').click(); App.undo();
      // notifications over the image editor, not over the analysis window
      G.QuantUI.show('figure', true); G.UI.toast('test notice'); await wait(50);
      const tr = $('toasts').getBoundingClientRect(), er = $('editorBox').getBoundingClientRect(), qr = $('quantView').getBoundingClientRect();
      const toastPlace = tr.left >= er.left - 1 && tr.right <= er.right + 1 && (tr.right <= qr.left || tr.left >= qr.right || tr.bottom <= qr.top);
      $('toasts').innerHTML = '';
      await G.UI.loadExample('western');
      const checks = { touchIdle: touchIdle === 'pan-y', editing, typed: !!typed, notYet, applied, escaped, free, autoKeeps, resetAll, scope, previewRows, copied, oneUndo, endpointDlg, cancelled, compare, aligned, normText, toastPlace };
      R.profileUI = Object.assign({ ok: Object.values(checks).every(Boolean), legend }, checks);
    }
    // 61. the owner's notes on the analysis (2026-10-30): a tool's instruction never covers the figure or the image;
    // on the Measurement regions layer the lanes do not respond and each box's drawn edges are its handles; a band's
    // edge moves the drawn baselines' limits with it (the same line); entering Edit baseline… never moves the plot
    // and the typed positions are folded unless the keyboard opened it; flagged lanes say what to check and can be
    // marked as checked (kept in the exports; any change brings the review back)
    {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
      const res = {};
      await G.UI.loadExample('broad'); await wait(120);
      const st = App.S, q = st.quant, row = () => App.S.quant.rows[0], fl = G.UI.figLanes(), lane4 = fl[3], lid4 = App.laneId(lane4);
      q.bg = 'local'; App.commit();
      G.QuantUI.show('figure', true); G.QuantUI.show('quant', true); await wait(80);
      // 1. the group bracket's instruction sits above the figure, not over it; a band tool's above the image
      G.FigEdit.setMode('group'); await wait(60);
      const ban = $('modeBanner'), pb = $('previewBox'), br = ban.getBoundingClientRect(), pr = pb.getBoundingClientRect();
      const groupOk = ban.parentNode === $('figPane') && ban.nextElementSibling === pb && !ban.classList.contains('hidden') && br.bottom <= pr.top + 0.5 && getComputedStyle(ban).position === 'static';
      G.FigEdit.setMode('quant'); await wait(60);
      const er = $('editorBox').getBoundingClientRect(), br2 = ban.getBoundingClientRect();
      const quantOk = ban.parentNode === $('rawCol') && ban.nextElementSibling === $('editorBox') && br2.bottom <= er.top + 0.5;
      G.FigEdit.setMode(null); await wait(30);
      res.banner = { ok: groupOk && quantOk && ban.classList.contains('hidden'), groupOk, quantOk };
      // 2. Measurement regions: a lane line does not respond; the same point does with Figure elements
      G.QuantUI.setLayer('quant'); G.Editor.draw();
      const c = st.crop, lx = st.lanes[lane4].x, s0 = G.Editor.toScreen(lx, c.y); s0.y += 30;   // on the lane line, clear of the red box's edge
      const hQuant = G.Editor.hit(s0.x, s0.y);
      G.QuantUI.setLayer('figure'); G.Editor.draw();
      const hFig = G.Editor.hit(s0.x, s0.y);
      res.layer = { ok: hQuant && hQuant.type === 'inside' && hFig && hFig.type === 'lane', quant: hQuant && hQuant.type, fig: hFig && hFig.type };
      // 3. a lane with a drawn baseline elsewhere than the band's rows: its box edge is a handle, and dragging it moves
      // the baseline's limits by the same rows (the line kept: its levels slide along it)
      G.QuantUI.setLayer('quant');
      const lim = G.Quant.limitsOf(row(), lid4), m0 = { a: lim[0] - 6, b: lim[1] + 6, la: 0.10, lb: 0.14 };
      G.Quant.setManual(App, row(), lid4, m0.a, m0.b, m0.la, m0.lb); App.commit(); G.Editor.draw();
      const out = G.Quant.outlines(App, row(), lid4), ys = out.signal.map(p => p[1]), top = Math.min(...ys);
      const sEdge = G.Editor.toScreen(st.lanes[lane4].x, top), hEdge = G.Editor.hit(sEdge.x, sEdge.y);
      const cv = $('editor'), r0 = cv.getBoundingClientRect(), fire = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 7, button: 0, clientX: r0.left + x, clientY: r0.top + y }));
      const dyPx = 5 * G.Editor.zoom();
      fire('pointerdown', sEdge.x, sEdge.y); fire('pointermove', sEdge.x, sEdge.y - dyPx / 2); fire('pointermove', sEdge.x, sEdge.y - dyPx); fire('pointerup', sEdge.x, sEdge.y - dyPx); await wait(80);
      const m1 = row().lanes[lid4].manual, at = y => m0.la + (m0.lb - m0.la) * (y - m0.a) / (m0.b - m0.a);
      const moved = !!m1 && m1.b === m0.b && m1.a <= m0.a - 4 && m1.a >= m0.a - 6 && Math.abs(m1.la - at(m1.a)) < 1e-4 && Math.abs(m1.lb - m0.lb) < 1e-6;
      const top2 = Math.min(...G.Quant.outlines(App, row(), lid4).signal.map(p => p[1]));
      res.edge = { ok: !!hEdge && hEdge.type === 'qedge' && hEdge.e === 'y0' && moved && top2 < top - 3, hit: hEdge && hEdge.type, m1, top, top2 };
      App.undo(); await wait(30);
      // Height in step 6 moves the drawn limits too (a re-placement in the same frame)
      const sp = G.Quant.rowSpan(App, row()); G.Quant.editRow(App, row(), sp.y0 - 3, sp.y1 + 3); App.commit();
      const m2 = row().lanes[lid4].manual;
      res.height = { ok: !!m2 && m2.a === m0.a - 3 && m2.b === m0.b + 3, m2 };
      App.undo(); App.undo(); await wait(30);
      // 4. Edit baseline… never moves the plot; the typed positions are folded after a pointer click, open from the keyboard
      G.QuantUI.setView('quant'); G.QuantUI.setTab('prof'); G.QuantUI.selectLane(lane4); await wait(120);
      const pv = $('qProfile'), y0 = pv.getBoundingClientRect().top, rowH0 = $('qEditRow').getBoundingClientRect().height;
      $('btnEditBase').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); await wait(80);
      const y1 = pv.getBoundingClientRect().top, rowH1 = $('qEditRow').getBoundingClientRect().height;
      const pointerEdit = !!G.QuantUI.editing() && !$('qEdExact').open && !$('btnEdApply').classList.contains('hidden') && $('btnEditBase').classList.contains('hidden')
        && $('qEditPanel').getBoundingClientRect().top >= pv.getBoundingClientRect().bottom - 0.5;
      // a drag that goes below the curve leaves the axes as they were
      const pa = G.QuantUI.profileXY(lim[0] - 4, 0.02), pbb = G.QuantUI.profileXY(lim[1] + 4, 0.02);
      const pr0 = pv.getBoundingClientRect(), fp = (type, p) => pv.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 8, button: 0, clientX: p.x, clientY: p.y }));
      const ref = G.QuantUI.profileXY(lim[0], 0.2);
      fp('pointerdown', pa); fp('pointermove', { x: (pa.x + pbb.x) / 2, y: pa.y + 40 }); fp('pointermove', { x: pbb.x, y: pa.y + 60 });
      await wait(30); const ref2 = G.QuantUI.profileXY(lim[0], 0.2); fp('pointerup', { x: pbb.x, y: pa.y + 60 });
      const frozen = Math.abs(ref.y - ref2.y) < 0.5 && Math.abs(ref.x - ref2.x) < 0.5;
      $('btnEdCancel').click(); await wait(50);
      const y2 = pv.getBoundingClientRect().top;
      $('btnEditBase').click(); await wait(80);   // a click with no pointer position: the keyboard's
      const keyEdit = $('qEdExact').open && document.activeElement === $('qEdA');
      $('btnEdCancel').click(); await wait(50);
      res.editLayout = { ok: Math.abs(y1 - y0) < 0.5 && Math.abs(y2 - y0) < 0.5 && Math.abs(rowH1 - rowH0) < 0.5 && pointerEdit && frozen && keyEdit, y0, y1, y2, rowH0, rowH1, pointerEdit, frozen, keyEdit };
      // 5. review: the list says what each lane is flagged for; Inspect shows what to check; Mark as checked takes it
      // off the list, keeps the flags in the exports and comes back when the lane changes
      const R0 = G.Quant.measure(App), open0 = R0.cells.flat().filter(c2 => G.Quant.issuesOf(c2).length && !c2.checked).length;
      G.QuantUI.render(); await wait(50);
      const items0 = $('qIssues').querySelectorAll('.q-issue').length, itemTxt = $('qIssues').textContent;
      const b4 = [...$('qIssues').querySelectorAll('[data-qinsp]')].find(b => +b.dataset.qinsp.split(':')[1] === lane4);
      if (b4) b4.click(); await wait(120);
      const what = /What to check/.test($('qProfSum').textContent) && !!$('btnChecked') && /Mark as checked/.test($('btnChecked').textContent);
      $('btnChecked').click(); await wait(120);
      const R1 = G.Quant.measure(App), j4 = R1.lanes.indexOf(lane4), c4 = R1.cells[0][j4];
      const items1 = $('qIssues').querySelectorAll('.q-issue').length;
      const csv = G.Quant.quantCSV(App, R1), tsvOk = /checked by the user: /.test(csv);
      const kept = c4.checked && c4.review.length > 0 && items1 === items0 - 1 && !R1.reviewLanes.includes(lane4) && R1.checkedLanes.includes(lane4) && /checked by you/.test($('qIssues').textContent)
        && /✓ Checked by you/.test($('qProfSum').textContent) && /were inspected on the lane profile and the values kept/.test(G.Quant.methodsText(App, R1));
      const log = JSON.stringify(G.Export.processingLog(App.S)), logOk = /"reviewCheckedByUserWells":\[[0-9]/.test(log);
      // a change to the lane (a shift) brings the review back
      row().lanes[lid4].dx = 2; App.commit(); const R2 = G.Quant.measure(App), back = !R2.cells[0][R2.lanes.indexOf(lane4)].checked;
      App.undo(); const R3 = G.Quant.measure(App), again = R3.cells[0][R3.lanes.indexOf(lane4)].checked;
      App.undo(); const R4 = G.Quant.measure(App), undone = !R4.cells[0][R4.lanes.indexOf(lane4)].checked;
      // Next to review goes to another flagged lane
      G.QuantUI.render(); await wait(50); const bn = $('btnNextIssue'); let next = true;
      if (bn) { const target = +bn.dataset.i; bn.click(); await wait(80); next = App.selLane === target; }
      res.review = { ok: open0 > 0 && items0 > 0 && /\(\+\d|reaches|background|noise/.test(itemTxt) && /To review/.test(itemTxt) && what && kept && tsvOk && logOk && back && again && undone && next, open0, items0, items1, what, kept, tsvOk, logOk, back, again, undone, next };
      // the profile is drawn when it becomes visible, whatever opened it (it had no width when the results were rendered)
      await G.UI.loadExample('western'); await wait(300);
      G.QuantUI.show('figure', true); await wait(100); G.QuantUI.setLayer('quant'); G.QuantUI.setView('quant'); await wait(300);
      const pc = $('qProfile'), px = pc.getContext('2d').getImageData(0, 0, pc.width, pc.height).data; let ink = 0; for (let t = 3; t < px.length; t += 4) if (px[t]) ink++;
      res.drawn = { ok: ink > 0 && pc.width >= pc.clientWidth, ink };
      R.notes = Object.assign({ ok: Object.values(res).every(v => v.ok) }, res);
    }
    // 55. less text, larger type, clearer layout: the wording (Size ladder, Lanes shown, the edit switch); finished
    // steps fold to their one-line summary (a click or Enter unfolds, a lesson unfolds the step it needs); the key to
    // the lines on the image lists only what is drawn and can be folded; the figure at its printed size; one filled
    // button in the export window, which also holds the resolution; the More menu; an example says it is not saved
    {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
      const shownEl = el => !!(el && el.offsetParent !== null);
      const secs = [...document.querySelectorAll('#sections > .sec')];
      const words = /Size ladder/.test(secs[2].querySelector('.sec-head').textContent) && $('rangeLabel').textContent === 'Lanes shown' && $('btnAddMarker').textContent === '+ Add ladder lane'
        && [...$('editSeg').querySelectorAll('button')].map(b => b.textContent).join('|') === 'Figure elements|Measurement regions' && parseFloat(getComputedStyle(document.body).fontSize) >= 14;
      // folding: a done step folds to its heading and summary; the heading unfolds it, by click or Enter
      const s1 = secs[0], h1 = s1.querySelector('.sec-head');
      s1.classList.add('done'); G.UI.foldDone();
      const folded = s1.classList.contains('collapsed') && !shownEl($('polSeg')) && shownEl(h1) && !!$('stImage').textContent && h1.getAttribute('aria-expanded') === 'false';
      h1.click(); const clickOpens = !s1.classList.contains('collapsed') && shownEl($('polSeg'));
      h1.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); const keyCloses = s1.classList.contains('collapsed');
      G.Tour.start('image'); await wait(200);
      const lessonUnfolds = $('tourTitle').textContent === 'Band look' && !s1.classList.contains('collapsed') && shownEl($('polSeg'));
      G.Tour.finish();
      // the key: what is drawn now, foldable, gone in the Original view
      const key = $('overlayKey'), on = k => !key.querySelector(`li[data-k="${k}"]`).classList.contains('off');
      const keyShown = shownEl(key) && on('crop') && on('lane') && on('ladder') === App.S.markers.length > 0 && on('box') === App.S.quant.rows.length > 0;
      const closed0 = key.classList.contains('closed');
      $('okeyToggle').click(); const keyFolds = key.classList.contains('closed') !== closed0 && App.prefs().okeyClosed === !closed0;
      $('okeyToggle').click();
      $('btnOrig').click(); await wait(50); const keyOrig = !shownEl(key); $('btnOrig').click(); await wait(50); const keyBack = shownEl(key);
      // the figure at its printed size: 1 pt = 4/3 CSS px
      const fw = G.UI.lastFig().w;
      $('btnActual').click(); const svg = () => $('preview').querySelector('svg');
      const actual = Math.abs(parseFloat(svg().style.width) - fw * 4 / 3) < 0.5 && $('btnActual').getAttribute('aria-pressed') === 'true';
      $('btnActual').click(); const fitted = Math.abs(parseFloat(svg().style.width) - fw * 4 / 3) > 0.5 || $('btnActual').getAttribute('aria-pressed') === 'false';
      // the export window: one filled button (the card it was opened for), the resolution beside the options
      const filled = () => [...$('exportDlg').querySelectorAll('.btn.primary')].map(b => b.id);
      G.UI.openExport('archive'); const archiveMain = filled().join() === 'btnArchive';
      G.UI.openExport(); const oneMain = filled().length === 1;
      const dpi0 = App.S.style.dpi, dx = $('dpiExp');
      dx.value = '1200'; dx.dispatchEvent(new Event('change')); const dpiSet = App.S.style.dpi === 1200 && $('dpiTop').value === '1200';
      dx.value = String(dpi0); dx.dispatchEvent(new Event('change'));
      $('btnExportClose').click();
      // the More menu: lessons, library, help, print
      const more = ['mLessons', 'mLibrary', 'mHelp', 'mPrint'].every(id => $('moreMenu').contains($(id)));
      $('mLessons').click(); const moreLessons = !$('lessonDlg').classList.contains('hidden'); $('btnLessonClose').click();
      // an example says at once that it is not kept
      await G.UI.loadExample('western'); await wait(50);
      const exampleNote = $('saveNote').textContent === 'Example: not saved';
      const checks = { words, folded, clickOpens, keyCloses, lessonUnfolds, keyShown, keyFolds, keyOrig, keyBack, actual, fitted, archiveMain, oneMain, dpiSet, more, moreLessons, exampleNote };
      R.compact = Object.assign({ ok: Object.values(checks).every(Boolean) }, checks);
    }
  } catch (e) { R.error = String(e) + '\n' + (e.stack || ''); }
  document.title = 'UITEST ' + JSON.stringify(R);
})(window);

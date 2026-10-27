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
      st.quant.rows = [{ y0: box.y0, y1: box.y1, name: 'product' }]; st.quant.control = -1; st.quant.ref = fl[1]; App.commit();
      const Rq = G.Quant.measure(App), j2 = Rq.lanes.indexOf(fl[2]), j3 = Rq.lanes.indexOf(fl[3]);
      const truth = [0.6 / 0.55, 0.5 / 0.55], got = [Rq.rel[0][j2], Rq.rel[0][j3]];
      const csv = G.Quant.quantCSV(App, Rq), chart = G.Quant.chartSVG(App, Rq);
      R.quant = { truth: truth.map(v => +v.toFixed(3)), got: got.map(v => +v.toFixed(3)), maxErr: Math.max(...got.map((v, k) => Math.abs(v / truth[k] - 1))), csvLines: csv.trim().split('\n').length, chart: !!chart && chart.svg.startsWith('<svg') };
      st.quant.rows = []; App.commit();
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
      R.western = { ok: App.S.markers.length === 1 && App.S.markers[0].ladderId === 'pr26619' && err < 0.03 && App.S.strips.length === 2, err: +err.toFixed(4), markers: App.S.markers.map(m => [m.lane + 1, m.ladderId]),
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
      const lcHead = /loading control/.test($('quantTable').innerHTML), panelHasChart = !document.getElementById('quantSec').contains($('quantChart'));
      G.QuantUI.show('quant', false);
      const v2 = G.QuantUI.view(), figShown = !$('figPane').classList.contains('hidden') && $('quantView').classList.contains('hidden');
      st.quant.rows.pop(); App.commit();
      R.quantView = { v0, v1, chart, tableRows, lanes, lcHead, panelHasChart, v2, figShown,
        ok: v0 === 'figure' && v1 === 'quant' && chart && tableRows === lanes && lcHead && panelHasChart && v2 === 'figure' && figShown };
    }
    // 35. the hands-on tutorial: every part waits for the real action, for typing to end and for dialogs to close, then for Next;
    // one card walks through "the button, then the figure"; the block a control sits in stays lit; the card keeps to the panel's corner
    if (/[?&]draft=1/.test(location.search) || true) {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
      const at = () => $('tourTitle').textContent + '·' + G.Tour.part();
      const until = async (want, ms) => { const t0 = Date.now(); while (at() !== want && Date.now() - t0 < (ms || 5000)) await wait(100); return at(); };
      // the action was done on the page: wait for the card to say so, click Next, and report where that leads
      const act = async want => { const t0 = Date.now(); while (!G.Tour.done() && Date.now() - t0 < 5000) await wait(100); if (!G.Tour.done()) return 'not done: ' + at(); G.Tour.next(); return until(want); };
      const warnsHidden = () => getComputedStyle($('warnings')).display === 'none';
      const holes = () => $('tourHoles').childNodes.length;
      const spotR = () => $('tourSpot').getBoundingClientRect(), cardR = () => $('tourCard').getBoundingClientRect(), panelR = $('panel').getBoundingClientRect();
      const within = (a, b, tol) => a.left >= b.left - tol && a.top >= b.top - tol && a.right <= b.right + tol && a.bottom <= b.bottom + tol;
      const log = [];
      App.setPref('tutorialSeen', null);
      $('panel').scrollTop = 200; $('imgAdv').open = false; $('fixLanes').open = false; $('laneAdv').open = false;
      G.Tour.start('tutorial');
      log.push(await until('The three areas·0'));                  // a gel is open, so the practice-gel step is skipped
      const clickable = getComputedStyle($('tour')).pointerEvents === 'none', warnHidden = warnsHidden(), dimmed = getComputedStyle($('tourDim').querySelector('.dim')).fill !== 'none';
      G.Tour.next(); const ringHidden = $('tourSpot').style.display === 'none';   // a whole column is shown by the dim alone
      const glued = $('tourText').innerHTML.includes('<span class="tour-kb"><kbd class="tour-key">Next</kbd>.</span>');   // "." never starts a line
      G.Tour.next(); const panelTop = $('panel').scrollTop === 0;   // the panel intro shows its top
      G.Tour.next(); log.push(at());                               // band look: one card, try it yourself
      const twoLit = holes() === 2;                                // the switch and the figure column stay lit
      G.Tour.next(); log.push(at());                               // straighten: one card for + and back
      await wait(300);
      const foldOpened = $('imgAdv').open, blockLit = holes() === 3, ringOnPlus = within(spotR(), $('rotPlus').getBoundingClientRect(), 8);
      const cardInPanel = cardR().right <= panelR.right + 1 && cardR().bottom > innerHeight - 40;   // bottom left while working in the panel
      App.setRotation(App.S.rotation + 0.5); App.commit(); await wait(700);
      const stageMoves = within(spotR(), $('btnResetRot').getBoundingClientRect(), 8) && !G.Tour.done();   // the ring moves to the next control
      $('btnResetRot').click(); log.push(await act('Set the contrast·0'));
      const warnShown = !warnsHidden();
      App.S.levels.white -= 0.01; App.commit(); await wait(700); const lvStage = within(spotR(), $('btnResetLv').getBoundingClientRect(), 8);
      $('btnResetLv').click(); log.push(await act('The figure area·0'));
      App.S.crop.h -= 5; App.commit(); log.push(await act('Check the lanes·0'));
      G.Tour.next(); log.push(at()); await wait(300); const fixOpened = $('fixLanes').open;
      const spot0 = spotR().top; $('panel').scrollTop += 40; await wait(120);
      const follows = Math.abs(spotR().top - spot0 + 40) < 3 || $('panel').scrollTop === 0;   // the spotlight follows a scroll
      $('btnEvenCrop').dispatchEvent(new MouseEvent('click', { bubbles: true })); log.push(await act('Check the lanes·2'));
      await wait(400);
      const fl0 = G.UI.figLanes(), spare = App.emptyLanes().filter(i => fl0.includes(i))[0] ?? fl0[fl0.length - 1];
      const showVisible = within(spotR(), $('laneList').getBoundingClientRect(), 8);   // the Show box is scrolled into view, the ring inside the list
      const fl = G.UI.figLanes().filter(i => !App.S.markers.some(m => m.lane === i)), names0 = fl.map(i => App.S.lanes[i].name);
      fl.forEach(i => { App.S.lanes[i].name = ''; });                 // no names when the naming card begins
      App.S.lanes[spare].hidden = true; App.commit(); log.push(await act('Name the lanes·0'));
      App.S.lanes[fl[0]].name = 'tut-A'; App.commit(); await wait(700);
      const oneEnough = G.Tour.done();                              // one name is enough
      log.push(await act('Check the ladder·0'));
      G.Tour.next(); log.push(at()); await wait(300); const bandsOpened = !!document.querySelector('#markerList .mk-card details[open]');
      App.S.markers[0].bands[0].show = !App.S.markers[0].bands[0].show; App.commit(); log.push(await act('Group line·0'));
      await wait(400); const ringOnBtn = within(spotR(), $('btnAddGroup').getBoundingClientRect(), 8);   // after the ring's slide
      App.mode = 'group'; App.emit('change'); await wait(200);
      const groupStage = spotR().left > $('figCol').getBoundingClientRect().left;   // the ring moves to the lane names on the figure
      App.mode = null; App.S.groups.push({ from: fl[0], to: fl[1], text: '' }); App.commit(); await wait(700);
      const needsLabel = !G.Tour.done();                            // a group without a label is not done
      App.S.groups[App.S.groups.length - 1].text = 'tut'; $('floatEd').classList.remove('hidden'); App.commit(); await wait(1200);
      const typingWaits = !G.Tour.done();                           // nor while a text box is open
      $('floatEd').classList.add('hidden'); log.push(await act('Target band arrow·0'));
      const skipLink = !!$('tourSkipPart');
      App.mode = 'arrow'; App.emit('change'); await wait(100);
      const gelImg = document.querySelector('#preview [data-edit="gel"]'), gr = gelImg.getBoundingClientRect();
      gelImg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: gr.left + gr.width / 2, clientY: gr.top + gr.height / 2 }));
      const guide = !$('arrowGuide').classList.contains('hidden') && Math.abs(parseFloat($('arrowGuide').style.width) - gr.width) < 2;
      App.mode = null; App.emit('change'); const guideGone = $('arrowGuide').classList.contains('hidden');
      const b0 = App.S.markers[0].bands[5]; App.S.arrows.push({ y: b0.y, text: 'tut', size: true, side: '' }); App.commit(); log.push(await act('Condition row·0'));
      App.S.conditions.push({ name: '', values: App.S.lanes.map(() => '') }); App.commit(); await wait(300);
      const noMarkerCell = !document.querySelector(`#preview [data-edit="cond"][data-src="${App.S.markers[0].lane}"]`) && document.querySelectorAll('#preview [data-edit="cond"]').length === fl.filter(i => !App.S.lanes[i].hidden).length;
      const cellsStage = !G.Tour.done() && spotR().width > 100;
      App.S.conditions[0].values[fl[0]] = '+'; App.S.conditions[0].values[fl[1]] = '−'; App.commit(); await wait(300); const nameStage = !G.Tour.done();
      App.S.conditions[0].name = 'EcoRI'; App.commit(); log.push(await act('Strips·0'));
      const nucleic = App.kind() === 'dna' || App.kind() === 'rna';
      const stripText = (nucleic ? /DNA or RNA gel like this one/ : /Western figures show/).test($('tourText').textContent);   // worded for the gel that is open
      G.Tour.skipStep(); log.push(at());                           // densitometry intro
      G.Tour.next(); log.push(at()); App.mode = 'quant'; App.emit('change'); await wait(200);
      const quantStage = spotR().left > panelR.right;              // the ring moves to the raw image
      App.mode = null; const r0 = App.S.markers[0].bands[3], r1 = App.S.markers[0].bands[6];
      App.S.quant.rows.push({ y0: r0.y - 6, y1: r0.y + 6, name: 'a' }); App.commit(); log.push(await act('Densitometry·2'));
      const viewOpened = G.QuantUI.view() === 'quant';             // the follow-up of the part ran
      App.S.quant.rows.push({ y0: r1.y - 6, y1: r1.y + 6, name: 'b' }); App.S.quant.control = 1; App.commit(); log.push(await act('Densitometry·3'));
      log.push(await act('Densitometry·4'));
      G.Tour.next(); log.push(at()); G.QuantUI.show('quant', false);
      $('warnings').innerHTML = '<div><span>⚠ a notice</span></div>';          // a notice is up: it is the first target of the export step
      log.push(await act('Export the figure·0'));
      const noticesStep = !warnsHidden() && spotR().height > 10;
      G.Tour.next(); G.Tour.next(); log.push(at()); const exportWaits = $('tourNext').disabled;
      const fontPt = App.S.style.fontPt; App.S.style.fontPt = 4; App.commit();  // something the pre-flight check warns about
      G.UI.autoConfirm = null; $('btnPNG').click(); await wait(300);
      const dialogWaits = !$('preflightDlg').classList.contains('hidden') && at() === 'Export the figure·2' && !G.Tour.done();   // the pre-flight window holds the step
      $('pfBack').click(); await wait(300); const backWaits = at() === 'Export the figure·2' && !G.Tour.done();
      App.S.style.fontPt = fontPt; App.commit();
      G.Tour.skipStep(); log.push(at()); const last = $('tourNext').textContent;
      G.Tour.next();
      const expect = ['The three areas·0', 'Band look: bright or dark·0', 'Straighten the image·0', 'Set the contrast·0', 'The figure area·0', 'Check the lanes·0', 'Check the lanes·1', 'Check the lanes·2',
        'Name the lanes·0', 'Check the ladder·0', 'Check the ladder·1', 'Group line·0', 'Target band arrow·0', 'Condition row·0', 'Strips·0', 'Densitometry·0', 'Densitometry·1', 'Densitometry·2', 'Densitometry·3', 'Densitometry·4', 'Densitometry·5',
        'Export the figure·0', 'Export the figure·2', 'Done·0'];
      const bad = expect.map((e, k) => log[k] === e ? null : `${k}: ${log[k]} ≠ ${e}`).filter(Boolean);
      const checks = { clickable, warnHidden, warnShown, dimmed, glued, ringHidden, panelTop, twoLit, foldOpened, blockLit, ringOnPlus, cardInPanel, stageMoves, lvStage, fixOpened, follows, showVisible, oneEnough, bandsOpened, ringOnBtn, groupStage, needsLabel, typingWaits, skipLink, guide, guideGone, noMarkerCell, cellsStage, nameStage, stripText, quantStage, viewOpened, noticesStep, exportWaits, dialogWaits, backWaits };
      R.tutorial = Object.assign({ bad, last, hidden: $('tour').classList.contains('hidden'), seen: !!App.prefs().tutorialSeen,
        ok: !bad.length && Object.values(checks).every(Boolean) && last === 'Done' && $('tour').classList.contains('hidden') && !!App.prefs().tutorialSeen }, checks);
      fl.forEach((i, k) => { App.S.lanes[i].name = names0[k]; });
      App.S.groups.pop(); App.S.arrows.pop(); App.S.conditions.pop(); App.S.quant.rows = []; App.S.quant.control = -1; App.S.lanes[spare].hidden = false; App.commit();
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
    // 38. densitometry: the band-pixel measure does not change with the box size; a reference lane without the band gives no relative values
    {
      await G.UI.loadExample('western');
      const st = App.S, q = st.quant, row = q.rows[0], h = Math.abs(row.y1 - row.y0), keep = JSON.parse(JSON.stringify(q));
      q.mode = 'band'; q.control = -1;
      const v1 = G.Quant.measure(App).vol[0];
      q.rows[0] = { y0: Math.min(row.y0, row.y1) - h * 0.6, y1: Math.max(row.y0, row.y1) + h * 0.6, name: row.name };   // a box more than twice as tall
      const v2 = G.Quant.measure(App).vol[0];
      const drift = Math.max(...v1.map((v, j) => Math.abs(v2[j] / v - 1)));
      q.mode = 'box';
      const v3 = G.Quant.measure(App).vol[0], driftBox = Math.max(...v1.map((v, j) => Math.abs(v3[j] / v - 1)));
      // a box over an empty region: the reference lane has no band there, so no relative value, and the chart falls back to the values
      q.mode = 'band'; q.rows = [q.rows[0], { y0: st.crop.y + 2, y1: st.crop.y + 10, name: 'empty' }];
      const M = G.Quant.measure(App), ch = G.Quant.chartSVG(App, M);
      const emptyLow = Math.max(...M.vol[1]) < 0.02 * Math.max(...M.vol[0]);
      const R2 = { refOk: M.refOk, relNull: M.rel[1].every(v => v == null), chart: !!(ch && ch.svg) };
      Object.assign(q, keep); App.commit();
      R.densMode = { drift: +drift.toFixed(4), driftBox: +driftBox.toFixed(4), emptyLow, refOk: R2.refOk, relNull: R2.relNull, chart: R2.chart,
        ok: drift < 0.03 && emptyLow && R2.refOk[0] === true && R2.refOk[1] === false && R2.relNull && R2.chart };
    }
    // 39. the raw image edits one layer at a time: band boxes respond with the Densitometry view, strips with the figure
    {
      await G.UI.loadExample('western');
      const st = App.S, c = document.getElementById('editor'), lane = G.Quant.quantLanes(App)[0];
      const pt = (x, y) => { const p = G.Editor.toScreen(x, y); return [p.x, p.y]; };
      const qy = Math.min(st.quant.rows[0].y0, st.quant.rows[0].y1), sy = Math.min(st.strips[0].y0, st.strips[0].y1);
      const strip = st.strips[0], sMid = (strip.y0 + strip.y1) / 2;
      G.QuantUI.setView('figure');
      const fQ = (G.Editor.hit(...pt(st.lanes[lane].x, qy)) || {}).type, fS = (G.Editor.hit(...pt(st.lanes[lane].x, sy)) || {}).type;
      G.QuantUI.setView('quant');
      const qQ = (G.Editor.hit(...pt(st.lanes[lane].x, qy)) || {}).type, qS = (G.Editor.hit(...pt(st.lanes[lane].x, sy)) || {}).type;
      G.QuantUI.setView('figure');
      R.layers = { fQ, fS, qQ, qS, sMid, ok: fQ !== 'qedge' && fQ !== 'qbody' && fS === 'sedge' && qQ === 'qedge' && qS !== 'sedge' };
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
      const both = vis($('figPane')) && vis($('quantView')) && vis($('gutterFig')) && G.QuantUI.view() === 'quant' && $('quantView').classList.contains('active') && vis($('imgAdv'));
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
      const numbered = $('quantSec').querySelector('.sec-n').textContent === '6', label = $('btnPNG').textContent === 'Export all', title = !!$('btnFigExport') && !!$('figFmt');
      // plot options reach the chart
      q.plot.type = 'point'; q.plot.values = true; q.plot.title = 'My plot'; q.plot.ylabel = 'Fold'; App.commit();
      const ch = G.QuantUI.chart(), pts = (ch.svg.match(/<circle /g) || []).length, bars = (ch.svg.match(/<rect /g) || []).length, titled = ch.svg.includes('My plot') && ch.svg.includes('Fold');
      // normalization modes and the border background
      q.norm = 'lane'; q.bg = 'border'; App.commit();
      const M = G.Quant.measure(App), laneNorm = M.normMode === 'lane' && M.normLabel === 'total lane' && M.norm.every(r => r.every(v => v == null || (v >= 0 && v <= 1.5))) && M.totals.every(t => t > 0);
      const csvNorm = G.Quant.quantCSV(App, M).includes('total lane'), methods = G.Quant.methodsText(App, M), methodsOk = /total-protein/.test(methods) && /3-pixel border/.test(methods) && $('methodsText').value === methods;
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
    // 48. perspective (keystone) correction: a gel without keystone is left alone, a typed keystone is applied, disclosed, carried
    // through a rotation and undone; a synthetic keystoned gel is corrected automatically within 2 points of the truth
    {
      const $ = id => document.getElementById(id), E = G.Engine, M3 = E.M3;
      const st = App.S, lanes0 = st.lanes.map(l => l.x), hist0 = App.hist.length;
      const none = App.autoKeystone(); const leftAlone = !none.applied && !st.keystone && /No keystone|Too few/.test(none.message);
      $('ksLanes').value = '12'; $('ksLanes').dispatchEvent(new Event('change', { bubbles: true }));
      const k = st.keystone, typed = !!k && k.on && k.source === 'manual' && k.lanesPct === 12 && Math.abs(App.keystoneReport().lanesPct - 12) < 1.5;
      const moved = st.lanes.some((l, i) => Math.abs(l.x - lanes0[i]) > 0.5) && st.lanes.every(l => l.x >= st.crop.x - 2 && l.x <= st.crop.x + st.crop.w + 2);
      const hints = G.Export.legendHints(st), disclosed = hints.some(h => /Perspective-corrected/.test(h) && /\+12 %/.test(h)) && !!G.Export.processingLog(st).keystone;
      const note = /typed · lanes \+12 %/.test($('ksNote').textContent);
      const frameBefore = App.frameKey(st); App.setRotation(st.rotation + 1); App.afterRotation(); App.commit();
      const rotatedOn = !!st.keystone && st.keystone.on && App.frameKey(st) !== frameBefore && st.lanes.every(l => l.x >= st.crop.x - 2 && l.x <= st.crop.x + st.crop.w + 2);
      $('btnKsOff').click(); const off = !st.keystone && !$('ksLanes').value;
      while (App.hist.length > hist0) App.undo();
      const restored = !App.S.keystone && App.S.lanes.every((l, i) => Math.abs(l.x - lanes0[i]) < 0.01);   // App.S is a new object after undo
      // the engine on a known keystone (the interface test runs on the practice gel, which has none)
      const gg = G.Demo.makeGel({ preset: 'sds', tilt: 0 }), img0 = { w: gg.width, h: gg.height, data: gg.data };
      const Hk = M3.inv(E.keystoneH({ x: 700, y: -2500 }, null, { x: 700, y: 500 }));
      const imgK = E.warp(img0, Hk); let img = imgK, H = M3.I(), crop = null;
      for (let r = 0; r < 4; r++) {
        const br = E.detectBright(img); crop = E.autoCrop(img, br);
        const L = E.detectLaneLattice(img, br, crop, E.autoCrop.meta); if (!L) break;
        const v = E.vanishing(E.laneLines(img, br, crop, L.centers, L.pitch), crop.y + crop.h / 2, crop.h); if (!v || !v.point) break;
        H = M3.mul(E.keystoneH({ x: v.point.across, y: v.point.along }, null, { x: crop.x + crop.w / 2, y: crop.y + crop.h / 2 }), H); img = E.warp(imgK, H);
      }
      const got = E.keystoneReport(H, crop), truth = E.keystoneReport(M3.inv(Hk), crop), engine = Math.abs(got.lanesPct - truth.lanesPct) <= 2;
      R.keystone = { leftAlone, msg: none.message, typed, moved, disclosed, note, rotatedOn, off, restored, got, truth, engine,
        ok: leftAlone && typed && moved && disclosed && note && rotatedOn && off && restored && engine };
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
  } catch (e) { R.error = String(e) + '\n' + (e.stack || ''); }
  document.title = 'UITEST ' + JSON.stringify(R);
})(window);

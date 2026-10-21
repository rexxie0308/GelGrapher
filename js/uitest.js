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
    // 11. group line splits at a splice gap
    {
      const f0 = fig(); const snap = App.snapshot();
      S().groups = [{ from: f0[1], to: f0[3], text: 'G' }]; S().style.spliceStyle = 'gap';
      const count = () => (App.buildFigure(false).svg.match(/<line /g) || []).length;
      const n1 = count();
      App.setLaneHidden(f0[2], true, 'test');
      const n2 = count();
      R.groupSplit = { extraLines: n2 - n1, expected: 1 + (S().style.groupTicks ? 2 : 0) };
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
      await App.dropDraft();
      R.draftDropped = !(await App.library.list()).some(e => e.sha256 === App.S.file.sha256);
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
      await App.library.remove(sha);
      const gone = !(await App.library.list()).some(e => e.sha256 === sha);
      App.commit(); await App.saveDraft();          // a removed gel stays out until it is loaded again
      const stillGone = !(await App.library.list()).some(e => e.sha256 === sha);
      R.library = { listed: !!me, thumb: !!(me && me.thumb && me.thumb.startsWith('data:image')), lanes: me && me.lanes, title, reopened, gone, stillGone,
        ok: !!me && !!(me.thumb) && title === 'My blot' && reopened === 'kept-in-library' && gone && stillGone };
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
      const st = App.S, v0 = G.QuantUI.view(), badge = $('quantBadge').textContent;
      const r = st.quant.rows[0], box = { name: 'extra', y0: r.y0 + 2, y1: r.y1 + 2 }; st.quant.rows.push(box); App.boxAdded = true; App.commit();
      await new Promise(r => setTimeout(r, 50));
      const v1 = G.QuantUI.view(), chart = !!$('quantChart').querySelector('svg'), tableRows = $('quantTable').querySelectorAll('tbody tr').length, lanes = G.Quant.quantLanes(App).length;
      const lcHead = /loading control/.test($('quantTable').innerHTML), panelHasChart = !document.getElementById('quantSec').contains($('quantChart'));
      G.QuantUI.setView('figure');
      const v2 = G.QuantUI.view(), figShown = !$('previewBox').classList.contains('hidden') && $('quantView').classList.contains('hidden');
      st.quant.rows.pop(); App.commit();
      R.quantView = { v0, badge, v1, chart, tableRows, lanes, lcHead, panelHasChart, v2, figShown,
        ok: v0 === 'figure' && badge === '2' && v1 === 'quant' && chart && tableRows === lanes && lcHead && panelHasChart && v2 === 'figure' && figShown };
    }
    // 35. the hands-on tutorial: every part waits for the real action and continues when the state shows it
    if (/[?&]draft=1/.test(location.search) || true) {
      const $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
      const at = () => $('tourTitle').textContent + '·' + G.Tour.part();
      const until = async (want, ms) => { const t0 = Date.now(); while (at() !== want && Date.now() - t0 < (ms || 5000)) await wait(100); return at(); };
      const warnsHidden = () => getComputedStyle($('warnings')).display === 'none';
      const log = [];
      App.setPref('tutorialSeen', null);
      G.Tour.start('tutorial');
      log.push(await until('The three areas·0'));                  // a gel is open, so the practice-gel step is skipped
      const clickable = getComputedStyle($('tour')).pointerEvents === 'none', warnHidden = warnsHidden();
      G.Tour.next(); G.Tour.next(); G.Tour.next();
      log.push(at());                                              // band look: switch
      App.S.levels.invert = !App.S.levels.invert; App.commit(); log.push(await until('Band look: bright or dark·1'));
      App.S.levels.invert = !App.S.levels.invert; App.commit(); log.push(await until('Straighten the image·0'));
      $('imgAdv').open = true; log.push(await until('Straighten the image·1'));
      const keys = $('tourText').querySelectorAll('.tour-key').length;
      App.setRotation(App.S.rotation + 0.5); App.commit(); log.push(await until('Straighten the image·2'));
      App.setRotation(App.autoRotation); App.commit(); log.push(await until('Set the contrast·0'));
      const warnShown = !warnsHidden();
      App.S.levels.white -= 0.01; App.commit(); log.push(await until('Set the contrast·1'));
      App.S.levels.white += 0.01; App.commit(); log.push(await until('The figure area·0'));
      App.S.crop.h -= 5; App.commit(); log.push(await until('Check the lanes·0'));
      G.Tour.next(); $('fixLanes').open = true; log.push(await until('Check the lanes·2'));
      $('btnEvenCrop').dispatchEvent(new MouseEvent('click', { bubbles: true })); log.push(await until('Check the lanes·3'));
      $('laneAdv').open = true; log.push(await until('Check the lanes·4'));
      const fl0 = G.UI.figLanes(), spare = App.emptyLanes().filter(i => fl0.includes(i))[0] ?? fl0[fl0.length - 1]; App.S.lanes[spare].hidden = true; App.commit(); log.push(await until('Name the lanes·0'));
      const fl = G.UI.figLanes().filter(i => !App.S.markers.some(m => m.lane === i));
      App.S.lanes[fl[0]].name = 'tut-A'; App.S.lanes[fl[1]].name = 'tut-B'; App.commit(); log.push(await until('Check the ladder·0'));
      G.Tour.next(); document.querySelector('#markerList .mk-card details').open = true; log.push(await until('Check the ladder·2'));
      App.S.markers[0].bands[0].show = !App.S.markers[0].bands[0].show; App.commit(); log.push(await until('Group line·0'));
      App.mode = 'group'; App.emit('change'); log.push(await until('Group line·1'));
      App.mode = null; App.S.groups.push({ from: fl[0], to: fl[1], text: 'tut' }); App.commit(); log.push(await until('Target band arrow·0'));
      const skipLink = !!$('tourSkipPart');
      G.Tour.skipStep(); log.push(at());                           // condition row
      App.S.conditions.push({ name: '', values: App.S.lanes.map(() => '') }); App.commit(); log.push(await until('Condition row·1'));
      App.S.conditions[0].values[fl[0]] = '+'; App.S.conditions[0].values[fl[1]] = '-'; App.commit(); log.push(await until('Condition row·2'));
      App.S.conditions[0].name = 'EcoRI'; App.commit(); log.push(await until('Strips·0'));
      G.Tour.skipStep(); log.push(at());                           // densitometry intro
      G.Tour.next(); App.mode = 'quant'; App.emit('change'); log.push(await until('Densitometry·2'));
      App.mode = null; const r0 = App.S.markers[0].bands[3], r1 = App.S.markers[0].bands[6];
      App.S.quant.rows.push({ y0: r0.y - 6, y1: r0.y + 6, name: 'a' }); App.commit(); log.push(await until('Densitometry·3'));
      App.S.quant.rows.push({ y0: r1.y - 6, y1: r1.y + 6, name: 'b' }); App.S.quant.control = 1; App.commit(); log.push(await until('Densitometry·5'));
      G.Tour.next(); log.push(at()); G.QuantUI.setView('figure'); log.push(await until('Export the figure·0'));
      G.Tour.next(); const exportWaits = $('tourNext').disabled; G.Tour.skipStep(); log.push(at()); const last = $('tourNext').textContent;
      G.Tour.next();
      const expect = ['The three areas·0', 'Band look: bright or dark·0', 'Band look: bright or dark·1', 'Straighten the image·0', 'Straighten the image·1', 'Straighten the image·2', 'Set the contrast·0', 'Set the contrast·1', 'The figure area·0',
        'Check the lanes·0', 'Check the lanes·2', 'Check the lanes·3', 'Check the lanes·4', 'Name the lanes·0', 'Check the ladder·0', 'Check the ladder·2', 'Group line·0', 'Group line·1', 'Target band arrow·0', 'Condition row·0', 'Condition row·1', 'Condition row·2',
        'Strips·0', 'Densitometry·0', 'Densitometry·2', 'Densitometry·3', 'Densitometry·5', 'Densitometry·6', 'Export the figure·0', 'Done·0'];
      const bad = expect.map((e, k) => log[k] === e ? null : `${k}: ${log[k]} ≠ ${e}`).filter(Boolean);
      R.tutorial = { bad, clickable, warnHidden, warnShown, keys, skipLink, exportWaits, last, hidden: $('tour').classList.contains('hidden'), seen: !!App.prefs().tutorialSeen,
        ok: !bad.length && clickable && warnHidden && warnShown && keys === 1 && skipLink && exportWaits && last === 'Done' && $('tour').classList.contains('hidden') && !!App.prefs().tutorialSeen };
      App.S.groups.pop(); App.S.conditions.pop(); App.S.quant.rows = []; App.S.quant.control = -1; App.S.lanes[spare].hidden = false; App.commit();
    }
  } catch (e) { R.error = String(e) + '\n' + (e.stack || ''); }
  document.title = 'UITEST ' + JSON.stringify(R);
})(window);

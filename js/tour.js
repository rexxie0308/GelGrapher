/* Guidance: short hands-on lessons and a read-only overview, one engine.
 *   lessons   3 to 8 cards each, chosen by goal (prepare a figure, measure bands) and worded for the
 *             experiment that is open. Every card asks for one action, spotlights the control and waits
 *             until the app's state shows the action was done; "Why?" opens the reason, and a card with
 *             nothing to do moves on with "Already correct" or "Not applicable". A lesson runs on an
 *             example (a practice copy: examples are never saved) or, when chosen, on the open gel, whose
 *             state from before the lesson can be restored at the end. Finished lessons and the card a
 *             lesson was left at are remembered (pref `lessons`).
 *   tour      a two-minute overview: a spotlight on one part of the screen at a time, read-only
 * Nothing starts by itself: the start screen offers "Use my image", "Practice with an example" and
 * "Quick overview"; Lessons in the top bar and Help list everything.
 * A target is a selector or a function returning a screen rectangle; cards whose target is not on screen
 * (or whose `when` is false) are skipped. [Button name] in a text is shown as a key cap. The rest of the
 * screen is dimmed; `watch` names the areas that stay lit as well (the block the control sits in, where
 * the result shows), and the card keeps off them. A target may change with the state (a function), so one
 * card can walk through "click the button, then work on the figure". */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const S = () => App.S;
  const figLanes = () => (G.UI && G.UI.figLanes ? G.UI.figLanes() : []);
  const isMarker = i => S().markers.some(m => m.lane === i);
  const sampleLanes = () => figLanes().filter(i => !isMarker(i));
  const named = () => sampleLanes().filter(i => S().lanes[i].name).length;
  const vis = id => !$(id).classList.contains('hidden');
  // a text box or window is open on the figure: the card waits until it is closed (Enter, Done, Escape)
  const typing = () => vis('floatEd') || vis('popover');
  // a dialog (pre-flight, a question) or the busy screen is up: the card waits for it too
  const dialogOpen = () => [...document.querySelectorAll('.dlg')].some(d => !d.classList.contains('hidden')) || vis('busy');
  const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  // a point of the working image on screen (the image editor's canvas)
  const imgPt = (x, y) => { const p = G.Editor.toScreen(x, y), c = $('editor').getBoundingClientRect(); return { x: c.left + p.x, y: c.top + p.y }; };
  const cropHandle = () => { const c = S().crop, p = imgPt(c.x + c.w / 2, c.y + c.h); return { left: p.x - 40, top: p.y - 14, width: 80, height: 28 }; };
  const cropRect = () => { const c = S().crop, a = imgPt(c.x, c.y), b = imgPt(c.x + c.w, c.y + c.h); return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }; };
  const laneLabel = i => document.querySelector(`#preview [data-edit="lane"][data-src="${i}"]`);
  const union = els => {
    if (!els.length) return null;
    const rs = els.map(e => e.getBoundingClientRect());
    const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)), r = Math.max(...rs.map(x => x.right)), b = Math.max(...rs.map(x => x.bottom));
    return { left: l, top: t, width: r - l, height: b - t };
  };
  const laneLabels = () => union(sampleLanes().map(laneLabel).filter(Boolean));
  const firstUnnamed = () => { const i = sampleLanes().find(k => !S().lanes[k].name); return laneLabel(i != null ? i : sampleLanes()[0]); };
  const gelImage = () => document.querySelector('#preview image[data-edit="gel"]');
  const lastCond = () => S().conditions.length - 1;
  const condCells = () => union([...document.querySelectorAll(`#preview [data-edit="cond"][data-r="${lastCond()}"]`)]);
  const condName = () => { const e = document.querySelector(`#preview [data-edit="condname"][data-r="${lastCond()}"]`); return e && rectOf(e); };
  const condVals = () => S().conditions.length ? S().conditions[lastCond()].values.filter(v => v === '+' || v === '−' || v === '-').length : 0;
  const hiddenCount = () => S().lanes.filter(l => l.hidden).length;
  const spareLane = () => { const e = App.emptyLanes().filter(i => figLanes().includes(i)); const f = sampleLanes(); return e.length ? e[0] : f[f.length - 1]; };
  const lastText = arr => (arr.length ? String(arr[arr.length - 1].text || '').trim() : '');
  const nucleic = () => App.kind() === 'dna' || App.kind() === 'rna';
  const western = () => !!App.gelType().western;
  const lanesKey = () => S().lanes.map(l => Math.round(l.x)).join(',');
  // the measured lanes with the strongest and the weakest corrected signal in the first band
  const strongWeak = () => {
    const R = S() && S().quant.rows.length && G.Quant ? G.Quant.measure(App) : null;
    if (!R || !R.lanes.length) return null;
    const v = R.values.corrected[0].map((x, j) => [x, R.lanes[j]]).filter(p => p[0] != null).sort((a, b) => b[0] - a[0]);
    return v.length >= 2 ? { strong: v[0][1], weak: v[v.length - 1][1] } : null;
  };
  const ANNO = '#sections .sec:nth-of-type(4)';
  let laneFix = 0, exported = 0, resultsOut = 0, resetRot = 0, resetLv = 0, origClicks = 0, polClicks = 0;
  const count = (id, fn) => $(id).addEventListener('click', fn, true);
  ['btnEvenCrop', 'btnRedetectCrop'].forEach(id => count(id, () => { laneFix++; }));
  count('btnResetRot', () => { resetRot++; }); count('btnResetLv', () => { resetLv++; });
  count('btnOrig', () => { origClicks++; }); count('polSeg', () => { polClicks++; });
  // an export counts when its button is pressed; "Go back and fix" in the pre-flight window takes it back
  // an export counts once the file was kept (the app announces it), never on the click alone
  App.on(what => { if (what === 'exported' || what === 'exported-results') { exported++; if (what === 'exported-results') resultsOut++; setTimeout(check, 0); } });

  /* A lesson = cards (steps), each one task in one or a few parts. A part with `done` waits for the action
   * (the predicate gets the value `enter` returned when the part began), is never done while a text box, a
   * window or a dialog is open, and then still waits for Next, unless `auto`; a part without `done` is read
   * and confirmed with Next. `alt` names the way past an action card with nothing to do ("Already correct",
   * "Not applicable"; "Skip" by default); `why` is the reason, behind "Why?". `el` / `rect` / `watch` may be
   * functions of the state, so the spotlight moves from the button to the figure within one card. `panel`
   * opens the folds around the target and scrolls it into view when it is not fully visible; `up` climbs
   * from the target to its label; `top` scrolls the panel to its top. `watch` = areas kept lit; the card keeps
   * off them and off `avoid`. `pane` names the workspace a target drawn by `rect` is in, for a phone. `text` and `why` may be functions (worded for the experiment); `when` leaves a
   * card out. `prepare` strips an example back to what detection found, for the lesson's practice. */
  const LESSONS = [
    { id: 'figure', goal: 'figure', title: 'Your first figure', desc: 'Compare with the original, check the lanes and the ladder, name a lane, read the notices, export.',
      next: 'labels',
      prepare: st => {
        st.lanes.forEach((l, k) => { if (!isMarker(k)) l.name = ''; });
        st.groups = []; st.arrows = []; st.conditions = []; st.strips = []; st.quant.rows = []; st.quant.normBand = null; st.quant.norm = 'none'; st.quant.output = 'corrected'; st.quant.ref = null;
        st.markers.forEach(m => { m.confirmed = false; });
      },
      end: 'Your first figure is done: checked, labelled and exported. Your own gels are kept in this browser\'s Library with everything you did.',
      steps: [
        { title: 'Working image and original', parts: [
          { el: '#btnOrig', watch: '#editorBox', text: 'The middle shows the working image: straightened, with what was detected drawn on it (red box: the figure area; blue: lanes; yellow: ladder bands). Click [Original] to see the file as it was opened, then click the button again.',
            why: 'Rotation, flips and the perspective correction change only how the image is shown and cropped. Measurements read the original pixel values, and the processing log lists every step.',
            enter: () => origClicks, done: b => origClicks >= b + 2 && !G.Editor.original() }] },
        { title: 'Check the lanes', parts: [
          { el: '#editorBox', alt: 'Already correct', text: 'Each blue line should run down the middle of a lane. Drag a wrong line onto its lane; when most are wrong, use "Lanes detected wrongly?" in the Lanes step. When they are right, click [Already correct].',
            why: 'Lane names, band sizes and measurements are all read along these lines. A line between two lanes gives a wrong size and a wrong value.',
            enter: () => lanesKey(), done: b => lanesKey() !== b }] },
        { title: 'Check the ladder', parts: [
          { el: '#markerList .mk-card .mk-confirm', panel: true, watch: ['#markerList .mk-card', '#editorBox'],
            text: () => `The card names the ladder whose pattern matches the yellow lines, and how many of its bands sit on peaks. Detection finds the closest pattern; only you know what was loaded. ${App.isExample ? 'Here it is right: tick' : 'If it is the product you loaded, tick'} [Confirm this is the ladder you loaded].`,
            why: 'Until it is confirmed, the legend and the log say the ladder was identified from the band pattern. "Check ladder and band assignments" on the card means few ladder bands sit on peaks: choose the product you loaded in the list, or drag a misplaced yellow line and the others re-fit.',
            done: () => S().markers.some(m => m.confirmed) }] },
        { title: 'Ladder image', when: western, parts: [
          { el: '#mkImageBox', panel: true, watch: '#editorBox', alt: 'Not applicable',
            text: 'If the ladder was imaged separately (white light), click [Load ladder image…]: it is straightened with the blot and an offset between the two is measured. No separate image: click [Not applicable].',
            why: 'The app checks for an offset; verify registration before estimating sizes. Slide the opacity to check that the membrane edges coincide: sizes read from a misaligned ladder image are off by the same shift.',
            done: () => App.hasMarkerImage() }] },
        { title: 'Name a lane', parts: [
          { pane: 'figure', rect: () => firstUnnamed() && rectOf(firstUnnamed()), watch: '#previewBox', text: 'Click a grey lane number on the figure, type a name (for example WT) and press Enter: the next lane opens for typing. Name one lane; Escape stops.',
            why: 'Names are typed on the figure, so you see them in place. A row of names copied from a spreadsheet can also be pasted into the box under the lane list.',
            enter: () => named(), done: b => named() > b }] },
        { title: 'Read the notices', warnings: true, parts: [
          { el: '#warnings', text: 'These notices are what a reviewer would question: clipped contrast, labels that overlap, saturated pixels. Read them and fix what can be fixed here, then click [Next].',
            why: 'Clipped pixels cannot be recovered afterwards. A shorter exposure helps when the detector saturated; an overloaded lane needs less sample. Contrast clipping is undone with Reset contrast under "Straighten and contrast".' }] },
        { title: 'Export the figure', warnings: true, parts: [
          { el: () => (vis('exportDlg') ? '#btnPNGItem' : '#btnExport'), text: 'Click [Export…], pick a format under Figure (PDF or TIFF for a journal, PNG or PowerPoint for slides) and click [Export figure]. A pre-flight window lists anything that still needs attention.',
            why: 'The resolution beside Export… applies to PNG and TIFF. Journals set their own minimum (often 300 dpi for photographs, more for images with text), so check the author guidelines. PDF and SVG keep text and lines sharp at any size.',
            enter: () => exported, done: b => exported > b }] }
      ] },
    { id: 'labels', goal: 'figure', title: 'Labels on the figure', desc: 'A group line over lanes, an arrow at a target band with its size, a + / − row.',
      next: 'strips',
      prepare: st => { st.groups = []; st.arrows = []; st.conditions = []; },
      end: 'Every label is listed under Annotations, where it can be edited or removed; on the figure, click a label to change its text.',
      steps: [
        { title: 'Group line', parts: [
          { pane: 'figure', el: () => (App.mode === 'group' ? null : '#btnAddGroup'), rect: () => (App.mode === 'group' ? laneLabels() : null), panel: true, watch: () => (App.mode === 'group' ? '#previewBox' : [ANNO, '#previewBox']),
            text: 'Click [Group line], then on the figure press on one lane name, drag to another and release. Type a label (for example EcoRI) and press Enter.',
            why: 'A group line brackets lanes that share a treatment or a genotype. It belongs to the lanes, so it follows them when lanes are hidden or reordered.',
            enter: () => S().groups.length, done: b => S().groups.length > b && !!lastText(S().groups) }] },
        { title: 'Target band arrow', parts: [
          { pane: 'figure', el: () => (App.mode === 'arrow' ? null : '#btnAddArrow'), rect: () => (App.mode === 'arrow' && gelImage() ? rectOf(gelImage()) : null), panel: true, watch: () => (App.mode === 'arrow' ? '#previewBox' : [ANNO, '#previewBox']),
            text: 'Click [Target band], then click a band on the figure (a dashed line shows where the arrow goes). Type a name, leave [Show size] ticked and click [Done].',
            why: 'The size is read from the ladder at that height, interpolated between ladder lanes when there are several. A size outside the ladder\'s calibrated range is marked ≈.',
            enter: () => S().arrows.length, done: b => S().arrows.length > b }] },
        { title: 'Condition row', parts: [
          { pane: 'figure', el: () => (S().conditions.length > condBase ? null : '#btnAddCond'), rect: () => (S().conditions.length > condBase ? condCells() : null), panel: true, watch: () => (S().conditions.length > condBase ? '#previewBox' : [ANNO, '#previewBox']),
            text: 'Click [Condition row]: a row of cells appears under the lane names. Click a cell once for +, again for −, a third time to clear it. Fill two cells.',
            why: 'A + / − row says per lane whether a treatment or probe was present, which reads faster than repeating it in every lane name.',
            enter: () => { condBase = S().conditions.length; return condBase; }, done: b => S().conditions.length > b && condVals() >= 2 },
          { pane: 'figure', rect: () => condName(), watch: '#previewBox', text: 'Click the row\'s label at its left end, type what the row stands for (for example EcoRI) and press Enter.',
            done: () => S().conditions.length > 0 && !!S().conditions[lastCond()].name }] }
      ] },
    { id: 'strips', goal: 'figure', title: 'Strips', desc: () => (nucleic() ? 'Show only chosen regions of the gel, stacked.' : 'The target and the loading control as thin panels from one blot.'),
      next: 'image',
      prepare: st => { st.strips = []; },
      end: () => (nucleic() ? 'Strips leave regions out of the figure; the legend notes say so and the uncropped image shows what was omitted.'
        : 'On your own blot, give each strip the protein name; the legend notes say the panels come from one image and the uncropped image shows what was omitted.'),
      steps: [
        { title: 'Add a strip', parts: [
          { pane: 'image', el: () => (App.mode === 'strip' ? null : '#btnAddStrip'), rect: () => (App.mode === 'strip' ? cropRect() : null), panel: true, watch: () => (App.mode === 'strip' ? ['#editorBox', '#figCol'] : [ANNO, '#editorBox']), avoid: '#editorBox',
            text: () => (nucleic()
              ? 'Click [Strip], then on the image drag from a little above a band row to a little below it. The figure shows only that region; press Enter to leave its name empty.'
              : 'Click [Strip], then on the image drag from a little above the target band to a little below it. The figure shows only that region; type the protein and press Enter.'),
            why: () => (nucleic() ? 'On DNA and RNA gels a strip is mostly used to leave out an empty region. Whole gels are usually preferred, so use strips sparingly.'
              : 'Western figures usually show the target and the loading control as thin panels from the same membrane, one strip each, so the figure stays compact.'),
            enter: () => S().strips.length, done: b => S().strips.length > b }] },
        { title: () => (nucleic() ? 'Remove the strip' : 'A second strip'), parts: [
          { pane: 'image', el: () => (nucleic() ? '#annoList [data-stdel]' : App.mode === 'strip' ? null : '#btnAddStrip'), rect: () => (!nucleic() && App.mode === 'strip' ? cropRect() : null), panel: true,
            watch: () => (nucleic() ? [ANNO, '#figCol'] : App.mode === 'strip' ? ['#editorBox', '#figCol'] : [ANNO, '#editorBox']), avoid: () => (nucleic() ? null : '#editorBox'),
            alt: () => (nucleic() ? 'Skip' : 'Not applicable'),
            text: () => (nucleic() ? 'Every strip is listed under Annotations. This gel is better shown whole: click [×] next to the strip to remove it.'
              : 'Add a second strip over the loading-control row the same way: click [Strip] and drag across it.'),
            enter: () => S().strips.length, done: b => (nucleic() ? S().strips.length < b : S().strips.length > b) }] }
      ] },
    { id: 'image', goal: 'figure', title: 'Image corrections', desc: 'Band look, angle, gel shape and contrast: what each changes, and what it never changes.',
      next: 'lanes',
      end: 'Every correction is a whole-image, linear change of how the figure looks; the processing log and the legend notes state each one.',
      steps: [
        { title: 'Band look', parts: [
          { el: '#polSeg', panel: true, watch: '#figCol', text: 'Click the other option and watch the figure invert, then click back.',
            why: 'DNA gels are usually shown with bright bands, stained protein gels and films with dark bands. Inverting is a display choice; the legend notes say when the figure is inverted.',
            enter: () => ({ n: polClicks, inv: !!S().levels.invert }), done: b => polClicks >= b.n + 2 && !!S().levels.invert === b.inv }] },
        { title: 'Straighten', parts: [
          { el: () => (S().rotation !== App.autoRotation ? '#btnResetRot' : '#rotPlus'), panel: true, watch: ['#imgAdv', '#editorBox'],
            text: 'Click [+] once: the image tilts by half a degree. Then click [Back to auto angle]. On your own gel, drag the slider until the bands are level, or click [Auto straighten].',
            why: 'Lanes and bands are found along the image\'s rows and columns, so a level gel gives straight lanes and sharp band rows.',
            enter: () => resetRot, done: b => resetRot > b && S().rotation === App.autoRotation }] },
        { title: 'Gel shape', parts: [
          { el: '#geomSeg', panel: true, watch: '#editorBox', text: 'Gel shape corrects a camera angle and bent lanes. Auto ran when the image opened; the note beside the heading says what it did. Manual: drag four corners onto the gel, then Apply. Click [Next].',
            why: 'The correction only changes the working image. Measurements still read the original pixels, through the inverse of the same mapping.' }] },
        { title: 'Contrast', warnings: true, parts: [
          { el: () => (JSON.stringify(S().levels) !== lvBase ? '#btnResetLv' : '#lvWhite'), panel: true, watch: ['#imgAdv', '#figCol'],
            text: 'Drag the white point slider a little to the left: the bands get stronger and the note under the histogram reports clipped pixels. Then click [Reset contrast].',
            why: 'Contrast is a linear whole-image change: it changes how the figure looks, never the measured values. Clipping in the figure hides differences between strong bands, so it is reported.',
            enter: () => { lvBase = JSON.stringify(S().levels); return resetLv; }, done: b => resetLv > b }] }
      ] },
    { id: 'lanes', goal: 'figure', title: 'Lanes and the figure area', desc: 'Move the red box, space lanes evenly, leave a lane out of the figure.',
      next: 'measure',
      end: 'The figure area, the lanes shown and the analysis are independent: changing what the figure shows never changes a measurement.',
      steps: [
        { title: 'The figure area', parts: [
          { pane: 'image', rect: cropHandle, watch: ['#editorBox', '#figCol'], avoid: '#editorBox', text: 'Only what is inside the red box becomes the figure. Drag the outlined handle on its bottom edge up a little and watch the figure.',
            why: 'The box\'s sides snap to the gaps between lanes (hold Alt to move freely). It sets the figure only; the analysis area is set apart in the Densitometry step.',
            enter: () => JSON.stringify(S().crop), done: b => JSON.stringify(S().crop) !== b }] },
        { title: 'Space lanes evenly', parts: [
          { el: '#btnEvenCrop', panel: true, watch: ['#fixLanes', '#editorBox'], text: 'When lanes are detected wrongly: make the red box span the outer lanes, type the number of lanes, and click [Space evenly]. Click it now; the lanes here are right, so nothing moves.',
            why: 'Evenly spaced lanes are the usual fix for a gel whose lanes were missed. Re-detect in box searches again inside the box; a single line can also be dragged.',
            enter: () => laneFix, done: b => laneFix > b }] },
        { title: 'Leave a lane out', parts: [
          { el: () => `#laneList [data-h="${spareLane()}"]`, up: 'label', panel: true, watch: ['#laneList', '#figCol'], text: 'In the lane list, untick the outlined box in the Fig. column: that lane leaves the figure and a splice gap marks the place.',
            why: 'Journals ask that removed lanes be marked; the gap and the legend notes do that. Leaving a lane out of the figure does not remove it from the measurements.',
            enter: () => hiddenCount(), done: b => hiddenCount() > b }] }
      ] },
    { id: 'measure', goal: 'measure', title: 'Measure bands', desc: 'Five decisions: acquisition quality, the target band, the background in a strong and a weak lane, the output, the flags before export.',
      next: 'figure',
      prepare: st => { st.quant.rows = []; st.quant.normBand = null; st.quant.norm = 'none'; st.quant.output = 'corrected'; st.quant.ref = null; st.quant.region = null; st.quant.version = 2; st.lanes.forEach(l => { l.noMeasure = false; }); },
      end: 'Those are the five decisions for your own blots: acquisition, target, background, output, flags. The methods paragraph is under Method details in the Densitometry step.',
      steps: [
        { title: 'Acquisition quality', parts: [
          { el: '#showSat', up: 'label', panel: true, watch: ['#clipLine', '#editorBox'], alt: 'Already checked',
            text: 'Values compare lanes only when the bands are within the detector\'s range. The line above reads the file for clipped pixels. Tick [Show saturated pixels] to mark them on the image.',
            why: 'A file cannot show saturation the imager clipped before saving: check the imager\'s own display too. A shorter exposure helps when the detector saturated; it cannot fix an overloaded lane, which needs less sample. A colour or JPEG image is not a quantitative acquisition. Contrast settings never change the values.',
            done: () => $('showSat').checked }] },
        { title: 'Select the target band', parts: [
          { pane: 'image', el: () => (App.mode === 'quant' ? null : '#btnAddBox'), rect: () => (App.mode === 'quant' ? cropRect() : null), panel: true, watch: () => (App.mode === 'quant' ? ['#editorBox', '#figCol'] : ['#quantSec', '#editorBox']), avoid: '#editorBox',
            text: () => `Click [+ Add band], then click the ${western() ? 'target band' : 'band to measure'} on the image, or drag from just above it to just below.`,
            why: 'One band is measured in every lane of the analysis area, at the same height, from the original pixels. Its region should hold the whole band from top to bottom and nothing of the bands above or below.',
            enter: () => S().quant.rows.length, done: b => S().quant.rows.length > b,
            after: () => { G.QuantUI.setView('quant'); G.QuantUI.setTab('prof'); const st = strongWeak(); if (st) G.QuantUI.selectLane(st.strong); } }] },
        { title: 'Inspect the background', parts: [
          { el: '#qProfLane', watch: ['#quantProf', '#editorBox'],
            text: () => { const sw = strongWeak(); return `The profile shows the strongest lane: shaded = counted, dashed line = the background subtracted, grey bands = the rows it came from. Now choose ${sw ? `lane ${sw.weak + 1}, the weakest,` : 'the weakest lane'} in this list. In both, the profile should be flat in the grey bands, not rising towards the band.`; },
            why: 'A background that holds part of the band, or a region shorter than the band, lowers the value, most of all for broad strong bands; such lanes are marked "? Needs review". Make the band taller (its Height) or move the background further away (Background, Edit…); never widen a region into the neighbouring lanes. Edit baseline… (a line you draw) is an expert alternative: it assumes both of its ends lie on background.',
            enter: () => { const sw = strongWeak(); return sw ? sw.weak : -1; }, done: w => +$('qProfLane').value === w || (w < 0 && G.QuantUI.tab() === 'prof') }] },
        { title: 'Output and normalization', parts: [
          { el: '#qNorm', panel: true, watch: ['#qNormSub', '#qOutput'], alt: 'Keep unnormalized',
            text: () => (App.kind() === 'protein' || App.kind() === 'native'
              ? 'Choose a normalization only if its assumption holds, or click [Keep unnormalized]. A reference band (GAPDH, actin, tubulin) must be in its linear range and unchanged by the treatment; total lane signal is total-protein normalization only on a total-protein stain or stain-free image.'
              : 'Choose a normalization only if its assumption holds, or click [Keep unnormalized]. A reference band must be in its linear range and unchanged by the conditions; total lane signal assumes equal loading gives equal lane signal.'),
            why: 'Unnormalized signal is useful when acquisition, region selection, and background correction are valid. Normalization is optional. The output (corrected signal, normalized, or fold change against a lane you choose) is set under it and stated with every value.',
            enter: () => S().quant.norm, done: b => S().quant.norm !== b }] },
        { title: 'Review flags and export', warnings: true, parts: [
          { el: () => (vis('exportDlg') ? '#btnPNG' : '#btnExport'),
            text: 'Read the marks in the table (⚠ clipped, † below 10σ, ? needs review, ✓ checked by you). A lane marked ? is listed under To review in step 6: [Inspect] shows its profile and what to check; fix it there, or mark it as checked when it looks right. Then click [Export…] and [Export results package]: the card is done once the file is saved.',
            why: 'The package holds the values with their regions, flags and method; the complete archive adds the original image so a reviewer can re-open the analysis. Biological replication depends on independently obtained samples. Duplicate lanes or repeated imaging do not create independent biological replicates.',
            enter: () => resultsOut, done: b => resultsOut > b }] }
      ] },
    { id: 'background', goal: 'measure', title: 'Broad bands and background', desc: 'Why a broad band can read lower than narrow ones, and how the background regions and the region height fix it.',
      example: 'broad', next: 'measure', open: () => { G.QuantUI.setView('quant'); G.QuantUI.setTab('prof'); },
      prepare: st => { st.quant.bg = 'edge'; st.quant.output = 'corrected'; st.quant.norm = 'none'; st.quant.ref = null; },
      end: 'A broad band is compared fairly when its background comes from outside it and its region holds all of it. When a lane is marked ? Needs review, open its profile before trusting its value.',
      steps: [
        { title: 'A broad band', parts: [
          { el: '#quantTabs [data-tab="int"]', watch: '#quantView',
            text: 'In this practice blot lane 4 holds the most protein (2.9 × lane 2; the example knows the true amounts), but its band is broad. The region was fitted to a narrow band, with Background "Line between region ends" as in earlier versions. Click [Table]: lane 4 reads lowest and is marked ?.',
            why: 'The table shows the background-corrected signal of every lane. A "?" means the region or its background should be checked before the value is used.',
            done: () => G.QuantUI.tab() === 'int' }] },
        { title: 'See why', parts: [
          { el: () => (G.QuantUI.tab() === 'prof' ? '#qProfLane' : '#quantTabs [data-tab="prof"]'), watch: ['#quantView', '#editorBox'],
            text: () => `Click [Profile] and choose lane ${(broadJ().i != null ? broadJ().i : 3) + 1}: the background is a line between the region's first and last rows, which lie on the band's flanks, so most of the band is subtracted from itself.`,
            why: 'This background assumes the region\'s end rows hold no band. True for a narrow band in a tall region; false for a broad band, which then reads too low however much protein it holds.',
            done: () => G.QuantUI.tab() === 'prof' && +$('qProfLane').value === broadJ().i }] },
        { title: 'Background outside the band', parts: [
          { el: '#qBg', panel: true, watch: ['#quantView', '#editorBox'],
            text: 'Choose Background: [Local regions]. The background now comes from regions above and below the band region, outside it (dashed on the image).',
            why: 'Background regions outside the signal region never contain the band they are subtracted from, provided the region holds the whole band.',
            done: () => S().quant.bg === 'local' }] },
        { title: 'A region as tall as the band', parts: [
          { el: '#boxList [data-qhgt="0"]', panel: true, watch: ['#quantView', '#editorBox'],
            text: 'Lane 4\'s band is taller than the region, so its edges are cut off. Type a larger Height for the band (about 57 px here) and press Enter, until the profile shows the whole peak inside the region.',
            why: 'Taller, never wider: wider regions take in the neighbouring lanes. Copying one lane\'s limits to the others (Copy integration limits…) can cut off a broader band; an endpoint baseline fails where its ends hold band signal, and is flagged. Judge a region by the flags and the profile, never by moving it until the number looks as expected.',
            done: () => { const c = broadCell(); return !!c && !c.flags.boundary; } }] },
        { title: 'Check the result', parts: [
          { el: '#quantTabs [data-tab="int"]', watch: '#quantView',
            text: () => { const r = broadRatio(); return `Lane 4 now reads ${r != null ? r.toFixed(2) : '–'} × lane 2 (true: 2.89 ×), the highest; the narrow lanes barely changed. It stays marked ?: its background regions still hold the band's faint tails (a few per cent of the value). A useful recovery within the benchmark's 10 % tolerance, not an exact or validated value.`; },
            why: 'The value of a region is the sum of signal minus background over its pixels; the profile and the table show the uncorrected sum, the background and the result for every lane, so the correction can be checked.' }] }
      ] }
  ];
  const GOALS = [['figure', 'Prepare a figure'], ['measure', 'Measure bands']];
  // the broad-band lesson: the lane with the broad band, its cell and its value against lane 2
  const broadJ = () => { const R = G.Quant.measure(App), i = (G.UI.figLanes() || [])[3]; return { R, j: R.lanes.indexOf(i), i }; };
  const broadCell = () => { const { R, j } = broadJ(); return j >= 0 && R.cells[0] ? R.cells[0][j] : null; };
  const broadRatio = () => { const { R, j } = broadJ(), v = R.values.corrected[0] || []; return j >= 0 && v[0] && v[j] != null ? v[j] / v[0] : null; };
  let lvBase = '', condBase = 0;   // baselines of the contrast and condition-row cards (set when they begin)

  const TOUR = [
    { title: 'A two-minute overview', text: 'Where everything is. Everything happens in your browser: images never leave your computer. Lessons in the top bar teach each part hands-on.' },
    { el: '#imgChip', title: 'Your image', text: 'The file that is open. Drop a new image anywhere in the window, or use Open / Save; the × closes it (it stays in the Library).' },
    { el: '#sections .sec:nth-of-type(1)', title: '1 · Image', text: 'The experiment (it chooses the ladder library and the unit) and how bands should look. Angle, gel shape and contrast were set automatically; open "Straighten and contrast" only when they need a hand.', panel: true },
    { el: '#editorBox', title: 'Image editor', text: 'The working image with what was detected: red box = the figure area, blue = lanes, yellow = ladder bands, green = measurement regions. Drag to correct; the Edit switch above says whether a drag edits figure elements or measurement regions. Original shows the file as it was opened.' },
    { el: '#sections .sec:nth-of-type(2)', title: '2 · Lanes', text: 'The wells shown in the figure, and one row per lane: its name, its role (sample, negative control, ladder), and whether it is in the figure and in the analysis.', panel: true },
    { el: '#figCol', title: 'Figure', text: 'The finished figure. Click a grey lane number and type its name; Enter jumps to the next lane. Any label can be edited by clicking it. The analysis window opens under it once a band is measured.' },
    { el: '#sections .sec:nth-of-type(3)', title: '3 · Size ladder', text: 'The ladder was identified by its band pattern: the card says how many ladder bands sit on peaks and the size range they calibrate. Confirm the product you loaded; drag a misplaced yellow line on the image.', panel: true },
    { el: ANNO, title: '4 · Annotations', text: 'Group lines over lane names, arrows at target bands (sized from the ladder), + / − condition rows, and strips to show only parts of a blot.', panel: true },
    { el: '#quantSec', title: '6 · Densitometry', text: 'Add a band: every lane of the analysis area is measured from the original pixels, with background regions beside the band and flags for anything to check. Normalization is optional and states its assumption. The analysis window shows the profile, table, plot and band sizes.', panel: true },
    { el: '#btnExport', title: 'Export', text: 'The figure alone (PNG, TIFF, PDF, SVG, PowerPoint), a results package (figure, chart, values, log, methods), a complete archive (that plus the original image and the project file) or the chart. A pre-flight check lists problems first.' },
    { el: '#btnLibrary', title: 'Library', text: 'Every gel you open is kept in this browser with your latest edits. For another computer or a backup, save a project file (Open / Save).' },
    { el: '#btnGuide', title: 'Lessons', text: 'Short hands-on lessons: a first figure, labels, strips, image corrections, lanes, and measuring bands. They run on an example, so your gels stay as they are.' },
    { el: '#btnHelp', title: 'Help', text: 'Shortcuts and common tasks.' }
  ];

  let mode = null, lessonId = null, snap = null, startGel = '', steps = [], si = -1, pi = 0, base = null, isDone = false, afterRan = false, timer = 0, hold = 0, scrollT = 0, lastSel = null;
  const box = () => $('tour'), spot = () => $('tourSpot'), card = () => $('tourCard');
  const part = () => (steps[si] && steps[si].parts ? steps[si].parts[pi] : steps[si]);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // [Name] becomes a key cap; punctuation right after it stays glued to it, so a line never starts with "."
  const fmt = t => esc(t).replace(/\[([^\]]+)\]([.,;:!?)]*)/g, '<span class="tour-kb"><kbd class="tour-key">$1</kbd>$2</span>');
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
  const val = v => (typeof v === 'function' ? safe(v, null) : v);
  const list = v => { v = val(v); return v == null ? [] : Array.isArray(v) ? v : [v]; };
  const lesson = id => LESSONS.find(l => l.id === id);
  const progress = () => Object.assign({}, App.prefs().lessons || {});
  // which gel a lesson ran on, so "Continue" is offered only while that gel is open
  const gelKey = () => (!S() ? '' : App.isExample ? 'example:' + App.isExample : S().file.sha256 || S().file.name);
  // the example a lesson practises on: the open example, else the one for the experiment chosen (or of the open gel)
  const EXAMPLE_NAMES = { dna: 'DNA gel', sds: 'SDS-PAGE', western: 'Western blot' };
  function exampleKind() {
    if (S() && App.isExample) return App.isExample;
    const t = App.gelType();
    return t.kind === 'dna' || t.kind === 'rna' ? 'dna' : t.western ? 'western' : 'sds';
  }
  // the part of an element's box that its scrolling ancestors show (null when it is scrolled out of view)
  function shownRect(el) {
    let r = rectOf(el);
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const o = getComputedStyle(a).overflowY;
      if (o !== 'auto' && o !== 'scroll') continue;
      const c = a.getBoundingClientRect(), l = Math.max(r.left, c.left), t = Math.max(r.top, c.top), rt = Math.min(r.left + r.width, c.right), bt = Math.min(r.top + r.height, c.bottom);
      if (rt - l <= 0 || bt - t <= 0) return null;
      r = { left: l, top: t, width: rt - l, height: bt - t };
    }
    return r;
  }
  function targetEl(p) {
    const sel = val(p.el); if (!sel) return null;
    let el = document.querySelector(sel); if (!el) return null;
    if (p.up) el = el.closest(p.up) || el;
    return el;
  }
  // `whole`: the element's full box even when part of it is scrolled away (to decide whether a part applies at all)
  function targetRect(p, whole) {
    if (!p) return null;
    try {
      if (p.rect) { const r = p.rect(); if (r && r.width > 0 && r.height > 0) return r; if (!val(p.el)) return null; }
      const el = targetEl(p); if (!el || getComputedStyle(el).visibility === 'hidden') return null;
      const r = whole ? rectOf(el) : shownRect(el);
      return r && r.width > 0 && r.height > 0 ? r : null;
    } catch (e) { return null; }
  }
  const overlaps = (a, b) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;
  // the dim: one rectangle over the page with a hole for every lit area
  function dim(holes) {
    const g = $('tourHoles');
    while (g.childNodes.length > holes.length) g.removeChild(g.lastChild);
    holes.forEach((h, k) => {
      let r = g.childNodes[k];
      if (!r) { r = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); r.setAttribute('rx', '10'); g.appendChild(r); }
      r.setAttribute('x', h.left - 6); r.setAttribute('y', h.top - 6); r.setAttribute('width', h.width + 12); r.setAttribute('height', h.height + 12);
    });
  }
  // open the folds around the target (not a fold whose own heading is the target) and scroll it into view when it is not fully shown
  function reveal(p) {
    const el = targetEl(p); if (!el) return;
    if (p.top) { const sc = el.closest('#panel') || el; sc.scrollTop = 0; return; }
    if (p.panel) {
      let d = el.tagName === 'SUMMARY' ? el.parentElement.parentElement && el.parentElement.parentElement.closest('details') : el.closest('details');
      for (; d; d = d.parentElement && d.parentElement.closest('details')) d.open = true;
    }
    const full = rectOf(el), shown = shownRect(el);
    if (!shown || Math.abs(shown.height - full.height) > 1 || Math.abs(shown.width - full.width) > 1) {
      el.scrollIntoView({ block: 'center' });
      // scrollIntoView also scrolls the page itself, which the desktop layout never does (the top bar would slide away);
      // only the narrow layout, whose page scrolls, keeps that
      if (getComputedStyle(document.body).overflowY === 'hidden') { const se = document.scrollingElement; se.scrollTop = 0; se.scrollLeft = 0; }
    }
    // a control in the settings panel is brought into the panel's upper part: the card sits at the panel's bottom
    // and needs the room (a card with its reason open is tall)
    const pn = el.closest('#panel');
    if (pn && !(G.UI.phone && G.UI.phone())) {
      const pr = pn.getBoundingClientRect(), er = el.getBoundingClientRect();
      if (er.top < pr.top || er.top > pr.top + pr.height * 0.45) pn.scrollTop += er.top - (pr.top + pr.height * 0.3);
    }
  }
  // which column of the screen a rectangle sits in: the settings panel, the image editor, or the figure
  function columnOf(r) {
    const pn = targetRect({ el: '#panel' }), ed = targetRect({ el: '#editorBox' }), cx = r.left + r.width / 2;
    if (pn && cx < pn.left + pn.width) return 'panel';
    if (ed && cx < ed.left + ed.width + 8) return 'mid';
    return 'right';
  }
  const hands = () => mode === 'lesson';
  function place() {
    const s = steps[si], p = part();
    if (!s || !p) return;
    const L = lesson(lessonId);
    $('tourTitle').textContent = val(s.title) || '';
    $('tourText').innerHTML = fmt(val(p.text) || '');
    const why = val(p.why) || '';
    $('tourWhy').classList.toggle('hidden', !why); $('tourWhyText').textContent = why;
    $('tourStep').textContent = (L ? `${L.title} · ` : '') + `${si + 1} / ${steps.length}` + (s.parts && s.parts.length > 1 ? ` · ${pi + 1}/${s.parts.length}` : '');
    $('tourBack').disabled = si === 0 && pi === 0;
    const waits = hands() && !!p.done && !isDone;
    $('tourNext').textContent = p.last ? 'Finish' : si === steps.length - 1 && !s.parts ? 'Done' : waits ? 'Waiting…' : 'Next';
    $('tourNext').disabled = waits;
    // an action card with nothing to do moves on with its own words: "Already correct", "Not applicable", "Skip"
    $('tourAlt').classList.toggle('hidden', !waits); $('tourAlt').textContent = val(p.alt) || 'Skip';
    $('tourStatus').innerHTML = hands() && p.done ? (isDone ? '✓ Done · click ' + fmt('[Next]') : 'Do it on the page to continue') : '';
    $('tourStatus').classList.toggle('ok', isDone);
    // the last card of a lesson: the next lesson, the list, and (on the user's own gel) the way back
    const more = hands() && !!p.last;
    $('tourMore').classList.toggle('hidden', !more);
    const nx = L && lesson(L.next);
    $('tourNextLesson').classList.toggle('hidden', !nx); if (nx) $('tourNextLesson').textContent = 'Next: ' + nx.title;
    $('tourRevert').classList.toggle('hidden', !snap);
    document.body.classList.toggle('tut-warn', !hands() || !!s.warnings);
    // a target that changed with the state (the button, then the figure) is revealed like a new one
    const sel = val(p.el);
    if (sel !== lastSel) { lastSel = sel; safe(() => bringOut(p)); reveal(p); }
    const sp = spot(), c = card(), pad = 6, vw = window.innerWidth, vh = window.innerHeight;
    const r = targetRect(p);
    // the ring marks a control; a whole area (a column, the panel) is shown by the dim alone
    const ring = r && r.width * r.height < 0.3 * vw * vh;
    if (ring) { sp.style.display = ''; sp.style.left = (r.left - pad) + 'px'; sp.style.top = (r.top - pad) + 'px'; sp.style.width = (r.width + 2 * pad) + 'px'; sp.style.height = (r.height + 2 * pad) + 'px'; }
    else sp.style.display = 'none';
    // lit: the target, the areas to watch, and any text box or window open on the figure
    const watch = list(p.watch).map(w => targetRect({ el: w })).filter(Boolean);
    const open = ['floatEd', 'popover'].filter(vis).map(id => rectOf($(id)));
    dim([r].concat(watch, open).filter(Boolean));
    // the card: in another column than the target, never over the target, the lit areas or the area to work in;
    // for work in the settings panel it sits at the bottom left (the top left when the control sits low); centred without a target
    const keep = [r].concat(watch, open, list(p.avoid).map(a => targetRect({ el: a }))).filter(Boolean);
    const pn = targetRect({ el: '#panel' }), ed = targetRect({ el: '#editorBox' }), wide = Math.min(360, vw - 24);
    const narrow = pn && pn.width >= 240 ? Math.min(wide, pn.width - 24) : wide;
    // in the panel the card may cover part of the lit block (never the control itself); elsewhere it keeps off everything lit
    const spots = {
      panel: pn ? [[pn.left + 12, 'bottom', narrow, true], [pn.left + 12, pn.top + 12, narrow, true]] : [],
      mid: ed ? [[Math.max(8, ed.left + ed.width - wide - 16), 'bottom', wide], [ed.left + 16, ed.top + 16, wide]] : [],
      right: [[vw - wide - 16, 'bottom', wide], [vw - wide - 16, 64, wide]]
    };
    const order = !r ? [] : columnOf(r) === 'panel' ? ['panel', 'mid', 'right'] : columnOf(r) === 'mid' ? ['right', 'panel', 'mid'] : ['mid', 'panel', 'right'];
    const cands = order.flatMap(k => spots[k]);
    const fit = rs => {
      for (const [l, t0, w, loose] of cands) {
        c.style.width = w + 'px';
        const ch = c.offsetHeight || 180, t = t0 === 'bottom' ? vh - ch - 16 : t0, me = { left: l, top: t, width: w, height: ch };
        const avoid = loose && columnOf(r) === 'panel' ? [r].concat(open) : rs;
        if (l >= 8 && t >= 8 && l + w <= vw - 8 && t + ch <= vh - 8 && !avoid.some(k => overlaps(me, k))) return [l, t];
      }
      return null;
    };
    let at;
    if (!r) { c.style.width = wide + 'px'; at = [(vw - wide) / 2, (vh - (c.offsetHeight || 180)) / 2]; }
    else at = fit(keep) || fit([r].concat(open)) || (c.style.width = wide + 'px', [vw - wide - 16, vh - (c.offsetHeight || 180) - 16]);
    c.style.left = at[0] + 'px'; c.style.top = at[1] + 'px';
    if (mode === 'tour') c.focus({ preventScroll: true });
  }
  function enterPart() {
    isDone = false; afterRan = false; clearTimeout(hold); lastSel = null;
    $('tourWhy').open = false;
    const p = part();
    base = p && p.enter ? safe(() => p.enter(), null) : null;
    place();
  }
  // the workspace a part's target is in, on a phone where one is shown at a time: from the element, else the part's `pane`
  function paneOf(p) {
    const el = targetEl(p);
    if (el) return el.closest('#panel') ? 'steps' : el.closest('#rawCol') ? 'image' : el.closest('#quantView') ? 'analysis' : el.closest('#figCol') ? 'figure' : null;
    return val(p.pane) || null;
  }
  // a target in a folded step is unfolded, and on a phone its workspace shown, before it is looked for
  function bringOut(p) {
    if (p.panel && G.UI.unfold) G.UI.unfold(targetEl(p));
    if (G.UI.phone && G.UI.phone()) { const pane = paneOf(p); if (pane && document.body.dataset.pane !== pane) G.UI.showPane(pane); }
  }
  const partOk = (s, k) => {
    const p = s.parts ? s.parts[k] : s;
    if ((s.when && !safe(s.when, false)) || (p.when && !safe(p.when, false))) return false;
    if (!p.el && !p.rect) return true;
    safe(() => bringOut(p));
    return !!targetRect(p, true);
  };
  // forward: the next part of this card, else the next card; parts whose target is off screen are skipped
  function forward() {
    let s = si, k = pi + 1;
    for (;;) {
      if (s >= steps.length) { finish(hands() ? 'done' : undefined); return; }
      const st = steps[s], n = st.parts ? st.parts.length : 1;
      document.body.classList.toggle('tut-warn', !hands() || !!st.warnings);   // the notices are a target of some cards
      while (k < n && !partOk(st, k)) k++;
      if (k < n) break;
      s++; k = 0;
    }
    si = s; pi = k; enterPart();
  }
  function backward() {
    let s = si, k = pi - 1;
    for (;;) {
      if (s < 0) { si = 0; pi = 0; enterPart(); return; }
      const st = steps[s];
      while (k >= 0 && !partOk(st, k)) k--;
      if (k >= 0) break;
      s--; k = s >= 0 ? (steps[s].parts ? steps[s].parts.length : 1) - 1 : -1;
    }
    si = s; pi = k; enterPart();
  }
  function skipStep() { si++; pi = -1; forward(); }
  // the lesson watches the page: when the asked-for action shows in the state (and nothing is being typed), the part is done
  const satisfied = p => !typing() && !dialogOpen() && safe(() => !!p.done(base), false);
  // what follows the action (the analysis window opens), once per part
  const runAfter = p => { if (afterRan) return; afterRan = true; if (p.after) safe(() => p.after()); };
  function check() {
    if (!hands() || si < 0) return;
    const p = part();
    if (!p || !p.done) return;
    const ok = satisfied(p);
    if (ok === isDone) return;
    if (!ok) { isDone = false; clearTimeout(hold); place(); return; }   // undone again (a window opened, the change was reverted)
    isDone = true; place();
    // nothing moves on by itself (except a part marked `auto`): the card shows "Done" and waits for Next.
    // The follow-up runs a moment later, after whatever follows the action, if the action still holds
    clearTimeout(hold);
    hold = setTimeout(() => {
      if (!hands() || part() !== p || !isDone) return;
      if (!satisfied(p)) { isDone = false; place(); return; }
      runAfter(p);
      if (p.auto) forward();
    }, 900);
  }
  /* start a lesson (by id) or the overview ('tour'), at a card when `at` is given (a lesson left part-way) */
  function start(which, at) {
    if (which === 'tutorial') which = 'figure';
    const L = lesson(which);
    finish();
    mode = L ? 'lesson' : 'tour'; lessonId = L ? L.id : null; startGel = gelKey();
    steps = L ? L.steps.concat([{ title: 'Lesson done', parts: [{ last: true, text: () => val(L.end) }] }]) : TOUR.slice();
    si = Math.max(0, Math.min(steps.length - 1, at | 0)); pi = -1;
    box().classList.remove('hidden'); box().classList.toggle('hands-on', hands());
    document.body.classList.add('touring'); document.body.classList.toggle('tutoring', hands());
    clearInterval(timer); timer = setInterval(() => { check(); if (si >= 0) place(); }, 500);
    forward();                                   // at once, so the first card is there when start() returns
    requestAnimationFrame(() => { if (si >= 0) place(); });   // and placed again once the overlay has painted
  }
  // `how` = 'done' when the lesson reached its end; otherwise the card it was left at is remembered
  function finish(how) {
    if (box().classList.contains('hidden')) return;
    if (mode === 'lesson') {
      const pr = progress(), cur = pr[lessonId] || {};
      pr[lessonId] = how === 'done' ? { done: true } : { done: !!cur.done, at: si, gel: gelKey() };
      App.setPref('lessons', pr);
    } else App.setPref('tourSeen', true);
    box().classList.add('hidden'); document.body.classList.remove('touring', 'tutoring', 'tut-warn');
    clearInterval(timer); timer = 0; clearTimeout(hold); si = -1; pi = 0; mode = null; lessonId = null;
    if (snap && how !== 'done') G.UI.toast('The lesson\'s changes stay on this gel; Ctrl+Z undoes them step by step');
    snap = null;
  }
  /* run a lesson: on an example (a practice copy, stripped back to what detection found) unless `where` is
   * 'this' and the open gel is the user's own; `resume` continues where the lesson was left on this gel */
  async function practice(id, opts) {
    opts = opts || {};
    const L = lesson(id); if (!L) return;
    $('lessonDlg').classList.add('hidden');
    finish();
    const pr = progress()[id] || {}, own = !!S() && !App.isExample;
    const at = opts.resume && pr.at != null && pr.gel === gelKey() ? pr.at : 0;
    const onThis = own && opts.where === 'this';
    if (!onThis && !at) {
      const kind = L.example || exampleKind();
      if (!S() || App.isExample !== kind) {
        if (own) await App.close();                              // the user's gel is saved and stays in the Library
        await G.UI.loadExample(kind, { clean: true });
        if (!S()) return;
      }
      if (L.prepare) { safe(() => L.prepare(S())); App.commit(); }
      if (L.goal !== 'measure') G.QuantUI.show('quant', false);
    }
    if (L.open) safe(() => L.open());   // the windows the lesson's first cards point at
    const keep = onThis ? App.snapshot() : null;
    start(id, at);
    snap = keep;
  }
  // the overview needs a gel on screen: the example for the chosen experiment when none is open
  async function overview() {
    $('lessonDlg').classList.add('hidden');
    if (!S()) { await G.UI.loadExample(exampleKind()); if (!S()) return; }
    start('tour');
  }

  /* ---------- the lesson menu: by goal, with what is done and where a lesson was left ---------- */
  let where = 'example';
  function renderMenu() {
    const pr = progress(), own = !!S() && !App.isExample;
    $('lessonWhereBox').classList.toggle('hidden', !own);
    if (!own) where = 'example';
    $('lessonWhere').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.where === where));
    $('lessonNote').textContent = own && where === 'this' ? 'On this gel: at the end of a lesson you can undo what it changed.'
      : `Lessons run on the ${EXAMPLE_NAMES[exampleKind()]} example, a practice copy that is never saved${own ? '; your gel stays in the Library' : ''}.`;
    $('lessonList').innerHTML = GOALS.map(([g, name]) => `<div class="ls-goal">${esc(name)}</div>` + LESSONS.filter(l => l.goal === g).map(l => {
      const st = pr[l.id] || {}, cont = st.at != null && st.at > 0 && st.gel === gelKey();
      const n = l.steps.filter(s => !s.when || safe(s.when, true)).length;
      return `<div class="ls-item${st.done ? ' done' : ''}"><span class="ls-tick" aria-label="${st.done ? 'done' : 'not done'}">${st.done ? '✓' : ''}</span>
        <button class="ls-main" data-ls="${l.id}"><b>${esc(l.title)}</b><small>${esc(val(l.desc))}</small></button>
        <span class="ls-meta">${cont ? `<button class="btn sm" data-resume="${l.id}">Continue at card ${st.at + 1}</button>` : `${n} cards`}</span></div>`;
    }).join('')).join('');
    $('lessonList').querySelectorAll('[data-ls]').forEach(b => { b.onclick = () => practice(b.dataset.ls, { where }); });
    $('lessonList').querySelectorAll('[data-resume]').forEach(b => { b.onclick = () => practice(b.dataset.resume, { where, resume: true }); });
  }
  function menu() { renderMenu(); $('lessonDlg').classList.remove('hidden'); }
  $('lessonWhere').querySelectorAll('button').forEach(b => { b.onclick = () => { where = b.dataset.where; renderMenu(); }; });
  $('btnLessonClose').onclick = () => $('lessonDlg').classList.add('hidden');
  $('btnLessonTour').onclick = () => overview();
  // the start screen: practice by goal on the example for the chosen experiment, or the overview
  document.querySelectorAll('[data-lesson]').forEach(b => { b.onclick = () => practice(b.dataset.lesson); });
  $('btnOverview').onclick = () => overview();
  $('btnLessonsStart').onclick = () => menu();

  $('tourNext').onclick = () => {
    const s = steps[si], p = part(); if (!p) return;
    if (p.last) { finish('done'); return; }
    if (si === steps.length - 1 && !s.parts) { finish(); return; }
    if (hands() && p.done) { if (!isDone) return; runAfter(p); }
    forward();
  };
  $('tourAlt').onclick = () => skipStep();
  $('tourBack').onclick = backward;
  $('tourSkip').onclick = () => finish();
  $('tourNextLesson').onclick = () => { const L = lesson(lessonId), w = snap ? 'this' : 'example'; finish('done'); if (L && L.next) practice(L.next, { where: w }); };
  $('tourMenuBtn').onclick = () => { finish('done'); menu(); };
  $('tourRevert').onclick = () => {
    if (!snap) return;
    App.S = JSON.parse(snap); snap = null; App.commit();
    G.UI.toast('The gel is back as it was before the lesson');
    place();
  };
  box().addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (mode === 'tour' && (e.key === 'ArrowRight' || e.key === 'Enter')) { e.preventDefault(); $('tourNext').click(); }
    else if (mode === 'tour' && e.key === 'ArrowLeft') { e.preventDefault(); backward(); }
    e.stopPropagation();
  });
  window.addEventListener('resize', () => { if (si >= 0) place(); });
  document.addEventListener('toggle', () => { if (si >= 0) place(); }, true);   // a fold opened or closed moves what is below it
  // the spotlight follows the target when the panel or the page scrolls (without the slide animation)
  window.addEventListener('scroll', () => {
    if (si < 0) return;
    box().classList.add('scrolling'); clearTimeout(scrollT); scrollT = setTimeout(() => box().classList.remove('scrolling'), 150);
    place();
  }, true);
  // checked at once and again a moment later: a window may open right after the change (an arrow's window, the pre-flight);
  // the gel closed or another one opened ends the guidance (it was about that gel; another exposure of it is the same gel)
  App.on(what => {
    if (si < 0) return;
    if (what === 'closed' || (what === 'loaded' && gelKey() !== startGel)) { finish(); return; }
    check(); place(); setTimeout(() => { if (si >= 0) { check(); place(); } }, 60);
  });
  G.Tour = { start, finish, practice, overview, menu, lessons: () => LESSONS.map(l => ({ id: l.id, goal: l.goal, title: l.title, cards: l.steps.map(s => val(s.title)) })),
    next: () => $('tourNext').click(), back: backward, skipStep, step: () => si, part: () => pi, count: () => steps.length,
    active: () => si >= 0, mode: () => mode, lesson: () => lessonId, done: () => isDone,
    seen: which => (which === 'tour' ? !!App.prefs().tourSeen : !!(progress()[which === 'tutorial' ? 'figure' : which] || {}).done) };
})(window);

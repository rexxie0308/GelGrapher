/* Guidance, two kinds, one engine:
 *   tutorial  hands-on: every step says what an area is for, then spotlights the exact control
 *             (a button, a slider, a lane label, a handle on the raw image) and waits until the app's
 *             state shows the action was done; the page stays fully usable
 *   tour      a two-minute overview: a spotlight on one part of the screen at a time, read-only
 * The tutorial starts by itself on the first visit (empty workspace); "Guide me" and Help run both.
 * A target is a selector or a function returning a screen rectangle; parts whose target is not on
 * screen are skipped. [Button name] in a text is shown as a key cap. The rest of the screen is dimmed;
 * `watch` names the areas that stay lit as well (the block the control sits in, where the result
 * shows), and the card keeps off them. A target may change with the state (a function), so one card
 * can walk through "click the button, then work on the figure". */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const S = () => App.S;
  const figLanes = () => (G.UI && G.UI.figLanes ? G.UI.figLanes() : []);
  const isMarker = i => S().markers.some(m => m.lane === i);
  const sampleLanes = () => figLanes().filter(i => !isMarker(i));
  const named = () => sampleLanes().filter(i => S().lanes[i].name).length;
  const vis = id => !$(id).classList.contains('hidden');
  // a text box or window is open on the figure: the step waits until it is closed (Enter, Done, Escape)
  const typing = () => vis('floatEd') || vis('popover');
  // a dialog (pre-flight, a question) or the busy screen is up: the step waits for it too
  const dialogOpen = () => [...document.querySelectorAll('.dlg')].some(d => !d.classList.contains('hidden')) || vis('busy');
  const shownBands = () => S().markers.reduce((a, m) => a + m.bands.filter(b => b.show).length, 0);
  const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  // a point of the rotated image on screen (the raw-image canvas)
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
  const condCells = () => union([...document.querySelectorAll('#preview [data-edit="cond"][data-r="0"]')]);
  const condName = () => { const e = document.querySelector('#preview [data-edit="condname"][data-r="0"]'); return e && rectOf(e); };
  const condVals = () => S().conditions.length ? S().conditions[0].values.filter(v => v === '+' || v === '−' || v === '-').length : 0;
  const hiddenCount = () => S().lanes.filter(l => l.hidden).length;
  const spareLane = () => { const e = App.emptyLanes().filter(i => figLanes().includes(i)); const f = figLanes(); return e.length ? e[0] : f[f.length - 1]; };
  const lastText = arr => (arr.length ? String(arr[arr.length - 1].text || '').trim() : '');
  const nucleic = () => App.kind() === 'dna' || App.kind() === 'rna';
  const ANNO = '#sections .sec:nth-of-type(4)';
  let laneFix = 0, exported = 0, resetRot = 0, resetLv = 0;
  const count = (id, fn) => $(id).addEventListener('click', fn, true);
  ['btnEvenCrop', 'btnRedetectCrop'].forEach(id => count(id, () => { laneFix++; }));
  count('btnResetRot', () => { resetRot++; }); count('btnResetLv', () => { resetLv++; });
  // an export counts when the button is pressed; "Go back and fix" in the pre-flight window takes it back
  count('btnPNG', () => { exported++; setTimeout(check, 0); });   // checked once the pre-flight window, if any, is up
  count('pfBack', () => { exported = Math.max(0, exported - 1); });

  // an example comes fully annotated; for practice it is stripped back to what detection found
  function cleanSlate() {
    const st = S();
    st.lanes.forEach((l, k) => { if (!isMarker(k)) l.name = ''; });
    st.groups = []; st.arrows = []; st.conditions = []; st.strips = []; st.quant.rows = []; st.quant.control = -1;
    App.commit();
  }

  /* A step = one task, in one or a few parts. A part with `done` waits for the action (the predicate
   * gets the value `enter` returned when the part began), is never done while a text box, a window or
   * a dialog is open, and then still waits for Next, unless `auto`; a part without `done` is read and
   * confirmed with Next. `el` / `rect` / `watch` may be functions of the state, so the spotlight moves
   * from the button to the figure within one card. `panel` opens the folds around the target and
   * scrolls it into view when it is not fully visible; `up` climbs from the target to its label;
   * `top` scrolls the panel to its top. `watch` = areas kept lit (the block the control sits in, where
   * the result shows); the card keeps off them and off `avoid`. `text` may be a function.
   * Written for someone who has never seen the app: every part names the thing to click. */
  const TUTORIAL = [
    { title: 'Open a practice gel', parts: [
      { el: '[data-example="dna"]', text: 'This screen is where a gel is opened. Click the outlined button [DNA gel] to open a practice gel. Your own images work the same way: drop the file anywhere in the window.',
        done: () => !!S(), auto: true, after: () => { if (App.isExample) cleanSlate(); } }] },
    { title: 'The three areas', parts: [
      { el: '#editorBox', text: 'The middle is the raw image, as it came from the imager. The app already straightened it and drew: a red box (what becomes the figure), blue lines (the lanes), yellow lines (the ladder bands). This is where you correct what was detected, by dragging those lines and boxes. To zoom, roll the mouse wheel over it; to move the view, drag the grey area outside the red box. Click [Next] on this card.' },
      { el: '#figCol', text: 'The right side is the figure that will be exported. It follows every change at once. Everything that is text, the lane names, group labels, arrows and condition rows, is typed here, directly on the figure. Click [Next].' },
      { el: '#panel', top: true, text: 'The left panel holds the settings, in numbered steps from top to bottom: 1 Image, 2 Lanes (which wells, their names), 3 Marker, 4 Annotations, 5 Layout, 6 Densitometry (which opens the Analysis page). A green tick means the step is fine; the panel scrolls. The tutorial goes through them in order. Click [Next].' }] },
    { title: 'Band look: bright or dark', parts: [
      { el: '#polSeg', panel: true, watch: '#figCol', text: 'Step 1, Image. A figure can show bright bands on a dark background (as a DNA gel is imaged) or dark bands on a light background (as a Coomassie gel or a film). This switch chooses; the option in use is highlighted. Try it: click the other option and watch the figure on the right invert, then click back. A DNA gel is normally shown with bright bands, a stained protein gel or a film with dark bands; an inversion is noted in the legend notes automatically. Click [Next].' }] },
    { title: 'Straighten the image', parts: [
      { el: () => (S().rotation !== App.autoRotation ? '#btnResetRot' : '#rotPlus'), panel: true, watch: ['#imgAdv', '#editorBox'],
        text: 'The gel was straightened automatically; its angle is in "Straighten and contrast", opened for you. Click [+] once: the raw image in the middle tilts by half a degree. That tilt is wrong, so then click [Back to auto angle]. On your own gels you would drag the slider until the bands are level, or click [Auto straighten] to try again.',
        enter: () => resetRot, done: b => resetRot > b && S().rotation === App.autoRotation }] },
    { title: 'Set the contrast', warnings: true, parts: [
      { el: () => (JSON.stringify(S().levels) !== lvBase ? '#btnResetLv' : '#lvWhite'), panel: true, watch: ['#imgAdv', '#figCol'],
        text: 'Contrast is set with the black point and the white point; this changes only how the figure looks, never the measurements. Drag the outlined white point slider a little to the left: the bands on the figure get stronger, the note under the histogram reports when pixels are clipped, and a notice appears at the bottom right. Then click [Reset contrast] to return to the automatic setting, which is right for most gels.',
        enter: () => { lvBase = JSON.stringify(S().levels); return resetLv; }, done: b => resetLv > b }] },
    { title: 'The figure area', parts: [
      { rect: cropHandle, watch: ['#editorBox', '#figCol'], avoid: '#editorBox', text: 'Only what is inside the red box becomes the figure. Each edge and corner of the box has a small white handle. Drag the outlined handle on the bottom edge upward a little and watch the figure. If the automatic box were wrong on your gel, you would move its edges this way; [Crop] above the raw image zooms to the box.',
        enter: () => JSON.stringify(S().crop), done: b => JSON.stringify(S().crop) !== b }] },
    { title: 'Check the lanes', parts: [
      { el: '#sections .sec:nth-of-type(2)', panel: true, watch: '#editorBox', text: 'Step 2, Lanes. Each blue line on the raw image must run down the middle of a lane, and the "Wells" range chooses which lanes appear in the figure. Look at the raw image: on the practice gel the lines are right. Now learn the fix for when they are not. Click [Next].' },
      { el: '#btnEvenCrop', panel: true, watch: ['#fixLanes', '#editorBox'], text: 'The fixing tools are under "Lanes detected wrongly?", opened for you. The usual fix: make sure the red box spans exactly the outer lanes, type the number of lanes in the small box, and click [Space evenly]. Click it now (the lanes are already right, so nothing moves). [Re-detect in box] is the other option; a single wrong line can be dragged on the raw image, and [+ Add lane] above the fold places a missing one where you click.',
        enter: () => laneFix, done: b => laneFix > b },
      { el: () => `#laneList [data-h="${spareLane()}"]`, up: 'label', panel: true, watch: ['#laneList', '#figCol'], text: 'A lane can be left out of the figure, for example an empty well. The list under "Lane names" has one row per well. Untick the outlined [Show] box: that lane disappears from the figure and a splice gap marks the place, which is what journals ask for. (Pressing H on a selected lane does the same.)',
        enter: () => hiddenCount(), done: b => hiddenCount() > b }] },
    { title: 'Name the lanes', parts: [
      { rect: () => firstUnnamed() && rectOf(firstUnnamed()), watch: '#previewBox', text: 'Names are typed directly on the figure. Click the outlined grey lane number, type a name such as WT and press Enter: the next lane opens for typing at once, so a whole row goes quickly; Escape stops. Name one lane now. (Step 3 in the panel also takes a row of names pasted from a spreadsheet.)',
        enter: () => named(), done: b => named() > b }] },
    { title: 'Check the ladder', parts: [
      { el: '#markerList .mk-card', panel: true, watch: '#editorBox', text: 'Step 3, Marker. The yellow lines on the raw image are the ladder bands, and the sizes on the left of the figure come from them. This card names the ladder that matched and how well it fits; "Poor fit" means the ladder in the list is the wrong product. Click [Next].' },
      { el: '#markerList .mk-card .list', panel: true, watch: ['#markerList .mk-card', '#figCol'], text: 'The list of ladder bands ("Bands") is open. Untick any one size: its label leaves the figure, which is how crowded labels are thinned ([Thin labels] does it automatically; [all] and [none] above the list take every box at once). A band on a wrong line can be dragged on the raw image.',
        enter: () => shownBands(), done: b => shownBands() !== b }] },
    { title: 'Group line', parts: [
      { el: () => (App.mode === 'group' ? null : '#btnAddGroup'), rect: () => (App.mode === 'group' ? laneLabels() : null), panel: true, watch: () => (App.mode === 'group' ? '#previewBox' : [ANNO, '#previewBox']),
        text: 'Step 4, Annotations: four tools, each used by clicking its button and then working on the figure. A group line is a bracket over several lanes with a label (a treatment, an enzyme). Click [Group line]; then, on the figure, press the mouse on the first lane name, drag to the third lane name and release. A line appears and a text box opens: type a label such as EcoRI and press Enter.',
        enter: () => S().groups.length, done: b => S().groups.length > b && !!lastText(S().groups) }] },
    { title: 'Target band arrow', parts: [
      { el: () => (App.mode === 'arrow' ? null : '#btnAddArrow'), rect: () => (App.mode === 'arrow' && gelImage() ? rectOf(gelImage()) : null), panel: true, watch: () => (App.mode === 'arrow' ? '#previewBox' : [ANNO, '#previewBox']),
        text: 'An arrow marks the band of interest, with its size estimated from the ladder. Click [Target band]; then move over the figure (a dashed line shows where the arrow will go) and click one band. The arrow appears and a small window opens: type a name (for example Product), leave [Show size] ticked, and click [Done]. The arrow can be dragged up or down later.',
        enter: () => S().arrows.length, done: b => S().arrows.length > b }] },
    { title: 'Condition row', parts: [
      { el: () => (S().conditions.length > condBase ? null : '#btnAddCond'), rect: () => (S().conditions.length > condBase ? (condVals() < 2 ? condCells() : condName()) : null), panel: true, watch: () => (S().conditions.length > condBase ? '#previewBox' : [ANNO, '#previewBox']),
        text: 'A condition row is a line of + and − signs under the lane names (treated or not, probe present or not). Click [Condition row]: an empty row appears under the names, one cell per lane. Click a cell once for +, again for −, a third time to clear it; fill in two cells. Then click the row\'s label at its left end, type what the row stands for (for example EcoRI) and press Enter.',
        enter: () => { condBase = S().conditions.length; return condBase; }, done: b => S().conditions.length > b && condVals() >= 2 && !!S().conditions[0].name }] },
    { title: 'Strips', parts: [
      { el: () => (App.mode === 'strip' ? null : '#btnAddStrip'), rect: () => (App.mode === 'strip' ? cropRect() : null), panel: true, watch: () => (App.mode === 'strip' ? ['#editorBox', '#figCol'] : [ANNO, '#editorBox']), avoid: '#editorBox',
        text: () => (nucleic()
          ? 'A strip shows only one horizontal region of the gel. It is the way Western blot figures show the target and the loading control as two thin panels; on a DNA or RNA gel like this one it is used only when part of the gel should be left out, for example an empty region. Try it once so you know it: click [Strip]; then, on the raw image, press the mouse a little above a band row, drag down to a little below it and release. The figure shows only that region; a text box opens for a name: press Enter.'
          : 'A strip shows only one horizontal region of the blot. It is the way Western figures show the target and the loading control as two thin panels, one strip each. Click [Strip]; then, on the raw image, press the mouse a little above a band row, drag down to a little below it and release. The figure shows only that region; a text box opens: type the protein and press Enter.'),
        enter: () => S().strips.length, done: b => S().strips.length > b },
      { el: '#annoList [data-stdel]', panel: true, watch: [ANNO, '#figCol'], text: () => (nucleic()
          ? 'Every annotation is listed here in step 4 and can be edited or removed. This gel is better shown whole, so click the [×] next to the strip to remove it.'
          : 'Every annotation is listed here in step 4 and can be edited or removed. For the tutorial, click the [×] next to the strip to remove it; on your own blot you would keep it and add a second strip for the loading control.'),
        enter: () => S().strips.length, done: b => S().strips.length < b }] },
    { title: 'Densitometry', parts: [
      { el: '#quantSec', panel: true, text: 'Step 6, Densitometry, measures how dark each band is. You draw a band box on one band; the app measures the same box in every lane, from the raw pixel values. Click [Next].' },
      { el: () => (App.mode === 'quant' ? null : '#btnAddBox'), rect: () => (App.mode === 'quant' ? cropRect() : null), panel: true, watch: () => (App.mode === 'quant' ? ['#editorBox', '#figCol'] : ['#quantSec', '#editorBox']), avoid: '#editorBox',
        text: 'Click [+ Band box]; then click a band on the raw image, inside the red box (or drag from just above the band to just below it). A green box fits itself to the band and the analysis window opens under the figure, with one bar per lane. Give the box a name in the list on the left (for example Product).',
        enter: () => S().quant.rows.length, done: b => S().quant.rows.length > b, after: () => G.QuantUI.setView('quant') },
      { el: () => (App.mode === 'quant' ? null : '#btnAddBox'), rect: () => (App.mode === 'quant' ? cropRect() : null), panel: true, watch: () => (App.mode === 'quant' ? ['#editorBox', '#figCol'] : ['#quantSec', '#editorBox']), avoid: '#editorBox',
        text: 'A second box is normally the loading control, the band that shows how much was loaded in each lane (GAPDH, actin, tubulin). Click [+ Band box] again, then click a band in another row of the raw image.',
        enter: () => S().quant.rows.length, done: b => S().quant.rows.length > b, after: () => G.QuantUI.setView('quant') },
      { el: '#boxList', panel: true, watch: ['#quantSec', '#figCol'], text: 'In the list of boxes, make sure [Loading control] is ticked on the second box (the app suggests it). The first box is then divided by it in every lane, which corrects for unequal loading; values are given relative to the reference lane, which reads 1.00.',
        done: () => S().quant.control >= 0 },
      { el: '#quantView .qv-head', text: 'This is the analysis window: the bar chart and the table, with [Copy table], [CSV] and [Export chart] in its header; [Band sizes] lists the size of every band in every lane. The divider above it sets how much room it takes; "Plot" in step 7 sets the chart type and labels. Click [Next].' },
      { el: '#btnCloseAna', text: 'Click [×] in the header of the analysis window to close it; [Analysis] in the top bar brings it back, and [Figure] does the same for the figure window. The measurements are kept.', done: () => !G.QuantUI.isShown('quant') }] },
    { title: 'Export the figure', warnings: true, parts: [
      { el: '#warnings', text: 'Before exporting, read the notices at the bottom right: they are what a reviewer would question (clipped contrast, labels that overlap, a saturated camera). Fix what can be fixed in the app; saturation can only be fixed by re-imaging with a shorter exposure. Click [Next].' },
      { el: '#dpiTop', text: 'The resolution for the exported file: 600 dpi is what most journals ask for. Leave it. Click [Next].' },
      { el: '#btnExport', text: 'Click [Export…], then [Export results package]: one ZIP with the figure, the chart, the numbers, the processing log and the methods text. The same window exports the figure alone, a complete archive (with the original image and the project) or the chart. If anything still needs attention, a pre-flight window lists it first: [Go back and fix] returns to the figure, [Export anyway] saves it.',
        enter: () => exported, done: b => exported > b }] },
    { title: 'Done', parts: [
      { last: true, text: 'That is the whole process for a paper figure. Your own gels are kept in the Library with everything you did, so you can return to them any time; Open / Save holds project files for other computers. [Guide me] in the top bar runs this again on any gel. Next, a two-minute overview of the rest of the screen?' }] }
  ];
  let lvBase = '', condBase = 0;   // baselines of the contrast and condition-row cards (set when they begin)

  const TOUR = [
    { title: 'A two-minute overview', text: 'Where everything is. Everything happens in your browser: images never leave your computer. Replay this any time from the ? button.' },
    { el: '#imgChip', title: 'Your image', text: 'The file that is open. Drop a new image anywhere in the window, or use Open / Save; the × closes it (it stays in the Library).' },
    { el: '#sections .sec:nth-of-type(1)', title: '1 · Image', text: 'Pick the experiment (it chooses the ladder library and the unit) and how bands should look. Straightening and contrast were set automatically; open "Straighten and contrast" only when they need a hand.', panel: true },
    { el: '#editorBox', title: 'Raw image', text: 'Red box = what becomes the figure; blue = lanes; yellow = marker bands. Drag a box edge, a lane line or a marker band to correct it. Scroll to zoom; drag outside the red box to move the view.' },
    { el: '#sections .sec:nth-of-type(2)', title: '2 · Lanes', text: 'Choose the wells that appear and name them (or click the names on the figure). A lane missing? + Add lane, then click its place. Lanes detected wrongly? Re-detect inside the red box, or space N lanes evenly.', panel: true },
    { el: '#figCol', title: 'Figure', text: 'The finished figure. Click a grey lane number and type its name; Enter jumps to the next lane. Any label can be edited by clicking it. The analysis window opens under it once you add band boxes (Figure and Analysis in the top bar show or hide the two windows).' },
    { el: '#sections .sec:nth-of-type(3)', title: '3 · Marker', text: 'The ladder lane was found and fitted; the fit score says whether to check it. A band placed wrongly? Drag its yellow line on the raw image and the others re-fit.', panel: true },
    { el: ANNO, title: '4 · Annotations', text: 'Group lines over lane names, arrows at target bands (sized from the ladder), + / − condition rows, and strips to show only parts of a blot.', panel: true },
    { el: '#quantSec', title: '6 · Densitometry', text: 'Add a band box per band of interest and tick the loading control. Every lane is measured; the chart and the table open in the analysis window under the figure, and the plot options are in this step.', panel: true },
    { el: '#btnExport', title: 'Export', text: 'Export… offers the figure alone (PNG, TIFF, PDF, SVG, PowerPoint), a results package (figure, chart, numbers, log, methods), a complete archive (that plus the original image and the project file) and the chart. A pre-flight check points out saturation, missing names and other problems first.' },
    { el: '#btnLibrary', title: 'Library', text: 'Every gel you open is kept here with your latest edits, so you can come back any time. Open / Save holds project files for other computers.' },
    { el: '#btnHelp', title: 'Help', text: 'Shortcuts, common tasks, the hands-on tutorial and this overview live under the ? button.' }
  ];

  let mode = null, steps = [], si = -1, pi = 0, base = null, isDone = false, afterRan = false, timer = 0, hold = 0, scrollT = 0, lastSel = null;
  const box = () => $('tour'), spot = () => $('tourSpot'), card = () => $('tourCard');
  const part = () => (steps[si] && steps[si].parts ? steps[si].parts[pi] : steps[si]);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // [Name] becomes a key cap; punctuation right after it stays glued to it, so a line never starts with "."
  const fmt = t => esc(t).replace(/\[([^\]]+)\]([.,;:!?)]*)/g, '<span class="tour-kb"><kbd class="tour-key">$1</kbd>$2</span>');
  const safe = (fn, dflt) => { try { return fn(); } catch (e) { return dflt; } };
  const val = v => (typeof v === 'function' ? v() : v);
  const list = v => { v = val(v); return v == null ? [] : Array.isArray(v) ? v : [v]; };
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
    const sel = safe(() => val(p.el), null); if (!sel) return null;
    let el = document.querySelector(sel); if (!el) return null;
    if (p.up) el = el.closest(p.up) || el;
    return el;
  }
  // `whole`: the element's full box even when part of it is scrolled away (to decide whether a part applies at all)
  function targetRect(p, whole) {
    if (!p) return null;
    try {
      if (p.rect) { const r = p.rect(); if (r && r.width > 0 && r.height > 0) return r; if (!p.el) return null; }
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
    if (!shown || Math.abs(shown.height - full.height) > 1 || Math.abs(shown.width - full.width) > 1) el.scrollIntoView({ block: 'center' });
  }
  // which column of the screen a rectangle sits in: the settings panel, the raw image, or the figure
  function columnOf(r) {
    const pn = targetRect({ el: '#panel' }), ed = targetRect({ el: '#editorBox' }), cx = r.left + r.width / 2;
    if (pn && cx < pn.left + pn.width) return 'panel';
    if (ed && cx < ed.left + ed.width + 8) return 'mid';
    return 'right';
  }
  function place() {
    const s = steps[si], p = part();
    if (!s || !p) return;
    $('tourTitle').textContent = s.title; $('tourText').innerHTML = fmt(typeof p.text === 'function' ? safe(p.text, '') : p.text);
    $('tourStep').textContent = `${si + 1} / ${steps.length}` + (s.parts && s.parts.length > 1 ? ` · ${pi + 1}/${s.parts.length}` : '');
    $('tourBack').disabled = si === 0 && pi === 0;
    const waits = mode === 'tutorial' && !!p.done && !isDone, optional = !!s.optional;
    $('tourNext').textContent = p.last || (si === steps.length - 1 && !s.parts) ? 'Done' : waits ? (optional ? 'Skip step' : 'Waiting…') : 'Next';
    $('tourNext').disabled = waits && !optional;
    $('tourStatus').innerHTML = mode === 'tutorial' && p.done ? (isDone ? '✓ Done · click ' + fmt('[Next]') : (optional ? 'Optional step' : 'Do it on the page to continue') + ' · <a href="#" id="tourSkipPart">skip this step</a>') : '';
    $('tourStatus').classList.toggle('ok', isDone);
    const sk = $('tourSkipPart'); if (sk) sk.onclick = e => { e.preventDefault(); skipStep(); };
    $('tourTourBtn').classList.toggle('hidden', !(mode === 'tutorial' && p.last));
    document.body.classList.toggle('tut-warn', mode !== 'tutorial' || !!s.warnings);
    // a target that changed with the state (the button, then the figure) is revealed like a new one
    const sel = safe(() => val(p.el), null);
    if (sel !== lastSel) { lastSel = sel; reveal(p); }
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
    // for work in the settings panel it sits at the bottom left; centred without a target
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
    const p = part();
    base = p && p.enter ? safe(() => p.enter(), null) : null;
    place();
  }
  const partOk = (s, k) => { const p = s.parts ? s.parts[k] : s; return !p.el && !p.rect ? true : !!targetRect(p, true); };
  // forward: the next part of this step, else the next step; parts whose target is off screen are skipped
  function forward() {
    let s = si, k = pi + 1;
    for (;;) {
      if (s >= steps.length) { finish(); return; }
      const st = steps[s], n = st.parts ? st.parts.length : 1;
      document.body.classList.toggle('tut-warn', mode !== 'tutorial' || !!st.warnings);   // the notices are a target of the export step
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
  // the tutorial watches the page: when the asked-for action shows in the state (and nothing is being typed), the part is done
  const satisfied = p => !typing() && !dialogOpen() && safe(() => !!p.done(base), false);
  // what follows the action (an example's annotations are stripped, the Densitometry view opens), once per part
  const runAfter = p => { if (afterRan) return; afterRan = true; if (p.after) safe(() => p.after()); };
  function check() {
    if (mode !== 'tutorial' || si < 0) return;
    const p = part();
    if (!p || !p.done) return;
    const ok = satisfied(p);
    if (ok === isDone) return;
    if (!ok) { isDone = false; clearTimeout(hold); place(); return; }   // undone again (a window opened, the change was reverted)
    isDone = true; place();
    // nothing moves on by itself (except a part marked `auto`, whose outcome fills the screen): the card shows "Done" and
    // waits for Next. The follow-up runs a moment later, after whatever follows the action, if the action still holds
    clearTimeout(hold);
    hold = setTimeout(() => {
      if (mode !== 'tutorial' || part() !== p || !isDone) return;
      if (!satisfied(p)) { isDone = false; place(); return; }
      runAfter(p);
      if (p.auto) forward();
    }, 900);
  }
  function start(which) {
    mode = which === 'tutorial' ? 'tutorial' : 'tour';
    steps = (mode === 'tutorial' ? TUTORIAL : TOUR).slice(); si = 0; pi = -1;
    box().classList.remove('hidden'); box().classList.toggle('hands-on', mode === 'tutorial');
    document.body.classList.add('touring'); document.body.classList.toggle('tutoring', mode === 'tutorial');
    clearInterval(timer); timer = setInterval(() => { check(); if (si >= 0) place(); }, 500);
    forward();                                   // at once, so the first step is there when start() returns
    requestAnimationFrame(() => { if (si >= 0) place(); });   // and placed again once the overlay has painted
  }
  function finish() {
    if (box().classList.contains('hidden')) return;
    const was = mode;
    box().classList.add('hidden'); document.body.classList.remove('touring', 'tutoring', 'tut-warn');
    clearInterval(timer); timer = 0; clearTimeout(hold); si = -1; pi = 0; mode = null;
    App.setPref(was === 'tutorial' ? 'tutorialSeen' : 'tourSeen', true);
  }
  $('tourNext').onclick = () => {
    const s = steps[si], p = part(); if (!p) return;
    if (p.last || (si === steps.length - 1 && !s.parts)) { finish(); return; }
    if (mode === 'tutorial' && p.done) {
      if (!isDone) { if (s.optional) skipStep(); return; }
      runAfter(p);
    }
    forward();
  };
  $('tourBack').onclick = backward;
  $('tourSkip').onclick = finish;
  $('tourTourBtn').onclick = () => { finish(); start('tour'); };
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
  // checked at once and again a moment later: a window may open right after the change (an arrow's window, the pre-flight)
  App.on(() => { if (si >= 0) { check(); place(); setTimeout(() => { if (si >= 0) { check(); place(); } }, 60); } });
  G.Tour = { start, finish, next: () => $('tourNext').click(), back: backward, skipStep, step: () => si, part: () => pi, count: () => steps.length,
    active: () => si >= 0, mode: () => mode, done: () => isDone, seen: which => !!App.prefs()[which === 'tutorial' ? 'tutorialSeen' : 'tourSeen'] };
})(window);

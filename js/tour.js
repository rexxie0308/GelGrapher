/* Guidance, two kinds, one engine:
 *   tutorial  hands-on: every step first says what an area is for, then spotlights the exact control
 *             (a button, a slider, a lane label, a handle on the raw image) and waits until the app's
 *             state shows the action was done; the page stays fully usable
 *   tour      a two-minute overview: a spotlight on one part of the screen at a time, read-only
 * The tutorial starts by itself on the first visit (empty workspace); "Guide me" and Help run both.
 * A target is a selector or a function returning a screen rectangle; parts whose target is not on
 * screen are skipped. [Button name] in a text is shown as a key cap. */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const S = () => App.S;
  const figLanes = () => (G.UI && G.UI.figLanes ? G.UI.figLanes() : []);
  const isMarker = i => S().markers.some(m => m.lane === i);
  const sampleLanes = () => figLanes().filter(i => !isMarker(i));
  const named = () => sampleLanes().filter(i => S().lanes[i].name).length;
  const names = () => JSON.stringify(figLanes().map(i => S().lanes[i].name));
  const typing = () => !$('floatEd').classList.contains('hidden') || !$('popover').classList.contains('hidden');
  const shownBands = () => S().markers.reduce((a, m) => a + m.bands.filter(b => b.show).length, 0);
  const rectOf = el => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
  // a point of the rotated image on screen (the raw-image canvas)
  const imgPt = (x, y) => { const p = G.Editor.toScreen(x, y), c = $('editor').getBoundingClientRect(); return { x: c.left + p.x, y: c.top + p.y }; };
  const cropHandle = () => { const c = S().crop, p = imgPt(c.x + c.w / 2, c.y + c.h); return { left: p.x - 40, top: p.y - 14, width: 80, height: 28 }; };
  const cropRect = () => { const c = S().crop, a = imgPt(c.x, c.y), b = imgPt(c.x + c.w, c.y + c.h); return { left: a.x, top: a.y, width: b.x - a.x, height: b.y - a.y }; };
  const laneLabel = i => document.querySelector(`#preview [data-edit="lane"][data-src="${i}"]`);
  const laneLabels = () => {
    const els = sampleLanes().map(laneLabel).filter(Boolean);
    if (!els.length) return null;
    const rs = els.map(e => e.getBoundingClientRect());
    const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)), r = Math.max(...rs.map(x => x.right)), b = Math.max(...rs.map(x => x.bottom));
    return { left: l, top: t, width: r - l, height: b - t };
  };
  const firstUnnamed = () => { const i = sampleLanes().find(k => !S().lanes[k].name); return laneLabel(i != null ? i : sampleLanes()[0]); };
  const gelImage = () => document.querySelector('#preview image[data-edit="gel"]');

  // an example comes fully annotated; for practice it is stripped back to what detection found
  function cleanSlate() {
    const st = S();
    st.lanes.forEach((l, k) => { if (!isMarker(k)) l.name = ''; });
    st.groups = []; st.arrows = []; st.conditions = []; st.strips = []; st.quant.rows = []; st.quant.control = -1;
    App.commit();
  }

  /* A step = one task; its parts introduce the area, then point at the control. A part with `done`
   * waits for the action (the predicate gets the value `enter` returned when the part began); a part
   * without it is read and confirmed with Next. `avoid` keeps the card off the area you work in. */
  const union = els => {
    if (!els.length) return null;
    const rs = els.map(e => e.getBoundingClientRect());
    const l = Math.min(...rs.map(r => r.left)), t = Math.min(...rs.map(r => r.top)), r = Math.max(...rs.map(x => x.right)), b = Math.max(...rs.map(x => x.bottom));
    return { left: l, top: t, width: r - l, height: b - t };
  };
  const condCells = () => union([...document.querySelectorAll('#preview [data-edit="cond"][data-r="0"]')]);
  const condName = () => { const e = document.querySelector('#preview [data-edit="condname"][data-r="0"]'); return e && rectOf(e); };
  const condVals = () => S().conditions.length ? S().conditions[0].values.filter(v => v === '+' || v === '-').length : 0;
  const hiddenCount = () => S().lanes.filter(l => l.hidden).length;
  const spareLane = () => { const e = App.emptyLanes().filter(i => figLanes().includes(i)); const f = figLanes(); return e.length ? e[0] : f[f.length - 1]; };
  const showBox = () => { const e = document.querySelector(`#laneList [data-h="${spareLane()}"]`); return e && rectOf(e.closest('label') || e); };
  const laneXs = () => JSON.stringify(S().lanes.map(l => Math.round(l.x)));
  const polarity = () => JSON.stringify([S().bright, S().levels.invert]);
  let laneFix = 0;
  ['btnEvenCrop', 'btnRedetectCrop'].forEach(id => $(id).addEventListener('click', () => { laneFix++; }, true));

  /* A step = one task; its parts introduce the area, then point at the control. A part with `done`
   * waits for the action (the predicate gets the value `enter` returned when the part began); a part
   * without it is read and confirmed with Next. `avoid` keeps the card off the area you work in.
   * Written for someone who has never seen the app: every part names the thing to click. */
  const TUTORIAL = [
    { title: 'Open a practice gel', parts: [
      { el: '[data-example="dna"]', text: 'The panel on the left is where a gel is opened. Click the button [DNA gel] (outlined) to open a practice gel. Your own images work the same way: drop the file anywhere in the window.',
        done: () => !!S(), after: () => { if (App.isExample) cleanSlate(); } }] },
    { title: 'The three areas', parts: [
      { el: '#editorBox', text: 'The middle is the raw image, as it came from the imager. The app already straightened it and drew: a red box (what becomes the figure), blue lines (the lanes), yellow lines (the ladder bands). To zoom, scroll the mouse wheel over it; to move the view, hold the Space bar and drag. Click [Next] on this card.' },
      { el: '#figCol', text: 'The right side is the figure that will be exported. It follows every change you make. Click [Next].' },
      { el: '#sections', panel: true, text: 'The left panel is the settings, in numbered steps from top to bottom: 1 Image, 2 Lanes, 3 Lane names, 4 Marker, 5 Annotations, 6 Layout, 7 Densitometry. A green tick means the step is fine. Click [Next].' }] },
    { title: 'Band look: bright or dark', parts: [
      { el: '#polSeg', panel: true, text: 'Step 1, Image. A figure can show bright bands on a dark background (as a DNA gel is imaged) or dark bands on a light background (as a Coomassie gel or a film). This switch chooses; the option in use is highlighted. Click the other option and watch the figure invert.',
        enter: () => polarity(), done: b => polarity() !== b },
      { el: '#polSeg', panel: true, text: 'Now click the first option again to switch back. A DNA gel is normally shown with bright bands, a stained protein gel or a film with dark bands; an inversion is recorded in the legend notes automatically.',
        enter: () => polarity(), done: b => polarity() !== b }] },
    { title: 'Straighten the image', parts: [
      { el: '#imgAdv > summary', panel: true, text: 'The gel was straightened automatically (the angle is written here). To see or change it, click [Straighten and contrast].', done: () => $('imgAdv').open },
      { el: '#rotPlus', panel: true, text: 'The rotation slider tilts the image; the raw image and the figure follow. Click the [+] button once to tilt it by half a degree.',
        enter: () => S().rotation, done: b => S().rotation !== b },
      { el: '#btnResetRot', panel: true, text: 'That tilt is wrong, so click [Back to auto angle]. If the automatic angle were wrong on one of your gels, you would drag the slider until the bands are level, or click [Auto straighten] to try again.',
        done: () => S().rotation === App.autoRotation }] },
    { title: 'Set the contrast', warnings: true, parts: [
      { el: '#lvWhite', panel: true, text: 'Contrast is set with the black point and the white point; this changes only how the figure looks, never the measurements. Drag the white point slider (outlined) a little to the left: bands get stronger. A note under the histogram reports when the setting clips pixels, and a notice appears at the bottom right; both are warnings a reviewer would notice.',
        enter: () => JSON.stringify(S().levels), done: b => JSON.stringify(S().levels) !== b },
      { el: '#btnResetLv', panel: true, text: 'Click [Reset contrast] to return to the automatic setting, which is right for most gels.',
        enter: () => JSON.stringify(S().levels), done: b => JSON.stringify(S().levels) !== b }] },
    { title: 'The figure area', parts: [
      { rect: cropHandle, avoid: '#editorBox', text: 'Only what is inside the red box becomes the figure. Each edge and corner of the box has a small white handle. Drag the outlined handle on the bottom edge upward a little and watch the figure. If the automatic box were wrong on your gel, you would move its edges this way; [Crop] above the raw image zooms to the box.',
        enter: () => JSON.stringify(S().crop), done: b => JSON.stringify(S().crop) !== b }] },
    { title: 'Check the lanes', parts: [
      { el: '#sections .sec:nth-of-type(2)', panel: true, text: 'Step 2, Lanes in figure. Each blue line on the raw image must run down the middle of a lane, and the "Wells" range chooses which lanes appear in the figure. On the practice gel the lanes are right; now learn the fix for when they are not. Click [Next].' },
      { el: '#fixLanes > summary', panel: true, text: 'Click [Lanes detected wrongly?] to open the fixing tools.', done: () => $('fixLanes').open },
      { el: '#btnEvenCrop', panel: true, text: 'The usual fix: make sure the red box spans exactly the outer lanes, type the number of lanes in the small box, and click [Space evenly]. Click it now (the lanes are already right, so nothing moves). [Re-detect in box] is the other option. A single wrong line can also be dragged on the raw image.',
        enter: () => laneFix, done: b => laneFix > b },
      { el: '#laneAdv > summary', panel: true, text: 'A lane can be left out of the figure, for example an empty well. Click [Individual lanes: remove / adjust] to open the list of lanes.', done: () => $('laneAdv').open },
      { rect: showBox, avoid: '#figCol', text: 'Untick the outlined [Show] box: that lane disappears from the figure and a splice gap marks the place, which is what journals ask for. (Pressing H on a selected lane does the same.)',
        enter: () => hiddenCount(), done: b => hiddenCount() > b }] },
    { title: 'Name the lanes', parts: [
      { rect: () => firstUnnamed() && rectOf(firstUnnamed()), avoid: '#figCol', text: 'Names are typed directly on the figure. Click the outlined grey lane number, type a name such as WT and press Enter: the next lane opens for typing. Name at least two lanes this way, then press Escape or click anywhere else. (Step 3 in the panel also takes a whole row of names pasted from Excel.)',
        enter: () => names(), done: b => !typing() && named() >= 2 && names() !== b }] },
    { title: 'Check the ladder', parts: [
      { el: '#markerList .mk-card', panel: true, text: 'Step 4, Marker. The yellow lines on the raw image are the ladder bands, and the sizes on the left of the figure come from them. This card names the ladder that matched and how well it fits; "Poor fit" means the ladder in the list is the wrong product. Click [Next].' },
      { el: '#markerList .mk-card details > summary', panel: true, text: 'Click [Bands] to open the list of ladder bands.', done: () => !!document.querySelector('#markerList .mk-card details[open]') },
      { el: '#markerList .mk-card .list', panel: true, text: 'Untick any one size: its label leaves the figure, which is how crowded labels are thinned ([Thin labels] does it automatically). A band on a wrong line can be dragged on the raw image.',
        enter: () => shownBands(), done: b => shownBands() !== b }] },
    { title: 'Group line', parts: [
      { el: '#btnAddGroup', panel: true, text: 'Step 5, Annotations: four tools, each used by clicking its button and then working on the figure or the raw image. A group line is a bracket over several lanes with a label (a treatment, an enzyme). Click [Group line].', done: () => App.mode === 'group' },
      { rect: laneLabels, avoid: '#figCol', text: 'Now, on the figure, press the mouse on the first lane name, drag to the third lane name and release. A line appears and a box opens: type a label such as EcoRI and press Enter.',
        enter: () => S().groups.length, done: b => !typing() && S().groups.length > b }] },
    { title: 'Target band arrow', parts: [
      { el: '#btnAddArrow', panel: true, text: 'An arrow marks the band of interest, with its size estimated from the ladder. Click [Target band].', done: () => App.mode === 'arrow' },
      { rect: () => gelImage() && rectOf(gelImage()), avoid: '#figCol', text: 'Click one band on the figure. The arrow appears and a small window opens: type a name if you like, then click [Done]. The arrow can be dragged up or down later.',
        enter: () => S().arrows.length, done: b => !typing() && S().arrows.length > b }] },
    { title: 'Condition row', parts: [
      { el: '#btnAddCond', panel: true, text: 'A condition row is a line of + and − signs under the lane names (treated or not, probe present or not). Click [Condition row]: an empty row is added under the names.',
        enter: () => S().conditions.length, done: b => S().conditions.length > b },
      { rect: condCells, avoid: '#figCol', text: 'The new row is outlined on the figure. Click a cell once for +, again for −, a third time to clear it. Fill in at least two cells.',
        enter: () => condVals(), done: b => condVals() >= b + 2 },
      { rect: condName, avoid: '#figCol', text: 'Click the outlined row name at the left end of the row, type what it stands for (for example EcoRI) and press Enter.',
        enter: () => S().conditions[0] && S().conditions[0].name, done: b => !typing() && S().conditions[0] && S().conditions[0].name && S().conditions[0].name !== b }] },
    { title: 'Strips', parts: [
      { el: '#btnAddStrip', panel: true, text: 'A strip shows only one horizontal band region of the gel, the way Western blot figures show the target and the loading control as two thin panels. Click [Strip].', done: () => App.mode === 'strip' },
      { rect: cropRect, avoid: '#editorBox', text: 'On the raw image, press the mouse a little above a band row, drag down to a little below it and release. The figure now shows only that region. A box opens: type a name (for a blot, the protein) and press Enter.',
        enter: () => S().strips.length, done: b => !typing() && S().strips.length > b },
      { el: '#annoList [data-stdel]', panel: true, text: 'Every annotation is listed here in step 5 and can be edited or removed. This DNA gel is better shown whole, so click the [×] next to the strip to remove it. (For a blot you would add a second strip for the loading control.)',
        enter: () => S().strips.length, done: b => S().strips.length < b }] },
    { title: 'Densitometry', parts: [
      { el: '#quantSec', panel: true, text: 'Step 7, Densitometry, measures how dark each band is. You draw a band box on one band; the app measures the same box in every lane, from the raw pixel values. Click [Next].' },
      { el: '#btnAddBox', panel: true, text: 'Click [+ Band box].', done: () => App.mode === 'quant' },
      { rect: cropRect, avoid: '#editorBox', text: 'Click a band on the raw image, inside the red box. A green box fits itself to the band and the Densitometry view opens on the right with one value per lane. Type a name for the box in the list on the left (for example Product).',
        enter: () => S().quant.rows.length, done: b => S().quant.rows.length > b, after: () => G.QuantUI.setView('quant') },
      { el: '#btnAddBox', panel: true, text: 'A second box is normally the loading control, the band that shows how much was loaded in each lane (GAPDH, actin, tubulin). Click [+ Band box] again, then click a band in another row of the raw image.',
        enter: () => S().quant.rows.length, done: b => S().quant.rows.length > b, after: () => G.QuantUI.setView('quant') },
      { el: '#boxList', panel: true, text: 'In the list of boxes, make sure [Loading control] is ticked on the second box (the app suggests it). The first box is then divided by it in every lane, which corrects for unequal loading; values are given relative to the reference lane, which reads 1.00.',
        done: () => S().quant.control >= 0 },
      { el: '#quantView .qv-head', text: 'This is the Densitometry view: the bar chart and the table, both exportable with [Copy table], [CSV] and [Export chart]. [Band sizes] lists the size of every band in every lane. Click [Next].' },
      { el: '#viewSeg [data-view="figure"]', text: 'Click [Figure] to return to the figure. The measurements stay in the Densitometry view.', done: () => G.QuantUI.view() === 'figure' }] },
    { title: 'Export the figure', parts: [
      { el: '#dpiTop', text: 'The resolution for the exported file: 600 dpi is what most journals ask for. Leave it. Click [Next].' },
      { el: '.topbar .split', text: 'Click [Export PNG], the left part of the outlined button (the arrow on its right lists TIFF, PDF and SVG). A pre-flight check lists anything a reviewer might ask about; then the figure is saved.',
        enter: () => exported, done: b => exported > b }] },
    { title: 'Done', parts: [
      { last: true, text: 'That is the whole process for a paper figure. Your own gels are kept in the Library with everything you did, so you can return to them any time; Open / Save holds project files for other computers. [Guide me] in the top bar runs this again on any gel. Next, a two-minute overview of the rest of the screen?' }] }
  ];
  const TOUR = [
    { title: 'A two-minute overview', text: 'Where everything is. Everything happens in your browser: images never leave your computer. Replay this any time from the ? button.' },
    { el: '#imgChip', title: 'Your image', text: 'The file that is open. Drop a new image anywhere in the window, or use Open / Save.' },
    { el: '#sections .sec:nth-of-type(1)', title: '1 · Image', text: 'Pick the experiment (it chooses the ladder library and the unit) and how bands should look. Straightening and contrast were set automatically; open "Straighten and contrast" only when they need a hand.', panel: true },
    { el: '#editorBox', title: 'Raw image', text: 'Red box = what becomes the figure; blue = lanes; yellow = marker bands. Drag a box edge, a lane line or a marker band to correct it. Scroll to zoom; hold the Space bar while dragging to move the view.' },
    { el: '#sections .sec:nth-of-type(2)', title: '2 · Lanes in figure', text: 'Choose the wells that appear. Lanes detected wrongly? Re-detect inside the red box, or space N lanes evenly.', panel: true },
    { el: '#figCol', title: 'Figure', text: 'The finished figure. Click a grey lane number and type its name; Enter jumps to the next lane. Any label can be edited by clicking it. The Densitometry view next to "Figure" shows measurements once you add band boxes.' },
    { el: '#sections .sec:nth-of-type(4)', title: '4 · Marker', text: 'The ladder lane was found and fitted; the fit score says whether to check it. A band placed wrongly? Drag its yellow line on the raw image and the others re-fit.', panel: true },
    { el: '#sections .sec:nth-of-type(5)', title: '5 · Annotations', text: 'Group lines over lane names, arrows at target bands (sized from the ladder), + / − condition rows, and strips to show only parts of a blot.', panel: true },
    { el: '#quantSec', title: '7 · Densitometry', text: 'Add a band box per band of interest and tick the loading control. Every lane is measured, and the chart and table open in the Densitometry view of the figure area.', panel: true },
    { el: '.topbar .split', title: 'Export', text: 'PNG at the chosen dpi; TIFF, PDF and SVG from the arrow. A pre-flight check points out saturation, missing names and other problems first.' },
    { el: '#btnLibrary', title: 'Library', text: 'Every gel you open is kept here with your latest edits, so you can come back any time. Open / Save holds project files for other computers.' },
    { el: '#btnHelp', title: 'Help', text: 'Shortcuts, common tasks, the hands-on tutorial and this overview live under the ? button.' }
  ];

  let mode = null, steps = [], si = -1, pi = 0, base = null, isDone = false, timer = 0, exported = 0, hold = 0;
  const box = () => $('tour'), spot = () => $('tourSpot'), card = () => $('tourCard');
  const part = () => (steps[si] && steps[si].parts ? steps[si].parts[pi] : steps[si]);
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const fmt = t => esc(t).replace(/\[([^\]]+)\]/g, '<kbd class="tour-key">$1</kbd>');
  function targetRect(p) {
    if (!p) return null;
    try {
      if (p.rect) { const r = p.rect(); return r && r.width > 0 && r.height > 0 ? r : null; }
      if (p.el) { const el = document.querySelector(p.el); if (!el) return null; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' ? r : null; }
    } catch (e) { return null; }
    return null;
  }
  const overlaps = (a, b) => a && b && a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

  function place() {
    const s = steps[si], p = part();
    if (!s || !p) return;
    $('tourTitle').textContent = s.title; $('tourText').innerHTML = fmt(p.text);
    $('tourStep').textContent = `${si + 1} / ${steps.length}` + (s.parts && s.parts.length > 1 ? ` · ${pi + 1}/${s.parts.length}` : '');
    $('tourBack').disabled = si === 0 && pi === 0;
    const waits = mode === 'tutorial' && !!p.done && !isDone, optional = !!s.optional;
    $('tourNext').textContent = p.last || (si === steps.length - 1 && !s.parts) ? 'Done' : waits ? (optional ? 'Skip step' : 'Waiting…') : 'Next';
    $('tourNext').disabled = waits && !optional;
    $('tourStatus').innerHTML = mode === 'tutorial' && p.done ? (isDone ? '✓ Done' : (optional ? 'Optional step' : 'Do it on the page to continue') + ' · <a href="#" id="tourSkipPart">skip this step</a>') : '';
    $('tourStatus').classList.toggle('ok', isDone);
    const sk = $('tourSkipPart'); if (sk) sk.onclick = e => { e.preventDefault(); skipStep(); };
    $('tourTourBtn').classList.toggle('hidden', !(mode === 'tutorial' && p.last));
    document.body.classList.toggle('tut-warn', mode !== 'tutorial' || !!s.warnings);
    const sp = spot(), c = card(), pad = 6, vw = window.innerWidth, vh = window.innerHeight;
    if (p.el && (p.panel || s.panel)) {
      const el = document.querySelector(p.el);
      if (el) { for (let d = el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true; el.scrollIntoView({ block: 'center' }); }
    }
    const r = targetRect(p);
    if (r) { sp.style.display = ''; sp.style.left = (r.left - pad) + 'px'; sp.style.top = (r.top - pad) + 'px'; sp.style.width = (r.width + 2 * pad) + 'px'; sp.style.height = (r.height + 2 * pad) + 'px'; }
    else sp.style.display = 'none';
    // the card: beside the target where there is room, never over the target or the area to work in; centred without a target
    const cw = Math.min(360, vw - 24), ch = c.offsetHeight || 180;
    const av = p.avoid ? targetRect({ el: p.avoid }) : null;
    const fits = (l, t) => l >= 8 && t >= 8 && l + cw <= vw - 8 && t + ch <= vh - 8 && !(r && overlaps({ left: l, top: t, width: cw, height: ch }, r)) && !(av && overlaps({ left: l, top: t, width: cw, height: ch }, av));
    let left, top;
    if (!r) { left = (vw - cw) / 2; top = (vh - ch) / 2; }
    else {
      const ty = Math.min(Math.max(12, r.top), vh - ch - 12), tx = Math.min(Math.max(12, r.left), vw - cw - 12);
      const side = [[r.left + r.width + 16, ty], [r.left - 16 - cw, ty]], below = [[tx, r.top + r.height + 12]], above = [[tx, r.top - 12 - ch]];
      // a target in the top bar gets the card under it; otherwise beside it first
      const cands = (r.top < 60 ? below.concat(side, above) : side.concat(below, above)).concat([[vw - cw - 16, vh - ch - 16], [16, vh - ch - 16], [vw - cw - 16, 64], [16, 64]]);
      const ok = cands.find(([l, t]) => fits(l, t)) || cands.find(([l, t]) => l >= 8 && t >= 8 && l + cw <= vw - 8 && t + ch <= vh - 8 && !(r && overlaps({ left: l, top: t, width: cw, height: ch }, r))) || cands[4];
      left = ok[0]; top = ok[1];
    }
    c.style.left = left + 'px'; c.style.top = top + 'px';
    if (mode === 'tour') c.focus({ preventScroll: true });
  }
  function enterPart() {
    isDone = false;
    const p = part();
    base = p && p.enter ? p.enter() : null;
    place();
  }
  const partOk = (s, k) => { const p = s.parts ? s.parts[k] : s; return !p.el && !p.rect ? true : !!targetRect(p); };
  // forward: the next part of this step, else the next step; parts whose target is off screen are skipped
  function forward() {
    let s = si, k = pi + 1;
    for (;;) {
      if (s >= steps.length) { finish(); return; }
      const st = steps[s], n = st.parts ? st.parts.length : 1;
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
  // the tutorial watches the page: when the asked-for action shows in the state, the part is done
  function check() {
    if (mode !== 'tutorial' || si < 0) return;
    const p = part();
    if (!p || !p.done || isDone) return;
    let ok = false;
    try { ok = !!p.done(base); } catch (e) { ok = false; }
    if (!ok) return;
    isDone = true; place();
    // the hand-over runs a moment later, after whatever follows the action (an example applies its annotations after loading)
    clearTimeout(hold);
    hold = setTimeout(() => { if (mode !== 'tutorial' || part() !== p || !isDone) return; if (p.after) { try { p.after(); } catch (e) { /* best effort */ } } forward(); }, 900);
  }
  function start(which) {
    mode = which === 'tutorial' ? 'tutorial' : 'tour';
    steps = (mode === 'tutorial' ? TUTORIAL : TOUR).slice(); si = 0; pi = -1;
    box().classList.remove('hidden'); box().classList.toggle('hands-on', mode === 'tutorial');
    document.body.classList.add('touring'); document.body.classList.toggle('tutoring', mode === 'tutorial');
    clearInterval(timer); timer = setInterval(() => { check(); if (si >= 0) place(); }, 500);
    requestAnimationFrame(forward);
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
    if (mode === 'tutorial' && p.done && !isDone && s.optional) { skipStep(); return; }
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
  App.on(() => { if (si >= 0) { check(); place(); } });
  // an export counts when the button is pressed (the pre-flight dialog may follow)
  $('btnPNG').addEventListener('click', () => { exported++; check(); }, true);
  G.Tour = { start, finish, next: () => $('tourNext').click(), back: backward, skipStep, step: () => si, part: () => pi, count: () => steps.length,
    active: () => si >= 0, mode: () => mode, done: () => isDone, seen: which => !!App.prefs()[which === 'tutorial' ? 'tutorialSeen' : 'tourSeen'] };
})(window);

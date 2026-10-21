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
  const TUTORIAL = [
    { title: 'Open a practice gel', parts: [
      { el: '[data-example="dna"]', text: 'Click [DNA gel]. Everything after this works the same for your own images, which you can drop anywhere in the window.',
        done: () => !!S(), after: () => { if (App.isExample) cleanSlate(); } }] },
    { title: 'What was found', parts: [
      { el: '#editorBox', text: 'This is the raw image. Straightening, the red figure box, the blue lanes and the yellow ladder bands were detected automatically. Scroll to zoom; to move the view, hold the Space bar while dragging. Press Next when you have had a look.' },
      { el: '#figCol', text: 'This is the figure that will be exported. It follows every change you make on the left. Press Next.' }] },
    { title: 'Adjust the figure area', parts: [
      { rect: cropHandle, avoid: '#editorBox', text: 'The red box is the figure area. Drag this handle on its bottom edge upward a little and watch the figure follow. (Ctrl+Z undoes any step.)',
        enter: () => JSON.stringify(S().crop), done: b => JSON.stringify(S().crop) !== b }] },
    { title: 'Set the contrast', warnings: true, parts: [
      { el: '#sections .sec:nth-of-type(1)', panel: true, text: 'Step 1 of the panel: the experiment type and how bands look. Contrast was set automatically; a notice at the bottom right reports when the setting clips pixels. Press Next.' },
      { el: '#imgAdv > summary', panel: true, text: 'Click [Straighten and contrast] to open the contrast controls.', done: () => $('imgAdv').open },
      { el: '#lvWhite', panel: true, text: 'Drag the white point slider: left makes bands stronger, right makes them fainter. Stop before the note below it reports clipping. The figure follows.',
        enter: () => JSON.stringify(S().levels), done: b => JSON.stringify(S().levels) !== b }] },
    { title: 'Name the lanes', parts: [
      { rect: () => firstUnnamed() && rectOf(firstUnnamed()), avoid: '#figCol', text: 'Click this grey lane number on the figure, type a name such as WT and press Enter: the next lane opens for typing. Name at least two lanes, then press Escape or click elsewhere.',
        enter: () => names(), done: b => !typing() && named() >= 2 && names() !== b }] },
    { title: 'Check the ladder', optional: true, parts: [
      { el: '#markerList .mk-card', panel: true, text: 'Step 4: the marker card names the ladder that matched and how well it fits. Press Next.' },
      { el: '#markerList .mk-card details > summary', panel: true, text: 'Click [Bands] and untick a size you do not need on the figure. [Thin labels] does it for you when labels are crowded.',
        enter: () => shownBands(), done: b => shownBands() !== b }] },
    { title: 'Group lanes', parts: [
      { el: '#btnAddGroup', panel: true, text: 'Step 5, Annotations. Click [Group line].', done: () => App.mode === 'group' },
      { rect: laneLabels, avoid: '#figCol', text: 'Now drag across two or more lane names on the figure, from the first to the last, and release. Then type a label such as EcoRI and press Enter.',
        enter: () => S().groups.length, done: b => !typing() && S().groups.length > b }] },
    { title: 'Mark a band', optional: true, parts: [
      { el: '#btnAddArrow', panel: true, text: 'Click [Target band].', done: () => App.mode === 'arrow' },
      { rect: () => gelImage() && rectOf(gelImage()), avoid: '#figCol', text: 'Click a band on the figure. An arrow appears with the size estimated from the ladder; name it if you like and press [Done].',
        enter: () => S().arrows.length, done: b => !typing() && S().arrows.length > b }] },
    { title: 'Measure bands', optional: true, parts: [
      { el: '#quantSec', panel: true, text: 'Step 7, Densitometry: a band box is measured in every lane; the chart and table open in the Densitometry view beside the figure. Press Next.' },
      { el: '#btnAddBox', panel: true, text: 'Click [+ Band box].', done: () => App.mode === 'quant' },
      { rect: cropRect, avoid: '#editorBox', text: 'Click a band on the raw image, inside the red box. The box fits itself to the band and the Densitometry view opens. For a Western, the second box is the loading control.',
        enter: () => S().quant.rows.length, done: b => !typing() && S().quant.rows.length > b },
      { el: '#viewSeg [data-view="figure"]', text: 'Click [Figure] to come back to the figure.', done: () => G.QuantUI.view() === 'figure' }] },
    { title: 'Export the figure', parts: [
      { el: '.topbar .split', text: 'Click [Export PNG], the left part of this button (the arrow lists TIFF, PDF and SVG). A pre-flight check lists anything a reviewer might ask about, then the figure is saved at the chosen dpi.',
        enter: () => exported, done: b => exported > b }] },
    { title: 'Done', parts: [
      { last: true, text: 'That is the whole process. Your own gels are kept in the Library with everything you did, so you can return to them any time; Open / Save holds project files for other computers. [Guide me] in the top bar runs this again on any gel. Next, a two-minute overview of the rest of the screen?' }] }
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
    $('tourStatus').textContent = mode === 'tutorial' && p.done ? (isDone ? '✓ Done' : optional ? 'Optional step' : 'Do it on the page to continue') : '';
    $('tourStatus').classList.toggle('ok', isDone);
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

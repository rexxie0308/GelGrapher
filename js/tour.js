/* Guidance, two kinds, one engine:
 *   tutorial  hands-on: each step asks for one real action (open a gel, drag the box, name lanes,
 *             group, arrow, export) and continues when the app shows it was done; the page stays usable
 *   tour      a two-minute overview: a spotlight on one part of the screen at a time, read-only
 * The tutorial starts by itself on the first visit (empty workspace); both are under Help.
 * Steps whose target is not on screen are skipped. */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const S = () => App.S;
  const figLanes = () => (G.UI && G.UI.figLanes ? G.UI.figLanes() : []);
  const named = () => figLanes().filter(i => S().lanes[i].name && !S().markers.some(m => m.lane === i)).length;
  const names = () => JSON.stringify(figLanes().map(i => S().lanes[i].name));

  const TUTORIAL = [
    { el: '#emptyState .examples', title: 'Open a practice gel', text: 'Click DNA gel under Examples. Everything after this works the same for your own images, which you can drop anywhere in the window.',
      done: () => !!S(), after: () => { if (App.isExample) cleanSlate(); } },
    { el: '#editorBox', title: 'What was found', text: 'Straightening, the red figure box, the blue lanes and the yellow ladder bands were detected automatically. Scroll to zoom, Space + drag to pan. Press Next when you have had a look.', review: true },
    { el: '#editorBox', title: 'Adjust the figure area', text: 'Drag the bottom edge of the red box up a little: the figure on the right follows. (Ctrl+Z undoes any step.)',
      enter: () => JSON.stringify(S().crop), done: b => JSON.stringify(S().crop) !== b },
    { el: '#figCol', title: 'Name the lanes', text: 'Click a lane number (or name) above the figure, type a name such as WT, then press Enter to jump to the next lane. Name or rename at least two lanes.',
      enter: () => names(), done: b => named() >= 2 && names() !== b },
    { el: '#sections .sec:nth-of-type(4)', title: 'Check the ladder', text: 'The marker card names the ladder that matched and how well it fits. Open Bands and untick a size you do not need on the figure; "Thin labels" does it for you when they are crowded.',
      enter: () => S().markers.reduce((a, m) => a + m.bands.filter(b => b.show).length, 0), done: b => S().markers.reduce((a, m) => a + m.bands.filter(b => b.show).length, 0) !== b, optional: true, panel: true },
    { el: '#btnAddGroup', title: 'Group lanes', text: 'Click Group line, drag across two or more lane names on the figure, release, and type a label such as "EcoRI".',
      enter: () => S().groups.length, done: b => S().groups.length > b, panel: true },
    { el: '#btnAddArrow', title: 'Mark a band', text: 'Click Target band, then click a band on the figure: an arrow with the size estimated from the ladder appears.',
      enter: () => S().arrows.length, done: b => S().arrows.length > b, optional: true, panel: true },
    { el: '#quantSec', title: 'Measure bands', text: 'Click + Band box, then click a band on the raw image. The Densitometry view opens with one value per lane; for a Western, tick the loading control on the second box.',
      enter: () => S().quant.rows.length, done: b => S().quant.rows.length > b, optional: true, panel: true },
    { el: '#btnPNG', title: 'Export the figure', text: 'Click Export PNG. The pre-flight check lists anything a reviewer might ask about, then the figure is saved at the chosen dpi. TIFF, PDF and SVG are under the arrow.',
      enter: () => exported, done: b => exported > b },
    { title: 'Done', text: 'That is the whole process. Your own gels are kept in the Library with everything you did, so you can return to them any time; Open / Save holds project files for other computers. "Guide me" in the top bar runs this again on any gel. Next, a two-minute overview of the rest of the screen?', last: true }
  ];
  const TOUR = [
    { title: 'A two-minute overview', text: 'Where everything is. Everything happens in your browser: images never leave your computer. Replay this any time from the ? button.' },
    { el: '#imgChip', title: 'Your image', text: 'The file that is open. Drop a new image anywhere in the window, or use Open / Save.' },
    { el: '#sections .sec:nth-of-type(1)', title: '1 · Image', text: 'Pick the experiment (it chooses the ladder library and the unit) and how bands should look. Straightening and contrast were set automatically; open "Straighten and contrast" only when they need a hand.', panel: true },
    { el: '#editorBox', title: 'Raw image', text: 'Red box = what becomes the figure; blue = lanes; yellow = marker bands. Drag a box edge, a lane line or a marker band to correct it. Scroll to zoom, Space + drag to pan.' },
    { el: '#sections .sec:nth-of-type(2)', title: '2 · Lanes in figure', text: 'Choose the wells that appear. Lanes detected wrongly? Re-detect inside the red box, or space N lanes evenly.', panel: true },
    { el: '#figCol', title: 'Figure', text: 'The finished figure. Click a grey lane number and type its name; Enter jumps to the next lane. Any label can be edited by clicking it. The Densitometry view next to "Figure" shows measurements once you add band boxes.' },
    { el: '#sections .sec:nth-of-type(4)', title: '4 · Marker', text: 'The ladder lane was found and fitted; the fit score says whether to check it. A band placed wrongly? Drag its yellow line on the raw image and the others re-fit.', panel: true },
    { el: '#sections .sec:nth-of-type(5)', title: '5 · Annotations', text: 'Group lines over lane names, arrows at target bands (sized from the ladder), + / − condition rows, and strips to show only parts of a blot.', panel: true },
    { el: '#quantSec', title: '7 · Densitometry', text: 'Add a band box per band of interest and tick the loading control. Every lane is measured, and the chart and table open in the Densitometry view of the figure area.', panel: true },
    { el: '#btnPNG', title: 'Export', text: 'PNG at the chosen dpi; TIFF, PDF and SVG from the arrow. A pre-flight check points out saturation, missing names and other problems first.' },
    { el: '#btnLibrary', title: 'Library', text: 'Every gel you open is kept here with your latest edits, so you can come back any time. Open / Save holds project files for other computers.' },
    { el: '#btnHelp', title: 'Help', text: 'Shortcuts, common tasks, the hands-on tutorial and this overview live under the ? button.' }
  ];

  // an example comes fully annotated; for practice it is stripped back to what detection found
  function cleanSlate() {
    const st = S();
    st.lanes.forEach((l, k) => { if (!st.markers.some(m => m.lane === k)) l.name = ''; });
    st.groups = []; st.arrows = []; st.conditions = []; st.strips = []; st.quant.rows = []; st.quant.control = -1;
    App.commit();
  }
  let mode = null, steps = [], i = -1, base = null, isDone = false, timer = 0, exported = 0;
  const box = () => $('tour'), spot = () => $('tourSpot'), card = () => $('tourCard');
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const stepOk = s => !s.el || visible(document.querySelector(s.el));

  function place() {
    const s = steps[i], el = s.el ? document.querySelector(s.el) : null;
    $('tourTitle').textContent = s.title; $('tourText').textContent = s.text;
    $('tourStep').textContent = `${i + 1} / ${steps.length}`;
    $('tourBack').disabled = i === 0;
    const waits = mode === 'tutorial' && !!s.done && !isDone;
    $('tourNext').textContent = s.last ? 'Done' : i === steps.length - 1 ? 'Done' : waits ? (s.optional ? 'Skip' : 'Waiting…') : 'Next';
    $('tourNext').disabled = waits && !s.optional;
    $('tourStatus').textContent = mode === 'tutorial' && s.done ? (isDone ? '✓ Done' : s.optional ? 'Optional' : 'Do it on the page to continue') : '';
    $('tourStatus').classList.toggle('ok', isDone);
    $('tourTourBtn').classList.toggle('hidden', !(mode === 'tutorial' && s.last));
    const sp = spot(), c = card(), pad = 6, vw = window.innerWidth, vh = window.innerHeight;
    if (el && s.panel) el.scrollIntoView({ block: 'center' });
    const r = el ? el.getBoundingClientRect() : null;
    if (r) { sp.style.display = ''; sp.style.left = (r.left - pad) + 'px'; sp.style.top = (r.top - pad) + 'px'; sp.style.width = (r.width + 2 * pad) + 'px'; sp.style.height = (r.height + 2 * pad) + 'px'; }
    else sp.style.display = 'none';
    // the card: beside the target where there is room, else below or above it; centred without a target
    const cw = Math.min(360, vw - 24), ch = c.offsetHeight || 180;
    let left, top;
    if (!r) { left = (vw - cw) / 2; top = (vh - ch) / 2; }
    else if (r.right + 16 + cw <= vw) { left = r.right + 16; top = Math.min(Math.max(12, r.top), vh - ch - 12); }
    else if (r.left - 16 - cw >= 0) { left = r.left - 16 - cw; top = Math.min(Math.max(12, r.top), vh - ch - 12); }
    else if (r.bottom + 12 + ch <= vh) { left = Math.min(Math.max(12, r.left), vw - cw - 12); top = r.bottom + 12; }
    else { left = Math.min(Math.max(12, r.left), vw - cw - 12); top = Math.max(12, r.top - 12 - ch); }
    c.style.left = left + 'px'; c.style.top = top + 'px';
    if (mode === 'tour') c.focus({ preventScroll: true });
  }
  function enter(k) {
    i = k; isDone = false;
    const s = steps[i];
    base = s.enter ? s.enter() : null;
    place();
  }
  function go(k) {
    // skip steps whose target is not on screen
    while (k >= 0 && k < steps.length && !stepOk(steps[k])) k += k > i ? 1 : -1;
    if (k < 0) k = 0;
    if (k >= steps.length) { finish(); return; }
    enter(k);
  }
  // the tutorial watches the page: when the asked-for action shows in the state, the step is done
  function check() {
    if (mode !== 'tutorial' || i < 0) return;
    const s = steps[i];
    if (!s.done || isDone) return;
    let ok = false;
    try { ok = !!s.done(base); } catch (e) { ok = false; }
    if (!ok) return;
    isDone = true; place();
    if (s.after) { try { s.after(); } catch (e) { /* best effort */ } }
    setTimeout(() => { if (mode === 'tutorial' && steps[i] === s && isDone) go(i + 1); }, 900);
  }
  function start(which) {
    mode = which === 'tutorial' ? 'tutorial' : 'tour';
    steps = (mode === 'tutorial' ? TUTORIAL : TOUR).slice(); i = -1;
    box().classList.remove('hidden'); box().classList.toggle('hands-on', mode === 'tutorial');
    document.body.classList.add('touring');
    clearInterval(timer); timer = setInterval(() => { check(); if (i >= 0) place(); }, 500);
    requestAnimationFrame(() => go(0));
  }
  function finish() {
    if (box().classList.contains('hidden')) return;
    const was = mode;
    box().classList.add('hidden'); document.body.classList.remove('touring'); clearInterval(timer); timer = 0; i = -1; mode = null;
    App.setPref(was === 'tutorial' ? 'tutorialSeen' : 'tourSeen', true);
  }
  $('tourNext').onclick = () => { const s = steps[i]; if (!s) return; if (s.last || i === steps.length - 1) finish(); else go(i + 1); };
  $('tourBack').onclick = () => go(i - 1);
  $('tourSkip').onclick = finish;
  $('tourTourBtn').onclick = () => { finish(); start('tour'); };
  box().addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (mode === 'tour' && (e.key === 'ArrowRight' || e.key === 'Enter')) { e.preventDefault(); $('tourNext').click(); }
    else if (mode === 'tour' && e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    e.stopPropagation();
  });
  window.addEventListener('resize', () => { if (i >= 0) place(); });
  App.on(() => { if (i >= 0) { check(); place(); } });
  // an export counts when the button is pressed (the pre-flight dialog may follow)
  $('btnPNG').addEventListener('click', () => { exported++; check(); }, true);
  G.Tour = { start, finish, next: () => $('tourNext').click(), back: () => go(i - 1), skipStep: () => go(i + 1), step: () => i, count: () => steps.length,
    active: () => i >= 0, mode: () => mode, done: () => isDone, seen: which => !!App.prefs()[which === 'tutorial' ? 'tutorialSeen' : 'tourSeen'] };
})(window);

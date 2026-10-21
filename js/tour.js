/* Guided tour: a spotlight on one part of the screen at a time, with a short card. Starts by itself
 * on the first visit (once the worked example is open) and any time from Help -> "Take the tour".
 * Steps whose target is not on screen (no gel open, a narrow window) are skipped. */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const STEPS = [
    { title: 'Welcome to GelGrapher', text: 'It turns a gel or blot image into a publication figure, with densitometry. Everything happens in your browser: images never leave your computer. This two-minute tour shows where things are; replay it any time from the ? button.' },
    { el: '#imgChip', title: 'Your image', text: 'The file that is open. Drop a new image anywhere in the window, or use Open / Save. What you see now is a synthetic example.' },
    { el: '#sections .sec:nth-of-type(1)', title: '1 · Image', text: 'Pick the experiment (it chooses the ladder library and the unit) and how bands should look. Straightening and contrast were set automatically; open "Straighten and contrast" only when they need a hand.', panel: true },
    { el: '#editorBox', title: 'Raw image', text: 'Red box = what becomes the figure; blue = lanes; yellow = marker bands. Drag a box edge, a lane line or a marker band to correct it. Scroll to zoom, Space + drag to pan.' },
    { el: '#sections .sec:nth-of-type(2)', title: '2 · Lanes in figure', text: 'Choose the wells that appear. Lanes detected wrongly? Re-detect inside the red box, or space N lanes evenly.', panel: true },
    { el: '#figCol', title: 'Figure', text: 'The finished figure. Click a grey lane number and type its name; Enter jumps to the next lane. Any label can be edited by clicking it. The Densitometry view next to "Figure" shows measurements once you add band boxes.' },
    { el: '#sections .sec:nth-of-type(4)', title: '4 · Marker', text: 'The ladder lane was found and fitted; the fit score says whether to check it. A band placed wrongly? Drag its yellow line on the raw image and the others re-fit.', panel: true },
    { el: '#sections .sec:nth-of-type(5)', title: '5 · Annotations', text: 'Group lines over lane names, arrows at target bands (sized from the ladder), + / − condition rows, and strips to show only parts of a blot.', panel: true },
    { el: '#quantSec', title: '7 · Densitometry', text: 'Add a band box per band of interest and tick the loading control. Every lane is measured, and the chart and table open in the Densitometry view of the figure area.', panel: true },
    { el: '#btnPNG', title: 'Export', text: 'PNG at the chosen dpi; TIFF, PDF and SVG from the arrow. A pre-flight check points out saturation, missing names and other problems first.' },
    { el: '#btnLibrary', title: 'Library', text: 'Every gel you open is kept here with your latest edits, so you can come back any time. Open / Save holds project files for other computers.' },
    { el: '#btnHelp', title: 'Help', text: 'Shortcuts, common tasks and this tour live under the ? button. Enjoy!' }
  ];
  let steps = [], i = -1, onDone = null;
  const box = () => $('tour'), spot = () => $('tourSpot'), card = () => $('tourCard');
  const visible = el => { if (!el) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };

  function place() {
    const s = steps[i], el = s.el ? document.querySelector(s.el) : null;
    $('tourTitle').textContent = s.title; $('tourText').textContent = s.text;
    $('tourStep').textContent = `${i + 1} / ${steps.length}`;
    $('tourBack').disabled = i === 0;
    $('tourNext').textContent = i === steps.length - 1 ? 'Done' : 'Next';
    const sp = spot(), c = card(), pad = 6, vw = window.innerWidth, vh = window.innerHeight;
    if (el && s.panel) el.scrollIntoView({ block: 'center', behavior: 'instant' in el ? 'instant' : 'auto' });
    const r = el ? el.getBoundingClientRect() : null;
    if (r) { sp.style.display = ''; sp.style.left = (r.left - pad) + 'px'; sp.style.top = (r.top - pad) + 'px'; sp.style.width = (r.width + 2 * pad) + 'px'; sp.style.height = (r.height + 2 * pad) + 'px'; }
    else sp.style.display = 'none';
    // the card: beside the target where there is room, else below or above it; centred without a target
    c.style.maxWidth = Math.min(360, vw - 24) + 'px';
    const cw = Math.min(360, vw - 24), ch = c.offsetHeight || 180;
    let left, top;
    if (!r) { left = (vw - cw) / 2; top = (vh - ch) / 2; }
    else if (r.right + 16 + cw <= vw) { left = r.right + 16; top = Math.min(Math.max(12, r.top), vh - ch - 12); }
    else if (r.left - 16 - cw >= 0) { left = r.left - 16 - cw; top = Math.min(Math.max(12, r.top), vh - ch - 12); }
    else if (r.bottom + 12 + ch <= vh) { left = Math.min(Math.max(12, r.left), vw - cw - 12); top = r.bottom + 12; }
    else { left = Math.min(Math.max(12, r.left), vw - cw - 12); top = Math.max(12, r.top - 12 - ch); }
    c.style.left = left + 'px'; c.style.top = top + 'px';
    c.focus({ preventScroll: true });
  }
  function go(k) {
    // skip steps whose target is not on screen
    while (k >= 0 && k < steps.length && steps[k].el && !visible(document.querySelector(steps[k].el))) k += k > i ? 1 : -1;
    if (k < 0) k = 0;
    if (k >= steps.length) { finish(); return; }
    i = k; place();
  }
  function start(cb) {
    steps = STEPS.slice(); i = -1; onDone = cb || null;
    box().classList.remove('hidden'); document.body.classList.add('touring');
    requestAnimationFrame(() => go(0));
  }
  function finish() {
    if (box().classList.contains('hidden')) return;
    box().classList.add('hidden'); document.body.classList.remove('touring'); i = -1;
    App.setPref('tourSeen', true);
    if (onDone) { const f = onDone; onDone = null; f(); }
  }
  $('tourNext').onclick = () => (i === steps.length - 1 ? finish() : go(i + 1));
  $('tourBack').onclick = () => go(i - 1);
  $('tourSkip').onclick = finish;
  box().addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); finish(); }
    else if (e.key === 'ArrowRight' || e.key === 'Enter') { e.preventDefault(); $('tourNext').click(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(i - 1); }
    e.stopPropagation();
  });
  window.addEventListener('resize', () => { if (i >= 0) place(); });
  G.Tour = { start, finish, next: () => $('tourNext').click(), back: () => go(i - 1), step: () => i, count: () => steps.length, active: () => i >= 0, seen: () => !!App.prefs().tourSeen };
})(window);

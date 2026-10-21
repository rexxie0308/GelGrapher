/* Draggable dividers: between the settings panel and the stage (panel width), and between the raw
 * image and the figure (their share of the stage, left/right or, on a stacked stage, top/bottom).
 * The sizes are remembered in the preferences; double-click (or Home on the keyboard) resets one.
 * The editor watches its own box (ResizeObserver) and the figure preview listens for `resize`,
 * so a drag only sets CSS variables and fires that event. On phones (one column) there are no dividers. */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const app = $('app'), stage = $('stage');
  const MIN_PANEL = 240, maxPanel = () => Math.min(600, window.innerWidth * 0.45);

  function apply() {
    const p = App.prefs();
    app.style.setProperty('--panel-w', p.panelW ? p.panelW + 'px' : '');
    const r = p.stageSplit;
    stage.style.setProperty('--raw-flex', r ? String(r) : '');
    stage.style.setProperty('--fig-flex', r ? String(1 - r) : '');
  }
  let raf = 0;
  const notify = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.dispatchEvent(new Event('resize')); }); };
  const stacked = () => getComputedStyle(stage).flexDirection === 'column';

  function setPanel(px) { App.setPref('panelW', Math.round(Math.min(maxPanel(), Math.max(MIN_PANEL, px)))); apply(); notify(); }
  function setSplit(ratio) { App.setPref('stageSplit', Math.round(Math.min(0.8, Math.max(0.2, ratio)) * 1000) / 1000); apply(); notify(); }
  const reset = key => { App.setPref(key, null); apply(); notify(); refit(); };
  // the raw image keeps its zoom while a divider moves and is fitted to the figure area once it settles
  const refit = () => { if (App.S && G.Editor) G.Editor.fitCrop(); };

  function gutter(el, opts) {
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); el.classList.add('drag'); document.body.classList.add('resizing');
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
      const grab = opts.grab(e);   // where in the divider the pointer took hold, so the edge does not jump to it
      const move = ev => { if (ev.pointerId === e.pointerId) opts.drag(ev, grab); };
      const up = ev => {
        if (ev.pointerId !== e.pointerId) return;
        try { el.releasePointerCapture(ev.pointerId); } catch (err) { /* not captured */ }
        el.classList.remove('drag'); document.body.classList.remove('resizing');
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
        refit();
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    });
    el.addEventListener('dblclick', opts.reset);
    el.addEventListener('keydown', e => {
      const step = e.shiftKey ? 40 : 10;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { opts.nudge(-step); e.preventDefault(); }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { opts.nudge(step); e.preventDefault(); }
      else if (e.key === 'Home') { opts.reset(); e.preventDefault(); }
    });
  }
  gutter($('gutterPanel'), {
    grab: e => e.clientX - $('panel').getBoundingClientRect().right,
    drag: (e, g) => setPanel(e.clientX - g - app.getBoundingClientRect().left),
    nudge: d => setPanel($('panel').getBoundingClientRect().width + d),
    reset: () => reset('panelW')
  });
  gutter($('gutterStage'), {
    grab: e => { const r = $('rawCol').getBoundingClientRect(); return stacked() ? e.clientY - r.bottom : e.clientX - r.right; },
    drag: (e, g) => { const b = stage.getBoundingClientRect(); setSplit(stacked() ? (e.clientY - g - b.top) / b.height : (e.clientX - g - b.left) / b.width); },
    nudge: d => { const b = stage.getBoundingClientRect(), raw = $('rawCol').getBoundingClientRect(); setSplit(stacked() ? (raw.height + d) / b.height : (raw.width + d) / b.width); },
    reset: () => reset('stageSplit')
  });
  apply();
  G.Splitters = { apply, setPanel, setSplit, reset };
})(window);

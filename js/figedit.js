/* Direct editing on the figure preview: click a lane name to type (Enter = next lane), drag across
 * lane names to make a group, click +/- cells to cycle, click an arrow for its size/label popover,
 * and the "place arrow" mode (click a band in either view). */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const S = () => App.S;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const fed = $('floatEd'), pop = $('popover'), prev = $('preview'), guide = $('arrowGuide');
  const composing = e => e.isComposing || e.keyCode === 229;

  /* ---------- modes ---------- */
  function setMode(m) {
    App.mode = m;
    $('modeBanner').classList.toggle('hidden', !m);
    // one instruction for the active tool: what it is, what to do, how to leave it
    $('modeText').textContent = m === 'arrow' ? 'Band arrow: click the band on either image · Esc cancels'
      : m === 'group' ? 'Group bracket: drag across the lane names on the figure · Esc cancels'
      : m === 'strip' ? 'Strip: drag down across the region on the image · Esc cancels'
      : m === 'quant' ? 'Add band: click or drag on image · Esc cancels'
      : m === 'lane' ? 'Add lane: click the lane centre on the image · Shift+click adds more · Esc ends' : '';
    [['btnAddArrow', 'arrow'], ['btnAddGroup', 'group'], ['btnAddStrip', 'strip'], ['btnAddBox', 'quant'], ['btnAddLane', 'lane']].forEach(([id, k]) => { $(id).classList.toggle('on', m === k); $(id).setAttribute('aria-pressed', String(m === k)); });
    $('addLaneHint').classList.toggle('hidden', m !== 'lane');
    prev.classList.toggle('arming', m === 'arrow');
    if (m !== 'arrow') guide.classList.add('hidden');
    // every tool opens the view it works in: a band box the Densitometry view, an arrow, group line or strip the figure
    // a tool that makes a band box or a strip works on that layer (the Editing switch shows it); the window follows
    if (m && G.QuantUI) { if (m === 'quant' || m === 'strip') G.QuantUI.setLayer(m === 'quant' ? 'quant' : 'figure'); G.QuantUI.follow(m === 'quant' ? 'quant' : 'figure'); }
    G.Editor.draw();
  }
  $('modeCancel').onclick = () => setMode(null);
  $('btnAddArrow').onclick = () => { if (S()) setMode(App.mode === 'arrow' ? null : 'arrow'); };
  $('btnAddGroup').onclick = () => { if (S()) setMode(App.mode === 'group' ? null : 'group'); };
  $('btnAddStrip').onclick = () => { if (S()) setMode(App.mode === 'strip' ? null : 'strip'); };
  $('btnAddBox').onclick = () => { if (S()) setMode(App.mode === 'quant' ? null : 'quant'); };

  /* a strip or band box drawn on the raw image: y0..y1, or (a click) only the point clicked */
  App.finishRegion = async function (mode, y0, y1, x, yClick) {
    const st = S(), c = st.crop;
    setMode(null);
    if (mode === 'quant') {
      const r = y0 != null ? { y0, y1 } : G.Quant.bandBox(App, x, yClick);
      if (!r) return;
      // one table never mixes two methods: an analysis measured with the earlier calculation is updated before a
      // band is added, and only when the user agrees (its values change; Undo brings them back)
      if (st.quant.version !== G.Quant.VERSION && st.quant.rows.length) {
        const ok = await G.UI.confirm('This analysis was measured with the earlier method (version 1). Adding a band updates every band to the current method: local background outside each band, signed sums, regions fixed on the original pixels. The values will change; Undo brings the earlier ones back.', 'Update and add');
        if (!ok || S() !== st) return;
        G.Quant.updateToCurrent(App);
      }
      st.quant.version = G.Quant.VERSION;
      // the first box fixes the analysis area: from now on the figure box can change without changing a result
      if (!st.quant.region) st.quant.region = Object.assign({}, st.crop);
      // the band's regions are placed now, in the frame shown, and stay on those original pixels
      const row = { name: '' };
      G.Quant.placeRow(App, row, r.y0, r.y1);
      st.quant.rows.push(row);
      // no loading control is suggested: dividing by a box is a choice the user makes (and must justify)
      App.boxAdded = true;   // a box drawn by the user opens the Densitometry view (quantui.js)
      App.commit();
      const d = $('quantDetails'); if (d && !d.open) d.open = true;
      requestAnimationFrame(() => { const inp = document.querySelector(`#boxList input[data-q="${st.quant.rows.length - 1}"]`); if (inp) inp.focus(); });
    } else {
      const hh = Math.max(12, c.h * 0.08);
      const r = y0 != null ? { y0, y1 } : { y0: Math.max(c.y, yClick - hh), y1: Math.min(c.y + c.h, yClick + hh) };
      st.strips.push({ y0: r.y0, y1: r.y1, label: '' });
      st.markers.forEach(m => App.thinMarkerLabels(m, false));
      App.commit();
      const k = st.strips.length - 1;
      requestAnimationFrame(() => openEd('strip', k));
    }
  };
  $('btnAddCond').onclick = () => {
    if (!S()) return;
    if (G.QuantUI) G.QuantUI.follow('figure');
    S().conditions.push({ name: '', values: S().lanes.map(() => '') });
    App.commit();
    G.UI.toast('Click each cell on the figure to cycle + / − / empty; click "Condition" to name the row', 3200);
  };

  App.placeArrow = function (x, y) {
    const sy = App.snapBandY(x, y);
    S().arrows.push({ y: sy != null ? sy : y, x, text: '', size: true, side: '' });
    const k = S().arrows.length - 1;
    App.selArrow = k;
    setMode(null);
    App.commit();
    requestAnimationFrame(() => arrowPopover(k, prev.querySelector(`g[data-edit="arrow"][data-k="${k}"]`)));
  };

  /* ---------- inline text editor ---------- */
  let edit = null;   // { kind, id, orig }
  const getVal = (kind, id) => kind === 'lane' ? S().lanes[id].name : kind === 'group' ? S().groups[id].text : kind === 'strip' ? S().strips[id].label : S().conditions[id].name;
  const setVal = (kind, id, v) => { if (kind === 'lane') S().lanes[id].name = v; else if (kind === 'group') S().groups[id].text = v; else if (kind === 'strip') S().strips[id].label = v; else S().conditions[id].name = v; };
  function openEd(kind, id) {
    closePop();
    const el = prev.querySelector(kind === 'lane' ? `g[data-edit="lane"][data-src="${id}"]` : kind === 'group' ? `g[data-edit="group"][data-k="${id}"]`
      : kind === 'strip' ? `g[data-edit="strip"][data-k="${id}"]` : `g[data-edit="condname"][data-r="${id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    edit = { kind, id, orig: getVal(kind, id) || '' };
    fed.value = edit.orig;
    fed.placeholder = kind === 'lane' ? `Well ${id + 1} name` : kind === 'group' ? 'Group label (Shift+Enter: new line)' : kind === 'strip' ? 'Protein / probe, e.g. p53' : 'Condition name';
    fitRows();
    const w = Math.max(120, Math.min(240, r.width + 50));
    fed.style.width = w + 'px';
    // where the text will be: over a lane name or group label (above the gel); a strip label grows to the right of
    // the gel, a condition name to the left of it, so the box never covers the gel image
    const left = kind === 'strip' ? r.left : kind === 'condname' ? r.right - w : r.left + r.width / 2 - w / 2;
    fed.style.left = clamp(left, 4, innerWidth - w - 4) + 'px';
    fed.style.top = clamp(r.top + r.height / 2 - 15, 56, innerHeight - 40) + 'px';
    fed.classList.remove('hidden');
    fed.focus(); fed.select();
    if (kind === 'lane') { App.selLane = id; G.Editor.draw(); }
  }
  function closeEd(revert) {
    if (!edit) return;
    const e = edit; edit = null;
    if (revert) setVal(e.kind, e.id, e.orig);
    else setVal(e.kind, e.id, fed.value.trim());
    fed.classList.add('hidden');
    App.commit();
  }
  // the box is a one-line textarea so a group label can hold typed line breaks (Shift+Enter); it grows with them
  const fitRows = () => { fed.rows = Math.max(1, Math.min(4, fed.value.split('\n').length)); };
  fed.addEventListener('input', () => { if (edit) { fitRows(); setVal(edit.kind, edit.id, fed.value); App.refresh(); } });
  fed.addEventListener('keydown', e => {
    if (!edit || composing(e)) return;          // IME is choosing characters: Enter belongs to it
    if (e.key === 'Escape') { e.preventDefault(); closeEd(true); return; }
    if (e.key === 'Enter' && e.shiftKey && edit.kind === 'group') return;   // a new line in the label
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      const { kind, id } = edit;
      closeEd(false);
      if (kind === 'lane') {
        const fl = G.UI.figLanes(), k = fl.indexOf(id) + (e.shiftKey ? -1 : 1);
        if (k >= 0 && k < fl.length) requestAnimationFrame(() => openEd('lane', fl[k]));
        else G.UI.toast(e.shiftKey ? 'This is the first lane' : 'All lane names are filled in');
      }
    }
  });
  fed.addEventListener('blur', () => { if (edit) closeEd(false); });

  /* ---------- arrow popover ---------- */
  let popK = -1;
  function closePop() { if (popK >= 0) { popK = -1; pop.classList.add('hidden'); App.commit(); } }
  function arrowPopover(k, anchor) {
    const a = S().arrows[k];
    if (!a) return;
    closeEd(false);
    popK = k; App.selArrow = k;
    const info = App.estimateInfo(a.y, a.x), est = info && info.bp;
    // honest about where the number comes from: which marker(s), and whether it lies outside the ladder
    let estHtml = 'No usable marker; the size cannot be estimated';
    if (info) {
      const v = `<b>${info.extrap || info.disagree ? '≈' : ''}${App.fmtSize(est)}</b>`;
      estHtml = `Estimated from marker: ${v} (${App.fmtExact(est)})`;
      if (info.extrap) estHtml += '<br><span class="warn-t">' + 'Outside the ladder range: extrapolated, shown with ≈' + '</span>';
      if (info.perMarker.length > 1) estHtml += '<br>' + info.perMarker.map(p => `well ${p.lane + 1}: ` + App.fmtSize(p.bp) + (p.extrap ? ' (extrapolated)' : '')).join('; ')
        + (info.disagree ? ' <span class="warn-t">' + 'differ by &gt;10%' + '</span>' : '');
    }
    pop.innerHTML = `<h4>${'Target band arrow'}</h4>
      <div class="field"><input type="text" id="pName" placeholder="${App.kind() === 'dna' || App.kind() === 'rna' ? 'Name (optional), e.g. PCR product' : 'Name (optional), e.g. p53, GAPDH'}" value="${esc(a.text)}"></div>
      <div class="est">${estHtml}</div>
      <div class="field inline"><label class="switch"><input type="checkbox" id="pSize" ${a.size ? 'checked' : ''}><span>${'Show size'}</span></label>
        <input type="text" id="pSizeText" placeholder="${est ? App.fmtSize(est) : (App.baseUnit() === 'kDa' ? 'e.g. 53 kDa' : 'e.g. 452 bp')}" value="${esc(a.sizeText || '')}" style="flex:1" title="${'Empty = use the estimate; or type the expected size'}"></div>
      <div class="field inline"><label class="inline-label">${'Side'}</label>
        <select id="pSide" style="width:auto"><option value="">${'Auto'}</option><option value="right">${'Right'}</option><option value="left">${'Left'}</option></select>
        <span class="hint" style="margin:0">${'Drag the magenta line on the image to move it'}</span></div>
      <div class="actions"><button class="btn sm danger" id="pDel">${'Delete'}</button><button class="btn sm primary" id="pOk">${'Done'}</button></div>`;
    pop.querySelector('#pSide').value = a.side || '';
    const r = (anchor || prev).getBoundingClientRect(), svg = prev.querySelector('svg'), sr = svg ? svg.getBoundingClientRect() : r;
    pop.classList.remove('hidden');
    const pw = 250, ph = pop.offsetHeight;
    // beside the figure (never over it), at the arrow's height; beside the arrow itself only when neither side has room
    const left = sr.right + 10 + pw <= innerWidth - 6 ? sr.right + 10 : sr.left - pw - 10 >= 6 ? sr.left - pw - 10 : (r.right + 10 + pw > innerWidth ? r.left - pw - 10 : r.right + 10);
    pop.style.left = clamp(left, 6, innerWidth - pw - 6) + 'px';
    pop.style.top = clamp(r.top - 20, 58, innerHeight - ph - 8) + 'px';
    const upd = () => App.refresh();
    pop.querySelector('#pName').addEventListener('input', e => { a.text = e.target.value; upd(); });
    pop.querySelector('#pName').addEventListener('keydown', e => { if (e.key === 'Enter' && !composing(e)) closePop(); });
    pop.querySelector('#pSize').addEventListener('change', e => { a.size = e.target.checked; upd(); });
    pop.querySelector('#pSizeText').addEventListener('input', e => {
      a.sizeText = e.target.value.trim();
      if (a.sizeText) { a.size = true; pop.querySelector('#pSize').checked = true; }
      // bilateral: a typed size moves the arrow to where the markers put that size (the magenta line on the image follows)
      if (a.sizeText && App.arrowToSize(k, a.sizeText)) {
        const i2 = App.estimateInfo(a.y, a.x);
        pop.querySelector('.est').innerHTML = i2 ? `Moved to ${App.fmtSize(i2.bp)} on the ladder scale${i2.extrap ? ' <span class="warn-t">(outside the ladder range)</span>' : ''}` : estHtml;
      }
      upd();
    });
    pop.querySelector('#pSide').addEventListener('change', e => { a.side = e.target.value; upd(); });
    pop.querySelector('#pOk').onclick = closePop;
    pop.querySelector('#pDel').onclick = () => { S().arrows.splice(k, 1); App.selArrow = -1; popK = -1; pop.classList.add('hidden'); App.commit(); };
    setTimeout(() => pop.querySelector('#pName').focus(), 0);
  }
  document.addEventListener('pointerdown', e => { if (popK >= 0 && !pop.contains(e.target) && !e.target.closest('[data-aed]') && !e.target.closest('g[data-edit="arrow"]')) closePop(); });

  /* ---------- preview pointer handling ---------- */
  let press = null;
  const laneAt = (x, y) => { const el = document.elementFromPoint(x, y); const g = el && el.closest && el.closest('g[data-edit="lane"]'); return g ? +g.dataset.src : null; };
  function highlight(a, b) {
    prev.querySelectorAll('g[data-edit="lane"]').forEach(g => {
      const s = +g.dataset.src;
      g.classList.toggle('active', a != null && s >= Math.min(a, b) && s <= Math.max(a, b));
    });
  }
  prev.addEventListener('pointerdown', e => {
    if (!S()) return;
    const g = e.target.closest('[data-edit]');
    if (!g) return;
    if (g.dataset.edit === 'lane') { press = { src: +g.dataset.src, x: e.clientX, y: e.clientY, moved: false, end: +g.dataset.src }; e.preventDefault(); }
  });
  window.addEventListener('pointermove', e => {
    if (!press) return;
    if (Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y) > 6) press.moved = true;
    if (press.moved) { const l = laneAt(e.clientX, e.clientY); if (l != null) press.end = l; highlight(press.src, press.end); }
  });
  window.addEventListener('pointerup', e => {
    if (!press) return;
    const p = press; press = null;
    highlight(null);
    if ((p.moved && p.end !== p.src) || App.mode === 'group') {
      // drag across lane names (or a click in group mode) = new group
      S().groups.push({ from: Math.min(p.src, p.end), to: Math.max(p.src, p.end), text: '' });
      const k = S().groups.length - 1;
      setMode(null);
      App.commit();
      requestAnimationFrame(() => openEd('group', k));
    } else if (!p.moved) openEd('lane', p.src);
  });
  prev.addEventListener('click', e => {
    if (!S()) return;
    const g = e.target.closest('[data-edit]');
    if (!g) { if (App.mode === 'arrow') G.UI.toast('Click a band on the gel image'); return; }
    const kind = g.dataset.edit;
    if (kind === 'group') openEd('group', +g.dataset.k);
    else if (kind === 'strip') openEd('strip', +g.dataset.k);
    else if (kind === 'condname') openEd('condname', +g.dataset.r);
    else if (kind === 'cond') {
      const c = S().conditions[+g.dataset.r], i = +g.dataset.src, cyc = { '': '+', '+': '−', '−': '' };
      c.values[i] = cyc[c.values[i] || ''] != null ? cyc[c.values[i] || ''] : '';
      App.commit();
    } else if (kind === 'arrow') arrowPopover(+g.dataset.k, g);
    else if (kind === 'gel' && App.mode === 'arrow') { const p = gelToRaw(e, g); App.placeArrow(p.x, p.y); }
  });
  // a point on the composed gel image, back in raw-image coordinates (removed lanes are skipped by the segments)
  function gelToRaw(e, g) {
    const rect = g.getBoundingClientRect(), gel = App._lastGel, c = S().crop;
    const fx = (e.clientX - rect.left) / rect.width, fy = (e.clientY - rect.top) / rect.height;
    const px = fx * gel.canvas.width;
    const seg = gel.segs.find(s => px >= s.off && px <= s.off + (s.px1 - s.px0)) || gel.segs[0];
    return { x: c.x + seg.px0 + (px - seg.off), y: c.y + fy * c.h, rect };
  }
  // while a target band is being placed, a dashed line on the figure shows where the arrow will go (snapped to the band)
  prev.addEventListener('pointermove', e => {
    const g = App.mode === 'arrow' && S() && App._lastGel ? e.target.closest('[data-edit="gel"]') : null;
    if (!g) { guide.classList.add('hidden'); return; }
    const p = gelToRaw(e, g), c = S().crop, sy = App.snapBandY(p.x, p.y) ?? p.y, info = App.estimateInfo(sy, p.x);
    guide.style.left = p.rect.left + 'px'; guide.style.width = p.rect.width + 'px';
    guide.style.top = (p.rect.top + (sy - c.y) / c.h * p.rect.height) + 'px';
    guide.querySelector('span').textContent = info && info.bp ? (info.extrap ? '≈' : '') + App.fmtSize(info.bp) : '';
    guide.classList.remove('hidden');
  });
  prev.addEventListener('pointerleave', () => guide.classList.add('hidden'));
  App.on(() => { if (App.mode !== 'arrow') guide.classList.add('hidden'); });

  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (popK >= 0) closePop();
    else if (App.mode) setMode(null);
  });

  G.FigEdit = {
    setMode, arrowPopover, openEd,
    afterRender() {
      if (edit && edit.kind === 'lane') {
        const el = prev.querySelector(`g[data-edit="lane"][data-src="${edit.id}"]`);
        if (el) el.classList.add('active');
      }
    }
  };
})(window);

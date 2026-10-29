/* Step 6 of the panel: densitometry (band boxes, table, chart, lane profile) and band sizes. */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const S = () => App.S;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const done = fn => e => { if (!S()) return; if (fn) fn(e); App.commit(); };
  const live = fn => e => { if (!S()) return; fn(e); App.refresh(); };
  // tab: the analysis window's view ('prof' = what a box measures, 'int' = table, 'plot', 'size');
  // selBox: the band box whose profile is shown
  let tab = 'prof', view = 'figure', lastR = null, lastSizes = null, selBox = 0;

  const sig = v => (v == null || !isFinite(v) ? '–' : v >= 100 ? String(Math.round(v)) : v.toPrecision(3));
  const rel = v => (v == null || !isFinite(v) ? '–' : v.toFixed(2));
  const baseName = () => S().file.name.replace(/\.[^.]+$/, '');

  /* ---------- copy with a fallback for hosts that refuse the clipboard ---------- */
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); G.UI.toast('Copied; paste into Excel or Prism'); }
    catch (e) {
      G.UI.alert('The clipboard is not available here. Select the text below and press Ctrl+C:');
      requestAnimationFrame(() => {
        const box = $('askText'), ta = document.createElement('textarea');
        ta.value = text; ta.rows = 8; ta.style.width = '100%'; ta.style.marginTop = '8px'; ta.readOnly = true;
        box.appendChild(ta); ta.focus(); ta.select();
      });
    }
  }

  /* ---------- the figure column shows either the figure or the densitometry results ---------- */
  /* The right column holds two windows: the figure and, under it, the analysis (chart, table). Either can
   * be closed; the last one clicked is the active window (`view()`). Which overlay the image edits is a
   * separate, explicit choice (`layer()`: 'figure' = lanes, ladder bands, strips; 'quant' = band boxes),
   * set with the Editing switch above the image or by a tool that makes something on that layer (+ Band
   * box, + Strip); showing, hiding or clicking a window never changes it. */
  const shown = { figure: true, quant: false };
  let layer = 'figure';
  function setLayer(l) {
    if (l !== 'quant') l = 'figure';
    if (layer === l) return;
    layer = l;
    document.querySelectorAll('#editSeg button').forEach(b => { b.classList.toggle('on', b.dataset.layer === layer); b.setAttribute('aria-checked', String(b.dataset.layer === layer)); });
    if (G.Editor) G.Editor.draw();
  }
  document.querySelectorAll('#editSeg button').forEach(b => b.onclick = () => { if (S()) setLayer(b.dataset.layer); });
  function refreshChrome() {
    const both = shown.figure && shown.quant;
    $('figPane').classList.toggle('hidden', !shown.figure); $('quantView').classList.toggle('hidden', !shown.quant);
    $('gutterFig').classList.toggle('hidden', !both); $('paneEmpty').classList.toggle('hidden', shown.figure || shown.quant);
    $('figPane').classList.toggle('active', view === 'figure'); $('quantView').classList.toggle('active', view === 'quant');
    document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', !!shown[b.dataset.view]));
    G.Editor.draw();
  }
  // show or hide one window; closing the active one hands the role to the other
  function show(pane, on) {
    if (shown[pane] === on) return;
    shown[pane] = on;
    if (!on && view === pane) view = pane === 'figure' ? 'quant' : 'figure';
    if (on && (!shown[pane === 'figure' ? 'quant' : 'figure'])) view = pane;
    refreshChrome();
    if (on && S()) { if (pane === 'figure') G.UI.updatePreview(); else render(); }
    window.dispatchEvent(new Event('resize'));
  }
  // make a window the active one, opening it if it is closed
  function setView(v) {
    if (!shown[v]) { shown[v] = true; if (S()) { if (v === 'figure') G.UI.updatePreview(); else render(); } window.dispatchEvent(new Event('resize')); }
    view = v;
    refreshChrome();
  }
  document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => { if (S()) { const v = b.dataset.view; if (shown[v]) show(v, false); else setView(v); } });
  $('btnCloseFig').onclick = () => show('figure', false);
  $('btnCloseAna').onclick = () => show('quant', false);
  $('btnShowFig').onclick = () => { if (S()) setView('figure'); };
  $('btnShowAna').onclick = () => { if (S()) setView('quant'); };
  // clicking inside a window makes it the active one
  $('figPane').addEventListener('pointerdown', () => { if (S() && view !== 'figure') { view = 'figure'; refreshChrome(); } }, true);
  $('quantView').addEventListener('pointerdown', () => { if (S() && view !== 'quant') { view = 'quant'; refreshChrome(); } }, true);
  /* the active window follows the control you touch in the panel; a window opened for you flashes its top-bar button
   * (the editing layer does not follow: only the Editing switch and the tools that make boxes or strips set it) */
  function follow(v) {
    if (!S() || (view === v && shown[v])) return;
    setView(v);
    const b = document.querySelector(`#viewSeg [data-view="${v}"]`);
    if (b) { b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash'); setTimeout(() => b.classList.remove('flash'), 800); }
  }
  // steps 1-5 of the panel work on the figure, step 6 on the analysis: touching a control there activates that window
  const panelView = e => {
    const t = e.target.closest ? e.target : null;
    if (!t || !S()) return;
    const ctl = t.closest('button, input, select, textarea, label, summary, a, .list, [contenteditable]');
    if (!ctl || !ctl.closest('#sections')) return;
    const sum = ctl.closest('summary');
    if (sum && sum.parentElement.open && e.type === 'pointerdown') return;   // closing a fold: done with it, no switch
    follow(ctl.closest('.ana-sec') ? 'quant' : 'figure');
  };
  $('sections').addEventListener('pointerdown', panelView, true);
  $('sections').addEventListener('focusin', panelView, true);
  $('btnShowQuant').onclick = () => { if (S()) { setView('quant'); } };
  // plot options and normalization live in the state, so projects and the undo history keep them
  const plot = () => S().quant.plot || (S().quant.plot = { type: 'bar', values: false, refLine: true, ylabel: '', title: '' });
  $('plotType').addEventListener('change', done(e => { plot().type = e.target.value; }));
  $('plotValues').addEventListener('change', done(e => { plot().values = e.target.checked; }));
  $('plotRef').addEventListener('change', done(e => { plot().refLine = e.target.checked; }));
  $('plotTitle').addEventListener('input', live(e => { plot().title = e.target.value; })); $('plotTitle').addEventListener('change', done());
  $('plotY').addEventListener('input', live(e => { plot().ylabel = e.target.value; })); $('plotY').addEventListener('change', done());
  /* ---------- settings: name, current value, action; the explanation underneath only when it matters ---------- */
  const Q = () => S().quant;
  $('qMode').addEventListener('change', done(e => { Q().mode = e.target.value === 'band' ? 'band' : 'box'; }));
  $('qBg').addEventListener('change', done(e => { Q().bg = e.target.value; }));
  const toggle = (btn, box) => { const open = $(box).classList.toggle('hidden') === false; $(btn).setAttribute('aria-expanded', String(open)); };
  $('btnBgEdit').onclick = () => toggle('btnBgEdit', 'qBgEdit');
  $('btnLanesEdit').onclick = () => toggle('btnLanesEdit', 'qLaneBox');
  $('btnAreaEdit').onclick = () => toggle('btnAreaEdit', 'qAreaBox');
  // the analysis area by its four sides (an explicit, undoable change; the lanes measured can change)
  ['qAreaL', 'qAreaR', 'qAreaT', 'qAreaB'].forEach(id => $(id).addEventListener('change', done(() => {
    const st = S(), g = Object.assign({}, G.Quant.region(st)), W = App.rot ? App.rot.w : st.crop.x + st.crop.w, H = App.rot ? App.rot.h : st.crop.y + st.crop.h;
    let l = +$('qAreaL').value, r = +$('qAreaR').value, t = +$('qAreaT').value, b = +$('qAreaB').value;
    l = Math.max(0, Math.min(l, W - 2)); r = Math.max(l + 2, Math.min(r, W)); t = Math.max(0, Math.min(t, H - 2)); b = Math.max(t + 2, Math.min(b, H));
    st.quant.region = { x: Math.round(l), y: Math.round(t), w: Math.round(r - l), h: Math.round(b - t) };
    if (!g || g.x !== l) G.UI.toast('Analysis area changed: the lanes measured follow it');
  })));
  $('qBgSides').addEventListener('change', done(e => { Q().bgSides = e.target.value; }));
  $('qBgGap').addEventListener('change', done(e => { Q().bgGap = Math.max(0, Math.round(+e.target.value || 0)); }));
  $('qBgSize').addEventListener('change', done(e => { const v = Math.round(+e.target.value || 0); Q().bgSize = v > 0 ? Math.max(2, v) : 0; }));
  // choosing the total lane signal sets the total-lane regions from the analysis area (said, and part of the same
  // undoable change); after that only "Update total-lane regions…" moves them
  $('qNorm').addEventListener('change', done(e => {
    const q = Q(); q.norm = e.target.value;
    if (q.norm === 'band' && !q.rows.some(r => r.id === q.normBand)) q.normBand = null;
    if (q.norm === 'lane' && !q.normRegions) { const nr = G.Quant.placeNormRegions(App); G.UI.toast(`Total-lane regions set from the analysis area: rows ${nr.y0}–${nr.y1}, ${Object.keys(nr.lanes).length} lanes`, 4200); }
  }));
  $('btnNormRegions').onclick = async () => {
    if (!S()) return;
    const g = G.Quant.region(S()), nr = Q().normRegions;
    if (!(await G.UI.confirm(`Set the total-lane regions from the analysis area (rows ${Math.round(g.y)}–${Math.round(g.y + g.h - 1)} as shown now)? ${nr ? `They are now rows ${nr.y0}–${nr.y1} of the frame they were placed in. ` : ''}Every normalized value changes; Undo brings the earlier regions back.`, 'Update regions'))) return;
    G.Quant.placeNormRegions(App); App.commit(); G.UI.toast('Total-lane regions updated from the analysis area');
  };
  $('qNormBand').addEventListener('change', done(e => { Q().normBand = e.target.value || null; }));
  $('qLaneTotal').addEventListener('change', done(e => { Q().laneTotal = e.target.checked; }));
  $('qOutput').addEventListener('change', done(e => { Q().output = e.target.value; }));
  $('qRef').addEventListener('change', done(e => { Q().ref = e.target.value || null; }));
  // the analysis area back onto the figure box: a deliberate act, since the lanes measured can change
  $('btnAreaFromCrop').onclick = async () => {
    if (!S() || !(await G.UI.confirm('Set the analysis area to the figure box? The lanes measured can change; the bands already placed keep their regions.', 'Reset from figure'))) return;
    Q().region = Object.assign({}, S().crop); App.commit(); G.UI.toast('Analysis area set to the figure box');
  };
  $('btnMethodsCopy').onclick = () => { if ($('methodsText').value) copyText($('methodsText').value); };
  $('btnAddBox2').onclick = () => $('btnAddBox').click();
  // an analysis made with the earlier calculation is updated only when the user asks
  $('btnQUpdate').onclick = async () => {
    if (!S()) return;
    const ok = await G.UI.confirm('Update this analysis to the current method? Every band is placed again on the lanes as shown, the background becomes local regions outside each band (unless you chose another), and sums are no longer cut at zero. The values will change; Undo brings the earlier ones back.', 'Update');
    if (!ok) return;
    G.Quant.updateToCurrent(App); App.commit(); G.UI.toast('Updated to the current method (version ' + G.Quant.VERSION + ')');
  };
  function setTab(t) {
    tab = ['prof', 'int', 'plot', 'size'].includes(t) ? t : 'prof';
    document.querySelectorAll('#quantTabs button').forEach(x => { const on = x.dataset.tab === tab; x.classList.toggle('on', on); x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; });
    const has = !!(S() && S().quant.rows.length);
    $('quantProf').classList.toggle('hidden', tab !== 'prof' || !has); $('quantInt').classList.toggle('hidden', tab !== 'int' || !has);
    $('quantPlot').classList.toggle('hidden', tab !== 'plot' || !has); $('quantSize').classList.toggle('hidden', tab !== 'size');
    $('quantActions').classList.toggle('hidden', tab === 'size'); $('sizeActions').classList.toggle('hidden', tab !== 'size');
  }
  document.querySelectorAll('#quantTabs button').forEach(b => b.onclick = () => { setTab(b.dataset.tab); render(); });
  // arrow keys move between the tabs (tablist pattern)
  $('quantTabs').addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const bs = [...document.querySelectorAll('#quantTabs button')], i = bs.findIndex(b => b.dataset.tab === tab), n = bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length];
    e.preventDefault(); setTab(n.dataset.tab); render(); n.focus();
  });
  $('qProfBox').addEventListener('change', e => { selBox = +e.target.value; drawProfile(); });
  $('qProfAll').addEventListener('change', () => drawProfile());
  $('qProfAlign').addEventListener('change', () => drawProfile());
  // the region width: every band is placed again with it (an analysis change)
  $('qW').addEventListener('input', live(e => { Q().wFrac = +e.target.value / 100; widthLabel(); }));
  $('qW').addEventListener('change', async () => {
    const q = Q(); if (q.version !== G.Quant.VERSION) { App.commit(); return; }
    if (!(await replaceOk(q.rows))) { $('qW').value = Math.round(q.wFrac * 100); render(); return; }
    q.rows.forEach(r => { const sp = G.Quant.rowSpan(App, r); G.Quant.editRow(App, r, sp.y0, sp.y1); }); App.commit(); keptNote(q.rows);
  });
  // selecting a lane anywhere (table row, chart mark, profile list, image) selects it everywhere
  function selectLane(i) { if (!S() || i == null || i < 0) return; App.selLane = i; App.emit('select'); }
  $('qProfLane').addEventListener('change', e => selectLane(+e.target.value));
  $('btnQCopy').onclick = () => { if (lastR) copyText(G.Quant.quantTSV(App, lastR)); };
  $('btnQCSV').onclick = async () => {
    if (!S() || !lastR) return;
    const st = await G.Export.download(new Blob([G.Quant.quantCSV(App, lastR)], { type: 'text/csv' }), baseName() + '_densitometry.csv');
    if (st === 'saved') { G.UI.toast('Exported the densitometry CSV'); App.emit('exported-results'); }
  };
  $('btnQChart').onclick = () => G.UI.openExport('chart');
  async function exportChart(fmt) {
    if (!S()) return;
    const R = measured(), ch = R ? G.Quant.chartSVG(App, R) : null;
    if (!ch) { G.UI.toast('Add at least one band to plot'); return; }
    App.busy(true, 'Exporting…');
    try {
      const st = await G.Export.exportChart(ch, fmt || 'png', baseName() + '_densitometry_chart', S().style.dpi, S());
      if (st === 'saved') { G.UI.toast('Exported the chart'); App.emit('exported-results'); }
    } catch (e) { G.UI.alert(e.message); } finally { App.busy(false); }
  }
  $('btnSCopy').onclick = () => { if (lastSizes) copyText(sizesTsv(lastSizes)); };
  $('btnSCSV').onclick = async () => {
    if (!S() || !lastSizes) return;
    const st = await G.Export.download(new Blob([G.Quant.sizesCSV(App, lastSizes)], { type: 'text/csv' }), baseName() + '_band_sizes.csv');
    if (st === 'saved') G.UI.toast('Exported the band sizes CSV');
  };

  function widthLabel() {
    const st = S(), px = G.Quant.boxHalfWidth(st) * 2;
    $('qWV').textContent = `${Math.round(st.quant.wFrac * 100)}% of lane spacing (${Math.round(px)} px)`;
  }
  const laneList = is => { if (!is.length) return 'none'; const out = []; let a = is[0], b = a; for (let k = 1; k <= is.length; k++) { if (is[k] === b + 1) { b = is[k]; continue; } out.push(a === b ? `${a + 1}` : `${a + 1}–${b + 1}`); a = b = is[k]; } return out.join(', '); };

  /* A band placed again in the frame shown now keeps its lanes' drawn baselines when the frame is the one it was
   * placed in; in another frame (rotated, flipped, geometry changed since) they are removed: asked first. */
  async function replaceOk(rows) {
    const lost = []; rows.forEach(r => G.Quant.placementDropsManual(App, r).forEach(id => lost.push(`${r.name || 'band'}: lane ${laneNum(id)}`)));
    return !lost.length || G.UI.confirm(`The image is shown in another frame than the one these bands were placed in, so their drawn baselines cannot be kept: ${lost.join('; ')}. Place the bands again and remove those baselines? Undo brings them back.`, 'Place again');
  }
  const laneNum = id => { const i = S().lanes.findIndex(l => l.id === id); return i >= 0 ? i + 1 : id; };
  function keptNote(rows) { const kept = []; rows.forEach(r => Object.keys(r.lanes || {}).forEach(id => { if (r.lanes[id].manual) kept.push(laneNum(id)); })); if (kept.length) { const k = [...new Set(kept)]; G.UI.toast(k.length > 1 ? `Lanes ${k.join(', ')} keep their drawn baselines (their own start and end)` : `Lane ${k[0]} keeps its drawn baseline (its own start and end)`, 4200); } }

  /* ---------- the bands: name, where, actions ---------- */
  function renderBoxes() {
    const st = S(), q = st.quant, lanes = G.Quant.quantLanes(App), isRef = r => q.norm === 'band' && r.id === q.normBand;
    // one item per band: its name and actions, then its height and the lanes it covers
    $('boxList').innerHTML = q.rows.length ? `<ul class="qb-list" aria-label="Bands">` + q.rows.map((r, k) => {
      const placed = r.lanes ? lanes.filter(i => r.lanes[App.laneId(i)]).length : lanes.length, miss = lanes.length - placed;
      const drift = r.frame ? lanes.filter(i => G.Quant.laneDrift(App, r, i) > Math.max(2, (r.hw || 4) * 0.3)) : [];
      const sp = G.Quant.rowSpan(App, r), hgt = Math.round(sp.y1 - sp.y0 + 1);
      return `<li class="qb${k === selBox ? ' sel' : ''}">
        <div class="qb-1"><span class="swatch${isRef(r) ? ' ctl' : ''}" aria-hidden="true"></span><input type="text" data-q="${k}" value="${esc(r.name)}" placeholder="Band ${k + 1}" aria-label="Name of band ${k + 1}">${isRef(r) ? '<span class="badge">reference</span>' : ''}
          <button class="btn sm" data-qprof="${k}">Inspect</button><div class="menu-wrap"><button class="btn sm" data-qmore="${k}" aria-label="More actions for band ${k + 1}" aria-haspopup="menu">⋯</button>
          <div class="menu right hidden" data-qmenu="${k}" role="menu">${r.frame ? `<button role="menuitem" data-qrecentre="${k}"><span>Re-centre on lanes</span><small>Place this band again on the lanes as shown (an analysis change)</small></button>` : ''}${miss && r.frame ? `<button role="menuitem" data-qmiss="${k}"><span>Place missing lanes</span><small>Give the ${miss} lane${miss > 1 ? 's' : ''} without a region one, leaving the others as they are</small></button>` : ''}<button role="menuitem" data-qref="${k}"><span>${isRef(r) ? 'Stop using as reference band' : 'Use as reference band'}</span><small>Normalize every other band by this one in the same lane</small></button><button role="menuitem" class="danger" data-qdel="${k}"><span>Delete band</span></button></div></div></div>
        <div class="qb-2"><label class="inline-label"><span>Height</span> <input type="number" class="num" data-qhgt="${k}" min="3" max="600" step="1" value="${hgt}" aria-label="Height of band ${k + 1} in pixels"> px</label><span>Lanes ${laneList(lanes)}</span>${miss ? `<span class="warn-t">${miss} without region</span>` : ''}${drift.length ? `<span class="warn-t">lane ${drift.map(i => i + 1).join(', ')} moved</span>` : ''}</div></li>`;
    }).join('') + '</ul>' : `<p class="hint">No bands yet. <b>+ Add band</b>, then click a band on the image.</p>`;
    $('boxList').querySelectorAll('[data-q]').forEach(inp => { const r = q.rows[+inp.dataset.q]; inp.addEventListener('input', live(e => { r.name = e.target.value; })); inp.addEventListener('change', done()); });
    // the band's height about its middle, in every lane (an explicit edit: the band is placed again)
    $('boxList').querySelectorAll('[data-qhgt]').forEach(inp => inp.addEventListener('change', async e => {
      const r = q.rows[+inp.dataset.qhgt], sp = G.Quant.rowSpan(App, r), c = (sp.y0 + sp.y1) / 2, h = Math.max(3, Math.min(600, Math.round(+e.target.value || 3)));
      if (!(await replaceOk([r]))) { render(); return; }
      G.Quant.editRow(App, r, Math.round(c - (h - 1) / 2), Math.round(c - (h - 1) / 2) + h - 1); App.commit(); keptNote([r]);
    }));
    $('boxList').querySelectorAll('[data-qprof]').forEach(b => b.onclick = () => { selBox = +b.dataset.qprof; setView('quant'); setTab('prof'); render(); });
    $('boxList').querySelectorAll('[data-qmore]').forEach(b => b.onclick = e => { e.stopPropagation(); const m = $('boxList').querySelector(`[data-qmenu="${b.dataset.qmore}"]`); document.querySelectorAll('.menu').forEach(x => { if (x !== m) x.classList.add('hidden'); }); m.classList.toggle('hidden'); });
    $('boxList').querySelectorAll('[data-qrecentre]').forEach(b => b.onclick = async () => { const r = q.rows[+b.dataset.qrecentre], sp = G.Quant.rowSpan(App, r); if (!(await replaceOk([r]))) return; G.Quant.editRow(App, r, sp.y0, sp.y1); App.commit(); G.UI.toast('Band placed again on the lanes as shown'); keptNote([r]); });
    $('boxList').querySelectorAll('[data-qmiss]').forEach(b => b.onclick = done(() => { const r = q.rows[+b.dataset.qmiss]; G.Quant.quantLanes(App).forEach(i => { if (!r.lanes[App.laneId(i)]) G.Quant.placeLane(App, r, i); }); }));
    $('boxList').querySelectorAll('[data-qref]').forEach(b => b.onclick = done(() => { const r = q.rows[+b.dataset.qref]; if (q.norm === 'band' && q.normBand === r.id) { q.norm = 'none'; q.normBand = null; } else { q.norm = 'band'; q.normBand = r.id; if (q.output === 'corrected') q.output = 'normalized'; } }));
    $('boxList').querySelectorAll('[data-qdel]').forEach(b => b.onclick = done(() => {
      const k = +b.dataset.qdel, r = q.rows[k];
      q.rows.splice(k, 1);
      if (q.normBand === r.id) q.normBand = null;
      if (q.control != null) { if (q.control === k) q.control = -1; else if (q.control > k) q.control--; }
      G.Quant.pruneFrames(q);
    }));
  }

  /* ---------- results: one measurement result feeds the table, the plot, the profile, the copy and the exports ---------- */
  const fmtV = (v, out) => (v == null || !isFinite(v) ? 'n/a' : out === 'fold' || out === 'normalized' ? v.toFixed(out === 'fold' ? 2 : 3) : Math.abs(v) >= 100 ? String(Math.round(v)) : v.toPrecision(3));
  // a cell's state in words and a symbol (never colour alone)
  function cellMarks(c, caveat) {
    const f = c.flags || {}, m = [];
    if (c.value == null) m.push(['na', 'n/a', c.unavailable || 'not available']);
    if (f.clip) m.push(['clip', '⚠', f.clip === 'pileup' ? 'probably clipped' : 'clipped']);
    if (f.below) m.push(['low', '†', f.below === 't3' ? 'below 3σ noise' : 'below 10σ noise']);
    if ((c.review && c.review.length) || caveat) m.push(['rev', '?', caveat && !(c.review && c.review.length) ? caveat : 'needs review']);
    if (f.manual) m.push(['man', '✎', 'baseline drawn by hand']);
    if (f.legacy) m.push(['old', 'v1', 'earlier method']);
    return m;
  }
  function renderTable(R) {
    const out = R.output, tg = R.rows.map((r, k) => k);
    const outHead = k => (out === 'fold' ? `Fold vs lane ${R.ref != null ? R.ref + 1 : '?'}` : out === 'normalized' ? `÷ ${esc(R.normLabel || '…')}` : 'Corrected (a.u.)');
    const head = `<tr><th scope="col">Lane</th>${tg.map(k => `<th scope="col">${esc(R.rows[k].name)}${R.rows[k].ref ? ' <span class="badge">reference band</span>' : ''}<br><small>${out === 'corrected' || R.rows[k].ref ? 'Corrected (a.u.)' : `${outHead(k)} · <span title="background-corrected signal">corr. (a.u.)</span>`}</small></th>`).join('')}<th scope="col">Flags</th></tr>`;
    const body = R.lanes.map((i, j) => {
      const sel = App.selLanes.has(i), flags = [];
      const cells = tg.map(k => {
        const c = R.cells[k][j], divisor = R.rows[k].ref && out !== 'corrected', cav = !divisor && R.shownCaveat ? R.shownCaveat[k][j] : null, marks = cellMarks(c, cav), v = divisor ? R.values.corrected[k][j] : R.shown[k][j], why = [divisor ? 'the reference band: its corrected signal (a.u.) divides the other bands' : R.shownWhy[k][j], cav].filter(Boolean).join('; ');
        marks.forEach(m => flags.push(`${R.rows[k].name}: ${m[2]}`));
        const cls = [c.flags && c.flags.below ? 'low' : '', c.flags && c.flags.clip ? 'sat' : '', v == null ? 'na' : ''].filter(Boolean).join(' ');
        const main = `<span class="qv">${fmtV(v, divisor ? 'corrected' : out)}</span>${marks.filter(m => m[0] !== 'na').map(m => `<span class="qm qm-${m[0]}" aria-hidden="true">${m[1]}</span>`).join('')}`;
        const sub = out !== 'corrected' && !divisor ? `<small class="qcorr">${fmtV(R.values.corrected[k][j], 'corrected')}</small>` : '';
        return `<td class="${cls}" title="${esc([why, flagText(c)].filter(Boolean).join(' · '))}">${main}${sub}</td>`;
      }).join('');
      if (R.ref === i && out === 'fold') flags.unshift('reference lane');
      return `<tr data-lane="${i}" class="${sel ? 'sel' : ''}${R.ref === i ? ' ref' : ''}" tabindex="0" aria-selected="${sel}"><th scope="row">${esc(R.names[j].replace(/\*/g, ''))}</th>${cells}<td class="qflags">${esc([...new Set(flags)].join('; '))}</td></tr>`;
    }).join('');
    const notes = [];
    const na = new Map(); R.shownWhy.forEach((r, k) => { if (R.rows[k].ref && out !== 'corrected') return; r.forEach(w => { if (w) na.set(w, (na.get(w) || 0) + 1); }); });
    if (na.size) notes.push(`<p class="hint warn-t"><b>Not available:</b> ${[...na].map(([w, n]) => `${esc(w)} (${n})`).join('; ')}.</p>`);
    if (R.saturatedLanes.length) notes.push(`<p class="hint warn-t">⚠ Clipped pixels in lane${R.saturatedLanes.length > 1 ? 's' : ''} ${R.saturatedLanes.map(i => i + 1).join(', ')}: those values are underestimated, and their ratios are not reliable fold changes.</p>`);
    if (R.flags.flat().some(f => f && f.below)) notes.push(`<p class="hint">† Below the estimated 10σ noise threshold: too close to the background noise to compare; never used as a divisor or reference.</p>`);
    const cavLanes = R.lanes.filter((i, j) => (R.shownCaveat || []).some(r => r[j])), revL = [...new Set((R.reviewLanes || []).concat(cavLanes))].sort((a, b) => a - b);
    if (revL.length) notes.push(`<p class="hint warn-t">? Needs review: lane ${revL.map(i => i + 1).join(', ')} (open Profile for the reasons${cavLanes.length ? '; a ratio needs review when its divisor or reference lane does' : ''}).</p>`);
    if (R.manualLanes && R.manualLanes.length) notes.push(`<p class="hint">✎ Integrated relative to a user-defined baseline: lane ${R.manualLanes.map(i => i + 1).join(', ')}. Their noise estimate excludes the uncertainty in where the baseline was drawn; the methods text and the log say so.</p>`);
    if (R.noiseUnknownLanes && R.noiseUnknownLanes.length) notes.push(`<p class="hint warn-t">Noise not estimated in lane ${R.noiseUnknownLanes.map(i => i + 1).join(', ')}: no 3σ / 10σ check was made there (marked ?). Ratios resting on such a lane are marked unverified.</p>`);
    if (R.clipUnknown) notes.push(`<p class="hint warn-t">Clipping could not be checked in this file (no digital limit to test against): no value here is known to be unclipped.</p>`);
    if (R.normMode === 'lane' && !R.laneTotal) notes.push(`<p class="hint warn-t">Divided by the total lane signal of this image. That is total-protein normalization only on a total-protein stain or stain-free image.</p>`);
    $('quantTable').innerHTML = `<div class="tscroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>` + notes.join('');
    $('quantTable').querySelectorAll('tr[data-lane]').forEach(tr => { tr.onclick = () => selectLane(+tr.dataset.lane); tr.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLane(+tr.dataset.lane); } }; });
    $('quantNote').textContent = 'Values are signal units of this image (a.u.), not optical density or amounts; compare lanes of this image only.';
    const ch = G.Quant.chartSVG(App, R);
    $('quantChart').innerHTML = ch ? ch.svg : '';
    const svg = $('quantChart').querySelector('svg');
    if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = 'auto'; }
  }
  const flagText = c => G.Quant.flagText(c.flags, c);
  function renderSizes() {
    const T = G.Quant.bandSizes(App);
    lastSizes = T;
    const rows = T.map(l => `<tr><td>${esc(l.name.replace(/\*/g, ''))}</td><td>${l.marker ? `<span class="muted">${'ladder'}</span>`
      : l.bands.length ? l.bands.map(b => `<span class="${b.extrap ? 'extrap' : ''}" title="${b.extrap ? 'outside the ladder range (extrapolated)' : ''}">${b.extrap ? '≈' : ''}${b.size ? App.fmtSize(b.size) : '?'}</span>`).join(', ')
      : `<span class="muted">${'no bands'}</span>`}</td></tr>`).join('');
    const kind = App.kind(), lads = S().markers.map(m => m.ladderId);
    const qual = [kind === 'native' ? 'Native gel: these are apparent sizes; mobility depends on shape and charge as well as mass.' : '',
      kind === 'dna' && !lads.includes('nebscextend') ? 'Sized against a linear ladder: valid for linear DNA. Supercoiled, nicked or relaxed plasmids run differently.' : '',
      lads.includes('nebscextend') ? 'Sized against a supercoiled ladder: valid for supercoiled plasmids only.' : '',
      S().markers.length >= 2 ? 'Each lane is sized between the ladder lanes on either side of it.' : '',
      S().markers.some(m => !m.confirmed) ? 'The ladder is not confirmed yet (Size ladder step).' : ''].filter(Boolean);
    $('sizeTable').innerHTML = S().markers.length ? `<div class="tscroll"><table><thead><tr><th scope="col">${'Lane'}</th><th scope="col">${kind === 'native' ? 'Apparent molecular weight' : G.Gels.sizeNoun(kind)}</th></tr></thead><tbody>${rows}</tbody></table></div>` + (qual.length ? `<p class="hint">${qual.join(' ')}</p>` : '')
      : `<p class="hint">${'A ladder lane is needed to estimate sizes.'}</p>`;
  }
  function sizesTsv(T) {
    return [['Well', 'Lane', `Bands (${App.baseUnit()})`].join('\t')]
      .concat(T.filter(l => !l.marker).map(l => [l.lane + 1, l.name, l.bands.map(b => (b.extrap ? '≈' : '') + (b.size ? App.fmtSize(b.size) : '?')).join(', ')].join('\t'))).join('\n');
  }

  /* ---------- the lane profile: what is integrated, drawn from the same pixels as the number ----------
   * One lane: the mean signal per pixel of each row of the lane's region width (the line, with gaps where a row
   * has no pixel), over the region and as much again above and below, on numeric axes (rows of the band's frame;
   * signal in a.u.); the rows the background came from (grey bands), the line the calculation subtracts (dashed;
   * solid amber for a user-defined baseline) and the rows counted (shaded; the value weights each row by its
   * pixel count). "Compare lanes": every measured lane's signal minus its background on one row axis (or aligned
   * on its peak, for shape only), with a legend. Manual integration is a mode: "Edit baseline…" (a drag on the
   * profile does nothing until then), with typed rows and levels, a snap option, Apply / Cancel / Use automatic
   * background, Escape cancelling from anywhere. */
  function cssVar(n, d) { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || d; }
  let pmap = null, pdrag = null, edit = null;
  const f2 = v => (v == null || !isFinite(v) ? '–' : Math.abs(v) >= 100 ? v.toFixed(1) : v.toPrecision(4));
  const PALETTE = ['#1b6ca8', '#c0392b', '#2e8b57', '#8e44ad', '#b9770e', '#d35400', '#17807e', '#7f6000', '#a93279', '#4d5656'];
  // the lane and band the profile shows
  function profCtx() {
    const st = S(), R = lastR; if (!st || !R) return null;
    const k = Math.min(selBox, st.quant.rows.length - 1), lane = App.selLane >= 0 && R.lanes.includes(App.selLane) ? App.selLane : R.lanes[0];
    if (k < 0 || lane == null || lane < 0) return null;
    const j = R.lanes.indexOf(lane), row = st.quant.rows[k];
    return { st, R, k, lane, j, c: R.cells[k][j], row, lid: App.laneId(lane), v2: R.version === G.Quant.VERSION && !!(row && row.lanes && row.lanes[App.laneId(lane)]) };
  }
  const niceStep = (span, n) => { const raw = span / Math.max(1, n), mag = Math.pow(10, Math.floor(Math.log10(raw || 1))); return [1, 2, 2.5, 5, 10].map(m => m * mag).find(x => x >= raw) || mag * 10; };
  // the axes of a plot box: ticks and labels in CSS px scaled by dpr
  function drawAxes(ctx, bx, X, Y, xr, yr, xLabel, yLabel, dpr, txt, grid) {
    ctx.strokeStyle = grid; ctx.fillStyle = txt; ctx.lineWidth = 1 * dpr; ctx.font = `${11 * dpr}px sans-serif`;
    const ys = niceStep(yr[1] - yr[0], 4); ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = Math.ceil(yr[0] / ys) * ys; v <= yr[1] + 1e-12; v += ys) { const y = Y(v); ctx.beginPath(); ctx.moveTo(bx.l, y); ctx.lineTo(bx.r, y); ctx.stroke(); ctx.fillText(+v.toPrecision(3) + '', bx.l - 4 * dpr, y); }
    const xs = niceStep(xr[1] - xr[0], Math.max(3, Math.floor((bx.r - bx.l) / (70 * dpr)))); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    for (let v = Math.ceil(xr[0] / xs) * xs; v <= xr[1] + 1e-9; v += xs) { const x = X(v); ctx.beginPath(); ctx.moveTo(x, bx.b); ctx.lineTo(x, bx.b + 4 * dpr); ctx.stroke(); ctx.fillText(+v.toPrecision(4) + '', x, bx.b + 5 * dpr); }
    ctx.strokeStyle = txt; ctx.beginPath(); ctx.moveTo(bx.l, bx.t); ctx.lineTo(bx.l, bx.b); ctx.lineTo(bx.r, bx.b); ctx.stroke();
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'center'; ctx.fillText(xLabel, (bx.l + bx.r) / 2, bx.b + 30 * dpr);
    ctx.save(); ctx.translate(12 * dpr, (bx.t + bx.b) / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel, 0, 0); ctx.restore();
  }
  // a polyline that breaks where a value is missing (no pixel there: a gap, not a zero)
  function pathGaps(ctx, pts, X, Y) { let on = false; ctx.beginPath(); pts.forEach(p => { if (p.y == null || !isFinite(p.y)) { on = false; return; } if (on) ctx.lineTo(X(p.x), Y(p.y)); else { ctx.moveTo(X(p.x), Y(p.y)); on = true; } }); ctx.stroke(); }
  function drawProfile() {
    const cv = $('qProfile'), st = S();
    if (!st || !cv.clientWidth || tab !== 'prof') return;
    const dpr = window.devicePixelRatio || 1, W = cv.width = cv.clientWidth * dpr, H = cv.height = cv.clientHeight * dpr, ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H); pmap = null;
    const P0 = profCtx(), all = $('qProfAll').checked;
    $('qProfAlignWrap').classList.toggle('hidden', !all);
    const tools = on => { ['btnEditBase', 'btnCopyLimits', 'btnEndpoint', 'btnBgRegions', 'btnLaneResetAll'].concat([...$('qLaneAdj').querySelectorAll('button')]).forEach(b => { (typeof b === 'string' ? $(b) : b).disabled = !on; }); };
    if (!P0) { $('qProfRead').textContent = ''; $('qProfSum').textContent = ''; $('qProfKey').textContent = ''; tools(false); return; }
    const { R, k, lane, j, c, row, lid, v2 } = P0;
    if (+$('qProfLane').value !== lane) $('qProfLane').value = String(lane);
    if (edit && (edit.k !== k || edit.lid !== lid || all)) stopEdit(true);
    const ink = cssVar('--text', '#1d2a30'), okc = '#1f9d55', manc = '#b45309', txt = cssVar('--muted', '#555'), grid = cssVar('--line-2', '#e6ecef');
    const bx = { l: 56 * dpr, r: W - 12 * dpr, t: 10 * dpr, b: H - 38 * dpr };
    if (all) {
      // every measured lane: signal minus its background along its region, on the band's row axis (or on its peak)
      const align = $('qProfAlign').checked, series = [];
      R.lanes.forEach((i, jj) => {
        const id = App.laneId(i), Pl = v2 && row.lanes[id] ? G.Quant.laneProfile(App, row, id) : null; if (!Pl) return;
        const pts = Pl.baseline.map(p => { const r = Pl.rows.find(q2 => Math.abs(q2.y - p.y) < 0.5); return { x: p.y, y: r && isFinite(p.b) ? r.mean - p.b : NaN }; });
        if (align) { const m = pts.reduce((a, p) => (isFinite(p.y) && (!a || p.y > a.y) ? p : a), null); if (m) { const x0 = m.x; pts.forEach(p => { p.x -= x0; }); } }
        series.push({ i, pts });
      });
      const vs = series.flatMap(s2 => s2.pts).filter(p => isFinite(p.y));
      if (vs.length) {
        let lo = Math.min(0, ...vs.map(p => p.y)), hi = Math.max(...vs.map(p => p.y)); if (hi <= lo) hi = lo + 1e-6; const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
        const xr = [Math.min(...vs.map(p => p.x)) - 0.5, Math.max(...vs.map(p => p.x)) + 0.5];
        const X = x => bx.l + (x - xr[0]) / (xr[1] - xr[0]) * (bx.r - bx.l), Y = y => bx.b - (y - lo) / (hi - lo) * (bx.b - bx.t);
        drawAxes(ctx, bx, X, Y, xr, [lo, hi], align ? 'Rows from each lane\'s peak (shape comparison only)' : 'Row of the band\'s frame (px)', 'Signal − background (a.u./px)', dpr, txt, grid);
        ctx.strokeStyle = txt; ctx.setLineDash([3 * dpr, 3 * dpr]); ctx.beginPath(); ctx.moveTo(bx.l, Y(0)); ctx.lineTo(bx.r, Y(0)); ctx.stroke(); ctx.setLineDash([]);
        series.forEach((s2, n) => { ctx.strokeStyle = PALETTE[n % PALETTE.length]; ctx.lineWidth = (s2.i === lane ? 2.6 : 1.4) * dpr; pathGaps(ctx, s2.pts, X, Y); });
      }
      $('qProfKey').innerHTML = series.map((s2, n) => `<span class="pk-lane${s2.i === lane ? ' sel' : ''}"><span class="pk" style="background:${PALETTE[n % PALETTE.length]}"></span>${esc((st.lanes[s2.i].name || `Lane ${s2.i + 1}`).replace(/\*/g, ''))}</span>`).join(' ')
        + `<br>${align ? 'Each curve shifted so its peak is at 0: for comparing shapes, not positions.' : 'Each lane over its own rows of the band\'s frame: a lane with other limits starts and ends elsewhere.'}`;
      $('qEditState').textContent = 'Compare lanes: untick it to inspect or edit one lane'; tools(false); $('btnEditBase').disabled = true;
      readout(R, k, j, c); return;
    }
    const P = v2 ? G.Quant.laneProfile(App, row, lid) : null;
    if (!P || !P.rows.length) { $('qProfKey').textContent = ''; $('qEditState').textContent = R.version === G.Quant.VERSION ? 'No region in this lane' : 'Earlier method: update the analysis to edit a baseline'; tools(false); readout(R, k, j, c); return; }
    tools(true);
    const rows = P.rows, man = P.manual, draft = edit ? (pdrag && pdrag.moved ? draftFromDrag() : edit) : null, base = draft || man;
    const ys = rows.map(r => r.mean).filter(isFinite).concat(P.baseline.map(p => p.b).filter(isFinite), base ? [base.la, base.lb] : []);
    let lo = Math.min(...ys), hi = Math.max(...ys); const span = (hi - lo) || 1e-3; lo -= span * 0.06; hi += span * 0.08;
    const xr = [rows[0].y - 0.5, rows[rows.length - 1].y + 0.5];
    const X = y => bx.l + (y - xr[0]) / (xr[1] - xr[0]) * (bx.r - bx.l), Y = l => bx.b - (l - lo) / (hi - lo) * (bx.b - bx.t);
    const Xi = x => xr[0] + (x - bx.l) / (bx.r - bx.l) * (xr[1] - xr[0]), Yi = yy => lo + (bx.b - yy) / (bx.b - bx.t) * (hi - lo);
    const meanAt = y => { const r = rows.find(q2 => Math.abs(q2.y - y) < 0.5); return r ? r.mean : NaN; };
    drawAxes(ctx, bx, X, Y, xr, [lo, hi], 'Row of the band\'s frame (px)', 'Mean signal per pixel (a.u.)', dpr, txt, grid);
    // the rows the background came from (grey), the rows counted (light)
    ctx.fillStyle = 'rgba(120,130,140,.16)';
    if (!base) P.bgRows.forEach(p => { ctx.fillRect(X(p.y - 0.5), bx.t, Math.max(1, X(p.y + 0.5) - X(p.y - 0.5)), bx.b - bx.t); });
    const ra = base ? base.a : P.region[0], rb = base ? base.b : P.region[1];
    ctx.fillStyle = 'rgba(31,157,85,.07)'; ctx.fillRect(X(ra - 0.5), bx.t, X(rb + 0.5) - X(ra - 0.5), bx.b - bx.t);
    const blAt = base ? (y => base.la + (base.lb - base.la) * (y - base.a) / Math.max(1, base.b - base.a)) : (y => { const p = P.baseline.find(q2 => Math.abs(q2.y - y) < 0.5); return p ? p.b : NaN; });
    const inR = rows.filter(r => r.y >= ra - 0.01 && r.y <= rb + 0.01 && isFinite(r.mean) && isFinite(blAt(r.y)));
    if (inR.length > 1 && R.mode === 'box') {
      ctx.fillStyle = base ? 'rgba(180,83,9,.22)' : 'rgba(31,157,85,.32)'; ctx.beginPath();
      inR.forEach((r, t) => { if (t) ctx.lineTo(X(r.y), Y(r.mean)); else ctx.moveTo(X(r.y), Y(r.mean)); });
      for (let t = inR.length - 1; t >= 0; t--) ctx.lineTo(X(inR[t].y), Y(blAt(inR[t].y)));
      ctx.closePath(); ctx.fill();
    }
    ctx.strokeStyle = ink; ctx.lineWidth = 1.6 * dpr; pathGaps(ctx, rows.map(r => ({ x: r.y, y: r.mean })), X, Y);
    if (base) {
      ctx.strokeStyle = manc; ctx.lineWidth = 2 * dpr; ctx.setLineDash(draft && !man ? [6 * dpr, 3 * dpr] : []); ctx.beginPath(); ctx.moveTo(X(base.a), Y(base.la)); ctx.lineTo(X(base.b), Y(base.lb)); ctx.stroke(); ctx.setLineDash([]);
      if (edit) { ctx.fillStyle = '#fff'; [[base.a, base.la], [base.b, base.lb]].forEach(([y, l]) => { ctx.beginPath(); ctx.rect(X(y) - 6 * dpr, Y(l) - 6 * dpr, 12 * dpr, 12 * dpr); ctx.fill(); ctx.stroke(); }); }
    } else {
      ctx.strokeStyle = okc; ctx.lineWidth = 1.5 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]);
      pathGaps(ctx, P.baseline.map(p => ({ x: p.y, y: p.b })), X, Y); ctx.setLineDash([]);
    }
    pmap = { X, Y, Xi, Yi, meanAt, P, row, lid, k, dpr, v0: xr[0], v1: xr[1], base: edit ? base : null };
    const ns = (P.baseline || []).map(p => p.n).filter(n => n > 0), nr = ns.length ? `${Math.min(...ns)}${Math.max(...ns) > Math.min(...ns) ? `–${Math.max(...ns)}` : ''}` : '';
    $('qProfKey').innerHTML = `<span class="pk pk-line"></span>mean signal per pixel of each row · ${base ? '<span class="pk pk-man"></span>user-defined baseline' : `<span class="pk pk-base"></span>background subtracted${P.bgRows.length ? ' · <span class="pk pk-bg"></span>rows the background came from' : ''}`} · <span class="pk pk-area${base ? ' man' : ''}"></span>rows counted${nr ? ` (the value sums every pixel: ${nr} per row here)` : ''}`;
    $('qEditState').textContent = edit ? 'Editing: manual baseline (not applied yet)' : man ? 'Editing: off · this lane uses a user-defined baseline' : `Editing: off · background: ${G.Quant.BG_SHORT[P.method] || P.method}`;
    readout(R, k, j, c);
  }
  // the selected output first, the corrected signal and the reference after it, then the status and its reasons;
  // every parameter under Calculation details
  function readout(R, k, j, c) {
    const st = S(), i = R.lanes[j], p = c.prov || {}, ln = (st.lanes[i].name || `lane ${i + 1}`).replace(/\*/g, ''), nm = R.rows[k].name, f = c.flags || {};
    const corners = cs => cs.map(q => `(${q[0].toFixed(1)}, ${q[1].toFixed(1)})`).join(' ');
    const outName = R.output === 'fold' ? 'Fold change' : R.output === 'normalized' ? `Normalized (÷ ${esc(R.normLabel || 'divisor')})` : 'Corrected signal';
    const shown = R.shown[k][j], main = shown != null ? `<b>${fmtV(shown, R.output)}</b>${R.output === 'corrected' ? ' a.u.' : ''}` : `<span class="warn-t">not available — ${esc(R.shownWhy[k][j] || c.unavailable || '')}</span>`;
    const second = [R.output !== 'corrected' ? `Corrected signal: ${c.value == null ? 'n/a' : `${f2(c.value)} a.u.`}` : '', R.output === 'fold' && R.ref != null ? `Reference: lane ${R.ref + 1}` : '', R.output === 'normalized' ? `Divisor: ${esc(R.normLabel || '–')}` : '', c.n ? `integrated over ${c.n} px` : ''].filter(Boolean).join(' · ');
    const issues = [].concat(c.review || [], R.shownCaveat && R.shownCaveat[k][j] ? [R.shownCaveat[k][j]] : []);
    const state = f.clip ? 'Clipped pixels' : issues.length ? 'Needs review' : f.below ? 'Near the noise' : 'No issues found';
    const extra = [f.manual ? 'Integrated relative to a user-defined baseline. Noise estimate excludes uncertainty in the manually selected baseline.' : '',
      f.clipState === 'unknown' ? 'Clipping could not be checked in this file (no digital limit to test against).' : f.clip ? '' : 'No clipped pixels found in the file (detector saturation before the file was written cannot be seen).'].filter(Boolean);
    $('qProfSum').innerHTML = `<p class="ps-main"><span class="ps-l">${esc(ln)} · ${esc(nm)} — ${outName}:</span> ${main}</p>${second ? `<p class="ps-sec">${second}</p>` : ''}`
      + `<p class="ps-status ${issues.length || f.clip ? 'warn-t' : ''}"><b>Status:</b> ${state}${f.manual ? ' · ✎ user-defined baseline' : ''}</p>`
      + (issues.length ? `<ul class="ps-why">${issues.map(w => `<li>${esc(w[0].toUpperCase() + w.slice(1))}.</li>`).join('')}</ul>` : '')
      + (extra.length ? `<p class="hint">${extra.join(' ')}</p>` : '');
    const lines = [];
    if (R.version === G.Quant.VERSION && p.signal) {
      lines.push(`Uncorrected sum ${f2(c.U)} − background ${f2(c.B)} = <b>${f2(c.value)}</b> (${p.signal.px} px; ${esc(p.polarity)}).`);
      lines.push(`Signal region: rows ${p.signal.frameRows ? p.signal.frameRows.join('–') : '–'}, columns ${p.signal.frameCols ? p.signal.frameCols.join('–') : '–'} of its placement frame; original pixels ${corners(p.signal.corners)}${p.signal.outsidePx ? `; ${p.signal.outsidePx} px off the image` : ''}.`);
      if (p.manual) lines.push(`User-defined baseline: from row ${p.manual.rows[0]} (level ${f2(p.manual.levels[0])}) to row ${p.manual.rows[1]} (level ${f2(p.manual.levels[1])}).`);
      else if (p.background && p.background.length) lines.push(`Background (${esc(G.Quant.BG_SHORT[p.method] || p.method)}${p.method === 'local' ? `, ${esc(G.Quant.SIDES_TEXT[p.spec.sides])}, ${p.spec.gap} px gap, ${p.spec.size} px deep${p.spec.override ? ', set for this lane' : ''}` : ''}): ${p.background.map(b => `${b.side} ${b.px} px ${corners(b.corners)}`).join('; ')}.`);
      else lines.push(`Background: ${esc(G.Quant.BG_TEXT[p.method] || p.method)}.`);
      lines.push(f.noise === 'estimated' ? `Noise (estimated): σ ${f2(c.sigmaPx)} per pixel from ${c.nNoise} background pixels${c.f > 1.05 ? ` (×${Math.sqrt(c.f).toFixed(2)} for correlated neighbours)` : ''}; thresholds 3σ ${f2(c.t3)}, 10σ ${f2(c.t10)}.`
        : `Noise: not estimated (${esc(G.Quant.NOISE_TEXT[f.noise] || f.noise || 'unknown')}${c.nNoise ? `; ${c.nNoise} background pixels` : ''}): no threshold check.`);
      if (c.msens) lines.push(`Baseline sensitivity (not a confidence interval): ends moved ±${c.msens.dPos} rows → ${c.msens.pos ? c.msens.pos.map(f2).join(' to ') : '–'}; levels moved ±${f2(c.msens.dLev)} → ${c.msens.lev ? c.msens.lev.map(f2).join(' to ') : '–'}.`);
      if (c.sens) lines.push(`Sensitivity: ${c.sens.tallerRows} rows taller at each end → ${f2(c.sens.taller)}${c.sens.away != null ? `; background ${c.sens.awayPx} px further away → ${f2(c.sens.away)}` : ''}.`);
      if (f.clip) lines.push(`${c.clip.n} pixel${c.clip.n > 1 ? 's' : ''} of the region ${f.clip === 'pileup' ? 'pile up at an extreme value (probably clipped)' : 'reach the file\'s digital limit (clipped)'}: the value is underestimated.`);
      lines.push(`Image: ${esc(p.image || '')} (SHA-256 ${esc(String(p.sha256 || '').slice(0, 12))}…) · build ${esc(p.build || '')} · calculation version ${p.version} · placed ${p.placed}×${p.override && p.override.length ? ` · lane-specific: ${esc(p.override.join(', '))}` : ''}.`);
    } else lines.push(`Earlier method (version 1): ${esc(G.Quant.BG_TEXT[R.method] || R.method)}; uncorrected ${f2(c.U)}, background ${f2(c.B)}.`);
    if (R.normMode !== 'none') lines.push(`Normalization: ${esc(G.Quant.describe(App, R).normalization)}.`);
    $('qProfRead').innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    const row = st.quant.rows[k], lid = App.laneId(i), L = row && row.lanes && row.lanes[lid];
    if (R.version === G.Quant.VERSION && L) {
      $('qLaneBg').value = L.bg && L.bg.sides ? L.bg.sides : ''; $('qLaneGap').value = L.bg && L.bg.gap != null ? L.bg.gap : '';
      $('qLaneBg').disabled = $('qLaneGap').disabled = !!L.manual;
      $('qLaneAdj').dataset.k = k; $('qLaneAdj').dataset.lid = lid;
    }
  }
  const laneRec = () => { const el = $('qLaneAdj'), row = S().quant.rows[+el.dataset.k]; return row && row.lanes ? row.lanes[el.dataset.lid] : null; };
  const laneRow = () => S().quant.rows[+$('qLaneAdj').dataset.k];
  // the step buttons: the start and end rows (of a user-defined baseline, or of the lane's region), and a shift that
  // moves the region left or right on the screen as the image is shown now
  document.querySelectorAll('#qLaneAdj [data-adj]').forEach(b => b.onclick = done(() => {
    const L = laneRec(); if (!L) return; const [key, d0] = b.dataset.adj.split(':'); let d = +d0;
    if (key === 'dx') d *= G.Quant.screenSign(App, laneRow(), $('qLaneAdj').dataset.lid);
    if (L.manual && key !== 'dx') { const m = L.manual, e = key === 'dy0' ? 'a' : 'b', nv = m[e] + d; if ((e === 'a' ? m.b - nv : nv - m.a) >= 2) m[e] = nv; return; }
    L[key] = (L[key] || 0) + d; if (!L[key]) delete L[key];
  }));
  $('qLaneBg').addEventListener('change', done(e => { const L = laneRec(); if (!L) return; const v = e.target.value; if (v) L.bg = Object.assign({}, L.bg, { sides: v }); else if (L.bg) { delete L.bg.sides; if (!Object.keys(L.bg).length) delete L.bg; } }));
  $('qLaneGap').addEventListener('change', done(e => { const L = laneRec(); if (!L) return; const v = e.target.value; if (v !== '') L.bg = Object.assign({}, L.bg, { gap: Math.max(0, Math.round(+v)) }); else if (L.bg) { delete L.bg.gap; if (!Object.keys(L.bg).length) delete L.bg; } }));
  $('btnBgRegions').onclick = () => toggle('btnBgRegions', 'qBgPanel');
  // Use automatic background: the drawn baseline goes; the start, end and shift stay
  $('btnLaneReset').onclick = () => { const row = laneRow(), lid = $('qLaneAdj').dataset.lid; if (row && G.Quant.useAutoBackground(App, row, lid)) { stopEdit(true); App.commit(); G.UI.toast('Automatic background in this lane; its start, end and shift are kept'); } else stopEdit(true); };
  $('btnLaneResetAll').onclick = async () => {
    const row = laneRow(), lid = $('qLaneAdj').dataset.lid; if (!row) return;
    const what = G.Quant.laneAdjustments(row, lid);
    if (!what.length) { G.UI.toast('This lane has no adjustments'); return; }
    if (!(await G.UI.confirm(`Reset this lane to the band's own region and background? This removes: ${what.join(', ')}. Undo brings them back.`, 'Reset'))) return;
    stopEdit(true); G.Quant.resetLaneAll(App, row, lid); App.commit();
  };
  /* ---------- Edit baseline… (manual integration, an expert mode) ---------- */
  function startEdit() {
    const P0 = profCtx(); if (!P0 || !P0.v2 || $('qProfAll').checked) return;
    const { row, lid, k } = P0, m = row.lanes[lid].manual, lim = G.Quant.limitsOf(row, lid), Pl = G.Quant.laneProfile(App, row, lid);
    edit = m ? { k, lid, a: m.a, b: m.b, la: m.la, lb: m.lb } : { k, lid, a: lim[0], b: lim[1], la: G.Quant.levelAt(Pl, lim[0]), lb: G.Quant.levelAt(Pl, lim[1]) };
    $('qEditPanel').classList.remove('hidden'); $('btnEditBase').setAttribute('aria-expanded', 'true'); $('btnEditBase').classList.add('on');
    $('qProfile').classList.add('editing'); syncEdit(); drawProfile(); previewEdit();
    $('qEdA').focus();
  }
  function stopEdit(silent) {
    const was = !!edit; edit = null; pdrag = null;
    $('qEditPanel').classList.add('hidden'); $('btnEditBase').setAttribute('aria-expanded', 'false'); $('btnEditBase').classList.remove('on'); $('qProfile').classList.remove('editing');
    if (was && !silent) { drawProfile(); $('btnEditBase').focus(); }
  }
  const syncEdit = () => { if (!edit) return; $('qEdA').value = edit.a; $('qEdB').value = edit.b; $('qEdLa').value = +(+edit.la).toFixed(4); $('qEdLb').value = +(+edit.lb).toFixed(4); };
  function previewEdit() {
    if (!edit) return;
    const row = S().quant.rows[edit.k], cur = R0 => R0 && R0.value != null ? f2(R0.value) : 'n/a';
    const pv = G.Quant.preview(App, row, [edit.lid], () => G.Quant.setManual(App, row, edit.lid, edit.a, edit.b, edit.la, edit.lb)), a = pv.after[edit.lid], b = pv.before[edit.lid];
    $('qEdPreview').textContent = a ? `With this line: ${cur(a)} a.u. (now ${cur(b)}) · ${a.review.length ? `review: ${a.review[0]}` : 'no issues found'}` : '';
  }
  ['qEdA', 'qEdB', 'qEdLa', 'qEdLb'].forEach(id => $(id).addEventListener('change', () => {
    if (!edit) return; const a = Math.round(+$('qEdA').value), b = Math.round(+$('qEdB').value), la = +$('qEdLa').value, lb = +$('qEdLb').value;
    if (b - a >= 2 && isFinite(la) && isFinite(lb)) Object.assign(edit, { a, b, la, lb }); else syncEdit();
    drawProfile(); previewEdit();
  }));
  $('btnEditBase').onclick = () => { if (edit) stopEdit(); else startEdit(); };
  $('btnEdCancel').onclick = () => stopEdit();
  $('btnEdApply').onclick = () => {
    if (!edit) return; const e = edit, row = S().quant.rows[e.k];
    stopEdit(true);
    if (row && G.Quant.setManual(App, row, e.lid, e.a, e.b, e.la, e.lb)) { App.commit(); G.UI.toast('User-defined baseline applied in this lane (Undo takes it back)'); } else drawProfile();
  };
  // Escape cancels a drag, then the editing, wherever the focus is (a dialog keeps its own Escape)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !edit || document.querySelector('.dlg:not(.hidden)')) return;
    e.preventDefault(); if (pdrag) { pdrag = null; drawProfile(); } else stopEdit();
  });
  // drawing on the profile, only while editing: a drag from the start of the peak to its end; a handle moves an end
  const cvp = $('qProfile');
  const evPt = e => { const r = cvp.getBoundingClientRect(), d = pmap ? pmap.dpr : 1; return { x: (e.clientX - r.left) * d, y: (e.clientY - r.top) * d, alt: e.altKey }; };
  const rowAt = x => Math.round(Math.max(pmap.v0 + 0.5, Math.min(pmap.v1 - 0.5, pmap.Xi(x))));
  // the level at a pointer: on the curve when within 8 px of it and snapping is on (Alt inverts it), else the pointer's
  const lvlAt = (y, py, alt) => { const m = pmap.meanAt(y), snap = $('qEdSnap').checked !== !!alt; return snap && isFinite(m) && Math.abs(pmap.Y(m) - py) <= 8 * pmap.dpr ? m : pmap.Yi(py); };
  const handleAt = p => { const m = pmap && pmap.base; if (!m) return null; const near = (y, l) => Math.hypot(pmap.X(y) - p.x, pmap.Y(l) - p.y) <= 12 * pmap.dpr; return near(m.a, m.la) ? 'a' : near(m.b, m.lb) ? 'b' : null; };
  function draftFromDrag() { const d = pdrag; const [a, la, b, lb] = d.y0 <= d.y1 ? [d.y0, d.l0, d.y1, d.l1] : [d.y1, d.l1, d.y0, d.l0]; return { k: edit.k, lid: edit.lid, a, b, la, lb }; }
  cvp.addEventListener('pointerdown', e => {
    if (!edit || !pmap || e.button !== 0) return;
    const p = evPt(e), h = handleAt(p), m = pmap.base;
    if (h) pdrag = { y0: h === 'a' ? m.b : m.a, l0: h === 'a' ? m.lb : m.la, y1: h === 'a' ? m.a : m.b, l1: h === 'a' ? m.la : m.lb, moved: true };
    else { const y = rowAt(p.x), l = lvlAt(y, p.y, p.alt); pdrag = { y0: y, l0: l, y1: y, l1: l, moved: false }; }
    try { cvp.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer has nothing to capture */ }
    e.preventDefault();
  });
  cvp.addEventListener('pointermove', e => {
    if (!pmap) return;
    const p = evPt(e);
    if (!pdrag) { cvp.style.cursor = edit ? (handleAt(p) ? 'grab' : 'crosshair') : 'default'; return; }
    const y = rowAt(p.x); pdrag.y1 = y; pdrag.l1 = lvlAt(y, p.y, p.alt); pdrag.moved = pdrag.moved || Math.abs(pdrag.y1 - pdrag.y0) >= 1;
    drawProfile();
  });
  const endDrag = keep => {
    const d = pdrag, take = edit && d && keep && d.moved && Math.abs(d.y1 - d.y0) >= 2;
    if (take) { const nd = draftFromDrag(); Object.assign(edit, { a: nd.a, b: nd.b, la: nd.la, lb: nd.lb }); syncEdit(); }
    pdrag = null; drawProfile(); if (take) previewEdit();
  };
  cvp.addEventListener('pointerup', () => endDrag(true));
  cvp.addEventListener('pointercancel', () => endDrag(false));
  /* ---------- the two bulk changes, each with its scope and a preview before anything is applied ---------- */
  let bulk = null;
  function openBulk(kind) {
    const P0 = profCtx(); if (!P0 || !P0.v2) return;
    const { st, R, row, lid } = P0, measured = new Set(R.ids), lim = G.Quant.limitsOf(row, lid), srcLane = laneNum(lid);
    const ids = Object.keys(row.lanes).sort((a, b) => st.lanes.findIndex(l => l.id === a) - st.lanes.findIndex(l => l.id === b));
    bulk = { kind, row, src: lid, lim, ids, measured };
    $('bulkTitle').textContent = kind === 'copy' ? 'Copy integration limits' : 'Use endpoint baseline';
    $('bulkWhat').textContent = kind === 'copy'
      ? `Copies the start and end of lane ${srcLane} (rows ${lim[0]}–${lim[1]} of the band's frame) to the ticked lanes. Each keeps its own background (${G.Quant.BG_SHORT[st.quant.bg] || st.quant.bg}); only the limits change. The same limits can cut off a broader band in another lane: check the preview's flags.`
      : 'In each ticked lane, integrates between its own start and end relative to the straight line joining its profile at those two rows (a user-defined baseline). The selected endpoints must represent background: where a band reaches them, the line cuts through the band and the lane is flagged.';
    $('bulkLanes').innerHTML = ids.map(id => {
      const L = row.lanes[id], isSrc = kind === 'copy' && id === lid, meas = measured.has(id), ticked = kind === 'copy' ? meas && !isSrc && !L.manual : id === lid;
      const chips = [isSrc ? 'source' : '', !meas ? 'not measured' : '', L.manual ? 'has a drawn baseline' : ''].filter(Boolean);
      const nmL = (st.lanes.find(l => l.id === id) || {}).name || '';
      return `<label class="bulk-lane${isSrc ? ' src' : ''}"><input type="checkbox" data-bl="${esc(id)}" ${ticked ? 'checked' : ''} ${isSrc ? 'disabled' : ''}><span>Lane ${laneNum(id)}${nmL ? ' · ' + esc(nmL.replace(/\*/g, '')) : ''}</span>${chips.map(c2 => `<span class="state-b det">${c2}</span>`).join('')}</label>`;
    }).join('');
    $('bulkReplace').checked = false;
    $('bulkLanes').querySelectorAll('input').forEach(inp => inp.addEventListener('change', bulkPreview));
    $('bulkReplace').onchange = bulkPreview;
    bulkPreview();
    $('bulkDlg').classList.remove('hidden');
  }
  const bulkTargets = () => [...$('bulkLanes').querySelectorAll('input:checked')].map(i => i.dataset.bl);
  const bulkOp = targets => (bulk.kind === 'copy' ? () => G.Quant.copyLimits(App, bulk.row, targets, bulk.lim[0], bulk.lim[1], { replaceManual: $('bulkReplace').checked }) : () => G.Quant.endpointBaseline(App, bulk.row, targets, { replaceManual: $('bulkReplace').checked }));
  function bulkPreview() {
    if (!bulk) return;
    const t = bulkTargets(), withManual = t.filter(id => bulk.row.lanes[id] && bulk.row.lanes[id].manual && !(bulk.kind === 'copy' && id === bulk.src));
    $('bulkReplaceWrap').classList.toggle('hidden', !withManual.length);
    $('btnBulkApply').disabled = !t.length;
    if (!t.length) { $('bulkPreview').innerHTML = '<p class="hint">Tick at least one lane.</p>'; return; }
    const pv = G.Quant.preview(App, bulk.row, t, bulkOp(t)), kept = pv.result ? pv.result.kept : [];
    const q = c2 => (!c2 ? '–' : c2.value == null ? `n/a` : f2(c2.value));
    $('bulkPreview').innerHTML = `<table class="bulk-table"><thead><tr><th scope="col">Lane</th><th scope="col">Now</th><th scope="col">After</th><th scope="col">Quality after</th></tr></thead><tbody>`
      + t.map(id => { const a = pv.after[id], b = pv.before[id], k2 = kept.includes(id); return `<tr><th scope="row">${laneNum(id)}</th><td>${q(b)}</td><td>${k2 ? 'unchanged (keeps its drawn baseline)' : q(a)}</td><td class="${a && a.review.length && !k2 ? 'warn-t' : ''}">${k2 ? '–' : a && a.review.length ? esc(a.review[0]) + (a.review.length > 1 ? ` (+${a.review.length - 1})` : '') : 'no issues found'}</td></tr>`; }).join('')
      + '</tbody></table>' + (withManual.length && !$('bulkReplace').checked ? `<p class="hint">${withManual.length > 1 ? `Lanes ${withManual.map(laneNum).join(', ')} keep their drawn baselines` : `Lane ${laneNum(withManual[0])} keeps its drawn baseline`} unless you tick Replace.</p>` : '');
  }
  const closeBulk = () => { bulk = null; $('bulkDlg').classList.add('hidden'); };
  $('btnBulkClose').onclick = closeBulk; $('btnBulkCancel').onclick = closeBulk;
  $('btnBulkApply').onclick = () => {
    if (!bulk) return; const t = bulkTargets(), r = bulkOp(t)(); closeBulk();
    App.commit(); G.UI.toast(`${r.done.length} lane${r.done.length === 1 ? '' : 's'} changed${r.kept.length ? `, ${r.kept.length} kept their drawn baseline` : ''} (one Undo takes it all back)`, 4200);
  };
  $('btnCopyLimits').onclick = () => openBulk('copy');
  $('btnEndpoint').onclick = () => openBulk('endpoint');

  // live: called while something is being dragged or typed; the band list (which may hold the input being typed
  // in) is left alone, only the numbers follow
  // the chart fits the analysis window's height (its width is the window's): set on every render and resize
  const fitChart = () => { const body = document.querySelector('#quantView .qv-body'); if (body && body.clientHeight) $('quantView').style.setProperty('--qv-h', Math.max(220, body.clientHeight - 64) + 'px'); };
  window.addEventListener('resize', () => { fitChart(); if (S() && shown.quant && tab === 'prof') drawProfile(); });
  function render(live) {
    const st = S();
    if (!st) return;
    fitChart();
    if (live) { if (shown.quant && tab !== 'size') results(); return; }
    const q = st.quant, lanes = G.Quant.quantLanes(App), v2 = q.version === G.Quant.VERSION;
    $('qLegacy').classList.toggle('hidden', v2 || !q.rows.length);
    if (!v2) $('qLegacyText').textContent = 'These values come from the calculation of an earlier version (background from the box\'s own edge rows; negative rows set to zero; boxes follow the image when it is rotated). They are kept as saved.';
    $('qMode').value = q.mode === 'band' ? 'band' : 'box';
    $('qModeHelp').textContent = q.mode === 'band' ? 'Exploratory: only pixels above a noise threshold count, so faint bands read too low. Not for comparing amounts.' : 'Sum signal after background correction.';
    $('qModeHelp').classList.toggle('warn-t', q.mode === 'band');
    $('qBg').value = q.bg; $('qBg').querySelector('option[value="border"]').hidden = q.bg !== 'border';
    $('qBgSides').value = q.bgSides || 'ab'; $('qBgGap').value = q.bgGap != null ? q.bgGap : 2; $('qBgSize').value = q.bgSize || '';
    $('btnBgEdit').disabled = q.bg !== 'local';
    $('btnBgEdit').title = q.bg === 'local' ? 'Sides, gap and depth of the background regions' : 'Only Local regions has regions to set';
    $('qBgHelp').textContent = q.bg === 'local' ? 'Background regions lie outside the band, this far from it; the dashed outlines on the image show them. A lane can have its own (Profile → Adjust this lane).'
      : q.bg === 'edge' ? 'Assumes the first and last rows inside the region hold no band; a broad band that reaches them is subtracted from itself.' : '';
    if (q.bg !== 'local') { $('qBgEdit').classList.add('hidden'); $('btnBgEdit').setAttribute('aria-expanded', 'false'); }
    if (q.bg === 'edge' && !$('qBgHelp').textContent) $('qBgHelp').textContent = '';
    // normalization: one control; the reference band by name
    const nm = q.norm === 'band' || q.norm === 'lane' ? q.norm : (q.norm === 'control' && !v2 ? 'band' : 'none');
    $('qNorm').value = nm; $('qNorm').disabled = !v2;
    $('qNormBand').classList.toggle('hidden', nm !== 'band');
    $('qNormBand').innerHTML = `<option value="">Choose the band…</option>` + q.rows.map((r, k) => `<option value="${esc(r.id || '')}"${r.id && r.id === q.normBand ? ' selected' : ''}>${esc(r.name || `Band ${k + 1}`)}</option>`).join('');
    $('qNormSub').classList.toggle('hidden', nm === 'none');
    $('qLaneTotalWrap').classList.toggle('hidden', nm !== 'lane'); $('qLaneTotal').checked = !!q.laneTotal;
    // the total-lane regions: their own extent, said; only "Update…" moves them
    const nrg = q.normRegions;
    $('qNormRegWrap').classList.toggle('hidden', nm !== 'lane' || !v2);
    $('qNormRegions').textContent = nrg ? `Total-lane regions: rows ${nrg.y0}–${nrg.y1} of the frame they were placed in (${G.Quant.frameText(q.frames && q.frames[nrg.frame])}), ${Object.keys(nrg.lanes || {}).length} lanes, from ${nrg.from || 'the analysis area'}. Changing the analysis area does not move them.` : 'No total-lane regions yet.';
    $('qNormHint').textContent = nm === 'band' ? 'Every other band is divided by this band in the same lane. Valid only if this band does not change between your conditions and is within its linear range: check its values in the table.'
      : nm === 'lane' ? (q.laneTotal ? 'Each band is divided by its lane\'s total signal over the analysis area of this total-protein image.' : 'Each band is divided by its lane\'s total signal over the analysis area. On an antibody image this is not total protein; tick below only for a total-protein stain or stain-free image of this gel or membrane.') : '';
    // output, and the reference lane only when fold changes need it (never chosen for you)
    $('qOutput').value = ['corrected', 'normalized', 'fold'].includes(q.output) ? q.output : 'corrected'; $('qOutput').disabled = !v2;
    $('qRef').classList.toggle('hidden', q.output !== 'fold' || !v2);
    $('qRef').innerHTML = `<option value="">Choose the reference lane…</option>` + lanes.map(i => { const id = App.laneId(i); return `<option value="${id}"${id === q.ref ? ' selected' : ''}>Lane ${i + 1}${st.lanes[i].name ? ' · ' + esc(st.lanes[i].name.replace(/\*/g, '')).slice(0, 14) : ''}</option>`; }).join('');
    $('qW').value = Math.round(q.wFrac * 100); widthLabel();
    // the analysis area and the lanes measured in it
    const ga = G.Quant.region(st), fixed = !!q.region, cr = st.crop, same = fixed && ga.x === cr.x && ga.y === cr.y && ga.w === cr.w && ga.h === cr.h;
    $('qAreaNote').textContent = !fixed ? 'Figure box (saved with the first band)' : same ? 'Saved' : 'Saved · differs from the figure box';
    [['qAreaL', ga.x], ['qAreaR', ga.x + ga.w], ['qAreaT', ga.y], ['qAreaB', ga.y + ga.h]].forEach(([id, v]) => { if (document.activeElement !== $(id)) $(id).value = Math.round(v); });
    $('btnAreaFromCrop').disabled = !fixed || same;
    $('btnAreaFromCrop').title = !fixed || same ? 'The analysis area is already the figure box' : 'Set the analysis area to the current figure box; lanes measured can change';
    $('qLanesSum').textContent = lanes.length ? laneList(lanes) : 'None';
    const mk = new Set(st.markers.map(m => m.lane)), inArea = st.lanes.map((l, i) => i).filter(i => st.lanes[i].x >= ga.x && st.lanes[i].x <= ga.x + ga.w);
    // the lanes not measured, each with its reason
    const notM = st.lanes.map((l, i) => i).filter(i => !lanes.includes(i)), reason = i => (mk.has(i) ? 'ladder' : !inArea.includes(i) ? 'outside the analysis area' : 'left out');
    const byWhy = new Map(); notM.forEach(i => { const w = reason(i); byWhy.set(w, (byWhy.get(w) || []).concat(i)); });
    $('qLaneWhy').textContent = notM.length ? `Not measured: ${[...byWhy].map(([w, l]) => `${laneList(l)} (${w})`).join('; ')}.` : 'Every lane is measured.';
    $('qLanesSum').title = $('qLaneWhy').textContent;
    $('qLaneList').innerHTML = inArea.map(i => mk.has(i)
      ? `<label class="chip-c off" title="ladder lane: never measured"><input type="checkbox" disabled aria-label="Lane ${i + 1}: ladder, not measured">${i + 1} ladder</label>`
      : `<label class="chip-c${st.lanes[i].noMeasure ? ' off' : ''}" title="${esc(st.lanes[i].name || 'lane ' + (i + 1))}${st.lanes[i].role === 'neg' ? ' (negative control)' : ''}"><input type="checkbox" data-qm="${i}" ${st.lanes[i].noMeasure ? '' : 'checked'} aria-label="Measure lane ${i + 1}${st.lanes[i].name ? ' ' + esc(st.lanes[i].name) : ''}">${i + 1}${st.lanes[i].role === 'neg' ? ' neg.' : ''}</label>`).join('');
    $('qLaneList').querySelectorAll('[data-qm]').forEach(inp => inp.addEventListener('change', done(e => { const l = st.lanes[+inp.dataset.qm]; if (e.target.checked) delete l.noMeasure; else l.noMeasure = true; })));
    const P = plot();
    $('plotType').value = P.type === 'point' ? 'point' : 'bar'; $('plotValues').checked = !!P.values; $('plotRef').checked = P.refLine !== false; $('plotRef').disabled = q.output !== 'fold';
    if (document.activeElement !== $('plotTitle')) $('plotTitle').value = P.title || '';
    if (document.activeElement !== $('plotY')) $('plotY').value = P.ylabel || '';
    const pl = App.selLane >= 0 && lanes.includes(App.selLane) ? App.selLane : lanes[0];
    $('qProfLane').innerHTML = lanes.map(i => `<option value="${i}"${i === pl ? ' selected' : ''}>Lane ${i + 1}${st.lanes[i].name ? ' · ' + esc(st.lanes[i].name.replace(/\*/g, '')).slice(0, 12) : ''}</option>`).join('');
    if (selBox >= q.rows.length) selBox = Math.max(0, q.rows.length - 1);
    $('qProfBox').innerHTML = q.rows.map((r, k) => `<option value="${k}"${k === selBox ? ' selected' : ''}>${esc(r.name || `Band ${k + 1}`)}</option>`).join('');
    $('stQuant').textContent = q.rows.length ? `${q.rows.length} band${q.rows.length > 1 ? 's' : ''}` : 'band intensities, band sizes';
    $('btnShowQuant').classList.toggle('hidden', shown.quant || !q.rows.length);
    renderBoxes();
    if (!shown.quant) { results(true); return; }
    setTab(tab);
    if (tab === 'size') { renderSizes(); return; }
    results();
  }
  // the issues that affect interpretation, next to the settings (one line each, with the way to them)
  function renderIssues(R) {
    const box = $('qIssues');
    if (!R) { box.innerHTML = ''; return; }
    const items = [];
    R.cells.forEach((r, k) => r.forEach((c, j) => {
      const i = R.lanes[j], what = c.value == null ? 'not available' : c.flags.clip ? 'clipped' : c.review && c.review.length ? (c.flags.contaminated || c.flags.boundary ? 'background needs review' : 'region needs review') : null;
      if (what) items.push(`<div class="q-issue"><span>${c.value == null ? 'n/a' : c.flags.clip ? '⚠' : '?'} Lane ${i + 1} · ${esc(R.rows[k].name)}: ${what}</span><button class="btn sm" data-qinsp="${k}:${i}">Inspect</button></div>`);
    }));
    box.innerHTML = items.slice(0, 6).join('') + (items.length > 6 ? `<p class="hint">and ${items.length - 6} more (Table)</p>` : '');
    box.querySelectorAll('[data-qinsp]').forEach(b => b.onclick = () => { const [k, i] = b.dataset.qinsp.split(':').map(Number); selBox = k; App.selLane = i; setView('quant'); setTab('prof'); App.emit('select'); render(); });
  }
  function results(quiet) {
    const st = S();
    if (st.quant.rows.length && G.Quant.quantLanes(App).length) lastR = G.Quant.measure(App);
    else lastR = null;
    renderIssues(lastR);
    const D = lastR ? G.Quant.describe(App, lastR) : null;
    $('qSummary').innerHTML = D ? `${esc(D.summary)}${lastR.legacy ? ' · <span class="warn-t">earlier method (version 1)</span>' : ''} · <a href="#" id="qMethodLink">Method details</a>` : '';
    const ml = $('qMethodLink'); if (ml) ml.onclick = e => { e.preventDefault(); $('quantDetails').open = true; $('methodsAdv').open = true; $('methodsAdv').scrollIntoView({ block: 'nearest' }); };
    $('qMethodNote').textContent = D ? `${D.summary}. Signal: ${D.signal}. Region: ${D.measure}. Background: ${D.background}. ${D.limits[0].toUpperCase() + D.limits.slice(1)}. ${D.version[0].toUpperCase() + D.version.slice(1)}.` : '';
    $('methodsText').value = lastR ? G.Quant.methodsText(App, lastR) : '';
    if (quiet) return;
    if (lastR) renderTable(lastR); else { $('quantTable').innerHTML = ''; $('quantChart').innerHTML = ''; }
    $('quantEmpty').classList.toggle('hidden', !!st.quant.rows.length);
    ['btnQCopy', 'btnQCSV', 'btnQChart'].forEach(id => { $(id).disabled = !lastR; });
    drawProfile();
  }
  // a chart mark selects its lane
  $('quantChart').addEventListener('click', e => { const t = e.target.closest('[data-lane]'); if (t) selectLane(+t.dataset.lane); });

  App.on(what => {
    if (!S() || what === 'select' && !shown.quant) { if (S() && what === 'select') renderBoxes(); return; }
    // a band drawn by the user opens the results: that is what adding one is for
    if (what === 'change' && App.boxAdded) { App.boxAdded = false; selBox = Math.max(0, S().quant.rows.length - 1); tab = 'prof'; if (!shown.quant || view !== 'quant') { setView('quant'); return; } }
    if (what === 'select') { if (lastR) { renderTable(lastR); drawProfile(); } return; }
    render(what === 'refresh');
  });
  // a loaded gel (example, project, library) opens on its figure, with the analysis window too when it has bands
  App.on(what => { if (what === 'loaded' && S()) { App.boxAdded = false; shown.figure = true; shown.quant = S().quant.rows.length > 0; view = 'figure'; layer = 'quant'; setLayer('figure'); refreshChrome(); if (shown.quant) { render(); $('quantDetails').open = true; } } });
  // the current results and chart (measured on demand), for the export routes
  function measured() { if (S() && S().quant.rows.length && G.Quant.quantLanes(App).length) lastR = G.Quant.measure(App); else lastR = null; return lastR; }
  function chart() { const R = measured(); return R ? G.Quant.chartSVG(App, R) : null; }
  // where a row and level of the profile are on the screen (client px), for tests and the lessons
  const profileXY = (y, l) => { if (!pmap) return null; const r = $('qProfile').getBoundingClientRect(); return { x: r.left + pmap.X(y) / pmap.dpr, y: r.top + pmap.Y(l) / pmap.dpr }; };
  G.QuantUI = { profileXY, editing: () => (edit ? Object.assign({}, edit) : null), render, setView, setTab: t => { setTab(t); render(); }, show, follow, view: () => view, isShown: p => !!shown[p], results: measured, lastResults: () => lastR, chart, layer: () => layer, setLayer, exportChart, selectLane, tab: () => tab };
})(window);

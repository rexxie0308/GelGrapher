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
  $('qNorm').addEventListener('change', done(e => { const q = Q(); q.norm = e.target.value; if (q.norm === 'band' && !q.rows.some(r => r.id === q.normBand)) q.normBand = null; }));
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
  // the region width: every band is placed again with it (an analysis change)
  $('qW').addEventListener('input', live(e => { Q().wFrac = +e.target.value / 100; widthLabel(); }));
  $('qW').addEventListener('change', done(() => { const q = Q(); if (q.version === G.Quant.VERSION) q.rows.forEach(r => { const sp = G.Quant.rowSpan(App, r); G.Quant.editRow(App, r, sp.y0, sp.y1); }); }));
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
    $('boxList').querySelectorAll('[data-qhgt]').forEach(inp => inp.addEventListener('change', done(e => {
      const r = q.rows[+inp.dataset.qhgt], sp = G.Quant.rowSpan(App, r), c = (sp.y0 + sp.y1) / 2, h = Math.max(3, Math.min(600, Math.round(+e.target.value || 3)));
      G.Quant.editRow(App, r, Math.round(c - (h - 1) / 2), Math.round(c - (h - 1) / 2) + h - 1);
    })));
    $('boxList').querySelectorAll('[data-qprof]').forEach(b => b.onclick = () => { selBox = +b.dataset.qprof; setView('quant'); setTab('prof'); render(); });
    $('boxList').querySelectorAll('[data-qmore]').forEach(b => b.onclick = e => { e.stopPropagation(); const m = $('boxList').querySelector(`[data-qmenu="${b.dataset.qmore}"]`); document.querySelectorAll('.menu').forEach(x => { if (x !== m) x.classList.add('hidden'); }); m.classList.toggle('hidden'); });
    $('boxList').querySelectorAll('[data-qrecentre]').forEach(b => b.onclick = done(() => { const r = q.rows[+b.dataset.qrecentre], sp = G.Quant.rowSpan(App, r); G.Quant.editRow(App, r, sp.y0, sp.y1); G.UI.toast('Band placed again on the lanes as shown'); }));
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

  /* ---------- the diagnostic profile: the measured pixels, row by row along the lane ----------
   * Built from the same pixels and background as the number: the mean signal of each row of the region (and of
   * the background regions' rows), the background level the calculation used, and the counted signal (shaded).
   * Thresholded signal: the line is the per-row mean of what was counted (the pixel selection itself is not a row
   * quantity). "Compare lanes" draws every measured lane's corrected row profile on one scale. */
  function cssVar(n, d) { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || d; }
  function drawProfile() {
    const cv = $('qProfile'), st = S(), R = lastR;
    if (!st || !cv.clientWidth || tab !== 'prof') return;
    const k = Math.min(selBox, st.quant.rows.length - 1), lane = App.selLane >= 0 && R && R.lanes.includes(App.selLane) ? App.selLane : R ? R.lanes[0] : -1;
    $('qLaneAdj').classList.add('hidden');
    if (!R || k < 0 || lane < 0) { $('qProfRead').textContent = ''; cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); return; }
    if (+$('qProfLane').value !== lane) $('qProfLane').value = String(lane);
    const j = R.lanes.indexOf(lane), c = R.cells[k][j], dpr = window.devicePixelRatio || 1, W = cv.width = cv.clientWidth * dpr, H = cv.height = 170 * dpr;
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, W, H);
    const accent = cssVar('--accent', '#176d7c'), okc = '#1f9d55', muted = cssVar('--faint', '#9aa2ad'), warn = cssVar('--warn', '#9F4E0C'), txt = cssVar('--muted', '#555');
    const pad = 10 * dpr, all = $('qProfAll').checked;
    if (!c.prof) { $('qProfKey').textContent = ''; readout(R, k, j, c); return; }
    if (all) {
      // every measured lane's corrected row profile (row mean minus its background), one scale
      const series = R.lanes.map((i, jj) => { const cc = R.cells[k][jj]; return cc.prof ? cc.prof.map(p => ({ v: p.v, y: p.mean - (isNaN(p.bg) ? 0 : p.bg) })) : []; });
      const vs = series.flat(); if (!vs.length) return;
      let lo = Math.min(0, ...vs.map(p => p.y)), hi = Math.max(...vs.map(p => p.y)), vmin = Math.min(...vs.map(p => p.v)), vmax = Math.max(...vs.map(p => p.v));
      if (hi <= lo) hi = lo + 1e-6;
      const X = v => pad + (v - vmin) / Math.max(1e-9, vmax - vmin) * (W - 2 * pad), Y = y => H - pad - (y - lo) / (hi - lo) * (H - 2 * pad);
      ctx.strokeStyle = muted; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(W - pad, Y(0)); ctx.stroke();
      series.forEach((s2, jj) => { if (!s2.length) return; const me = R.lanes[jj] === lane; ctx.strokeStyle = me ? accent : muted; ctx.lineWidth = (me ? 2.2 : 1) * dpr; ctx.globalAlpha = me ? 1 : 0.7; ctx.beginPath(); s2.forEach((p, t) => { if (t) ctx.lineTo(X(p.v), Y(p.y)); else ctx.moveTo(X(p.v), Y(p.y)); }); ctx.stroke(); });
      ctx.globalAlpha = 1;
      $('qProfKey').textContent = 'Every measured lane, row by row: signal minus its background, on one scale (selected lane thick). Zero line: the background.';
    } else {
      const pts = c.prof.map(p => ({ v: p.v, y: p.mean, bg: p.bg, loc: p.local, cnt: p.counted })), bgp = (c.bgProf || []).filter(p => !isNaN(p.mean));
      const ys = pts.map(p => p.y).concat(pts.map(p => p.bg).filter(v => v != null && !isNaN(v)), bgp.map(p => p.mean));
      let lo = Math.min(...ys), hi = Math.max(...ys); if (hi <= lo) hi = lo + 1e-6;
      const vmin = Math.min(...pts.map(p => p.v), ...bgp.map(p => p.v)) - 0.5, vmax = Math.max(...pts.map(p => p.v), ...bgp.map(p => p.v)) + 0.5;
      const X = v => pad + (v - vmin) / Math.max(1e-9, vmax - vmin) * (W - 2 * pad), Y = y => H - pad - (y - lo) / (hi - lo) * (H - 2 * pad);
      const v0 = pts[0].v - 0.5, v1 = pts[pts.length - 1].v + 0.5;
      // the signal region (light band), the background regions (hatched outline)
      ctx.fillStyle = 'rgba(31,157,85,.08)'; ctx.fillRect(X(v0), pad, X(v1) - X(v0), H - 2 * pad);
      // what is counted: between the row means and the background (whole region; signed: below the background counts negative)
      if (R.mode === 'box' && pts.every(p => !isNaN(p.bg))) { ctx.fillStyle = 'rgba(31,157,85,.35)'; ctx.beginPath(); pts.forEach((p, t) => { if (t) ctx.lineTo(X(p.v), Y(p.y)); else ctx.moveTo(X(p.v), Y(p.y)); }); for (let t = pts.length - 1; t >= 0; t--) ctx.lineTo(X(pts[t].v), Y(pts[t].bg)); ctx.closePath(); ctx.fill(); }
      // background rows' means (dots), the background level used (dashed)
      ctx.fillStyle = muted; bgp.forEach(p => { ctx.beginPath(); ctx.arc(X(p.v), Y(p.mean), 2 * dpr, 0, 7); ctx.fill(); });
      ctx.strokeStyle = okc; ctx.lineWidth = 1.3 * dpr; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.beginPath(); pts.forEach((p, t) => { if (isNaN(p.bg)) return; if (t) ctx.lineTo(X(p.v), Y(p.bg)); else ctx.moveTo(X(p.v), Y(p.bg)); }); ctx.stroke();
      if (R.mode === 'band') { ctx.strokeStyle = warn; ctx.setLineDash([1.5 * dpr, 2.5 * dpr]); ctx.beginPath(); pts.forEach((p, t) => { const y = p.bg + (p.cnt || 0); if (t) ctx.lineTo(X(p.v), Y(y)); else ctx.moveTo(X(p.v), Y(y)); }); ctx.stroke(); }
      ctx.setLineDash([]);
      ctx.strokeStyle = accent; ctx.lineWidth = 1.8 * dpr; ctx.beginPath(); pts.forEach((p, t) => { if (t) ctx.lineTo(X(p.v), Y(p.y)); else ctx.moveTo(X(p.v), Y(p.y)); }); ctx.stroke();
      ctx.fillStyle = txt; ctx.font = `${11 * dpr}px sans-serif`; ctx.textAlign = 'left'; ctx.fillText('top', pad, H - 2 * dpr); ctx.textAlign = 'right'; ctx.fillText('bottom', W - pad, H - 2 * dpr);
      $('qProfKey').textContent = `Rows of the region along the lane (top → bottom): line = mean signal of each row's pixels; dashed = the background the calculation used; dots = rows of the background regions; shaded = counted signal${R.mode === 'band' ? '; dotted = background plus the per-row counted mean (the pixel selection itself is not drawn)' : ''}. From the same original pixels as the number.`;
    }
    readout(R, k, j, c);
  }
  // everything the number rests on, for the selected lane and band
  function readout(R, k, j, c) {
    const st = S(), i = R.lanes[j], p = c.prov || {}, ln = st.lanes[i].name || `lane ${i + 1}`, nm = R.rows[k].name;
    const f2 = v => (v == null || !isFinite(v) ? '–' : Math.abs(v) >= 100 ? v.toFixed(1) : v.toPrecision(4));
    const corners = cs => cs.map(q => `(${q[0].toFixed(1)}, ${q[1].toFixed(1)})`).join(' ');
    const lines = [];
    lines.push(`<b>${esc(ln.replace(/\*/g, ''))} · ${esc(nm)}</b>: ${c.value == null ? `<span class="warn-t">not available — ${esc(c.unavailable || '')}</span>` : `corrected signal <b>${f2(c.value)}</b> a.u.`}${R.output !== 'corrected' && R.shown[k][j] != null ? ` · ${R.output === 'fold' ? 'fold change' : 'normalized'} <b>${fmtV(R.shown[k][j], R.output)}</b>` : R.output !== 'corrected' ? ` · ${esc(R.output)}: n/a (${esc(R.shownWhy[k][j] || '')})` : ''}`);
    if (c.review && c.review.length) lines.push(`<span class="warn-t">? Needs review: ${esc(c.review.join('; '))}.</span>`);
    if (c.flags && c.flags.clip) lines.push(`<span class="warn-t">⚠ ${c.clip.n} pixel${c.clip.n > 1 ? 's' : ''} of the region ${c.flags.clip === 'pileup' ? 'pile up at an extreme value (probably clipped)' : 'reach the file\'s digital limit (clipped)'}: the value is underestimated.</span>`);
    if (c.flags && c.flags.below) lines.push(`† Below the estimated ${c.flags.below === 't3' ? '3' : '10'}σ noise threshold (${f2(c.flags.below === 't3' ? c.t3 : c.t10)}).`);
    if (R.version === G.Quant.VERSION && p.signal) {
      lines.push(`Uncorrected sum ${f2(c.U)} − background ${f2(c.B)} = <b>${f2(c.value)}</b> (${p.signal.px} px; ${esc(p.polarity)}).`);
      lines.push(`Signal region, original pixels: ${corners(p.signal.corners)}${p.signal.outsidePx ? `; ${p.signal.outsidePx} px off the image` : ''}.`);
      if (p.background && p.background.length) lines.push(`Background (${esc(G.Quant.BG_SHORT[p.method] || p.method)}${p.method === 'local' ? `, ${esc(G.Quant.SIDES_TEXT[p.spec.sides])}, ${p.spec.gap} px gap, ${p.spec.size} px deep${p.spec.override ? ', set for this lane' : ''}` : ''}): ${p.background.map(b => `${b.side} ${b.px} px ${corners(b.corners)}`).join('; ')}.`);
      else lines.push(`Background: ${esc(G.Quant.BG_TEXT[p.method] || p.method)}.`);
      lines.push(c.flags && c.flags.noise ? `Noise: not estimated here — the background regions are not flat (${esc(c.flags.noise)}), so their spread (${f2(c.sigmaPx)} per pixel) is not noise.`
        : `Noise: σ ${f2(c.sigmaPx)} per pixel${c.f > 1.05 ? ` (×${Math.sqrt(c.f).toFixed(2)} for correlated neighbours)` : ''}; thresholds 3σ ${f2(c.t3)}, 10σ ${f2(c.t10)} (estimated).`);
      if (R.output !== 'corrected' && R.shownCaveat && R.shownCaveat[k][j]) lines.push(`<span class="warn-t">? The ${R.output === 'fold' ? 'fold change' : 'normalized value'} needs review: ${esc(R.shownCaveat[k][j])}.</span>`);
      if (c.sens) lines.push(`Sensitivity: ${c.sens.tallerRows} rows taller at each end → ${f2(c.sens.taller)}${c.sens.away != null ? `; background ${c.sens.awayPx} px further away → ${f2(c.sens.away)}` : ''}.`);
      lines.push(`Image: ${esc(p.image || '')} (SHA-256 ${esc(String(p.sha256 || '').slice(0, 12))}…) · calculation version ${p.version} · placed ${p.placed}×${p.override && p.override.length ? ` · lane-specific: ${esc(p.override.join(', '))}` : ''}.`);
    } else lines.push(`Earlier method (version 1): ${esc(G.Quant.BG_TEXT[R.method] || R.method)}; uncorrected ${f2(c.U)}, background ${f2(c.B)}.`);
    if (R.normMode !== 'none') lines.push(`Normalization: ${esc(G.Quant.describe(App, R).normalization)}.`);
    if (R.output === 'fold') lines.push(R.ref != null ? `Reference lane: ${R.ref + 1}${st.lanes[R.ref] && st.lanes[R.ref].name ? ` (${esc(st.lanes[R.ref].name.replace(/\*/g, ''))})` : ''}.` : 'No reference lane chosen.');
    $('qProfRead').innerHTML = lines.map(l => `<p>${l}</p>`).join('');
    // the lane's own adjustments (version 2): edges, shift, background
    const row = st.quant.rows[k], lid = App.laneId(i), L = row && row.lanes && row.lanes[lid];
    if (R.version === G.Quant.VERSION && L) {
      $('qLaneAdj').classList.remove('hidden');
      $('qLaneBg').value = L.bg && L.bg.sides ? L.bg.sides : ''; $('qLaneGap').value = L.bg && L.bg.gap != null ? L.bg.gap : '';
      $('qLaneAdj').dataset.k = k; $('qLaneAdj').dataset.lid = lid;
    }
  }
  const laneRec = () => { const el = $('qLaneAdj'), row = S().quant.rows[+el.dataset.k]; return row && row.lanes ? row.lanes[el.dataset.lid] : null; };
  document.querySelectorAll('#qLaneAdj [data-adj]').forEach(b => b.onclick = done(() => { const L = laneRec(); if (!L) return; const [key, d] = b.dataset.adj.split(':'); L[key] = (L[key] || 0) + +d; if (!L[key]) delete L[key]; }));
  $('qLaneBg').addEventListener('change', done(e => { const L = laneRec(); if (!L) return; const v = e.target.value; if (v) L.bg = Object.assign({}, L.bg, { sides: v }); else if (L.bg) { delete L.bg.sides; if (!Object.keys(L.bg).length) delete L.bg; } }));
  $('qLaneGap').addEventListener('change', done(e => { const L = laneRec(); if (!L) return; const v = e.target.value; if (v !== '') L.bg = Object.assign({}, L.bg, { gap: Math.max(0, Math.round(+v)) }); else if (L.bg) { delete L.bg.gap; if (!Object.keys(L.bg).length) delete L.bg; } }));
  $('btnLaneReset').onclick = done(() => { const L = laneRec(); if (!L) return; ['dx', 'dy0', 'dy1', 'bg'].forEach(k2 => delete L[k2]); });

  // live: called while something is being dragged or typed; the band list (which may hold the input being typed
  // in) is left alone, only the numbers follow
  function render(live) {
    const st = S();
    if (!st) return;
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
  G.QuantUI = { render, setView, setTab: t => { setTab(t); render(); }, show, follow, view: () => view, isShown: p => !!shown[p], results: measured, lastResults: () => lastR, chart, layer: () => layer, setLayer, exportChart, selectLane, tab: () => tab };
})(window);

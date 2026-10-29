/* Step 6 of the panel: densitometry (band boxes, table, chart, lane profile) and band sizes. */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  const S = () => App.S;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const done = fn => e => { if (!S()) return; if (fn) fn(e); App.commit(); };
  const live = fn => e => { if (!S()) return; fn(e); App.refresh(); };
  let tab = 'int', view = 'figure', lastR = null, lastSizes = null;

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
   * be closed; the last one clicked is the active window, and that decides which overlay layer the raw
   * image edits (strips with the figure, band boxes with the analysis). `view()` is the active window. */
  const shown = { figure: true, quant: false };
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
  /* the active window follows the control you touch in the panel; a window opened for you flashes its top-bar button */
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
  $('qNorm').addEventListener('change', done(e => { S().quant.norm = e.target.value; }));
  $('qLaneTotal').addEventListener('change', done(e => { S().quant.laneTotal = e.target.checked; }));
  // the analysis area back onto the figure box: a deliberate act, since results can change
  $('btnAreaFromCrop').onclick = done(() => { S().quant.region = Object.assign({}, S().crop); G.UI.toast('Analysis area set to the figure box'); });
  $('btnMethodsCopy').onclick = () => { if ($('methodsText').value) copyText($('methodsText').value); };
  $('btnAddBox2').onclick = () => $('btnAddBox').click();
  document.querySelectorAll('#quantTabs button').forEach(b => b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll('#quantTabs button').forEach(x => x.classList.toggle('on', x === b));
    $('quantInt').classList.toggle('hidden', tab !== 'int'); $('quantSize').classList.toggle('hidden', tab !== 'size');
    $('quantActions').classList.toggle('hidden', tab !== 'int'); $('sizeActions').classList.toggle('hidden', tab !== 'size');
    render();
  });
  $('profAdv').addEventListener('toggle', () => { if ($('profAdv').open) drawProfile(); });
  $('qBg').addEventListener('change', done(e => { S().quant.bg = e.target.value; }));
  $('qMode').addEventListener('change', done(e => { S().quant.mode = e.target.value; }));
  $('qW').addEventListener('input', live(e => { S().quant.wFrac = +e.target.value / 100; widthLabel(); }));
  $('qW').addEventListener('change', done());
  $('qRef').addEventListener('change', done(e => { S().quant.ref = +e.target.value; }));
  $('qProfLane').addEventListener('change', () => drawProfile());
  $('btnQCopy').onclick = () => { if (lastR) copyText(tsv(lastR)); };
  $('btnQCSV').onclick = async () => {
    if (!S() || !lastR) return;
    const st = await G.Export.download(new Blob([G.Quant.quantCSV(App, lastR)], { type: 'text/csv' }), baseName() + '_densitometry.csv');
    if (st === 'saved') G.UI.toast('Exported the densitometry CSV');
  };
  $('btnQChart').onclick = async () => {
    if (!S() || !lastR) return;
    const ch = G.Quant.chartSVG(App, lastR);
    if (!ch) { G.UI.toast('Add at least one band box that is not the loading control'); return; }
    App.busy(true, 'Exporting…');
    try {
      const fmt = $('qChartFmt').value, st = await G.Export.exportChart(ch, fmt, baseName() + '_densitometry_chart', S().style.dpi, S());
      if (st === 'saved') G.UI.toast('Exported the chart');
    } catch (e) { G.UI.alert(e.message); } finally { App.busy(false); }
  };
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

  /* ---------- band boxes ---------- */
  function renderBoxes() {
    const st = S(), q = st.quant;
    $('boxList').innerHTML = q.rows.map((r, k) => `<div class="item">
      <span class="swatch${k === q.control ? ' ctl' : ''}"></span>
      <input type="text" data-q="${k}" value="${esc(r.name)}" placeholder="${`Band ${k + 1}, e.g. p53`}">
      <label class="switch" title="${'Divide the other boxes of each lane by this one (a loading control). Use it only when this band does not change between your conditions and is within its linear range'}"><input type="checkbox" data-qc="${k}" ${k === q.control ? 'checked' : ''}>${'Divide by this box'}</label>
      <button class="x" data-qdel="${k}" title="${'Delete'}">×</button></div>`).join('')
      || `<p class="hint">${'No band boxes yet.'}</p>`;
    $('boxList').querySelectorAll('[data-q]').forEach(inp => {
      const r = q.rows[+inp.dataset.q];
      inp.addEventListener('input', live(e => { r.name = e.target.value; }));
      inp.addEventListener('change', done());
    });
    // ticking a box is the deliberate choice of a loading-control normalization; unticking ends it
    $('boxList').querySelectorAll('[data-qc]').forEach(inp => inp.addEventListener('change', done(e => {
      q.control = e.target.checked ? +inp.dataset.qc : -1;
      if (e.target.checked) q.norm = 'control'; else if (q.norm === 'control') q.norm = 'none';
    })));
    $('boxList').querySelectorAll('[data-qdel]').forEach(b => b.onclick = done(() => {
      const k = +b.dataset.qdel;
      q.rows.splice(k, 1);
      if (q.control === k) q.control = -1; else if (q.control > k) q.control--;
    }));
  }

  /* ---------- results ---------- */
  function tsv(R) {
    const head = ['Well', 'Lane'].concat(R.rows.map(r => r.name)).concat(R.rows.filter((r, k) => k !== R.control).map(r => r.name + ' rel.'));
    const lines = [head.join('\t')];
    R.lanes.forEach((i, j) => lines.push([i + 1, R.names[j]].concat(R.vol.map(v => sig(v[j]))).concat(R.rel.filter((r, k) => k !== R.control).map(v => rel(v[j]))).join('\t')));
    return lines.join('\n');
  }
  function sizesTsv(T) {
    return [['Well', 'Lane', `Bands (${App.baseUnit()})`].join('\t')]
      .concat(T.filter(l => !l.marker).map(l => [l.lane + 1, l.name, l.bands.map(b => (b.extrap ? '≈' : '') + (b.size ? App.fmtSize(b.size) : '?')).join(', ')].join('\t'))).join('\n');
  }
  function renderTable(R) {
    const tg = R.rows.map((r, k) => k).filter(k => k !== R.control);
    const ctlName = R.normLabel;
    const flagMark = f => (f.sat ? ' ⚠' : '') + (f.below === 'lod' ? ' <small class="blq">&lt;LOD</small>' : f.below === 'loq' ? ' <small class="blq">&lt;LOQ</small>' : '');
    const head = `<tr><th>${'Lane'}</th>${R.rows.map((r, k) => `<th title="${'Integrated density (a.u.)'}">${esc(r.name)}${k === R.control ? ' <span class="tag" title="the other boxes are divided by this one">divisor</span>' : ''}</th>`).join('')}` +
      (R.totals ? `<th title="${'the lane signal over the analysis area: the divisor'}">${esc(R.normLabel)}</th>` : '') +
      tg.map(k => `<th title="${esc(ctlName ? `${R.rows[k].name} / ${ctlName}, relative to the reference lane` : 'relative to the reference lane')}">${esc(R.rows[k].name)} ${ctlName ? '/ ' + esc(ctlName) + ', rel.' : 'rel.'}</th>`).join('') + '</tr>';
    const body = R.lanes.map((i, j) => `<tr class="${i === R.ref ? 'ref' : ''}"><td>${esc(R.names[j].replace(/\*/g, ''))}</td>` +
      R.rows.map((r, k) => { const c = R.cells[k][j], f = R.flags[k][j], t = G.Quant.flagText(f); return `<td class="${f.sat ? 'sat' : ''}${f.below ? ' low' : ''}" title="${esc(`LOQ ${sig(c.loq)}${t ? ' · ' + t : ''}`)}">${sig(c.vol)}${flagMark(f)}</td>`; }).join('') +
      (R.totals ? `<td title="${esc(R.totalCells[j].sat ? 'clipped pixels' : '')}">${sig(R.totals[j])}${R.totalCells[j].sat ? ' ⚠' : ''}</td>` : '') +
      tg.map(k => { const f = R.flags[k][j], v = R.rel[k][j]; return `<td class="relv${f.below ? ' low' : ''}" title="${esc(G.Quant.flagText(f))}">${rel(v)}${v != null && f.below ? '†' : ''}</td>`; }).join('') + '</tr>').join('');
    const notes = [];
    const st = S(), D = G.Quant.describe(App, R);
    if (R.saturatedLanes.length) notes.push(`<p class="hint warn-t">${`Boxes in well${R.saturatedLanes.length > 1 ? 's' : ''} ${R.saturatedLanes.map(i => i + 1).join(', ')} contain clipped pixels, so their values are underestimated; re-image with a shorter exposure.`}</p>`);
    const nBelow = R.flags.flat().filter(f => f.below).length;
    if (nBelow) notes.push(`<p class="hint">${`${nBelow} value${nBelow > 1 ? 's are' : ' is'} below the limit of quantification (‹LOQ, † on relative values): detected or not, too close to the background noise to compare.`}</p>`);
    const nDen = R.flags.flat().filter(f => f.den).length;
    if (nDen) notes.push(`<p class="hint warn-t">${`${nDen} normalized value${nDen > 1 ? 's are' : ' is'} not given: the divisor in that lane is clipped or below its limit of quantification.`}</p>`);
    const noRef = tg.filter(k => !R.refOk[k]).map(k => R.rows[k].name);
    if (noRef.length) notes.push(`<p class="hint warn-t">${`The reference lane (well ${R.ref + 1}) has no quantifiable band in ${noRef.join(', ')}, so no relative values are given for ${noRef.length > 1 ? 'these boxes' : 'this box'} and the chart shows the values themselves. Pick another reference lane.`}</p>`);
    if (R.normMode === 'lane' && !R.laneTotal) notes.push(`<p class="hint warn-t">${'Divided by the lane signal of this image. That is total-protein normalization only on a total-protein stain or stain-free image; an antibody image\'s lane signal is not total protein.'}</p>`);
    if (R.normMode === 'control' && R.control < 0) notes.push(`<p class="hint warn-t">${'Normalize is set to a loading-control box, but no box is ticked “Divide by this box”: the values are not normalized.'}</p>`);
    $('quantTable').innerHTML = `<div class="tscroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>` + notes.join('');
    $('quantNote').textContent = `Measured: ${D.measure}, with ${D.background}, from ${D.pixels}. ${D.limits[0].toUpperCase() + D.limits.slice(1)}. ${D.normalization[0].toUpperCase() + D.normalization.slice(1)}; ${D.reference}. Compare lanes of this image only.`;
    const ch = G.Quant.chartSVG(App, R);
    $('quantChart').innerHTML = ch ? ch.svg : '';
    const svg = $('quantChart').querySelector('svg');
    if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = 'auto'; }
    void st;
  }
  function renderSizes() {
    const T = G.Quant.bandSizes(App);
    lastSizes = T;
    const rows = T.map(l => `<tr><td>${esc(l.name.replace(/\*/g, ''))}</td><td>${l.marker ? `<span class="muted">${'marker'}</span>`
      : l.bands.length ? l.bands.map(b => `<span class="${b.extrap ? 'extrap' : ''}" title="${b.extrap ? 'outside the marker range (extrapolated)' : ''}">${b.extrap ? '≈' : ''}${b.size ? App.fmtSize(b.size) : '?'}</span>`).join(', ')
      : `<span class="muted">${'no bands'}</span>`}</td></tr>`).join('');
    $('sizeTable').innerHTML = S().markers.length ? `<div class="tscroll"><table><thead><tr><th>${'Lane'}</th><th>${G.Gels.sizeNoun(App.kind())}</th></tr></thead><tbody>${rows}</tbody></table></div>`
      : `<p class="hint">${'A marker lane is needed to estimate sizes.'}</p>`;
  }

  /* ---------- lane profile ---------- */
  function cssVar(n, d) { const v = getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return v || d; }
  function drawProfile() {
    const cv = $('qProfile'), st = S();
    if (!st || !cv.clientWidth) return;
    const lane = +$('qProfLane').value;
    if (!st.lanes[lane]) return;
    const dpr = window.devicePixelRatio || 1, W = cv.width = cv.clientWidth * dpr, H = cv.height = 130 * dpr;
    const ctx = cv.getContext('2d'), img = App.ensureRot(), hw = G.Quant.boxHalfWidth(st), cx = st.lanes[lane].x;
    const x0 = Math.max(0, Math.round(cx - hw)), x1 = Math.min(img.w - 1, Math.round(cx + hw));
    const ga = G.Quant.region(st), ya = Math.max(0, Math.round(ga.y)), yb = Math.min(img.h - 1, Math.round(ga.y + ga.h - 1)), n = yb - ya + 1;
    const p = new Float32Array(n);
    for (let y = ya; y <= yb; y++) { let s = 0; for (let x = x0; x <= x1; x++) { const v = img.data[y * img.w + x]; s += st.bright ? v : 1 - v; } p[y - ya] = s / (x1 - x0 + 1); }
    let lo = Infinity, hi = -Infinity; p.forEach(v => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const pad = 6 * dpr, X = i => pad + i / (n - 1) * (W - 2 * pad), Y = v => H - pad - (v - lo) / Math.max(1e-9, hi - lo) * (H - 2 * pad);
    ctx.clearRect(0, 0, W, H);
    const accent = cssVar('--accent', '#176d7c'), ok = cssVar('--q-box', '#1f9d55'), muted = cssVar('--faint', '#9aa2ad');
    st.quant.rows.forEach((r, k) => {
      const a = Math.min(r.y0, r.y1) - ya, b = Math.max(r.y0, r.y1) - ya;
      ctx.fillStyle = k === st.quant.control ? 'rgba(122,139,0,.16)' : 'rgba(31,157,85,.16)';
      ctx.fillRect(X(a), pad, X(b) - X(a), H - 2 * pad);
      // the background that this box subtracts (mean per pixel column, like the curve)
      const c = G.Quant.measureBox(App, lane, r, st.quant.bg, st.quant.mode), w = x1 - x0 + 1;
      if (st.quant.bg !== 'none') {
        const ia = Math.max(0, Math.round(a)), ib = Math.min(n - 1, Math.round(b));
        ctx.strokeStyle = ok; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = 1.2 * dpr;
        const e0 = st.quant.bg === 'edge' ? (p[ia] + p[Math.min(n - 1, ia + 1)]) / 2 : null, e1 = st.quant.bg === 'edge' ? (p[ib] + p[Math.max(0, ib - 1)]) / 2 : null;
        ctx.beginPath();
        if (st.quant.bg === 'edge') { ctx.moveTo(X(ia), Y(e0)); ctx.lineTo(X(ib), Y(e1)); }
        else { const lvl = c.bg / Math.max(1, ib - ia + 1) / w; ctx.moveTo(X(ia), Y(lvl)); ctx.lineTo(X(ib), Y(lvl)); }
        ctx.stroke(); ctx.setLineDash([]);
        // thresholded signal: only pixels above the background plus this threshold count (dotted)
        if (st.quant.mode === 'band' && st.quant.bg === 'edge') {
          ctx.strokeStyle = '#b26b00'; ctx.setLineDash([1.5 * dpr, 2.5 * dpr]); ctx.beginPath();
          ctx.moveTo(X(ia), Y(e0 + c.floor)); ctx.lineTo(X(ib), Y(e1 + c.floor)); ctx.stroke(); ctx.setLineDash([]);
        }
      }
    });
    ctx.strokeStyle = muted; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.moveTo(pad, H - pad); ctx.lineTo(W - pad, H - pad); ctx.stroke();
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
    for (let i = 0; i < n; i++) { if (i) ctx.lineTo(X(i), Y(p[i])); else ctx.moveTo(X(i), Y(p[i])); }
    ctx.stroke();
  }

  // live: called while something is being dragged or typed; the band-box list (which may hold the
  // input being typed in) is left alone, only the numbers follow
  function render(live) {
    const st = S();
    if (!st) return;
    if (live) { if (shown.quant && tab === 'int') results(); return; }
    const q = st.quant, lanes = G.Quant.quantLanes(App);
    $('qBg').value = q.bg; $('qMode').value = q.mode === 'band' ? 'band' : 'box'; $('qW').value = Math.round(q.wFrac * 100); widthLabel();
    $('qModeWarn').classList.toggle('hidden', q.mode !== 'band');
    const nm = q.norm === 'lane' || q.norm === 'control' ? q.norm : 'none';
    $('qNorm').value = nm;
    $('qLaneTotalWrap').classList.toggle('hidden', nm !== 'lane'); $('qLaneTotal').checked = !!q.laneTotal;
    $('qNormHint').textContent = nm === 'control'
      ? (q.control >= 0 ? `Each box is divided by “${q.rows[q.control].name || `Band ${q.control + 1}`}” in the same lane. That corrects for loading only if this band does not change between your conditions and is within its linear range: check its values in the table.` : 'Tick “Divide by this box” on the loading-control box.')
      : nm === 'lane' ? (q.laneTotal ? 'Each box is divided by its lane\'s total signal over the analysis area of this total-protein image.' : 'Each box is divided by its lane\'s signal over the analysis area. On an antibody image this is not total protein: use a total-protein stain or stain-free image of the same membrane for that.')
      : 'The values are the background-subtracted box totals. Choose a normalization only when it suits the experiment.';
    // the analysis area and the lanes measured in it
    const ga = G.Quant.region(st), fixed = !!q.region, cr = st.crop;
    const same = fixed && ga.x === cr.x && ga.y === cr.y && ga.w === cr.w && ga.h === cr.h;
    $('qAreaNote').textContent = !fixed ? 'the figure box, until the first band box fixes it' : same ? 'fixed; the same as the figure box' : 'fixed; differs from the figure box (dashed green on the image)';
    $('btnAreaFromCrop').disabled = !fixed || same;
    const mk = new Set(st.markers.map(m => m.lane)), inArea = st.lanes.map((l, i) => i).filter(i => st.lanes[i].x >= ga.x && st.lanes[i].x <= ga.x + ga.w);
    $('qLaneList').innerHTML = inArea.map(i => mk.has(i)
      ? `<label class="chip-c off" title="${'ladder lane: never measured'}"><input type="checkbox" disabled>${i + 1} M</label>`
      : `<label class="chip-c${st.lanes[i].noMeasure ? ' off' : ''}" title="${esc(st.lanes[i].name || 'well ' + (i + 1))}"><input type="checkbox" data-qm="${i}" ${st.lanes[i].noMeasure ? '' : 'checked'}>${i + 1}</label>`).join('');
    $('qLaneList').querySelectorAll('[data-qm]').forEach(inp => inp.addEventListener('change', done(e => { const l = st.lanes[+inp.dataset.qm]; if (e.target.checked) delete l.noMeasure; else l.noMeasure = true; })));
    const P = plot();
    $('plotType').value = P.type === 'point' ? 'point' : 'bar'; $('plotValues').checked = !!P.values; $('plotRef').checked = P.refLine !== false;
    if (document.activeElement !== $('plotTitle')) $('plotTitle').value = P.title || '';
    if (document.activeElement !== $('plotY')) $('plotY').value = P.ylabel || '';
    const refNow = lanes.includes(q.ref) ? q.ref : lanes[0];
    $('qRef').innerHTML = lanes.map(i => `<option value="${i}"${i === refNow ? ' selected' : ''}>${i + 1}${st.lanes[i].name ? ' · ' + esc(st.lanes[i].name.replace(/\*/g, '')).slice(0, 12) : ''}</option>`).join('');
    const pl = +$('qProfLane').value, plSel = lanes.includes(pl) ? pl : (App.selLane >= 0 && lanes.includes(App.selLane) ? App.selLane : lanes[0]);
    $('qProfLane').innerHTML = lanes.map(i => `<option value="${i}"${i === plSel ? ' selected' : ''}>${'Well'} ${i + 1}${st.lanes[i].name ? ' · ' + esc(st.lanes[i].name.replace(/\*/g, '')).slice(0, 12) : ''}</option>`).join('');
    $('stQuant').textContent = q.rows.length ? `${q.rows.length} band box${q.rows.length > 1 ? 'es' : ''}` : 'band intensities, band sizes';
    $('btnShowQuant').classList.toggle('hidden', shown.quant);
    renderBoxes();
    if (!shown.quant) return;
    if (tab === 'size') { renderSizes(); return; }
    results();
  }
  function results() {
    const st = S();
    if (st.quant.rows.length && G.Quant.quantLanes(App).length) { lastR = G.Quant.measure(App); renderTable(lastR); }
    else { lastR = null; $('quantTable').innerHTML = ''; $('quantChart').innerHTML = ''; }
    $('methodsText').value = lastR ? G.Quant.methodsText(App, lastR) : '';
    $('quantEmpty').classList.toggle('hidden', !!st.quant.rows.length);
    ['btnQCopy', 'btnQCSV', 'btnQChart'].forEach(id => { $(id).disabled = !lastR; });
    if ($('profAdv').open) drawProfile();
  }

  App.on(what => {
    if (!S() || what === 'select' && !shown.quant) return;
    // a band box drawn by the user opens the results: that is what adding one is for
    if (what === 'change' && App.boxAdded) { App.boxAdded = false; if (!shown.quant || view !== 'quant') { setView('quant'); return; } }
    render(what === 'refresh');
  });
  // a loaded gel (example, project, library) opens on its figure, with the analysis window too when it has band boxes
  App.on(what => { if (what === 'loaded' && S()) { App.boxAdded = false; shown.figure = true; shown.quant = S().quant.rows.length > 0; view = 'figure'; refreshChrome(); if (shown.quant) { render(); $('quantDetails').open = true; } } });
  // the current results and chart (measured on demand), for the export routes
  function measured() { if (!lastR && S() && S().quant.rows.length && G.Quant.quantLanes(App).length) lastR = G.Quant.measure(App); return lastR; }
  function chart() { const R = measured(); return R ? G.Quant.chartSVG(App, R) : null; }
  G.QuantUI = { render, setView, show, follow, view: () => view, isShown: p => !!shown[p], results: measured, chart };
})(window);

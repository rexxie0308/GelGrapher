/* Step 7 of the panel: densitometry (band boxes, table, chart, lane profile) and band sizes. */
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
  function setView(v) {
    view = v;
    document.querySelectorAll('#viewSeg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    $('previewBox').classList.toggle('hidden', v !== 'figure'); $('quantView').classList.toggle('hidden', v !== 'quant');
    $('figSub').textContent = v === 'figure' ? 'Click any text to edit it' : 'Measured in every lane of the figure';
    $('figSize').classList.toggle('hidden', v !== 'figure');
    if (v === 'figure') G.UI.updatePreview(); else render();
    G.Editor.draw();   // the raw image shows the layer of this view in front (strips with the figure, band boxes here)
  }
  document.querySelectorAll('#viewSeg button').forEach(b => b.onclick = () => { if (S()) setView(b.dataset.view); });
  $('btnShowQuant').onclick = () => { if (S()) { setView('quant'); } };
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
      <label class="switch" title="${'The other bands in each lane are divided by this one (corrects for unequal loading)'}"><input type="checkbox" data-qc="${k}" ${k === q.control ? 'checked' : ''}>${'Loading control'}</label>
      <button class="x" data-qdel="${k}" title="${'Delete'}">×</button></div>`).join('')
      || `<p class="hint">${'No band boxes yet.'}</p>`;
    $('boxList').querySelectorAll('[data-q]').forEach(inp => {
      const r = q.rows[+inp.dataset.q];
      inp.addEventListener('input', live(e => { r.name = e.target.value; }));
      inp.addEventListener('change', done());
    });
    $('boxList').querySelectorAll('[data-qc]').forEach(inp => inp.addEventListener('change', done(e => { q.control = e.target.checked ? +inp.dataset.qc : -1; })));
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
    const ctlName = R.control >= 0 ? R.rows[R.control].name : null;
    const head = `<tr><th>${'Lane'}</th>${R.rows.map((r, k) => `<th title="${'Integrated density (a.u.)'}">${esc(r.name)}${k === R.control ? ' <span class="tag" title="loading control">loading control</span>' : ''}</th>`).join('')}` +
      tg.map(k => `<th title="${esc(ctlName ? `${R.rows[k].name} / ${ctlName}, relative to the reference lane` : 'relative to the reference lane')}">${esc(R.rows[k].name)} ${ctlName ? '/ ' + esc(ctlName) + ', rel.' : 'rel.'}</th>`).join('') + '</tr>';
    const body = R.lanes.map((i, j) => `<tr class="${i === R.ref ? 'ref' : ''}"><td>${esc(R.names[j].replace(/\*/g, ''))}</td>` +
      R.rows.map((r, k) => { const c = R.cells[k][j]; return `<td class="${c.sat ? 'sat' : ''}" title="${c.sat ? `${c.sat} saturated pixels` : ''}">${sig(c.vol)}${c.sat ? ' ⚠' : ''}</td>`; }).join('') +
      tg.map(k => `<td class="relv">${rel(R.rel[k][j])}</td>`).join('') + '</tr>').join('');
    let note = R.saturatedLanes.length ? `<p class="hint warn-t">${`Boxes in well${R.saturatedLanes.length > 1 ? 's' : ''} ${R.saturatedLanes.map(i => i + 1).join(', ')} contain saturated pixels, so their values are underestimated; re-image with a shorter exposure.`}</p>` : '';
    const noRef = tg.filter(k => !R.refOk[k]).map(k => R.rows[k].name);
    if (noRef.length) note += `<p class="hint warn-t">${`The reference lane (well ${R.ref + 1}) has no band in ${noRef.join(', ')}, so no relative values are given for ${noRef.length > 1 ? 'these boxes' : 'this box'} and the chart shows the values themselves. Pick a reference lane with that band in step 7.`}</p>`;
    $('quantTable').innerHTML = `<div class="tscroll"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>` + note;
    const ch = G.Quant.chartSVG(App, R);
    $('quantChart').innerHTML = ch ? ch.svg : '';
    const svg = $('quantChart').querySelector('svg');
    if (svg) { svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.width = '100%'; svg.style.height = 'auto'; }
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
    const ya = Math.max(0, Math.round(st.crop.y)), yb = Math.min(img.h - 1, Math.round(st.crop.y + st.crop.h - 1)), n = yb - ya + 1;
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
      const c = G.Quant.measureBox(App, lane, r, st.quant.bg), w = x1 - x0 + 1;
      if (st.quant.bg !== 'none') {
        const ia = Math.max(0, Math.round(a)), ib = Math.min(n - 1, Math.round(b));
        ctx.strokeStyle = ok; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.lineWidth = 1.2 * dpr;
        const e0 = st.quant.bg === 'edge' ? (p[ia] + p[Math.min(n - 1, ia + 1)]) / 2 : null, e1 = st.quant.bg === 'edge' ? (p[ib] + p[Math.max(0, ib - 1)]) / 2 : null;
        ctx.beginPath();
        if (st.quant.bg === 'edge') { ctx.moveTo(X(ia), Y(e0)); ctx.lineTo(X(ib), Y(e1)); }
        else { const lvl = c.bg / Math.max(1, ib - ia + 1) / w; ctx.moveTo(X(ia), Y(lvl)); ctx.lineTo(X(ib), Y(lvl)); }
        ctx.stroke(); ctx.setLineDash([]);
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
    if (live) { if (view === 'quant' && tab === 'int') results(); return; }
    const q = st.quant, lanes = G.Quant.quantLanes(App);
    $('qBg').value = q.bg; $('qMode').value = q.mode === 'box' ? 'box' : 'band'; $('qW').value = Math.round(q.wFrac * 100); widthLabel();
    const refNow = lanes.includes(q.ref) ? q.ref : lanes[0];
    $('qRef').innerHTML = lanes.map(i => `<option value="${i}"${i === refNow ? ' selected' : ''}>${i + 1}${st.lanes[i].name ? ' · ' + esc(st.lanes[i].name.replace(/\*/g, '')).slice(0, 12) : ''}</option>`).join('');
    const pl = +$('qProfLane').value, plSel = lanes.includes(pl) ? pl : (App.selLane >= 0 && lanes.includes(App.selLane) ? App.selLane : lanes[0]);
    $('qProfLane').innerHTML = lanes.map(i => `<option value="${i}"${i === plSel ? ' selected' : ''}>${'Well'} ${i + 1}${st.lanes[i].name ? ' · ' + esc(st.lanes[i].name.replace(/\*/g, '')).slice(0, 12) : ''}</option>`).join('');
    $('stQuant').textContent = q.rows.length ? `${q.rows.length} band box${q.rows.length > 1 ? 'es' : ''}` : 'band intensities, band sizes';
    $('btnShowQuant').classList.toggle('hidden', view === 'quant');
    renderBoxes();
    if (view !== 'quant') return;
    if (tab === 'size') { renderSizes(); return; }
    results();
  }
  function results() {
    const st = S();
    if (st.quant.rows.length && G.Quant.quantLanes(App).length) { lastR = G.Quant.measure(App); renderTable(lastR); }
    else { lastR = null; $('quantTable').innerHTML = ''; $('quantChart').innerHTML = ''; }
    $('quantEmpty').classList.toggle('hidden', !!st.quant.rows.length);
    ['btnQCopy', 'btnQCSV', 'btnQChart'].forEach(id => { $(id).disabled = !lastR; });
    if ($('profAdv').open) drawProfile();
  }

  App.on(what => {
    if (!S() || what === 'select' && view !== 'quant') return;
    // a band box drawn by the user opens the results: that is what adding one is for
    if (what === 'change' && App.boxAdded) { App.boxAdded = false; if (view !== 'quant') { setView('quant'); return; } }
    render(what === 'refresh');
  });
  // a loaded gel (example, project, library) opens on its figure
  App.on(what => { if (what === 'loaded' && S()) { App.boxAdded = false; if (view !== 'figure') setView('figure'); if (S().quant.rows.length) $('quantDetails').open = true; } });
  G.QuantUI = { render, setView, view: () => view };
})(window);

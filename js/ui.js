/* UI: panel sections, top bar, coach line, live preview. Direct editing on the figure lives in figedit.js. */
(function (G) {
  'use strict';
  const App = G.App, E = G.Engine;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const toSlider = v => Math.round(Math.sqrt(Math.max(0, Math.min(1, v))) * 1000);
  const fromSlider = s => (s / 1000) ** 2;
  const pct = v => (v * 100).toFixed(v < 0.1 ? 3 : 2) + '%';
  const S = () => App.S;
  const live = fn => e => { if (!S()) return; fn(e); App.refresh(); };
  const done = fn => e => { if (!S()) return; if (fn) fn(e); App.commit(); };
  const list = a => a.join(', ');

  /* ---------- toasts / warnings ---------- */
  function toast(msg, ms) {
    const el = document.createElement('div');
    el.className = 'toast'; el.textContent = msg;
    $('toasts').appendChild(el);
    setTimeout(() => { el.style.transition = '.25s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 260); }, ms || 2400);
  }
  const dismissed = new Set();
  function showWarnings(items) {
    const box = $('warnings');
    box.innerHTML = '';
    (items || []).filter(w => !dismissed.has(w)).slice(0, 3).forEach(w => {
      const d = document.createElement('div');
      d.innerHTML = `<span>⚠ ${esc(w)}</span>`;
      const x = document.createElement('button'); x.textContent = '×'; x.title = 'Dismiss';
      x.onclick = () => { dismissed.add(w); d.remove(); };
      d.appendChild(x); box.appendChild(d);
    });
  }

  /* ---------- in-page dialogs (alert / confirm are not available in every host) ---------- */
  let askQueue = Promise.resolve();
  function ask(html, opts) {
    opts = opts || {};
    // self-tests answer without showing the dialog
    if (UI.autoConfirm != null && opts.confirm) return Promise.resolve(!!UI.autoConfirm);
    const run = () => new Promise(resolve => {
      $('askText').innerHTML = html;
      $('askYes').textContent = opts.ok || 'OK';
      $('askYes').classList.toggle('danger-btn', !!opts.danger);
      $('askNo').classList.toggle('hidden', !opts.confirm);
      $('askNo').textContent = 'Cancel';
      $('askDlg').classList.remove('hidden');
      const done = v => { $('askDlg').classList.add('hidden'); window.removeEventListener('keydown', key, true); resolve(v); };
      const key = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); } else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); done(true); } };
      window.addEventListener('keydown', key, true);
      $('askYes').onclick = () => done(true);
      $('askNo').onclick = () => done(false);
      setTimeout(() => $('askYes').focus(), 0);
    });
    const p = askQueue.then(run);
    askQueue = p.catch(() => {});
    return p;
  }
  const textHtml = t => esc(t).replace(/\n/g, '<br>');
  const alertDlg = msg => ask(textHtml(msg), {});
  const confirmDlg = (msg, ok, danger) => ask(textHtml(msg), { confirm: true, ok: ok || 'Continue', danger });
  const UI = { autoConfirm: null };

  /* ---------- helpers ---------- */
  const range = () => (S() && App.laneRange()) || null;
  // lanes that appear in the figure, left to right
  const figLanes = () => { const r = range(); if (!r) return []; const out = []; for (let i = r[0]; i <= r[1]; i++) if (!S().lanes[i].hidden) out.push(i); return out; };
  const isMarkerLane = i => S().markers.some(m => m.lane === i);
  App.afterRangeChange = function () {
    const r = range();
    const vis = r ? S().markers.filter(m => m.lane >= r[0] && m.lane <= r[1]) : [];
    if (!vis.length) App.autoMarkers(); else App.matchMarkers(false);
  };

  /* ---------- loading ---------- */
  // files: FileList / array. A .gelfig opens a project; several images = several exposures
  async function load(files, gelType) {
    files = [...(files.length != null ? files : [files])];
    if (!files.length) return;
    // a .zip (as saved from a Claude artifact) is unpacked first
    const zips = files.filter(f => /\.zip$/i.test(f.name));
    if (zips.length) {
      try {
        const inner = [];
        for (const z of zips) (await G.Zip.read(await z.arrayBuffer())).forEach(e => inner.push(new File([e.data], e.name)));
        files = files.filter(f => !zips.includes(f)).concat(inner.filter(f => /\.(gelfig|tiff?|png|jpe?g|bmp)$/i.test(f.name)));
      } catch (e) { alertDlg('Could not open the ZIP: ' + e.message); return; }
      if (!files.length) { alertDlg('The ZIP contains no image or project file'); return; }
    }
    const proj = files.find(f => /\.gelfig$/i.test(f.name));
    if (proj) return openProject(proj);
    await App.load(files.length > 1 ? files : files[0], gelType);
    if (!S()) return;
    const r = range(), n = r ? r[1] - r[0] + 1 : 0, nw = S().lanes.length, nm = S().markers.length;
    let msg = `Detected ${nw} wells, ${n} lanes in the figure` + (nm ? `, ${nm} marker${nm > 1 ? 's' : ''}` : ', no marker found');
    if (App.rowCount() > 1) msg = `${App.rowCount()} rows of wells on this gel; showing row 1 (switch under "Lanes in figure"). ` + msg;
    if (App.exposures) {
      const e = App.exposures[App.expIdx], c = (e.clipFrac * 100).toFixed(2);
      msg = `Picked ${e.name} of ${App.exposures.length} exposures (${c}% saturated). ` + msg;
    }
    toast(msg, 4200);
    (App.loadWarnings || []).forEach(w => toast(w, 5200));
    if (App.ladderNotice) toast(App.ladderNotice, 5200);
    if (Math.abs(S().rotation) >= App.AUTO_ROT_LIMIT - 0.3) toast(`Auto-straightening reached its ±${App.AUTO_ROT_LIMIT}° limit; please check the angle`, 5200);
  }
  async function openProject(f) {
    if (/\.zip$/i.test(f.name)) return load([f]);
    try { App.busy(true, 'Opening project…'); await App.openProject(await f.arrayBuffer()); toast('Project opened'); }
    catch (e) { alertDlg('Could not open the project: ' + e.message); } finally { App.busy(false); }
  }
  App.onDropFile = f => load([f]);
  function bindFile(id) { $(id).addEventListener('change', e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) load(fs); }); }
  bindFile('fileInput'); bindFile('fileInput2'); bindFile('fileInput3');
  $('projInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openProject(f); });
  $('imgChip').onclick = () => $('fileInput').click();
  const demoFile = () => new File([G.Demo.encodeTiff16(G.Demo.makeGel())], 'demo_gel.tif', { type: 'image/tiff' });
  /* ---------- examples: synthetic gels, filled in the way a finished figure would be ---------- */
  const EXAMPLE_NAMES = { dna: 'example_DNA_agarose.tif', sds: 'example_SDS-PAGE_Coomassie.tif', western: 'example_Western_p53.tif' };
  async function loadExample(kind) {
    App.busy(true, 'Building the example…');
    await new Promise(r => setTimeout(r, 30));
    // the tutorial's practice gel has no saturated band, so the figure made in it passes the pre-flight check
    const g = G.Demo.makeGel({ preset: kind, clean: !!(G.Tour && G.Tour.mode() === 'tutorial') });
    await App.load({ name: EXAMPLE_NAMES[kind], buffer: G.Demo.encodeTiff16(g) }, g.truth.gelType);
    if (!S()) return;
    App.isExample = kind;
    const st = S(), fl = figLanes();
    if (kind === 'dna') {
      const names = ['M', 'WT', 'WT', 'KO-1', 'NTC', '*lacZ*-1', '*lacZ*-2', 'pUC19', 'pUC19', 'Clone A', 'Clone B'];
      fl.forEach((li, k) => { st.lanes[li].name = names[k] || ''; });
      st.groups = [{ from: fl[1], to: fl[3], text: 'Genotyping' }, { from: fl[5], to: fl[8], text: 'Plasmid' }];
      const b = st.markers[0] && st.markers[0].bands.find(x => x.bp === 1500);
      st.arrows = b ? [{ y: b.y, text: 'Product', size: true, side: '' }] : [];
    } else {
      fl.forEach((li, k) => { if (g.truth.names[k] != null) st.lanes[li].name = g.truth.names[k]; });
      const yOf = g.truth.yOf;
      if (kind === 'sds') {
        st.groups = [{ from: fl[4], to: fl[8], text: 'Ni-NTA' }];
        const y = App.snapBandY(st.lanes[fl[6]].x, yOf(45));
        st.arrows = y != null ? [{ y, text: 'His-MBP', size: true, side: '' }] : [];
      } else {
        st.groups = [{ from: fl[1], to: fl[fl.length - 1], text: 'Doxorubicin' }];
        const mid = st.lanes[fl[Math.floor(fl.length / 2)]].x;
        const t = G.Quant.bandBox(App, mid, yOf(g.truth.target.size)), c = G.Quant.bandBox(App, mid, yOf(g.truth.control.size));
        st.quant.rows = [{ y0: t.y0, y1: t.y1, name: g.truth.target.name }, { y0: c.y0, y1: c.y1, name: g.truth.control.name }];
        st.quant.control = 1; st.quant.ref = fl[1];
        const ty = (t.y0 + t.y1) / 2, cy = (c.y0 + c.y1) / 2;
        st.strips = [{ y0: ty - 58, y1: ty + 26, label: g.truth.target.name }, { y0: cy - 24, y1: cy + 24, label: g.truth.control.name }];
        st.markers.forEach(m => App.thinMarkerLabels(m, false));
        $('quantDetails').open = true;
      }
    }
    App.commit();
    toast('This is a synthetic example; drop your own image to start', 4200);
  }
  G.UI_loadExample = loadExample;
  document.querySelectorAll('[data-example]').forEach(b => { b.onclick = () => loadExample(b.dataset.example); });
  // drop anywhere in the window
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { dragDepth++; document.body.classList.add('dragging'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove('dragging'); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging');
    if (e.dataTransfer.files.length) load(e.dataTransfer.files);
  });

  /* ---------- draft restore (offered on the start screen) ---------- */
  /* ---------- library: the gels kept in this browser ---------- */
  const ago = t => { const m = (Date.now() - t) / 60000; if (m < 1) return 'just now'; if (m < 60) return `${Math.round(m)} min ago`; if (m < 36 * 60) return `${Math.round(m / 60)} h ago`; const d = new Date(t); return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : ''); };
  const fmtMB = n => n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' kB';
  function libCard(e) {
    const cur = S() && S().file && S().file.sha256 === e.sha256, type = G.Gels.get(e.gelType);
    return `<div class="lib-card${cur ? ' on' : ''}" data-sha="${e.sha256}" role="button" tabindex="0" title="${cur ? 'Open now' : 'Open this gel as you left it'}">
      ${e.thumb ? `<img src="${e.thumb}" alt="">` : '<div class="noimg">▣</div>'}
      <input class="lib-title" value="${esc(e.title || '')}" placeholder="${esc(e.name)}" title="Click to rename" spellcheck="false">
      <div class="lib-meta">${esc(type ? type.name() : '')}${e.lanes ? ` · ${e.lanes} wells` : ''}${e.size ? ` · ${fmtMB(e.size)}` : ''}</div>
      <div class="lib-meta">${cur ? '<span class="lib-now">Open now</span> · saved ' : 'Edited '}${ago(e.savedAt)}</div>
      <button class="x" title="Remove from the library">×</button></div>`;
  }
  async function renderLibrary() {
    let list = [];
    try { list = await App.library.list(); } catch (e) { list = []; }
    const total = list.reduce((a, e) => a + (e.size || 0), 0), note = list.length ? `${list.length} ${list.length === 1 ? 'gel' : 'gels'} · ${fmtMB(total)} in this browser` : '';
    $('libNote').textContent = note; $('libNote2').textContent = note;
    $('btnLibClear').classList.toggle('hidden', !list.length);
    const html = list.length ? list.map(libCard).join('') : '<div class="lib-empty">No gels yet. Open an image and it is kept here with your edits.</div>';
    $('libGrid').innerHTML = list.length ? list.map(libCard).join('') : ''; $('libGrid2').innerHTML = html;
    $('libBox').classList.toggle('hidden', !list.length || !!S());
    for (const grid of [$('libGrid'), $('libGrid2')]) grid.querySelectorAll('.lib-card').forEach(card => {
      const sha = card.dataset.sha, title = card.querySelector('.lib-title');
      const open = async () => {
        if (S() && S().file && S().file.sha256 === sha) { $('libDlg').classList.add('hidden'); return; }
        try { App.busy(true, 'Opening…'); await App.library.open(sha); $('libDlg').classList.add('hidden'); toast('Opened as you left it'); }
        catch (e) { alertDlg('Could not open: ' + e.message); } finally { App.busy(false); }
      };
      card.addEventListener('click', e => { if (e.target === title || e.target.classList.contains('x')) return; open(); });
      card.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === card) { e.preventDefault(); open(); } });
      title.addEventListener('change', () => App.library.rename(sha, title.value.trim()));
      title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); title.blur(); } e.stopPropagation(); });
      card.querySelector('.x').onclick = async e => {
        e.stopPropagation();
        if (!(await confirmDlg(`Remove “${title.value.trim() || card.querySelector('.lib-title').placeholder}” from the library? The image and its edits are deleted from this browser (a saved project file is not affected).`, 'Remove', true))) return;
        await App.library.remove(sha); renderLibrary();
      };
    });
  }
  $('btnLibrary').onclick = async () => { await renderLibrary(); $('libDlg').classList.remove('hidden'); };
  $('btnLibClose').onclick = () => $('libDlg').classList.add('hidden');
  $('libDlg').addEventListener('click', e => { if (e.target === $('libDlg')) $('libDlg').classList.add('hidden'); });
  $('btnLibClear').onclick = async () => {
    if (!(await confirmDlg('Remove every gel from the library? Their images and edits are deleted from this browser. Saved project files are not affected.', 'Remove all', true))) return;
    await App.library.clear(); renderLibrary();
  };
  let libRenderTimer = 0;
  App.on(what => { if (what === 'library' && !$('libDlg').classList.contains('hidden')) { clearTimeout(libRenderTimer); libRenderTimer = setTimeout(renderLibrary, 300); } });

  /* ---------- exposures strip ---------- */
  function renderExposures() {
    const ex = App.exposures, box = $('expoStrip');
    if (!ex || ex.length < 2) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const best = Math.max(...ex.map(e => e.score));
    box.innerHTML = ex.map((e, k) => {
      const sc = (e.score * 100).toFixed(0), c = (e.clipFrac * 100).toFixed(2);
      return `<div class="expo-item${k === App.expIdx ? ' on' : ''}" data-k="${k}" title="${esc(e.name)}\n${`score ${sc} · SNR ${e.snr.toFixed(0)} · saturated ${c}%`}">
      <img src="${e.thumb}" alt="">
      ${e.score === best ? `<span class="best">${'Best'}</span> · ` : ''}${`score ${sc}`}<br>
      <span class="${e.clipFrac > 0.0005 ? 'clip' : ''}">${'sat.'} ${c}%</span></div>`;
    }).join('');
    box.querySelectorAll('.expo-item').forEach(el => el.onclick = async () => {
      const r = await App.switchExposure(+el.dataset.k);
      if (r.kept) toast(`Switched to ${S().file.name}; all annotations kept`);
      else if (r.namesCarried) toast('This image has a different size and was re-detected; lane names were carried over in order — please check');
      else if (r.kept === false) toast('This image is framed differently and was re-detected; annotations were not carried over', 4200);
    });
  }

  /* ---------- top bar ---------- */
  $('btnUndo').onclick = () => App.undo();
  $('btnRedo').onclick = () => App.redo();
  $('btnHelp').onclick = () => $('helpDlg').classList.remove('hidden');
  $('btnTour').onclick = () => { $('helpDlg').classList.add('hidden'); G.Tour.start('tour'); };
  $('btnTutorial').onclick = () => { $('helpDlg').classList.add('hidden'); G.Tour.start('tutorial'); };
  $('btnGuide').onclick = () => G.Tour.start('tutorial');
  $('btnHelpClose').onclick = () => $('helpDlg').classList.add('hidden');
  function menu(btn, m) {
    $(btn).onclick = e => { e.stopPropagation(); document.querySelectorAll('.menu').forEach(x => { if (x.id !== m) x.classList.add('hidden'); }); $(m).classList.toggle('hidden'); };
  }
  menu('btnTplMenu', 'tplMenu'); menu('btnExportMenu', 'exportMenu');
  document.addEventListener('click', () => document.querySelectorAll('.menu').forEach(x => x.classList.add('hidden')));
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? App.redo() : App.undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); App.redo(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p' && S()) { e.preventDefault(); printFigure(); }
    if (e.key === 'Escape') { $('helpDlg').classList.add('hidden'); $('libDlg').classList.add('hidden'); }
  });
  const baseName = () => (S() ? S().file.name.replace(/\.[^.]+$/, '') : 'gel');
  $('dpiTop').addEventListener('change', done(e => { S().style.dpi = +e.target.value; }));
  const needImage = () => { if (S()) return false; toast('Open a gel image first'); return true; };

  /* ---------- export (with pre-flight) ---------- */
  $('preflightOn').checked = App.prefs().preflight !== false;
  $('preflightOn').addEventListener('change', e => App.setPref('preflight', e.target.checked));
  // the legend notes under the figure, in exports and prints, only when asked for (off by default)
  $('notesOn').checked = !!App.prefs().legendNotes;
  $('notesOn').addEventListener('change', e => App.setPref('legendNotes', e.target.checked));
  const figForExport = () => { const f = App.buildFigure(false); return App.prefs().legendNotes ? G.Render.withNotes(f, G.Export.legendHints(S()).join(' '), S().style.fontPt) : f; };
  // resolves true = go ahead, false = user went back to fix
  function preflight() {
    return new Promise(resolve => {
      if (App.prefs().preflight === false) return resolve(true);
      const items = App.preflight(), serious = items.filter(i => i.level === 'block' || i.level === 'warn');
      if (!serious.length) return resolve(true);
      const lab = { block: 'Fix', warn: 'Warning', info: 'Note' };
      const box = $('pfList');
      box.innerHTML = items.map((it, k) => `<div class="pf-item"><span class="lv ${it.level}">${lab[it.level]}</span><span class="tx">${esc(it.text)}</span>${it.fix ? `<button class="btn sm" data-fix="${k}">${esc(it.fix.label)}</button>` : ''}</div>`).join('');
      box.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => { items[+b.dataset.fix].fix.run(); App.commit(); b.disabled = true; b.textContent = 'Fixed'; });
      $('pfOff').checked = false;
      $('preflightDlg').classList.remove('hidden');
      const close = ok => { $('preflightDlg').classList.add('hidden'); if ($('pfOff').checked) { App.setPref('preflight', false); $('preflightOn').checked = false; } resolve(ok); };
      $('pfBack').onclick = () => close(false);
      $('pfGo').onclick = () => close(true);
    });
  }
  // toast only for files the viewer actually kept
  const saved = (status, msg) => { if (status === 'saved') toast(msg); };
  async function exportFigure(kind) {
    if (needImage()) return;
    if (!(await preflight())) return;
    App.busy(true, 'Exporting…');
    try {
      const f = figForExport(), dpi = S().style.dpi, eff = Math.round(App.effectiveDpi());
      if (kind === 'pdf') {
        const r = await G.Export.exportPDF(f.svg, `${baseName()}_figure.pdf`, S());
        if (r.missing.length) alertDlg(`The PDF uses the standard PDF fonts, which cannot show these characters (written as "?"): ${r.missing.join(' ')}. Use SVG or PNG for them.`);
        saved(r.status, 'Exported vector PDF');
        return;
      }
      if (kind === 'pptx') {
        saved(await G.Export.exportPPTX(f.svg, `${baseName()}_figure.pptx`, S(), { crop: App._lastCrop, gel: App._lastGel }), 'Exported an editable PowerPoint slide');
        return;
      }
      const fmt = kind === 'tiff' ? 'TIFF' : 'PNG';
      const st = kind === 'tiff' ? await G.Export.exportTIFF(f.svg, f.w, f.h, dpi, `${baseName()}_figure_${dpi}dpi.tif`, S())
        : await G.Export.exportPNG(f.svg, f.w, f.h, dpi, `${baseName()}_figure_${dpi}dpi.png`, S());
      saved(st, `Exported ${dpi} dpi ${fmt}` + (eff < dpi ? ` (the gel itself is ${eff} dpi)` : ''));
    } catch (e) { alertDlg(e.message); } finally { App.busy(false); }
  }
  $('btnPNGItem').onclick = () => exportFigure('png');
  $('btnFigExport').onclick = () => exportFigure($('figFmt').value);
  /* ---------- print (for a lab notebook) ----------
   * A page with the figure at a readable size and a caption: file, experiment, date, the legend notes. Printed from a
   * hidden frame of this page, so nothing leaves the browser. The artifact viewer cannot print: there the same page is
   * saved as a vector PDF to print. */
  function printHtml() {
    const f = figForExport(), wmm = f.w / G.Render.MM, shown = Math.min(180, Math.max(wmm, 120));
    const gt = App.gelType(), cap = [baseName(), typeof gt.name === 'function' ? gt.name() : gt.name, new Date().toISOString().slice(0, 10), `figure ${wmm.toFixed(0)} mm wide at ${S().style.dpi} dpi`, `${App.NAME} ${App.VERSION}`];
    return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(baseName())}</title><style>@page{margin:15mm}body{margin:0;font:9pt -apple-system,Segoe UI,Arial,sans-serif;color:#000}img{display:block;width:${shown.toFixed(1)}mm;max-width:100%}p{margin:3mm 0 0;max-width:180mm}</style></head><body><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.svg)}"><p>${esc(cap.join(' · '))}</p></body></html>`;
  }
  async function printFigure() {
    if (needImage()) return;
    if (G.Host.inClaude()) {
      App.busy(true, 'Preparing a PDF…');
      try {
        const f = figForExport(), r = await G.Export.exportPDF(f.svg, `${baseName()}_figure.pdf`, S());
        saved(r.status, 'Printing is not available inside Claude: the figure was saved as a PDF to print');
      } catch (e) { alertDlg(e.message); } finally { App.busy(false); }
      return;
    }
    const fr = document.createElement('iframe');
    fr.setAttribute('aria-hidden', 'true'); fr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(fr);
    const d = fr.contentDocument; d.open(); d.write(printHtml()); d.close();
    const img = d.querySelector('img');
    await new Promise(r => { if (img.complete) r(); else { img.onload = r; img.onerror = r; } });
    const w = fr.contentWindow; w.focus(); w.print();   // the page's own window cannot print inside the artifact; this frame is used only outside it
    setTimeout(() => fr.remove(), 60000);
  }
  $('btnPrint').onclick = printFigure;
  $('btnPrintMenu').onclick = printFigure;
  $('btnTIFF').onclick = () => exportFigure('tiff');
  $('btnPDF').onclick = () => exportFigure('pdf');
  $('btnPPTX').onclick = () => exportFigure('pptx');
  /* everything in one ZIP: figure, chart, measurements, band sizes, log, methods (the Claude viewer saves ZIPs) */
  async function exportPackage() {
    if (needImage()) return;
    if (!(await preflight())) return;
    App.busy(true, 'Packing…');
    try {
      const f = figForExport(), ch = G.QuantUI ? G.QuantUI.chart() : null;
      const r = await G.Export.packageBlob(S(), baseName(), f, ch, S().style.dpi);
      saved(await G.Export.download(r.blob, baseName() + '_package.zip'), `Exported ${r.files.length} files in one ZIP`);
    } catch (e) { alertDlg(e.message); } finally { App.busy(false); }
  }
  $('btnPNG').onclick = exportPackage;   // the green button: everything in one ZIP
  // copy the figure as a PNG: the quickest way into a slide or a notebook entry
  $('btnCopyFig').onclick = async () => {
    if (needImage()) return;
    App.busy(true, 'Rendering…');
    try {
      const f = figForExport(), dpi = S().style.dpi;
      const c = await G.Export.svgToCanvas(f.svg, f.w, f.h, dpi);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(`Copied a ${dpi} dpi PNG; paste it anywhere`);
    } catch (e) {
      toast('The clipboard is not available here; use Export figure instead', 3600);
    } finally { App.busy(false); }
  };
  $('btnSVG').onclick = async () => { if (needImage() || !(await preflight())) return; saved(await G.Export.exportSVG(figForExport().svg, baseName() + '_figure.svg'), 'Exported SVG'); };
  $('btnUncropped').onclick = async () => { if (needImage()) return; App.renderFull(); saved(await G.Export.exportUncropped(S(), App.fullCanvas, baseName() + '_uncropped_same-processing.png'), 'Exported the uncropped image (same processing as the figure)'); };
  $('btnOriginal').onclick = async () => {
    if (needImage()) return;
    const mk = App.hasMarkerImage() ? { name: S().markerImage.name, sha256: S().markerImage.sha256, buffer: App.markerBuffer } : null;
    saved(await G.Export.exportOriginal(S(), App.srcBuffer, mk), 'Exported the original file' + ' (SHA-256 ' + S().file.sha256.slice(0, 12) + '…)');
  };
  $('btnLog').onclick = async () => { if (needImage()) return; saved(await G.Export.download(new Blob([JSON.stringify(G.Export.processingLog(S()), null, 2)], { type: 'application/json' }), baseName() + '_processing_log.json'), 'Exported the processing log'); };

  /* ---------- project / style files ---------- */
  $('btnSaveProj').onclick = async () => {
    if (needImage()) return;
    const b = await App.projectBlob();
    saved(await G.Export.download(b, baseName() + '.gelfig'), 'Project saved (includes the original image; continue on any computer)');
  };
  $('btnSaveTpl').onclick = async () => { if (!needImage()) saved(await G.Export.download(new Blob([JSON.stringify(App.template(), null, 2)], { type: 'application/json' }), baseName() + '_style.json'), 'Style saved'); };
  $('tplInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || needImage()) return;
    try {
      const t = JSON.parse(await f.text()), chk = App.checkTemplate(t), a = chk.templateLanes, b = chk.figureLanes;
      if (a && a !== b && !(await confirmDlg(`The style has ${a} lanes; the figure currently shows ${b}.\nNames will be applied in order from the first lane and the figure range set to ${a} lanes.`, 'Apply'))) return;
      const r = App.applyTemplate(t);
      toast('Style applied' + (r.importedLadders.length ? `; imported custom ladders: ${list(r.importedLadders)}` : ''));
    } catch (err) { alertDlg('Could not apply the style: ' + err.message); }
  });
  // close: back to the start screen (the library, or the empty workspace)
  async function closeWorkspace() {
    $('sections').classList.add('hidden'); $('emptyState').classList.remove('hidden'); $('btnClose').classList.add('hidden'); $('viewSeg').classList.add('hidden');
    $('imgChipName').textContent = 'Open image'; $('coachText').textContent = 'Drop a gel image into the window to start';
    $('preview').innerHTML = ''; showWarnings([]); dismissed.clear();
    $('floatEd').classList.add('hidden'); $('popover').classList.add('hidden'); $('modeBanner').classList.add('hidden');
    $('btnUndo').disabled = $('btnRedo').disabled = true;
    G.Editor.draw(); $('dropHint').classList.remove('hidden');
    if (G.QuantUI) G.QuantUI.setView('figure');
    await renderLibrary();
  }
  const closeGel = () => { if (!needImage()) App.close(); };
  $('btnClose').onclick = closeGel;
  $('btnClose2').onclick = closeGel;
  $('btnResetAll').onclick = async () => {
    if (needImage()) return;
    if (!(await confirmDlg('Reset everything: rotation, crop, lanes, markers, names, groups, arrows, strips, band boxes and layout go back to how they were right after import.\nThis clears the undo history.', 'Reset', true))) return;
    App.resetAll(); G.Editor.fitCrop(); toast('Back to the state after import');
  };

  /* ---------- experiment type ---------- */
  function fillTypes(sel) {
    sel.innerHTML = G.Gels.TYPES.map(t => `<option value="${t.id}">${esc(t.name())}</option>`).join('');
  }
  function syncTypeHints() {
    const cur = S() ? S().gelType : App.gelType().id;
    ['gelType', 'gelTypeStart'].forEach(id => { const el = $(id); if (!el.options.length) fillTypes(el); el.value = cur; });
    const t = G.Gels.get(cur);
    $('gelTypeHint').textContent = t.hint(); $('gelTypeStartHint').textContent = t.hint();
    $('mkImageBox').classList.toggle('emph', !!t.western);
  }
  $('gelTypeStart').addEventListener('change', e => { App.setPref('gelType', e.target.value); syncTypeHints(); renderFavs(); });
  $('gelType').addEventListener('change', done(e => {
    App.setGelType(e.target.value);
    const n = S().markers.length;
    toast(`Switched to ${App.gelType().name()}; markers re-detected from its ladder library (${n})`, 3600);
    renderFavs();
  }));

  /* ---------- 1 image ---------- */
  document.querySelectorAll('#polSeg button').forEach(b => b.onclick = done(() => { App.setDarkBands(b.dataset.dark === '1'); App.invertInherited = false; }));
  // detection polarity by hand (the auto-detected one can be wrong on a dark tray or a white frame)
  $('btnPolDetect').onclick = () => {
    if (needImage()) return;
    App.busy(true, 'Detecting again…');
    setTimeout(async () => { try { await App.setBright(!S().bright); await App.autoGeometry(); App.afterRangeChange(); App.commit(); G.Editor.fitCrop(); geomSeg(); } finally { App.busy(false); } toast(`Detection reads ${S().bright ? 'bright bands on a dark background' : 'dark bands on a light background'}; lanes, ladders and geometry found again`); }, 20);
  };
  $('lvBlack').addEventListener('input', live(e => { S().levels.black = Math.min(fromSlider(+e.target.value), S().levels.white - 0.0005); $('lvBlackV').textContent = pct(S().levels.black); drawHisto(); updateClipLine(); }));
  $('lvWhite').addEventListener('input', live(e => { S().levels.white = Math.max(fromSlider(+e.target.value), S().levels.black + 0.0005); $('lvWhiteV').textContent = pct(S().levels.white); drawHisto(); updateClipLine(); }));
  $('lvBlack').addEventListener('change', done()); $('lvWhite').addEventListener('change', done());
  // rotation: live while dragging (annotations follow), one commit + band re-check when released
  $('rot').addEventListener('input', live(e => { App.setRotation(+e.target.value); $('rotNum').value = S().rotation; $('rotV').textContent = S().rotation + '°'; G.Editor.setGrid(true); }));
  function commitRotation() {
    G.Editor.setGrid($('showGrid').checked);
    App.afterRotation(); App.commit();
    const d = S().rotation;
    if (Math.abs(d) > App.AUTO_ROT_LIMIT) toast(`Rotation ${d}°: at large angles the image corners are cut off; make sure the crop box stays inside the gel`, 4200);
  }
  $('rot').addEventListener('change', () => { if (S()) commitRotation(); });
  $('rotNum').addEventListener('change', e => { if (!S()) return; App.setRotation(+e.target.value || 0); commitRotation(); });
  $('rotMinus').onclick = () => { if (!S()) return; App.setRotation(S().rotation - 0.5); commitRotation(); };
  $('rotPlus').onclick = () => { if (!S()) return; App.setRotation(S().rotation + 0.5); commitRotation(); };
  $('btnDeskew').onclick = () => {
    if (!S()) return;
    App.busy(true, 'Measuring the angle…');
    setTimeout(() => {
      const a = App.autoDeskew(); App.afterRotation(); App.busy(false); App.commit();
      toast(Math.abs(a) >= App.AUTO_ROT_LIMIT - 0.3
        ? `Auto-straightening hit its limit at ${a}°; the gel may still be tilted — please check`
        : `Straightened to ${a}° (annotations rotated with the image)`, 3600);
    }, 20);
  };
  $('btnResetRot').onclick = () => { if (!S()) return; App.resetRotation(); App.commit(); toast(`Back to the automatic angle ${S().rotation}°`); };
  // geometry: automatic (perspective + lane straightening, recursive), a manual four-corner box, or off
  function geomMode() { const g = S() && S().geom; return g ? g.mode : 'off'; }
  let placing = false;
  function geomSeg() {
    document.querySelectorAll('#geomSeg button').forEach(b => b.classList.toggle('on', b.dataset.geom === (placing ? 'manual' : geomMode())));
    $('geomPlace').classList.toggle('hidden', !placing);
    G.Editor.setCorners(placing);
  }
  // the box is only shown while it is being placed; the image changes on Apply, not on every drag
  function startPlacing() { placing = true; App.pendingCorners = App.geomCornersWork(); geomSeg(); G.Editor.fitCrop(); }
  function stopPlacing() { placing = false; App.pendingCorners = null; geomSeg(); }
  document.querySelectorAll('#geomSeg button').forEach(b => b.onclick = () => {
    if (needImage()) return;
    const m = b.dataset.geom;
    if (m === 'manual') { if (!placing) { startPlacing(); toast('Drag the round corners of the blue box onto the corners of the gel (the square handles slide a side), then click Apply', 6000); } return; }
    stopPlacing();
    if (m === 'auto') {
      App.busy(true, 'Measuring the geometry…');
      setTimeout(async () => {
        if (S().geom && S().geom.mode === 'manual') App.setGeom(null);
        const r = await App.autoGeometry(); App.busy(false);
        if (r.applied) { App.afterGeom(); App.afterRangeChange(); App.commit(); G.Editor.fitCrop(); }
        geomSeg(); toast(r.message, 6000);
      }, 20);
    } else if (S().geom) { App.setGeom(null); App.afterGeom(); App.redetectAll(); App.afterRangeChange(); App.commit(); G.Editor.fitCrop(); geomSeg(); toast('Geometry correction off; lanes and markers detected again'); }
    else geomSeg();
  });
  $('btnGeomApply').onclick = () => {
    if (!S() || !placing) return;
    const q = App.pendingCorners;
    App.busy(true, 'Mapping the gel…');
    setTimeout(() => {
      if (S().geom && S().geom.mode === 'auto') App.setGeom(null);
      const ok = App.setGeomCorners(q);
      App.pendingCorners = null;
      if (ok) { App.afterGeom(); App.redetectAll(); App.afterRangeChange(); App.commit(); }
      App.busy(false); stopPlacing(); G.Editor.fitCrop();
      toast(ok ? `Gel mapped to a rectangle: lanes ${S().geom.lanesPct > 0 ? '+' : ''}${S().geom.lanesPct} %, bands ${S().geom.bandsPct > 0 ? '+' : ''}${S().geom.bandsPct} %; lanes and markers detected again` : 'The box is not a convex quadrilateral');
    }, 20);
  };
  $('btnGeomCancel').onclick = () => { stopPlacing(); G.Editor.draw(); };
  // the red box: lanes and markers are detected again once the box has been still for a moment, in
  // a timeout, so grabbing the next side right away is never held up by the previous side's detection
  let cropJob = 0;
  App.onCropStart = () => { cropJob++; };
  App.onCropDone = () => {
    const id = ++cropJob, note = $('rawNote');
    if (note) note.textContent = 'Detecting lanes and markers…';
    setTimeout(() => {
      if (id !== cropJob || !S()) return;
      try {
        // lanes inside the box again (fast); the ladder search (slow) only when the box gained lanes,
        // otherwise the markers there follow their lanes and are only re-fitted
        const c = S().crop, byHand = S().lanes.some(l => l.manual && l.x >= c.x && l.x <= c.x + c.w);
        if (byHand) { App.afterRangeChange(); if (note) note.textContent = 'Lanes placed by hand are kept (Re-detect in box replaces them)'; }
        else {
          const n0 = S().lanes.length;
          App.redetectLanesInCrop();
          if (S().lanes.length > n0) App.relaneMarkers(() => 0); else App.afterRangeChange();
        }
        App.commit();
      } finally { if (note) note.textContent = ''; }
    }, 350);
  };
  G.UI_geomSeg = geomSeg;
  G.UI_placing = () => placing;
  const flipBtn = (id, axis) => { $(id).onclick = () => {
    if (!S()) return;
    App.busy(true, 'Flipping…');
    setTimeout(() => { App.flip(axis); App.busy(false); App.commit(); G.Editor.fitCrop(); toast('Flipped; every annotation followed (Ctrl+Z to undo)'); }, 20);
  }; };
  flipBtn('btnFlipV', 'v'); flipBtn('btnFlipH', 'h');
  $('showGrid').addEventListener('change', e => { G.Editor.setGrid(e.target.checked); });
  $('btnResetLv').onclick = done(() => { App.resetLevels(); toast('Contrast reset (Ctrl+Z to undo)'); });
  $('btnAutoLv').onclick = done(() => App.autoLevels());
  function updateClipLine() {
    if (!S()) return;
    const k = App.clipStats(), bc = App.bandClipFrac();
    const p = v => (v * 100).toFixed(v < 0.001 ? 3 : 2) + '%';
    $('clipLine').innerHTML = `${'Camera saturation'} <span class="${k.sensorFrac > 0.0005 ? 'bad' : 'ok'}">${p(k.sensorFrac)}</span> · ${'Contrast clipping'} <span class="${bc > 0.001 ? 'bad' : 'ok'}">${p(bc)}</span>`;
    $('clipLine').title = `Of ${k.n} pixels in the crop: ${k.sensor} saturated by the camera; clipped by the contrast setting: ${k.high} bright, ${k.low} dark`;
  }
  $('showSat').addEventListener('change', () => G.Editor.draw());
  $('gammaUnlock').addEventListener('change', e => {
    $('gamma').disabled = !e.target.checked;
    if (!e.target.checked && S()) { S().levels.gamma = 1; App.commit(); }
  });
  $('gamma').addEventListener('change', done(e => { S().levels.gamma = E.clamp(+e.target.value || 1, 0.2, 5); }));

  /* ---------- 2 range ---------- */
  function onRange() {
    const a = +$('rangeA').value, b = +$('rangeB').value;
    App.setLaneRange(a, b); App.afterRangeChange(); App.commit(); G.Editor.fitCrop();
  }
  $('rangeA').addEventListener('change', onRange);
  $('rangeB').addEventListener('change', onRange);
  $('btnRangeAuto').onclick = done(() => {
    const r = App.loadedLaneRange();
    if (r) { App.setLaneRange(r[0], r[1]); App.afterRangeChange(); G.Editor.fitCrop(); }
  });
  // rows of wells: one button per row; the stashed rows show how many lanes they have
  function renderRows() {
    const st = S(), n = App.rowCount();
    $('rowBox').classList.toggle('hidden', n < 2);
    if (n < 2) return;
    $('rowSeg').innerHTML = st.gelRows.map((r, k) => {
      const lanes = k === st.gelRow ? st.lanes.length : st.rowStash[k] ? st.rowStash[k].lanes.length : null;
      return `<button data-row="${k}" class="${k === st.gelRow ? 'on' : ''}">Row ${k + 1}${lanes != null ? ` <small>(${lanes} wells)</small>` : ''}</button>`;
    }).join('');
    $('rowSeg').querySelectorAll('[data-row]').forEach(b => b.onclick = () => {
      const k = +b.dataset.row;
      if (k === S().gelRow) return;
      App.busy(true, 'Analysing the row…');
      setTimeout(() => { App.setGelRow(k); App.busy(false); App.commit(); G.Editor.fitCrop(); toast(`Row ${k + 1}: ${S().lanes.length} wells, ${S().markers.length} marker${S().markers.length === 1 ? '' : 's'}`); }, 20);
    });
  }
  $('btnAutoLanes').onclick = done(() => { App.autoLanes(); App.afterRangeChange(); toast(`Detected ${S().lanes.length} wells on the whole gel`); });
  // "+ Add lane": the next click on the raw image places a lane line there (js/editor.js, mode 'lane')
  $('btnAddLane').onclick = () => { if (needImage()) return; G.FigEdit.setMode(App.mode === 'lane' ? null : 'lane'); };
  const relaneMarkers = App.relaneMarkers;
  $('btnRedetectCrop').onclick = done(() => {
    const n = relaneMarkers(() => App.redetectLanesInCrop());
    toast(n ? `Found ${n} lanes in the box` : 'No lanes found in the box; enter the number and click "Space evenly"');
  });
  const evenCrop = done(() => {
    const n = relaneMarkers(() => App.evenLanesInCrop(+$('cropLaneN').value || 0));
    toast(`Spaced ${n} lanes evenly in the box`);
  });
  G.UI_relane = relaneMarkers;
  $('btnEvenCrop').onclick = evenCrop;
  // two selected lanes (Shift+click), dragged onto their lanes: the lanes between them spread evenly
  $('btnSpread').onclick = () => {
    if (needImage()) return;
    const sel = [...App.selLanes];
    if (sel.length !== 2) { toast('Shift+click two lane lines on the image first (e.g. the first and the last of a run), drag them onto their lanes, then click Spread'); return; }
    if (!App.spreadBetween(sel[0], sel[1])) { toast('No lanes between the two selected ones'); return; }
    App.commit(); toast(`Spread the lanes between wells ${Math.min(...sel) + 1} and ${Math.max(...sel) + 1} evenly`);
  };
  $('cropLaneN').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); evenCrop(); } });

  // empty lanes inside the range: suggest cutting them (never done silently)
  const ignoredEmpty = new Set();
  function updateEmptyBar() {
    const st = S(), empt = App.emptyLanes().filter(i => !ignoredEmpty.has(st.file.sha256 + ':' + i));
    $('emptyBar').classList.toggle('hidden', !empt.length);
    if (!empt.length) return;
    const wells = list(empt.map(i => i + 1));
    $('emptyText').innerHTML = `Well${empt.length > 1 ? 's' : ''} <b>${wells}</b> look${empt.length > 1 ? '' : 's'} empty (almost no bands). Removing adds a splice gap and is recorded in the processing log.`;
    $('btnCutEmpty').onclick = done(() => { empt.forEach(i => App.setLaneHidden(i, true, 'empty lane (suggested, user confirmed)')); toast(`Removed ${empt.length} empty lane${empt.length > 1 ? 's' : ''} (Ctrl+Z to undo)`); });
    $('btnIgnoreEmpty').onclick = () => { empt.forEach(i => ignoredEmpty.add(st.file.sha256 + ':' + i)); updateEmptyBar(); };
  }
  // cutting a marker lane removes the size reference: always ask. Resolves true when changed.
  async function toggleLaneHidden(i, hidden) {
    if (hidden && isMarkerLane(i) && !(await confirmDlg(`Well ${i + 1} is a marker lane; removing it leaves the figure without a size reference.`, 'Remove', true))) return false;
    App.setLaneHidden(i, hidden, 'manual');
    return true;
  }
  App.toggleLaneHidden = toggleLaneHidden;
  $('spliceGap').addEventListener('input', live(e => { S().style.spliceGapPt = +e.target.value; $('spliceGapV').textContent = e.target.value + ' pt'; }));
  $('spliceGap').addEventListener('change', done());

  /* ---------- lane names pasted as a row (step 2) ---------- */
  function applyBulk() {
    const raw = $('laneBulk').value.replace(/\r/g, '').trim();
    if (!raw) return;
    let names = raw.includes('\t') ? raw.split(/\t|\n/) : raw.includes('\n') ? raw.split('\n') : raw.split(/[,，;；]/);
    names = names.map(s => s.trim());
    let lanes = figLanes();
    // more names than lanes in the figure: widen the range to the right
    if (names.length > lanes.length) {
      const r = range(), extra = names.length - lanes.length;
      if (r && r[1] + extra < S().lanes.length) {
        App.setLaneRange(r[0], r[1] + extra); lanes = figLanes();
        toast(`${names.length} names given: the figure range was extended by ${extra} well${extra > 1 ? 's' : ''} to the right`);
      }
    }
    lanes.forEach((li, k) => { if (k < names.length) S().lanes[li].name = names[k]; });
    $('laneBulk').value = '';
    App.commit();
    const n = Math.min(names.length, lanes.length);
    toast(`Filled in ${n} lane name${n > 1 ? 's' : ''}`);
  }
  $('laneBulk').addEventListener('change', applyBulk);
  $('laneBulk').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); applyBulk(); } });

  /* ---------- 3 markers ---------- */
  $('btnAutoMarkers').onclick = done(() => {
    App.autoMarkers();
    const n = S().markers.length;
    toast(n ? `Found ${n} marker lane${n > 1 ? 's' : ''}` : 'No clear marker lane in the figure range');
  });
  $('btnAddMarker').onclick = done(() => {
    const used = new Set(S().markers.map(m => m.lane));
    const cand = figLanes().filter(i => !used.has(i));
    const sel = App.selLane >= 0 && !used.has(App.selLane) ? App.selLane : cand[0];
    if (sel == null) { toast('No free lane in the figure range'); return; }
    S().markers.push(App.newMarker(sel, (S().markers[0] || {}).ladderId));
    S().markers.sort((a, b) => a.lane - b.lane);
    if (!S().lanes[sel].name) S().lanes[sel].name = 'M';
    App.matchMarkers(true);
  });
  /* Western marker image: white-light picture of the same membrane, same position */
  $('btnMarkerImg').onclick = () => { if (!needImage()) $('markerInput').click(); };
  $('markerInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !S()) return;
    App.busy(true, 'Reading the marker image…');
    await new Promise(r => setTimeout(r, 30));
    try {
      const input = await App.readInput(f);
      App.setMarkerImage(input);
      const prev = S().markers.map(m => ({ lane: m.lane, ladderId: m.ladderId }));
      App.autoMarkers();
      if (!S().markers.length && prev.length) { S().markers = prev.map(m => App.newMarker(m.lane, m.ladderId)); App.matchMarkers(true); }
      App.commit();
      const n = S().markers.length;
      toast(n ? `Found ${n} marker lane${n > 1 ? 's' : ''} on the marker image`
        : 'No clear ladder lane on the marker image; add the marker lane in step 3', 4200);
    } catch (err) { alertDlg(err.message); } finally { App.busy(false); }
  });
  $('btnMarkerImgDel').onclick = done(() => { App.clearMarkerImage(); App.matchMarkers(false); toast('Marker image removed; marker bands are read from the blot itself again'); });
  $('mkOverlay').addEventListener('change', () => G.Editor.draw());

  $('btnSaveLadder').onclick = () => {
    const name = $('customName').value.trim();
    const sizes = $('customSizes').value.split(/[,，\s]+/).map(Number).filter(v => v > 0);
    if (!name || sizes.length < 2) { alertDlg('Enter a name and at least 2 band sizes'); return; }
    const lad = G.Ladders.saveCustom(name, sizes, App.kind());
    if (!G.Ladders.isFavorite(lad.id)) G.Ladders.toggleFavorite(lad.id);   // new custom ladders start as favourites
    if (S() && S().markers.length) { S().markers[0].ladderId = lad.id; App.matchMarkers(true); App.commit(); }
    renderFavs();
    toast('Custom ladder saved (added to favourites)');
  };
  /* favourites: biased first in auto-detection, listed first in menus */
  $('onlyFav').checked = !!App.prefs().onlyFavLadders;
  $('onlyFav').addEventListener('change', e => {
    App.setPref('onlyFavLadders', e.target.checked);
    toast(e.target.checked ? 'Detection now picks from favourites only (falls back to all ladders if none fits)'
      : 'Detection picks from all ladders (favourites slightly preferred)');
  });
  function renderFavs() {
    const kind = App.kind(), favs = G.Ladders.favorites(kind), u = G.Ladders.KIND_UNIT[kind];
    $('favNote').textContent = favs.length ? `${favs.length}` : 'none';
    const eg = { bp: '5000,3000,2000,1000,500', nt: '6000,4000,3000,2000,1000,500', kDa: '250,130,100,70,55,35,25,15,10' }[u];
    $('customSizes').placeholder = `Band sizes in ${u}, comma separated: ${eg}`;
    $('favList').innerHTML = G.Ladders.all(kind).map(l => `<div class="item"><button class="star${G.Ladders.isFavorite(l.id) ? '' : ' off'}" data-fav="${l.id}" title="${'Add to / remove from favourites'}">★</button><span style="flex:1">${esc(l.name)}</span></div>`).join('');
    $('favList').querySelectorAll('[data-fav]').forEach(b => b.onclick = () => { G.Ladders.toggleFavorite(b.dataset.fav); renderFavs(); if (S()) renderMarkers(); });
    const custom = G.Ladders.all(kind).filter(l => l.custom);
    $('customList').innerHTML = custom.map(l => `<div class="item"><span style="flex:1">${esc(l.name)} <span class="h3-note">${`${l.sizes.length} bands`}</span></span><button class="x" data-cdel="${l.id}" title="${'Delete'}">×</button></div>`).join('');
    $('customList').querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
      const used = S() && S().markers.some(m => m.ladderId === b.dataset.cdel);
      if (used) { toast('This ladder is in use; choose another ladder for the marker first'); return; }
      if (!(await confirmDlg('Delete this custom ladder?', 'Delete', true))) return;
      G.Ladders.removeCustom(b.dataset.cdel); renderFavs(); if (S()) renderMarkers();
    });
  }
  renderFavs();
  function laneOpt(i, sel) { const l = S().lanes[i]; return `<option value="${i}"${i === sel ? ' selected' : ''}>${i + 1}${l.name ? ' · ' + esc(l.name.replace(/\*/g, '')).slice(0, 10) : ''}</option>`; }
  function renderMarkers() {
    const st = S(), kind = App.kind(), r = range(), unit = App.baseUnit();
    const all = G.Ladders.ordered(kind);
    // a ladder of another kind still in use stays selectable (e.g. right after switching the type)
    st.markers.forEach(m => { const l = G.Ladders.get(m.ladderId); if (l && !all.includes(l)) all.push(l); });
    // every commit rebuilds the cards; keep each open band list open, at the same scroll, so several bands can be ticked in a row
    const wasOpen = {};
    $('markerList').querySelectorAll('.mk-card').forEach(card => {
      const d = card.querySelector('details'), lane = (st.markers[+card.dataset.mi] || {}).lane;
      if (d && d.open && lane != null) wasOpen[lane] = card.querySelector('.list').scrollTop;
    });
    $('markerList').innerHTML = st.markers.map((m, mi) => {
      const sc = m.score != null ? Math.round(m.score * 100) : null;
      const out = !r || m.lane < r[0] || m.lane > r[1];
      const shown = m.bands.filter(b => b.show).length;
      return `<div class="mk-card${out ? ' out' : ''}" data-mi="${mi}">
        <div class="mk-head"><span class="mk-badge">${'Well'} ${m.lane + 1}</span>
          ${out ? `<span class="h3-note">${'outside the figure'}</span>` : sc != null ? `<span class="mk-score${sc < 60 ? ' low' : ''}">${sc < 60 ? 'Poor fit — check the ladder' : 'Fit ' + sc + '%'}</span>` : ''}
          <button class="star${G.Ladders.isFavorite(m.ladderId) ? '' : ' off'}" data-f="fav" title="${'Add this ladder to / remove it from favourites (preferred during detection)'}">★</button>
          <button class="x" data-f="del" title="${'Not a marker'}">×</button></div>
        <select data-f="ladder">${all.map(l => `<option value="${l.id}"${l.id === m.ladderId ? ' selected' : ''}>${G.Ladders.isFavorite(l.id) ? '★ ' : ''}${esc(l.name)}</option>`).join('')}</select>
        <div class="row2">
          <select data-f="side"><option value="auto">${'Labels: auto side'}</option><option value="left">${'Labels left'}</option><option value="right">${'Labels right'}</option></select>
          <select data-f="unit">${G.Ladders.unitsFor(kind).concat(G.Ladders.unitsFor(kind).includes(m.unit) ? [] : [m.unit]).map(u => `<option value="${u}">${u === 'auto' ? 'bp/kb' : u}</option>`).join('')}</select>
        </div>
        <details class="adv"${m.lane in wasOpen ? ' open' : ''}><summary>${`Bands (${shown}/${m.bands.length} shown)`}</summary>
          <div class="pick">${'Labels:'} <a href="#" data-pickb="all">${'all'}</a> · <a href="#" data-pickb="none">${'none'}</a></div>
          <div class="list">${m.bands.map((b, k) => `<div class="item"><label class="switch"><input type="checkbox" data-band="${k}" ${b.show ? 'checked' : ''}></label>
            <span style="flex:1">${b.bp} ${unit}${b.ref ? ' ★' : ''}</span><span class="tag ${b.manual ? 'man' : b.matched ? 'ok' : ''}">${b.manual ? 'manual' : b.matched ? 'matched' : 'predicted'}</span></div>`).join('')}</div>
          <div class="field inline"><button class="btn sm" data-f="thin">${'Thin labels'}</button><button class="btn sm ghost" data-f="match">${'Re-match'}</button></div>
          <p class="hint">${'A band is wrong? Drag its yellow line on the image to the right place; the others re-fit around it.'}</p>
        </details>
      </div>`;
    }).join('') || `<p class="hint">${App.gelType().western
      ? 'No marker in the figure range. If the ladder does not show on the chemiluminescence image, load the white-light marker image below, or mark a lane as the marker and drag its yellow lines onto the bands.'
      : 'No marker in the figure range. Use the button below to mark a lane as the marker.'}</p>`;
    $('markerList').querySelectorAll('.mk-card').forEach(card => {
      const m = st.markers[+card.dataset.mi], q = f => card.querySelector(`[data-f="${f}"]`);
      q('side').value = m.side; q('unit').value = m.unit;
      if (m.lane in wasOpen) card.querySelector('.list').scrollTop = wasOpen[m.lane];
      q('ladder').addEventListener('change', done(e => { m.ladderId = e.target.value; m.bands = []; App.prefLadder = m.ladderId; App.matchMarkers(false); }));
      q('side').addEventListener('change', done(e => { m.side = e.target.value; }));
      q('unit').addEventListener('change', done(e => { m.unit = e.target.value; App.prefUnit = m.unit; }));
      q('del').onclick = done(() => { st.markers.splice(+card.dataset.mi, 1); });
      q('fav').onclick = () => { const on = G.Ladders.toggleFavorite(m.ladderId); renderFavs(); renderMarkers(); toast(on ? 'Added to favourites' : 'Removed from favourites'); };
      q('thin').onclick = done(() => { m.bands.forEach(b => { b.show = true; }); App.thinMarkerLabels(m, false); });
      q('match').onclick = done(() => { m.bands = []; App.matchMarkers(false); });
      card.querySelectorAll('[data-band]').forEach(inp => inp.addEventListener('change', done(e => { m.bands[+inp.dataset.band].show = e.target.checked; })));
      card.querySelectorAll('[data-pickb]').forEach(a => a.onclick = e => { e.preventDefault(); m.bands.forEach(b => { b.show = a.dataset.pickb === 'all'; }); App.commit(); });
    });
  }

  /* ---------- lane list (advanced) ---------- */
  function renderLanes() {
    const st = S(), r = range(), empty = new Set(App.emptyLanes());
    const emptyShown = st.lanes.some((l, i) => empty.has(i) && !l.hidden && !isMarkerLane(i) && r && i >= r[0] && i <= r[1]);
    $('laneList').innerHTML = `<div class="pick">${'Show:'} <a href="#" data-pick="all">${'all'}</a>${emptyShown ? ` · <a href="#" data-pick="hideEmpty">${'hide the empty wells'}</a>` : ''}</div>` + st.lanes.map((l, i) => {
      const out = !r || i < r[0] || i > r[1];
      return `<div class="item${App.selLanes.has(i) ? ' sel' : ''}${out ? ' out' : ''}">
        <span class="idx">${i + 1}</span>
        <input type="text" data-i="${i}" value="${esc(l.name)}" placeholder="${isMarkerLane(i) ? 'M' : 'Name'}">
        ${empty.has(i) ? `<span class="tag" title="${'almost no bands'}">${'empty'}</span>` : ''}
        <label class="switch" title="${'Untick = remove from the figure (splice gap added); or select the lane and press H'}"><input type="checkbox" data-h="${i}" ${l.hidden ? '' : 'checked'}>${'Show'}</label>
        <button class="x" data-del="${i}" title="${'Delete this lane (if it was detected by mistake)'}">×</button></div>`;
    }).join('');
    $('laneList').querySelectorAll('input[type=text]').forEach(inp => {
      const i = +inp.dataset.i;
      inp.addEventListener('input', live(e => { st.lanes[i].name = e.target.value; }));
      inp.addEventListener('change', done());
      inp.addEventListener('focus', () => { App.selLane = i; G.Editor.draw(); });
    });
    $('laneList').querySelectorAll('[data-h]').forEach(inp => inp.addEventListener('change', async e => {
      if (await toggleLaneHidden(+inp.dataset.h, !e.target.checked)) App.commit(); else e.target.checked = true;
    }));
    $('laneList').querySelectorAll('[data-del]').forEach(b => b.onclick = done(() => { App.removeLane(+b.dataset.del); App.selLane = -1; toast('Lane deleted (Ctrl+Z to undo)'); }));
    $('laneList').querySelectorAll('[data-pick]').forEach(a => a.onclick = e => {
      e.preventDefault();
      if (a.dataset.pick === 'all') st.lanes.forEach(l => { l.hidden = false; });
      else st.lanes.forEach((l, i) => { if (empty.has(i) && !isMarkerLane(i) && r && i >= r[0] && i <= r[1]) l.hidden = true; });
      App.commit();
    });
    $('laneCountNote').textContent = `${st.lanes.length} wells`;
    if (document.activeElement !== $('cropLaneN')) $('cropLaneN').value = r ? r[1] - r[0] + 1 : '';
    // range selects
    const opts = sel => st.lanes.map((l, i) => laneOpt(i, sel)).join('');
    $('rangeA').innerHTML = opts(r ? r[0] : 0);
    $('rangeB').innerHTML = opts(r ? r[1] : st.lanes.length - 1);
  }

  /* ---------- annotation list ---------- */
  function renderAnno() {
    const st = S(), rows = [];
    st.groups.forEach((g, k) => rows.push(`<div class="item"><span class="kind">${'Group'}</span>
      <span class="idx" style="width:auto">${Math.min(g.from, g.to) + 1}–${Math.max(g.from, g.to) + 1}</span>
      <textarea class="ta" rows="${Math.max(1, g.text.split('\n').length)}" data-g="${k}" placeholder="${'Group label'}" title="Shift+Enter starts a new line">${esc(g.text)}</textarea><button class="x" data-gdel="${k}">×</button></div>`));
    st.arrows.forEach((a, k) => rows.push(`<div class="item${k === App.selArrow ? ' sel' : ''}"><span class="kind">${'Arrow'}</span>
      <button class="btn sm ghost" data-aed="${k}" style="flex:1;justify-content:flex-start">${esc(App.arrowLabel(a) || '(unnamed)')}</button><button class="x" data-adel="${k}">×</button></div>`));
    st.conditions.forEach((c, r) => rows.push(`<div class="item"><span class="kind">${'Condition'}</span>
      <input type="text" data-c="${r}" value="${esc(c.name)}" placeholder="${'Condition, e.g. EcoRI'}"><button class="x" data-cdel="${r}">×</button></div>`));
    st.strips.forEach((t, k) => rows.push(`<div class="item"><span class="kind">${'Strip'}</span>
      <input type="text" data-st="${k}" value="${esc(t.label)}" placeholder="${'Name, e.g. p53, GAPDH'}"><button class="x" data-stdel="${k}">×</button></div>`));
    const box = $('annoList');
    box.innerHTML = rows.join('');
    box.querySelectorAll('[data-st]').forEach(inp => { const t = st.strips[+inp.dataset.st]; inp.addEventListener('input', live(e => { t.label = e.target.value; })); inp.addEventListener('change', done()); });
    box.querySelectorAll('[data-stdel]').forEach(b => b.onclick = done(() => { st.strips.splice(+b.dataset.stdel, 1); }));
    box.querySelectorAll('[data-g]').forEach(inp => {
      const g = st.groups[+inp.dataset.g];
      inp.addEventListener('input', live(e => { g.text = e.target.value; inp.rows = Math.max(1, g.text.split('\n').length); }));
      inp.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); inp.blur(); } });
      inp.addEventListener('change', done());
    });
    box.querySelectorAll('[data-c]').forEach(inp => { const c = st.conditions[+inp.dataset.c]; inp.addEventListener('input', live(e => { c.name = e.target.value; })); inp.addEventListener('change', done()); });
    box.querySelectorAll('[data-gdel]').forEach(b => b.onclick = done(() => st.groups.splice(+b.dataset.gdel, 1)));
    box.querySelectorAll('[data-cdel]').forEach(b => b.onclick = done(() => st.conditions.splice(+b.dataset.cdel, 1)));
    box.querySelectorAll('[data-adel]').forEach(b => b.onclick = done(() => { st.arrows.splice(+b.dataset.adel, 1); App.selArrow = -1; }));
    box.querySelectorAll('[data-aed]').forEach(b => b.onclick = () => G.FigEdit.arrowPopover(+b.dataset.aed, b));
  }

  /* ---------- 6 layout ---------- */
  $('autoWidth').addEventListener('change', done(e => { S().style.autoWidth = e.target.checked; }));
  $('gelW').addEventListener('change', done(e => { S().style.gelWidthMm = E.clamp(+e.target.value || 45, 10, 180); S().style.autoWidth = false; }));
  $('fontPt').addEventListener('change', done(e => { S().style.fontPt = E.clamp(+e.target.value || 7, 4, 14); }));
  $('lineW').addEventListener('change', done(e => { S().style.lineWidthPt = E.clamp(+e.target.value || 0.5, 0.25, 2); }));
  const PRESET_ANGLES = ['auto', '0', '45', '60', '90'];
  $('labelAngle').addEventListener('change', done(e => { const v = e.target.value; S().style.labelAngle = v === 'custom' ? G.Render.labelAngle($('labelAngleNum').value || 0) : v; }));
  $('labelAngleNum').addEventListener('change', done(e => { S().style.labelAngle = G.Render.labelAngle(e.target.value); }));
  $('font').addEventListener('change', done(e => { S().style.font = G.Render.fontName(e.target.value); }));
  $('groupFit').addEventListener('change', done(e => { S().style.groupFit = e.target.value; }));
  ['unitHeader', 'laneNumbers', 'frame', 'groupTicks', 'groupSplit'].forEach(id => $(id).addEventListener('change', done(e => { S().style[id] = e.target.checked; })));
  $('spliceStyle').addEventListener('change', done(e => { S().style.spliceStyle = e.target.value; }));
  $('panelLetter').addEventListener('change', done(e => { S().style.panelLetter = e.target.value.trim(); }));
  $('stripGap').addEventListener('change', done(e => { S().style.stripGapPt = E.clamp(+e.target.value || 0, 0, 12); }));
  $('laneNumberMode').addEventListener('change', done(e => { S().style.laneNumberMode = e.target.value; }));
  // journal column width = total figure width (labels included): solve for the gel width
  $('widthPreset').addEventListener('change', e => {
    const target = +e.target.value; e.target.value = '';
    if (!S() || !target) return;
    const st = S().style;
    st.gelWidthMm = App.gelWidthMm(); st.autoWidth = false;
    for (let k = 0; k < 4; k++) {   // label widths depend weakly on the gel width; a few rounds converge
      const f = App.buildFigure(false), total = f.w / G.Render.MM;
      st.gelWidthMm = E.clamp(Math.round(st.gelWidthMm + (target - total)), 10, 180);
    }
    App.commit();
    const tot = (App.buildFigure(false).w / G.Render.MM).toFixed(1);
    toast(`Figure width ${tot} mm (gel ${st.gelWidthMm} mm)`);
  });
  $('btnResetLayout').onclick = done(() => { App.resetLayout(); toast('Layout reset to defaults (Ctrl+Z to undo)'); });
  function updateDpiLine() {
    const eff = Math.round(App.effectiveDpi()), safe = App.maxSafeWidthMm(300), w = App.gelWidthMm();
    $('dpiLine').innerHTML = eff >= 300
      ? `${'Effective gel resolution'} <span class="ok">${eff} dpi</span>`
      : `${'Effective gel resolution'} <span class="bad">${eff} dpi</span>` +
        ` (&lt;300): keep the gel at most <b>${safe} mm</b> wide for 300 dpi` +
        (w > safe ? ` <button class="btn sm" id="btnSafeW">${`Use ${safe} mm`}</button>` : '');
    const b = $('btnSafeW'); if (b) b.onclick = done(() => { S().style.autoWidth = false; S().style.gelWidthMm = Math.max(10, safe); });
  }
  $('fitFull').onclick = () => G.Editor.fitFull();
  $('fitCrop').onclick = () => G.Editor.fitCrop();

  /* ---------- status + coach ---------- */
  function updateStatus() {
    const st = S(), r = range(), fl = figLanes();
    const named = fl.filter(i => st.lanes[i].name).length;
    const visMk = r ? st.markers.filter(m => m.lane >= r[0] && m.lane <= r[1]) : [];
    const lowMk = visMk.filter(m => m.score != null && m.score < 0.6);
    const set = (id, txt, cls) => { const el = $(id); el.textContent = txt; el.className = 'sec-status' + (cls ? ' ' + cls : ''); };
    set('stImage', (st.rotation ? `rotated ${st.rotation}° · ` : '')
      + (st.levels.invert ? 'inverted' : 'raw')
      + (st.saturatedInCrop ? ' · saturated' : ''), st.saturatedInCrop ? 'warn' : '');
    const p1 = v => (v * 100).toFixed(1);
    $('imgAdvNote').textContent = `${st.rotation ? st.rotation + '°' : '0°'}${st.flip && (st.flip.h || st.flip.v) ? ' · flipped' : ''}${st.geom ? ' · geometry' : ''} · levels ${p1(st.levels.black)}–${p1(st.levels.white)} %${st.levels.gamma && st.levels.gamma !== 1 ? ' · γ ' + st.levels.gamma : ''}`;
    set('stRange', (App.rowCount() > 1 ? `row ${st.gelRow + 1} of ${App.rowCount()} · ` : '') + (r ? `wells ${r[0] + 1}–${r[1] + 1} · ${named}/${fl.length} named` : ''));
    set('stMarker', visMk.length ? (lowMk.length ? 'check ladder' : String(visMk.length)) : 'none', lowMk.length || !visMk.length ? 'warn' : '');
    const secs = document.querySelectorAll('#sections .sec');
    const state = [true, !!r && named >= fl.length && fl.length > 0, visMk.length > 0 && !lowMk.length];
    secs.forEach((s, i) => { s.classList.toggle('done', !!state[i]); s.classList.remove('todo'); });
    const firstTodo = state.findIndex(v => !v);
    if (firstTodo >= 0 && secs[firstTodo]) secs[firstTodo].classList.add('todo');
    // coach: the single most useful next step
    let msg, ok = false;
    if (!r) msg = 'Drag the red box on the image, or choose wells under "Lanes in figure"';
    else if (named < fl.length) msg = `Next: <b>click a grey lane number</b> on the figure and type its name; Enter moves on (${fl.length - named} to go)`;
    else if (!visMk.length) msg = App.gelType().western
      ? 'No marker in the figure: add the marker lane in step 3, or load the white-light marker image'
      : 'No marker in the figure: add the marker lane in step 3 on the left';
    else if (lowMk.length) msg = `The marker in well ${lowMk[0].lane + 1} fits the chosen ladder poorly — <b>check the ladder</b>`;
    else if (App.isExample) { msg = 'This is a synthetic example — <b>drop your own image</b> to start'; ok = true; }
    else { msg = 'Ready — <b>Export figure</b> above the figure, or <b>Export all</b> at the top right; add groups, arrows or strips on the left, band boxes in step 6'; ok = true; }
    $('coachText').innerHTML = msg;
    $('coach').classList.toggle('done', ok);
    $('imgChip').classList.toggle('warn', st.saturatedInCrop > 0);
    $('imgChip').classList.toggle('ready', !st.saturatedInCrop);
  }

  function syncControls() {
    const st = S(), y = st.style;
    const dark = App.darkBands();
    document.querySelectorAll('#polSeg button').forEach(b => b.classList.toggle('on', (b.dataset.dark === '1') === dark));
    // which of the two looks is the image as it came from the imager
    document.querySelectorAll('#polSeg .pol-note').forEach(n => { n.textContent = (n.dataset.k === '1') === !st.bright ? 'as imaged' : 'inverted'; });
    $('btnPolDetect').textContent = `Detection: ${st.bright ? 'bright bands on dark' : 'dark bands on light'} · change`;
    $('lvBlack').value = toSlider(st.levels.black); $('lvWhite').value = toSlider(st.levels.white);
    $('lvBlackV').textContent = pct(st.levels.black); $('lvWhiteV').textContent = pct(st.levels.white);
    $('rot').value = st.rotation; $('rotNum').value = st.rotation; $('rotV').textContent = st.rotation + '°';
    $('rotAuto').textContent = App.autoRotation != null ? `auto ${App.autoRotation}°` : '';
    const ft = G.Export.flipText(st);
    $('flipNote').textContent = ft ? ft : '';
    const k = st.geom;
    $('ksNote').textContent = !k ? (st.geomChecked ? 'checked · none needed' : 'off') : `${k.mode}${Math.abs(k.lanesPct) >= 0.5 || Math.abs(k.bandsPct) >= 0.5 ? ` · lanes ${k.lanesPct > 0 ? '+' : ''}${k.lanesPct} %${k.rows || k.mode === 'manual' ? ` · bands ${k.bandsPct > 0 ? '+' : ''}${k.bandsPct} %` : ''}` : ''}${k.bendPx >= 0.5 ? ` · bend ${k.bendPx.toFixed(1)} px` : ''}`;
    geomSeg();
    $('btnFlipV').classList.toggle('on', !!st.flip.v); $('btnFlipH').classList.toggle('on', !!st.flip.h);
    $('invNote').textContent = App.invertInherited ? `${dark ? 'Dark' : 'Bright'} bands, as you last chose for this experiment` : '';
    $('stripGap').value = y.stripGapPt != null ? y.stripGapPt : 3;
    syncTypeHints();
    const hasMk = App.hasMarkerImage();
    $('btnMarkerImgDel').classList.toggle('hidden', !hasMk); $('mkOverlayWrap').classList.toggle('hidden', !hasMk);
    $('btnMarkerImg').textContent = hasMk ? 'Replace marker image…' : 'Load marker image…';
    $('mkImageText').textContent = hasMk ? `Marker bands are read from: ${st.markerImage.name}`
      : 'Ladder not visible on the blot image? Load the white-light image of the same membrane. It is used only to find the marker bands; the figure still shows the blot.';
    $('spliceGap').value = y.spliceGapPt != null ? y.spliceGapPt : 1.5; $('spliceGapV').textContent = $('spliceGap').value + ' pt';
    $('laneNumberMode').value = y.laneNumberMode || 'well';
    updateClipLine(); updateDpiLine(); updateEmptyBar();
    $('gamma').value = st.levels.gamma; $('gammaUnlock').checked = st.levels.gamma !== 1; $('gamma').disabled = st.levels.gamma === 1 && !$('gammaUnlock').checked;
    $('autoWidth').checked = !!y.autoWidth; $('gelW').value = App.gelWidthMm(); $('gelW').disabled = !!y.autoWidth;
    $('fontPt').value = y.fontPt; $('lineW').value = y.lineWidthPt; $('groupFit').value = y.groupFit || 'wrap'; $('font').value = G.Render.fontName(y.font);
    const la = G.Render.labelAngle(y.labelAngle);
    $('labelAngle').value = PRESET_ANGLES.includes(String(la)) ? String(la) : 'custom';
    $('labelAngleNum').value = la === 'auto' ? '' : la; $('labelAngleNum').disabled = la === 'auto';
    ['unitHeader', 'laneNumbers', 'frame', 'groupTicks', 'groupSplit'].forEach(id => { $(id).checked = !!y[id]; });
    $('spliceStyle').value = y.spliceStyle; $('panelLetter').value = y.panelLetter || '';
    $('dpiTop').value = String(y.dpi);
    $('stLayout').textContent = `${App.gelWidthMm()} mm · ${y.fontPt} pt`;
    $('imgChipName').textContent = App.isExample ? 'Example: ' + App.gelType().name() : st.file.name;
    $('imgChip').title = `${App.src.w} × ${App.src.h} px · ${st.file.bits}-bit${st.file.dpi ? ' · ' + Math.round(st.file.dpi) + ' dpi' : ''}` + ' (click to replace)';
    $('btnUndo').disabled = App.hist.length < 2; $('btnRedo').disabled = !App.future.length;
    drawHisto();
  }

  /* ---------- histogram ---------- */
  let histCache = null;
  function drawHisto() {
    const cv = $('histo'), st = S();
    if (!st || !cv.clientWidth) return;
    const dpr = window.devicePixelRatio || 1, W = cv.width = cv.clientWidth * dpr, H = cv.height = 40 * dpr;
    const ctx = cv.getContext('2d');
    const key = [st.rotation, st.crop.x, st.crop.y, st.crop.w, st.crop.h].join();
    if (!histCache || histCache.key !== key) {
      const c = App.cropImg(), bins = new Float32Array(200), step = Math.max(1, (c.data.length / 300000) | 0);
      for (let i = 0; i < c.data.length; i += step) bins[Math.min(199, (Math.sqrt(Math.max(0, c.data[i])) * 200) | 0)]++;
      let mx = 0; for (let i = 0; i < 200; i++) { bins[i] = Math.log1p(bins[i]); mx = Math.max(mx, bins[i]); }
      histCache = { key, bins, mx };
    }
    const { bins, mx } = histCache;
    ctx.clearRect(0, 0, W, H);
    const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    ctx.fillStyle = css('--hist') || '#c3cad4';
    for (let i = 0; i < 200; i++) { const h = bins[i] / mx * (H - 3); ctx.fillRect(i / 200 * W, H - h, W / 200 + 0.5, h); }
    const bx = Math.sqrt(st.levels.black) * W, wx = Math.sqrt(st.levels.white) * W;
    ctx.fillStyle = css('--accent-bg') || '#e1f0f2'; ctx.fillRect(bx, 0, wx - bx, H);
    ctx.fillStyle = css('--accent') || '#176d7c'; ctx.fillRect(bx - 1, 0, 2, H); ctx.fillRect(wx - 1, 0, 2, H);
  }

  /* ---------- preview ---------- */
  let lastFig = null, buildMs = 0, lastLive = 0, liveTimer = 0;
  // live updates while dragging: skip frames when building the figure is slow (large images),
  // always finishing with a final render shortly after the last input
  function livePreview() {
    clearTimeout(liveTimer);
    const gap = buildMs > 30 ? Math.min(400, buildMs * 3) : 0, now = performance.now();
    if (now - lastLive >= gap) { lastLive = now; updatePreview(); }
    else liveTimer = setTimeout(() => { lastLive = performance.now(); updatePreview(); }, gap);
  }
  function updatePreview() {
    const st = S();
    let f;
    const t0 = performance.now();
    try { f = App.buildFigure(true); } catch (e) { console.error(e); return; }
    buildMs = buildMs ? buildMs * 0.6 + (performance.now() - t0) * 0.4 : performance.now() - t0;
    lastFig = f;
    $('preview').innerHTML = f.svg;
    const svg = $('preview').querySelector('svg'), box = $('previewBox').getBoundingClientRect();
    const k = Math.max(0.5, Math.min((box.width - 48) / f.w, (box.height - 48) / f.h, 4));
    svg.removeAttribute('width'); svg.removeAttribute('height');
    svg.style.width = (f.w * k) + 'px'; svg.style.height = (f.h * k) + 'px';
    $('figSize').textContent = `${(f.w / G.Render.MM).toFixed(1)} × ${(f.h / G.Render.MM).toFixed(1)} mm`;
    $('angleInfo').textContent = G.Render.labelAngle(st.style.labelAngle) === 'auto' ? `now ${f.angle}°` : '';
    const rs = G.Export.rasterSize(f.w, f.h, st.style.dpi);
    $('pxLine').innerHTML = rs.ok ? `${rs.w} × ${rs.h} px at ${st.style.dpi} dpi` : `<span class="bad">${rs.w} × ${rs.h} px at ${st.style.dpi} dpi: more than ${rs.browser} can draw as PNG</span>` + (rs.fitsDpi ? ` <button class="btn sm" id="btnFitDpi">Use ${rs.fitsDpi} dpi</button>` : '');
    const fb = $('btnFitDpi'); if (fb) fb.onclick = done(() => { S().style.dpi = rs.fitsDpi; });
    showWarnings(f.warnings);
    // legend suggestions are English: they go into the manuscript
    const hints = G.Export.legendHints(st);
    $('legendHints').innerHTML = hints.length ? `<b>${'Legend notes'}</b>` + hints.map(esc).join('<br>') : '';
    if (G.FigEdit) G.FigEdit.afterRender(f);
  }

  function renderPanel() { renderRows(); renderLanes(); renderMarkers(); renderAnno(); }

  App.on(what => {
    if (what === 'closed') { closeWorkspace(); return; }
    if (!S()) return;
    if (what === 'loaded') { $('emptyState').classList.add('hidden'); $('libBox').classList.add('hidden'); $('sections').classList.remove('hidden'); $('btnClose').classList.remove('hidden'); $('viewSeg').classList.remove('hidden'); histCache = null; renderExposures(); renderFavs(); }
    if (what === 'refresh') { livePreview(); return; }
    clearTimeout(liveTimer);
    if (what === 'select') { renderLanes(); renderAnno(); return; }
    syncControls(); renderPanel(); updateStatus(); updatePreview();
  });
  window.addEventListener('resize', () => { if (S()) { updatePreview(); drawHisto(); } });
  $('imgAdv').addEventListener('toggle', () => { if ($('imgAdv').open) drawHisto(); });

  Object.assign(UI, { toast, updatePreview, figLanes, range, esc, lastFig: () => lastFig, preflight, renderExposures, alert: alertDlg, confirm: confirmDlg, loadExample, load, printHtml, exportPackage });
  G.UI = UI;
  $('btnUndo').disabled = $('btnRedo').disabled = true;
  syncTypeHints();

  /* the app opens on the empty workspace (with the library, if any); the first visit starts the hands-on tutorial */
  async function startup() {
    const q = new URLSearchParams(location.search);
    if (q.get('demo') === '1' || q.get('src') || q.get('blank') === '1') return;
    if (q.get('example')) { loadExample(q.get('example')); return; }
    let list = [];
    try { list = await App.library.list(); } catch (e) { list = []; }
    if (S()) return;
    if (list.length) renderLibrary();
    else if (!App.prefs().tutorialSeen) setTimeout(() => { if (!S() && !App.prefs().tutorialSeen) G.Tour.start('tutorial'); }, 500);
  }
  startup();

  /* ---------- development / self-test URL parameters ----------
   * ?demo=1 loads the synthetic gel; ?uitest=1 runs js/uitest.js; ?annot=1, ?names=, ?range=, ?groups=,
   * ?arm=arrow and ?png=<dpi> set up states for screenshots; ?src=<url> loads a local file (for tests). */
  const qs = new URLSearchParams(location.search);
  if (qs.get('demo') === '1' || qs.get('src')) setTimeout(async () => {
    App.forceJsHash = true;
    if (qs.get('src')) {
      const src = qs.get('src'), buf = await (await fetch(src)).arrayBuffer();
      await App.load({ name: decodeURIComponent(src.split('/').pop()), buffer: buf });
    } else await App.load(demoFile(), 'dna-agarose');
    const st = S();
    if (qs.get('annot') === '1') {
      const names = ['M', 'WT', 'WT', 'KO-1', 'NTC', '*lacZ*-1', '*lacZ*-2', 'pUC19', 'pUC19', 'Clone A', 'Clone B'];
      figLanes().forEach((li, k) => { st.lanes[li].name = names[k] || ''; });
      const fl = figLanes();
      st.groups = [{ from: fl[1], to: fl[3], text: 'Genotyping' }, { from: fl[5], to: fl[8], text: 'Plasmid' }];
      st.conditions = [{ name: 'EcoRI', values: st.lanes.map((l, i) => (fl.indexOf(i) > 0 ? (fl.indexOf(i) % 2 ? '+' : '−') : '')) }];
      const b15 = st.markers[0] && st.markers[0].bands.find(b => b.bp === 1500);
      st.arrows = b15 ? [{ y: b15.y, text: 'Product', size: true, side: '' }] : [];
    }
    if (qs.get('names')) { const n = qs.get('names').split(','); figLanes().forEach((li, k) => { if (n[k] != null) st.lanes[li].name = n[k]; }); }
    if (qs.get('range')) { const [a, b] = qs.get('range').split('-').map(Number); App.setLaneRange(a - 1, b - 1); App.afterRangeChange(); }
    if (qs.get('groups')) {
      const fl = figLanes();
      st.groups = qs.get('groups').split(';').map(g => { const [r, t] = g.split(':'); const [a, b] = r.split('-').map(Number); return { from: fl[a - 1], to: fl[(b || a) - 1], text: t || '' }; });
    }
    App.commit();
    if (qs.get('arm') === 'arrow') G.FigEdit.setMode('arrow');
    if (qs.get('uitest') === '1') { const s = document.createElement('script'); s.src = 'js/uitest.js'; document.body.appendChild(s); return; }
    if (qs.get('png')) {
      const f = App.buildFigure(false), c = await G.Export.svgToCanvas(f.svg, f.w, f.h, +qs.get('png'));
      const pre = document.createElement('pre'); pre.id = 'figpng'; pre.style.display = 'none'; pre.textContent = c.toDataURL('image/png'); document.body.appendChild(pre);
    }
    const r = range();
    document.title = 'READY ' + JSON.stringify({
      file: st.file.name, rot: st.rotation, crop: st.crop, lanes: st.lanes.map(l => Math.round(l.x)), range: r && [r[0] + 1, r[1] + 1],
      halfW: Math.round(st.laneHalfW), markers: st.markers.map(m => ({ lane: m.lane + 1, ladder: m.ladderId, score: Math.round((m.score || 0) * 100) / 100 })),
      coach: $('coachText').textContent
    });
  }, 50);
})(window);

/* UI: panel sections, top bar, coach line, live preview. Direct editing on the figure lives in figedit.js. */
(function (G) {
  'use strict';
  const App = G.App, E = G.Engine, L = G.L;
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const toSlider = v => Math.round(Math.sqrt(Math.max(0, Math.min(1, v))) * 1000);
  const fromSlider = s => (s / 1000) ** 2;
  const pct = v => (v * 100).toFixed(v < 0.1 ? 3 : 2) + '%';
  const S = () => App.S;
  const live = fn => e => { if (!S()) return; fn(e); App.refresh(); };
  const done = fn => e => { if (!S()) return; if (fn) fn(e); App.commit(); };
  const list = a => a.join(L('、', ', '));

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
      const x = document.createElement('button'); x.textContent = '×'; x.title = L('不再提示', 'Dismiss');
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
      $('askNo').textContent = L('取消', 'Cancel');
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
  const confirmDlg = (msg, ok, danger) => ask(textHtml(msg), { confirm: true, ok: ok || L('继续', 'Continue'), danger });
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
      } catch (e) { alertDlg(L('无法打开 ZIP：', 'Could not open the ZIP: ') + e.message); return; }
      if (!files.length) { alertDlg(L('ZIP 里没有图片或项目文件', 'The ZIP contains no image or project file')); return; }
    }
    const proj = files.find(f => /\.gelfig$/i.test(f.name));
    if (proj) return openProject(proj);
    await App.load(files.length > 1 ? files : files[0], gelType);
    if (!S()) return;
    const r = range(), n = r ? r[1] - r[0] + 1 : 0, nw = S().lanes.length, nm = S().markers.length;
    let msg = L(`识别完成：${nw} 个加样孔，出图 ${n} 条泳道` + (nm ? `，${nm} 个 Marker` : '，未找到 Marker'),
      `Detected ${nw} wells, ${n} lanes in the figure` + (nm ? `, ${nm} marker${nm > 1 ? 's' : ''}` : ', no marker found'));
    if (App.exposures) {
      const e = App.exposures[App.expIdx], c = (e.clipFrac * 100).toFixed(2);
      msg = L(`${App.exposures.length} 张曝光中自动选了 ${e.name}（过曝 ${c}%）。`, `Picked ${e.name} of ${App.exposures.length} exposures (${c}% saturated). `) + msg;
    }
    toast(msg, 4200);
    (App.loadWarnings || []).forEach(w => toast(w, 5200));
    if (App.ladderNotice) toast(App.ladderNotice, 5200);
    if (Math.abs(S().rotation) >= App.AUTO_ROT_LIMIT - 0.3) toast(L(`自动转正达到上限 ±${App.AUTO_ROT_LIMIT}°，请人工确认角度`, `Auto-straightening reached its ±${App.AUTO_ROT_LIMIT}° limit; please check the angle`), 5200);
  }
  async function openProject(f) {
    if (/\.zip$/i.test(f.name)) return load([f]);
    try { App.busy(true, L('正在打开项目…', 'Opening project…')); await App.openProject(await f.arrayBuffer()); toast(L('项目已打开', 'Project opened')); }
    catch (e) { alertDlg(L('打开项目失败：', 'Could not open the project: ') + e.message); } finally { App.busy(false); }
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
    App.busy(true, L('正在生成示例…', 'Building the example…'));
    await new Promise(r => setTimeout(r, 30));
    const g = G.Demo.makeGel({ preset: kind });
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
    toast(L('这是合成的示例图；拖入你自己的图片即可开始', 'This is a synthetic example; drop your own image to start'), 4200);
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
  async function offerDraft() {
    const d = await App.peekDraft();
    if (!d || S()) return;
    $('draftName').textContent = d.name;
    $('draftTime').textContent = L('保存于 ', 'Saved ') + new Date(d.savedAt).toLocaleString(G.I18N.lang === 'en' ? 'en' : 'zh-CN');
    $('draftBox').classList.remove('hidden');
  }
  $('btnDraftRestore').onclick = async () => {
    try { App.busy(true, L('正在恢复…', 'Restoring…')); await App.restoreDraft(); toast(L('已恢复上次的进度', 'Restored your last session')); }
    catch (e) { alertDlg(L('恢复失败：', 'Could not restore: ') + e.message); } finally { App.busy(false); }
  };
  $('btnDraftDrop').onclick = async () => { await App.dropDraft(); $('draftBox').classList.add('hidden'); };

  /* ---------- exposures strip ---------- */
  function renderExposures() {
    const ex = App.exposures, box = $('expoStrip');
    if (!ex || ex.length < 2) { box.classList.add('hidden'); return; }
    box.classList.remove('hidden');
    const best = Math.max(...ex.map(e => e.score));
    box.innerHTML = ex.map((e, k) => {
      const sc = (e.score * 100).toFixed(0), c = (e.clipFrac * 100).toFixed(2);
      return `<div class="expo-item${k === App.expIdx ? ' on' : ''}" data-k="${k}" title="${esc(e.name)}\n${L(`评分 ${sc} · 信噪比 ${e.snr.toFixed(0)} · 过曝 ${c}%`, `score ${sc} · SNR ${e.snr.toFixed(0)} · saturated ${c}%`)}">
      <img src="${e.thumb}" alt="">
      ${e.score === best ? `<span class="best">${L('推荐', 'Best')}</span> · ` : ''}${L(`${sc} 分`, `score ${sc}`)}<br>
      <span class="${e.clipFrac > 0.0005 ? 'clip' : ''}">${L('过曝', 'sat.')} ${c}%</span></div>`;
    }).join('');
    box.querySelectorAll('.expo-item').forEach(el => el.onclick = async () => {
      const r = await App.switchExposure(+el.dataset.k);
      if (r.kept) toast(L(`已切换到 ${S().file.name}，标注全部保留`, `Switched to ${S().file.name}; all annotations kept`));
      else if (r.namesCarried) toast(L('这张尺寸不同，已重新识别；泳道名按顺序沿用，请核对', 'This image has a different size and was re-detected; lane names were carried over in order — please check'));
      else if (r.kept === false) toast(L('这张的构图与之前不同，已重新识别，标注未沿用', 'This image is framed differently and was re-detected; annotations were not carried over'), 4200);
    });
  }

  /* ---------- top bar ---------- */
  $('btnUndo').onclick = () => App.undo();
  $('btnRedo').onclick = () => App.redo();
  $('btnHelp').onclick = () => $('helpDlg').classList.remove('hidden');
  $('btnHelpClose').onclick = () => $('helpDlg').classList.add('hidden');
  $('btnLang').onclick = () => G.I18N.set(G.I18N.lang === 'en' ? 'zh' : 'en');
  G.I18N.onChange(() => {
    syncTypeHints(); renderFavs(); renderExposures();
    if (S()) App.emit('change');
    else offerDraft();
  });
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
    if (e.key === 'Escape') $('helpDlg').classList.add('hidden');
  });
  const baseName = () => (S() ? S().file.name.replace(/\.[^.]+$/, '') : 'gel');
  $('dpiTop').addEventListener('change', done(e => { S().style.dpi = +e.target.value; }));
  const needImage = () => { if (S()) return false; toast(L('先打开一张凝胶图', 'Open a gel image first')); return true; };

  /* ---------- export (with pre-flight) ---------- */
  $('preflightOn').checked = App.prefs().preflight !== false;
  $('preflightOn').addEventListener('change', e => App.setPref('preflight', e.target.checked));
  // resolves true = go ahead, false = user went back to fix
  function preflight() {
    return new Promise(resolve => {
      if (App.prefs().preflight === false) return resolve(true);
      const items = App.preflight(), serious = items.filter(i => i.level === 'block' || i.level === 'warn');
      if (!serious.length) return resolve(true);
      const lab = { block: L('需处理', 'Fix'), warn: L('注意', 'Warning'), info: L('提示', 'Note') };
      const box = $('pfList');
      box.innerHTML = items.map((it, k) => `<div class="pf-item"><span class="lv ${it.level}">${lab[it.level]}</span><span class="tx">${esc(it.text)}</span>${it.fix ? `<button class="btn sm" data-fix="${k}">${esc(it.fix.label)}</button>` : ''}</div>`).join('');
      box.querySelectorAll('[data-fix]').forEach(b => b.onclick = () => { items[+b.dataset.fix].fix.run(); App.commit(); b.disabled = true; b.textContent = L('已修正', 'Fixed'); });
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
    App.busy(true, L('正在导出…', 'Exporting…'));
    try {
      const f = App.buildFigure(false), dpi = S().style.dpi, eff = Math.round(App.effectiveDpi());
      if (kind === 'pdf') {
        const r = await G.Export.exportPDF(f.svg, `${baseName()}_figure.pdf`, S());
        if (r.missing.length) alertDlg(L(`PDF 使用标准字体，以下字符无法显示，已替换为 "?"：${r.missing.join(' ')}。需要这些字符请用 SVG 或 PNG。`,
          `The PDF uses the standard PDF fonts, which cannot show these characters (written as "?"): ${r.missing.join(' ')}. Use SVG or PNG for them.`));
        saved(r.status, L('已导出矢量 PDF', 'Exported vector PDF'));
        return;
      }
      const fmt = kind === 'tiff' ? 'TIFF' : 'PNG';
      const st = kind === 'tiff' ? await G.Export.exportTIFF(f.svg, f.w, f.h, dpi, `${baseName()}_figure_${dpi}dpi.tif`, S())
        : await G.Export.exportPNG(f.svg, f.w, f.h, dpi, `${baseName()}_figure_${dpi}dpi.png`, S());
      saved(st, L(`已导出 ${dpi} dpi ${fmt}`, `Exported ${dpi} dpi ${fmt}`) + (eff < dpi ? L(`（胶图本身 ${eff} dpi）`, ` (the gel itself is ${eff} dpi)`) : ''));
    } catch (e) { alertDlg(e.message); } finally { App.busy(false); }
  }
  $('btnPNG').onclick = () => exportFigure('png');
  $('btnTIFF').onclick = () => exportFigure('tiff');
  $('btnPDF').onclick = () => exportFigure('pdf');
  // copy the figure as a PNG: the quickest way into a slide or a notebook entry
  $('btnCopyFig').onclick = async () => {
    if (needImage()) return;
    App.busy(true, L('正在渲染…', 'Rendering…'));
    try {
      const f = App.buildFigure(false), dpi = S().style.dpi;
      const c = await G.Export.svgToCanvas(f.svg, f.w, f.h, dpi);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no clipboard');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(L(`已复制 ${dpi} dpi PNG，可直接粘贴`, `Copied a ${dpi} dpi PNG; paste it anywhere`));
    } catch (e) {
      toast(L('此处无法写入剪贴板，请用"导出 PNG"', 'The clipboard is not available here; use Export PNG instead'), 3600);
    } finally { App.busy(false); }
  };
  $('btnSVG').onclick = async () => { if (needImage() || !(await preflight())) return; saved(await G.Export.exportSVG(App.buildFigure(false).svg, baseName() + '_figure.svg'), L('已导出 SVG', 'Exported SVG')); };
  $('btnUncropped').onclick = async () => { if (needImage()) return; App.renderFull(); saved(await G.Export.exportUncropped(S(), App.fullCanvas, baseName() + '_uncropped_same-processing.png'), L('已导出未裁切图（与成图同处理）', 'Exported the uncropped image (same processing as the figure)')); };
  $('btnOriginal').onclick = async () => {
    if (needImage()) return;
    const mk = App.hasMarkerImage() ? { name: S().markerImage.name, sha256: S().markerImage.sha256, buffer: App.markerBuffer } : null;
    saved(await G.Export.exportOriginal(S(), App.srcBuffer, mk), L('已导出原始文件', 'Exported the original file') + ' (SHA-256 ' + S().file.sha256.slice(0, 12) + '…)');
  };
  $('btnLog').onclick = async () => { if (needImage()) return; saved(await G.Export.download(new Blob([JSON.stringify(G.Export.processingLog(S()), null, 2)], { type: 'application/json' }), baseName() + '_processing_log.json'), L('已导出处理日志', 'Exported the processing log')); };

  /* ---------- project / style files ---------- */
  $('btnSaveProj').onclick = async () => {
    if (needImage()) return;
    const b = await App.projectBlob();
    saved(await G.Export.download(b, baseName() + '.gelfig'), L('项目已保存（含原图，可在其他电脑打开继续编辑）', 'Project saved (includes the original image; continue on any computer)'));
  };
  $('btnSaveTpl').onclick = async () => { if (!needImage()) saved(await G.Export.download(new Blob([JSON.stringify(App.template(), null, 2)], { type: 'application/json' }), baseName() + '_style.json'), L('样式已保存', 'Style saved')); };
  $('tplInput').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || needImage()) return;
    try {
      const t = JSON.parse(await f.text()), chk = App.checkTemplate(t), a = chk.templateLanes, b = chk.figureLanes;
      if (a && a !== b && !(await confirmDlg(L(
        `样式有 ${a} 条泳道，当前出图范围是 ${b} 条。\n套用后会从当前第一条泳道起按顺序对应，并把出图范围调整为 ${a} 条。`,
        `The style has ${a} lanes; the figure currently shows ${b}.\nNames will be applied in order from the first lane and the figure range set to ${a} lanes.`), L('套用', 'Apply')))) return;
      const r = App.applyTemplate(t);
      toast(L('样式已套用', 'Style applied') + (r.importedLadders.length ? L(`，并导入自定义 Ladder：${list(r.importedLadders)}`, `; imported custom ladders: ${list(r.importedLadders)}`) : ''));
    } catch (err) { alertDlg(L('样式载入失败：', 'Could not apply the style: ') + err.message); }
  });
  $('btnResetAll').onclick = async () => {
    if (needImage()) return;
    if (!(await confirmDlg(L('重置整图：旋转、裁切、泳道、Marker、名称、分组、箭头、分条、条带框、版式全部回到刚导入时的样子。\n此操作会清空撤销记录。',
      'Reset everything: rotation, crop, lanes, markers, names, groups, arrows, strips, band boxes and layout go back to how they were right after import.\nThis clears the undo history.'), L('重置', 'Reset'), true))) return;
    App.resetAll(); G.Editor.fitCrop(); toast(L('已回到导入时的状态', 'Back to the state after import'));
  };

  /* ---------- experiment type ---------- */
  function fillTypes(sel) {
    sel.innerHTML = G.Gels.TYPES.map(t => `<option value="${t.id}">${esc(t.name())}</option>`).join('');
  }
  function syncTypeHints() {
    const cur = S() ? S().gelType : App.gelType().id;
    ['gelType', 'gelTypeStart'].forEach(id => { const el = $(id); if (!el.options.length || el.dataset.lang !== G.I18N.lang) { fillTypes(el); el.dataset.lang = G.I18N.lang; } el.value = cur; });
    const t = G.Gels.get(cur);
    $('gelTypeHint').textContent = t.hint(); $('gelTypeStartHint').textContent = t.hint();
    $('mkImageBox').classList.toggle('emph', !!t.western);
  }
  $('gelTypeStart').addEventListener('change', e => { App.setPref('gelType', e.target.value); syncTypeHints(); renderFavs(); });
  $('gelType').addEventListener('change', done(e => {
    App.setGelType(e.target.value);
    const n = S().markers.length;
    toast(L(`已切换为 ${App.gelType().name()}；Marker 按新的型号库重新识别（${n} 个）`, `Switched to ${App.gelType().name()}; markers re-detected from its ladder library (${n})`), 3600);
    renderFavs();
  }));

  /* ---------- 1 image ---------- */
  document.querySelectorAll('#polSeg button').forEach(b => b.onclick = done(() => { App.setDarkBands(b.dataset.dark === '1'); App.invertInherited = false; }));
  $('lvBlack').addEventListener('input', live(e => { S().levels.black = Math.min(fromSlider(+e.target.value), S().levels.white - 0.0005); $('lvBlackV').textContent = pct(S().levels.black); drawHisto(); updateClipLine(); }));
  $('lvWhite').addEventListener('input', live(e => { S().levels.white = Math.max(fromSlider(+e.target.value), S().levels.black + 0.0005); $('lvWhiteV').textContent = pct(S().levels.white); drawHisto(); updateClipLine(); }));
  $('lvBlack').addEventListener('change', done()); $('lvWhite').addEventListener('change', done());
  // rotation: live while dragging (annotations follow), one commit + band re-check when released
  $('rot').addEventListener('input', live(e => { App.setRotation(+e.target.value); $('rotNum').value = S().rotation; $('rotV').textContent = S().rotation + '°'; G.Editor.setGrid(true); }));
  function commitRotation() {
    G.Editor.setGrid($('showGrid').checked);
    App.afterRotation(); App.commit();
    const d = S().rotation;
    if (Math.abs(d) > App.AUTO_ROT_LIMIT) toast(L(`旋转 ${d}°：角度较大，图像四角会被裁掉或拉伸，请确认裁切框只框住胶块内部`, `Rotation ${d}°: at large angles the image corners are cut off; make sure the crop box stays inside the gel`), 4200);
  }
  $('rot').addEventListener('change', () => { if (S()) commitRotation(); });
  $('rotNum').addEventListener('change', e => { if (!S()) return; App.setRotation(+e.target.value || 0); commitRotation(); });
  $('rotMinus').onclick = () => { if (!S()) return; App.setRotation(S().rotation - 0.5); commitRotation(); };
  $('rotPlus').onclick = () => { if (!S()) return; App.setRotation(S().rotation + 0.5); commitRotation(); };
  $('btnDeskew').onclick = () => {
    if (!S()) return;
    App.busy(true, L('正在检测角度…', 'Measuring the angle…'));
    setTimeout(() => {
      const a = App.autoDeskew(); App.afterRotation(); App.busy(false); App.commit();
      toast(Math.abs(a) >= App.AUTO_ROT_LIMIT - 0.3
        ? L(`自动转正到达上限 ${a}°，可能还没转正，请手动确认`, `Auto-straightening hit its limit at ${a}°; the gel may still be tilted — please check`)
        : L(`已转正为 ${a}°（标注已随图转动）`, `Straightened to ${a}° (annotations rotated with the image)`), 3600);
    }, 20);
  };
  $('btnResetRot').onclick = () => { if (!S()) return; App.resetRotation(); App.commit(); toast(L(`已回到自动角度 ${S().rotation}°`, `Back to the automatic angle ${S().rotation}°`)); };
  const flipBtn = (id, axis) => { $(id).onclick = () => {
    if (!S()) return;
    App.busy(true, L('正在翻转…', 'Flipping…'));
    setTimeout(() => { App.flip(axis); App.busy(false); App.commit(); G.Editor.fitCrop(); toast(L('已翻转，所有标注跟随（Ctrl+Z 可撤销）', 'Flipped; every annotation followed (Ctrl+Z to undo)')); }, 20);
  }; };
  flipBtn('btnFlipV', 'v'); flipBtn('btnFlipH', 'h');
  $('showGrid').addEventListener('change', e => { G.Editor.setGrid(e.target.checked); });
  $('btnResetLv').onclick = done(() => { App.resetLevels(); toast(L('对比度已重置（Ctrl+Z 可撤销）', 'Contrast reset (Ctrl+Z to undo)')); });
  $('btnAutoLv').onclick = done(() => App.autoLevels());
  function updateClipLine() {
    if (!S()) return;
    const k = App.clipStats(), bc = App.bandClipFrac();
    const p = v => (v * 100).toFixed(v < 0.001 ? 3 : 2) + '%';
    $('clipLine').innerHTML = `${L('相机过曝', 'Camera saturation')} <span class="${k.sensorFrac > 0.0005 ? 'bad' : 'ok'}">${p(k.sensorFrac)}</span> · ${L('色阶削顶', 'Contrast clipping')} <span class="${bc > 0.001 ? 'bad' : 'ok'}">${p(bc)}</span>`;
    $('clipLine').title = L(`裁切区 ${k.n} 像素中：相机饱和 ${k.sensor}；被对比度压成纯白/纯黑：亮端 ${k.high}、暗端 ${k.low}`,
      `Of ${k.n} pixels in the crop: ${k.sensor} saturated by the camera; clipped by the contrast setting: ${k.high} bright, ${k.low} dark`);
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
  $('btnAutoLanes').onclick = done(() => { App.autoLanes(); App.afterRangeChange(); toast(L(`整块胶识别出 ${S().lanes.length} 个加样孔`, `Detected ${S().lanes.length} wells on the whole gel`)); });
  // after lanes inside the crop are rebuilt, find the marker lanes again but keep the ladder the
  // user chose for a marker that is still at (about) the same position
  function relaneMarkers(fn) {
    const st = S(), tol = (st.lanePitch || 40) * 0.5;
    const prev = st.markers.map(m => ({ x: st.lanes[m.lane] ? st.lanes[m.lane].x : -1e9, ladderId: m.ladderId, unit: m.unit, side: m.side }));
    const n = fn();
    App.autoMarkers();
    let changed = false;
    st.markers.forEach(m => {
      const p = prev.find(q => Math.abs(q.x - st.lanes[m.lane].x) < tol);
      if (p) { if (m.ladderId !== p.ladderId) changed = true; Object.assign(m, { ladderId: p.ladderId, unit: p.unit, side: p.side }); }
    });
    if (changed) App.matchMarkers(true);
    return n;
  }
  $('btnRedetectCrop').onclick = done(() => {
    const n = relaneMarkers(() => App.redetectLanesInCrop());
    toast(n ? L(`框内识别出 ${n} 条泳道`, `Found ${n} lanes in the box`) : L('框内没识别到泳道，可以填条数后点"等间距排布"', 'No lanes found in the box; enter the number and click "Space evenly"'));
  });
  const evenCrop = done(() => {
    const n = relaneMarkers(() => App.evenLanesInCrop(+$('cropLaneN').value || 0));
    toast(L(`框内已等间距排布 ${n} 条泳道`, `Spaced ${n} lanes evenly in the box`));
  });
  G.UI_relane = relaneMarkers;
  $('btnEvenCrop').onclick = evenCrop;
  $('cropLaneN').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); evenCrop(); } });

  // empty lanes inside the range: suggest cutting them (never done silently)
  const ignoredEmpty = new Set();
  function updateEmptyBar() {
    const st = S(), empt = App.emptyLanes().filter(i => !ignoredEmpty.has(st.file.sha256 + ':' + i));
    $('emptyBar').classList.toggle('hidden', !empt.length);
    if (!empt.length) return;
    const wells = list(empt.map(i => i + 1));
    $('emptyText').innerHTML = L(`孔 <b>${wells}</b> 看起来是空泳道（几乎没有条带）。剪除后会自动加拼接间隙，并在处理记录里注明。`,
      `Well${empt.length > 1 ? 's' : ''} <b>${wells}</b> look${empt.length > 1 ? '' : 's'} empty (almost no bands). Removing adds a splice gap and is recorded in the processing log.`);
    $('btnCutEmpty').onclick = done(() => { empt.forEach(i => App.setLaneHidden(i, true, 'empty lane (suggested, user confirmed)')); toast(L(`已剪除 ${empt.length} 条空泳道（Ctrl+Z 可撤销）`, `Removed ${empt.length} empty lane${empt.length > 1 ? 's' : ''} (Ctrl+Z to undo)`)); });
    $('btnIgnoreEmpty').onclick = () => { empt.forEach(i => ignoredEmpty.add(st.file.sha256 + ':' + i)); updateEmptyBar(); };
  }
  // cutting a marker lane removes the size reference: always ask. Resolves true when changed.
  async function toggleLaneHidden(i, hidden) {
    if (hidden && isMarkerLane(i) && !(await confirmDlg(L(`孔 ${i + 1} 是 Marker 泳道，剪除后成图上就没有分子量参照了。`, `Well ${i + 1} is a marker lane; removing it leaves the figure without a size reference.`), L('剪除', 'Remove'), true))) return false;
    App.setLaneHidden(i, hidden, 'manual');
    return true;
  }
  App.toggleLaneHidden = toggleLaneHidden;
  $('spliceGap').addEventListener('input', live(e => { S().style.spliceGapPt = +e.target.value; $('spliceGapV').textContent = e.target.value + ' pt'; }));
  $('spliceGap').addEventListener('change', done());

  /* ---------- 3 names (bulk) ---------- */
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
        toast(L(`名称有 ${names.length} 个，出图范围已向右扩展 ${extra} 孔`, `${names.length} names given: the figure range was extended by ${extra} well${extra > 1 ? 's' : ''} to the right`));
      }
    }
    lanes.forEach((li, k) => { if (k < names.length) S().lanes[li].name = names[k]; });
    $('laneBulk').value = '';
    App.commit();
    const n = Math.min(names.length, lanes.length);
    toast(L(`已填入 ${n} 个泳道名`, `Filled in ${n} lane name${n > 1 ? 's' : ''}`));
  }
  $('laneBulk').addEventListener('change', applyBulk);
  $('laneBulk').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.isComposing) { e.preventDefault(); applyBulk(); } });

  /* ---------- 4 markers ---------- */
  $('btnAutoMarkers').onclick = done(() => {
    App.autoMarkers();
    const n = S().markers.length;
    toast(n ? L(`找到 ${n} 个 Marker 泳道`, `Found ${n} marker lane${n > 1 ? 's' : ''}`) : L('出图范围内没找到明显的 Marker 泳道', 'No clear marker lane in the figure range'));
  });
  $('btnAddMarker').onclick = done(() => {
    const used = new Set(S().markers.map(m => m.lane));
    const cand = figLanes().filter(i => !used.has(i));
    const sel = App.selLane >= 0 && !used.has(App.selLane) ? App.selLane : cand[0];
    if (sel == null) { toast(L('出图范围内没有空闲泳道', 'No free lane in the figure range')); return; }
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
    App.busy(true, L('正在读取 Marker 图…', 'Reading the marker image…'));
    await new Promise(r => setTimeout(r, 30));
    try {
      const input = await App.readInput(f);
      App.setMarkerImage(input);
      const prev = S().markers.map(m => ({ lane: m.lane, ladderId: m.ladderId }));
      App.autoMarkers();
      if (!S().markers.length && prev.length) { S().markers = prev.map(m => App.newMarker(m.lane, m.ladderId)); App.matchMarkers(true); }
      App.commit();
      const n = S().markers.length;
      toast(n ? L(`已在 Marker 图上识别出 ${n} 个 Marker 泳道`, `Found ${n} marker lane${n > 1 ? 's' : ''} on the marker image`)
        : L('Marker 图上没找到明显的 Marker 泳道，可在第 4 步手动添加', 'No clear ladder lane on the marker image; add the marker lane in step 4'), 4200);
    } catch (err) { alertDlg(err.message); } finally { App.busy(false); }
  });
  $('btnMarkerImgDel').onclick = done(() => { App.clearMarkerImage(); App.matchMarkers(false); toast(L('已移除 Marker 图，Marker 条带改从胶图本身识别', 'Marker image removed; marker bands are read from the blot itself again')); });
  $('mkOverlay').addEventListener('change', () => G.Editor.draw());

  $('btnSaveLadder').onclick = () => {
    const name = $('customName').value.trim();
    const sizes = $('customSizes').value.split(/[,，\s]+/).map(Number).filter(v => v > 0);
    if (!name || sizes.length < 2) { alertDlg(L('请输入名称和至少 2 个条带大小', 'Enter a name and at least 2 band sizes')); return; }
    const lad = G.Ladders.saveCustom(name, sizes, App.kind());
    if (!G.Ladders.isFavorite(lad.id)) G.Ladders.toggleFavorite(lad.id);   // new custom ladders start as favourites
    if (S() && S().markers.length) { S().markers[0].ladderId = lad.id; App.matchMarkers(true); App.commit(); }
    renderFavs();
    toast(L('已保存自定义 Ladder（已加入常用）', 'Custom ladder saved (added to favourites)'));
  };
  /* favourites: biased first in auto-detection, listed first in menus */
  $('onlyFav').checked = !!App.prefs().onlyFavLadders;
  $('onlyFav').addEventListener('change', e => {
    App.setPref('onlyFavLadders', e.target.checked);
    toast(e.target.checked ? L('之后的自动识别只在常用型号中挑选（不吻合时回退全库）', 'Detection now picks from favourites only (falls back to all ladders if none fits)')
      : L('自动识别在全部型号中挑选（常用型号略优先）', 'Detection picks from all ladders (favourites slightly preferred)'));
  });
  function renderFavs() {
    const kind = App.kind(), favs = G.Ladders.favorites(kind), u = G.Ladders.KIND_UNIT[kind];
    $('favNote').textContent = favs.length ? L(`${favs.length} 个`, `${favs.length}`) : L('未设置', 'none');
    const eg = { bp: '5000,3000,2000,1000,500', nt: '6000,4000,3000,2000,1000,500', kDa: '250,130,100,70,55,35,25,15,10' }[u];
    $('customSizes').placeholder = L(`条带大小（${u}），逗号分隔：${eg}`, `Band sizes in ${u}, comma separated: ${eg}`);
    $('favList').innerHTML = G.Ladders.all(kind).map(l => `<div class="item"><button class="star${G.Ladders.isFavorite(l.id) ? '' : ' off'}" data-fav="${l.id}" title="${L('设为/取消常用', 'Add to / remove from favourites')}">★</button><span style="flex:1">${esc(l.name)}</span></div>`).join('');
    $('favList').querySelectorAll('[data-fav]').forEach(b => b.onclick = () => { G.Ladders.toggleFavorite(b.dataset.fav); renderFavs(); if (S()) renderMarkers(); });
    const custom = G.Ladders.all(kind).filter(l => l.custom);
    $('customList').innerHTML = custom.map(l => `<div class="item"><span style="flex:1">${esc(l.name)} <span class="h3-note">${L(`${l.sizes.length} 条`, `${l.sizes.length} bands`)}</span></span><button class="x" data-cdel="${l.id}" title="${L('删除', 'Delete')}">×</button></div>`).join('');
    $('customList').querySelectorAll('[data-cdel]').forEach(b => b.onclick = async () => {
      const used = S() && S().markers.some(m => m.ladderId === b.dataset.cdel);
      if (used) { toast(L('当前图正在使用这个型号，先给 Marker 换一个型号再删除', 'This ladder is in use; choose another ladder for the marker first')); return; }
      if (!(await confirmDlg(L('删除这个自定义 Ladder？', 'Delete this custom ladder?'), L('删除', 'Delete'), true))) return;
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
    $('markerList').innerHTML = st.markers.map((m, mi) => {
      const sc = m.score != null ? Math.round(m.score * 100) : null;
      const out = !r || m.lane < r[0] || m.lane > r[1];
      const shown = m.bands.filter(b => b.show).length;
      return `<div class="mk-card${out ? ' out' : ''}" data-mi="${mi}">
        <div class="mk-head"><span class="mk-badge">${L('孔', 'Well')} ${m.lane + 1}</span>
          ${out ? `<span class="h3-note">${L('不在出图范围', 'outside the figure')}</span>` : sc != null ? `<span class="mk-score${sc < 60 ? ' low' : ''}">${sc < 60 ? L('吻合度低，请核对型号', 'Poor fit — check the ladder') : L('吻合 ', 'Fit ') + sc + '%'}</span>` : ''}
          <button class="star${G.Ladders.isFavorite(m.ladderId) ? '' : ' off'}" data-f="fav" title="${L('把这个型号设为/取消常用（常用型号在自动识别时优先）', 'Add this ladder to / remove it from favourites (preferred during detection)')}">★</button>
          <button class="x" data-f="del" title="${L('不作为 Marker', 'Not a marker')}">×</button></div>
        <select data-f="ladder">${all.map(l => `<option value="${l.id}"${l.id === m.ladderId ? ' selected' : ''}>${G.Ladders.isFavorite(l.id) ? '★ ' : ''}${esc(l.name)}</option>`).join('')}</select>
        <div class="row2">
          <select data-f="side"><option value="auto">${L('标签：自动分侧', 'Labels: auto side')}</option><option value="left">${L('标签在左', 'Labels left')}</option><option value="right">${L('标签在右', 'Labels right')}</option></select>
          <select data-f="unit">${G.Ladders.unitsFor(kind).concat(G.Ladders.unitsFor(kind).includes(m.unit) ? [] : [m.unit]).map(u => `<option value="${u}">${u === 'auto' ? 'bp/kb' : u}</option>`).join('')}</select>
        </div>
        <details class="adv"><summary>${L(`条带（显示 ${shown}/${m.bands.length}）`, `Bands (${shown}/${m.bands.length} shown)`)}</summary>
          <div class="list">${m.bands.map((b, k) => `<div class="item"><label class="switch"><input type="checkbox" data-band="${k}" ${b.show ? 'checked' : ''}></label>
            <span style="flex:1">${b.bp} ${unit}${b.ref ? ' ★' : ''}</span><span class="tag ${b.manual ? 'man' : b.matched ? 'ok' : ''}">${b.manual ? L('手动', 'manual') : b.matched ? L('已对上', 'matched') : L('推测', 'predicted')}</span></div>`).join('')}</div>
          <div class="field inline"><button class="btn sm" data-f="thin">${L('精简标签', 'Thin labels')}</button><button class="btn sm ghost" data-f="match">${L('重新匹配', 'Re-match')}</button></div>
          <p class="hint">${L('某条带对错了：在原图上把那条黄线拖到正确位置，其余会围绕它重新匹配。', 'A band is wrong? Drag its yellow line on the image to the right place; the others re-fit around it.')}</p>
        </details>
      </div>`;
    }).join('') || `<p class="hint">${App.gelType().western
      ? L('出图范围内没有 Marker。化学发光图上看不到 Marker 时，载入下面的白光 Marker 图；或把一条泳道设为 Marker 后在原图上拖动黄线到各条带。', 'No marker in the figure range. If the ladder does not show on the chemiluminescence image, load the white-light marker image below, or mark a lane as the marker and drag its yellow lines onto the bands.')
      : L('出图范围内没有 Marker。点下面按钮把一条泳道设为 Marker。', 'No marker in the figure range. Use the button below to mark a lane as the marker.')}</p>`;
    $('markerList').querySelectorAll('.mk-card').forEach(card => {
      const m = st.markers[+card.dataset.mi], q = f => card.querySelector(`[data-f="${f}"]`);
      q('side').value = m.side; q('unit').value = m.unit;
      q('ladder').addEventListener('change', done(e => { m.ladderId = e.target.value; m.bands = []; App.prefLadder = m.ladderId; App.matchMarkers(false); }));
      q('side').addEventListener('change', done(e => { m.side = e.target.value; }));
      q('unit').addEventListener('change', done(e => { m.unit = e.target.value; App.prefUnit = m.unit; }));
      q('del').onclick = done(() => { st.markers.splice(+card.dataset.mi, 1); });
      q('fav').onclick = () => { const on = G.Ladders.toggleFavorite(m.ladderId); renderFavs(); renderMarkers(); toast(on ? L('已加入常用型号', 'Added to favourites') : L('已移出常用型号', 'Removed from favourites')); };
      q('thin').onclick = done(() => { m.bands.forEach(b => { b.show = true; }); App.thinMarkerLabels(m, false); });
      q('match').onclick = done(() => { m.bands = []; App.matchMarkers(false); });
      card.querySelectorAll('[data-band]').forEach(inp => inp.addEventListener('change', done(e => { m.bands[+inp.dataset.band].show = e.target.checked; })));
    });
  }

  /* ---------- lane list (advanced) ---------- */
  function renderLanes() {
    const st = S(), r = range(), empty = new Set(App.emptyLanes());
    $('laneList').innerHTML = st.lanes.map((l, i) => {
      const out = !r || i < r[0] || i > r[1];
      return `<div class="item${i === App.selLane ? ' sel' : ''}${out ? ' out' : ''}">
        <span class="idx">${i + 1}</span>
        <input type="text" data-i="${i}" value="${esc(l.name)}" placeholder="${isMarkerLane(i) ? 'M' : L('名称', 'Name')}">
        ${empty.has(i) ? `<span class="tag" title="${L('几乎没有条带', 'almost no bands')}">${L('空', 'empty')}</span>` : ''}
        <label class="switch" title="${L('取消 = 从成图剪除（自动加拼接间隙）；选中泳道后按 H 也可切换', 'Untick = remove from the figure (splice gap added); or select the lane and press H')}"><input type="checkbox" data-h="${i}" ${l.hidden ? '' : 'checked'}>${L('显示', 'Show')}</label>
        <button class="x" data-del="${i}" title="${L('删除这条泳道（误识别时用）', 'Delete this lane (if it was detected by mistake)')}">×</button></div>`;
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
    $('laneList').querySelectorAll('[data-del]').forEach(b => b.onclick = done(() => { App.removeLane(+b.dataset.del); App.selLane = -1; toast(L('已删除泳道（Ctrl+Z 可撤销）', 'Lane deleted (Ctrl+Z to undo)')); }));
    $('laneCountNote').textContent = L(`${st.lanes.length} 孔`, `${st.lanes.length} wells`);
    if (document.activeElement !== $('cropLaneN')) $('cropLaneN').value = r ? r[1] - r[0] + 1 : '';
    // range selects
    const opts = sel => st.lanes.map((l, i) => laneOpt(i, sel)).join('');
    $('rangeA').innerHTML = opts(r ? r[0] : 0);
    $('rangeB').innerHTML = opts(r ? r[1] : st.lanes.length - 1);
  }

  /* ---------- annotation list ---------- */
  function renderAnno() {
    const st = S(), rows = [];
    st.groups.forEach((g, k) => rows.push(`<div class="item"><span class="kind">${L('分组', 'Group')}</span>
      <span class="idx" style="width:auto">${Math.min(g.from, g.to) + 1}–${Math.max(g.from, g.to) + 1}</span>
      <input type="text" data-g="${k}" value="${esc(g.text)}" placeholder="${L('分组文字', 'Group label')}"><button class="x" data-gdel="${k}">×</button></div>`));
    st.arrows.forEach((a, k) => rows.push(`<div class="item${k === App.selArrow ? ' sel' : ''}"><span class="kind">${L('箭头', 'Arrow')}</span>
      <button class="btn sm ghost" data-aed="${k}" style="flex:1;justify-content:flex-start">${esc(App.arrowLabel(a) || L('（未命名）', '(unnamed)'))}</button><button class="x" data-adel="${k}">×</button></div>`));
    st.conditions.forEach((c, r) => rows.push(`<div class="item"><span class="kind">${L('条件', 'Condition')}</span>
      <input type="text" data-c="${r}" value="${esc(c.name)}" placeholder="${L('条件名，如 EcoRI', 'Condition, e.g. EcoRI')}"><button class="x" data-cdel="${r}">×</button></div>`));
    st.strips.forEach((t, k) => rows.push(`<div class="item"><span class="kind">${L('分条', 'Strip')}</span>
      <input type="text" data-st="${k}" value="${esc(t.label)}" placeholder="${L('名称，如 p53、GAPDH', 'Name, e.g. p53, GAPDH')}"><button class="x" data-stdel="${k}">×</button></div>`));
    const box = $('annoList');
    box.innerHTML = rows.join('');
    box.querySelectorAll('[data-st]').forEach(inp => { const t = st.strips[+inp.dataset.st]; inp.addEventListener('input', live(e => { t.label = e.target.value; })); inp.addEventListener('change', done()); });
    box.querySelectorAll('[data-stdel]').forEach(b => b.onclick = done(() => { st.strips.splice(+b.dataset.stdel, 1); }));
    box.querySelectorAll('[data-g]').forEach(inp => { const g = st.groups[+inp.dataset.g]; inp.addEventListener('input', live(e => { g.text = e.target.value; })); inp.addEventListener('change', done()); });
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
  $('labelAngle').addEventListener('change', done(e => { S().style.labelAngle = e.target.value; }));
  ['unitHeader', 'laneNumbers', 'frame', 'groupTicks'].forEach(id => $(id).addEventListener('change', done(e => { S().style[id] = e.target.checked; })));
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
    toast(L(`成图总宽 ${tot} mm（凝胶 ${st.gelWidthMm} mm）`, `Figure width ${tot} mm (gel ${st.gelWidthMm} mm)`));
  });
  $('btnResetLayout').onclick = done(() => { App.resetLayout(); toast(L('版式已重置为默认（Ctrl+Z 可撤销）', 'Layout reset to defaults (Ctrl+Z to undo)')); });
  function updateDpiLine() {
    const eff = Math.round(App.effectiveDpi()), safe = App.maxSafeWidthMm(300), w = App.gelWidthMm();
    $('dpiLine').innerHTML = eff >= 300
      ? `${L('胶图有效分辨率', 'Effective gel resolution')} <span class="ok">${eff} dpi</span>`
      : `${L('胶图有效分辨率', 'Effective gel resolution')} <span class="bad">${eff} dpi</span>` +
        L(`（&lt;300）：凝胶宽不超过 <b>${safe} mm</b> 才能保证 300 dpi`, ` (&lt;300): keep the gel at most <b>${safe} mm</b> wide for 300 dpi`) +
        (w > safe ? ` <button class="btn sm" id="btnSafeW">${L(`改为 ${safe} mm`, `Use ${safe} mm`)}</button>` : '');
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
    set('stImage', (st.rotation ? L(`已转正 ${st.rotation}° · `, `rotated ${st.rotation}° · `) : '')
      + (st.levels.invert ? L('白底黑带', 'inverted') : L('黑底白带', 'raw'))
      + (st.saturatedInCrop ? L(' · 有过曝', ' · saturated') : ''), st.saturatedInCrop ? 'warn' : '');
    set('stRange', r ? L(`孔 ${r[0] + 1}–${r[1] + 1} · ${fl.length} 条`, `wells ${r[0] + 1}–${r[1] + 1} · ${fl.length} lanes`) : '');
    set('stNames', `${named}/${fl.length}`);
    set('stMarker', visMk.length ? (lowMk.length ? L('请核对型号', 'check ladder') : String(visMk.length)) : L('无', 'none'), lowMk.length || !visMk.length ? 'warn' : '');
    const secs = document.querySelectorAll('#sections .sec');
    const state = [true, !!r, named >= fl.length && fl.length > 0, visMk.length > 0 && !lowMk.length];
    secs.forEach((s, i) => { s.classList.toggle('done', !!state[i]); s.classList.remove('todo'); });
    const firstTodo = state.findIndex(v => !v);
    if (firstTodo >= 0 && secs[firstTodo]) secs[firstTodo].classList.add('todo');
    // coach: the single most useful next step
    let msg, ok = false;
    if (!r) msg = L('在原图上拖红框，或在左侧"出图范围"选择泳道', 'Drag the red box on the image, or choose wells under "Lanes in figure"');
    else if (named < fl.length) msg = L(`下一步：在右侧成图上<b>点灰色的泳道号</b>输入名称，回车跳到下一条（还差 ${fl.length - named} 条）`,
      `Next: <b>click a grey lane number</b> on the figure and type its name; Enter moves on (${fl.length - named} to go)`);
    else if (!visMk.length) msg = App.gelType().western
      ? L('出图范围里没有 Marker：第 4 步加 Marker 泳道，或载入白光 Marker 图', 'No marker in the figure: add the marker lane in step 4, or load the white-light marker image')
      : L('出图范围里没有 Marker：左侧第 4 步把 Marker 泳道加上', 'No marker in the figure: add the marker lane in step 4 on the left');
    else if (lowMk.length) msg = L(`孔 ${lowMk[0].lane + 1} 的 Marker 与所选 Ladder 吻合度低，<b>请核对型号</b>`, `The marker in well ${lowMk[0].lane + 1} fits the chosen ladder poorly — <b>check the ladder</b>`);
    else if (App.isExample) { msg = L('这是合成示例 —— <b>拖入你自己的图片</b>即可开始', 'This is a synthetic example — <b>drop your own image</b> to start'); ok = true; }
    else { msg = L('已可导出 —— 右上角<b>导出 PNG</b>；需要分组、箭头、分条、定量时用左侧"标注"和"定量分析"', 'Ready — <b>Export PNG</b> at the top right; add groups, arrows, strips or densitometry on the left'); ok = true; }
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
    document.querySelectorAll('#polSeg .pol-note').forEach(n => { n.textContent = (n.dataset.k === '1') === !st.bright ? L('原样', 'as imaged') : L('反色', 'inverted'); });
    $('lvBlack').value = toSlider(st.levels.black); $('lvWhite').value = toSlider(st.levels.white);
    $('lvBlackV').textContent = pct(st.levels.black); $('lvWhiteV').textContent = pct(st.levels.white);
    $('rot').value = st.rotation; $('rotNum').value = st.rotation; $('rotV').textContent = st.rotation + '°';
    $('rotAuto').textContent = App.autoRotation != null ? L(`自动检测 ${App.autoRotation}°`, `auto ${App.autoRotation}°`) : '';
    const ft = G.Export.flipText(st);
    $('flipNote').textContent = ft ? L({ 'rotated by 180°': '已旋转 180°', 'flipped horizontally': '已左右翻转', 'flipped vertically': '已上下翻转' }[ft], ft) : '';
    $('btnFlipV').classList.toggle('on', !!st.flip.v); $('btnFlipH').classList.toggle('on', !!st.flip.h);
    $('invNote').textContent = App.invertInherited ? L(`条带明暗沿用了你上次在这类实验中的选择（${dark ? '白底暗带' : '黑底亮带'}），可在上方切换`,
      `Band look follows your last choice for this experiment (${dark ? 'dark bands' : 'bright bands'}); switch it above`) : '';
    $('stripGap').value = y.stripGapPt != null ? y.stripGapPt : 3;
    syncTypeHints();
    const hasMk = App.hasMarkerImage();
    $('btnMarkerImgDel').classList.toggle('hidden', !hasMk); $('mkOverlayWrap').classList.toggle('hidden', !hasMk);
    $('btnMarkerImg').textContent = hasMk ? L('更换 Marker 图…', 'Replace marker image…') : L('载入 Marker 图…', 'Load marker image…');
    $('mkImageText').textContent = hasMk ? L(`Marker 条带取自：${st.markerImage.name}`, `Marker bands are read from: ${st.markerImage.name}`)
      : L('化学发光图上看不到 Marker？载入同一位置拍的白光 / 比色图，只用来定位 Marker 条带，成图仍是印迹图本身。', 'Ladder invisible on the chemiluminescence image? Load the white-light / colorimetric image taken in the same position. It is used only to find the marker bands; the figure still shows the blot.');
    $('spliceGap').value = y.spliceGapPt != null ? y.spliceGapPt : 1.5; $('spliceGapV').textContent = $('spliceGap').value + ' pt';
    $('laneNumberMode').value = y.laneNumberMode || 'well';
    updateClipLine(); updateDpiLine(); updateEmptyBar();
    $('gamma').value = st.levels.gamma; $('gammaUnlock').checked = st.levels.gamma !== 1; $('gamma').disabled = st.levels.gamma === 1 && !$('gammaUnlock').checked;
    $('autoWidth').checked = !!y.autoWidth; $('gelW').value = App.gelWidthMm(); $('gelW').disabled = !!y.autoWidth;
    $('fontPt').value = y.fontPt; $('lineW').value = y.lineWidthPt; $('labelAngle').value = String(y.labelAngle);
    ['unitHeader', 'laneNumbers', 'frame', 'groupTicks'].forEach(id => { $(id).checked = !!y[id]; });
    $('spliceStyle').value = y.spliceStyle; $('panelLetter').value = y.panelLetter || '';
    $('dpiTop').value = String(y.dpi);
    $('stLayout').textContent = `${App.gelWidthMm()} mm · ${y.fontPt} pt`;
    $('imgChipName').textContent = App.isExample ? L('示例：', 'Example: ') + App.gelType().name() : st.file.name;
    $('imgChip').title = `${App.src.w} × ${App.src.h} px · ${st.file.bits}-bit${st.file.dpi ? ' · ' + Math.round(st.file.dpi) + ' dpi' : ''}` + L('（点击更换图片）', ' (click to replace)');
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
    ctx.fillStyle = 'rgba(47,111,235,.16)'; ctx.fillRect(bx, 0, wx - bx, H);
    ctx.fillStyle = '#2f6feb'; ctx.fillRect(bx - 1, 0, 2, H); ctx.fillRect(wx - 1, 0, 2, H);
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
    $('angleInfo').textContent = st.style.labelAngle === 'auto' ? L(`当前 ${f.angle}°`, `now ${f.angle}°`) : '';
    showWarnings(f.warnings);
    // legend suggestions are English: they go into the manuscript
    const hints = G.Export.legendHints(st);
    $('legendHints').innerHTML = hints.length ? `<b>${L('图注可参考', 'Legend notes')}</b>` + hints.map(esc).join('<br>') : '';
    if (G.FigEdit) G.FigEdit.afterRender(f);
  }

  function renderPanel() { renderLanes(); renderMarkers(); renderAnno(); }

  App.on(what => {
    if (!S()) return;
    if (what === 'loaded') { $('emptyState').classList.add('hidden'); $('draftBox').classList.add('hidden'); $('sections').classList.remove('hidden'); histCache = null; renderExposures(); }
    if (what === 'refresh') { livePreview(); return; }
    clearTimeout(liveTimer);
    if (what === 'select') { renderLanes(); renderAnno(); return; }
    syncControls(); renderPanel(); updateStatus(); updatePreview();
  });
  window.addEventListener('resize', () => { if (S()) { updatePreview(); drawHisto(); } });

  Object.assign(UI, { toast, updatePreview, figLanes, range, esc, lastFig: () => lastFig, preflight, renderExposures, alert: alertDlg, confirm: confirmDlg, loadExample, load });
  G.UI = UI;
  $('btnUndo').disabled = $('btnRedo').disabled = true;
  syncTypeHints();

  /* first visit: open a worked example so the tool shows what it does; a saved draft is offered instead */
  async function startup() {
    const q = new URLSearchParams(location.search);
    if (q.get('demo') === '1' || q.get('src') || q.get('blank') === '1') return;
    if (q.get('example')) { loadExample(q.get('example')); return; }
    const d = await App.peekDraft();
    if (S()) return;
    if (d) offerDraft(); else loadExample('western');
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

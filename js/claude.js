/* "Draft legend and methods with Claude". Available only when the page runs as a Claude artifact
 * (the `sample` capability: the viewer's own Claude account answers, no API key is involved).
 * Only a text summary of the figure is sent; the image never leaves the browser. */
(function (G) {
  'use strict';
  const App = G.App, $ = id => document.getElementById(id);
  let sample = null, ctl = null, lastText = '';

  G.Host.sample().then(fn => { sample = fn; sync(); });
  function sync() { $('btnClaude').classList.toggle('hidden', !sample || !App.S); }
  App.on(what => { if (what === 'loaded' || what === 'change') sync(); });

  // facts about the figure, nothing invented: what Claude may use
  function summary() {
    const S = App.S, A = App, k = A.clipStats(), r = A.laneRange(), unit = A.baseUnit();
    const fig = A.figureLanes(), mk = new Map(S.markers.map(m => [m.lane, m]));
    const out = {
      experiment: A.gelType().name(), sizeUnit: unit, software: `${A.NAME} ${A.VERSION} (based on GelFigure)`,
      lanesInFigureLeftToRight: fig.map((i, n) => ({ position: n + 1, well: i + 1, name: S.lanes[i].name || null,
        marker: mk.has(i) ? (G.Ladders.get(mk.get(i).ladderId) || {}).name : undefined })),
      groups: S.groups.map(g => ({ label: g.text, wells: [Math.min(g.from, g.to) + 1, Math.max(g.from, g.to) + 1] })),
      conditionRows: S.conditions.map(c => ({ name: c.name, perLane: fig.map(i => c.values[i] || '') })),
      arrows: S.arrows.map(a => ({ label: A.arrowLabel(a) })),
      strips: S.strips.map(t => t.label || null),
      imageProcessing: {
        sourceBitDepth: S.file.bits, rotationDeg: S.rotation, orientation: G.Export.flipText(S) || 'as imaged', contrast: 'linear, whole image', gamma: S.levels.gamma,
        inverted: !!S.levels.invert, removedLanes: S.lanes.map((l, i) => (l.hidden ? i + 1 : null)).filter(v => v != null),
        bandEndClippedFracInCrop: +k.sensorFrac.toFixed(5), saturation: A.satReport().text, effectiveGelDpi: Math.round(A.effectiveDpi()), figureWells: r ? [r[0] + 1, r[1] + 1] : null,
        markerFromWhiteLightImage: A.hasMarkerImage()
      },
      legendNotes: G.Export.legendHints(S)
    };
    if (S.quant.rows.length) {
      const R = G.Quant.measure(A);
      out.densitometry = {
        description: G.Quant.describe(A, R),
        output: R.output, referenceBand: R.normBand >= 0 ? R.rows[R.normBand].name : null, referenceLane: R.ref != null && S.lanes[R.ref] ? (S.lanes[R.ref].name || `lane ${R.ref + 1}`) : null,
        values: R.rows.map((row, kk) => ({ band: row.name, perLane: R.lanes.map((i, j) => ({ lane: R.names[j], value: R.shown[kk][j] == null ? null : +R.shown[kk][j].toPrecision(4), unavailable: R.shownWhy[kk][j] || undefined, flags: [G.Quant.flagText(R.cells[kk][j].flags, R.cells[kk][j]), R.shownCaveat ? R.shownCaveat[kk][j] : null].filter(Boolean).join('; ') || undefined })) })),
        lanesWithClippedPixels: R.saturatedLanes.map(i => i + 1), lanesNeedingReview: (R.reviewLanes || []).map(i => i + 1), lanesReviewedAndKeptByUser: (R.checkedLanes || []).map(i => i + 1)
      };
    }
    return out;
  }
  function buildPrompt() {
    return [
      `You help a biologist write the figure legend and the methods text for a ${App.gelType().name()} figure prepared with GelGrapher.`,
      'Use ONLY the facts in the JSON below. Where information is missing (sample amounts, antibodies and dilutions, gel percentage, imaging system, exposure), write a placeholder in square brackets such as [primary antibody, dilution]. Never invent results, conditions or numbers. Describe densitometry values only if they are present, without claiming statistical significance (there is one blot). Use densitometry.description word for word in substance: do not upgrade a lane-signal normalization to total-protein normalization, do not call a reference band validated, call the noise thresholds estimated (not assay limits), and mention values flagged below the 10σ threshold, needing review, or with clipped pixels as such; never present inverted grey values as optical density or amounts.',
      'Reply in plain text without Markdown, with exactly these two headings on their own lines:',
      'Figure legend',
      '(a one-sentence title, then 2 to 5 sentences: what the lanes show, the marker, arrows or strips, the normalization if any, and every disclosure in legendNotes)',
      'Methods: image processing and quantification',
      '(one paragraph in the past tense: acquisition with placeholders, processing in GelGrapher with only linear whole-image contrast adjustment, rotation, any removed lanes or omitted regions, and the densitometry method if present)',
      '',
      JSON.stringify(summary(), null, 1)
    ].join('\n');
  }

  function note(t) { $('claudeNote').textContent = t || ''; }
  async function run(fresh) {
    if (!sample || !App.S) return;
    if (ctl) ctl.abort();
    ctl = new AbortController();
    const out = $('claudeOut');
    out.textContent = 'Thinking…'; note('');
    $('claudeStop').disabled = false; $('claudeAgain').disabled = true; $('claudeCopy').disabled = true;
    try {
      const r = await sample(buildPrompt(), { signal: ctl.signal, cache: fresh ? false : true, onText: ({ text }) => { out.textContent = text; } });
      lastText = r.text; out.textContent = r.text;
      if (r.truncated) note('The answer was cut short');
    } catch (e) {
      const code = e && e.code;
      if (e && e.text) { out.textContent = e.text; lastText = e.text; } else if (code !== 'cancelled') out.textContent = '';
      if (code === 'not_granted' || code === 'sampling_disabled' || code === 'not_declared' || code === 'capability_disabled' || code === 'capability_removed') {
        note('Claude is not available to this page'); sample = null; sync();
      } else if (code === 'rate_limited') note('Too many requests or usage limit reached; try again later');
      else if (code === 'session_expired') note('Sign in to Claude again');
      else if (code === 'refused') note('Claude declined this request');
      else if (code !== 'cancelled') note('Claude could not answer; you can try again');
    } finally {
      ctl = null;
      $('claudeStop').disabled = true; $('claudeAgain').disabled = false; $('claudeCopy').disabled = !lastText;
    }
  }
  $('btnClaude').onclick = () => { $('claudeDlg').classList.remove('hidden'); lastText = ''; run(false); };
  $('claudeAgain').onclick = () => run(true);
  $('claudeStop').onclick = () => { if (ctl) ctl.abort(); };
  $('claudeCopy').onclick = async () => {
    try { await navigator.clipboard.writeText(lastText); G.UI.toast('Copied'); }
    catch (e) { const rg = document.createRange(); rg.selectNodeContents($('claudeOut')); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); note('Press Ctrl+C to copy the selected text'); }
  };
  $('btnClaudeClose').onclick = () => { if (ctl) ctl.abort(); $('claudeDlg').classList.add('hidden'); };
})(window);

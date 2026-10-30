#!/usr/bin/env node
/* Runs GelGrapher's two self-tests in real browsers through Playwright:
 *   test/test.html                       engine: TIFF decoding, deskew, crop, lanes, ladders, rendering
 *   index.html?demo=1&uitest=1&draft=1    interface: editing, rotation, lane removal, exports, projects, drafts…
 * The app is served from a throw-away local HTTP server (no network access is needed).
 * Usage: node tests/run.mjs [--browser=chromium,firefox,webkit] [--channel=msedge] */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const browsers = (arg('browser') || 'chromium,firefox,webkit').split(',').filter(Boolean);
const channel = arg('channel');   // e.g. msedge to use an installed Edge instead of Playwright's Chromium
const ENGINES = { chromium, firefox, webkit };

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.json': 'application/json' };
let swVersion = 'test1';   // what the served sw.js is stamped with; the PWA test bumps it to simulate a deployment
function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (rel === '/sw.js') { res.end(fs.readFileSync(file, 'utf8').replace(/__VERSION__/g, swVersion)); return; }
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// interface self-test expectations: [description, predicate on the result object]
const UI_CHECKS = [
  ['no exception', r => !r.error],
  ['Enter moves to the next lane', r => r.enterNext.name1 === 'Sample A' && r.enterNext.editorOpen],
  ['IME Enter does not commit', r => r.imeEnter.stillEditing],
  ['Backspace/Delete never delete lanes while typing', r => r.backspace.lanesBefore === r.backspace.lanesAfter],
  ['arrow snaps to the band and gets a size', r => Math.abs(r.arrow.snappedTo - r.arrow.band) <= 1 && /\d/.test(r.arrow.label)],
  ['narrowing the range keeps names', r => r.rangeMiddle.lanesUnchanged],
  ['condition cell cycles', r => r.cond === '+'],
  ['re-detect in crop fixes bad lanes', r => r.cropRedetect.maxErrRedetect != null && r.cropRedetect.maxErrRedetect < 3 && r.cropRedetect.namesKept && r.cropRedetect.outsideUntouched],
  ['even spacing matches the true lanes', r => r.cropRedetect.maxErrEven != null && r.cropRedetect.maxErrEven < 3],
  ['style template round trip', r => r.template.ok],
  ['rotation is reversible', r => r.rotationCarry.every(x => x.roundTripLane < 2.5 && x.roundTripBand < 3)],
  ['carried bands agree with a fresh match', r => r.rotationCarry.every(x => x.bandVsScratchMatch < 3)],
  ['H removes and restores a lane; marker lane asks first', r => r.empty.hOnLane && r.empty.hBack && r.empty.markerNeedsConfirm],
  ['empty lane is suggested', r => r.empty.emptyWells.length > 0 && r.empty.barShown],
  ['group line runs on across a splice; the option breaks it', r => r.groupSplit.bridged === 0 && r.groupSplit.extraLines === r.groupSplit.expected],
  ['extrapolated size marked ≈', r => r.extrap.outside.startsWith('≈') && !r.extrap.inside.startsWith('≈') && r.extrap.info === true],
  ['reset everything returns to the import state', r => r.resetAll.equalsInitial && r.resetAll.hist === 1],
  ['custom ladder travels with the template', r => r.templateLadder.carried === 1 && r.templateLadder.present && r.templateLadder.markerUses],
  ['wrong favourite falls back to the full library', r => JSON.stringify(r.favorites.fallback.picked) === JSON.stringify(r.favorites.truth) && !!r.favorites.fallback.notice],
  ['favourites keep the right ladder', r => JSON.stringify(r.favorites.withFav) === JSON.stringify(r.favorites.truth)],
  ['PNG carries pHYs, sRGB and iTXt once', r => ['pHYs', 'sRGB', 'iTXt'].every(c => r.export.pngChunks.filter(x => x === c).length === 1)],
  ['TIFF export is lossless with 300 dpi', r => r.export.tiffMaxDiff === 0 && Math.round(r.export.tiffDpi) === 300],
  ['project file round trip', r => r.project.same],
  ['best exposure is picked', r => r.exposures.picked === 'exp_x0.7.tif'],
  ['switching exposure keeps annotations', r => r.exposures.switched.kept && r.exposures.nameKept === 'keepme' && r.exposures.stripItems === 3],
  ['draft is saved and restored', r => r.draft && r.draft.restored && r.draftDropped, ['draft', 'draftDropped']],
  // GelGrapher additions
  ['experiment type switches ladders and units', r => r.gelType.protein.kDa && r.gelType.back.bp],
  ['strips stack chosen regions and are disclosed', r => r.strips.ok],
  ['densitometry matches the synthetic truth', r => r.quant.maxErr < 0.05 && r.quant.chart && r.quant.csvLines > 4],
  ['vector PDF is valid and keeps Greek letters as text', r => r.pdf.ok],
  ['ZIP round trip', r => r.zip.ok],
  ['project keeps the Western marker image', r => r.markerProject.ok],
  ['Western example: ladder, strips and densitometry', r => r.western.ok],
  ['favourite ladders follow the loaded gel\'s kind', r => r.western.favsFollowKind, ['western']],
  ['SDS-PAGE example: ladder lane found among lysates', r => r.sds.ok],
  ['flips carry annotations and undo each other', r => r.flip.relFollowsV && r.flip.namesStay && r.flip.relH && r.flip.identity, ['flip']],
  ['arrow labels on one side are spread apart', r => r.arrowSpread.ok, ['arrowSpread']],
  ['two rows of wells: found, analysed separately, annotations kept per row', r => r.rows.ok && r.rows.bottomKept, ['rows']],
  ['marker band list stays open while several bands are ticked', r => r.bandTicks.ok && r.bandTicks.scrollKept && r.bandTicks.boxes, ['bandTicks']],
  ['dividers resize the panel and the stage, remember it, and reset on double-click', r => r.splitters.ok, ['splitters']],
  ['library keeps the gel with its edits, renames, reopens, closes and removes it', r => r.library.ok, ['library']],
  ['overview tour: targets, keyboard, remembered as seen', r => r.tour.ok, ['tour']],
  ['lessons: nothing starts by itself; short lessons by goal on a practice copy, worded for the experiment, one action per card that waits for it; Already correct / Not applicable, Why?, progress remembered, the measuring lesson in order, a lesson on the user\'s gel undone on request', r => r.lessons.ok, ['lessons']],
  ['"all" / "none" picks in the band and lane lists', r => r.picks.ok, ['picks']],
  ['print page and exports: the legend notes under the figure only when asked for', r => r.print.ok, ['print']],
  ['densitometry: a two-fold dilution reads two-fold in the default whole-box measure (not in the thresholded one); boxes below their LOQ are flagged, never a reference or a denominator; the figure box and figure lanes change no number; methods and CSV describe the same measure', r => r.densMode.ok, ['densMode']],
  ['the image edits one layer at a time, chosen with the Editing switch (or a tool that makes boxes or strips); showing or activating a window never changes it', r => r.layers.ok, ['layers']],
  ['the figure column follows the panel step: steps 1-5 the figure, step 6 the Densitometry view', r => r.followView.ok, ['followView']],
  ['long group labels wrap, shrink or stay on one line; typed line breaks', r => r.groupFit.ok, ['groupFit']],
  ['typeface allowlist (SVG, measurement, PDF) and a custom lane-name angle', r => r.fonts.ok, ['fonts']],
  ['raster exports checked against the canvas limit; banded TIFF render matches', r => r.raster.ok, ['raster']],
  ['editable PowerPoint: text boxes per label, cropped gel pictures per block, valid package', r => r.pptx.ok, ['pptx']],
  ['analysis window under the figure: divider, closing, reopening, active window; plot options, normalization modes, package ZIP', r => r.analysis.ok, ['analysis']],
  ['several lane lines selected and moved together, spread between two; a typed arrow size moves the arrow', r => r.multiSel.ok, ['multiSel']],
  ['"+ Add lane" places a lane at the click, Shift keeps it armed; lane names and the paste box are in step 2, Marker is step 3', r => r.addLane.ok, ['addLane']],
  ['a gel small in a large frame: the red box is found coarse to fine on the gel with every lane, its rows framed on the bands', r => r.smallInFrame.ok, ['smallInFrame']],
  ['a strip of two or three lanes finds exactly its lanes; the lane-fix fold is two rows of titled tools', r => r.strip.ok, ['strip']],
  ['detected is not confirmed: the ladder card states matched bands and range and asks for confirmation (legend, log, step state follow); sizes interpolate between ladder lanes; lane roles; the low-signal prompt; the Original view; one export dialog with a complete archive; the profile reads out a box', r => r.review.ok, ['review']],
  ['saturation from the original pixels at the band end, where the file clips: dark bands at black, 12-bit data in a 16-bit file, floating point (cannot tell), colour (warned); the marker image shares the blot\'s geometry and its offset is measured', r => r.saturation.ok, ['saturation']],
  ['a remembered ladder with one band more than the gel\'s does not stick: the library is checked and the ladder fitting every band wins; a perfect usual ladder stays', r => r.ladderRecheck.ok, ['ladderRecheck']],
  ['the ladder library is well formed: unique ids, sizes largest first, reference bands among the sizes, catalogue numbers, earlier ids still open; one ladder\'s loading formats count once in the search, a starred one stands for them; legends keep a standard\'s range', r => r.ladderLibrary.ok, ['ladderLibrary']],
  ['geometry correction: Auto at load corrects a keystoned gel (lanes parallel within 2 %) with every lane and the red box framed beside the outer lanes, seg / legend / log show it, rotation and undo carry it, Off restores, Manual box maps a trapezoid, a hand-placed lane survives a box change, the detection polarity can be overridden', r => r.keystone.ok, ['keystone']],
  ['densitometry results open in the figure column', r => r.quantView.ok, ['quantView']],
  ['densitometry regressions (software checks on synthetic images, not experimental validation): equal amounts read equal however wide the band; a broad band read low by the end-row background is flagged and restored by local regions and a region as tall as the band; signed blanks unbiased; a two-fold series reads two-fold; clipping flagged and hatched; neighbours and shifted targets flagged; dark = bright; display changes no value; regions fixed through rotation, geometry, flips, crop, hiding, lane order, save / reopen, undo / redo; explicit edits counted; one result in table, profile, CSV, clipboard, log, methods and chart; unavailable values explained; pixels counted once', r => r.densV2.ok, ['densV2']],
  ['manual integration on the lane profile: a user-defined baseline gives the area above it exactly, is marked and disclosed (table, CSV, log, methods, legend), a reset and undo take it back, copied limits with an endpoint baseline on each lane\'s own profile; a drag changes nothing until Edit baseline, then draws a draft, a handle moves an end, Apply sets it, Use automatic background keeps the limits; the editing row stays put; the chart fills the window', r => r.manualInt.ok, ['manualInt']],
  ['measurement correctness (follow-up review): copying limits keeps each lane\'s background; an endpoint baseline whose ends hold band stays flagged with its reasons; existing drawn baselines kept unless replacing is asked; a drawn baseline keeps its own coverage checks and a sensitivity check; unknown noise is never a passed check (missing, too few, contaminated samples; ratios marked unverified; CSV and methods say so); frames keyed by their whole transform (save / reopen, undo / redo); warm and cold caches agree, overlaps seen across frames; total-lane denominators independent of band order, deletion, renaming, new bands and the analysis area; narrow and full lane resets; re-placements keep or announce drawn baselines; exports independent of the output shown; a specification that recomputes the values', r => r.correctness.ok, ['correctness']],
  ['the owner\'s notes (2026-10-30): a tool\'s instruction sits above its window, never over the figure or the image; on the Measurement regions layer the lanes do not respond and each box\'s drawn edges are its handles; a band\'s edge (drag or Height) moves drawn baselines\' limits along their line; Edit baseline never moves the plot, its typed positions folded unless opened from the keyboard, the axes fixed while drawing; flagged lanes say what to check, Mark as checked takes them off the list (kept in CSV, log and methods; back after any change to the lane), Next to review; the profile drawn when it becomes visible', r => r.notes.ok, ['notes']],
  ['profile controls: manual integration only in Edit baseline mode, complete by keyboard, Escape from anywhere, a snap option, Use automatic background keeps the limits, a full reset says what it removes; bulk changes scoped, previewed and undone at once; comparison on the band\'s rows with a legend; total-lane regions stated; notifications over the image editor; touch scrolls the profile unless editing', r => r.profileUI.ok, ['profileUI']],
  ['densitometry workspace: an earlier-method analysis keeps its numbers until updated on request (adding a band asks); Measure bands as apart from Display; the lane table\'s columns and names; why a lane is not measured; the analysis area and band height edited explicitly; one instruction per tool; dialogs hold and return the focus; the broad-band lesson', r => r.workspace.ok, ['workspace']],
  ['less text, larger type: Size ladder and Lanes shown, finished steps folded to a summary (a lesson unfolds what it needs), a key to the lines on the image, the figure at printed size, one filled button in the export window with its resolution, the More menu', r => r.compact.ok, ['compact']],
  ['settings navigation reveals and focuses each section; keyboard shortcuts, method details and lessons; review counts stay visible, optional advice survives redraws, navigation leaves measurements unchanged', r => r.hierarchy.ok, ['hierarchy']]
];

// Chromium: a Playwright version newer than the browsers installed under PLAYWRIGHT_BROWSERS_PATH (as in
// Claude Code cloud sessions, which preinstall one Chromium and skip downloads) falls back to that browser
async function launch(name) {
  const opts = channel && name === 'chromium' ? { channel } : {};
  try { return await ENGINES[name].launch(opts); }
  catch (e) {
    const exe = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || path.join(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers', 'chromium');
    if (name !== 'chromium' || channel || !fs.existsSync(exe)) throw e;
    console.log(`  (bundled Chromium missing; using ${exe})`);
    return ENGINES[name].launch({ executablePath: exe });
  }
}

async function runIn(name, base) {
  const out = { browser: name, results: [], ok: true };
  const fail = (what, detail) => { out.ok = false; out.results.push(['FAIL', what, detail]); };
  const pass = what => out.results.push(['ok', what]);
  const browser = await launch(name);
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 960 } });
    const watch = page => {
      const errs = [];
      page.on('pageerror', e => errs.push(String(e)));
      page.on('console', m => { if (m.type() === 'error' && /Content.Security.Policy|Refused to/i.test(m.text())) errs.push(m.text()); });
      return errs;
    };

    // engine self-test
    {
      const page = await ctx.newPage(), errs = watch(page);
      await page.goto(`${base}/test/test.html`);
      await page.waitForFunction(() => /"allOk"/.test(document.getElementById('out').textContent), null, { timeout: 180000 });
      const r = JSON.parse(await page.textContent('#out'));
      r.allOk ? pass('engine self-test') : fail('engine self-test', JSON.stringify(r).slice(0, 600));
      if (errs.length) fail('engine page errors', errs.join(' | '));
      await page.close();
    }
    // interface self-test
    {
      const page = await ctx.newPage(), errs = watch(page);
      await page.goto(`${base}/index.html?demo=1&uitest=1&draft=1`);
      await page.waitForFunction(() => document.title.startsWith('UITEST '), null, { timeout: 300000 });
      const r = JSON.parse((await page.title()).slice(7));
      // a third element names the result fields to print when the check fails
      for (const [what, ok, keys] of UI_CHECKS) {
        let good = false;
        try { good = !!ok(r); } catch (e) { /* missing field = failure */ }
        // on a failure, the checks that came out false are named first, then the detail (cut to a line)
        const falsy = keys ? keys.flatMap(k => Object.entries(r[k] || {}).filter(([, v]) => v === false).map(([n]) => n)) : [];
        good ? pass(what) : fail(what, r.error ? r.error.split('\n')[0] : keys ? (falsy.length ? `false: ${falsy.join(', ')} · ` : '') + JSON.stringify(Object.fromEntries(keys.map(k => [k, r[k]]))).slice(0, 400) : '');
      }
      if (errs.length) fail('interface page errors', errs.join(' | '));
      await page.close();
    }
    // installable app: the service worker stores the app, serves it offline, and a new deployment is offered as "Reload"
    // (Playwright's WebKit build has no service workers, so an offline navigation crashes it; Safari itself does)
    if (name === 'webkit') pass('installable app: skipped, no service workers in Playwright WebKit');
    else {
      const pctx = await browser.newContext({ viewport: { width: 1200, height: 800 } }), page = await pctx.newPage();
      try {
        await page.goto(`${base}/index.html?pwa=1`);
        await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 60000 });
        const stored = await page.evaluate(async () => { const c = await caches.open((await caches.keys()).find(k => k.startsWith('gelgrapher-'))); return (await c.keys()).length; });
        await pctx.setOffline(true);
        await page.goto(`${base}/index.html?pwa=1&demo=1`);
        await page.waitForFunction(() => window.App && window.App.S && window.App.S.lanes.length > 0, null, { timeout: 60000 });
        const offline = await page.evaluate(() => ({ lanes: App.S.lanes.length, bar: document.getElementById('updateBar').classList.contains('hidden') }));
        await pctx.setOffline(false);
        swVersion = 'test2';                       // a new deployment
        await page.goto(`${base}/index.html?pwa=1`);
        await page.waitForSelector('#updateBar:not(.hidden)', { timeout: 60000 });
        await Promise.all([page.waitForNavigation({ timeout: 60000 }), page.click('#updateReload')]);
        await page.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 60000 });
        const keys = await page.evaluate(() => caches.keys());
        stored >= 24 ? pass('installable app stores the whole app') : fail('installable app stores the whole app', `${stored} files`);
        offline.lanes > 0 && offline.bar ? pass('installable app opens offline') : fail('installable app opens offline', JSON.stringify(offline));
        keys.includes('gelgrapher-test2') && !keys.includes('gelgrapher-test1') ? pass('installable app takes the new version on Reload') : fail('installable app takes the new version on Reload', keys.join());
      } catch (e) { fail('installable app', e.message.split('\n')[0]); }
      finally { swVersion = 'test1'; await pctx.close(); }
    }
    // privacy: the Content Security Policy must stop every request to another origin
    {
      const page = await ctx.newPage();
      await page.goto(`${base}/index.html`);
      outside.hits = [];
      await page.evaluate(async t => {
        try { await fetch(t + '/fetch', { method: 'POST', body: 'x' }); } catch (e) { /* expected */ }
        await new Promise(r => { const i = new Image(); i.onload = i.onerror = r; i.src = t + '/img'; });
        try { navigator.sendBeacon(t + '/beacon', 'x'); } catch (e) { /* expected */ }
        try { const x = new XMLHttpRequest(); x.open('GET', t + '/xhr'); x.send(); } catch (e) { /* expected */ }
        try { new WebSocket(t.replace('http', 'ws') + '/ws'); } catch (e) { /* expected */ }
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = t + '/css'; document.head.appendChild(l);
      }, outside.url);
      await page.waitForTimeout(2000);
      outside.hits.length ? fail('no request leaves the page', outside.hits.join(', ')) : pass('no request leaves the page');
      await page.close();
    }
    // a phone (390 × 844): one workspace at a time with a bar at the bottom, a two-row top bar, nothing wider than the screen;
    // a lesson shows the workspace its card needs and keeps its card above the bar
    {
      const mctx = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await mctx.newPage();
      try {
        await page.goto(`${base}/index.html?example=dna`);
        await page.waitForFunction(() => window.App && window.App.S && document.body.classList.contains('has-gel'), null, { timeout: 60000 });
        await page.waitForTimeout(500);
        const r = await page.evaluate(async () => {
          const $ = id => document.getElementById(id), shown = el => !!(el && el.offsetParent !== null && el.getBoundingClientRect().height > 0), wait = ms => new Promise(f => setTimeout(f, ms));
          const nav = $('mobileNav').getBoundingClientRect(), top = document.querySelector('.topbar').getBoundingClientRect();
          const first = document.body.dataset.pane === 'figure' && shown($('figPane')) && !shown($('panel')) && !shown($('rawCol'));
          const narrow = document.documentElement.scrollWidth <= innerWidth + 1 && top.height <= 110 && nav.bottom <= innerHeight + 1 && nav.height >= 44;
          document.querySelector('#mobileNav [data-pane="image"]').click(); await wait(200);
          const image = shown($('rawCol')) && !shown($('figCol')) && $('editor').getBoundingClientRect().width > 300;
          document.querySelector('#mobileNav [data-pane="steps"]').click(); await wait(100);
          const steps = shown($('panel')) && !shown($('stage'));
          await window.UI.loadExample('western'); await wait(200);
          window.UI.showPane('analysis'); window.QuantUI.setTab('prof'); await wait(100);
          const values = JSON.stringify(window.QuantUI.results().shown);
          $('qMethodLink').click(); await wait(100);
          const method = document.body.dataset.pane === 'steps' && shown($('methodsAdv')) && $('methodsAdv').open
            && $('methodsAdv').getBoundingClientRect().top >= $('settingsNav').getBoundingClientRect().bottom
            && JSON.stringify(window.QuantUI.results().shown) === values;
          document.querySelector('#settingsNav [data-step="0"]').click(); await wait(100);
          const shortcut = shown($('polSeg')) && document.documentElement.scrollWidth <= innerWidth + 1;
          await window.Tour.practice('figure'); await wait(400);
          const card = $('tourCard').getBoundingClientRect();
          const lesson = document.body.dataset.pane === 'image' && $('tourTitle').textContent === 'Working image and original' && card.bottom <= nav.top + 1 && card.top > 0;
          return { first, narrow, image, steps, method, shortcut, lesson };
        });
        Object.values(r).every(Boolean) ? pass('phone: one workspace at a time, a bar to switch, nothing wider than the screen; a lesson shows the workspace its card needs')
          : fail('phone: one workspace at a time, a bar to switch, nothing wider than the screen; a lesson shows the workspace its card needs', JSON.stringify(r));
      } catch (e) { fail('phone layout', e.message.split('\n')[0]); }
      finally { await mctx.close(); }
    }
    // intermediate widths and 200 % zoom (720 × 450 CSS px at 2 device px): nothing wider than the window with the
    // analysis window open on the Profile
    {
      const bad = [];
      for (const [w, h, dpr] of [[860, 900, 1], [900, 800, 1], [1024, 768, 1], [1100, 800, 1], [1280, 800, 1], [1440, 900, 1], [720, 450, 2]]) {
        const wctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr }), page = await wctx.newPage();
        try {
          await page.goto(`${base}/index.html?example=western`);
          await page.waitForFunction(() => window.App && window.App.S && document.body.classList.contains('has-gel'), null, { timeout: 60000 });
          const sw = await page.evaluate(async () => { window.QuantUI.setView('quant'); window.QuantUI.setTab('prof'); await new Promise(f => setTimeout(f, 300)); return document.documentElement.scrollWidth - innerWidth; });
          if (sw > 1) bad.push(`${w}px: ${sw}px too wide`);
        } catch (e) { bad.push(`${w}px: ${e.message.split('\n')[0]}`); }
        finally { await wctx.close(); }
      }
      bad.length ? fail('no horizontal overflow at 860, 900, 1024, 1100, 1280 and 1440 px and at 200 % zoom', bad.join('; ')) : pass('no horizontal overflow at 860, 900, 1024, 1100, 1280 and 1440 px and at 200 % zoom');
    }
    // a first visit: nothing starts by itself; "Practice with an example" opens the example and its lesson
    {
      const fctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }), page = await fctx.newPage();
      try {
        await page.goto(`${base}/index.html`);
        await page.waitForTimeout(1500);
        const idle = await page.evaluate(() => document.getElementById('tour').classList.contains('hidden') && !window.App.S && !!document.querySelector('#emptyState [data-lesson="figure"]'));
        await page.click('#emptyState [data-lesson="figure"]');
        await page.waitForFunction(() => window.App && window.App.S && window.Tour && window.Tour.lesson() === 'figure', null, { timeout: 60000 });
        const started = await page.evaluate(() => ({ example: window.App.isExample, title: document.getElementById('tourTitle').textContent }));
        idle && started.example === 'dna' && started.title === 'Working image and original' ? pass('first visit: nothing starts by itself; Practice with an example opens its lesson')
          : fail('first visit: nothing starts by itself; Practice with an example opens its lesson', JSON.stringify({ idle, started }));
      } catch (e) { fail('first visit', e.message.split('\n')[0]); }
      finally { await fctx.close(); }
    }
  } catch (e) {
    fail('runner', e.message);
  } finally { await browser.close(); }
  return out;
}

const server = await serve();
const base = `http://127.0.0.1:${server.address().port}`;
// a second origin that records anything the page manages to send
const outside = { hits: [] };
const sink = http.createServer((req, res) => { outside.hits.push(`${req.method} ${req.url}`); res.end(); });
await new Promise(r => sink.listen(0, '127.0.0.1', r));
outside.url = `http://localhost:${sink.address().port}`;
let allOk = true;
for (const name of browsers) {
  if (!ENGINES[name]) { console.error(`unknown browser: ${name}`); allOk = false; continue; }
  const t0 = Date.now();
  const r = await runIn(name, base);
  console.log(`\n${name}${channel && name === 'chromium' ? ` (${channel})` : ''} — ${r.ok ? 'PASS' : 'FAIL'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  r.results.forEach(([s, what, detail]) => console.log(`  ${s === 'ok' ? '✓' : '✗'} ${what}${detail ? `\n      ${detail}` : ''}`));
  allOk = allOk && r.ok;
}
server.close(); sink.close();
process.exit(allOk ? 0 : 1);

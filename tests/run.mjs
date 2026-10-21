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
  ['hands-on tutorial waits for each real action, for typing, for dialogs and for Next; lights the areas to watch', r => r.tutorial.ok, ['tutorial']],
  ['"all" / "none" picks in the band and lane lists', r => r.picks.ok, ['picks']],
  ['print page and exports: the legend notes under the figure only when asked for', r => r.print.ok, ['print']],
  ['densitometry results open in the figure column', r => r.quantView.ok, ['quantView']]
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
        good ? pass(what) : fail(what, r.error ? r.error.split('\n')[0] : keys ? JSON.stringify(Object.fromEntries(keys.map(k => [k, r[k]]))).slice(0, 400) : '');
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

#!/usr/bin/env node
/* Fast checks that need no browser: every script parses, index.html loads each one exactly once,
 * and the artifact build succeeds. Run before pushing: npm run check */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let ok = true;
const fail = msg => { ok = false; console.error('✗ ' + msg); };

const js = fs.readdirSync(path.join(ROOT, 'js')).filter(f => f.endsWith('.js'));
for (const f of js) {
  try { execFileSync(process.execPath, ['--check', path.join(ROOT, 'js', f)], { stdio: 'pipe' }); }
  catch (e) { fail(`js/${f} does not parse:\n${e.stderr}`); }
}
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const loaded = [...html.matchAll(/<script src="js\/([^"]+)"[^>]*><\/script>/g)].map(m => m[1]);
for (const f of js) if (f !== 'uitest.js' && !loaded.includes(f)) fail(`js/${f} is not loaded by index.html`);
for (const f of loaded) if (loaded.filter(x => x === f).length > 1) fail(`js/${f} is loaded twice`);
for (const f of loaded) if (!js.includes(f)) fail(`index.html loads missing js/${f}`);
// the service worker's stored copy must contain every file the page loads, and nothing that does not exist
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const files = [...sw.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
for (const f of loaded) if (!files.includes('js/' + f)) fail(`sw.js does not store js/${f}`);
for (const f of ['index.html', 'css/style.css', 'manifest.webmanifest']) if (!files.includes(f)) fail(`sw.js does not store ${f}`);
for (const f of files) if (f !== './' && !fs.existsSync(path.join(ROOT, f))) fail(`sw.js stores missing ${f}`);
for (const f of [...JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')).icons.map(i => i.src), 'icons/icon-180.png']) if (!files.includes(f)) fail(`sw.js does not store ${f}`);
if (!sw.includes("'__VERSION__'")) fail('sw.js has no __VERSION__ placeholder for the deployment stamp');
try { execFileSync(process.execPath, ['--check', path.join(ROOT, 'sw.js')], { stdio: 'pipe' }); } catch (e) { fail(`sw.js does not parse:\n${e.stderr}`); }
try { execFileSync(process.execPath, [path.join(ROOT, 'tools/build-artifact.mjs'), '--out=' + path.join(ROOT, 'dist/.check.html')], { stdio: 'pipe' }); fs.rmSync(path.join(ROOT, 'dist/.check.html')); }
catch (e) { fail(`artifact build failed:\n${e.stderr}`); }
console.log(ok ? `✓ ${js.length} scripts parse, index.html and sw.js are consistent, artifact build works` : 'checks failed');
process.exit(ok ? 0 : 1);

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
const loaded = [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
for (const f of js) if (f !== 'uitest.js' && !loaded.includes(f)) fail(`js/${f} is not loaded by index.html`);
for (const f of loaded) if (loaded.filter(x => x === f).length > 1) fail(`js/${f} is loaded twice`);
for (const f of loaded) if (!js.includes(f)) fail(`index.html loads missing js/${f}`);
try { execFileSync(process.execPath, [path.join(ROOT, 'tools/build-artifact.mjs'), '--out=' + path.join(ROOT, 'dist/.check.html')], { stdio: 'pipe' }); fs.rmSync(path.join(ROOT, 'dist/.check.html')); }
catch (e) { fail(`artifact build failed:\n${e.stderr}`); }
console.log(ok ? `✓ ${js.length} scripts parse, index.html is consistent, artifact build works` : 'checks failed');
process.exit(ok ? 0 : 1);

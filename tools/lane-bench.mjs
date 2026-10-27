#!/usr/bin/env node
/* Lane-detection benchmark: runs the engine (deskew, auto-crop, lane lattice) in node on the
 * synthetic gels and reports found vs expected lane centres. Run it before changing the lane
 * detector; every variant should read "hit = n = expected, extra 0".
 *   node tools/lane-bench.mjs
 *   node tools/lane-bench.mjs --raw gel.raw 2000x1600 --expect 630,722,775,...
 * --raw: an 8-bit grey image as raw bytes (e.g. `convert gel.png -colorspace gray -depth 8 gray:gel.raw`),
 * --expect: its lane centres in pixels (after deskew, usually 0° for a photograph). */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['ladders', 'gels', 'engine', 'demo']) vm.runInThisContext(fs.readFileSync(path.join(root, 'js', f + '.js'), 'utf8'), { filename: f + '.js' });
const E = window.Engine, Demo = window.Demo;

// what App.startFrom does before autoLanes
function detect(img) {
  const bright = E.detectBright(img);
  const a = E.deskew(img, bright);
  if (a) img = E.rotate(img, a);
  const crop = E.autoCrop(img, bright);
  const L = E.detectLaneLattice(img, bright, crop, E.autoCrop.meta);
  return { bright, angle: a, crop, centers: L ? L.centers : [], pitch: L ? L.pitch : 0 };
}

const args = process.argv.slice(2);
const cases = [];
const rawAt = args.indexOf('--raw');
if (rawAt >= 0) {
  const file = args[rawAt + 1], [w, h] = args[rawAt + 2].split('x').map(Number);
  const raw = fs.readFileSync(file), data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = raw[i] / 255;
  const ex = args.indexOf('--expect');
  cases.push({ name: path.basename(file), img: { w, h, data }, truth: ex >= 0 ? args[ex + 1].split(',').map(Number) : [] });
}
// synthetic: lanes at 260 + 80 k inside the slab (140..1260); 'western' has no wells, so only
// loaded lanes can be found; a lane within half a pitch of the slab edge (lanes: 15) is not expected
for (const preset of ['dna', 'sds', 'western']) {
  for (const v of [{}, { tilt: 0 }, { lanes: 15 }, { seed: 3 }]) {
    const g = Demo.makeGel(Object.assign({ preset }, v));
    const n = preset === 'western' ? 9 : Math.min(v.lanes || (preset === 'dna' ? 12 : 10), 12);
    cases.push({ name: `${preset} ${JSON.stringify(v)}`, img: { w: g.width, h: g.height, data: g.data }, truth: Array.from({ length: n }, (_, k) => 260 + 80 * k) });
  }
}
let allOk = true;
for (const c of cases) {
  const t0 = Date.now(), r = detect(c.img), got = r.centers, p = r.pitch;
  const hit = c.truth.filter(t => got.some(x => Math.abs(x - t) < Math.max(6, p * 0.3))).length;
  const extra = got.length - hit, ok = c.truth.length ? hit === c.truth.length && extra === 0 : true;
  if (!ok) allOk = false;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.name.padEnd(24)} found ${String(got.length).padStart(2)}  expected ${String(c.truth.length).padStart(2)}  hit ${String(hit).padStart(2)}  extra ${extra}  pitch ${p.toFixed(1)}  ${Date.now() - t0} ms`);
  if (!ok || !c.truth.length) console.log('     found   ', got.map(Math.round).join(' '));
  if (!ok) console.log('     expected', c.truth.join(' '));
}
console.log(allOk ? 'all variants right' : 'some variants wrong');
process.exit(allOk ? 0 : 1);

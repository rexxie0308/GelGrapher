#!/usr/bin/env node
/* Builds the single-file page that is published as a Claude artifact: dist/gelgrapher-artifact.html.
 *
 * The artifact host wraps the file in its own <!doctype html><head>…<body> skeleton and sets its own
 * Content Security Policy, so the output is only the page content: <title>, <style> with the
 * inlined stylesheet, the body markup and every script inlined in load order. The offline CSP meta
 * of index.html is left out on purpose (it would block the inlined scripts).
 *
 * Usage: node tools/build-artifact.mjs [--out=path] */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = name => (process.argv.find(a => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
const out = path.resolve(ROOT, arg('out') || 'dist/gelgrapher-artifact.html');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const pick = (re, what) => { const m = html.match(re); if (!m) throw new Error(`index.html: ${what} not found`); return m[1]; };
const title = pick(/<title>([^<]*)<\/title>/, '<title>');
const description = pick(/<meta name="description" content="([^"]*)">/, 'description');
let body = pick(/<body>([\s\S]*)<\/body>/, '<body>');

// scripts in the order index.html loads them (the self-test script is never part of the page);
// those marked data-artifact="no" (the service worker registration) are left out: the host runs the page
const scripts = [...body.matchAll(/<script src="([^"]+)"([^>]*)><\/script>\n?/g)].filter(m => !/data-artifact="no"/.test(m[2]));
if (!scripts.length) throw new Error('no <script src> tags found');
// the build identifier: the commit (with "+changes" when the working tree differs from it), so a reviewed commit
// and a deployed build can be told apart (App.BUILD; written in the log, the CSV, the methods and the specification)
let build = 'dev';
try {
  const sha = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim();
  const dirty = execSync('git status --porcelain -- js css index.html', { cwd: ROOT }).toString().trim();
  build = sha + (dirty ? '+changes' : '');
} catch (e) { /* not a git checkout */ }
const inlineJs = scripts.map(m => {
  let src = fs.readFileSync(path.join(ROOT, m[1]), 'utf8');
  if (m[1] === 'js/app.js') src = src.replace(/__BUILD__/g, build);
  if (/<\/script/i.test(src)) throw new Error(`${m[1]} contains "</script"`);
  return `<script>/* ${m[1]} */\n${src}</script>`;
}).join('\n');
body = body.replace(/<script src="[^"]+"[^>]*><\/script>\n?/g, '');

const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const page = `<title>${title}</title>
<meta name="description" content="${description}">
<!-- GelGrapher ${pkg.version} - single-file build of https://github.com/rexxie0308/GelGrapher (MIT).
     Based on GelFigure by poplarity (MIT, https://github.com/poplarity/GelFigure). Built by tools/build-artifact.mjs; do not edit by hand. -->
<style>
${css}</style>
${body.trim()}
${inlineJs}
`;

for (const bad of [/(^|[^.\w])alert\(/, /(^|[^.\w])confirm\(/, /(^|[^.\w])prompt\(/, /window\.print\(/]) {
  // dialogs and printing do nothing inside the artifact viewer
  const hit = inlineJs.split('\n').find(l => bad.test(l) && !/^\s*(\/\/|\*)/.test(l));
  if (hit) throw new Error(`blocked API in the build: ${hit.trim().slice(0, 120)}`);
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`wrote ${path.relative(ROOT, out)} (${(Buffer.byteLength(page) / 1024).toFixed(0)} KB, ${scripts.length} scripts inlined)`);

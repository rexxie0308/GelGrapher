/* Service worker for the installed (PWA) and web versions of GelGrapher.
 * The app shell is stored in the browser on first visit and served from there afterwards, so the
 * page opens offline. Every deployment stamps a new VERSION (the pages workflow replaces
 * __VERSION__ with the commit); the browser notices the changed file on the next start while
 * online, installs the new copy alongside the old one and js/pwa.js offers "Reload". Only files of
 * this origin are ever handled: nothing else is fetched, nothing is sent anywhere. */
'use strict';
const VERSION = '__VERSION__';
const CACHE = 'gelgrapher-' + VERSION;
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'js/tiff.js', 'js/ladders.js', 'js/gels.js', 'js/engine.js', 'js/render.js', 'js/quant.js', 'js/zip.js', 'js/pdf.js', 'js/pptx.js',
  'js/host.js', 'js/export.js', 'js/demo.js', 'js/app.js', 'js/splitters.js', 'js/editor.js', 'js/ui.js', 'js/figedit.js', 'js/quantui.js',
  'js/claude.js', 'js/tour.js', 'js/pwa.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
});
self.addEventListener('activate', e => {
  // the previous version's files go once this one is in charge
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('gelgrapher-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // the stored copy answers first (the query string, ?demo=1 and the like, is ignored); the network only fills gaps
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit
    || (e.request.mode === 'navigate' ? caches.match('index.html') : null)
    || fetch(e.request)));
});

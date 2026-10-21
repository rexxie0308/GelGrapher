/* Installable app: registers the service worker (sw.js) that keeps a copy of the app in the browser,
 * offers "Install as an app" in the File menu where the browser supports it, and shows a bar when a
 * newer version has been stored so one click (or the next start) switches to it.
 * Not used inside the Claude artifact (the host runs the page) nor from a local file (no service
 * workers there); on localhost only with ?pwa=1, so the self-tests decide when it runs. */
(function (G) {
  'use strict';
  const $ = id => document.getElementById(id);
  const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const on = /^https?:$/.test(location.protocol) && 'serviceWorker' in navigator && !G.Host.inClaude()
    && (!local || /[?&]pwa=1/.test(location.search));
  G.PWA = { on, version: null, update: () => reg && reg.update() };
  if (!on) return;

  let reg = null, wanted = false, waiting = null, installPrompt = null;
  function offer(worker) {
    waiting = worker;
    $('updateBar').classList.remove('hidden');
  }
  $('updateReload').onclick = () => {
    if (!waiting) { location.reload(); return; }
    wanted = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };
  $('updateLater').onclick = () => $('updateBar').classList.add('hidden');
  // the new worker takes over only after "Reload"; a first install never reloads the page under the user
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (wanted) location.reload(); });
  navigator.serviceWorker.register('sw.js').then(r => {
    reg = r;
    if (r.waiting && navigator.serviceWorker.controller) offer(r.waiting);
    r.addEventListener('updatefound', () => {
      const w = r.installing;
      if (!w) return;
      w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => { /* no offline copy; the page still works online */ });

  // "Install as an app" (Chrome, Edge; Safari installs from its own Share / File menu)
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); installPrompt = e;
    $('btnInstall').classList.remove('hidden');
  });
  $('btnInstall').onclick = async () => {
    $('tplMenu').classList.add('hidden');
    if (!installPrompt) return;
    installPrompt.prompt();
    try { await installPrompt.userChoice; } catch (e) { /* dismissed */ }
    installPrompt = null; $('btnInstall').classList.add('hidden');
  };
  window.addEventListener('appinstalled', () => { $('btnInstall').classList.add('hidden'); G.UI && G.UI.toast && G.UI.toast('GelGrapher is installed; it opens offline and updates itself when online'); });
})(window);

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

  // "Install as an app": always offered on the web version. Chrome and Edge hand over an install prompt
  // (beforeinstallprompt) that is used directly; any other browser gets its own steps.
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (!standalone()) $('btnInstall').classList.remove('hidden');
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
  function howTo() {
    const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/.test(ua), safari = /Safari/.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
    const firefox = /Firefox/.test(ua), chromium = /Chrome|Chromium|Edg/.test(ua);
    if (ios) return 'Tap the Share button, then “Add to Home Screen”. The app then opens from its own icon, works offline and updates itself when online.';
    if (safari) return 'In Safari’s menu bar choose File → “Add to Dock…” (macOS Sonoma or newer). The app then opens from the Dock, works offline and updates itself when online.';
    if (firefox) return 'Firefox on the desktop cannot install web apps. The page still works offline here once it has been opened once, and updates itself when online. For an app icon, open this address in Chrome, Edge or Safari.';
    if (chromium) return 'Chrome and Edge show an install icon at the right end of the address bar; or open the browser menu (⋮) → “Cast, save and share” → “Install page as app…”. If neither is offered yet, reload the page once and try again.';
    return 'Use your browser’s “Install app” or “Add to Home Screen” command. The app then opens from its own icon, works offline and updates itself when online.';
  }
  $('btnInstall').onclick = async () => {
    $('tplMenu').classList.add('hidden');
    if (installPrompt) {
      const p = installPrompt; installPrompt = null;
      p.prompt();
      try { await p.userChoice; } catch (e) { /* dismissed */ }
      return;
    }
    G.UI.alert(howTo());
  };
  window.addEventListener('appinstalled', () => { $('btnInstall').classList.add('hidden'); G.UI && G.UI.toast && G.UI.toast('GelGrapher is installed; it opens offline and updates itself when online'); });
})(window);

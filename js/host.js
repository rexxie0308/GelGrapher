/* Bridge to the page's host. Inside a Claude artifact viewer, `window.claude.use(name)` gives access
 * to runtime capabilities: `downloads` (files the viewer confirms before saving) and `sample` (ask
 * Claude, on the viewer's own account). Opened any other way (GitHub Pages, a local file) there is no
 * `window.claude`: every capability is null and the app falls back to ordinary browser downloads. */
(function (G) {
  'use strict';
  const cache = {};
  const inClaude = () => !!(window.claude && typeof window.claude.use === 'function');
  function use(name) {
    if (!inClaude()) return Promise.resolve(null);
    if (!cache[name]) cache[name] = Promise.resolve().then(() => window.claude.use(name)).catch(() => null);
    return cache[name];
  }
  G.Host = { inClaude, use, downloads: () => use('downloads'), sample: () => use('sample') };
})(window);

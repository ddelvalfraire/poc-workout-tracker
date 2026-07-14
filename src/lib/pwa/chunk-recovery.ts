// The pre-boot stale-chunk recovery script, as a plain string so (a) the root
// layout can inline it before any /_next chunk loads and (b) the test suite
// can execute the exact shipped artifact with stubbed globals — see
// chunk-recovery.test.ts. It must stay dependency-free ES5: it runs before
// React, before hydration, in whatever engine the installed PWA has.
//
// Behavior: reload when a /_next script OR stylesheet fails to load (stale
// deploy), or a lazy import rejects — webpack names these ChunkLoadError, but
// Safari/Firefox native import() rejects with a TypeError whose MESSAGE is
// the only signal, so those exact wordings are matched too. Generic "Failed
// to fetch" is deliberately NOT reload-worthy: an offline API call is not
// version skew (the resume-time version probe owns proactive updates).
// Never reload while offline — the navigation would land on offline.html and
// bury a live logger.
//
// Rate limit: at most once per RELOAD window. The stamp lives in
// sessionStorage as epoch ms — a timestamp, NOT a one-shot flag: installed
// iOS PWAs keep sessionStorage across background/resume, and a permanent flag
// turned "recovers instantly" into "recovers after force-kill". If storage is
// unreadable or unwritable we cannot rate-limit across reloads, so an
// in-memory flag allows exactly ONE attempt per page lifetime — recovery
// still happens (previously this failed closed and left the white screen),
// and a persistently broken deploy costs one reload per full page load, not
// a tight storm.
export const RECOVERY_SCRIPT = `
(function () {
  var KEY = 'chunk-reload-at';
  var RELOAD_WINDOW_MS = 30000;
  var memoryReloaded = false;
  var IMPORT_FAILURE = /Importing a module script failed|error loading dynamically imported module|Loading chunk/i;
  function reloadOnceInMemory() {
    if (memoryReloaded) return;
    memoryReloaded = true;
    location.reload();
  }
  function recover(event) {
    var target = event.target;
    var staleScript =
      target instanceof HTMLScriptElement && target.src.indexOf('/_next/') !== -1;
    var staleStyle =
      target instanceof HTMLLinkElement &&
      typeof target.href === 'string' &&
      target.href.indexOf('/_next/') !== -1;
    var reason = event.reason;
    var message = reason && typeof reason.message === 'string' ? reason.message : '';
    var staleImport =
      !!reason && (reason.name === 'ChunkLoadError' || IMPORT_FAILURE.test(message));
    if (!staleScript && !staleStyle && !staleImport) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    var last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch (e) { reloadOnceInMemory(); return; }
    if (Date.now() - last < RELOAD_WINDOW_MS) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) { reloadOnceInMemory(); return; }
    location.reload();
  }
  window.addEventListener('error', recover, true);
  window.addEventListener('unhandledrejection', recover);
})();
`

// The pre-boot stale-chunk recovery script, as a plain string so (a) the root
// layout can inline it before any /_next chunk loads and (b) the test suite
// can execute the exact shipped artifact with stubbed globals — see
// chunk-recovery.test.ts. It must stay dependency-free ES5: it runs before
// React, before hydration, in whatever engine the installed PWA has.
//
// Behavior: reload when a /_next script fails to load (stale deploy) or a
// lazy import rejects with ChunkLoadError, at most once per RELOAD window.
// The stamp lives in sessionStorage as epoch ms — a timestamp, NOT a one-shot
// flag: installed iOS PWAs keep sessionStorage across background/resume, and
// a permanent flag turned "recovers instantly" into "recovers after
// force-kill". If storage is unreadable or unwritable we CANNOT rate-limit,
// so we skip the reload entirely (fail closed) rather than risk a reload
// storm against a persistently broken deploy.
export const RECOVERY_SCRIPT = `
(function () {
  var KEY = 'chunk-reload-at';
  var RELOAD_WINDOW_MS = 30000;
  function recover(event) {
    var target = event.target;
    var staleScript =
      target instanceof HTMLScriptElement && target.src.indexOf('/_next/') !== -1;
    var reason = event.reason;
    var staleImport = !!reason && reason.name === 'ChunkLoadError';
    if (!staleScript && !staleImport) return;
    var last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch (e) { return; }
    if (Date.now() - last < RELOAD_WINDOW_MS) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) { return; }
    location.reload();
  }
  window.addEventListener('error', recover, true);
  window.addEventListener('unhandledrejection', recover);
})();
`

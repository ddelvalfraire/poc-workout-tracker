// Pre-boot recovery for stale-deploy chunk failures.
//
// When the served HTML references hashed /_next chunks that a redeploy has
// deleted, the bootstrap scripts 404 and React NEVER mounts — so recovery
// living in a React effect (the old approach) never attaches, and error.tsx
// never renders. The page sits blank until the user force-kills the PWA.
// This inline, render-blocking script attaches the listeners before any
// /_next script can fail, so the very first dead chunk triggers a reload
// that fetches fresh HTML (the SW is network-first for navigations).
//
// Guards: at most one reload per RELOAD_WINDOW_MS (sessionStorage timestamp,
// not a one-shot flag — an installed iOS PWA keeps sessionStorage across
// background/resume, so a permanent flag turned "recovers instantly" into
// "recovers only after force-kill"). A genuinely-offline reload lands on the
// SW's offline page, which loads no /_next scripts and can't loop.

const RECOVERY_SCRIPT = `
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
    try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch (e) {}
    if (Date.now() - last < RELOAD_WINDOW_MS) return;
    try { sessionStorage.setItem(KEY, String(Date.now())); } catch (e) {}
    location.reload();
  }
  window.addEventListener('error', recover, true);
  window.addEventListener('unhandledrejection', recover);
})();
`

export function ChunkRecoveryScript() {
  if (process.env.NODE_ENV !== 'production') return null
  return <script dangerouslySetInnerHTML={{ __html: RECOVERY_SCRIPT }} />
}

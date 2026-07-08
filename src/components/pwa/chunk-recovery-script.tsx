import { RECOVERY_SCRIPT } from '@/lib/pwa/chunk-recovery'

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
// The script itself (rate-limit semantics, fail-closed storage handling)
// lives and is unit-tested in src/lib/pwa/chunk-recovery.ts.
export function ChunkRecoveryScript() {
  if (process.env.NODE_ENV !== 'production') return null
  return <script dangerouslySetInnerHTML={{ __html: RECOVERY_SCRIPT }} />
}

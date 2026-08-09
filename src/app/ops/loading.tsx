import { OpsHeader } from '@/components/ops/ops-header'
import { OpsGhostPanel, OpsGhostStrip } from '@/components/ops/loading-ghosts'

/**
 * Segment loading state for /ops: the force-dynamic page spends ~500ms in
 * vendor fetches, and without this the tab click bought dead time. The REAL
 * OpsHeader renders immediately (it is static — title, tabs, refresh
 * controls never blank), and the board's exact frame stands in below it:
 * wrapper, strip, and the 12-col 7/5/12 grid all copy page.tsx's classes
 * verbatim, so the frames, header, and grid land shift-free. Panel BODIES
 * are variable-height (tables, charts), so total page height still settles
 * on resolve — only the outer geometry is guaranteed stable.
 */
export default function OpsLoading() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <OpsHeader active="ops" />

      <main
        aria-busy="true"
        className="mx-auto w-full max-w-screen-2xl flex-1 px-5 pb-safe pt-5"
      >
        <OpsGhostStrip />

        <div className="mt-5 grid grid-cols-1 gap-4 pb-8 xl:grid-cols-12">
          <OpsGhostPanel className="xl:col-span-7" lines={6} />
          <OpsGhostPanel className="xl:col-span-5" lines={6} />
          <OpsGhostPanel className="xl:col-span-12" lines={4} />
        </div>
      </main>
    </div>
  )
}

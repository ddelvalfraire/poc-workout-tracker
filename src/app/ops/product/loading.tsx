import { OpsHeader } from '@/components/ops/ops-header'
import { OpsGhostPanel } from '@/components/ops/loading-ghosts'

/**
 * Segment loading state for /ops/product — same contract as /ops/loading.tsx:
 * the REAL OpsHeader immediately (Product tab already active, so the tab nav
 * answers the click before the data does), then ghost panels on this page's
 * exact grid: 12-col with Usage 12 / Adoption 5 / Activity 7, classes copied
 * from page.tsx verbatim for a zero-shift resolve.
 */
export default function OpsProductLoading() {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <OpsHeader active="product" />

      <main
        aria-busy="true"
        className="mx-auto w-full max-w-screen-2xl flex-1 px-5 pb-safe pt-5"
      >
        <div className="grid grid-cols-1 gap-4 pb-8 xl:grid-cols-12">
          <OpsGhostPanel className="xl:col-span-12" lines={5} />
          <OpsGhostPanel className="xl:col-span-5" lines={6} />
          <OpsGhostPanel className="xl:col-span-7" lines={6} />
        </div>
      </main>
    </div>
  )
}

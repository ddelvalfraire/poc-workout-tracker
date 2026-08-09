import { requireUserId } from '@/lib/auth'
import { getHomeLayout } from '@/db/preferences'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { HomeLayoutEditor } from './home-layout-editor'

/**
 * The home layout editor surface: one list that teaches the model — a locked
 * Status row first (always rendered, never customizable), then the optional
 * sections in the user's order. Reorder is chevron buttons, visibility is a
 * switch; every interaction persists the full layout document immediately.
 *
 * Precedents, deliberately: Fitbit's chevron reorder (no drag — buttons are
 * natively focusable, so keyboard/switch/voice all work, WCAG 2.5.7), Apple
 * Health's single-list toggle editor. Mobile-first; desktop is the same
 * component in the settings max-width column.
 */
export default async function CustomizeHomePage() {
  const userId = await requireUserId()
  const sections = await getHomeLayout(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title="Customize home" leading={<BackLink fallback="/settings" />} />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <HomeLayoutEditor initialSections={sections} />
      </main>
    </div>
  )
}

import { requireUserId } from '@/lib/auth'
import { getHomeLayout } from '@/db/preferences'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { HomeLayoutEditor } from './home-layout-editor'
import { getTranslations } from 'next-intl/server'

/**
 * The home layout editor surface: a miniature grid preview that teaches the
 * model — a locked Status bar first (always rendered, never customizable),
 * then the optional sections as schematic tiles in home's own 2-col flow.
 * Tapping a tile opens its sheet (size, visibility, Move buttons — the WCAG
 * 2.5.7 non-drag path); every interaction persists the full layout document
 * immediately.
 *
 * Precedents, deliberately: iOS's widget-gallery schematic previews, Apple
 * Health's single-surface editor. Mobile-first; desktop is the same
 * component in the settings max-width column.
 */
export default async function CustomizeHomePage() {
  const t = await getTranslations('CustomizeHome')
  const userId = await requireUserId()
  const sections = await getHomeLayout(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={t('title')} leading={<BackLink fallback="/settings" />} />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <HomeLayoutEditor initialSections={sections} />
      </main>
    </div>
  )
}

import { requireUserId } from '@/lib/auth'
import { getSeededHomeLayout, getTrainingSignal } from '@/db/home-signal'
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
  // One instant for the request, so the signal's eight-week window cannot
  // shift mid-render — the same `new Date()` shape home uses.
  const now = new Date()
  // The SEEDED layout, not the bare registry default: this editor is a
  // miniature of home, so it must start from what home actually renders —
  // otherwise an uncustomized user sees fifteen tiles here and six there.
  // The derived read is shown HERE and nowhere else: home must never carry a
  // line asking you to confirm how you train.
  const [sections, signal] = await Promise.all([
    getSeededHomeLayout(userId, now.getTime()),
    getTrainingSignal(userId, now.getTime()),
  ])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={t('title')} leading={<BackLink fallback="/settings" />} />
      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <HomeLayoutEditor initialSections={sections} signal={signal} />
      </main>
    </div>
  )
}

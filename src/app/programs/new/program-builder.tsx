'use client'

import { useEffect, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { EmptyWords } from '@/components/ui/empty-words'
import { Section } from '@/components/ui/section'
import { EditableTitle } from '@/components/program-form/editable-title'
import { SummaryRow } from '@/components/program-form/summary-row'
import { saveProgramAction, updateProgramAction } from '@/app/programs/actions'
import { type WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { DayEditor } from './day-editor'
import { ProgramSettings, resolvedDeloadMode } from './program-settings'
import {
  programDraftReducer,
  draftToProgramInput,
  emptyProgramDraft,
  newDraftProgramDay,
  buildStoredProgramDraft,
  parseStoredProgramDraft,
  type ProgramDraft,
} from './program-draft'

/** What a blank week count means downstream (draftToProgramInput's default). */
const DEFAULT_MESOCYCLE_WEEKS = '1'

/** The select arm the summary takes when there is no deload week to name. */
const NO_DELOAD = 'none'

/** The arm for a deload that is armed but has no week: it fires on a stall, so
 *  saying "no deload" would report the opposite of what the program will do. */
const REACTIVE_DELOAD = 'reactive'

interface ProgramBuilderProps {
  /** When set, the builder is in edit mode: Save updates this program and returns to its detail page. */
  programId?: string
  initialDraft?: ProgramDraft
  /** Load display/entry unit; loads are converted to kg at save time. */
  unit?: WeightUnit
}

/**
 * The program editor, shared by `/programs/new` and `/programs/[id]/edit`.
 * Create is not a different screen; it is this screen with an empty program in
 * it, which is why one component serves both.
 *
 * THE SHAPE. A title, then one settings row, then the days. The title is the
 * only thing that says "new" — a muted heading is an unfilled slot, which
 * prompts a name without gating on one. The eleven program-level controls that
 * used to sit above the day list now live behind a summary row: they are
 * already sane defaults, so they are one line to CHECK rather than a gauntlet
 * to pass, and the actual work starts above the fold. Days are hairline rows
 * (`DayEditor`), and the single volt on the screen is Save.
 *
 * The reducer, the local-draft persistence and the save path are untouched by
 * the visual rewrite — this file owns the shell, `ProgramSettings` and
 * `DayEditor` own their regions.
 */
export function ProgramBuilder({
  programId,
  initialDraft = emptyProgramDraft,
  unit = 'kg',
}: ProgramBuilderProps) {
  const t = useTranslations('ProgramBuilder')
  const [draft, dispatch] = useReducer(programDraftReducer, initialDraft)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)
  const router = useRouter()
  // Local draft persistence: the builder is a long phone form with no server
  // draft (unlike the logger) — a backgrounded-tab kill would otherwise
  // destroy a 30-set program mid-build. Keyed per surface; a live local draft
  // wins over the server-seeded rows it was forked from (logger rationale).
  const storageKey = `program-draft:${programId ?? 'new'}`
  // Value-based change detection, immune to StrictMode double-runs (same
  // pattern as the logger's autosave): mount snapshot skips the seeded render.
  const lastSnapshotRef = useRef<string | null>(null)

  // Whether this render is showing a restored local draft. Restore must be
  // VISIBLE: `/programs/new` shares one storage slot, so without a notice an
  // abandoned Program A would silently seed an unrelated Program B, and in
  // edit mode a stale local draft would silently beat newer server rows.
  const [wasRestored, setWasRestored] = useState(false)

  // Restore an interrupted build. localStorage is sync, so this lands before
  // the user can type; parse validates shape, version, and TTL.
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(storageKey)
    } catch {
      return // storage unavailable (private mode) — the builder works without it
    }
    if (!stored) return
    const restored = parseStoredProgramDraft(stored, new Date())
    if (restored) {
      dispatch({ type: 'RESTORE_DRAFT', draft: restored })
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync from localStorage (external system)
      setWasRestored(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: storageKey is stable per page load
  }, [])

  function handleDiscardRestored() {
    clearStoredDraft()
    // Pre-seed the snapshot ref so the persist effect sees "no change" and
    // doesn't immediately re-write the discarded draft back to storage.
    lastSnapshotRef.current = JSON.stringify(initialDraft)
    dispatch({ type: 'RESTORE_DRAFT', draft: initialDraft })
    setWasRestored(false)
  }

  // Persist every change. Drafts are small (the server caps programs long
  // before localStorage limits matter), so no debounce.
  useEffect(() => {
    const snapshot = JSON.stringify(draft)
    if (lastSnapshotRef.current === snapshot) return
    const isMount = lastSnapshotRef.current === null
    lastSnapshotRef.current = snapshot
    if (isMount) return // seeded first render — nothing user-entered yet
    try {
      window.localStorage.setItem(storageKey, buildStoredProgramDraft(draft, new Date()))
    } catch {
      // Quota/private mode: persistence is best-effort, never blocks editing.
    }
  }, [draft, storageKey])

  function clearStoredDraft() {
    try {
      window.localStorage.removeItem(storageKey)
    } catch {
      // Best-effort; an orphaned draft expires via TTL anyway.
    }
  }

  // Mirror the server's Zod minimums (≥1 day, ≥1 exercise per day, ≥1 set per
  // exercise) so Save is disabled instead of guaranteed to fail.
  const isIncomplete =
    draft.days.length === 0 ||
    draft.days.some(
      (day) => day.exercises.length === 0 || day.exercises.some((e) => e.sets.length === 0),
    )

  // Not startTransition: navigating inside an async transition lets the
  // app-wide <ViewTransition> strand the old screen's snapshot over the
  // destination (see workout-logger handleSave). Await, then navigate.
  async function handleSave() {
    setIsPending(true)
    try {
      setError(null)
      if (programId) {
        await updateProgramAction(programId, draftToProgramInput(draft, unit))
        clearStoredDraft() // the saved program supersedes the local draft
        router.push(`/programs/${programId}`)
      } else {
        const { id } = await saveProgramAction(draftToProgramInput(draft, unit))
        clearStoredDraft()
        router.push(`/programs/${id}`)
      }
    } catch {
      setIsPending(false)
      setError(t('saveError'))
    }
  }

  // The settings row's whole job: say where the program stands in one line, so
  // the panel behind it is something to open on purpose rather than to survive.
  const deloadMode = resolvedDeloadMode(draft)
  const settingsSummary = t('settings.summary', {
    weeks: draft.mesocycleWeeks.trim() || DEFAULT_MESOCYCLE_WEEKS,
    deloadWeek:
      deloadMode === 'scheduled' && draft.deloadWeek.trim() !== ''
        ? draft.deloadWeek.trim()
        : deloadMode === 'reactive'
          ? REACTIVE_DELOAD
          : NO_DELOAD,
    autoreg: draft.autoregulation ? 'on' : 'off',
  })

  return (
    <>
      <div className="py-5">
        {/* The live region is ALWAYS mounted and only its text is swapped. A
            `role="status"` injected into the DOM together with its content is
            commonly not announced — the region has to exist before the text
            arrives for the assistive tech to have anything to watch. The
            border and padding come and go with the notice so an empty region
            leaves no hairline behind. */}
        <div
          role="status"
          className={cn(
            'flex items-center justify-between gap-3',
            wasRestored && 'border-b border-b-border/60 pb-3',
          )}
        >
          <p className="min-w-0 text-sm">{wasRestored ? t('restoredNotice') : ''}</p>
          {wasRestored && (
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="outline" onClick={handleDiscardRestored}>
                {t('discardAction')}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setWasRestored(false)}>
                {t('keepAction')}
              </Button>
            </div>
          )}
        </div>

        {/* The title is the only thing that says "new" — and it is a heading
            you can press, not a field to clear before starting. */}
        <EditableTitle
          value={draft.name}
          onValueChange={(value) => dispatch({ type: 'SET_META', field: 'name', value })}
          placeholder={t('untitled')}
          label={t('nameAriaLabel')}
          className="mb-2"
        />

        <SummaryRow label={t('settings.legend')} summary={settingsSummary}>
          <ProgramSettings draft={draft} dispatch={dispatch} />
        </SummaryRow>

        <Section title={t('days.legend')}>
          {draft.days.length === 0 ? (
            <EmptyWords>{t('empty.days')}</EmptyWords>
          ) : (
            <div className="mt-2 divide-y divide-border/60 border-y border-y-border/60">
              {draft.days.map((day, dayIndex) => (
                <DayEditor
                  key={day.id}
                  day={day}
                  dayIndex={dayIndex}
                  dispatch={dispatch}
                  unit={unit}
                  programOvershootPolicy={draft.overshootPolicy}
                />
              ))}
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            className="mt-4 w-full"
            onClick={() =>
              dispatch({
                type: 'ADD_DAY',
                // Stored data, NOT copy: a translated seed would freeze the
                // creating user's language into the saved program, leave old
                // names behind when they switch locale, and hand localized
                // values to the MCP/API consumers. The display already falls
                // back to a localized title when a day has no name.
                day: newDraftProgramDay(`Day ${draft.days.length + 1}`),
              })
            }
          >
            {t('addDayAction')}
          </Button>
        </Section>

        {/* Same always-mounted-region rule as the restore notice, assertive
            here because it reports a submission that just failed. */}
        <p role="alert" className={cn('text-sm text-destructive', error && 'mt-4')}>
          {error ?? ''}
        </p>
      </div>

      {/* Says what this thing IS and what it is not doing — a draft exists from
          the first tap, so the state has to be legible. Create only: an
          existing program is already saved, so calling it a draft would lie.
          `mt-auto` pins the pair to the bottom on short content (the empty
          create state), which is the same reason the bar below carries it. */}
      {!programId && (
        <p className="mt-auto border-t border-border/60 pt-4 pb-1 text-sm text-muted-foreground">
          {t('draftStatus')}
        </p>
      )}

      {/* The screen's one volt.

          `mt-auto` is what actually bottom-anchors this, not `sticky` —
          sticky only ever pulls a box UP off the fold, never pushes it down,
          so on short content the bar would sit at its flow position with dead
          space beneath it and move every time the content height changed.
          That height-coupling is also what ate the first tap on the logger's
          Finish button (see workout-logger.tsx, pinned by
          e2e/sticky-cta.spec.ts). Requires the page's <main> to be
          `flex flex-col`; both /programs/new and /programs/[id]/edit are. */}
      <div className="sticky bottom-0 z-10 mt-auto -mx-5 border-t border-border bg-background/85 px-5 pt-3 pb-safe backdrop-blur-md">
        <Button
          size="lg"
          className="w-full font-semibold uppercase tracking-wide"
          disabled={isIncomplete || isPending}
          onClick={handleSave}
        >
          {isPending ? t('saving') : programId ? t('saveChangesAction') : t('saveAction')}
        </Button>
      </div>
    </>
  )
}

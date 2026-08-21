'use client'

import { Fragment, useEffect, useReducer, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useQueries, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Dumbbell,
  NotebookPen,
  Pin,
  Trash2,
  X,
} from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AppHeader } from '@/components/app-header'
import { PrBadge } from '@/components/pr-badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  saveWorkoutAction,
  updateWorkoutAction,
  deleteWorkoutAction,
  getLastPerformanceAction,
  getExerciseBestAction,
  substitutePlanTargetsAction,
  rememberSwapAction,
  getWorkoutDraftAction,
  putWorkoutDraftAction,
  deleteWorkoutDraftAction,
} from '@/app/workout/actions'
import { ExerciseSheet } from './exercise-sheet'
import type { PickedExercise } from './exercise-picker'
import { ReplaceConfirmDialog } from './replace-confirm-dialog'
import {
  workoutDraftReducer,
  completeFilledSets,
  draftToInput,
  emptyDraft,
  isMissingRequiredMetric,
  newDraftExercise,
  newDraftSet,
  nextSetMetricMode,
  replacementDraftExercise,
  resolveTargetSetIndex,
  setMetricMode,
  type DraftExercise,
  type DraftSet,
  type WorkoutDraft,
} from './workout-draft'
import { draftKey, buildDraftPayload, parseDraftPayload } from './draft-payload'
import { consumePendingPick } from './pending-pick'
import { createDraftSyncQueue, type DraftSyncQueue, type DraftSyncStatus } from './draft-sync'
import { SwipeToDelete } from './swipe-to-delete'
import { SetRowMenu } from './set-row-menu'
import { NoteSheet } from './note-sheet'
import {
  exerciseNoteCount,
  persistSetNotes,
  setHasNote,
  setSnapshotLabel,
  type NoteScope,
} from './note-capture'
import {
  createPendingNotesQueue,
  PENDING_NOTES_STORAGE_KEY,
  type PendingNotesQueue,
} from './pending-notes'
import {
  createNoteAction,
  createFallbackSetNoteAction,
  createSetNotesForWorkoutAction,
} from '@/app/notes/actions'
import { EffortChips } from './effort-chips'
import { stickyNote, noteChipLabel, lastSessionEcho, type IdentityNote } from './identity-note'
import { upsertExerciseNoteAction, deleteExerciseNoteAction } from '@/app/exercises/actions'
import dynamic from 'next/dynamic'

// Lazy on purpose (bundle discipline, plan §7): the note sheet — and through
// its own dynamic import, TipTap — loads only when a chip is actually tapped.
// The logger's first-paint bundle gains no editor bytes.
const QuickCaptureSheet = dynamic(
  () => import('@/components/editor/quick-capture-sheet').then((m) => m.QuickCaptureSheet),
  { ssr: false },
)
import { HeaderClock } from './session-clock'
import { PlateSheet } from './plate-sheet'
import { RestSheet } from './rest-sheet'
import { StatsSheet } from './stats-sheet'
import { RestPill } from './rest-pill'
import { WeightStepper } from './weight-stepper'
import { SessionToast } from './session-toast'
import { fireRestOverAlert } from './rest-over-alert'
import { unlockRestChime } from './rest-chime'
import { EXERCISE_COMPLETE_VIBRATION, SET_COMPLETE_VIBRATION, vibrate } from './haptics'
import { resolveRestTarget } from '@/lib/rest-target'
import {
  continuesTechniqueGroup,
  startsRestPeriod,
  TECHNIQUE_LABEL_KEY,
} from '@/lib/technique'
import { adjustedRestTarget } from '@/lib/rest-alert'
import { sessionPulse, shouldShowNextUp } from '@/lib/session-pulse'
import { targetCaption } from '@/lib/target-caption'
import { allTimePRIndex } from '@/lib/pr-detection'
import { DEFAULT_EQUIPMENT, type Equipment } from '@/lib/equipment'
import { LOGGING_TYPES, isLoggingType } from '@/lib/workout-input'
import type { ExerciseSource } from '@/lib/custom-exercise-input'
import { type WeightUnit } from '@/lib/units'
import { cn } from '@/lib/utils'
import { markReplace, navigateBack } from '@/lib/back-navigation'
import { discardSession } from '@/lib/discard-session'
import { effortLabel, shouldShowEffortRow } from '@/lib/effort'
import {
  planSetGhost,
  placeholderForSet,
  planPlaceholderForSet,
  adoptableGhostValue,
  previousChipLabel,
  completedSetsSummary,
  type PlanSetTarget,
} from '@/lib/format'
import type { LastPerformance } from '@/db/workouts'
import { useTranslations } from 'next-intl'
import { renderMessage } from '@/lib/message'

/** How long the inline "Removed — Undo" affordance stays actionable. 8s per
 *  the #210 direction: action-bearing snackbars sit at the long end of M3's
 *  4–10s, and the SessionToast drain hairline now makes the window visible
 *  (hover/focus pauses it — the drain's animationend IS the dismissal). */
const UNDO_WINDOW_MS = 8000

/** Hold a set circle this long to toggle its warm-up tag. */
const LONG_PRESS_MS = 500
/** Pointer travel past this cancels the hold — it's a scroll, not a press. */
const LONG_PRESS_SLOP_PX = 8

/** One-time hint flag: set after the user's first-ever warm-up tag. */
const WARMUP_HINT_KEY = 'logger:warmup-hint-seen'

/* The per-exercise logging-type select's option LABELS live in the catalog
   (WorkoutLogger.loggingType.*) and are read at render — a label baked into
   a module map is built before any request and can never be translated. The
   option VALUES come from LOGGING_TYPES in lib/workout-input. */

/** One reversible removal. Sets capture their exercise by STABLE id, not
 *  index — the exercise list can shift (or the exercise itself vanish and be
 *  undone back) before the user taps Undo. */
type RemovedEntry =
  | { kind: 'exercise'; exercise: DraftExercise; index: number }
  | { kind: 'set'; exerciseId: string; exerciseName: string; setIndex: number; set: DraftSet }
  /** Undo for REPLACE_EXERCISE: restores the ORIGINAL exercise (logged
   *  values included) over the replacement, resolved by the replacement's
   *  stable id — the list can shift before Undo. */
  | { kind: 'replace'; previous: DraftExercise; replacementId: string }

interface WorkoutLoggerProps {
  /** When set, the logger is in edit mode: Save updates this workout and returns to its detail page. */
  workoutId?: string
  /** Live session being logged now (Finish + running clock) vs correcting a
   *  finished workout (Save changes). NOT the same as !workoutId: a program
   *  session started from home is edit-mode WITH a workoutId, yet live. */
  isLive?: boolean
  /** Header title — the logger owns the app bar so the clock can live in it. */
  title: string
  /** Where the header's Close lands (the page decides; see the pages' comments). */
  closeHref: string
  initialDraft?: WorkoutDraft
  initialName?: string
  /** Weight display/entry unit; weights are converted to kg at save time. */
  unit?: WeightUnit
  /** Per-exercise planned targets for program workouts — the ghost fallback
   *  when an exercise has no prior history. Keyed by the composite
   *  `source:wgerExerciseId` (plan slots can be custom exercises). */
  planTargets?: Record<string, PlanSetTarget[]>
  /** Plan-declared superset groups keyed `source:id` — display-only pairing
   *  labels; the logger never creates or edits groupings. */
  planSupersets?: Record<string, number>
  /** Per-exercise auto-regulation reasons keyed `source:id` (reason already in
   *  the display unit). Display-only + one optional escape: the ghosts arrive
   *  pre-adjusted in planTargets; "Use plan as written" reverts them. */
  planAutoreg?: Record<
    string,
    { reason: string; suggestEarlyDeload: boolean; phaseContext?: 'cutting' }
  >
  /** Which program (day · week) this session is stamped to, e.g. "Legs ·
   *  Week 1". Provenance is fixed at start and can't be edited — surfacing
   *  it here is what keeps a wrong-day start from absorbing a full session
   *  unnoticed. Absent for ad-hoc workouts. */
  programContext?: string
  /** The persisted session start, for edit mode; new sessions clock from open time. */
  startedAt?: Date
  /** The user's bars + plate denominations for the plate calculator (display unit). */
  equipment?: Equipment
  /** The user's stored default rest target (seconds) — seeds the session
   *  default the countdown falls back to when a set has no plan restSec. */
  defaultRestSec?: number | null
  /** Feature switch: false suppresses the whole rest surface — no readout,
   *  no countdown, plan targets ignored. The elapsed clock is unaffected. */
  restTimerEnabled?: boolean
  /** Opt-in RPE/RIR effort logging (user_preferences.rpe_logging_enabled).
   *  The effort chip row shows iff a set has a prescribed effort target OR
   *  this is true — with both false the render is untouched (fast-path
   *  parity for opted-out users is a hard contract). */
  rpeLoggingEnabled?: boolean
}

/** What the notes-v2 capture sheet is open for: a pressed set (which the
 *  scope chips can then retarget up to its exercise or the workout), or the
 *  workout itself — the app-bar entry, which has no set under the finger. */
type NoteCaptureTarget =
  | { kind: 'set'; exerciseIndex: number; setIndex: number }
  | { kind: 'workout' }

/** The two targets, built here rather than inline in JSX — `kind` values are
 *  state discriminants, not words anyone reads, and the i18n lint rule reads
 *  every string literal in JSX as copy (nextSetTag exists for the same
 *  reason). */
const workoutNoteCapture = (): NoteCaptureTarget => ({ kind: 'workout' })
const setNoteCapture = (exerciseIndex: number, setIndex: number): NoteCaptureTarget => ({
  kind: 'set',
  exerciseIndex,
  setIndex,
})

/** Identity of an open capture, so switching targets REMOUNTS the sheet. The
 *  sheet is non-modal by design, so the app-bar entry stays tappable while a
 *  set-anchored sheet is mid-edit; without a fresh key React would keep the
 *  same instance and its half-typed body, and the save would file that text
 *  under the new target. */
const noteCaptureKey = (target: NoteCaptureTarget): string =>
  target.kind === 'set' ? `set-${target.exerciseIndex}-${target.setIndex}` : 'workout'

export function WorkoutLogger({
  workoutId,
  isLive = true,
  title,
  closeHref,
  initialDraft = emptyDraft,
  initialName = '',
  unit = 'kg',
  planTargets,
  planSupersets,
  planAutoreg,
  programContext,
  startedAt,
  equipment,
  defaultRestSec = null,
  restTimerEnabled = true,
  rpeLoggingEnabled = false,
}: WorkoutLoggerProps) {
  const t = useTranslations('WorkoutLogger')
  const tCommon = useTranslations('Common')
  // The collapsed-card summary is built by lib/format, which owns its
  // own words ("set", "top", "BW") in the Format namespace.
  const tFormat = useTranslations('Format')
  const [draft, dispatch] = useReducer(workoutDraftReducer, initialDraft)
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  // Discard flow (live sessions only): two-step — the trigger opens a
  // centered ConfirmDialog — plus a pending flag. Separate from isSaving so
  // each button can disable the other — finishing and discarding the same
  // session must be mutually exclusive. Discard failures get their own error
  // state: they render INSIDE the dialog (retry in place), while `error`
  // stays the page-level save surface.
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [isDiscardModalOpen, setIsDiscardModalOpen] = useState(false)
  const [discardError, setDiscardError] = useState<string | null>(null)
  // Finish flow (live sessions): the completion pass runs first — sets with
  // reps logged get checked off (typing the reps IS "I did it"); if anything
  // is left unchecked, this holds the transformed draft while a ConfirmDialog
  // warns those sets will save as skipped. Null = no warning pending.
  const [pendingFinish, setPendingFinish] = useState<{
    draft: WorkoutDraft
    skipped: number
  } | null>(null)
  const closeFinishDialogRef = useRef<(() => void) | null>(null)
  // ConfirmDialog populates this with an imperative close; the success path
  // calls it BEFORE router.push (the #25 stranded-::backdrop race).
  const closeDiscardDialogRef = useRef<(() => void) | null>(null)
  // Prior performance per distinct exercise, for the per-set ghost
  // placeholders. TanStack Query owns dedupe/caching/retry; provider
  // defaults keep ghosts fresh per session and a tab refocus picks up sets
  // logged elsewhere (e.g. via MCP).
  // Deduped by the COMPOSITE identity — a custom exercise's id can collide
  // with a wger id, and the two must never share ghosts, bests, or caches.
  const exerciseRefs = Array.from(
    new Map(
      draft.exercises.map((e) => [
        `${e.source}:${e.wgerExerciseId}`,
        { source: e.source, wgerExerciseId: e.wgerExerciseId },
      ]),
    ).values(),
  )
  const lastPerformanceQueries = useQueries({
    queries: exerciseRefs.map((ref) => ({
      queryKey: ['last-performance', ref.source, ref.wgerExerciseId, workoutId ?? null],
      queryFn: () => getLastPerformanceAction(ref.wgerExerciseId, workoutId, ref.source),
    })),
  })
  const lastByExercise: Record<string, LastPerformance | null> = {}
  exerciseRefs.forEach((ref, i) => {
    const result = lastPerformanceQueries[i].data
    if (result !== undefined) lastByExercise[`${ref.source}:${ref.wgerExerciseId}`] = result
  })
  // All-time best e1RM per exercise — the baseline the live PR flag compares
  // against. LIVE sessions only (correcting a finished workout is not "the
  // moment it happens"), and deliberately frozen for the session
  // (staleTime: Infinity): the record you walked in with is the one you beat.
  const bestExerciseRefs = isLive ? exerciseRefs : []
  const bestQueries = useQueries({
    queries: bestExerciseRefs.map((ref) => ({
      queryKey: ['exercise-best', ref.source, ref.wgerExerciseId],
      queryFn: () => getExerciseBestAction(ref.wgerExerciseId, ref.source),
      staleTime: Infinity,
      retry: 1,
    })),
  })
  const bestByExercise: Record<string, number | null> = {}
  bestExerciseRefs.forEach((ref, i) => {
    const result = bestQueries[i].data
    if (result !== undefined) bestByExercise[`${ref.source}:${ref.wgerExerciseId}`] = result
  })
  // Which set (if any) currently claims the all-time-PR caption, per exercise
  // position. Pure recompute per render — unchecking or editing a set moves
  // or clears the flag honestly.
  const prIndexByExercise = draft.exercises.map((exercise) =>
    isLive
      ? allTimePRIndex(
          exercise.sets,
          exercise.loggingType,
          unit,
          bestByExercise[`${exercise.source}:${exercise.wgerExerciseId}`] ?? null,
        )
      : null,
  )
  // Superset letters (A, B…) assigned to plan groups in draft order — group
  // NUMBERS are plan-internal; letters are what a lifter reads mid-set.
  const supersetLetters = (() => {
    const letters: Record<number, string> = {}
    if (!planSupersets) return letters
    let next = 0
    for (const exercise of draft.exercises) {
      const group = planSupersets[`${exercise.source}:${exercise.wgerExerciseId}`]
      if (group !== undefined && letters[group] === undefined) {
        letters[group] = String.fromCharCode(65 + next++)
      }
    }
    return letters
  })()

  // When the user opened the logger — saved as startedAt for NEW workouts so
  // startedAt→completedAt reflects the real session length, not the save
  // instant. Edits keep the workout's existing startedAt. State (not a ref)
  // because a restored snapshot rewinds it to the original session start.
  const [openedAt, setOpenedAt] = useState<Date>(() => startedAt ?? new Date())
  // Value-based change detection for the autosave effect. Run-counting
  // ("skip the first run") breaks under StrictMode, which re-runs effects
  // with UNCHANGED deps: the mount re-run slipped past the consumed skip
  // flag, enqueued an empty-draft delete, and its dirty flag blocked the
  // restore — resuming a session from the home banner wiped the draft in
  // dev. Comparing snapshots is immune to double-runs by construction.
  const lastSnapshotRef = useRef<string | null>(null)
  // Set once the user changes anything. The async restore checks it before
  // applying, so a draft fetched over the network never clobbers input typed
  // while the request was in flight.
  const dirtyRef = useRef(false)
  const key = draftKey(workoutId)
  // Sync-failure signal for the offline hint; 'pending' is the constant
  // typing state and stays invisible.
  const [syncStatus, setSyncStatus] = useState<DraftSyncStatus>('synced')
  // The write-behind queue owns debounce + offline retry + the save-time
  // pause (a paused queue can't re-put the draft the save action deletes —
  // the resurrection race). Created once via the state initializer (never
  // re-set); `key` is stable per mount.
  const [queue] = useState<DraftSyncQueue>(() =>
    createDraftSyncQueue({
      send: (payload) => putWorkoutDraftAction(key, payload),
      remove: () => deleteWorkoutDraftAction(key),
      onStatus: setSyncStatus,
    }),
  )
  const router = useRouter()
  const queryClient = useQueryClient()
  // Gear is server-passed but user-editable inside the sheet; local state so a
  // save reflects immediately without a round-trip re-render.
  const [gear, setGear] = useState<Equipment>(equipment ?? DEFAULT_EQUIPMENT[unit])
  // Which exercise's plate sheet is open (by index), if any.
  const [plateSheetFor, setPlateSheetFor] = useState<number | null>(null)
  // Which exercise's identity-note sheet is open (by index), if any. The
  // sticky chip that opens it renders ONLY when a pinned note exists — an
  // exercise without a note keeps its markup byte-identical (the effort-row
  // discipline).
  // Which exercise the QuickCapture sheet is open for, plus WHICH text seeds
  // it: 'identity' (pinned-chip tap — edit the pinned body) or 'session'
  // (pin-as-promotion — the session note being promoted). The two entry
  // points must diverge or promotion silently drops the session text
  // whenever an identity note already exists.
  const [noteSheetFor, setNoteSheetFor] = useState<{
    index: number
    seed: 'identity' | 'session'
  } | null>(null)
  // Session-local note edits, keyed `${source}:${id}`: undefined = untouched
  // (the Prev query's ride-along wins), null = deleted this session. The
  // last-performance query stays frozen — this map is the fresher truth.
  const [noteOverrides, setNoteOverrides] = useState<
    Record<string, IdentityNote | null>
  >({})
  // Previous-chip feedback: the set whose inputs briefly flash after a fill —
  // "accepted from history", not an error, hence a highlight (never a shake).
  const [flashSetId, setFlashSetId] = useState<string | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Refused check-off feedback: the weight_reps set whose empty weight input
  // briefly flashes when its circle is tapped — "this needs a weight", the
  // error twin of fill-flash (still color-only, never a shake).
  const [weightNudgeSetId, setWeightNudgeSetId] = useState<string | null>(null)
  const weightNudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Weight steppers show ONLY for the row whose weight input has focus —
  // zero ambient chrome for lifters who never use them.
  const [stepperSetId, setStepperSetId] = useState<string | null>(null)
  // Completion pop: which circle animates, and whether the tap finished the
  // whole exercise (bigger pop, feeds the collapse). No timer needed — the
  // one-shot animation replays only when the class re-attaches (uncheck →
  // recheck flips `completed`, which drops and re-adds it).
  const [completionPop, setCompletionPop] = useState<{ setId: string; big: boolean } | null>(null)
  // One-time warm-up gesture hint: shown until the user tags their first-ever
  // warm-up set (localStorage flag, read post-mount — SSR can't know it).
  const [showWarmupHint, setShowWarmupHint] = useState(false)
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync from localStorage (external system)
      setShowWarmupHint(window.localStorage.getItem(WARMUP_HINT_KEY) !== '1')
    } catch {
      // Storage blocked: keep the hint hidden rather than nag forever.
    }
  }, [])
  function dismissWarmupHint() {
    setShowWarmupHint(false)
    try {
      window.localStorage.setItem(WARMUP_HINT_KEY, '1')
    } catch {
      // Best-effort: the hint just reappears next session.
    }
  }
  // Long-press on a set circle toggles its warm-up tag. One primary pointer
  // at a time, so component-level refs suffice — no per-row state. The fired
  // flag suppresses the press's own click (the completion toggle).
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFiredRef = useRef(false)
  const pressOriginRef = useRef<{ x: number; y: number } | null>(null)

  function cancelLongPress() {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = null
    pressOriginRef.current = null
  }

  useEffect(() => cancelLongPress, [])

  // Row-BODY long-press → the set context menu (notes v2). Deliberately its
  // own refs — sharing the circle's would let the two gestures cancel each
  // other; the circle's warm-up hold is untouched. Same LONG_PRESS_MS/SLOP
  // machinery; the fired flag arms a click-capture swallow so the release
  // tap can't also land on an input or the circle.
  const rowPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowPressOriginRef = useRef<{ x: number; y: number } | null>(null)
  const rowPressFiredRef = useRef(false)
  // Which set row's context menu is open, anchored at the press point.
  const [rowMenu, setRowMenu] = useState<{
    exerciseIndex: number
    setIndex: number
    x: number
    y: number
  } | null>(null)
  // Which set the capture sheet is open for (the sheet's DEFAULT scope is
  // the pressed set; scope chips can retarget before saving).
  const [noteCaptureFor, setNoteCaptureFor] = useState<NoteCaptureTarget | null>(null)
  // The save receipt: the set whose volt dot pops in (150ms, motion-safe).
  const [notePopSetId, setNotePopSetId] = useState<string | null>(null)

  function cancelRowPress() {
    if (rowPressTimerRef.current) clearTimeout(rowPressTimerRef.current)
    rowPressTimerRef.current = null
    rowPressOriginRef.current = null
  }

  useEffect(() => cancelRowPress, [])

  // Offline fallback for capture-sheet SET notes (the pending-notes queue's
  // consumer): entries land here only when the post-save batch create fails,
  // already downgraded to a workout anchor (fallbackPendingNotes). Send
  // routes by anchor kind — downgraded workout-anchored notes go through the
  // fallback action (marker snapshot: never the canonical session note);
  // anything else replays as a plain create. Storage access stays inside the
  // callbacks so the queue is SSR-safe to construct.
  const [notesQueue] = useState<PendingNotesQueue>(() =>
    createPendingNotesQueue({
      load: () => {
        try {
          return window.localStorage.getItem(PENDING_NOTES_STORAGE_KEY)
        } catch {
          return null
        }
      },
      store: (raw) => {
        if (raw === null) window.localStorage.removeItem(PENDING_NOTES_STORAGE_KEY)
        else window.localStorage.setItem(PENDING_NOTES_STORAGE_KEY, raw)
      },
      send: async (note) => {
        if (note.anchor.kind === 'workout') {
          await createFallbackSetNoteAction(note.anchor.id, note.body, note.id)
        } else {
          await createNoteAction(note.anchor, note.body, note.id)
        }
      },
    }),
  )

  // Flush on mount + reconnect: a note queued by a previous session (save
  // landed, notes didn't) delivers the next time any logger is open with a
  // network — the queue is one per browser, not per workout.
  useEffect(() => {
    void notesQueue.flush()
    const onOnline = () => void notesQueue.flush()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [notesQueue])
  // Fully-completed cards collapse to a one-line summary; this holds the ids
  // the lifter re-expanded (to correct a set). Never pruned — stale ids are
  // harmless once an exercise stops being complete.
  const [expandedDone, setExpandedDone] = useState<Set<string>>(new Set())
  // Per-exercise notes textareas the lifter opened. Visibility is
  // open-OR-has-notes: a card with a note always shows it (a hidden note is
  // a lost note), so stale ids are harmless here too.
  const [notesOpen, setNotesOpen] = useState<Set<string>>(new Set())
  // Mount-time content must not animate as a wall; only cards/rows appearing
  // AFTER the session settles (adds, restores, swaps) ease in.
  const [riseInArmed, setRiseInArmed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setRiseInArmed(true), 400)
    return () => clearTimeout(t)
  }, [])

  useEffect(
    () => () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    },
    [],
  )

  useEffect(
    () => () => {
      if (weightNudgeTimerRef.current) clearTimeout(weightNudgeTimerRef.current)
    },
    [],
  )

  function flashFilledSet(setId: string) {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    setFlashSetId(setId)
    flashTimerRef.current = setTimeout(() => setFlashSetId(null), 700)
  }
  // Which exercise's all-time stats sheet is open (by index), if any —
  // opened by tapping the exercise's name.
  const [statsSheetFor, setStatsSheetFor] = useState<number | null>(null)
  // Whether the add-exercise sheet is up — opened from the sticky bar, so
  // adding stays one thumb-reach away however deep the workout scrolls.
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  // Just-removed exercises AND sets, held as a stack for the inline Undo
  // window. Any removal mid-workout is a destructive slip (values gone,
  // autosave persists the loss within the debounce), so both levels must be
  // reversible — a stack (not a single slot) so rapid removals can't silently
  // drop an earlier undo. Each removal restarts the shared window; Undo
  // restores last-removed-first.
  const [removed, setRemoved] = useState<RemovedEntry[]>([])
  // The undo window's clock lives in SessionToast's drain animation (its
  // animationend dismisses — so hover/focus pausing the visual pauses the
  // window too). This key restarts that animation: bumped ONLY on push, so
  // an Undo tap mid-stack never re-extends the shared window (the old
  // setTimeout behavior, preserved).
  const [undoResetKey, setUndoResetKey] = useState(0)
  // Which exit the undo toast plays when it closes: 100ms fade after an
  // Undo press, the default drop-fade after expiry/replacement.
  const [undoExitQuick, setUndoExitQuick] = useState(false)
  // When the user last checked off a set — starts the between-sets rest
  // count-up. In-session only by design: a restored draft can't know how long
  // ago the interrupted session's last set really was.
  const [restStartedAt, setRestStartedAt] = useState<Date | null>(null)
  // The CURRENT rest period's plan-prescribed target (the completed set's
  // restSec), captured at check-off time. Kept separate from the session
  // default instead of pre-merged so the two stay independently live: editing
  // the default mid-rest retargets a default-driven countdown instantly but
  // never overwrites a plan prescription. The effective target below is the
  // same value resolveRestTarget(plan, setIndex, sessionRestSec) yields.
  const [restPlanSec, setRestPlanSec] = useState<number | null>(null)
  // The session's fallback rest target — server-seeded, sheet-editable
  // (optimistic local state; the server persist is best-effort). Same
  // local-first pattern as `gear`.
  const [sessionRestSec, setSessionRestSec] = useState<number | null>(defaultRestSec)
  // Whether the rest-target sheet is up (opened by tapping the rest pill's
  // time area in the sticky bar).
  const [isRestSheetOpen, setIsRestSheetOpen] = useState(false)
  // Quick-adjust (−15/+15) offset for the CURRENT rest period ONLY. Scope is
  // a settled constraint: it never writes into sessionRestSec (the session
  // default) or any plan restSec — the next check-off resets it to 0 and
  // that period starts clean at its own target.
  const [restOffsetSec, setRestOffsetSec] = useState(0)
  const restTargetSec = adjustedRestTarget(restPlanSec ?? sessionRestSec, restOffsetSec)

  /** Skip ends the CURRENT rest period outright — restStartedAt clears (the
   *  rest pill disappears, no overage counts up), the plan capture and
   *  offset go with it. Defaults and plan values are untouched. */
  function handleSkipRest() {
    setRestStartedAt(null)
    setRestPlanSec(null)
    setRestOffsetSec(0)
  }

  // The set whose post-completion effort chip row is open — the just-checked
  // set (when its show rule passes) or a logged caption re-opened for a
  // correction. One at a time; skip-by-ignoring means the next check-off
  // simply moves it. Never set while the show rule is false, so opted-out
  // sessions carry only this dormant null.
  const [effortPromptSetId, setEffortPromptSetId] = useState<string | null>(null)

  // Replace-exercise flow: which exercise the sheet is replacing (null = the
  // sheet is in plain add mode), and a pick paused at the logged-work guard.
  const [replaceTargetIndex, setReplaceTargetIndex] = useState<number | null>(null)
  const [pendingReplace, setPendingReplace] = useState<{
    index: number
    picked: PickedExercise
  } | null>(null)
  // Substitute plan targets fetched after a swap, overlaying the server-
  // seeded planTargets (which stays keyed to the plan's ORIGINAL exercises).
  // In-memory only: a reload falls back to history ghosts (accepted).
  const [planOverrides, setPlanOverrides] = useState<Record<string, PlanSetTarget[]>>({})
  // Post-swap "use for the block?" prompt — one at a time, newest swap wins.
  // Snooze is per ORIGINAL exercise, in-memory for this workout only (a
  // fresh swap next session re-asks once — that repeat IS the signal the
  // question deserves re-asking; no persistent snooze store by design).
  const [pendingRemember, setPendingRemember] = useState<{
    originalId: number
    originalSource: ExerciseSource
    originalName: string
    substituteId: number
    substituteSource: ExerciseSource
    substituteName: string
    replacementId: string
  } | null>(null)
  // Snooze is per ORIGINAL slot, keyed by the composite `source:id`.
  const [rememberSnoozed, setRememberSnoozed] = useState<Set<string>>(new Set())
  // Renders INSIDE the prompt row so the user retries in place.
  const [rememberError, setRememberError] = useState<string | null>(null)
  const [isRemembering, setIsRemembering] = useState(false)
  // "Use plan as written" per exercise (ephemeral, this session only): the
  // exercise's ghost targets revert from the autoreg-adjusted loads to the
  // unadjusted scheme values carried alongside as planLoadKg. Zero taps added
  // to logging — the escape is opt-in, the adjusted ghosts are the default.
  const [autoregReverted, setAutoregReverted] = useState<Set<string>>(new Set())
  // Substitute overlay first, then the server-seeded plan — both ghost
  // placeholders and the rest countdown must see the same answer. Everything
  // keys on the composite `source:id`, so a custom whose serial id collides
  // with a wger plan slot can never wear that slot's ghosts or rest targets.
  const planFor = (source: ExerciseSource, id: number) => {
    const key = `${source}:${id}`
    const targets = planOverrides[key] ?? planTargets?.[key]
    if (!targets || !autoregReverted.has(key)) return targets
    return targets.map((t) =>
      t.planLoadKg !== undefined ? { ...t, loadKg: t.planLoadKg } : t,
    )
  }

  // "Next up" for the sticky bar: the first incomplete set in workout order,
  // labeled from typed values first, ghost targets as fallback — the
  // thumb-zone glance that replaces scroll-hunting between sets.
  const nextUp = (() => {
    for (let exerciseIndex = 0; exerciseIndex < draft.exercises.length; exerciseIndex++) {
      const exercise = draft.exercises[exerciseIndex]
      if (exercise.skipped) continue // opted out — never "next"
      const setIndex = exercise.sets.findIndex((set) => !set.completed)
      if (setIndex === -1) continue
      const set = exercise.sets[setIndex]
      const plan = planPlaceholderForSet(planFor(exercise.source, exercise.wgerExerciseId), setIndex, unit)
      // Typed values win per field; the fallback ghost is the plan target
      // (same planSetGhost rule as the set rows).
      const ghost = planSetGhost(plan, exercise.loggingType)
      const label = previousChipLabel(
        {
          reps: set.reps || ghost.reps,
          weight:
            exercise.loggingType === 'weight_reps'
              ? set.weight || ghost.weight
              : set.weight || undefined,
          // Cardio next-up reads as its duration (typed first, plan fallback).
          duration: (set.duration ?? '') || ghost.duration,
        },
        exercise.loggingType,
      )
      return { exercise, setIndex, label }
    }
    return null
  })()

  // Session pulse: completed/total working sets, derived per render from the
  // draft (zero queries) — feeds the header count and the sticky bar's
  // progress fill.
  const pulse = sessionPulse(draft.exercises)

  function pushRemoved(entry: RemovedEntry) {
    setRemoved((prev) => [...prev, entry])
    setUndoResetKey((key) => key + 1) // restart the toast's drain = the window
    setUndoExitQuick(false)
  }

  function handleRemoveExercise(index: number) {
    const exercise = draft.exercises[index]
    dispatch({ type: 'REMOVE_EXERCISE', index })
    pushRemoved({ kind: 'exercise', exercise, index })
    // Trashing the substitute withdraws its remember question — the prompt
    // must never offer to persist an exercise no longer in the session.
    if (pendingRemember?.replacementId === exercise.id) {
      setPendingRemember(null)
    }
  }

  function performReplace(index: number, picked: PickedExercise) {
    const previous = draft.exercises[index]
    if (!previous) return // list shifted while the sheet was up — nothing to replace
    const replacement = replacementDraftExercise(picked, previous.sets.length)
    dispatch({ type: 'REPLACE_EXERCISE', index, exercise: replacement })
    pushRemoved({ kind: 'replace', previous, replacementId: replacement.id })
    // Re-derive the slot's plan targets for the substitute (loads from ITS
    // history, original-movement absolutes stripped server-side) — best-effort
    // enhancement: ghosts stay history-only if this fails or the workout is
    // ad-hoc (the action nulls quietly for non-program sessions). Identity is
    // the composite (source, id) on both ends, customs included.
    if (workoutId) {
      substitutePlanTargetsAction(
        workoutId,
        previous.wgerExerciseId,
        picked.wgerExerciseId,
        previous.source,
        picked.source,
      )
        .then((targets) => {
          if (targets) {
            setPlanOverrides((prev) => ({
              ...prev,
              [`${picked.source}:${picked.wgerExerciseId}`]: targets,
            }))
          }
        })
        .catch(() => {
          // Non-critical: the swap already stands on history ghosts.
        })
    }
    // Offer to make it permanent — only for PLAN exercises (planTargets is
    // keyed by exactly the plan's slots, NOT the overlay: ad-hoc sessions,
    // hand-added exercises, and re-swapped substitutes never qualify) and
    // not while snoozed for this workout.
    const previousKey = `${previous.source}:${previous.wgerExerciseId}`
    if (workoutId && planTargets?.[previousKey] !== undefined && !rememberSnoozed.has(previousKey)) {
      setRememberError(null)
      setPendingRemember({
        originalId: previous.wgerExerciseId,
        originalSource: previous.source,
        originalName: previous.name,
        substituteId: picked.wgerExerciseId,
        substituteSource: picked.source,
        substituteName: picked.name,
        replacementId: replacement.id,
      })
    }
  }

  function handleRememberJustToday() {
    if (!pendingRemember) return
    setRememberSnoozed((prev) =>
      new Set(prev).add(`${pendingRemember.originalSource}:${pendingRemember.originalId}`),
    )
    setPendingRemember(null)
  }

  async function handleRememberForBlock() {
    if (!pendingRemember || !workoutId) return
    setIsRemembering(true)
    try {
      setRememberError(null)
      await rememberSwapAction(
        workoutId,
        pendingRemember.originalId,
        {
          wgerExerciseId: pendingRemember.substituteId,
          source: pendingRemember.substituteSource,
          name: pendingRemember.substituteName,
        },
        pendingRemember.originalSource,
      )
      setPendingRemember(null)
    } catch {
      // The prompt stays: the error renders inside it, retry in place.
      setRememberError(t('rememberError'))
    } finally {
      setIsRemembering(false)
    }
  }

  /** One pick, one gate: routes a replacement through the logged-work guard
   *  (warn + Add-instead instead of silently discarding checked-off sets)
   *  before performReplace. Shared by the sheet's live pick and the
   *  create-from-swap return leg, so both fire the exact same swap. */
  function applyPick(index: number, picked: PickedExercise) {
    const target = draft.exercises[index]
    if (!target) return
    if (target.sets.some((set) => set.completed)) {
      setPendingReplace({ index, picked })
      return
    }
    performReplace(index, picked)
  }

  function handleReplacePick(picked: PickedExercise) {
    const index = replaceTargetIndex
    setReplaceTargetIndex(null) // the sheet closes itself; clear replace mode
    if (index === null) return
    applyPick(index, picked)
  }

  /** #218 outbound leg: the picker's create row pushes the full-page form.
   *  Flush the draft first (best-effort) so the page seed on return already
   *  holds this session; the swap target travels by the draft exercise's
   *  STABLE client id (persisted in the payload), never by index. */
  function handleCreateNavigate(query: string) {
    queue.flush()
    const params = new URLSearchParams()
    if (query) params.set('name', query)
    if (replaceTargetIndex !== null) {
      const target = draft.exercises[replaceTargetIndex]
      if (!target) return
      params.set('return', 'swap')
      params.set('target', target.id)
    } else {
      params.set('return', 'add')
    }
    router.push(`/exercises/new?${params.toString()}`)
  }

  // #218 return leg: consume the pick instruction the create page stored and
  // route it through the SAME paths a live pick takes (append, or swap with
  // the logged-work guard + plan-target re-derive + use-for-block prompt +
  // undo). Mount-only against the server-seeded draft; a vanished target
  // drops the instruction silently (silence over corruption).
  useEffect(() => {
    const pick = consumePendingPick()
    if (!pick) return
    // The pick is newer user intent than any cross-device snapshot: hold the
    // async draft restore off exactly like in-flight typing, so it can't
    // clobber the swap or silently close the guard dialog it may open.
    dirtyRef.current = true
    if (pick.mode === 'add') {
      dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(pick.exercise) })
      return
    }
    const index = draft.exercises.findIndex((exercise) => exercise.id === pick.targetId)
    if (index === -1) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount sync from sessionStorage (external system), the WARMUP_HINT_KEY precedent
    applyPick(index, pick.exercise)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: applies against the seeded draft
  }, [])

  function handleRemoveSet(exerciseIndex: number, setIndex: number) {
    const exercise = draft.exercises[exerciseIndex]
    const set = exercise.sets[setIndex]
    dispatch({ type: 'REMOVE_SET', exerciseIndex, setIndex })
    pushRemoved({
      kind: 'set',
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      setIndex,
      set,
    })
  }

  function handleUndoRemove() {
    const last = removed[removed.length - 1]
    if (!last) return
    if (last.kind === 'exercise') {
      dispatch({ type: 'INSERT_EXERCISE', index: last.index, exercise: last.exercise })
    } else if (last.kind === 'replace') {
      // Swap the ORIGINAL back over the replacement, wherever it sits now;
      // a vanished replacement (removed meanwhile) leaves nothing to undo into.
      const index = draft.exercises.findIndex((e) => e.id === last.replacementId)
      if (index !== -1) {
        dispatch({ type: 'REPLACE_EXERCISE', index, exercise: last.previous })
      }
      // Undoing the swap withdraws its remember question.
      if (pendingRemember?.replacementId === last.replacementId) {
        setPendingRemember(null)
      }
    } else {
      // Resolve the exercise's CURRENT index by id; if its own removal is
      // deeper in the stack, undoing that first brings this set's home back.
      const exerciseIndex = draft.exercises.findIndex((e) => e.id === last.exerciseId)
      if (exerciseIndex !== -1) {
        dispatch({ type: 'INSERT_SET', exerciseIndex, setIndex: last.setIndex, set: last.set })
      }
    }
    setRemoved((prev) => prev.slice(0, -1))
    // Popping the LAST entry closes the toast — that close is the undo-pressed
    // exit (100ms fade), not the expiry drop.
    setUndoExitQuick(true)
  }

  // Restore an interrupted session from the server draft (cross-device: a
  // session started on the phone resumes on the laptop). In edit mode this
  // intentionally wins over the server-seeded workout rows: a live draft is
  // newer than the row it was seeded from. Last writer wins across devices.
  // The PAGES pre-seed this same draft server-side (no content swap on
  // mount); this fetch is the cross-device race net — a draft
  // written after the page rendered still lands here. When both saw the same
  // draft, the RESTORE_DRAFT dispatch is a same-values no-op for the
  // autosave snapshot; dirtyRef keeps it from clobbering in-flight typing.
  useEffect(() => {
    let cancelled = false
    getWorkoutDraftAction(key)
      .then((payload) => {
        if (cancelled || dirtyRef.current) return
        // parseDraftPayload also clamps a future openedAt (clock skew) to now.
        const restored = parseDraftPayload(payload, { unit, now: new Date() })
        if (!restored) return
        dispatch({ type: 'RESTORE_DRAFT', draft: restored.draft })
        setName(restored.name)
        setOpenedAt(restored.openedAt)
        // A whole-draft replace orphans any pending undo entries; drop them
        // so the Undo button can't promise a restore it can no longer make.
        setRemoved([])
        // Same rationale for an in-flight replace: its numeric index would
        // silently retarget under the restored draft — cancel, don't retarget.
        setReplaceTargetIndex(null)
        setPendingReplace(null)
        // Index-addressed sheets too: a restore landing while one is open
        // would silently point it at a different exercise. (Remove/replace
        // can't race these — the modal dialog makes the page inert — but the
        // restore is async and can.)
        setPlateSheetFor(null)
        setStatsSheetFor(null)
        setNoteSheetFor(null)
        // Index-addressed notes-v2 surfaces: a restore under an open menu or
        // capture sheet would silently retarget them at a different set.
        setRowMenu(null)
        setNoteCaptureFor(null)
        // And a held finish warning: its snapshot draft predates the restore.
        setPendingFinish(null)
        // And an open effort prompt: its set id may not exist in the
        // restored draft (id-addressed, but a stale id is a dead prompt).
        setEffortPromptSetId(null)
        // And the remember prompt: its swap may not exist in the restored draft.
        setPendingRemember(null)
      })
      .catch(() => {
        // Non-critical: restore is best-effort; the logger works without it.
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only: key/unit are stable per page load
  }, [])

  // Autosave every change to the server draft. The queue debounces bursts,
  // sends only the latest snapshot, and retries failures on an interval —
  // a gym dead zone delays the sync instead of silently dropping it.
  useEffect(() => {
    const snapshot = JSON.stringify({ name, notes: draft.notes, exercises: draft.exercises })
    if (lastSnapshotRef.current === snapshot) return // StrictMode re-run or no real change
    const isMount = lastSnapshotRef.current === null
    lastSnapshotRef.current = snapshot
    if (isMount) return // the server-seeded first render — nothing user-entered yet
    dirtyRef.current = true
    const isEmptyDraft = draft.exercises.length === 0 && !name.trim()
    queue.enqueue(
      isEmptyDraft ? null : buildDraftPayload({ draft, name, unit, openedAt }),
    )
  }, [draft, name, unit, openedAt, queue])

  // Reconnect signal: retry a failed sync the moment the network is back,
  // instead of waiting out the retry interval. Unmount stops the queue;
  // setup resumes it so the pair is symmetric — StrictMode's dev-time
  // mount→cleanup→mount would otherwise leave the queue paused forever.
  useEffect(() => {
    queue.resume()
    const onOnline = () => queue.flush()
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('online', onOnline)
      queue.pause()
    }
  }, [queue])

  const isEmpty = draft.exercises.length === 0
  // Every exercise has sets and every set is checked off — the moment the
  // Finish button starts nudging (and the last card outline turns volt).
  // Skipped exercises are opted out — they must not hold the nudge hostage.
  const isSessionDone =
    !isEmpty &&
    draft.exercises.every(
      (exercise) =>
        exercise.skipped ||
        (exercise.sets.length > 0 && exercise.sets.every((set) => set.completed)),
    )

  // Deliberately NOT wrapped in startTransition: tying router.push to an async
  // transition made the experimental <ViewTransition> capture race the
  // destination page's suspended data reads, which could strand the old
  // screen's snapshot over the new page (taps landed on a frozen picture).
  // Await everything first, then navigate outside any transition scope.
  /**
   * Live Finish entry point: run the completion pass, then either save
   * straight through or hold for the skipped-sets warning. Edit mode
   * ("Save changes") bypasses this — corrections must never silently flip
   * completion states the lifter didn't touch.
   */
  function handleFinishClick() {
    if (!isLive) {
      handleSave()
      return
    }
    const result = completeFilledSets(draft)
    if (result.skipped > 0) {
      setPendingFinish(result)
      return
    }
    finishWith(result.draft)
  }

  /** Adopt the completion-pass draft into state (so autosave and a failed
   *  save agree with what's persisted) and save it. The dispatch MUST stay
   *  before handleSave's first await: queue.settle() pauses autosave
   *  synchronously, so the re-render's enqueue can never land after the
   *  save deletes the server draft (the resurrection race). */
  function finishWith(finalDraft: WorkoutDraft) {
    dispatch({ type: 'RESTORE_DRAFT', draft: finalDraft })
    handleSave(finalDraft)
  }

  /** Post-save leg for capture-sheet SET notes: the extracted orchestration
   *  (note-capture.ts persistSetNotes — unit-tested there) with the logger's
   *  real seams injected: the batch server action and the pending queue. */
  function persistDraftSetNotes(savedWorkoutId: string, finalDraft: WorkoutDraft) {
    return persistSetNotes(savedWorkoutId, finalDraft, {
      createBatch: (id, entries) => createSetNotesForWorkoutAction(id, entries),
      enqueue: (note) => notesQueue.enqueue(note),
    })
  }

  async function handleSave(finalDraft: WorkoutDraft = draft) {
    setPlateSheetFor(null) // a live showModal() dialog must not cross navigation
    setStatsSheetFor(null) // same for the stats sheet
    setNoteSheetFor(null) // and the identity-note sheet
    setRowMenu(null) // the set context menu + capture sheet die with the barrier
    setNoteCaptureFor(null)
    setIsPickerOpen(false) // same top-layer invariant for the exercise sheet
    setIsRestSheetOpen(false) // and for the rest-target sheet
    setReplaceTargetIndex(null) // and for the replace sheet + its guard dialog
    setPendingReplace(null)
    setPendingRemember(null) // an unanswered remember prompt dies with the session
    setIsSaving(true)
    try {
      setError(null)
      // Save-time barrier: pause autosave AND wait out any put already on
      // the wire, so nothing can land after the save action deletes the
      // draft and resurrect it.
      await queue.settle()
      // The save actions delete this surface's server draft themselves —
      // the saved workout supersedes it on every device.
      if (workoutId) {
        await updateWorkoutAction(workoutId, draftToInput(finalDraft, name, unit))
        // Capture-sheet set notes land AFTER the replace, against the
        // re-inserted rows (their positional address) — creating them before
        // would hand them to rows the replace is about to delete.
        await persistDraftSetNotes(workoutId, finalDraft)
        // History changed: the browser QueryClient outlives this page, so
        // cached ghosts would otherwise show pre-save data next session.
        queryClient.invalidateQueries({ queryKey: ['last-performance'], refetchType: 'none' })
        // Success: close the finish warning (if open) BEFORE navigating —
        // the same stranded-::backdrop race the discard dialog guards.
        closeFinishDialogRef.current?.()
        setPendingFinish(null)
        // `finished=1` is presentation-only: the summary swaps its plain
        // header for the completion moment. Gated on isLive because this
        // update branch is shared with edit-mode "Save changes" — a
        // correction to an old workout is not a finish.
        // REPLACE, never push (stack hygiene, spike §3d): the post-save
        // logger entry must not survive — swiping back from the summary
        // must never resurrect a finished session. markReplace keeps the
        // NavigationTracker stack agreeing with the real history.
        markReplace()
        router.replace(isLive ? `/workout/${workoutId}?finished=1` : `/workout/${workoutId}`)
      } else {
        const { id } = await saveWorkoutAction({
          ...draftToInput(finalDraft, name, unit),
          // Live session bounds: opened → saved. Without the explicit
          // completedAt the DB layer would fall back to startedAt (the
          // backdating default) and every live log would read as 0 min.
          startedAt: openedAt,
          completedAt: new Date(),
        })
        // The new-session leg of the positional design: the server workout
        // exists only NOW, so queued set notes flush here, right after save.
        await persistDraftSetNotes(id, finalDraft)
        queryClient.invalidateQueries({ queryKey: ['last-performance'], refetchType: 'none' })
        // Same success-path close-before-push as the update branch above.
        closeFinishDialogRef.current?.()
        setPendingFinish(null)
        // Land on the session summary (duration, volume, PR badges) — the
        // finish deserves a readout, not a home-screen redirect. This create
        // branch only exists for live sessions, but the isLive gate keeps the
        // finished=1 contract in one shape with the update branch above.
        // Same replace-not-push contract as the update branch above.
        markReplace()
        router.replace(isLive ? `/workout/${id}?finished=1` : `/workout/${id}`)
      }
      // isSaving intentionally stays true on success: the button reads
      // "Saving…" until the navigation unmounts this screen.
    } catch {
      queue.resume() // save failed — autosave picks the latest back up
      setIsSaving(false)
      setError(t('saveError'))
    }
  }

  // Discard a LIVE session: the draft goes, and (for a program session
  // started from home) so does the already-created workout row — otherwise
  // the abandoned row lingers in Unfinished forever. Same shape as
  // handleSave: settle() is the save-time barrier (a paused queue can't
  // re-put the draft the delete just removed — the resurrection race), and
  // navigation happens OUTSIDE any startTransition (see handleSave's
  // comment on the <ViewTransition> strand).
  async function handleDiscard() {
    setPendingFinish(null) // finishing and discarding are mutually exclusive
    setPlateSheetFor(null) // a live showModal() dialog must not cross navigation
    setStatsSheetFor(null)
    setNoteSheetFor(null)
    setRowMenu(null)
    setNoteCaptureFor(null)
    setIsPickerOpen(false)
    setIsRestSheetOpen(false)
    setReplaceTargetIndex(null)
    setPendingReplace(null)
    setPendingRemember(null)
    setIsDiscarding(true)
    try {
      setDiscardError(null)
      // Shared, unit-tested destructive ordering (lib/discard-session):
      // settle the autosave queue, then ONE delete — the draft for a
      // quick-log surface, or the workout for an edit-mode session (its
      // action is ownership-scoped, cascades children, and clears the
      // draft keyed by the same id — no separate draft round-trip).
      await discardSession(key, {
        settle: () => queue.settle(),
        deleteDraft: deleteWorkoutDraftAction,
        deleteWorkout: deleteWorkoutAction,
      })
      // Release the confirm dialog's top layer imperatively before
      // navigating: relying on unmount cleanup to close() races React's
      // flush against router.push (the #25 stranded-::backdrop race).
      closeDiscardDialogRef.current?.()
      setIsDiscardModalOpen(false)
      // REPLACE to home, never push and never pop (spike §3d Q2): the
      // discarded logger entry must not survive, and a pop is unsafe here —
      // in edit mode the origin can be the just-DELETED workout's detail
      // page, which would notFound on return. The origin entry beneath the
      // replace is a known, accepted remainder.
      markReplace()
      router.replace('/')
      // isDiscarding stays true on success: buttons hold their disabled
      // state until the navigation unmounts this screen.
    } catch {
      queue.resume() // discard failed — autosave picks the draft back up
      setIsDiscarding(false)
      // The dialog stays open: the error renders inside it, retry in place.
      setDiscardError(t('discardError'))
    }
  }

  /** Per-row affordance skin. Declared here, not inline in the set map: an
   *  enum ternary written inside JSX reads to the i18n gate as copy. */
  const rowStateOf = (completed: boolean, isActive: boolean): 'done' | 'active' | 'waiting' =>
    completed ? 'done' : isActive ? 'active' : 'waiting'

  /** The undo toast's sentence — "Removed X" / "Replaced X", one whole ICU
   *  message per kind with the name as the emphasized chunk. Built outside
   *  JSX for the same reason as rowStateOf. */
  function undoMessage(last: RemovedEntry) {
    const emphasis = { name: (chunks: ReactNode) => <span className="font-medium">{chunks}</span> }
    if (last.kind === 'exercise') {
      return t.rich('undoRemoved', { subject: last.exercise.name, ...emphasis })
    }
    if (last.kind === 'replace') {
      return t.rich('undoReplaced', { subject: last.previous.name, ...emphasis })
    }
    return t.rich('undoRemoved', {
      subject: t('undoSetSubject', { number: last.setIndex + 1, name: last.exerciseName }),
      ...emphasis,
    })
  }

  /** Flips a set's warm-up tag. Same reason as above: the tag values are
   *  enum members, not words the user reads. */
  const nextSetTag = (tag: DraftSet['tag']) => (tag === 'warmup' ? 'working' : 'warmup')

  return (
    <>
      {/* The logger owns the app bar: the session clock belongs up there
          (glanceable without scrolling, out of the workout body), and only
          the logger knows the session's openedAt. Header action says
          "Close", not "Cancel": the autosaved draft survives and resumes
          from the home banner — nothing is cancelled. */}
      <AppHeader
        title={title}
        trailing={
          <>
            {/* Clock only for a live session — a finished workout's edit
                has no running time to show. openedAt (not a prop clock):
                a restored draft rewinds it to the original session start. */}
            {isLive && pulse.total > 0 && (
              // Session pulse: completed/total working sets (warm-ups and
              // skipped exercises excluded — scoring semantics). Muted, not
              // volt: while resting, the sticky bar's rest pill keeps the
              // one-volt slot.
              <span
                aria-label={t('pulseAriaLabel', { completed: pulse.completed, total: pulse.total })}
                className="text-sm text-muted-foreground tnum"
              >
                <span aria-hidden="true">
                  {pulse.completed}/{pulse.total}
                </span>
              </span>
            )}
            {isLive && <HeaderClock startedAt={openedAt} />}
            {/* Workout-note entry. It lives up here because a session note
                ("cut short — gym closing") is about the whole workout, and
                the old worded pill at the very bottom of the scroll was only
                findable by scrolling past every card to reach it. Same
                icon-only grammar as the exercise-level entry (NotebookPen,
                icon-sm ghost, hit-44-y for the 44px target #236) — one note
                vocabulary everywhere.

                It opens the capture SHEET, not the textarea below: an entry
                point at the top must never scroll-jump the session to an
                editor at the bottom. The sheet appends; the textarea below
                still owns display and inline editing.

                Gated on !isEmpty in lockstep with that textarea — on an
                exercise-less draft the note would have nowhere to show, and
                an unshowable note is a lost note. */}
            {!isEmpty && (
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0 hit-44-y text-muted-foreground"
                onClick={() => setNoteCaptureFor(workoutNoteCapture())}
                aria-label={t('workoutNoteAriaLabel')}
              >
                <NotebookPen aria-hidden="true" className="size-4" />
              </Button>
            )}
            {/* Back affordance, so it must pop-or-replace, never push
                (spike §3d): closeHref demotes from destination to cold-entry
                fallback. The draft still survives — Close ≠ Cancel. */}
            <button
              type="button"
              onClick={() => navigateBack(router, closeHref)}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              {tCommon('close')}
            </button>
          </>
        }
      />
      {/* The width wrapper moved in from the pages alongside the header:
          the sticky bar's -mx-5 bleed is calibrated against this px-5, so
          the pair must live in the same component. Pages keep the outer
          min-h flex column. */}
      <main className="mx-auto w-full max-w-md flex-1 px-5">
      <div className="space-y-4 py-5">
        <div>
          {/* A real label, not placeholder-as-label: the placeholder vanishes
              the moment typing starts, and an unlabeled box at the top of the
              screen reads as a mystery field. */}
          <div className="flex items-baseline justify-between gap-3 px-1">
            {/* A <label> only when there is a control to label — the live
                session shows static text, and htmlFor on a <p> is invalid. */}
            {isLive ? (
              <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t('nameLabel')}
              </span>
            ) : (
              <label
                htmlFor="workout-name"
                className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
              >
                {t('nameLabel')}
              </label>
            )}
            {/* The session's fixed (day · week) stamp: renaming or swapping
                exercises never moves a workout to another day, so the stamp
                stays visible while logging. */}
            {programContext && (
              <span className="shrink-0 text-xs text-muted-foreground tnum">{programContext}</span>
            )}
          </div>
          {isLive ? (
            // Mid-session the name is a fact, not a field (#207): renaming
            // belongs to the edit surface after the workout is saved. Static
            // text with the input's exact metrics (h-11, px-1, border slot
            // kept transparent) so edit mode swaps in the input without a
            // layout shift.
            <p
              id="workout-name"
              className={cn(
                'mt-1.5 flex h-11 items-center border-b-2 border-transparent px-1 text-base',
                name.trim() === '' && 'text-muted-foreground',
              )}
            >
              {name.trim() === '' ? t('namePlaceholderStatic') : name}
            </p>
          ) : (
            <Input
              id="workout-name"
              placeholder={t('namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              // De-boxed to an underline field (keep-list allows): same input,
              // same h-11 hit area, px-1 keeps horizontal hit padding.
              className="mt-1.5 rounded-none border-0 border-b-2 border-input bg-transparent px-1"
            />
          )}
        </div>

        {syncStatus === 'failed' && (
          <p className="px-1 text-sm text-warning" role="status">
            {t('offlineNotice')}
          </p>
        )}

        {/* Empty state as invitation, in the editorial voice: a font-display
            verdict + one plain sentence pointing at the thumb-bar CTA. */}
        {isEmpty && (
          <div className="px-1 py-8 text-center">
            <p className="font-display text-2xl font-semibold uppercase tracking-wide">
              {t('empty')}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t('emptyHint')}
            </p>
          </div>
        )}

        {draft.exercises.map((exercise, exerciseIndex) => {
          const isDone = exercise.sets.length > 0 && exercise.sets.every((set) => set.completed)
          // Done cards fold to one line so mid-session the scroll shows the
          // current and upcoming work, not rows of dead inputs. Re-expand is
          // one tap (corrections); auto-collapse costs the log path nothing.
          const isCollapsed = isDone && !expandedDone.has(exercise.id)
          // Affordance follows work (render-only skin): the FIRST incomplete
          // set is the one row wearing full input affordance; completed sets
          // flatten to quiet text; later incompletes wait muted until focused.
          const activeSetIndex = exercise.sets.findIndex((set) => !set.completed)
          const hasPR =
            typeof prIndexByExercise[exerciseIndex] === 'number' &&
            (prIndexByExercise[exerciseIndex] as number) >= 0
          // Plan superset pairing, display-only. Adjacent same-group cards
          // pull together and share a rail so the pair reads as one block.
          const supersetGroup =
            planSupersets?.[`${exercise.source}:${exercise.wgerExerciseId}`]
          const supersetLabel =
            supersetGroup !== undefined ? supersetLetters[supersetGroup] : undefined
          const previous = draft.exercises[exerciseIndex - 1]
          const continuesSuperset =
            supersetGroup !== undefined &&
            previous !== undefined &&
            planSupersets?.[`${previous.source}:${previous.wgerExerciseId}`] === supersetGroup
          // Sticky identity note (Strong's pin pattern): session-local edits
          // outrank the Prev ride-along; only pinned notes surface. Null =
          // zero note markup — the no-note path stays byte-identical.
          const identityKey = `${exercise.source}:${exercise.wgerExerciseId}`
          const identityNote = stickyNote(
            noteOverrides[identityKey],
            lastByExercise[identityKey]?.note,
          )
          // The middle tier (#211): last session's per-instance note, offered
          // once. Pure show rule — gone as soon as this session has its own
          // note, and never a duplicate of the pinned chip's text.
          const echoNote = lastSessionEcho(
            lastByExercise[identityKey]?.sessionNote,
            exercise.notes,
            identityNote,
            lastByExercise[identityKey]?.sessionSkipped ?? false,
          )
          return (
          <section
            key={exercise.id}
            className={cn(
              // De-carded: sections sit on hairline dividers, no shell.
              'border-b pb-4 transition-colors',
              riseInArmed && 'motion-safe:animate-rise-in',
              // Every set checked off = this movement is done: a quiet volt
              // hairline under the section is the same "live/complete" state
              // marker the resume banner and rest readout use. Skipped stays
              // muted — opting out is not a live state (one-volt rule).
              isDone && !exercise.skipped ? 'border-b-primary/30' : 'border-b-border/60',
              // Muted rail, not volt (one-volt rule): grouping is structure,
              // not a live state. The rail replaces the old card edge, so it
              // earns a little breathing room.
              supersetLabel !== undefined && 'border-l-2 border-l-muted-foreground/40 pl-3',
              continuesSuperset && '-mt-2',
            )}
          >
            {supersetLabel !== undefined && !isCollapsed && !exercise.skipped && (
              <p className="mb-3 text-[0.65rem] font-semibold uppercase tracking-widest text-muted-foreground">
                {t('supersetLabel', { group: supersetLabel })}
              </p>
            )}
          {exercise.skipped ? (
            /* Skipped fold: same one-line row pattern as the done-collapse
               below, but muted throughout — opting out is quiet, not volt.
               The whole row is the Unskip affordance (one tap back in). */
            <button
              type="button"
              onClick={() => dispatch({ type: 'TOGGLE_SKIP_EXERCISE', exerciseIndex })}
              aria-label={t('unskipAriaLabel', { name: exercise.name })}
              className={cn(
                'flex w-full items-center justify-between gap-3 py-2 text-left',
                riseInArmed && 'motion-safe:animate-rise-in',
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground"
                >
                  <CircleSlash className="size-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-base leading-tight text-muted-foreground line-through">
                    {exercise.name}
                  </span>
                  {exercise.notes.trim() !== '' && (
                    <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                      {exercise.notes}
                    </span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                {t('skippedBadge')}
              </span>
            </button>
          ) : isCollapsed ? (
            <button
              type="button"
              onClick={() =>
                setExpandedDone((prev) => {
                  const next = new Set(prev)
                  next.add(exercise.id)
                  return next
                })
              }
              aria-expanded={false}
              aria-label={t('expandAriaLabel', {
                name: exercise.name,
                summary: renderMessage(
                  tFormat,
                  completedSetsSummary(exercise.sets, exercise.loggingType),
                ),
                pr: hasPR ? 'yes' : 'no',
                superset: supersetLabel ?? 'none',
              })}
              className={cn(
                'flex w-full items-center justify-between gap-3 py-2 text-left',
                riseInArmed && 'motion-safe:animate-rise-in',
              )}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {/* Tinted volt disc echoes the completed set circle — the
                    log → collapse continuity, quieter than a solid fill. */}
                <span
                  aria-hidden="true"
                  className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/15 text-primary"
                >
                  <Check strokeWidth={3} className="size-3.5" />
                </span>
                <span className="truncate text-base leading-tight">{exercise.name}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground tnum">
                {renderMessage(
                  tFormat,
                  completedSetsSummary(exercise.sets, exercise.loggingType),
                )}
                {hasPR && <PrBadge />}
              </span>
            </button>
          ) : (
          <div className={cn('space-y-3', riseInArmed && 'motion-safe:animate-rise-in')}>
            {/* De-carded header: condensed-caps movement name with the tool
                rail inline on the same row (the name truncates; tools never
                wrap). The logging-type select sits on its own quiet line. */}
            <div>
              <div className="flex items-start justify-between gap-2">
              <h3 className="min-w-0 flex-1 text-base uppercase tracking-wide leading-tight">
                {/* The name IS the stats entry point (Strong/Hevy convention):
                    zero added chrome. Read-only, so unlike replace it never
                    freezes behind the save/discard barriers. */}
                <button
                  type="button"
                  onClick={() => setStatsSheetFor(exerciseIndex)}
                  aria-label={t('statsAriaLabel', { name: exercise.name })}
                  className="-my-1.5 py-1.5 text-left underline-offset-4 active:underline"
                >
                  {exercise.name}
                </button>
                {exercise.category && (
                  <span className="mt-0.5 block text-sm font-normal normal-case tracking-normal text-muted-foreground">
                    {exercise.category}
                  </span>
                )}
              </h3>
              <div className="-mr-1 flex shrink-0 items-center">
              {/* Notes affordance (one per exercise): the notes-v2 roll-up and
                  the note entry are the SAME button — pen + count when
                  anything is noted, bare pen when nothing is; either way it
                  opens this session's note editor. One merged affordance on
                  purpose: two identical pens in the rail would give no cue
                  which one is pressable. Chips mean pressable, so
                  a count that can be pressed wears a control's skin — the
                  rail's own ghost button, sized to fit the number. Keeps the
                  entry's hit-44-y (#236): the rail's buttons are 36px, and the
                  vertical-only extension buys the 44px target back without
                  bleeding into the neighbours it sits between. */}
              {(() => {
                const noteCount = exerciseNoteCount(exercise)
                return (
                  <Button
                    // A count needs a content-width box, so it switches to the
                    // `sm` size rather than overriding `icon-sm`'s `size-9`:
                    // both are h-9 with the same radius, so the rail's rhythm
                    // is identical either way, and no width utility has to win
                    // a stylesheet-order race against `size-*`. px-2 trims
                    // `sm`'s px-3 back to the rail's tighter gutter.
                    size={noteCount > 0 ? 'sm' : 'icon-sm'}
                    variant="ghost"
                    className={cn(
                      'mr-1 shrink-0 hit-44-y text-muted-foreground',
                      noteCount > 0 && 'gap-1 px-2',
                    )}
                    // The editor below closes on blur, so a plain press
                    // while it is open would tear it down and the click would
                    // rebuild it — same words, remounted field, caret thrown
                    // to the end mid-sentence. Preventing the default on
                    // mousedown keeps focus in the field (the toolbar-button
                    // pattern), which also makes the press a no-op instead of
                    // a flicker.
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setNotesOpen((prev) => new Set(prev).add(exercise.id))}
                    // The name has to say what pressing DOES. A pure-state
                    // name ("1 note on Squat") strands a screen-reader user
                    // twice: nothing marks it as an opener, and since the
                    // count rolls up SET notes, the note it names may not be
                    // the one the editor shows. Action first, count behind
                    // it — and `Edit` only when there is an exercise note to
                    // edit, because a lone set note opens an empty field.
                    aria-label={t('noteButtonAriaLabel', {
                      count: noteCount,
                      hasNote: exercise.notes.trim() === '' ? 'no' : 'yes',
                      name: exercise.name,
                    })}
                  >
                    <NotebookPen aria-hidden="true" className="size-4" />
                    {noteCount > 0 && (
                      // Fixed slot + tabular numerals: the box grows once,
                      // when the first note appears (a deliberate act), and
                      // never creeps again at the second or the tenth — the
                      // rail's other controls sit under a thumb already
                      // reaching for them.
                      <span aria-hidden="true" className="w-3 text-center text-xs tnum">
                        {noteCount}
                      </span>
                    )}
                  </Button>
                )
              })()}
              {/* A done card auto-collapses; once re-expanded for corrections
                  this is the way back down — same expandedDone set, inverse
                  edge. Only rendered when done: an unfinished card collapsing
                  would hide live inputs. */}
              {isDone && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  onClick={() =>
                    setExpandedDone((prev) => {
                      const next = new Set(prev)
                      next.delete(exercise.id)
                      return next
                    })
                  }
                  aria-expanded={true}
                  aria-label={t('collapseAriaLabel', { name: exercise.name })}
                >
                  <ChevronUp aria-hidden="true" className="size-4" />
                </Button>
              )}
              {/* Plates only make sense for a barbell-style total load — a
                  bodyweight movement has nothing to rack. */}
              {exercise.loggingType === 'weight_reps' && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setPlateSheetFor(exerciseIndex)}
                  aria-label={t('platesAriaLabel', { name: exercise.name })}
                >
                  <Dumbbell aria-hidden="true" className="size-4" />
                </Button>
              )}
              {/* Machine taken? Swap the movement, keep the slot. Renders for
                  EVERY loggingType (unlike plates) — equipment conflicts
                  aren't barbell-specific. Frozen with the other draft
                  mutations once a save/discard barrier engages. */}
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                disabled={isSaving || isDiscarding}
                onClick={() => setReplaceTargetIndex(exerciseIndex)}
                aria-label={t('replaceAriaLabel', { name: exercise.name })}
              >
                <ArrowLeftRight aria-hidden="true" className="size-4" />
              </Button>
              {/* Hairline gap between the everyday utilities and the
                  destructive remove — adjacency invites mid-set slips. */}
              <span aria-hidden="true" className="h-5 w-px shrink-0 self-center bg-border" />
              {/* Skip sits with remove past the divider: both are "opt out"
                  actions, though skip is reversible (the folded row unskips). */}
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0 text-muted-foreground"
                onClick={() => dispatch({ type: 'TOGGLE_SKIP_EXERCISE', exerciseIndex })}
                aria-label={t('skipAriaLabel', { name: exercise.name })}
              >
                <CircleSlash aria-hidden="true" className="size-4" />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                className="-mr-1 shrink-0 text-muted-foreground"
                onClick={() => handleRemoveExercise(exerciseIndex)}
                aria-label={t('removeExerciseAriaLabel', { name: exercise.name })}
              >
                <Trash2 aria-hidden="true" className="size-4" />
              </Button>
              </div>
              </div>
              {/* How this exercise logs (Hevy-style). A native select — four
                  options don't justify a custom menu, and the OS picker is the
                  best small-screen affordance. Ghost-quiet on purpose: it's a
                  per-exercise setting touched once, not a control competing
                  with the movement name — small caps + chevron, no box. */}
              <span className="relative inline-block">
                <select
                  value={exercise.loggingType}
                  onChange={(e) => {
                    // The DOM only offers whitelisted options; the guard keeps
                    // the reducer payload typed without an `as` cast.
                    if (isLoggingType(e.target.value)) {
                      dispatch({
                        type: 'SET_LOGGING_TYPE',
                        exerciseIndex,
                        loggingType: e.target.value,
                      })
                    }
                  }}
                  aria-label={t('loggingTypeAriaLabel', { name: exercise.name })}
                  className="h-9 appearance-none rounded-lg bg-transparent pl-1 pr-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {LOGGING_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`loggingType.${type}`)}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute right-0.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                />
              </span>
            </div>

            {/* Sticky identity-note chip: the pinned "seat pin 4" line that
                follows the exercise across sessions. A control (tap = open in
                QuickCapture), rendered ONLY when a pinned note exists — the
                no-note fast path gains nothing. Distinct from the session
                note textarea below, which stays per-instance. */}
            {identityNote !== null && (
              <button
                type="button"
                onClick={() => setNoteSheetFor({ index: exerciseIndex, seed: 'identity' })}
                aria-label={t('identityNoteAriaLabel', {
                  name: exercise.name,
                  note: noteChipLabel(identityNote.body),
                })}
                className="flex max-w-full items-center gap-1.5 self-start hit-44-y rounded-full border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground transition-colors active:bg-muted"
              >
                <Pin aria-hidden="true" className="size-3 shrink-0" />
                <span className="truncate">{noteChipLabel(identityNote.body)}</span>
              </button>
            )}

            {/* Last-session echo (#211's new tier): the previous session's
                note, one greyed italic line, read-only. Tap = copy it into
                this session's editor, prefilled — which retires the echo
                (exercise.notes is no longer empty). Muted throughout: memory,
                not a live state. */}
            {echoNote !== null && (
              <button
                type="button"
                onClick={() => {
                  dispatch({ type: 'SET_EXERCISE_NOTES', exerciseIndex, value: echoNote.text })
                  setNotesOpen((prev) => new Set(prev).add(exercise.id))
                }}
                aria-label={t('echoNoteAriaLabel', { name: exercise.name })}
                className="block max-w-full truncate px-0.5 text-left text-xs italic text-muted-foreground"
              >
                {echoNote.sessionSkipped
                  ? t('echoNoteSkipped', { note: noteChipLabel(echoNote.text) })
                  : t('echoNote', { note: noteChipLabel(echoNote.text) })}
              </button>
            )}

            {/* Session note, open-OR-has-notes (a hidden note is a lost note):
                open = the editor; closed with text = the words themselves are
                the reopen target (words are labels — and here the label IS
                the control, muted, no chip dress-up). The pin beside either
                state PROMOTES the note to the identity tier via QuickCapture
                (Strong's pin-as-promotion); the session copy stays.
                Trim-gated: a whitespace-only draft is not a note, so closing
                the editor over one hides this block rather than leaving an
                invisible reopen target (the header's note button reopens it,
                and unlike the old entry it never went away). */}
            {(notesOpen.has(exercise.id) || exercise.notes.trim() !== '') && (
              <div className="flex items-start gap-1">
                {notesOpen.has(exercise.id) ? (
                  <Textarea
                    rows={2}
                    autoFocus
                    placeholder={t('notePlaceholder')}
                    value={exercise.notes}
                    onChange={(e) =>
                      dispatch({ type: 'SET_EXERCISE_NOTES', exerciseIndex, value: e.target.value })
                    }
                    onBlur={() =>
                      setNotesOpen((prev) => {
                        const next = new Set(prev)
                        next.delete(exercise.id)
                        return next
                      })
                    }
                    aria-label={t('notesAriaLabel', { name: exercise.name })}
                    className="min-w-0 flex-1 motion-safe:animate-rise-in"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setNotesOpen((prev) => new Set(prev).add(exercise.id))}
                    aria-label={t('editNoteAriaLabel', { name: exercise.name })}
                    className="hit-44-y min-w-0 flex-1 whitespace-pre-wrap px-0.5 py-2 text-left text-sm text-muted-foreground"
                  >
                    {exercise.notes}
                  </button>
                )}
                {exercise.notes.trim() !== '' && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground"
                    onClick={() => setNoteSheetFor({ index: exerciseIndex, seed: 'session' })}
                    aria-label={t('pinNoteAriaLabel', { name: exercise.name })}
                  >
                    <Pin aria-hidden="true" className="size-4" />
                  </Button>
                )}
              </div>
            )}

            {/* Layer 1 auto-regulation, propose-don't-impose: the adjusted
                targets already ride the ghosts; this line is the REASON (the
                transparency contract) plus the one-tap per-exercise escape.
                Muted on purpose — guidance, never a gate on logging. */}
            {(() => {
              const autoregKey = `${exercise.source}:${exercise.wgerExerciseId}`
              const autoregInfo = planAutoreg?.[autoregKey]
              if (!autoregInfo) return null
              if (autoregReverted.has(autoregKey)) {
                return (
                  <p className="px-0.5 text-xs text-muted-foreground">
                    {t('autoregReverted')}
                  </p>
                )
              }
              return (
                <div className="space-y-0.5 px-0.5">
                  <p className="text-xs text-muted-foreground">
                    <span aria-hidden="true">{t('autoregGlyph')} </span>
                    {autoregInfo.reason}
                    <button
                      type="button"
                      onClick={() =>
                        setAutoregReverted((prev) => new Set(prev).add(autoregKey))
                      }
                      className="ml-2 underline underline-offset-2"
                    >
                      {t('autoregRevertAction')}
                    </button>
                  </p>
                  {/* While cutting, the reason line above already carries the
                      holding-is-the-win framing — repeating the deload nudge
                      here would contradict it (stalls are expected under a
                      deficit; deload only if sessions feel grindy). */}
                  {autoregInfo.suggestEarlyDeload &&
                    autoregInfo.phaseContext !== 'cutting' && (
                      <p className="text-xs text-muted-foreground">
                        {t('deloadNudge')}
                      </p>
                    )}
                </div>
              )
            })()}

            {exercise.sets.length > 0 && (
              <div className="flex items-center gap-2 px-0.5 text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground">
                <span className="w-8 shrink-0" aria-hidden="true" />
                <span className="w-10 shrink-0 text-center">{t('column.prev')}</span>
                {/* Cardio exercises head their columns Time/km; the first
                    set's metric mode speaks for the card (rows still render
                    per their OWN mode). */}
                {setMetricMode(exercise.sets[0]) !== 'reps_weight' ? (
                  <>
                    <span className="flex-1 text-center">{t('column.time')}</span>
                    <span className="flex-1 text-center">
                      {setMetricMode(exercise.sets[0]) === 'duration_distance'
                        ? t('column.distance')
                        : ''}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="flex-1 text-center">{t('column.reps')}</span>
                    <span className="flex-1 text-center">{unit}</span>
                  </>
                )}
                <span className="size-9 shrink-0" aria-hidden="true" />
              </div>
            )}
            {/* One-time warm-up gesture hint (first card only — a teaching
                caption, not chrome): retired forever after the first real
                warm-up tag, via the localStorage flag. */}
            {showWarmupHint && exerciseIndex === 0 && exercise.sets.length > 0 && (
              <p className="px-0.5 text-xs text-muted-foreground">
                {t('warmupHint')}
              </p>
            )}

            <div className="space-y-2">
              {exercise.sets.map((set, setIndex) => {
                // Two surfaces, two meanings: the grey input ghost is the
                // PLAN's week-N target; the Prev chip is last performance.
                // Neither borrows from the other.
                const history = placeholderForSet(
                  lastByExercise[`${exercise.source}:${exercise.wgerExerciseId}`] ?? null,
                  setIndex,
                  unit,
                )
                const plan = planPlaceholderForSet(
                  planFor(exercise.source, exercise.wgerExerciseId),
                  setIndex,
                  unit,
                )
                const ghost = planSetGhost(plan, exercise.loggingType)
                // Effort show rule (spec-exact): prescribed target on THIS
                // set, or the opt-in preference. False = zero effort UI and
                // zero new state writes — the fast path stays byte-identical.
                const effortTarget = planFor(exercise.source, exercise.wgerExerciseId)?.[setIndex]
                const effortEnabled = shouldShowEffortRow(effortTarget, rpeLoggingEnabled)
                // Prev is previous PERFORMANCE only: plan targets ghost the
                // inputs above but never masquerade as history in this column.
                const prevLabel = previousChipLabel(history, exercise.loggingType)
                // This row's metric: cardio rows swap reps/weight inputs for
                // duration (+ distance) and gate completion on duration.
                const metricMode = setMetricMode(set)
                const isCardioSet = metricMode !== 'reps_weight'
                // Chip fills from history (what the chip shows); BW-relative
                // types never fill a weight — theirs isn't a total load.
                // Cardio rows fill duration/distance instead (the ghost
                // strings are already in the input dialect — no adoptable
                // parse needed).
                const chipFill = isCardioSet
                  ? { duration: history.duration, distance: history.distance }
                  : {
                      reps: adoptableGhostValue(history.reps),
                      weight:
                        exercise.loggingType === 'weight_reps'
                          ? adoptableGhostValue(history.weight)
                          : undefined,
                    }
                // Enabled only when a tap would actually change something —
                // otherwise the flash would confirm a fill that never happened.
                const chipCanFill = isCardioSet
                  ? ((set.duration ?? '') === '' && !!chipFill.duration) ||
                    ((set.distance ?? '') === '' && !!chipFill.distance)
                  : (set.reps === '' && !!chipFill.reps) ||
                    (set.weight === '' && !!chipFill.weight)
                // Row identity for assistive tech: a warm-up row must SAY so —
                // the 'W' glyph alone is visual-only.
                // A stage row says what it is: "drop set stage 2 of set 3".
                // The glyph in the circle is visual-only.
                const stage = set.technique
                const isStage = stage !== undefined && stage.stageIndex > 0
                const setLabel = isStage
                  ? t('setLabelStage', {
                      // Sentence-position name ('drop set'), not the picker's title case.
                      technique: t(`technique.${TECHNIQUE_LABEL_KEY[stage.kind]}`),
                      stage: stage.stageIndex + 1,
                      number: setIndex + 1,
                    })
                  : set.tag === 'warmup'
                    ? t('setLabelWarmup', { number: setIndex + 1 })
                    : t('setLabel', { number: setIndex + 1 })
                // A technique group reads as ONE set: its rows sit under a
                // shared hairline (the superset vocabulary), so three
                // rest-pause rows never look like three straight sets.
                const groupsWithPrevious = continuesTechniqueGroup(
                  exercise.sets[setIndex - 1]?.technique,
                  stage,
                )
                const groupsWithNext = continuesTechniqueGroup(
                  stage,
                  exercise.sets[setIndex + 1]?.technique,
                )
                // Per-row affordance state (visual skin ONLY — every handler,
                // input, and tap target below is identical across states):
                // done rows flatten to quiet text, the active row carries the
                // full underline-input affordance, waiting rows sit muted and
                // promote to full affordance on any focus within the row.
                const rowState = rowStateOf(set.completed, setIndex === activeSetIndex)
                return (
                <Fragment key={set.id}>
                {/* Swipe is the fast touch path; the row's X stays for
                    mouse/keyboard/screen-reader users — additive, not a
                    replacement. Undo (not a confirm) catches mistakes. */}
                <SwipeToDelete onDelete={() => handleRemoveSet(exerciseIndex, setIndex)}>
                <div
                  className={cn(
                    // group/setrow: focus anywhere in a waiting row promotes
                    // its quiet inputs to full affordance (CSS-only).
                    'group/setrow flex items-center gap-2',
                    // Hairline, not a shell: the rows of one technique set
                    // share a left rule and an indent for as long as the
                    // group runs. Drawn as a pseudo-element rather than a
                    // border so it can bridge the gap between rows — each row
                    // sits in its own swipe wrapper, and three stubs of rule
                    // read as three sets again. It reaches into the wrapper's
                    // padding (py-1) only: further would be clipped.
                    (groupsWithPrevious || groupsWithNext) && [
                      'relative pl-2',
                      'before:absolute before:left-0 before:w-0.5 before:bg-muted-foreground/40',
                      groupsWithPrevious ? 'before:-top-1' : 'before:top-0',
                      groupsWithNext ? 'before:-bottom-1' : 'before:bottom-0',
                    ],
                    riseInArmed && 'motion-safe:animate-rise-in',
                  )}
                  id={`set-row-${set.id}`}
                  // Row-BODY long-press → context menu (notes v2). Never
                  // starts on inputs/buttons (SwipeToDelete's bail-out list —
                  // the circle keeps its warm-up hold, a drag in a weight
                  // field stays cursor placement); pointercancel + move-slop
                  // keep scrolls from firing it.
                  onPointerDown={(e) => {
                    if (
                      e.target instanceof Element &&
                      e.target.closest('input, button, select, a, textarea')
                    ) {
                      return
                    }
                    rowPressFiredRef.current = false
                    rowPressOriginRef.current = { x: e.clientX, y: e.clientY }
                    if (rowPressTimerRef.current) clearTimeout(rowPressTimerRef.current)
                    const at = { x: e.clientX, y: e.clientY }
                    rowPressTimerRef.current = setTimeout(() => {
                      rowPressFiredRef.current = true
                      setRowMenu({ exerciseIndex, setIndex, x: at.x, y: at.y })
                    }, LONG_PRESS_MS)
                  }}
                  onPointerUp={cancelRowPress}
                  onPointerLeave={cancelRowPress}
                  onPointerCancel={cancelRowPress}
                  onPointerMove={(e) => {
                    const origin = rowPressOriginRef.current
                    if (
                      origin &&
                      Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP_PX
                    ) {
                      cancelRowPress()
                    }
                  }}
                  // A press that already opened the menu must not ALSO click
                  // whatever the finger lifted over.
                  onClickCapture={(e) => {
                    if (rowPressFiredRef.current) {
                      rowPressFiredRef.current = false
                      e.preventDefault()
                      e.stopPropagation()
                    }
                  }}
                >
                  <button
                    type="button"
                    // Hold-to-tag: the timer fires TAG_SET and arms the flag
                    // that swallows the press's own click below. Movement past
                    // the slop reads as scrolling and cancels the hold.
                    onPointerDown={(e) => {
                      longPressFiredRef.current = false
                      pressOriginRef.current = { x: e.clientX, y: e.clientY }
                      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current)
                      longPressTimerRef.current = setTimeout(() => {
                        longPressFiredRef.current = true
                        // The gesture just proved itself learned — retire the
                        // one-time hint for good.
                        if (set.tag !== 'warmup') dismissWarmupHint()
                        dispatch({
                          type: 'TAG_SET',
                          exerciseIndex,
                          setIndex,
                          tag: nextSetTag(set.tag),
                        })
                      }, LONG_PRESS_MS)
                    }}
                    onPointerUp={cancelLongPress}
                    onPointerLeave={cancelLongPress}
                    // A scroll taking over the touch fires pointercancel (no
                    // pointerup, no click) — without this the armed timer
                    // would still retag ~500ms into the scroll.
                    onPointerCancel={cancelLongPress}
                    onPointerMove={(e) => {
                      const origin = pressOriginRef.current
                      if (
                        origin &&
                        Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP_PX
                      ) {
                        cancelLongPress()
                      }
                    }}
                    onClick={() => {
                      // A hold that already retagged must not ALSO toggle
                      // completion when the finger lifts.
                      if (longPressFiredRef.current) {
                        longPressFiredRef.current = false
                        return
                      }
                      // Tap-to-accept: checking off an untouched set adopts
                      // the ghost ("do what I did last time" in one tap).
                      // A "8–12" plan range adopts its floor; cardio rows
                      // adopt the plan's duration/distance verbatim (the
                      // ghost already speaks the input dialect).
                      const fill = isCardioSet
                        ? { duration: ghost.duration, distance: ghost.distance }
                        : {
                            reps: adoptableGhostValue(ghost.reps),
                            // A bodyweight set HAS no weight value to adopt —
                            // filling one would persist a phantom load.
                            weight:
                              exercise.loggingType === 'bodyweight_reps'
                                ? undefined
                                : adoptableGhostValue(ghost.weight),
                          }
                      // The reducer refuses a weight-less weight_reps (or
                      // duration-less cardio) check-off; mirror its predicate
                      // here so the refusal gets FEEDBACK (input flash) and
                      // none of the completion side effects (pop, rest clock,
                      // effort chips) fire for a set that didn't complete.
                      if (
                        !set.completed &&
                        isMissingRequiredMetric(exercise, setIndex, fill)
                      ) {
                        vibrate(SET_COMPLETE_VIBRATION)
                        if (weightNudgeTimerRef.current) {
                          clearTimeout(weightNudgeTimerRef.current)
                        }
                        setWeightNudgeSetId(set.id)
                        weightNudgeTimerRef.current = setTimeout(
                          () => setWeightNudgeSetId(null),
                          700,
                        )
                        return
                      }
                      dispatch({
                        type: 'TOGGLE_SET_COMPLETED',
                        exerciseIndex,
                        setIndex,
                        fill,
                      })
                      if (!set.completed) {
                        // Sensory answer to the check-off: a haptic tick and
                        // a scale pop on the circle — stronger when this tap
                        // completes the whole exercise (the collapse follows).
                        // Unchecking is a correction and stays silent.
                        const completesExercise = exercise.sets.every(
                          (s, i) => i === setIndex || s.completed,
                        )
                        vibrate(
                          completesExercise ? EXERCISE_COMPLETE_VIBRATION : SET_COMPLETE_VIBRATION,
                        )
                        setCompletionPop({ setId: set.id, big: completesExercise })
                        // This tap is also the lazy AudioContext unlock for
                        // the optional rest chirp (gesture-gated autoplay).
                        unlockRestChime()
                      }
                      // Checking off starts the rest clock; unchecking is a
                      // correction, not a new rest period. The plan component
                      // of the target is resolved from THIS set's slot
                      // (session default deliberately not merged here — see
                      // restPlanSec above); ad-hoc exercises have no plan
                      // targets and resolve to null → the session default.
                      // Feature switch first: with the rest timer off, no
                      // rest state ever starts, so the readout/sheet never
                      // render — the surface disappears, not just the target.
                      const planRestSec = resolveRestTarget(
                        planFor(exercise.source, exercise.wgerExerciseId),
                        setIndex,
                        null,
                      )
                      // Between the stages of ONE technique set there is no
                      // rest period — that absence IS the technique (Hevy's
                      // rule). An authored intra-set pause (rest-pause,
                      // cluster) still counts down: there the short rest IS
                      // the prescription.
                      if (
                        restTimerEnabled &&
                        !set.completed &&
                        startsRestPeriod(stage, exercise.sets[setIndex + 1]?.technique, planRestSec)
                      ) {
                        setRestStartedAt(new Date())
                        setRestPlanSec(planRestSec)
                        // New period, clean slate: quick-adjust taps belong
                        // to ONE rest period only, never the next.
                        setRestOffsetSec(0)
                      }
                      // Effort capture rides the same tap (never a second
                      // gate): checking off opens THIS set's chip row when
                      // its show rule passes; unchecking withdraws it. With
                      // the rule false neither branch runs — the 1-tap path
                      // is untouched for opted-out sessions.
                      if (effortEnabled && !set.completed) {
                        setEffortPromptSetId(set.id)
                      } else if (set.completed && effortPromptSetId === set.id) {
                        setEffortPromptSetId(null)
                      }
                    }}
                    aria-pressed={set.completed}
                    aria-label={
                      set.completed
                        ? t('markIncompleteAriaLabel', { set: setLabel })
                        : t('markCompleteAriaLabel', { set: setLabel })
                    }
                    className={cn(
                      'relative grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold tnum transition-colors',
                      // Invisible inset expands the tap target toward HIG size
                      // without growing the visual circle or shifting the row
                      // (Tailwind v4 injects content on before: automatically).
                      'before:absolute before:-inset-1.5',
                      // Same disc, same size, same tap semantics — only the
                      // paint follows the row's affordance state: volt check
                      // when done, full-weight disc on the active row, muted
                      // ring while waiting.
                      rowState === 'done' && 'bg-primary text-primary-foreground',
                      rowState === 'active' && 'bg-muted text-foreground',
                      rowState === 'waiting' &&
                        'bg-transparent text-muted-foreground ring-1 ring-inset ring-border',
                      // One-shot pop on completion (motion-safe: reduced
                      // motion keeps the instant color/check swap).
                      set.completed &&
                        completionPop?.setId === set.id &&
                        (completionPop.big
                          ? 'motion-safe:animate-set-pop-big'
                          : 'motion-safe:animate-set-pop'),
                    )}
                  >
                    {set.completed ? (
                      <Check aria-hidden="true" strokeWidth={3} className="size-4" />
                    ) : isStage ? (
                      t(`techniqueGlyph.${TECHNIQUE_LABEL_KEY[stage.kind]}`)
                    ) : set.tag === 'warmup' ? (
                      t('warmupGlyph')
                    ) : (
                      setIndex + 1
                    )}
                    {/* Notes-v2 indicator: a 4px volt dot beside the set
                        number — the note's WHOLE in-logger footprint (the
                        body never renders inline). Pops in on save (the
                        receipt; motion-safe keeps reduced-motion instant). */}
                    {setHasNote(set) && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          // ring-background keeps the dot legible on a
                          // completed (volt-filled) circle too.
                          'absolute -right-0.5 -top-0.5 size-1 rounded-full bg-primary ring-2 ring-background',
                          notePopSetId === set.id && 'motion-safe:animate-dot-in',
                        )}
                      />
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={!prevLabel || !chipCanFill}
                    onClick={() => {
                      dispatch({ type: 'FILL_SET', exerciseIndex, setIndex, fill: chipFill })
                      flashFilledSet(set.id)
                    }}
                    aria-label={
                      prevLabel
                        ? t('fillAriaLabel', { set: setLabel, previous: prevLabel })
                        : t('noPreviousAriaLabel', { set: setLabel })
                    }
                    className="relative w-10 shrink-0 truncate text-center text-xs font-medium tnum text-muted-foreground before:absolute before:-inset-1.5 disabled:opacity-40"
                  >
                    {prevLabel ?? t('prevEmpty')}
                  </button>
                  {isCardioSet ? (
                    <>
                      {/* Cardio row: mm:ss + km replace reps/weight. Same
                          underline skin, same row states, same select-all
                          focus dance as the lifting inputs. */}
                      <Input
                        type="text"
                        inputMode="numeric"
                        placeholder={ghost.duration ?? t('durationPlaceholder')}
                        value={set.duration ?? ''}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_SET',
                            exerciseIndex,
                            setIndex,
                            field: 'duration',
                            value: e.target.value,
                          })
                        }
                        onFocus={(e) => {
                          const input = e.currentTarget
                          requestAnimationFrame(() => input.select())
                        }}
                        enterKeyHint={metricMode === 'duration_distance' ? 'next' : 'done'}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          if (metricMode !== 'duration_distance') {
                            e.currentTarget.blur()
                            return
                          }
                          document.getElementById(`distance-input-${set.id}`)?.focus()
                        }}
                        aria-label={t('durationAriaLabel', { set: setIndex + 1 })}
                        className={cn(
                          'flex-1 rounded-none border-0 border-b-2 bg-transparent px-1 text-center tnum',
                          rowState === 'active' && 'border-input text-lg font-medium',
                          rowState === 'done' && 'border-transparent text-muted-foreground',
                          rowState === 'waiting' &&
                            'border-transparent opacity-80 group-focus-within/setrow:border-input group-focus-within/setrow:opacity-100',
                          flashSetId === set.id && 'fill-flash',
                          // The refused-check-off nudge lands on the duration
                          // input — cardio's required metric (#206 mirror).
                          weightNudgeSetId === set.id && 'weight-required-flash',
                        )}
                      />
                      {metricMode === 'duration_distance' ? (
                        <Input
                          type="text"
                          inputMode="decimal"
                          id={`distance-input-${set.id}`}
                          placeholder={ghost.distance}
                          value={set.distance ?? ''}
                          onChange={(e) =>
                            dispatch({
                              type: 'UPDATE_SET',
                              exerciseIndex,
                              setIndex,
                              field: 'distance',
                              value: e.target.value,
                            })
                          }
                          onFocus={(e) => {
                            const input = e.currentTarget
                            requestAnimationFrame(() => input.select())
                          }}
                          enterKeyHint="done"
                          onKeyDown={(e) => {
                            if (e.key !== 'Enter') return
                            e.preventDefault()
                            e.currentTarget.blur()
                          }}
                          aria-label={t('distanceAriaLabel', { set: setIndex + 1 })}
                          className={cn(
                            'flex-1 rounded-none border-0 border-b-2 bg-transparent px-1 text-center tnum',
                            rowState === 'active' && 'border-input text-lg font-medium',
                            rowState === 'done' && 'border-transparent text-muted-foreground',
                            rowState === 'waiting' &&
                              'border-transparent opacity-80 group-focus-within/setrow:border-input group-focus-within/setrow:opacity-100',
                            flashSetId === set.id && 'fill-flash',
                          )}
                        />
                      ) : (
                        // Duration-only mode: hold the second column's
                        // footprint so rows never jump (the BW-pill trick).
                        <span aria-hidden="true" className="h-11 flex-1" />
                      )}
                    </>
                  ) : (
                    <>
                  <Input
                    type="text"
                    inputMode="numeric"
                    placeholder={ghost.reps}
                    value={set.reps}
                    onChange={(e) =>
                      dispatch({
                        type: 'UPDATE_SET',
                        exerciseIndex,
                        setIndex,
                        field: 'reps',
                        value: e.target.value,
                      })
                    }
                    // Select-all on focus: tapping a filled field means
                    // "replace this", not "append a digit to it". Deferred a
                    // frame — WebKit's mouseup after a pointer-initiated focus
                    // collapses a synchronous selection back to a caret.
                    onFocus={(e) => {
                      const input = e.currentTarget
                      requestAnimationFrame(() => input.select())
                    }}
                    // Keyboard flow: reps hands off to the row's weight input
                    // ("next"); a bodyweight row has no weight, so reps is
                    // the last stop ("done" → dismiss the keyboard). Blur
                    // only — Enter must never complete the set for you.
                    enterKeyHint={exercise.loggingType === 'bodyweight_reps' ? 'done' : 'next'}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      if (exercise.loggingType === 'bodyweight_reps') {
                        e.currentTarget.blur()
                        return
                      }
                      document.getElementById(`weight-input-${set.id}`)?.focus()
                    }}
                    aria-label={t('repsAriaLabel', { set: setIndex + 1 })}
                    className={cn(
                      // Underline-field skin: same input, same handlers, same
                      // h-11 hit area — the box collapses to a baseline. px-1
                      // keeps a sliver of horizontal hit padding.
                      'flex-1 rounded-none border-0 border-b-2 bg-transparent px-1 text-center tnum',
                      // Active row: the one full-affordance row (bigger
                      // numerals, visible underline).
                      rowState === 'active' && 'border-input text-lg font-medium',
                      // Done row: flattened to quiet text; tap-to-edit still
                      // works and focus restores a visible underline + ring.
                      rowState === 'done' && 'border-transparent text-muted-foreground',
                      // Waiting row: visually quiet until anything in the row
                      // takes focus, then full affordance (CSS-only).
                      rowState === 'waiting' &&
                        'border-transparent opacity-80 group-focus-within/setrow:border-input group-focus-within/setrow:opacity-100',
                      flashSetId === set.id && 'fill-flash',
                    )}
                  />
                  {exercise.loggingType === 'bodyweight_reps' ? (
                    // The lifter IS the load: a non-editable pill holds the
                    // weight input's footprint so rows never jump on switch.
                    <span
                      aria-label={t('bodyweightAriaLabel', { set: setIndex + 1 })}
                      className={cn(
                        // Chips → words: "BW" as quiet text, same footprint so
                        // rows never jump on a logging-type switch.
                        'flex h-11 flex-1 items-center justify-center text-base font-medium text-muted-foreground',
                        rowState === 'waiting' && 'opacity-80',
                      )}
                    >
                      {t('bodyweightGlyph')}
                    </span>
                  ) : (
                    <div className="relative flex-1">
                      {exercise.loggingType !== 'weight_reps' && (
                        // Sign prefix inside the field: this number is added
                        // to (+) or subtracted from (−) bodyweight, not total.
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-base text-muted-foreground"
                        >
                          {exercise.loggingType === 'assisted_bodyweight' ? '−' : '+'}
                        </span>
                      )}
                      <Input
                        type="text"
                        inputMode="decimal"
                        // Target for the reps input's Enter-to-next hop.
                        id={`weight-input-${set.id}`}
                        placeholder={ghost.weight}
                        value={set.weight}
                        onChange={(e) =>
                          dispatch({
                            type: 'UPDATE_SET',
                            exerciseIndex,
                            setIndex,
                            field: 'weight',
                            value: e.target.value,
                          })
                        }
                        // End of the row's keyboard flow: dismiss, don't
                        // auto-complete — checking off stays a deliberate tap.
                        enterKeyHint="done"
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter') return
                          e.preventDefault()
                          e.currentTarget.blur()
                        }}
                        onFocus={(e) => {
                          // Select-all (type-over, same rAF-deferred WebKit
                          // dance as reps), then arm this row's ± steppers.
                          const input = e.currentTarget
                          requestAnimationFrame(() => input.select())
                          setStepperSetId(set.id)
                        }}
                        onBlur={() => setStepperSetId(null)}
                        aria-label={
                          exercise.loggingType === 'weighted_bodyweight'
                            ? t('addedWeightAriaLabel', { set: setIndex + 1, unit })
                            : exercise.loggingType === 'assisted_bodyweight'
                              ? t('assistanceAriaLabel', { set: setIndex + 1, unit })
                              : t('weightAriaLabel', { set: setIndex + 1, unit })
                        }
                        className={cn(
                          // Same underline skin as the reps input (see its
                          // per-state comments).
                          'w-full rounded-none border-0 border-b-2 bg-transparent px-1 text-center tnum',
                          rowState === 'active' && 'border-input text-lg font-medium',
                          rowState === 'done' && 'border-transparent text-muted-foreground',
                          rowState === 'waiting' &&
                            'border-transparent opacity-80 group-focus-within/setrow:border-input group-focus-within/setrow:opacity-100',
                          flashSetId === set.id && 'fill-flash',
                          weightNudgeSetId === set.id && 'weight-required-flash',
                        )}
                      />
                    </div>
                  )}
                    </>
                  )}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    // Invisible inset lifts the 36px visual button toward the
                    // 44px HIG target without shifting the row (same trick as
                    // the set-complete circle).
                    className="relative shrink-0 text-muted-foreground before:absolute before:-inset-1"
                    onClick={() => handleRemoveSet(exerciseIndex, setIndex)}
                    aria-label={t('removeSetAriaLabel', { set: setLabel })}
                  >
                    <X aria-hidden="true" className="size-4" />
                  </Button>
                </div>
                </SwipeToDelete>
                {/* Micro target caption: typing hides the plan ghost, so the
                    target it replaced stays readable here — plan restated,
                    never adopted (ghost and Prev semantics untouched). Only
                    when a typed value actually DIFFERS from the plan; muted,
                    aligned under the inputs. */}
                {(() => {
                  // Cardio rows skip the caption: their ghost strings ("12:30")
                  // aren't numeric targets the caption grammar can restate.
                  if (isCardioSet) return null
                  const caption = targetCaption({ reps: set.reps, weight: set.weight }, ghost)
                  if (!caption) return null
                  return <p className="pl-22 pr-11 text-xs text-muted-foreground tnum">{caption}</p>
                })()}
                {/* Post-completion effort row (opt-in / prescribed only):
                    the open chip row under the just-completed set, or the
                    logged value as a quiet tappable caption (tap = correct
                    it). Skip-by-ignoring — nothing here ever blocks the
                    next set, and unanswered rows simply move on. */}
                {effortEnabled &&
                  set.completed &&
                  (effortPromptSetId === set.id ? (
                    <EffortChips
                      setLabel={setLabel}
                      rir={set.rir ?? ''}
                      rpe={set.rpe ?? ''}
                      targetLabel={effortLabel(
                        effortTarget?.rir ?? null,
                        effortTarget?.rpe ?? null,
                      )}
                      targetRir={effortTarget?.rir ?? null}
                      targetRpe={effortTarget?.rpe ?? null}
                      // An untouched row tidies itself (~5s): same collapse
                      // as the prompt moving on — skip-by-ignoring, never
                      // blocking, and the quiet slot below stays tappable.
                      onIdleCollapse={() => setEffortPromptSetId(null)}
                      onSelectRir={(value) => {
                        dispatch({ type: 'SET_EFFORT', exerciseIndex, setIndex, rir: value })
                        // A real selection answers the prompt; a clear keeps
                        // the row open for a re-pick.
                        if (value !== '') setEffortPromptSetId(null)
                      }}
                      onSelectRpe={(value) => {
                        dispatch({ type: 'SET_EFFORT', exerciseIndex, setIndex, rpe: value })
                        // Unlike RIR, an RPE pick must NOT close the row:
                        // the second tap of the whole → half cycle needs the
                        // chip still on screen. The idle collapse tidies up.
                      }}
                    />
                  ) : (
                    (() => {
                      const logged = effortLabel(
                        set.rir ? Number(set.rir) : null,
                        set.rpe ? Number(set.rpe) : null,
                      )
                      // Nothing logged: the slot itself stays — a quiet
                      // "Effort" word so late logging is always reachable
                      // after the prompt moved on (or idle-collapsed).
                      // Renders only under the show rule, so the opted-out
                      // fast path stays byte-identical.
                      return (
                        <button
                          type="button"
                          onClick={() => setEffortPromptSetId(set.id)}
                          aria-label={
                            logged
                              ? t('changeEffortAriaLabel', { set: setLabel, effort: logged })
                              : t('logEffortAriaLabel', { set: setLabel })
                          }
                          className="block pl-22 pr-11 text-left text-xs text-muted-foreground tnum underline-offset-2 active:underline"
                        >
                          {logged ?? t('effortSlot')}
                        </button>
                      )
                    })()
                  ))}
                {/* Steppers ride under the focused weight row only —
                    extracted to WeightStepper (#216), which owns the ± rail,
                    hold-to-autorepeat, and the per-side plate chip. The
                    focus-gating (stepperSetId) and blur-to-dismiss lifecycle
                    stay here. ghost.weight is undefined for BW-relative
                    types by design (a total-load ghost would be a phantom),
                    so their steppers step the typed value or from zero. */}
                {stepperSetId === set.id && (
                  <WeightStepper
                    setIndex={setIndex}
                    inputId={`weight-input-${set.id}`}
                    weight={set.weight}
                    ghostWeight={ghost.weight}
                    unit={unit}
                    loggingType={exercise.loggingType}
                    bar={gear.bars[0] ?? 0}
                    plates={gear.plates}
                    onWeightChange={(value) =>
                      dispatch({
                        type: 'UPDATE_SET',
                        exerciseIndex,
                        setIndex,
                        field: 'weight',
                        value,
                      })
                    }
                    onOpenPlateSheet={() => setPlateSheetFor(exerciseIndex)}
                  />
                )}
                {/* The record moment, recognized as it happens: this set's
                    e1RM strictly beats the all-time best the session opened
                    with. Presentation-only — nothing is stored. */}
                {setIndex === prIndexByExercise[exerciseIndex] && (
                  <p className="pl-10">
                    <PrBadge label={t('prBadge')} />
                  </p>
                )}
                </Fragment>
                )
              })}
            </div>

            <Button
              size="sm"
              variant="outline"
              className="w-full"
              // New sets inherit the exercise's metric mode (cardio adds
              // cardio sets; lifting adds lifting sets).
              onClick={() =>
                dispatch({
                  type: 'ADD_SET',
                  exerciseIndex,
                  set: newDraftSet(nextSetMetricMode(exercise)),
                })
              }
            >
              {t('addSetAction')}
            </Button>
          </div>
          )}
          </section>
          )
        })}

        {/* Workout-level note, above the destructive tail: session context
            ("cut short — gym closing") belongs to the whole workout, not one
            card. This is where the note LIVES — has-notes, so a workout note
            is always on screen and always editable in place (a hidden note is
            a lost note). No entry affordance beside it any more: the app-bar
            NotebookPen is the one door in, and a second worded pill down here
            would be a second door to the same note. */}
        {!isEmpty && draft.notes.trim() !== '' && (
          <Textarea
            rows={2}
            placeholder={t('notePlaceholder')}
            value={draft.notes}
            onChange={(e) => dispatch({ type: 'SET_WORKOUT_NOTES', value: e.target.value })}
            aria-label={t('workoutNotesAriaLabel')}
            className="motion-safe:animate-rise-in"
          />
        )}

        {/* Discard lives at the END of the scrolling content, not in the
            sticky bar: a destructive exit must be sought out, never sit one
            mis-tap from Finish. Live sessions only — editing a completed
            workout deletes from its summary page, not here. The trigger opens
            a centered ConfirmDialog (a true modal — same treatment as the
            delete flows in workout-actions.tsx / program-actions.tsx),
            rendered near the other top-layer surfaces below. */}
        {isLive && (
          <div className="pt-2">
            {/* Demoted on purpose (destructive-outline, never volt): a
                designed escape hatch rather than a bare text link, but still
                nothing that competes with the volt Finish below. Full-width
                matches the card rhythm of the page; the ConfirmDialog stays
                the actual guard. */}
            <Button
              variant="destructive-outline"
              className="w-full"
              disabled={isSaving || isDiscarding}
              onClick={() => {
                setDiscardError(null) // a stale failure must not reopen with the dialog
                setIsDiscardModalOpen(true)
              }}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t('discardAction')}
            </Button>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div
        data-volt-muted={noteCaptureFor !== null || undefined}
        className={cn(
          'sticky bottom-0 z-10 -mx-5 border-t border-border bg-background/85 px-5 pt-3 pb-safe backdrop-blur-md',
          // One volt while the capture sheet is open: the bar recedes
          // (opacity + desaturation — still readable, still tappable per the
          // sheet's non-modal contract) so the sheet's Save is the screen's
          // only live accent regardless of how tall the bar stacks (rest
          // pill + toasts). Mechanism, not layout coincidence — pinned by
          // the volt-budget render tests.
          noteCaptureFor !== null &&
            'opacity-50 saturate-50 motion-safe:transition-opacity motion-safe:duration-200',
        )}
      >
        {/* Session-pulse fill riding the bar's top border: 2px of volt that
            grows with completed working sets. Live-progress semantics, same
            one-volt family as the rest readout; scaleX (not width) keeps the
            motion compositor-only. Decorative — the header count carries the
            accessible numbers. */}
        {isLive && pulse.total > 0 && (
          <div aria-hidden="true" className="absolute inset-x-0 top-[-1px] h-0.5 overflow-hidden">
            <div
              className="h-full origin-left bg-primary transition-transform duration-500 ease-out"
              style={{ transform: `scaleX(${pulse.completed / pulse.total})` }}
            />
          </div>
        )}
        {/* The session's closing verdict, in the drawer/home editorial voice:
            every planned set is in. Sits with the Finish button it's nudging
            toward; the volt stays on the button (one-volt rule). */}
        {isLive && isSessionDone && (
          <p className="mb-2 font-display text-lg font-semibold uppercase leading-none tracking-wide motion-safe:animate-rise-in">
            {t('sessionDone')}
          </p>
        )}
        {/* The unified rest pill, only while a period is actually running —
            the bar's PRIMARY slot during rest (Next-up compresses to its
            one-line glance beneath). Digits + depleting fill + −15/Skip/+15
            in one surface; the time area opens the rest-target sheet.
            Adjust taps accumulate into restOffsetSec (this period ONLY —
            see its constraint comment); Skip ends the period. The pill also
            owns the rest-over edge detection — its tick IS the countdown. */}
        {isLive && restTimerEnabled && restStartedAt !== null && (
          <RestPill
            restStartedAt={restStartedAt}
            restTargetSec={restTargetSec}
            onTimeClick={() => setIsRestSheetOpen(true)}
            onAdjust={(deltaSec) => setRestOffsetSec((prev) => prev + deltaSec)}
            onSkip={handleSkipRest}
            // Module function = stable reference (the tick effect depends
            // on it). Fires vibrate + optional chirp + title flash, at most
            // once per rest period.
            onRestOver={fireRestOverAlert}
          />
        )}
        {/* Next-up glance: where the session continues after rest — the
            PWA-legal cousin of a lock-screen Live Activity, living in the
            thumb zone the sticky bar already owns. Ungated from rest: it
            shows once the session is underway (≥1 completed set) or there's
            more than one exercise to hop between — resting is not the only
            time a lifter loses their place. Tap scrolls the row into view. */}
        {isLive && nextUp && shouldShowNextUp(draft.exercises) && (
          <button
            type="button"
            onClick={() =>
              document
                .getElementById(`set-row-${nextUp.exercise.sets[nextUp.setIndex].id}`)
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
            className="mb-2 flex w-full items-baseline justify-between gap-3 text-left"
          >
            <span className="min-w-0 truncate text-sm text-muted-foreground">
              {t.rich('nextUp', {
                name: nextUp.exercise.name,
                set: nextUp.setIndex + 1,
                exercise: (chunks) => <span className="text-foreground">{chunks}</span>,
              })}
            </span>
            {nextUp.label && (
              <span className="shrink-0 text-sm font-medium tnum">{nextUp.label}</span>
            )}
          </button>
        )}
        {/* Post-swap remember prompt: a quiet follow-up, never a modal — the
            decision that mattered (the swap) is already made; this must not
            block logging. Sits above the undo toast (it outlives undo's
            window). Prompt mode = no countdown: it persists until answered.
            One-volt rule: ghost/outline pair, Finish keeps the bar's volt. */}
        <SessionToast open={pendingRemember !== null}>
          {pendingRemember && (
            <>
              <p className="min-w-0 text-sm">
                {t.rich('rememberPrompt', {
                  name: pendingRemember.substituteName,
                  substitute: (chunks) => <span className="font-medium">{chunks}</span>,
                })}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t('rememberHint', { name: pendingRemember.originalName })}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="reversal"
                  disabled={isRemembering}
                  onClick={handleRememberJustToday}
                >
                  {t('rememberJustToday')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isRemembering}
                  onClick={handleRememberForBlock}
                >
                  {isRemembering ? t('rememberPending') : t('rememberForBlock')}
                </Button>
              </div>
              {rememberError && (
                <p className="mt-1.5 text-sm text-destructive">{rememberError}</p>
              )}
            </>
          )}
        </SessionToast>
        {/* Undo toast: SessionToast owns the window's clock — its drain
            hairline's animationend clears the stack, so hover/focus pausing
            the drain pauses the dismissal with it. */}
        <SessionToast
          open={removed.length > 0}
          countdown={{
            durationMs: UNDO_WINDOW_MS,
            resetKey: undoResetKey,
            onExpire: () => setRemoved([]),
          }}
          exit={undoExitQuick ? 'quick' : 'default'}
        >
          {removed.length > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm">
                {undoMessage(removed[removed.length - 1])}
              </p>
              <Button size="sm" variant="reversal" className="shrink-0" onClick={handleUndoRemove}>
                {removed.length > 1 ? t('undoCount', { count: removed.length }) : t('undo')}
              </Button>
            </div>
          )}
        </SessionToast>
        <div className="flex flex-col gap-2">
          {/* Adding an exercise is the second-most-frequent act mid-session,
              so it earns a permanent slot in the thumb bar — outline, so the
              volt Finish stays the unmistakable primary. Disabled while
              saving: the draft is frozen once the save barrier engages. */}
          <Button
            size="lg"
            variant="outline"
            className="w-full"
            // Also frozen while discarding: the settle barrier has engaged
            // and the draft is on its way out — no more edits.
            disabled={isSaving || isDiscarding}
            onClick={() => setIsPickerOpen(true)}
          >
            {t('addExerciseAction')}
          </Button>
          <Button
            size="lg"
            // Keyed off isLive, NOT workoutId: a live program session is
            // edit-mode with a workoutId but still ends with a volt Finish.
            // "Finish", not "Save": ending a session is the product's peak
            // moment, not filing paperwork. Correcting a finished workout
            // keeps an outline "Save changes" — that IS paperwork.
            variant={isLive ? 'band' : 'outline'}
            className={cn(
              'w-full font-semibold uppercase tracking-wide',
              // Live Finish is the `band` variant (the sticky bar's primary,
              // still the only volt CTA): tinted wash + volt condensed caps
              // instead of a solid pill. The variant owns the skin; -mx-5
              // bleeding across the bar's px-5 is layout and stays here.
              // Edit-mode "Save changes" keeps the outline pill —
              // corrections are paperwork, not a moment.
              isLive && '-mx-5 w-[calc(100%+2.5rem)]',
              // Every planned set is done: a gentle scale nudge says "wrap it
              // up" — motion as state (session complete), not decoration.
              // Reduced-motion users get the same information from the volt
              // section hairlines above.
              isLive && isSessionDone && !isSaving && 'motion-safe:animate-finish-nudge',
            )}
            // isDiscarding too: finishing a session that's mid-discard would
            // race the delete — the two exits are mutually exclusive.
            // isRemembering too: finishing mid program-patch would navigate
            // away from an in-flight plan edit — let the momentary action
            // settle (it resolves in one round-trip).
            disabled={isEmpty || isSaving || isDiscarding || isRemembering}
            onClick={handleFinishClick}
          >
            {isSaving ? (
              t('savePending')
            ) : isLive ? (
              t.rich('finish', {
                arrow: (chunks) => <span aria-hidden="true">{chunks}</span>,
              })
            ) : (
              t('saveChanges')
            )}
          </Button>
        </div>
      </div>
      </main>

      {/* One sheet, two modes: the sticky bar opens it in add mode, the ⇄
          header button in replace mode (retitled; the pick routes through the
          logged-work guard instead of appending). */}
      {(isPickerOpen || replaceTargetIndex !== null) && (
        <ExerciseSheet
          heading={
            replaceTargetIndex !== null
              ? t('replaceHeading', {
                  name: draft.exercises[replaceTargetIndex]?.name ?? t('replaceHeadingFallback'),
                })
              : undefined
          }
          suggestFor={
            replaceTargetIndex !== null
              ? draft.exercises[replaceTargetIndex]?.wgerExerciseId
              : undefined
          }
          onAdd={(exercise) =>
            replaceTargetIndex !== null
              ? handleReplacePick(exercise)
              : dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(exercise) })
          }
          onCreateNavigate={handleCreateNavigate}
          onClose={() => {
            setIsPickerOpen(false)
            setReplaceTargetIndex(null)
          }}
        />
      )}

      {pendingReplace && draft.exercises[pendingReplace.index] && (
        <ReplaceConfirmDialog
          oldName={draft.exercises[pendingReplace.index].name}
          newName={pendingReplace.picked.name}
          hasAllCompleted={draft.exercises[pendingReplace.index].sets.every((s) => s.completed)}
          onReplace={() => {
            performReplace(pendingReplace.index, pendingReplace.picked)
            setPendingReplace(null)
          }}
          onAddInstead={() => {
            dispatch({ type: 'ADD_EXERCISE', exercise: newDraftExercise(pendingReplace.picked) })
            setPendingReplace(null)
          }}
          onClose={() => setPendingReplace(null)}
        />
      )}

      {statsSheetFor !== null && draft.exercises[statsSheetFor] && (
        <StatsSheet
          wgerExerciseId={draft.exercises[statsSheetFor].wgerExerciseId}
          source={draft.exercises[statsSheetFor].source}
          name={draft.exercises[statsSheetFor].name}
          unit={unit}
          onClose={() => setStatsSheetFor(null)}
        />
      )}

      {/* Guarded on loggingType too: the open button only renders for
          weight_reps, but the type can switch while the sheet is up. */}
      {plateSheetFor !== null &&
        draft.exercises[plateSheetFor] &&
        draft.exercises[plateSheetFor].loggingType === 'weight_reps' && (
        <PlateSheet
          // Remount per exercise: bar choice, count-mode taps, and the
          // warm-up override are all per-open state by design.
          key={plateSheetFor}
          exerciseName={draft.exercises[plateSheetFor].name}
          weights={Array.from(
            new Set(
              draft.exercises[plateSheetFor].sets
                .map((set) => parseFloat(set.weight))
                .filter((weight) => Number.isFinite(weight) && weight > 0),
            ),
          ).sort((a, b) => b - a)}
          unit={unit}
          equipment={gear}
          onClose={() => setPlateSheetFor(null)}
          onEquipmentSaved={setGear}
          onUseWeight={(weight) => {
            const exercise = draft.exercises[plateSheetFor]
            const setIndex = resolveTargetSetIndex(exercise.sets)
            if (setIndex >= 0) {
              dispatch({
                type: 'UPDATE_SET',
                exerciseIndex: plateSheetFor,
                setIndex,
                field: 'weight',
                value: String(weight),
              })
            }
            setPlateSheetFor(null)
          }}
        />
      )}

      {/* Identity-note QuickCapture: markdown in/out through the note
          actions; the session-local override map keeps the chip fresh
          without touching the frozen last-performance query. */}
      {noteSheetFor !== null &&
        draft.exercises[noteSheetFor.index] &&
        (() => {
          const exercise = draft.exercises[noteSheetFor.index]
          const key = `${exercise.source}:${exercise.wgerExerciseId}`
          const current =
            noteOverrides[key] !== undefined
              ? noteOverrides[key]
              : (lastByExercise[key]?.note ?? null)
          // Pin-as-promotion (#211): the pin beside a session note seeds the
          // SESSION text — that is the promotion the control promises, even
          // when an identity note already exists (saving then overwrites the
          // pinned body with the promoted text: the user explicitly pinned
          // it). The pinned-chip tap keeps seeding the pinned body for edits.
          // Promotion copies: the session note stays as this session's record.
          const promoting = noteSheetFor.seed === 'session'
          return (
            <QuickCaptureSheet
              title={exercise.name}
              eyebrow={t('identityNoteEyebrow')}
              initialBody={promoting ? exercise.notes : (current?.body ?? exercise.notes)}
              // A note born in (or promoted from) the logger defaults pinned —
              // pinning is the whole point of promoting it.
              initialPinned={promoting ? true : (current?.pinned ?? true)}
              onSave={async (value) => {
                const saved = await upsertExerciseNoteAction(
                  exercise.source,
                  exercise.wgerExerciseId,
                  value,
                )
                setNoteOverrides((prev) => ({ ...prev, [key]: saved }))
              }}
              onDelete={
                current !== null
                  ? async () => {
                      await deleteExerciseNoteAction(exercise.source, exercise.wgerExerciseId)
                      setNoteOverrides((prev) => ({ ...prev, [key]: null }))
                    }
                  : undefined
              }
              onClose={() => setNoteSheetFor(null)}
            />
          )
        })()}

      {/* Set-row context menu (notes v2): guarded on the target still
          existing — the draft can shift under an open menu (undo, restore). */}
      {rowMenu &&
        draft.exercises[rowMenu.exerciseIndex]?.sets[rowMenu.setIndex] &&
        (() => {
          const exercise = draft.exercises[rowMenu.exerciseIndex]
          const set = exercise.sets[rowMenu.setIndex]
          const menuSetLabel =
            set.tag === 'warmup' ? `warm-up set ${rowMenu.setIndex + 1}` : `set ${rowMenu.setIndex + 1}`
          return (
            <SetRowMenu
              x={rowMenu.x}
              y={rowMenu.y}
              setLabel={`${menuSetLabel} of ${exercise.name}`}
              hasNote={setHasNote(set)}
              isWarmup={set.tag === 'warmup'}
              techniqueKind={set.technique?.kind ?? null}
              // A stage continues the set above it: the first set of an
              // exercise has nothing to continue, so it isn't offered.
              canTagTechnique={rowMenu.setIndex > 0}
              onNote={() => {
                setNoteCaptureFor(setNoteCapture(rowMenu.exerciseIndex, rowMenu.setIndex))
                setRowMenu(null)
              }}
              onTagWarmup={() => {
                // The same TAG_SET the circle hold dispatches — a second door
                // to the same action; the gesture hint retires with either.
                if (set.tag !== 'warmup') dismissWarmupHint()
                dispatch({
                  type: 'TAG_SET',
                  exerciseIndex: rowMenu.exerciseIndex,
                  setIndex: rowMenu.setIndex,
                  tag: nextSetTag(set.tag),
                })
                setRowMenu(null)
              }}
              onTagTechnique={(kind) => {
                dispatch({
                  type: 'SET_SET_TECHNIQUE',
                  exerciseIndex: rowMenu.exerciseIndex,
                  setIndex: rowMenu.setIndex,
                  kind,
                  // Minted here (the reducer stays pure); used only when a
                  // NEW group starts — joining reuses the group above.
                  group: crypto.randomUUID(),
                })
                setRowMenu(null)
              }}
              onRemove={() => {
                handleRemoveSet(rowMenu.exerciseIndex, rowMenu.setIndex)
                setRowMenu(null)
              }}
              onClose={() => setRowMenu(null)}
            />
          )
        })()}

      {/* The notes-v2 capture sheet (non-modal — the session stays live).
          Set scope writes the draft's set note + mints its clientKey (the
          post-save create's idempotency handle); exercise/workout scopes
          route into the existing #211 note tiers this sheet absorbs
          (appended, never clobbering words already there). */}
      {noteCaptureFor &&
        (() => {
          // The set anchor, re-resolved every render: the draft can shift
          // under an open sheet (undo, restore, remove). A workout capture has
          // no anchor to lose, so it survives whatever the draft does.
          const anchored =
            noteCaptureFor.kind === 'set' &&
            draft.exercises[noteCaptureFor.exerciseIndex]?.sets[noteCaptureFor.setIndex]
              ? {
                  exerciseIndex: noteCaptureFor.exerciseIndex,
                  setIndex: noteCaptureFor.setIndex,
                  exercise: draft.exercises[noteCaptureFor.exerciseIndex],
                  set: draft.exercises[noteCaptureFor.exerciseIndex].sets[noteCaptureFor.setIndex],
                }
              : null
          // An anchored sheet whose set vanished has nothing left to address.
          if (noteCaptureFor.kind === 'set' && anchored === null) return null

          /** Appends rather than replaces: the exercise/workout tiers are
           *  journals, and a capture must never clobber words already there. */
          const append = (existing: string, body: string) =>
            existing.trim() === '' ? body : `${existing.trim()}\n${body}`

          const handleCaptureSave = (scope: NoteScope, body: string) => {
            if (scope === 'set' && anchored !== null) {
              dispatch({
                type: 'SET_SET_NOTE',
                exerciseIndex: anchored.exerciseIndex,
                setIndex: anchored.setIndex,
                note: body,
                clientKey: anchored.set.noteClientKey ?? crypto.randomUUID(),
              })
              setNotePopSetId(anchored.set.id) // the receipt: the dot pops in
            } else if (scope === 'exercise' && anchored !== null) {
              dispatch({
                type: 'SET_EXERCISE_NOTES',
                exerciseIndex: anchored.exerciseIndex,
                value: append(anchored.exercise.notes, body),
              })
            } else {
              // Workout scope — and the only scope an unanchored sheet has.
              dispatch({ type: 'SET_WORKOUT_NOTES', value: append(draft.notes, body) })
            }
          }
          return (
            <NoteSheet
              // Remount on retarget — see noteCaptureKey.
              key={noteCaptureKey(noteCaptureFor)}
              anchor={
                anchored === null
                  ? null
                  : {
                      exerciseName: anchored.exercise.name,
                      setNumber: anchored.setIndex + 1,
                      snapshot: setSnapshotLabel(
                        anchored.set,
                        anchored.exercise.loggingType,
                        unit,
                      ),
                    }
              }
              initialScope={anchored === null ? 'workout' : 'set'}
              initialBody={anchored?.set.note ?? ''}
              onSave={handleCaptureSave}
              onClose={() => setNoteCaptureFor(null)}
            />
          )
        })()}

      {isDiscardModalOpen && (
        <ConfirmDialog
          title={t('discardDialog.title')}
          body={t('discardDialog.body')}
          confirmLabel={t('discardDialog.confirm')}
          pendingLabel={t('discardDialog.pending')}
          error={discardError}
          isPending={isDiscarding}
          onConfirm={handleDiscard}
          onClose={() => setIsDiscardModalOpen(false)}
          closeRef={closeDiscardDialogRef}
        />
      )}

      {/* Skipped-sets warning: sets with reps were checked off by the
          completion pass; whatever's left saves as not-completed and scores
          nothing — worth one look before it's history. Volt confirm: finishing
          is affirmative, not destructive. */}
      {pendingFinish && (
        <ConfirmDialog
          title={t('finishDialog.title')}
          body={t('finishDialog.body', { count: pendingFinish.skipped })}
          confirmLabel={t('finishDialog.confirm')}
          pendingLabel={t('finishDialog.pending')}
          error={error}
          isPending={isSaving}
          confirmVariant="default"
          closeRef={closeFinishDialogRef}
          // ConfirmDialog contract: stay open while the save runs (retry in
          // place on failure); the success path closes via closeRef before
          // router.push inside handleSave.
          onConfirm={() => finishWith(pendingFinish.draft)}
          onClose={() => setPendingFinish(null)}
        />
      )}

      {isRestSheetOpen && (
        <RestSheet
          currentSec={sessionRestSec}
          onClose={() => setIsRestSheetOpen(false)}
          // Optimistic: the session default (and any default-driven countdown
          // running right now) adopts the value immediately; the sheet owns
          // the best-effort server persist and its error text.
          onSaved={setSessionRestSec}
        />
      )}
    </>
  )
}

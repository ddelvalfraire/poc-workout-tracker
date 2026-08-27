import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { AppHeader } from '@/components/app-header'
import { EditorDayPane } from '@/components/editor/editor-day-pane'
import { EditorInspector, type EditorInspectorExercise } from '@/components/editor/editor-inspector'
import { EditorPanes } from '@/components/editor/editor-panes'
import { EditorPivotGrid } from '@/components/editor/editor-pivot-grid'
import { EditorReachSheet } from '@/components/editor/editor-reach-sheet'
import { EditorScopeLine } from '@/components/editor/editor-scope-line'
import { EditorStructurePane } from '@/components/editor/editor-structure-pane'
import { EditorViewToggle } from '@/components/editor/editor-view-toggle'
import { buildBlockWeeks } from '@/components/block-weeks'
import { buttonVariants } from '@/components/ui/button'
import { getWeightUnit } from '@/db/preferences'
import { getProgramDetail, listProgramWorkouts, programWeekState } from '@/db/programs'
import { workoutDetailQuery } from '@/db/workouts'
import { requireUserId } from '@/lib/auth'
import { renderMessage } from '@/lib/message'
import { TECHNIQUE_LABEL_KEY } from '@/lib/technique'
import { cn } from '@/lib/utils'
import { kgToDisplay } from '@/lib/units'
import { progressionLine, programStatusLine } from '../detail-view'
import { applyReachToPlanAction, saveSetOverrideAction } from './actions'
import { editorHref, resolveEditorAddress, type RawParam } from './editor-address'
import {
  editorDayDetail,
  editorDays,
  editorLoggedExercises,
  editorSetLoadKg,
  editorWeeks,
} from './editor-view'
import { pivotRows } from './pivot-view'
import {
  parseReachParam,
  reachDivergence,
  reachWeeks,
  type ReachScope,
} from './reach-view'
import { isSettled, trainedDayState, trainedSeamIndex, weekTrainedReport } from './trained-view'

/**
 * The program editor, for BOTH of its routes: `/programs/[id]/editor` and
 * `/programs/[id]/editor/[day]`.
 *
 * One component serves both because DESIGN.md's pane rule is only keepable that
 * way — "the panes are the same routes and the same state, never a second
 * implementation." The two `page.tsx` files differ by exactly one argument (the
 * day segment, present or not); everything downstream — the reads, the address
 * resolution, the three panes — happens here, once.
 *
 * Selection lives entirely in the URL, resolved by `./editor-address`. Below the
 * pane breakpoint a day segment is a page you navigate to and `?exercise=` opens
 * a sheet over it; at or above it the same two facts light up pane 2 and pane 3.
 * Nothing here branches on width: `EditorPanes` owns the projection in CSS.
 */
/**
 * The two scopes the sheet offers, in order. There is deliberately no third:
 * nothing in the schema is week-ranged, so "this week onward" has nowhere to be
 * stored (docs/specs/per-week-set-count.md), and the do-nothing branch comes
 * first because the edit is already saved.
 */
const REACH_SCOPES = ['week', 'plan'] as const satisfies readonly ReachScope[]

interface EditorSurfaceProps {
  programId: string
  /** The `[day]` path segment; undefined on the structure-only route. */
  daySegment?: string
  searchParams: { week?: RawParam; exercise?: RawParam; view?: RawParam; reach?: RawParam }
}

export async function EditorSurface({ programId, daySegment, searchParams }: EditorSurfaceProps) {
  const t = await getTranslations('ProgramEditor')
  const tCommon = await getTranslations('Common')
  const tDetail = await getTranslations('ProgramDetail')
  const tScheme = await getTranslations('SchemeCopy')

  const userId = await requireUserId()
  const [program, unit] = await Promise.all([
    getProgramDetail(userId, programId),
    getWeightUnit(userId),
  ])
  if (!program) notFound()

  const [{ currentWeek, blockComplete }, workouts] = await Promise.all([
    programWeekState(userId, program.id, program.mesocycleWeeks),
    listProgramWorkouts(userId, program.id),
  ])

  const weeksWithWorkouts = workouts
    .map((workout) => workout.programWeek)
    .filter((week): week is number => week !== null)

  // The week bound handed to the address parser is the REAL outer week, not
  // `mesocycleWeeks`. A shrink below already-trained weeks is allowed and only
  // reported (`updateProgramMeta`'s `trainedWeeksBeyond`), so real history can
  // sit above the block length — and `parseWeekParam` clamps to the bound it is
  // given. Passing `mesocycleWeeks` would make `?week=9` silently resolve to
  // week 6 and quietly hide a week the user actually trained. The parser itself
  // stays the one shared with the detail page and is not forked here; only the
  // BOUND, which is data, differs.
  const weekBound = Math.max(program.mesocycleWeeks, ...weeksWithWorkouts, 1)

  const address = resolveEditorAddress(
    {
      day: daySegment,
      exercise: searchParams.exercise,
      week: searchParams.week,
      view: searchParams.view,
    },
    {
      dayCount: program.days.length,
      exerciseCountForDay: (day) => program.days[day]?.exercises.length ?? 0,
      mesocycleWeeks: weekBound,
      currentWeek,
    },
  )

  // Trained state, per DAY, for the selected week. The freeze unit is a workout
  // instantiation — one (day × week) — so this is a state per day and never a
  // property of the week; `resolveDayState` inside `trainedDayState` is the
  // shipped decision point, not a second predicate written here.
  //
  // "Skipped" is gated on the week being behind the user: saying it of the
  // current or a future week would accuse them of missing a session they can
  // still train.
  const isPastWeek = address.week < currentWeek
  const workoutsFor = (dayId: string) =>
    workouts.filter(
      (workout) => workout.programDayId === dayId && workout.programWeek === address.week,
    )
  const trainedStates = program.days.map((programDay) =>
    trainedDayState(workoutsFor(programDay.id), isPastWeek),
  )

  const sourceDay = address.day === null ? null : (program.days[address.day] ?? null)

  // The settled day's SESSION — real facts, from aggregates the week read
  // already carried. No extra query, and nothing here presents the plan's
  // numbers as though they were the logged ones.
  const sessionRow =
    sourceDay !== null && address.day !== null && isSettled(trainedStates[address.day])
      ? (workoutsFor(sourceDay.id)[0] ?? null)
      : null

  // The settled day's LOG — the sets as the session recorded them, with the
  // prescription each was seeded with. Read here rather than reconstructed from
  // the plan: `instantiateProgramDay` froze `prescribed*` at start time and no
  // edit path updates them, so the template on screen today may be a different
  // number from the one this session was actually given. Showing the template
  // under "you trained this" would present a plan figure as something lifted.
  const session = sessionRow === null ? null : await workoutDetailQuery(userId, sessionRow.id)

  const day = editorDayDetail(
    sourceDay,
    address.day,
    address.week,
    unit,
    address.day === null ? null : trainedStates[address.day],
    sessionRow === null
      ? null
      : {
          href: `/workout/${sessionRow.id}`,
          completedSetCount: sessionRow.completedSetCount,
          setCount: sessionRow.setCount,
          volume: kgToDisplay(sessionRow.volumeKg, unit),
          exercises: editorLoggedExercises(session?.exercises ?? []),
        },
  )

  const sourceExercise =
    sourceDay !== null && address.exercise !== null
      ? (sourceDay.exercises[address.exercise] ?? null)
      : null

  let inspected: EditorInspectorExercise | null = null
  if (sourceExercise !== null && address.exercise !== null) {
    // The scheme sentence is derived by the SHIPPED `progressionLine`, fed the
    // week's real loads in kg. Reusing it (rather than composing a sentence
    // here) is what keeps the inspector and the detail page from describing the
    // same scheme two different ways.
    const howLine = progressionLine(
      sourceExercise.progression,
      sourceExercise.sets.map((set) => ({
        loadKg: editorSetLoadKg(set, address.week),
        setType: set.setType,
      })),
      unit,
    )
    inspected = {
      position: address.exercise,
      name: sourceExercise.name,
      setCount: sourceExercise.sets.length,
      progressionSentence: renderMessage(tScheme, howLine),
      // Technique labels borrow the detail page's shipped vocabulary rather
      // than minting a second set of words for the same four techniques.
      techniques: sourceExercise.sets.flatMap((set) =>
        set.technique === null
          ? []
          : [
              {
                setNumber: set.setNumber,
                label: tDetail(`day.technique.${TECHNIQUE_LABEL_KEY[set.technique.kind]}`),
              },
            ],
      ),
    }
  }

  // Every link the surface mints carries the current READING, so switching to
  // the pivot and then picking a day does not silently drop you back into the
  // day-wise one. The reading is part of the address; it travels like the rest
  // of it.
  const href = (next: { day?: number | null; exercise?: number | null; week?: number }) =>
    editorHref(program.id, { week: address.week, view: address.view, ...next })

  // One week list for both panes. The structure list and the pivot's columns
  // MUST be the same weeks: `editorWeeks` keeps weeks trained above a shrunken
  // `mesocycleWeeks`, and a grid that re-derived its own range would drop them
  // while the list beside it still showed them.
  const weeks = editorWeeks(program.mesocycleWeeks, program.deloadWeek, weeksWithWorkouts)
  const weekNumbers = weeks.map((entry) => entry.week)

  // The reach sheet — "you changed a weight, how far should it reach?".
  //
  // The `?reach=` param only NAMES a set; whether there is anything to ask is
  // decided here by `reachDivergence`, which is silent unless this week's pin
  // really differs from the template. So a pin equal to the rule, a reps-only
  // edit, or a hand-typed param all open nothing.
  const reachTarget = parseReachParam(searchParams.reach)
  const reachSet =
    reachTarget === null || sourceDay === null
      ? null
      : (sourceDay.exercises[reachTarget.exercise]?.sets.find(
          (row) => row.setNumber === reachTarget.setNumber,
        ) ?? null)
  const reachSubject = reachSet === null ? null : { set: reachSet, week: address.week }
  const divergence = reachSubject === null ? null : reachDivergence(reachSubject)

  // Which weeks of THIS day already have a session. Any workout row means the
  // day was started, and a started session is as settled as a finished one —
  // its sets were written at start time and resuming returns them untouched.
  const settledWeeksForDay =
    sourceDay === null
      ? []
      : [
          ...new Set(
            workouts
              .filter((workout) => workout.programDayId === sourceDay.id)
              .map((workout) => workout.programWeek)
              .filter((weekNumber): weekNumber is number => weekNumber !== null),
          ),
        ]

  // The block's sentence is the SHIPPED one — "Block complete." included —
  // rather than a second opinion about where the block stands.
  const blockWeeks = buildBlockWeeks({
    mesocycleWeeks: program.mesocycleWeeks,
    deloadWeek: program.deloadWeek,
    currentWeek,
    dayCountTotal: program.days.length,
    workouts,
  })
  const statusLine = programStatusLine({
    currentWeek,
    mesocycleWeeks: program.mesocycleWeeks,
    deloadWeek: program.deloadWeek,
    daysDoneThisWeek: blockWeeks.find((w) => w.week === currentWeek)?.dayCountDone ?? 0,
    dayCountTotal: program.days.length,
    blockComplete,
  })

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title={program.name}
        trailing={
          <Link
            href={`/programs/${program.id}`}
            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
          >
            {tCommon('close')}
          </Link>
        }
      />
      <main aria-label={t('surfaceLabel')} className="flex flex-1 flex-col">
        {/* Scope stated BEFORE the edit, not confirmed at save. */}
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 min-[840px]:max-w-none min-[840px]:flex-row min-[840px]:items-start min-[840px]:justify-between">
          <EditorScopeLine
            className="min-w-0 flex-1 border-b-0 min-[840px]:border-b"
            statusLine={renderMessage(tDetail, statusLine)}
            week={address.week}
            report={weekTrainedReport(trainedStates)}
            hasHistory={workouts.length > 0}
          />
          {/* The reading, beside the scope it applies to. Both readings answer
              for the SAME selection, so this is a lens control and not
              navigation to somewhere else. */}
          <EditorViewToggle
            className="border-b border-b-border/60 px-5 pb-3 min-[840px]:border-b-0 min-[840px]:pt-3"
            view={address.view}
            hrefForView={(view) =>
              editorHref(program.id, {
                week: address.week,
                day: address.day,
                exercise: address.exercise,
                view,
              })
            }
          />
        </div>
        <EditorPanes
          className="mx-auto w-full max-w-md min-[840px]:max-w-none"
          hasDay={address.day !== null}
          structure={
            <EditorStructurePane
              weeks={weeks}
              selectedWeek={address.week}
              hrefForWeek={(week) => href({ week, day: address.day, exercise: address.exercise })}
              days={editorDays(program.days, trainedStates)}
              selectedDay={address.day}
              hrefForDay={(dayPosition) => href({ day: dayPosition })}
              seamIndex={trainedSeamIndex(trainedStates)}
            />
          }
          day={
            // Pane 2's two faces. Same address, same day, same week — only the
            // axis differs, which is why this is a branch here and not a
            // second route with its own state to keep in step.
            address.view === 'exercise' ? (
              <EditorPivotGrid
                dayName={sourceDay?.name ?? null}
                weeks={weeks}
                rows={pivotRows(sourceDay?.exercises ?? [], weekNumbers, unit)}
                selectedWeek={address.week}
                selectedExercise={address.exercise}
                hrefForCell={(exercise, week) => href({ day: address.day, exercise, week })}
                unit={unit}
              />
            ) : (
              <EditorDayPane
                day={day}
                week={address.week}
                unit={unit}
                selectedExercise={address.exercise}
                hrefForExercise={(exercise) => href({ day: address.day, exercise })}
                programId={program.id}
                saveSetAction={saveSetOverrideAction}
              />
            )
          }
          inspector={
            inspected === null ? null : (
              <EditorInspector exercise={inspected} closeHref={href({ day: address.day })} />
            )
          }
        />
        {reachSubject !== null &&
          divergence !== null &&
          reachTarget !== null &&
          address.day !== null && (
            <EditorReachSheet
              className="mx-auto w-full max-w-md min-[840px]:max-w-none"
              exerciseName={sourceDay?.exercises[reachTarget.exercise]?.name ?? ''}
              week={address.week}
              toLoad={kgToDisplay(divergence.toKg, unit)}
              fromLoad={
                divergence.fromKg === null ? null : kgToDisplay(divergence.fromKg, unit)
              }
              unit={unit}
              options={REACH_SCOPES.map((scope) => ({
                scope,
                weeks: reachWeeks(reachSubject, weekNumbers, scope, settledWeeksForDay, unit),
              }))}
              dismissHref={href({ day: address.day, exercise: address.exercise })}
              applyToPlanAction={applyReachToPlanAction}
              subject={{
                programId: program.id,
                day: address.day,
                exercise: reachTarget.exercise,
                setNumber: reachTarget.setNumber,
                week: address.week,
              }}
            />
          )}
      </main>
    </div>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { AppHeader } from '@/components/app-header'
import { EditorDayPane } from '@/components/editor/editor-day-pane'
import { EditorInspector, type EditorInspectorExercise } from '@/components/editor/editor-inspector'
import { EditorPanes } from '@/components/editor/editor-panes'
import { EditorStructurePane } from '@/components/editor/editor-structure-pane'
import { buttonVariants } from '@/components/ui/button'
import { getWeightUnit } from '@/db/preferences'
import { getProgramDetail, listProgramWorkouts, programWeekState } from '@/db/programs'
import { requireUserId } from '@/lib/auth'
import { renderMessage } from '@/lib/message'
import { TECHNIQUE_LABEL_KEY } from '@/lib/technique'
import { cn } from '@/lib/utils'
import { progressionLine } from '../detail-view'
import { editorHref, resolveEditorAddress, type RawParam } from './editor-address'
import { editorDayDetail, editorDays, editorSetLoadKg, editorWeeks } from './editor-view'

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
interface EditorSurfaceProps {
  programId: string
  /** The `[day]` path segment; undefined on the structure-only route. */
  daySegment?: string
  searchParams: { week?: RawParam; exercise?: RawParam }
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

  const [{ currentWeek }, workouts] = await Promise.all([
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
    { day: daySegment, exercise: searchParams.exercise, week: searchParams.week },
    {
      dayCount: program.days.length,
      exerciseCountForDay: (day) => program.days[day]?.exercises.length ?? 0,
      mesocycleWeeks: weekBound,
      currentWeek,
    },
  )

  const sourceDay = address.day === null ? null : (program.days[address.day] ?? null)
  const day = editorDayDetail(sourceDay, address.day, address.week, unit)

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

  const href = (next: { day?: number | null; exercise?: number | null }) =>
    editorHref(program.id, { week: address.week, ...next })

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
        <EditorPanes
          className="mx-auto w-full max-w-md min-[840px]:max-w-none"
          hasDay={address.day !== null}
          structure={
            <EditorStructurePane
              weeks={editorWeeks(program.mesocycleWeeks, program.deloadWeek, weeksWithWorkouts)}
              selectedWeek={address.week}
              hrefForWeek={(week) =>
                editorHref(program.id, { week, day: address.day, exercise: address.exercise })
              }
              days={editorDays(program.days)}
              selectedDay={address.day}
              hrefForDay={(dayPosition) => href({ day: dayPosition })}
            />
          }
          day={
            <EditorDayPane
              day={day}
              week={address.week}
              unit={unit}
              selectedExercise={address.exercise}
              hrefForExercise={(exercise) => href({ day: address.day, exercise })}
            />
          }
          inspector={
            inspected === null ? null : (
              <EditorInspector exercise={inspected} closeHref={href({ day: address.day })} />
            )
          }
        />
      </main>
    </div>
  )
}

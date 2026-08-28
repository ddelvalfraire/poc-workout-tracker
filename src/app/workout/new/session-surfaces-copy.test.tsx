import { describe, it, expect } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { EffortChips } from './effort-chips'
import { SetRowMenu } from './set-row-menu'
import { NoteSheet } from './note-sheet'
import { SwipeToDelete } from './swipe-to-delete'
import { SessionToast } from './session-toast'
import { ReplaceConfirmDialog } from './replace-confirm-dialog'
import { PlateSheet } from './plate-sheet'

/**
 * Copy contract for the in-session surfaces the logger opens: chips, the row
 * menu, the note sheet, the swipe backdrop, the toast and the replace guard.
 * All resolve through the REAL en.json (vitest.intl feeds the shipped
 * catalog), and none may leak a key path into its markup.
 *
 * Messages that only appear behind data a static render cannot reach (the
 * stats sheet's records, the rest pill's live readout) are replayed through
 * the same keys and argument names their component uses.
 */

const noop = () => {}

type CatalogNamespace = 'StatsSheet' | 'RestPill' | 'PlateSheet' | 'RestSheet' | 'WeightStepper'

/** The translator is typed structurally on purpose: this probe spans several
 *  namespaces, and ReturnType<typeof useTranslations> with no parameter asks
 *  TypeScript to instantiate every namespace in the catalog — which exceeds
 *  its depth limit now that the catalog is app-wide. */
type Translator = {
  (key: string, values?: Record<string, unknown>): string
  rich: (key: string, values?: Record<string, unknown>) => ReactNode
}

function Probe({
  namespace,
  render,
}: {
  namespace: CatalogNamespace
  render: (t: Translator) => ReactNode
}) {
  const t = useTranslations(namespace)
  return <>{render(t as unknown as Translator)}</>
}

const message = (namespace: CatalogNamespace, render: (t: Translator) => ReactNode) =>
  renderStaticIntl(<Probe namespace={namespace} render={render} />)

describe('EffortChips copy', () => {
  it('names both scales, the target caption and the chip labels', () => {
    const html = renderStaticIntl(
      <EffortChips
        setLabel="set 1"
        rir=""
        rpe=""
        targetLabel="RIR 2"
        targetRir={2}
        targetRpe={null}
        onSelectRir={noop}
        onSelectRpe={noop}
        onIdleCollapse={noop}
      />,
    )

    expect(html).toContain('RIR')
    expect(html).toContain('Reps in reserve for set 1')
    expect(html).toContain('Switch to RPE for set 1')
    expect(html).toContain('Target RIR 2')
    expect(html).toContain('RIR 5 or more')
    expect(html).not.toMatch(/EffortChips\.[a-zA-Z.]+/)
  })
})

describe('SetRowMenu copy', () => {
  it('speaks both note states and both warm-up states', () => {
    const fresh = renderStaticIntl(
      <SetRowMenu
        x={0}
        y={0}
        setLabel="set 2"
        hasNote={false}
        isWarmup={false}
        techniqueKind={null}
        canTagTechnique
        onNote={noop}
        onTagTechnique={noop}
        onTagWarmup={noop}
        onRemove={noop}
        onClose={noop}
      />,
    )
    const tagged = renderStaticIntl(
      <SetRowMenu
        x={0}
        y={0}
        setLabel="set 2"
        hasNote
        isWarmup
        techniqueKind={null}
        canTagTechnique
        onNote={noop}
        onTagTechnique={noop}
        onTagWarmup={noop}
        onRemove={noop}
        onClose={noop}
      />,
    )

    expect(fresh).toContain('Actions for set 2')
    expect(fresh).toContain('Add note')
    expect(fresh).toContain('Tag warm-up')
    expect(fresh).toContain('Remove set')
    expect(tagged).toContain('Note · view')
    expect(tagged).toContain('Untag warm-up')
    expect(fresh).not.toMatch(/SetRowMenu\.[a-zA-Z.]+/)
  })
})

describe('NoteSheet copy', () => {
  it('builds the breadcrumb and the scope chips at render, not at import', () => {
    const html = renderStaticIntl(
      <NoteSheet
        anchor={{ exerciseName: 'Bench Press', setNumber: 3, snapshot: '100 kg × 5' }}
        initialScope="set"
        onSave={noop}
        onClose={noop}
      />,
    )

    expect(html).toContain('Note for Bench Press · Set 3')
    expect(html).toContain('Bench Press · Set 3')
    expect(html).toContain('Set 3')
    expect(html).toContain('Exercise')
    expect(html).toContain('Workout')
    expect(html).toContain('Add note…')
    expect(html).toContain('Insert #form tag')
    expect(html).not.toMatch(/NoteSheet\.[a-zA-Z.]+/)
  })

  it('an unanchored sheet still localizes the workout breadcrumb', () => {
    const html = renderStaticIntl(
      <NoteSheet anchor={null} initialScope="workout" onSave={noop} onClose={noop} />,
    )

    expect(html).toContain('Note for Workout')
    expect(html).toContain('Add note…')
    expect(html).not.toMatch(/NoteSheet\.[a-zA-Z.]+/)
  })
})

describe('SwipeToDelete and SessionToast copy', () => {
  it('labels the swipe backdrop', () => {
    const html = renderStaticIntl(
      <SwipeToDelete onDelete={noop}>
        <span>row</span>
      </SwipeToDelete>,
    )

    expect(html).toContain('Remove')
    expect(html).not.toMatch(/SwipeToDelete\.[a-zA-Z.]+/)
  })

  it('renders the toast without leaking its key path', () => {
    const html = renderStaticIntl(
      <SessionToast open>
        <span>Removed Squat</span>
      </SessionToast>,
    )

    expect(html).toContain('Removed Squat')
    expect(html).not.toMatch(/SessionToast\.[a-zA-Z.]+/)
  })
})

describe('ReplaceConfirmDialog copy', () => {
  it('uses a whole message per completion state, never a swapped adverb', () => {
    const full = renderStaticIntl(
      <ReplaceConfirmDialog
        oldName="Squat"
        newName="Hack Squat"
        hasAllCompleted
        onReplace={noop}
        onAddInstead={noop}
        onClose={noop}
      />,
    )
    const partial = renderStaticIntl(
      <ReplaceConfirmDialog
        oldName="Squat"
        newName="Hack Squat"
        hasAllCompleted={false}
        onReplace={noop}
        onAddInstead={noop}
        onClose={noop}
      />,
    )

    expect(full).toContain('Squat is fully completed')
    expect(partial).toContain('Squat is partially completed')
    expect(full).toContain(
      'Replacing discards its logged sets. Add Hack Squat as a separate exercise to keep them.',
    )
    expect(full).toContain('Add instead')
    expect(full).not.toMatch(/ReplaceConfirmDialog\.[a-zA-Z.]+/)
  })
})

describe('StatsSheet rich messages', () => {
  it('keeps the unit inside its tag on the headline record', () => {
    const out = message('StatsSheet', (t) =>
      t.rich('bestE1rmValue', {
        value: 142.5,
        unit: 'kg',
        unitTag: (chunks: ReactNode) => <span className="unit">{chunks}</span>,
      }),
    )

    expect(out).toContain('<span class="unit">kg</span>')
    expect(out).toContain('142.5')
    expect(out).not.toMatch(/StatsSheet\.[a-zA-Z.]+/)
  })

  it('keeps the rep count inside its tag on the heaviest tile', () => {
    const out = message('StatsSheet', (t) =>
      t.rich('heaviestValue', {
        weight: 140,
        unit: 'kg',
        reps: 3,
        repsTag: (chunks: ReactNode) => <span className="reps">{chunks}</span>,
      }),
    )

    expect(out).toContain('140 kg')
    expect(out).toContain('<span class="reps">×3</span>')
  })
})

describe('Rest, plate and stepper argument messages', () => {
  it('renders all three rest-pill readout labels', () => {
    expect(message('RestPill', (t) => t('label.countUp', { time: '1:15' }))).toContain(
      'Rest time 1:15. Set rest target',
    )
    expect(message('RestPill', (t) => t('label.remaining', { time: '1:00', target: 90 }))).toContain(
      'Rest 1:00 remaining of 90 second target. Change rest target',
    )
    expect(message('RestPill', (t) => t('label.over', { time: '0:10', target: 90 }))).toContain(
      'Rest 0:10 over the 90 second target — go. Change rest target',
    )
  })

  it('renders the rest adjusters with their signs', () => {
    expect(message('RestPill', (t) => t('shorten', { seconds: 15 }))).toContain('−15')
    expect(message('RestPill', (t) => t('extend', { seconds: 15 }))).toContain('+15')
  })

  it('renders the plate sheet per-side readouts', () => {
    expect(message('PlateSheet', (t) => t('perSideBarOnly'))).toContain('bar only')
    expect(message('PlateSheet', (t) => t('perSide', { plates: '20 + 10' }))).toContain(
      '20 + 10 / side',
    )
    expect(
      message('PlateSheet', (t) => t('closest', { weight: 97.5, perSide: '20 + 10 / side' })),
    ).toContain('closest 97.5 — 20 + 10 / side')
    expect(message('PlateSheet', (t) => t('editGearAction', { unit: 'kg' }))).toContain(
      'Edit your bars &amp; plates (kg)',
    )
  })

  it('builds each stepper label as one whole sentence per direction', () => {
    expect(
      message('WeightStepper', (t) =>
        t('increaseAriaLabel', { set: 1, noun: 'added weight', step: 2.5, unit: 'kg' }),
      ),
    ).toContain('Increase set 1 added weight by 2.5 kg')
    expect(
      message('WeightStepper', (t) =>
        t('decreaseAriaLabel', { set: 1, noun: 'assistance', step: 2.5, unit: 'kg' }),
      ),
    ).toContain('Decrease set 1 assistance by 2.5 kg')
  })

  it('renders the rest sheet presets and its validation ceiling', () => {
    expect(message('RestSheet', (t) => t('presetSeconds', { seconds: 90 }))).toContain('90s')
    expect(message('RestSheet', (t) => t('validation', { max: 900 }))).toContain(
      'Custom rest must be a whole number of seconds, 0 to 900.',
    )
  })
})

// The picker's own behaviour lives in exercise-picker.test.tsx; this pins only
// the create-row copy, whose two branches swap on the typed query.
describe('ExercisePicker create row', () => {
  it('quotes the query when there is one', () => {
    function CreateRow() {
      const t = useTranslations('ExercisePicker')
      return (
        <>
          {t('createQueryAction', { query: 'zercher' })}
          {t('createAction')}
        </>
      )
    }
    const html = renderStaticIntl(<CreateRow />)

    expect(html).toContain('+ Create “zercher”')
    expect(html).toContain('+ Create custom exercise')
    expect(html).not.toMatch(/ExercisePicker\.[a-zA-Z.]+/)
  })
})

// The bar picker's own markup, not just its messages: the fix that put "bar"
// in the legend instead of on every pill is a fact about the RENDERED sheet,
// and a message-only assertion would still pass if the pill went back to
// printing the whole phrase.
describe('PlateSheet bar picker', () => {
  const renderSheet = () =>
    renderStaticIntl(
      <PlateSheet
        exerciseName="Back Squat"
        weights={[100]}
        unit="kg"
        equipment={{ bars: [20, 15], plates: [25, 20, 10, 5, 2.5, 1.25] }}
        onClose={noop}
        onEquipmentSaved={noop}
      />,
    )

  it('says "bar" once, in the legend — never on a pill', () => {
    const html = renderSheet()

    expect(html).toContain('Bar (kg)')
    // The seen copy is the bare denomination. Were the pill to print the whole
    // phrase again, every pill would wrap to two lines on a phone.
    expect(html).toContain('>20</button>')
    expect(html).not.toContain('>20 kg bar<')
  })

  it('still names each pill in full for a screen reader', () => {
    const html = renderSheet()

    expect(html).toContain('aria-label="20 kg bar"')
    expect(html).toContain('aria-label="15 kg bar"')
  })

  it('keeps the plate-loaded escape hatch', () => {
    expect(renderSheet()).toContain('No bar')
  })
})

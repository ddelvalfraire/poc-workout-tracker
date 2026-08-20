import { describe, it, expect } from 'vitest'
import { renderMessageIn } from '../../../../vitest.intl'
import { restartDialogBody, type RestartPreview } from './restart-view'

/** What the dialog actually shows: each sentence descriptor rendered through
 *  the real catalog, joined the way RestartProgramButton joins them. */
const body = (preview: RestartPreview | null) =>
  restartDialogBody(preview)
    .map((sentence) => renderMessageIn('RestartProgramButton', sentence))
    .join(' ')

const BASE =
  'Creates a fresh copy of this program starting at week 1 and makes it active. ' +
  'This one is archived — its history and stats stay.'

describe('restartDialogBody (restart confirm step)', () => {
  it('decides on the base sentence alone while the preview is loading or failed', () => {
    expect(restartDialogBody(null)).toEqual([{ key: 'dialog.body' }])
    expect(body(null)).toBe(BASE)
  })

  it('stays the base copy for a program with nothing to carry forward', () => {
    const preview: RestartPreview = { flagged: [], incrementCount: 0, unit: 'kg' }
    expect(restartDialogBody(preview)).toEqual([{ key: 'dialog.body' }])
    expect(body(preview)).toBe(BASE)
  })

  it('announces the step-up count for a clean block', () => {
    const preview: RestartPreview = { flagged: [], incrementCount: 3, unit: 'kg' }
    expect(restartDialogBody(preview)[1]).toEqual({
      key: 'dialog.bodyIncrements',
      values: { lifts: 3 },
    })
    expect(body(preview)).toBe(
      `${BASE} Training maxes step up one increment for the new block (3 lifts).`,
    )
  })

  // One and many asserted separately: the count was hand-pluralized before,
  // which is exactly the shape that reads wrong in every other language.
  it('agrees the step-up count with itself at one lift', () => {
    const preview: RestartPreview = { flagged: [], incrementCount: 1, unit: 'kg' }
    expect(body(preview)).toBe(
      `${BASE} Training maxes step up one increment for the new block (1 lift).`,
    )
  })

  it('appends one reset suggestion per flagged lift, deduped by name', () => {
    const preview: RestartPreview = {
      flagged: [
        { exerciseName: 'Squat', proposedTm: 126 },
        { exerciseName: 'Squat', proposedTm: 126 }, // same lift on another day
        { exerciseName: 'Press', proposedTm: null },
      ],
      incrementCount: 1,
      unit: 'kg',
    }
    // The exercise name rides in as an ARGUMENT — it is catalog content, never
    // translated — so the descriptor carries it rather than a rendered clause.
    expect(restartDialogBody(preview).slice(2)).toEqual([
      { key: 'dialog.bodyStalledReset', values: { exercise: 'Squat', tm: 126, unit: 'kg' } },
      { key: 'dialog.bodyStalled', values: { exercise: 'Press' } },
    ])
    expect(body(preview)).toBe(
      `${BASE} Training maxes step up one increment for the new block (1 lift). ` +
        'Squat looks stalled — its training max stays put; consider a reset to 126 kg after restarting. ' +
        'Press looks stalled — its training max stays put.',
    )
  })

  it('leaves no unresolved key path in the rendered body', () => {
    const preview: RestartPreview = {
      flagged: [{ exerciseName: 'Squat', proposedTm: 126 }],
      incrementCount: 2,
      unit: 'lb',
    }
    expect(body(preview)).not.toMatch(/RestartProgramButton\.[a-zA-Z.]+/)
  })
})

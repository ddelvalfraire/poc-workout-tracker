import { describe, it, expect } from 'vitest'
import { restartDialogBody, type RestartPreview } from './restart-view'

const BASE =
  'Creates a fresh copy of this program starting at week 1 and makes it active. ' +
  'This one is archived — its history and stats stay.'

describe('restartDialogBody (restart confirm step)', () => {
  it('reads exactly the base copy while the preview is loading or failed', () => {
    expect(restartDialogBody(null)).toBe(BASE)
  })

  it('stays the base copy for a program with nothing to carry forward', () => {
    const preview: RestartPreview = { flagged: [], incrementCount: 0, unit: 'kg' }
    expect(restartDialogBody(preview)).toBe(BASE)
  })

  it('announces the step-up count for a clean block', () => {
    const preview: RestartPreview = { flagged: [], incrementCount: 3, unit: 'kg' }
    expect(restartDialogBody(preview)).toBe(
      `${BASE} Training maxes step up one increment for the new block (3 lifts).`,
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
    expect(restartDialogBody(preview)).toBe(
      `${BASE} Training maxes step up one increment for the new block (1 lift). ` +
        'Squat looks stalled — its training max stays put; consider a reset to 126 kg after restarting. ' +
        'Press looks stalled — its training max stays put.',
    )
  })
})

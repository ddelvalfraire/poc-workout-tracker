import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Analytics wiring of the program actions — program_started on activation
 * paths, workout_started on day instantiation. Everything stateful is mocked;
 * pure libs (program-input schemas, units) stay real.
 */
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireUserId: vi.fn() }))
vi.mock('@/db/programs', () => ({
  saveProgram: vi.fn(),
  updateProgram: vi.fn(),
  deleteProgram: vi.fn(),
  setProgramStatus: vi.fn(),
  updateProgramDescription: vi.fn(),
  cloneProgram: vi.fn(),
  instantiateProgramDay: vi.fn(),
  adoptProgram: vi.fn(),
  declineProgram: vi.fn(),
  countProgramDays: vi.fn(async () => 4),
}))
vi.mock('@/db/program-shares', () => ({
  setProgramVisibility: vi.fn(),
  createShare: vi.fn(),
  revokeShare: vi.fn(),
}))
vi.mock('@/db/program-patches', () => ({
  setTrainingMax: vi.fn(),
  setProgramDietPhase: vi.fn(),
  setProgramOvershootPolicy: vi.fn(),
  updateProgramExercise: vi.fn(),
}))
vi.mock('@/db/patch-proposals', () => ({
  confirmPatchProposal: vi.fn(),
  declinePatchProposal: vi.fn(),
}))
vi.mock('@/db/restart-plan', () => ({ restartTmPlan: vi.fn() }))
vi.mock('@/db/preferences', () => ({ getWeightUnit: vi.fn() }))
vi.mock('./[id]/detail-view', () => ({ proposedTrainingMaxKg: vi.fn() }))
vi.mock('@/lib/analytics', () => ({ captureServerEvent: vi.fn(async () => {}) }))

import {
  setProgramStatusAction,
  adoptProgramAction,
  startProgramDayAction,
} from './actions'
import { requireUserId } from '@/lib/auth'
import { setProgramStatus, adoptProgram, instantiateProgramDay } from '@/db/programs'
import { captureServerEvent } from '@/lib/analytics'

const USER = 'user_123'
const PROGRAM = 'prog-1'
const DAY = 'day-1'

const mockedCapture = vi.mocked(captureServerEvent)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireUserId).mockResolvedValue(USER)
})

/** The captures are fire-and-forget; wait for the microtask chain. */
async function expectProgramStarted(source: 'template' | 'custom') {
  await vi.waitFor(() => {
    expect(mockedCapture).toHaveBeenCalledWith(USER, {
      name: 'program_started',
      properties: { source, day_count: 4 },
    })
  })
}

describe('program_started wiring', () => {
  it('fires with source custom when an own program is activated', async () => {
    vi.mocked(setProgramStatus).mockResolvedValue({ id: PROGRAM })

    await setProgramStatusAction(PROGRAM, 'active')

    await expectProgramStarted('custom')
  })

  it('does not fire on non-activating status changes', async () => {
    vi.mocked(setProgramStatus).mockResolvedValue({ id: PROGRAM })

    await setProgramStatusAction(PROGRAM, 'archived')
    await new Promise((r) => setTimeout(r, 0))

    expect(mockedCapture).not.toHaveBeenCalled()
  })

  it('fires with source template on adopt-and-activate', async () => {
    vi.mocked(adoptProgram).mockResolvedValue({ id: PROGRAM })

    await adoptProgramAction(PROGRAM, true)

    await expectProgramStarted('template')
  })

  it('does not fire on adopt-to-draft', async () => {
    vi.mocked(adoptProgram).mockResolvedValue({ id: PROGRAM })

    await adoptProgramAction(PROGRAM, false)
    await new Promise((r) => setTimeout(r, 0))

    expect(mockedCapture).not.toHaveBeenCalled()
  })
})

describe('workout_started wiring', () => {
  it('fires with resume provenance from instantiateProgramDay', async () => {
    vi.mocked(instantiateProgramDay).mockResolvedValue({
      id: 'w1',
      week: 2,
      weekDerived: false,
      resumed: true,
    })

    await startProgramDayAction(DAY, 2)

    await vi.waitFor(() => {
      expect(mockedCapture).toHaveBeenCalledWith(USER, {
        name: 'workout_started',
        properties: { source: 'program_day', is_resumed: true },
      })
    })
  })
})

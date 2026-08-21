// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { withIntl } from '../../../../vitest.intl'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/**
 * The warm-up hint's expiry, verified interactively (the volt-budget jsdom
 * idiom — the mount effects that read/write localStorage never run in a
 * static render). The contract: the hint retires after the first real
 * warm-up tag (the original flag) OR after three sessions of rendering
 * unanswered — it has no dismiss affordance, so exposure is the only other
 * way out. The counter must count RENDERED sessions only: an empty ad-hoc
 * session where the hint never appeared must not burn an exposure.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}))

vi.mock('@/app/workout/actions', () => ({
  saveWorkoutAction: vi.fn(),
  updateWorkoutAction: vi.fn(),
  deleteWorkoutAction: vi.fn(),
  getLastPerformanceAction: vi.fn(),
  getExerciseBestAction: vi.fn(),
  substitutePlanTargetsAction: vi.fn(),
  rememberSwapAction: vi.fn(),
  getWorkoutDraftAction: vi.fn(),
  putWorkoutDraftAction: vi.fn(),
  deleteWorkoutDraftAction: vi.fn(),
}))

vi.mock('@/app/notes/actions', () => ({
  createNoteAction: vi.fn(),
  createFallbackSetNoteAction: vi.fn(),
  createSetNotesForWorkoutAction: vi.fn(),
}))

import { WorkoutLogger } from './workout-logger'
import type { WorkoutDraft } from './workout-draft'
import { getWorkoutDraftAction } from '@/app/workout/actions'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

window.matchMedia = (() => ({
  matches: false,
  addEventListener: () => {},
  removeEventListener: () => {},
})) as unknown as typeof window.matchMedia

const SEEN_KEY = 'logger:warmup-hint-seen'
const SESSIONS_KEY = 'logger:warmup-hint-sessions'
/** A stable fragment of WorkoutLogger.warmupHint from the shipped catalog. */
const HINT_TEXT = 'Hold a set'

/** Fresh in-memory localStorage per test: the runner's Node exposes its own
 *  experimental localStorage global ("--localstorage-file was provided
 *  without a valid path"), which shadows jsdom's with a partial, broken
 *  Storage — so the harness installs a deterministic one. */
function installLocalStorage(): void {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, String(value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => void store.clear(),
    },
  })
}

function draft(): WorkoutDraft {
  return {
    notes: '',
    exercises: [
      {
        id: 'ex1',
        wgerExerciseId: 73,
        source: 'wger',
        name: 'Squat',
        category: 'Legs',
        loggingType: 'weight_reps',
        notes: '',
        skipped: false,
        sets: [{ id: 's1', reps: '', weight: '', completed: false, tag: 'working' }],
      },
    ],
  }
}

describe('warm-up hint expiry', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    installLocalStorage()
    vi.mocked(getWorkoutDraftAction).mockResolvedValue(null)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function mount(initialDraft: WorkoutDraft = draft()) {
    const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } })
    act(() => {
      root.render(
        withIntl(
          <QueryClientProvider client={client}>
            <WorkoutLogger title="New Workout" closeHref="/" initialDraft={initialDraft} />
          </QueryClientProvider>,
        ),
      )
    })
  }

  const hintShown = () => document.body.textContent?.includes(HINT_TEXT) ?? false

  it('renders on a first-ever session and counts the exposure', () => {
    mount()
    expect(hintShown()).toBe(true)
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBe('1')
  })

  it('still renders on the third session — the last of the budget', () => {
    window.localStorage.setItem(SESSIONS_KEY, '2')
    mount()
    expect(hintShown()).toBe(true)
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBe('3')
  })

  it('stops rendering after three sessions of being ignored', () => {
    window.localStorage.setItem(SESSIONS_KEY, '3')
    mount()
    expect(hintShown()).toBe(false)
    // Hidden sessions never advance the counter.
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBe('3')
  })

  it('the gesture flag retires the hint regardless of the counter', () => {
    window.localStorage.setItem(SEEN_KEY, '1')
    mount()
    expect(hintShown()).toBe(false)
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBeNull()
  })

  it('an exercise-less session shows no hint and burns no exposure', () => {
    mount({ notes: '', exercises: [] })
    expect(hintShown()).toBe(false)
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBeNull()
  })

  it('a corrupt stored counter reads as zero and self-heals on the next write', () => {
    // NaN-guarded read (warmupHintSessionsSeen): garbage must not pin the
    // hint on forever (NaN < 3 is false — the gate would hide it for good)
    // NOR freeze the count — the render's own write overwrites the garbage
    // with a real number and the budget resumes from there.
    window.localStorage.setItem(SESSIONS_KEY, 'garbage')
    mount()
    expect(hintShown()).toBe(true)
    expect(window.localStorage.getItem(SESSIONS_KEY)).toBe('1')
  })
})

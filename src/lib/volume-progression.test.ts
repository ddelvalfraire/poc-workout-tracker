import { describe, it, expect } from 'vitest'
import type { AutoregSession } from './autoregulate'
import {
  combineWeekResults,
  hasPendingVolumeProposal,
  movementWeekResult,
  muscleVerdicts,
  pickCandidate,
  proposalsToCreate,
  uniformRepTop,
  volumeProposalContent,
  volumeProposalSummary,
  type MovementWeekEvidence,
  type MovementWeekResult,
  type SetTemplate,
} from './volume-progression'

/** A 3-working-set session prescribed 100 kg × 8-floor, performed at load. */
const sessionOf = (reps: (number | null)[]): AutoregSession => ({
  startedAtMs: 0,
  prescribed: reps.map((_, i) => ({ setNumber: i + 1, repMin: 8, loadKg: 100 })),
  actual: reps.map((r, i) => ({
    setNumber: i + 1,
    reps: r,
    weightKg: 100,
    completed: r !== null,
  })),
})

const TEMPLATE: SetTemplate = { repMin: 8, repMax: 12, restSec: 120 }

const movement = (
  overrides: Partial<MovementWeekEvidence> & { key: string },
): MovementWeekEvidence => ({
  name: overrides.key,
  primaryGroups: ['Chest'],
  weeks: new Map(),
  frequency: 1,
  muscleTagCount: 1,
  address: { dayPosition: 0, exercisePosition: 0 },
  setTemplate: TEMPLATE,
  schemeOwnsSets: false,
  ...overrides,
})

const weekMap = (entries: [number, MovementWeekResult][]) => new Map(entries)
const BEAT: MovementWeekResult = { beat: true, stalled: false }
const MISS: MovementWeekResult = { beat: false, stalled: false }
const STALL: MovementWeekResult = { beat: false, stalled: true }
const SILENT: MovementWeekResult = { beat: null, stalled: false }

describe('movementWeekResult', () => {
  it('beats when every scorable set is at/above the top', () => {
    expect(movementWeekResult(sessionOf([12, 12, 12]), 12, 'all-sets')).toEqual({
      beat: true,
      stalled: false,
    })
  })

  it('null beat when the plan has no rep top (silence, never false)', () => {
    expect(movementWeekResult(sessionOf([12, 12, 12]), null, 'all-sets').beat).toBe(null)
  })

  it('stalls via the engine session verdict (floor missed)', () => {
    const result = movementWeekResult(sessionOf([8, 8, 6]), 12, 'all-sets')
    expect(result.stalled).toBe(true)
    expect(result.beat).toBe(false)
  })

  it('quorum failure yields no beat verdict and no stall', () => {
    expect(movementWeekResult(sessionOf([12, null, null]), 12, 'all-sets')).toEqual({
      beat: null,
      stalled: false,
    })
  })
})

describe('combineWeekResults', () => {
  it('any stall stalls the week', () => {
    expect(combineWeekResults([BEAT, STALL]).stalled).toBe(true)
  })

  it('a mixed week is not a clear beat', () => {
    expect(combineWeekResults([BEAT, MISS]).beat).toBe(false)
  })

  it('beat + silence stays a beat; all-silent stays silent', () => {
    expect(combineWeekResults([BEAT, SILENT]).beat).toBe(true)
    expect(combineWeekResults([SILENT, SILENT]).beat).toBe(null)
  })
})

describe('uniformRepTop', () => {
  it('uniform working tops → the top; warmups ignored', () => {
    expect(
      uniformRepTop([
        { setType: 'warmup', repMax: null },
        { setType: 'working', repMax: 12 },
        { setType: 'working', repMax: 12 },
      ]),
    ).toBe(12)
  })

  it('mixed or absent tops → null (silence)', () => {
    expect(
      uniformRepTop([
        { setType: 'working', repMax: 12 },
        { setType: 'working', repMax: 10 },
      ]),
    ).toBe(null)
    expect(uniformRepTop([{ setType: 'working', repMax: null }])).toBe(null)
    expect(uniformRepTop([])).toBe(null)
  })
})

describe('muscleVerdicts', () => {
  it('INCREASE needs the top beaten in BOTH of the last two completed weeks', () => {
    const two = movement({
      key: 'wger:1',
      weeks: weekMap([
        [1, BEAT],
        [2, BEAT],
      ]),
    })
    const [verdict] = muscleVerdicts([two], 2)
    expect(verdict).toMatchObject({ group: 'Chest', status: 'increase', drivers: ['wger:1'] })
    expect(verdict.candidate?.key).toBe('wger:1')
  })

  it('one beaten week is on-track, not increase (no chasing one good week)', () => {
    const one = movement({
      key: 'wger:1',
      weeks: weekMap([
        [1, MISS],
        [2, BEAT],
      ]),
    })
    expect(muscleVerdicts([one], 2)[0].status).toBe('on-track')
  })

  it('week 1 can never INCREASE (no second completed week to confirm)', () => {
    const early = movement({ key: 'wger:1', weeks: weekMap([[1, BEAT]]) })
    expect(muscleVerdicts([early], 1)[0].status).toBe('on-track')
  })

  it('HOLD needs two DISTINCT stalled movements; one stall stays on-track', () => {
    const a = movement({ key: 'wger:1', weeks: weekMap([[2, STALL]]) })
    const b = movement({ key: 'wger:2', weeks: weekMap([[2, MISS]]) })
    expect(muscleVerdicts([a, b], 2)[0].status).toBe('on-track')
    const bStalled = movement({ key: 'wger:2', weeks: weekMap([[2, STALL]]) })
    const [verdict] = muscleVerdicts([a, bStalled], 2)
    expect(verdict.status).toBe('hold')
    expect(verdict.drivers).toEqual(['wger:1', 'wger:2'])
    expect(verdict.candidate).toBe(null)
  })

  it('HOLD outranks INCREASE — safety wins a conflict', () => {
    const beater = movement({
      key: 'wger:1',
      weeks: weekMap([
        [1, BEAT],
        [2, BEAT],
      ]),
    })
    const s1 = movement({ key: 'wger:2', weeks: weekMap([[2, STALL]]) })
    const s2 = movement({ key: 'wger:3', weeks: weekMap([[2, STALL]]) })
    expect(muscleVerdicts([beater, s1, s2], 2)[0].status).toBe('hold')
  })

  it('no scorable evidence → no verdict at all (silence over corruption)', () => {
    const silent = movement({ key: 'wger:1', weeks: weekMap([[2, SILENT]]) })
    expect(muscleVerdicts([silent], 2)).toEqual([])
    const untrained = movement({ key: 'wger:1', weeks: weekMap([]) })
    expect(muscleVerdicts([untrained], 2)).toEqual([])
  })

  it('verdicts are per muscle: a movement only testifies for its PRIMARY groups', () => {
    const bench = movement({
      key: 'wger:1',
      primaryGroups: ['Chest'],
      weeks: weekMap([
        [1, BEAT],
        [2, BEAT],
      ]),
    })
    const row = movement({
      key: 'wger:2',
      primaryGroups: ['Back'],
      weeks: weekMap([[2, MISS]]),
    })
    const verdicts = muscleVerdicts([bench, row], 2)
    expect(verdicts.map((v) => [v.group, v.status])).toEqual([
      ['Chest', 'increase'],
      ['Back', 'on-track'],
    ])
  })
})

describe('pickCandidate', () => {
  const beat2 = weekMap([
    [1, BEAT],
    [2, BEAT],
  ])

  it('highest frequency wins; muscle-tag count (compound proxy) breaks ties', () => {
    const fly = movement({
      key: 'wger:2',
      name: 'Fly',
      frequency: 1,
      muscleTagCount: 1,
      weeks: beat2,
    })
    const bench = movement({
      key: 'wger:1',
      name: 'Bench',
      frequency: 2,
      muscleTagCount: 3,
      weeks: beat2,
    })
    expect(pickCandidate([fly, bench])?.name).toBe('Bench')
    const dips = movement({
      key: 'wger:3',
      name: 'Dips',
      frequency: 1,
      muscleTagCount: 4,
      weeks: beat2,
    })
    expect(pickCandidate([fly, dips])?.name).toBe('Dips')
  })

  it('scheme-owned (weekly-volume) and template-less movements never candidate', () => {
    const schemed = movement({ key: 'wger:1', schemeOwnsSets: true, weeks: beat2 })
    const bare = movement({ key: 'wger:2', setTemplate: null, weeks: beat2 })
    expect(pickCandidate([schemed, bare])).toBe(null)
  })
})

describe('proposal content and dedup', () => {
  const candidate = {
    key: 'wger:1',
    name: 'Bench Press',
    address: { dayPosition: 0, exercisePosition: 1 },
    setTemplate: TEMPLATE,
  }

  it('builds one add_program_set patch cloning the working-set shape (no load)', () => {
    const content = volumeProposalContent('Chest', candidate)
    expect(content.summary).toBe('Add a set to Chest — beat top of range 2 weeks running')
    expect(content.patches).toEqual([
      {
        tool: 'add_program_set',
        args: {
          dayPosition: 0,
          exercisePosition: 1,
          setType: 'working',
          repMin: 8,
          repMax: 12,
          restSec: 120,
        },
      },
    ])
  })

  it('null template fields are omitted, not sent as nulls', () => {
    const bare = { ...candidate, setTemplate: { repMin: null, repMax: null, restSec: null } }
    expect(volumeProposalContent('Chest', bare).patches[0].args).toEqual({
      dayPosition: 0,
      exercisePosition: 1,
      setType: 'working',
    })
  })

  it('a pending proposal for the muscle blocks a duplicate (summary-prefix match)', () => {
    const pending = [volumeProposalSummary('Chest')]
    expect(hasPendingVolumeProposal(pending, 'Chest')).toBe(true)
    expect(hasPendingVolumeProposal(pending, 'Back')).toBe(false)
  })

  it('proposalsToCreate: increase-with-candidate only, deduped against pending', () => {
    const verdicts = [
      { group: 'Chest' as const, status: 'increase' as const, drivers: ['Bench'], candidate },
      {
        group: 'Back' as const,
        status: 'increase' as const,
        drivers: ['Row'],
        candidate: { ...candidate, key: 'wger:9', name: 'Row' },
      },
      {
        group: 'Quads' as const,
        status: 'hold' as const,
        drivers: ['Squat', 'Leg Press'],
        candidate: null,
      },
      { group: 'Biceps' as const, status: 'increase' as const, drivers: ['Curl'], candidate: null },
    ]
    const out = proposalsToCreate(verdicts, [volumeProposalSummary('Back')])
    expect(out.map((p) => p.group)).toEqual(['Chest'])
  })
})

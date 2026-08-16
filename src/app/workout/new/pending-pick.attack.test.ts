import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  parsePendingPick,
  consumePendingPick,
  PENDING_PICK_KEY,
  type PendingPickExercise,
} from './pending-pick'
import { newDraftExercise, replacementDraftExercise } from './workout-draft'
import { buildDraftPayload, isDraftPayload } from './draft-payload'

/**
 * Adversarial regression tests (#218): pending-pick is a trust boundary that
 * "re-validates the full shape and rejects rather than coerces". These tests
 * attack that claim with hostile sessionStorage payloads — a page any script
 * on the origin (or a stale/buggy writer) can populate. Adopted from the
 * adversarial verification round.
 */

/** The exact 4-key shape the create page writes. */
const CLEAN: PendingPickExercise = {
  wgerExerciseId: 42,
  source: 'custom',
  name: 'Nordic Curl',
  category: 'Legs',
}

describe('parsePendingPick — hostile payload shapes', () => {
  it('ATTACK: strips unknown keys from the exercise (trust boundary = exact shape out)', () => {
    // A hostile writer smuggles extra keys alongside a valid pick. The doc
    // comment promises "the reader re-validates the full shape and rejects
    // rather than coerces" — passing extra properties THROUGH is neither.
    const hostile = JSON.stringify({
      mode: 'add',
      exercise: { ...CLEAN, id: 'attacker-id', sets: 'garbage', extra: { blob: true } },
    })
    const pick = parsePendingPick(hostile)
    expect(pick).not.toBeNull()
    // The returned exercise must be EXACTLY the declared PendingPickExercise
    // shape — no ride-along properties.
    expect(Object.keys(pick!.exercise).sort()).toEqual([
      'category',
      'name',
      'source',
      'wgerExerciseId',
    ])
  })

  it('ATTACK: a smuggled `id` must not override the fresh draft-exercise uuid (add path)', () => {
    // newDraftExercise mints `id: crypto.randomUUID()` AFTER spreading
    // `...picked`, so a hostile `id` riding the pick can never win — and the
    // parser strips it anyway (defense-in-depth).
    const pick = parsePendingPick(
      JSON.stringify({ mode: 'add', exercise: { ...CLEAN, id: 'attacker-id' } }),
    )
    expect(pick).not.toBeNull()
    const draft = newDraftExercise(pick!.exercise)
    expect(draft.id).not.toBe('attacker-id')
  })

  it('ATTACK: a smuggled NON-STRING `id` must not poison the draft (breaks server autosave)', () => {
    // Follow-on damage: isDraftPayload requires exercise.id to be a string,
    // so a numeric hostile id makes EVERY subsequent autosave of the session
    // fail server-side validation — draft-sync swallows the error, so the
    // cross-device draft silently stops updating.
    const pick = parsePendingPick(JSON.stringify({ mode: 'add', exercise: { ...CLEAN, id: 123 } }))
    expect(pick).not.toBeNull()
    const draft = newDraftExercise(pick!.exercise)
    const payload = buildDraftPayload({
      draft: { exercises: [draft], notes: '' },
      name: 'Session',
      unit: 'kg',
      openedAt: new Date('2026-01-01T10:00:00Z'),
    })
    expect(isDraftPayload(payload)).toBe(true)
  })

  it('ATTACK: swap path — a smuggled `id` equal to targetId collides with the replaced slot', () => {
    // replacementDraftExercise has the same id-before-spread ordering. If the
    // hostile pick carries id === the swap target's id, the replacement KEEPS
    // the old exercise's identity — undo-by-replacementId and the remember
    // prompt's replacementId matching can then act on the wrong node.
    const pick = parsePendingPick(
      JSON.stringify({
        mode: 'swap',
        targetId: 'ex-target',
        exercise: { ...CLEAN, id: 'ex-target' },
      }),
    )
    expect(pick).not.toBeNull()
    const replacement = replacementDraftExercise(pick!.exercise, 3)
    expect(replacement.id).not.toBe('ex-target')
  })

  it('no prototype pollution from a __proto__ payload', () => {
    const hostile = JSON.stringify({
      mode: 'add',
      exercise: { ...CLEAN, ['__proto__']: { polluted: true } },
    })
    const pick = parsePendingPick(hostile)
    // Whether or not the pick parses, Object.prototype must stay clean —
    // including after the draft-builder's object spread.
    if (pick) newDraftExercise(pick.exercise)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })

  it("mode 'add' with a contradictory targetId parses as a plain add (targetId dropped)", () => {
    const pick = parsePendingPick(JSON.stringify({ mode: 'add', targetId: 'ex-1', exercise: CLEAN }))
    expect(pick).toEqual({ mode: 'add', exercise: CLEAN })
    expect(pick && 'targetId' in pick).toBe(false)
  })

  it('rejects wrong-typed fields wholesale (no coercion)', () => {
    const bad = [
      { mode: 'swap', targetId: 7, exercise: CLEAN },
      { mode: 'swap', targetId: '', exercise: CLEAN },
      { mode: 'add', exercise: { ...CLEAN, wgerExerciseId: '42' } },
      { mode: 'add', exercise: { ...CLEAN, wgerExerciseId: 4.5 } },
      { mode: 'add', exercise: { ...CLEAN, wgerExerciseId: -1 } },
      { mode: 'add', exercise: { ...CLEAN, source: 'sqlinjection' } },
      { mode: 'add', exercise: { ...CLEAN, name: '' } },
      { mode: 'add', exercise: { ...CLEAN, name: 7 } },
      { mode: 'add', exercise: 'not-an-object' },
      { mode: 'replace', targetId: 'x', exercise: CLEAN },
      [CLEAN],
      'true',
      '42',
    ]
    for (const value of bad) {
      expect(parsePendingPick(JSON.stringify(value))).toBeNull()
    }
  })

  it('caps the name at 200 chars (mirrors workout-input MAX_NAME) — an oversized name is rejected wholesale', () => {
    // Without the cap, a multi-megabyte name would wedge every later autosave
    // against the 32KB server draft cap (draft-sync swallows the error, so the
    // cross-device draft silently stops updating).
    const atCap = 'A'.repeat(200)
    expect(
      parsePendingPick(JSON.stringify({ mode: 'add', exercise: { ...CLEAN, name: atCap } })),
    ).not.toBeNull()
    for (const name of ['A'.repeat(201), 'A'.repeat(1_000_000)]) {
      expect(
        parsePendingPick(JSON.stringify({ mode: 'add', exercise: { ...CLEAN, name } })),
      ).toBeNull()
    }
  })
})

describe('consumePendingPick — read-and-clear under hostile storage', () => {
  const store = new Map<string, string>()
  let removeThrows = false

  beforeEach(() => {
    store.clear()
    removeThrows = false
    ;(globalThis as Record<string, unknown>).window = {
      sessionStorage: {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => void store.set(key, value),
        removeItem: (key: string) => {
          if (removeThrows) throw new Error('denied')
          store.delete(key)
        },
      },
    }
  })

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).window
  })

  it('a poison (unparseable) payload is cleared BEFORE parsing — no wedge on every mount', () => {
    store.set(PENDING_PICK_KEY, '{"mode":') // malformed JSON
    expect(consumePendingPick()).toBeNull()
    // The poison must be gone: a second mount starts clean.
    expect(store.has(PENDING_PICK_KEY)).toBe(false)
    expect(consumePendingPick()).toBeNull()
  })

  it('a throwing removeItem degrades to null (no crash, no partial state)', () => {
    store.set(PENDING_PICK_KEY, JSON.stringify({ mode: 'add', exercise: CLEAN }))
    removeThrows = true
    expect(consumePendingPick()).toBeNull()
  })

  it('a valid instruction is returned exactly once', () => {
    store.set(PENDING_PICK_KEY, JSON.stringify({ mode: 'add', exercise: CLEAN }))
    expect(consumePendingPick()).toEqual({ mode: 'add', exercise: CLEAN })
    expect(consumePendingPick()).toBeNull()
  })
})

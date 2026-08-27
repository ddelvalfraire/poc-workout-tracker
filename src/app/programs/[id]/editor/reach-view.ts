import { kgToDisplay, type WeightUnit } from '@/lib/units'
import type { RawParam } from './editor-address'
import type { SourceSet } from './editor-view'

/**
 * "You changed a weight — how far should it reach?"
 *
 * Pure logic for the reach sheet, kept free of JSX like its siblings here.
 *
 * TWO SCOPES, NOT THREE, and the missing third one is why this module
 * documents itself at length. "This week onward" is not offered because it is
 * not EXPRESSIBLE: `programSetOverrides` is keyed `(program_set_id, week)` and
 * carries field values for ONE week, and nothing in the schema is week-RANGED
 * (docs/specs/per-week-set-count.md). Offering it would mean either writing a
 * pin into every remaining week — silently converting derived weeks into
 * authored ones the rule can no longer move — or inventing a range column.
 * Both are worse than saying two things truthfully.
 *
 * SET COUNT IS NOT A SCOPE EITHER. A pin holds field values, not cardinality,
 * and varying set count across a block is already the rule layer's job: the
 * deload policy's `setFactor`, or a `weekly-volume` progression's MEV→MRV ramp,
 * both applied in one place (`resizeWorkingSets`). A stored per-week count
 * would put a second, differently-grained answer beside two rules that already
 * speak. The sheet therefore routes that ask to the rule instead of growing an
 * option the storage cannot hold.
 *
 * THE EDIT HAS ALREADY HAPPENED. The day pane's set row posts a per-week
 * override and that write lands immediately; this sheet is the offer to WIDEN
 * it, never a confirmation gate in front of it. So "this week only" is the
 * do-nothing branch and it is the default — an edit someone already made is not
 * undone by their ignoring a sheet.
 *
 * NOTHING HERE PROJECTS A PROGRESSION. The week strips show the loads the plan
 * actually STORES — the template with each week's own pin laid over it — and
 * how those stored numbers move under each option. What a progression rule
 * would compute for week 5 belongs to the engine, and a second derivation that
 * disagreed with the instantiated session would be worse than no strip at all.
 */

/** Which of the two expressible scopes an option describes. */
export type ReachScope = 'week' | 'plan'

/** One week's number under one option. */
export interface ReachWeek {
  /** 1-based. */
  week: number
  /** The load in the user's display unit; null when the plan names none. */
  load: number | null
  /** True when choosing this option MOVES this week's number. */
  changes: boolean
  /**
   * True when this week's session is already settled.
   *
   * The number shown is still the PLAN's, and it is not what the user lifted —
   * that session's targets were frozen when it started. The flag exists so the
   * sheet can say so, rather than letting a template figure pass for a logged
   * one.
   */
  settled: boolean
}

/** The state the sheet needs about the set whose load moved. */
export interface ReachSubject {
  /** The set as stored, with its per-week override rows. */
  set: SourceSet
  /** The week the user was editing — the week now pinned. */
  week: number
}

/**
 * Whether there is anything to ask about, and what moved.
 *
 * The sheet appears only when the addressed week carries a pinned load that
 * DIFFERS from the template's. A pin equal to the rule reaches nowhere new, and
 * asking about it would be a sheet with no consequence — the fastest way to
 * teach someone to dismiss this one unread.
 */
export function reachDivergence(
  subject: ReachSubject,
): { fromKg: number | null; toKg: number } | null {
  const pinned = subject.set.overrides.find((row) => row.week === subject.week)
  if (pinned?.suggestedLoadKg == null) return null
  if (pinned.suggestedLoadKg === subject.set.suggestedLoadKg) return null
  return { fromKg: subject.set.suggestedLoadKg, toKg: pinned.suggestedLoadKg }
}

/** The load a week carries as things stand: its own pin, else the template. */
function currentKg(set: SourceSet, week: number): number | null {
  return set.overrides.find((row) => row.week === week)?.suggestedLoadKg ?? set.suggestedLoadKg
}

/**
 * The week strip for one option.
 *
 * 'week' is the state as it ALREADY stands, so the only week marked as changed
 * is the pinned one — that is the edit the user just made, and the strip's job
 * is to show it sitting alone.
 *
 * 'plan' moves the template, which every week without a pin of its own follows.
 * A week that has its own pin keeps its own number and is not marked: "pinned
 * weeks stay pinned even when you change the rule" is the one promise this
 * vocabulary makes on every surface, and the strip has to show it holding.
 */
export function reachWeeks(
  subject: ReachSubject,
  weeks: readonly number[],
  scope: ReachScope,
  settledWeeks: readonly number[],
  unit: WeightUnit,
): ReachWeek[] {
  const divergence = reachDivergence(subject)
  const settled = new Set(settledWeeks)

  return weeks.map((week) => {
    const current = currentKg(subject.set, week)
    const own = subject.set.overrides.find((row) => row.week === week)?.suggestedLoadKg ?? null

    const loadKg =
      scope === 'week' || divergence === null ? current : (own ?? divergence.toKg)

    return {
      week,
      load: loadKg === null ? null : kgToDisplay(loadKg, unit),
      changes:
        divergence === null
          ? false
          : scope === 'week'
            ? week === subject.week
            : loadKg !== current || week === subject.week,
      settled: settled.has(week),
    }
  })
}

/** Which set the sheet is about, within the day the address already names. */
export interface ReachTarget {
  /** 0-based exercise position. */
  exercise: number
  /** 1-based set number. */
  setNumber: number
}

/**
 * The set a `?reach=` param names, as `<exercise>.<setNumber>`.
 *
 * This lives here rather than in `./editor-address` because it is not part of
 * the ADDRESS: it selects nothing, it survives exactly one render, and the day
 * and week it is read against come from the real address beside it. Putting a
 * transient notice into the thing that answers "where am I" is how a Back press
 * starts reopening sheets.
 *
 * Junk resolves to null rather than throwing. Nothing downstream trusts the
 * result anyway — the sheet appears only when the named set turns out to carry
 * a load that really diverged, so a hand-typed param can at worst reopen a
 * question about an edit that was genuinely made.
 */
export function parseReachParam(raw: RawParam): ReachTarget | null {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === undefined) return null
  const match = /^(\d+)\.(\d+)$/.exec(value)
  if (match === null) return null
  const exercise = Number(match[1])
  const setNumber = Number(match[2])
  if (!Number.isSafeInteger(exercise) || !Number.isSafeInteger(setNumber)) return null
  return setNumber < 1 ? null : { exercise, setNumber }
}

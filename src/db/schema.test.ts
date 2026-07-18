import { describe, it, expect } from 'vitest'
import { getTableName, getTableColumns } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  workouts,
  workoutExercises,
  sets,
  programs,
  programDays,
  programExercises,
  programSets,
  programExerciseMuscles,
  programSetOverrides,
  customExercises,
  programEvents,
} from './schema'

describe('schema', () => {
  it('defines the three workout tables with snake_case names', () => {
    expect(getTableName(workouts)).toBe('workouts')
    expect(getTableName(workoutExercises)).toBe('workout_exercises')
    expect(getTableName(sets)).toBe('sets')
  })

  it('marks sets.completed as non-null', () => {
    expect(getTableColumns(sets).completed.notNull).toBe(true)
  })

  it('makes the autoregulation switch additive on programs (non-null, default true)', () => {
    const cols = getTableColumns(programs)
    expect(cols.autoregulation.notNull).toBe(true)
    expect(cols.autoregulation.hasDefault).toBe(true)
  })

  it('defines the four program tables with snake_case names', () => {
    expect(getTableName(programs)).toBe('programs')
    expect(getTableName(programDays)).toBe('program_days')
    expect(getTableName(programExercises)).toBe('program_exercises')
    expect(getTableName(programSets)).toBe('program_sets')
  })

  it('makes the metric model additive on live sets (non-null, defaulted)', () => {
    const cols = getTableColumns(sets)
    expect(cols.metricMode.notNull).toBe(true)
    expect(cols.metricMode.hasDefault).toBe(true)
    expect(cols.durationSec.notNull).toBe(false)
    expect(cols.distanceM.notNull).toBe(false)
  })

  it('makes the warm-up tag additive on live sets (non-null, defaulted)', () => {
    const setType = getTableColumns(sets).setType
    expect(setType.notNull).toBe(true)
    expect(setType.hasDefault).toBe(true)
  })

  it('makes the prescribed-at-instantiation snapshot additive on live sets (nullable, no default)', () => {
    const cols = getTableColumns(sets)
    expect(cols.prescribedLoadKg.notNull).toBe(false)
    expect(cols.prescribedRepMin.notNull).toBe(false)
    // No default: pre-snapshot rows stay null forever (unscorable by design).
    expect(cols.prescribedLoadKg.hasDefault).toBe(false)
    expect(cols.prescribedRepMin.hasDefault).toBe(false)
  })

  it('makes workout provenance columns nullable', () => {
    const cols = getTableColumns(workouts)
    expect(cols.programDayId.notNull).toBe(false)
    expect(cols.programWeek.notNull).toBe(false)
  })

  it('guards ordering uniqueness on every position-addressed program table', () => {
    // Concurrent appends read max(position) then insert; without these unique
    // constraints two racers could land at the same position and make the
    // position-addressed patch ops ambiguous.
    const dayUniques = getTableConfig(programDays).uniqueConstraints
    expect(dayUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'position',
      'program_id',
    ])

    const exerciseUniques = getTableConfig(programExercises).uniqueConstraints
    expect(exerciseUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'position',
      'program_day_id',
    ])

    const setUniques = getTableConfig(programSets).uniqueConstraints
    expect(setUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'program_exercise_id',
      'set_number',
    ])
  })

  it('defines the Phase-5 tables with snake_case names', () => {
    expect(getTableName(programExerciseMuscles)).toBe('program_exercise_muscles')
    expect(getTableName(programSetOverrides)).toBe('program_set_overrides')
  })

  it('keys muscle rows and overrides uniquely per parent', () => {
    const muscleUniques = getTableConfig(programExerciseMuscles).uniqueConstraints
    expect(muscleUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'muscle',
      'program_exercise_id',
    ])

    const overrideUniques = getTableConfig(programSetOverrides).uniqueConstraints
    expect(overrideUniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'program_set_id',
      'week',
    ])
  })

  it('keeps every override target column nullable (null = not overridden)', () => {
    const cols = getTableColumns(programSetOverrides)
    for (const key of [
      'repMin',
      'repMax',
      'rir',
      'rpe',
      'suggestedLoadKg',
      'tempo',
      'durationSec',
      'distanceM',
      'technique',
    ] as const) {
      expect(cols[key].notNull).toBe(false)
    }
    expect(cols.week.notNull).toBe(true)
  })

  it('makes superset grouping optional on program exercises', () => {
    expect(getTableColumns(programExercises).supersetGroup.notNull).toBe(false)
  })

  it('defaults program_sets.set_type and metric_mode (non-null)', () => {
    const cols = getTableColumns(programSets)
    expect(cols.setType.notNull).toBe(true)
    expect(cols.setType.hasDefault).toBe(true)
    expect(cols.metricMode.notNull).toBe(true)
    expect(cols.metricMode.hasDefault).toBe(true)
  })

  it('defines the custom exercise catalog with snake_case name', () => {
    expect(getTableName(customExercises)).toBe('custom_exercises')
  })

  it('gives custom_exercises an integer identity id', () => {
    const id = getTableColumns(customExercises).id
    expect(id.dataType).toBe('number')
    // Identity (not a computed column): drizzle exposes it as generatedIdentity.
    expect(id.generatedIdentity).toMatchObject({ type: 'always' })
  })

  it('requires ownership and definition fields on custom_exercises', () => {
    const cols = getTableColumns(customExercises)
    expect(cols.userId.notNull).toBe(true)
    expect(cols.name.notNull).toBe(true)
    expect(cols.category.notNull).toBe(true)
    // Parity arrays stay nullable — a definition without tags is valid.
    expect(cols.equipment.notNull).toBe(false)
    expect(cols.muscles.notNull).toBe(false)
    expect(cols.musclesSecondary.notNull).toBe(false)
  })

  it('keys custom exercises uniquely per (user, name)', () => {
    const uniques = getTableConfig(customExercises).uniqueConstraints
    expect(uniques.map((u) => u.columns.map((c) => c.name).sort())).toContainEqual([
      'name',
      'user_id',
    ])
  })

  it('makes the source discriminator additive on both exercise ref tables (non-null, defaulted)', () => {
    for (const table of [workoutExercises, programExercises]) {
      const source = getTableColumns(table).source
      expect(source.notNull).toBe(true)
      expect(source.hasDefault).toBe(true)
    }
  })

  it('forbids the negative-ID stopgap via check constraints on both ref tables', () => {
    expect(getTableConfig(workoutExercises).checks.map((c) => c.name)).toContain(
      'workout_exercises_wger_id_positive',
    )
    expect(getTableConfig(programExercises).checks.map((c) => c.name)).toContain(
      'program_exercises_wger_id_positive',
    )
  })

  it('defines the program change log with snake_case name', () => {
    expect(getTableName(programEvents)).toBe('program_events')
  })

  it('requires every fact column on program_events (payload alone is optional)', () => {
    const cols = getTableColumns(programEvents)
    expect(cols.programId.notNull).toBe(true)
    expect(cols.userId.notNull).toBe(true)
    expect(cols.occurredAt.notNull).toBe(true)
    expect(cols.occurredAt.hasDefault).toBe(true)
    expect(cols.actor.notNull).toBe(true)
    expect(cols.action.notNull).toBe(true)
    expect(cols.summary.notNull).toBe(true)
    expect(cols.payload.notNull).toBe(false)
  })

  it('indexes program_events on (program_id, occurred_at) — the only read path', () => {
    const indexes = getTableConfig(programEvents).indexes
    expect(
      indexes.map((i) => i.config.columns.map((c) => ('name' in c ? c.name : ''))),
    ).toContainEqual(['program_id', 'occurred_at'])
  })
})

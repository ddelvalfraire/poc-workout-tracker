import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { Technique, Progression } from '@/lib/program-input'

export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // Clerk user id, e.g. "user_2abc..."
    name: text('name'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Provenance: when this workout was instantiated from a program day. SET NULL
    // (not cascade) so editing/deleting a plan never destroys logged history.
    programDayId: uuid('program_day_id').references(() => programDays.id, {
      onDelete: 'set null',
    }),
    // 1-based week within the program's mesocycle this session belongs to.
    programWeek: integer('program_week'),
  },
  (t) => [index('workouts_user_id_idx').on(t.userId)],
)

export const workoutExercises = pgTable('workout_exercises', {
  id: uuid('id').defaultRandom().primaryKey(),
  workoutId: uuid('workout_id')
    .notNull()
    .references(() => workouts.id, { onDelete: 'cascade' }),
  wgerExerciseId: integer('wger_exercise_id').notNull(),
  name: text('name').notNull(), // denormalized from wger
  position: integer('position').notNull().default(0),
})

export const sets = pgTable(
  'sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workoutExerciseId: uuid('workout_exercise_id')
      .notNull()
      .references(() => workoutExercises.id, { onDelete: 'cascade' }),
    setNumber: integer('set_number').notNull(),
    reps: integer('reps'),
    // numeric (not float) so fractional plate weights (e.g. 2.5 kg) stay exact
    weight: numeric('weight', { precision: 6, scale: 2, mode: 'number' }), // kg
    completed: boolean('completed').notNull().default(false),
    // Metric model (timed exercises). Additive + defaulted so existing rows and
    // the reps_weight logging path are unaffected; e1RM applies only to reps_weight.
    metricMode: text('metric_mode').notNull().default('reps_weight'),
    durationSec: integer('duration_sec'),
    distanceM: numeric('distance_m', { precision: 9, scale: 2, mode: 'number' }), // meters
  },
  // setNumber is 1-based contiguous per exercise. This guard stops two concurrent
  // add_set calls from both inserting the same number (the read-max/insert race).
  // The migration makes it DEFERRABLE INITIALLY DEFERRED so removeSet's in-place
  // decrement-renumber — which transiently collides mid-statement — still commits.
  (t) => [unique('sets_exercise_set_number_unique').on(t.workoutExerciseId, t.setNumber)],
)

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey(), // Clerk user id; one row per user
  unit: text('unit').notNull().default('lb'), // weight display unit: 'kg' | 'lb'; product default lb
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const workoutsRelations = relations(workouts, ({ many }) => ({
  exercises: many(workoutExercises),
}))

export const workoutExercisesRelations = relations(workoutExercises, ({ one, many }) => ({
  workout: one(workouts, {
    fields: [workoutExercises.workoutId],
    references: [workouts.id],
  }),
  sets: many(sets),
}))

export const setsRelations = relations(sets, ({ one }) => ({
  workoutExercise: one(workoutExercises, {
    fields: [sets.workoutExerciseId],
    references: [workoutExercises.id],
  }),
}))

/**
 * Programs — a first-class, reusable training plan. This tree
 * (programs → program_days → program_exercises → program_sets) is a structural
 * twin of the workout tree so instantiation (Phase 3) is a near 1:1 row copy.
 * `programs` is the ownership root (user_id), exactly like `workouts`.
 */
export const programs = pgTable(
  'programs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // Clerk user id
    name: text('name').notNull(),
    status: text('status').notNull().default('draft'), // 'draft' | 'active' | 'archived'
    mesocycleWeeks: integer('mesocycle_weeks').notNull().default(1),
    deloadWeek: integer('deload_week'), // 1-based week that deloads; null = none
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('programs_user_id_idx').on(t.userId)],
)

export const programDays = pgTable(
  'program_days',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0), // 0-based order
    notes: text('notes'),
  },
  // 0-based contiguous per program — guards the read-max-then-insert append and
  // the position-addressed patch ops against racing duplicates. DEFERRABLE
  // INITIALLY DEFERRED (hand-edited migration, same as program_sets) so the
  // Phase-4 move splice-renumber, which transiently collides, still commits.
  (t) => [unique('program_days_program_position_unique').on(t.programId, t.position)],
)

export const programExercises = pgTable(
  'program_exercises',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programDayId: uuid('program_day_id')
      .notNull()
      .references(() => programDays.id, { onDelete: 'cascade' }),
    wgerExerciseId: integer('wger_exercise_id').notNull(),
    name: text('name').notNull(), // denormalized from wger
    position: integer('position').notNull().default(0),
    // Narrow JSONB tail: per-exercise progression scheme params (Phase 5 engine
    // consumes it). Validated/typed by `progressionSchema` at the boundary.
    progression: jsonb('progression').$type<Progression>(),
  },
  // Same rationale (and deferral) as program_days' position unique above.
  (t) => [unique('program_exercises_day_position_unique').on(t.programDayId, t.position)],
)

export const programSets = pgTable(
  'program_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programExerciseId: uuid('program_exercise_id')
      .notNull()
      .references(() => programExercises.id, { onDelete: 'cascade' }),
    setNumber: integer('set_number').notNull(), // 1-based
    setType: text('set_type').notNull().default('working'), // warmup|working|backoff|amrap
    metricMode: text('metric_mode').notNull().default('reps_weight'), // reps_weight|duration|duration_distance
    repMin: integer('rep_min'),
    repMax: integer('rep_max'),
    rir: integer('rir'), // reps in reserve
    rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
    suggestedLoadKg: numeric('suggested_load_kg', { precision: 6, scale: 2, mode: 'number' }), // kg
    tempo: text('tempo'),
    durationSec: integer('duration_sec'),
    distanceM: numeric('distance_m', { precision: 9, scale: 2, mode: 'number' }), // meters
    // Narrow JSONB tail: unified intensity-technique stages (drop/rest-pause/myo/cluster).
    technique: jsonb('technique').$type<Technique>(),
  },
  // Mirrors `sets`: 1-based contiguous per exercise. The migration makes this
  // DEFERRABLE INITIALLY DEFERRED so a future in-place renumber (Phase 4
  // reorder/remove) that transiently collides still commits.
  (t) => [unique('program_sets_exercise_set_number_unique').on(t.programExerciseId, t.setNumber)],
)

export const programsRelations = relations(programs, ({ many }) => ({
  days: many(programDays),
}))

export const programDaysRelations = relations(programDays, ({ one, many }) => ({
  program: one(programs, {
    fields: [programDays.programId],
    references: [programs.id],
  }),
  exercises: many(programExercises),
}))

export const programExercisesRelations = relations(programExercises, ({ one, many }) => ({
  day: one(programDays, {
    fields: [programExercises.programDayId],
    references: [programDays.id],
  }),
  sets: many(programSets),
}))

export const programSetsRelations = relations(programSets, ({ one }) => ({
  exercise: one(programExercises, {
    fields: [programSets.programExerciseId],
    references: [programExercises.id],
  }),
}))

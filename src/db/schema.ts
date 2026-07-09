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
  check,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import type { Technique, Progression, SetType, MetricMode } from '@/lib/program-input'
import type { ExerciseSource, ExerciseCategory } from '@/lib/custom-exercise-input'
import type { LoggingType } from '@/lib/workout-input'

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

export const workoutExercises = pgTable(
  'workout_exercises',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    // Exercise ref, always positive (CHECK). Holds a custom_exercises.id when
    // source = 'custom' — the column name is historical; kept to avoid a rename
    // across every query site.
    wgerExerciseId: integer('wger_exercise_id').notNull(),
    // 'wger' | 'custom' — exercise identity is the composite (source, id).
    source: text('source').$type<ExerciseSource>().notNull().default('wger'),
    name: text('name').notNull(), // denormalized from wger
    position: integer('position').notNull().default(0),
    // How this exercise's sets read their `weight` column (Hevy-style):
    // total load / ignored / added to bodyweight / subtracted assistance.
    // Additive + defaulted so every existing row stays a plain weight×reps
    // exercise. Text + app-level enum, like `source` and `set_type`.
    loggingType: text('logging_type').$type<LoggingType>().notNull().default('weight_reps'),
  },
  // The durable kill for the spike's negative-ID stopgap: customs live in
  // custom_exercises with the source discriminator, never as sign-bit tricks.
  (t) => [check('workout_exercises_wger_id_positive', sql`${t.wgerExerciseId} > 0`)],
)

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
  // Plate-calculator gear ({ unit, bars, plates } — see lib/equipment.ts).
  // Nullable: readers default per unit; stored unit-native, never converted.
  equipment: jsonb('equipment'),
  // The user's bodyweight in canonical kg — the load basis for bodyweight
  // logging types. Nullable: unset means bodyweight exercises score by reps
  // instead of estimated 1RM. numeric(5,2) caps at 999.99 kg; the action
  // boundary enforces a tighter 500 kg sanity ceiling.
  bodyweightKg: numeric('bodyweight_kg', { precision: 5, scale: 2, mode: 'number' }),
  // The user's fallback rest target in seconds — what the logger counts down
  // for ad-hoc sets and for program sets with no per-set restSec. Nullable:
  // null means no target, so the rest readout stays a plain count-up. The
  // action boundary enforces the 0..3600 range; reads still guard stored data.
  defaultRestSec: integer('default_rest_sec'),
  // Feature switch for the whole rest-timer surface: off means no rest
  // readout at all (no countdown, no count-up) and per-set plan targets are
  // ignored. Default ON — the timer is the feature's normal state; the
  // switch exists for lifters who find any clock a distraction.
  restTimerEnabled: boolean('rest_timer_enabled').notNull().default(true),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * In-progress workout drafts, synced across devices — the logger autosaves
 * here and restores on mount, so a session started on one device can be
 * finished on another. One row per logging surface: `key` is 'new' for
 * /workout/new or the workout uuid for edit mode (plain text, not a FK — the
 * 'new' sentinel shares the column, and a draft must never block workout
 * deletion). `payload` is the client draft snapshot ({ v, unit, name,
 * openedAt, draft }); it is untrusted and re-validated by the client codec on
 * read. Rows are short-lived: deleted on save, expired by TTL on read.
 */
export const workoutDrafts = pgTable(
  'workout_drafts',
  {
    userId: text('user_id').notNull(), // Clerk user id — ownership root
    key: text('key').notNull(), // 'new' | workout uuid
    payload: jsonb('payload').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
)

/**
 * Per-user custom exercise catalog — movements wger lacks, with app-side wger
 * parity (the `Exercise` shape in `lib/wger.ts`). Integer identity PK because
 * the exercise ref columns are integers; identity is the composite
 * (source, id), so numeric collision with wger ids is fine. Muscles/equipment
 * are text[] (not child rows) because this is catalog/definition data nothing
 * aggregates over — contrast with `program_exercise_muscles`, which stays the
 * aggregation surface and is fed FROM these arrays at author time (Phase 3).
 */
export const customExercises = pgTable(
  'custom_exercises',
  {
    id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id').notNull(), // Clerk user id — ownership root, like `workouts`/`programs`
    name: text('name').notNull(),
    category: text('category').$type<ExerciseCategory>().notNull(), // wger's fixed 8-category set, enforced at the input boundary
    equipment: text('equipment').array(),
    muscles: text('muscles').array(), // primary muscles, wger English names
    musclesSecondary: text('muscles_secondary').array(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('custom_exercises_user_id_idx').on(t.userId),
    // Guards accidental duplicates from repeated create calls. Exact-match only.
    unique('custom_exercises_user_name_unique').on(t.userId, t.name),
  ],
)

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
    // Exercise ref, always positive (CHECK). Holds a custom_exercises.id when
    // source = 'custom' — the column name is historical; kept to avoid a rename
    // across every query site.
    wgerExerciseId: integer('wger_exercise_id').notNull(),
    // 'wger' | 'custom' — exercise identity is the composite (source, id).
    source: text('source').$type<ExerciseSource>().notNull().default('wger'),
    name: text('name').notNull(), // denormalized from wger
    position: integer('position').notNull().default(0),
    // Same non-null value within a day = perform those exercises as a superset.
    supersetGroup: integer('superset_group'),
    // Narrow JSONB tail: per-exercise progression scheme params (Phase 5 engine
    // consumes it). Validated/typed by `progressionSchema` at the boundary.
    progression: jsonb('progression').$type<Progression>(),
  },
  // Same rationale (and deferral) as program_days' position unique above.
  (t) => [
    unique('program_exercises_day_position_unique').on(t.programDayId, t.position),
    // Same negative-ID kill as workout_exercises.
    check('program_exercises_wger_id_positive', sql`${t.wgerExerciseId} > 0`),
  ],
)

export const programSets = pgTable(
  'program_sets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programExerciseId: uuid('program_exercise_id')
      .notNull()
      .references(() => programExercises.id, { onDelete: 'cascade' }),
    setNumber: integer('set_number').notNull(), // 1-based
    setType: text('set_type').$type<SetType>().notNull().default('working'), // warmup|working|backoff|amrap
    metricMode: text('metric_mode').$type<MetricMode>().notNull().default('reps_weight'), // reps_weight|duration|duration_distance
    repMin: integer('rep_min'),
    repMax: integer('rep_max'),
    rir: integer('rir'), // reps in reserve
    rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
    suggestedLoadKg: numeric('suggested_load_kg', { precision: 6, scale: 2, mode: 'number' }), // kg
    tempo: text('tempo'),
    durationSec: integer('duration_sec'),
    distanceM: numeric('distance_m', { precision: 9, scale: 2, mode: 'number' }), // meters
    // Seconds of rest AFTER this set — per-set granularity, the finest the
    // tree offers ("per exercise per set"). Distinct concern from the
    // technique JSONB's restSec, which is INTRA-set pause between stages.
    // Nullable: null = no prescribed target (the logger falls back to the
    // user's session default, then to a plain count-up).
    restSec: integer('rest_sec'),
    // Narrow JSONB tail: unified intensity-technique stages (drop/rest-pause/myo/cluster).
    technique: jsonb('technique').$type<Technique>(),
  },
  // Mirrors `sets`: 1-based contiguous per exercise. The migration makes this
  // DEFERRABLE INITIALLY DEFERRED so a future in-place renumber (Phase 4
  // reorder/remove) that transiently collides still commits.
  (t) => [unique('program_sets_exercise_set_number_unique').on(t.programExerciseId, t.setNumber)],
)

/**
 * Muscles an exercise slot trains, denormalized from wger's muscles arrays at
 * author time (Phase 5). A relation — not JSONB — because weekly volume
 * aggregates over it (the PRD's column-vs-JSON boundary rule). `muscle` is
 * wger's English name; `role` is 'primary' | 'secondary' (text + app-level
 * enum, like set_type). Tag rows are enrichment: a save without catalog access
 * simply leaves an exercise untagged.
 */
export const programExerciseMuscles = pgTable(
  'program_exercise_muscles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programExerciseId: uuid('program_exercise_id')
      .notNull()
      .references(() => programExercises.id, { onDelete: 'cascade' }),
    muscle: text('muscle').notNull(),
    role: text('role').notNull(), // 'primary' | 'secondary'
  },
  (t) => [
    unique('program_exercise_muscles_unique').on(t.programExerciseId, t.muscle),
    index('program_exercise_muscles_exercise_idx').on(t.programExerciseId),
  ],
)

/**
 * Per-week explicit targets for one planned set — the escape hatch for block/
 * undulating models the derived-progression engine can't express. A non-null
 * column here WINS over the engine (and the deload modifier) for that week;
 * null means "not overridden". `setType`/`metricMode` are deliberately absent:
 * changing a set's shape is an edit, not a week override.
 */
export const programSetOverrides = pgTable(
  'program_set_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programSetId: uuid('program_set_id')
      .notNull()
      .references(() => programSets.id, { onDelete: 'cascade' }),
    week: integer('week').notNull(), // 1-based week within the mesocycle
    repMin: integer('rep_min'),
    repMax: integer('rep_max'),
    rir: integer('rir'),
    rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
    suggestedLoadKg: numeric('suggested_load_kg', { precision: 6, scale: 2, mode: 'number' }), // kg
    tempo: text('tempo'),
    durationSec: integer('duration_sec'),
    distanceM: numeric('distance_m', { precision: 9, scale: 2, mode: 'number' }), // meters
    // Per-week rest-after-set override: non-null WINS over the base set's
    // restSec for that week, mirroring every other override column here.
    restSec: integer('rest_sec'),
    technique: jsonb('technique').$type<Technique>(),
  },
  (t) => [unique('program_set_overrides_set_week_unique').on(t.programSetId, t.week)],
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
  muscles: many(programExerciseMuscles),
}))

export const programExerciseMusclesRelations = relations(programExerciseMuscles, ({ one }) => ({
  exercise: one(programExercises, {
    fields: [programExerciseMuscles.programExerciseId],
    references: [programExercises.id],
  }),
}))

export const programSetOverridesRelations = relations(programSetOverrides, ({ one }) => ({
  set: one(programSets, {
    fields: [programSetOverrides.programSetId],
    references: [programSets.id],
  }),
}))

export const programSetsRelations = relations(programSets, ({ one, many }) => ({
  exercise: one(programExercises, {
    fields: [programSets.programExerciseId],
    references: [programExercises.id],
  }),
  overrides: many(programSetOverrides),
}))

import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  index,
  unique,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // Clerk user id, e.g. "user_2abc..."
    name: text('name'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
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

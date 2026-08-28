import {
  pgTable,
  uuid,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  date,
  index,
  unique,
  uniqueIndex,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations, sql } from 'drizzle-orm'
import type {
  Technique,
  Progression,
  SetType,
  MetricMode,
  ProgramVisibility,
  DeloadPolicy,
  DietPhase,
} from '@/lib/program-input'
import type { AutoregStallPolicy } from '@/lib/autoregulate'
import type { OvershootPolicy } from '@/lib/overshoot-policy'
import type { ExerciseSource, ExerciseCategory } from '@/lib/custom-exercise-input'
import type { LoggingType } from '@/lib/workout-input'
import type { MeasurementSite } from '@/lib/measurement-sites'
import type { PhotoPose } from '@/lib/photo-input'
import type { GoalKind, GoalTarget } from '@/lib/goal-input'
import type { TrophyKind, TrophyContext } from '@/lib/trophy-kinds'
import type { NoteAuthor, NoteAnchorSnapshot } from '@/lib/note-input'
import type { Tier, GrantSource, GrantStatus } from '@/lib/entitlements/tiers'

export const workouts = pgTable(
  'workouts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id, e.g. "user_01JXYZ..."
    name: text('name'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    // When this session's ORIGINAL record was persisted by a session-scoped
    // write (saveWorkout, or updateWorkout's first full persist of an
    // instantiated shell). Null means the session has never been recorded as
    // a whole — it is still being logged.
    //
    // This exists BECAUSE `completedAt` cannot answer that question. The MCP
    // patch tools stamp `completedAt` via coalesce(…, now()) on the first set
    // they touch, so a coach patching one set of a LIVE session flips it
    // non-null; a surface reading `completedAt` would then call that session's
    // real first persist a correction. Set-level writes never touch this
    // column, and `uncompleteWorkout` never clears it — an original record
    // that happened stays happened.
    originalRecordedAt: timestamp('original_recorded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Provenance: when this workout was instantiated from a program day. SET NULL
    // (not cascade) so editing/deleting a plan never destroys logged history.
    // This is the LIVE link every read joins on, and it is only as durable as
    // the row it points at — `updateProgram`'s full replace drops and recreates
    // every day, so the column is re-attached from `programDaySlotKey` below,
    // inside the same transaction that nulled it.
    programDayId: uuid('program_day_id').references(() => programDays.id, {
      onDelete: 'set null',
    }),
    // 1-based week within the program's mesocycle this session belongs to.
    programWeek: integer('program_week'),
    // Durable provenance: the SLOT this session was trained from, which
    // outlives the `program_days` row (`programDays.slotKey`). Deliberately no
    // FK — a foreign key would be nulled by the very delete this column exists
    // to survive, and the slot is a logical identity, not a row reference.
    // Null on rows written before the slot key existed, and on ad-hoc sessions.
    programDaySlotKey: uuid('program_day_slot_key'),
    // Frozen plan facts, stamped at instantiation and NEVER updated: what the
    // day was called and where it sat in the week AT THE TIME IT WAS TRAINED.
    // Facts of the session, like `sets.prescribedLoadKg` — so a log surface can
    // still name what was trained after the day is genuinely deleted, and does
    // not silently re-label old history when the plan is renamed. Null on
    // ad-hoc sessions and on rows written before these columns existed (never
    // backfilled: today's day name is not evidence of yesterday's).
    programDayName: text('program_day_name'),
    programDayPosition: integer('program_day_position'),
    // Free-form session note. Nullable: null = no note, same as programs.notes.
    notes: text('notes'),
    // Provenance: which history import created this workout. SET NULL (not
    // cascade) mirrors programDayId — undo deletes the batch's workouts
    // EXPLICITLY (db/import.ts) and then the batch row; a dangling batch
    // delete must never destroy history on its own.
    importBatchId: uuid('import_batch_id').references(() => importBatches.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('workouts_user_id_idx').on(t.userId),
    // Drives the post-replace re-attach in `updateProgram`.
    index('workouts_program_day_slot_key_idx').on(t.programDaySlotKey),
  ],
)

/**
 * One row per confirmed history import (Strong/Hevy CSV). The batch is the
 * undo handle: "Remove this import" deletes the workouts stamped with this
 * id, then this row. Counts are the COMMITTED numbers (duplicates already
 * skipped) — facts about what landed, recorded once, never re-derived.
 * Custom exercises created by an import are deliberately NOT tracked here:
 * undo leaves them in place (deleting could orphan re-logged history).
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    source: text('source').$type<'strong' | 'hevy'>().notNull(),
    fileName: text('file_name'), // nullable — uploads may carry no name
    workoutCount: integer('workout_count').notNull(),
    setCount: integer('set_count').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('import_batches_user_id_idx').on(t.userId)],
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
    // Free-form per-exercise note. Nullable: null = no note.
    notes: text('notes'),
    // Marked skipped in-session ("couldn't do this today"). Additive +
    // defaulted so every existing row stays a performed exercise. Skipping
    // never touches the sets — they stay uncompleted, and completed-only
    // counting already keeps them out of stats.
    skipped: boolean('skipped').notNull().default(false),
  },
  // The durable kill for the spike's negative-ID stopgap: customs live in
  // custom_exercises with the source discriminator, never as sign-bit tricks.
  (t) => [
    check('workout_exercises_wger_id_positive', sql`${t.wgerExerciseId} > 0`),
    // Exercise-first access path (all-time exercise stats): the other queries
    // reach this table workout-first via the workouts.user_id index.
    index('workout_exercises_exercise_idx').on(t.wgerExerciseId, t.source),
  ],
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
    // Set-role tag. Additive + defaulted so every existing row stays a working
    // set. Full program_sets.set_type range: instantiation forwards the
    // prescription's type so backoff/amrap rows never masquerade as working
    // sets to the auto-regulation stall rules.
    setType: text('set_type').$type<SetType>().notNull().default('working'),
    // Prescribed-at-instantiation snapshot (immutable facts — no edit path may
    // update them): the derived load and rep floor this set was seeded with.
    // Null on ad-hoc sets and all pre-snapshot history; such sets are
    // unscorable by the auto-regulation engine, by design.
    prescribedLoadKg: numeric('prescribed_load_kg', { precision: 6, scale: 2, mode: 'number' }),
    prescribedRepMin: integer('prescribed_rep_min'),
    // Logged effort, opt-in (RPE/RIR §2): BOTH scales stored, never converted
    // (half-point RPE straddles RIR integers). Null = not logged — skipping
    // by ignoring the chip row is the designed common case.
    rir: integer('rir'),
    rpe: numeric('rpe', { precision: 3, scale: 1, mode: 'number' }),
    // Prescribed-at-instantiation effort snapshot, same immutability contract
    // as prescribed_load_kg/prescribed_rep_min above: the target this set was
    // seeded with (program_sets.rir/rpe through the week derivation). Null on
    // ad-hoc sets and all pre-snapshot history.
    prescribedRir: integer('prescribed_rir'),
    prescribedRpe: numeric('prescribed_rpe', { precision: 3, scale: 1, mode: 'number' }),
    // Metric model (timed exercises). Additive + defaulted so existing rows and
    // the reps_weight logging path are unaffected; e1RM applies only to reps_weight.
    // $type'd like `program_sets.metric_mode`: the column held the same union
    // all along, and leaving it bare `string` here forced every reader to
    // re-narrow DB text it had already constrained on write.
    metricMode: text('metric_mode').$type<MetricMode>().notNull().default('reps_weight'),
    durationSec: integer('duration_sec'),
    distanceM: numeric('distance_m', { precision: 9, scale: 2, mode: 'number' }), // meters
    // Intensity-technique grouping (lib/technique.ts, "Model A"): a drop-set /
    // rest-pause / myo-reps / cluster set is N ROWS, not nested JSON, so most
    // row-reading consumers (e1RM, best-set, plan-sync) keep working
    // untouched; the two that must NOT treat a stage as an ordinary set say
    // so explicitly — the autoreg stall rules exclude the whole group
    // (db/autoreg-history.ts) and weekly volume weights it (db/muscle-volume.ts).
    // All three columns are nullable and absent on an ordinary set — a
    // technique row is the exception, never the default. `technique_group` is
    // equal across one technique set's rows and unique within the exercise;
    // `stage_index` is 0-based (0 = the top / activation set). Text +
    // app-level union like `set_type`.
    techniqueKind: text('technique_kind').$type<Technique['kind']>(),
    techniqueGroup: text('technique_group'),
    stageIndex: integer('stage_index'),
  },
  // setNumber is 1-based contiguous per exercise. This guard stops two concurrent
  // add_set calls from both inserting the same number (the read-max/insert race).
  // The migration makes it DEFERRABLE INITIALLY DEFERRED so removeSet's in-place
  // decrement-renumber — which transiently collides mid-statement — still commits.
  (t) => [
    unique('sets_exercise_set_number_unique').on(t.workoutExerciseId, t.setNumber),
    // The technique triple is all-or-nothing. Every WRITE path already treats
    // it that way (updateWorkout spreads all three or none; instantiation
    // stamps all three from one `techniqueStage`), but without the constraint
    // a partial row was legal — and its two readers disagreed about it:
    // `rowTechnique` (db/muscle-volume.ts) needs only kind+stageIndex and
    // would weight a group-less row 0.5, while `detailToDraft` requires all
    // three and degrades the same row to an ordinary set worth 1.0. Same row,
    // two answers. The constraint makes the shape the DB's guarantee, the way
    // `notes_exactly_one_anchor` does for the note anchors.
    check(
      'sets_technique_all_or_none',
      sql`num_nonnulls(${t.techniqueKind}, ${t.techniqueGroup}, ${t.stageIndex}) in (0, 3)`,
    ),
  ],
)

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey(), // WorkOS user id; one row per user
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
  // The lifter's ± step for the weight field, stored UNIT-NATIVE and never
  // converted: 2.5 means 2.5 kg to a kg user and 2.5 lb to an lb user. Null
  // means "use the unit default" (WEIGHT_STEP). Readers run it through
  // resolveWeightStep, which also drops a value the current unit does not
  // offer — so switching kg→lb falls back to the lb default instead of
  // inheriting a kg number.
  weightStep: numeric('weight_step', { precision: 5, scale: 2, mode: 'number' }),
  // Feature switch for the whole rest-timer surface: off means no rest
  // readout at all (no countdown, no count-up) and per-set plan targets are
  // ignored. Default ON — the timer is the feature's normal state; the
  // switch exists for lifters who find any clock a distraction.
  restTimerEnabled: boolean('rest_timer_enabled').notNull().default(true),
  // Home section layout ({ version: 1, sections: [{ kind, hidden? }] } — see
  // lib/home/layout.ts). Nullable: null means the code-defined default order,
  // which is also what "Reset to default" writes. Readers zod-guard the shape
  // and degrade to the default on any corruption.
  homeLayout: jsonb('home_layout'),
  // Home-page "train with a plan" nudge, dismissed. Stored as DISMISSED (not
  // "enabled") so the false default means every user starts with the reminder
  // visible; only an explicit dismissal — card or settings toggle — hides it.
  programReminderDismissed: boolean('program_reminder_dismissed').notNull().default(false),
  // Opt-in switch for RPE/RIR effort logging on EVERY set (the show rule's
  // preference arm; sets with a prescribed effort target show the row
  // regardless). Default OFF — effort logging must never tax a lifter who
  // didn't ask for it.
  rpeLoggingEnabled: boolean('rpe_logging_enabled').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * Bodyweight measurement history — one row per weigh-in. This table is the
 * record; `user_preferences.bodyweight_kg` stays the CURRENT value that
 * scoring reads (denormalized on purpose: e1RM for bodyweight-type exercises
 * keeps its single read path, and the data layer resyncs it to the freshest
 * log row on every log write/delete). `weighed_at` is when the measurement
 * was taken (defaults to now; backdated entries are allowed and must not
 * clobber the current value — see db/bodyweight.ts).
 */
export const bodyweightLogs = pgTable(
  'bodyweight_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    weighedAt: timestamp('weighed_at', { withTimezone: true }).defaultNow().notNull(),
    // Canonical kg, same precision as user_preferences.bodyweight_kg so the
    // synced current value is always exactly one log row's value.
    weightKg: numeric('weight_kg', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  },
  // Composite: both access paths (history list, freshest-row resync) filter
  // by user AND order by weighed_at desc — the index serves the sort too.
  (t) => [index('bodyweight_logs_user_id_weighed_at_idx').on(t.userId, t.weighedAt.desc())],
)

/**
 * Tape-measurement history — one row per site reading, echoing bodyweight_logs
 * (same ownership root, same backdatable timestamp, same canonical-metric
 * column). No denormalized current value: nothing scores off a girth, so the
 * freshest row per site is derived at read time. `site` is the app-level enum
 * in lib/measurement-sites.ts (text + $type, like `source`/`set_type`);
 * `value_cm` is canonical cm — inches are a display concern (lib/units.ts).
 */
export const bodyMeasurements = pgTable(
  'body_measurements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    measuredAt: timestamp('measured_at', { withTimezone: true }).defaultNow().notNull(),
    site: text('site').$type<MeasurementSite>().notNull(),
    // Canonical cm. numeric(5,2) caps at 999.99; the data layer enforces the
    // tighter 10–300 cm human-plausibility band.
    valueCm: numeric('value_cm', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  },
  // Same shape as bodyweight_logs' index: the history read filters by user and
  // orders by measured_at desc (site filtering narrows in-plan).
  (t) => [index('body_measurements_user_id_measured_at_idx').on(t.userId, t.measuredAt.desc())],
)

/**
 * Progress-photo metadata — the blobs themselves live in the private Supabase
 * Storage bucket `progress-photos` under {userId}/{photoId}/. Derivatives
 * (display + thumb + ThumbHash) are computed IN THE BROWSER before upload;
 * the server only stores what it receives — the deliberate E2EE escape hatch.
 * `thumb_hash` is the disclosed plaintext leak: a ~25-byte base64 blur that
 * lets the timeline render placeholders from this table alone, zero network.
 * `taken_at` is backdatable, like measured_at/weighed_at.
 */
export const progressPhotos = pgTable(
  'progress_photos',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    takenAt: timestamp('taken_at', { withTimezone: true }).defaultNow().notNull(),
    // Bucket object keys, stored (not derived) so a delete removes exactly
    // what was uploaded even if the key scheme ever changes.
    blobKeyDisplay: text('blob_key_display').notNull(),
    blobKeyThumb: text('blob_key_thumb').notNull(),
    thumbHash: text('thumb_hash').notNull(),
    pose: text('pose').$type<PhotoPose>(), // nullable — pose tagging is optional
    note: text('note'), // nullable; data layer caps at PHOTO_NOTE_MAX_LENGTH
  },
  // Same shape as bodyweight_logs' index: timeline reads filter by user and
  // order by taken_at desc.
  (t) => [index('progress_photos_user_id_taken_at_idx').on(t.userId, t.takenAt.desc())],
)

/**
 * User goals — FACTS ABOUT TARGETS, never a parallel stats system: a row
 * stores what the user is aiming at (`target` jsonb, discriminated by `kind`
 * — see lib/goal-input.ts) and progress is always DERIVED from truths the app
 * already computes (exercise-stats e1RM records, the denormalized current
 * bodyweight, schedule adherence from completed workouts vs programDays.
 * weekdays). The exercise ref columns are populated for 'strength' only;
 * identity is the composite (source, wgerExerciseId) like everywhere else,
 * with the name denormalized for labels. `achievedAt` is set ONCE by the
 * fails-soft achievement seam (lib/goals.ts) — a recorded fact, never
 * re-derived or cleared. `archivedAt` is the soft hide; delete is the hard
 * one. No program_events-style audit table: goals aren't programs.
 */
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    kind: text('kind').$type<GoalKind>().notNull(),
    // Narrow, kind-discriminated jsonb (validated at the boundary): nothing
    // aggregates over target fields, so the column-vs-JSON rule allows it.
    target: jsonb('target').$type<GoalTarget>().notNull(),
    // Strength-only exercise ref; null for the other kinds by construction.
    wgerExerciseId: integer('wger_exercise_id'),
    source: text('source').$type<ExerciseSource>(),
    exerciseName: text('exercise_name'), // denormalized for labels, like workout_exercises.name
    // Optional aspiration date (display only — nothing enforces it).
    deadline: date('deadline'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    achievedAt: timestamp('achieved_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('goals_user_id_idx').on(t.userId)],
)

/**
 * Trophies — fact-derived milestones, stamped ONCE per (user, kind). Like
 * goals' achievedAt, a stamp is a recorded fact: never re-derived, never
 * cleared. UNIQUE(user_id, kind) IS the once-guarantee — detection writes via
 * INSERT … ON CONFLICT DO NOTHING and only a returned row (the first stamp)
 * may push/celebrate, so a racing double-fire of the seam can't double-
 * notify. `context` is the fact behind the stamp (lift e1RM, count, weeks —
 * see lib/trophy-kinds.ts); its `workoutId` is present only when a live
 * finish earned it, which is what keeps history imports celebration-silent.
 */
export const trophies = pgTable(
  'trophies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    kind: text('kind').$type<TrophyKind>().notNull(),
    achievedAt: timestamp('achieved_at', { withTimezone: true }).defaultNow().notNull(),
    context: jsonb('context').$type<TrophyContext>().notNull().default({}),
  },
  (t) => [
    unique('trophies_user_id_kind_unique').on(t.userId, t.kind),
    index('trophies_user_id_idx').on(t.userId),
  ],
)

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
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
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
    userId: text('user_id').notNull(), // WorkOS user id — ownership root, like `workouts`/`programs`
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

/**
 * Exercise-IDENTITY notes ("seat pin 4"): one markdown note per user per
 * exercise identity — the composite (source, exercise_id), same discriminator
 * as everywhere else — that follows the exercise across workouts. Distinct
 * from workout_exercises.notes, which stays a per-INSTANCE session note.
 * `body` is a markdown string (markdown is the source of truth — agents read
 * and write it; editor JSON is never persisted). `pinned` opts the note into
 * sticky resurfacing in the logger.
 */
export const exerciseNotes = pgTable(
  'exercise_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root, like `workouts`/`programs`
    // 'wger' | 'custom' — exercise identity is the composite (source, id).
    source: text('source').$type<ExerciseSource>().notNull().default('wger'),
    // Exercise ref, always positive (CHECK) — holds a custom_exercises.id when
    // source = 'custom', matching workout_exercises.wger_exercise_id semantics.
    exerciseId: integer('exercise_id').notNull(),
    body: text('body').notNull(), // markdown
    pinned: boolean('pinned').notNull().default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check('exercise_notes_exercise_id_positive', sql`${t.exerciseId} > 0`),
    // One note per identity: upserts key on this, and the getLastPerformance
    // LEFT JOIN relies on at-most-one row per (user, source, exercise).
    unique('exercise_notes_user_exercise_unique').on(t.userId, t.source, t.exerciseId),
  ],
)

/**
 * Notes v2 — authored annotations with exactly ONE anchor (program, workout,
 * workout-exercise instance, or set). One table (not per-entity columns)
 * because the global notes browser queries across anchors in one shot and
 * `author` makes rows entities in their own right (user today, coach comments
 * later — the WRITE path for 'coach' is gated behind the coach surface, but
 * the column ships now so it needs data, not schema).
 *
 * Anchoring rules:
 * - Exactly one anchor FK is non-null (DB CHECK, `num_nonnulls` = 1); every
 *   FK cascades — a deleted anchor takes its notes.
 * - `anchor_snapshot` is written ONCE at creation for set/exercise anchors
 *   (cheap facts: load×reps, set number, exercise name) and NEVER updated —
 *   it powers the future "outdated" badge. A workout-anchored row WITH a
 *   snapshot is a fallback re-anchor (its set/exercise vanished in an edit);
 *   a true session note never carries one — reconcile logic keys on this.
 * - `updateWorkout`'s full replace must re-anchor these rows across its
 *   delete/re-insert (db/note-sync.ts) — cascade would otherwise eat them.
 *
 * The identity `exercise_notes` table above is a different animal (follows
 * the exercise across workouts, markdown, pinned) and stays as-is.
 */
export const notes = pgTable(
  'notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    // Who wrote it: 'user' | 'coach' (text + app-level union, validated at
    // the boundary like `status`/`source` everywhere else).
    author: text('author').$type<NoteAuthor>().notNull().default('user'),
    body: text('body').notNull(), // plain text, 2000 cap (parseNotes 'note')
    // The four anchors — exactly one non-null, each a REAL cascade.
    programId: uuid('program_id').references(() => programs.id, { onDelete: 'cascade' }),
    workoutId: uuid('workout_id').references(() => workouts.id, { onDelete: 'cascade' }),
    workoutExerciseId: uuid('workout_exercise_id').references(() => workoutExercises.id, {
      onDelete: 'cascade',
    }),
    setId: uuid('set_id').references(() => sets.id, { onDelete: 'cascade' }),
    // Frozen creation-time context for set/exercise anchors; null for
    // workout/program anchors. Written once, never updated.
    anchorSnapshot: jsonb('anchor_snapshot').$type<NoteAnchorSnapshot>(),
    // Client-supplied idempotency key (the offline queue's PendingNote.id):
    // the partial unique below makes a replayed flush a no-op instead of a
    // duplicate row. Nullable — direct (non-queued) creates carry none.
    clientKey: text('client_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    check(
      'notes_exactly_one_anchor',
      sql`num_nonnulls(${t.programId}, ${t.workoutId}, ${t.workoutExerciseId}, ${t.setId}) = 1`,
    ),
    // Exactly-once for queued creates: one row per (user, client key).
    uniqueIndex('notes_user_client_key_unique')
      .on(t.userId, t.clientKey)
      .where(sql`${t.clientKey} is not null`),
    // The browser's read path: by user, newest first — the composite serves
    // the sort too (bodyweight_logs precedent).
    index('notes_user_created_idx').on(t.userId, t.createdAt.desc()),
    // Per-anchor lookups (ride-alongs, re-anchor capture, cascade sweeps).
    index('notes_program_id_idx').on(t.programId),
    index('notes_workout_id_idx').on(t.workoutId),
    index('notes_workout_exercise_id_idx').on(t.workoutExerciseId),
    index('notes_set_id_idx').on(t.setId),
  ],
)

/**
 * Standalone workout templates — a reusable session SKETCH that lives outside
 * any program ("users can save workout templates outside of programs"). One
 * level flatter than the program tree on purpose: a template records which
 * movements and roughly how much (a compact per-exercise set plan), not
 * per-set prescriptions — programs remain the precision tool for progression,
 * overrides, and week-by-week targets. Starting from a template seeds a live
 * draft; the resulting workout records NO template provenance (a workout is a
 * workout).
 */
export const workoutTemplates = pgTable(
  'workout_templates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root, like `workouts`
    name: text('name').notNull(),
    description: text('description'),
    // Emoji/short token for list rows, same convention as programs.icon.
    icon: text('icon'),
    // Who authored this template — 'owner' today; open value space (another
    // user id, a group id) so future sharing needs data, not schema. Mirrors
    // programs.author_actor. No sharing/ACLs exist yet.
    authorActor: text('author_actor').notNull().default('owner'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('workout_templates_user_id_idx').on(t.userId)],
)

export const workoutTemplateExercises = pgTable(
  'workout_template_exercises',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workoutTemplates.id, { onDelete: 'cascade' }),
    // Exercise ref, always positive (CHECK). Holds a custom_exercises.id when
    // source = 'custom' — the column name matches workout_exercises.
    wgerExerciseId: integer('wger_exercise_id').notNull(),
    // 'wger' | 'custom' — exercise identity is the composite (source, id).
    source: text('source').$type<ExerciseSource>().notNull().default('wger'),
    name: text('name').notNull(), // denormalized from wger
    position: integer('position').notNull().default(0),
    // Seeded onto the draft exercise when the template is started.
    loggingType: text('logging_type').$type<LoggingType>().notNull().default('weight_reps'),
    notes: text('notes'),
    // The compact set plan — deliberately NOT a per-set child table: a
    // template is a sketch ("3×8–12, rest 90s"), not a program. Anything
    // finer-grained (per-set loads, RIR, techniques, overrides) belongs in
    // the program tree.
    plannedSets: integer('planned_sets').notNull().default(3),
    repMin: integer('rep_min'),
    repMax: integer('rep_max'),
    restSec: integer('rest_sec'),
  },
  (t) => [
    // Same negative-ID kill as workout_exercises.
    check('workout_template_exercises_wger_id_positive', sql`${t.wgerExerciseId} > 0`),
    // Templates are always read tree-root-first (list/detail/start).
    index('workout_template_exercises_template_idx').on(t.templateId),
  ],
)

export const workoutTemplatesRelations = relations(workoutTemplates, ({ many }) => ({
  exercises: many(workoutTemplateExercises),
}))

export const workoutTemplateExercisesRelations = relations(workoutTemplateExercises, ({ one }) => ({
  template: one(workoutTemplates, {
    fields: [workoutTemplateExercises.templateId],
    references: [workoutTemplates.id],
  }),
}))

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
 * Web-push subscriptions — one row per browser endpoint; a user may hold
 * several (phone + desktop). `endpoint` is globally unique (it IS the
 * subscription's identity at the push service), so re-subscribing upserts on
 * it — including across users on a shared device, where the newest sign-in
 * takes the endpoint over. p256dh/auth are the client's encryption keys,
 * opaque base64url strings. Rows die on 404/410 from the push service
 * (pruned by lib/push.ts) or on an explicit unsubscribe.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    // Bumped on every re-subscribe upsert — a liveness hint, not a fact reads depend on.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('push_subscriptions_user_id_idx').on(t.userId)],
)

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
    userId: text('user_id').notNull(), // WorkOS user id
    name: text('name').notNull(),
    // 'draft' | 'active' | 'archived' | 'proposed'. A 'proposed' row is a
    // coach-drafted plan behind the forced owner confirm: it derives nothing,
    // instantiates nothing, never joins the single-active sweep, and exits
    // ONLY via adoptProgram/declineProgram (db/programs.ts).
    status: text('status')
      .$type<'draft' | 'active' | 'archived' | 'proposed'>()
      .notNull()
      .default('draft'),
    // Who drafted this row — 'owner' | 'coach' today; open value space (a
    // human coach's user id, a group id) so future actors need data, not
    // schema. Mirrors program_events.actor's philosophy.
    authorActor: text('author_actor').notNull().default('owner'),
    // Article metadata (all nullable, additive): what the plan is/for whom,
    // an emoji/short token for lists, the article header image, and the
    // attribution link for imported templates (CC attribution is a
    // requirement, not decoration).
    description: text('description'),
    icon: text('icon'),
    heroImageUrl: text('hero_image_url'),
    sourceUrl: text('source_url'),
    mesocycleWeeks: integer('mesocycle_weeks').notNull().default(1),
    deloadWeek: integer('deload_week'), // 1-based week that deloads; null = none
    // Auto-regulation switch, default ON: propose-don't-impose delivery plus
    // the per-exercise "use plan as written" escape soften the default; false
    // skips the stall rules (and their history reads) entirely at derive time.
    autoregulation: boolean('autoregulation').notNull().default(true),
    // Fixed-mode stall policy (lib/autoregulate.ts AutoregStallPolicy):
    // 'all-sets' (default — ANY scorable working set under its floor stalls,
    // C1) | 'first-set' (only the lowest-setNumber working set governs).
    // Text + app-level union like `status`; range mode ignores it (its stall
    // is total-rep-gain, not floor misses).
    autoregStallPolicy: text('autoreg_stall_policy')
      .$type<AutoregStallPolicy>()
      .notNull()
      .default('all-sets'),
    // Deload policy (lib/program-input.ts deloadPolicySchema): 'none' |
    // 'reactive' | 'scheduled' (+ shape). NULLABLE with no default and no
    // backfill ON PURPOSE — null means "pre-policy program", resolved at
    // READ time by resolveDeloadPolicy (lib/progression.ts) into the legacy
    // behavior (deloadWeek set → scheduled at the historical factors, else
    // none), so existing programs derive byte-identically. Narrow,
    // boundary-validated JSONB like `progression` below.
    deloadPolicy: jsonb('deload_policy').$type<DeloadPolicy>(),
    // Diet-phase context (lib/program-input.ts dietPhaseSchema): 'cutting' |
    // 'maintaining' | 'bulking'. NULLABLE with no default and no backfill ON
    // PURPOSE — null means "not a thing" and the engine derives byte-for-byte
    // today's behavior. 'cutting' only ANNOTATES stall verdicts and gates the
    // 3-stall auto-backoff into a confirmable proposal (loads never change
    // from phase alone); 'maintaining'/'bulking' are stored context only in
    // v1. Text + app-level union like `status`. NEVER copied by clone/adopt —
    // phases don't cross training blocks.
    dietPhase: text('diet_phase').$type<DietPhase>(),
    // When the phase was last SET (any explicit write, including a null
    // clear) — the minimal staleness signal, exposed via get_program so the
    // coach can reason about "still cutting?" without a nag surface.
    dietPhaseSetAt: timestamp('diet_phase_set_at', { withTimezone: true }),
    // Overshoot / goal-met policy (lib/overshoot-policy.ts): 'strict-load' |
    // 'e1rm-equivalent' | 'any-metric'. NULLABLE with no default and no
    // backfill ON PURPOSE — null means "per-scheme default", resolved at READ
    // time by resolveOvershootPolicy (strict for load-anchored schemes,
    // e1rm-equivalent for rpe-target), so existing programs score
    // byte-identically. Text + app-level union like `status`.
    overshootPolicy: text('overshoot_policy').$type<OvershootPolicy>(),
    // Performance→plan auto-sync switch, default ON so fresh users never see
    // stale plans; off for deliberate-percentage programs (5/3/1-style waves)
    // where performed > listed is by design.
    planSync: boolean('plan_sync').notNull().default(true),
    // Program-suggested body check-in cadence, in days ("this program suggests
    // a check-in every 14 days"). Null = no suggestion — nullable, unlike the
    // switches above, because absence IS the off state. App-validated 3–90 at
    // the input boundary (program-input.ts); no DB default on purpose.
    checkInEveryDays: integer('check_in_every_days'),
    // Sharing visibility (tier 1 of the social ladder): 'private' (owner
    // only — the default forever) | 'link' (readable via a live share URL) |
    // 'public' (link behavior + eligibility for a future browse surface; the
    // value is stored now so tier 2+ needs data, not schema). Text + app-level
    // enum like `status`; resolution additionally requires a live
    // program_shares row and status != 'proposed' (db/program-shares.ts).
    visibility: text('visibility').$type<ProgramVisibility>().notNull().default('private'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('programs_user_id_idx').on(t.userId)],
)

/**
 * Batch-patch proposals (proposals plan §3): ONE row per proposal — a grouped
 * set of existing patch ops an agent suggests against an ACTIVE program, held
 * inert until the owner's single combined confirm. Deliberately NOT a
 * normalized patch-list table: `patches` is an opaque validated jsonb array
 * (lib/patch-proposal.ts shapes it like the MCP patch-tool inputs, kg-
 * canonical), so the proposal stays one decision unit — accept whole or
 * decline — and the schema stays a pending-inbox, not a second change log
 * (program_events remains the log; every applied patch writes its own row
 * there). `status`: 'pending' | 'applied' (confirm keeps the row as the audit
 * anchor its events reference; decline hard-deletes, mirroring
 * declineProgram). Cascade: proposals die with their program.
 */
export const programPatchProposals = pgTable(
  'program_patch_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root, like `programs`
    // Who proposed — same open value space philosophy as programs.authorActor
    // ('coach' | 'mcp' today; a human coach's user id later needs data, not
    // schema).
    authorActor: text('author_actor').notNull(),
    // The one-line human summary the approval card leads with.
    summary: text('summary').notNull(),
    patches: jsonb('patches').notNull(),
    status: text('status').notNull().default('pending'),
    // Structured provenance for MACHINE-raised proposals (nullable — human/
    // coach proposals carry neither): `source` names the generator
    // ('volume-progression' today), `muscleGroup` its subject. The partial
    // unique index below makes "one pending proposal per (program, source,
    // subject)" a DATABASE guarantee, so concurrent trigger runs collapse to
    // one row instead of racing past an app-level pending check.
    source: text('source'),
    muscleGroup: text('muscle_group'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // The only read path (pending proposals for a program page / user) filters
  // by program; user-wide listings ride the program join.
  (t) => [
    index('program_patch_proposals_program_id_idx').on(t.programId),
    uniqueIndex('program_patch_proposals_pending_source_unique')
      .on(t.programId, t.source, t.muscleGroup)
      .where(sql`${t.status} = 'pending' and ${t.source} is not null`),
  ],
)

export const programDays = pgTable(
  'program_days',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    // The day's DURABLE identity, distinct from `id`: a full-replace save
    // (updateProgram) deletes and re-inserts every row, so `id` is re-minted
    // and cannot carry provenance across an edit. The slot key is snapshotted
    // before the wipe and written back onto the matching re-inserted day, so
    // `workouts.programDaySlotKey` still names the slot afterwards. New days
    // (and every clone/copy, which lists columns explicitly) mint a fresh one.
    slotKey: uuid('slot_key').defaultRandom().notNull(),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0), // 0-based order
    notes: text('notes'),
    // Weekday schedule (0–6, Sunday-first). Empty = unscheduled — the
    // pre-schedule behavior, so every existing row keeps meaning "no anchor".
    // Deduped/sorted at the validation boundary (program-input.ts).
    weekdays: integer('weekdays').array().notNull().default(sql`'{}'::integer[]`),
  },
  // 0-based contiguous per program — guards the read-max-then-insert append and
  // the position-addressed patch ops against racing duplicates. DEFERRABLE
  // INITIALLY DEFERRED (hand-edited migration, same as program_sets) so the
  // Phase-4 move splice-renumber, which transiently collides, still commits.
  (t) => [
    unique('program_days_program_position_unique').on(t.programId, t.position),
    // Globally unique so the slot key alone identifies a slot; the replace
    // deletes before it re-inserts, so carrying a key forward never collides.
    unique('program_days_slot_key_unique').on(t.slotKey),
  ],
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
    // Per-exercise overshoot-policy override (lib/overshoot-policy.ts) —
    // outranks the program column; null = inherit (program policy, else the
    // scheme default). Same nullable-text + read-time-resolution discipline
    // as programs.overshoot_policy. No override UI in v1 — the column and
    // resolver support it so a later surface needs data, not schema.
    overshootPolicy: text('overshoot_policy').$type<OvershootPolicy>(),
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
 *
 * `technique` is the ONE apparent exception, and it is deliberate rather than
 * an inconsistency: a per-week intensifier is the canonical way these methods
 * are programmed. Coaching practice adds drop sets / rest-pause / myo-reps
 * LATE in a block, once straight-set progression slows — "early mesocycles
 * are generally better served by accumulating volume" — which is precisely a
 * statement about weeks, not about the set's identity. Removing one for a
 * week needs no override: a scheduled deload strips intensifiers itself
 * (lib/progression.ts), which is the case that actually matters.
 * Source: RP Strength, "Intensity Techniques for Maximum Mass".
 *
 * Set COUNT is absent
 * for the same reason and stays that way — per-week count is owned by the RULE
 * layer (the deload policy's setFactor, the weekly-volume ramp) through the one
 * resize step in lib/progression.ts. See docs/specs/per-week-set-count.md for
 * the decision and for what a per-week editing surface may promise.
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

/**
 * Share links for programs with visibility 'link' | 'public' — a separate
 * table, not a column, so rotation, multiple live links, and future rows
 * carrying scope (crewId, expiresAt) need new ROWS, not schema surgery.
 * `token` is the capability: 24 bytes of crypto randomness (192-bit entropy,
 * base64url), globally unique. Revocation sets `revokedAt` (the row is kept
 * as a fact); a replacement link is a NEW row with a fresh token. Resolution
 * (db/program-shares.ts) requires revokedAt IS NULL plus the program-side
 * gates; anything else 404s without acknowledging existence.
 */
export const programShares = pgTable(
  'program_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  // Owner-side reads (active link for the sharing UI, revoke sweep) are
  // program-first; token lookups ride the unique index.
  (t) => [index('program_shares_program_id_idx').on(t.programId)],
)

/**
 * Share links for COMPLETED workouts — program_shares' shape, verbatim, for
 * the same reasons (rotation and future scope live in new ROWS). Workouts
 * carry no visibility column: a live row here IS the grant (create refuses
 * unfinished sessions — db/workout-shares.ts), so revoking every row returns
 * the workout to private. Cascade delete: a deleted workout takes its links.
 */
export const workoutShares = pgTable(
  'workout_shares',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  // Same access paths as program_shares: owner reads workout-first, token
  // lookups ride the unique index.
  (t) => [index('workout_shares_workout_id_idx').on(t.workoutId)],
)

/**
 * Append-only change log for a logged SESSION — the workout counterpart of
 * `program_events`, written by the db seam (workouts.ts) inside the same
 * transaction as the change it describes: a failed save logs nothing, a logged
 * event implies the write committed. No update or delete path exists.
 *
 * `kind` is the discriminator the clinical-record vocabulary turns on, and it
 * is DECLARED BY THE CALLING CODE PATH — never inferred here. It cannot be
 * inferred: `workouts.completedAt` is stamped by `coalesce(completedAt, now())`
 * on the FIRST set-level touch, so an agent logging one rep mid-session and an
 * agent correcting a set a week later are indistinguishable at this layer.
 *   - 'original'   — the session's first persist. The record being CREATED.
 *   - 'late_entry' — something that happened but was never logged, ADDED after
 *                    the fact. It does not contradict what is already there.
 *   - 'amendment'  — a correction of something recorded wrong. It CONTRADICTS
 *                    prior content. This is the log's headline view.
 *   - 'system'     — the app's own writes (autoregulation, recalculation).
 *
 * Grain is one row per user INTENT, not per field: "fix the weight and reps on
 * set 3" is ONE row whose `changed` array lists both columns. `changed` is
 * denormalised on write so the renderer never has to diff the JSONB to decide
 * what to show. `before`/`after` snapshot the SUBJECT ONLY (a set is ~6 scalar
 * fields — the snapshot is tiny); `before` is null for a creation, `after` is
 * null for a removal, and the subject's addressing (exercise identity + set
 * number) rides inside whichever snapshot exists, so at least one always names
 * what the row is about. Cascade delete: a session's history dies with it.
 */
export const workoutEvents = pgTable(
  'workout_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    workoutId: uuid('workout_id')
      .notNull()
      .references(() => workouts.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root, like `workouts`
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    kind: text('kind').$type<'original' | 'late_entry' | 'amendment' | 'system'>().notNull(),
    actor: text('actor').$type<'ui' | 'mcp' | 'coach' | 'system'>().notNull(),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    /** Column names the intent touched — empty for a creation or a removal,
     *  where the whole subject IS the change. */
    changed: text('changed')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    before: jsonb('before'),
    after: jsonb('after'),
  },
  // Same access path as program_events: the timeline filters by workout and
  // orders newest-first, so the composite serves the sort too.
  (t) => [index('workout_events_workout_occurred_idx').on(t.workoutId, t.occurredAt.desc())],
)

/**
 * Append-only change log for the program tree — one row per mutating call at
 * the db seam (program-patches.ts + programs.ts), written inside the same
 * transaction as the change: a failed patch logs nothing, a logged event
 * implies the change committed. Facts about plan changes (record, never
 * rewrite) — no update path exists. `actor` is WHO edited ('ui' | 'mcp' |
 * 'coach'); `action` is the patch/tool name; `summary` is one compact human
 * line; `payload` is a minimal before/after of the touched fields, not a
 * snapshot (restart-as-clone remains the coarse rollback). Cascade delete:
 * a program's change history dies with the program.
 */
export const programEvents = pgTable(
  'program_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(), // WorkOS user id — ownership root, like `programs`
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    actor: text('actor').$type<'ui' | 'mcp' | 'coach' | 'wger' | 'seed'>().notNull(),
    action: text('action').notNull(),
    summary: text('summary').notNull(),
    payload: jsonb('payload'),
  },
  // The only read path (program timeline + list_program_changes) filters by
  // program and orders newest-first — the composite serves the sort too.
  (t) => [index('program_events_program_occurred_idx').on(t.programId, t.occurredAt.desc())],
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

// ---------------------------------------------------------------------------
// Consent ledger (see docs/legal/in-product-copy.md and the PR 4 brief).
// Append-only events + a current-state projection — the Fides/iubenda shape.
// consent_events is NEVER updated or deleted (CA ARL: keep >= 3 years; on
// account deletion the user is pseudonymized, the events remain as compliance
// records). All writes go through src/db/consent.ts.
// ---------------------------------------------------------------------------

/**
 * Versioned snapshots of the documents consent can reference. content is the
 * FULL text as shown — clickwrap enforceability turns on reproducing exactly
 * what was accepted, so the snapshot (plus hash) is the evidence, and the
 * version label is cosmetic. `isMaterial` drives re-consent: a material new
 * version gates the app behind a fresh affirmative act; non-material just
 * swaps the linked text.
 */
export const consentDocuments = pgTable(
  'consent_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    docType: text('doc_type')
      .$type<'tos' | 'privacy' | 'health_notice' | 'analytics_notice'>()
      .notNull(),
    version: integer('version').notNull(),
    contentMd: text('content_md').notNull(),
    contentSha256: text('content_sha256').notNull(),
    isMaterial: boolean('is_material').notNull().default(true),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('consent_documents_type_version_idx').on(t.docType, t.version)],
)

export type ConsentPurpose =
  | 'tos'
  | 'health_collect'
  | 'health_share'
  | 'analytics_identity'
  | 'autorenewal'

/**
 * The append-only ledger. One row per affirmative act (grant, withdraw,
 * reconfirm). `presentation` captures HOW it was shown (route, surface, the
 * exact control label, locale) — the half of consent proof most systems drop.
 * IP is stored TRUNCATED (v4: last octets zeroed to /16) — a full IP beside
 * health-consent rows is itself a data-minimization problem.
 *
 * No FK to a users table by design: the ledger must outlive account deletion
 * (events are retained pseudonymized), so a cascade would destroy evidence.
 */
export const consentEvents = pgTable(
  'consent_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(), // WorkOS user id (pseudonymized on account deletion)
    purpose: text('purpose').$type<ConsentPurpose>().notNull(),
    action: text('action').$type<'granted' | 'withdrawn' | 'reconfirmed'>().notNull(),
    // Null on withdrawals — you withdraw a purpose, not a document version.
    documentId: uuid('document_id').references(() => consentDocuments.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    ipTruncated: text('ip_truncated'),
    userAgent: text('user_agent'),
    presentation: jsonb('presentation').notNull(),
  },
  (t) => [index('consent_events_user_purpose_idx').on(t.userId, t.purpose, t.occurredAt.desc())],
)

/**
 * Current-state projection, rewritten in the same transaction as each event
 * insert. Hot-path gates (requireConsent) read ONLY this — one PK lookup.
 */
export const consentCurrent = pgTable(
  'consent_current',
  {
    userId: text('user_id').notNull(),
    purpose: text('purpose').$type<ConsentPurpose>().notNull(),
    granted: boolean('granted').notNull(),
    documentId: uuid('document_id').references(() => consentDocuments.id),
    eventId: uuid('event_id')
      .notNull()
      .references(() => consentEvents.id),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.purpose] })],
)

/**
 * Withdrawal/deletion fan-out log — MHMDA requires propagating to processors,
 * and this table is the evidence it happened (e.g. PostHog person deletion
 * after analytics_identity withdrawal). Rows are enqueued in the withdrawal
 * transaction and completed by the worker that performs the action.
 */
export const consentDownstreamActions = pgTable(
  'consent_downstream_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => consentEvents.id),
    processor: text('processor').notNull(), // 'posthog', ...
    action: text('action').notNull(), // 'person_delete', 'stop_share', ...
    status: text('status').$type<'pending' | 'completed' | 'failed'>().notNull().default('pending'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('consent_downstream_status_idx').on(t.status)],
)

// ---------------------------------------------------------------------------
// Entitlements — see docs/ENTITLEMENTS.md
// ---------------------------------------------------------------------------

/**
 * The append-only reason a user has a tier. One row per grant, whatever
 * conferred it: a Stripe subscription, an Apple/Google transaction, a support
 * comp, a promo. Rows are NEVER edited to reflect a new truth — a revocation
 * stamps the revoked_* columns and leaves the original act legible, which is
 * what makes this answerable months later when a customer asks why.
 *
 * `reason` is not nullable on purpose. A grant nobody can explain later is
 * unauditable, and the one most likely to need explaining is the manual one
 * somebody made at 2am.
 *
 * No FK to a users table: user ids come from WorkOS, and the rest of the
 * schema keys on the same bare text id.
 */
export const entitlementGrants = pgTable(
  'entitlement_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: text('user_id').notNull(),
    tier: text('tier').$type<Tier>().notNull(),
    source: text('source').$type<GrantSource>().notNull(),
    /**
     * The external identity of what caused this: a Stripe subscription id, an
     * Apple originalTransactionId, a Google purchaseToken, a promo code. Null
     * for a manual comp, which has no external counterpart.
     */
    sourceRef: text('source_ref'),
    status: text('status').$type<GrantStatus>().notNull().default('active'),
    startsAt: timestamp('starts_at', { withTimezone: true }).defaultNow().notNull(),
    /** Null = perpetual: a lifetime purchase, or an open-ended comp. */
    endsAt: timestamp('ends_at', { withTimezone: true }),
    reason: text('reason').notNull(),
    /** The ops user who took the action; null when a payment processor did. */
    actorId: text('actor_id'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    revokedByActorId: text('revoked_by_actor_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('entitlement_grants_user_idx').on(t.userId, t.createdAt.desc()),
    /**
     * At most one LIVE grant per external subscription. This is the webhook
     * idempotency guard: a redelivered Stripe event tries to insert the same
     * (source, source_ref) and collides instead of provisioning twice. Partial
     * so a revoked grant does not block re-subscribing with the same id.
     */
    uniqueIndex('entitlement_grants_source_ref_live_idx')
      .on(t.source, t.sourceRef)
      .where(sql`${t.sourceRef} is not null and ${t.status} = 'active'`),
    check('entitlement_grants_window_ck', sql`${t.endsAt} is null or ${t.endsAt} > ${t.startsAt}`),
  ],
)

/**
 * Current-state projection, rewritten in the same transaction as every grant
 * write. Hot-path gates read ONLY this — one primary-key lookup.
 *
 * `expires_at` is stored rather than derived so the read can compare it to the
 * clock: a grant that simply lapses stops granting with no event, no cron and
 * no webhook. A stale projection therefore resolves DOWN, never up, which is
 * the only acceptable direction for a row that hands out paid features.
 */
export const entitlementsCurrent = pgTable('entitlements_current', {
  userId: text('user_id').primaryKey(),
  tier: text('tier').$type<Tier>().notNull(),
  /** Null when the user is on the default tier with nothing granted. */
  source: text('source').$type<GrantSource>(),
  /** Null when perpetual, or when on the default tier. */
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  /** The winning grant, for the ops surface to link the tier back to a cause. */
  grantId: uuid('grant_id').references(() => entitlementGrants.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
})

/** Where a RevenueCat webhook event stands. `orphaned` = permanently
 *  unprocessable (unknown user) — retrying cannot fix it, so RC got a 200. */
export type RcWebhookEventStatus = 'received' | 'processed' | 'ignored' | 'failed' | 'orphaned'

/**
 * Insert-first inbox for RevenueCat webhook deliveries — dedupe, retry
 * bookkeeping, and the dead-letter record, in one table. RC redelivers with
 * the SAME event id (5 retries), so the primary key is the dedupe guard:
 * `INSERT ... ON CONFLICT DO NOTHING`, then the status decides whether this
 * delivery is a duplicate (processed/ignored → 200 immediately) or a retry
 * (received/failed → process again). See docs/SPIKE-REVENUECAT.md.
 *
 * The raw payload is kept because RC has no self-serve replay once its
 * retries exhaust; a retention trim nulls it after 90 days, and account
 * deletion purges rows by app_user_id (payloads can carry subscriber PII).
 */
export const rcWebhookEvents = pgTable(
  'rc_webhook_events',
  {
    /** RC's event id. Retries reuse it — this IS the dedupe key. */
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    /** Null for events that carry no user (some paywall/test events). */
    appUserId: text('app_user_id'),
    /** SANDBOX | PRODUCTION — one shared stream, filtered per deployment. */
    environment: text('environment').notNull(),
    /** Full raw event. Nulled by the retention trim, never the row itself. */
    payload: jsonb('payload'),
    status: text('status').$type<RcWebhookEventStatus>().notNull().default('received'),
    /** Deliveries seen (first + RC's redeliveries). RC stops after 6 total. */
    attempts: integer('attempts').notNull().default(1),
    lastError: text('last_error'),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [
    // The account-deletion purge and the backstop sweep both look up by user.
    index('rc_webhook_events_user_idx').on(t.appUserId),
    // The backstop cron scans for failed/stale-received rows.
    index('rc_webhook_events_status_idx').on(t.status, t.receivedAt),
  ],
)

/**
 * Usage meters — how much of a metered, capped thing a user has consumed. The
 * first (and for now only) meter is the free coach-message taste for
 * non-entitled users; the shape is deliberately general so a second meter is
 * a new `meter` value, not a new table.
 *
 * The LIMIT is NOT stored here — it is resolved from the user's tier at check
 * time (the same "features not tiers" indirection entitlements use), so
 * changing a plan's allowance is a code/data change in one place, never a
 * migration of every row.
 *
 * `periodKey` carries the reset semantics WITHOUT a cron: `'lifetime'` never
 * resets; a periodic meter would use e.g. `'2026-08'`, and the next period is
 * simply a fresh row starting at zero.
 */
export const usageCounters = pgTable(
  'usage_counters',
  {
    userId: text('user_id').notNull(),
    /** What is being metered, e.g. 'coach_message'. */
    meter: text('meter').notNull(),
    /** 'lifetime' or a period stamp like '2026-08'. */
    periodKey: text('period_key').notNull(),
    used: integer('used').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.meter, t.periodKey] })],
)

import type { ProgramInputUnparsed } from '../programs/program-input'

/**
 * The template library's canonical seed content: five published-canon
 * programs authored as plain `ProgramInputUnparsed` payloads, validated by
 * the same `parseProgramInput` boundary every other create path uses (the
 * unit tests parse every payload; the seed script refuses to write anything
 * that fails the boundary). Scheme configs mirror the cited golden corpus
 * (lib/testing/corpus.test.ts) where a corpus entry exists:
 *
 *  [W1] Wendler 5/3/1 — wave 65/75/85 · 70/80/90 · 75/85/95 (%TM), reps
 *       5/5/5 · 3/3/3 · 5/3/1, deload row 40/50/60% ×5 off the OLD TM
 *       (tmBumpTiming 'after-deload'), +2.5 kg upper / +5 kg lower per cycle.
 *  [G1] GZCLP — T1 session-linear (+2.5 upper / +5 lower), T2
 *       double-progression 8–10, T3 15–25. DIVERGENCE (named in the corpus):
 *       our engine progresses per WEEK and answers T1 failure with the stall
 *       path, not GZCLP's 6×2+/10×1+ ladder.
 *  [S1] StrongLifts 5×5 — linear +2.5 kg per step; the third straight fail
 *       backs off ~10% via the engine's stall rules. DIVERGENCE (axis only):
 *       per week, not per session.
 *
 * PPL and Upper/Lower are structure templates (no single published oracle):
 * double-progression compounds + rep-range accessory sets.
 *
 * Exercise identity: every `wgerExerciseId` below was verified against the
 * live wger English catalog (wger.de/api/v2/exerciseinfo, language 2) on
 * 2026-08-09 — the same catalog path `loadExerciseCatalog` resolves muscle
 * tags from. The test pins the payloads to this verified set.
 */

// --- Verified wger exercise ids (name as wger lists it) ---
export const WGER = {
  squat: 615, // Squats
  bench: 73, // Bench Press
  deadlift: 184, // Deadlifts
  ohp: 687, // Overhead Press
  row: 83, // Bent Over Rowing
  pullUp: 475, // Pull-ups
  chinUp: 152, // Chin Up
  latPulldown: 355, // Lat Pull Down (Straight Back)
  cableRow: 1117, // Seated Cable Row
  legPress: 371, // Leg Press
  legCurl: 364, // Leg Curl
  legExtension: 369, // Leg Extension
  rdl: 507, // Romanian Deadlift
  lateralRaise: 348, // Lateral Raises
  barbellCurl: 91, // Biceps Curls With Barbell
  dumbbellCurl: 92, // Biceps Curls With Dumbbell
  tricepsPushdown: 1185, // Triceps Pushdown
  skullcrusher: 246, // Skullcrusher SZ-bar
  facePull: 222, // Facepull
  calfRaise: 622, // Standing Calf Raises
  inclineBench: 538, // Incline Bench Press - Barbell
  chestFly: 135, // Butterfly
  crunch: 167, // Crunches
  lunge: 205, // Dumbbell Lunges Standing
  hipThrust: 294, // Hip Thrust
} as const

type DayIn = ProgramInputUnparsed['days'][number]
type ExerciseIn = DayIn['exercises'][number]
type SetIn = ExerciseIn['sets'][number]
type ProgressionIn = ExerciseIn['progression']

/** `count` identical planned sets (fresh objects — nothing shares state). */
function setsOf(count: number, set: SetIn): SetIn[] {
  return Array.from({ length: count }, () => ({ ...set }))
}

/** Straight working sets: count × repMin–repMax with a rest. */
function work(count: number, repMin: number, repMax: number | null, restSec: number): SetIn[] {
  return setsOf(count, { repMin, repMax, restSec })
}

/** Working sets whose LAST set is an AMRAP ("5×3+" shapes). */
function workPlus(count: number, repMin: number, restSec: number): SetIn[] {
  return [
    ...work(count - 1, repMin, null, restSec),
    { repMin, repMax: null, restSec, setType: 'amrap' },
  ]
}

function doubleProgression(repMin: number, repMax: number, incrementKg: number): ProgressionIn {
  return { scheme: 'double-progression', repMin, repMax, incrementKg }
}

function linear(incrementKg: number): ProgressionIn {
  return { scheme: 'linear', incrementKg }
}

// --- Wendler 5/3/1 [W1] ---

const WAVE_531 = [
  [0.65, 0.75, 0.85],
  [0.7, 0.8, 0.9],
  [0.75, 0.85, 0.95],
]
const WAVE_REPS_531 = [
  [5, 5, 5],
  [3, 3, 3],
  [5, 3, 1],
]

/** One 5/3/1 main-lift slot: 3 wave sets (last AMRAP) off a starter TM. */
function main531(id: number, name: string, trainingMaxKg: number, incrementKg: number): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: workPlus(3, 5, 180),
    progression: {
      scheme: 'amrap-cycle',
      trainingMaxKg,
      incrementKg,
      wave: WAVE_531,
      waveReps: WAVE_REPS_531,
      deloadRow: { percents: [0.4, 0.5, 0.6], reps: 5 }, // 40/50/60% ×5 [W1]
      tmBumpTiming: 'after-deload', // deload derives off the OLD TM [W1]
    },
  }
}

/** BBB-style supplemental volume: the day's lift again, 5×10, no scheme. */
function bbb(id: number, name: string): ExerciseIn {
  return { wgerExerciseId: id, name, sets: work(5, 10, null, 90) }
}

/** An accessory slot: rep-range sets, optionally on double progression. */
function accessory(
  id: number,
  name: string,
  count: number,
  repMin: number,
  repMax: number,
  progression: ProgressionIn = null,
): ExerciseIn {
  return { wgerExerciseId: id, name, sets: work(count, repMin, repMax, 90), progression }
}

const WENDLER_531: ProgramInputUnparsed = {
  name: 'Wendler 5/3/1',
  status: 'draft',
  visibility: 'public',
  icon: '🌊',
  mesocycleWeeks: 4,
  deloadWeek: 4,
  deloadPolicy: { mode: 'scheduled', shape: {} },
  // Deliberate-percentage program: performed > listed is by design, so the
  // plan must not chase the log (the upsert_program tool's own guidance).
  planSync: false,
  sourceUrl: 'https://barbend.com/5-3-1-program/',
  description:
    'Jim Wendler’s 5/3/1 (T-Nation 2009 / the 5/3/1 book): four days, one main lift each, waved off a Training Max (~90% of your 1RM).\n\nWeek 1: 65/75/85% × 5/5/5+ · Week 2: 70/80/90% × 3/3/3+ · Week 3: 75/85/95% × 5/3/1+ · Week 4 deload: 40/50/60% × 5, off the old TM. The last work set each week is an AMRAP — leave a rep or two in the tank. After the deload the TM grows +2.5 kg on presses and +5 kg on squat/deadlift.\n\nEdit the Training Maxes to your own before starting (the app prefills from your history when it can). Supplemental 5×10 volume and one accessory ride along, Boring-But-Big style.',
  days: [
    {
      name: 'Press day',
      exercises: [
        main531(WGER.ohp, 'Overhead Press', 40, 2.5),
        bbb(WGER.ohp, 'Overhead Press'),
        accessory(WGER.chinUp, 'Chin Up', 5, 8, 12),
      ],
    },
    {
      name: 'Deadlift day',
      exercises: [
        main531(WGER.deadlift, 'Deadlifts', 100, 5),
        bbb(WGER.deadlift, 'Deadlifts'),
        accessory(WGER.crunch, 'Crunches', 5, 10, 15),
      ],
    },
    {
      name: 'Bench day',
      exercises: [
        main531(WGER.bench, 'Bench Press', 60, 2.5),
        bbb(WGER.bench, 'Bench Press'),
        accessory(WGER.row, 'Bent Over Rowing', 5, 8, 12),
      ],
    },
    {
      name: 'Squat day',
      exercises: [
        main531(WGER.squat, 'Squats', 80, 5),
        bbb(WGER.squat, 'Squats'),
        accessory(WGER.legCurl, 'Leg Curl', 5, 10, 15),
      ],
    },
  ],
}

// --- GZCLP [G1] ---

/** T1: 5×3, last set AMRAP, session-linear load. */
function t1(id: number, name: string, incrementKg: number): ExerciseIn {
  return { wgerExerciseId: id, name, sets: workPlus(5, 3, 180), progression: linear(incrementKg) }
}

/** T2: 3×8–10 double progression at the same weight until the top. */
function t2(id: number, name: string, incrementKg: number): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: work(3, 8, 10, 120),
    progression: doubleProgression(8, 10, incrementKg),
  }
}

/** T3: 3×15–25, last set AMRAP, double progression. */
function t3(id: number, name: string): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: [...work(2, 15, 25, 60), { repMin: 15, repMax: 25, restSec: 60, setType: 'amrap' }],
    progression: doubleProgression(15, 25, 2.5),
  }
}

const GZCLP: ProgramInputUnparsed = {
  name: 'GZCLP',
  status: 'draft',
  visibility: 'public',
  icon: '🧱',
  mesocycleWeeks: 9,
  sourceUrl: 'https://www.boostcamp.app/coaches/cody-lefever/gzcl-program-gzclp',
  description:
    'Cody Lefever’s GZCLP: the linear-progression entry to the GZCL method. Four days, three tiers each — T1 heavy main lift (5×3, last set AMRAP), T2 secondary lift (3×8–10, add weight when every set hits 10), T3 pump work (3×15–25, last set AMRAP).\n\nT1 adds +5 kg on squat/deadlift and +2.5 kg on bench/press per step; T2 and T3 move by double progression.\n\nNote: this app progresses week over week and answers a T1 stall with its own stall rules (repeat, then back off ~10%) instead of GZCLP’s 6×2+ → 10×1+ set-shape ladder — same spirit, simpler bookkeeping.',
  days: [
    {
      name: 'A1 · Squat',
      exercises: [
        t1(WGER.squat, 'Squats', 5),
        t2(WGER.bench, 'Bench Press', 2.5),
        t3(WGER.latPulldown, 'Lat Pull Down'),
      ],
    },
    {
      name: 'B1 · Press',
      exercises: [
        t1(WGER.ohp, 'Overhead Press', 2.5),
        t2(WGER.deadlift, 'Deadlifts', 5),
        t3(WGER.row, 'Bent Over Rowing'),
      ],
    },
    {
      name: 'A2 · Bench',
      exercises: [
        t1(WGER.bench, 'Bench Press', 2.5),
        t2(WGER.squat, 'Squats', 5),
        t3(WGER.latPulldown, 'Lat Pull Down'),
      ],
    },
    {
      name: 'B2 · Deadlift',
      exercises: [
        t1(WGER.deadlift, 'Deadlifts', 5),
        t2(WGER.ohp, 'Overhead Press', 2.5),
        t3(WGER.row, 'Bent Over Rowing'),
      ],
    },
  ],
}

// --- StrongLifts 5×5 [S1] ---

function fiveByFive(id: number, name: string, incrementKg: number): ExerciseIn {
  return { wgerExerciseId: id, name, sets: work(5, 5, null, 180), progression: linear(incrementKg) }
}

const STRONGLIFTS: ProgramInputUnparsed = {
  name: 'StrongLifts 5×5',
  status: 'draft',
  visibility: 'public',
  icon: '🏛️',
  mesocycleWeeks: 12,
  sourceUrl: 'https://stronglifts.com/stronglifts-5x5/',
  description:
    'The classic beginner barbell program: two alternating full-body workouts, three sessions a week, squatting every time.\n\nWorkout A: Squat, Bench Press, Barbell Row. Workout B: Squat, Overhead Press, Deadlift (one heavy set of five). Add +2.5 kg per step — +5 kg on deadlift — for as long as the bar keeps moving; after a third straight miss the app backs the lift off ~10%, StrongLifts’ own deload rule.\n\nThis plan lists A/B/A; next week run B/A/B by picking the day you’re on — the alternation is the program.',
  days: [
    {
      name: 'Workout A',
      exercises: [
        fiveByFive(WGER.squat, 'Squats', 2.5),
        fiveByFive(WGER.bench, 'Bench Press', 2.5),
        fiveByFive(WGER.row, 'Bent Over Rowing', 2.5),
      ],
    },
    {
      name: 'Workout B',
      exercises: [
        fiveByFive(WGER.squat, 'Squats', 2.5),
        fiveByFive(WGER.ohp, 'Overhead Press', 2.5),
        {
          wgerExerciseId: WGER.deadlift,
          name: 'Deadlifts',
          sets: work(1, 5, null, 180),
          progression: linear(5),
        },
      ],
    },
    {
      name: 'Workout A (repeat)',
      exercises: [
        fiveByFive(WGER.squat, 'Squats', 2.5),
        fiveByFive(WGER.bench, 'Bench Press', 2.5),
        fiveByFive(WGER.row, 'Bent Over Rowing', 2.5),
      ],
    },
  ],
}

// --- Push Pull Legs (6-day) ---

/** A compound slot: rep-range sets driven by double progression. */
function compound(
  id: number,
  name: string,
  count: number,
  repMin: number,
  repMax: number,
  incrementKg: number,
): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: work(count, repMin, repMax, 150),
    progression: doubleProgression(repMin, repMax, incrementKg),
  }
}

const PPL: ProgramInputUnparsed = {
  name: 'Push Pull Legs',
  status: 'draft',
  visibility: 'public',
  icon: '🔁',
  mesocycleWeeks: 8,
  sourceUrl: 'https://www.reddit.com/r/Fitness/wiki/routines/',
  description:
    'The six-day hypertrophy staple: push (chest/shoulders/triceps), pull (back/biceps), legs — twice through each week, with a heavier A day and a higher-rep B day per slot.\n\nCompound lifts run double progression: work inside the rep range, add weight when every set reaches the top. Accessories stay in their rep range and grow by feel. Six days is a real commitment — drop to one round (3 days) on rough weeks and pick up where you left off.',
  days: [
    {
      name: 'Push A',
      exercises: [
        compound(WGER.bench, 'Bench Press', 3, 6, 8, 2.5),
        compound(WGER.ohp, 'Overhead Press', 3, 8, 10, 2.5),
        compound(WGER.inclineBench, 'Incline Bench Press', 3, 8, 12, 2.5),
        accessory(WGER.lateralRaise, 'Lateral Raises', 3, 12, 15),
        accessory(WGER.tricepsPushdown, 'Triceps Pushdown', 3, 10, 12),
      ],
    },
    {
      name: 'Pull A',
      exercises: [
        {
          wgerExerciseId: WGER.deadlift,
          name: 'Deadlifts',
          sets: work(1, 5, null, 180),
          progression: linear(5),
        },
        accessory(WGER.pullUp, 'Pull-ups', 3, 6, 10),
        compound(WGER.cableRow, 'Seated Cable Row', 3, 8, 10, 2.5),
        accessory(WGER.facePull, 'Facepull', 3, 15, 20),
        accessory(WGER.barbellCurl, 'Biceps Curls With Barbell', 3, 10, 12),
      ],
    },
    {
      name: 'Legs A',
      exercises: [
        compound(WGER.squat, 'Squats', 3, 6, 8, 5),
        compound(WGER.rdl, 'Romanian Deadlift', 3, 8, 10, 2.5),
        accessory(WGER.legPress, 'Leg Press', 3, 10, 12),
        accessory(WGER.legCurl, 'Leg Curl', 3, 10, 12),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 3, 12, 15),
      ],
    },
    {
      name: 'Push B',
      exercises: [
        compound(WGER.ohp, 'Overhead Press', 3, 6, 8, 2.5),
        compound(WGER.bench, 'Bench Press', 3, 8, 10, 2.5),
        accessory(WGER.chestFly, 'Butterfly', 3, 12, 15),
        accessory(WGER.lateralRaise, 'Lateral Raises', 3, 12, 15),
        accessory(WGER.skullcrusher, 'Skullcrusher SZ-bar', 3, 10, 12),
      ],
    },
    {
      name: 'Pull B',
      exercises: [
        compound(WGER.row, 'Bent Over Rowing', 3, 6, 8, 2.5),
        compound(WGER.latPulldown, 'Lat Pull Down', 3, 8, 10, 2.5),
        accessory(WGER.chinUp, 'Chin Up', 3, 6, 10),
        accessory(WGER.facePull, 'Facepull', 3, 15, 20),
        accessory(WGER.dumbbellCurl, 'Biceps Curls With Dumbbell', 3, 10, 12),
      ],
    },
    {
      name: 'Legs B',
      exercises: [
        compound(WGER.squat, 'Squats', 3, 6, 8, 5),
        compound(WGER.hipThrust, 'Hip Thrust', 3, 8, 10, 2.5),
        accessory(WGER.legExtension, 'Leg Extension', 3, 12, 15),
        accessory(WGER.legCurl, 'Leg Curl', 3, 10, 12),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 3, 12, 15),
      ],
    },
  ],
}

// --- Upper / Lower (4-day) ---

const UPPER_LOWER: ProgramInputUnparsed = {
  name: 'Upper / Lower',
  status: 'draft',
  visibility: 'public',
  icon: '⚖️',
  mesocycleWeeks: 8,
  deloadWeek: 8,
  deloadPolicy: { mode: 'scheduled', shape: {} },
  sourceUrl: 'https://www.reddit.com/r/Fitness/wiki/routines/',
  description:
    'Four days, two halves: upper body twice, lower body twice — the strength-and-size middle ground between full-body and a six-day split.\n\nCompound lifts run double progression (add weight when every set hits the top of its range); accessories hold their rep ranges. Week 8 is a built-in deload — lighter loads, half the sets — then restart the block a notch heavier.',
  days: [
    {
      name: 'Upper A',
      exercises: [
        compound(WGER.bench, 'Bench Press', 4, 5, 8, 2.5),
        compound(WGER.row, 'Bent Over Rowing', 4, 5, 8, 2.5),
        compound(WGER.ohp, 'Overhead Press', 3, 8, 10, 2.5),
        accessory(WGER.latPulldown, 'Lat Pull Down', 3, 8, 10),
        accessory(WGER.barbellCurl, 'Biceps Curls With Barbell', 2, 10, 12),
        accessory(WGER.skullcrusher, 'Skullcrusher SZ-bar', 2, 10, 12),
      ],
    },
    {
      name: 'Lower A',
      exercises: [
        compound(WGER.squat, 'Squats', 4, 5, 8, 5),
        compound(WGER.rdl, 'Romanian Deadlift', 3, 8, 10, 2.5),
        accessory(WGER.legPress, 'Leg Press', 3, 10, 12),
        accessory(WGER.legCurl, 'Leg Curl', 2, 10, 12),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 3, 12, 15),
      ],
    },
    {
      name: 'Upper B',
      exercises: [
        compound(WGER.ohp, 'Overhead Press', 4, 5, 8, 2.5),
        accessory(WGER.chinUp, 'Chin Up', 4, 6, 10),
        compound(WGER.inclineBench, 'Incline Bench Press', 3, 8, 10, 2.5),
        accessory(WGER.cableRow, 'Seated Cable Row', 3, 8, 10),
        accessory(WGER.lateralRaise, 'Lateral Raises', 2, 12, 15),
        accessory(WGER.dumbbellCurl, 'Biceps Curls With Dumbbell', 2, 10, 12),
      ],
    },
    {
      name: 'Lower B',
      exercises: [
        compound(WGER.deadlift, 'Deadlifts', 3, 3, 5, 5),
        compound(WGER.hipThrust, 'Hip Thrust', 3, 8, 10, 2.5),
        accessory(WGER.legExtension, 'Leg Extension', 3, 12, 15),
        accessory(WGER.lunge, 'Dumbbell Lunges', 2, 10, 12),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 3, 12, 15),
      ],
    },
  ],
}

/** The library, in the order the seed script writes it. Names are the
 *  idempotency key: re-seeding updates the row with the same name. */
export const TEMPLATE_CANON: readonly ProgramInputUnparsed[] = [
  WENDLER_531,
  GZCLP,
  STRONGLIFTS,
  PPL,
  UPPER_LOWER,
]

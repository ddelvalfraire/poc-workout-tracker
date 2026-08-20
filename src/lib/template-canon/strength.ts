/**
 * Strength canon — barbell programs whose organizing idea is a number going
 * up. Scheme configs mirror the cited golden corpus (lib/testing/corpus.test.ts)
 * where a corpus entry exists:
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
 * The programs added beyond the corpus carry their divergences in their own
 * `description` — every one of them states, in the lifter's words, where this
 * app's week-axis engine departs from the published source. Training maxes and
 * starting loads are PLACEHOLDERS sized for a general intermediate; the
 * description tells the lifter to edit them, and the app prefills from history
 * where it can.
 */
import type { ProgramInputUnparsed } from '../program-input'
import { WGER } from './wger-ids'
import {
  accessory,
  doubleProgression,
  ladder,
  linear,
  straightSets,
  work,
  workPlus,
  type ExerciseIn,
} from './builders'

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
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg,
    wave: WAVE_531,
    waveReps: WAVE_REPS_531,
    restSec: 180,
    amrapSets: [2],
    deloadRow: { percents: [0.4, 0.5, 0.6], reps: 5 }, // 40/50/60% ×5 [W1]
  })
}

/** BBB-style supplemental volume: the day's lift again, 5×10, no scheme. */
function bbb(id: number, name: string): ExerciseIn {
  return { wgerExerciseId: id, name, sets: work(5, 10, null, 90) }
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
        straightSets(WGER.squat, 'Squats', 5, 5, 2.5),
        straightSets(WGER.bench, 'Bench Press', 5, 5, 2.5),
        straightSets(WGER.row, 'Bent Over Rowing', 5, 5, 2.5),
      ],
    },
    {
      name: 'Workout B',
      exercises: [
        straightSets(WGER.squat, 'Squats', 5, 5, 2.5),
        straightSets(WGER.ohp, 'Overhead Press', 5, 5, 2.5),
        straightSets(WGER.deadlift, 'Deadlifts', 1, 5, 5),
      ],
    },
    {
      name: 'Workout A (repeat)',
      exercises: [
        straightSets(WGER.squat, 'Squats', 5, 5, 2.5),
        straightSets(WGER.bench, 'Bench Press', 5, 5, 2.5),
        straightSets(WGER.row, 'Bent Over Rowing', 5, 5, 2.5),
      ],
    },
  ],
}

// --- Starting Strength ---

const STARTING_STRENGTH: ProgramInputUnparsed = {
  name: 'Starting Strength',
  status: 'draft',
  visibility: 'public',
  icon: '⚓',
  mesocycleWeeks: 12,
  deloadPolicy: { mode: 'reactive' },
  sourceUrl: 'https://startingstrength.com/get-started/programs',
  description:
    'Mark Rippetoe’s novice linear progression, stripped to the bar: three sets of five on a handful of lifts, three days a week, more weight every session for as long as your body will bank it.\n\nWorkout A: Squat 3×5, Press 3×5, Deadlift 1×5. Workout B: Squat 3×5, Bench 3×5, Power Clean 5×3. Alternate A/B/A, then B/A/B. Add +2.5 kg to the presses and +5 kg to squat and deadlift each session while it keeps working — that is the whole method, and it is the fastest strength you will ever buy.\n\nWhen a lift misses reps three sessions running, the app backs it off ~10% and you climb again. Swap Power Clean for Barbell Row if you have no coach and no platform.',
  days: [
    {
      name: 'Workout A',
      exercises: [
        straightSets(WGER.squat, 'Squats', 3, 5, 5),
        straightSets(WGER.ohp, 'Overhead Press', 3, 5, 2.5),
        straightSets(WGER.deadlift, 'Deadlifts', 1, 5, 5),
      ],
    },
    {
      name: 'Workout B',
      exercises: [
        straightSets(WGER.squat, 'Squats', 3, 5, 5),
        straightSets(WGER.bench, 'Bench Press', 3, 5, 2.5),
        straightSets(WGER.powerClean, 'Power Clean', 5, 3, 2.5, 150),
      ],
    },
    {
      name: 'Workout A (repeat)',
      exercises: [
        straightSets(WGER.squat, 'Squats', 3, 5, 5),
        straightSets(WGER.ohp, 'Overhead Press', 3, 5, 2.5),
        straightSets(WGER.deadlift, 'Deadlifts', 1, 5, 5),
      ],
    },
  ],
}

// --- Greyskull LP ---

/** Greyskull's signature shape: two straight sets, then a set taken to failure. */
function greyskull(id: number, name: string, incrementKg: number): ExerciseIn {
  return { wgerExerciseId: id, name, sets: workPlus(3, 5, 180), progression: linear(incrementKg) }
}

const GREYSKULL: ProgramInputUnparsed = {
  name: 'Greyskull LP',
  status: 'draft',
  visibility: 'public',
  icon: '💀',
  mesocycleWeeks: 12,
  deloadPolicy: { mode: 'reactive' },
  sourceUrl: 'https://www.boostcamp.app/coaches/john-sheaffer/greyskull-lp',
  description:
    'John Sheaffer’s Greyskull LP: a novice linear progression that ends every main lift with a set taken to failure, so the program finds your ceiling instead of guessing it.\n\nEvery lift is 2×5 then 1×5+ — the last set is an AMRAP, and the reps you get there are the honest record of the session. Add +2.5 kg upper / +5 kg lower per session, alternating A and B across three days a week. Hit ten or more on the AMRAP and you have earned a double jump.\n\nWhen the AMRAP drops under five for three sessions running, the app backs the lift off ~10% and you re-climb. Frequency is the point: everything gets pressed or pulled twice a week.',
  days: [
    {
      name: 'Workout A',
      exercises: [
        greyskull(WGER.ohp, 'Overhead Press', 2.5),
        greyskull(WGER.squat, 'Squats', 5),
        accessory(WGER.chinUp, 'Chin Up', 3, 6, 12),
      ],
    },
    {
      name: 'Workout B',
      exercises: [
        greyskull(WGER.bench, 'Bench Press', 2.5),
        greyskull(WGER.squat, 'Squats', 5),
        { wgerExerciseId: WGER.deadlift, name: 'Deadlifts', sets: workPlus(1, 5, 180), progression: linear(5) },
      ],
    },
    {
      name: 'Workout A (repeat)',
      exercises: [
        greyskull(WGER.ohp, 'Overhead Press', 2.5),
        greyskull(WGER.squat, 'Squats', 5),
        accessory(WGER.australianRow, 'Australian pull-ups', 3, 8, 15),
      ],
    },
  ],
}

// --- Madcow 5×5 ---

/** Madcow's ramp: four build sets into a top set of five, all off one TM. */
function madcowRamp(id: number, name: string, trainingMaxKg: number): ExerciseIn {
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg: 2.5,
    wave: [[0.5, 0.625, 0.75, 0.875, 1.0]],
    waveReps: [[5, 5, 5, 5, 5]],
    restSec: 180,
  })
}

/** The Wednesday light day: the same ramp, stopped three rungs up. */
function madcowLight(id: number, name: string, trainingMaxKg: number): ExerciseIn {
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg: 2.5,
    wave: [[0.5, 0.625, 0.75]],
    waveReps: [[5, 5, 5]],
    restSec: 150,
  })
}

/** Friday: ramp past Monday's top for a heavy triple, then one back-off eight. */
function madcowPr(id: number, name: string, trainingMaxKg: number): ExerciseIn {
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg: 2.5,
    wave: [[0.5, 0.625, 0.75, 0.875, 1.05, 0.75]],
    waveReps: [[5, 5, 5, 5, 3, 8]],
    restSec: 240,
    amrapSets: [4],
  })
}

const MADCOW: ProgramInputUnparsed = {
  name: 'Madcow 5×5',
  status: 'draft',
  visibility: 'public',
  icon: '🐄',
  mesocycleWeeks: 12,
  deloadPolicy: { mode: 'reactive' },
  planSync: false,
  sourceUrl: 'https://stronglifts.com/madcow-5x5/',
  description:
    'The intermediate sequel to 5×5: when adding weight every session stops working, add it every WEEK instead.\n\nMonday is the ramp — four build sets into a top set of five. Wednesday is light, the same ramp stopped three rungs up, to keep the groove without the fatigue. Friday is the record: ramp past Monday’s top set for a heavy triple, then drop back for one set of eight.\n\nThe whole week is percentages off one number per lift, so set your Training Maxes to a recent top set of five before you start. Everything climbs +2.5 kg per week; a missed triple means you repeat the week rather than push it.',
  days: [
    {
      name: 'Monday · Ramp',
      exercises: [
        madcowRamp(WGER.squat, 'Squats', 100),
        madcowRamp(WGER.bench, 'Bench Press', 80),
        madcowRamp(WGER.row, 'Bent Over Rowing', 70),
      ],
    },
    {
      name: 'Wednesday · Light',
      exercises: [
        madcowLight(WGER.squat, 'Squats', 100),
        madcowLight(WGER.ohp, 'Overhead Press', 50),
        madcowLight(WGER.deadlift, 'Deadlifts', 120),
      ],
    },
    {
      name: 'Friday · Heavy',
      exercises: [
        madcowPr(WGER.squat, 'Squats', 100),
        madcowPr(WGER.bench, 'Bench Press', 80),
        madcowPr(WGER.row, 'Bent Over Rowing', 70),
      ],
    },
  ],
}

// --- Texas Method ---

const TEXAS_METHOD: ProgramInputUnparsed = {
  name: 'Texas Method',
  status: 'draft',
  visibility: 'public',
  icon: '🤠',
  mesocycleWeeks: 12,
  deloadPolicy: { mode: 'reactive' },
  planSync: false,
  sourceUrl: 'https://startingstrength.com/article/the-texas-method',
  description:
    'Volume Monday, recovery Wednesday, a personal record Friday — the intermediate week that separates the three jobs a session can do instead of asking one session to do all three.\n\nMonday: 5×5 across at roughly 90% of Friday’s last top set. Wednesday: light squats and pressing, enough to move, not enough to cost. Friday: work up to ONE heavy set of five and beat last week by the smallest honest jump.\n\nThe program lives or dies on Wednesday actually being easy. Set your loads so Monday is hard but completable, and let Friday be the only day you chase a number.',
  days: [
    {
      name: 'Monday · Volume',
      exercises: [
        straightSets(WGER.squat, 'Squats', 5, 5, 2.5, 240),
        straightSets(WGER.bench, 'Bench Press', 5, 5, 2.5, 240),
        straightSets(WGER.row, 'Bent Over Rowing', 5, 5, 2.5, 150),
      ],
    },
    {
      name: 'Wednesday · Recovery',
      exercises: [
        { wgerExerciseId: WGER.squat, name: 'Squats', sets: work(2, 5, null, 150) },
        straightSets(WGER.ohp, 'Overhead Press', 3, 5, 2.5, 150),
        accessory(WGER.chinUp, 'Chin Up', 3, 6, 12),
        accessory(WGER.hyperextension, 'Hyperextensions', 3, 10, 15),
      ],
    },
    {
      name: 'Friday · Intensity',
      exercises: [
        straightSets(WGER.squat, 'Squats', 1, 5, 2.5, 300),
        straightSets(WGER.bench, 'Bench Press', 1, 5, 2.5, 300),
        straightSets(WGER.deadlift, 'Deadlifts', 1, 5, 5, 300),
      ],
    },
  ],
}

// --- nSuns 5/3/1 LP ---

/** The T1 ladder: nine sets off the TM, with the third and last taken to failure. */
function nsunsT1(id: number, name: string, trainingMaxKg: number, incrementKg: number): ExerciseIn {
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg,
    wave: [[0.65, 0.75, 0.85, 0.85, 0.85, 0.8, 0.75, 0.7, 0.65]],
    waveReps: [[5, 3, 1, 3, 3, 3, 5, 5, 5]],
    restSec: 150,
    amrapSets: [2, 8],
  })
}

/** The T2 ladder: eight lighter sets of the day's second lift. */
function nsunsT2(id: number, name: string, trainingMaxKg: number, incrementKg: number): ExerciseIn {
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg,
    wave: [[0.5, 0.6, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7]],
    waveReps: [[6, 5, 3, 5, 7, 4, 6, 8]],
    restSec: 120,
    amrapSets: [4],
  })
}

const NSUNS: ProgramInputUnparsed = {
  name: 'nSuns 5/3/1 LP',
  status: 'draft',
  visibility: 'public',
  icon: '☀️',
  mesocycleWeeks: 6,
  deloadPolicy: { mode: 'reactive' },
  planSync: false,
  sourceUrl: 'https://www.boostcamp.app/coaches/nsuns/nsuns-lp-4-day',
  description:
    'The high-volume rewrite of 5/3/1: the same Training Max idea, but nine working sets on the main lift and a bump every WEEK instead of every cycle.\n\nEach day runs a T1 ladder (65/75/85 · 85/85/80 · 75/70/65% for 5/3/1+ · 3/3/3 · 5/5/5+) and a T2 ladder of the day’s second lift. Two sets are AMRAPs — the third and the last on T1 — and the reps you post there are what tell you whether the weekly jump was earned.\n\nThis is a lot of volume. Four days: Bench+OHP, Squat+Sumo, OHP+Incline, Deadlift+Front Squat. Set your TMs at ~90% of a true max and expect the AMRAPs to be the hardest honest thing in your week.',
  days: [
    {
      name: 'Bench · OHP',
      exercises: [
        nsunsT1(WGER.bench, 'Bench Press', 90, 2.5),
        nsunsT2(WGER.ohp, 'Overhead Press', 55, 2.5),
        accessory(WGER.latPulldown, 'Lat Pull Down', 4, 10, 15),
      ],
    },
    {
      name: 'Squat · Sumo Deadlift',
      exercises: [
        nsunsT1(WGER.squat, 'Squats', 120, 5),
        nsunsT2(WGER.sumoDeadlift, 'Sumo Deadlift', 120, 5),
        accessory(WGER.legCurl, 'Leg Curl', 4, 10, 15),
      ],
    },
    {
      name: 'OHP · Incline',
      exercises: [
        nsunsT1(WGER.ohp, 'Overhead Press', 55, 2.5),
        nsunsT2(WGER.inclineBench, 'Incline Bench Press', 70, 2.5),
        accessory(WGER.cableRow, 'Seated Cable Row', 4, 10, 15),
      ],
    },
    {
      name: 'Deadlift · Front Squat',
      exercises: [
        nsunsT1(WGER.deadlift, 'Deadlifts', 150, 5),
        nsunsT2(WGER.frontSquat, 'Front Squats', 80, 5),
        accessory(WGER.abWheel, 'Ab wheel', 4, 8, 15),
      ],
    },
  ],
}

// --- Candito 6-Week Strength Program ---

/** Candito's block in one wave: volume → transition → heavy, week by week. */
function canditoWave(id: number, name: string, trainingMaxKg: number): ExerciseIn {
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg: 0, // the block peaks INSIDE the wave; retest, then re-enter with a new TM
    wave: [
      [0.65, 0.7, 0.7, 0.7],
      [0.7, 0.75, 0.75, 0.75],
      [0.75, 0.8, 0.8, 0.8],
      [0.8, 0.85, 0.85, 0.8],
      [0.85, 0.9, 0.925, 0.8],
    ],
    waveReps: [
      [8, 8, 8, 8],
      [6, 6, 6, 6],
      [5, 5, 5, 5],
      [4, 4, 4, 6],
      [3, 2, 1, 5],
    ],
    restSec: 210,
    deloadRow: { percents: [0.5, 0.6, 0.7], reps: 3 },
  })
}

const CANDITO_6_WEEK: ProgramInputUnparsed = {
  name: 'Candito 6-Week Strength',
  status: 'draft',
  visibility: 'public',
  icon: '📐',
  mesocycleWeeks: 6,
  deloadWeek: 6,
  deloadPolicy: { mode: 'scheduled', shape: { loadFactor: 0.6, setFactor: 0.5 } },
  planSync: false,
  checkInEveryDays: 14,
  sourceUrl: 'https://www.canditotraininghq.com/6-week-program/',
  description:
    'Jonnie Candito’s six-week block: start with volume you can actually recover from, walk the reps down and the percentages up, and finish standing over a heavier bar than you started under.\n\nWeek 1–2 build work capacity at 8s and 6s. Week 3 is the transition at 5s. Weeks 4–5 are the heavy end — 4s, then a top single with a back-off five. Week 6 deloads to 50/60/70% triples so week 7 can be a test day, not a recovery day.\n\nThis is a BLOCK, not a ladder you ride forever: run it once, retest, then re-enter with the new numbers. Set Training Maxes from a true recent max — the last two weeks are unforgiving of an inflated one.',
  days: [
    {
      name: 'Squat focus',
      exercises: [
        canditoWave(WGER.squat, 'Squats', 130),
        accessory(WGER.legPress, 'Leg Press', 3, 8, 12, doubleProgression(8, 12, 5)),
        accessory(WGER.legCurl, 'Leg Curl', 3, 10, 15, doubleProgression(10, 15, 2.5)),
      ],
    },
    {
      name: 'Bench focus',
      exercises: [
        canditoWave(WGER.bench, 'Bench Press', 95),
        accessory(WGER.closeGripBench, 'Bench Press Narrow Grip', 3, 6, 10, doubleProgression(6, 10, 2.5)),
        accessory(WGER.row, 'Bent Over Rowing', 4, 8, 12, doubleProgression(8, 12, 2.5)),
      ],
    },
    {
      name: 'Deadlift focus',
      exercises: [
        canditoWave(WGER.deadlift, 'Deadlifts', 160),
        accessory(WGER.rdl, 'Romanian Deadlift', 3, 8, 12, doubleProgression(8, 12, 5)),
        accessory(WGER.latPulldown, 'Lat Pull Down', 3, 10, 15, doubleProgression(10, 15, 2.5)),
      ],
    },
    {
      name: 'Press focus',
      exercises: [
        canditoWave(WGER.ohp, 'Overhead Press', 60),
        accessory(WGER.dips, 'Dips', 3, 6, 12),
        accessory(WGER.facePull, 'Facepull', 3, 12, 20, doubleProgression(12, 20, 2.5)),
      ],
    },
  ],
}

// --- Smolov Jr ---

/** One Smolov Jr day: N sets across at a fixed percentage of the max. */
function smolovDay(id: number, name: string, trainingMaxKg: number, sets: number, reps: number, percent: number): ExerciseIn {
  return ladder(id, name, {
    trainingMaxKg,
    incrementKg: 2.5, // the weekly bump: +2.5 kg bench / +5 kg squat
    wave: [Array.from({ length: sets }, () => percent)],
    waveReps: [Array.from({ length: sets }, () => reps)],
    restSec: 180,
  })
}

const SMOLOV_JR: ProgramInputUnparsed = {
  name: 'Smolov Jr',
  status: 'draft',
  visibility: 'public',
  icon: '🐻',
  mesocycleWeeks: 3,
  deloadPolicy: { mode: 'none' },
  planSync: false,
  checkInEveryDays: 7,
  sourceUrl: 'https://www.boostcamp.app/coaches/sergey-smolov/smolov-jr',
  description:
    'Three weeks of one lift, four times a week, at percentages that stop being funny by Wednesday. Smolov Jr is a specialization block — pick ONE lift (bench here; swap in squat if that is the goal) and let everything else idle.\n\nThe week: 6×6 at 70%, 7×5 at 75%, 8×4 at 80%, 10×3 at 85%. Add +2.5 kg (bench) or +5 kg (squat) to the whole week each week, then test in week four.\n\nRun this when you are eating and sleeping properly and have nothing else you need to be good at. It is not a program you extend, repeat back-to-back, or add accessories to — the volume IS the program.',
  days: [
    {
      name: 'Day 1 · 6×6 @ 70%',
      exercises: [smolovDay(WGER.bench, 'Bench Press', 100, 6, 6, 0.7)],
    },
    {
      name: 'Day 2 · 7×5 @ 75%',
      exercises: [smolovDay(WGER.bench, 'Bench Press', 100, 7, 5, 0.75)],
    },
    {
      name: 'Day 3 · 8×4 @ 80%',
      exercises: [smolovDay(WGER.bench, 'Bench Press', 100, 8, 4, 0.8)],
    },
    {
      name: 'Day 4 · 10×3 @ 85%',
      exercises: [smolovDay(WGER.bench, 'Bench Press', 100, 10, 3, 0.85)],
    },
  ],
}

export const STRENGTH_CANON: readonly ProgramInputUnparsed[] = [
  WENDLER_531,
  GZCLP,
  STRONGLIFTS,
  STARTING_STRENGTH,
  GREYSKULL,
  MADCOW,
  TEXAS_METHOD,
  NSUNS,
  CANDITO_6_WEEK,
  SMOLOV_JR,
]

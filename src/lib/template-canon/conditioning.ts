/**
 * Minimal-equipment and conditioning canon — the programs that do NOT assume
 * a barbell, and the ones whose unit of progress is a clock rather than a
 * plate.
 *
 * These are the canon's only users of the non-`reps_weight` metric modes, and
 * they are deliberate: a plank progresses in SECONDS, a couch-to-5K leg
 * progresses in seconds and metres, and neither should be dragged along by a
 * load-anchored scheme. Timed slots ride `rep-progression` (incrementSec),
 * bodyweight rep slots ride `rep-progression` (incrementReps) — the engine
 * moves the TARGET and leaves the load alone, which is the only honest thing
 * to do when there is no load to move.
 */
import type { ProgramInputUnparsed } from '../program-input'
import { WGER } from './wger-ids'
import {
  accessory,
  doubleProgression,
  repProgression,
  timed,
  timedDistance,
  work,
  type ExerciseIn,
  type SetIn,
} from './builders'

/** A bodyweight rep slot: the engine adds reps, never load. */
function bodyweight(
  id: number,
  name: string,
  count: number,
  repMin: number,
  repMax: number,
  restSec = 120,
): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: work(count, repMin, repMax, restSec),
    progression: repProgression({ reps: 1, maxReps: repMax * 2 }),
  }
}

/** A timed hold: the engine adds seconds up to a ceiling. */
function hold(
  id: number,
  name: string,
  count: number,
  durationSec: number,
  restSec: number,
  maxSec: number,
): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: timed(count, durationSec, restSec),
    progression: repProgression({ sec: 5, maxSec }),
  }
}

// --- r/bodyweightfitness Recommended Routine ---

const RECOMMENDED_ROUTINE: ProgramInputUnparsed = {
  name: 'Recommended Routine',
  status: 'draft',
  visibility: 'public',
  icon: '🤸',
  mesocycleWeeks: 12,
  deloadPolicy: { mode: 'reactive' },
  sourceUrl: 'https://www.reddit.com/r/bodyweightfitness/wiki/kb/recommended_routine/',
  description:
    'The r/bodyweightfitness Recommended Routine: a full-body calisthenics program that needs a pull-up bar, a floor, and about an hour, three days a week.\n\nSix movement pairs — a push and a pull, a squat and a hinge, a core hold and a core pull — supersetted so you are always working while something else recovers. Progress by REPS first: when you clear the top of the range on every set, move to the harder progression of that movement (knee push-ups → push-ups → diamond → archer, and so on).\n\nThe holds progress in seconds, not reps. Nothing here is load-anchored, so the app adds targets rather than weight — swap in the harder variant yourself when the range gets easy, because that jump is a judgement call no engine should make for you.',
  days: [
    {
      name: 'Full Body A',
      exercises: [
        { ...bodyweight(WGER.pullUp, 'Pull-ups', 3, 5, 8, 150), supersetGroup: 1 },
        { ...bodyweight(WGER.dips, 'Dips', 3, 5, 8, 150), supersetGroup: 1 },
        { ...bodyweight(WGER.pistolSquat, 'Pistol Squat', 3, 5, 8), supersetGroup: 2 },
        { ...bodyweight(WGER.nordicCurl, 'Nordic Curl', 3, 5, 8), supersetGroup: 2 },
        { ...hold(WGER.plank, 'Plank', 3, 45, 60, 120), supersetGroup: 3 },
        { ...hold(WGER.lSit, 'L-sit', 3, 20, 60, 60), supersetGroup: 3 },
      ],
    },
    {
      name: 'Full Body B',
      exercises: [
        { ...bodyweight(WGER.australianRow, 'Australian pull-ups', 3, 8, 12, 150), supersetGroup: 1 },
        { ...bodyweight(WGER.pushUp, 'Push-Up', 3, 8, 12, 150), supersetGroup: 1 },
        { ...bodyweight(WGER.bulgarianSplitSquat, 'Bulgarian Squat with Dumbbells', 3, 8, 12), supersetGroup: 2 },
        { ...bodyweight(WGER.hipThrust, 'Hip Thrust', 3, 8, 12), supersetGroup: 2 },
        { ...hold(WGER.sidePlank, 'Side Plank', 3, 30, 45, 90), supersetGroup: 3 },
        { ...bodyweight(WGER.hangingLegRaise, 'Hanging Leg Raises', 3, 5, 10, 60), supersetGroup: 3 },
      ],
    },
    {
      name: 'Full Body C',
      exercises: [
        { ...bodyweight(WGER.chinUp, 'Chin Up', 3, 5, 8, 150), supersetGroup: 1 },
        { ...bodyweight(WGER.pikePushUp, 'Pike Push Ups', 3, 5, 10, 150), supersetGroup: 1 },
        { ...bodyweight(WGER.stepUp, 'Step-ups', 3, 8, 12), supersetGroup: 2 },
        { ...bodyweight(WGER.nordicCurl, 'Nordic Curl', 3, 5, 8), supersetGroup: 2 },
        { ...hold(WGER.plank, 'Plank', 3, 45, 60, 120), supersetGroup: 3 },
        { ...bodyweight(WGER.abWheel, 'Ab wheel', 3, 6, 12, 60), supersetGroup: 3 },
      ],
    },
  ],
}

// --- Dumbbell Only ---

const DUMBBELL_ONLY: ProgramInputUnparsed = {
  name: 'Dumbbell Only',
  status: 'draft',
  visibility: 'public',
  icon: '🏠',
  mesocycleWeeks: 8,
  deloadWeek: 8,
  deloadPolicy: { mode: 'scheduled', shape: {} },
  sourceUrl: 'https://www.muscleandstrength.com/workouts/dumbbell-only-workout-routine',
  description:
    'Everything a pair of adjustable dumbbells can do, three days a week, no rack and no bar.\n\nFull body each session, rotating which pattern leads: a squat or hinge, a press, a row, a carry or a hold. Rep ranges sit at 8–15 because dumbbell jumps are big — you will usually add a rep before you can add a plate, and double progression handles exactly that.\n\nIf your dumbbells cap out, this stops being a strength program and becomes a maintenance one. That is a fine thing for it to be; just do not expect the numbers to keep climbing forever with a 25 kg ceiling.',
  days: [
    {
      name: 'Full Body A',
      exercises: [
        accessory(WGER.gobletSquat, 'Dumbbell Goblet Squat', 4, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 4, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.inclineDbRow, 'Incline Dumbbell Row', 4, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.dbShoulderPress, 'Shoulder Press, Dumbbells', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.farmersCarry, "Dumbbell farmer's carry", 3, 20, 40, doubleProgression(20, 40, 2.5)),
      ],
    },
    {
      name: 'Full Body B',
      exercises: [
        accessory(WGER.bulgarianSplitSquat, 'Bulgarian Squat with Dumbbells', 4, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.rdl, 'Romanian Deadlift', 4, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.pushUp, 'Push-Up', 3, 10, 20),
        accessory(WGER.arnoldPress, 'Arnold Shoulder Press', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.hammerCurl, 'Hammer Curls', 3, 10, 15, doubleProgression(10, 15, 2.5)),
      ],
    },
    {
      name: 'Full Body C',
      exercises: [
        accessory(WGER.lunge, 'Dumbbell Lunges Standing', 4, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.stepUp, 'Step-ups', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.inclineDbFly, 'Incline Dumbbell Fly', 3, 12, 15, doubleProgression(12, 15, 2.5)),
        accessory(WGER.lateralRaise, 'Lateral Raises', 4, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.dbOverheadTriceps, 'Triceps Overhead (Dumbbell)', 3, 10, 15, doubleProgression(10, 15, 2.5)),
      ],
    },
  ],
}

// --- Kettlebell Simple & Sinister ---

const SIMPLE_AND_SINISTER: ProgramInputUnparsed = {
  name: 'Kettlebell Simple & Sinister',
  status: 'draft',
  visibility: 'public',
  icon: '🔔',
  mesocycleWeeks: 12,
  deloadPolicy: { mode: 'reactive' },
  planSync: false,
  sourceUrl: 'https://www.strongfirst.com/simple-sinister/',
  description:
    'Pavel Tsatsouline’s Simple & Sinister: two movements, every day, until they are easy — then heavier.\n\nTen sets of ten one-hand swings, then five get-ups per side. The standard is not "finish it" but "finish it fresh": rest as long as you need at first, then compress the rest until the whole session takes about thirty minutes with no gasping. Only then do you pick up the next bell.\n\nSwings are timed sets here because the clock is the actual variable — the reps do not change, the rest does. This is a practice, not a block; there is no deload week because there is no peak.',
  days: [
    {
      name: 'The practice',
      exercises: [
        {
          wgerExerciseId: WGER.kettlebellSwing,
          name: 'Kettlebell Swing',
          // No scheme: S&S progresses by COMPRESSING REST and then changing
          // bells, neither of which is a target the engine may move for you.
          sets: timed(10, 30, 60),
        },
        {
          wgerExerciseId: WGER.turkishGetUp,
          name: 'Turkish Get-Up',
          sets: timed(10, 60, 30),
        },
      ],
    },
  ],
}

// --- Couch to 5K ---

/** One run leg: alternating jog and walk intervals, both timed + measured. */
function interval(jogSec: number, jogM: number, walkSec: number, walkM: number, repeats: number): SetIn[] {
  return Array.from({ length: repeats }, () => [
    timedDistance(jogSec, jogM, 0),
    timedDistance(walkSec, walkM, 0),
  ]).flat()
}

const COUCH_TO_5K: ProgramInputUnparsed = {
  name: 'Couch to 5K',
  status: 'draft',
  visibility: 'public',
  icon: '👟',
  mesocycleWeeks: 9,
  deloadPolicy: { mode: 'none' },
  planSync: false,
  sourceUrl: 'https://www.nhs.uk/live-well/exercise/running-and-aerobic-exercises/get-running-with-couch-to-5k/',
  description:
    'Nine weeks from not running to running five kilometres, three sessions a week, built entirely out of alternating jog and walk intervals.\n\nWeek 1 is sixty seconds of jogging against ninety of walking, eight times. By week 9 the walking is gone and the jog is a continuous thirty minutes. The distances shown beside each interval assume a gentle 6 min/km jog and a 12 min/km walk — enter what you actually cover and the app keeps your record, not the estimate.\n\nEvery session opens with a five-minute brisk walk. The pace does not matter; finishing the intervals does. If a week feels too hard, repeat it — the plan is nine weeks for most people and twelve for plenty of others.',
  days: [
    {
      name: 'Run 1',
      exercises: [
        {
          wgerExerciseId: WGER.walking,
          name: 'Walking',
          sets: [timedDistance(300, 500, 0)],
        },
        {
          wgerExerciseId: WGER.jogging,
          name: 'Jogging',
          sets: interval(60, 170, 90, 125, 8),
          progression: repProgression({ sec: 15, maxSec: 1800 }),
        },
      ],
    },
    {
      name: 'Run 2',
      exercises: [
        {
          wgerExerciseId: WGER.walking,
          name: 'Walking',
          sets: [timedDistance(300, 500, 0)],
        },
        {
          wgerExerciseId: WGER.jogging,
          name: 'Jogging',
          sets: interval(90, 250, 120, 165, 6),
          progression: repProgression({ sec: 15, maxSec: 1800 }),
        },
      ],
    },
    {
      name: 'Run 3',
      exercises: [
        {
          wgerExerciseId: WGER.walking,
          name: 'Walking',
          sets: [timedDistance(300, 500, 0)],
        },
        {
          wgerExerciseId: WGER.jogging,
          name: 'Jogging',
          sets: interval(120, 335, 90, 125, 5),
          progression: repProgression({ sec: 20, maxSec: 1800 }),
        },
      ],
    },
  ],
}

// --- Hybrid: lift and run ---

const HYBRID: ProgramInputUnparsed = {
  name: 'Hybrid Strength & Endurance',
  status: 'draft',
  visibility: 'public',
  icon: '🧭',
  mesocycleWeeks: 8,
  deloadWeek: 8,
  deloadPolicy: { mode: 'scheduled', shape: { loadFactor: 0.8, setFactor: 0.5, timedExercises: 'scaled' } },
  checkInEveryDays: 14,
  sourceUrl: 'https://www.trainingpeaks.com/blog/concurrent-training-strength-and-endurance/',
  description:
    'Two lifting days and two conditioning days, arranged so neither one eats the other: the lifts stay heavy and low-volume, the runs stay easy and long.\n\nThe interference effect is real but overstated — it bites hardest when hard intervals land next to heavy legs. So the hard lifting sits on Monday and Thursday, the easy aerobic work on Tuesday and Saturday, and nothing is scheduled to be maximal on consecutive days.\n\nThe deload week scales the timed work too, not just the bars — a rare case where backing off the clock is the point. Distances are placeholders; enter what you actually ran.',
  days: [
    {
      name: 'Lift · Lower',
      exercises: [
        accessory(WGER.squat, 'Squats', 4, 4, 6, doubleProgression(4, 6, 5)),
        accessory(WGER.rdl, 'Romanian Deadlift', 3, 6, 10, doubleProgression(6, 10, 5)),
        accessory(WGER.bulgarianSplitSquat, 'Bulgarian Squat with Dumbbells', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        hold(WGER.plank, 'Plank', 3, 45, 60, 120),
      ],
    },
    {
      name: 'Easy aerobic',
      exercises: [
        {
          wgerExerciseId: WGER.jogging,
          name: 'Jogging',
          sets: [timedDistance(2400, 6000, 0)],
          progression: repProgression({ sec: 120, maxSec: 4800 }),
        },
      ],
    },
    {
      name: 'Lift · Upper',
      exercises: [
        accessory(WGER.bench, 'Bench Press', 4, 4, 6, doubleProgression(4, 6, 2.5)),
        accessory(WGER.pullUp, 'Pull-ups', 4, 5, 10),
        accessory(WGER.ohp, 'Overhead Press', 3, 6, 10, doubleProgression(6, 10, 2.5)),
        accessory(WGER.cableRow, 'Seated Cable Row', 3, 8, 12, doubleProgression(8, 12, 2.5)),
      ],
    },
    {
      name: 'Long aerobic',
      exercises: [
        {
          wgerExerciseId: WGER.rowingMachine,
          name: 'Rowing Machine',
          sets: [timedDistance(1200, 5000, 180)],
          progression: repProgression({ sec: 60, maxSec: 2700 }),
        },
        {
          wgerExerciseId: WGER.cycling,
          name: 'Cycling',
          sets: [timedDistance(1800, 12000, 0)],
          progression: repProgression({ sec: 120, maxSec: 5400 }),
        },
      ],
    },
  ],
}

export const CONDITIONING_CANON: readonly ProgramInputUnparsed[] = [
  RECOMMENDED_ROUTINE,
  DUMBBELL_ONLY,
  SIMPLE_AND_SINISTER,
  COUCH_TO_5K,
  HYBRID,
]

/**
 * Hypertrophy canon — programs organized around weekly volume per muscle
 * rather than a single number going up. No published oracle governs these the
 * way the corpus governs 5/3/1; they are structure templates, and their
 * progression is honest double-progression (add reps to the top of the range,
 * then add load) except where a program's own idea is volume ramping, which
 * rides the `weekly-volume` scheme.
 *
 * Loads are unset on purpose: a rep-range slot's first week is a calibration
 * week. The lifter enters what they used, and the engine takes it from there.
 */
import type { ProgramInputUnparsed } from '../program-input'
import { WGER } from './wger-ids'
import {
  accessory,
  compound,
  doubleProgression,
  weeklyVolume,
  work,
  type ExerciseIn,
} from './builders'

/** A power slot: low reps, long rest, double progression on a tight range. */
function power(id: number, name: string, count: number, incrementKg: number): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: work(count, 3, 5, 210),
    progression: doubleProgression(3, 5, incrementKg),
  }
}

/** A pump slot: high reps, short rest, the last set taken to failure. */
function pump(id: number, name: string, count: number, repMin: number, repMax: number): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: [
      ...work(count - 1, repMin, repMax, 60),
      { repMin, repMax, restSec: 60, setType: 'amrap' },
    ],
    progression: doubleProgression(repMin, repMax, 2.5),
  }
}

// --- Push Pull Legs (6-day) ---

const PPL: ProgramInputUnparsed = {
  name: 'Push Pull Legs',
  status: 'draft',
  visibility: 'public',
  icon: '🔁',
  mesocycleWeeks: 6,
  sourceUrl: 'https://www.muscleandstrength.com/workouts/6-day-push-pull-legs-workout',
  description:
    'The highest-frequency split that still lets a muscle recover: push, pull, legs, twice a week each.\n\nEvery session opens with a compound on double progression — work the top of the rep range on every set, then add weight and start again at the bottom. Accessories chase the range, not the number.\n\nSix days is a commitment. Run it as A/B (heavier ranges on the first rotation, higher on the second) and drop to three days without guilt when the week goes sideways.',
  days: [
    {
      name: 'Push A',
      exercises: [
        compound(WGER.bench, 'Bench Press', 4, 5, 8, 2.5),
        compound(WGER.ohp, 'Overhead Press', 3, 6, 10, 2.5),
        accessory(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.lateralRaise, 'Lateral Raises', 4, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.tricepsPushdown, 'Triceps Pushdown', 3, 10, 15, doubleProgression(10, 15, 2.5)),
      ],
    },
    {
      name: 'Pull A',
      exercises: [
        compound(WGER.deadlift, 'Deadlifts', 3, 4, 6, 5),
        compound(WGER.pullUp, 'Pull-ups', 4, 5, 10, 2.5),
        accessory(WGER.cableRow, 'Seated Cable Row', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.facePull, 'Facepull', 3, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.barbellCurl, 'Biceps Curls With Barbell', 3, 8, 12, doubleProgression(8, 12, 2.5)),
      ],
    },
    {
      name: 'Legs A',
      exercises: [
        compound(WGER.squat, 'Squats', 4, 5, 8, 5),
        compound(WGER.rdl, 'Romanian Deadlift', 3, 8, 12, 5),
        accessory(WGER.legPress, 'Leg Press', 3, 10, 15, doubleProgression(10, 15, 5)),
        accessory(WGER.legCurl, 'Leg Curl', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 4, 12, 20, doubleProgression(12, 20, 2.5)),
      ],
    },
    {
      name: 'Push B',
      exercises: [
        compound(WGER.ohp, 'Overhead Press', 4, 5, 8, 2.5),
        compound(WGER.inclineBench, 'Incline Bench Press', 3, 6, 10, 2.5),
        accessory(WGER.chestFly, 'Butterfly', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.lateralRaise, 'Lateral Raises', 4, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.skullcrusher, 'Skullcrusher', 3, 8, 12, doubleProgression(8, 12, 2.5)),
      ],
    },
    {
      name: 'Pull B',
      exercises: [
        compound(WGER.row, 'Bent Over Rowing', 4, 6, 10, 2.5),
        compound(WGER.latPulldown, 'Lat Pull Down', 3, 8, 12, 2.5),
        accessory(WGER.inclineDbRow, 'Incline Dumbbell Row', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.rearDeltRaise, 'Rear Delt Raises', 3, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.hammerCurl, 'Hammer Curls', 3, 10, 15, doubleProgression(10, 15, 2.5)),
      ],
    },
    {
      name: 'Legs B',
      exercises: [
        compound(WGER.frontSquat, 'Front Squats', 4, 5, 8, 5),
        compound(WGER.hipThrust, 'Hip Thrust', 3, 8, 12, 5),
        accessory(WGER.bulgarianSplitSquat, 'Bulgarian Squat with Dumbbells', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.legExtension, 'Leg Extension', 3, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 4, 12, 20, doubleProgression(12, 20, 2.5)),
      ],
    },
  ],
}

// --- Upper / Lower ---

const UPPER_LOWER: ProgramInputUnparsed = {
  name: 'Upper / Lower',
  status: 'draft',
  visibility: 'public',
  icon: '⚖️',
  mesocycleWeeks: 8,
  deloadWeek: 8,
  deloadPolicy: { mode: 'scheduled', shape: {} },
  sourceUrl: 'https://www.muscleandstrength.com/workouts/4-day-upper-lower-body-split',
  description:
    'Four days, everything trained twice a week, and no session so long you start negotiating with it. The most defensible split there is for a lifter who is past novice and has a job.\n\nEach day opens with a compound in a low rep range and fills out with accessories in the 8–15 range, all on double progression. Week 8 is a scheduled deload — half the sets at 85% — so the block ends on purpose instead of on a bad week.\n\nA/B rotation keeps the same movement patterns without the same exercises going stale.',
  days: [
    {
      name: 'Upper A',
      exercises: [
        compound(WGER.bench, 'Bench Press', 4, 5, 8, 2.5),
        compound(WGER.row, 'Bent Over Rowing', 4, 6, 10, 2.5),
        accessory(WGER.dbShoulderPress, 'Shoulder Press, Dumbbells', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.latPulldown, 'Lat Pull Down', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.dumbbellCurl, 'Biceps Curls With Dumbbell', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.tricepsPushdown, 'Triceps Pushdown', 3, 10, 15, doubleProgression(10, 15, 2.5)),
      ],
    },
    {
      name: 'Lower A',
      exercises: [
        compound(WGER.squat, 'Squats', 4, 5, 8, 5),
        compound(WGER.rdl, 'Romanian Deadlift', 3, 8, 12, 5),
        accessory(WGER.legPress, 'Leg Press', 3, 10, 15, doubleProgression(10, 15, 5)),
        accessory(WGER.legCurl, 'Leg Curl', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 4, 12, 20, doubleProgression(12, 20, 2.5)),
      ],
    },
    {
      name: 'Upper B',
      exercises: [
        compound(WGER.ohp, 'Overhead Press', 4, 5, 8, 2.5),
        compound(WGER.pullUp, 'Pull-ups', 4, 5, 10, 2.5),
        accessory(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.cableRow, 'Seated Cable Row', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.lateralRaise, 'Lateral Raises', 4, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.facePull, 'Facepull', 3, 12, 20, doubleProgression(12, 20, 2.5)),
      ],
    },
    {
      name: 'Lower B',
      exercises: [
        compound(WGER.deadlift, 'Deadlifts', 3, 4, 6, 5),
        compound(WGER.frontSquat, 'Front Squats', 3, 6, 10, 5),
        accessory(WGER.lunge, 'Dumbbell Lunges Standing', 3, 10, 15, doubleProgression(10, 15, 2.5)),
        accessory(WGER.legExtension, 'Leg Extension', 3, 12, 20, doubleProgression(12, 20, 2.5)),
        accessory(WGER.hangingLegRaise, 'Hanging Leg Raises', 3, 8, 15),
      ],
    },
  ],
}

// --- PHUL ---

const PHUL: ProgramInputUnparsed = {
  name: 'PHUL',
  status: 'draft',
  visibility: 'public',
  icon: '🧬',
  mesocycleWeeks: 8,
  deloadWeek: 8,
  deloadPolicy: { mode: 'scheduled', shape: {} },
  sourceUrl: 'https://www.muscleandstrength.com/workouts/phul-workout',
  description:
    'Power Hypertrophy Upper Lower: four days that stop making you choose between getting strong and getting big.\n\nThe first two days are POWER — 3–5 reps, long rests, the compounds you actually care about. The last two are HYPERTROPHY — 8–15 reps on the same patterns with different tools, short rests, the last set of the pump work taken to failure.\n\nEverything runs on double progression: climb to the top of the range on every set, then add the smallest plate you own. Week 8 deloads. It is the standard answer to "I want both" and it is a good answer.',
  days: [
    {
      name: 'Upper Power',
      exercises: [
        power(WGER.bench, 'Bench Press', 4, 2.5),
        power(WGER.row, 'Bent Over Rowing', 4, 2.5),
        accessory(WGER.inclineBench, 'Incline Bench Press', 3, 6, 10, doubleProgression(6, 10, 2.5)),
        accessory(WGER.latPulldown, 'Lat Pull Down', 3, 6, 10, doubleProgression(6, 10, 2.5)),
        accessory(WGER.barbellCurl, 'Biceps Curls With Barbell', 3, 6, 10, doubleProgression(6, 10, 2.5)),
        accessory(WGER.skullcrusher, 'Skullcrusher', 3, 6, 10, doubleProgression(6, 10, 2.5)),
      ],
    },
    {
      name: 'Lower Power',
      exercises: [
        power(WGER.squat, 'Squats', 4, 5),
        power(WGER.deadlift, 'Deadlifts', 4, 5),
        accessory(WGER.legPress, 'Leg Press', 3, 8, 12, doubleProgression(8, 12, 5)),
        accessory(WGER.legCurl, 'Leg Curl', 3, 8, 12, doubleProgression(8, 12, 2.5)),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 4, 8, 12, doubleProgression(8, 12, 2.5)),
      ],
    },
    {
      name: 'Upper Hypertrophy',
      exercises: [
        pump(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 3, 10, 15),
        pump(WGER.cableCrossover, 'Cable Cross-over', 3, 10, 15),
        pump(WGER.cableRow, 'Seated Cable Row', 3, 10, 15),
        pump(WGER.latPulldown, 'Lat Pull Down', 3, 10, 15),
        pump(WGER.lateralRaise, 'Lateral Raises', 3, 12, 20),
        pump(WGER.hammerCurl, 'Hammer Curls', 3, 10, 15),
        pump(WGER.tricepsPushdown, 'Triceps Pushdown', 3, 10, 15),
      ],
    },
    {
      name: 'Lower Hypertrophy',
      exercises: [
        pump(WGER.frontSquat, 'Front Squats', 3, 8, 12),
        pump(WGER.lunge, 'Dumbbell Lunges Standing', 3, 10, 15),
        pump(WGER.legExtension, 'Leg Extension', 3, 12, 20),
        pump(WGER.legCurl, 'Leg Curl', 3, 12, 20),
        pump(WGER.calfRaise, 'Standing Calf Raises', 4, 15, 25),
      ],
    },
  ],
}

// --- PHAT ---

const PHAT: ProgramInputUnparsed = {
  name: 'PHAT',
  status: 'draft',
  visibility: 'public',
  icon: '🐘',
  mesocycleWeeks: 8,
  deloadWeek: 8,
  deloadPolicy: { mode: 'scheduled', shape: {} },
  sourceUrl: 'https://www.muscleandstrength.com/workouts/layne-norton-phat-workout',
  description:
    'Layne Norton’s Power Hypertrophy Adaptive Training: five days built on the observation that a bigger muscle has a higher ceiling and a stronger muscle can move enough weight to earn one.\n\nTwo power days open the week — upper and lower, 3–5 reps, the heavy compounds. Three hypertrophy days follow, split back/shoulders, lower, chest/arms, in the 8–20 range with the last set of each pump movement taken to failure.\n\nFive days and a lot of sets. Run it when your sleep and food are handled; drop the last hypertrophy day before you drop a power day if the week compresses.',
  days: [
    {
      name: 'Upper Power',
      exercises: [
        power(WGER.row, 'Bent Over Rowing', 3, 2.5),
        power(WGER.pullUp, 'Pull-ups', 2, 2.5),
        power(WGER.bench, 'Bench Press', 3, 2.5),
        power(WGER.ohp, 'Overhead Press', 2, 2.5),
        accessory(WGER.barbellCurl, 'Biceps Curls With Barbell', 3, 6, 10, doubleProgression(6, 10, 2.5)),
        accessory(WGER.skullcrusher, 'Skullcrusher', 3, 6, 10, doubleProgression(6, 10, 2.5)),
      ],
    },
    {
      name: 'Lower Power',
      exercises: [
        power(WGER.squat, 'Squats', 3, 5),
        power(WGER.deadlift, 'Deadlifts', 3, 5),
        accessory(WGER.legPress, 'Leg Press', 2, 6, 10, doubleProgression(6, 10, 5)),
        accessory(WGER.legCurl, 'Leg Curl', 3, 6, 10, doubleProgression(6, 10, 2.5)),
        accessory(WGER.calfRaise, 'Standing Calf Raises', 4, 6, 10, doubleProgression(6, 10, 2.5)),
      ],
    },
    {
      name: 'Back · Shoulders',
      exercises: [
        pump(WGER.row, 'Bent Over Rowing', 4, 8, 12),
        pump(WGER.latPulldown, 'Lat Pull Down', 3, 10, 15),
        pump(WGER.cableRow, 'Seated Cable Row', 3, 12, 15),
        pump(WGER.dbShoulderPress, 'Shoulder Press, Dumbbells', 3, 8, 12),
        pump(WGER.lateralRaise, 'Lateral Raises', 3, 12, 20),
        pump(WGER.rearDeltRaise, 'Rear Delt Raises', 3, 12, 20),
      ],
    },
    {
      name: 'Lower Hypertrophy',
      exercises: [
        pump(WGER.squat, 'Squats', 3, 8, 12),
        pump(WGER.hackSquat, 'Hack Squats', 3, 10, 15),
        pump(WGER.legExtension, 'Leg Extension', 3, 15, 20),
        pump(WGER.rdl, 'Romanian Deadlift', 3, 8, 12),
        pump(WGER.legCurl, 'Leg Curl', 3, 12, 20),
        pump(WGER.calfRaise, 'Standing Calf Raises', 4, 12, 20),
      ],
    },
    {
      name: 'Chest · Arms',
      exercises: [
        pump(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 4, 8, 12),
        pump(WGER.pecDeck, 'Pec Deck', 3, 12, 15),
        pump(WGER.cableCrossover, 'Cable Cross-over', 3, 15, 20),
        pump(WGER.preacherCurl, 'Preacher Curls', 3, 10, 15),
        pump(WGER.dumbbellCurl, 'Biceps Curls With Dumbbell', 3, 12, 20),
        pump(WGER.tricepsPushdown, 'Triceps Pushdown', 3, 12, 20),
        pump(WGER.dbOverheadTriceps, 'Triceps Overhead (Dumbbell)', 3, 12, 20),
      ],
    },
  ],
}

// --- Arnold Split ---

const ARNOLD_SPLIT: ProgramInputUnparsed = {
  name: 'Arnold Split',
  status: 'draft',
  visibility: 'public',
  icon: '🏆',
  mesocycleWeeks: 6,
  deloadWeek: 6,
  deloadPolicy: { mode: 'scheduled', shape: { loadFactor: 0.8, setFactor: 0.5 } },
  sourceUrl: 'https://www.muscleandstrength.com/workouts/arnold-schwarzenegger-blueprint-workout',
  description:
    'Chest and back together, shoulders and arms together, legs twice — six days of Golden Era volume, on the theory that antagonist muscles trained in the same session pump each other up.\n\nThe pairings are the point: pressing against pulling, biceps against triceps. Rep ranges live in the 8–15 zone, rest stays short, and the last set of most movements goes to failure.\n\nThis is a lot of work and it assumes you recover like someone who has nothing else to do. Week 6 deloads hard — 80% load, half the sets. If six days is fantasy, run days 1–3 and repeat.',
  days: [
    {
      name: 'Chest · Back',
      exercises: [
        pump(WGER.bench, 'Bench Press', 4, 8, 12),
        pump(WGER.inclineBench, 'Incline Bench Press', 4, 8, 12),
        pump(WGER.chestFly, 'Butterfly', 3, 10, 15),
        pump(WGER.pullUp, 'Pull-ups', 4, 6, 12),
        pump(WGER.row, 'Bent Over Rowing', 4, 8, 12),
        pump(WGER.tBarRow, 'T-Bar row', 3, 10, 15),
      ],
    },
    {
      name: 'Shoulders · Arms',
      exercises: [
        pump(WGER.ohp, 'Overhead Press', 4, 8, 12),
        pump(WGER.arnoldPress, 'Arnold Shoulder Press', 3, 10, 15),
        pump(WGER.lateralRaise, 'Lateral Raises', 4, 12, 20),
        pump(WGER.barbellCurl, 'Biceps Curls With Barbell', 4, 8, 12),
        pump(WGER.preacherCurl, 'Preacher Curls', 3, 10, 15),
        pump(WGER.skullcrusher, 'Skullcrusher', 4, 8, 12),
        pump(WGER.tricepsPushdown, 'Triceps Pushdown', 3, 12, 20),
      ],
    },
    {
      name: 'Legs · Core',
      exercises: [
        pump(WGER.squat, 'Squats', 5, 8, 12),
        pump(WGER.legPress, 'Leg Press', 4, 10, 15),
        pump(WGER.legCurl, 'Leg Curl', 4, 10, 15),
        pump(WGER.calfRaise, 'Standing Calf Raises', 5, 15, 25),
        accessory(WGER.hangingLegRaise, 'Hanging Leg Raises', 4, 10, 20),
      ],
    },
    {
      name: 'Chest · Back (2)',
      exercises: [
        pump(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 4, 8, 12),
        pump(WGER.dips, 'Dips', 4, 8, 15),
        pump(WGER.cableCrossover, 'Cable Cross-over', 3, 12, 20),
        pump(WGER.latPulldown, 'Lat Pull Down', 4, 10, 15),
        pump(WGER.cableRow, 'Seated Cable Row', 4, 10, 15),
        pump(WGER.barbellShrug, 'Shrugs, Barbells', 3, 12, 20),
      ],
    },
    {
      name: 'Shoulders · Arms (2)',
      exercises: [
        pump(WGER.dbShoulderPress, 'Shoulder Press, Dumbbells', 4, 10, 15),
        pump(WGER.lateralRaise, 'Lateral Raises', 4, 15, 25),
        pump(WGER.facePull, 'Facepull', 3, 15, 20),
        pump(WGER.hammerCurl, 'Hammer Curls', 4, 10, 15),
        pump(WGER.dumbbellCurl, 'Biceps Curls With Dumbbell', 3, 12, 20),
        pump(WGER.dbOverheadTriceps, 'Triceps Overhead (Dumbbell)', 4, 10, 15),
      ],
    },
    {
      name: 'Legs · Core (2)',
      exercises: [
        pump(WGER.frontSquat, 'Front Squats', 4, 8, 12),
        pump(WGER.rdl, 'Romanian Deadlift', 4, 8, 12),
        pump(WGER.legExtension, 'Leg Extension', 4, 15, 20),
        pump(WGER.lunge, 'Dumbbell Lunges Standing', 3, 10, 15),
        pump(WGER.calfRaise, 'Standing Calf Raises', 5, 15, 25),
        accessory(WGER.abWheel, 'Ab wheel', 3, 8, 15),
      ],
    },
  ],
}

// --- Body Part Split ---

const BODY_PART_SPLIT: ProgramInputUnparsed = {
  name: 'Body Part Split',
  status: 'draft',
  visibility: 'public',
  icon: '🗓️',
  mesocycleWeeks: 8,
  deloadWeek: 8,
  deloadPolicy: { mode: 'scheduled', shape: {} },
  sourceUrl: 'https://www.muscleandstrength.com/workouts/5-day-bodybuilder-split',
  description:
    'One muscle a day, five days a week — the split every commercial gym runs on Monday night, and the easiest one to actually stick to.\n\nChest, back, shoulders, legs, arms. Each day opens with a compound in the 6–10 range and fills out with 3–4 isolation movements at 10–20, last set to failure. Frequency is low, so the per-session volume is high.\n\nIf you are past your first two years and growth has stalled, an Upper/Lower or PPL split will hit each muscle twice a week and probably serve you better. If what you need is a plan you will not skip, this is it.',
  days: [
    {
      name: 'Chest',
      exercises: [
        compound(WGER.bench, 'Bench Press', 4, 6, 10, 2.5),
        pump(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 4, 8, 12),
        pump(WGER.pecDeck, 'Pec Deck', 3, 12, 15),
        pump(WGER.cableCrossover, 'Cable Cross-over', 3, 15, 20),
        pump(WGER.dips, 'Dips', 3, 8, 15),
      ],
    },
    {
      name: 'Back',
      exercises: [
        compound(WGER.deadlift, 'Deadlifts', 3, 5, 8, 5),
        pump(WGER.pullUp, 'Pull-ups', 4, 6, 12),
        pump(WGER.row, 'Bent Over Rowing', 4, 8, 12),
        pump(WGER.cableRow, 'Seated Cable Row', 3, 10, 15),
        pump(WGER.latPulldown, 'Lat Pull Down', 3, 12, 20),
      ],
    },
    {
      name: 'Shoulders',
      exercises: [
        compound(WGER.ohp, 'Overhead Press', 4, 6, 10, 2.5),
        pump(WGER.dbShoulderPress, 'Shoulder Press, Dumbbells', 3, 10, 15),
        pump(WGER.lateralRaise, 'Lateral Raises', 4, 12, 20),
        pump(WGER.rearDeltRaise, 'Rear Delt Raises', 3, 15, 20),
        pump(WGER.barbellShrug, 'Shrugs, Barbells', 3, 12, 20),
      ],
    },
    {
      name: 'Legs',
      exercises: [
        compound(WGER.squat, 'Squats', 4, 6, 10, 5),
        pump(WGER.legPress, 'Leg Press', 4, 10, 15),
        pump(WGER.rdl, 'Romanian Deadlift', 3, 8, 12),
        pump(WGER.legCurl, 'Leg Curl', 3, 12, 20),
        pump(WGER.legExtension, 'Leg Extension', 3, 15, 20),
        pump(WGER.calfRaise, 'Standing Calf Raises', 5, 15, 25),
      ],
    },
    {
      name: 'Arms',
      exercises: [
        compound(WGER.closeGripBench, 'Bench Press Narrow Grip', 4, 6, 10, 2.5),
        pump(WGER.barbellCurl, 'Biceps Curls With Barbell', 4, 8, 12),
        pump(WGER.skullcrusher, 'Skullcrusher', 4, 8, 12),
        pump(WGER.hammerCurl, 'Hammer Curls', 3, 10, 15),
        pump(WGER.tricepsPushdown, 'Triceps Pushdown', 3, 12, 20),
        pump(WGER.preacherCurl, 'Preacher Curls', 3, 12, 20),
      ],
    },
  ],
}

// --- Full Body Hypertrophy (volume-landmark block) ---

/** A volume-landmark slot: the engine ramps sets from MEV toward MRV. */
function landmark(id: number, name: string, mev: number, mrv: number, repMin: number, repMax: number): ExerciseIn {
  return {
    wgerExerciseId: id,
    name,
    sets: work(mev, repMin, repMax, 120),
    progression: weeklyVolume(mev, mrv),
  }
}

const FULL_BODY_HYPERTROPHY: ProgramInputUnparsed = {
  name: 'Full Body Hypertrophy',
  status: 'draft',
  visibility: 'public',
  icon: '📈',
  mesocycleWeeks: 6,
  deloadWeek: 6,
  deloadPolicy: { mode: 'scheduled', shape: { loadFactor: 0.7, setFactor: 0.5 } },
  checkInEveryDays: 14,
  sourceUrl: 'https://rpstrength.com/blogs/articles/training-volume-landmarks-muscle-growth',
  description:
    'Three full-body days that add SETS instead of weight — the volume-landmark model, where a block starts at the least work that still grows you and climbs toward the most you can recover from.\n\nEvery slot starts at its MEV (minimum effective volume) in week 1 and ramps toward MRV (maximum recoverable volume) by week 5. Week 6 halves the sets at 70% load and resets the whole thing. Load stays roughly constant inside the block; the stimulus comes from the sets.\n\nThe honest version of this needs feedback — the app asks for a check-in every two weeks. If a muscle is still sore when its next session comes around, you are at your MRV, and that is information, not failure.',
  days: [
    {
      name: 'Full Body A',
      exercises: [
        landmark(WGER.squat, 'Squats', 3, 5, 6, 10),
        landmark(WGER.bench, 'Bench Press', 3, 5, 6, 10),
        landmark(WGER.row, 'Bent Over Rowing', 3, 6, 8, 12),
        landmark(WGER.lateralRaise, 'Lateral Raises', 2, 5, 12, 20),
        landmark(WGER.legCurl, 'Leg Curl', 2, 4, 10, 15),
      ],
    },
    {
      name: 'Full Body B',
      exercises: [
        landmark(WGER.rdl, 'Romanian Deadlift', 3, 5, 8, 12),
        landmark(WGER.ohp, 'Overhead Press', 3, 5, 6, 10),
        landmark(WGER.latPulldown, 'Lat Pull Down', 3, 6, 8, 12),
        landmark(WGER.legPress, 'Leg Press', 2, 5, 10, 15),
        landmark(WGER.barbellCurl, 'Biceps Curls With Barbell', 2, 4, 10, 15),
      ],
    },
    {
      name: 'Full Body C',
      exercises: [
        landmark(WGER.frontSquat, 'Front Squats', 3, 5, 6, 10),
        landmark(WGER.inclineDbBench, 'Incline Bench Press - Dumbbell', 3, 5, 8, 12),
        landmark(WGER.cableRow, 'Seated Cable Row', 3, 6, 10, 15),
        landmark(WGER.calfRaise, 'Standing Calf Raises', 2, 5, 12, 20),
        landmark(WGER.tricepsPushdown, 'Triceps Pushdown', 2, 4, 10, 15),
      ],
    },
  ],
}

export const HYPERTROPHY_CANON: readonly ProgramInputUnparsed[] = [
  PPL,
  UPPER_LOWER,
  PHUL,
  PHAT,
  ARNOLD_SPLIT,
  BODY_PART_SPLIT,
  FULL_BODY_HYPERTROPHY,
]

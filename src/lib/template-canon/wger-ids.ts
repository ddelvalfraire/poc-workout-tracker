/**
 * Verified wger exercise ids — the ONLY place the canon names a catalog row.
 *
 * Every id below was resolved against the live wger English catalog (the same
 * `getAllExercises` path `loadExerciseCatalog` tags muscles from); the comment
 * is the name wger lists, verbatim, so a drift is visible in review. The unit
 * test pins the canon to this set and the seed script re-checks every id
 * against the live catalog before it writes anything.
 *
 * Last verified: 2026-08-20 (860-row catalog).
 */
export const WGER = {
  // --- Barbell mains ---
  squat: 615, // Squats
  frontSquat: 257, // Front Squats
  bench: 73, // Bench Press
  closeGripBench: 76, // Bench Press Narrow Grip
  inclineBench: 538, // Incline Bench Press - Barbell
  deadlift: 184, // Deadlifts
  sumoDeadlift: 630, // Sumo Deadlift
  rdl: 507, // Romanian Deadlift
  ohp: 687, // Overhead Press
  powerClean: 683, // Power Clean
  row: 83, // Bent Over Rowing
  tBarRow: 919, // T-Bar row
  hipThrust: 294, // Hip Thrust
  barbellShrug: 571, // Shrugs, Barbells
  barbellCurl: 91, // Biceps Curls With Barbell

  // --- Machines & cables ---
  latPulldown: 355, // Lat Pull Down (Straight Back)
  cableRow: 1117, // Seated Cable Row
  legPress: 371, // Leg Press
  hackSquat: 1414, // Hack Squats
  legCurl: 364, // Leg Curl
  legExtension: 369, // Leg Extension
  calfRaise: 622, // Standing Calf Raises
  chestPress: 129, // Chest Press
  pecDeck: 1904, // Pec Deck
  chestFly: 135, // Butterfly
  cableCrossover: 323, // Cable Cross-over
  machineShoulderPress: 543, // Shoulder Press, on Machine
  tricepsPushdown: 1185, // Triceps Pushdown
  facePull: 222, // Facepull
  hyperextension: 301, // Hyperextensions

  // --- Dumbbells ---
  dbShoulderPress: 567, // Shoulder Press, Dumbbells
  arnoldPress: 20, // Arnold Shoulder Press
  inclineDbBench: 537, // Incline Bench Press - Dumbbell
  inclineDbFly: 308, // Incline Dumbbell Fly
  inclineDbRow: 310, // Incline Dumbbell Row
  gobletSquat: 203, // Dumbbell Goblet Squat
  bulgarianSplitSquat: 1706, // Bulgarian Squat with Dumbbells
  lunge: 205, // Dumbbell Lunges Standing
  stepUp: 981, // Step-ups
  farmersCarry: 1116, // Dumbbell farmer's carry
  lateralRaise: 348, // Lateral Raises
  rearDeltRaise: 487, // Rear Delt Raises
  dumbbellCurl: 92, // Biceps Curls With Dumbbell
  hammerCurl: 272, // Hammer Curls
  preacherCurl: 465, // Preacher Curls
  skullcrusher: 246, // Skullcrusher SZ-bar
  dbOverheadTriceps: 1336, // Triceps Overhead (Dumbbell)

  // --- Bodyweight ---
  pullUp: 475, // Pull-ups
  chinUp: 152, // Chin Up
  australianRow: 1219, // Australian pull-ups
  invertedRow: 1198, // Inverted Rows
  pushUp: 1551, // Push-Up
  pikePushUp: 454, // Pike Push Ups
  handstandPushUp: 282, // Handstand Pushup
  dips: 194, // Dips
  pistolSquat: 456, // Pistol Squat
  nordicCurl: 910, // Nordic Curl
  plank: 458, // Plank
  sidePlank: 580, // Side Plank
  lSit: 1852, // L-sit
  hangingLegRaise: 283, // Hanging Leg Raises
  abWheel: 1573, // Ab wheel
  crunch: 167, // Crunches
  sitUp: 591, // Sit-ups

  // --- Kettlebell ---
  kettlebellSwing: 960, // Kettlebell Swing
  turkishGetUp: 675, // Turkish Get-Up

  // --- Cardio ---
  jogging: 319, // Jogging
  walking: 1104, // Walking
  cycling: 177, // Cycling
  rowingMachine: 1093, // Rowing Machine
  jumpRope: 993, // Jump rope: basic jumps
} as const

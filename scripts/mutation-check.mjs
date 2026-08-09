#!/usr/bin/env node
// Mutation-score ratchet: runs Stryker, then fails if the measured mutation
// score drops below the committed baseline (stryker-baseline.json) minus a
// small tolerance. This gates on REGRESSION only — there is no absolute
// threshold, by design (see the PRD's "What We're NOT Building").
//
// Raise-only policy: when the score improves, bump `mutationScore` in
// stryker-baseline.json in the same PR. Never lower it to make a run pass.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASELINE_FILE = join(root, 'stryker-baseline.json')
const REPORT_FILE = join(root, 'reports/mutation/mutation.json')
const TOLERANCE = 0.5 // percentage points of run-to-run noise allowed

const DETECTED = new Set(['Killed', 'Timeout'])
const UNDETECTED = new Set(['Survived', 'NoCoverage'])

function computeScore(report) {
  let detected = 0
  let undetected = 0
  for (const file of Object.values(report.files)) {
    for (const mutant of file.mutants) {
      if (DETECTED.has(mutant.status)) detected += 1
      else if (UNDETECTED.has(mutant.status)) undetected += 1
      // CompileError / RuntimeError / Ignored are excluded from the score,
      // matching Stryker's own mutation-score formula.
    }
  }
  const valid = detected + undetected
  if (valid === 0) throw new Error('mutation report contains no valid mutants')
  return (detected / valid) * 100
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))

const run = spawnSync('npx', ['stryker', 'run'], {
  cwd: root,
  stdio: 'inherit',
})
if (run.status !== 0) {
  console.error(`\n[mutation-check] stryker run failed (exit ${run.status})`)
  process.exit(run.status ?? 1)
}

const report = JSON.parse(readFileSync(REPORT_FILE, 'utf8'))
const score = computeScore(report)
const floor = baseline.mutationScore - TOLERANCE

console.log(
  `\n[mutation-check] score ${score.toFixed(2)}% | baseline ${baseline.mutationScore}% | floor ${floor.toFixed(2)}%`,
)

if (score < floor) {
  console.error(
    '[mutation-check] FAIL: mutation score regressed below the committed baseline.',
  )
  console.error(
    '[mutation-check] New/changed engine code is under-tested — inspect survived mutants in the Stryker report and add tests. Do NOT lower the baseline.',
  )
  process.exit(1)
}

if (score > baseline.mutationScore + TOLERANCE) {
  console.log(
    `[mutation-check] Score improved — consider raising mutationScore in stryker-baseline.json to ${Math.floor(score * 100) / 100} (raise-only ratchet).`,
  )
}
console.log('[mutation-check] PASS')

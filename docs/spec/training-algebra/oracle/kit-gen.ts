/**
 * kit-gen.ts — regenerates the language handoff kit's fixtures. Runs only in
 * the scratch copy verify step 8 makes (`kit-verify.ts tap` rewrote the entry
 * points there), so the suites below record every top-level oracle call as
 * they run. Run: (in the copy) KIT_OUT=<handoff dir> tsx kit-gen.ts
 */
import { writeKit } from './kit-record'
import { RESULTS } from './testkit'
import './semantics.test'
import './laws.test'
import './conformance'
import './demo'
// Last, so a call an earlier suite already made stays recorded where it was.
import './hardening.test'
import './coverage.test'
import './semfix.test'
import './weekbasis.test'
import './patfix.test'
import './config.test'

declare const process: { env: Record<string, string | undefined>; exitCode?: number }
const out = process.env['KIT_OUT']
if (!out) throw new Error('kit-gen: set KIT_OUT')
const failed = RESULTS.filter((r) => !r.ok)
if (failed.length) throw new Error(`kit-gen: ${failed.length} suite tests failed under the recorder: ${failed.map((r) => r.name).join('; ')}`)
writeKit(out)

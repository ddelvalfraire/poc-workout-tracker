#!/usr/bin/env bash
# The verification suites, rerunnable:
#   1. tsc strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess, clean
#   2. every @ts-expect-error in negative.ts fires on the line below it
#   3. the demo runs and matches the shipped transcript
#   4. the construct counts the rationale cites, recomputed
#   5. the property suites: the formers (semantics.test.ts), the laws L1–L13
#      (laws.test.ts), the typing-observation fixes (hardening.test.ts), the
#      fixture-coverage gaps (coverage.test.ts), the semantics review
#      round's regressions (semfix.test.ts), the weekly basis options
#      (weekbasis.test.ts), the correctness interrogation round's
#      regressions (patfix.test.ts) and the configurability round's
#      declared options (config.test.ts)
#   6. conformance: publication with examples evaluated, the capability matrix,
#      the checker suite, and the prose-versus-evaluation differential
#   7. the test-plan disposition is complete and matches what ran
#   8. the language handoff kit (../kit) is regenerated from the suites,
#      every file validates against its ir-schema.json, and every fixture
#      replays on the oracle to its stored output
set -euo pipefail
cd "$(dirname "$0")"
BIN=${BIN:-$(cd ../../../.. && pwd)/node_modules/.bin}

"$BIN/tsc" -p tsconfig.json
echo "1. tsc: clean over $(ls ./*.ts | grep -v '\.d\.ts$' | wc -l | tr -d ' ') files"

tmp=$(mktemp -d "$PWD/../.negchk.XXXX")
gen=$(mktemp -d "$PWD/../.kitgen.XXXX")
trap 'rm -rf "$tmp" "$gen"' EXIT
cp ./*.ts tsconfig.json "$tmp/"
expected=$(grep -n '^ *// @ts-expect-error' negative.ts | cut -d: -f1 | awk '{print $1 + 1}' | sort -n | uniq)
sed -i.bak 's#^\( *\)// @ts-expect-error.*#\1//#' "$tmp/negative.ts"
actual=$( (cd "$tmp" && "$BIN/tsc" -p tsconfig.json || true) | grep -E '^negative\.ts\(' | sed -E 's/^negative\.ts\(([0-9]+),.*/\1/' | sort -n | uniq)
if [ "$expected" != "$actual" ]; then
  echo "2. negatives: MISMATCH"; diff <(echo "$expected") <(echo "$actual"); exit 1
fi
echo "2. negatives: $(echo "$expected" | wc -l | tr -d ' ') directives, each fires on its own line when stripped"

"$BIN/tsx" demo.ts | diff - demo.out.txt
echo "3. demo: output matches demo.out.txt ($(grep -c 'REFUSED' demo.out.txt) refusals, $(grep -c '^  OK  ' demo.out.txt) acceptances)"

formers=$("$BIN/tsx" -e "import { DESCRIBERS } from './describe'; console.log(Object.keys(DESCRIBERS).length)")
codes=$(awk '/^export type TypeError/,/^\)/' engine.ts | grep -c "| { code: '")
echo "4. constructs: $formers term formers (DESCRIBERS is total over Term), $codes compile-time refusal codes (engine.ts TypeError)"

sem=$(QUIET=1 "$BIN/tsx" semantics.test.ts) || { echo "$sem"; exit 1; }
law=$(QUIET=1 "$BIN/tsx" laws.test.ts) || { echo "$law"; exit 1; }
hard=$(QUIET=1 "$BIN/tsx" hardening.test.ts) || { echo "$hard"; exit 1; }
cov=$(QUIET=1 "$BIN/tsx" coverage.test.ts) || { echo "$cov"; exit 1; }
semf=$(QUIET=1 "$BIN/tsx" semfix.test.ts) || { echo "$semf"; exit 1; }
wkb=$(QUIET=1 "$BIN/tsx" weekbasis.test.ts) || { echo "$wkb"; exit 1; }
pat=$(QUIET=1 "$BIN/tsx" patfix.test.ts) || { echo "$pat"; exit 1; }
cfg=$(QUIET=1 "$BIN/tsx" config.test.ts) || { echo "$cfg"; exit 1; }
echo "5. properties: $(grep -c "^t('" semantics.test.ts) former tests, $(grep -c "^t('" laws.test.ts) law tests, $(grep -c "^t('" hardening.test.ts) oracle-hardening tests, $(grep -c "^t('" coverage.test.ts) fixture-coverage tests, $(grep -c "^t('" semfix.test.ts) semantics-review regressions, $(grep -c "^t('" weekbasis.test.ts) weekly-basis tests, $(grep -c "^t('" patfix.test.ts) correctness-round regressions and $(grep -c "^t('" config.test.ts) configurability-round tests pass (semantics, laws, hardening, coverage, semfix, weekbasis, patfix, config)"

conf=$(QUIET=1 "$BIN/tsx" conformance.ts) || { echo "$conf"; exit 1; }
echo "6. conformance: $(grep -c "^t('" conformance.ts) publication/matrix/checker tests and $(QUIET=1 "$BIN/tsx" -e "import { RESULTS } from './testkit'; import('./differential').then(() => console.log(RESULTS.filter((r) => r.suite === 'differential').length))") prose-vs-evaluation checks pass (conformance.ts, differential.ts)"

QUIET=1 "$BIN/tsx" dispose.ts

kit="$(cd .. && pwd)/kit"
cp ./*.ts tsconfig.json "$gen/"
"$BIN/tsx" kit-verify.ts tap "$gen"
(cd "$gen" && QUIET=1 KIT_OUT="$kit" "$BIN/tsx" kit-gen.ts)
QUIET=1 "$BIN/tsx" kit-verify.ts check "$kit"

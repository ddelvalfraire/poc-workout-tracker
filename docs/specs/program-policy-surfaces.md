# Program policy surfaces

Scope: the five `set_program_policy` arms — `autoregulation` (+ `autoregStallPolicy`),
`deloadPolicy`, `dietPhase`, `overshootPolicy`, `planSync` — and where each one is
legible to the owner.

This doc was commissioned on the premise that four of the five arms had an MCP
tool but no user-facing surface, and that a shipped row conflated
`programs.autoregulation` with a per-exercise progression scheme. **Neither
holds on `main` as of 729b02f** (`Merge redesign/programs`). Section 1 records
what is actually shipped, with file anchors, so the premise does not get
re-litigated. Sections 2–4 spec the three gaps that survive the audit.

## 1. Audit — what is shipped

| Arm | DB | Write surface | Read surface | Control |
|---|---|---|---|---|
| `autoregulation` | `programs.autoregulation` (bool, default true) | `src/app/programs/new/program-builder.tsx:381-397` | `[id]/page.tsx:601-645` (the verdict card) | native checkbox |
| `autoregStallPolicy` | `programs.autoreg_stall_policy` (text, default `all-sets`) | `program-builder.tsx:400-428`, nested under the switch and hidden with it | none | radio pair |
| `deloadPolicy` | `programs.deload_policy` (jsonb, nullable) | `program-builder.tsx:272-350` — mode radios, resolved-mode checked state, shape sentence, nested `timedExercises` radios under Scheduled | **none** — see §3 | radio group |
| `dietPhase` | `programs.diet_phase` (text, nullable) | `program-builder.tsx:353-373`; mid-block via `[id]/diet-phase-card.tsx` | staleness card on `[id]` | radio group + card |
| `overshootPolicy` | `programs.overshoot_policy`, `program_exercises.overshoot_policy` (text, nullable) | `[id]/overshoot-policy-control.tsx` (program), `[id]/exercise-overshoot-control.tsx` (exercise) | both render on `[id]` | native `select` |
| `planSync` | `programs.plan_sync` (bool, default true) | `program-builder.tsx:431-449` | none | native checkbox |

Every builder control is reachable for a live program through
`/programs/[id]/edit`, which mounts the same `ProgramBuilder`.

The builder's policy block is correct on the two points the brief worried about:

- **Deload mode is legible, not numeric.** The three modes are radios with
  distinguishing sentences (`ProgramBuilder.deloadPolicy.none` / `.reactive` /
  `.scheduled`), and the shape percentages render only under Scheduled. A
  never-set policy shows the *resolved* mode, so a pre-policy program displays
  what it will actually do rather than a blank.
- **`planSync` is worded as a consequence.** `ProgramBuilder.planSync.description`
  reads: *"When you finish a session lifting more than the plan calls for, the
  plan adopts your loads (logged in the change log). Turn off for percentage-wave
  programs where lifting past the listed number is intentional."* The label names
  the switch; the sentence names what changes. Keep it.

## 2. Gap A — overshoot precedence is never stated

`resolveOvershootPolicy` (`src/lib/programs/overshoot-policy.ts:54-64`) is
**exercise override > program policy > per-scheme default**. Both controls
implement it and neither says it.

`OvershootPolicyControl.hint.default` explains only the third layer ("Strict for
load-anchored schemes; e1RM-equivalent for RPE targets"). `ExerciseOvershootControl`
offers an option literally labelled `default`, which reads as "the scheme
default" when it actually means "whatever the program says, and only then the
scheme".

### Spec

**Program-level** — `[id]/overshoot-policy-control.tsx`, one new `<p>` below the
select, `text-sm text-muted-foreground`, no shell, no volt.

- key `OvershootPolicyControl.precedenceNote`
- copy: `Applies to every exercise that hasn't set its own. An exercise's own choice always wins.`

**Per-exercise** — `[id]/exercise-overshoot-control.tsx`.

- Change the *value* of `ExerciseOvershootControl.option.default` from `default`
  to `program setting`. Keep the key: it names the slot (the inherit option),
  not the string, and renaming it would orphan the leaf for no gain.
- Add `ExerciseOvershootControl.hint`, rendered only while the select sits on
  the inherit option:
  `Follows the program — {policy} right now.`
  `{policy}` is the resolved label, passed from `resolveOvershootPolicy`, so the
  sentence names the behaviour rather than the layer it came from.
- The component must therefore receive the program policy and the exercise's
  scheme as props; it already receives everything else it needs.

No new component, no new route. Both notes are words in muted ink, not chips —
they are labels, not controls (DESIGN.md, "Chips are controls, words are labels").

## 3. Gap B — deload mode is invisible on the read surface

`/programs/[id]` passes `program.deloadPolicy` into derivation
(`[id]/page.tsx:221`) and never shows it. The page renders `ProgramDetail.deloadBadge`
("Deload week") and `day.deloadLabel` off `derivedFrom === 'deload'`, so:

- **`scheduled`** shows the badge and backed-off numbers;
- **`none`** shows neither, because the week derives as a normal week;
- **`reactive`** shows neither, because nothing is scheduled.

`none` and `reactive` are therefore indistinguishable on the read surface, and
both are indistinguishable from "this program has no deload week at all". The
owner cannot tell whether a deload is coming, is only offered on demand, or was
switched off. That is exactly the failure mode the brief names: the mode decides
whether the week exists, and the numbers cannot carry it.

### Spec

**Where** — `/programs/[id]`, inside the existing "About this program" block
(`ProgramDetail.aboutTitle`), above the change log. Not a new sheet: this is
one derived sentence, and a sheet for one sentence is a shell where a hairline
does the job.

**Control** — none. A sentence in `text-sm text-muted-foreground`, sitting under
the existing caps `Section` header. It is read-only by design; the edit path is
the link in §4.

**Copy** — one ICU `select`, mirroring `ProgramDetail.statusLine.week`, which
already carries branch logic in a single message rather than concatenating keys.

- key `ProgramDetail.deloadPolicy.summary`
- value:

  ```
  {mode, select,
    none {Week {week} trains like any other — nothing backs off, and no deload is suggested.}
    reactive {Nothing is scheduled to back off. If your lifts stall, a deload gets offered.}
    scheduled {Week {week} backs off to {load}% of the load and {sets}% of the sets.}
    other {}}
  ```

- `{week}` is `programs.deloadWeek`; `{load}`/`{sets}` are the resolved shape's
  factors as whole percents, formatted exactly as the builder already does.
- When `rpeCap` is non-null, append via a second key rather than a nested
  select — `ProgramDetail.deloadPolicy.capNote` = `Effort capped at RPE {rpeCap}.`
  The builder splits `shape` / `shapeWithCap` the same way.

**Empty / default state** — `programs.deload_policy` is nullable on purpose; a
pre-policy program resolves through `resolveDeloadPolicy` at read time. Render
the **resolved** mode, never a "not set" state. A program with `deloadWeek === null`
resolves to `none` and its `{week}` argument is absent, so it takes a fourth
branch:

- key `ProgramDetail.deloadPolicy.noWeek`
- copy: `No deload week in this block.`

The row never disappears — a deload policy that renders nothing is the bug being
fixed.

## 4. Gap C — the policy block has no read surface and no entry point

Four arms (`autoregulation`, `autoregStallPolicy`, `deloadPolicy`, `planSync`)
are editable only by opening the full builder at `/programs/[id]/edit` and
scrolling past the day/exercise tree. `dietPhase` and `overshootPolicy` got
mid-block controls on `/programs/[id]`; the other four did not. That split is
an accident of when each shipped, not a decision.

### Decision

**Do not build a policy sheet.** The builder's fieldsets are correct and tested,
and duplicating four controls onto the detail page would give every one of them
two write paths to keep honest. Instead: make the detail page *state* the
policies and *link* to the one place that edits them.

**Where** — the same "About this program" block as §3, as a short list of
sentences in muted ink, closed with a hairline (`border-b border-b-border/60`),
followed by a single quiet link. No card shell.

**Copy and keys** — grouped under `ProgramDetail.policies`:

| Key | Copy |
|---|---|
| `policies.title` | `How this program adapts` |
| `policies.autoregOn` | `Sessions adjust your loads after missed reps, and say why.` |
| `policies.autoregOff` | `Loads run as written — no automatic adjustments.` |
| `policies.stallAllSets` | `Any working set under its rep floor counts as a stall.` |
| `policies.stallFirstSet` | `Only the first working set decides whether a session stalled.` |
| `policies.planSyncOn` | `Out-lift the plan and the plan adopts your loads.` |
| `policies.planSyncOff` | `The plan keeps its listed loads however much you lift.` |
| `policies.editLink` | `Change these` |

- The two stall lines render only while autoregulation is on — the builder hides
  the control under the same condition, and a stall rule stated next to
  "no automatic adjustments" is a contradiction on the page.
- `policies.editLink` targets `/programs/[id]/edit`. Give the builder's policy
  fieldsets an `id` so the link can carry a fragment; the fragment is a
  convenience, and the link must work without it.
- On a proposal (`isProposed`), render the sentences and **omit** the link —
  same gate the sharing and overshoot controls already use. Nothing about a
  pending proposal is editable until it is adopted.

**Empty state** — none. Every field here is non-null in the schema
(`autoregulation`, `autoreg_stall_policy`, `plan_sync` all carry defaults), so
the list always has at least three sentences. `deloadPolicy` contributes §3's
line whether or not the column is set.

**One volt** — none of this is accented. `/programs/[id]` spends its accent on
the primary action; these are labels.

## 5. The autoregulation / scheme conflation

The brief describes a row reading `Autoregulation · Linear · on`, mixing the
program-level boolean with a per-exercise progression scheme name.

**No such row exists.** Verified by (a) full-catalog scan of `messages/en.json`
for any value joining `·` with an on/off token, (b) grep for every render site
of `programs.autoregulation` across `src/app/**` and `src/components/**`, and
(c) grep for every consumer of the `SchemeCopy` namespace. The two concepts are
already separate and each sits at its correct scope:

- **`programs.autoregulation` is program scope.** It renders as the builder's
  checkbox (`program-builder.tsx:378-393`, `ProgramBuilder.autoreg.label`) and,
  when it produces a verdict, as the detail page's `ProgramDetail.autoreg` card
  (`[id]/page.tsx:601-640`).
- **The progression scheme is exercise scope.** It renders as
  `SchemeSubtitle` — "Linear — Add weight every session you complete all sets."
  (`src/app/programs/new/scheme-subtitle.tsx:12-27`, from `SchemeCopy.name.*` /
  `SchemeCopy.subtitle.*` via the message descriptors in
  `src/lib/programs/scheme-copy.ts`), and as the how-line on an expanded exercise row on
  the detail page.

### What is true, and is how the conflation would get built

The two renderers are **adjacent inside one scrolling form**: `SchemeSubtitle`
mounts per exercise at `program-builder.tsx:650-652`, a few hundred lines below
the program-level autoregulation checkbox at `:378-393`, in the same visual
stack and the same muted-ink idiom. Nothing on screen marks that one is
program-scoped and the other exercise-scoped. Compressing that stack into a
detail-page meta line is exactly the move that produces
`Autoregulation · Linear · on` — a row that is wrong about at least one of its
three segments, because segment 2 varies per exercise while segment 3 does not.

### The rule that keeps them apart

Record it here so the row does not get invented later:

> Auto-regulation and a progression scheme are not two settings of one thing.
> The scheme decides **what the plan asks for**; auto-regulation decides
> **whether the app adjusts that ask after you miss it**. They live at different
> scopes (program vs. exercise) and one is not a mode of the other. Never render
> them in a single meta line, and never let one's state gate the other's label.

§4's `policies.autoregOn` / `policies.autoregOff` are the sanctioned way to
state auto-regulation on the detail page: a sentence about adjustment behaviour,
carrying no scheme name.

## 6. Non-goals

- No policy sheet, dialog, or new route (§4).
- No per-exercise autoregulation switch. The per-exercise escape is the existing
  "use the plan as written" affordance, not a second policy layer.
- No editing of the deload `shape` outside the builder. The shape is agent- and
  builder-authored; the detail page states it and stops.
- No change to any resolver. `resolveOvershootPolicy` and `resolveDeloadPolicy`
  stay the only paths from stored column to behaviour; every surface above reads
  through them rather than re-deriving.

## 7. Notes for the implementer

- New keys go in `messages/en.json` under the namespaces above and follow
  `docs/I18N-KEYS.md`: keys name the slot, ICU carries the branching, no
  sentence is built by concatenating keys. Run `npm run i18n:report` after
  adding them — it is the closest thing the repo has to a catalog gate.
- `ExerciseOvershootControl` and any new client island must be listed in
  `src/i18n/client-namespaces.ts` if they gain a namespace.
- **`src/components/ui` has no `Sheet`, `Dialog`, `RadioGroup`, `Switch`, or
  `Select` primitive.** The existing policy controls are native elements styled
  at the call site (`<fieldset>/<legend>/<input type="radio" class="size-4
  shrink-0 accent-primary">`, bare `<select class="h-9 rounded-lg border
  border-border …">`). Everything specced above is a `<p>`, an `<option>` label,
  or an `<a>`, so none of it needs a primitive that does not exist.
- `DividerRow` requires an `href`. §4's `policies.editLink` navigates to
  `/programs/[id]/edit`, so it fits; do not reach for `DividerRow` if the link
  later becomes a sheet trigger.
- The repo has no markdown or docs linter — `npm run lint` is ESLint over
  `.ts`/`.tsx` only. This doc is reviewed by hand.

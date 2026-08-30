# Timed Set Authoring

Authoring surface for the non-`reps_weight` logging modalities — `duration` and `duration_distance` (planks, carries, timed holds, loaded walks, cardio). How the mode is chosen, how the set row reshapes, which progression schemes the picker may offer, what a deload week shows, and how a timed set renders in the week grid.

- Status: draft / code-verified against cardio v1 (#242) / no implementation
- Date: 2026-08-22

## 01 · Product framing

The premise "this modality has no authoring surface" is **half true**, and the half that is false matters.

Cardio v1 (`332b362`) already shipped a working authoring path in `src/app/programs/new/program-builder.tsx`: a per-exercise metric-mode `<select>`, a Time/Km/RPE/Rest column swap, `mm:ss` and km codecs (`src/lib/duration.ts`), draft round-tripping (`program-draft.ts`), and a derivation-layer metric-mode guard (`src/lib/programs/progression.ts`). What is missing is not the modality — it is **the vocabulary around it**:

| Gap | Today | § |
|---|---|---|
| Mode carrier floats above the table instead of being the table | ghost `<select>` above the header row | 03 |
| Per-set drift is silently flattened on any mode change | `SET_EXERCISE_METRIC_MODE` stamps every set | 02 |
| Timed sets cannot carry a load | no Load column in `duration`/`duration_distance` | 04 |
| A carry load that *is* authored disappears on the detail page | `derived-format.ts` `target.timed` drops `loadKg`; `planned-set-format.ts` prints it | 04 |
| Distance is km for everyone | `formatDistanceInput` is km-only; header key is the literal `column.km` | 05 |
| No scheme picker exists, so nothing filters illegal schemes | builder renders `SchemeSubtitle` only; scheme is agent-authored pass-through | 07 |
| `rep-progression`'s `incrementSec`/`maxSec` is unreachable from the builder | no picker to expose it | 07 |
| Deload's `timedExercises` arm is invisible in the plan | derivation honors it; no surface says so | 08 |
| No week grid | unbuilt; `BlockMap` is a week *strip*, not a cell grid | 09 |
| Nothing in `src/app/programs/**` has a story | CLAUDE.md requires one per component | 10 |

> **Design position.** Every rule below is a *presentation and authoring* rule. None of it changes derivation. `deriveWeekSets` already decides what a timed set does under every scheme and every deload arm; this spec makes the builder stop offering the author things the engine will silently ignore, and makes the plan surfaces print what the engine actually produced. Silence over corruption stays the law: where a combination is meaningless it must never be offered and then dropped.

## 02 · Where the mode is chosen — per exercise, with per-set preservation

**Decision: the switch is per EXERCISE. The read model is per SET.**

The column is per-set in `program_sets` for a reason the builder should honor rather than inherit. `program-draft.ts:167` states the intent:

> per-set drift inside one slot is an agent affordance, not a builder one

That intent survives, and it is right, for three reasons:

1. **A table has one header row.** Per-set mode means per-row column drift — Row 1 is Rep min/Rep max/kg/RPE/Rest, Row 2 is Time/RPE/Rest. At the 448px column (`content-max-width`, `src/design/tokens.ts`) that destroys the `tnum` alignment that makes a set table scannable mid-authoring. The logger accepts this asymmetry deliberately (`workout-logger.tsx:1984` — headers follow set 0, "rows still render per their OWN mode") because the logger *reads* drift it never *authors*.
2. **Drift is a circuit, not an edit.** The real per-set case ("3×10 swings, then 1×60s plank") is one slot that is really two exercises. A coach writing it through MCP knows that; an author dragging a dropdown does not.
3. **The schema already refuses shape-editing at row grain.** `program_set_overrides` deliberately excludes `metricMode` — "changing a set's shape is an edit, not an override". Per-set authoring would make the builder the only place in the tree where shape moves at row grain.

What changes is that the builder must stop **destroying** drift it did not create.

### The three exercise-level mode states

| State | When | Header control reads | Rows render |
|---|---|---|---|
| `uniform` | every set shares one `metricMode` | that mode | that mode |
| `mixed` | sets disagree | `Mixed` | **each set in its own mode** |
| `empty` | no sets yet | `Reps × weight` (`DEFAULT_METRIC_MODE`) | — |

In `mixed` the header row renders the union header (`Time` in the first metric slot — the timed row is the constrained one) and each row keeps its own inputs. This is exactly the logger's shipped behavior, and the two surfaces must agree or the same program reads two ways.

### Flattening is a confirmed, destructive act

Choosing a mode from the header control while the exercise is `mixed` flattens every set. Today the reducer comments that "typed values survive — they re-read under the new mode's columns and simply don't emit while hidden", which is true of the *draft* and false of the *save*: `toProgramInput` emits only the active mode's fields, so a save discards the hidden ones permanently. So it goes behind the repo's `ConfirmDialog` idiom.

```
Title    Change all sets to Duration?
Body     This slot mixes tracking modes. Every set becomes Duration, and
         values that don't fit the new mode are cleared.
Confirm  Change all sets
Cancel   Cancel
```

From a `uniform` state the switch is unconfirmed — it is exactly what the author asked for, and the draft is still unsaved.

Per-set mode editing stays available through the MCP tools and the coach, unchanged.

## 03 · The header IS the mode control

**Decision: retire the ghost `<select>` above the table; the first metric column header carries the mode.**

The mode is not metadata about the table — it is *what the columns mean*. A control above the table is a second place to look for something the header row already announces, and it is the reason the current surface reads as "cardio bolted on".

- The **first metric column header** (`Reps min` ↔ `Time`) becomes a `<button>` that opens the mode menu.
- Every other header stays an inert `<span>`.
- The skin is the shipped metric-mode idiom, moved rather than invented: the header's `text-[0.7rem] font-semibold uppercase tracking-wider text-muted-foreground` plus a trailing `ChevronDown` at `size-3` and the volt focus ring (`focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden`).

This squares DESIGN.md's *"chips are controls, words are labels"*: a header word does not become pressable by fiat — it becomes pressable by wearing the chevron the builder's existing mode control already wears. Exactly one chevron lives in the header band, so *"one glyph, one meaning"* holds: the chevron means "this column's meaning is yours to change", and nothing else in the band has one.

### The menu

A popover, not a native `<select>` — the mixed state, the flatten warning and the carry-load toggle need more than an `<option>` can hold.

```
┌─────────────────────────────┐
│ ✓ Reps × weight             │
│   Duration                  │
│   Duration + distance       │
├─────────────────────────────┤
│ Carry load          [ off ] │   ← §04, timed modes only
└─────────────────────────────┘
```

A11y and geometry copy `src/app/workout/new/set-row-menu.tsx` verbatim — the roving-focus precedent (`a9d2252`), and the only one in the repo:

- `role="menu"` with an `aria-label`; the three modes are `role="menuitemradio"` with `aria-checked`.
- First item focused on open; a window keydown handler roves ArrowDown/ArrowUp with wrap over `[role^="menuitem"]`, Home/End jump, Escape closes and returns focus to the header button, Enter/Space selects.
- The transparent backdrop `preventDefault`s on `pointerDown` and swallows the paired click, so closing the menu never also focuses an input underneath.
- Shell vocabulary `bg-popover rounded-lg border-border shadow-lg motion-safe:animate-rise-in` — an overlay is a band of its own and earns a shell (DESIGN.md keep-list).
- Item height stays the menu's 44px; the mode menu is 4 items, so its clamp is `MENU_ITEM_HEIGHT × 4`.
- The button's accessible name is the existing `ProgramBuilder.exercise.metricModeAriaLabel` (`"Tracking mode for {exerciseName}"`) — unchanged key, zero translation churn. The visible header word is the label; this is never a naked icon.

### Distance is the second header, and it is also a control

`duration` → `duration_distance` is a column *addition*, not a different table:

| Mode | Second metric header |
|---|---|
| `duration` | `+ Distance` — pressable, switches to `duration_distance` |
| `duration_distance` | the resolved unit symbol (`km` / `mi`), inert; the mode menu's radio is the way back |

`+ Distance` is the only verb in the band and it does **not** take a chevron: chevron means "choose", plus means "add" — the same split `+ Add set` / `+ Add day` already use.

## 04 · How the row reshapes

Column budget is the constraint. One column at `content-max-width` (448px), flex-based like today (no grid template anywhere in `src/app/programs/**`); the set disc, gaps and remove button take ~140px, leaving ~308px of metric columns, and the row is tuned against the 390px PWA viewport.

| Mode | Columns (flex basis) | Load |
|---|---|---|
| `reps_weight` | Rep min `1` · Rep max `1` · `{unit}` `1.4` · RPE `1` · Rest `1` | required |
| `duration` | Time `1.4` · [`{unit}` `1.4`] · RPE `1` · Rest `1` | **opt-in** |
| `duration_distance` | Time `1.4` · `{distanceUnit}` `1.4` · [`{unit}` `1.4`] · RPE `1` · [Rest `1`] | **opt-in** |

**Load in timed modes is opt-in, off by default** — the "(Load?)" question answered. A weighted plank, a farmer's walk and a ruck are real, and the schema already stores them: `suggestedLoadKg` is orthogonal to `metricMode`, and the derivation guard passes a template load straight through for timed rows (`applies === false` → `loadKg: set.suggestedLoadKg`). But most timed work is unloaded, and a permanently-present empty Load column costs the Time field width it cannot spare at 390px. So it is a per-exercise toggle in the mode menu (`Carry load`), persisted on the draft exercise, defaulting off. Turning it off with values present clears them under the same confirm as §02.

**Rest is the demotion candidate.** With `duration_distance` + carry load, five metric columns do not fit at 390px. Rest demotes: it leaves the row and its per-set editor moves into the set-row menu, because rest is the only metric with a standing fallback chain (per-set → program → `user_preferences.default_rest_sec` → plain count-up). Nothing else may demote; a missing Time makes the set unsaveable.

### Input affordances — all of them already exist

| Field | Control | Codec |
|---|---|---|
| Time | `Input type="text" inputMode="numeric"`, `placeholder` `mm:ss` | `parseDurationInput` / `formatDurationInput` (`src/lib/duration.ts`) |
| Distance | `Input type="text" inputMode="decimal"` | `parseDistanceInput` / `formatDistanceInput`, extended per §05 |
| Load | `Input type="text" inputMode="decimal"` | the shipped `load` field — display unit in, kg stored |
| RPE, Rest | unchanged | unchanged |

There is no `DurationField` component and there must not become one: the codec is the shared thing, and it is already shared by the builder and the logger. Reuse `src/lib/duration.ts` verbatim. Do not write a second `mm:ss` parser — its rules are load-bearing and adversarially tested (`1:75` is a typo and rejects; `75:30` is a valid 75-minute steady-state entry; a bare `30` reads as **minutes**; `0:00` parses to `null`, so a stored zero can never round-trip into existence).

### Effort in timed modes

RPE stays; RIR does not appear. The builder's effort column has always been RPE — `rir` is a pass-through field on `DraftProgramSet` the builder never edits, and RIR is logger vocabulary (`EffortChips`, the post-check chip row). Where the brief says "Reps / Load / RIR", the shipped builder reads Reps / Load / **RPE**, and the timed row keeps RPE for the same reason: an effort cap on a hard plank is meaningful, reps-in-reserve on one is not.

### The load-display bug this exposes

Two formatters over one grammar disagree about a loaded timed set:

- `src/lib/programs/planned-set-format.ts` appends `@ 40 kg` to a timed core (the append runs unconditionally after the mode branch).
- `src/app/programs/[id]/derived-format.ts` builds `target.timed` from `count`/`duration`/`distance` only — **the load is dropped**.

So a 40 kg farmer's walk prints its load on the template surface and loses it on the program detail page. Once carry load is authorable this is a visible lie. Fix by giving `target.timed` an optional load slot; the key does not change (it still names the slot), only the ICU value:

```
"{count}×{duration, select, none {—} other {{duration}}}{distance, select, none {} other { / {distance}}}{load, select, none {} other { @ {load}}}"
```

A quieter sibling: `mergeOverride` (`progression.ts:194`) applies a per-week `suggestedLoadKg` override **only** when `metricMode === 'reps_weight'`. A week override that raises a carry's load is silently ignored. Flagged in §12, not decided here — widening it changes derived output for stored programs, which is a decision and not a fix.

## 05 · Units — distance follows the weight preference

**Decision: the distance unit is inferred from `user_preferences.unit`. km for kg, mi for lb. No new setting.**

`src/lib/units.ts` already contains the precedent and its rationale:

> The length display unit is INFERRED from the weight unit preference — one preference governs both (lb users measure in inches, kg users in cm). There is deliberately no separate length-unit setting.

Add the sibling beside `lengthUnitFor`:

```ts
export type DistanceUnit = 'km' | 'mi'
export function distanceUnitFor(weightUnit: WeightUnit): DistanceUnit
```

This does **not** break `duration.ts`'s standing rule ("one display unit for ENTRY everywhere, chosen over m/km switching so a typed number always means the same thing"). That rule means *one unit per user per surface*, and it is preserved — the same discipline the load column has always had. What changes is which unit that is, resolved from a preference the user already set. A lb-user has no feel for a 5 km target; showing them one is the same defect class as showing them 37.2 lb.

| | kg user | lb user |
|---|---|---|
| Entry unit (builder + logger) | km, decimal (`0.4` = 400 m) | mi, decimal (`0.05` ≈ 88 yd) |
| Column header | `km` | `mi` |
| Read-side, below one unit | metres | yards |
| Read-side, above one unit | km | mi |
| Canonical storage | metres, always | metres, always |

`formatDistance` (`src/lib/format.ts`) takes the unit and swaps its `meter`/`kilometer` Intl pair for `yard`/`mile`. Crossover is one whole unit in both systems — symmetric, so neither user learns a special case. Yards rather than feet because carries and sled work are prescribed in yards.

**Migration.** Draft strings in localStorage are display-unit text. The draft envelope stamps the entry unit it was written in; on hydrate a mismatch re-derives the strings from canonical metres rather than reinterpreting them. Same class of guard `parseStoredProgramDraft` already runs for the cardio shape change.

**Key deletion.** `ProgramBuilder.column.km` goes away with no replacement — the header renders the Intl unit symbol, exactly as the load header has always rendered a bare `{unit}`. A unit symbol is `Intl`, not a catalog entry (I18N-KEYS §9). This also retires the `column.km` (`"Km"`) vs `WorkoutLogger.column.distance` (`"km"`) casing drift, since neither surface holds the string any more.

## 06 · Copy and i18n keys

Namespaces follow I18N-KEYS §7 — the component that owns the literal. Flat catalog, `messages/en.json`, max depth 3.

### `ProgramBuilder` — changed

| Key | Change |
|---|---|
| `column.km` | **deleted** — header renders the Intl unit symbol |
| `field.distance` | value becomes `"distance in {unit}"` (was `"distance in km"`); key unchanged, ICU arg added |
| `exercise.metricModeAriaLabel` | unchanged; now names the header button |
| `metricMode.repsWeight` / `.duration` / `.durationDistance` | unchanged; now menu items |
| `placeholder.duration` | unchanged (`mm:ss`) |

### `ProgramBuilder` — new

| Key | English |
|---|---|
| `metricMode.mixed` | `Mixed` |
| `metricMode.description` | `What these sets measure. Sets that mix modes keep their own.` |
| `column.distanceAdd` | `+ Distance` |
| `carryLoad.label` | `Carry load` |
| `carryLoad.hint` | `Adds a load column for weighted planks, carries and rucks.` |
| `flattenDialog.title` | `Change all sets to {mode}?` |
| `flattenDialog.body` | `This slot mixes tracking modes. Every set becomes {mode}, and values that don't fit the new mode are cleared.` |
| `flattenDialog.confirm` | `Change all sets` |
| `flattenDialog.cancel` | `Cancel` |
| `validation.durationRequired` | `Every timed set needs a time.` |

`validation.durationRequired` is the user-facing echo of `programSetIntegrityViolation`'s `"durationSec is required when metricMode is duration or duration_distance"` — that string is a developer message and must never reach a user.

`{mode}` in the flatten dialog is the already-translated `metricMode.*` value, passed as an ICU argument. Not concatenated (I18N-KEYS §5).

### `SchemePicker` — new namespace (§07)

| Key | English |
|---|---|
| `label` | `How it progresses` |
| `option.none` | `No progression` |
| `timedNotice` | `Timed work progresses by seconds, so load-based schemes aren't offered here.` |
| `mixedNotice` | `This scheme moves the lifting sets only. Timed sets train as written.` |
| `incrementSec.label` | `Add each session` |
| `incrementSec.unit` | `sec` |
| `maxSec.label` | `Stop at` |
| `maxSec.placeholder` | `No cap` |

Scheme names and one-liners reuse the shipped `SchemeCopy.name.*`, `SchemeCopy.subtitle.*` and `SchemeCopy.sentence.secProgression` / `.secProgressionCapped` through `src/lib/programs/scheme-copy.ts`'s descriptors — the direction doc's "one copy module, three consumers, so they can't drift" contract. The picker is consumer (a); nothing new is written here.

### `WeekGrid` — new namespace (§09)

| Key | English |
|---|---|
| `cell.ariaLabel` | `Week {week}, set {set}: {target}` |
| `badge.deload` | `DL` |
| `badge.asWritten` | `As written` |
| `empty` | `—` |

`badge.deload` duplicates `BlockMap.deloadBadge` deliberately (I18N-KEYS §4: duplicate by default; sharing must be earned).

## 07 · The scheme picker under a timed exercise

The picker does not exist — `scheme-subtitle.tsx` says so outright ("the builder has no scheme picker; progression is agent-authored pass-through"), and the direction doc specifies it as name + one-line subtitle. What this spec adds is **which options it may show**, read off what `deriveWeekSets` actually does rather than off intuition.

### Legality

| Scheme | Anchored on | On a timed set | Verdict |
|---|---|---|---|
| `linear` | `incrementKg` | per-set guard no-ops it | **illegal** |
| `double-progression` | `incrementKg` + rep range | per-set guard no-ops it | **illegal** |
| `percent-1rm` | `trainingMaxKg` × week % | per-set guard no-ops it | **illegal** |
| `rpe-target` | e1RM × rep-derived % | needs reps; e1RM is `reps_weight`-only | **illegal** |
| `amrap-cycle` | TM waves; `deloadRow` needs an all-`reps_weight` chassis | guard excludes timed rows from the percent index | **illegal** |
| `weekly-volume` | working-set count | `hasTimedProgressedSet` disables resizing for the **whole exercise** | **illegal** |
| `rep-progression` | `incrementReps`/`maxReps`, `incrementSec`/`maxSec` | bumps `durationSec` by design | **legal** |

**Exactly one legal scheme for timed work — `rep-progression` — plus "No progression".** "Add 2.5 kg to a plank" is never rendered.

### Picker states

| Exercise shape | Options offered | Notice |
|---|---|---|
| every progressed set is `reps_weight` | all seven + None | none |
| every progressed set is timed | `rep-progression` + None | `timedNotice` |
| **mixed** | all except `weekly-volume` + None | `mixedNotice` |

The mixed row is the subtle one and it is not a compromise. Because the metric-mode guard is per **set**, a `linear` scheme on a mixed slot legitimately progresses the lifting rows while leaving timed rows alone; hiding it would remove a working configuration. `weekly-volume` is excluded even when mixed, because its guard is exercise-level — resizing is a whole-list operation and one timed working set disables it outright.

### `rep-progression` params, mode-aware

The scheme carries both pairs. The picker shows the pair that matches:

| Exercise shape | Fields |
|---|---|
| all timed | `incrementSec` + `maxSec` |
| all reps | `incrementReps` + `maxReps` |
| mixed | both pairs, each labelled with what it moves |

Preview sentence under the picker, from `SchemeCopy.sentence.secProgressionCapped`: `+15 sec each session, up to 120 sec.`

> **Warning for implementers.** `programExerciseSchema` deliberately does *not* re-validate metric-mode × scheme, because MCP write tools accepted illegal combinations before cardio v1 and a parse-time throw would brick full-replace saves of legacy programs. The picker filters what is **offered**; it must never filter what is **loaded**. An exercise arriving with a stored illegal scheme renders that scheme's name with `timedNotice` beside it and keeps it until the author changes it.

## 08 · Deload week display

`deloadPolicy.shape.timedExercises` is `untouched` (default) or `scaled`. The engine already differs; no surface says so, which is how an author discovers the setting by accident in week 5.

| Arm | Fully-timed exercise | Mixed exercise |
|---|---|---|
| `untouched` | derives as a **normal week**: same set count, same durations, no `derivedFrom: 'deload'` stamp | lifting rows scale-shape and stamp; timed rows byte-identical and unstamped |
| `scaled` | working-set count × `setFactor` (ceil, min 1); `rpeCap` clamps derived RPE stamps | uniform whole-exercise treatment |

Under **both** arms a timed set's duration is unchanged — `durationSec` is never multiplied by `loadFactor`. That is the most surprising fact here and the copy must carry it: the deload shortens the *list*, never the *interval*.

### Surface rules

- **`untouched`, fully timed** — renders identically to a non-deload week, with an `As written` badge in the muted ink. No volt, no `DL`. Words, not a pill: this is metadata, and *"chips are controls, words are labels"* forbids decorating it.
- **`untouched`, mixed** — the `DL` treatment lands on the lifting rows only; timed rows sit unbadged among them. This is correct and looks wrong at a glance, so the exercise carries one caption — the already-translated `ProgramBuilder.timedExercises.untouched`, *"Untouched — timed work trains as written"*.
- **`scaled`** — timed rows join the `DL` treatment. Rows dropped by `setFactor` vanish exactly as lifting rows do; no ghost row marks the removal.
- **`none` / `reactive`** — no deload treatment at all, and nothing timed-specific to say.

The builder's `timedExercises` radio group already exists with both arms translated; the only change is that the *plan* surfaces now reflect the choice instead of leaving it a hidden derivation detail.

## 09 · The week grid, and the mobile/desktop question

### There is no desktop table

DESIGN.md is explicit: single column, `max-w` ~28rem, centred, phone-first, and *"every other surface stays the single phone column"* — HOME's bento is the one named exception. The builder is therefore **the same 448px column at 390px and at 1920px**, and there is no responsive breakpoint anywhere in the set rows today. Do not spec a wide desktop table: it would be the first surface to break that rule, and it would break the token layer's portability contract with the SwiftUI and Compose targets at the same time.

What is genuinely desktop-specific:

- Pointer hover on the header control and the mode menu (`hover:bg-muted/50`, per `DividerRow`).
- Full keyboard path: Tab across metric columns in visual order; `Enter` chaining Time → Distance → Load, reusing the logger's `enterKeyHint`/`onKeyDown` chain; Escape closing the mode menu and returning focus to its header button.
- The mode menu renders as a popover on fine pointers and may render as a bottom sheet under `(pointer: coarse)`; both carry the same roving-arrow contract.

At 390px the only new pressure is the opt-in Load column, handled by the Rest demotion in §04.

### The week grid cell

Cells are two-line: line 1 is the **primary metric**, line 2 is the **secondary**. In `reps_weight` that reads reps over load. The timed equivalent:

| Mode | Line 1 | Line 2 |
|---|---|---|
| `reps_weight` | `8–12` | `100 kg` |
| `duration` | `1:30` | carry load (`20 kg`) if authored, else empty |
| `duration_distance` | `12:30` | `2.5 km`, or `2.5 km · 20 kg` when a carry load exists |

Rules the grid must hold:

- **Line 1 is never empty.** A timed set without a duration cannot be saved (`programSetIntegrityViolation`), so line 1 always has a clock. A legacy row predating the constraint renders `WeekGrid.empty` (`—`) rather than collapsing the row height.
- **Line 2 may be empty; the cell keeps its height.** Same discipline as the logger reserving the Prev column's `w-10` from first paint — a grid whose row height changes between weeks is unreadable.
- **The clock is the tell.** No per-cell mode badge. `1:30` cannot be mistaken for reps and `2.5 km` cannot be mistaken for a load, so the column header (§03) carries the mode for the whole exercise and the cell carries none.
- **Deload cells** follow §08: `DL` where the engine stamped `derivedFrom: 'deload'`, `As written` where a timed row went unstamped under `untouched`.
- **Numerals are `tnum`** on both lines so weeks compare vertically.
- Composition reuses the `StatTile` label-over-value idiom (`<dt>` small, `<dd>` heavier) rather than inventing a second two-line vocabulary.

## 10 · Stories

CLAUDE.md requires a `.stories.tsx` beside every component, and **nothing in `src/app/programs/**` has one** — `ProgramBuilder` and `SchemeSubtitle` both ship storyless. The three surfaces this spec touches must not extend that debt:

| Component | Story states |
|---|---|
| the mode menu | uniform ×3 modes, mixed, carry-load on/off, open-at-viewport-edge |
| `SchemePicker` | all-reps, all-timed (`timedNotice`), mixed (`mixedNotice`), stored-illegal-scheme, `rep-progression` params in all three shapes |
| the week grid cell | each mode × {load, no load} × {normal, `DL`, `As written`}, plus the legacy `—` |

Following `ghost.stories.tsx`'s precedent, a story that needs a sibling's geometry references the sibling rather than restating it, so the two cannot drift.

## 11 · States

| State | Trigger | Presentation |
|---|---|---|
| default | uniform mode, sets present | header row + rows in that mode |
| empty | exercise with no sets | no header row; `+ Add set` only (shipped) |
| mixed | sets disagree | header reads `Mixed`; rows render per-set |
| menu open | header tapped | radio menu, `aria-checked` on current, roving arrows |
| flatten confirm | mode chosen while mixed | `ConfirmDialog`, §02 copy |
| invalid | timed set with blank Time | field ring in `--destructive`; `validation.durationRequired` under the set group; save disabled |
| deload, untouched | derived week is the deload, arm is `untouched` | `As written` badge, no `DL`, no volt |
| deload, scaled | arm is `scaled` | `DL` treatment on timed rows; durations unchanged |
| legacy illegal scheme | stored load-anchored scheme on an all-timed exercise | scheme name renders with `timedNotice`; never auto-corrected |
| unit change | `user_preferences.unit` flips | distance strings re-derived from canonical metres on next hydrate |

## 12 · Rejected

- **Per-set mode switching in the builder.** §02. The schema keeps it; the builder does not offer it.
- **A dual m/km (or yd/mi) entry toggle.** `duration.ts` already rejected it, correctly: a typed number must always mean one thing.
- **A separate distance-unit preference.** `lengthUnitFor` set the precedent against it; two unit settings is one more than anyone will find.
- **A wide desktop set table.** DESIGN.md, Layout & Mobile.
- **A `Timed` pill on every timed row.** `plannedSetChips` earns its `Timed` chip on a collapsed *template* line, where no column headers exist. In a table with a `Time` header the chip is noise, and a pill that does nothing violates *"chips are controls"*.
- **Auto-correcting a stored illegal scheme on load.** Silent rewriting of an author's config; the engine already no-ops it harmlessly.
- **Multiplying `durationSec` by `loadFactor` on a scaled deload.** The engine deliberately does not; halving a plank's hold is a different exercise, not a deload.

## 13 · Open questions

1. **Per-week load override on a timed set** (§04) — widen `mergeOverride`'s `reps_weight` guard, or state the limitation on the override surface? Widening changes derived output for stored programs, which the standing byte-identical law makes a decision rather than a bug fix.
2. **Rest demotion** (§04) — is the set-row menu the right home, or is `duration_distance` + carry load rare enough to accept a tight row instead?
3. **`incrementSec` granularity** — the field caps at 600 s/session. Plain decimal input, or a stepper on the `WeightStepper` precedent?

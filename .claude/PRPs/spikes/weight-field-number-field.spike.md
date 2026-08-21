# Spike: retire the hand-rolled weight rail for Base UI's NumberField

**Date**: 2026-08-21 · **Status**: exploration, no code changes

## The question

Should the logger's weight field become a `NumberField` from `@base-ui/react`
(already a dependency, `^1.5.0`, currently unused), retiring the hand-rolled
`WeightStepper` rail?

## Why it is being asked

Two bugs and one gap all trace to the same root: the rail is a **focus-gated
widget that mounts and unmounts inside the layout**.

| Symptom | Cause |
|---|---|
| Finish ate the first tap (#294) | rail unmounts on the mousedown that blurs the input; the bar moved before mouseup |
| "+ Add set" ate the first tap | same, for content BELOW the rail; fixed by docking the rail in the sticky bar |
| ± had no keyboard path at all | rail is unreachable by Tab — it unmounts on the first Tab away, and docking put it far from its input in DOM order |

An **always-mounted** stepper cannot produce any of the three. That is the
real argument here, not tidiness.

## The stated blocker, tested: Safari's incrementers

> "we can't use number field because safari adds the incrementers"

**This does not apply to Base UI's NumberField.** Verified against the
installed package, not from memory:

```
node_modules/@base-ui/react/number-field/input/*.js
  →  type: 'text',  autoComplete: 'off',  inputMode (computed)
```

`NumberField.Input` renders `type="text"`. Native spinners are a
`<input type="number">` behaviour **only**, so Safari (and Chrome) render no
incrementers. Every serious number-field primitive avoids `type="number"` for
exactly this reason — plus wheel-scroll changing the value on hover, and
`type=number` rejecting partial entry in ways that break decimals and locale.

The concern would have been correct and fatal for a bare
`<input type="number">`. It is not a reason to rule out this component.

## What NumberField would give us

- Arrow / Home / End stepping on the **input** — change reason `'keyboard'`,
  the model we hand-rolled in `2f30105`
- `alt` = `smallStep`, `shift` = `largeStep`
- `min` / `max` clamping, `snapOnStep`
- Increment / Decrement parts with the a11y already settled
- `onValueChange` with a **reason** enum (`'keyboard' | 'increment-press' |
  'decrement-press' | 'input-change' | 'input-clear' | 'input-blur' |
  'input-paste' | 'wheel' | 'scrub'`) — strictly more information than we
  have today, and enough to keep haptics/dip on pointer steps only
- Optional scrub area (drag to change)

## What it costs — where the actual work is

**1. Value model.** NumberField owns `number | null` with `Intl` formatting.
Our field is a `string`, and that is load-bearing in four ways:

- partial entry (`"10."` mid-typing) must survive
- **non-numeric passthrough**: `stepWeightValue` returns `null` and REFUSES to
  clobber what was typed
- **empty ≠ 0**. Empty means "not logged"; `0` is a real logged value
- the same field means total load, *added* load, or *assistance* depending on
  `loggingType` (see the logging-type weight semantics rule) — so any
  clamping or formatting has to be per-row, not global

**2. Ghost adoption — the likely dealbreaker.** An untouched field shows the
plan target as a placeholder, and stepping **adopts that ghost and steps from
it** ("+ on an untouched set means more than last time"). NumberField has no
concept of stepping from a placeholder: its value is `null`, and `null + step`
is not "ghost + step". This is product behaviour with tests behind it and no
upstream equivalent. It would have to be re-expressed in our `onValueChange`,
if it can be expressed at all.

**3. Layout.** `NumberField.Group` wants `Decrement | Input | Increment`
adjacent. The set row is already `circle | prev | reps | weight | X` at 390px —
which is precisely why the rail became a separate strip, and then moved to the
bar. The Group shape fights the decision we just shipped.

**4. Blast radius.** This is the hottest surface in the product and it changed
twice today.

## Options

| | Shape | Gets | Costs |
|---|---|---|---|
| **A** | Full adopt: Root + Group + Input + Increment/Decrement, inline | Everything, including no-focus-gating by construction | Loses the thumb-zone docking; fights the 390px row; largest value-model migration |
| **B** | Partial: `NumberField.Root` + `NumberField.Input` replace our `Input`; keep the docked rail as our own buttons driving Root's API | Value model, stepping, clamping, formatting, a11y — while keeping the bar docking the owner approved | Still needs the value-model and ghost-adoption reconciliation |
| **C** | Do nothing | Zero risk; current state is correct and tested | We own these semantics forever, and the next focus-gated widget re-learns the same bug |

## Recommendation

**Option B, and prove ghost adoption FIRST.** It is the piece most likely to
show that NumberField's controlled model cannot express what this product
needs. If it cannot be expressed cleanly, stop and stay at **C** — the current
implementation is correct, tested, and the comments now explain the model
rather than apologise for it.

Do not start with the layout. Layout is the visible part and the least
informative.

## Answered already, without writing code

**Q1 — can it be driven from our string? NO.** `value` is `number | null` and
`defaultValue` is `number`; there is no string mode. Consequence: the draft
can stay a string (convert at the boundary), but the COMPONENT is the source
of truth for the parsed number, and anything the number cannot hold is lost
there.

**Q3 — empty vs `0`? SAFE.** `null` is empty and distinct from `0`, and there
is an explicit `'input-clear'` change reason for "the field became empty". The
"empty means not logged" contract survives.

**Q4 — non-numeric passthrough? LOST.** `number | null` cannot hold
`"bodyweight"`. Today `stepWeightValue` returns `null` and refuses to clobber
whatever was typed. **Owner question**: does anyone actually type text into a
weight field? If not this is a non-loss, and the refusal is just defensive
code we can retire.

**Q2 — ghost adoption? YES. PROVEN, not assumed.** Written and run against
the installed package (5/5 green): ghost adoption survives the seam, from the
increment button, the decrement button, and the keyboard.

Direction is the crux, and it must come from the REASON — never from the
`next` value the component reports, which is already its own step-from-empty
and cannot express intent. `'increment-press'` and `'decrement-press'` give
direction directly; `'keyboard'` carries the `KeyboardEvent`, so `event.key`
gives it:

```tsx
onValueChange={(next, details) => {
  let dir: 1 | -1 | 0 = 0
  if (details.reason === 'increment-press') dir = 1
  else if (details.reason === 'decrement-press') dir = -1
  else if (details.reason === 'keyboard') {
    if (details.event.key === 'ArrowUp') dir = 1
    else if (details.event.key === 'ArrowDown') dir = -1
  }
  // Empty means "not logged", so the component's arithmetic is never right
  // here — see the finding below. We own the step from empty entirely.
  if (dir !== 0 && value === null) {
    setValue(Math.max(0, (ghost ?? 0) + dir * step))
    return
  }
  setValue(next)
}}
```

**New finding, and the reason the interceptor cannot be ghost-only:** from
`value === null` with `min={0}`, NumberField hands back **`min` (0), not
`0 + step`**. Our `stepWeightValue` returns `2.5` in that case. So the
substitution has to cover the no-ghost empty case as well — one expression
covers both, as above. The consequence worth stating plainly: **when the field
is empty, stepping is entirely ours**; NumberField's own arithmetic only takes
over once a value exists. That is a maintenance fact, not a blocker.

Home/End and PageUp/PageDown also arrive as `'keyboard'`. They jump rather
than step, so they fall through to `next` — which is correct, but means a
future large/small-step decision has to revisit this branch.

## What is left to prove, in order

1. ~~Ghost adoption through the reason seam~~ — **done, it works** (above).
2. Partial entry (`"10."`) survives typing without the parse fighting the
   caret. This is now the riskiest unknown.
3. `loggingType` semantics: per-row min/format without a global assumption.
4. Only then: layout, and whether the rail stays docked.

**Status after this round: the migration is viable.** The blocker that was
raised (Safari incrementers) does not apply, and the behaviour feared to be
inexpressible is expressible. What remains is real work, not open questions —
except partial entry, which is worth one more experiment before committing.

## Open questions for the owner

- **Large/small step** is settled: one step size, user-configurable in
  settings (see the separate change). No shift/alt modifiers.
- **Large/small step**: is `shift`/`alt` stepping wanted, or is one step size
  (2.5kg / 5lb) the product's opinion?
- If ghost adoption cannot survive the migration, is losing it acceptable? (I
  would say no — it is the behaviour that makes an untouched set one tap.)

## Scrub area (drag-to-change): researched, and the answer is "yes, but not there"

I first dismissed this on instinct. That was wrong; here is the evidence.

**What it is.** Press and drag sideways on a target element — usually the
label, not the input — to change the value. A desktop design-tool idiom
(Figma, Blender, After Effects). Base UI's `ScrubArea` is a separate `<span>`,
so it is a deliberate target, not the whole field.

**Three concrete reasons NOT to put it on the set row:**

1. **The gesture is already taken.** `swipe-to-delete.tsx` owns horizontal
   drag on every set row — `touch-action: pan-y`, an axis lock after N px, and
   an explicit "never start from an input or button". A horizontal scrub in
   the same rows would compete with delete for the same finger movement.
2. **`ScrubArea` sets `touchAction: 'none'`.** Wherever it lands becomes a
   region the page cannot be scrolled from. In a phone-first scrolling logger
   that is a dead zone under the thumb.
3. **It degrades on our primary platform.** The virtual cursor uses the
   Pointer Lock API, which Base UI **disables in Safari** (the browser's
   pointer-lock notification causes a layout shift there) — and pointer lock
   does not exist on touch at all.

**But docking the rail created the right home for it.** The sticky bar is
outside the scrolling flow, is not a set row, and does not scroll — so
`touch-action: none` costs nothing there, and there is no swipe-to-delete to
collide with. A scrub strip living in the docked rail is the one placement
where all three objections evaporate.

**Industry check.** Scrub-on-label is a desktop idiom; the established MOBILE
pattern for weight entry is the ruler / tape picker, and the repeated advice
is to pair any drag mechanism with numeric entry for precision rather than
replacing it. Google Fit's drag-based weight entry drew criticism for exactly
the failure mode worth avoiding — adjusting a column the user did not intend
to touch. `pixelSensitivity` (default 2px) is the tunable that makes this
survivable; it wants to be much higher than the default here.

Sources: [UX of number inputs](https://luhr.co/blog/2025/07/01/a-deep-dive-on-the-ux-of-number-inputs/) ·
[slider UI patterns](https://www.eleken.co/blog-posts/slider-ui) ·
[ruler picker rationale](https://theadityatiwari.medium.com/building-a-custom-ruler-picker-for-android-why-i-ended-up-open-sourcing-it-0f06a6f5d123)

**Recommendation**: keep it out of scope for the NumberField migration itself,
then evaluate it as a follow-up **in the docked rail only**, with a raised
`pixelSensitivity` and the numeric field always available beside it.

## Not in scope

Reps, duration and distance inputs. They have no stepper today, so there is no
inaccessible function to fix, and pulling them in triples the surface.

# Reordering

Moving a **day** within a program, an **exercise** within (or across) a day, and
a **set** within an exercise. Three MCP tools have shipped these operations to
the agent since Phase 4; none of them has ever had a human affordance. This is
the interaction design for all three, on touch and pointer, with a keyboard path
and a menu path that reach the same outcome.

- Status: draft / no implementation
- Date: 2026-08-22

## 01 · What exists today

**The tools.** `src/lib/mcp/program-patch-tools.ts` registers three moves. All
three address by *position*, not by id, and all three renumber the span between
`from` and `to` so positions stay contiguous:

| Tool | Address | Range | Documented constraint |
|---|---|---|---|
| `move_program_day` | `programId` + `from`/`to` | 0-based | within one program |
| `move_program_exercise` | `+ dayPosition` + `from`/`to` | 0-based | **within one day only** — "cross-day moves: remove then add" |
| `move_program_set` | `+ exercisePosition` + `from`/`to` | 1-based `setNumber` | within one exercise |

**The schema permits the splice.** `program_days_program_position_unique`,
`program_exercises_day_position_unique` and
`program_sets_exercise_set_number_unique` are each `DEFERRABLE INITIALLY
DEFERRED` (`src/db/schema.ts` §795, §828, §864) — that deferral exists *precisely*
so an in-place renumber that transiently collides still commits. Nothing in the
data layer resists reordering.

**The UI has none of it.** `src/app/programs/new/program-builder.tsx` is the only
editing surface (create and edit share it). Its reducer action union
(`src/app/programs/new/program-draft.ts` §154–182) has `ADD_*`, `REMOVE_*`,
`UPDATE_*`, `RENAME_DAY` — and **no `MOVE_*` action at any level**. Day sections,
exercise blocks and set rows each carry a single bare destructive icon-button
(`Trash2`, `Trash2`, `X`); there is no `⋮` overflow menu on any of them.

> **Correction to the brief.** There is no "Reorder" mode toggle in the app —
> not in the builder, not in the program detail, not in the mocks. The nearest
> thing is the Settings → Home layout editor, which is a *permanently* reorderable
> surface (always-on long-press drag + Move buttons in the tile sheet), not a mode.
> The mode-vs-always-on question below is therefore a greenfield choice, not a
> removal.

**The precedent to match.** `src/app/settings/home/` is the house pattern and it
is a good one: `editor-grid-dnd.tsx` (dnd-kit, PointerSensor at 250ms/5px,
KeyboardSensor, live state preview, commit once on drop, snapshot restore on
cancel) plus `tile-sheet.tsx:183` — *"Reorder — real buttons, always present
(WCAG 2.5.7: dragging is never the only path). Edges disable, they don't hide."*
This spec extends that sentence to three nested levels; it does not invent a
second vocabulary.

**The gap it leaves.** The home editor announces nothing when a tile moves
(`home-layout-editor.tsx:185` has only an error `role="status"`). There is no
shared live-region helper anywhere in the codebase. §06 fixes that here, and the
helper it introduces should be retrofitted to the home editor.

## 02 · The commitments

| Question | Commitment |
|---|---|
| Mode or always-on? | **Always-on. No reorder mode anywhere.** |
| Drag on touch? | **Day: yes. Exercise: yes. Set: no.** |
| Drag on pointer? | Day and exercise, via a handle revealed on `hover: hover`. Never the only path. |
| Guaranteed non-drag path | The row `⋮` menu, at **all three** levels, on every input modality. |
| Long-press | Spent on drag initiation at day and exercise; spent on opening `⋮` at set. Never on multi-select. |
| Drop indicator | 2px volt rule, not the `border` hairline. |
| Superset | The group is the drag unit. Membership is an edit, never a drop. |
| Cross-day exercise | Offered, but as one transactional server op, gated by an override warning. |

### Why always-on, not a mode

A mode is the cheaper thing to build and the wrong thing to build here.

1. **The builder is a form.** Every row already owns a tap target that means
   something else — a name input, five numeric fields, a metric-mode select. A
   mode that silently repoints "tap" from *edit this number* to *grab this row*
   is the classic modal error, and it is worst on the surface where the user is
   mid-thought about a rep range. A handle is a *spatially separate* target, so
   nothing a user already knows how to tap changes meaning.
2. **A mode has to be entered, and entry is the discovery problem.** A "Reorder"
   toggle in a header is a control the user must find, guess the meaning of, and
   remember to leave. A grip glyph on the row it moves is self-describing at the
   point of need.
3. **A mode has an exit, and the exit is a trap.** Modes strand people: the
   Done button scrolls off, the back gesture cancels the wrong thing, and any
   navigation while the mode is on has to decide whether to commit. Always-on has
   no exit state to get wrong.
4. **The house already chose.** The home layout editor is always-on. A second
   surface with a mode would mean two reorder vocabularies in one app for the
   same verb — the exact failure the "one glyph, one meaning, many scopes" rule
   in `DESIGN.md` exists to prevent.
5. **A mode does not buy accessibility.** The argument *for* a mode is that it
   makes drag discoverable. WCAG 2.5.7 requires a non-dragging path regardless,
   so the `⋮` menu ships either way — and once it ships, the mode's only
   remaining job is decoration.

The one real cost of always-on — permanent visual weight from a handle on every
row — is what §03 spends the density budget on, and it is why sets get no handle
at all.

### Why sets get no drag

NN/g's position is that touch drag-and-drop is a last resort, justified only
where users explicitly expect it and no lower-cost alternative exists. A program
set row fails both halves:

- **No expectation.** Nobody arrives at set 3 of an accessory lift intending to
  drag it. The realistic intent is "this should be the warm-up" or "move the
  AMRAP last" — a destination, not a gesture.
- **A lower-cost alternative exists and is better.** Sets per exercise are
  typically 2–5. "Move up" is one tap and lands exactly. A drag over a 44px row
  inside a vertically scrolling column, in a 28rem-max phone layout already
  carrying five numeric inputs, is a worse instrument for a 3-item list.
- **Density.** A handle would be a seventh target on a row that has six.
- **It frees long-press.** With no drag at set level, long-press on a set row is
  available to open the `⋮` menu — matching `src/app/workout/new/set-row-menu.tsx`,
  where long-press already opens the logger's set menu. Two set-row menus in one
  app that open the same way is a feature; two that open differently is a bug.

So `move_program_set` gets its first-ever affordance as a **menu-only**
operation. That is not a lesser path; it is the correct instrument for its scope.

## 03 · The three levels

Common to all three: a level's items live in one ordered container (days in a
program, exercises in a day, sets in an exercise) and reordering never crosses
levels. The single exception — an exercise crossing into another day — is §05.

### Day

**Anatomy.** The day `<section>` header gains a leading grip (`GripVertical`,
`size-4`, `text-muted-foreground`) inside a 44×44 button, and a trailing `⋮`
(`MoreVertical`) button that absorbs the existing `Trash2` as a menu item. Net
change to the header's target count: +1.

**Touch.** Long-press the grip (250ms hold, 5px tolerance — the home-editor
constants) starts a drag. A scroll flick or a quick tap never becomes one. Haptic
`vibrate(10)` on grab. The day collapses to its header while grabbed, so a
four-exercise day does not become an unliftable slab; the collapse is the
displacement animation's first 100ms.

**Pointer.** The grip is `opacity-0` until `:hover`/`:focus-within` on the header
under `@media (hover: hover)`, and permanently `opacity-100` under
`@media (hover: none)` — a coarse pointer has no hover to reveal with. Cursor
`grab`/`grabbing`. No activation delay on a fine pointer; a 5px threshold only.

**Menu (`⋮`).** `Move up` · `Move down` · `Move to…` · hairline · `Remove day`.

**Boundaries.** First day: `Move up` is present, `aria-disabled`, dimmed
(`opacity-30`), and still focusable so a screen-reader user can perceive that the
verb exists and why it is unavailable. Never hidden. Dragging above the first
slot rubber-bands ~8px with no drop indicator and no haptic.

### Exercise

**Anatomy.** The exercise `<h3>` row gains the same leading grip and trailing
`⋮`. The existing `Trash2` moves into the menu.

**Touch.** Same 250ms/5px long-press on the grip. An exercise dragged past the
last position of its day and held over the *next day's header* for 400ms enters
that day (§05); auto-scroll engages within 64px of the viewport edge at
≤600px/s. Because days stack vertically on a phone, a cross-day drop is only
committed when the destination day's header is visible — an off-screen day is
not a drop target, only the `Move to…` sheet reaches it.

**Pointer.** Identical reveal rule to Day.

**Menu (`⋮`).** `Move up` · `Move down` · `Move to…` · hairline ·
`Join superset above` **or** `Leave superset` (exactly one, per §04) · hairline ·
`Remove exercise`.

`Move to…` at this level opens a two-step sheet: pick a **day**, then a
**position** within it. The same sheet reaches both the within-day and the
cross-day outcome, so the user never has to know which tool underlies it.

**Boundaries.** Edge items disable `Move up`/`Move down` as at Day level —
*within the day*. `Move to…` is never disabled, because a first-position exercise
can still move to another day.

### Set

**Anatomy.** The set row gains one trailing `⋮`. The existing `X` moves into the
menu; the row's target count stays at six. No grip, no drag.

**Touch.** Tap `⋮`, or long-press anywhere on the row that is not an input
(matching the logger's set-row menu). The menu is fixed-positioned and anchored
at the press point, for the same reason `set-row-menu.tsx` is: an ancestor may
clip.

**Pointer.** `⋮` is revealed on row hover under `hover: hover`, always present
otherwise. Right-click on the row opens the same menu.

**Menu (`⋮`).** `Move up` · `Move down` · `Move to…` · hairline · `Remove set`.

`Move to…` here is a one-step position picker listing `1 of 4` … `4 of 4` with
the current position marked (`aria-checked` on a `menuitemradio` inline, or a
radio list in the sheet).

**Boundaries.** As above. An exercise keeps at least one set — that invariant
belongs to `remove_program_set`, not to a move, and nothing here can violate it.

## 04 · Supersets

`program_exercises.supersetGroup` is a nullable integer; **the same non-null
value on adjacent exercises within a day means "perform as a superset"**
(`schema.ts:816`). Adjacency is not decoration — the three read-only renderers
(`template-preview.tsx:92–126`, `workout-logger.tsx:1499`, `p/[token]/page.tsx`)
all assign letters by first appearance and draw the left rail
(`border-l-2 border-l-muted-foreground/40 pl-3`) with the caps label on the first
member only. A non-adjacent group renders as two unrelated groups wearing the
same letter. So adjacency is an invariant reordering must preserve, and that
dictates the whole rule:

**The group is the unit. Membership is an edit.**

1. **Grabbing any member grabs the whole group.** The rail, the letter and every
   member lift together and land together. The grabbed treatment applies to the
   group as one block.
2. **The gap between two members of a group is not a drop target.** Insertion
   points exist above and below the group, never inside it. This is what makes
   the invariant unbreakable by drag rather than merely discouraged.
3. **You cannot drag an exercise out of a group, and you cannot drag one in.**
   Drop position never changes membership. Position and membership are different
   facts and a single gesture must not set both — that ambiguity is why
   drag-into-folder interactions need a dwell timer and a distinct visual state,
   and it is not worth paying for here.
4. **Membership changes through the menu, explicitly.** `Join superset above`
   appears on an exercise whose immediate predecessor is in a group (or is an
   ungrouped exercise, in which case joining *creates* a new group of two, taking
   the next unused integer for the day). `Leave superset` appears on a member.
   Exactly one of the two is ever present.
5. **Leaving from the middle splices, and says so.** Clearing `supersetGroup` on
   a middle member would strand the group non-adjacent, so leaving *also* moves
   the exercise to immediately after the group's last member. That is a position
   change the user did not ask for, so it is announced
   (`announce.supersetLeft`) and reflected by the same 100ms displacement a drag
   would use. Leaving from the first or last member is a pure membership change —
   nothing moves, and the announcement says so
   (`announce.supersetLeftInPlace`).
6. **A group of one is not a group.** If a leave (or an exercise removal) reduces
   a group to a single member, that member's `supersetGroup` is cleared in the
   same edit.
7. **Cross-day carries the group.** An exercise that is a group member cannot
   cross into another day alone: `Move to…` on a member moves the whole group,
   and the sheet's title names the group ("Move superset A, 2 exercises"). To move
   one member alone, leave the superset first — two deliberate steps for two
   deliberate facts.

**What this costs at the tool layer.** A group move of *n* members is *n*
sequential `move_program_exercise` calls. In the UI that is irrelevant — the
builder reorders draft state and the whole program is rewritten on save (§08) —
but the agent path must sequence them, and the deferrable uniques are what let
each intermediate state exist inside the transaction.

## 05 · Cross-day exercise moves

`move_program_exercise` is within-day only; the documented cross-day recipe is
*remove then add*. Three consequences the interaction must own:

**It must be one transaction.** Remove-then-add as two round trips can lose an
exercise if the second fails. The UI's server action performs both inside a
single transaction; only the agent, calling the tools directly, sees the two-step
shape. The interaction never exposes the seam — the user moved an exercise.

**Per-week overrides do not survive it.** `program_set_overrides` is addressed by
`(dayPosition, exercisePosition, setNumber, week)` — the "`setAddress` reordering
hazard" that `docs/specs/muscle-roles.md` calls out under Save/replace. A
within-day or within-exercise move re-addresses cleanly because the splice is a
renumber. A cross-day move is a *delete*, and the overrides go with it. This is
not silently acceptable, so:

> **Cross-day moves confirm when overrides exist.** Before committing, a
> `ConfirmDialog` states the count: *"3 week overrides on this exercise will be
> cleared. The exercise, its sets and its notes move intact."* Move anyway /
> Keep here. When the exercise has no overrides the dialog does not appear — a
> confirmation nobody needs is a confirmation nobody reads.

**Exercise notes follow identity, not position.** `src/db/note-sync.ts:134`
already keys notes to exercise identity so reorders keep them. Cross-day is a
reorder as far as notes are concerned and they survive. Say so in the dialog;
never warn separately about what is safe.

**The three routes to a cross-day move**, in order of expected use:

1. `⋮` → `Move to…` → pick day → pick position. The only route that reaches an
   off-screen day. Always available.
2. Keyboard: grab, `Tab` to the next day, arrows to position, `Enter`. (§06)
3. Drag: hold over the destination day's header for 400ms to enter it. Available
   only when that header is on screen.

## 06 · The keyboard model

Adobe React Aria's model, adapted to the fact that every container here is a
single vertical axis: **arrows pick the position, `Tab` changes the container.**
Tab is reserved for the one cross-container case (exercise → another day); at day
and set level it is not bound, which leaves the move mode's key set smaller.

The grip is a `<button>` and a tab stop, distinct from the row's other controls —
two stops, two verbs, exactly as `editor-grid-dnd.tsx` reasons about its sortable
wrapper. Where there is no grip (set level), the `⋮` menu's `Move up`/`Move down`
items *are* the keyboard path and no move mode exists; that is sufficient for a
2–5 item list and it is one fewer mode to teach.

| Key | In move mode | Result |
|---|---|---|
| `Enter` / `Space` on grip | — | Enter move mode. Grab. |
| `↑` / `↓` | ✓ | Insertion point one slot up/down within the container. Live preview. |
| `Home` / `End` | ✓ | First / last position in the container. |
| `Tab` / `Shift+Tab` | ✓ (exercise only) | Next / previous **day**, landing at that day's last position. |
| `Enter` / `Space` | ✓ | Drop. Commit. Focus returns to the grip, now on the moved row. |
| `Escape` | ✓ | Cancel. Restore the pre-grab snapshot. Focus returns to the grip. |
| any other key | ✓ | Ignored — move mode swallows it rather than leaking a keystroke into a numeric input. |

Move mode is exited only by `Enter`, `Space`, `Escape`, or blur (blur cancels).
Nothing in it is a trap: `Escape` always works and always restores.

Explicit **drop indicators between items** are rendered in move mode exactly as
they are in a drag — the keyboard user sees the same 2px volt rule at the same
insertion point (§07). Position is never conveyed by the moving row alone.

While move mode is active the grabbed row carries `aria-grabbed="true"` and the
container carries `aria-dropeffect="move"`. These are deprecated in ARIA 1.1 and
are *supplementary* — the live region below is the actual mechanism; the
attributes are there for the assistive tech that still honours them.

### Announcements

One polite live region per editor, plus one assertive region for the
grab/drop/cancel boundary events. The codebase has no live-region helper today —
every instance is hand-rolled inline (`plate-sheet.tsx:364`,
`session-toast.tsx:181`, …) — so this spec obligates a small shared
`<LiveAnnouncer>`, which should then be retrofitted onto the home layout editor.

| Event | Politeness | Message key |
|---|---|---|
| Grab (day, set) | assertive | `announce.grabbed` |
| Grab (exercise) | assertive | `announce.grabbedCrossDay` |
| Grab (superset member) | assertive | above, then `announce.grabbedSuperset` |
| Position change | polite | `announce.position` |
| Position change across days | polite | `announce.positionInDay` |
| At a boundary | polite | `announce.boundaryFirst` / `announce.boundaryLast` |
| Drop | assertive | `announce.dropped` / `announce.droppedInDay` |
| Cancel | assertive | `announce.cancelled` |
| Menu move | polite | `announce.dropped` — a menu move announces its outcome exactly as a drag does |
| Join / leave superset | polite | `announce.supersetJoined` / `announce.supersetLeft` / `announce.supersetLeftInPlace` |

Position-change announcements are **debounced 100ms** so holding `↓` does not
flood the buffer; the final position always announces. Boundary announcements do
*not* exit move mode — the user is told nothing happened and stays grabbed.

## 07 · Visual treatment

### The drop indicator

The structural hairline is `border-b border-b-border/60` — `oklch(1 0 0 / 12%)`
at 60% opacity, roughly 7% white over `#0a0a0a`, about **1.1:1**. It is a
divider, and a divider is allowed to be invisible-as-an-indicator because it
carries no state. A drop indicator *is* a state indicator, and WCAG 1.4.11 puts it
at **3:1 against adjacent colours**. So it cannot be the divider token at any
opacity, and it cannot be a thicker divider either — same hue, same failure.

**The recipe.**

- 2px tall, full width of the list's content box, `rounded-full`.
- Colour: `--primary` (the volt, `oklch(0.86 0.19 128)`). Against `--background`
  `oklch(0.145 0 0)` and against `--card` `oklch(0.205 0 0)` it clears 3:1 by a
  wide margin. **No new token** — the volt is the app's state colour, and adding
  a near-volt "drop" token would be a second accent by the back door.
- It sits in a 2px gap the neighbours open for it, so the indicator never
  overlaps content and its 3:1 is measured against a known background.
- Minimum 2px: a 1px volt rule in a list framed by 1px hairlines invites a
  "which line is which" glance, and 1px hairlines are the surrounding vocabulary.
- Forced colors: `@media (forced-colors: active)` repaints it as `Highlight` at
  the same 2px. WHCM drops `box-shadow` and flattens custom colours; the
  indicator must survive that the way the divider-row focus ring survives via
  `focus-visible:outline-hidden`.

**The one-volt rule still holds.** `DESIGN.md` allows one volt moment per screen.
A move in progress *is* that moment — so **while a move is active the builder's
primary Save button drops to the quiet/secondary treatment** and the drop
indicator is the screen's only volt. This is checkable in review, and it is the
rule that keeps an always-on reorder affordance from smuggling a second accent
onto the surface.

**Colour is never the only channel.** The indicator is accompanied by (a) the
2px gap — a positional change visible without colour, (b) the grabbed item's own
state, and (c) the live-region announcement.

### The grabbed item

- `opacity-60` on the item left in the flow; the lifted copy under the pointer
  renders in a `bg-card rounded-xl` shell with a shadow. This is a **keep-list**
  case (`DESIGN.md` → "Sheets, dialogs, popovers — elevation is the point of an
  overlay"): a drag ghost is an overlay, and it is transient, so the de-card rule
  does not bite. It must not persist after drop.
- `scale(1.02)` and the shadow are `motion-safe:` only.

### Motion and haptics

- Displacement animates **100ms** `ease-out`; reshuffle triggers when the dragged
  item's **centre** crosses a neighbour's edge, and the item snaps magnetically
  to the resolved slot on drop.
- `prefers-reduced-motion: reduce`: no displacement animation and no scale — the
  rows jump. The indicator, the gap and the announcements are unchanged.
- `navigator.vibrate(10)` on grab and on each reshuffle. Nothing on drop (the
  snap is the feedback). Haptics are decoration: iOS Safari has no `vibrate`, so
  no state may depend on them.

## 08 · Persistence and failure

Reordering is a **draft edit**. The builder holds the program in a `useReducer`
draft and writes nothing until Save, which replaces the program wholesale
(`replaceProgram` deletes and reinserts). Position changes therefore cost nothing
at save time, and no `move_*` tool call happens on the human path at all — the
tools remain the agent's vocabulary for the same verbs. `CoachToolCall.change.
moveDay` / `moveExercise` / `moveSet` already exist to describe them in the coach
transcript; the human UI must **not** reuse those strings, which are written in
the agent's reporting register.

What this obligates, and what a plan must add:

- Three new reducer actions — `MOVE_DAY`, `MOVE_EXERCISE`, `MOVE_SET` — plus
  `SET_SUPERSET_GROUP` for §04's join/leave. Each is a pure splice on an
  immutable copy.
- `MOVE_EXERCISE` takes a destination `dayIndex` as well as a position, so
  cross-day is the same action.
- The superset invariants (adjacent members, no group of one) are enforced *in
  the reducer*, not at the call sites — one place to test.
- A cancelled drag restores a pre-grab snapshot, exactly as `drag-controller.ts`
  does today. A drag is one edit, not one edit per frame.

**Failure.** The only failure a move can hit is Save failing, which the builder
already surfaces (`ProgramBuilder.saveError`). A move that cannot be applied to
the draft (a stale index after a concurrent remove) is a no-op with a polite
announcement — `Reordering.error.failed`, "That move didn't stick. Nothing
changed." Silence over corruption.

## 09 · Copy and i18n keys

New namespace **`Reordering`** — one namespace for the reorder layer across all
three levels, grouped by surface. Depth stays at 3. Per `docs/I18N-KEYS.md` §4
these are **not** shared with `TileSheet.move.*` despite identical English: the
home editor moves sections, this moves training entities, and the two will
diverge in any language that inflects the object.

```jsonc
"Reordering": {
  "handle": {
    "dayAriaLabel": "Reorder day {position}",
    "exerciseAriaLabel": "Reorder {exerciseName}",
    "supersetAriaLabel": "Reorder superset {letter}, {count} exercises",
    "roleDescription": "reorder handle"
  },
  "menu": {
    "dayTriggerAriaLabel": "Day {position} actions",
    "exerciseTriggerAriaLabel": "{exerciseName} actions",
    "setTriggerAriaLabel": "{exerciseName} set {position} actions",
    "moveUp": "Move up",
    "moveDown": "Move down",
    "moveTo": "Move to…",
    "joinSuperset": "Join superset above",
    "leaveSuperset": "Leave superset"
  },
  "sheet": {
    "dayTitle": "Move day {position}",
    "exerciseTitle": "Move {exerciseName}",
    "supersetTitle": "Move superset {letter}, {count} exercises",
    "setTitle": "Move set {position}",
    "dayStepLabel": "Day",
    "positionStepLabel": "Position",
    "positionOption": "{position} of {count}",
    "currentOption": "{position} of {count} — where it is now",
    "confirm": "Move",
    "cancel": "Cancel"
  },
  "announce": {
    "grabbed": "Grabbed {name}, position {position} of {count}. Arrow keys to move, Enter to drop, Escape to cancel.",
    "grabbedCrossDay": "Grabbed {name}, {dayName}, position {position} of {count}. Arrow keys to move, Tab to change day, Enter to drop, Escape to cancel.",
    "grabbedSuperset": "Moves with its superset, {count} exercises.",
    "position": "{name}, position {position} of {count}.",
    "positionInDay": "{name}, {dayName}, position {position} of {count}.",
    "boundaryFirst": "{name} is already first.",
    "boundaryLast": "{name} is already last.",
    "dropped": "{name} moved to position {position} of {count}.",
    "droppedInDay": "{name} moved to {dayName}, position {position} of {count}.",
    "cancelled": "Move cancelled. {name} back at position {position}.",
    "supersetJoined": "{name} joined superset {letter}, {count} exercises.",
    "supersetLeft": "{name} left superset {letter} and sits after it, position {position} of {count}.",
    "supersetLeftInPlace": "{name} left superset {letter}. Its position is unchanged."
  },
  "crossDay": {
    "warningTitle": "Moving to another day",
    "warningBody": "{count, plural, one {# week override} other {# week overrides}} on this exercise will be cleared. The exercise, its sets and its notes move intact.",
    "confirm": "Move anyway",
    "cancel": "Keep here"
  },
  "hint": {
    "days": "Drag a day by its handle, or use its menu to move it.",
    "exercises": "Drag an exercise by its handle, or use its menu to move it between days."
  },
  "error": {
    "failed": "That move didn't stick. Nothing changed."
  }
}
```

Notes on the copy:

- Every accessible name **leads with the verb** — "Reorder day 2", not "Day 2
  handle" — per the `DESIGN.md` rule that a name which is pure state leaves a
  control announcing no verb.
- `menu.moveTo` keeps the ellipsis: it opens a further choice, which is what an
  ellipsis promises.
- `sheet.currentOption` exists so the picker can mark the status quo without
  relying on a visual checkmark alone.
- No key encodes its copy (`moveUp`, not `moveThisDayUpOneSlot`), no key is
  numbered, and the plural lives inside the ICU value, not in a sibling key.

## 10 · Rejected

| Rejected | Why |
|---|---|
| A "Reorder" mode toggle | §02. Repoints existing tap targets, needs discovery and an exit, buys no accessibility, and forks the app's reorder vocabulary. |
| Drag handles on set rows | §02. A seventh target on a six-target row, for a 2–5 item list where two taps land exactly. |
| Long-press for multi-select ("move these three") | Long-press is spent — on drag at day/exercise, on the menu at set. It cannot do both. Multi-move is out of scope. |
| Drag to change superset membership | §04. One gesture setting two independent facts; needs a dwell timer and a third visual state to disambiguate. |
| A dedicated `--drop-indicator` token | A near-volt second accent by the back door. The volt is the state colour; the one-volt rule is satisfied by quieting Save during a move. |
| A thicker `--border` for the indicator | Fails 1.4.11 at any thickness — it is the wrong hue, not the wrong size. |
| Tab-through-drop-targets (React Aria's literal model) at every level | Correct for 2-D and multi-container grids. These are single vertical axes; arrows are the natural picker, which frees Tab for the one genuinely cross-container case. |
| Cross-day drag to an off-screen day | An auto-scroll drag past several collapsed days is unaimable on a phone. `Move to…` is the honest instrument for a distant destination. |
| Optimistic per-move persistence | The builder is a draft; a move is one edit among many, and Save already replaces the program wholesale. |

## 11 · Acceptance

A reviewer should be able to check each of these against the built surface.

1. No reorder mode exists. Nothing on any program surface toggles what a tap
   means.
2. Every level reaches every reachable position with **keyboard only**, and with
   **menu only**, without a pointer or a drag.
3. `move_program_set` has a human affordance: `⋮` → Move up / Move down /
   Move to…
4. Edge items **disable** their move verbs; none is hidden; all stay focusable.
5. No drop indicator can appear between two members of a superset group.
6. Dragging any superset member moves every member, with the rail and letter
   intact and adjacency preserved.
7. No drag or drop can change `supersetGroup`. Only the two menu items can.
8. A cross-day move with overrides shows the count before it commits; one
   without shows no dialog.
9. The drop indicator measures ≥3:1 against both `--background` and `--card`,
   is ≥2px, and is not the `border` token.
10. While a move is active, the drop indicator is the only volt on screen.
11. Every move — dragged, keyboard, or menu — produces the same announcement.
12. Under `prefers-reduced-motion: reduce` nothing animates and every path still
    works.
13. Under forced colors the drop indicator is still visible.
14. `Escape` always cancels and always restores. There is no state a move can
    strand the user in.

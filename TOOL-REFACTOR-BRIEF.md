# Coach tool-surface refactor

The coach exposed **40 MCP tools**. This is the record of what we cut, what we
didn't, and why.

## What shipped

### 1. `list_workouts` is bounded

The original brief called for turning eight `list_*` tools into `search_*`.
Auditing them first showed the premise didn't hold — only one was actually
unbounded:

| tool | bounded before? |
|---|---|
| `list_workouts` | **no — every workout ever logged** |
| `list_notes` | yes — filters + `limit` (max 200) |
| `list_program_changes` | yes — `limit` + compound cursor |
| `list_programs`, `list_proposals`, `list_templates`, `list_custom_exercises`, `list_goals` | bounded by reality (a handful of each) |

`list_workouts` was the one that grows forever. Four sessions a week for a year
is ~200 rows — roughly 12k tokens in a single tool result. Tool results live in
message history, which is exactly the half of the prompt that prompt caching
can't settle, so that cost re-bills at full price on every later turn of the
session, and the noise crowds out the reasoning besides.

Now: default 20, max 100, `hasMore`, and `before` to page into older history —
the cursor vocabulary `list_program_changes` already established. The bound is
at the tool boundary, not in the query: app callers still get the whole history
because the history page and the momentum panel need it.

Renaming `list_*` → `search_*` was dropped. It doesn't reduce the tool count,
and these tools are the external MCP contract too. The win was never the name.

### 2. The five policy setters are one tool

`set_program_{autoregulation,deload_policy,diet_phase,overshoot_policy,plan_sync}`
→ `set_program_policy`, a discriminated union on `policy.name`.

This is the one merge where the standing objection to collapsing tools — that a
tight per-tool schema guides a model better than a polymorphic one — doesn't
bite, because there was no per-tool nuance to lose. All five were a program id
plus one value.

**The collapse stops at the tool layer, deliberately.** The change-log `action`
names in `db/program-patches.ts` and the proposal op name in
`lib/patch-proposal.ts` are persisted — historical events and pending proposals
reference them — so those keep the original per-policy names.

**40 → 36.**

## What we deliberately did not do

### The CRUD matrix stays as it is

`{add,update,remove,move}_program_{day,exercise,set}` — 12 tools.

The original brief said to check whether `propose_program_patches` already
subsumes them. It doesn't: it accepts 7 ops (set-level, training max, diet
phase), overlapping 3 of the 12, and even those aren't redundant — a proposal
is inert until the owner confirms on the program page, while the direct tools
apply immediately after in-chat approval. Different semantics, not duplication.

So there's nothing free to delete, and merging 12 tight schemas into 3
polymorphic ones is a coin flip: you'd cut the count and possibly cut selection
accuracy at the same time, and land on a tool with a dozen parameters. Not
worth doing on a guess — and unnecessary if the next section happens.

## The endgame, blocked on a feature

The coach still has **17 approval-gated direct mutators**. Every one is a tool
the model must select correctly *and* a tap the user makes mid-workout.

The structurally right answer is that the coach's write path is proposals, not
direct mutation: inert until confirmed, one confirm for a whole batch, reviewed
where the user can see what changes. That would take the coach to ~20 tools by
*removing* tools rather than merging them — no polymorphic-schema risk at all —
and unify two competing confirmation gestures into one.

It is blocked on **in-chat proposal UI**, which does not exist. Today "propose"
means "go to the program page", so removing the direct mutators would strand
the coach mid-conversation. That UI is its own feature: a proposal component
inline in chat for small changes, escalating to a full review surface for
larger ones (a whole program, or a batch spanning several exercises).

Sequence: build in-chat proposal UI → move the coach's writes onto proposals →
the tool count falls out of it. Don't collapse the CRUD matrix first; that
means refactoring twice.

## Landmine

`filterCoachTools` sorts by name, and that is load-bearing for the prompt
cache, not cosmetic. Any rewrite must keep the output order deterministic or
the cache silently stops matching and every turn pays the 2x write. There is a
test pinning it.

## If a measurement is ever wanted

`promptfoo` (not installed) has `tool_choice` control, `tool_calls`
finish-reason assertions, and native cost/latency assertions. ~30 realistic
coach turns, each with an expected tool, run against variants of the tool set,
asserting the correct tool name. `tool_choice: 'auto'` is the setting under
test — forcing a tool measures nothing.

Worth building to validate the proposals migration when it happens. It was not
needed for either change above: both are correct on their own terms.

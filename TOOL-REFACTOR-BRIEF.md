# Coach tool-surface refactor

Parked work. Start here; nothing else in this worktree is set up yet.

**Do this after PR #275 (entitlement gates + coach prompt caching) lands** — it
touches `filterCoachTools`, which #275 just made order-sensitive.

## Why

The coach exposes **40 distinct MCP tools** (17 read, 21 approval, 2 draft),
22 of them program mutations. Measured from `COACH_ALLOWED_TOOLS`.

Benchmark data (late 2025): at ~50 tools frontier models hold **84–95%**
selection accuracy; at 200 it is 41–83%; at 740 it collapses. Practitioner
reports put noticeable degradation at **15–20 tools in active rotation**. So 40
is costing something — plausibly 5–16% of selections — without being
catastrophic. Degradation is non-linear, so the goal is distance from the
cliff, not a round number.

Note what is NOT a reason: token cost. #275 added prompt caching, so the tool
block costs 0.1x after the first turn of a session. This refactor is about
**selection accuracy and tool-result volume**, not the size of the prefix.

## The three moves, in order of expected value

### 1. `list_*` → `search_*` (8 tools)

Anthropic's own MCP guidance:

> Implement search-focused tools (like `search_contacts`) rather than list-all
> tools (`list_contacts`).

We have eight: `list_workouts`, `list_programs`, `list_notes`, `list_goals`,
`list_templates`, `list_proposals`, `list_custom_exercises`,
`list_program_changes`.

This is the biggest win because it cuts **two** things: the tool count, and the
unbounded tool *results* that flood message history — which is the other half
of the 73k-token context, and the half caching does not fix (history changes
every turn; only the settled prefix caches).

### 2. Collapse the CRUD matrix (12 tools → ~3)

```
{add,update,remove,move}_program_{day,exercise,set}
```

4 verbs x 3 entity types. A controlled study on tool misuse found that
descriptive renaming plus grouping by structural similarity cut cardinality
13 → 5 without capability loss.

Check first whether `propose_program_patches` already subsumes these — it sits
alongside all 22 granular mutators and may make some redundant.

### 3. Collapse the policy setters (5 tools → 1)

`set_program_{autoregulation,deload_policy,diet_phase,overshoot_policy,plan_sync}`
→ `set_program_policy(policy, value)`.

Target: **40 → ~26.**

## The counter-argument, which is real

Tight single-purpose schemas guide a model better than one polymorphic tool
with a discriminated union. Consolidation can *reduce* selection accuracy even
as it reduces count. Moves 2 and 3 are therefore hypotheses, not conclusions.
Move 1 is safe — it changes tool *shape*, not tool *granularity*.

Also keep AWS's guidance in view: tool parameter counts around eight or fewer.
A collapsed CRUD tool that needs twelve parameters has traded one problem for
another.

## How to verify: promptfoo

Not installed. `promptfoo` has an `eval-tool-use` example, `tool_choice`
control, `tool_calls` finish-reason assertions, custom JS assertions, and
native cost/latency assertions.

```
~30 realistic coach turns, each with an expected tool:
  "add a set to bench on day 2"   -> add_program_set
  "what did I lift last week"      -> get_last_performance
  "make my program 4 days"         -> propose_program_patches
  "why did my squat stall"         -> get_program_stats

variants:  A. 40 tools (baseline, today)
           B. + list_* -> search_*
           C. + CRUD and policy collapsed  (~26)

assert:    correct tool name, plus cost and latency thresholds
```

Run A first — the current number is what makes B and C judgeable. Pin the model
version; the point is detecting regressions.

Two costs to keep in mind: the eval runs real inference against OpenRouter
credits, so keep the case count tight; and `tool_choice: 'auto'` is the setting
under test — forcing a tool measures nothing.

## Landmine

`filterCoachTools` now sorts by name, and that is load-bearing for the prompt
cache, not cosmetic. Any rewrite must keep the output order deterministic or
the cache silently stops matching and every turn pays the 2x write. There is a
test pinning it.

## Not decided

Whether to go further to hierarchical tool selection (a router agent
delegating to subagents with tool subsets) or Tool RAG (retrieving relevant
tools per query). Both are named production patterns for this problem. Both
cost extra inference per turn and add latency, which is the wrong trade for a
coach used between sets in a gym — revisit only if 26 tools still measures
badly.

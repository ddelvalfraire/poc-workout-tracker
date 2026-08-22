# Create is a write, not a screen

Why `/programs/new` is folded into the editor, what replaces it, and the two rules that keep the database from filling with junk.

- Status: design decision / pending implementation
- Date: 2026-08-22
- Depends on: the program editor (`design/editor-layout` and the editor surfaces)

## 01 · The duplication

`/programs/new` is a 31-line shell that mounts `ProgramBuilder`. So is
`/programs/[id]/edit` — the same 888-line component, imported from
`@/app/programs/new/program-builder`. There is one authoring surface with two
doors, and the create door owns the module.

That is why the styling drifted. Nothing about authoring from scratch is
different in kind from editing: a new program is a program with no days in it
yet. The second door was never a second design, only a second entry point that
nobody restyled when the surfaces around it changed.

## 02 · Decision

**Creating a program is a POST, not a page.** "Build your own" writes an empty
`draft` program and redirects to the editor. There is no create-specific UI, no
create-specific component, and no create-specific route to keep in visual sync.

`/programs/new` and `ProgramBuilder` are both deleted when the editor lands.

### Why not a wizard

The obvious alternative — replace the bare builder with a guided multi-step
create flow — is wrong here on the established criteria. Wizards suit fixed
sequences, conditional branching, and users who need guidance through a task
they do rarely.[^uxmatters] They fail for repetitive tasks, for power users who
want keyboard efficiency, and when the user already knows what they want. A
lifter authoring their third training block is all three. The general caution
applies too: needing a wizard is usually a signal the underlying task is too
complicated,[^uipatterns] and the fix is to simplify the task rather than to
stage the complexity across screens.

The editor is already the guided surface. A wizard in front of it would teach a
vocabulary the user then has to unlearn.

### Why the name is not asked for

The program is created as **Untitled**, and the title is an inline-editable
heading in the editor — not a required first field. Requiring a name before any
content delays the only thing the user came to do, and a name is the field they
are least able to supply before the thing exists.[^friction]
`update_program_meta` is the write; the muted "Untitled" reads as an unfilled
slot and prompts the name without gating on it.

Focus on entering the editor goes to **adding the first movement**, not to the
title field. Auto-focusing the title would rebuild the naming gate the deferral
was meant to remove.

## 03 · The blank canvas is the real risk

Create-as-write trades a badly-styled screen for an empty editor, and an empty
editor is the worst first-run state there is: a blank canvas gives the user no
answer to "what am I supposed to put here?" and is a large source of drop-off.
The standing recommendation is not to design an elegant empty state but to
**prevent a genuinely empty one**, via starter content.[^emptystates]

So the fold only works if the door seeds the content. The three doors on the
empty state become three **seeds**, not three screens — all landing in the same
editor:

| Door | Seeds the draft with | Blank? |
|---|---|---|
| Start from a template | the full template, copied | no — fully populated |
| Ask the coach | the coach's drafted block, via proposal → accept | no — generated first draft |
| Build your own | one day, one empty exercise slot | skeleton only |

Only the third approaches a blank, and it still opens with structure and a
single obvious next action. The coach door is the strongest of the three and
already has its machinery: generate a first draft, then edit it, is the pattern
that has displaced blank-canvas creation across authoring tools.

## 04 · Two rules that keep the list clean

Creating before naming means a `draft` row exists from the first tap. Two
consequences, both handled by predicates rather than heuristics.

### Rule 1 — At most one untouched empty draft per user

"Build your own" does not blindly insert. If the user already has a draft that
is still exactly as created — untitled, zero exercises, never edited — it
**reuses** that one and opens it.

This is also the double-tap guard: two rapid taps yield one program, not two.

### Rule 2 — Leaving an untouched draft removes it

If the user exits the editor and the program is still untouched by the same
predicate, the row is deleted. Abandoning create leaves no trace, which is
exactly what `/programs/new` does today by holding the draft in `localStorage`.

**No timer, and no auto-delete of anything the user has touched.** A time-based
sweep is the tempting version and the wrong one — where this has been tried, the
consensus is that filtering and cleanup affordances beat aggressive
auto-deletion, because a timer eventually destroys real work.[^figma] The
predicate here can only ever fire on a program that has never been edited, so it
cannot.

Anything with one exercise or a name survives as a real draft: it appears in the
list, `noProgramState()` already ranks drafts ahead of archived and cold states,
it resumes on any device, and the coach can see it.

## 05 · What this buys beyond consistency

- **Drafts stop being device-local.** `ProgramBuilder` keeps an in-progress
  program in one shared `localStorage` slot — the reason it carries a collision
  banner (`program-builder.tsx:124`). A `draft` row survives a device switch and
  needs no banner.
- **The training-max bypass dies with the builder.** The builder's TM field
  writes via full-replace with no `adjust_training_max` event and no reason.
  Deleting the component removes the path rather than fixing it in two places.
- **A half-built program is addressable.** It has an id, so it can be handed to
  the coach, proposed against, and patched granularly — none of which is possible
  for a draft living in browser storage.

## 06 · Route shape, and one correctness note

`/programs/new` becomes a **POST** — a route handler or server action that
creates and redirects. It must not be a GET page.

This is not only semantics. Today `/programs/new` is reached by
`<DividerRow href="/programs/new">` (`src/app/programs/page.tsx:496`, and again
at `:618`). Next.js prefetches `<Link>` targets on viewport entry, so a GET
route that creates a row would mint phantom programs for anyone who merely
scrolls the empty state into view. GET must stay safe and idempotent.

The affordance therefore changes from a link to a submit control styled as a
divider row. That is the accessible spelling of a state-changing action anyway —
a link that writes to the database is a defect independent of this fold.

`/programs/[id]/edit` needs no change for the empty case: its e1RM prefill only
reads history for training-max-anchored exercises whose stored TM is 0, and a
program with no exercises has none, so the batched read is skipped.

## 07 · Two existing specs this invalidates

Both currently place their new control inside the component being deleted. Each
needs retargeting to the editor's inspector before it is built:

- `docs/specs/muscle-roles.md` §"Placement" — a `<fieldset>` in `ProgramBuilder`,
  in the program-settings stack.
- `docs/specs/initial-load-selection.md` — a policy control "alongside the
  existing TM field" in the builder.

The TM field they anchor to is itself the unaudited write path this fold
removes, so the retarget is not cosmetic.

## 08 · Sequencing

The editor is not shipped. Until it is, `ProgramBuilder` is the only way to
author from scratch, so deleting `/programs/new` now would strand the "Build
your own" door.

1. Ship the editor.
2. Land the POST route, the two draft rules, and the door rewiring.
3. Delete `/programs/new`, `program-builder.tsx`, and the create-side use of
   `program-draft.ts` in the same change.

`program-draft.ts` and its tests do not all die with the builder —
`detailToProgramDraft` is the edit path's adapter. Check its remaining callers
before removing it.

[^uxmatters]: [Wizards Versus Forms](https://www.uxmatters.com/mt/archives/2011/09/wizards-versus-forms.php), UXmatters — wizards fail for repetitive tasks, power users, and known conditions.
[^uipatterns]: [Wizard design pattern](https://ui-patterns.com/patterns/Wizard), UI-Patterns — needing a wizard signals the task is too complicated.
[^friction]: [Onboarding friction](https://www.thebehavioralscientist.com/glossary/onboarding-friction) — every step before the first valuable moment is drop-off.
[^emptystates]: [Empty State UX Examples & Best Practices](https://www.pencilandpaper.io/articles/empty-states), Pencil & Paper — prevent the empty state with starter content rather than designing around it.
[^figma]: [Auto-delete untitled empty documents](https://forum.figma.com/archive-21/feature-request-auto-delete-untitled-empty-figma-documents-after-a-week-15727), Figma Forum — filtering beat auto-deletion in community feedback.

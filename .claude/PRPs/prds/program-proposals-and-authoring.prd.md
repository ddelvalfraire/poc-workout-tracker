# Program Proposals & Conversational Authoring — coach-drafted plans behind a forced confirm

## Problem Statement

Everything downstream of a program — auto-regulation, prescriptions, up-next,
block stats, the finish celebration — activates only once a program exists,
and creating one is the highest-friction step in the app. The coach can chat
(PR #83) and can patch an existing plan behind an approval card, but it cannot
draft a program, and there is no model for ANY non-owner actor authoring a
plan. Separately, programs are bare (`name` + `notes`): nothing describes what
a plan is for, and there is no surface a template could "read like an article"
on.

## Direct user asks (2026-07-19)

- "convo program creation is goated though lets do it"
- "we always force the user to confirm"
- "keep this surface open to expansion in the future. maybe in the future we
  want to allow coaches? groups? … multiple users share the same program …
  someone other than the user make edits"
- "programs should also now have a title, and an optional description … a
  thumbnail field, or an icon, and a background for the article. these
  programs should read like articles"
- "you can load up the ones from wger into our db" (template import)

## Proposed Solution

### 1. Proposals: a program status, not a new tree

A proposal IS a program row — full tree, same tables — with
`status = 'proposed'`. This reuses every existing surface for free: the
preview is the program detail page, adoption is a status transition, and the
change-log already records mutations. New columns on `programs`:

- `status` gains `'proposed'` (existing: draft | active | archived).
- `authorActor` text NOT NULL default `'owner'` — who drafted this row.
  `'coach'` today; the value space is open (a human coach's user id, a group
  id) so tomorrow's actors need data, not schema. Mirrors `program_events.actor`.

**The confirm is forced and owner-only**: a `'proposed'` program derives
nothing, instantiates nothing, and never participates in the single-active
sweep. The ONLY exits are the owner's explicit Adopt (→ `draft`, or → `active`
with the sweep) or Decline (→ delete). No path — MCP tool, coach bridge, or
server action — may create or promote a program as `active` when
`authorActor !== 'owner'` without that owner adopt; enforced at the db layer,
not the UI.

### 2. Conversational creation

The coach drafts through the EXISTING MCP authoring tools (`upsert_program`,
`add_program_day/exercise/set`, …) with one policy change: coach-bridge calls
that create programs always create them as `proposed` with
`authorActor = 'coach'`; coach mutations may touch only its own still-proposed
rows. The chat surfaces a proposal card linking to the article-style preview,
where Adopt / Decline live. Every event logs with the coach actor.

### 3. Article metadata

`programs` gains presentation fields (all optional, additive):

- `description` text — what this plan is, who it's for; renders as the
  article body lead on the program page.
- `icon` text — emoji/short token for lists and cards.
- `heroImageUrl` text — the article's background/header image.
- `sourceUrl` text — attribution link for imported templates (wger is
  CC-licensed; attribution is a requirement, not decoration).

The program detail page gets an article-style header (hero, icon, title,
description) that degrades cleanly when the fields are empty.

### 4. wger template import

A script/route imports wger's public routine templates as programs carrying
name/description and mapped exercises; adoption = the existing `cloneProgram`
flow into the user's account as `draft`. Fields wger has that we lack land in
§3's columns. (Sequenced after §1–3; its own implementation phase.)

## What We're NOT Building

- **Per-program in-app styling** — explicitly declined ("dont do that last one").
- **Sharing/groups/multi-user editing now** — the surface is shaped for it
  (`authorActor`, owner-only confirm), but no membership tables, no ACLs.
- **A separate proposals table** — the program tree is the draft; a payload
  jsonb twin would rot against the real schema.
- **Coach editing ACTIVE programs via this surface** — the existing
  approval-card patch flow remains; proposals cover new plans.
- **Auto-adopt anything** — "we always force the user to confirm."

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Forced confirm | No code path activates/instantiates a non-owner-authored program without the owner's explicit adopt | db-layer tests: proposed rows excluded from derive/instantiate/sweep; promotion guard tests |
| Coach draft round-trip | "4 days, barbell, strength" in chat → proposed program with days/exercises/sets → Adopt → active | bridge integration test + manual dogfood |
| Attribution | Every proposal shows its author; adoption logs an owner event | program_events assertions |
| Article render | Program page renders hero/icon/description when present, unchanged when absent | page render tests / visual check |

## Open Questions

- [ ] Decline semantics: hard delete vs archive-with-status `'declined'` for
  audit. Lean hard-delete v1 (change-log keeps the event trail).
- [ ] Should Adopt offer "adopt as draft" vs "adopt and activate" as two
  buttons or a follow-up? Lean two explicit buttons.
- [ ] wger import ownership: a shared system user vs import-on-browse. Decide
  in the import phase.

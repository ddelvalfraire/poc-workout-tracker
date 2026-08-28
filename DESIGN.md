# Design

> The [De-card vocabulary](#de-card-vocabulary-review-contract) section is the
> review contract for list/detail surfaces — check every conversion and every
> new surface against it.

> **Storybook is this document's reference implementation.** `npm run storybook`
> renders every component in `src/components/**`, with the vocabulary and the
> token tables under "Design/". When a component and this document disagree,
> this document wins and the component is a bug. See
> [Component catalog](#component-catalog) and [Tokens](#tokens).

## Theme
Dark, committed — not a toggle. Near-black surface (`#0a0a0a`, matching the PWA `theme_color`/manifest) with subtly lifted panels, near-white ink, and a single high-voltage accent for primary actions and active state. Dark is the deliberate choice for a gym environment (harsh/low light, OLED phones, glance-readability), echoing athletic apps (Strong, Hevy, Nike Training). The light shadcn defaults are removed; the app ships one intentional dark theme.

## Tokens

`src/design/tokens.ts` is the **single source** for colour, radius, touch
targets, motion, type scale and layout constants. `npm run tokens` generates
three files from it, and `npm run tokens:check` fails when any has drifted:

| Output | Platform |
|---|---|
| `src/app/tokens.generated.css` | Web — imported by `globals.css` |
| `design/generated/DesignTokens.swift` | iOS — SwiftUI |
| `design/generated/DesignTokens.kt` | Android — Jetpack Compose |

**Never edit a generated file.** Edit `tokens.ts` and regenerate; commit the
source and all three outputs together.

Why it exists: React components do not port to SwiftUI or Compose — a
`className` string is a dead end on both. The token layer and this document are
what actually port, so they are the artifacts that keep three codebases looking
like one product. Colours are authored in OKLCH and every one is verified inside
the sRGB gamut, so the hex handed to Swift and Kotlin is exact rather than
gamut-mapped; the generator throws if a future token leaves sRGB.

Tokens carry a `status`. `core` ships to all three platforms; `unused` marks
inherited shadcn scaffolding no component reads (`chart-1..5`, `sidebar-*`,
`popover-*`, `accent-*` — the charts colour series with `var(--primary)` and
`var(--muted-foreground)`). Unused tokens stay in the web CSS so nothing moves,
but are withheld from the native output.

## Component catalog

Every component in `src/components/**` has a `.stories.tsx` beside it. The
primitives carry full variant matrices; feature components carry their real
states (default, empty, pending, error, degraded). Four components render
`null` — `NavigationTracker` and the three PWA scripts — and their stories are
mount smoke tests, filed under "Behavioral" and labelled as such rather than
given invented visuals.

Storybook config lives in `.storybook/`. Three things it has to do that are
worth knowing before you change it:

- **Fonts** come from `src/app/fonts.ts`, imported by BOTH the app shell and
  the preview. Declaring the two `next/font` calls twice would let the catalog
  and the app drift on the exact axis the catalog exists to police.
- **`'use server'` modules are aliased** to `.storybook/mocks/app-actions.ts`
  (`UnitToggle`, `NavDrawer`, `SessionConflictDialog` each call one). Keep the
  list in `main.ts` in sync with
  `grep -rn "from '@/app/.*actions'" src/components/`.
- **The `dark` class goes on `documentElement`**, not a wrapper, because
  `@custom-variant dark (&:is(.dark *))` needs a `.dark` ancestor for every
  `dark:` utility to match.

## Color (OKLCH)
| Role | Value | Use |
|---|---|---|
| `--background` | `oklch(0.145 0 0)` (~#0a0a0a) | App surface |
| `--card` / surface | `oklch(0.205 0 0)` | Lifted panels, list rows |
| `--foreground` | `oklch(0.97 0 0)` | Primary ink (≥4.5:1) |
| `--muted-foreground` | `oklch(0.72 0 0)` | Secondary text (verified ≥4.5:1 on bg) |
| `--border` | `oklch(1 0 0 / 12%)` | Hairline dividers |
| `--primary` / accent (volt) | `oklch(0.86 0.19 128)` | Primary action, active/selected only |
| `--primary-foreground` | `oklch(0.16 0.03 128)` | Ink on volt (dark, high-contrast) |
| `--destructive` | `oklch(0.65 0.2 25)` | Remove/delete |

Accent is Restrained: it appears on the primary CTA and the active state, never as decoration.

## Typography
Contrast-axis pairing (condensed display + neutral UI sans), not two similar sans.
- **Display / headings — Oswald** (condensed grotesque, athletic gym-poster). Used for page titles and section headers, often uppercase with slight positive tracking. Var: `--font-display`.
- **Body / UI / data — Inter** (humanist sans, product-grade workhorse, permitted in product register). Labels, buttons, inputs, numerals. Var: `--font-sans`.
- Fixed rem scale (product register — no fluid clamp in UI). Numerals in the logger run large for glanceability.
- Fixes the prior broken self-referential `--font-sans` mapping.

## Components
- **Inputs**: 16px font (`text-base`) to eliminate iOS tap-zoom; height ≥44px (`h-11`); clear focus ring in the volt/ring color.
- **Buttons**: primary/default and `lg` are ≥44px tall for touch; compact `sm`/`xs`/`icon` retained for inline affordances (e.g. remove-set). One consistent shape app-wide. States: default/hover/focus/active/disabled/loading all defined.
- **App shell**: sticky top header with brand title + user button, padded for `env(safe-area-inset-top)`. Primary actions (Start / Save) are full-width and thumb-reachable; the logger's Save sits in a bottom action bar padded for `env(safe-area-inset-bottom)`.
- **Bottom action bar**: the logger's thumb bar is also the DOCK for focus-gated accessories — the weight ± rail, the rest pill, the next-up glance. Nothing focus-gated may live in the scrolling flow: it mounts and unmounts on the same mousedown that begins a tap, so whatever sits below it jumps and the browser never synthesizes the click. The bar is bottom-anchored (`mt-auto` on a flex-column `main` plus `sticky bottom-0`), so anything stacked into it grows the bar UPWARD and displaces neither its own buttons nor the page. Pinned by `e2e/sticky-cta.spec.ts`.
- **List rows**: lifted surface, hairline dividers, generous vertical padding for touch.

## Layout & Mobile
- `viewport-fit=cover` + `env(safe-area-inset-*)` so content clears the notch and home indicator in standalone mode.
- `-webkit-text-size-adjust: 100%`, `overscroll-behavior-y: contain`, momentum scroll, removed tap-highlight, `touch-action` tuned for inputs.
- Single-column, max-width ~28rem, centered — phone-first. Exception: HOME widens in three tiers matching its bento's column counts — `max-w-md` / 2 columns on the phone, `md:max-w-3xl` / 4, `xl:max-w-6xl` / 6. Every other READING surface stays the single phone column. Tiles do NOT normalize their own top margins: a bento cell is sized by its grid track (`.home-cell` fills it), so a page-stacking margin inside a body is that much of the track spent on nothing. Section spacing is the grid's gutter, and the shapes' spans per tier live in `lib/home/registry.ts`, never in the stylesheet.
- **The editor is the second exception, and the only multi-pane one.** Reading surfaces stay one column at any width — widening them is dispersion, not design. Authoring is the one posture with a genuinely different shape: it holds a whole block in view and pivots between week-wise and exercise-wise readings of it, which a phone column cannot render at all. Below `editor-pane-breakpoint` (840px) the editor IS the phone column and drilling into a day navigates; at or above it the same routes project into three panes — structure (`editor-structure-pane-width`), the day, and an inspector (`editor-inspector-width`) — and drilling in SELECTS instead. Rules that hold across the boundary: the panes are the same routes and the same state, never a second implementation; the inspector replaces what is a sheet on phone (an inspector beside the content, never a popover) and collapses when nothing is selected; every pointer-only affordance (hover reveal, right-click, drag) is an accelerator for something already reachable by tap and by keyboard, never the sole path; rows may drop from the 44px touch target to ~32px only where the input is a pointer.
- User zoom stays enabled (accessibility); zoom-on-focus solved via 16px inputs, not a scale lock.

## Motion
- 150–250ms state transitions (color, ring, subtle press translate). No page-load choreography.
- Press feedback on buttons (small translate/active state). Full `prefers-reduced-motion: reduce` fallbacks (crossfade/instant).

## De-card vocabulary (review contract)

The shipped list/detail surfaces (settings, programs, exercises) speak one
visual language. Review every conversion and every new surface against this
section.

### Hairlines, not shells

Content sits on the page background, framed by muted hairline dividers — not
inside rounded card shells. `rounded-2xl` + `bg-card` shells are reserved for
the keep-list below. Prefer the primitives in `src/components/ui/`
(`Section`, `DividerList`/`DividerRow`, `EmptyWords`) over re-typing recipes.

### The exact recipes

- **Hairline**: `border-b border-b-border/60` (grouped lists close with one; a
  chart or hero sits *above* one instead of inside a shell).
- **Caps header**: `font-display text-base uppercase leading-none
  tracking-wide text-muted-foreground` (`Section`).
- **Divider list**: `divide-y divide-border/60 border-b border-b-border/60`
  on the `ul` (`DividerList`); the dashed variant (`divide-dashed
  border-dashed`) is the quarantined / pending voice.
- **Divider row**: `flex items-center justify-between gap-4 py-4
  transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3
  focus-visible:ring-ring/50 focus-visible:outline-hidden` with a trailing
  `text-muted-foreground` value + `size-4` chevron cluster (`DividerRow`).
  Keyboard focus is the volt ring — the same pair buttons and inputs use —
  never a `bg-muted` wash: muted over the page background is ~1.1:1,
  invisible as an indicator (WCAG 2.4.7), and `outline-none` has already
  removed the UA fallback. The trailing `focus-visible:outline-hidden` is the
  forced-colors safety net: WHCM drops `box-shadow` (the ring paints
  nothing), and outline-hidden's transparent outline is repainted there in a
  system color, so keyboard focus survives high-contrast mode too. The `/50`
  wash stays hover-only.
- **Empty words**: `px-1 py-6 text-center text-sm text-muted-foreground` —
  an empty state is a plain sentence, not a boxed apology (`EmptyWords`).
- **Ghost / pending**: once the loading-states pass lands, skeletons use the
  same hairline geometry as the loaded surface — never placeholder cards.

### One volt

One volt (accent) moment per screen: the primary action or the single live
element. Precedent (#163): on revisit surfaces (lists you scan repeatedly),
per-item volt stacks and is banned — a zone heading or a single delta carries
the accent; declines and ordinary values render quiet.

### Chips are controls, words are labels

Pill/chip styling means "you can press me" (toggle chips, segmented controls,
the rest pill). Metadata is words in the muted ink — never decorate a label
as a chip.

### One glyph, one meaning, many scopes

A glyph may carry the same meaning at more than one scope — the NotebookPen
marks "note" in the app bar (the workout) and in the exercise rail (the
movement). Reuse is the point: one vocabulary beats a second invented icon
nobody has learned.

Two conditions make it safe, and both are load-bearing:

- **Every instance is pressable.** The failure that motivated #282 was not the
  repeated glyph; it was a repeated glyph where one copy was *inert* — a
  roll-up count wearing a control's clothes. Same glyph, same band, one
  pressable and one not, is the banned shape.
- **The scopes sit in different bands.** Two of the same glyph inside ONE band
  is a duplicate, not a scope.

The bands, outermost in:

| Band | Owns | Note scope today |
|---|---|---|
| **App bar** | the session | the workout note |
| **Card rail** | one exercise | the exercise note |
| **Row** | one set | (the dot — a mark, not a control) |
| **Overlay** | whatever opened it | the set note, via the row menu |

An overlay is always a band of its own: it is summoned, it names its subject,
and it cannot be mistaken for the surface underneath. So the third pen — the
set-row menu's — is in the clear by construction, and an overlay never needs
this test run against it. The rule bites between the three *standing* bands,
where two glyphs can be on screen at once.

Assistive tech gets the scope from the name, so the labels must differ and
must lead with the action ("Add workout note" vs. "Add note for Squat, 1
note") — a name that is pure state leaves a control that announces no verb.

### Keep-list (do not de-card)

Card shells stay where the shell *is* the meaning:

- **Sheets, dialogs, popovers** — elevation is the point of an overlay.
- **Coach chat** — message bubbles are the conversational idiom.
- **StatTile** — a tile grid is the scannable record wall.
- **Article / content-preview cards** — external content previews read as
  clippings.
- **Actor chips** — provenance markers are chips by design.
- **Control clusters** — rest pill, segmented controls, toggle chips: chips
  mean pressable.
- **Media tiles** — photos and share cards need a bounded frame.
- **Form fields** (`Input`, `Textarea`) — fields need enclosure.
- **`src/components/ui/card.tsx`** — the primitive stays for keep-list use.
- **Nav-drawer hover shapes** — the drawer's own interaction vocabulary.
- **Programs-landing active hero** — explicitly kept as shipped.

### Lint ratchet

`eslint.config.mjs` bans `rounded-2xl` and `bg-card` (via
`better-tailwindcss/no-restricted-classes`) outside two allowlists: the
keep-list (permanent) and the `CARD_SHELL_RATCHET` grandfather list
(temporary). Every conversion PR must remove its files from the ratchet
list — it only ever shrinks, never grows, and new surfaces never join it.

## Pending states
- **Ghosts** (`<Ghost />`, `animate-ghost-in`): a rounded `bg-muted` bar holding the EXACT final dimensions of the content it stands in for (same wrappers/margins, bar boxed to the text's line height) — zero layout shift on resolve. 1.8s opacity pulse via `motion-safe:` only; static bar under reduced motion. Never a shimmer sweep, never a new color.
- **150ms delayed appearance**: ghosts start at `opacity: 0` with a 150ms `animation-delay` — data that beats the delay means no ghost is ever seen. The ops tabs' pending dim (`animate-pending-dim`) follows the same rule.
- **Arrival**: resolved content replaces its ghost in place through the existing `rise-in`/`fade-in` vocabulary (180ms ease-out, row stagger where rows already stagger); reduced motion gets the instant swap.
- The root `loading.tsx` spinner stays the app's ONLY naked spinner — every other pending surface is a ghost of its resolved self.

## Client data
- Server state renders on the server (RSC); client components that must fetch use TanStack Query (`useQuery`) — no hand-rolled `fetch`+`useState`.

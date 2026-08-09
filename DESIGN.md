# Design

> The [De-card vocabulary](#de-card-vocabulary-review-contract) section is the
> review contract for list/detail surfaces — check every conversion and every
> new surface against it.

## Theme
Dark, committed — not a toggle. Near-black surface (`#0a0a0a`, matching the PWA `theme_color`/manifest) with subtly lifted panels, near-white ink, and a single high-voltage accent for primary actions and active state. Dark is the deliberate choice for a gym environment (harsh/low light, OLED phones, glance-readability), echoing athletic apps (Strong, Hevy, Nike Training). The light shadcn defaults are removed; the app ships one intentional dark theme.

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
- **List rows**: lifted surface, hairline dividers, generous vertical padding for touch.

## Layout & Mobile
- `viewport-fit=cover` + `env(safe-area-inset-*)` so content clears the notch and home indicator in standalone mode.
- `-webkit-text-size-adjust: 100%`, `overscroll-behavior-y: contain`, momentum scroll, removed tap-highlight, `touch-action` tuned for inputs.
- Single-column, max-width ~28rem, centered — phone-first; scales gracefully on larger screens without desktop density.
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
  transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50`
  with a trailing `text-muted-foreground` value + `size-4` chevron cluster
  (`DividerRow`).
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

# Design

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

/**
 * The design tokens — ONE source of truth for every platform.
 *
 * Web reads these as CSS custom properties (`src/app/tokens.generated.css`,
 * imported by globals.css). iOS and Android read the generated Swift and
 * Kotlin files. All three are emitted by `npm run tokens` from THIS file;
 * `npm run tokens:check` fails CI when a generated file has drifted.
 *
 * Why this file exists at all: React components do not port to SwiftUI or
 * Jetpack Compose — a `className` string is a dead end on both. The palette,
 * the radii, the touch targets and the motion durations DO port, and they are
 * the part that actually keeps three codebases looking like one product. Edit
 * values here, never in a generated file.
 *
 * Colors are authored in OKLCH because that is what the web renders and what
 * DESIGN.md specifies. Every token in this palette is verified inside the
 * sRGB gamut, so the hex the native platforms receive is EXACT, not a
 * gamut-mapped approximation — see `scripts/build-tokens.ts`, which fails the
 * build if a future token ever leaves sRGB.
 */

/**
 * `core` tokens are the real palette — emitted to web, iOS and Android.
 *
 * `unused` tokens are inherited shadcn scaffolding that no component reads
 * (verified: the charts colour their series with `var(--primary)` and
 * `var(--muted-foreground)`, never `--chart-N`). They stay in the CSS so this
 * change moves zero pixels, but they are withheld from the native output —
 * shipping dead colours to a mobile team is how a design system starts lying.
 * Delete them from here when the web side is cleaned up.
 */
export type TokenStatus = "core" | "unused";

export interface ColorToken {
  /** CSS custom property name, without the leading `--`. */
  name: string;
  /** Authored OKLCH — the source value. */
  oklch: string;
  /** Rendered as a doc comment on every platform. */
  doc: string;
  status: TokenStatus;
}

export const COLORS: readonly ColorToken[] = [
  {
    name: "background",
    oklch: "oklch(0.145 0 0)",
    doc: "App surface. Near-black, matches the PWA theme_color (#0a0a0a).",
    status: "core",
  },
  {
    name: "foreground",
    oklch: "oklch(0.97 0 0)",
    doc: "Primary ink. Verified >=4.5:1 on background.",
    status: "core",
  },
  {
    name: "card",
    oklch: "oklch(0.205 0 0)",
    doc: "Lifted panel. Keep-list surfaces only (sheets, dialogs, StatTile) — de-carded surfaces sit on background.",
    status: "core",
  },
  {
    name: "card-foreground",
    oklch: "oklch(0.97 0 0)",
    doc: "Ink on a lifted panel.",
    status: "core",
  },
  {
    name: "popover",
    oklch: "oklch(0.205 0 0)",
    doc: "Unused: no component reads it; overlays use card.",
    status: "unused",
  },
  {
    name: "popover-foreground",
    oklch: "oklch(0.97 0 0)",
    doc: "Unused: no component reads it.",
    status: "unused",
  },
  {
    name: "primary",
    oklch: "oklch(0.86 0.19 128)",
    doc: "The volt. Primary action and active/selected state ONLY — never decoration. One volt moment per screen.",
    status: "core",
  },
  {
    name: "primary-foreground",
    oklch: "oklch(0.16 0.03 128)",
    doc: "Ink on volt. Dark, high-contrast.",
    status: "core",
  },
  {
    name: "secondary",
    oklch: "oklch(0.269 0 0)",
    doc: "Secondary control fill.",
    status: "core",
  },
  {
    name: "secondary-foreground",
    oklch: "oklch(0.97 0 0)",
    doc: "Ink on a secondary control.",
    status: "core",
  },
  {
    name: "muted",
    oklch: "oklch(0.269 0 0)",
    doc: "Muted fill: hover washes, ghost/pending bars.",
    status: "core",
  },
  {
    name: "muted-foreground",
    oklch: "oklch(0.72 0 0)",
    doc: "Secondary text and metadata. Verified >=4.5:1 on background.",
    status: "core",
  },
  {
    name: "accent",
    oklch: "oklch(0.269 0 0)",
    doc: "Unused: identical to muted; the app's accent is primary (the volt).",
    status: "unused",
  },
  {
    name: "accent-foreground",
    oklch: "oklch(0.97 0 0)",
    doc: "Unused: see accent.",
    status: "unused",
  },
  {
    name: "destructive",
    oklch: "oklch(0.65 0.2 25)",
    doc: "Remove / delete. The TINT and border colour — not the ink on top of it.",
    status: "core",
  },
  {
    name: "destructive-ink",
    oklch: "oklch(0.775 0.13 25)",
    doc: "Text and icons ON a destructive tint. A tint and its ink cannot be the same value: as the tint's alpha rises the background approaches the ink, so contrast falls to 1. Verified >=4.5:1 on destructive tints from 5% to 30% (hover included) over page, card and muted.",
    status: "core",
  },
  {
    name: "warning",
    oklch: "oklch(0.8 0.15 85)",
    doc: "Offline / degraded hints. Verified >=4.5:1 on background.",
    status: "core",
  },
  {
    name: "border",
    oklch: "oklch(1 0 0 / 12%)",
    doc: "Hairline dividers — the de-card vocabulary's primary framing device.",
    status: "core",
  },
  {
    name: "input",
    oklch: "oklch(1 0 0 / 15%)",
    doc: "Form field border.",
    status: "core",
  },
  {
    name: "ring",
    oklch: "oklch(0.86 0.19 128)",
    doc: "Focus ring. The volt, so keyboard focus is unmistakable.",
    status: "core",
  },
  {
    name: "chart-1",
    oklch: "oklch(0.86 0.19 128)",
    doc: "Unused: charts colour series with primary / muted-foreground.",
    status: "unused",
  },
  {
    name: "chart-2",
    oklch: "oklch(0.708 0 0)",
    doc: "Unused: see chart-1.",
    status: "unused",
  },
  {
    name: "chart-3",
    oklch: "oklch(0.556 0 0)",
    doc: "Unused: see chart-1.",
    status: "unused",
  },
  {
    name: "chart-4",
    oklch: "oklch(0.439 0 0)",
    doc: "Unused: see chart-1.",
    status: "unused",
  },
  {
    name: "chart-5",
    oklch: "oklch(0.371 0 0)",
    doc: "Unused: see chart-1.",
    status: "unused",
  },
  {
    name: "sidebar",
    oklch: "oklch(0.205 0 0)",
    doc: "Unused: the nav drawer styles itself from card / muted.",
    status: "unused",
  },
  {
    name: "sidebar-foreground",
    oklch: "oklch(0.97 0 0)",
    doc: "Unused: see sidebar.",
    status: "unused",
  },
  {
    name: "sidebar-primary",
    oklch: "oklch(0.86 0.19 128)",
    doc: "Unused: see sidebar.",
    status: "unused",
  },
  {
    name: "sidebar-primary-foreground",
    oklch: "oklch(0.16 0.03 128)",
    doc: "Unused: see sidebar.",
    status: "unused",
  },
  {
    name: "sidebar-accent",
    oklch: "oklch(0.269 0 0)",
    doc: "Unused: see sidebar.",
    status: "unused",
  },
  {
    name: "sidebar-accent-foreground",
    oklch: "oklch(0.97 0 0)",
    doc: "Unused: see sidebar.",
    status: "unused",
  },
  {
    name: "sidebar-border",
    oklch: "oklch(1 0 0 / 12%)",
    doc: "Unused: see sidebar.",
    status: "unused",
  },
  {
    name: "sidebar-ring",
    oklch: "oklch(0.86 0.19 128)",
    doc: "Unused: see sidebar.",
    status: "unused",
  },
];

export interface DimensionToken {
  name: string;
  /** Density-independent pixels. `pt` on iOS, `dp` on Android, CSS px on web. */
  value: number;
  doc: string;
}

/**
 * Corner radii. `radius` is the web's `--radius` (0.75rem = 12px); the rest
 * are the Tailwind scale steps globals.css derives from it, resolved to
 * absolute values so native does not have to replicate the arithmetic.
 */
export const RADII: readonly DimensionToken[] = [
  { name: "radius-sm", value: 7.2, doc: "--radius * 0.6" },
  { name: "radius-md", value: 9.6, doc: "--radius * 0.8" },
  { name: "radius-lg", value: 12, doc: "The base radius. Buttons and fields." },
  { name: "radius-xl", value: 16.8, doc: "--radius * 1.4. Card shells." },
  { name: "radius-2xl", value: 21.6, doc: "--radius * 1.8. Keep-list shells only." },
  { name: "radius-3xl", value: 26.4, doc: "--radius * 2.2" },
  { name: "radius-4xl", value: 31.2, doc: "--radius * 2.6" },
  { name: "radius-full", value: 9999, doc: "Pills and chips — controls, never labels." },
];

/**
 * Touch targets. Both meet the 44pt floor shared by Apple's HIG and Material's
 * 48dp guidance — the reason Button's `default` is h-11 and `lg` is h-12.
 */
export const TOUCH_TARGETS: readonly DimensionToken[] = [
  { name: "touch-target-min", value: 44, doc: "Minimum tappable edge. Button default, Input, icon buttons." },
  { name: "touch-target-comfortable", value: 48, doc: "Primary actions. Button lg." },
];

export interface DurationToken {
  name: string;
  /** Milliseconds. */
  value: number;
  doc: string;
}

/**
 * Motion (DESIGN.md § Motion). Every one of these must be skipped under the
 * platform's reduce-motion setting: `UIAccessibility.isReduceMotionEnabled` on
 * iOS, `Settings.Global.TRANSITION_ANIMATION_SCALE == 0` on Android, and
 * `prefers-reduced-motion` on web.
 */
export const DURATIONS: readonly DurationToken[] = [
  { name: "duration-state", value: 150, doc: "Colour / ring state transitions — the fast end." },
  { name: "duration-state-slow", value: 250, doc: "State transitions — the slow end." },
  { name: "duration-rise-in", value: 180, doc: "In-session mount motion: fade + 4px rise." },
  { name: "duration-sheet-up", value: 240, doc: "Bottom sheet entry from the edge it lives on." },
  { name: "duration-ghost-delay", value: 150, doc: "Pending delay: data that beats this shows NO ghost at all." },
  { name: "duration-ghost-pulse", value: 1800, doc: "Ghost opacity pulse. Never a shimmer sweep." },
];

export interface FontToken {
  name: string;
  /** Web font-family stack. */
  web: string;
  /** PostScript-ish family name for the native platforms. */
  native: string;
  doc: string;
}

/**
 * The contrast-axis pairing (DESIGN.md § Typography). Both families are on
 * Google Fonts; iOS and Android must bundle the same two font files rather
 * than substituting a system face, or the athletic register is lost.
 */
export const FONTS: readonly FontToken[] = [
  {
    name: "font-display",
    web: "var(--font-display)",
    native: "Oswald",
    doc: "Display / headings. Condensed grotesque, usually uppercase with slight positive tracking. Weights 500/600/700.",
  },
  {
    name: "font-sans",
    web: "var(--font-sans)",
    native: "Inter",
    doc: "Body, UI, data. Labels, buttons, inputs, numerals.",
  },
];

export interface TypeScaleToken {
  name: string;
  /** Points / sp / CSS px. */
  size: number;
  lineHeight: number;
  doc: string;
}

/**
 * The fixed rem scale (product register — no fluid clamp in UI). Each step is
 * keyed to an Apple text style at the default Dynamic Type size, so the web
 * reads at the sizes a native iOS app would — Tailwind's stock ramp runs a
 * notch or two larger at every step above the caption, which is why buttons,
 * fields and headlines read "huge" next to Apple's own apps. `text-5xl` is
 * the one deliberate step above Apple's ladder (see its doc).
 *
 * These are the web's sizes, not a mirror of them: `npm run tokens` emits
 * them into Tailwind's `@theme`, so `text-sm` IS this row.
 */
export const TYPE_SCALE: readonly TypeScaleToken[] = [
  { name: "text-xs", size: 12, lineHeight: 16, doc: "Caption 1. Captions, chip labels, metadata." },
  { name: "text-sm", size: 13, lineHeight: 18, doc: "Footnote. Body default, button labels, list secondary lines." },
  { name: "text-base", size: 16, lineHeight: 21, doc: "Callout. Inputs — 16px is what stops iOS tap-zoom. Never go smaller in a field." },
  { name: "text-lg", size: 17, lineHeight: 22, doc: "Body. Section leads." },
  { name: "text-xl", size: 20, lineHeight: 25, doc: "Title 3. App bar title." },
  { name: "text-2xl", size: 22, lineHeight: 28, doc: "Title 2. StatTile value." },
  { name: "text-3xl", size: 28, lineHeight: 34, doc: "Title 1. Logger numerals — sized for glanceability mid-set." },
  { name: "text-4xl", size: 34, lineHeight: 41, doc: "Large Title. Display headlines — next-up day name on the program detail." },
  { name: "text-5xl", size: 40, lineHeight: 44, doc: "Hero numerals — programs-hero week count, fact-strip figures, empty-state headline. Display face, uppercase, one per screen. The single step above Apple's ladder: Large Title plus one optical notch, the way Fitness and Weather size their one hero figure." },
];

export interface LayoutToken {
  name: string;
  value: number;
  doc: string;
}

/** Layout constants (DESIGN.md § Layout & Mobile). */
export const LAYOUT: readonly LayoutToken[] = [
  { name: "content-max-width", value: 448, doc: "The single phone column (28rem). Every reading surface." },
  { name: "content-max-width-wide", value: 672, doc: "HOME only (42rem), from the md breakpoint up." },
  {
    name: "editor-pane-breakpoint",
    value: 840,
    doc: "The ONE architectural breakpoint: below it the editor is the phone column and drilling down navigates; at or above it the same routes project into panes and drilling down SELECTS. Matches Material's expanded window class, and it is a WINDOW measure, not a device one — split-screen and Stage Manager cross it.",
  },
  {
    name: "editor-structure-pane-width",
    value: 244,
    doc: "Editor pane 1 — weeks and days. Fixed: it is a table of contents, so it must not grow with the window.",
  },
  {
    name: "editor-inspector-width",
    value: 316,
    doc: "Editor pane 3 — the inspector for whatever is selected (Apple: beside the content, never a popover). Fixed, and collapses to nothing when the selection is empty so it never costs width for silence.",
  },
  { name: "app-bar-height", value: 56, doc: "Sticky top app bar, excluding the status-bar safe area." },
];

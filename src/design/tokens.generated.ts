// GENERATED FILE — DO NOT EDIT.
//
// Source: src/design/tokens.ts
// Regenerate: npm run tokens

/** Resolved sRGB hex for every colour token, keyed by CSS custom property name. */
export const SRGB_HEX = {
  "background": "#0a0a0a",
  "foreground": "#f5f5f5",
  "card": "#171717",
  "card-foreground": "#f5f5f5",
  "popover": "#171717",
  "popover-foreground": "#f5f5f5",
  "primary": "#ade74e",
  "primary-foreground": "#091003",
  "secondary": "#262626",
  "secondary-foreground": "#f5f5f5",
  "muted": "#262626",
  "muted-foreground": "#a4a4a4",
  "accent": "#262626",
  "accent-foreground": "#f5f5f5",
  "destructive": "#f14d4c",
  "destructive-ink": "#fe938b",
  "warning": "#eab532",
  "border": "#ffffff",
  "input": "#ffffff",
  "ring": "#ade74e",
  "chart-1": "#ade74e",
  "chart-2": "#a1a1a1",
  "chart-3": "#737373",
  "chart-4": "#525252",
  "chart-5": "#404040",
  "sidebar": "#171717",
  "sidebar-foreground": "#f5f5f5",
  "sidebar-primary": "#ade74e",
  "sidebar-primary-foreground": "#091003",
  "sidebar-accent": "#262626",
  "sidebar-accent-foreground": "#f5f5f5",
  "sidebar-border": "#ffffff",
  "sidebar-ring": "#ade74e",
} as const satisfies Record<string, `#${string}`>;

/** Corner radii in px, keyed by token name. */
export const RADIUS_PX = {
  "radius-sm": 7.2,
  "radius-md": 9.6,
  "radius-lg": 12,
  "radius-xl": 16.8,
  "radius-2xl": 21.6,
  "radius-3xl": 26.4,
  "radius-4xl": 31.2,
  "radius-full": 9999,
} as const;

/** The two family names. Consumers that cannot read CSS variables (Storybook's
 *  theme API) compose their own fallback stack from these. */
export const FONT_FAMILY = {
  "font-display": "Oswald",
  "font-sans": "Inter",
} as const;

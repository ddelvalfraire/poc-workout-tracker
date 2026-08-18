import { create } from "storybook/theming/create";

import { FONT_FAMILY, RADIUS_PX, SRGB_HEX } from "../src/design/tokens.generated";

/**
 * Storybook's own chrome, painted in the app's palette.
 *
 * Docs pages and the manager sidebar default to a LIGHT theme, which would
 * render the catalog's prose, prop tables and navigation on white while every
 * swatch and story beside them is the committed dark — the exact inconsistency
 * this catalog exists to prevent.
 *
 * This lives in its own module, imported by both `preview.tsx` and
 * `manager.ts`, because the manager is bundled by esbuild and cannot process
 * the `globals.css` import that `preview.tsx` carries.
 *
 * Values come from `src/design/tokens.generated.ts`, not by hand: Storybook's
 * theme API predates OKLCH and takes plain colour strings, so the generator
 * resolves the palette to sRGB for it. The chrome therefore cannot drift from
 * the palette it is meant to demonstrate — `npm run tokens:check` guards it
 * alongside the CSS, Swift and Kotlin outputs.
 */
export const storybookTheme = create({
  base: "dark",
  appBg: SRGB_HEX.background,
  appContentBg: SRGB_HEX.background,
  appPreviewBg: SRGB_HEX.background,
  barBg: SRGB_HEX.background,
  colorPrimary: SRGB_HEX.primary,
  colorSecondary: SRGB_HEX.primary,
  textColor: SRGB_HEX.foreground,
  textMutedColor: SRGB_HEX["muted-foreground"],
  barTextColor: SRGB_HEX["muted-foreground"],
  barSelectedColor: SRGB_HEX.primary,
  appBorderColor: SRGB_HEX.secondary,
  appBorderRadius: RADIUS_PX["radius-lg"],
  inputBg: SRGB_HEX.card,
  inputBorder: SRGB_HEX.secondary,
  inputTextColor: SRGB_HEX.foreground,
  fontBase: `${FONT_FAMILY["font-sans"]}, ui-sans-serif, system-ui, sans-serif`,
  fontCode: "ui-monospace, SFMono-Regular, Menlo, monospace",
  brandTitle: "Workout Tracker — design system",
});

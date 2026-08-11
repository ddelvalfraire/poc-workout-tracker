import { create } from "storybook/theming/create";

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
 * Values are the resolved sRGB of the tokens in `src/design/tokens.ts` —
 * Storybook's theme API predates OKLCH and takes plain colour strings, so
 * these are the one place a token value is restated. Keep them in step with
 * the sRGB column on the Design/Design Tokens page.
 */
export const storybookTheme = create({
  base: "dark",
  appBg: "#0a0a0a", // --background
  appContentBg: "#0a0a0a",
  appPreviewBg: "#0a0a0a",
  barBg: "#0a0a0a",
  background: "#0a0a0a",
  colorPrimary: "#ade74e", // --primary (the volt)
  colorSecondary: "#ade74e",
  textColor: "#f5f5f5", // --foreground
  textMutedColor: "#a4a4a4", // --muted-foreground
  barTextColor: "#a4a4a4",
  barSelectedColor: "#ade74e",
  appBorderColor: "#262626", // --secondary / --muted
  appBorderRadius: 12, // radius-lg
  inputBg: "#171717", // --card
  inputBorder: "#262626",
  inputTextColor: "#f5f5f5",
  fontBase: "Inter, ui-sans-serif, system-ui, sans-serif",
  fontCode: "ui-monospace, SFMono-Regular, Menlo, monospace",
  brandTitle: "Workout Tracker — design system",
});

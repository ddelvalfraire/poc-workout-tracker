import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";

// Keep-list: surfaces where the card shell IS the intended vocabulary
// (sheets/dialogs/overlays, coach chat, StatTile, control clusters, form
// fields, the card primitive). Allowed permanently — see DESIGN.md.
const CARD_SHELL_KEEP = [
  "src/components/ui/card.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/stat-tile.tsx",
  "src/components/confirm-dialog.tsx",
  "src/components/session-conflict-dialog.tsx",
  "src/components/editor/quick-capture-sheet.tsx",
  "src/app/coach/coach-chat.tsx",
  "src/app/body/photo-overlay.tsx",
  "src/app/programs/\\[id\\]/patch-proposal-card.tsx",
  "src/app/settings/home/tile-sheet.tsx",
  "src/app/templates/\\[id\\]/template-edit-sheet.tsx",
  "src/app/workout/new/exercise-sheet.tsx",
  "src/app/workout/new/plate-sheet.tsx",
  "src/app/workout/new/rest-sheet.tsx",
  "src/app/workout/new/stats-sheet.tsx",
  "src/app/workout/new/rest-pill.tsx",
  "src/app/workout/new/replace-confirm-dialog.tsx",
];

// RATCHET: files still carrying pre-conversion card shells (or non-shell
// uses of the banned classes, e.g. media-tile radii and popovers that were
// audited as keeps but share the utility), grandfathered so the ban can
// land now. Every conversion PR must REMOVE its files from this list — it
// only ever shrinks, never grows. New surfaces never join it; they use the
// primitives from day one.
const CARD_SHELL_RATCHET = [
  "src/app/body/measurements-section.tsx",
  "src/app/body/photo-cell.tsx",
  "src/app/body/photo-compare.tsx",
  "src/app/body/photos-section.tsx",
  "src/app/goals/goal-card-actions.tsx",
  "src/app/home-sections.tsx",
  "src/app/p/\\[token\\]/page.tsx",
  "src/app/programs/\\[id\\]/page.tsx",
  "src/app/programs/\\[id\\]/stats/page.tsx",
  "src/app/programs/new/program-builder.tsx",
  "src/app/settings/import/import-flow.tsx",
  "src/app/w/\\[token\\]/page.tsx",
  "src/app/workout/new/workout-logger.tsx",
  "src/components/nav/nav-drawer.tsx",
  "src/components/ops/loading-ghosts.tsx",
  "src/components/ops/panel.tsx",
  "src/components/ops/status-strip.tsx",
  "src/components/share-card-button.tsx",
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "better-tailwindcss": betterTailwindcss },
    settings: {
      "better-tailwindcss": {
        attributes: ["className"],
        callees: ["cn", "clsx", "cva"],
      },
    },
    rules: {
      "better-tailwindcss/no-restricted-classes": [
        "error",
        {
          restrict: [
            {
              pattern: "(?:^|:)rounded-2xl$",
              message:
                "Card shell: de-carded surfaces use hairline dividers, not rounded shells (DESIGN.md). Keep-list surfaces are allowlisted in eslint.config.mjs.",
            },
            {
              pattern: "(?:^|:)rounded-xl$",
              message:
                "Card shell: de-carded surfaces use hairline dividers, not rounded shells (DESIGN.md). Keep-list surfaces are allowlisted in eslint.config.mjs.",
            },
            {
              pattern: "(?:^|:)bg-card(?:/\\d+)?$",
              message:
                "Card shell: de-carded surfaces sit on the page background with hairline dividers (DESIGN.md). Keep-list surfaces are allowlisted in eslint.config.mjs.",
            },
          ],
        },
      ],
    },
  },
  {
    files: [...CARD_SHELL_KEEP, ...CARD_SHELL_RATCHET],
    rules: {
      "better-tailwindcss/no-restricted-classes": "off",
    },
  },
]);

export default eslintConfig;

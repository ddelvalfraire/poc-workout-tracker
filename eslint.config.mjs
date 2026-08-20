import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import betterTailwindcss from "eslint-plugin-better-tailwindcss";
import i18next from "eslint-plugin-i18next";

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


// I18N RATCHET — deliberately INVERTED relative to CARD_SHELL_RATCHET above.
// That list grandfathers the files still to convert, which works because the
// codebase was already mostly compliant when the ban landed. Extraction
// starts from zero, so an exemption list would have to name every file under
// src/. This names the MIGRATED files instead: it only ever GROWS, one
// directory per PR, until it covers src/** and collapses into a single glob.
// A file joins this list in the same PR that extracts its copy — never
// before, or the rule is just noise a future PR learns to ignore.
const I18N_MIGRATED = [
  // Root-level route files (src/app/*.tsx); the subdirectory routes join
  // as their own conversion PRs land.
  "src/app/check-in-card.tsx",
  "src/app/error.tsx",
  "src/app/global-error.tsx",
  "src/app/history-list.tsx",
  "src/app/home-sections.tsx",
  "src/app/layout.tsx",
  "src/app/loading.tsx",
  "src/app/momentum-panel.tsx",
  "src/app/page.tsx",
  "src/app/providers.tsx",
  "src/app/status-hero.tsx",
  "src/app/today-recap.tsx",
  "src/app/up-next-anchor.tsx",
  "src/app/goals/consistency-progress.tsx",
  "src/app/goals/goal-card-actions.tsx",
  "src/app/goals/goal-create.tsx",
  "src/app/goals/page.tsx",
  // Shared components. Listed file-by-file rather than as a
  // src/components/**/*.tsx glob on purpose: a glob would also swallow the
  // colocated .stories.tsx and .test.tsx files, whose literals are fixtures
  // rather than shipped copy — exempting them wholesale is exactly the
  // "noise a future PR learns to ignore" this ratchet exists to prevent.
  "src/components/app-header.tsx",
  "src/components/auth/sign-out-button.tsx",
  "src/components/back-link.tsx",
  "src/components/block-map.tsx",
  "src/components/charts/trend-chart.tsx",
  "src/components/charts/volume-bar-chart.tsx",
  "src/components/confirm-dialog.tsx",
  "src/components/consent-identity.tsx",
  "src/components/editor/notes-editor.tsx",
  "src/components/editor/quick-capture-sheet.tsx",
  "src/components/ghost.tsx",
  "src/components/guarded-start-link.tsx",
  "src/components/markdown-view.tsx",
  "src/components/nav/nav-drawer.tsx",
  "src/components/navigation-tracker.tsx",
  "src/components/notes/note-row.tsx",
  "src/components/ops/activity-log.tsx",
  "src/components/ops/auto-refresh-toggle.tsx",
  "src/components/ops/coach-chart.tsx",
  "src/components/ops/coach-panel.tsx",
  "src/components/ops/delivery-panel.tsx",
  "src/components/ops/errors-panel.tsx",
  "src/components/ops/loading-ghosts.tsx",
  "src/components/ops/mini-bar-chart.tsx",
  "src/components/ops/ops-header.tsx",
  "src/components/ops/panel.tsx",
  "src/components/ops/refresh-button.tsx",
  "src/components/ops/status-strip.tsx",
  "src/components/ops/tab-pending.tsx",
  "src/components/page-transition.tsx",
  "src/components/pr-badge.tsx",
  "src/components/pwa/chunk-recovery-script.tsx",
  "src/components/pwa/service-worker-register.tsx",
  "src/components/pwa/update-on-resume.tsx",
  "src/components/session-conflict-dialog.tsx",
  "src/components/share-card-button.tsx",
  "src/components/sparkbar.tsx",
  "src/components/stat-tile.tsx",
  "src/components/streak-chip.tsx",
  "src/components/ui/button-group.tsx",
  "src/components/ui/button.tsx",
  "src/components/ui/card.tsx",
  "src/components/ui/chart.tsx",
  "src/components/ui/divider-list.tsx",
  "src/components/ui/empty-words.tsx",
  "src/components/ui/input.tsx",
  "src/components/ui/section.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/unit-toggle.tsx",
];

// TEXT-ONLY RATCHET: migrated before the rule covered attributes and JSX
// expressions, so their aria-labels, dialog props and ternary CTAs are still
// English. Held to the weaker rule so the gate does not claim they are done.
// Only ever SHRINKS — a backfill PR moves files up into I18N_MIGRATED.
const I18N_TEXT_ONLY = [
  "src/app/trophies/page.tsx",
  "src/app/settings/analytics-consent-toggle.tsx",
  "src/app/settings/delete-account/delete-account-form.tsx",
  "src/app/settings/delete-account/page.tsx",
  "src/app/settings/home/editor-grid-dnd.tsx",
  "src/app/settings/home/editor-grid.tsx",
  "src/app/settings/home/home-layout-editor.tsx",
  "src/app/settings/home/page.tsx",
  "src/app/settings/home/section-tile.tsx",
  "src/app/settings/home/tile-sheet.tsx",
  "src/app/settings/import/import-flow.tsx",
  "src/app/settings/import/page.tsx",
  "src/app/settings/import/remove-import-button.tsx",
  "src/app/settings/page.tsx",
  "src/app/settings/rest-default-setting.tsx",
  "src/app/settings/rest-timer-toggle.tsx",
  "src/app/settings/rpe-logging-toggle.tsx",
  "src/app/settings/workout-reminders-toggle.tsx",
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
    // Storybook's build output — bundled/minified vendor code, not ours.
    "storybook-static/**",
    // Agent worktrees are full checkouts (their own node_modules included)
    // living inside the repo — linting them buries real findings under tens
    // of thousands of vendor warnings.
    ".claude/**",
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
  {
    // jsx-only, not jsx-text-only: text alone let a file pass the gate while
    // still shipping English in aria-labels, dialog props and ternary CTAs
    // ({isPending ? "Creating…" : "Create goal"}). Migrated has to mean
    // migrated, or the ratchet silences the very strings it should catch.
    files: I18N_MIGRATED,
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          // The translator call itself, and class helpers, take string
          // arguments that are identifiers rather than copy.
          callees: { exclude: ["t", "t.rich", "tCommon", "cn", "clsx", "cva"] },
          "jsx-attributes": {
            exclude: [
              "className", "id", "key", "type", "name", "href", "src", "role",
              "htmlFor", "variant", "size", "autoComplete", "inputMode",
              "data-.*", "aria-hidden", "width", "height", "viewBox", "fill",
              "stroke", "d", "xmlns", "style", "step", "min", "max", "pattern",
              "rel", "target", "method", "action", "encType", "dir", "lang",
              // aria-current takes the ARIA token "page", never prose.
              "aria-current",
              // Recharts addresses series and axes by name; these are data
              // and geometry identifiers, not copy.
              "dataKey", "nameKey", "yAxisId", "orientation", "layout",
              "scale", "ifOverflow", "strokeDasharray",
              // vaul's slide direction, React's ViewTransition class name,
              // and the class-name twin our chart primitives take.
              "direction", "default", "barClassName",
            ],
          },
        },
      ],
    },
  },
  {
    files: I18N_TEXT_ONLY,
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }],
    },
  },
]);

export default eslintConfig;

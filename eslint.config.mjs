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
  "src/components/overshoot-field.tsx",
  "src/components/ui/select.tsx",
  // A true modal <dialog> wearing the same skin as the three dialogs above —
  // a KEEP, not a ratchet entry: a modal IS a shell by design. It only
  // missed the list because it landed after the list was written.
  "src/app/coach/coach-disclosure.tsx",
  "src/components/editor/quick-capture-sheet.tsx",
  "src/app/welcome/consent-form.tsx",
  "src/app/welcome/page.tsx",
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
  "noise a future PR learns to ignore",
  "src/app/body/entry-row.tsx",
  "src/app/body/log-form.tsx",
  "src/app/body/measurement-entry-row.tsx",
  "src/app/body/measurements-section.tsx",
  "src/app/body/page.tsx",
  "src/app/body/photo-cell.tsx",
  "src/app/body/photo-compare.tsx",
  "src/app/body/photo-overlay.tsx",
  "src/app/body/photos-section.tsx",
  "src/app/check-in-card.tsx",
  "src/app/coach/coach-chat.tsx",
  "src/app/coach/coach-disclosure.tsx",
  "src/app/coach/page.tsx",
  "src/app/error.tsx",
  "src/app/exercises/\\[source\\]/\\[id\\]/exercise-note-section.tsx",
  "src/app/exercises/\\[source\\]/\\[id\\]/page.tsx",
  "src/app/exercises/custom-exercise-editor.tsx",
  "src/app/exercises/library-filter.tsx",
  "src/app/exercises/new/create-exercise-form.tsx",
  "src/app/exercises/new/page.tsx",
  "src/app/exercises/page.tsx",
  "src/app/global-error.tsx",
  "src/app/goals/consistency-progress.tsx",
  "src/app/goals/goal-card-actions.tsx",
  "src/app/goals/goal-create.tsx",
  "src/app/goals/page.tsx",
  "src/app/history-list.tsx",
  "src/app/history/page.tsx",
  "src/app/home-sections.tsx",
  "src/app/layout.tsx",
  "src/app/loading.tsx",
  "src/app/momentum-panel.tsx",
  "src/app/notes/facet-select.tsx",
  "src/app/notes/notes-browser.tsx",
  "src/app/notes/page.tsx",
  "src/app/p/\\[token\\]/page.tsx",
  "src/app/page.tsx",
  "src/app/programs/\\[id\\]/about/page.tsx",
  "src/app/programs/\\[id\\]/description-edit.tsx",
  "src/app/programs/\\[id\\]/diet-phase-card.tsx",
  "src/app/programs/\\[id\\]/edit/page.tsx",
  "src/app/programs/\\[id\\]/page.tsx",
  "src/app/programs/\\[id\\]/patch-proposal-card.tsx",
  "src/app/programs/\\[id\\]/program-actions.tsx",
  "src/app/programs/\\[id\\]/proposal-actions.tsx",
  "src/app/programs/\\[id\\]/restart-program-button.tsx",
  "src/app/programs/\\[id\\]/sharing-section.tsx",
  "src/app/programs/\\[id\\]/start-day-button.tsx",
  "src/app/programs/\\[id\\]/stats/page.tsx",
  "src/app/programs/\\[id\\]/tm-reset-button.tsx",
  "src/app/programs/new/day-editor.tsx",
  "src/app/programs/new/page.tsx",
  "src/app/programs/new/program-builder.tsx",
  "src/app/programs/new/scheme-subtitle.tsx",
  "src/app/programs/page.tsx",
  "src/app/programs/templates/\\[id\\]/page.tsx",
  "src/app/programs/templates/\\[id\\]/system-template-detail.tsx",
  "src/app/programs/templates/import-button.tsx",
  "src/app/programs/templates/page.tsx",
  "src/app/programs/templates/unavailable.tsx",
  "src/app/programs/templates/use-template-button.tsx",
  "src/app/providers.tsx",
  "src/app/settings/account/page.tsx",
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
  "src/app/stats/page.tsx",
  "src/app/stats/plan-bullet-list.tsx",
  "src/app/stats/window-toggle.tsx",
  "src/app/status-hero.tsx",
  "src/app/templates/\\[id\\]/page.tsx",
  "src/app/templates/\\[id\\]/template-actions.tsx",
  "src/app/templates/\\[id\\]/template-edit-sheet.tsx",
  "src/app/templates/page.tsx",
  "src/app/today-recap.tsx",
  "src/app/trophies/page.tsx",
  "src/app/up-next-anchor.tsx",
  "src/app/w/\\[token\\]/page.tsx",
  "src/app/welcome/consent-form.tsx",
  "src/app/welcome/page.tsx",
  "src/app/workout/\\[id\\]/edit/page.tsx",
  "src/app/workout/\\[id\\]/finish-up-next-card.tsx",
  "src/app/workout/\\[id\\]/page.tsx",
  "src/app/workout/\\[id\\]/workout-actions.tsx",
  "src/app/workout/\\[id\\]/workout-sharing.tsx",
  "src/app/workout/new/effort-chips.tsx",
  "src/app/workout/new/exercise-picker.tsx",
  "src/app/workout/new/exercise-sheet.tsx",
  "src/app/workout/new/note-sheet.tsx",
  "src/app/workout/new/page.tsx",
  "src/app/workout/new/plate-sheet.tsx",
  "src/app/workout/new/replace-confirm-dialog.tsx",
  "src/app/workout/new/rest-pill.tsx",
  "src/app/workout/new/rest-sheet.tsx",
  "src/app/workout/new/session-clock.tsx",
  "src/app/workout/new/session-toast.tsx",
  "src/app/workout/new/set-row-menu.tsx",
  "src/app/workout/new/stats-sheet.tsx",
  "src/app/workout/new/swipe-to-delete.tsx",
  "src/app/workout/new/weight-stepper.tsx",
  "src/app/workout/new/workout-logger.tsx",
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
  "src/components/overshoot-field.tsx",
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
  "src/components/ui/nav-list.tsx",
  "src/components/ui/section.tsx",
  "src/components/ui/textarea.tsx",
  "src/components/unit-toggle.tsx",
];

// TEXT-ONLY RATCHET — now EMPTY, and meant to stay that way. It held files
// migrated before the rule covered attributes and JSX expressions, whose
// aria-labels and ternary CTAs were still English; all of them now pass the
// strict rule, so keeping them here would understate them and let new
// attribute copy slip in unguarded. Retained as a landing place for a future
// partial migration; its config block is spread conditionally because ESLint
// rejects an empty `files` array.
const I18N_TEXT_ONLY = [];

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
    // Vendored agent skills (21 Clerk packages, tracked but not authored
    // here). Every .ts/.tsx under them is sample code in a `templates/`
    // directory, written for OTHER frameworks — TanStack, Astro, Vue, Expo —
    // so our Next.js rules judge it against a target it was never for, none
    // of it reaches our bundle, and the next skills update overwrites any
    // edit. Linting it can only produce findings nobody may act on.
    //
    // Scoped to skills/, not all of .agents/: anything WE write there later
    // is first-party and must stay linted.
    ".agents/skills/**",
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
          "object-properties": { exclude: ["field", "mode", "type", "tag", "seed"] },
          callees: { exclude: ["t", "t.rich", "cn", "clsx", "cva", "tCommon", "toolStatusLabel"] },
          "jsx-attributes": {
            exclude: ["className", "id", "key", "type", "name", "href", "src", "role", "htmlFor", "aria-describedby", "variant", "size", "autoComplete", "inputMode", "data-.*", "aria-hidden", "width", "height", "viewBox", "fill", "stroke", "d", "xmlns", "style", "step", "min", "max", "pattern", "rel", "target", "method", "action", "encType", "dir", "lang", "fallback", "confirmVariant", "page", "aria-current", "dataKey", "nameKey", "yAxisId", "orientation", "layout", "scale", "ifOverflow", "strokeDasharray", "direction", "default", "barClassName", "autoCapitalize", "enterKeyHint", "aria-keyshortcuts", "aria-autocomplete", "initialScope", "exit", "seed", "describedBy"],
          },
        },
      ],
    },
  },
  // Spread, not inlined: ESLint rejects an empty `files` array, and the list
  // is empty precisely because the ratchet finished. Keeping the block means a
  // future partial migration has somewhere to land.
  ...(I18N_TEXT_ONLY.length > 0
    ? [
        {
          files: I18N_TEXT_ONLY,
          plugins: { i18next },
          rules: {
            "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }],
          },
        },
      ]
    : []),
]);

export default eslintConfig;

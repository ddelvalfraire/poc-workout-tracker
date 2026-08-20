import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { StorybookConfig } from "@storybook/nextjs-vite";

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `'use server'` modules can't be bundled for the browser — they pull in
 * Drizzle, Postgres and the AuthKit session. UnitToggle, NavDrawer and
 * SessionConflictDialog each call one, so the catalog swaps them for the
 * stubs in ./mocks/app-actions.ts. `.storybook/mocks.test.ts` enforces that
 * this list covers every action module the components import, and that the
 * stub file exports every symbol they pull from it.
 */
export const SERVER_ACTION_MODULES = [
  "@/app/actions",
  "@/app/programs/actions",
  "@/app/workout/actions",
  "@/app/settings/account/mfa/actions",
];

/**
 * Storybook is the design system's reference implementation: every component
 * in src/components/** has a story, and the DESIGN.md vocabulary is rendered
 * live under "Design/" so the contract sits next to the components it
 * governs. See DESIGN.md § Component catalog.
 */
const config: StorybookConfig = {
  framework: "@storybook/nextjs-vite",
  stories: [
    // Vocabulary + token docs (MDX), listed first so "Design" sorts to the top.
    "../.storybook/docs/**/*.mdx",
    "../src/**/*.stories.@(ts|tsx)",
  ],
  addons: [
    "@storybook/addon-docs",
    // Every story is axe-checked in the a11y panel — the catalog is also the
    // accessibility regression surface (44px targets, contrast, roles).
    "@storybook/addon-a11y",
  ],
  // Icons, manifest and share-card assets referenced by components.
  staticDirs: ["../public"],
  typescript: {
    // react-docgen reads the JSDoc + prop interfaces already written on every
    // component, so autodocs prop tables come from the source of truth.
    reactDocgen: "react-docgen-typescript",
  },
  viteFinal(config) {
    config.resolve ??= {};

    // Array form, not object form: aliases are matched in order and the
    // framework already registers a `@` -> src alias for the tsconfig path
    // mapping. `@/app/actions` has to be tested BEFORE that `@` prefix or it
    // resolves straight back to the real server-action module.
    const inherited = config.resolve.alias;
    const inheritedEntries = Array.isArray(inherited)
      ? inherited
      : Object.entries(inherited ?? {}).map(([find, replacement]) => ({
          find,
          replacement: replacement as string,
        }));

    config.resolve.alias = [
      ...SERVER_ACTION_MODULES.map((find) => ({
        find,
        replacement: join(HERE, "mocks/app-actions.ts"),
      })),
      ...inheritedEntries,
    ];

    return config;
  },
};

export default config;

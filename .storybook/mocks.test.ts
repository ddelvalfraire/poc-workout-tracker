import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { SERVER_ACTION_MODULES } from "./main";
import * as mocks from "./mocks/app-actions";

/**
 * The alias list in main.ts is the only thing keeping Drizzle, Postgres and
 * Clerk auth out of the Storybook browser bundle. It used to be maintained by
 * hand against a grep in a comment; these tests are that grep, enforced.
 */
const COMPONENTS = join(process.cwd(), "src/components");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) && !/\.(test|stories)\./.test(entry.name)
      ? [full]
      : [];
  });
}

/** Every `import { a, b } from '@/app/**\/actions'` under src/components. */
function actionImports(): { module: string; symbols: string[]; file: string }[] {
  const pattern = /import\s*\{([^}]+)\}\s*from\s*['"](@\/app\/[^'"]*actions)['"]/g;
  return walk(COMPONENTS).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(pattern)].map((match) => ({
      file,
      module: match[2],
      symbols: match[1]
        .split(",")
        .map((s) => s.trim().split(/\s+as\s+/)[0].trim())
        .filter(Boolean),
    }));
  });
}

describe("storybook server-action mocks", () => {
  const imports = actionImports();

  it("finds the action imports it is meant to guard", () => {
    // A regex that silently matches nothing would make every assertion below
    // vacuously true.
    expect(imports.length).toBeGreaterThan(0);
  });

  it("aliases every action module the components import", () => {
    const unaliased = imports
      .filter((i) => !SERVER_ACTION_MODULES.includes(i.module))
      .map((i) => `${i.module} (${i.file})`);
    // An unaliased module resolves to the real 'use server' file and pulls the
    // database and auth clients into the browser bundle.
    expect(unaliased).toEqual([]);
  });

  it("stubs every symbol the components import", () => {
    const missing = imports.flatMap((i) =>
      i.symbols
        .filter((symbol) => !(symbol in mocks))
        .map((symbol) => `${symbol} from ${i.module} (${i.file})`),
    );
    // An aliased module missing an export fails at call time inside a story,
    // not at build time — which is exactly when nobody is watching.
    expect(missing).toEqual([]);
  });

  it("has no stale entries in the alias list", () => {
    const used = new Set(imports.map((i) => i.module));
    const stale = SERVER_ACTION_MODULES.filter((m) => !used.has(m));
    expect(stale).toEqual([]);
  });
});

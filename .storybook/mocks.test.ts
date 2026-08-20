import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { SERVER_ACTION_MODULES } from "./main";
import * as mocks from "./mocks/app-actions";

/**
 * The alias list in main.ts is the only thing keeping Drizzle, Postgres and
 * the AuthKit session out of the Storybook browser bundle. It used to be
 * maintained by hand against a grep in a comment; these tests are that grep,
 * enforced.
 *
 * The grep follows the STORY IMPORT GRAPH, not a directory. A directory walk
 * of src/components was the original rule, and it had a blind spot big enough
 * to break a story: a story outside src/components (Logger/*) reaches server
 * actions through several hops of its own module tree, and the catalog only
 * discovers that when the story renders `__dirname is not defined` from deep
 * inside AuthKit. What matters is reachability from a story, so that is what
 * is walked.
 */
const SRC = resolve(process.cwd(), "src");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() && /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Resolves a `@/`- or relative specifier to a file in src, or null for a
 *  package (node_modules is not ours to guard). */
function resolveSpecifier(specifier: string, from: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (base === null) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ];
  return (
    candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null
  );
}

const NAMED_IMPORT = /import\s*(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g;
const ANY_IMPORT = /from\s*['"]([^'"]+)['"]/g;

/** Specifiers a file imports as VALUES. An `import type` edge is erased by
 *  the compiler — the module never reaches the browser bundle, so it is not
 *  the catalog's problem. A specifier is skipped by the graph walk only when
 *  EVERY import of it in the file is type-only; one value import keeps the
 *  edge. Exported for its own tests below. */
export function valueImportSpecifiers(source: string): Set<string> {
  const specifiers = new Set<string>();
  for (const match of source.matchAll(
    /\b(?:import|export)\b\s*(type\s+)?[^'";]*?from\s*['"]([^'"]+)['"]/g,
  )) {
    if (!match[1]) specifiers.add(match[2]);
  }
  return specifiers;
}

/** True for a module the alias list replaces with a stub. Traversal STOPS at
 *  one: its own imports (auth, Drizzle, the AuthKit session) never reach the
 *  browser bundle, so they are not the catalog's problem — that substitution
 *  is the whole point of the alias. */
function isAliased(file: string): boolean {
  return SERVER_ACTION_MODULES.some(
    (module) => resolveSpecifier(module, join(SRC, "x.ts")) === file,
  );
}

/** Every file reachable from a story file, stories included, stopping at the
 *  aliased action modules. */
function storyGraph(): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    if (isAliased(file)) return;
    const source = readFileSync(file, "utf8");
    const valueSpecifiers = valueImportSpecifiers(source);
    for (const match of source.matchAll(ANY_IMPORT)) {
      if (!valueSpecifiers.has(match[1])) continue;
      const resolved = resolveSpecifier(match[1], file);
      if (resolved !== null) visit(resolved);
    }
  };
  for (const file of walk(SRC)) {
    if (/\.stories\.tsx?$/.test(file)) visit(file);
  }
  return [...seen];
}

const GRAPH = storyGraph();

/** Every `import { a, b } from '.../actions'` in the story graph. A relative
 *  specifier is normalized to its `@/`-form: that is what the Vite alias
 *  matches on, so a relative import of an action module is reported as
 *  unaliased even though the module itself may be in the list. */
function actionImports(): { module: string; symbols: string[]; file: string }[] {
  return GRAPH.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(NAMED_IMPORT)]
      .filter((match) => {
        const resolved = resolveSpecifier(match[2], file);
        return resolved !== null && /[\\/]app[\\/].*actions\.tsx?$/.test(resolved);
      })
      .map((match) => ({
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

  it("imports no auth-vendor component that would need a provider", () => {
    // The drawer footer used to render a vendor account widget that threw
    // outside its provider — a crash that only reproduced with the drawer
    // OPEN, which is why NavDrawer still has an `Opened` story with a play
    // function. AuthKit's session is reached through a server action instead,
    // so no component needs a provider standing up in the catalog. This test
    // is what stops a vendor component from reintroducing that class of crash.
    const offenders = GRAPH.filter(
      (file) =>
        !isAliased(file) &&
        /from\s*['"]@(?:clerk\/nextjs|workos-inc\/authkit-nextjs)[^'"]*['"]/.test(
          readFileSync(file, "utf8"),
        ),
    );
    expect(offenders).toEqual([]);
  });

  it("has no stale entries in the alias list", () => {
    const used = new Set(imports.map((i) => i.module));
    const stale = SERVER_ACTION_MODULES.filter((m) => !used.has(m));
    expect(stale).toEqual([]);
  });
});

describe("valueImportSpecifiers", () => {
  it("keeps value imports and drops whole-statement type imports", () => {
    const source = [
      `import { Button } from './button'`,
      `import type { Props } from './props'`,
      `export type { Shape } from './shape'`,
      `import Default from './default'`,
      `export * from './barrel'`,
    ].join("\n");
    const specifiers = valueImportSpecifiers(source);
    expect([...specifiers].sort()).toEqual([
      "./barrel",
      "./button",
      "./default",
    ]);
  });

  it("treats an inline type modifier mixed with values as a value import", () => {
    const specifiers = valueImportSpecifiers(
      `import { type Kind, label } from './mixed'`,
    );
    expect(specifiers.has("./mixed")).toBe(true);
  });

  it("follows a multi-line value import", () => {
    const specifiers = valueImportSpecifiers(
      `import {\n  one,\n  two,\n} from './multi'`,
    );
    expect(specifiers.has("./multi")).toBe(true);
  });

  it("keeps a minified zero-whitespace value import", () => {
    // Prettier would never emit this, but the guard walks whatever is on
    // disk — a compact import must not silently drop a real value edge.
    const specifiers = valueImportSpecifiers(`import{Foo}from'./compact'`);
    expect(specifiers.has("./compact")).toBe(true);
  });
});

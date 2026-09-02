import { describe, expect, it } from "vitest";

import { COLORS, TYPE_SCALE } from "../src/design/tokens";
import { css, kotlin, swift, tsTokens } from "./build-tokens";

/**
 * The emitters have no compiler downstream — no Swift or Kotlin toolchain runs
 * in this repo, so a malformed identifier or a name collision would ship to a
 * native target and stay invisible here until someone opened the file. These
 * tests are the only thing standing in for `swiftc` and `kotlinc`.
 */
describe("token emitters", () => {
  const core = COLORS.filter((c) => c.status === "core");
  const unused = COLORS.filter((c) => c.status === "unused");

  it("emits every core colour to both native platforms", () => {
    const swiftOut = swift();
    const kotlinOut = kotlin();
    expect(core.length).toBeGreaterThan(0);
    for (const token of core) {
      expect(swiftOut, token.name).toContain(token.doc);
      expect(kotlinOut, token.name).toContain(token.doc);
    }
  });

  it("withholds unused scaffolding from native while keeping it on the web", () => {
    const cssOut = css();
    const swiftOut = swift();
    const kotlinOut = kotlin();
    expect(unused.length).toBeGreaterThan(0);
    for (const token of unused) {
      expect(cssOut, token.name).toContain(`--${token.name}:`);
      expect(swiftOut, token.name).not.toContain(`let ${token.name}`);
      // Kotlin identifiers are PascalCase, so check the doc text instead.
      expect(kotlinOut, token.name).not.toContain(token.doc);
    }
  });

  it("emits the type ramp into Tailwind's theme, so tokens.ts owns the web's sizes", () => {
    const cssOut = css();
    expect(cssOut).toContain("@theme {");
    for (const step of TYPE_SCALE) {
      expect(cssOut).toContain(`--${step.name}: ${step.size / 16}rem;`);
      expect(cssOut).toContain(`--${step.name}--line-height: calc(${step.lineHeight} / ${step.size});`);
    }
  });

  it("generates unique Swift identifiers", () => {
    // pascal()/camel() strip prefixes, so two distinct tokens can collapse to
    // one platform identifier. Kotlin and Swift would then silently lose a
    // token to a redeclaration.
    const ids = [...swift().matchAll(/public static let (\w+)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("generates unique Kotlin identifiers", () => {
    const ids = [...kotlin().matchAll(/(?:const )?val (\w+)/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBe(new Set(ids).size);
  });

  it("emits only syntactically valid identifiers", () => {
    const swiftIds = [...swift().matchAll(/public static let (\w+)/g)].map((m) => m[1]);
    const kotlinIds = [...kotlin().matchAll(/(?:const )?val (\w+)/g)].map((m) => m[1]);
    for (const id of swiftIds) expect(id, `swift: ${id}`).toMatch(/^[a-z][A-Za-z0-9]*$/);
    for (const id of kotlinIds) expect(id, `kotlin: ${id}`).toMatch(/^[A-Z][A-Za-z0-9]*$/);
  });

  it("balances braces in both native files", () => {
    for (const [name, out] of [["swift", swift()], ["kotlin", kotlin()]] as const) {
      const open = (out.match(/\{/g) ?? []).length;
      const close = (out.match(/\}/g) ?? []).length;
      expect(open, `${name} braces`).toBe(close);
    }
  });

  it("states the unit on every Kotlin duration, since the type cannot", () => {
    // Swift emits `TimeInterval` (seconds) and is self-documenting. Kotlin
    // emits a bare Int, so the NAME has to carry the unit — guessing wrong is
    // a 1000x animation error.
    const durations = [...kotlin().matchAll(/const val (\w+) = \d+/g)].map((m) => m[1]);
    expect(durations.length).toBeGreaterThan(0);
    for (const id of durations) expect(id, `kotlin duration ${id}`).toMatch(/Ms$/);
  });

  it("resolves sRGB for the TS consumers that cannot read OKLCH", () => {
    const out = tsTokens();
    // Storybook's theme reads this; a missing token silently paints the chrome
    // in a default colour rather than the app's.
    for (const token of COLORS) {
      expect(out, token.name).toContain(`"${token.name}": "#`);
    }
    expect(out).toContain('"radius-lg": 12');
  });

  it("is deterministic — two runs produce identical output", () => {
    expect(tsTokens()).toBe(tsTokens());
    expect(css()).toBe(css());
    expect(swift()).toBe(swift());
    expect(kotlin()).toBe(kotlin());
  });

  it("marks every generated file as generated", () => {
    for (const out of [css(), tsTokens(), swift(), kotlin()]) {
      expect(out).toContain("GENERATED FILE — DO NOT EDIT.");
      expect(out).toContain("src/design/tokens.ts");
    }
  });
});

import { describe, expect, it } from "vitest";
import Color from "colorjs.io";

import {
  COLORS,
  DURATIONS,
  FONTS,
  LAYOUT,
  RADII,
  TOUCH_TARGETS,
  TYPE_SCALE,
} from "./tokens";

/**
 * The token source is the contract three platforms read. These tests guard the
 * invariants that a generated Swift/Kotlin file cannot check for itself — a
 * broken one ships a wrong colour to iOS and Android silently.
 */
describe("design tokens", () => {
  it("every colour is inside the sRGB gamut", () => {
    // The whole native pipeline depends on this: in-gamut means the hex
    // compiled into Swift and Kotlin is EXACT, not gamut-mapped. If this ever
    // fails, scripts/build-tokens.ts throws rather than silently shifting
    // colour on one platform — this test is the earlier warning.
    const outside = COLORS.filter((c) => !new Color(c.oklch).inGamut("srgb"));
    expect(outside.map((c) => c.name)).toEqual([]);
  });

  it("every colour parses as OKLCH", () => {
    for (const token of COLORS) {
      expect(token.oklch, token.name).toMatch(/^oklch\(/);
      expect(() => new Color(token.oklch)).not.toThrow();
    }
  });

  it("has no duplicate token names", () => {
    const names = [
      ...COLORS.map((t) => t.name),
      ...RADII.map((t) => t.name),
      ...TOUCH_TARGETS.map((t) => t.name),
      ...DURATIONS.map((t) => t.name),
      ...FONTS.map((t) => t.name),
      ...TYPE_SCALE.map((t) => t.name),
      ...LAYOUT.map((t) => t.name),
    ];
    expect(names.length).toBe(new Set(names).size);
  });

  it("documents every token — the doc becomes the comment on all platforms", () => {
    const undocumented = [
      ...COLORS,
      ...RADII,
      ...TOUCH_TARGETS,
      ...DURATIONS,
      ...FONTS,
      ...TYPE_SCALE,
      ...LAYOUT,
    ].filter((t) => t.doc.trim().length === 0);
    expect(undocumented.map((t) => t.name)).toEqual([]);
  });

  it("keeps both touch targets at or above the 44pt HIG floor", () => {
    for (const target of TOUCH_TARGETS) {
      expect(target.value, target.name).toBeGreaterThanOrEqual(44);
    }
  });

  it("keys every step to an Apple text style, so the web reads at native sizes", () => {
    // iOS text styles at the default Dynamic Type size, ascending: caption 1,
    // footnote, callout, body, title 3, title 2, title 1, large title. The
    // hero step is the one deliberate exception above the ladder (its doc
    // says why), so it is asserted separately.
    const appleLadder = [12, 13, 16, 17, 20, 22, 28, 34];
    const sizes = TYPE_SCALE.map((t) => t.size);
    expect(sizes.slice(0, appleLadder.length)).toEqual(appleLadder);
    expect(sizes.length).toBe(appleLadder.length + 1);
  });

  it("keeps the ramp strictly ascending in size and line height", () => {
    for (let i = 1; i < TYPE_SCALE.length; i++) {
      const prev = TYPE_SCALE[i - 1];
      const step = TYPE_SCALE[i];
      expect(step.size, step.name).toBeGreaterThan(prev.size);
      expect(step.lineHeight, step.name).toBeGreaterThanOrEqual(prev.lineHeight);
      expect(step.lineHeight, step.name).toBeGreaterThanOrEqual(step.size);
    }
  });

  it("keeps the input type size at 16px — smaller makes iOS zoom on focus", () => {
    const base = TYPE_SCALE.find((t) => t.name === "text-base");
    expect(base?.size).toBe(16);
  });

  it("marks the volt as core so it reaches iOS and Android", () => {
    const primary = COLORS.find((c) => c.name === "primary");
    expect(primary?.status).toBe("core");
    // The one colour the whole design leans on — pin its resolved value so a
    // careless edit to the OKLCH triple is caught here, not in review.
    expect(
      new Color(primary!.oklch).to("srgb").toString({ format: "hex" }),
    ).toBe("#ade74e");
  });

  it("resolves radius-lg to the web's --radius (0.75rem at a 16px root)", () => {
    expect(RADII.find((r) => r.name === "radius-lg")?.value).toBe(12);
  });
});

/**
 * Emits the platform token files from `src/design/tokens.ts`.
 *
 *   npm run tokens         write the generated files
 *   npm run tokens:check   fail if any generated file has drifted (CI)
 *
 * Outputs:
 *   src/app/tokens.generated.css        imported by globals.css
 *   design/generated/DesignTokens.swift SwiftUI
 *   design/generated/DesignTokens.kt    Jetpack Compose
 *
 * Colour handling: tokens are authored in OKLCH. The web gets them verbatim
 * (browsers render OKLCH natively and it is what DESIGN.md specifies). Swift
 * and Kotlin get sRGB, converted with colorjs.io — a build-time devDependency,
 * never shipped. Every token is asserted to be inside the sRGB gamut first, so
 * the native values are exact rather than gamut-mapped; a future out-of-gamut
 * token fails this script loudly instead of silently shifting colour on one
 * platform only.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Color from "colorjs.io";

import {
  COLORS,
  DURATIONS,
  FONTS,
  LAYOUT,
  RADII,
  TOUCH_TARGETS,
  TYPE_SCALE,
  type ColorToken,
} from "../src/design/tokens";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

const BANNER_LINES = [
  "GENERATED FILE — DO NOT EDIT.",
  "",
  "Source: src/design/tokens.ts",
  "Regenerate: npm run tokens",
];

/**
 * Neither Swift nor Kotlin allows an identifier to begin with a digit, and
 * stripping the `radius-` prefix off `radius-2xl` leaves exactly that. Rotate
 * the leading digits to the end so the token keeps its meaning and the file
 * compiles: `2xl` -> `xl2`. Guarded by scripts/build-tokens.test.ts.
 */
function identifierSafe(part: string): string {
  const leadingDigits = /^(\d+)(.+)$/.exec(part);
  return leadingDigits ? `${leadingDigits[2]}${leadingDigits[1]}` : part;
}

/** `background` -> `Background`; `primary-foreground` -> `PrimaryForeground`. */
function pascal(name: string): string {
  return name
    .split("-")
    .map(identifierSafe)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}

/** `primary-foreground` -> `primaryForeground`. */
function camel(name: string): string {
  const p = pascal(name);
  return p.charAt(0).toLowerCase() + p.slice(1);
}

interface Srgb {
  r: number;
  g: number;
  b: number;
  a: number;
  hex: string;
}

/**
 * OKLCH -> sRGB. Throws rather than gamut-map: a token that cannot be
 * represented exactly on native must be a deliberate decision, not a silent
 * one made by a build script at 3am.
 */
function toSrgb(token: ColorToken): Srgb {
  const color = new Color(token.oklch);
  if (!color.inGamut("srgb")) {
    throw new Error(
      `Token --${token.name} (${token.oklch}) is outside the sRGB gamut.\n` +
        `iOS/Android would receive a gamut-mapped approximation while the web renders the true colour.\n` +
        `Either pull its chroma back inside sRGB, or extend this script to emit Display-P3 for Swift and Kotlin.`,
    );
  }
  // colorjs.io types coordinates as `number | null` (null = "missing
  // component", e.g. hue on an achromatic colour). Every value here is a
  // resolved sRGB channel, so null collapses to 0 rather than propagating.
  const num = (n: number | null | undefined) => (typeof n === "number" ? n : 0);
  const [r, g, b] = color.to("srgb").coords.map(num) as [number, number, number];
  const a = num(color.alpha as number | null);
  const byte = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * 255);
  const hex =
    "#" +
    [byte(r), byte(g), byte(b)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  return { r, g, b, a, hex };
}

/** The web's `--radius`. Named lookup, so a rename fails by name not by TypeError. */
function baseRadius(): number {
  const lg = RADII.find((r) => r.name === "radius-lg");
  if (!lg) {
    throw new Error(
      "No `radius-lg` token: the web's --radius is derived from it. " +
        "Rename it back, or point baseRadius() at its replacement.",
    );
  }
  return lg.value;
}

export function css(): string {
  const banner = BANNER_LINES.map((l) => (l ? `   ${l}` : "")).join("\n");
  const decl = (t: ColorToken) => {
    const { hex, a } = toSrgb(t);
    const swatch = a < 1 ? `${hex} @ ${Math.round(a * 100)}%` : hex;
    return `  --${t.name}: ${t.oklch}; /* ${swatch} */`;
  };

  return `/* ${BANNER_LINES[0]}
${banner.split("\n").slice(1).join("\n")}

   The app ships ONE intentional dark palette (DESIGN.md § Theme), not a
   toggle. :root and .dark carry identical values so there is no light flash
   before the shell's \`dark\` class lands. */
:root,
.dark {
${COLORS.map(decl).join("\n")}
  --radius: ${baseRadius() / 16}rem;
}
`;
}

/**
 * Resolved sRGB for TypeScript consumers that cannot take OKLCH. Storybook's
 * theme API predates OKLCH and wants plain colour strings; without this the
 * chrome restates the palette by hand and drifts from it.
 */
export function tsTokens(): string {
  const hex = (t: ColorToken) => `  "${t.name}": "${toSrgb(t).hex}",`;
  return `${BANNER_LINES.map((l) => (l ? `// ${l}` : "//")).join("\n")}

/** Resolved sRGB hex for every colour token, keyed by CSS custom property name. */
export const SRGB_HEX = {
${COLORS.map(hex).join("\n")}
} as const satisfies Record<string, \`#\${string}\`>;

/** Corner radii in px, keyed by token name. */
export const RADIUS_PX = {
${RADII.map((r) => `  "${r.name}": ${r.value},`).join("\n")}
} as const;

/** The two family names. Consumers that cannot read CSS variables (Storybook's
 *  theme API) compose their own fallback stack from these. */
export const FONT_FAMILY = {
${FONTS.map((f) => `  "${f.name}": ${JSON.stringify(f.native)},`).join("\n")}
} as const;
`;
}

export function swift(): string {
  const core = COLORS.filter((c) => c.status === "core");
  const colorCases = core
    .map((t) => {
      const { r, g, b, a } = toSrgb(t);
      const f = (n: number) => n.toFixed(4);
      return `        /// ${t.doc}\n        public static let ${camel(t.name)} = Color(.sRGB, red: ${f(r)}, green: ${f(g)}, blue: ${f(b)}, opacity: ${f(a)})`;
    })
    .join("\n\n");

  return `// ${BANNER_LINES[0]}
//
// ${BANNER_LINES.slice(2).join("\n// ")}
//
// Drop this file into the iOS target. Values are exact sRGB — every token in
// the palette was verified inside the sRGB gamut at generation time.
//
// Naming: a token whose name begins with a digit once its prefix is stripped
// (radius-2xl -> 2xl) has its digits rotated to the end (xl2), because neither
// Swift nor Kotlin allows a leading digit. The web name is recoverable: xl2 is
// --radius-2xl.

import SwiftUI

public enum DesignTokens {

    // MARK: - Colour

    public enum Colors {
${colorCases}
    }

    // MARK: - Corner radius (points)

    public enum Radius {
${RADII.map((r) => `        /// ${r.doc}\n        public static let ${camel(r.name.replace(/^radius-?/, "")) || "base"}: CGFloat = ${r.value}`).join("\n\n")}
    }

    // MARK: - Touch targets (points)

    public enum TouchTarget {
${TOUCH_TARGETS.map((t) => `        /// ${t.doc}\n        public static let ${camel(t.name.replace(/^touch-target-?/, "")) || "min"}: CGFloat = ${t.value}`).join("\n\n")}
    }

    // MARK: - Motion (seconds)
    //
    // Skip every one of these when UIAccessibility.isReduceMotionEnabled.

    public enum Duration {
${DURATIONS.map((d) => `        /// ${d.doc}\n        public static let ${camel(d.name.replace(/^duration-?/, ""))}: TimeInterval = ${(d.value / 1000).toFixed(3)}`).join("\n\n")}
    }

    // MARK: - Typography
    //
    // Bundle the same two families as the web — substituting a system face
    // loses the contrast-axis pairing DESIGN.md specifies.

    public enum FontFamily {
${FONTS.map((f) => `        /// ${f.doc}\n        public static let ${camel(f.name.replace(/^font-?/, ""))} = "${f.native}"`).join("\n\n")}
    }

    public enum TypeScale {
${TYPE_SCALE.map((t) => `        /// ${t.doc}\n        public static let ${camel(t.name.replace(/^text-?/, "size"))}: (size: CGFloat, lineHeight: CGFloat) = (${t.size}, ${t.lineHeight})`).join("\n\n")}
    }

    // MARK: - Layout (points)

    public enum Layout {
${LAYOUT.map((l) => `        /// ${l.doc}\n        public static let ${camel(l.name)}: CGFloat = ${l.value}`).join("\n\n")}
    }
}
`;
}

export function kotlin(): string {
  const core = COLORS.filter((c) => c.status === "core");
  const colorVals = core
    .map((t) => {
      const { r, g, b, a } = toSrgb(t);
      const byte = (n: number) =>
        Math.round(Math.min(1, Math.max(0, n)) * 255)
          .toString(16)
          .padStart(2, "0")
          .toUpperCase();
      const argb = `0x${byte(a)}${byte(r)}${byte(g)}${byte(b)}`;
      return `        /** ${t.doc} */\n        val ${pascal(t.name)} = Color(${argb})`;
    })
    .join("\n\n");

  return `// ${BANNER_LINES[0]}
//
// ${BANNER_LINES.slice(2).join("\n// ")}
//
// Drop this file into the Android target. Colours are exact sRGB ARGB — every
// token in the palette was verified inside the sRGB gamut at generation time.
//
// Naming: a token whose name begins with a digit once its prefix is stripped
// (radius-2xl -> 2xl) has its digits rotated to the end (xl2), because neither
// Swift nor Kotlin allows a leading digit. The web name is recoverable: xl2 is
// --radius-2xl.

package com.workouttracker.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object DesignTokens {

    object Colors {
${colorVals}
    }

    object Radius {
${RADII.map((r) => `        /** ${r.doc} */\n        val ${pascal(r.name.replace(/^radius-?/, "")) || "Base"} = ${r.value}.dp`).join("\n\n")}
    }

    object TouchTarget {
${TOUCH_TARGETS.map((t) => `        /** ${t.doc} */\n        val ${pascal(t.name.replace(/^touch-target-?/, "")) || "Min"} = ${t.value}.dp`).join("\n\n")}
    }

    /**
     * Motion. Skip every one of these when the system animation scale is 0
     * (Settings.Global.TRANSITION_ANIMATION_SCALE).
     */
    object Duration {
${DURATIONS.map((d) => `        /** ${d.doc} */\n        const val ${pascal(d.name.replace(/^duration-?/, ""))}Ms = ${d.value}`).join("\n\n")}
    }

    /**
     * Bundle the same two families as the web — substituting a system face
     * loses the contrast-axis pairing DESIGN.md specifies.
     */
    object FontFamily {
${FONTS.map((f) => `        /** ${f.doc} */\n        const val ${pascal(f.name.replace(/^font-?/, ""))} = "${f.native}"`).join("\n\n")}
    }

    object TypeScale {
${TYPE_SCALE.map((t) => `        /** ${t.doc} */\n        val ${pascal(t.name.replace(/^text-?/, "Size"))} = ${t.size}.sp to ${t.lineHeight}.sp`).join("\n\n")}
    }

    object Layout {
${LAYOUT.map((l) => `        /** ${l.doc} */\n        val ${pascal(l.name)} = ${l.value}.dp`).join("\n\n")}
    }
}
`;
}

export const OUTPUTS: ReadonlyArray<{ path: string; contents: () => string }> = [
  { path: join(ROOT, "src/app/tokens.generated.css"), contents: css },
  { path: join(ROOT, "src/design/tokens.generated.ts"), contents: tsTokens },
  { path: join(ROOT, "design/generated/DesignTokens.swift"), contents: swift },
  { path: join(ROOT, "design/generated/DesignTokens.kt"), contents: kotlin },
];

function main(): void {
  let drifted = 0;
  for (const { path, contents: emit } of OUTPUTS) {
    const rel = relative(ROOT, path);
    const contents = emit();
    if (CHECK) {
      let current: string | null = null;
      try {
        current = readFileSync(path, "utf8");
      } catch {
        current = null;
      }
      if (current !== contents) {
        drifted += 1;
        console.error(
          current === null
            ? `MISSING  ${rel}`
            : `DRIFTED  ${rel} — regenerate with \`npm run tokens\``,
        );
      } else {
        console.log(`ok       ${rel}`);
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
      console.log(`wrote    ${rel}`);
    }
  }

  if (CHECK && drifted > 0) {
    console.error(
      `\n${drifted} generated token file(s) out of date with src/design/tokens.ts.`,
    );
    process.exit(1);
  }

  const skipped = COLORS.filter((c) => c.status === "unused").length;
  if (!CHECK && skipped > 0) {
    console.log(
      `\n${COLORS.length - skipped} core colours emitted to all platforms; ` +
        `${skipped} unused (web CSS only — see tokens.ts).`,
    );
  }
}

// Only run when invoked as a script. Importing this module (the emitter tests
// do) must not write files or call process.exit.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

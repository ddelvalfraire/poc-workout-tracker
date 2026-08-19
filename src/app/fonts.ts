import { Inter, Oswald } from "next/font/google";

// Body / UI / data — humanist sans, product-grade workhorse.
export const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Display / headings — condensed grotesque, athletic gym-poster feel.
export const oswald = Oswald({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

/**
 * The `--font-sans` / `--font-display` custom-property classes.
 *
 * Single source for the DESIGN.md § Typography pairing: the app shell puts
 * these on `<html>`, and Storybook's preview puts the SAME string on its own
 * `<html>`. Declaring the two `next/font` calls twice would let the catalog
 * and the app drift apart on the exact axis the catalog exists to police.
 */
export const fontVariables = `${inter.variable} ${oswald.variable}`;

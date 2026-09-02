// GENERATED FILE — DO NOT EDIT.
//
// Source: src/design/tokens.ts
// Regenerate: npm run tokens
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
        /// App surface. Near-black, matches the PWA theme_color (#0a0a0a).
        public static let background = Color(.sRGB, red: 0.0394, green: 0.0394, blue: 0.0394, opacity: 1.0000)

        /// Primary ink. Verified >=4.5:1 on background.
        public static let foreground = Color(.sRGB, red: 0.9606, green: 0.9606, blue: 0.9606, opacity: 1.0000)

        /// Lifted panel. Keep-list surfaces only (sheets, dialogs, StatTile) — de-carded surfaces sit on background.
        public static let card = Color(.sRGB, red: 0.0905, green: 0.0905, blue: 0.0905, opacity: 1.0000)

        /// Ink on a lifted panel.
        public static let cardForeground = Color(.sRGB, red: 0.9606, green: 0.9606, blue: 0.9606, opacity: 1.0000)

        /// The volt. Primary action and active/selected state ONLY — never decoration. One volt moment per screen.
        public static let primary = Color(.sRGB, red: 0.6765, green: 0.9075, blue: 0.3051, opacity: 1.0000)

        /// Ink on volt. Dark, high-contrast.
        public static let primaryForeground = Color(.sRGB, red: 0.0371, green: 0.0613, blue: 0.0120, opacity: 1.0000)

        /// Secondary control fill.
        public static let secondary = Color(.sRGB, red: 0.1494, green: 0.1494, blue: 0.1494, opacity: 1.0000)

        /// Ink on a secondary control.
        public static let secondaryForeground = Color(.sRGB, red: 0.9606, green: 0.9606, blue: 0.9606, opacity: 1.0000)

        /// Muted fill: hover washes, ghost/pending bars.
        public static let muted = Color(.sRGB, red: 0.1494, green: 0.1494, blue: 0.1494, opacity: 1.0000)

        /// Secondary text and metadata. Verified >=4.5:1 on background.
        public static let mutedForeground = Color(.sRGB, red: 0.6447, green: 0.6447, blue: 0.6447, opacity: 1.0000)

        /// Remove / delete. The TINT and border colour — not the ink on top of it.
        public static let destructive = Color(.sRGB, red: 0.9436, green: 0.3038, blue: 0.2990, opacity: 1.0000)

        /// Text and icons ON a destructive tint. A tint and its ink cannot be the same value: as the tint's alpha rises the background approaches the ink, so contrast falls to 1. Verified >=4.5:1 on destructive tints from 5% to 30% (hover included) over page, card and muted.
        public static let destructiveInk = Color(.sRGB, red: 0.9963, green: 0.5775, blue: 0.5464, opacity: 1.0000)

        /// Offline / degraded hints. Verified >=4.5:1 on background.
        public static let warning = Color(.sRGB, red: 0.9165, green: 0.7093, blue: 0.1953, opacity: 1.0000)

        /// Hairline dividers — the de-card vocabulary's primary framing device.
        public static let border = Color(.sRGB, red: 1.0000, green: 1.0000, blue: 1.0000, opacity: 0.1200)

        /// Form field border.
        public static let input = Color(.sRGB, red: 1.0000, green: 1.0000, blue: 1.0000, opacity: 0.1500)

        /// Focus ring. The volt, so keyboard focus is unmistakable.
        public static let ring = Color(.sRGB, red: 0.6765, green: 0.9075, blue: 0.3051, opacity: 1.0000)
    }

    // MARK: - Corner radius (points)

    public enum Radius {
        /// --radius * 0.6
        public static let sm: CGFloat = 7.2

        /// --radius * 0.8
        public static let md: CGFloat = 9.6

        /// The base radius. Buttons and fields.
        public static let lg: CGFloat = 12

        /// --radius * 1.4. Card shells.
        public static let xl: CGFloat = 16.8

        /// --radius * 1.8. Keep-list shells only.
        public static let xl2: CGFloat = 21.6

        /// --radius * 2.2
        public static let xl3: CGFloat = 26.4

        /// --radius * 2.6
        public static let xl4: CGFloat = 31.2

        /// Pills and chips — controls, never labels.
        public static let full: CGFloat = 9999
    }

    // MARK: - Touch targets (points)

    public enum TouchTarget {
        /// Minimum tappable edge. Button default, Input, icon buttons.
        public static let min: CGFloat = 44

        /// Primary actions. Button lg.
        public static let comfortable: CGFloat = 48
    }

    // MARK: - Motion (seconds)
    //
    // Skip every one of these when UIAccessibility.isReduceMotionEnabled.

    public enum Duration {
        /// Colour / ring state transitions — the fast end.
        public static let state: TimeInterval = 0.150

        /// State transitions — the slow end.
        public static let stateSlow: TimeInterval = 0.250

        /// In-session mount motion: fade + 4px rise.
        public static let riseIn: TimeInterval = 0.180

        /// Bottom sheet entry from the edge it lives on.
        public static let sheetUp: TimeInterval = 0.240

        /// Pending delay: data that beats this shows NO ghost at all.
        public static let ghostDelay: TimeInterval = 0.150

        /// Ghost opacity pulse. Never a shimmer sweep.
        public static let ghostPulse: TimeInterval = 1.800
    }

    // MARK: - Typography
    //
    // Bundle the same two families as the web — substituting a system face
    // loses the contrast-axis pairing DESIGN.md specifies.

    public enum FontFamily {
        /// Display / headings. Condensed grotesque, usually uppercase with slight positive tracking. Weights 500/600/700.
        public static let display = "Oswald"

        /// Body, UI, data. Labels, buttons, inputs, numerals.
        public static let sans = "Inter"
    }

    public enum TypeScale {
        /// Caption 1. Captions, chip labels, metadata.
        public static let sizexs: (size: CGFloat, lineHeight: CGFloat) = (12, 16)

        /// Footnote. Body default, button labels, list secondary lines.
        public static let sizesm: (size: CGFloat, lineHeight: CGFloat) = (13, 18)

        /// Callout. Inputs — 16px is what stops iOS tap-zoom. Never go smaller in a field.
        public static let sizebase: (size: CGFloat, lineHeight: CGFloat) = (16, 21)

        /// Body. Section leads.
        public static let sizelg: (size: CGFloat, lineHeight: CGFloat) = (17, 22)

        /// Title 3. App bar title.
        public static let sizexl: (size: CGFloat, lineHeight: CGFloat) = (20, 25)

        /// Title 2. StatTile value.
        public static let size2xl: (size: CGFloat, lineHeight: CGFloat) = (22, 28)

        /// Title 1. Logger numerals — sized for glanceability mid-set.
        public static let size3xl: (size: CGFloat, lineHeight: CGFloat) = (28, 34)

        /// Large Title. Display headlines — next-up day name on the program detail.
        public static let size4xl: (size: CGFloat, lineHeight: CGFloat) = (34, 41)

        /// Hero numerals — programs-hero week count, fact-strip figures, empty-state headline. Display face, uppercase, one per screen. The single step above Apple's ladder: Large Title plus one optical notch, the way Fitness and Weather size their one hero figure.
        public static let size5xl: (size: CGFloat, lineHeight: CGFloat) = (40, 44)
    }

    // MARK: - Layout (points)

    public enum Layout {
        /// The single phone column (28rem). Every reading surface.
        public static let contentMaxWidth: CGFloat = 448

        /// HOME only (42rem), from the md breakpoint up.
        public static let contentMaxWidthWide: CGFloat = 672

        /// The ONE architectural breakpoint: below it the editor is the phone column and drilling down navigates; at or above it the same routes project into panes and drilling down SELECTS. Matches Material's expanded window class, and it is a WINDOW measure, not a device one — split-screen and Stage Manager cross it.
        public static let editorPaneBreakpoint: CGFloat = 840

        /// Editor pane 1 — weeks and days. Fixed: it is a table of contents, so it must not grow with the window.
        public static let editorStructurePaneWidth: CGFloat = 244

        /// Editor pane 3 — the inspector for whatever is selected (Apple: beside the content, never a popover). Fixed, and collapses to nothing when the selection is empty so it never costs width for silence.
        public static let editorInspectorWidth: CGFloat = 316

        /// Sticky top app bar, excluding the status-bar safe area.
        public static let appBarHeight: CGFloat = 56

        /// The nav drawer's hero box — the volt button's own height (12 padding + 21 text-base line + 2 gap + 16 text-xs line + 12 padding + 2 border, rounded to the spacing grid). Every hero variant, the pending ghost included, fills it (web: min-h-17), so pending → quiet → volt swaps never move the rows below.
        public static let navHeroHeight: CGFloat = 68
    }
}

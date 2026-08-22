// GENERATED FILE — DO NOT EDIT.
//
// Source: src/design/tokens.ts
// Regenerate: npm run tokens
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
        /** App surface. Near-black, matches the PWA theme_color (#0a0a0a). */
        val Background = Color(0xFF0A0A0A)

        /** Primary ink. Verified >=4.5:1 on background. */
        val Foreground = Color(0xFFF5F5F5)

        /** Lifted panel. Keep-list surfaces only (sheets, dialogs, StatTile) — de-carded surfaces sit on background. */
        val Card = Color(0xFF171717)

        /** Ink on a lifted panel. */
        val CardForeground = Color(0xFFF5F5F5)

        /** The volt. Primary action and active/selected state ONLY — never decoration. One volt moment per screen. */
        val Primary = Color(0xFFADE74E)

        /** Ink on volt. Dark, high-contrast. */
        val PrimaryForeground = Color(0xFF091003)

        /** Secondary control fill. */
        val Secondary = Color(0xFF262626)

        /** Ink on a secondary control. */
        val SecondaryForeground = Color(0xFFF5F5F5)

        /** Muted fill: hover washes, ghost/pending bars. */
        val Muted = Color(0xFF262626)

        /** Secondary text and metadata. Verified >=4.5:1 on background. */
        val MutedForeground = Color(0xFFA4A4A4)

        /** Remove / delete. The TINT and border colour — not the ink on top of it. */
        val Destructive = Color(0xFFF14D4C)

        /** Text and icons ON a destructive tint. A tint and its ink cannot be the same value: as the tint's alpha rises the background approaches the ink, so contrast falls to 1. Verified >=4.5:1 on destructive tints from 5% to 30% (hover included) over page, card and muted. */
        val DestructiveInk = Color(0xFFFE938B)

        /** Offline / degraded hints. Verified >=4.5:1 on background. */
        val Warning = Color(0xFFEAB532)

        /** Hairline dividers — the de-card vocabulary's primary framing device. */
        val Border = Color(0x1FFFFFFF)

        /** Form field border. */
        val Input = Color(0x26FFFFFF)

        /** Focus ring. The volt, so keyboard focus is unmistakable. */
        val Ring = Color(0xFFADE74E)
    }

    object Radius {
        /** --radius * 0.6 */
        val Sm = 7.2.dp

        /** --radius * 0.8 */
        val Md = 9.6.dp

        /** The base radius. Buttons and fields. */
        val Lg = 12.dp

        /** --radius * 1.4. Card shells. */
        val Xl = 16.8.dp

        /** --radius * 1.8. Keep-list shells only. */
        val Xl2 = 21.6.dp

        /** --radius * 2.2 */
        val Xl3 = 26.4.dp

        /** --radius * 2.6 */
        val Xl4 = 31.2.dp

        /** Pills and chips — controls, never labels. */
        val Full = 9999.dp
    }

    object TouchTarget {
        /** Minimum tappable edge. Button default, Input, icon buttons. */
        val Min = 44.dp

        /** Primary actions. Button lg. */
        val Comfortable = 48.dp
    }

    /**
     * Motion. Skip every one of these when the system animation scale is 0
     * (Settings.Global.TRANSITION_ANIMATION_SCALE).
     */
    object Duration {
        /** Colour / ring state transitions — the fast end. */
        const val StateMs = 150

        /** State transitions — the slow end. */
        const val StateSlowMs = 250

        /** In-session mount motion: fade + 4px rise. */
        const val RiseInMs = 180

        /** Bottom sheet entry from the edge it lives on. */
        const val SheetUpMs = 240

        /** Pending delay: data that beats this shows NO ghost at all. */
        const val GhostDelayMs = 150

        /** Ghost opacity pulse. Never a shimmer sweep. */
        const val GhostPulseMs = 1800
    }

    /**
     * Bundle the same two families as the web — substituting a system face
     * loses the contrast-axis pairing DESIGN.md specifies.
     */
    object FontFamily {
        /** Display / headings. Condensed grotesque, usually uppercase with slight positive tracking. Weights 500/600/700. */
        const val Display = "Oswald"

        /** Body, UI, data. Labels, buttons, inputs, numerals. */
        const val Sans = "Inter"
    }

    object TypeScale {
        /** Captions, chip labels, metadata. */
        val Sizexs = 12.sp to 16.sp

        /** Body default, button labels. */
        val Sizesm = 14.sp to 20.sp

        /** Inputs — 16px is what stops iOS tap-zoom. Never go smaller in a field. */
        val Sizebase = 16.sp to 24.sp

        /** Section leads. */
        val Sizelg = 18.sp to 28.sp

        /** App bar title. */
        val Sizexl = 20.sp to 28.sp

        /** StatTile value. */
        val Size2xl = 24.sp to 32.sp

        /** Logger numerals — sized for glanceability mid-set. */
        val Size3xl = 30.sp to 36.sp

        /** Display headlines — next-up day name on the program detail. */
        val Size4xl = 36.sp to 40.sp

        /** Hero numerals — programs-hero week count, fact-strip figures, empty-state headline. Display face, uppercase, one per screen. */
        val Size5xl = 48.sp to 48.sp
    }

    object Layout {
        /** The single phone column (28rem). Every surface except HOME. */
        val ContentMaxWidth = 448.dp

        /** HOME only (42rem), from the md breakpoint up. */
        val ContentMaxWidthWide = 672.dp

        /** Sticky top app bar, excluding the status-bar safe area. */
        val AppBarHeight = 56.dp
    }
}

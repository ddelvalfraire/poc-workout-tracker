import type { Metadata, Viewport } from "next";
import { Inter, Oswald } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { ChunkRecoveryScript } from "@/components/pwa/chunk-recovery-script";
import { UpdateOnResume } from "@/components/pwa/update-on-resume";
import { PageTransition } from "@/components/page-transition";
import { Providers } from "./providers";
import "./globals.css";

// Body / UI / data — humanist sans, product-grade workhorse.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

// Display / headings — condensed grotesque, athletic gym-poster feel.
const oswald = Oswald({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

const BRAND = "#0a0a0a";

export const metadata: Metadata = {
  title: "Workout Tracker",
  description: "Log your workouts and review your training history.",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Workouts" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  themeColor: BRAND,
  // Cover the notch/home-indicator in standalone mode; env(safe-area-*) handles insets.
  viewportFit: "cover",
  // Android/Chromium: the software keyboard RESIZES the viewport instead of
  // overlaying it, so dvh-sized surfaces (the exercise sheet) track the
  // keyboard. Safari ignores this — there the sheet's top-pinned search
  // input is what keeps typing usable (see exercise-sheet.tsx).
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          colorBackground: BRAND,
          colorPrimary: "oklch(0.86 0.19 128)",
          colorPrimaryForeground: "oklch(0.16 0.03 128)",
          colorForeground: "oklch(0.97 0 0)",
          colorMutedForeground: "oklch(0.72 0 0)",
          colorInput: "oklch(0.205 0 0)",
          colorInputForeground: "oklch(0.97 0 0)",
          colorNeutral: "oklch(0.97 0 0)",
        },
      }}
    >
      <html
        lang="en"
        className={`dark ${inter.variable} ${oswald.variable} h-full antialiased`}
      >
        <body className="bg-background text-foreground min-h-[100dvh] flex flex-col">
          {/* Must be first in <body>: attaches chunk-failure listeners before
              any /_next script can 404 (stale deploy), when React never boots. */}
          <ChunkRecoveryScript />
          <Providers>
            <PageTransition>{children}</PageTransition>
          </Providers>
          <ServiceWorkerRegister />
          {/* Proactive stale-build reload on resume — the counterpart to the
              reactive ChunkRecoveryScript above. */}
          <UpdateOnResume />
        </body>
      </html>
    </ClerkProvider>
  );
}

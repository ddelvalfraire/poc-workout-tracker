import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { ConsentIdentity } from "@/components/consent-identity";
import { getConsentState } from "@/db/consent";
import { NavigationTracker } from "@/components/navigation-tracker";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { ChunkRecoveryScript } from "@/components/pwa/chunk-recovery-script";
import { UpdateOnResume } from "@/components/pwa/update-on-resume";
import { PageTransition } from "@/components/page-transition";
import { Providers } from "./providers";
import { fontVariables } from "./fonts";
import "./globals.css";

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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server-truth bootstrap for analytics identity: consent is a per-USER
  // fact; the ConsentIdentity island converges this device's PostHog state
  // to it (identify on grant, reset on withdrawal — cross-device correct).
  // Signed-out = nothing to reconcile. One projection read per request.
  const { userId } = await auth();
  const analyticsGranted = userId
    ? Boolean((await getConsentState(userId)).analytics_identity?.granted)
    : false;
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
        className={`dark ${fontVariables} h-full antialiased`}
      >
        <body className="bg-background text-foreground min-h-[100dvh] flex flex-col">
          {/* Must be first in <body>: attaches chunk-failure listeners before
              any /_next script can 404 (stale deploy), when React never boots. */}
          <ChunkRecoveryScript />
          {/* Once, app-wide: the in-app history stack every BackLink reads
              (pop vs fallback-replace) — see lib/back-navigation. */}
          <NavigationTracker />
          <Providers>
            <PageTransition>{children}</PageTransition>
          </Providers>
          {userId && <ConsentIdentity userId={userId} granted={analyticsGranted} />}
          <ServiceWorkerRegister />
          {/* Proactive stale-build reload on resume — the counterpart to the
              reactive ChunkRecoveryScript above. */}
          <UpdateOnResume />
        </body>
      </html>
    </ClerkProvider>
  );
}

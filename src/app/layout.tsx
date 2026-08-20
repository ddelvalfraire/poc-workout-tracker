import type { Metadata, Viewport } from "next";
import { withAuth } from "@workos-inc/authkit-nextjs";
import { AuthKitProvider } from "@workos-inc/authkit-nextjs/components";
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
  // Read the session HERE and hand it to the provider as `initialAuth`.
  // Without it the provider fetches the session from a client effect on
  // mount — and that fetch is a SERVER ACTION, which makes Next refetch the
  // route, which re-runs the effect: every page reloaded forever, spinner
  // restarting, while the server logged nothing but 200s.
  //
  // accessToken is destructured off deliberately: it is a live credential and
  // the provider's own prop type omits it from what reaches the client.
  const { accessToken, ...initialAuth } = await withAuth();
  void accessToken; // stays on the server; never serialized to the client

  return (
    <html
      lang="en"
      className={`dark ${fontVariables} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-[100dvh] flex flex-col">
        {/* Must be first in <body>: attaches chunk-failure listeners before
            any /_next script can 404 (stale deploy), when React never boots. */}
        <ChunkRecoveryScript />
        {/* AuthKit's client-side session context (useAuth) plus its handling
            for auth edge cases — the hosted sign-in page is themed in the
            WorkOS dashboard, so no appearance config lives in code. */}
        <AuthKitProvider initialAuth={initialAuth}>
          {/* Once, app-wide: the in-app history stack every BackLink reads
              (pop vs fallback-replace) — see lib/back-navigation. */}
          <NavigationTracker />
          <Providers>
            <PageTransition>{children}</PageTransition>
          </Providers>
          <ServiceWorkerRegister />
          {/* Proactive stale-build reload on resume — the counterpart to the
              reactive ChunkRecoveryScript above. */}
          <UpdateOnResume />
        </AuthKitProvider>
      </body>
    </html>
  );
}

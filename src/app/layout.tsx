import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import { resolveLocale } from "@/i18n/request";
import { NavigationTracker } from "@/components/navigation-tracker";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { ChunkRecoveryScript } from "@/components/pwa/chunk-recovery-script";
import { UpdateOnResume } from "@/components/pwa/update-on-resume";
import { PageTransition } from "@/components/page-transition";
import { Providers } from "./providers";
import { fontVariables } from "./fonts";
import "./globals.css";

const BRAND = "#0a0a0a";

// A function rather than a static object so the title/description come from
// the message catalog. Still evaluated at build time — getTranslations reads
// the request config, which is locale-constant and touches no request data,
// so static routes stay static.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Common");
  return {
    title: t("appName"),
    description: t("appDescription"),
    appleWebApp: { capable: true, statusBarStyle: "default", title: "Workouts" },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

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

// NO auth provider and NO session read belong in this layout. It wraps the
// public routes too, so reading request data here opts /terms, /privacy and
// /health-privacy out of static rendering — which is exactly what happened
// once already. src/app/layout.test.ts fails if either creeps back.
export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Async only to await the locale — NOT a request read, so this does not
  // opt any route out of static rendering.
  const locale = await resolveLocale();

  return (
    <html
      lang={locale}
      dir="ltr"
      className={`dark ${fontVariables} h-full antialiased`}
    >
      <body className="bg-background text-foreground min-h-[100dvh] flex flex-col">
        {/* Must be first in <body>: attaches chunk-failure listeners before
            any /_next script can 404 (stale deploy), when React never boots. */}
        <ChunkRecoveryScript />
        {/* Once, app-wide: the in-app history stack every BackLink reads
            (pop vs fallback-replace) — see lib/back-navigation. */}
        <NavigationTracker />
        {/* No messages prop: client islands inherit what the server already
            resolved. NOTE the cost of putting this at the root — getMessages()
            returns the WHOLE catalog unscoped, so every route's payload
            carries every namespace. Fine at this size; once extraction has
            grown the catalog, scope it (pick() per route, or push providers
            down to the islands that need them) or it becomes a bundle
            regression no test will catch. */}
        <NextIntlClientProvider>
          <Providers>
            <PageTransition>{children}</PageTransition>
          </Providers>
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
        {/* Proactive stale-build reload on resume — the counterpart to the
            reactive ChunkRecoveryScript above. */}
        <UpdateOnResume />
      </body>
    </html>
  );
}

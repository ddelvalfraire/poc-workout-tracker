import type { Metadata, Viewport } from "next";
import { Inter, Oswald } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { PageTransition } from "@/components/page-transition";
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
          <PageTransition>{children}</PageTransition>
          <ServiceWorkerRegister />
        </body>
      </html>
    </ClerkProvider>
  );
}

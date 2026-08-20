import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import type { Decorator, Preview } from "@storybook/nextjs-vite";
import { storybookTheme } from "./theme";

import messages from "../messages/en.json";
import { fontVariables } from "../src/app/fonts";
import "../src/app/globals.css";

/**
 * Mirror the app shell's <html> exactly (src/app/layout.tsx): the committed
 * `dark` class plus the shared font variables.
 *
 * It has to be `documentElement`, not a wrapper <div>: globals.css declares
 * `@custom-variant dark (&:is(.dark *))`, so every `dark:` utility in the
 * components needs a `.dark` ANCESTOR to match. Painting the root is also
 * what makes the canvas read as the real app surface rather than a component
 * floating on white.
 */
if (typeof document !== "undefined") {
  document.documentElement.classList.add(
    "dark",
    "antialiased",
    ...fontVariables.split(" ").filter(Boolean),
  );
}

/**
 * Phone-first, matching DESIGN.md § Layout & Mobile: the app is a single
 * centered column capped at ~28rem, so the default canvas is a phone. The
 * `md` entry exists for HOME, the one surface that widens to ~42rem.
 */
const VIEWPORTS = {
  iphoneSe: {
    name: "iPhone SE (375×667)",
    styles: { width: "375px", height: "667px" },
    type: "mobile" as const,
  },
  iphone14: {
    name: "iPhone 14/15 (390×844)",
    styles: { width: "390px", height: "844px" },
    type: "mobile" as const,
  },
  pixel7: {
    name: "Pixel 7 (412×915)",
    styles: { width: "412px", height: "915px" },
    type: "mobile" as const,
  },
  md: {
    name: "md breakpoint (768×1024)",
    styles: { width: "768px", height: "1024px" },
    type: "tablet" as const,
  },
};

/**
 * Mirrors src/app/providers.tsx for the client components that fetch through
 * TanStack Query (the nav drawer, the ops panels). Retries are off and the
 * cache is per-story: a story must show its stubbed state immediately and must
 * not inherit data from the story you were just looking at.
 */
function withQueryClient(Story: React.ComponentType) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false },
    },
  });
  return (
    <QueryClientProvider client={client}>
      <Story />
    </QueryClientProvider>
  );
}

/**
 * Components that call useTranslations need next-intl's context, which only the
 * app's provider supplies — without it they throw on render. The catalog is the
 * REAL messages/en.json, so the catalog renders the copy users actually see and
 * a missing key surfaces here rather than shipping.
 */
const withIntl: Decorator = (Story) => (
  <NextIntlClientProvider locale="en" messages={messages}>
    <Story />
  </NextIntlClientProvider>
);

const preview: Preview = {
  decorators: [withIntl, withQueryClient],
  parameters: {
    // Accessibility is a test, not a panel you remember to open: every story
    // fails its Vitest run on a violation. Stories that still carry a known
    // violation say so with `a11y: { test: 'todo' }` ON THE STORY, where the
    // component author will see it.
    a11y: { test: "error" },
    docs: { theme: storybookTheme },
    layout: "centered",
    // The app ships ONE intentional dark theme (DESIGN.md § Theme) — a
    // background switcher would advertise a light mode that does not exist.
    backgrounds: { disable: true },
    viewport: { options: VIEWPORTS },
    // Required for any component importing next/navigation (BackLink,
    // UnitToggle, the ops controls, the nav drawer).
    nextjs: { appDirectory: true },
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
      expanded: true,
    },
    options: {
      storySort: {
        order: [
          "Design",
          ["Introduction", "Design Tokens", "De-card Vocabulary"],
          "UI",
          "Components",
          "Charts",
          "Navigation",
          "Editor",
          "Ops",
          "*",
        ],
      },
    },
  },
  initialGlobals: { viewport: { value: "iphone14" } },
  // Autodocs for every component: the prop tables come from the JSDoc and
  // prop interfaces already written in src/components/**.
  tags: ["autodocs"],
};

export default preview;

import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { NavigationTracker } from "./navigation-tracker";

/**
 * **Renders nothing.** Mounted once in the root layout, it mirrors the app's
 * slice of browser history into the `sessionStorage` stack that `canGoBack()`
 * reads — the state `BackLink` consults to decide "pop" versus
 * "replace(fallback)".
 *
 * The ordering contract it depends on: the browser fires `popstate` BEFORE the
 * App Router re-renders, so `reconcilePopstate()` has already aligned the
 * stack top by the time the `usePathname` effect runs, and `recordPathname`
 * no-ops instead of double-counting the pop as a push.
 *
 * There is no visual to review, so this story exists as a **mount smoke
 * test**: if the component throws on mount, or its effects blow up outside a
 * real Next.js history stack, this story goes red. Its behaviour is covered by
 * the unit tests around `lib/back-navigation`, not here.
 */
const meta = {
  title: "Behavioral/NavigationTracker",
  component: NavigationTracker,
  parameters: { layout: "padded" },
} satisfies Meta<typeof NavigationTracker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MountsWithoutRendering: Story = {
  render: () => (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <NavigationTracker />
      <p className="border-b border-b-border/60 py-4 text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">
          Mounted, renders null.
        </strong>{" "}
        This component writes to the sessionStorage history stack and returns
        nothing. An empty canvas is the correct result.
      </p>
    </div>
  ),
}

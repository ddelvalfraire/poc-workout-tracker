import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { PageTransition } from "./page-transition";

/**
 * The route-change boundary in the root layout (React `<ViewTransition>`).
 *
 * Outgoing content fades up and out, incoming fades up and in — 140ms out,
 * 200ms in, quick enough to read as *responsiveness* rather than decoration.
 * The animation itself lives in `globals.css` under
 * `::view-transition-old(.page)` / `::view-transition-new(.page)`, and
 * `prefers-reduced-motion: reduce` removes it entirely.
 *
 * Browsers without the View Transitions API ignore all of it and the app is
 * unaffected — which is also why this component looks inert in Storybook.
 * There is no route change to animate here; the transition is only observable
 * in the running app. What this story proves is that the boundary renders its
 * children transparently.
 */
const meta = {
  title: "Components/PageTransition",
  component: PageTransition,
  parameters: { layout: "padded" },
} satisfies Meta<typeof PageTransition>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: (
      <div className="w-[min(28rem,calc(100vw-2rem))]">
        <h1 className="text-xl uppercase tracking-tight">History</h1>
        <ul className="mt-4 divide-y divide-border/60 border-b border-b-border/60">
          {["Push day", "Pull day", "Leg day"].map((name) => (
            <li key={name} className="flex justify-between gap-4 py-4">
              <span>{name}</span>
              <span className="text-muted-foreground">18 sets</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-muted-foreground">
          The boundary passes its children straight through. The fade-and-rise
          only fires on a real route change.
        </p>
      </div>
    ),
  },
}

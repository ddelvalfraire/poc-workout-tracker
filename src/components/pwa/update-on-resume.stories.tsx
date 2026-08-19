import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { UpdateOnResume } from "./update-on-resume";

/**
 * **Renders nothing.** Proactive stale-build detection for the installed PWA:
 * on mount and on every background→foreground resume it compares this
 * bundle's baked-in build id against `/api/version` (served by the newest
 * deployment) and hard-reloads on mismatch — BEFORE the user taps into a dead
 * chunk.
 *
 * It is the proactive half of a pair; `ChunkRecoveryScript` is the reactive
 * net for failures this misses.
 *
 * No visual to review, so this story is a **mount smoke test**. `/api/version`
 * does not exist in Storybook, so the fetch fails and the component correctly
 * does nothing — which is exactly the behaviour you want when the version
 * endpoint is unreachable.
 */
const meta = {
  title: "Behavioral/UpdateOnResume",
  component: UpdateOnResume,
  parameters: { layout: "padded" },
} satisfies Meta<typeof UpdateOnResume>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MountsWithoutRendering: Story = {
  render: () => (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <UpdateOnResume />
      <p className="border-b border-b-border/60 py-4 text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">
          Mounted, renders null.
        </strong>{" "}
        A failed version check must be a no-op, never a reload loop.
      </p>
    </div>
  ),
}

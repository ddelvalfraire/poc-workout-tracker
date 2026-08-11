import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ServiceWorkerRegister } from "./service-worker-register";

/**
 * **Renders nothing.** Registers the Serwist service worker and listens for
 * waiting/activated updates.
 *
 * No visual to review, so this story is a **mount smoke test** — it proves the
 * component mounts and cleans up without throwing. Storybook is not a
 * PWA scope, so no worker is actually installed here; the real behaviour only
 * exists in the deployed app.
 */
const meta = {
  title: "Behavioral/ServiceWorkerRegister",
  component: ServiceWorkerRegister,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ServiceWorkerRegister>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MountsWithoutRendering: Story = {
  render: () => (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <ServiceWorkerRegister />
      <p className="border-b border-b-border/60 py-4 text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">
          Mounted, renders null.
        </strong>{" "}
        Service-worker registration is a side effect of the app shell, not a
        component with a surface.
      </p>
    </div>
  ),
}

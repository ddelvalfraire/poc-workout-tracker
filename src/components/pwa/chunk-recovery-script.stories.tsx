import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ChunkRecoveryScript } from "./chunk-recovery-script";

/**
 * **Renders nothing in development.** In production it emits a single inline
 * `<script>` that must be the FIRST thing in `<body>` — it attaches
 * chunk-failure listeners before any `/_next` script can 404 against a stale
 * deploy, in the window where React never boots at all.
 *
 * It is the reactive net under `UpdateOnResume`'s proactive version check.
 *
 * Because Storybook runs a development bundle, the component takes its
 * `NODE_ENV !== 'production'` branch and returns null. There is nothing to
 * see, and a story that faked the production markup would be documenting
 * something the catalog never actually renders — so this stays a **mount
 * smoke test**.
 */
const meta = {
  title: "Behavioral/ChunkRecoveryScript",
  component: ChunkRecoveryScript,
  parameters: { layout: "padded" },
} satisfies Meta<typeof ChunkRecoveryScript>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MountsWithoutRendering: Story = {
  render: () => (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <ChunkRecoveryScript />
      <p className="border-b border-b-border/60 py-4 text-sm text-muted-foreground">
        <strong className="font-medium text-foreground">
          Mounted, renders null here.
        </strong>{" "}
        The inline recovery script is production-only; a dev bundle has no
        stale chunks to recover from.
      </p>
    </div>
  ),
}

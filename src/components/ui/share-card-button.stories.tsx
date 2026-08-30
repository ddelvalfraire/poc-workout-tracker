import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ShareCardButton } from "./share-card-button";

/**
 * Shares a rendered card PNG through the OS share sheet.
 *
 * The privacy design is the whole point: it fetches the card from a
 * same-origin **authed** route (the WorkOS session cookie rides the fetch, so
 * the PNG never has a public URL), then hands the FILE to
 * `navigator.share({ files })` — the iOS PWA path. The share verb ships the
 * pixels, never a link. Where file sharing is unavailable it falls back to
 * downloading the image and showing a short hint.
 *
 * Storybook has no card API, so these stories point `cardUrl` at an inline
 * `data:` PNG. The fetch, the `File` construction and the share/download
 * branch are all real — only the image is a stand-in. Which branch you get
 * depends on the browser you are viewing this in.
 */
const meta = {
  title: "Components/ShareCardButton",
  component: ShareCardButton,
  args: {
    // 1×1 transparent PNG — enough for a real fetch + File round-trip.
    cardUrl:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    shareTitle: "Squat 315 club",
  },
  argTypes: { size: { control: "inline-radio", options: ["icon-xs", "icon-sm"] } },
} satisfies Meta<typeof ShareCardButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {}

export const ExtraSmall: Story = { args: { size: "icon-xs" } }

/** A failing card route — press it to see the error hint. */
export const FetchFails: Story = {
  args: { cardUrl: "/api/cards/does-not-exist", shareTitle: "Broken card" },
}

/** In place — trailing a trophy row. */
export const InContext: Story = {
  parameters: { layout: "padded" },
  render: (args) => (
    <div className="w-[min(28rem,calc(100vw-2rem))]">
      <div className="flex items-center justify-between gap-4 border-b border-b-border/60 py-4">
        <div className="min-w-0">
          <div className="truncate">Squat 315 club</div>
          <div className="truncate text-sm text-muted-foreground">
            Earned 12 Mar 2026
          </div>
        </div>
        <ShareCardButton {...args} />
      </div>
    </div>
  ),
}

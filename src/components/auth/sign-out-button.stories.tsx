import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";

import { SignOutButton } from "./sign-out-button";

/** The HIG/Material floor, and `touch-target-min` in src/design/tokens.ts. */
const TOUCH_TARGET_MIN_PX = 44;

/**
 * The way out of the app, in both of its shapes.
 *
 * AuthKit ships no account widget, so sign-out is an explicit control instead
 * of a menu hidden behind an avatar — the identity surface it used to belong
 * to now lives on /settings. `icon` sits where the vendor avatar button used
 * to (home header, drawer footer); `full` is the labelled control in the
 * settings identity row.
 *
 * Both variants are 44px targets and quiet by default — sign-out is an exit,
 * never a volt (DESIGN.md § one volt).
 *
 * In Storybook the server action is stubbed
 * (`.storybook/mocks/app-actions.ts`) with ~600ms of latency, so the disabled
 * "Signing out…" state is actually visible when you press.
 */
const meta = {
  title: "Components/SignOutButton",
  component: SignOutButton,
  args: { variant: "icon" },
  argTypes: { variant: { control: "inline-radio", options: ["icon", "full"] } },
} satisfies Meta<typeof SignOutButton>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Both stories assert the 44px floor rather than trusting the prose above it.
 * The first version of this component claimed both variants met the floor
 * while the labelled one sized off padding alone and landed near 32px — the
 * story rendered it perfectly happily, because nothing measured it.
 */
async function expectTouchTargetFloor(canvasElement: HTMLElement) {
  const button = within(canvasElement).getByRole("button", { name: /sign out/i });
  await expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(
    TOUCH_TARGET_MIN_PX,
  );
}

export const Icon: Story = {
  play: async ({ canvasElement }) => expectTouchTargetFloor(canvasElement),
}

export const Full: Story = {
  args: { variant: "full" },
  play: async ({ canvasElement }) => expectTouchTargetFloor(canvasElement),
}

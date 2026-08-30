import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { useEffect } from "react";

import type { DrawerData } from "@/lib/home/drawer-status";

import { NavDrawer } from "./nav-drawer";

/**
 * The navigation drawer — and the verdict that shapes it: **the drawer is a
 * dashboard, not a menu.** Four zones with distinct jobs: ACT (the volt hero
 * whose copy IS the context) / SURFACES (every row carries a live status line)
 * / RECENT / IDENTITY, pinned bottom.
 *
 * Vaul owns the mechanics — focus trap, scrim, escape, swipe-to-dismiss,
 * left-edge slide. Status data arrives through TanStack Query, enabled on the
 * drawer's FIRST open, so a warm cache renders instantly on later opens with
 * no ghosts and no arrival replay.
 *
 * The degradation rule is the important one: **a failed fetch degrades every
 * row to its label**. The nav never breaks because a status read did — see
 * `FetchFails` below.
 *
 * Open the drawer with the trigger; `/api/drawer` is stubbed per story. Every
 * story below renders the drawer CLOSED — the content lives in a portal that
 * mounts on first open, so `Opened` is the one that actually exercises it.
 */

const FULL: DrawerData = {
  resume: null,
  upNext: { dayId: "d1", dayName: "Push A", week: 3, weekdays: [1, 3, 5] },
  program: { name: "Push / Pull / Legs", week: 3, mesocycleWeeks: 4 },
  stats: { weekSets: 26, daySets: [4, 0, 6, 3, 0, 8, 5] },
  goals: {
    activeCount: 2,
    topGoalLabel: "Bench 120 kg",
    percent: 68,
    streak: {
      completedAtTimes: Array.from(
        { length: 12 },
        (_, i) => Date.now() - (i + 1) * 2 * 86_400_000,
      ),
      scheduledWeekdays: [1, 3, 5],
      allowedMissesPerWeek: 1,
    },
  },
  trophies: { earned: 7, newestLabel: "Squat 140 kg" },
  body: { weightKg: 78.4, deltaKg: -0.3, checkInDue: false, daysSinceLast: 2 },
  exercises: { lastPrLabel: "Bench 102.5 kg", loggedCount: 48 },
  coach: true,
  recents: [
    { id: "w1", name: "Pull B", startedAtMs: Date.now() - 86_400_000, volumeKg: 9820 },
    { id: "w2", name: "Legs A", startedAtMs: Date.now() - 3 * 86_400_000, volumeKg: 12480 },
    { id: "w3", name: null, startedAtMs: Date.now() - 5 * 86_400_000, volumeKg: 7310 },
  ],
  unit: "kg",
};

const EMPTY: DrawerData = {
  resume: null,
  upNext: null,
  program: null,
  stats: null,
  goals: null,
  trophies: null,
  body: null,
  exercises: null,
  coach: false,
  recents: [],
  unit: "kg",
};

/**
 * Stubs `/api/drawer` for the lifetime of a story. Patching `fetch` is
 * deliberate over a network-mock addon: the drawer makes exactly one request,
 * and an explicit stub keeps each story's state readable at a glance.
 */
function stubDrawer(
  respond: () => Promise<Response>,
): (Story: React.ComponentType) => React.ReactElement {
  return function WithStubbedDrawer(Story) {
    useEffect(() => {
      const real = window.fetch;
      window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/drawer")) return respond();
        return real(input, init);
      }) as typeof window.fetch;
      return () => {
        window.fetch = real;
      };
    }, []);
    return <Story />;
  };
}

const json = (data: DrawerData, delayMs = 400) => async () => {
  await new Promise((r) => setTimeout(r, delayMs));
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

// NavDrawer resolves 'today'/'tomorrow' and relative recents against the
// REAL clock (local-day semantics, by design), so its fixtures stay relative
// to now. A frozen epoch would label every recent workout months old.
const meta = {
  title: "Navigation/NavDrawer",
  component: NavDrawer,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="min-h-[36rem] bg-background p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NavDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A full dashboard: active program, goals, trophies, body, recents. */
export const Populated: Story = { decorators: [stubDrawer(json(FULL))] }

/**
 * The drawer as the user sees it. Vaul renders the content in a portal that
 * only mounts on first open, so a story that leaves it closed asserts almost
 * nothing about this component — including whether it renders at all. That
 * gap hid a crash: the footer's account widget threw outside its auth
 * provider, and nothing caught it because nothing ever opened the drawer.
 */
export const Opened: Story = {
  decorators: [stubDrawer(json(FULL))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByLabelText("Open navigation"));
    // The portal renders outside canvasElement, so query the document body.
    const drawer = within(document.body);
    // Substring match: the hero reads "Push A · Week 3 · tomorrow" in one node.
    await expect(await drawer.findByText(/Push A/)).toBeInTheDocument();
    // The identity row is the part the closed stories could never reach — it
    // holds the account widget that used to throw here.
    await expect(
      await drawer.findByRole("link", { name: /settings/i }),
    ).toBeInTheDocument();
  },
}

/**
 * A live session turns the hero into RESUME — the single-active-session
 * guard expressed in the drawer's one volt moment.
 */
export const LiveSession: Story = {
  decorators: [
    stubDrawer(json({ ...FULL, resume: { key: "new", name: "Push A" }, upNext: null })),
  ],
}

/** A brand-new account: every row is an invitation, not a teaser. */
export const NewAccount: Story = { decorators: [stubDrawer(json(EMPTY))] }

/** Slow network — the ghosts and the staggered arrival are visible. */
export const Loading: Story = { decorators: [stubDrawer(json(FULL, 4000))] }

/**
 * The degradation contract: the status read failed, so every row falls back to
 * its plain label. The nav still works.
 */
export const FetchFails: Story = {
  decorators: [
    stubDrawer(async () => new Response("nope", { status: 500 })),
  ],
}

/** Pounds — status lines are server-rendered in the user's unit. */
export const PoundsUnit: Story = {
  decorators: [stubDrawer(json({ ...FULL, unit: "lb" }))],
}

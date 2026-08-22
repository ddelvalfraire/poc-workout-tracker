import type { Meta, StoryObj } from '@storybook/nextjs-vite'

import { Button } from '@/components/ui/button'
import { TemplatePreview, type TemplatePreviewDay } from './template-preview'

/**
 * The shared template preview — one body for both shelves of
 * /programs/templates/[id]. The pitch order is the contract: fact strip at
 * hero scale, block map, day 1 fully expanded, later days as expandable
 * summary rows, description after the plan, sticky volt start bar.
 */
const meta = {
  title: 'Components/TemplatePreview',
  component: TemplatePreview,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <main className="mx-auto min-h-[100dvh] w-full max-w-md px-5">
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof TemplatePreview>

export default meta
type Story = StoryObj<typeof meta>

const repSets = (count: number, repMin: number, repMax: number) =>
  Array.from({ length: count }, () => ({ setType: 'working' as const, repMin, repMax }))

const DAYS: TemplatePreviewDay[] = [
  {
    key: 'day-1',
    name: 'Squat',
    exercises: [
      { key: 'e1', name: 'Back Squat', supersetGroup: null, sets: repSets(5, 3, 3) },
      { key: 'e2', name: 'Bench Press', supersetGroup: null, sets: repSets(3, 10, 10) },
      { key: 'e3', name: 'Lat Pulldown', supersetGroup: null, sets: repSets(3, 15, 15) },
    ],
  },
  {
    key: 'day-2',
    name: 'Overhead Press',
    exercises: [
      { key: 'e4', name: 'Overhead Press', supersetGroup: null, sets: repSets(5, 3, 3) },
      { key: 'e5', name: 'Deadlift', supersetGroup: null, sets: repSets(3, 10, 10) },
      { key: 'e6', name: 'Dumbbell Row', supersetGroup: 1, sets: repSets(3, 12, 15) },
      { key: 'e7', name: 'Cable Face Pull', supersetGroup: 1, sets: repSets(3, 15, 20) },
    ],
  },
  {
    key: 'day-3',
    name: 'Bench',
    exercises: [
      { key: 'e8', name: 'Bench Press', supersetGroup: null, sets: repSets(5, 3, 3) },
      { key: 'e9', name: 'Back Squat', supersetGroup: null, sets: repSets(3, 10, 10) },
      { key: 'e10', name: 'Lat Pulldown', supersetGroup: null, sets: repSets(3, 15, 15) },
    ],
  },
]

/** The full pitch: multi-day, deload week, description, sticky CTA. */
export const Curated: Story = {
  args: {
    name: 'GZCLP · 4-Day',
    icon: null,
    description:
      'Tiered linear progression for lifters past the newbie phase — heavy triples up top, volume underneath. T1 lifts add weight when you hit all reps; the deload backs everything off.',
    mesocycleWeeks: 5,
    deloadWeek: 4,
    days: DAYS,
    unit: 'kg',
    cta: <Button className="w-full">Use this program</Button>,
  },
}

/** No description, no deload — the strip and plan carry the page alone. */
export const Minimal: Story = {
  args: {
    name: 'Push / Pull',
    icon: null,
    description: null,
    mesocycleWeeks: 1,
    deloadWeek: null,
    days: DAYS.slice(0, 2),
    unit: 'lb',
    cta: <Button className="w-full">Add to my programs</Button>,
  },
}

/** Footer slot: the wger branch's skipped ledger + attribution ride below the plan. */
export const WithFooter: Story = {
  args: {
    ...Curated.args,
    footer: (
      <section className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Couldn&rsquo;t map
        </p>
        <ul className="mt-1.5 space-y-1">
          <li className="text-sm text-muted-foreground">Weighted plank — no matching exercise</li>
        </ul>
      </section>
    ),
  },
}

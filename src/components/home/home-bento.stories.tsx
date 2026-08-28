import type { Meta, StoryObj } from '@storybook/nextjs-vite'
import { expect } from 'storybook/test'

import { applyPreset, GENERAL_PRESET_ID } from '@/lib/home/presets'
import { HomeBento, type HomeBentoItem } from './home-bento'

/**
 * The bento shell, with stub bodies.
 *
 * Every other home test asserts the ARITHMETIC — which cell the packer picks,
 * which span it emits. None of them could see the bug these stories exist for:
 * the grid tracks are a fixed height and `.home-cell` was not adopting them,
 * so a short widget left a void inside its own track and a tall one drew
 * straight over the row below it. That is only visible with real layout, so
 * these run as browser tests (vitest.config.ts `storybook` project, real
 * Chromium) rather than in jsdom.
 *
 * Bodies are stubs, and that is the point of the shell being a separate
 * module: the real sections are async RSCs that reach the database, so a
 * shell coupled to them could not be rendered in a browser at all.
 */

/** A body that fills whatever it is given — the shape most widgets take. */
function Body({ label, lines }: { label: string; lines: number }) {
  return (
    <div className="flex h-full flex-col">
      <span className="text-[0.66rem] font-medium uppercase tracking-[0.15em]">{label}</span>
      <span className="mt-auto flex flex-col">
        {Array.from({ length: lines }, (_, i) => (
          <span key={i} className="font-display text-[2rem] font-semibold leading-[0.9]">
            {12 + i}
          </span>
        ))}
      </span>
    </div>
  )
}

interface BentoProps {
  /** Body height, in lines of big type — how a widget's content is varied
   *  without giving the shell a real widget to import. */
  lines?: (kind: string) => number
  /** Renders this kind's body as NOTHING — the state a widget with no data
   *  reaches on its own, after the shell has already been handed it. */
  empty?: (kind: string) => boolean
}

/** The default home, which is the layout a brand-new account gets. */
function Bento({ lines = () => 1, empty = () => false }: BentoProps) {
  const items: HomeBentoItem[] = applyPreset(GENERAL_PRESET_ID)
    .filter((s) => !s.hidden)
    .map((s) => ({
      id: s.id,
      shape: s.shape,
      body: empty(s.kind) ? null : <Body label={s.kind} lines={lines(s.kind)} />,
    }))
  return (
    // The home container, verbatim from page.tsx — the bento's column count
    // and its max width are tuned to each other, so testing it at any other
    // width would be testing a layout that never ships.
    <div className="mx-auto w-full max-w-md px-5 md:max-w-3xl xl:max-w-6xl">
      <HomeBento items={items} />
    </div>
  )
}

/** Every cell, paired with the grid track it was placed in. */
function measured() {
  const grid = document.querySelector('.home-bento')
  expect(grid).not.toBeNull()
  return [...grid!.children].map((track) => {
    const cell = track.querySelector('.home-cell')
    expect(cell).not.toBeNull()
    return {
      label: cell!.textContent?.slice(0, 24) ?? '',
      track: track.getBoundingClientRect(),
      cell: cell!.getBoundingClientRect(),
    }
  })
}

/** Sub-pixel tolerance: track heights are rem-derived and rarely integral. */
const EPSILON = 0.5

/** The kind used as the empty one below — a `micro` in the general preset, so
 *  it has a neighbour beside it and cells after it. */
const EMPTY_KIND = 'streak'

const meta = {
  title: 'Home/Bento shell',
  component: Bento,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Bento>

export default meta
type Story = StoryObj<typeof meta>

/**
 * The grid tracks are a fixed unit, so a cell that sizes to its own content
 * ignores them: a one-line body in a two-row track left 128px of dead space
 * on the phone, and every `h-full` / `mt-auto` inside it resolved against an
 * auto height and did nothing.
 */
export const FillsItsTrack: Story = {
  play: async () => {
    const cells = measured()
    expect(cells.length).toBeGreaterThan(0)
    for (const { label, track, cell } of cells) {
      expect(
        { label, fills: Math.abs(cell.height - track.height) < EPSILON },
        `${label} is ${cell.height}px in a ${track.height}px track`,
      ).toEqual({ label, fills: true })
    }
  },
}

/**
 * WHY AN EMPTY BODY MUST NEVER REACH THE SHELL.
 *
 * The shell places what it is given, and a cell whose body renders nothing is
 * not invisible — it is a reserved hole: it keeps a full-height grid track, it
 * paints `.home-cell`'s closing hairline into it, and every later cell is
 * routed around a gap with a stray rule in it. Nothing in the shell can fix
 * that, because by the time the widget decides it has nothing to say the
 * placement has already been computed.
 *
 * So this story does not assert a bug is gone; it pins the COST that makes
 * `renderHomeSections` drop empty sections BEFORE packing. If the shell ever
 * learns to collapse an empty cell on its own, this is the test that should
 * fail and be rewritten.
 */
export const AnEmptyBodyStillCostsATrack: Story = {
  args: { empty: (kind: string) => kind === EMPTY_KIND },
  play: async () => {
    const grid = document.querySelector('.home-bento')
    expect(grid).not.toBeNull()
    const tracks = [...grid!.children]
    const emptyIndex = tracks.findIndex((t) => t.querySelector('.home-cell')?.textContent === '')
    expect(emptyIndex, `no empty cell rendered — is '${EMPTY_KIND}' still in the preset?`)
      .toBeGreaterThan(-1)

    const cell = tracks[emptyIndex].querySelector('.home-cell')!
    const box = cell.getBoundingClientRect()
    // A reserved hole, not a collapsed one: it still owns a full row.
    expect(box.height, 'an empty cell collapsed — the packer no longer pays for it').toBeGreaterThan(
      EPSILON,
    )
    // And it paints the closing hairline into that hole, which is the visible
    // artefact: a rule floating in a gap with nothing above it.
    const rule = getComputedStyle(cell).borderBottomWidth
    expect(parseFloat(rule), 'the empty cell paints no hairline').toBeGreaterThan(0)

    // Later cells are routed around it rather than filling it.
    const after = tracks
      .slice(emptyIndex + 1)
      .map((t) => t.getBoundingClientRect())
      .filter((r) => r.height > EPSILON)
    for (const next of after) {
      const fillsTheHole = next.top < box.bottom - EPSILON && next.left < box.right - EPSILON
      expect(fillsTheHole, 'a later cell reclaimed the empty track').toBe(false)
    }
  },
}

/**
 * The other half of the same bug. A body taller than its track used to grow
 * the cell instead of being clipped by it — `overflow: hidden` never fired,
 * because the box it was hiding was the one doing the growing — and the
 * overflow painted on top of the cells below.
 */
export const ClipsAnOversizedBody: Story = {
  // Six lines cannot fit a single-row track at any breakpoint.
  args: { lines: (kind: string) => (kind === 'today-recap' ? 6 : 1) },
  play: async () => {
    const cells = measured()
    for (const { label, track, cell } of cells) {
      expect(
        { label, contained: cell.height <= track.height + EPSILON },
        `${label} overflows its track by ${cell.height - track.height}px`,
      ).toEqual({ label, contained: true })
    }
    // Containment is what stops the collision, so assert the collision is
    // gone directly rather than trusting that it follows.
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i].cell
        const b = cells[j].cell
        const pair = `${cells[i].label} / ${cells[j].label}`
        const overlaps =
          a.left < b.right - EPSILON &&
          b.left < a.right - EPSILON &&
          a.top < b.bottom - EPSILON &&
          b.top < a.bottom - EPSILON
        expect({ pair, overlaps }, 'two cells are drawing over each other').toEqual({
          pair,
          overlaps: false,
        })
      }
    }
  },
}

import { Button } from './button'
import { ButtonGroup } from './button-group'

/**
 * Segmented clusters on the ButtonGroup primitive: a hairline frame on the
 * page background (never bg-card), a hairline divider between segments,
 * flush flex-1 buttons inside. Consumers: the weight stepper today; the
 * rest trio and future segmented controls in later slices (#216/#217).
 *
 * CSF-shaped module: renders under Storybook when the workbench lands; until
 * then it is the reviewable variant matrix and a compile-checked contract.
 */

const meta = {
  title: 'UI/ButtonGroup',
  component: ButtonGroup,
}

export default meta

/** Segment counts × sizes — ghost segments, the group carries the frame. */
export const Matrix = {
  render: () => (
    <div className="flex w-80 flex-col gap-4 p-6">
      {(['sm', 'default'] as const).map((size) => (
        <div key={size} className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{size}</span>
          <ButtonGroup>
            <Button size={size} variant="ghost">
              −2.5
            </Button>
            <Button size={size} variant="ghost">
              +2.5
            </Button>
          </ButtonGroup>
          <ButtonGroup>
            <Button size={size} variant="ghost">
              −15
            </Button>
            <Button size={size} variant="ghost">
              Skip
            </Button>
            <Button size={size} variant="ghost">
              +15
            </Button>
          </ButtonGroup>
        </div>
      ))}
    </div>
  ),
}

/** The weight stepper as the logger renders it: sm ghost pair, tabular
 *  numerals, hit-44-y vertical touch insets riding outside the 36px
 *  controls (vertical-only so the segments' invisible extensions never
 *  cross the divider into the opposite action). */
export const Stepper = {
  render: () => (
    <div className="w-64 p-6">
      <ButtonGroup>
        <Button size="sm" variant="ghost" className="hit-44-y font-semibold tnum">
          −5
        </Button>
        <Button size="sm" variant="ghost" className="hit-44-y font-semibold tnum">
          +5
        </Button>
      </ButtonGroup>
    </div>
  ),
}

/** Disabled segments keep the frame; only the segment dims. */
export const DisabledSegment = {
  render: () => (
    <div className="w-64 p-6">
      <ButtonGroup>
        <Button size="sm" variant="ghost" disabled>
          −5
        </Button>
        <Button size="sm" variant="ghost">
          +5
        </Button>
      </ButtonGroup>
    </div>
  ),
}

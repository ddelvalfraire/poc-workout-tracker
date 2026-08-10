'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronUp, Lock } from 'lucide-react'
import { setHomeLayoutAction } from '@/app/actions'
import {
  HOME_SECTION_REGISTRY,
  HOME_SECTION_SIZES,
  type HomeSectionSize,
} from '@/lib/home/registry'
import {
  moveSection,
  toggleSection,
  setSectionSize,
  toLayoutDoc,
  resolveHomeLayout,
  type ResolvedHomeSection,
} from '@/lib/home/layout'
import { cn } from '@/lib/utils'

/**
 * The single-list home layout editor. The locked Status row leads (lock icon,
 * non-interactive) to teach that the hero is not customizable; each optional
 * row reorders with up/down chevron BUTTONS (no drag, no library — natively
 * focusable, so keyboard/switch-access/voice all work; single-pointer taps
 * satisfy WCAG 2.5.7) and toggles with the settings switch vocabulary
 * (role="switch", the RestTimerToggle pattern). A hidden row stays in place,
 * dimmed — hiding is not removing.
 *
 * Every interaction persists the FULL layout document immediately,
 * optimistically: state flips first, the action writes, failure rolls back to
 * the pre-interaction snapshot. Reset stores NULL — the read path's
 * degrade-to-default IS the reset.
 */
export function HomeLayoutEditor({
  initialSections,
}: {
  initialSections: ResolvedHomeSection[]
}) {
  const [sections, setSections] = useState<readonly ResolvedHomeSection[]>(initialSections)
  const [hasError, setHasError] = useState(false)
  const [, startTransition] = useTransition()
  const router = useRouter()
  // Monotonic write counter: only the LATEST write may roll state back or
  // refresh, so a slow earlier failure can't clobber a newer success.
  const writeSeq = useRef(0)

  function persist(next: readonly ResolvedHomeSection[], reset = false) {
    const prev = sections
    const seq = ++writeSeq.current
    setSections(next)
    setHasError(false)
    startTransition(async () => {
      try {
        await setHomeLayoutAction(reset ? null : toLayoutDoc(next))
        if (seq === writeSeq.current) router.refresh()
      } catch {
        if (seq === writeSeq.current) {
          setSections(prev) // roll back; the list shows the stored truth
          setHasError(true)
        }
      }
    })
  }

  function onMove(kind: string, direction: 'up' | 'down') {
    const next = moveSection(sections, kind, direction)
    if (next !== sections) persist(next)
  }

  function onToggle(kind: string) {
    const next = toggleSection(sections, kind)
    if (next !== sections) persist(next)
  }

  function onSize(kind: string, size: HomeSectionSize) {
    const next = setSectionSize(sections, kind, size)
    if (next !== sections) persist(next)
  }

  function onReset() {
    persist(resolveHomeLayout(null), true)
  }

  return (
    <>
      <ul className="mt-6 divide-y divide-border/60 border-b border-b-border/60">
        {/* The locked row: Status always renders, always first. Present but
            non-interactive — its stillness next to live rows teaches the
            model faster than any explanation. */}
        <li
          className="flex items-center gap-4 py-4"
          aria-label="Status — always shown, always first"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">Status</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Your state and next step &mdash; always first.
            </p>
          </div>
          <Lock aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        </li>

        {sections.map((section, index) => {
          const meta = HOME_SECTION_REGISTRY.find((s) => s.kind === section.kind)
          if (!meta) return null // unknown kind (future client): not editable here
          return (
            <li key={section.kind} className="flex items-center gap-3 py-4">
              {/* Reorder chevrons lead — the row's primary spatial verb. */}
              <div className="flex shrink-0 flex-col">
                <ReorderButton
                  label={`Move ${meta.title} up`}
                  disabled={index === 0}
                  onClick={() => onMove(section.kind, 'up')}
                >
                  <ChevronUp aria-hidden="true" className="size-4" />
                </ReorderButton>
                <ReorderButton
                  label={`Move ${meta.title} down`}
                  disabled={index === sections.length - 1}
                  onClick={() => onMove(section.kind, 'down')}
                >
                  <ChevronDown aria-hidden="true" className="size-4" />
                </ReorderButton>
              </div>
              <div
                className={cn(
                  'min-w-0 flex-1 transition-opacity',
                  section.hidden && 'opacity-40',
                )}
              >
                <p className="font-medium">{meta.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{meta.description}</p>
                <SizeControl
                  title={meta.title}
                  allowedSizes={meta.allowedSizes}
                  value={section.size}
                  disabled={section.hidden}
                  onSelect={(size) => onSize(section.kind, size)}
                />
              </div>
              <VisibilitySwitch
                label={`Show ${meta.title} on Home`}
                checked={!section.hidden}
                onToggle={() => onToggle(section.kind)}
              />
            </li>
          )
        })}
      </ul>

      <p className="mt-3 text-sm text-muted-foreground">
        Hidden sections keep tracking &mdash; they just don&rsquo;t show on Home.
      </p>
      {hasError && (
        <p className="mt-2 text-sm text-destructive" role="status">
          Couldn&rsquo;t save. Try again.
        </p>
      )}

      <button
        type="button"
        onClick={onReset}
        className="mt-8 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Reset to default
      </button>
    </>
  )
}

const SIZE_LABELS: Record<HomeSectionSize, string> = { sm: 'S', md: 'M', lg: 'L' }
const SIZE_NAMES: Record<HomeSectionSize, string> = { sm: 'Small', md: 'Medium', lg: 'Large' }

/** S/M/L segmented size picker — the goal-kind picker's radio vocabulary,
 *  compact. Sizes outside the section's allowedSizes stay visible but
 *  disabled (the row keeps its shape); a hidden row dims the whole control. */
function SizeControl({
  title,
  allowedSizes,
  value,
  disabled,
  onSelect,
}: {
  title: string
  allowedSizes: readonly HomeSectionSize[]
  value: HomeSectionSize
  disabled: boolean
  onSelect: (size: HomeSectionSize) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label={`${title} size`}
      className={cn('mt-2 flex gap-1.5 transition-opacity', disabled && 'opacity-40')}
    >
      {HOME_SECTION_SIZES.map((size) => {
        const isAllowed = allowedSizes.includes(size)
        return (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={value === size}
            aria-label={`${SIZE_NAMES[size]} ${title}`}
            disabled={disabled || !isAllowed}
            onClick={() => onSelect(size)}
            className={cn(
              'w-9 rounded-lg border py-1 text-xs font-semibold uppercase tracking-wide transition-colors',
              'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              value === size
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground',
              !isAllowed && 'opacity-30',
            )}
          >
            {SIZE_LABELS[size]}
          </button>
        )
      })}
    </div>
  )
}

/** One chevron: a real button (focusable, disabled at the edges) with a
 *  44px-ish effective target via the invisible inset. */
function ReorderButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative rounded-md p-1 text-muted-foreground transition-colors before:absolute before:-inset-x-2 before:-inset-y-0.5',
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        disabled ? 'opacity-30' : 'hover:bg-muted/50 hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/** The settings switch vocabulary (RestTimerToggle's track/thumb, verbatim)
 *  as a controlled presentational switch. */
function VisibilitySwitch({
  label,
  checked,
  onToggle,
}: {
  label: string
  checked: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onToggle}
      // 44px effective target via the invisible inset on a compact track.
      className={cn(
        'relative h-7 w-12 shrink-0 rounded-full border transition-colors before:absolute before:-inset-2',
        'outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        checked ? 'border-primary bg-primary' : 'border-border bg-muted',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0.5 left-0.5 size-[22px] rounded-full transition-transform',
          checked ? 'translate-x-5 bg-primary-foreground' : 'translate-x-0 bg-muted-foreground',
        )}
      />
    </button>
  )
}

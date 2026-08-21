'use client'

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { thumbHashToPlaceholderUrl } from '@/lib/photo-pipeline'
import { photoPoseLabel } from '@/lib/photo-input'
import { cn } from '@/lib/utils'
import type { PhotoEntry } from './photo-cell'
import { useTranslations } from 'next-intl'
import { renderMessage } from '@/lib/message'

const SLIDER_STEP_PERCENT = 5

/** The alt text for one rendition — three call sites, one message.
 *  Typed to its OWN namespace: an unparameterised
 *  ReturnType<typeof useTranslations> asks TypeScript to instantiate every
 *  namespace in the catalog, which exceeds the depth limit now that the
 *  catalog is app-wide. */
function altFor(
  t: ReturnType<typeof useTranslations<'PhotoCompare'>>,
  tBody: ReturnType<typeof useTranslations<'Body'>>,
  entry: PhotoEntry,
): string {
  return t('alt', {
    date: entry.dateLabel,
    pose: entry.pose === null ? 'none' : renderMessage(tBody, photoPoseLabel(entry.pose)),
  })
}

/** The two compare modes, as VALUES. Their words live in the catalog. */
const COMPARE_MODES = ['slider', 'side'] as const

/**
 * Compare — the retention moment: date A vs date B at display quality, in
 * two modes. Slider (default): both photos stacked, the earlier one clipped
 * with clip-path and revealed by dragging the divider — the change under a
 * thumb. Side by side: the classic two-pane. Pure presentation; selection
 * lives in PhotosSection. clip-path + transform only (compositor-friendly);
 * each layer paints its ThumbHash instantly while the signed display
 * rendition loads.
 */
export function PhotoCompare({ left, right }: { left: PhotoEntry; right: PhotoEntry }) {
  const t = useTranslations('PhotoCompare')
  const [mode, setMode] = useState<'slider' | 'side'>('slider')

  return (
    <div className="motion-safe:animate-rise-in">
      <div role="radiogroup" aria-label={t('modeGroupLabel')} className="flex gap-1.5">
        {/* Values only — a label built here would be fixed at module scope
            for the whole session; the words come from the catalog at render. */}
        {COMPARE_MODES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            onClick={() => setMode(option)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              mode === option
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground',
            )}
          >
            {t(`mode.${option}`)}
          </button>
        ))}
      </div>

      <div className="mt-2">
        {mode === 'side' ? (
          <div
            role="group"
            aria-label={t('sideGroupLabel', { left: left.dateLabel, right: right.dateLabel })}
            className="grid grid-cols-2 gap-1.5"
          >
            <ComparePane entry={left} />
            <ComparePane entry={right} />
          </div>
        ) : (
          <OverlaySlider left={left} right={right} />
        )}
      </div>
    </div>
  )
}

/**
 * The slider: `right` (the later photo) is the base layer; `left` (the
 * earlier) sits on top clipped to the divider — dragging right reveals more
 * of the before. The divider is a real slider (role, arrow keys); pointer
 * capture keeps a drag alive off the handle.
 */
function OverlaySlider({ left, right }: { left: PhotoEntry; right: PhotoEntry }) {
  const t = useTranslations('PhotoCompare')
  const tBody = useTranslations('Body')
  const [percent, setPercent] = useState(50)
  const frameRef = useRef<HTMLDivElement>(null)
  const isDraggingRef = useRef(false)

  function percentFromPointer(e: ReactPointerEvent): number {
    const frame = frameRef.current
    if (frame === null) return percent
    const rect = frame.getBoundingClientRect()
    if (rect.width === 0) return percent
    return Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100))
  }

  function handlePointerDown(e: ReactPointerEvent) {
    isDraggingRef.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    setPercent(percentFromPointer(e))
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (!isDraggingRef.current) return
    setPercent(percentFromPointer(e))
  }

  function handlePointerUp() {
    isDraggingRef.current = false
  }

  return (
    <figure className="m-0">
      <div
        ref={frameRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="relative aspect-[3/4] touch-none select-none overflow-hidden rounded-xl bg-muted"
      >
        <SliderImage entry={right} />
        {/* The earlier photo, clipped at the divider — clip-path only. */}
        <div
          aria-hidden="true"
          className="absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
        >
          <SliderImage entry={left} />
        </div>
        {/* Divider + handle: the one focusable control. */}
        <div
          role="slider"
          tabIndex={0}
          aria-label={t('sliderLabel')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
              e.preventDefault()
              setPercent((p) => Math.max(0, p - SLIDER_STEP_PERCENT))
            } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
              e.preventDefault()
              setPercent((p) => Math.min(100, p + SLIDER_STEP_PERCENT))
            }
          }}
          className="group absolute inset-y-0 -ml-3 w-6 cursor-ew-resize focus-visible:outline-none"
          style={{ left: `${percent}%` }}
        >
          <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white/90 shadow-[0_0_4px_rgba(0,0,0,0.5)]" />
          {/* The focus ring rides the GRIP, not the strip: the strip is a
              full-height 24px slice over the photos, so a ring on it would
              outline the whole image edge. On the grip the volt hugs a 20px
              circle that already carries a white border, so it reads over
              any photo underneath. */}
          <span
            data-slot="compare-grip"
            className="absolute left-1/2 top-1/2 size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40 shadow-[0_0_4px_rgba(0,0,0,0.5)] group-focus-visible:ring-3 group-focus-visible:ring-ring/50"
          />
        </div>
        {/* Corner date tags — which side is which, always visible. */}
        <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
          {left.dateLabel}
        </span>
        <span className="absolute right-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white">
          {right.dateLabel}
        </span>
      </div>
      <figcaption className="mt-1 text-center text-xs font-medium text-muted-foreground">
        {t('captionPair', { left: left.dateLabel, right: right.dateLabel })}
        {left.pose && left.pose === right.pose && (
          <span className="opacity-75">{t('poseSuffix', { pose: renderMessage(tBody, photoPoseLabel(left.pose)) })}</span>
        )}
      </figcaption>
    </figure>
  )
}

function SliderImage({ entry }: { entry: PhotoEntry }) {
  const t = useTranslations('PhotoCompare')
  const tBody = useTranslations('Body')
  const placeholder = useMemo(() => thumbHashToPlaceholderUrl(entry.thumbHash), [entry.thumbHash])
  const imageUrl = entry.displayUrl ?? entry.thumbUrl
  return (
    <div
      className="absolute inset-0"
      style={
        placeholder
          ? { backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' }
          : undefined
      }
    >
      {imageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- signed expiring URL; the optimizer would cache-bust every render
        <img
          src={imageUrl}
          alt={altFor(t, tBody, entry)}
          width={540}
          height={720}
          draggable={false}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  )
}

function ComparePane({ entry }: { entry: PhotoEntry }) {
  const t = useTranslations('PhotoCompare')
  const tBody = useTranslations('Body')
  const placeholder = useMemo(() => thumbHashToPlaceholderUrl(entry.thumbHash), [entry.thumbHash])
  const imageUrl = entry.displayUrl ?? entry.thumbUrl

  return (
    <figure className="m-0">
      <div
        className="relative aspect-[3/4] overflow-hidden rounded-xl bg-muted"
        style={
          placeholder
            ? { backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' }
            : undefined
        }
      >
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed expiring URL; the optimizer would cache-bust every render
          <img
            src={imageUrl}
            alt={altFor(t, tBody, entry)}
            width={540}
            height={720}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <figcaption className="mt-1 text-center text-xs font-medium text-muted-foreground">
        {entry.dateLabel}
        {entry.pose && (
          <span className="opacity-75">{t('poseSuffix', { pose: renderMessage(tBody, photoPoseLabel(entry.pose)) })}</span>
        )}
      </figcaption>
    </figure>
  )
}

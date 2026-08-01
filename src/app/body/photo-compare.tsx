'use client'

import { useMemo } from 'react'
import { thumbHashToPlaceholderUrl } from '@/lib/photo-pipeline'
import { photoPoseLabel } from '@/lib/photo-input'
import type { PhotoEntry } from './photo-cell'

/**
 * Side-by-side compare — the retention moment: date A vs date B at display
 * quality. Pure presentation; selection lives in PhotosSection. Each pane
 * paints its ThumbHash instantly while the signed display rendition loads.
 */
export function PhotoCompare({ left, right }: { left: PhotoEntry; right: PhotoEntry }) {
  return (
    <div
      role="group"
      aria-label={`Comparing ${left.dateLabel} with ${right.dateLabel}`}
      className="grid grid-cols-2 gap-1.5 motion-safe:animate-rise-in"
    >
      <ComparePane entry={left} />
      <ComparePane entry={right} />
    </div>
  )
}

function ComparePane({ entry }: { entry: PhotoEntry }) {
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
            alt={`Progress photo, ${entry.dateLabel}${entry.pose ? `, ${photoPoseLabel(entry.pose)}` : ''}`}
            width={540}
            height={720}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
      </div>
      <figcaption className="mt-1 text-center text-xs font-medium text-muted-foreground">
        {entry.dateLabel}
        {entry.pose && <span className="opacity-75"> · {photoPoseLabel(entry.pose)}</span>}
      </figcaption>
    </figure>
  )
}

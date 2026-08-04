'use client'

import { useMemo } from 'react'
import { thumbHashToPlaceholderUrl } from '@/lib/photo-pipeline'
import { photoPoseLabel, type PhotoPose } from '@/lib/photo-input'
import { cn } from '@/lib/utils'

/** One photo crossing the island boundary — dates pre-formatted server-side,
 *  URLs pre-signed at render (null when signing failed → placeholder only). */
export interface PhotoEntry {
  id: string
  dateLabel: string
  /** Raw instant (epoch ms) — powers the cadence nudge + default compare pair. */
  takenAtMs: number
  pose: PhotoPose | null
  note: string | null
  /** Base64 ThumbHash off the row — decodes to an instant placeholder. */
  thumbHash: string
  thumbUrl: string | null
  displayUrl: string | null
}

interface PhotoCellProps {
  entry: PhotoEntry
  onSelect: (id: string) => void
  /** Compare mode: taps toggle selection instead of opening the detail view. */
  isSelected: boolean
  isCompareMode: boolean
}

/**
 * One timeline-grid cell. The ThumbHash placeholder paints instantly from the
 * row data alone (decoded client-side, zero network); the signed thumb
 * lazy-loads over it (plain <img>, not next/image — the URL is signed and
 * expiring, so the optimizer cache would be useless churn). The container
 * owns the aspect ratio, so the image arriving never shifts layout.
 */
export function PhotoCell({ entry, onSelect, isSelected, isCompareMode }: PhotoCellProps) {
  const placeholder = useMemo(() => thumbHashToPlaceholderUrl(entry.thumbHash), [entry.thumbHash])

  return (
    <button
      type="button"
      onClick={() => onSelect(entry.id)}
      aria-label={
        isCompareMode
          ? `${isSelected ? 'Deselect' : 'Select'} photo from ${entry.dateLabel}`
          : `View photo from ${entry.dateLabel}`
      }
      aria-pressed={isCompareMode ? isSelected : undefined}
      className={cn(
        'relative aspect-[3/4] overflow-hidden rounded-xl bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 motion-safe:animate-rise-in',
        isCompareMode && isSelected && 'ring-3 ring-primary',
      )}
      style={
        placeholder
          ? { backgroundImage: `url(${placeholder})`, backgroundSize: 'cover' }
          : undefined
      }
    >
      {entry.thumbUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- signed expiring URL; the optimizer would cache-bust every render
        <img
          src={entry.thumbUrl}
          alt={`Progress photo, ${entry.dateLabel}${entry.pose ? `, ${photoPoseLabel(entry.pose)}` : ''}`}
          loading="lazy"
          width={320}
          height={427}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4 text-left text-[10px] font-medium leading-tight text-white">
        {entry.dateLabel}
        {entry.pose && <span className="opacity-75"> · {photoPoseLabel(entry.pose)}</span>}
      </span>
    </button>
  )
}

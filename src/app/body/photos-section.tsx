'use client'

import { useRef, useState, type ChangeEvent } from 'react'
import { useMounted } from '@/lib/use-mounted'
import { useRouter } from 'next/navigation'
import { Camera, Columns2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { preparePhoto } from '@/lib/body/photo-pipeline'
import {
  PHOTO_NOTE_MAX_LENGTH,
  PHOTO_POSES,
  photoPoseLabel,
  type PhotoPose,
} from '@/lib/body/photo-input'
import { cn } from '@/lib/utils'
import { PhotoCell, type PhotoEntry } from './photo-cell'
import { PhotoOverlay } from './photo-overlay'
import { PhotoCompare } from './photo-compare'
import { defaultComparePair } from './compare-pair'
import { useTranslations } from 'next-intl'
import { renderMessage } from '@/lib/message'

// A month without a photo → the quiet cadence nudge by Add photo.
const CADENCE_NUDGE_DAYS = 30
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The photos third of /body: upload (pose + note optional), the 3-up timeline
 * grid, the detail overlay, and compare mode. Entering compare PRE-SELECTS
 * the earliest-vs-latest pair of the same pose (compare-pair.ts) — the
 * one-tap change story — and taps still repick freely. Derivatives +
 * ThumbHash are computed here in the browser (photo-pipeline); the server
 * stores them verbatim. The file input carries no `capture` attribute on
 * purpose — progress photos are usually mirror selfies, so the OS chooser
 * (camera OR library) beats forcing the rear camera.
 */
export function PhotosSection({ entries }: { entries: PhotoEntry[] }) {
  const t = useTranslations('PhotosSection')
  const tBody = useTranslations('Body')
  const [pose, setPose] = useState<PhotoPose | null>(null)
  const [note, setNote] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [isCompareMode, setIsCompareMode] = useState(false)
  const [compareIds, setCompareIds] = useState<string[]>([])
  // Mounted gate for the cadence nudge — "now" is the client's, not the SSR's.
  // Read at render, not stamped into state by an effect: a clock read is not
  // state to own, and owning it cost a second render on every mount.
  const mounted = useMounted()
  // `new Date()` rather than `Date.now()`: NOT more pure — both read the wall
  // clock. The compiler's typed-globals table marks `Date.now` impure and has
  // no shape for the `Date` constructor, so only the former is flagged. What
  // actually makes this safe is the mounted gate above; `new Date()` is just
  // the unflagged spelling, and the one status-hero.tsx already uses.
  const nowMs = mounted ? new Date().getTime() : null
  const fileInputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  const openEntry = entries.find((e) => e.id === openId) ?? null
  const compareEntries = compareIds
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is PhotoEntry => e !== undefined)

  const newestMs = entries.length > 0 ? Math.max(...entries.map((e) => e.takenAtMs)) : null
  const isStale =
    nowMs !== null && newestMs !== null && nowMs - newestMs > CADENCE_NUDGE_DAYS * MS_PER_DAY

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // re-picking the same file must fire change again
    if (!file) return
    setIsUploading(true)
    setError(null)
    try {
      const prepared = await preparePhoto(file)
      const form = new FormData()
      form.set('display', prepared.display)
      form.set('thumb', prepared.thumb)
      form.set('thumbHash', prepared.thumbHash)
      if (pose !== null) form.set('pose', pose)
      const trimmedNote = note.trim()
      if (trimmedNote !== '') form.set('note', trimmedNote)
      const res = await fetch('/api/photos', { method: 'POST', body: form })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(body?.error ?? t('uploadFailed'))
      }
      setNote('')
      setPose(null)
      router.refresh()
    } catch (err: unknown) {
      // Pipeline and route errors are written for users — surface verbatim.
      setError(err instanceof Error ? err.message : t('uploadError'))
    } finally {
      setIsUploading(false)
    }
  }

  function handleCellSelect(id: string) {
    if (!isCompareMode) {
      setOpenId(id)
      return
    }
    setCompareIds((current) =>
      current.includes(id)
        ? current.filter((c) => c !== id)
        : // Third pick replaces the older selection — compare is always a pair.
          [...current, id].slice(-2),
    )
  }

  function toggleCompare() {
    if (isCompareMode) {
      setIsCompareMode(false)
      setCompareIds([])
      return
    }
    // One tap in: the default same-pose earliest-vs-latest pair, when one
    // exists — otherwise compare opens empty for manual picking.
    const pair = defaultComparePair(entries)
    setCompareIds(pair === null ? [] : [pair[0].id, pair[1].id])
    setIsCompareMode(true)
  }

  return (
    <div>
      {/* Upload controls: optional pose pills + note, then THE action. */}
      <div
        role="radiogroup"
        aria-label={t('poseGroupLabel')}
        className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1"
      >
        {PHOTO_POSES.map((p) => (
          <button
            key={p}
            type="button"
            role="radio"
            aria-checked={pose === p}
            onClick={() => setPose((current) => (current === p ? null : p))}
            className={cn(
              'shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-3 focus-visible:ring-ring/50',
              pose === p
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground hover:text-foreground',
            )}
          >
            {renderMessage(tBody, photoPoseLabel(p))}
          </button>
        ))}
      </div>

      <div className="mt-3 flex gap-2">
        <Input
          type="text"
          value={note}
          maxLength={PHOTO_NOTE_MAX_LENGTH}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          aria-label={t('noteAriaLabel')}
          autoComplete="off"
        />
        <Button
          type="button"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0"
        >
          <Camera aria-hidden="true" className="size-4" />
          {isUploading ? t('pendingAction') : t('action')}
        </Button>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
      />
      {error && (
        <p role="alert" className="mt-1.5 text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {isStale && !error && (
        // The quiet cadence nudge — a fact, not a guilt trip.
        <p className="mt-1.5 text-xs text-muted-foreground">
          {t('cadenceNudge')}
        </p>
      )}

      {entries.length >= 2 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            type="button"
            variant={isCompareMode ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={isCompareMode}
            onClick={toggleCompare}
          >
            <Columns2 aria-hidden="true" className="size-4" />
            {isCompareMode ? t('compareDone') : t('compareAction')}
          </Button>
          {isCompareMode && compareEntries.length < 2 && (
            <p className="text-sm text-muted-foreground">
              {t('comparePick', { remaining: 2 - compareEntries.length })}
            </p>
          )}
        </div>
      )}

      {isCompareMode && compareEntries.length === 2 && (
        <div className="mt-4">
          <PhotoCompare left={compareEntries[0]} right={compareEntries[1]} />
        </div>
      )}

      {entries.length > 0 ? (
        <div role="list" aria-label={t('timelineGroupLabel')} className="mt-4 grid grid-cols-3 gap-1.5">
          {entries.map((entry) => (
            <PhotoCell
              key={entry.id}
              entry={entry}
              onSelect={handleCellSelect}
              isCompareMode={isCompareMode}
              isSelected={compareIds.includes(entry.id)}
            />
          ))}
        </div>
      ) : (
        // Honest empty state — the privacy promise is the pitch.
        <p className="mt-4 text-sm text-muted-foreground">
          {t('empty')}
        </p>
      )}

      {openEntry && !isCompareMode && (
        <PhotoOverlay entry={openEntry} onClose={() => setOpenId(null)} />
      )}
    </div>
  )
}

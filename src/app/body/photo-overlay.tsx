'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { thumbHashToPlaceholderUrl } from '@/lib/photo-pipeline'
import { photoPoseLabel } from '@/lib/photo-input'
import type { PhotoEntry } from './photo-cell'

interface PhotoOverlayProps {
  entry: PhotoEntry
  onClose: () => void
}

/**
 * Detail view for one photo: the display-size rendition (signed URL) over its
 * ThumbHash placeholder, meta (date/pose/note), and delete. Native <dialog> +
 * showModal(), the app's one dialog vocabulary (see ConfirmDialog's rationale)
 * — the confirm itself nests in the top layer above this dialog. Delete goes
 * through DELETE /api/photos/[id] (row + both blobs), then router.refresh()
 * so the server-rendered grid drops the cell.
 */
export function PhotoOverlay({ entry, onClose }: PhotoOverlayProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeConfirmRef = useRef<(() => void) | null>(null)
  const router = useRouter()

  const placeholder = useMemo(() => thumbHashToPlaceholderUrl(entry.thumbHash), [entry.thumbHash])
  // Display rendition preferred; degrade to the thumb, then placeholder-only.
  const imageUrl = entry.displayUrl ?? entry.thumbUrl

  useEffect(() => {
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => dialog?.close()
  }, [])

  async function handleDelete() {
    setIsPending(true)
    try {
      setError(null)
      const res = await fetch(`/api/photos/${entry.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`delete failed (${res.status})`)
      // Release the top layer before the refresh unmounts this tree — the
      // stranded-::backdrop race from ConfirmDialog's contract.
      closeConfirmRef.current?.()
      setIsConfirmOpen(false)
      onClose()
      router.refresh()
    } catch {
      setError('Could not delete this photo. Please try again.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      aria-label={`Photo from ${entry.dateLabel}`}
      className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-border bg-card p-0 text-foreground backdrop:bg-black/60 motion-safe:animate-rise-in"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden rounded-t-2xl bg-muted">
        {placeholder && (
          // eslint-disable-next-line @next/next/no-img-element -- tiny data-URL blur, no optimizer value
          <img
            src={placeholder}
            alt=""
            aria-hidden="true"
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        {imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- signed expiring URL; the optimizer would cache-bust every render
          <img
            src={imageUrl}
            alt={`Progress photo, ${entry.dateLabel}${entry.pose ? `, ${photoPoseLabel(entry.pose)}` : ''}`}
            width={810}
            height={1080}
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-2 rounded-full bg-black/50 p-1.5 text-white focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="flex items-start justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {entry.dateLabel}
            {entry.pose && (
              <span className="text-muted-foreground"> · {photoPoseLabel(entry.pose)}</span>
            )}
          </p>
          {entry.note && (
            <p className="mt-1 break-words text-sm text-muted-foreground">{entry.note}</p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            setError(null) // a stale failure must not reopen with the dialog
            setIsConfirmOpen(true)
          }}
          aria-label={`Delete photo from ${entry.dateLabel}`}
          className="shrink-0 text-muted-foreground hover:text-destructive focus-visible:text-destructive"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </Button>
      </div>

      {isConfirmOpen && (
        <ConfirmDialog
          title="Delete this photo?"
          body="It's removed from your account permanently — there's no undo."
          confirmLabel="Delete"
          pendingLabel="Deleting…"
          error={error}
          isPending={isPending}
          onConfirm={handleDelete}
          onClose={() => setIsConfirmOpen(false)}
          closeRef={closeConfirmRef}
        />
      )}
    </dialog>
  )
}

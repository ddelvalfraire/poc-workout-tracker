'use client'

import { useEffect, useRef, useState } from 'react'
import { Share } from 'lucide-react'
import { cardFileName, pickShareStrategy } from '@/lib/share-card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const HINT_DISMISS_MS = 4000

interface ShareCardButtonProps {
  /** Same-origin authed card route, e.g. /api/cards/trophy/club_squat_315.
   *  The Clerk session cookie rides the fetch — the PNG never has a public URL. */
  cardUrl: string
  /** Share-sheet title; also seeds the fallback download filename. */
  shareTitle: string
  size?: 'icon-xs' | 'icon-sm'
  className?: string
}

/**
 * Fetches the rendered share-card PNG and hands the FILE to the OS share
 * sheet (`navigator.share({ files })` — the iOS PWA path). Where file sharing
 * isn't available, falls back to downloading the image plus a toast-style
 * hint. The share verb ships the pixels, never a link — the privacy design.
 */
export function ShareCardButton({
  cardUrl,
  shareTitle,
  size = 'icon-sm',
  className,
}: ShareCardButtonProps) {
  const [busy, setBusy] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hintTimer.current !== null) clearTimeout(hintTimer.current)
    }
  }, [])

  function showHint(text: string): void {
    if (hintTimer.current !== null) clearTimeout(hintTimer.current)
    setHint(text)
    hintTimer.current = setTimeout(() => setHint(null), HINT_DISMISS_MS)
  }

  async function handleShare(): Promise<void> {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(cardUrl)
      if (!res.ok) throw new Error(`Card fetch failed (${res.status})`)
      const blob = await res.blob()
      const file = new File([blob], cardFileName(shareTitle), {
        type: blob.type !== '' ? blob.type : 'image/png',
      })
      if (pickShareStrategy(navigator, file) === 'share') {
        try {
          await navigator.share({ files: [file], title: shareTitle })
        } catch (error: unknown) {
          // Closing the sheet without picking a target is not a failure.
          if (!(error instanceof DOMException && error.name === 'AbortError')) throw error
        }
      } else {
        const objectUrl = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = objectUrl
        anchor.download = file.name
        anchor.click()
        // Revoke after the download has had time to start.
        setTimeout(() => URL.revokeObjectURL(objectUrl), HINT_DISMISS_MS)
        showHint('Image saved — post it anywhere')
      }
    } catch {
      showHint("Couldn't create the share image")
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleShare}
        disabled={busy}
        aria-label={`Share ${shareTitle}`}
        className={cn(
          buttonVariants({ variant: 'ghost', size }),
          'text-muted-foreground',
          className,
        )}
      >
        <Share aria-hidden="true" />
      </button>
      {hint !== null && (
        <div
          role="status"
          className="fixed inset-x-0 bottom-6 z-50 mx-auto w-fit max-w-[90vw] rounded-full border border-border bg-card px-4 py-2 text-sm shadow-lg"
        >
          {hint}
        </div>
      )}
    </>
  )
}

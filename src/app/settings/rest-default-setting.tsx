'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RestSheet } from '@/app/workout/new/rest-sheet'

/**
 * Settings row control for the default rest target: shows the current value
 * and opens the same RestSheet the logger uses — one editing surface for one
 * preference, whether reached mid-session or from here. onSaved refreshes so
 * the server-rendered readout picks the change up.
 */
export function RestDefaultSetting({ defaultRestSec }: { defaultRestSec: number | null }) {
  const [isOpen, setIsOpen] = useState(false)
  // Local echo so the row updates before the refresh round-trip lands.
  const [current, setCurrent] = useState<number | null>(defaultRestSec)
  const router = useRouter()

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsOpen(true)}
        aria-label={`Default rest target: ${current === null ? 'off' : `${current} seconds`}`}
      >
        <span aria-hidden="true" className="tnum">
          {current === null ? 'Off' : `${current}s`}
        </span>
      </Button>
      {isOpen && (
        <RestSheet
          currentSec={current}
          onClose={() => setIsOpen(false)}
          onSaved={(sec) => {
            setCurrent(sec)
            router.refresh()
          }}
        />
      )}
    </>
  )
}

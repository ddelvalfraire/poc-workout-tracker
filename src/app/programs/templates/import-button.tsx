'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { importWgerTemplateAction } from './actions'
import { useTranslations } from 'next-intl'

/**
 * "Add to my programs" — imports one wger template as the user's own draft
 * and navigates to its program page (article header + edit/activate live
 * there; the template detail page is a read-only preview). Await-then-navigate,
 * not
 * startTransition: navigating inside an async transition lets the app-wide
 * <ViewTransition> strand the old screen's snapshot (restart-program-button's
 * rationale). isPending stays true on success — navigation unmounts this card.
 */
export function ImportTemplateButton({ templateId }: { templateId: number }) {
  const t = useTranslations('ImportTemplateButton')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleImport() {
    setIsPending(true)
    setError(null)
    try {
      const { id } = await importWgerTemplateAction(templateId)
      router.push(`/programs/${id}`)
    } catch {
      setIsPending(false)
      setError(t('importError'))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button size="sm" disabled={isPending} onClick={handleImport}>
        {isPending ? t('pending') : t('importAction')}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

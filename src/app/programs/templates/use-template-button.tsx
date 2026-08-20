'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { adoptTemplateAction } from './actions'
import { useTranslations } from 'next-intl'

/**
 * "Use this program" — the template detail page's one volt CTA: adopts a
 * curated system template as the user's own DRAFT copy and navigates to its
 * program page (edit/activate live there). Await-then-navigate, not
 * startTransition, and isPending stays true on success — the
 * ImportTemplateButton rationale, verbatim.
 */
export function UseTemplateButton({ templateId }: { templateId: string }) {
  const t = useTranslations('UseTemplateButton')
  const [isPending, setIsPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  async function handleAdopt() {
    setIsPending(true)
    setError(null)
    try {
      const { id } = await adoptTemplateAction(templateId)
      router.push(`/programs/${id}`)
    } catch {
      setIsPending(false)
      setError(t('adoptError'))
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button className="w-full" disabled={isPending} onClick={handleAdopt}>
        {isPending ? t('pending') : t('adoptAction')}
      </Button>
      {error !== null && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

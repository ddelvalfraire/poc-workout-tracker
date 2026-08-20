import { Trophy } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'

/**
 * The one PR marker: a solid volt pill with the trophy glyph. Logger captions,
 * collapsed cards, and the workout summary all render this exact chip so the
 * record moment never drifts into competing treatments per surface.
 */
export function PrBadge({ label, className }: { label?: string; className?: string }) {
  const t = useTranslations('PrBadge')
  return (
    <span
      aria-label={t('ariaLabel')}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary-foreground',
        className,
      )}
    >
      <Trophy aria-hidden="true" className="size-3" />
      {label ?? t('label')}
    </span>
  )
}

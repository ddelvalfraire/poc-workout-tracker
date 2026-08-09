import { cn } from '@/lib/utils'

interface EmptyWordsProps {
  className?: string
  children: React.ReactNode
}

/**
 * An empty state as plain words: a centered muted paragraph, no shell, no
 * illustration. Class recipe verbatim from the shipped empty states on the
 * exercise stats page.
 */
function EmptyWords({ className, children }: EmptyWordsProps) {
  return (
    <p className={cn('px-1 py-6 text-center text-sm text-muted-foreground', className)}>
      {children}
    </p>
  )
}

export { EmptyWords }

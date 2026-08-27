import { cn } from '@/lib/utils'

interface SectionProps {
  /** Condensed-caps group header. Omit for a headerless section. */
  title?: string
  /** Anchor id, for an in-page link that targets this section's heading. */
  id?: string
  className?: string
  children: React.ReactNode
}

/**
 * A de-carded page section: the settings-zone shape. A condensed-caps group
 * header sits over the section's content — no shell, no background; the
 * content (usually a DividerList) carries its own hairlines. The header
 * recipe is the shipped one from /settings, verbatim.
 */
function Section({ title, id, className, children }: SectionProps) {
  return (
    <section
      {...(id !== undefined ? { id } : {})}
      {...(title !== undefined ? { 'aria-label': title } : {})}
      className={cn('mt-8', className)}
    >
      {title !== undefined && (
        <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
          {title}
        </h2>
      )}
      {children}
    </section>
  )
}

export { Section }

import { cn } from '@/lib/utils'

/**
 * The user's picture, with initials standing in when there isn't one.
 *
 * WorkOS exposes `profilePictureUrl` read-only — it comes from whichever
 * identity provider the user signed in with, and there is no upload endpoint
 * anywhere in the API. So this renders what the provider gave us and never
 * offers to change it; a disabled "change photo" affordance would promise
 * something no amount of app code can deliver.
 *
 * A plain <img>, not next/image: the project configures no remote image
 * patterns, and adding a host allowlist for one avatar buys nothing —
 * these are already small, cached, CDN-served files.
 */
export function AccountAvatar({
  src,
  name,
  email,
  className,
}: {
  src: string | null
  name: string
  email: string
  className?: string
}) {
  // Initials come from the name when there is one, else the email's first
  // letter — never an empty circle, which reads as a broken image.
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || (email[0]?.toUpperCase() ?? '?')

  const shape = cn('size-12 shrink-0 rounded-full', className)

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        // Empty alt with aria-hidden: the name and email sit beside this in
        // the DOM, so announcing them again is noise to a screen reader.
        alt=""
        aria-hidden="true"
        width={48}
        height={48}
        className={cn(shape, 'object-cover')}
      />
    )
  }

  return (
    <div
      aria-hidden="true"
      className={cn(
        shape,
        'flex items-center justify-center bg-muted text-sm font-medium text-muted-foreground',
      )}
    >
      {initials}
    </div>
  )
}

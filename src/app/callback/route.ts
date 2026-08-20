import { handleAuth } from '@workos-inc/authkit-nextjs'

/**
 * AuthKit OAuth callback: exchanges the code for a session cookie and
 * redirects to the app. Must match NEXT_PUBLIC_WORKOS_REDIRECT_URI and the
 * redirect URI registered in the WorkOS dashboard.
 */
export const GET = handleAuth({ returnPathname: '/' })

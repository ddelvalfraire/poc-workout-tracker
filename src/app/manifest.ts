import type { MetadataRoute } from 'next'
import { getTranslations } from 'next-intl/server'

// The install prompt is the first copy a user ever sees, and it was a second
// hardcoded copy of the same two strings the document title already resolves
// from the catalog — so a translated app would still have offered an English
// install prompt.
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations('Common')
  return {
    name: t('appName'),
    short_name: t('appShortName'),
    description: t('appDescription'),
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}

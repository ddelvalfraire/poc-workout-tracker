import type { Metadata } from 'next'
import { privacy } from '@/lib/legal-content.generated'
import { LegalPage } from '../legal-page'

export const metadata: Metadata = { title: 'Privacy Policy' }

export default function PrivacyPage() {
  return <LegalPage markdown={privacy.contentMd} currentPath="/privacy" />
}

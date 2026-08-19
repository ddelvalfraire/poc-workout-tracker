import type { Metadata } from 'next'
import { healthNotice } from '@/lib/legal-content.generated'
import { LegalPage } from '../legal-page'

export const metadata: Metadata = { title: 'Consumer Health Data Privacy Policy' }

export default function HealthPrivacyPage() {
  return <LegalPage markdown={healthNotice.contentMd} currentPath="/health-privacy" />
}

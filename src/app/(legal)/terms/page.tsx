import type { Metadata } from 'next'
import { tos } from '@/lib/legal-content.generated'
import { LegalPage } from '../legal-page'

export const metadata: Metadata = { title: 'Terms of Service' }

export default function TermsPage() {
  return <LegalPage markdown={tos.contentMd} currentPath="/terms" />
}

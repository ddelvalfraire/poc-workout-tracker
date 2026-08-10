'use client'

import { useLinkStatus } from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Pending hint for the ops header's tab Links. useLinkStatus reads the
 * parent <Link>'s optimistic navigation state; while a navigation to that
 * tab is pending the LABEL eases to a pending opacity — an always-rendered,
 * fixed-size treatment with zero layout impact (no spinner, no dot, no width
 * change). The 150ms animation-delay in animate-pending-dim means a nav that
 * resolves faster never flashes it; the segment's loading.tsx takes over the
 * moment the route transition commits.
 *
 * Must live inside a <Link>: useLinkStatus returns pending: false anywhere
 * else, which degrades to a plain label (never breaks).
 */
export function OpsTabPending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus()
  return <span className={cn('block', pending && 'animate-pending-dim')}>{children}</span>
}

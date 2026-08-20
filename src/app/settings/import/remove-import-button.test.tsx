import { describe, expect, test, vi } from 'vitest'
import { useTranslations } from 'next-intl'
import { renderStaticIntl } from '../../../../vitest.intl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { RemoveImportButton } from './remove-import-button'

/**
 * The undo row. Its confirm dialog opens from state and its scope line is
 * assembled by the server page, so neither is reachable from a static render
 * of the button — the probes below resolve the same messages through the
 * same real catalog the dialog props and the page will hit. The scope line
 * was `${n} workout${n === 1 ? '' : 's'}`, so both plural branches are
 * asserted.
 */

function DialogCopyProbe({ scope }: { scope: string }) {
  const t = useTranslations('RemoveImportButton')
  return (
    <ul>
      <li>{t('confirm.title')}</li>
      <li>{t('confirm.body', { scope })}</li>
      <li>{t('confirm.confirmLabel')}</li>
      <li>{t('confirm.pendingLabel')}</li>
    </ul>
  )
}

function BatchCopyProbe({ count }: { count: number }) {
  const t = useTranslations('Import')
  return (
    <ul>
      <li>{t('title')}</li>
      <li>{t('historyGroupLabel')}</li>
      <li>{t('batch.scope', { count })}</li>
      <li>{t('source.strong')}</li>
      <li>{t('source.hevy')}</li>
    </ul>
  )
}

describe('RemoveImportButton', () => {
  test('the trigger resolves its label through the catalog', () => {
    const html = renderStaticIntl(<RemoveImportButton batchId="batch-1" scopeLabel="2 workouts" />)
    expect(html).toContain('Remove')
    expect(html).not.toMatch(/RemoveImportButton\.[a-zA-Z.]+/)
  })

  test('the confirm dialog props name the scope in one message', () => {
    const html = renderStaticIntl(<DialogCopyProbe scope="2 workouts" />)
    expect(html).toContain('Remove this import?')
    expect(html).toContain('Deletes the 2 workouts this import added.')
    expect(html).toContain('Removing…')
    expect(html).not.toMatch(/RemoveImportButton\.[a-zA-Z.]+/)
  })
})

describe('Import history list copy', () => {
  test('the batch scope pluralises at both branches', () => {
    expect(renderStaticIntl(<BatchCopyProbe count={1} />)).toContain('1 workout<')
    expect(renderStaticIntl(<BatchCopyProbe count={7} />)).toContain('7 workouts<')
  })

  test('the header, group label and source names resolve', () => {
    const html = renderStaticIntl(<BatchCopyProbe count={2} />)
    expect(html).toContain('Import history')
    expect(html).toContain('Past imports')
    expect(html).toContain('Strong')
    expect(html).toContain('Hevy')
    expect(html).not.toMatch(/Import\.[a-zA-Z.]+/)
  })
})

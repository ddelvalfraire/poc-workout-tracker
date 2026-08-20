import { describe, expect, test, vi } from 'vitest'
import { createTranslator } from 'next-intl'

import en from '../../../messages/en.json'
import { renderStaticIntl } from '../../../vitest.intl'
import { templateStatusLine, type TemplateStatusMessage } from '@/lib/template-usage'
import { TemplateActions } from './[id]/template-actions'

/**
 * Copy contract for /templates and /templates/[id]. Both pages are Server
 * Components behind database reads, so their messages are asserted through the
 * REAL catalog; the one client island renders for the markup-level checks
 * (dialog props and button labels are user-visible and must not stay English
 * literals in the source).
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}))

const t = (namespace: 'Templates' | 'TemplateDetail' | 'TemplateActions' | 'TemplateEditSheet') =>
  createTranslator({ locale: 'en', messages: en, namespace })

describe('Templates list copy', () => {
  const templates = t('Templates')

  test('the surface headings and empty state resolve', () => {
    expect(templates('title')).toBe('Session templates')
    expect(templates('empty')).toContain('Save as template')
    expect(templates('startAction')).toBe('Start a workout')
  })

  test('the hero CTA and the row accessible name are whole messages', () => {
    expect(templates('startHeroAction', { name: 'Push A' })).toBe('Start Push A')
    expect(templates('startRowAriaLabel', { name: 'Push A' })).toBe('Start Push A')
  })
})

/**
 * lib/template-usage decides WHICH status sentence a row earns; these render
 * that decision through the real catalog. The recency half is its own message,
 * resolved first and passed in as an argument exactly as the page does it — so
 * a broken nesting surfaces here rather than as "Last: Templates.lastRun…" on
 * someone's screen.
 */
describe('Templates row status, rendered from descriptors', () => {
  const templates = t('Templates')
  const NOW = new Date('2026-07-20T12:00:00Z')
  const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000)

  function render(status: TemplateStatusMessage): string {
    if (status.key === 'status.neverRun') return templates(status.key, status.values)
    const when = templates(status.values.when.key, status.values.when.values as never)
    return status.key === 'status.lastRun'
      ? templates(status.key, { when })
      : templates(status.key, { when, volume: status.values.volume, unit: status.values.unit })
  }

  test('a run with volume reads as one sentence in the display unit', () => {
    const usage = { lastPerformedAt: daysAgo(4), lastVolumeKg: 3663.2 }
    expect(render(templateStatusLine(usage, 5, 'lb', NOW))).toBe('Last: 4d ago · 8,076 lb')
    expect(render(templateStatusLine(usage, 5, 'kg', NOW))).toBe('Last: 4d ago · 3,663 kg')
  })

  test('a zero-volume run drops the segment', () => {
    const usage = { lastPerformedAt: daysAgo(1), lastVolumeKg: 0 }
    expect(render(templateStatusLine(usage, 5, 'kg', NOW))).toBe('Last: Yesterday')
  })

  test('Never run pluralises the exercise count at one and at many', () => {
    expect(render(templateStatusLine(null, 1, 'kg', NOW))).toBe('1 exercise · Never run')
    expect(render(templateStatusLine(null, 8, 'kg', NOW))).toBe('8 exercises · Never run')
  })

  test('every recency word resolves, and no key path leaks', () => {
    const lines = [0, 1, 6, 35, 120].map((days) =>
      render(templateStatusLine({ lastPerformedAt: daysAgo(days), lastVolumeKg: 0 }, 1, 'kg', NOW)),
    )
    expect(lines).toEqual([
      'Last: Today',
      'Last: Yesterday',
      'Last: 6d ago',
      'Last: 5 wks ago',
      'Last: 4 mo ago',
    ])
    expect(lines.join(' ')).not.toMatch(/Templates\.[a-zA-Z.]+/)
  })
})

describe('TemplateDetail copy', () => {
  const detail = t('TemplateDetail')

  test('the set plan pluralises the bare-set case at both categories', () => {
    expect(detail('setPlan.sets', { count: 1 })).toBe('1 set')
    expect(detail('setPlan.sets', { count: 3 })).toBe('3 sets')
  })

  test('the rep-range form carries no words, only the two numbers', () => {
    expect(detail('setPlan.range', { sets: 3, reps: '8' })).toBe('3 × 8')
    expect(detail('setPlan.range', { sets: 3, reps: '8–12' })).toBe('3 × 8–12')
  })

  test('the rest label and every tagged logging type resolve by enum value', () => {
    expect(detail('restLabel', { seconds: 90 })).toBe('Rest 90s')
    expect(detail('loggingType.bodyweight_reps')).toBe('Bodyweight')
    expect(detail('loggingType.weighted_bodyweight')).toBe('Weighted bodyweight')
    expect(detail('loggingType.assisted_bodyweight')).toBe('Assisted bodyweight')
  })
})

describe('TemplateActions', () => {
  const template = { id: 't1', name: 'Push A', description: null, icon: null }

  test('every button label resolves through the catalog', () => {
    const html = renderStaticIntl(<TemplateActions template={template} session={null} />)
    expect(html).toContain('Start workout')
    expect(html).toContain('Edit details')
    expect(html).toContain('Delete')
  })

  test('no unresolved key path reaches the markup', () => {
    const html = renderStaticIntl(<TemplateActions template={template} session={null} />)
    expect(html).not.toMatch(/TemplateActions\.[a-zA-Z.]+/)
  })

  test('the confirm dialog props are catalog copy, not English literals', () => {
    const actions = t('TemplateActions')
    expect(actions('deleteDialog.title')).toBe('Delete this template?')
    expect(actions('deleteDialog.body')).toContain('only the template goes')
    expect(actions('deleteDialog.confirm')).toBe('Delete')
    expect(actions('deleteDialog.pending')).toBe('Deleting…')
    expect(actions('deleteError')).toBe('Could not delete template. Please try again.')
  })
})

describe('TemplateEditSheet copy', () => {
  const sheet = t('TemplateEditSheet')

  test('the interpolated accessible names are whole messages', () => {
    expect(sheet('ariaLabel', { name: 'Push A' })).toBe('Edit Push A')
    expect(sheet('descriptionAriaLabel', { name: 'Push A' })).toBe('Description for Push A')
    expect(sheet('iconChoiceAriaLabel', { icon: '💪' })).toBe('Use 💪 as the icon')
  })

  test('field labels, controls and the failure message resolve', () => {
    expect(sheet('eyebrow')).toBe('Edit template')
    expect(sheet('close')).toBe('Close')
    expect(sheet('nameLabel')).toBe('Name')
    expect(sheet('iconLabel')).toBe('Icon')
    expect(sheet('iconFieldLabel')).toBe('Icon')
    expect(sheet('descriptionLabel')).toBe('Description')
    expect(sheet('cancel')).toBe('Cancel')
    expect(sheet('save')).toBe('Save')
    expect(sheet('saving')).toBe('Saving…')
    expect(sheet('saveError')).toBe('Could not save changes. Please try again.')
  })
})

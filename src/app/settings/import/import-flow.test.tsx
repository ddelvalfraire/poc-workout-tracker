import { describe, expect, test, vi } from 'vitest'
import { renderStaticIntl } from '../../../../vitest.intl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import {
  ImportFlow,
  PreviewSummary,
  SuccessSummary,
  type CommitResponse,
  type PreviewResponse,
} from './import-flow'

/**
 * The import flow carried this directory's worst i18n debt: a confirm CTA
 * built by gluing a count to `workout${n === 1 ? '' : 's'}`, and two success
 * clauses appended the same way. English grammar spelled out in JSX has no
 * correct translation, so each is now one ICU message — asserted here at
 * BOTH plural branches, since a one-branch plural reads fine at exactly one
 * value and is wrong at every other.
 */

function previewOf(overrides: Partial<PreviewResponse> = {}): PreviewResponse {
  return {
    token: 'preview-token',
    source: 'strong',
    sourceUnit: 'kg',
    unitFromFile: true,
    fileName: 'strong.csv',
    workoutCount: 2,
    setCount: 8,
    duplicateCount: 0,
    skippedCount: 0,
    dateRange: null,
    matched: [],
    toCreate: [],
    skipped: [],
    duplicates: [],
    warnings: [],
    ...overrides,
  }
}

function renderPreview(overrides: Partial<PreviewResponse> = {}): string {
  return renderStaticIntl(
    <PreviewSummary
      preview={previewOf(overrides)}
      unit="kg"
      isCommitting={false}
      onUnitChange={() => {}}
      onConfirm={() => {}}
      onCancel={() => {}}
    />,
  )
}

function resultOf(overrides: Partial<CommitResponse> = {}): CommitResponse {
  return {
    batchId: 'batch-1',
    workoutsImported: 2,
    setsImported: 8,
    duplicatesSkipped: 0,
    customsCreated: 0,
    ...overrides,
  }
}

describe('ImportFlow upload step', () => {
  test('the idle step resolves its indicator, dropzone and control names', () => {
    const html = renderStaticIntl(<ImportFlow defaultUnit="kg" />)
    expect(html).toContain('Step 1 of 3 — Upload')
    expect(html).toContain('Choose CSV — Strong or Hevy')
    expect(html).toContain('aria-label="Import a history file"')
    expect(html).toContain('aria-label="History CSV file"')
  })

  test('no key path leaks into the upload step', () => {
    const html = renderStaticIntl(<ImportFlow defaultUnit="kg" />)
    expect(html).not.toMatch(/ImportFlow\.[a-zA-Z.]+/)
  })
})

describe('ImportFlow preview step', () => {
  test('the confirm CTA pluralises the workout count', () => {
    expect(renderPreview({ workoutCount: 1 })).toContain('Import 1 workout<')
    expect(renderPreview({ workoutCount: 2 })).toContain('Import 2 workouts<')
  })

  test('the duplicate notice pluralises', () => {
    expect(renderPreview({ duplicateCount: 1 })).toContain(
      '1 workout already in your history will be skipped.',
    )
    expect(renderPreview({ duplicateCount: 3 })).toContain(
      '3 workouts already in your history will be skipped.',
    )
  })

  test('the new-exercise count pluralises', () => {
    expect(renderPreview({ toCreate: ['Zercher Squat'] })).toContain('1 new custom exercise')
    expect(renderPreview({ toCreate: ['Zercher Squat', 'Jefferson Curl'] })).toContain(
      '2 new custom exercises',
    )
  })

  test('the skipped-rows summary pluralises', () => {
    expect(
      renderPreview({ skippedCount: 1, skipped: [{ row: 4, reason: 'no exercise' }] }),
    ).toContain('1 row can’t be imported')
    expect(
      renderPreview({
        skippedCount: 2,
        skipped: [
          { row: 4, reason: 'no exercise' },
          { row: 9, reason: 'no reps' },
        ],
      }),
    ).toContain('2 rows can’t be imported')
  })

  test('the file name is one message with the source, not a fragment beside it', () => {
    const html = renderPreview({ fileName: 'strong.csv' })
    expect(html).toContain('Strong export')
    expect(html).toContain('— strong.csv')
  })

  test('the unit picker is named when the file does not declare a unit', () => {
    const html = renderPreview({ unitFromFile: false })
    expect(html).toContain('aria-label="File weight unit"')
  })

  test('no key path leaks into the preview step', () => {
    const html = renderPreview({
      unitFromFile: false,
      duplicateCount: 2,
      skippedCount: 1,
      skipped: [{ row: 4, reason: 'no exercise' }],
      toCreate: ['Zercher Squat'],
    })
    expect(html).not.toMatch(/ImportFlow\.[a-zA-Z.]+/)
  })
})

describe('ImportFlow success step', () => {
  test('the summary pluralises workouts and sets', () => {
    const one = renderStaticIntl(
      <SuccessSummary
        result={resultOf({ workoutsImported: 1, setsImported: 1 })}
        onReset={() => {}}
      />,
    )
    expect(one).toContain('1 workout and 1 set added to your history.')

    const many = renderStaticIntl(
      <SuccessSummary
        result={resultOf({ workoutsImported: 4, setsImported: 9 })}
        onReset={() => {}}
      />,
    )
    expect(many).toContain('4 workouts and 9 sets added to your history.')
  })

  test('the skipped-duplicates clause pluralises', () => {
    const one = renderStaticIntl(
      <SuccessSummary result={resultOf({ duplicatesSkipped: 1 })} onReset={() => {}} />,
    )
    expect(one).toContain('1 duplicate was skipped.')

    const many = renderStaticIntl(
      <SuccessSummary result={resultOf({ duplicatesSkipped: 5 })} onReset={() => {}} />,
    )
    expect(many).toContain('5 duplicates were skipped.')
  })

  test('the created-customs clause pluralises', () => {
    const one = renderStaticIntl(
      <SuccessSummary result={resultOf({ customsCreated: 1 })} onReset={() => {}} />,
    )
    expect(one).toContain('1 custom exercise created.')

    const many = renderStaticIntl(
      <SuccessSummary result={resultOf({ customsCreated: 3 })} onReset={() => {}} />,
    )
    expect(many).toContain('3 custom exercises created.')
  })

  test('no key path leaks into the success step', () => {
    const html = renderStaticIntl(
      <SuccessSummary
        result={resultOf({ duplicatesSkipped: 2, customsCreated: 2 })}
        onReset={() => {}}
      />,
    )
    expect(html).not.toMatch(/ImportFlow\.[a-zA-Z.]+/)
  })
})

import { describe, expect, test, vi } from 'vitest'
import { useTranslations } from 'next-intl'
import { renderStaticIntl } from '../../../vitest.intl'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

import { PhotosSection } from './photos-section'
import { PhotoCell, type PhotoEntry } from './photo-cell'
import { PhotoCompare } from './photo-compare'
import { PhotoOverlay } from './photo-overlay'

/**
 * Progress photos: the empty state IS the privacy promise, so it is asserted
 * word for word. Every alt text and cell label used to be a template literal
 * that appended the pose with a comma — an English sentence shape — and each
 * is now one ICU select, asserted with a pose and without.
 */

function photoOf(overrides: Partial<PhotoEntry> = {}): PhotoEntry {
  return {
    id: 'p1',
    dateLabel: 'Jan 2',
    takenAtMs: Date.now(),
    pose: 'front',
    note: null,
    thumbHash: '',
    thumbUrl: 'https://example.test/thumb.jpg',
    displayUrl: 'https://example.test/display.jpg',
    ...overrides,
  }
}

describe('PhotosSection', () => {
  test('the upload controls resolve their names', () => {
    const html = renderStaticIntl(<PhotosSection entries={[]} />)
    expect(html).toContain('aria-label="Pose (optional)"')
    expect(html).toContain('placeholder="Note (optional)"')
    expect(html).toContain('aria-label="Photo note"')
    expect(html).toContain('Add photo')
  })

  test('the empty state carries the privacy promise verbatim', () => {
    const html = renderStaticIntl(<PhotosSection entries={[]} />)
    expect(html).toContain(
      'No photos yet. Progress photos live only in your account — never public. The scale misses what a monthly photo catches.',
    )
  })

  test('the timeline and the compare CTA are named once photos exist', () => {
    const html = renderStaticIntl(<PhotosSection entries={[photoOf(), photoOf({ id: 'p2' })]} />)
    expect(html).toContain('aria-label="Photo timeline"')
    expect(html).toContain('Compare')
  })

  test('the compare prompt pluralises at both branches', () => {
    // Compare mode is entered by a tap, which a static render never fires.
    function PickProbe({ remaining }: { remaining: number }) {
      const t = useTranslations('PhotosSection')
      return <p>{t('comparePick', { remaining })}</p>
    }
    expect(renderStaticIntl(<PickProbe remaining={1} />)).toContain('Pick one more')
    expect(renderStaticIntl(<PickProbe remaining={2} />)).toContain('Pick two photos')
  })

  test('no key path leaks into the markup', () => {
    const html = renderStaticIntl(<PhotosSection entries={[photoOf(), photoOf({ id: 'p2' })]} />)
    expect(html).not.toMatch(/PhotosSection\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/PhotoCell\.[a-zA-Z.]+/)
  })
})

describe('PhotoCell', () => {
  test('names the tap intent for each mode', () => {
    const view = renderStaticIntl(
      <PhotoCell entry={photoOf()} onSelect={() => {}} isSelected={false} isCompareMode={false} />,
    )
    expect(view).toContain('aria-label="View photo from Jan 2"')

    const pick = renderStaticIntl(
      <PhotoCell entry={photoOf()} onSelect={() => {}} isSelected={false} isCompareMode />,
    )
    expect(pick).toContain('aria-label="Select photo from Jan 2"')

    const drop = renderStaticIntl(
      <PhotoCell entry={photoOf()} onSelect={() => {}} isSelected isCompareMode />,
    )
    expect(drop).toContain('aria-label="Deselect photo from Jan 2"')
  })

  test('the alt text names the pose only when there is one', () => {
    const posed = renderStaticIntl(
      <PhotoCell entry={photoOf()} onSelect={() => {}} isSelected={false} isCompareMode={false} />,
    )
    expect(posed).toContain('alt="Progress photo, Jan 2, Front"')

    const bare = renderStaticIntl(
      <PhotoCell
        entry={photoOf({ pose: null })}
        onSelect={() => {}}
        isSelected={false}
        isCompareMode={false}
      />,
    )
    expect(bare).toContain('alt="Progress photo, Jan 2"')
  })
})

describe('PhotoCompare', () => {
  test('the mode picker, slider and caption resolve through the catalog', () => {
    const html = renderStaticIntl(
      <PhotoCompare left={photoOf()} right={photoOf({ id: 'p2', dateLabel: 'Feb 6' })} />,
    )
    expect(html).toContain('aria-label="Compare mode"')
    expect(html).toContain('Slider')
    expect(html).toContain('Side by side')
    expect(html).toContain('aria-label="Reveal earlier photo"')
    expect(html).toContain('Jan 2 → Feb 6')
    expect(html).not.toMatch(/PhotoCompare\.[a-zA-Z.]+/)
  })
})

describe('PhotoOverlay', () => {
  test('the dialog, close and delete controls resolve their names', () => {
    const html = renderStaticIntl(<PhotoOverlay entry={photoOf()} onClose={() => {}} />)
    expect(html).toContain('aria-label="Photo from Jan 2"')
    expect(html).toContain('aria-label="Close"')
    expect(html).toContain('aria-label="Delete photo from Jan 2"')
    expect(html).toContain('alt="Progress photo, Jan 2, Front"')
    expect(html).not.toMatch(/PhotoOverlay\.[a-zA-Z.]+/)
  })
})

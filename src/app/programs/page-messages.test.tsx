import { useTranslations } from 'next-intl'
import { describe, expect, test } from 'vitest'

import { renderStaticIntl } from '../../../vitest.intl'

/**
 * The programs surface's PAGES are async Server Components that open with
 * `requireUserId()` and a fistful of db reads, so they cannot be rendered in a
 * unit test — but their copy is the half of this directory most likely to
 * break, because it carries every plural and every `t.rich` tag.
 *
 * These probes call the same keys with the same argument names the pages do,
 * through the real en.json (vitest.intl.tsx). Between this and the typed
 * message keys — a page referencing a key the catalog never got is a compile
 * error, not a runtime miss — a broken message cannot reach a user quietly.
 *
 * Every plural is asserted at BOTH branches on purpose: a message that spells
 * only the `other` arm looks perfect at 5 and wrong at 1.
 */

function ProgramsProbe({ weeks }: { weeks: number }) {
  const t = useTranslations('Programs')
  return (
    <div>
      <p>{t('row.weeks', { weeks })}</p>
      <p>{t('row.weeksDeload', { weeks, deloadWeek: 4 })}</p>
      <p>{t('hero.next', { dayName: 'Legs' })}</p>
      <p>{t('archived.summary', { count: weeks })}</p>
      <p>{t('thisWeek.heading')}</p>
      <p>{t('thisWeek.doneCount', { done: 2, total: weeks })}</p>
      <p>{t('thisWeek.done')}</p>
      <p>{t('fullPlan')}</p>
      <p>{t('zone.withCount', { label: 'Drafts', count: weeks })}</p>
      <p>{t('blockSoFar.heading')}</p>
      <p>{t('blockSoFar.daysDone', { done: 9, planned: 12 })}</p>
      <p>{t('blockSoFar.daysLabel')}</p>
      <p>{t('blockSoFar.volumeLabel')}</p>
      <p>{t('blockSoFar.weeksLeftLabel')}</p>
      <p>
        {t.rich('hero.weekPosition', {
          week: 3,
          total: 8,
          big: (chunks) => <b data-testid="big">{chunks}</b>,
          small: (chunks) => <i data-testid="small">{chunks}</i>,
        })}
      </p>
    </div>
  )
}

describe('Programs list messages', () => {
  test('the row meta line reads singular at one week', () => {
    const html = renderStaticIntl(<ProgramsProbe weeks={1} />)
    expect(html).toContain('1 week')
    expect(html).not.toContain('1 weeks')
    expect(html).toContain('1 week · deload wk 4')
  })

  test('the row meta line reads plural past one week', () => {
    const html = renderStaticIntl(<ProgramsProbe weeks={8} />)
    expect(html).toContain('8 weeks')
    expect(html).toContain('8 weeks · deload wk 4')
  })

  test('the hero week position renders both of its styled halves', () => {
    const html = renderStaticIntl(<ProgramsProbe weeks={8} />)
    expect(html).toContain('<b data-testid="big">Wk 3</b>')
    expect(html).toContain('<i data-testid="small">of 8</i>')
  })

  test('the next-day line names the day', () => {
    const html = renderStaticIntl(<ProgramsProbe weeks={8} />)
    expect(html).toContain('Next: Legs')
    expect(html).not.toMatch(/Programs\.[a-zA-Z.]+/)
  })

  test('the block-dashboard bands resolve their headings and counts', () => {
    const html = renderStaticIntl(<ProgramsProbe weeks={4} />)
    expect(html).toContain('This week')
    expect(html).toContain('2 of 4 done')
    expect(html).toContain('<p>done</p>')
    expect(html).toContain('Full plan &amp; settings')
    expect(html).toContain('Drafts · 4')
    expect(html).toContain('Block so far')
    expect(html).toContain('9/12')
    expect(html).toContain('Days done')
    expect(html).toContain('Volume')
    expect(html).toContain('Wks left')
  })
})

function ProgramDetailProbe({ count }: { count: number }) {
  const t = useTranslations('ProgramDetail')
  return (
    <div>
      <p>{t('blockComplete.eyebrow', { weeks: count })}</p>
      <p>{t('day.exerciseCount', { count })}</p>
      <p>{t('day.exerciseSummary', { count, names: 'Squat · Bench' })}</p>
      <p>{t('day.setProgress', { completed: 2, total: count })}</p>
      <p>{t('day.setSummary', { count })}</p>
      <p>{t('day.setsUnit', { count })}</p>
      <p>{t('day.number', { position: count })}</p>
      <p>{t('weekMeta', { week: 2, total: 8 })}</p>
      <p>{t('weekMetaDeload', { week: 2, total: 8, deloadWeek: 4 })}</p>
      <p>
        {t('autoreg.tmProposal', {
          week: 5,
          currentTm: 140,
          proposedTm: 126,
          unit: 'kg',
        })}
      </p>
    </div>
  )
}

describe('Program detail messages', () => {
  test('counts read singular at one', () => {
    const html = renderStaticIntl(<ProgramDetailProbe count={1} />)
    expect(html).toContain('Block complete · 1 week')
    expect(html).toContain('1 exercise<')
    expect(html).toContain('1 exercise · Squat · Bench')
    expect(html).toContain('2 of 1 set<')
    expect(html).toContain('<p>set</p>')
  })

  test('counts read plural past one', () => {
    const html = renderStaticIntl(<ProgramDetailProbe count={5} />)
    expect(html).toContain('Block complete · 5 weeks')
    expect(html).toContain('5 exercises<')
    expect(html).toContain('5 exercises · Squat · Bench')
    expect(html).toContain('2 of 5 sets<')
    expect(html).toContain('<p>sets</p>')
  })

  test('the week meta line carries the deload clause inside one message', () => {
    const html = renderStaticIntl(<ProgramDetailProbe count={5} />)
    expect(html).toContain('Week 2 of 8')
    expect(html).toContain('Week 2 of 8 · deload wk 4')
  })

  // Training vocabulary is not translated away: TM stays TM.
  test('the TM proposal keeps the training-max sentence intact', () => {
    const html = renderStaticIntl(<ProgramDetailProbe count={5} />)
    expect(html).toContain(
      'Week 5: TM 140 → 126 kg — 3 straight stalls, training max likely set too high',
    )
    expect(html).not.toMatch(/ProgramDetail\.[a-zA-Z.]+/)
  })
})

function ProgramStatsProbe({ count }: { count: number }) {
  const t = useTranslations('ProgramStats')
  return (
    <div>
      <p>{t('prs.estimateNote', { reps: count })}</p>
      <p>{t('prs.weekNote', { week: 3 })}</p>
      <p>{t('prs.gain', { value: '5 kg' })}</p>
      <p>{t('weeks.sets', { sets: count })}</p>
      <p>{t('weeks.volumeAndSets', { volume: '9,210 kg', sets: count })}</p>
      <p>{t('weeks.dayRatio', { done: 2, planned: 4 })}</p>
      <p>{t('weeks.unfinished', { count })}</p>
      <p>{t('muscle.setCount', { value: '10.5', count })}</p>
      <p>{t('muscle.lede', { week: 3 })}</p>
      <p>{t('progression.reps', { reps: count })}</p>
      <p>{t('progression.sets', { sets: count })}</p>
      <p>{t('weekShort', { week: 3 })}</p>
      <p>{t('weekMeta', { week: 3, total: 8 })}</p>
      <p>
        {t.rich('muscle.trend', {
          values: '8 → 10 → 12',
          muted: (chunks) => <em data-testid="muted">{chunks}</em>,
        })}
      </p>
    </div>
  )
}

describe('Program stats messages', () => {
  test('counts read singular at one', () => {
    const html = renderStaticIntl(<ProgramStatsProbe count={1} />)
    expect(html).toContain('est. from 1 rep<')
    expect(html).toContain('<p>1 set</p>')
    expect(html).toContain('9,210 kg · 1 set<')
    expect(html).toContain('10.5 set<')
  })

  test('counts read plural past one', () => {
    const html = renderStaticIntl(<ProgramStatsProbe count={3} />)
    expect(html).toContain('est. from 3 reps<')
    expect(html).toContain('<p>3 sets</p>')
    expect(html).toContain('9,210 kg · 3 sets<')
    expect(html).toContain('10.5 sets<')
  })

  test('the muscle trend renders its muted tail as an element', () => {
    const html = renderStaticIntl(<ProgramStatsProbe count={3} />)
    expect(html).toContain('8 → 10 → 12')
    expect(html).toContain('<em data-testid="muted">sets/week</em>')
  })

  test('week annotations and gains resolve', () => {
    const html = renderStaticIntl(<ProgramStatsProbe count={3} />)
    expect(html).toContain('· wk 3')
    expect(html).toContain('+5 kg')
    expect(html).toContain('Wk 3')
    expect(html).toContain('Week 3 of 8')
    expect(html).toContain('Verdicts from week 3 — sets credited per muscle')
    expect(html).not.toMatch(/ProgramStats\.[a-zA-Z.]+/)
  })
})

function TemplateProbe({ days, weeks }: { days: number; weeks: number }) {
  const shelf = useTranslations('ProgramTemplates')
  const wger = useTranslations('ProgramTemplateDetail')
  const curated = useTranslations('SystemTemplateDetail')
  // The shared preview body owns the plan vocabulary both detail branches
  // render (day labels, superset letters, fact-strip captions, counts).
  const preview = useTranslations('TemplatePreview')
  return (
    <div>
      <p>{shelf('curated.meta', { days, weeks })}</p>
      <p>{shelf('group.weeks', { weeks })}</p>
      <p>{preview('dayNumber', { position: 1 })}</p>
      <p>{preview('supersetLabel', { letter: 'A' })}</p>
      <p>{preview('exerciseCount', { count: days })}</p>
      <p>{preview('factWeeks')}</p>
      <p>{preview('factDaysPerWeek')}</p>
      <p>{preview('factExercisesPerDay')}</p>
      <p>{preview('ctaHint')}</p>
      <p>
        {wger.rich('attribution', {
          source: (chunks) => <a href="https://wger.de">{chunks}</a>,
        })}
      </p>
      <p>
        {curated.rich('attribution', {
          source: (chunks) => <a href="https://example.test">{chunks}</a>,
        })}
      </p>
    </div>
  )
}

describe('Template shelf and detail messages', () => {
  test('day and week counts read singular at one', () => {
    const html = renderStaticIntl(<TemplateProbe days={1} weeks={1} />)
    expect(html).toContain('<p>1 week</p>')
    expect(html).toContain('<p>1 exercise</p>')
  })

  test('day and week counts read plural past one', () => {
    const html = renderStaticIntl(<TemplateProbe days={4} weeks={8} />)
    expect(html).toContain('<p>8 weeks</p>')
    expect(html).toContain('<p>4 exercises</p>')
  })

  test('both attribution footers wrap only the link text in the anchor', () => {
    const html = renderStaticIntl(<TemplateProbe days={4} weeks={8} />)
    expect(html).toContain('From the wger community · <a href="https://wger.de">View on wger</a>')
    expect(html).toContain('About this program · <a href="https://example.test">View source</a>')
  })

  test('preview labels resolve', () => {
    const html = renderStaticIntl(<TemplateProbe days={4} weeks={8} />)
    expect(html).toContain('Day 1')
    expect(html).toContain('Superset A')
    expect(html).toContain('Weeks')
    expect(html).toContain('Days / week')
    expect(html).toContain('Exercises / day')
    expect(html).toContain('nothing is scheduled until you train')
    expect(html).not.toMatch(/ProgramTemplates\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/ProgramTemplateDetail\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/SystemTemplateDetail\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/TemplatePreview\.[a-zA-Z.]+/)
  })
})

function ChromeProbe() {
  const newProgram = useTranslations('ProgramNew')
  const editProgram = useTranslations('ProgramEdit')
  // Both close links read the shared chrome word now.
  const tCommon = useTranslations('Common')
  return (
    <div>
      <p>{newProgram('title')}</p>
      <p>{tCommon('close')}</p>
      <p>{editProgram('title')}</p>
      <p>{tCommon('close')}</p>
    </div>
  )
}

describe('Builder page chrome messages', () => {
  test('the create and edit headers are distinct messages', () => {
    const html = renderStaticIntl(<ChromeProbe />)
    expect(html).toContain('New Program')
    expect(html).toContain('Edit Program')
    expect(html).toContain('Close')
    expect(html).not.toMatch(/ProgramNew\.[a-zA-Z.]+/)
    expect(html).not.toMatch(/ProgramEdit\.[a-zA-Z.]+/)
  })
})

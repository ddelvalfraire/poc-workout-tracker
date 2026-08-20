import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ExternalLink } from 'lucide-react'
import { getUserId } from '@/lib/auth'
import { resolveShare } from '@/db/program-shares'
import { getWeightUnit } from '@/db/preferences'
import { DEFAULT_WEIGHT_UNIT } from '@/lib/units'
import {
  formatPlannedScheme,
  groupPlannedSets,
  plannedSetChips,
  type PlannedSetShape,
} from '@/lib/planned-set-format'
import { AppHeader } from '@/components/app-header'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { adoptSharedProgramAction } from './actions'
import { getTranslations } from 'next-intl/server'

/** Share tokens are 32 base64url chars (24 random bytes); anything shaped
 *  differently is a bad URL and 404s before touching the db — the same
 *  fail-fast idiom as the uuid guards on other detail pages. Bounds are
 *  generous so a future longer token doesn't break old-page deploys. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/

/**
 * The public share page — a PUBLIC route (proxy.ts) that gates itself:
 * `resolveShare` collapses every failure (unknown token, revoked, private,
 * proposed) into the same null → constant-shape notFound(), never
 * acknowledging which gate refused. Renders program CONTENT only — the full
 * day → exercise → set structure via the planned-set formatters — and NEVER
 * the owner's history, stats, body data, or change log (resolveShare cannot
 * even return them). Read-only: no Start buttons; the one CTA is the
 * cross-account funnel (sign in → "Add to my programs" → proposal).
 */
export default async function SharedProgramPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const t = await getTranslations('P')
  const { token } = await params
  if (!TOKEN_PATTERN.test(token)) notFound()
  const shared = await resolveShare(token)
  if (!shared) notFound()
  const { program, ownerUserId } = shared

  // Who's looking decides the CTA — signed-out visitors still get the full
  // read (this page is the acquisition surface).
  const userId = await getUserId()
  const isOwner = userId !== null && userId === ownerUserId
  // Loads render in the VIEWER's unit when signed in; anonymous visitors get
  // the app default.
  const unit = userId !== null ? await getWeightUnit(userId) : DEFAULT_WEIGHT_UNIT

  // Superset letters (A, B…) in order of first appearance — the same reader
  // vocabulary as the template detail page.
  const supersetLetters: Record<number, string> = {}
  let nextLetter = 0
  for (const day of program.days) {
    for (const exercise of day.exercises) {
      const group = exercise.supersetGroup
      if (group !== null && supersetLetters[group] === undefined) {
        supersetLetters[group] = String.fromCharCode(65 + nextLetter++)
      }
    }
  }

  const dayCount = program.days.length

  // De-carded notice: a plain sentence past a hairline — the button, not a
  // shell, carries the affordance (same voice as /w/[token]).
  const cta = isOwner ? (
    <div className="border-t border-border pt-4">
      <p className="text-sm text-muted-foreground">
        {t('ownerNotice')}
      </p>
      <Link
        href={`/programs/${program.id}`}
        className={cn(buttonVariants({ variant: 'outline' }), 'mt-3 w-full')}
      >
        {t('openAction')}
      </Link>
    </div>
  ) : userId !== null ? (
    // The action re-validates the share at clone time and lands on the new
    // proposal's page, where Adopt/Decline is the forced confirm.
    <form action={adoptSharedProgramAction.bind(null, token)}>
      <Button type="submit" className="w-full">
        {t('adoptAction')}
      </Button>
    </form>
  ) : (
    // Post-sign-in returns here (validated via safeReturnPath) so the add flow
    // continues where it started.
    <Link
      href={`/sign-in?redirect_url=${encodeURIComponent(`/p/${token}`)}`}
      className={cn(buttonVariants(), 'w-full')}
    >
      {t('signInAction')}
    </Link>
  )

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader title={t('pageTitle')} />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Article READ surface — the program page's visual language (hero +
            icon/title + description lead), same object through a different
            door. */}
        <header className="mt-4">
          {program.heroImageUrl !== null && (
            <div className="relative -mx-5 h-44 overflow-hidden sm:mx-0 sm:rounded-2xl">
              {/* Plain <img>: remote hosts aren't in the next/image allowlist,
                  and the URL was validated http(s) at the input boundary. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={program.heroImageUrl}
                alt=""
                className="absolute inset-0 size-full object-cover"
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent"
              />
            </div>
          )}
          <p className={cn('flex items-baseline gap-2', program.heroImageUrl !== null && 'mt-3')}>
            {program.icon !== null && (
              <span aria-hidden="true" className="text-2xl leading-none">
                {program.icon}
              </span>
            )}
            <span className="min-w-0 truncate font-display text-3xl uppercase leading-none tracking-wide">
              {program.name}
            </span>
          </p>
          {/* Attribution: "Shared program", no owner name in v1 (no
              display-name plumbing) — the value space is ready for it. */}
          <p className="mt-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground tnum">
            {t('attribution', { days: dayCount, weeks: program.mesocycleWeeks })}
          </p>
          {program.description !== null && (
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {program.description}
            </p>
          )}
        </header>

        <div className="mt-5">{cta}</div>

        <h2 className="mt-8 font-display text-xl uppercase leading-none tracking-wide">{t('planTitle')}</h2>
        {/* Hairline day sections (programs/[id] vocabulary): the public read
            speaks the same de-carded language as the owner's detail page. */}
        <div className="mt-1">
          {program.days.map((day, dayIndex) => (
            <section key={day.id} className="border-b border-b-border/60 py-4">
              <h3 className="flex min-w-0 items-baseline gap-2">
                <span className="shrink-0 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground tnum">
                  {t('dayLabel', { number: dayIndex + 1 })}
                </span>
                <span className="min-w-0 truncate font-display text-lg uppercase leading-tight tracking-wide">
                  {day.name}
                </span>
              </h3>

              <div className="mt-3 space-y-3">
                {day.exercises.map((exercise, exerciseIndex) => {
                  const group = exercise.supersetGroup
                  const supersetLabel = group !== null ? supersetLetters[group] : undefined
                  const previousGroup = day.exercises[exerciseIndex - 1]?.supersetGroup
                  const startsSuperset = supersetLabel !== undefined && previousGroup !== group
                  // db set rows → the planned display shape (the template
                  // page's formatter — week-1 template values, no derivation:
                  // deriving would read the OWNER's history, which never
                  // crosses accounts).
                  const plannedSets: PlannedSetShape[] = exercise.sets.map((s) => ({
                    setType: s.setType,
                    metricMode: s.metricMode,
                    repMin: s.repMin,
                    repMax: s.repMax,
                    rir: s.rir,
                    rpe: s.rpe,
                    suggestedLoadKg: s.suggestedLoadKg,
                    tempo: s.tempo,
                    durationSec: s.durationSec,
                    distanceM: s.distanceM,
                    restSec: s.restSec,
                    technique: s.technique,
                  }))
                  return (
                    <div
                      key={exercise.id}
                      className={cn(
                        supersetLabel !== undefined &&
                          'border-l-2 border-l-muted-foreground/40 pl-3',
                      )}
                    >
                      {startsSuperset && (
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          {t('supersetLabel', { label: supersetLabel })}
                        </p>
                      )}
                      <p className="text-sm font-medium">{exercise.name}</p>
                      <div className="mt-1 space-y-0.5">
                        {groupPlannedSets(plannedSets).map((run, runIndex) => (
                          <p
                            key={runIndex}
                            className="flex items-baseline gap-2 text-sm text-muted-foreground"
                          >
                            <span className="tnum">
                              {formatPlannedScheme(run.set, run.count, unit)}
                            </span>
                            {/* Chips → words: set qualifiers are labels, not
                                controls — quiet caps text, no pill shell
                                (programs/[id] target-line rule). */}
                            {plannedSetChips(run.set).map((chip) => (
                              <span
                                key={chip}
                                className="text-[10px] font-semibold uppercase tracking-widest tnum"
                              >
                                {chip}
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-8">{cta}</div>

        {/* wger attribution is a licensing requirement when the plan was
            imported from their CC catalog — it travels with the share. */}
        {program.sourceUrl !== null && (
          <p className="mt-6 pb-2 text-xs text-muted-foreground">
            <a
              href={program.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-2 transition-colors hover:text-foreground"
            >
              {t('sourceLabel')}
              <ExternalLink aria-hidden="true" className="size-3" />
            </a>
          </p>
        )}
      </main>
    </div>
  )
}

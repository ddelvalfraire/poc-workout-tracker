import { useTranslations } from 'next-intl'
import { Section } from '@/components/ui/section'
import { DividerList } from '@/components/ui/divider-list'
import { cn } from '@/lib/utils'
import {
  TIERS,
  activeProgramLimitFor,
  featuresFor,
  type Feature,
  type ResolvedEntitlement,
  type Tier,
} from '@/lib/entitlements/tiers'

/**
 * What the member is on, and what the other tiers would give them.
 *
 * Deliberately has no checkout button: nothing can be bought yet, and a
 * disabled "Upgrade" that never works is worse than an honest page. When
 * Stripe lands, the button belongs on the tier the member does NOT have — the
 * comparison below is already shaped for it.
 *
 * Where a tier came from is stated plainly rather than hidden. A member on a
 * support comp should be able to see that is what they are on, so an expiry
 * they did not choose is never a surprise.
 */
/**
 * Explicit key strings rather than template literals. next-intl resolves both,
 * but a key assembled at runtime is invisible to the catalog's orphan check —
 * renaming a tier would leave dead messages that nobody is told about.
 */
const TIER_KEY = {
  free: { name: 'tier.free.name', summary: 'tier.free.summary', price: 'tier.free.price' },
  pro: { name: 'tier.pro.name', summary: 'tier.pro.summary', price: 'tier.pro.price' },
  max: { name: 'tier.max.name', summary: 'tier.max.summary', price: 'tier.max.price' },
} as const

export function PlanSurface({ entitlement }: { entitlement: ResolvedEntitlement }) {
  const t = useTranslations('Plan')

  return (
    <div className="flex flex-col gap-8 pb-10 pt-2">
      <Section title={t('current.title')}>
        <div className="flex flex-col gap-2 pt-1">
          <p className="font-display text-3xl uppercase tracking-tight">
            {t(TIER_KEY[entitlement.tier].name)}
          </p>
          <p className="text-sm text-muted-foreground">{t(TIER_KEY[entitlement.tier].summary)}</p>

          {/* Only ever shown for a granted tier: "Free, from nothing, forever"
              is noise, and the default tier has no provenance to explain. */}
          {entitlement.source && (
            <p className="text-sm text-muted-foreground">
              {entitlement.source === 'manual' || entitlement.source === 'promo'
                ? t('provenance.granted')
                : t('provenance.purchased', { source: entitlement.source })}
              {entitlement.expiresAt
                ? ` · ${t('expiry.on', { date: formatDate(entitlement.expiresAt) })}`
                : ` · ${t('expiry.never')}`}
            </p>
          )}
        </div>
      </Section>

      <Section title={t('compare.title')}>
        <DividerList>
          {TIERS.map((tier) => (
            <TierRow key={tier} tier={tier} isCurrent={tier === entitlement.tier} />
          ))}
        </DividerList>
      </Section>

      <p className="text-sm text-muted-foreground">{t('unavailableNotice')}</p>
    </div>
  )
}

function TierRow({ tier, isCurrent }: { tier: Tier; isCurrent: boolean }) {
  const t = useTranslations('Plan')
  const limit = activeProgramLimitFor(tier)

  return (
    <li className="flex flex-col gap-1.5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn('text-base', isCurrent && 'font-semibold')}>{t(TIER_KEY[tier].name)}</p>
        <p className="text-sm text-muted-foreground">
          {isCurrent ? t('compare.currentBadge') : t(TIER_KEY[tier].price)}
        </p>
      </div>

      <ul className="flex flex-col gap-0.5 text-sm text-muted-foreground">
        {/* The program cap is stated for every tier, including the ones where
            it is lifted: "unlimited" only means something next to a number. */}
        <li>
          {limit === null
            ? t('capability.programsUnlimited')
            : t('capability.programs', { count: limit })}
        </li>
        {featuresFor(tier).map((feature: Feature) =>
          feature === 'unlimited_programs' ? null : (
            <li key={feature}>{t(`capability.${feature}`)}</li>
          ),
        )}
      </ul>
    </li>
  )
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(value)
}

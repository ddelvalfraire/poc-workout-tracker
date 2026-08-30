import { withAuth } from '@workos-inc/authkit-nextjs'
import { SignOutButton } from '@/components/auth/sign-out-button'
import { requireUserId } from '@/lib/auth/auth'
import {
  getWeightUnit,
  getBodyweightKg,
  getDefaultRestSec,
  getWeightStep,
  getRestTimerEnabled,
  getRpeLoggingEnabled,
} from '@/db/preferences'
import { kgToDisplay } from '@/lib/units'
import { isOpsUser } from '@/lib/ops/access'
import { AppHeader } from '@/components/nav/app-header'
import { BackLink } from '@/components/nav/back-link'
import { UnitToggle } from '@/components/account/unit-toggle'
import { Section } from '@/components/ui/section'
import { DividerList, DividerRow } from '@/components/ui/divider-list'
import packageJson from '../../../package.json'
import { RestDefaultSetting } from './rest-default-setting'
import { WeightStepSetting } from './weight-step-setting'
import { RestTimerToggle } from './rest-timer-toggle'
import { AnalyticsConsentToggle } from './analytics-consent-toggle'
import { getConsentState } from '@/db/consent'
import { ConsentIdentity } from '@/components/account/consent-identity'
import { RpeLoggingToggle } from './rpe-logging-toggle'
import { WorkoutRemindersToggle } from './workout-reminders-toggle'
import { getTranslations } from 'next-intl/server'

/**
 * The preferences surface: everything that tunes how the app behaves for
 * this user, gathered off the home header where controls had been squatting.
 * Zoned per the settings idiom (identity → TRAINING → DATA → INTERNAL) with
 * benefit-first hints — what a setting does FOR you, one clause, no
 * implementation narration. Also the home of the notifications opt-in —
 * permission prompts must be gesture-driven from a settings toggle, never
 * fired on page load.
 */
export default async function SettingsPage() {
  const t = await getTranslations('Settings')
  const userId = await requireUserId()
  const [unit, bodyweightKg, defaultRestSec, restTimerEnabled, rpeLoggingEnabled, weightStep, session, consent] =
    await Promise.all([
      getWeightUnit(userId),
      getBodyweightKg(userId),
      getDefaultRestSec(userId),
      getRestTimerEnabled(userId),
      getRpeLoggingEnabled(userId),
      getWeightStep(userId),
      withAuth(),
      getConsentState(userId),
    ])

  // Internal ops board — the link only renders for allowlisted users, the
  // same dev-gate visibility idiom the coach entry points use. The /ops route
  // enforces the gate itself (404s otherwise); this just hides the entry.
  const showOps = isOpsUser(userId)

  // AuthKit's user carries a single, already-primary email — no address list
  // to pick a primary out of.
  const email = session.user?.email ?? null

  // Version truth: the deployed git SHA baked at build (NEXT_PUBLIC_BUILD_ID
  // in next.config.ts); local builds get a `local-` id, where the package
  // version is the honest label instead.
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID
  const versionLabel =
    buildId !== undefined && !buildId.startsWith('local-')
      ? t('version', { sha: buildId.slice(0, 7) })
      : t('versionLocal', { version: packageJson.version })

  return (
    <div className="flex min-h-[100dvh] flex-col">
      {/* Second reconciler mount: the settings toggle changes the consent
          fact, and this page re-renders with the new projection — the
          island applies identify()/reset() immediately after the flip. */}
      <ConsentIdentity
        userId={userId}
        granted={Boolean(consent.analytics_identity?.granted)}
      />
      <AppHeader
        title={t('title')}
        leading={
          <BackLink fallback="/" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Identity: who's signed in, the way into account management, and
            the way out. The row drills into /settings/account (name, sign-in
            methods, deletion); sign-out stays here rather than behind that
            drill-down, because the exit should never cost an extra tap. */}
        <section aria-label={t('accountGroupLabel')} className="mt-6">
          {/* De-carded: identity is the grouped list's first rows — muted
              hairlines between and under them, no shell. */}
          <DividerList>
            <DividerRow
              href="/settings/account"
              trailing={
                <span className="max-w-[12rem] truncate text-sm">
                  {email ?? <span className="text-muted-foreground">{t('signedInLabel')}</span>}
                </span>
              }
            >
              <div className="min-w-0">
                <p className="font-medium">{t('account.label')}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{t('account.hint')}</p>
              </div>
            </DividerRow>
            {/* Plan sits beside identity rather than in a zone of its own:
                it is a fact about the account, and a member checking what
                they are on looks where their email is. */}
            <DividerRow href="/settings/plan">
              <div className="min-w-0">
                <p className="font-medium">{t('plan.label')}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{t('plan.hint')}</p>
              </div>
            </DividerRow>
            <li className="flex items-center justify-end py-2">
              <SignOutButton variant="full" />
            </li>
          </DividerList>
        </section>

        <SettingsZone title={t('zones.training')}>
          <SettingRow label={t('unit.label')} hint={t('unit.hint')}>
            <UnitToggle unit={unit} />
          </SettingRow>
          <SettingRow label={t('restTimer.label')} hint={t('restTimer.hint')}>
            <RestTimerToggle enabled={restTimerEnabled} />
          </SettingRow>
          <SettingRow label={t('effortLogging.label')} hint={t('effortLogging.hint')}>
            <RpeLoggingToggle enabled={rpeLoggingEnabled} />
          </SettingRow>
          {/* The switch's truth is the BROWSER's push subscription (probed on
              mount), not a server flag — and the permission prompt only ever
              fires from the toggle gesture (iOS grants it exactly once). */}
          <SettingRow label={t('reminders.label')} hint={t('reminders.hint')}>
            <WorkoutRemindersToggle />
          </SettingRow>
          <SettingRow
            label={t('defaultRest.label')}
            hint={restTimerEnabled ? t('defaultRest.hint') : t('defaultRest.hintDisabled')}
          >
            <RestDefaultSetting defaultRestSec={defaultRestSec} />
          </SettingRow>
          {/* The ± step the logger's rail and the weight field's arrow keys
              both use. Unit-native and not converted on a unit switch — the
              picker offers this unit's sizes, and a stored value from the
              other unit falls back to this one's default. */}
          <SettingRow label={t('weightStep.label')} hint={t('weightStep.hint', { unit })}>
            <WeightStepSetting weightStep={weightStep} unit={unit} />
          </SettingRow>
          {/* Link row, like Body: the home layout editor grew its own surface
              at /settings/home (locked hero bar over a grid preview; tap a
              tile for size/visibility/reorder, long-press to drag). */}
          <LinkRow
            href="/settings/home"
            label={t('home.label')}
            hint={t('home.hint')}
          />
        </SettingsZone>

        <SettingsZone title={t('zones.data')}>
          {/* Link row, not an inline editor: body tracking grew its own surface
              (weight + tape history and trends at /body); settings only shows
              the current weight scoring reads and hands off. */}
          <LinkRow href="/body" label={t('body.label')} hint={t('body.hint')}>
            <span className="text-sm tnum">
              {bodyweightKg !== null
                ? t('body.value', { value: kgToDisplay(bodyweightKg, unit), unit })
                : t('body.valueUnset')}
            </span>
          </LinkRow>
          {/* Link row, like Body: the import flow (upload → preview → confirm
              → undo) grew its own surface at /settings/import. */}
          <LinkRow
            href="/settings/import"
            label={t('import.label')}
            hint={t('import.hint')}
          />
          {/* Deletion's entry point moved to /settings/account's terminal
              Danger zone, where identity actions belong — beside DATA's
              "Import history" it read as a routine data chore of the same
              weight. Still one tap from here (Account → last row), so it
              stays easily discoverable; kept to ONE canonical entry so
              analytics and tests have a single path to assert on. */}
        </SettingsZone>

        {/* Internal-only, visually quarantined (dashed, muted) so operator
            plumbing never reads as part of the product. Rendered solely for
            allowlisted operators; the route 404s for everyone else, so a
            leaked link reveals nothing. */}
        {showOps && (
          <SettingsZone title={t('zones.internal')} quarantined>
            <LinkRow href="/ops" label={t('ops.label')} hint={t('ops.hint')} />
          </SettingsZone>
        )}

        {/* Privacy: the MHMDA withdrawal path — consent must be revocable
            here as easily as it was granted at signup. */}
        <SettingsZone title={t('zones.privacy')}>
          <SettingRow label={t('analytics.label')} hint={t('analytics.hint')}>
            <AnalyticsConsentToggle granted={Boolean(consent.analytics_identity?.granted)} />
          </SettingRow>
        </SettingsZone>

        {/* Legal links: the health-privacy link's prominence is an MHMDA
            requirement, not footer decoration. */}
        <SettingsZone title={t('zones.legal')}>
          <LinkRow href="/terms" label={t('terms.label')} hint={t('terms.hint')} />
          <LinkRow href="/privacy" label={t('privacyPolicy.label')} hint={t('privacyPolicy.hint')} />
          <LinkRow
            href="/health-privacy"
            label={t('healthPrivacy.label')}
            hint={t('healthPrivacy.hint')}
          />
        </SettingsZone>

        <p className="mt-8 pb-4 text-center text-xs text-muted-foreground tnum">{versionLabel}</p>
      </main>
    </div>
  )
}

/** One settings zone: condensed-caps group header over a divider list — the
 *  Section + DividerList primitives (this page is the shape's reference
 *  surface). The quarantined variant (INTERNAL) keeps its "present, not
 *  product" voice as DASHED hairlines. */
function SettingsZone({
  title,
  quarantined = false,
  children,
}: {
  title: string
  quarantined?: boolean
  children: React.ReactNode
}) {
  return (
    <Section title={title}>
      <DividerList dashed={quarantined} className="mt-1">
        {children}
      </DividerList>
    </Section>
  )
}

/** One settings list row: label + hint on the left, the control right. */
function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint: string
  children: React.ReactNode
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-4">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  )
}

/** A navigation row: same anatomy as SettingRow, but the whole row is the
 *  control — optional trailing value, then the chevron (DividerRow). */
function LinkRow({
  href,
  label,
  hint,
  children,
}: {
  href: string
  label: string
  hint: string
  children?: React.ReactNode
}) {
  return (
    <DividerRow href={href} trailing={children}>
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
    </DividerRow>
  )
}

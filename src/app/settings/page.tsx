import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { currentUser } from '@clerk/nextjs/server'
import { SignOutButton, UserButton } from '@clerk/nextjs'
import { requireUserId } from '@/lib/auth'
import {
  getWeightUnit,
  getBodyweightKg,
  getDefaultRestSec,
  getRestTimerEnabled,
  getRpeLoggingEnabled,
} from '@/db/preferences'
import { kgToDisplay } from '@/lib/units'
import { isOpsUser } from '@/lib/ops/access'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { UnitToggle } from '@/components/unit-toggle'
import { cn } from '@/lib/utils'
import packageJson from '../../../package.json'
import { RestDefaultSetting } from './rest-default-setting'
import { RestTimerToggle } from './rest-timer-toggle'
import { RpeLoggingToggle } from './rpe-logging-toggle'
import { WorkoutRemindersToggle } from './workout-reminders-toggle'

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
  const userId = await requireUserId()
  const [unit, bodyweightKg, defaultRestSec, restTimerEnabled, rpeLoggingEnabled, user] =
    await Promise.all([
      getWeightUnit(userId),
      getBodyweightKg(userId),
      getDefaultRestSec(userId),
      getRestTimerEnabled(userId),
      getRpeLoggingEnabled(userId),
      currentUser(),
    ])

  // Internal ops board — the link only renders for allowlisted users, the
  // same dev-gate visibility idiom the coach entry points use. The /ops route
  // enforces the gate itself (404s otherwise); this just hides the entry.
  const showOps = isOpsUser(userId)

  const email =
    user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user?.emailAddresses[0]?.emailAddress ??
    null

  // Version truth: the deployed git SHA baked at build (NEXT_PUBLIC_BUILD_ID
  // in next.config.ts); local builds get a `local-` id, where the package
  // version is the honest label instead.
  const buildId = process.env.NEXT_PUBLIC_BUILD_ID
  const versionLabel =
    buildId !== undefined && !buildId.startsWith('local-')
      ? `Build ${buildId.slice(0, 7)}`
      : `v${packageJson.version}`

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Settings"
        leading={
          <BackLink fallback="/" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        {/* Identity: who's signed in, and the way out. UserButton carries
            Clerk's account management; sign-out gets its own explicit exit. */}
        <section aria-label="Account" className="mt-6">
          {/* De-carded: identity is the grouped list's first row — a muted
              hairline under it, no shell. */}
          <div className="flex items-center gap-3 border-b border-b-border/60 py-4">
            <UserButton />
            <p className="min-w-0 flex-1 truncate text-sm">
              {email ?? <span className="text-muted-foreground">Signed in</span>}
            </p>
            <SignOutButton>
              <button
                type="button"
                className="shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Sign out
              </button>
            </SignOutButton>
          </div>
        </section>

        <SettingsZone title="Training">
          <SettingRow label="Weight unit" hint="Shown everywhere you enter or read weight.">
            <UnitToggle unit={unit} />
          </SettingRow>
          <SettingRow label="Rest timer" hint="Counts down your rest after each set.">
            <RestTimerToggle enabled={restTimerEnabled} />
          </SettingRow>
          <SettingRow
            label="Effort logging"
            hint="Rate how hard sets felt (RIR/RPE) after you complete them."
          >
            <RpeLoggingToggle enabled={rpeLoggingEnabled} />
          </SettingRow>
          {/* The switch's truth is the BROWSER's push subscription (probed on
              mount), not a server flag — and the permission prompt only ever
              fires from the toggle gesture (iOS grants it exactly once). */}
          <SettingRow label="Workout reminders" hint="A morning nudge on your program days.">
            <WorkoutRemindersToggle />
          </SettingRow>
          <SettingRow
            label="Default rest"
            hint={
              restTimerEnabled
                ? 'Your countdown length between sets.'
                : 'Turn the rest timer on to use this.'
            }
          >
            <RestDefaultSetting defaultRestSec={defaultRestSec} />
          </SettingRow>
          {/* Link row, like Body: the home layout editor grew its own surface
              at /settings/home (locked hero row, chevron reorder, switches). */}
          <LinkRow
            href="/settings/home"
            label="Customize home"
            hint="Choose which sections show, and their order."
          />
        </SettingsZone>

        <SettingsZone title="Data">
          {/* Link row, not an inline editor: body tracking grew its own surface
              (weight + tape history and trends at /body); settings only shows
              the current weight scoring reads and hands off. */}
          <LinkRow href="/body" label="Body" hint="Your weight and measurements over time.">
            <span className="text-sm tnum">
              {bodyweightKg !== null ? `${kgToDisplay(bodyweightKg, unit)} ${unit}` : 'Not set'}
            </span>
          </LinkRow>
          {/* Link row, like Body: the import flow (upload → preview → confirm
              → undo) grew its own surface at /settings/import. */}
          <LinkRow
            href="/settings/import"
            label="Import history"
            hint="Bring your Strong or Hevy workouts with you."
          />
        </SettingsZone>

        {/* Internal-only, visually quarantined (dashed, muted) so operator
            plumbing never reads as part of the product. Rendered solely for
            allowlisted operators; the route 404s for everyone else, so a
            leaked link reveals nothing. */}
        {showOps && (
          <SettingsZone title="Internal" quarantined>
            <LinkRow href="/ops" label="Ops" hint="Monitoring board — not part of the app." />
          </SettingsZone>
        )}

        <p className="mt-8 pb-4 text-center text-xs text-muted-foreground tnum">{versionLabel}</p>
      </main>
    </div>
  )
}

/** One settings zone: condensed-caps group header over a divider list — the
 *  iOS-grouped-list shape in the de-card vocabulary: rows separated by muted
 *  hairlines, a closing hairline instead of a shell. The quarantined variant
 *  (INTERNAL) keeps its "present, not product" voice as DASHED hairlines. */
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
    <section aria-label={title} className="mt-8">
      <h2 className="font-display text-base uppercase leading-none tracking-wide text-muted-foreground">
        {title}
      </h2>
      <ul
        className={cn(
          'mt-1',
          quarantined
            ? 'divide-y divide-dashed divide-border/60 border-b border-dashed border-b-border/60'
            : 'divide-y divide-border/60 border-b border-b-border/60',
        )}
      >
        {children}
      </ul>
    </section>
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
 *  control — optional trailing value, then the chevron. */
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
    <li>
      <Link
        href={href}
        className="flex items-center justify-between gap-4 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
      >
        <div className="min-w-0">
          <p className="font-medium">{label}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
          {children}
          <ChevronRight aria-hidden="true" className="size-4" />
        </div>
      </Link>
    </li>
  )
}

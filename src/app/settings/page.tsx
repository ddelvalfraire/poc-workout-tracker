import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import {
  getWeightUnit,
  getBodyweightKg,
  getDefaultRestSec,
  getRestTimerEnabled,
} from '@/db/preferences'
import { kgToDisplay } from '@/lib/units'
import { isOpsUser } from '@/lib/ops/access'
import { AppHeader } from '@/components/app-header'
import { BackLink } from '@/components/back-link'
import { UnitToggle } from '@/components/unit-toggle'
import { RestDefaultSetting } from './rest-default-setting'
import { RestTimerToggle } from './rest-timer-toggle'
import { WorkoutRemindersToggle } from './workout-reminders-toggle'

/**
 * The preferences surface: everything that tunes how the app behaves for
 * this user, gathered off the home header where controls had been squatting.
 * Also the future home of the notifications opt-in — permission prompts must
 * be gesture-driven from a settings toggle, never fired on page load.
 */
export default async function SettingsPage() {
  const userId = await requireUserId()
  const [unit, bodyweightKg, defaultRestSec, restTimerEnabled] = await Promise.all([
    getWeightUnit(userId),
    getBodyweightKg(userId),
    getDefaultRestSec(userId),
    getRestTimerEnabled(userId),
  ])

  // Internal ops board — the link only renders for allowlisted users, the
  // same dev-gate visibility idiom the coach entry points use. The /ops route
  // enforces the gate itself (404s otherwise); this just hides the entry.
  const showOps = isOpsUser(userId)

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Settings"
        leading={
          <BackLink fallback="/" />
        }
      />

      <main className="mx-auto w-full max-w-md flex-1 px-5 pb-safe">
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          <SettingRow
            label="Weight unit"
            hint="Display and entry unit — weights are stored in kg."
          >
            <UnitToggle unit={unit} />
          </SettingRow>
          <SettingRow
            label="Rest timer"
            hint="Countdown and rest readout after each set. Off hides the whole surface."
          >
            <RestTimerToggle enabled={restTimerEnabled} />
          </SettingRow>
          {/* The switch's truth is the BROWSER's push subscription (probed on
              mount), not a server flag — and the permission prompt only ever
              fires from the toggle gesture (iOS grants it exactly once). */}
          <SettingRow
            label="Workout reminders"
            hint="A morning notification on days your program schedules. iPhone asks for permission once — choose carefully."
          >
            <WorkoutRemindersToggle />
          </SettingRow>
          <SettingRow
            label="Default rest"
            hint={
              restTimerEnabled
                ? "Countdown target after each set. Program sets with their own rest override this."
                : "Inactive while the rest timer is off — the value is kept for when it returns."
            }
          >
            <RestDefaultSetting defaultRestSec={defaultRestSec} />
          </SettingRow>
          {/* Link row, not an inline editor: body tracking grew its own surface
              (weight + tape history and trends at /body); settings only shows
              the current weight scoring reads and hands off. */}
          <li>
            <Link
              href="/body"
              className="flex items-center justify-between gap-4 px-4 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="font-medium">Body</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Bodyweight and tape measurements. Weight feeds est. 1RM.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
                <span className="text-sm tnum">
                  {bodyweightKg !== null ? `${kgToDisplay(bodyweightKg, unit)} ${unit}` : 'Not set'}
                </span>
                <ChevronRight aria-hidden="true" className="size-4" />
              </div>
            </Link>
          </li>
          {/* Link row, like Body: the import flow (upload → preview → confirm
              → undo) grew its own surface at /settings/import. */}
          <li>
            <Link
              href="/settings/import"
              className="flex items-center justify-between gap-4 px-4 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
            >
              <div className="min-w-0">
                <p className="font-medium">Import history</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  Bring past workouts in from a Strong or Hevy CSV export.
                </p>
              </div>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
          {/* Internal-only: rendered solely for allowlisted operators. The
              route 404s for everyone else, so a leaked link reveals nothing. */}
          {showOps && (
            <li>
              <Link
                href="/ops"
                className="flex items-center justify-between gap-4 px-4 py-4 transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
              >
                <div className="min-w-0">
                  <p className="font-medium">Ops</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Internal board: Sentry, Healthchecks, Langfuse, Vercel, and app vitals.
                  </p>
                </div>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          )}
        </ul>
      </main>
    </div>
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
    <li className="flex items-center justify-between gap-4 px-4 py-4">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </li>
  )
}

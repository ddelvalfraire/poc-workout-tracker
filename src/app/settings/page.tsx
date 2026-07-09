import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { requireUserId } from '@/lib/auth'
import { getWeightUnit, getBodyweightKg, getDefaultRestSec } from '@/db/preferences'
import { kgToDisplay } from '@/lib/units'
import { AppHeader } from '@/components/app-header'
import { UnitToggle } from '@/components/unit-toggle'
import { BodyweightEditor } from '@/components/bodyweight-editor'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { RestDefaultSetting } from './rest-default-setting'

/**
 * The preferences surface: everything that tunes how the app behaves for
 * this user, gathered off the home header where controls had been squatting.
 * Also the future home of the notifications opt-in — permission prompts must
 * be gesture-driven from a settings toggle, never fired on page load.
 */
export default async function SettingsPage() {
  const userId = await requireUserId()
  const [unit, bodyweightKg, defaultRestSec] = await Promise.all([
    getWeightUnit(userId),
    getBodyweightKg(userId),
    getDefaultRestSec(userId),
  ])

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="Settings"
        leading={
          <Link
            href="/"
            aria-label="Back"
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), '-ml-2')}
          >
            <ChevronLeft aria-hidden="true" className="size-5" />
          </Link>
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
            label="Default rest"
            hint="Countdown target after each set. Program sets with their own rest override this."
          >
            <RestDefaultSetting defaultRestSec={defaultRestSec} />
          </SettingRow>
          <SettingRow
            label="Bodyweight"
            hint="Feeds est. 1RM for bodyweight-type exercises."
          >
            <BodyweightEditor
              bodyweightDisplay={bodyweightKg !== null ? kgToDisplay(bodyweightKg, unit) : null}
              unit={unit}
            />
          </SettingRow>
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

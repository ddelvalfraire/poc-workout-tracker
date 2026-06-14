import Link from 'next/link'
import { requireUserId } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { AppHeader } from '@/components/app-header'
import { cn } from '@/lib/utils'
import { WorkoutLogger } from './workout-logger'

export default async function NewWorkoutPage() {
  await requireUserId() // middleware also guards; defense-in-depth

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <AppHeader
        title="New Workout"
        trailing={
          <Link href="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
            Cancel
          </Link>
        }
      />
      <main className="mx-auto w-full max-w-md flex-1 px-5">
        <WorkoutLogger />
      </main>
    </div>
  )
}

import Link from 'next/link'
import { requireUserId } from '@/lib/auth'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { WorkoutLogger } from './workout-logger'

export default async function NewWorkoutPage() {
  await requireUserId() // middleware also guards; defense-in-depth

  return (
    <main className="mx-auto w-full max-w-md p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">New Workout</h1>
        <Link href="/" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>
          Cancel
        </Link>
      </header>
      <WorkoutLogger />
    </main>
  )
}

import { autoSyncPlanToPerformance } from '@/lib/auto-plan-sync'
import { checkGoalAchievements } from '@/lib/goals'
import { checkTrophies } from '@/lib/trophies'

/**
 * The post-completion domain pipeline — everything that must react to a just-
 * saved workout beyond the row itself: the plan silently adopts outperformed
 * loads (auto plan-sync), a finished session can complete a strength target or
 * extend a streak (goals), and a crossed threshold stamps a medal (trophies).
 *
 * ONE seam beneath every adapter. The web actions (app/workout/actions.ts) and
 * the MCP write tools (lib/mcp/write-tools.ts) save the same fact; before this
 * module the pipeline lived only in the actions, so an MCP-logged session
 * never synced the plan, completed a goal, or earned a trophy — a behavioural
 * fork between clients writing identical workouts. Analytics is deliberately
 * NOT part of this pipeline: MCP writes fire no product events (the accepted-
 * imprecision note in lib/analytics.ts owns that decision).
 *
 * Ordering is load-bearing: the sync runs first (the plan reflects the session
 * before anything else reads it), the goal check next, and the trophy check
 * AFTER the goal check — a live finish may celebrate + push; anything not
 * attributable to this workout stamps quietly (the retroactive rule).
 *
 * FAIL-SOFT, structurally: each step already swallows its own failures — the
 * save that triggered it is the source of truth, and every helper's contract
 * is "resolves, always" — and the outer catch backstops the adapter boundary
 * so a future regression inside a helper can still never fail a committed
 * save.
 */
export async function completeWorkoutSideEffects(
  userId: string,
  workoutId: string,
): Promise<void> {
  try {
    await autoSyncPlanToPerformance(userId, workoutId)
    await checkGoalAchievements(userId, ['strength', 'consistency'])
    await checkTrophies(userId, { kind: 'finish', workoutId })
  } catch (error) {
    // The parent write already committed; a lost side-effect is always
    // preferable to failing the save it rode on.
    console.error('workout completion side-effects failed (workout saved)', error)
  }
}

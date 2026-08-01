import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getWeightUnit } from '@/db/preferences'
import { goalLabel } from '@/lib/goal-progress'
import { evaluateGoalProgress, type GoalWithProgress } from '@/lib/goals'
import { kgToDisplay, type WeightUnit } from '@/lib/units'
import { resolveUserId } from './resolve-user'
import { errorResult, jsonResult } from './result'

/**
 * Registers the goal read tools — the coach's window into the user's goals
 * ("goal tracking we can create our own version of goals"). Read-only in v1
 * by design: goals are personal targets the owner sets in the app; the coach
 * references them, it doesn't write them. Same boundary conventions as
 * read-tools.ts: resolveUserId, weights converted to the user's display unit,
 * the unit echoed in the payload.
 */
export function registerGoalTools(server: McpServer): void {
  server.registerTool(
    'list_goals',
    {
      title: 'List Goals',
      description:
        "Lists the user's active goals with live progress: strength (target est. 1RM per exercise, percent + pace projection), bodyweight (target weight + direction, remaining), consistency (scheduled-days streak with the goal's own grace setting). Weights are in the user's unit. Streak weeks are computed in server UTC weeks — treat as approximate near week boundaries. Use to reference what the user is training toward.",
      inputSchema: { userId: z.string().optional() },
    },
    async ({ userId }, extra) => {
      try {
        const resolved = resolveUserId(extra, userId)
        const evaluated = await evaluateGoalProgress(resolved)
        const unit = await getWeightUnit(resolved)
        return jsonResult({
          userId: resolved,
          unit,
          goals: evaluated.map((entry) => buildGoalPayload(entry, unit)),
        })
      } catch (error: unknown) {
        return errorResult(error)
      }
    },
  )
}

/** Projects one evaluated goal into the agent-facing shape (display units,
 *  ISO dates) — exported for the tool test. */
export function buildGoalPayload(entry: GoalWithProgress, unit: WeightUnit) {
  const { goal, progress, achieved } = entry
  return {
    id: goal.id,
    kind: goal.kind,
    label: goalLabel(goal, unit),
    achieved,
    deadline: goal.deadline,
    createdAt: goal.createdAt.toISOString(),
    achievedAt: goal.achievedAt?.toISOString() ?? null,
    ...(goal.kind === 'strength' && goal.wgerExerciseId !== null && goal.source !== null
      ? {
          exercise: {
            wgerExerciseId: goal.wgerExerciseId,
            source: goal.source,
            name: goal.exerciseName,
          },
        }
      : {}),
    target: buildTargetPayload(goal.target, unit),
    progress: buildProgressPayload(progress, unit),
  }
}

function buildTargetPayload(target: GoalWithProgress['goal']['target'], unit: WeightUnit) {
  if ('e1rmKg' in target) return { e1rm: kgToDisplay(target.e1rmKg, unit) }
  if ('weightKg' in target) {
    return { weight: kgToDisplay(target.weightKg, unit), direction: target.direction }
  }
  return { targetWeeks: target.targetWeeks, allowedMissesPerWeek: target.allowedMissesPerWeek }
}

function buildProgressPayload(progress: GoalWithProgress['progress'], unit: WeightUnit) {
  if (progress.kind === 'strength') {
    return {
      bestE1rm: progress.bestE1rmKg === null ? null : kgToDisplay(progress.bestE1rmKg, unit),
      percent: progress.percent,
      onPaceFor: progress.projectedAt?.toISOString().slice(0, 10) ?? null,
    }
  }
  if (progress.kind === 'bodyweight') {
    return {
      current: progress.currentKg === null ? null : kgToDisplay(progress.currentKg, unit),
      remaining: progress.remainingKg === null ? null : kgToDisplay(progress.remainingKg, unit),
    }
  }
  return {
    streakWeeks: progress.streakWeeks,
    targetWeeks: progress.targetWeeks,
    scheduledWeekdays: progress.scheduledWeekdays,
  }
}

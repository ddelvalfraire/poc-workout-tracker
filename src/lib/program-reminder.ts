/**
 * Visibility rule for the home page's "train with a plan" nudge, kept pure so
 * the rule is testable without the page: show only when there is no program
 * day to put in the hero (the fresh-user state) and the user hasn't dismissed
 * the reminder. A program day always wins — the nudge is redundant next to a
 * hero that already embodies the plan.
 */
export function shouldShowProgramReminder(hasProgramDay: boolean, dismissed: boolean): boolean {
  return !hasProgramDay && !dismissed
}

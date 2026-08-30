/**
 * A simulated clock, anchored to a fixed instant, for backdating persona
 * writes deterministically. Forward-only by construction: daysAgo/hoursAgo
 * only subtract from the anchor, so a non-negative `n` can never exceed it.
 */

export interface PersonaClock {
  readonly anchor: Date
  daysAgo(n: number): Date
  hoursAgo(n: number): Date
}

export function createClock(anchor: Date = new Date()): PersonaClock {
  return {
    anchor,
    daysAgo: (n) => new Date(anchor.getTime() - n * 24 * 60 * 60 * 1000),
    hoursAgo: (n) => new Date(anchor.getTime() - n * 60 * 60 * 1000),
  }
}

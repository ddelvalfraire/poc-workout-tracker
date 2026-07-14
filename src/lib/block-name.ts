/** Mirrors MAX_NAME in program-input.ts (not exported there) — the ceiling a
 *  program name must stay under to survive a future builder edit's Zod parse. */
export const MAX_PROGRAM_NAME = 200

/** End-anchored and exact-spelled so an em dash or the word "Block" INSIDE a
 *  user's name never increments — only our own stamped suffix does. */
const BLOCK_SUFFIX = /\s—\sBlock\s(\d+)$/

/**
 * The name a restarted block's clone gets: "Name — Block 2", or the existing
 * block number bumped ("PPL — Block 2" → "PPL — Block 3"). The BASE is clamped
 * so the stamped result stays a valid program name (rename is a builder edit,
 * which re-validates length).
 */
export function nextBlockName(name: string): string {
  const match = name.match(BLOCK_SUFFIX)
  const base = match ? name.slice(0, match.index) : name
  const k = match ? Number(match[1]) + 1 : 2
  const suffix = ` — Block ${k}`
  return base.slice(0, Math.max(1, MAX_PROGRAM_NAME - suffix.length)).trimEnd() + suffix
}

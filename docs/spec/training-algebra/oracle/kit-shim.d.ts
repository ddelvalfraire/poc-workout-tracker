/** The further Node entry points the handoff kit uses (the package builds with no @types). */
declare module 'node:fs' {
  export function mkdirSync(path: string, opts?: { recursive?: boolean }): void
  export function rmSync(path: string, opts?: { recursive?: boolean; force?: boolean }): void
  export function readdirSync(path: string): string[]
  export function existsSync(path: string): boolean
}

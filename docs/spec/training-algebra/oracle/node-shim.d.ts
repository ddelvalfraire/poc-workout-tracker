/** The two Node entry points dispose.ts uses (the package builds with no @types). */
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string
  export function writeFileSync(path: URL | string, data: string): void
}

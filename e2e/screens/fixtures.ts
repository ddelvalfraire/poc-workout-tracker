import { test as base } from '@playwright/test'

export interface ScreensFixtures {
  personaSlug: string
}

/** `personaSlug` is a project-option fixture — set per-project in
 *  playwright.screens.config.ts's `use: { personaSlug: slug }`, not per-test. */
export const test = base.extend<ScreensFixtures>({
  personaSlug: ['', { option: true }],
})
export { expect } from '@playwright/test'

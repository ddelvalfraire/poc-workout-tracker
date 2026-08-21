/**
 * Where the app under test lives — in ONE place.
 *
 * `playwright.config.ts` feeds `APP_ORIGIN` to `use.baseURL` (what every
 * relative `page.goto()` resolves against) and starts the dev server on
 * `APP_PORT`; the few specs that assert an absolute URL import the same
 * constant. It used to be typed out in five files, so moving the suite off
 * port 3000 meant editing all five and remembering to revert them.
 *
 * Moving it is not hypothetical: `reuseExistingServer: false` makes the app
 * server refuse to start when something already holds the port, and another
 * dev server on 3000 is the normal state of this machine. Reusing that one
 * would silently test whatever branch IT is serving, which is why the config
 * refuses rather than reuses. `E2E_PORT=3100 npx playwright test` now moves
 * the whole harness together.
 */
export const APP_PORT = process.env.E2E_PORT ?? '3000'
export const APP_ORIGIN = `http://localhost:${APP_PORT}`

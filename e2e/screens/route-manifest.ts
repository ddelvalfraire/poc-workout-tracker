import type { Page, Locator } from '@playwright/test'
import type { ResolvedManifest } from './resolve-manifest'
import type { RouteParam } from './build-path'

/**
 * The checked-in survey of every capturable page under `src/app/`. Each
 * entry's `readySignal` mirrors e2e/visual.spec.ts's existing idiom — a
 * content assertion, never `networkidle` (PostHog polls, drawers refetch on
 * focus). Static strings are copied verbatim from messages/en.json. Routes
 * whose primary heading is genuinely dynamic (a program/template/exercise's
 * own name, with no static fallback) fall back to `getByRole('heading')`
 * with no name filter — "some heading rendered" still fails a 404 or error
 * boundary, which is what a ready signal needs to catch.
 *
 * `/ops`, `/ops/billing`, `/ops/product` are excluded (vendor allowlist
 * keyed by a user id — out of scope). `/bodyweight` is a hard redirect to
 * `/body` with no content of its own — `/body` already covers it.
 */
export interface RouteSpec {
  /** Human-readable slug for the screenshot filename, e.g. 'programs-detail'. */
  slug: string
  /** Path template with `:param` placeholders, e.g. '/programs/:programId'. */
  pathTemplate: string
  /** Which resolved-manifest field(s) fill the template's params. Empty for static routes. */
  params: RouteParam[]
  /** Locator asserted visible before the screenshot is taken. */
  readySignal: (page: Page, resolved: ResolvedManifest) => Locator
  lane: 'diffable' | 'gallery-only'
  viewports: Array<'phone' | 'desktop'>
  /** False for routes that are env-gated off in the default local setup —
   *  kept in the table (not deleted) so the gap stays visible. Defaults to
   *  enabled when omitted. */
  enabled?: boolean
}

export const ROUTE_MANIFEST: RouteSpec[] = [
  {
    slug: 'home',
    pathTemplate: '/',
    params: [],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone', 'desktop'],
  },
  {
    slug: 'history',
    pathTemplate: '/history',
    params: [],
    readySignal: (page) => page.getByText('History'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'stats',
    pathTemplate: '/stats',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'This Week' }),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'goals',
    pathTemplate: '/goals',
    params: [],
    readySignal: (page) => page.getByText('Goals'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'notes',
    pathTemplate: '/notes',
    params: [],
    readySignal: (page) => page.getByText('Notes'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'trophies',
    pathTemplate: '/trophies',
    params: [],
    readySignal: (page) => page.getByText('Trophies'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'exercises',
    pathTemplate: '/exercises',
    params: [],
    readySignal: (page) => page.getByText('Exercises'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'exercises-new',
    pathTemplate: '/exercises/new',
    params: [],
    readySignal: (page) => page.getByText('New custom exercise'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'exercise-detail',
    pathTemplate: '/exercises/:exerciseSource/:exerciseId',
    params: [
      { name: 'exerciseSource', source: 'exerciseRef', split: { on: ':', index: 0 } },
      { name: 'exerciseId', source: 'exerciseRef', split: { on: ':', index: 1 } },
    ],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'workout-new',
    pathTemplate: '/workout/new',
    params: [],
    readySignal: (page) => page.getByText('New Workout'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'workout-detail',
    pathTemplate: '/workout/:workoutId',
    params: [{ name: 'workoutId', source: 'workoutId' }],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'workout-edit',
    pathTemplate: '/workout/:workoutId/edit',
    params: [{ name: 'workoutId', source: 'workoutId' }],
    readySignal: (page) => page.getByText('Edit Workout'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'programs',
    pathTemplate: '/programs',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Programs' }),
    lane: 'diffable',
    viewports: ['phone', 'desktop'],
  },
  {
    slug: 'programs-new',
    pathTemplate: '/programs/new',
    params: [],
    readySignal: (page) => page.getByText('New Program'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'programs-detail',
    pathTemplate: '/programs/:programId',
    params: [{ name: 'programId', source: 'programId' }],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone', 'desktop'],
  },
  {
    slug: 'programs-about',
    pathTemplate: '/programs/:programId/about',
    params: [{ name: 'programId', source: 'programId' }],
    readySignal: (page) => page.getByText('About'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'programs-edit',
    pathTemplate: '/programs/:programId/edit',
    params: [{ name: 'programId', source: 'programId' }],
    readySignal: (page) => page.getByText('Edit Program'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'programs-editor',
    pathTemplate: '/programs/:programId/editor',
    params: [{ name: 'programId', source: 'programId' }],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone', 'desktop'],
  },
  {
    slug: 'programs-editor-day',
    pathTemplate: '/programs/:programId/editor/:day',
    params: [
      { name: 'programId', source: 'programId' },
      { name: 'day', source: 'literal', literal: '1' },
    ],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone', 'desktop'],
  },
  {
    slug: 'programs-stats',
    pathTemplate: '/programs/:programId/stats',
    params: [{ name: 'programId', source: 'programId' }],
    readySignal: (page) => page.getByText('Sessions'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'programs-templates',
    pathTemplate: '/programs/templates',
    params: [],
    readySignal: (page) => page.getByText('Program templates'),
    lane: 'gallery-only',
    viewports: ['phone'],
  },
  {
    slug: 'programs-templates-detail',
    pathTemplate: '/programs/templates/:templateId',
    params: [{ name: 'templateId', source: 'templateId' }],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'gallery-only',
    viewports: ['phone'],
  },
  {
    slug: 'templates',
    pathTemplate: '/templates',
    params: [],
    readySignal: (page) => page.getByText('Session templates'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'templates-detail',
    pathTemplate: '/templates/:templateId',
    params: [{ name: 'templateId', source: 'templateId' }],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'settings',
    pathTemplate: '/settings',
    params: [],
    readySignal: (page) => page.getByText('Settings'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'settings-account',
    pathTemplate: '/settings/account',
    params: [],
    readySignal: (page) => page.getByText('Account'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'settings-account-name',
    pathTemplate: '/settings/account/name',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Name' }),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'settings-account-mfa',
    pathTemplate: '/settings/account/mfa',
    params: [],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone'],
    // 404s unless WORKOS_MFA_MODE is 'optional'/'required' in the running
    // app's env, which this rig's webServer block does not set. Kept
    // visible in the table rather than deleted; flip on once that env var
    // is wired through the screens config.
    enabled: false,
  },
  {
    slug: 'settings-home',
    pathTemplate: '/settings/home',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Customize home' }),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'settings-import',
    pathTemplate: '/settings/import',
    params: [],
    readySignal: (page) => page.getByText('Import history'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'settings-plan',
    pathTemplate: '/settings/plan',
    params: [],
    readySignal: (page) => page.getByText('Plan'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'settings-delete-account',
    pathTemplate: '/settings/delete-account',
    params: [],
    // Capture only — nothing on this page should ever be clicked by the rig.
    readySignal: (page) => page.getByText('Delete account'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'body',
    pathTemplate: '/body',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Body' }),
    lane: 'gallery-only',
    viewports: ['phone'],
  },
  {
    slug: 'coach',
    pathTemplate: '/coach',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Coach' }),
    lane: 'gallery-only',
    viewports: ['phone'],
  },
  {
    slug: 'welcome',
    pathTemplate: '/welcome',
    params: [],
    readySignal: (page) => page.getByText('Your data, your call'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'program-share',
    pathTemplate: '/p/:programShareToken',
    params: [{ name: 'programShareToken', source: 'programShareToken' }],
    readySignal: (page) => page.getByRole('heading').first(),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'workout-share',
    pathTemplate: '/w/:workoutShareToken',
    params: [{ name: 'workoutShareToken', source: 'workoutShareToken' }],
    readySignal: (page) => page.getByText('Open your workout'),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'privacy',
    pathTemplate: '/privacy',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Privacy Policy' }),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'terms',
    pathTemplate: '/terms',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Terms of Service' }),
    lane: 'diffable',
    viewports: ['phone'],
  },
  {
    slug: 'health-privacy',
    pathTemplate: '/health-privacy',
    params: [],
    readySignal: (page) => page.getByRole('heading', { name: 'Consumer Health Data Privacy Policy' }),
    lane: 'diffable',
    viewports: ['phone'],
  },
]

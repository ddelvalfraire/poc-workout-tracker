# Plan: TanStack Query Adoption (client-side server state)

## Summary
Install @tanstack/react-query v5 and migrate the client-side server-state we've been hand-rolling — starting with the logger's last-performance ghost fetches, which currently use a bespoke `requestedRef` dedupe cache + manual state map. Server components stay server components; the draft sync queue stays (latest-wins supersede + save barrier aren't Query mutation semantics). This lays the provider infrastructure the stats phase and focus-refetch (seeing MCP edits) will build on.

## Scope
- `npm i @tanstack/react-query`
- `src/app/providers.tsx` (CREATE): 'use client'; `getQueryClient()` per current official docs — fresh client per server request, browser singleton, NOT useState-wrapped. Defaults: `staleTime: 30_000`, `refetchOnWindowFocus: true`, `retry: 1`.
- `src/app/layout.tsx` (UPDATE): wrap children inside ClerkProvider with `<Providers>`.
- `src/app/workout/new/workout-logger.tsx` (UPDATE): replace `lastByExercise` state + `requestedRef` + fetch effect with `useQueries` over the distinct exercise ids — `queryKey: ['last-performance', id, workoutId ?? null]`, `queryFn: () => getLastPerformanceAction(id, workoutId)`, `staleTime: Infinity` (ghosts are session-stable; preserves current behavior), derive the id→performance map from results.

## NOT migrating (and why)
- **Draft sync queue** — mutations in Query queue up; a draft snapshot needs latest-wins supersede + the settle() save barrier. Revisit only if logging moves to per-set server mutations.
- **Draft restore** — one-shot apply-to-state on mount; useQuery adds ceremony without value.
- **RSC pages** (history, program pages) — server components don't use Query; converting them to client fetching would be an architecture regression. Prefetch+HydrationBoundary becomes relevant with the stats dashboard.

## Validation
`tsc --noEmit` · scoped eslint · `npm test` · `npm run build` · e2e `last-time.spec.ts` + `workout.spec.ts` (ghosts + draft flow are the behaviors touched).

## Risks
- Bundle: +~11-12 kb gz on app pages — within the 300 kb app-page budget.
- `useQueries` result identity churn re-rendering the logger — memoize the derived map.

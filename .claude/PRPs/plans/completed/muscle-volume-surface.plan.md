# Plan: Weekly Muscle Volume — Phase 2: /stats Surface + Home Teaser

## Summary
`/stats`: StatTiles (sets/sessions with vs-last-week delta), a horizontal grouped bar chart (current volt vs previous muted, per muscle group), low-volume flags, and a rolling⇄calendar window toggle carrying the client tz offset in URL state. Home gains a compact "This week" teaser card linking to it.

## Metadata
Complexity: Medium · Source PRD: weekly-muscle-volume.prd.md (Phase 2) · Files: 6

## Key context (all in-session)
- Data: `getMuscleVolume(userId, volumeWindows(mode, now, tz))` (PR #63); groups in fixed order + optional Other; totals { currentSets, previousSets, currentSessions }.
- URL state: `?window=calendar&tz=<getTimezoneOffset()>` — tz only meaningful in calendar mode; rolling is the no-param default. Toggle must be a client island (only the client knows its offset). Bad params degrade to defaults (page-param precedent, exercises/[source]/[id]).
- Chart: shadcn primitive (components/ui/chart.tsx); two series → legend required (dataviz rule); horizontal layout (`layout="vertical"` in recharts terms) fits 10–11 rows on a phone; current = var(--primary), previous = muted token.
- Tiles: StatTile (dt/dd internals — wrap grid in <dl>); sets delta uses NEUTRAL tone with signed "vs last week" text (volume up isn't unconditionally good).
- Low-volume rule (pure, tested): groups with current < 10 AND (current > 0 OR previous > 0) — "active but under floor"; wholly untrained groups aren't nagged. `LOW_VOLUME_FLOOR = 10` documented const.

## Files
1. `src/app/stats/volume-view.ts` (+ test) — `lowVolumeGroups(groups, floor)`, `setsDeltaLabel(current, previous)` pure helpers.
2. `src/components/charts/volume-bar-chart.tsx` — client island: ChartContainer + BarChart layout=vertical, YAxis category (group), two Bars w/ legend + tooltip; height scales with row count.
3. `src/app/stats/window-toggle.tsx` — client island: two pill links (Rolling 7d default / Calendar wk) built with the live tz offset; current mode highlighted.
4. `src/app/stats/page.tsx` — server: parse `window`/`tz` (defaults rolling/0; `/^-?\d+$/` guard, clamp ±16h), getMuscleVolume, AppHeader "This week" + back, tiles (Sets w/ delta, Sessions), low list, chart, empty state when no sets in either window.
5. `src/app/page.tsx` — teaser card after quick links: "This week — N sets · M sessions" + chevron link to /stats (rolling data, one extra read).

## NOT building
Custom floors, per-group drill-down, monthly trends, MCP exposure.

## Validation
npm test · eslint · build; manual: toggle switches (tz visible in URL), chart renders both series, flags correct, teaser links.

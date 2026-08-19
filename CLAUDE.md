# Design

- All list/detail surface work must follow the review contract in [DESIGN.md](DESIGN.md) — especially the "De-card vocabulary" section (hairlines not shells, one volt, keep-list, lint ratchet).
- Every component in `src/components/**` has a `.stories.tsx` beside it. New components ship with one; changed components get their stories updated in the same PR. `npm run storybook`.
- Colour, radius, touch targets, motion, type scale and layout constants live ONLY in `src/design/tokens.ts`. Never hardcode them, and never edit a generated file (`src/app/tokens.generated.css`, `design/generated/DesignTokens.{swift,kt}`) — edit the source and run `npm run tokens`. `npm run tokens:check` guards the three against drift.

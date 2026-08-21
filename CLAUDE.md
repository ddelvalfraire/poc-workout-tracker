# Design

- All list/detail surface work must follow the review contract in [DESIGN.md](DESIGN.md) — especially the "De-card vocabulary" section (hairlines not shells, one volt, keep-list, lint ratchet).
- Every component in `src/components/**` has a `.stories.tsx` beside it. New components ship with one; changed components get their stories updated in the same PR. `npm run storybook`.
- Colour, radius, touch targets, motion, type scale and layout constants live ONLY in `src/design/tokens.ts`. Never hardcode them, and never edit a generated file (`src/app/tokens.generated.css`, `design/generated/DesignTokens.{swift,kt}`) — edit the source and run `npm run tokens`. `npm run tokens:check` guards the three against drift.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

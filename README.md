A workout tracking PWA: programs, logging, autoregulation, progress photos,
stats, and an AI coach — plus an MCP server so agents can log and query
training directly. Built on Next.js (App Router), Postgres via Drizzle,
and WorkOS AuthKit.

## Tech stack

- **Framework**: Next.js (App Router) + React, TypeScript
- **Auth**: WorkOS AuthKit
- **Database**: Postgres (Supabase) via Drizzle ORM
- **Cache**: Upstash Redis (optional — exercise catalog)
- **Storage**: Supabase Storage (progress photos)
- **Billing**: RevenueCat
- **AI coach**: Vercel AI SDK, OpenRouter or Vercel AI Gateway
- **MCP server**: `@modelcontextprotocol/sdk` (`/api/mcp`)
- **Testing**: Vitest (unit), Playwright (e2e), Stryker (mutation)
- **PWA**: Serwist service worker

## Getting Started

1. Copy `.env.example` to `.env.local` and fill in the variables you need.
   Every variable is documented inline — most integrations (Redis, Sentry,
   PostHog, the AI coach, `/ops`) are optional and degrade gracefully when
   unset. WorkOS and `DATABASE_URL`/`DATABASE_URL_DIRECT` are required.
2. Push the schema to your database:

   ```bash
   npm run db:push
   ```

3. Run the development server:

   ```bash
   npm run dev
   ```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load its type pairing (Oswald + Inter), declared once in `src/app/fonts.ts`.

## Testing

```bash
npm run test        # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright)
npm run lint         # ESLint
```

## Design system

The design contract is [DESIGN.md](DESIGN.md); Storybook is its reference
implementation.

```bash
npm run storybook        # component catalog on :6006
npm run build-storybook  # static build
```

Every component in `src/components/**` has a `.stories.tsx` beside it. The
"Design/" section renders the token tables and the de-card review contract as
live pages.

### Design tokens

Colour, radius, touch targets, motion, type scale and layout constants live in
**one** file, `src/design/tokens.ts`, which generates all three platforms:

```bash
npm run tokens        # regenerate
npm run tokens:check  # fail on drift (wire into CI)
```

| Output | Platform |
|---|---|
| `src/app/tokens.generated.css` | Web — imported by `globals.css` |
| `design/generated/DesignTokens.swift` | iOS — SwiftUI |
| `design/generated/DesignTokens.kt` | Android — Jetpack Compose |

Never edit a generated file. Edit `tokens.ts` and regenerate.

## MCP Agent Server

This app exposes its workout data to AI agents over the [Model Context Protocol](https://modelcontextprotocol.io) — so you can log and review training by talking to an agent instead of tapping the UI.

- **Endpoint**: `https://<your-deployment>/api/mcp` (Streamable HTTP transport). Locally it's `http://localhost:3000/api/mcp` once `npm run dev` is running.
- **Warning — no auth (POC)**: the endpoint is **public and unauthenticated by design** — see "What We're NOT Building" in `.claude/PRPs/prds/mcp-agent-server.prd.md`. It is **not production-safe**; don't point it at real multi-user data.

### Target user

There's no auth, so every data tool needs to know *whose* data to touch. It's resolved in this order:

1. A `userId` argument passed to the tool, else
2. the `MCP_DEV_USER_ID` environment variable.

Set `MCP_DEV_USER_ID` to your own user id so "add my workout" needs no id. The `workout://{id}` resource has no argument, so it always uses `MCP_DEV_USER_ID`.

### Connecting Claude

Add the endpoint as a remote MCP server (e.g. in Claude's connectors/MCP settings, "Add a custom server" by URL):

```
https://<your-deployment>/api/mcp
```

Then ask the agent to list tools — you should see `ping`, `whoami`, and the workout tools below.

### Tools & resources

| Tool | Purpose |
| --- | --- |
| `ping` | Liveness check — returns `pong`. |
| `whoami` | Returns the resolved target `userId` (arg, else `MCP_DEV_USER_ID`). Confirm this before any write. |
| `list_workouts` | The user's workouts, most recent first, with exercise/set counts. |
| `get_workout` | One workout with exercises and sets (weights in the user's unit) and a per-exercise estimated 1RM. |
| `search_exercises` | Search the public exercise catalog to resolve a name to its `wgerExerciseId`. |
| `get_last_performance` | The user's most recent prior performance of an exercise — "what did I do last time?". |
| `get_weight_unit` | The user's stored weight unit (`kg` or `lb`). |
| `create_workout` | Log a new workout. Weights are given in the user's unit (or a `unit` arg) and stored as kg. |
| `update_workout` | Full replace of an existing workout's exercises/sets. |
| `delete_workout` | Delete a workout and its sets. |
| `set_weight_unit` | Set the user's stored weight unit (`kg` or `lb`). |

| Resource | Purpose |
| --- | --- |
| `workout://{id}` | Read a single workout by URI — same payload as `get_workout`, for the `MCP_DEV_USER_ID` user. |

> Weights are entered/returned in the user's display unit and stored canonically in **kg**; every tool echoes the `userId` and `unit` it used so the agent can confirm.

### Example loop

A read → create → read round-trip an agent can run:

1. `whoami` → confirm the target user.
2. `search_exercises({ "search": "bench" })` → get the `wgerExerciseId` for Bench Press.
3. `create_workout({ "exercises": [{ "wgerExerciseId": 73, "name": "Bench Press", "sets": [{ "reps": 5, "weight": 100 }] }] })` → returns the new `workoutId`.
4. `get_workout({ "id": "<workoutId>" })` (or read `workout://<workoutId>`) → confirm the persisted rows.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

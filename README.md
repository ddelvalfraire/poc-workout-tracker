This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

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

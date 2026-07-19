# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run dev          # Start dev server (nodemon watches src/server/, runs vinxi dev)
pnpm run build        # Production build — runs scripts/build.bat (Windows only)
pnpm run lint         # ESLint over src/
pnpm run typecheck    # tsc --noEmit
pnpm run generate     # Regenerate Prisma client after schema changes
pnpm run knip         # Find unused exports and dependencies
```

No test suite exists. The app runs on `http://localhost:2500` in dev.

## Architecture

Elohr is a **SolidStart** (SolidJS + Vinxi) full-stack HR system with a Discord bot, JWT auth, tRPC API, and MongoDB via Prisma.

### Request lifecycle

```
Browser → SolidStart middleware (src/server/middleware/index.ts)
  → requestLogger → validateToken → validatePayload
  → tRPC handler at /api/trpc/[trpc].ts
  → appRouter (auth / attendance / admin / recordings)
```

Each tRPC call passes through `createContext` ([src/server/api/context.ts](src/server/api/context.ts)), which extracts and decodes the JWT from the `Authorization` header.

### tRPC procedure tiers

Defined in [src/server/api/trpc.ts](src/server/api/trpc.ts):

- `publicProcedure` — no auth
- `authProcedure` — valid JWT with non-expired token and linked `discordId`
- `adminProcedure` — auth + `ADMIN` role

Input validation uses **valibot** (not zod). SSE subscriptions are supported natively via the tRPC SSE transport configured in `t`.

### Database layer

`src/server/db/` exports all DB functions. The Prisma client is a plain singleton (`src/server/db/connection.ts`). Key modules:

- `attendances.ts` — login/logout logic, break tracking, availability heatmap, leave queries. Also exports the `AttendanceEventEmitter` singleton (stored on `global._attendanceEventsGlobal` to survive hot reloads).
- `users.ts` — user CRUD, Discord ID lookups
- `wrapped.ts` — year-in-review stats computation

**Bangladesh weekend convention** used throughout: Friday (5) and Saturday (6) are weekend days; the working week is Sunday–Thursday.

### Discord bot

Initialized in `src/server/services/discord/index.ts`. The Discord client is also a global singleton (`global._discordClientGlobal`).

On startup `initializeDiscord()`:
1. Logs in with `DISCORD_BOT_TOKEN`
2. Registers slash commands (`/hr`, `/availability`, `/record`)
3. Attaches voice state and interaction event handlers
4. Starts cron jobs

**Voice-to-attendance flow** (production only): when a user joins/leaves a non-AFK voice channel, `handleVoiceStateChange` queues a login or logout action with a configurable delay (`VOICE_CHANNEL_ATTENDANCE_DELAY_IN_SECONDS`). The queue per user ensures serialized execution.

**Cron jobs** (`cron-jobs.ts`): auto-logout at 23:59 daily; weekly attendance report to admin on Thursdays.

**Interaction routing** (`interaction-handlers/index.ts`): `/availability` and `/record` work server-wide; `/hr` is restricted to the attendance channel.

**Recording subsystem** (`src/server/services/discord/recording/`): voice channel recording with live transcription (Gemini) and session summaries. Organized into `runtime/` (session lifecycle) and `processing/` (audio merge, transcription, formatting).

### Frontend

SolidStart file-based routing under `src/routes/`:

- `index.tsx` — login/home entry
- `home.tsx` — main HR dashboard
- `wrapped.tsx` — year-in-review page
- `recordings/` — recording list and detail pages

Client-side state is managed with SolidJS stores in `src/store/`:
- `user.store.ts` — current user + attendance state, admin user list
- Attendance updates arrive via a tRPC SSE subscription (`attendanceChanged`) and are pushed into the store

The tRPC client (`src/lib/api.ts`) splits subscriptions onto `httpSubscriptionLink` (with `EventSourcePolyfill`) and batches queries/mutations onto `httpBatchLink`. Auth token is attached to every request via the `Authorization` header.

### Key environment variables

| Variable | Purpose |
|---|---|
| `DB_URL` | MongoDB connection string |
| `JWT_SECRET` | Signs/verifies auth tokens |
| `DISCORD_BOT_TOKEN` | Discord bot login |
| `DISCORD_SERVER_ID` | Guild ID |
| `BOT_ID` | Application/bot user ID |
| `ATTENDANCE_CHANNEL_ID` | Production Discord channel for attendance commands |
| `TEST_CHANNEL_ID` | Dev channel used when `NODE_ENV !== production` |
| `VOICE_CHANNEL_ATTENDANCE_DELAY_IN_SECONDS` | Debounce before acting on voice events |
| `FRONTEND_URL` | Used server-side to build absolute URLs in production |
| `STATUS_TAG_AVAILABLE` / `STATUS_TAG_ERROR` | Emoji prefixes for Discord messages |

Copy `.env.example` to `.env` before starting.

## Code conventions

- No `as` or `any` casts unless absolutely necessary
- Descriptive variable names, DRY code
- Prisma schema is in `prisma/schema.prisma`; run `pnpm generate` after any schema edit
- Global singletons (Discord client, AttendanceEventEmitter) are stored on `global.*` to survive Vinxi/nodemon hot reloads — follow this pattern for any new server-side singleton

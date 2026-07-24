# Lottes Project

A household chores web app: recurring task scheduling, assignment across household
members, and timed reminders. Personal-scale (a handful of users), self-funded, and
must stay on free tiers.

**Status: scaffold only.** The product spec has not landed yet. Do not build domain
features, schema, or UI beyond what a task explicitly asks for.

## Stack

| Layer | Choice |
| --- | --- |
| Client | React 19 + Vite, Tailwind v4 |
| Server | Hono on Cloudflare Workers (`src/worker`) |
| Database | Cloudflare D1 (SQLite) via Drizzle — not wired up yet |
| Scheduling | Workers Cron Triggers — not wired up yet |
| Tooling | pnpm, Biome (lint + format), Vitest, TypeScript project references |

Deferred until the spec lands, deliberately: TanStack Router, TanStack Query,
Drizzle schema, Better Auth, Web Push. Do not add them speculatively.

## Layout

```
src/client/   React app.       Browser only. Never import from src/worker.
src/worker/   Hono API.        Workers runtime only. Never import from src/client.
src/shared/   Domain logic.    Pure TypeScript, importable by both.
```

Each has its own tsconfig; `src/shared` is compiled by both. The one-way import rule
is a real constraint — client code cannot use Workers APIs and vice versa.

## Commands

```
pnpm dev        # Vite + workerd together; API and client on one origin
pnpm verify     # typecheck + lint + test. Run before declaring anything done.
pnpm test       # vitest run
pnpm check      # biome check --write (fixes formatting and imports)
```

## Conventions

**TypeScript strictness is not negotiable.** `strict`, `noUncheckedIndexedAccess`,
and `noImplicitOverride` are on in `tsconfig.base.json`. Never weaken a compiler
flag to make an error go away, and never reach for `any` or a cast to silence the
checker — fix the type. `noExplicitAny` is a Biome error, not a warning.

**Domain logic lives in `src/shared` and stays pure.** Recurrence and date math take
their inputs explicitly — including the current time and the user's IANA timezone —
and touch no database, no network, and no ambient clock. Never call `Date.now()` or
`new Date()` inside domain functions; pass the instant in. This is what makes DST
and month-boundary behaviour testable.

**Test the domain hard, the plumbing lightly.** Recurrence, scheduling, and timezone
math get thorough unit tests including edge cases. CRUD endpoints do not need tests
asserting that an insert inserts.

**Timezones.** Store instants as UTC epoch milliseconds. Store each user's IANA zone
alongside. All day-boundary logic ("due today", "8am reminder") happens in the user's
zone, in TypeScript, never in SQL.

**D1 has no interactive transactions.** Anything that must be atomic goes in a single
`db.batch()`. Two `batch()` calls are two transactions. Read-compute-write sequences
need optimistic concurrency (a version column) or idempotent writes — assume nothing
about ordering. Keep to well under 50 D1 queries per Worker invocation (free-plan
cap); batch rather than looping queries per row.

**Free tier is a design constraint**, not a preference. Before adding a dependency or
a service, confirm it stays free at household scale.

## Working agreements

- Plan before non-trivial work. Schema and recurrence design get reviewed before code.
- Small commits that each leave the app working.
- Library APIs change faster than model training data. Check the docs before asserting
  how D1, Wrangler, Hono, or Tailwind v4 behave — do not answer from memory.
- Prefer the simple version. This is a household app, not a platform. Push back on
  abstraction that has no second caller yet.
- `pnpm verify` must pass before saying a task is done. If it did not run, say so.

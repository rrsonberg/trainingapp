# Coach App — Expo client

The client-facing mobile app. Compiles to real iOS and Android binaries.
Talks to the same Supabase project as the Lovable trainer console.

## What's here

| Path | What it is |
|---|---|
| `src/lib/localdb.ts` | Local SQLite store. **The app reads from here, always.** |
| `src/lib/outbox.ts` | Durable write queue with idempotent replay and backoff |
| `src/lib/supabase.ts` | Server client — used only by sync, never by components |
| `src/lib/units.ts` | SI storage, display conversion at render |
| `src/types/sessions.ts` | The 14 session types and their typed parameters |
| `src/repositories/sessions.ts` | Offline-first session CRUD + load-balance query |
| `src/theme.ts` | Design tokens |
| `app/log-recovery.tsx` | Working recovery logging screen |

## Setup

```bash
npm install
cp .env.example .env      # fill in your Supabase URL and anon key
npx expo start
```

Requires `schema.sql` already deployed to the Supabase project.

## The one rule

**Never call `supabase` from a component.** Components call repositories,
repositories write to SQLite and enqueue, the outbox syncs. If a screen awaits
the network to show or accept data, you have reintroduced the exact defect
this architecture exists to prevent.

## Not built yet

- Auth + tenant context (screens currently use placeholder IDs)
- Pull-side sync (`src/lib/sync.ts`) — outbox is push only so far
- Strength logger
- HealthKit read + historical backfill
- Daily check-in and readiness scoring
- watchOS companion

## Next commits, in order

1. Auth context, replacing the placeholder tenant/client IDs
2. Pull sync with `last_pulled_at` watermarks per table
3. Network listener that drains the outbox on reconnect + app foreground
4. Stuck-write UI — surface `getStuckWrites()` rather than dropping data
5. Strength logger
6. HealthKit

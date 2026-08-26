# Coach App — Expo client

The client-facing mobile app. Compiles to real iOS and Android binaries.
Talks to the same Supabase project as the Lovable trainer console.

## What's here

| Path | What it is |
|---|---|
| `src/lib/localdb.ts` | Local SQLite store. **The app reads from here, always.** |
| `src/lib/outbox.ts` | Durable write queue with idempotent replay and backoff |
| `src/lib/supabase.ts` | Server client — used only by sync, never by components |
| `src/lib/auth.tsx` | Session + tenant/client identity, resolved from JWT claims |
| `src/lib/sync.ts` | Pull sync with per-table watermarks; dirty rows are never clobbered |
| `src/lib/syncRunner.tsx` | When to sync: mount, foreground, reconnect. Single-flight |
| `src/lib/health.ts` | HealthKit reads — permissions, recent sync, historical backfill |
| `src/lib/units.ts` | SI storage, display conversion at render |
| `src/types/sessions.ts` | The 14 session types and their typed parameters |
| `src/repositories/sessions.ts` | Offline-first session CRUD + load-balance query |
| `src/repositories/biometrics.ts` | Offline-first biometric writes, baselines, daily nutrition |
| `src/theme.ts` | Design tokens |
| `app/_layout.tsx` | Root layout and redirect-based auth gate |
| `app/sign-in.tsx` | Email and password sign-in |
| `app/log-recovery.tsx` | Working recovery logging screen |
| `app/pending-writes.tsx` | The outbox made visible — stuck writes and retry |
| `app/connect-health.tsx` | HealthKit permission + backfill onboarding |

## Setup

```bash
npm install
cp .env.example .env      # fill in your Supabase URL and anon key
npx expo start
```

Requires `schema.sql` already deployed to the Supabase project.

Sign-in expects each account's JWT to carry a `tenant_id` claim (and optionally
`client_id`) in **`app_metadata`** — set it server-side when a coach creates the
client. Without it the app refuses the session rather than writing rows that
belong to no tenant. If your backend stores identity elsewhere, change
`identityFromUser` in `src/lib/auth.tsx`; nothing else reads those claims.

## The one rule

**Never call `supabase` from a component.** Components call repositories,
repositories write to SQLite and enqueue, the outbox syncs. If a screen awaits
the network to show or accept data, you have reintroduced the exact defect
this architecture exists to prevent.

The corollary on the read side: **a pull never overwrites a dirty row.** A dirty
row is a write the user made that has not reached the server. Sync skips it and
lets the outbox resolve it on push. Clean rows lose to the server on
`updated_at`.

## Not built yet

- Strength logger
- Daily check-in and readiness scoring
- watchOS companion

## Next commits, in order

1. Strength logger
2. Daily check-in and readiness scoring

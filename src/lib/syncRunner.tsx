/**
 * Sync runner — decides WHEN to sync. sync.ts decides what syncing means.
 *
 * Three triggers, because there are three moments a client's data goes stale
 * without anyone touching the screen:
 *
 *   - sign-in / mount   the first run, forced
 *   - app foreground    they came back to the app
 *   - reconnect         the false -> true edge only
 *
 * That last one is the reason this file exists. A phone in a gym basement
 * queues writes for an hour; the moment signal returns, the outbox should
 * drain without the user knowing there was anything to drain.
 *
 * ONE GUARD, and it is not optional: single flight. Two concurrent runs would
 * both call drainOutbox, and the outbox is explicitly order-sensitive — a set
 * cannot sync before its session. Callers arriving mid-run join the run in
 * progress instead of starting a second one.
 *
 * The throttle is separate from the guard: a foreground bounce every few
 * seconds should not hammer the server. Reconnects and the first run bypass it,
 * because those are the cases where data is genuinely waiting.
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { syncNow } from './sync';
import { onOutboxChanged, pendingCount } from './outbox';
import { useAuth } from './auth';

const MIN_INTERVAL_MS = 15_000;

export type SyncPhase = 'idle' | 'syncing' | 'error';

type SyncValue = {
  phase: SyncPhase;
  /** Epoch ms of the last successful run, or null if none has succeeded yet. */
  lastSyncedAt: number | null;
  lastError: string | null;
  /** Rows still waiting in the outbox. */
  pending: number;
  online: boolean;
  sync: (opts?: { force?: boolean }) => Promise<void>;
  refreshPending: () => Promise<void>;
};

const SyncContext = createContext<SyncValue | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  // Deliberately useAuth, not useIdentity: this provider stays mounted across
  // sign-out so the navigator underneath it is never torn down and rebuilt.
  // With no identity it simply does nothing.
  const { identity } = useAuth();
  const clientId = identity?.clientId ?? null;

  const [phase, setPhase] = useState<SyncPhase>('idle');
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(true);

  const inFlight = useRef<Promise<void> | null>(null);
  const lastRunAt = useRef(0);
  const mounted = useRef(true);

  const refreshPending = useCallback(async () => {
    try {
      const n = await pendingCount();
      if (mounted.current) setPending(n);
    } catch {
      // The badge is not worth an error state. Leave the last known count.
    }
  }, []);

  const sync = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!clientId) return;
      if (inFlight.current) return inFlight.current;

      if (!opts?.force && Date.now() - lastRunAt.current < MIN_INTERVAL_MS) return;

      const run = (async () => {
        if (mounted.current) {
          setPhase('syncing');
          setLastError(null);
        }
        try {
          const result = await syncNow(clientId);
          if (mounted.current) {
            setLastSyncedAt(Date.now());
            // A drain that stopped on a rejection is not a successful sync.
            // Reporting "synced" here is how a blocked queue stays invisible.
            if (result.push.failed > 0 && result.push.lastError) {
              setPhase('error');
              setLastError(result.push.lastError);
            } else if (result.pull.failures.length > 0) {
              // Partial pull. Say so rather than reporting a clean sync over a
              // table that never came down.
              setPhase('error');
              setLastError(result.pull.failures[0]);
            } else {
              setPhase('idle');
            }
          }
        } catch (e: any) {
          // A failed sync is not a failed app. The data is still on disk and
          // the next trigger will try again — surface it, do not throw.
          if (mounted.current) {
            setLastError(e?.message ?? 'Could not sync. Your data is saved on this device.');
            setPhase('error');
          }
        } finally {
          // Stamped on both paths so a server that is down cannot turn every
          // foreground into a retry storm.
          lastRunAt.current = Date.now();
          inFlight.current = null;
          await refreshPending();
        }
      })();

      inFlight.current = run;
      return run;
    },
    [clientId, refreshPending]
  );

  useEffect(() => {
    mounted.current = true;
    if (!clientId) return;

    void refreshPending();
    void sync({ force: true });

    const appSub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next === 'active') void sync();
    });

    // A queued write is the fourth trigger. Without it a client who logs a set
    // and stays on the screen sees nothing move until they background the app.
    // Not forced: the throttle is what stops a fast logger from firing a sync
    // per set, and the count still refreshes immediately either way.
    const unsubscribeOutbox = onOutboxChanged(() => {
      void refreshPending();
      void sync();
    });

    // Seeded true so the first event cannot masquerade as a reconnection.
    let wasOnline = true;
    const unsubscribeNet = NetInfo.addEventListener((state) => {
      // isInternetReachable is null while the probe is still out. Treating null
      // as offline would flap the indicator on every network change.
      const nowOnline = Boolean(state.isConnected) && state.isInternetReachable !== false;
      if (mounted.current) setOnline(nowOnline);

      // The false -> true edge only. A connected device emits plenty of events
      // that are not a reconnection, and each one would otherwise force a run.
      if (nowOnline && !wasOnline) void sync({ force: true });
      wasOnline = nowOnline;
    });

    return () => {
      mounted.current = false;
      appSub.remove();
      unsubscribeNet();
      unsubscribeOutbox();
    };
  }, [clientId, sync, refreshPending]);

  return (
    <SyncContext.Provider
      value={{ phase, lastSyncedAt, lastError, pending, online, sync, refreshPending }}
    >
      {children}
    </SyncContext.Provider>
  );
}

export function useSync(): SyncValue {
  const v = useContext(SyncContext);
  if (!v) throw new Error('useSync must be used inside <SyncProvider>.');
  return v;
}

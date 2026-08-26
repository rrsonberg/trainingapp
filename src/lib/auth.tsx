/**
 * Auth and tenant context.
 *
 * Two jobs, and the second is the one that matters. First, hold the Supabase
 * session. Second, resolve the tenant and client identity that every repository
 * write is keyed by — and have it ready on a cold launch with no network,
 * because clients open this app in gym basements.
 *
 * Identity resolves in two steps, cheapest first.
 *
 * 1. JWT claims, if the backend provisions them. Free and offline.
 * 2. Otherwise a `memberships` lookup — profile_id = auth.uid(), role 'client',
 *    status 'active' — which is the shape the trainer console already uses and
 *    the only one that works against the deployed schema. Verified: zero of the
 *    fifteen accounts carry a tenant claim, and all fifteen have a membership.
 *
 * The lookup costs one round trip, so it runs ONLY when the cache is empty —
 * which in practice means at sign-in, where the network is required anyway. A
 * cold launch reads the cached identity and never touches the network, which is
 * what keeps the launch path clear of the defect this codebase exists to avoid.
 *
 * A network failure during the lookup is NOT treated as "no membership". The
 * former is temporary and must not sign anyone out; only an authoritative empty
 * result refuses.
 */

import {
  createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

const IDENTITY_KEY = 'coach.identity.v1';

export type Identity = {
  userId: string;
  tenantId: string;
  clientId: string;
  email: string | null;
};

export type AuthStatus = 'loading' | 'signedOut' | 'signedIn';

type AuthValue = {
  status: AuthStatus;
  identity: Identity | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Step 1 — tenant straight out of the token, when it is there.
 *
 * `app_metadata` only. `user_metadata` is writable by the account holder, so
 * trusting it for a tenant id would let one client write rows into another's
 * tenant. `client_id` falls back to the auth uid, which is correct here:
 * profiles.id IS the auth uid, and sessions.client_id references profiles.id.
 */
export function identityFromUser(user: User): Identity | null {
  const app = (user.app_metadata ?? {}) as Record<string, unknown>;

  const tenantId = str(app.tenant_id);
  if (!tenantId) return null;

  return {
    userId: user.id,
    tenantId,
    clientId: str(app.client_id) ?? user.id,
    email: user.email ?? null,
  };
}

/** Distinguishes "this account has no tenant" from "the network is down". */
type Resolution =
  | { kind: 'identity'; identity: Identity }
  | { kind: 'noTenant' }
  | { kind: 'unavailable' };

/**
 * Step 2 — the membership lookup.
 *
 * One row, one round trip, and only when nothing is cached. `.limit(1)` with a
 * stable order rather than `.single()`: a client belonging to two tenants is a
 * data question, not a reason to refuse them entry to the app.
 */
async function identityFromMembership(user: User): Promise<Resolution> {
  const { data, error } = await supabase
    .from('memberships')
    .select('tenant_id')
    .eq('profile_id', user.id)
    .eq('role', 'client')
    .eq('status', 'active')
    .is('deleted_at', null)
    .order('created_at', { ascending: true })
    .limit(1);

  // An error here is transport, not verdict. Saying "no tenant" on a dropped
  // connection would sign out a client standing in a gym with bad signal.
  if (error) return { kind: 'unavailable' };

  const tenantId = str(data?.[0]?.tenant_id);
  if (!tenantId) return { kind: 'noTenant' };

  return {
    kind: 'identity',
    identity: {
      userId: user.id,
      tenantId,
      clientId: user.id,
      email: user.email ?? null,
    },
  };
}

async function resolveIdentity(user: User): Promise<Resolution> {
  const claimed = identityFromUser(user);
  if (claimed) return { kind: 'identity', identity: claimed };
  return identityFromMembership(user);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read inside apply() without making it a dependency — apply is wired to
  // onAuthStateChange, and re-subscribing on every identity change would churn.
  const identityRef = useRef<Identity | null>(null);
  identityRef.current = identity;

  const apply = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setIdentity(null);
      setStatus('signedOut');
      await AsyncStorage.removeItem(IDENTITY_KEY);
      return;
    }

    const resolved = await resolveIdentity(session.user);

    if (resolved.kind === 'noTenant') {
      // Authenticated, but linked to no tenant. Refusing is deliberate: letting
      // them in would produce sessions and biometrics that belong to nobody and
      // cannot be repaired after the fact.
      setError(
        'This account is not linked to a coach yet. Ask your coach to finish setting it up.'
      );
      setIdentity(null);
      setStatus('signedOut');
      await AsyncStorage.removeItem(IDENTITY_KEY);
      await supabase.auth.signOut();
      return;
    }

    if (resolved.kind === 'unavailable') {
      // Could not ask. Keep whatever we already had — a cached identity from a
      // previous launch stays valid, and a fresh sign-in simply reports that it
      // could not finish rather than pretending the account is unlinked.
      if (!identityRef.current) {
        setError('Could not reach your coach\u2019s workspace. Check your connection and try again.');
        setStatus('signedOut');
      }
      return;
    }

    setError(null);
    setIdentity(resolved.identity);
    setStatus('signedIn');
    await AsyncStorage.setItem(IDENTITY_KEY, JSON.stringify(resolved.identity));
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Cached identity first. This is the offline cold-launch path and the
      //    reason a client in a basement sees their screen instead of a spinner.
      try {
        const raw = await AsyncStorage.getItem(IDENTITY_KEY);
        if (raw && !cancelled) {
          const cached = JSON.parse(raw) as Identity;
          if (str(cached?.tenantId) && str(cached?.clientId)) {
            setIdentity(cached);
            setStatus('signedIn');
          }
        }
      } catch {
        // A corrupt cache is not a reason to block launch. Fall through to the
        // session read, which is authoritative anyway.
      }

      // 2. Reconcile against the persisted session. getSession reads local
      //    storage and does not require the network, so this stays offline-safe:
      //    an expired token still yields a session, and its claims still hold.
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      await apply(data.session);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      void apply(session);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [apply]);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const { error: e } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // onAuthStateChange applies the session; only the failure path is ours.
    if (e) {
      setError(e.message);
      throw e;
    }
  }, []);

  const signOut = useCallback(async () => {
    // Local rows stay on disk on purpose. Unsynced writes live in SQLite and
    // the outbox; clearing them here would discard a user's data to reclaim a
    // few hundred kilobytes. A deliberate device-handoff flow can purge, once
    // one exists and can warn about pending writes first.
    setError(null);
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ status, identity, error, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>.');
  return v;
}

/**
 * For screens behind the gate, where identity is guaranteed. Saves every
 * screen a null check that could only ever fail as a routing bug.
 */
export function useIdentity(): Identity {
  const { identity } = useAuth();
  if (!identity) {
    throw new Error(
      'useIdentity was called outside the auth gate. Render this screen under app/_layout.tsx.'
    );
  }
  return identity;
}

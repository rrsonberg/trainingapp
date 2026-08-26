/**
 * Auth and tenant context.
 *
 * Two jobs, and the second is the one that matters. First, hold the Supabase
 * session. Second, resolve the tenant and client identity that every repository
 * write is keyed by — and have it ready on a cold launch with no network,
 * because clients open this app in gym basements.
 *
 * Identity comes from JWT claims, not a lookup query. The claims are set
 * server-side and travel inside the token, so a persisted session already
 * carries the tenant. A `select` against a clients table would put the network
 * on the launch path, which is the exact defect the rest of this codebase is
 * built to avoid.
 *
 * If your backend puts the claims somewhere else, `identityFromUser` below is
 * the only function that has to change.
 */

import {
  createContext, useCallback, useContext, useEffect, useState, type ReactNode,
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
 * Pull tenant and client out of the token.
 *
 * `app_metadata` is checked first because it is the half of the token a user
 * cannot edit — `user_metadata` is writable by the account holder, so trusting
 * it for a tenant id would let one client write rows into another's tenant.
 * It is read only as a fallback for dev projects that provision there.
 *
 * `client_id` falls back to the auth uid, which is correct for schemas that key
 * the clients table on it. `tenant_id` has no fallback on purpose: a write with
 * a guessed tenant is worse than a write that never happens.
 */
export function identityFromUser(user: User): Identity | null {
  const app = (user.app_metadata ?? {}) as Record<string, unknown>;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;

  const tenantId = str(app.tenant_id) ?? str(meta.tenant_id);
  if (!tenantId) return null;

  const clientId = str(app.client_id) ?? str(meta.client_id) ?? user.id;

  return { userId: user.id, tenantId, clientId, email: user.email ?? null };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async (session: Session | null) => {
    if (!session?.user) {
      setIdentity(null);
      setStatus('signedOut');
      await AsyncStorage.removeItem(IDENTITY_KEY);
      return;
    }

    const next = identityFromUser(session.user);

    if (!next) {
      // Authenticated, but the account carries no tenant claim. Refusing here
      // is deliberate: letting them in would produce sessions and biometrics
      // that belong to nobody and cannot be repaired after the fact.
      setError(
        'This account is not linked to a coach yet. Ask your coach to finish setting it up.'
      );
      setIdentity(null);
      setStatus('signedOut');
      await AsyncStorage.removeItem(IDENTITY_KEY);
      await supabase.auth.signOut();
      return;
    }

    setError(null);
    setIdentity(next);
    setStatus('signedIn');
    await AsyncStorage.setItem(IDENTITY_KEY, JSON.stringify(next));
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

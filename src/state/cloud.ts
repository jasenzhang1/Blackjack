/**
 * Accounts and cloud-saved stats (Supabase Auth + Postgres with row-level security).
 *
 * Data model (see supabase/schema.sql):
 *   user_stats    (user_id, data jsonb)               rules, prefs, cells, quiz, trainer, drills, watch
 *   user_sessions (user_id, id, report jsonb, ended)  one row per report card
 *
 * On sign-in the device's progress and the account's are merged (nothing is lost), written back to
 * both, and from then on every local save is pushed to the account (debounced).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { supabaseConfig } from '../supabase.config';
import type { SessionReport } from '../table/report';
import { mergeData, SYNC_KEYS, type Blob, type SyncKey } from './merge';
import { load, onSave, saveQuiet } from './storage';

export const cloudEnabled = Boolean(supabaseConfig.url && supabaseConfig.anonKey);

export interface CloudUser {
  uid: string;
  email: string | null;
  name: string | null;
  photo: string | null;
}

export interface CloudState {
  ready: boolean;
  user: CloudUser | null;
  syncing: boolean;
  lastSync: number | null;
  error: string | null;
  /** The user arrived from a password-reset email and should choose a new password. */
  recovery: boolean;
}

let state: CloudState = { ready: !cloudEnabled, user: null, syncing: false, lastSync: null, error: null, recovery: false };
const subs = new Set<() => void>();
function setState(p: Partial<CloudState>): void {
  state = { ...state, ...p };
  for (const s of subs) s();
}

export function useCloud(): CloudState {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => state,
  );
}

// ---- lazy client --------------------------------------------------------------------------------

let clientPromise: Promise<SupabaseClient> | null = null;
function client(): Promise<SupabaseClient> {
  clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      // PKCE returns "?code=…" in the query string, which leaves the app's #/route hash alone.
      auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
    }),
  );
  return clientPromise;
}

/** Where OAuth / email links should come back to (this page, without the #route). */
function returnUrl(): string {
  return window.location.origin + window.location.pathname;
}

const ROUTE_KEY = 'bjlab.returnRoute';

// ---- auth ---------------------------------------------------------------------------------------

export function initCloud(): void {
  if (!cloudEnabled) return;
  client()
    .then((sb) => {
      sb.auth.onAuthStateChange((event, session) => {
        const u = session?.user;
        const meta = (u?.user_metadata ?? {}) as Record<string, string | undefined>;
        const user = u ? { uid: u.id, email: u.email ?? null, name: meta.full_name ?? meta.name ?? null, photo: meta.avatar_url ?? meta.picture ?? null } : null;
        const changed = (user?.uid ?? null) !== (state.user?.uid ?? null);
        setState({ ready: true, user, recovery: event === 'PASSWORD_RECOVERY' ? true : state.recovery });
        if (changed) {
          // setTimeout: Supabase recommends not awaiting other calls inside this callback.
          if (user) window.setTimeout(() => void syncOnLogin(user.uid), 0);
          else stopAutoSync();
        }
        if (user) restoreRoute();
      });
    })
    .catch((e) => setState({ ready: true, error: friendly(e) }));
}

function restoreRoute(): void {
  try {
    const r = sessionStorage.getItem(ROUTE_KEY);
    if (r) {
      sessionStorage.removeItem(ROUTE_KEY);
      if (r !== window.location.hash) window.location.hash = r;
    }
    // Drop "?code=…" left over from the OAuth redirect.
    if (window.location.search) window.history.replaceState(null, '', returnUrl() + window.location.hash);
  } catch {
    /* ignore */
  }
}

export async function signInWithGoogle(): Promise<void> {
  const sb = await client();
  try {
    sessionStorage.setItem(ROUTE_KEY, window.location.hash);
  } catch {
    /* ignore */
  }
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: returnUrl() } });
  if (error) throw error;
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const sb = await client();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

/** Returns true when the project requires the user to confirm their email before signing in. */
export async function createAccount(email: string, password: string): Promise<boolean> {
  const sb = await client();
  const { data, error } = await sb.auth.signUp({ email, password, options: { emailRedirectTo: returnUrl() } });
  if (error) throw error;
  return !data.session;
}

export async function resetPassword(email: string): Promise<void> {
  const sb = await client();
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: returnUrl() });
  if (error) throw error;
}

export async function setNewPassword(password: string): Promise<void> {
  const sb = await client();
  const { error } = await sb.auth.updateUser({ password });
  if (error) throw error;
  setState({ recovery: false });
}

/** Signs out and clears the synced stats from this browser (they stay safe in the account). */
export async function signOutCloud(): Promise<void> {
  const sb = await client();
  await flush();
  stopAutoSync();
  currentUid = null;
  await sb.auth.signOut();
  for (const k of SYNC_KEYS) saveQuiet(k, undefined);
  window.dispatchEvent(new Event('bjlab-sync'));
}

export function friendly(e: unknown): string {
  const err = e as { code?: string; message?: string; status?: number };
  const msg = err?.message ?? '';
  const byCode: Record<string, string> = {
    invalid_credentials: 'Wrong email or password.',
    email_not_confirmed: 'Confirm your email first (check your inbox for the link).',
    user_already_exists: 'An account with this email already exists. Sign in instead.',
    weak_password: 'Use a stronger password (at least 6 characters).',
    over_email_send_rate_limit: 'Too many emails sent. Try again in a few minutes.',
    over_request_rate_limit: 'Too many attempts. Try again in a few minutes.',
    validation_failed: 'Check the email address and password.',
    provider_disabled: 'Google sign-in is not enabled for this site yet.',
    email_provider_disabled: 'Email sign-in is not enabled for this site yet.',
  };
  if (err?.code && byCode[err.code]) return byCode[err.code];
  if (/Invalid API key|No API key/i.test(msg)) return 'Accounts are misconfigured: the Supabase key is not valid.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Network error. Check your connection.';
  if (/row-level security|permission denied/i.test(msg)) return 'Your stats could not be saved: check the database policies (supabase/schema.sql).';
  if (/relation .* does not exist|Could not find the table/i.test(msg)) return 'The stats tables are missing: run supabase/schema.sql in the SQL editor.';
  return msg || 'Something went wrong.';
}

// ---- sync ---------------------------------------------------------------------------------------

function localBlob(): Blob {
  const b: Blob = {};
  for (const k of SYNC_KEYS) {
    const v = load<unknown>(k, undefined);
    if (v !== undefined) b[k] = v;
  }
  return b;
}

/** Session id → `end` timestamp as currently stored in the account. */
let pushedSessions = new Map<string, number>();

async function readCloud(uid: string): Promise<Blob> {
  const sb = await client();
  const out: Blob = {};
  const stats = await sb.from('user_stats').select('data').eq('user_id', uid).maybeSingle();
  if (stats.error) throw stats.error;
  const data = (stats.data?.data ?? null) as Partial<Record<SyncKey, unknown>> | null;
  if (data) Object.assign(out, data);
  const sess = await sb.from('user_sessions').select('id, report, ended').eq('user_id', uid);
  if (sess.error) throw sess.error;
  pushedSessions = new Map();
  const list: SessionReport[] = [];
  for (const row of sess.data ?? []) {
    list.push(row.report as SessionReport);
    pushedSessions.set(row.id as string, Number(row.ended));
  }
  if (list.length) out.sessions = list;
  return out;
}

async function writeCloud(uid: string, blob: Blob): Promise<void> {
  const sb = await client();
  const data: Partial<Record<SyncKey, unknown>> = {};
  for (const k of SYNC_KEYS) if (k !== 'sessions' && blob[k] !== undefined) data[k] = blob[k];
  const up = await sb.from('user_stats').upsert({ user_id: uid, data, updated_at: new Date().toISOString() });
  if (up.error) throw up.error;

  const sessions = (blob.sessions as SessionReport[] | undefined) ?? [];
  const changed = sessions.filter((s) => pushedSessions.get(s.id) !== s.end);
  if (changed.length) {
    // JSON round-trip drops `undefined` fields so the jsonb payload is clean.
    const rows = changed.map((s) => ({ user_id: uid, id: s.id, report: JSON.parse(JSON.stringify(s)), ended: s.end }));
    const r = await sb.from('user_sessions').upsert(rows);
    if (r.error) throw r.error;
  }
  const ids = new Set(sessions.map((s) => s.id));
  const gone = Array.from(pushedSessions.keys()).filter((id) => !ids.has(id));
  if (gone.length) {
    const d = await sb.from('user_sessions').delete().eq('user_id', uid).in('id', gone);
    if (d.error) throw d.error;
  }
  pushedSessions = new Map(sessions.map((s) => [s.id, s.end]));
}

let unsub: (() => void) | null = null;
let timer: number | null = null;
let currentUid: string | null = null;

async function syncOnLogin(uid: string): Promise<void> {
  currentUid = uid;
  setState({ syncing: true, error: null });
  try {
    const merged = mergeData(localBlob(), await readCloud(uid));
    for (const k of SYNC_KEYS) saveQuiet(k, merged[k]);
    window.dispatchEvent(new Event('bjlab-sync'));
    await writeCloud(uid, merged);
    setState({ syncing: false, lastSync: Date.now() });
    startAutoSync();
  } catch (e) {
    setState({ syncing: false, error: `Couldn't sync: ${friendly(e)}` });
  }
}

function startAutoSync(): void {
  stopAutoSync();
  unsub = onSave((key) => {
    if (!(SYNC_KEYS as readonly string[]).includes(key)) return;
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), 1500);
  });
}

function stopAutoSync(): void {
  unsub?.();
  unsub = null;
  if (timer) window.clearTimeout(timer);
  timer = null;
}

async function flush(): Promise<void> {
  if (!currentUid || !unsub) return;
  if (timer) window.clearTimeout(timer);
  timer = null;
  setState({ syncing: true });
  try {
    await writeCloud(currentUid, localBlob());
    setState({ syncing: false, lastSync: Date.now(), error: null });
  } catch (e) {
    setState({ syncing: false, error: `Couldn't save to your account: ${friendly(e)}` });
  }
}

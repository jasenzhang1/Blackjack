import { useEffect, useRef, useState } from 'react';
import { cloudEnabled, googleButtonEnabled, renderGoogleButton, createAccount, friendly, resetPassword, setNewPassword, signInWithEmail, signInWithGoogle, signOutCloud, useCloud } from '../state/cloud';
import { Modal } from './ui';

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/** Google's own button when it loads; otherwise our button using the redirect sign-in. */
function GoogleSignIn({ busy, onRedirect, onError }: { busy: boolean; onRedirect: () => void; onError: (msg: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(!cloudEnabled || !googleButtonEnabled);
  useEffect(() => {
    if (fallback || !ref.current) return;
    let live = true;
    renderGoogleButton(ref.current, ref.current.clientWidth || 360, (m) => live && onError(m)).catch(() => live && setFallback(true));
    return () => {
      live = false;
    };
  }, [fallback, onError]);
  if (fallback) {
    return (
      <button className="btn big" onClick={onRedirect} disabled={busy}>
        <GoogleLogo /> Continue with Google
      </button>
    );
  }
  return <div ref={ref} className="gsi-btn" />;
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { user } = useCloud();
  useEffect(() => {
    if (user) onClose();
  }, [user, onClose]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'signin' ? 'Sign in' : 'Create account'} onClose={onClose} narrow>
      <div className="stack">
        {!cloudEnabled && <div className="callout small">Accounts aren't connected yet. Sign-in will work once the site's Supabase project is set up.</div>}
        <fieldset disabled={!cloudEnabled} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }} className="stack">
        <GoogleSignIn busy={busy} onRedirect={() => run(signInWithGoogle)} onError={setError} />
        <div className="row" style={{ gap: 10 }}>
          <span className="grow" style={{ height: 1, background: 'var(--border)' }} />
          <span className="muted small">or</span>
          <span className="grow" style={{ height: 1, background: 'var(--border)' }} />
        </div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              if (mode === 'signin') await signInWithEmail(email, password);
              else if (await createAccount(email, password)) setInfo('Check your email for a confirmation link, then sign in.');
            });
          }}
        >
          <label className="field">
            Email
            <input type="text" inputMode="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value.trim())} style={{ width: '100%' }} />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%', background: 'var(--bg-2)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '7px 10px', font: 'inherit' }}
            />
          </label>
          {error && <div className="callout bad small">{error}</div>}
          {info && <div className="callout good small">{info}</div>}
          <button className="btn primary" type="submit" disabled={busy || !email || !password}>
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="row between small">
          <button className="btn ghost small" onClick={() => (setMode(mode === 'signin' ? 'create' : 'signin'), setError(null))}>
            {mode === 'signin' ? 'Create an account' : 'I already have an account'}
          </button>
          {mode === 'signin' && (
            <button
              className="btn ghost small"
              disabled={busy}
              onClick={() => (email ? run(async () => (await resetPassword(email), setInfo('Password reset email sent. Open the link to choose a new password.'))) : setError('Enter your email first.'))}
            >
              Forgot password?
            </button>
          )}
        </div>
        </fieldset>
      </div>
    </Modal>
  );
}

function NewPasswordModal() {
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  if (done) return null;
  return (
    <Modal title="Choose a new password" onClose={() => setDone(true)} narrow>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await setNewPassword(pw);
            setDone(true);
          } catch (err) {
            setError(friendly(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          New password
          <input
            type="password"
            autoComplete="new-password"
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            style={{ width: '100%', background: 'var(--bg-2)', color: 'var(--text)', border: '1px solid var(--border-2)', borderRadius: 8, padding: '7px 10px', font: 'inherit' }}
          />
        </label>
        {error && <div className="callout bad small">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy || pw.length < 6}>
          Save password
        </button>
      </form>
    </Modal>
  );
}

/** Opens the sign-in dialog from anywhere (e.g. the guest reminder). */
export function openSignIn(): void {
  window.dispatchEvent(new Event('bjlab-open-signin'));
}

export function AccountButton() {
  const { ready, user, syncing, lastSync, error, recovery } = useCloud();
  const [modal, setModal] = useState(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', off);
    return () => window.removeEventListener('mousedown', off);
  }, [menu]);
  useEffect(() => {
    const on = () => setModal(true);
    window.addEventListener('bjlab-open-signin', on);
    return () => window.removeEventListener('bjlab-open-signin', on);
  }, []);
  if (cloudEnabled && !ready) return null;
  if (!user) {
    return (
      <>
        <button className="btn small account-btn" onClick={() => setModal(true)}>
          Sign in
        </button>
        {modal && <AuthModal onClose={() => setModal(false)} />}
      </>
    );
  }
  const label = user.name ?? user.email ?? 'Account';
  return (
    <div className="nav-group account-btn" ref={ref}>
      {recovery && <NewPasswordModal />}
      <button className="btn small ghost" onClick={() => setMenu((m) => !m)} aria-expanded={menu} title={label}>
        {user.photo ? <img src={user.photo} alt="" width={22} height={22} style={{ borderRadius: '50%' }} referrerPolicy="no-referrer" /> : <span className="avatar" style={{ background: 'var(--gold)' }}>{label[0].toUpperCase()}</span>}
        <span className="account-name">{label}</span>
      </button>
      {menu && (
        <div className="nav-menu" style={{ display: 'flex', left: 'auto', right: 0, padding: 12, gap: 8, minWidth: 240 }}>
          <div className="small">{user.email}</div>
          <div className={`small ${error ? 'bad' : 'muted'}`}>{error ?? (syncing ? 'Saving…' : lastSync ? `Stats saved to your account · ${new Date(lastSync).toLocaleTimeString()}` : 'Stats saved to your account')}</div>
          <button className="btn small" onClick={() => (setMenu(false), signOutCloud())}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

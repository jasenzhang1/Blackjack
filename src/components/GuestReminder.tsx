import { useEffect, useState } from 'react';
import { useRoute } from '../router';
import { useCloud } from '../state/cloud';
import { onSave } from '../state/storage';
import { openSignIn } from './Account';

const PROGRESS_KEYS = new Set(['cells', 'quiz', 'trainer', 'drills', 'watch', 'sessions']);
const PRACTICE_ROUTES = new Set(['/strategy/quiz', '/strategy/trainer', '/counting/drills', '/counting/watch', '/counting/play', '/play']);
const FIRST_AFTER = 3; // progress saves before the first reminder
const AGAIN_AFTER = 30; // more saves before it comes back after being dismissed

/**
 * Soft, dismissible reminder shown while a signed-out user is practising: their progress only
 * lives in this browser.
 */
export function GuestReminder() {
  const { ready, user } = useCloud();
  const path = useRoute();
  const [saves, setSaves] = useState(0);
  const [threshold, setThreshold] = useState(FIRST_AFTER);
  useEffect(() => onSave((k) => PROGRESS_KEYS.has(k) && setSaves((n) => n + 1)), []);
  if (!ready || user || !PRACTICE_ROUTES.has(path) || saves < threshold) return null;
  return (
    <div className="guest-reminder no-print" role="status">
      <span>Playing as a guest. Your progress isn't saved to an account.</span>
      <button className="btn small primary" onClick={openSignIn}>
        Sign in
      </button>
      <button className="btn small ghost" aria-label="Dismiss" onClick={() => setThreshold(saves + AGAIN_AFTER)}>
        ✕
      </button>
    </div>
  );
}

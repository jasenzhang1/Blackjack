/**
 * Merging a device's saved progress with the copy stored in the user's account, so signing in on a
 * new device (or after playing as a guest) never loses either side's stats.
 */
import { mergeHoldem, type HoldemStats } from '../holdem/progress';
import type { SessionReport } from '../table/report';
import type { CellStat, DrillResult, QuizAttempt, TrainerStats, WatchStats } from './progress';

/** Keys synced to the account. Sessions are stored separately (one cloud document each). */
export const SYNC_KEYS = ['rules', 'prefs', 'cells', 'quiz', 'trainer', 'drills', 'watch', 'holdem', 'holdemPaint', 'holdemSessions', 'sessions'] as const;
export type SyncKey = (typeof SYNC_KEYS)[number];
export type Blob = Partial<Record<SyncKey, unknown>>;

type Cells = Record<string, Record<string, CellStat>>;

function mergeCells(a: Cells = {}, b: Cells = {}): Cells {
  const out: Cells = {};
  for (const src of [a, b]) {
    for (const [rk, cells] of Object.entries(src)) {
      const dst = (out[rk] ??= {});
      for (const [ck, s] of Object.entries(cells)) {
        const cur = dst[ck];
        // The record with more attempts already contains the other's history (or is the larger one).
        if (!cur || s.attempts > cur.attempts || (s.attempts === cur.attempts && s.last > cur.last)) dst[ck] = s;
      }
    }
  }
  return out;
}

function unionBy<T>(a: T[] = [], b: T[] = [], key: (x: T) => string, keepNewer: (x: T, y: T) => T = (x) => x): T[] {
  const m = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const k = key(x);
    const cur = m.get(k);
    m.set(k, cur ? keepNewer(cur, x) : x);
  }
  return Array.from(m.values());
}

export function mergeData(local: Blob, cloud: Blob): Blob {
  const out: Blob = {};
  // Settings: the account's saved settings win; fall back to this device's.
  out.rules = cloud.rules ?? local.rules;
  out.prefs = cloud.prefs ?? local.prefs;
  out.cells = mergeCells(local.cells as Cells, cloud.cells as Cells);
  out.quiz = unionBy(local.quiz as QuizAttempt[], cloud.quiz as QuizAttempt[], (q) => `${q.date}|${q.scope}`)
    .sort((x, y) => x.date - y.date)
    .slice(-200);
  out.drills = unionBy(local.drills as DrillResult[], cloud.drills as DrillResult[], (d) => `${d.date}|${d.drill}`)
    .sort((x, y) => x.date - y.date)
    .slice(-300);
  const tl = local.trainer as TrainerStats | undefined;
  const tc = cloud.trainer as TrainerStats | undefined;
  if (tl || tc) {
    const base = !tc || (tl && tl.total > tc.total) ? tl! : tc;
    out.trainer = { ...base, bestStreak: Math.max(tl?.bestStreak ?? 0, tc?.bestStreak ?? 0) };
  }
  const wl = local.watch as WatchStats | undefined;
  const wc = cloud.watch as WatchStats | undefined;
  if (wl || wc) out.watch = !wc || (wl && wl.checks > wc.checks) ? wl : wc;
  if (local.holdem || cloud.holdem) out.holdem = mergeHoldem(local.holdem as HoldemStats, cloud.holdem as HoldemStats);
  if (local.holdemPaint || cloud.holdemPaint) {
    const a = (local.holdemPaint ?? {}) as Record<string, number>;
    const b = (cloud.holdemPaint ?? {}) as Record<string, number>;
    out.holdemPaint = Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => [k, Math.max(a[k] ?? 0, b[k] ?? 0)]));
  }
  if (local.holdemSessions || cloud.holdemSessions)
    out.holdemSessions = unionBy(local.holdemSessions as { id: string; end: number }[], cloud.holdemSessions as { id: string; end: number }[], (r) => r.id, (x, y) => (y.end > x.end ? y : x))
      .sort((x, y) => x.end - y.end)
      .slice(-40);
  out.sessions = unionBy(local.sessions as SessionReport[], cloud.sessions as SessionReport[], (s) => s.id, (x, y) => (y.end > x.end ? y : x))
    .sort((x, y) => x.end - y.end)
    .slice(-60);
  for (const k of Object.keys(out) as SyncKey[]) if (out[k] === undefined) delete out[k];
  return out;
}

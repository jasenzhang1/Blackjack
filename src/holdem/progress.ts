/** Hold'em training-room stats, saved under one localStorage key (and synced to the account). */
import { load, save } from '../state/storage';

export type RoomId = 'preflop' | 'potodds' | 'implied' | 'semibluff' | 'reading' | 'play';

export interface RoomStats {
  /** Spots played to the final decision. */
  hands: number;
  /** Spots where the final decision was right. */
  correct: number;
  /** Every graded step (outs, prices, decisions). */
  steps: number;
  stepsCorrect: number;
  streak: number;
  bestStreak: number;
  last: number;
}

export type HoldemStats = Partial<Record<RoomId, RoomStats>>;

const EMPTY: RoomStats = { hands: 0, correct: 0, steps: 0, stepsCorrect: 0, streak: 0, bestStreak: 0, last: 0 };

export function getHoldemStats(): HoldemStats {
  return load<HoldemStats>('holdem', {});
}

export function roomStats(room: RoomId): RoomStats {
  return { ...EMPTY, ...getHoldemStats()[room] };
}

/** Records a finished spot: `steps` holds the result of every graded step, the last being the decision. */
export function recordSpot(room: RoomId, steps: boolean[]): RoomStats {
  const all = getHoldemStats();
  const s = { ...EMPTY, ...all[room] };
  const ok = steps[steps.length - 1] ?? false;
  s.hands++;
  if (ok) s.correct++;
  s.steps += steps.length;
  s.stepsCorrect += steps.filter(Boolean).length;
  s.streak = ok ? s.streak + 1 : 0;
  s.bestStreak = Math.max(s.bestStreak, s.streak);
  s.last = Date.now();
  all[room] = s;
  save('holdem', all);
  return s;
}

/** Merges this device's stats with the account's: per room, the record with more spots wins. */
export function mergeHoldem(a: HoldemStats = {}, b: HoldemStats = {}): HoldemStats {
  const out: HoldemStats = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<RoomId>) {
    const x = a[k];
    const y = b[k];
    const base = !y || (x && (x.hands > y.hands || (x.hands === y.hands && x.last >= y.last))) ? x! : y;
    out[k] = { ...base, bestStreak: Math.max(x?.bestStreak ?? 0, y?.bestStreak ?? 0) };
  }
  return out;
}

/** Best score (share of combos right) for each range-painting chart. */
export function paintScores(): Record<string, number> {
  return load<Record<string, number>>('holdemPaint', {});
}

export function savePaintScore(chartId: string, score: number): void {
  const all = paintScores();
  all[chartId] = Math.max(all[chartId] ?? 0, score);
  save('holdemPaint', all);
}

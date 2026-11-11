/**
 * Learning progress persisted in localStorage: per-cell accuracy (feeds the "weak spots" heat-map
 * and the trainer's weak-spot mode), quiz attempts, trainer streaks, drill scores and session
 * report cards.
 */
import { load, save } from './storage';
import type { SessionReport } from '../table/report';

export interface CellStat {
  attempts: number;
  correct: number;
  last: number;
}

type CellStore = Record<string, Record<string, CellStat>>;

/** `rkey` should be strategyKey(rules) (playing decisions do not depend on the payout). */
export function recordCell(rkey: string, cell: string, correct: boolean): void {
  const all = load<CellStore>('cells', {});
  const m = (all[rkey] ??= {});
  const s = (m[cell] ??= { attempts: 0, correct: 0, last: 0 });
  s.attempts++;
  if (correct) s.correct++;
  s.last = Date.now();
  save('cells', all);
}

export function cellStats(rkey: string): Record<string, CellStat> {
  return load<CellStore>('cells', {})[rkey] ?? {};
}

/** Clears the accuracy history for every cell whose row is in `rows`. */
export function resetCellStats(rkey: string, rows: string[]): void {
  const all = load<CellStore>('cells', {});
  const m = all[rkey];
  if (!m) return;
  const set = new Set(rows);
  for (const k of Object.keys(m)) if (set.has(k.split('|')[0])) delete m[k];
  save('cells', all);
}

export interface QuizAttempt {
  date: number;
  scope: string;
  strict: boolean;
  correct: number;
  total: number;
  ms: number;
  rulesKey: string;
}

export function saveQuizAttempt(a: QuizAttempt): void {
  const list = load<QuizAttempt[]>('quiz', []);
  list.push(a);
  save('quiz', list.slice(-200));
}

export function listQuizAttempts(): QuizAttempt[] {
  return load<QuizAttempt[]>('quiz', []);
}

export interface TrainerStats {
  total: number;
  correct: number;
  bestStreak: number;
}

export function getTrainerStats(): TrainerStats {
  return load<TrainerStats>('trainer', { total: 0, correct: 0, bestStreak: 0 });
}

export function saveTrainerStats(s: TrainerStats): void {
  save('trainer', s);
}

export interface DrillResult {
  drill: string;
  date: number;
  score: number;
  total: number;
  ms: number;
  detail?: string;
  /** Per-card log, in order: rank, whether the answer was right (omitted when not graded per card), ms spent on it. */
  cards?: { r: number; ok?: boolean; ms: number }[];
}

export function saveDrill(r: DrillResult): void {
  const list = load<DrillResult[]>('drills', []);
  list.push(r);
  save('drills', list.slice(-300));
}

export function listDrills(drill?: string): DrillResult[] {
  const list = load<DrillResult[]>('drills', []);
  return drill ? list.filter((d) => d.drill === drill) : list;
}

export function saveSession(r: SessionReport): void {
  const list = load<SessionReport[]>('sessions', []);
  const i = list.findIndex((x) => x.id === r.id);
  if (i >= 0) list[i] = r;
  else list.push(r);
  save('sessions', list.slice(-60));
}

export function listSessions(): SessionReport[] {
  return load<SessionReport[]>('sessions', []).sort((a, b) => b.end - a.end);
}

export function deleteSession(id: string): void {
  save(
    'sessions',
    load<SessionReport[]>('sessions', []).filter((s) => s.id !== id),
  );
}

export interface WatchStats {
  checks: number;
  exact: number;
}

export function getWatchStats(): WatchStats {
  return load<WatchStats>('watch', { checks: 0, exact: 0 });
}

export function saveWatchStats(s: WatchStats): void {
  save('watch', s);
}

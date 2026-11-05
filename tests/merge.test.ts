import { describe, expect, it } from 'vitest';
import { mergeData } from '../src/state/merge';

describe('account merge', () => {
  it('keeps progress from both the device and the account', () => {
    const local = {
      cells: { k: { 'H16|10': { attempts: 5, correct: 3, last: 10 }, 'H12|3': { attempts: 1, correct: 1, last: 5 } } },
      quiz: [{ date: 1, scope: 'hard', strict: false, correct: 10, total: 160, ms: 1, rulesKey: 'x' }],
      trainer: { total: 50, correct: 40, bestStreak: 9 },
      sessions: [{ id: 'a', end: 100 }, { id: 'b', end: 200 }],
      prefs: { unit: 5 },
    };
    const cloud = {
      cells: { k: { 'H16|10': { attempts: 8, correct: 7, last: 20 } } },
      quiz: [{ date: 2, scope: 'soft', strict: false, correct: 70, total: 80, ms: 1, rulesKey: 'x' }],
      trainer: { total: 30, correct: 30, bestStreak: 15 },
      sessions: [{ id: 'b', end: 250 }, { id: 'c', end: 50 }],
      prefs: { unit: 25 },
    };
    const m = mergeData(local as never, cloud as never) as Record<string, any>;
    expect(m.cells.k['H16|10'].attempts).toBe(8);
    expect(m.cells.k['H12|3'].attempts).toBe(1);
    expect(m.quiz.map((q: { date: number }) => q.date)).toEqual([1, 2]);
    expect(m.trainer).toEqual({ total: 50, correct: 40, bestStreak: 15 });
    expect(m.sessions.map((s: { id: string; end: number }) => `${s.id}:${s.end}`)).toEqual(['c:50', 'a:100', 'b:250']);
    expect(m.prefs.unit).toBe(25);
  });

  it('a brand-new account adopts the guest progress unchanged', () => {
    const local = { trainer: { total: 3, correct: 2, bestStreak: 2 }, rules: { decks: 2 } };
    const m = mergeData(local as never, {}) as Record<string, any>;
    expect(m.trainer).toEqual(local.trainer);
    expect(m.rules).toEqual({ decks: 2 });
  });
});

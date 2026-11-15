import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/holdem/cards';
import { FLUSH, FULL_HOUSE, QUADS, STRAIGHT, STRAIGHT_FLUSH } from '../src/holdem/evaluate';
import { straightHigh } from '../src/holdem/evaluate';
import { rankOf } from '../src/holdem/cards';
import { dealRead, gradeNuts, gradeStraights, gradeTypes, parseHolding, readBoard } from '../src/holdem/nuts';
import { mulberry32 } from '../src/engine/rng';

const R = (s: string) => readBoard(parseCards(s));

describe('board reading', () => {
  it('reads a three-heart connected board', () => {
    const r = R('7h8h9cKh2d');
    expect([...r.possible].sort()).toEqual([STRAIGHT, FLUSH].sort());
    expect(r.straights.map((s) => s.high)).toEqual([9, 8, 7]); // J-high (TJ), T-high (6T), 9-high (56)
    expect(r.straights.map((s) => s.need)).toEqual([[9, 8], [8, 4], [4, 3]]);
    expect(r.nutName).toBe('Ace high flush');
    expect(r.nutText).toEqual(['A♥ + any heart']);
    expect(gradeNuts(r, 'AhXh').ok).toBe(true);
    expect(gradeNuts(r, 'A♥ Q♥').ok).toBe(true);
    expect(gradeNuts(r, 'Ah').ok).toBe(false);
    expect(gradeNuts(r, 'TJ').ok).toBe(false);
    expect(gradeStraights(r, '56 6T TJ').ok).toBe(true);
    expect(gradeStraights(r, '5-6, 6/10').missed.map((s) => s.high)).toEqual([9]);
    expect(gradeStraights(r, '56 6T TJ QA').wrong).toHaveLength(1);
    expect(gradeTypes(r, new Set([FLUSH, STRAIGHT])).ok).toBe(true);
    expect(gradeTypes(r, new Set([FLUSH])).missed).toEqual([STRAIGHT]);
  });

  it('finds one-card straights and the extra-rank case', () => {
    const r = R('5c6d7h8sKc');
    expect(r.straights.map((s) => [s.high, s.need])).toEqual([[8, [8, 7]], [7, [7]], [6, [2]]]);
    expect(r.nutText).toEqual(['T9']);
    const g = gradeStraights(r, '4 9 9T');
    expect(g.ok).toBe(true);
    expect(gradeStraights(r, '34 9 9T').loose).toHaveLength(1); // 34 makes the 8-high: only the 4 is needed
    expect(gradeStraights(r, '45 9 9T').loose).toHaveLength(1);
    expect(gradeNuts(r, '9x').ok).toBe(false);
    expect(gradeNuts(r, 'T9').ok).toBe(true);
  });

  it('reads paired boards: quads are the nuts', () => {
    const r = R('KsKd7c4h2s');
    expect(r.possible.has(QUADS)).toBe(true);
    expect(r.possible.has(FULL_HOUSE)).toBe(true);
    expect(r.nutText).toEqual(['KK']);
    expect(gradeNuts(r, 'KK').ok).toBe(true);
    const t = R('KsKdKc7h2s');
    expect(t.nutText).toEqual(['K + any card']);
    expect(gradeNuts(t, 'K').ok).toBe(true);
  });

  it('finds straight flushes', () => {
    const r = R('7h8h9hKc2d');
    expect(r.possible.has(STRAIGHT_FLUSH)).toBe(true);
    expect(r.nutName).toBe('Straight flush, jack high');
    expect(r.nutText).toEqual(['J♥10♥']);
    expect(gradeNuts(r, 'JhTh').ok).toBe(true);
    expect(gradeNuts(r, 'JT').ok).toBe(false);
  });

  it('nut flush with four on board needs only the ace', () => {
    const r = R('2h5h9hJhKc');
    expect(r.nutName).toBe('Ace high flush');
    expect(r.nutText).toEqual(['A♥ + any card']);
  });

  it('parses holding shorthand', () => {
    expect(parseHolding('A♥ x♥')).toEqual([{ rank: 12, suit: 1 }, { rank: null, suit: 1 }]);
    expect(parseHolding('10J')).toEqual([{ rank: 8, suit: null }, { rank: 9, suit: null }]);
    expect(parseHolding('Ah any')).toEqual([{ rank: 12, suit: 1 }, { rank: null, suit: null }]);
    expect(parseHolding('zz')).toBeNull();
  });

  it('busy boards have at least two features', () => {
    const rand = mulberry32(7);
    for (let i = 0; i < 20; i++) {
      const r = dealRead(rand, 5, 'busy');
      expect(r.board).toHaveLength(5);
      expect((r.flush ? 1 : 0) + (r.straights.length ? 1 : 0) + (r.pairedRanks.length ? 1 : 0)).toBeGreaterThanOrEqual(2);
    }
  });

  it('straight list matches brute force over every pair of hole ranks', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 300; i++) {
      const r = dealRead(rand, ([3, 4, 5] as const)[i % 3], 'any');
      const mask = r.board.reduce((m, c) => m | (1 << rankOf(c)), 0);
      const seen = new Set<number>();
      for (let a = 0; a < 13; a++) for (let b = a; b < 13; b++) {
        const h = straightHigh(mask | (1 << a) | (1 << b));
        if (h >= 0) seen.add(h);
      }
      expect(r.straights.map((s) => s.high).sort((x, y) => x - y)).toEqual([...seen].sort((x, y) => x - y));
    }
  });
});

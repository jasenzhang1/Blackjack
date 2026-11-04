import { describe, expect, it } from 'vitest';
import { UPCARDS, type Rank } from '../src/engine/cards';
import { HARD_ROWS, PAIR_ROWS, SOFT_ROWS, rowKey } from '../src/engine/hand';
import { DEFAULT_RULES, type Rules } from '../src/engine/rules';
import { advise, cellKey, computeStrategy, type StrategyTable } from '../src/engine/strategy';
import { splitChain } from '../src/engine/ev';

function chart(t: StrategyTable): string[] {
  const rows = [...HARD_ROWS.map((n) => rowKey('hard', n)), ...SOFT_ROWS.map((n) => rowKey('soft', n)), ...PAIR_ROWS.map((n) => rowKey('pair', n))];
  return rows.map((r) => `${r}: ` + UPCARDS.map((u) => t.cells[cellKey(r, u)].code).join(' '));
}

// Published 4–8 deck, S17, DAS, late-surrender basic strategy (columns 2..9, T, A).
const SIX_DECK_S17_DAS_LS = `
H5: H H H H H H H H H H
H6: H H H H H H H H H H
H7: H H H H H H H H H H
H8: H H H H H H H H H H
H9: H Dh Dh Dh Dh H H H H H
H10: Dh Dh Dh Dh Dh Dh Dh Dh H H
H11: Dh Dh Dh Dh Dh Dh Dh Dh Dh H
H12: H H S S S H H H H H
H13: S S S S S H H H H H
H14: S S S S S H H H H H
H15: S S S S S H H H Rh H
H16: S S S S S H H Rh Rh Rh
H17: S S S S S S S S S S
H18: S S S S S S S S S S
H19: S S S S S S S S S S
H20: S S S S S S S S S S
S13: H H H Dh Dh H H H H H
S14: H H H Dh Dh H H H H H
S15: H H Dh Dh Dh H H H H H
S16: H H Dh Dh Dh H H H H H
S17: H Dh Dh Dh Dh H H H H H
S18: S Ds Ds Ds Ds S S H H H
S19: S S S S S S S S S S
S20: S S S S S S S S S S
P2: P P P P P P H H H H
P3: P P P P P P H H H H
P4: H H H P P H H H H H
P5: Dh Dh Dh Dh Dh Dh Dh Dh H H
P6: P P P P P H H H H H
P7: P P P P P P H H H H
P8: P P P P P P P P P P
P9: P P P P P S P P S S
P10: S S S S S S S S S S
P1: P P P P P P P P P P`
  .trim()
  .split('\n');

describe('basic strategy chart', () => {
  const s17 = computeStrategy({ ...DEFAULT_RULES });
  const h17 = computeStrategy({ ...DEFAULT_RULES, hitSoft17: true });

  it('reproduces the published 6-deck S17 DAS LS chart exactly', () => {
    expect(chart(s17)).toEqual(SIX_DECK_S17_DAS_LS);
  });

  it('applies the well-known H17 changes', () => {
    const code = (r: string, u: Rank) => h17.cells[cellKey(r, u)].code;
    expect(code('H11', 1)).toBe('Dh'); // double 11 vs A
    expect(code('H15', 1)).toBe('Rh'); // surrender 15 vs A
    expect(code('H17', 1)).toBe('Rs'); // surrender 17 vs A
    expect(code('S18', 2)).toBe('Ds'); // A7 vs 2 double
    expect(code('S19', 6)).toBe('Ds'); // A8 vs 6 double
    expect(code('P8', 1)).toBe('Rp'); // surrender 8,8 vs A
  });

  it('single deck classics', () => {
    const sd = computeStrategy({ ...DEFAULT_RULES, decks: 1, hitSoft17: true, doubleAfterSplit: false, surrender: 'none' });
    expect(sd.cells[cellKey('H8', 5)].code).toBe('Dh');
    expect(sd.cells[cellKey('H9', 2)].code).toBe('Dh');
    expect(sd.cells[cellKey('H11', 1)].code).toBe('Dh');
    expect(sd.cells[cellKey('P7', 10)].code).toBe('S');
    expect(sd.cells[cellKey('P4', 5)].code).toBe('Dh');
    expect(sd.cells[cellKey('S19', 6)].code).toBe('Ds');
  });

  it('house edge is in the published range and rule effects have the right size', () => {
    const base = computeStrategy({ ...DEFAULT_RULES, surrender: 'none' });
    expect(base.houseEdge).toBeGreaterThan(0.0036);
    expect(base.houseEdge).toBeLessThan(0.0045);
    // Late surrender is worth roughly 0.05–0.10% in a 6-deck S17 game.
    expect(base.houseEdge - s17.houseEdge).toBeGreaterThan(0.0005);
    expect(base.houseEdge - s17.houseEdge).toBeLessThan(0.001);
    // H17 costs about 0.2%.
    expect(h17.houseEdge - s17.houseEdge).toBeGreaterThan(0.0017);
    expect(h17.houseEdge - s17.houseEdge).toBeLessThan(0.0024);
    // 6:5 costs P(player BJ, dealer none) × 0.3 ≈ 1.36%.
    const sixFive = computeStrategy({ ...DEFAULT_RULES, blackjackPays: 1.2 });
    expect(sixFive.houseEdge - s17.houseEdge).toBeCloseTo(s17.pPlayerBJWin * 0.3, 10);
    expect(sixFive.houseEdge - s17.houseEdge).toBeGreaterThan(0.0133);
    expect(sixFive.houseEdge - s17.houseEdge).toBeLessThan(0.014);
  });

  it('advises with fallbacks when an action is not available', () => {
    const t = s17;
    expect(advise(t, [10, 6], 10, { double: true, split: false, surrender: true }).action).toBe('R');
    expect(advise(t, [10, 6], 10, { double: true, split: false, surrender: false }).action).toBe('H');
    expect(advise(t, [1, 7], 4, { double: true, split: false, surrender: true }).action).toBe('D');
    expect(advise(t, [1, 7], 4, { double: false, split: false, surrender: false }).action).toBe('S');
    expect(advise(t, [5, 4, 2], 6, { double: false, split: false, surrender: false }).action).toBe('H');
    expect(advise(t, [8, 8], 10, { double: true, split: false, surrender: false }).action).toBe('H');
    // A,A that can no longer be split is soft 12: doubling it against a 6 is (narrowly) best.
    expect(advise(t, [1, 1], 6, { double: true, split: false, surrender: false }).action).toBe('D');
    expect(advise(t, [1, 1], 6, { double: false, split: false, surrender: false }).action).toBe('H');
    expect(advise(t, [10, 1, 10], 6, { double: false, split: false, surrender: false }).action).toBe('S');
  });
});

describe('split chain', () => {
  it('no resplit: two hands, each a pair with probability p', () => {
    const [a, b] = splitChain(0.1, 2);
    expect(a).toBeCloseTo(1.8, 12);
    expect(b).toBeCloseTo(0.2, 12);
  });
  it('expected number of hands grows with resplits and is bounded by the limit', () => {
    const p = 1 / 13;
    const [a3, b3] = splitChain(p, 3);
    const [a4, b4] = splitChain(p, 4);
    expect(a3 + b3).toBeGreaterThan(2);
    expect(a4 + b4).toBeGreaterThan(a3 + b3);
    expect(a4 + b4).toBeLessThan(4);
  });
});

describe('rule matrix smoke test', () => {
  const variants: Partial<Rules>[] = [
    { dealerPeeks: false },
    { surrender: 'early' },
    { doubleOn: '10-11', doubleAfterSplit: false },
    { resplitAces: true, hitSplitAces: true },
    { maxSplitHands: 2 },
    { decks: 2 },
  ];
  for (const v of variants) {
    it(JSON.stringify(v), () => {
      const t = computeStrategy({ ...DEFAULT_RULES, ...v });
      expect(Number.isFinite(t.houseEdge)).toBe(true);
      expect(Math.abs(t.houseEdge)).toBeLessThan(0.03);
      for (const c of Object.values(t.cells)) for (const x of Object.values(c.ev)) expect(Number.isFinite(x)).toBe(true);
    });
  }
  it('ENHC is worse for the player than peek; early surrender is better than late', () => {
    const peek = computeStrategy({ ...DEFAULT_RULES, surrender: 'none' });
    const enhc = computeStrategy({ ...DEFAULT_RULES, surrender: 'none', dealerPeeks: false });
    const late = computeStrategy({ ...DEFAULT_RULES });
    const early = computeStrategy({ ...DEFAULT_RULES, surrender: 'early' });
    expect(enhc.houseEdge).toBeGreaterThan(peek.houseEdge);
    expect(early.houseEdge).toBeLessThan(late.houseEdge - 0.004);
    // Regression: with no hole card, *late* surrender must still lose everything to a dealer
    // blackjack, so ENHC + late surrender is worse for the player than peek + late surrender.
    const enhcLate = computeStrategy({ ...DEFAULT_RULES, dealerPeeks: false });
    expect(enhcLate.houseEdge).toBeGreaterThan(late.houseEdge);
    expect(enhcLate.houseEdge - late.houseEdge).toBeLessThan(0.003);
    // Classic ENHC play: don't double 11 against a ten (a dealer blackjack takes the double too).
    expect(enhc.cells[cellKey('H11', 10)].code).toBe('H');
  });
});

import { describe, expect, it } from 'vitest';
import type { Rank } from '../src/engine/cards';
import { EVEngine, outcomeStats } from '../src/engine/ev';
import { DEFAULT_RULES, type Rules } from '../src/engine/rules';

const opts = { double: true, split: true, surrender: true };

function check(rules: Rules, cards: Rank[], up: Rank) {
  const eng = new EVEngine(rules, up);
  const { ev } = eng.analyze(cards, opts);
  const { dist, simulated } = eng.distributions(cards, opts, 40000);
  for (const [a, o] of Object.entries(dist)) {
    const total = o!.reduce((s, z) => s + z.p, 0);
    expect(total).toBeCloseTo(1, 9);
    const { mean } = outcomeStats(o!);
    const exact = ev[a as keyof typeof ev]!;
    if (simulated[a as keyof typeof simulated]) {
      // Simulated split: within sampling error (and the engine's split approximation).
      expect(Math.abs(mean - exact)).toBeLessThan(0.03);
    } else {
      expect(mean).toBeCloseTo(exact, 9);
    }
  }
}

describe('outcome distributions', () => {
  it('match the exact EVs (S17, 6 decks, peek)', () => {
    check(DEFAULT_RULES, [10, 6], 10);
    check(DEFAULT_RULES, [6, 5], 6);
    check(DEFAULT_RULES, [1, 7], 9);
    check(DEFAULT_RULES, [2, 3], 4);
    check(DEFAULT_RULES, [8, 8], 1);
    check(DEFAULT_RULES, [1, 1], 6);
  });
  it('match the exact EVs with no hole card, early surrender and an infinite deck', () => {
    check({ ...DEFAULT_RULES, dealerPeeks: false }, [9, 7], 1);
    check({ ...DEFAULT_RULES, surrender: 'early' }, [10, 6], 10);
    check({ ...DEFAULT_RULES, decks: Infinity }, [10, 2], 3);
    check({ ...DEFAULT_RULES, decks: 1, hitSoft17: true }, [7, 7], 10);
  });
});

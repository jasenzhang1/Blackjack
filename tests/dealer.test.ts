import { describe, expect, it } from 'vitest';
import { fullShoe, removeRanks, type Rank } from '../src/engine/cards';
import { dealerDistribution, dealerDistributionInfinite, dealerTerms, dealerTreeNode, OUT_BJ, OUT_BUST } from '../src/engine/dealer';

/** Brute-force recursion (no multiset trick) used as an independent reference. */
function bruteDealer(up: Rank, h17: boolean, shoe: number[]): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const rec = (hard: number, ace: boolean, k: number, p: number, s: number[], n: number) => {
    const soft = ace && hard <= 11;
    const total = soft ? hard + 10 : hard;
    if (k === 1 && total === 21) { out[6] += p; return; }
    if (total > 21) { out[5] += p; return; }
    if (total > 17 || (total === 17 && !(soft && h17))) { out[total - 17] += p; return; }
    for (let r = 1; r <= 10; r++) {
      if (s[r] === 0) continue;
      const q = s[r] / n;
      s[r]--;
      rec(hard + r, ace || r === 1, k + 1, p * q, s, n - 1);
      s[r]++;
    }
  };
  rec(up, up === 1, 0, 1, shoe.slice(), shoe.reduce((a, b) => a + b, 0));
  return out;
}

describe('dealer distribution', () => {
  it('matches the published infinite-deck S17 bust probabilities', () => {
    // Standard table (e.g. Griffin / Wizard of Odds), dealer BJ included in the distribution.
    const bust: Record<number, number> = { 2: 0.3536, 3: 0.3739, 4: 0.3945, 5: 0.4164, 6: 0.4232, 7: 0.2623, 8: 0.2448, 9: 0.2284, 10: 0.2124, 1: 0.1153 };
    for (const up of [2, 3, 4, 5, 6, 7, 8, 9, 10, 1] as Rank[]) {
      const d = dealerDistributionInfinite(dealerTerms(up, false));
      expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(d[OUT_BUST]).toBeCloseTo(bust[up], 3);
    }
    const dA = dealerDistributionInfinite(dealerTerms(1, false));
    expect(dA[OUT_BJ]).toBeCloseTo(4 / 13, 12);
    const d2 = dealerDistributionInfinite(dealerTerms(2, false));
    expect(d2[0]).toBeCloseTo(0.139809, 5); // P(17 | 2 up)
  });

  it('agrees exactly with brute-force recursion for finite shoes', () => {
    for (const h17 of [false, true]) {
      for (const up of [2, 6, 10, 1] as Rank[]) {
        const shoe = removeRanks(fullShoe(1), [up, 10, 6]);
        const fast = dealerDistribution(dealerTerms(up, h17), shoe);
        const slow = bruteDealer(up, h17, shoe);
        for (let o = 0; o < 7; o++) expect(fast[o]).toBeCloseTo(slow[o], 12);
      }
    }
  });

  it('dealer tree root distribution equals the multiset formula', () => {
    const shoe = removeRanks(fullShoe(2), [6]);
    const node = dealerTreeNode(6, true, shoe, []);
    const d = dealerDistribution(dealerTerms(6, true), shoe);
    for (let o = 0; o < 7; o++) expect(node.dist[o]).toBeCloseTo(d[o], 12);
    expect(node.children.reduce((a, c) => a + c.p, 0)).toBeCloseTo(1, 12);
  });

  it('reports enumeration sizes', () => {
    let total = 0;
    for (const up of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as Rank[]) total += dealerTerms(up, true).n;
    console.log('terminal dealer multisets (H17, all upcards):', total, 'upcard 2:', dealerTerms(2, true).n);
    expect(total).toBeGreaterThan(100);
  });
});

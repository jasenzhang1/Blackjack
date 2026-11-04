import { describe, expect, it } from 'vitest';
import { fullShoe, totalCards, type Rank } from '../src/engine/cards';
import { HI_LO, SYSTEMS, representativeShoe, runningCountOf, trueCount } from '../src/engine/counting';
import { gradeInsurance, gradePlay } from '../src/engine/deviations';
import { EVEngine } from '../src/engine/ev';
import { DEFAULT_RULES } from '../src/engine/rules';
import { computeStrategy } from '../src/engine/strategy';
import { summarize, type SessionReport } from '../src/table/report';

const table = computeStrategy({ ...DEFAULT_RULES });
const all = { double: true, split: false, surrender: true };

describe('explanations are internally consistent', () => {
  it('hit/double rows reproduce the headline EVs and probabilities sum to 1', () => {
    for (const [cards, up] of [
      [[10, 6], 10],
      [[1, 7], 9],
      [[5, 6], 1],
      [[8, 8], 10],
      [[9, 3], 2],
    ] as [Rank[], Rank][]) {
      const eng = new EVEngine(DEFAULT_RULES, up);
      const pair = cards[0] === cards[1];
      const x = eng.explain(cards, { double: true, split: pair, surrender: true });
      const sumP = x.hit!.rows.reduce((a, r) => a + r.p, 0);
      expect(sumP).toBeCloseTo(1, 10);
      expect(x.hit!.rows.reduce((a, r) => a + r.p * r.ev, 0)).toBeCloseTo(x.hit!.ev, 10);
      expect(x.hit!.ev).toBeCloseTo(x.ev.H!, 10);
      expect(x.stand.ev).toBeCloseTo(x.ev.S!, 10);
      expect(x.stand.win - x.stand.lose).toBeCloseTo(x.stand.ev, 10);
      expect(2 * x.double!.rows.reduce((a, r) => a + r.p * r.ev, 0)).toBeCloseTo(x.ev.D!, 10);
      if (pair) {
        const s = x.split!;
        expect(s.rows.reduce((a, r) => a + r.p, 0)).toBeCloseTo(1, 10);
        expect(s.nNonPair * s.eNonPair + s.nPairFinal * s.ePairFinal).toBeCloseTo(x.ev.P!, 10);
      }
    }
  });
});

describe('counting', () => {
  it('every balanced system sums to zero over a deck', () => {
    for (const s of SYSTEMS.filter((x) => x.balanced)) {
      let sum = 0;
      for (let r = 1; r <= 10; r++) sum += s.tags[r] * (r === 10 ? 16 : 4);
      expect(sum).toBe(0);
    }
  });
  it('representative shoe has the requested Hi-Lo true count and size', () => {
    for (const tc of [-4, 0, 3, 7]) {
      const shoe = representativeShoe(3, tc);
      expect(totalCards(shoe)).toBeCloseTo(156, 9);
      // RC of dealt cards = −(tags of remaining) since a full shoe sums to 0.
      let remaining = 0;
      for (let r = 1; r <= 10; r++) remaining += HI_LO.tags[r] * shoe[r];
      expect(trueCount(-remaining, 156)).toBeCloseTo(tc, 9);
    }
  });
  it('running count and true count', () => {
    expect(runningCountOf(HI_LO, [2, 3, 10, 1, 7, 5])).toBe(1);
    expect(trueCount(6, 156)).toBeCloseTo(2, 12);
    expect(fullShoe(6)[10]).toBe(96);
  });
});

describe('deviation grading', () => {
  it('16 vs 10 without surrender: hit below 0, stand above, both inside the grace band', () => {
    const avail = { double: true, split: false, surrender: false };
    expect(gradePlay(table, [10, 6], 10, avail, -2, true).action).toBe('H');
    expect(gradePlay(table, [10, 6], 10, avail, 2, true).action).toBe('S');
    expect(gradePlay(table, [10, 6], 10, avail, 0.2, true).acceptable.sort()).toEqual(['H', 'S']);
  });
  it('late surrender beats the stand index for 16 vs 10', () => {
    expect(gradePlay(table, [10, 6], 10, all, 3, true).action).toBe('R');
  });
  it('Fab 4: 15 vs 10 surrenders at TC ≥ 0, hits when negative', () => {
    expect(gradePlay(table, [10, 5], 10, all, 1, true).action).toBe('R');
    expect(gradePlay(table, [10, 5], 10, all, -2, true).action).toBe('H');
  });
  it('12 vs 4 becomes a hit at negative counts; 10 vs 10 doubles at +4 (5,5 too)', () => {
    expect(gradePlay(table, [10, 2], 4, all, -1, true).action).toBe('H');
    expect(gradePlay(table, [10, 2], 4, all, 1, true).action).toBe('S');
    expect(gradePlay(table, [6, 4], 10, all, 5, true).action).toBe('D');
    expect(gradePlay(table, [5, 5], 10, { ...all, split: true }, 5, true).action).toBe('D');
    expect(gradePlay(table, [6, 4], 10, all, 5, false).action).toBe('H');
  });
  it('splits tens vs 6 at +4 only when deviations are on', () => {
    const av = { double: true, split: true, surrender: true };
    expect(gradePlay(table, [10, 10], 6, av, 5, true).action).toBe('P');
    expect(gradePlay(table, [10, 10], 6, av, 5, false).action).toBe('S');
  });
  it('insurance at TC ≥ +3', () => {
    expect(gradeInsurance(4, true, DEFAULT_RULES).take).toBe(true);
    expect(gradeInsurance(1, true, DEFAULT_RULES).take).toBe(false);
    expect(gradeInsurance(9, false, DEFAULT_RULES).take).toBe(false);
  });
});

describe('report card', () => {
  it('summarises accuracy, EV lost and grade', () => {
    const r: SessionReport = {
      id: 't',
      mode: 'casino',
      start: 0,
      end: 60_000,
      rulesKey: '',
      rulesChips: [],
      houseEdge: 0.005,
      startBankroll: 1000,
      endBankroll: 1010,
      rounds: [
        { round: 1, bet: 10, net: 10, tc: 0 },
        { round: 2, bet: 10, net: 0, tc: 0 },
      ],
      decisions: [
        { id: 'a', round: 1, kind: 'play', cards: [10, 6], up: 10, taken: 'S', correct: 'H', acceptable: ['H'], ok: false, basic: 'H', tc: 0, bet: 10, evLoss: 0.05, category: 'hard' },
        { id: 'b', round: 2, kind: 'play', cards: [1, 7], up: 9, taken: 'H', correct: 'H', acceptable: ['H'], ok: true, basic: 'H', tc: 0, bet: 10, evLoss: 0, category: 'soft' },
      ],
      checks: [],
      deviationsOn: false,
      countingSystem: 'hilo',
      coach: 'off',
      unit: 10,
    };
    const s = summarize(r);
    expect(s.accuracy).toBe(0.5);
    expect(s.evLostMoney).toBeCloseTo(0.5, 12);
    expect(s.net).toBe(10);
    expect(s.expected).toBeCloseTo(-0.1 - 0.5, 12);
    expect(s.grade).toBe('F');
  });
});

describe('performance', () => {
  it('exact per-decision analysis of a pair in a 6-deck shoe is fast enough for live coaching', () => {
    const t0 = performance.now();
    new EVEngine(DEFAULT_RULES, 2, fullShoe(6)).analyze([2, 2], { double: true, split: true, surrender: true });
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(2000);
  });
});

import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/rng';
import { analyzeDraw, comboEquities, handGroup, rangeEquity } from '../src/holdem/analysis';
import { parseCards, type HCard } from '../src/holdem/cards';
import { categoryOf, evaluate, FLUSH, FULL_HOUSE, ONE_PAIR, STRAIGHT, STRAIGHT_FLUSH, TWO_PAIR, HIGH_CARD, TRIPS, QUADS } from '../src/holdem/evaluate';
import { ALL_CLASSES, classByLabel, combosOf, PREFLOP_ORDER, rangeCombos, topRange } from '../src/holdem/ranges';
import { hitProbability, impliedSpot, potOddsSpot, ruleOfThumb, semiBreakEven, semiSpot } from '../src/holdem/scenarios';
import { comboDrill, rangeDrill } from '../src/holdem/reading';
import { mergeData } from '../src/state/merge';

const ev = (s: string) => evaluate(parseCards(s));

/** Reference evaluator: best of all 5-card subsets, scored by brute-force rules. */
function bruteBest(cards: HCard[]): number {
  let best = -1;
  const n = cards.length;
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++)
      for (let c = b + 1; c < n; c++)
        for (let d = c + 1; d < n; d++)
          for (let e = d + 1; e < n; e++) best = Math.max(best, evaluate([cards[a], cards[b], cards[c], cards[d], cards[e]]));
  return best;
}

describe('hold’em evaluator', () => {
  it('ranks every category correctly', () => {
    expect(categoryOf(ev('AsKsQsJsTs2d3c'))).toBe(STRAIGHT_FLUSH);
    expect(categoryOf(ev('9h9d9s9c2d3c4h'))).toBe(QUADS);
    expect(categoryOf(ev('9h9d9s2c2d3c4h'))).toBe(FULL_HOUSE);
    expect(categoryOf(ev('9h9d9s2c2d2h4h'))).toBe(FULL_HOUSE);
    expect(categoryOf(ev('Ah9h5h3h2hKdKc'))).toBe(FLUSH);
    expect(categoryOf(ev('As2d3c4h5sKdKc'))).toBe(STRAIGHT);
    expect(categoryOf(ev('7s7d7c2h5sKdQc'))).toBe(TRIPS);
    expect(categoryOf(ev('7s7d2c2h5sKdQc'))).toBe(TWO_PAIR);
    expect(categoryOf(ev('7s7d2c3h5sKdQc'))).toBe(ONE_PAIR);
    expect(categoryOf(ev('7s9d2c3h5sKdQc'))).toBe(HIGH_CARD);
  });

  it('breaks ties by kickers and handles the wheel', () => {
    expect(ev('AsAd7c5h2sKdQc')).toBeGreaterThan(ev('AhAc7d5s2cKhJc'));
    expect(ev('6s2d3c4h5s')).toBeGreaterThan(ev('As2d3c4h5s'));
    expect(ev('As2s3s4s5s')).toBeLessThan(ev('2s3s4s5s6s'));
    // Three pair: the best two plus the best kicker.
    expect(ev('KsKd7c7h2s2dAc')).toBe(ev('KhKc7d7sAd3h4c'));
    // Two trips make a full house with the higher set.
    expect(ev('9h9d9s5c5d5h2c')).toBeGreaterThan(ev('9h9d9s4c4d2h3c'));
  });

  it('agrees with a best-of-21 brute force on random hands', () => {
    const rand = mulberry32(7);
    for (let t = 0; t < 3000; t++) {
      const deck = Array.from({ length: 52 }, (_, i) => i);
      for (let i = 51; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
      }
      const seven = deck.slice(0, 7);
      expect(evaluate(seven)).toBe(bruteBest(seven));
    }
  });
});

describe('ranges and combos', () => {
  it('has 169 classes covering 1326 combos', () => {
    expect(ALL_CLASSES.length).toBe(169);
    expect(ALL_CLASSES.reduce((n, c) => n + c.combos, 0)).toBe(1326);
    expect(rangeCombos(ALL_CLASSES, []).length).toBe(1326);
    expect(PREFLOP_ORDER[0].label).toBe('AA');
  });

  it('counts combos with card removal', () => {
    const board = parseCards('AsKd7c');
    expect(combosOf(classByLabel('AKo')!, board).length).toBe(7); // 3 × 3 − 2 suited
    expect(combosOf(classByLabel('AKs')!, board).length).toBe(2);
    expect(combosOf(classByLabel('77')!, board).length).toBe(3);
    expect(combosOf(classByLabel('QJs')!, board).length).toBe(4);
  });

  it('builds top-X% ranges of about the right size', () => {
    const r = topRange(0.15);
    const n = r.reduce((s, c) => s + c.combos, 0);
    expect(n).toBeGreaterThanOrEqual(0.15 * 1326);
    expect(n).toBeLessThan(0.15 * 1326 + 13);
    expect(r.map((c) => c.label)).toContain('AKo');
  });
});

describe('draws, outs and equity', () => {
  it('counts outs for the classic draws', () => {
    expect(analyzeDraw(parseCards('AhKh'), parseCards('7h2h9c')).outs.length).toBe(9);
    expect(analyzeDraw(parseCards('9s8d'), parseCards('7h6c2s')).outs.length).toBe(8);
    expect(analyzeDraw(parseCards('9s8d'), parseCards('7h5c2s')).outs.length).toBe(4);
    const combo = analyzeDraw(parseCards('9h8h'), parseCards('7h6h2c'));
    expect(combo.outs.length).toBe(15);
    expect(combo.kinds).toEqual(['flush', 'oesd']);
  });

  it('hit probabilities and the rule of 2 and 4', () => {
    expect(hitProbability(9, 46, 1)).toBeCloseTo(9 / 46, 12);
    expect(hitProbability(9, 47, 2)).toBeCloseTo(1 - (38 * 37) / (47 * 46), 12);
    expect(ruleOfThumb(9, 2)).toBeCloseTo(0.35, 12);
    expect(ruleOfThumb(8, 1)).toBeCloseTo(0.16, 12);
  });

  it('computes exact equity on the turn', () => {
    // Nut flush draw vs a set: 9 flush outs, but the board-pairing flush cards fill the set up.
    const hero = parseCards('AhKh');
    const board = parseCards('7h2h9c4s');
    const v = [{ a: parseCards('9s')[0], b: parseCards('9d')[0], cls: classByLabel('99')!, w: 1 }];
    const eq = comboEquities(hero, board, v)[0];
    // 44 rivers. Nine hearts are live; 4h fills villain up and 9h gives quads, so 7 win.
    expect(eq).toBeCloseTo(7 / 44, 10);
  });

  it('flop all-in equity matches an independent brute-force count', () => {
    const hero = parseCards('AsAd');
    const board = parseCards('Kc7h2d');
    const [a, b] = parseCards('KdKs');
    const villain = [{ a, b, cls: classByLabel('KK')!, w: 1 }];
    const eq = rangeEquity(comboEquities(hero, board, villain), villain);
    const dead = new Set([...hero, ...board, a, b]);
    const live = Array.from({ length: 52 }, (_, i) => i).filter((c) => !dead.has(c));
    let won = 0;
    let n = 0;
    for (let i = 0; i < live.length; i++)
      for (let j = i + 1; j < live.length; j++) {
        const run = [...board, live[i], live[j]];
        const h = bruteBest([...hero, ...run]);
        const v = bruteBest([a, b, ...run]);
        won += h > v ? 1 : h === v ? 0.5 : 0;
        n++;
      }
    expect(n).toBe(990);
    expect(eq).toBeCloseTo(won / n, 12);
    expect(eq).toBeCloseTo(0.0859, 3); // overpair vs set: the textbook ~8.5%
  });

  it('groups hands for range reading', () => {
    const board = parseCards('Kh7d2c');
    const g = (s: string) => {
      const [a, b] = parseCards(s);
      return handGroup(a, b, board);
    };
    expect(g('7s7c')).toBe('monster');
    expect(g('AsKd')).toBe('top');
    expect(g('AcAd')).toBe('top');
    expect(g('8s8c')).toBe('weak');
    expect(g('QsJs')).toBe('air');
    expect(g('AhQh')).toBe('air');
    const wet = parseCards('Kh7h2c');
    expect(handGroup(parseCards('Ah')[0], parseCards('Qh')[0], wet)).toBe('draw');
  });
});

describe('training-room scenarios', () => {
  it('pot-odds spots are internally consistent', () => {
    const rand = mulberry32(11);
    for (let i = 0; i < 6; i++) {
      const s = potOddsSpot(rand, { profile: 'random', street: 'mixed' });
      expect(s.required).toBeCloseTo(s.bet / (s.pot + 2 * s.bet), 12);
      expect(s.evCall).toBeCloseTo(s.equity * (s.pot + 2 * s.bet) - s.bet, 9);
      expect(s.equity).toBeGreaterThan(0);
      expect(s.equity).toBeLessThan(1);
      expect(s.draw.outs.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('implied-odds EV adds up', () => {
    const rand = mulberry32(5);
    for (let i = 0; i < 4; i++) {
      const s = impliedSpot(rand, { profile: 'random' });
      expect(s.evImplied).toBeCloseTo(s.evDirect + s.extraWin - s.reverseLoss, 9);
      expect(s.evDirect).toBeCloseTo(s.equity * (s.pot + 2 * s.bet) - s.bet, 6);
      expect(s.riverBet).toBeLessThanOrEqual(s.stack);
    }
  });

  it('semi-bluff options follow the EV formula', () => {
    const rand = mulberry32(3);
    const s = semiSpot(rand, { profile: 'tag', street: 'turn' });
    for (const o of s.options.slice(1)) {
      expect(o.ev).toBeCloseTo(o.fold * s.pot + (1 - o.fold) * (o.eqCalled * (s.pot + 2 * o.bet) - o.bet), 9);
      // Hands that continue are stronger than the whole range.
      expect(o.eqCalled).toBeLessThanOrEqual(s.eqAll + 1e-9);
      // At the break-even fold equity the bet is worth exactly zero.
      const fe = semiBreakEven(s.pot, o.bet, o.eqCalled);
      if (fe > 0) expect(fe * s.pot + (1 - fe) * (o.eqCalled * (s.pot + 2 * o.bet) - o.bet)).toBeCloseTo(0, 9);
    }
  });

  it('reading drills have consistent answers', () => {
    const rand = mulberry32(9);
    for (let i = 0; i < 10; i++) {
      const c = comboDrill(rand);
      expect(c.answer).toBe(combosOf(c.cls, [...c.hero, ...c.board]).length);
      const r = rangeDrill(rand, 'random');
      const total = Object.values(r.shares).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(1, 9);
      expect(r.shares[r.answer]).toBe(Math.max(...Object.values(r.shares)));
    }
  });
});

describe('hold’em stats sync', () => {
  it('merges per room, keeping the larger record and the best streak', () => {
    const local = { holdem: { potodds: { hands: 10, correct: 7, steps: 30, stepsCorrect: 22, streak: 2, bestStreak: 4, last: 5 }, reading: { hands: 1, correct: 1, steps: 1, stepsCorrect: 1, streak: 1, bestStreak: 1, last: 1 } } };
    const cloud = { holdem: { potodds: { hands: 6, correct: 6, steps: 18, stepsCorrect: 18, streak: 6, bestStreak: 6, last: 9 } } };
    const m = mergeData(local as never, cloud as never) as Record<string, any>;
    expect(m.holdem.potodds.hands).toBe(10);
    expect(m.holdem.potodds.bestStreak).toBe(6);
    expect(m.holdem.reading.hands).toBe(1);
  });
});

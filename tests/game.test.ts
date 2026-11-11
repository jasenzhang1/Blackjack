import { describe, expect, it } from 'vitest';
import type { Rank } from '../src/engine/cards';
import { makeBotBrain } from '../src/engine/bots';
import { EVEngine } from '../src/engine/ev';
import { Table, type Player } from '../src/engine/game';
import { DEFAULT_RULES, type Rules } from '../src/engine/rules';
import { mulberry32 } from '../src/engine/rng';
import { computeStrategy } from '../src/engine/strategy';

function human(bankroll = 1000): Player {
  return { id: 'me', name: 'You', kind: 'human', bankroll };
}

/** Deals a rigged round to one human seat: player [a, b], dealer [up, hole], then `extra` cards. */
function rigged(rules: Rules, a: Rank, b: Rank, up: Rank, hole: Rank, extra: Rank[] = [], bet = 10) {
  const t = new Table({ rules, seats: 1, rng: mulberry32(1) });
  const p = human();
  t.sit(0, p);
  t.placeBet(0, bet);
  t.rig(rules.dealerPeeks ? [a, up, b, hole, ...extra] : [a, up, b, hole, ...extra]);
  t.startRound();
  t.runUntilBlocked();
  return { t, p };
}

describe('settlement', () => {
  it('blackjack pays 3:2 and 6:5', () => {
    for (const [pays, expected] of [
      [1.5, 15],
      [1.2, 12],
    ] as const) {
      const { t, p } = rigged({ ...DEFAULT_RULES, blackjackPays: pays }, 1, 10, 9, 8);
      t.runUntilBlocked();
      expect(t.phase).toBe('done');
      expect(t.seatNet(0)).toBe(expected);
      expect(p.bankroll).toBe(1000 + expected);
    }
  });

  it('peek: dealer blackjack takes only the original bet; player blackjack pushes', () => {
    const { t } = rigged({ ...DEFAULT_RULES }, 10, 6, 10, 1);
    expect(t.phase).toBe('done');
    expect(t.seatNet(0)).toBe(-10);
    const r2 = rigged({ ...DEFAULT_RULES }, 1, 10, 10, 1);
    expect(r2.t.seatNet(0)).toBe(0);
  });

  it('ENHC: a dealer blackjack takes the doubled bet too', () => {
    const rules = { ...DEFAULT_RULES, dealerPeeks: false };
    const t = new Table({ rules, seats: 1, rng: mulberry32(2) });
    t.sit(0, human());
    t.placeBet(0, 10);
    t.rig([6, 10, 5, 2, 1]); // player 6,5; dealer 10 up; player doubles and draws 2; dealer draws A
    t.startRound();
    t.runUntilBlocked();
    expect(t.pending().kind).toBe('action');
    t.act('D');
    t.runUntilBlocked();
    expect(t.phase).toBe('done');
    expect(t.seatNet(0)).toBe(-20);
  });

  it('late surrender returns half the bet', () => {
    const { t } = rigged({ ...DEFAULT_RULES }, 10, 6, 10, 7);
    expect(t.pending().kind).toBe('action');
    t.act('R');
    t.runUntilBlocked();
    expect(t.seatNet(0)).toBe(-5);
  });

  it('insurance pays 2:1 against a dealer blackjack', () => {
    const { t } = rigged({ ...DEFAULT_RULES }, 10, 9, 1, 10);
    expect(t.pending().kind).toBe('insurance');
    t.decideInsurance(0, true);
    t.runUntilBlocked();
    expect(t.phase).toBe('done');
    expect(t.seatNet(0)).toBe(-10 + 10); // lose main bet, insurance (5) wins 10
  });

  it('splits create separate hands and split aces get one card', () => {
    const { t } = rigged({ ...DEFAULT_RULES }, 1, 1, 6, 10, [10, 9]);
    t.act('P');
    t.runUntilBlocked();
    const hands = t.seats[0].hands;
    expect(hands.length).toBe(2);
    expect(hands.every((h) => h.cards.length === 2 && h.done)).toBe(true);
    // A+T after a split is 21, not blackjack: pays 1:1. Dealer 6+T = 16 draws.
    expect(t.phase).toBe('done');
  });
});

describe('simulation agrees with the exact engine', () => {
  it('house edge from 150k simulated rounds is within 4 standard errors', () => {
    const rules: Rules = { ...DEFAULT_RULES };
    const table = computeStrategy(rules);
    const rng = mulberry32(12345);
    const t = new Table({ rules, seats: 1, rng });
    const bot: Player = { id: 'b', name: 'Bot', kind: 'bot', bankroll: 1e12, style: 'pro' };
    t.sit(0, bot);
    t.botBrain = makeBotBrain(() => table, rng);
    const n = 150_000;
    let sum = 0;
    let sum2 = 0;
    for (let i = 0; i < n; i++) {
      t.placeBet(0, 10);
      t.startRound();
      t.runUntilBlocked();
      const net = t.seatNet(0) / 10;
      sum += net;
      sum2 += net * net;
      t.endRound();
    }
    const mean = sum / n;
    const se = Math.sqrt((sum2 / n - mean * mean) / n);
    expect(Math.abs(-mean - table.houseEdge)).toBeLessThan(4 * se);
  });

  it('rigged 8,8 vs 10: simulated split EV matches the engine (resplits, DAS)', () => {
    const rules: Rules = { ...DEFAULT_RULES, surrender: 'none' };
    const table = computeStrategy(rules);
    const ev = new EVEngine(rules, 10).analyze([8, 8], { double: true, split: true, surrender: false }).ev.P!;
    const rng = mulberry32(777);
    const t = new Table({ rules, seats: 1, rng });
    const bot: Player = { id: 'b', name: 'Bot', kind: 'bot', bankroll: 1e12, style: 'pro' };
    t.sit(0, bot);
    const brain = makeBotBrain(() => table, rng);
    let first = true;
    t.botBrain = {
      ...brain,
      act(tb, seat, hand, avail) {
        if (first) {
          first = false;
          return 'P';
        }
        return brain.act(tb, seat, hand, avail);
      },
    };
    const n = 60_000;
    let sum = 0;
    let sum2 = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      // A fresh shoe each round keeps the composition at "full shoe minus 8,8,T".
      t.newShoe();
      t.placeBet(0, 10);
      t.rig([8, 10, 8]);
      first = true;
      t.startRound();
      t.runUntilBlocked();
      // Dealer blackjack rounds end before the split (EV is conditional on no dealer BJ).
      if (t.seats[0].hands.length >= 2) {
        const net = t.seatNet(0) / 10;
        sum += net;
        sum2 += net * net;
        count++;
      }
      t.endRound();
    }
    const mean = sum / count;
    const se = Math.sqrt((sum2 / count - mean * mean) / count);
    expect(Math.abs(mean - ev)).toBeLessThan(4 * se);
  });
});

describe('draw with replacement (trainer)', () => {
  it('rigged hands always deal as asked, however many rounds', () => {
    const rules: Rules = { ...DEFAULT_RULES, decks: 1 };
    const t = new Table({ rules, seats: 1, rng: mulberry32(7), replacement: true });
    t.sit(0, human(1e9));
    for (let i = 0; i < 2000; i++) {
      t.placeBet(0, 10);
      t.rig([1, 6, 1, 9]); // A,A vs 6: a single deck holds only four aces
      t.startRound();
      t.runUntilBlocked();
      const ranks = t.seats[0].hands[0].cards.map((c) => c.rank);
      expect(ranks).toEqual([1, 1]);
      expect(t.dealer[0].rank).toBe(6);
      t.abortRound();
      expect(t.shoe.length).toBe(52);
    }
  });
});

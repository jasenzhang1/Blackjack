import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../src/engine/rng';
import { groupCache, initialRange, sampleAction, updateRange, villainDist } from '../src/holdem/bot';
import { parseCards } from '../src/holdem/cards';
import { advise, heroOptions } from '../src/holdem/coach';
import { actOf, allCharts, chartShare, parseRange, RFI, VS3BET, vsOpenChart } from '../src/holdem/preflop';
import { PROFILES } from '../src/holdem/profiles';
import { classByLabel } from '../src/holdem/ranges';
import { seatPositions } from '../src/holdem/session';
import { apply, legal, newHand, preflopSpot, START_STACK, totalPot, type HandState } from '../src/holdem/table';

describe('preflop charts', () => {
  it('parses range notation', () => {
    expect([...parseRange('TT-77')].sort()).toEqual(['77', '88', '99', 'TT']);
    expect([...parseRange('A5s-A2s')].sort()).toEqual(['A2s', 'A3s', 'A4s', 'A5s']);
    expect(parseRange('KTo+').size).toBe(3);
    expect(parseRange('AK')).toEqual(new Set(['AKs', 'AKo']));
    expect(parseRange('22+').size).toBe(13);
    for (const c of allCharts()) for (const l of c.acts.keys()) expect(classByLabel(l), `${c.id}: ${l}`).toBeDefined();
  });

  it('opening ranges widen with position and nest', () => {
    const order = ['UTG', 'HJ', 'CO', 'BTN'] as const;
    const shares = order.map((p) => chartShare(RFI[p]));
    for (let i = 1; i < shares.length; i++) expect(shares[i]).toBeGreaterThan(shares[i - 1]);
    expect(shares[0]).toBeGreaterThan(0.15);
    expect(shares[0]).toBeLessThan(0.22);
    expect(shares[3]).toBeGreaterThan(0.4);
    for (let i = 1; i < order.length; i++) for (const l of RFI[order[i - 1]].acts.keys()) expect(actOf(RFI[order[i]], l), `${l} in ${order[i]}`).toBe('raise');
  });

  it('charts give sensible actions', () => {
    expect(actOf(RFI.UTG, 'AA')).toBe('raise');
    expect(actOf(RFI.UTG, '72o')).toBe('fold');
    expect(actOf(vsOpenChart('UTG', 'BTN'), 'AKs')).toBe('raise');
    expect(actOf(vsOpenChart('UTG', 'BTN'), '55')).toBe('call');
    expect(actOf(vsOpenChart('BTN', 'BB'), 'K4s')).toBe('call');
    expect(chartShare(vsOpenChart('BTN', 'BB'))).toBeGreaterThan(chartShare(vsOpenChart('UTG', 'BB')));
    expect(chartShare(VS3BET.light)).toBeGreaterThan(chartShare(VS3BET.tight));
  });
});

/** Plays a hand with a scripted list of moves (hero/villain alternate as the engine dictates). */
function play(s: HandState, moves: Parameters<typeof apply>[1][]): HandState {
  for (const m of moves) s = apply(s, m);
  return s;
}

describe('hand engine', () => {
  const deck = parseCards('AsAd KsKd 2c7h9s Jd 3c').concat(Array.from({ length: 52 }, (_, i) => i).filter((c) => !parseCards('AsAdKsKd2c7h9sJd3c').includes(c)));

  it('posts blinds and dead money', () => {
    const s = newHand(mulberry32(1), 'BTN', 'CO', deck);
    expect(s.dead).toBe(3);
    expect(totalPot(s)).toBe(3);
    expect(s.toAct).toBe('villain'); // CO acts before BTN
    const b = newHand(mulberry32(1), 'SB', 'BB', deck);
    expect(b.dead).toBe(0);
    expect(b.players.hero.stack).toBe(START_STACK - 1);
    expect(b.toAct).toBe('hero');
  });

  it('plays a raised pot to showdown and conserves chips', () => {
    let s = newHand(mulberry32(1), 'BTN', 'BB', deck);
    s = play(s, [{ kind: 'raise', to: 5 }, { kind: 'call' }]);
    expect(s.street).toBe('flop');
    expect(s.board.length).toBe(3);
    expect(s.toAct).toBe('villain'); // BB acts first postflop
    s = play(s, [{ kind: 'check' }, { kind: 'raise', to: 6 }, { kind: 'call' }, { kind: 'check' }, { kind: 'check' }, { kind: 'check' }, { kind: 'check' }]);
    expect(s.over).toBe(true);
    expect(s.showdown).toBe(true);
    expect(s.winner).toBe('hero'); // aces hold
    expect(s.heroNet).toBe(11 + 1); // villain's 11 plus the dead small blind
  });

  it('runs out the board after an all-in', () => {
    let s = newHand(mulberry32(1), 'SB', 'BB', deck);
    s = play(s, [{ kind: 'raise', to: 200 }, { kind: 'call' }]);
    expect(s.over).toBe(true);
    expect(s.board.length).toBe(5);
    expect(Math.abs(s.heroNet)).toBe(200);
  });

  it('handles folds, walks and the min-raise', () => {
    let s = newHand(mulberry32(1), 'BTN', 'UTG', deck);
    expect(s.toAct).toBe('villain');
    s = apply(s, { kind: 'fold' });
    expect(s.over).toBe(false); // folded to you: you still decide
    expect(preflopSpot(s).kind).toBe('rfi');
    expect(legal(s, 'hero').canRaise).toBe(true);
    s = apply(s, { kind: 'raise', to: 5 });
    expect(s.over).toBe(true);
    expect(s.heroNet).toBe(3);
    const w = apply(newHand(mulberry32(1), 'BB', 'SB', deck), { kind: 'fold' });
    expect(w.over).toBe(true);
    expect(w.heroNet).toBe(1);
    const r = apply(newHand(mulberry32(1), 'UTG', 'BB', deck), { kind: 'raise', to: 5 });
    expect(legal(r, 'villain').minTo).toBe(8);
  });

  it('seats rotate positions', () => {
    expect(seatPositions(0)).toEqual(['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']);
    expect(seatPositions(3)[0]).toBe('UTG');
  });
});

describe('bots and coach', () => {
  it('bot probabilities sum to one and range updates follow Bayes', () => {
    const rand = mulberry32(4);
    const groups = groupCache();
    for (const id of ['nit', 'tag', 'lag', 'station', 'maniac'] as const) {
      const p = PROFILES[id];
      let s = newHand(rand, 'BTN', 'BB', undefined);
      s = apply(s, { kind: 'raise', to: 5 });
      let range = initialRange(s.players.hero.hole);
      for (const c of range.slice(0, 200)) {
        const d = villainDist(s, p, c.a, c.b, groups);
        expect(d.fold + d.passive + d.aggressive).toBeCloseTo(1, 12);
      }
      const d = villainDist(s, p, s.players.villain.hole[0], s.players.villain.hole[1], groups);
      const act = sampleAction(d, rand());
      range = updateRange(range, s, p, act, groups);
      // The villain's real hand always stays in the range it is consistent with.
      expect(range.some((c) => (c.a === s.players.villain.hole[0] && c.b === s.players.villain.hole[1]) || (c.b === s.players.villain.hole[0] && c.a === s.players.villain.hole[1]))).toBe(true);
    }
  });

  it('a tight player who calls preflop has a narrower range than a station', () => {
    const groups = groupCache();
    const s = apply(newHand(mulberry32(2), 'CO', 'BTN'), { kind: 'raise', to: 5 });
    const n = (id: 'nit' | 'station') => updateRange(initialRange(s.players.hero.hole), s, PROFILES[id], 'passive', groups).reduce((t, c) => t + c.w, 0);
    expect(n('nit')).toBeLessThan(n('station') / 3);
  });

  it('aggressive players fold less to a raise than tight ones', () => {
    const groups = groupCache();
    let s = newHand(mulberry32(12), 'BTN', 'BB');
    s = apply(apply(s, { kind: 'raise', to: 5 }), { kind: 'call' });
    s = apply(s, { kind: 'raise', to: 4 }); // villain (BB) bets the flop
    s = apply(s, { kind: 'raise', to: 12 }); // you raise
    const range = initialRange([...s.players.hero.hole, ...s.board]);
    const foldShare = (id: 'nit' | 'maniac' | 'station') => range.reduce((t, c) => t + villainDist(s, PROFILES[id], c.a, c.b, groups).fold, 0) / range.length;
    expect(foldShare('maniac')).toBeLessThan(foldShare('nit'));
    expect(foldShare('station')).toBeLessThan(foldShare('nit'));
  });

  it('coach values options consistently', () => {
    const rand = mulberry32(8);
    const groups = groupCache();
    const p = PROFILES.tag;
    let s = newHand(rand, 'BTN', 'BB');
    let range = initialRange(s.players.hero.hole);
    s = apply(s, { kind: 'raise', to: 5 });
    range = updateRange(range, s, p, 'passive', groups);
    s = apply(s, { kind: 'call' });
    range = range.filter((c) => !s.board.includes(c.a) && !s.board.includes(c.b));
    range = updateRange(range, s, p, 'passive', groups);
    s = apply(s, { kind: 'check' });
    const a = advise(s, p, range, groups);
    expect(a.evals!.length).toBe(heroOptions(s).length);
    const check = a.evals!.find((e) => e.option.id === 'check')!;
    expect(check.ev).toBeCloseTo(a.equity! * totalPot(s), 9);
    expect(a.ok).toContain(a.bestId);
  });
});

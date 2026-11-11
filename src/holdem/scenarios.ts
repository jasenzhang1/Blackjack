/**
 * Scenario generators for the training rooms. Every number a room grades against is computed
 * exactly from the cards (runout enumeration against a weighted range); the only modelling is the
 * opponent's behaviour, which comes from the profiles and is shown to the player.
 */
import { pick, shuffle, type RNG } from '../engine/rng';
import { fullDeck, liveCards, suitOf, type HCard } from './cards';
import { analyzeDraw, comboEquities, handGroup, handScore, improvesBoard, rangeEquity, strengthKey, totalWeight, type DrawInfo, type DrawKind, type WeightedCombo } from './analysis';
import { categoryOf, FLUSH } from './evaluate';
import { foldVs, PROFILE_IDS, PROFILES, type HandGroup, type Profile, type ProfileId, type Visibility } from './profiles';
import { rangeCombos, topRange } from './ranges';

export type Street = 'flop' | 'turn';
export type DrawTarget = 'flush' | 'straight' | 'combo' | 'gutshot';

/** Rounds a dollar amount the way bets are made at a $1/$2 table. */
export function roundMoney(x: number): number {
  return x < 20 ? Math.max(1, Math.round(x)) : Math.round(x / 5) * 5;
}

function matchesTarget(kinds: DrawKind[], t: DrawTarget): boolean {
  const flush = kinds.includes('flush');
  const st = kinds.includes('oesd') || kinds.includes('double-gutter');
  const gut = kinds.includes('gutshot');
  if (t === 'flush') return flush && !st && !gut;
  if (t === 'straight') return st && !flush;
  if (t === 'gutshot') return gut && !flush;
  return flush && (st || gut);
}

export interface DrawDeal {
  hero: HCard[];
  board: HCard[];
  draw: DrawInfo;
}

/** Deals hero a pure draw (no pair of their own yet) on a flop or turn. */
export function dealDraw(rand: RNG, street: Street, target: DrawTarget = pick(rand, ['flush', 'flush', 'straight', 'straight', 'combo', 'gutshot'] as const)): DrawDeal {
  const nb = street === 'flop' ? 3 : 4;
  for (let t = 0; t < 40000; t++) {
    const d = shuffle(fullDeck(), rand);
    const hero = [d[0], d[1]];
    const board = d.slice(2, 2 + nb);
    if (improvesBoard(hero, board)) continue;
    const draw = analyzeDraw(hero, board);
    if (!matchesTarget(draw.kinds, target) || draw.outs.length < 4) continue;
    return { hero, board, draw };
  }
  return dealDraw(rand, street, 'flush');
}

/** Villain's range on this board: preflop range weighted by how often each hand plays this way. */
export function weightedRange(board: readonly HCard[], dead: readonly HCard[], preflopShare: number, weight: (g: HandGroup) => number): WeightedCombo[] {
  return rangeCombos(topRange(preflopShare), dead)
    .map((c) => {
      const group = handGroup(c.a, c.b, board);
      return { ...c, group, w: weight(group) };
    })
    .filter((c) => c.w > 0);
}

export const bettingRange = (p: Profile, board: readonly HCard[], dead: readonly HCard[]) => weightedRange(board, dead, p.stats.vpip / 100, (g) => p.betProb[g]);

/** Rule of 2 and 4 (with the "minus outs above 8" correction on the flop). */
export function ruleOfThumb(outs: number, cardsToCome: 1 | 2): number {
  if (cardsToCome === 1) return (2 * outs) / 100;
  return (4 * outs - Math.max(0, outs - 8)) / 100;
}

/** Exact probability of hitting one of `outs` with 1 or 2 cards to come from `unseen` cards. */
export function hitProbability(outs: number, unseen: number, cardsToCome: 1 | 2): number {
  if (cardsToCome === 1) return outs / unseen;
  return 1 - ((unseen - outs) * (unseen - outs - 1)) / (unseen * (unseen - 1));
}

const randomProfile = (rand: RNG, id: ProfileId | 'random'): Profile => PROFILES[id === 'random' ? pick(rand, PROFILE_IDS) : id];
const randomPot = (rand: RNG, lo = 20, hi = 240) => roundMoney(lo + rand() * (hi - lo));

// ---------------------------------------------------------------------------------------------
// Pot odds
// ---------------------------------------------------------------------------------------------

export interface PotOddsSpot {
  street: Street;
  /** Flop spots are all-in (both remaining cards come with no more betting). */
  allIn: boolean;
  hero: HCard[];
  board: HCard[];
  draw: DrawInfo;
  profile: Profile;
  range: WeightedCombo[];
  /** Pot before villain's bet. */
  pot: number;
  bet: number;
  equity: number;
  /** Equity needed to call: B / (P + 2B). */
  required: number;
  /** EV of calling, in dollars, relative to folding. */
  evCall: number;
  unseen: number;
  hitProb: number;
  rule: number;
  /** Turn only: where the exact equity comes from. */
  split?: TurnSplit;
}

export interface TurnSplit {
  /** Equity won on rivers that complete the draw. */
  fromOuts: number;
  /** Equity won on every other river (beating bluffs, pairing up). */
  fromOther: number;
  /** Probability that the draw completes but still loses. */
  hitButLose: number;
  /** Probability that the draw completes. */
  hit: number;
}

/** Splits turn equity into what the outs win and what the other rivers win. */
export function turnSplit(hero: readonly HCard[], board: readonly HCard[], range: readonly WeightedCombo[], outs: readonly HCard[]): TurnSplit {
  const W = totalWeight(range);
  const rivers = liveCards([...hero, ...board]);
  const hs = new Map(rivers.map((c) => [c, handScore(hero, board, [c])]));
  const outSet = new Set(outs);
  const r: TurnSplit = { fromOuts: 0, fromOther: 0, hitButLose: 0, hit: 0 };
  for (const v of range) {
    const valid = rivers.filter((c) => c !== v.a && c !== v.b);
    const m = v.w / W / valid.length;
    for (const c of valid) {
      const h = hs.get(c)!;
      const s = handScore([v.a, v.b], board, [c]);
      const e = h > s ? 1 : h === s ? 0.5 : 0;
      if (outSet.has(c)) {
        r.hit += m;
        r.fromOuts += m * e;
        if (e === 0) r.hitButLose += m;
      } else r.fromOther += m * e;
    }
  }
  return r;
}

export function potOddsSpot(rand: RNG, opts: { profile: ProfileId | 'random'; street: Street | 'mixed' }): PotOddsSpot {
  let best: PotOddsSpot | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const street: Street = opts.street === 'mixed' ? (rand() < 0.6 ? 'turn' : 'flop') : opts.street;
    const profile = randomProfile(rand, opts.profile);
    const { hero, board, draw } = dealDraw(rand, street);
    const range = bettingRange(profile, board, [...hero, ...board]);
    if (totalWeight(range) < 3) continue;
    const pot = randomPot(rand);
    const frac = street === 'turn' ? pick(rand, [0.33, 0.5, 0.66, 0.75, 1, 1.25]) : pick(rand, [0.75, 1, 1.5, 2]);
    const bet = roundMoney(pot * frac);
    const equity = rangeEquity(comboEquities(hero, board, range), range);
    const required = bet / (pot + 2 * bet);
    const cardsToCome = street === 'turn' ? 1 : 2;
    const unseen = 52 - 2 - board.length;
    const spot: PotOddsSpot = {
      street,
      allIn: street === 'flop',
      hero,
      board,
      draw,
      profile,
      range,
      pot,
      bet,
      equity,
      required,
      evCall: equity * (pot + 2 * bet) - bet,
      unseen,
      hitProb: hitProbability(draw.outs.length, unseen, cardsToCome),
      rule: ruleOfThumb(draw.outs.length, cardsToCome),
      split: street === 'turn' ? turnSplit(hero, board, range, draw.outs) : undefined,
    };
    best = spot;
    // Prefer decisions that are close enough to need the math.
    if (Math.abs(equity - required) < 0.15) break;
  }
  return best ?? potOddsSpot(rand, opts);
}

// ---------------------------------------------------------------------------------------------
// Implied odds
// ---------------------------------------------------------------------------------------------

export interface OutGroup {
  label: string;
  cards: HCard[];
  vis: Visibility;
  /** Probability villain pays your river bet when this out lands and you are ahead. */
  pay: number;
  /** How often you actually win when this out lands (dirty outs lose). */
  winWhenHit: number;
}

export interface ImpliedSpot {
  hero: HCard[];
  board: HCard[];
  draw: DrawInfo;
  profile: Profile;
  range: WeightedCombo[];
  pot: number;
  bet: number;
  /** Effective stack behind after calling. */
  stack: number;
  /** River value bet when you hit (capped by the stack). */
  riverBet: number;
  equity: number;
  /** Probability of completing the draw: outs / 46. */
  hitProb: number;
  /** Classic break-even future winnings: B/h − (P + 2B). */
  neededW: number;
  evDirect: number;
  /** Expected extra won on the river when you hit and villain pays. */
  extraWin: number;
  /** Expected extra lost on the river when you hit and still lose (reverse implied odds). */
  reverseLoss: number;
  evImplied: number;
  groups: OutGroup[];
}

function visibilityOf(hero: readonly HCard[], board: readonly HCard[], c: HCard, draw: DrawInfo): Visibility {
  if (categoryOf(handScore(hero, board, [c])) >= FLUSH && draw.flushSuit >= 0 && suitOf(c) === draw.flushSuit) return 'obvious';
  return draw.kinds.includes('oesd') ? 'medium' : 'hidden';
}

export function impliedSpot(rand: RNG, opts: { profile: ProfileId | 'random' }): ImpliedSpot {
  const wantShort = rand() < 0.8; // most spots: the direct price is not enough on its own
  let last: ImpliedSpot | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const profile = randomProfile(rand, opts.profile);
    const { hero, board, draw } = dealDraw(rand, 'turn', pick(rand, ['flush', 'straight', 'gutshot', 'gutshot', 'combo'] as const));
    const range = bettingRange(profile, board, [...hero, ...board]);
    const W = totalWeight(range);
    if (W < 3) continue;
    const pot = randomPot(rand, 20, 160);
    const bet = roundMoney(pot * pick(rand, [0.5, 0.66, 0.75, 1]));
    const stack = roundMoney(pot * pick(rand, [0.5, 1, 2, 3, 5]));
    const riverBet = Math.min(stack, roundMoney(0.7 * (pot + 2 * bet)));
    const rivers = liveCards([...hero, ...board]);
    const heroScores = new Map(rivers.map((c) => [c, handScore(hero, board, [c])]));
    const outSet = new Set(draw.outs);
    const vis = new Map(draw.outs.map((c) => [c, visibilityOf(hero, board, c, draw)]));
    const hitMass = new Map<HCard, { win: number; all: number }>();
    let evDirect = 0;
    let extraWin = 0;
    let reverseLoss = 0;
    let eq = 0;
    for (const v of range) {
      const valid = rivers.filter((c) => c !== v.a && c !== v.b);
      const m = v.w / W / valid.length;
      const pays = v.group === 'monster' || v.group === 'top' || v.group === 'weak';
      for (const c of valid) {
        const h = heroScores.get(c)!;
        const s = handScore([v.a, v.b], board, [c]);
        const made = outSet.has(c);
        if (made) {
          const hm = hitMass.get(c) ?? { win: 0, all: 0 };
          hm.all += m;
          if (h > s) hm.win += m;
          hitMass.set(c, hm);
        }
        if (h > s) {
          evDirect += m * (pot + bet);
          eq += m;
          if (made && pays) extraWin += m * riverBet * profile.payoff[vis.get(c)!];
        } else if (h === s) {
          evDirect += (m * pot) / 2;
          eq += m / 2;
        } else {
          evDirect -= m * bet;
          if (made) reverseLoss += m * riverBet;
        }
      }
    }
    const groups: OutGroup[] = [];
    const byVis = new Map<Visibility, HCard[]>();
    for (const c of draw.outs) byVis.set(vis.get(c)!, [...(byVis.get(vis.get(c)!) ?? []), c]);
    for (const [v, cards] of byVis) {
      let win = 0;
      let all = 0;
      for (const c of cards) {
        win += hitMass.get(c)?.win ?? 0;
        all += hitMass.get(c)?.all ?? 0;
      }
      groups.push({ label: v === 'obvious' ? 'Flush cards' : 'Straight cards', cards, vis: v, pay: profile.payoff[v], winWhenHit: all ? win / all : 0 });
    }
    const hitProb = draw.outs.length / 46;
    const spot: ImpliedSpot = {
      hero,
      board,
      draw,
      profile,
      range,
      pot,
      bet,
      stack,
      riverBet,
      equity: eq,
      hitProb,
      neededW: bet / hitProb - (pot + 2 * bet),
      evDirect,
      extraWin,
      reverseLoss,
      evImplied: evDirect + extraWin - reverseLoss,
      groups,
    };
    last = spot;
    if (wantShort === evDirect < 0) break;
  }
  return last ?? impliedSpot(rand, opts);
}

// ---------------------------------------------------------------------------------------------
// Semi-bluffs
// ---------------------------------------------------------------------------------------------

export type SemiAction = 'check' | 'half' | 'pot';

export interface SemiOption {
  id: SemiAction;
  label: string;
  bet: number;
  /** Fraction of villain's range that folds. */
  fold: number;
  /** Your equity against the hands that continue. */
  eqCalled: number;
  ev: number;
}

export interface SemiSpot {
  street: Street;
  hero: HCard[];
  board: HCard[];
  draw: DrawInfo;
  profile: Profile;
  pot: number;
  range: WeightedCombo[];
  /** Equity against villain's whole checking range. */
  eqAll: number;
  options: SemiOption[];
  /** Size used for the break-even fold equity question. */
  quiz: SemiAction;
}

export function semiSpot(rand: RNG, opts: { profile: ProfileId | 'random'; street: Street | 'mixed' }): SemiSpot {
  const street: Street = opts.street === 'mixed' ? (rand() < 0.5 ? 'turn' : 'flop') : opts.street;
  const profile = randomProfile(rand, opts.profile);
  const { hero, board, draw } = dealDraw(rand, street);
  // Villain called preflop and checks: assume the whole calling range checks to the raiser.
  const range = weightedRange(board, [...hero, ...board], profile.stats.vpip / 100, () => 1);
  const eqs = comboEquities(hero, board, range);
  const eqAll = rangeEquity(eqs, range);
  const pot = randomPot(rand, 15, 160);
  const order = range.map((c, i) => ({ i, k: strengthKey(c.a, c.b, board, c.group), w: c.w })).sort((x, y) => y.k - x.k);
  const W = totalWeight(range);

  const option = (id: SemiAction, frac: number): SemiOption => {
    const bet = roundMoney(pot * frac);
    const fold = foldVs(profile, frac);
    // The strongest (1 − fold) of the range continues; the boundary hand continues fractionally.
    let keep = (1 - fold) * W;
    let s = 0;
    let w = 0;
    for (const o of order) {
      if (keep <= 0) break;
      const take = Math.min(o.w, keep);
      s += eqs[o.i] * take;
      w += take;
      keep -= take;
    }
    const eqCalled = w ? s / w : 0;
    return { id, label: id === 'half' ? `Bet half pot ($${bet})` : `Bet pot ($${bet})`, bet, fold, eqCalled, ev: fold * pot + (1 - fold) * (eqCalled * (pot + 2 * bet) - bet) };
  };
  const options: SemiOption[] = [{ id: 'check', label: 'Check (free card)', bet: 0, fold: 0, eqCalled: eqAll, ev: eqAll * pot }, option('half', 0.5), option('pot', 1)];
  return { street, hero, board, draw, profile, pot, range, eqAll, options, quiz: rand() < 0.5 ? 'half' : 'pot' };
}

/** Break-even fold equity for a semi-bluff: (B − q(P+2B)) / (P + B − q(P+2B)). */
export function semiBreakEven(pot: number, bet: number, eqCalled: number): number {
  const x = eqCalled * (pot + 2 * bet) - bet;
  return x >= 0 ? 0 : -x / (pot - x);
}

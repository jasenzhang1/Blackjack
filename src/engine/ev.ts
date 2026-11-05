/**
 * Player expected-value engine (composition-dependent, exact card removal).
 *
 * Notation: R = multiset of cards removed from the shoe besides the upcard (the player's cards,
 * plus — for a split hand — the partner hand's starting card). D(R) = dealer final distribution for
 * the shoe minus R. All internal values are "J-values"
 *
 *            J = E[ payoff · 1{dealer has no blackjack} ]
 *
 * When the dealer peeks (US rules, upcard A or T) the player acts knowing there is no dealer
 * blackjack, so the quantity of interest is E[payoff | no BJ] = J / P(no BJ). Working with J
 * keeps the recursion exact *including the effect of the hole card on the player's own draws*:
 * by exchangeability the player's draws may be treated as coming before the hole card, after which
 * "no blackjack" is an event about the dealer's cards only (see docs/MATH.md §3).
 *
 *   Stand:   J_S(R, t)  = Σ_o D_o(R) · w(t, o)      (w = +1 win, 0 push, −1 loss; BJ term dropped)
 *   Hit:     J_H(R)     = Σ_c P(c | R) · J*(R + c),   J*(·) = max(J_S, J_H), bust ⇒ −P(no BJ | R + c)
 *   Double:  J_D(R)     = 2 · Σ_c P(c | R) · J_S(R + c)
 *   Surrender (late):  −½ · P(no BJ | R)
 *   Split:   per-hand values from the shoe with both pair cards removed + exact resplit chain.
 */
import { INFINITE_PROBS, fullShoe, type Counts, type Rank } from './cards';
import { dealerDistribution, dealerDistributionInfinite, dealerTerms, OUT_BJ, type DealerTerms } from './dealer';
import { canDoubleTotal, type Rules } from './rules';
import { handValue, totalOf } from './hand';
import { mulberry32 } from './rng';

export type Action = 'H' | 'S' | 'D' | 'P' | 'R';
export const ACTIONS: readonly Action[] = ['H', 'S', 'D', 'P', 'R'];
export const ACTION_NAMES: Record<Action, string> = { H: 'Hit', S: 'Stand', D: 'Double', P: 'Split', R: 'Surrender' };
export type ActionEVs = Partial<Record<Action, number>>;

export type EVBasis = 'conditional' | 'unconditional';

/** Probability distribution of a play's net result, in bets: sorted by payoff, probabilities sum to 1. */
export type Outcomes = { x: number; p: number }[];

export interface PlayDistributions {
  dist: Partial<Record<Action, Outcomes>>;
  /** Actions whose distribution was simulated rather than computed exactly, with the sample size. */
  simulated: Partial<Record<Action, number>>;
}

/** Mean and standard deviation of a distribution. */
export function outcomeStats(o: Outcomes): { mean: number; sd: number } {
  let m = 0;
  let m2 = 0;
  for (const { x, p } of o) {
    m += p * x;
    m2 += p * x * x;
  }
  return { mean: m, sd: Math.sqrt(Math.max(0, m2 - m * m)) };
}

function toOutcomes(map: Map<number, number>, scale = 1): Outcomes {
  const out: Outcomes = [];
  for (const [x, p] of map) if (p > 1e-12) out.push({ x, p: p / scale });
  return out.sort((a, b) => a.x - b.x);
}

export interface RootOptions {
  double: boolean;
  split: boolean;
  surrender: boolean;
}

export interface RootEV {
  ev: ActionEVs;
  /** P(dealer blackjack | upcard and the player's cards). */
  pBJ: number;
  /**
   * 'conditional' — EVs given that the dealer has no blackjack (the dealer has peeked).
   * 'unconditional' — EVs before the peek / without conditioning (upcards 2–9, no-hole-card games,
   * or early surrender against A/T where the decision is made before the peek).
   */
  basis: EVBasis;
}

/** Mixed-radix weights for encoding the multiset R as an integer (see bounds in MATH.md §6). */
const RADIX = [1, 23, 12, 9, 7, 6, 5, 5, 4, 4, 4];
const WEIGHT: number[] = (() => {
  const w = new Array(11).fill(0);
  let acc = 1;
  for (let r = 1; r <= 10; r++) {
    w[r] = acc;
    acc *= RADIX[r];
  }
  return w;
})();

/**
 * Expected number of finished hands of each kind when splitting a pair, as an exact Markov chain.
 *
 * Every pending one-card hand draws a card: with probability p it is another pair card and, if
 * fewer than `maxHands` hands exist, it is resplit (one pending hand becomes two); otherwise the
 * hand is finished — as "pair card + non-pair card" or, when resplitting is exhausted, as a
 * two-card pair that must be played out.
 *
 * Returns [E #hands finished with a non-pair second card, E #hands finished as an unsplittable pair].
 */
export function splitChain(p: number, maxHands: number): [number, number] {
  const memo = new Map<number, [number, number]>();
  const f = (pending: number, hands: number): [number, number] => {
    if (pending === 0) return [0, 0];
    const key = pending * 64 + hands;
    const hit = memo.get(key);
    if (hit) return hit;
    const done = f(pending - 1, hands);
    let pairBranch: [number, number];
    if (hands < maxHands) pairBranch = f(pending + 1, hands + 1);
    else pairBranch = [done[0], done[1] + 1];
    const res: [number, number] = [p * pairBranch[0] + (1 - p) * (done[0] + 1), p * pairBranch[1] + (1 - p) * done[1]];
    memo.set(key, res);
    return res;
  };
  return f(2, 2);
}

// --------------------------------------------------------------------------------------------
// Explanation types (consumed by the proof drawer)
// --------------------------------------------------------------------------------------------

export interface DrawRow {
  rank: Rank;
  /** Probability the next card is `rank` (conditional on no dealer BJ when applicable). */
  p: number;
  cards: Rank[];
  total: number;
  soft: boolean;
  bust: boolean;
  /** Optimal continuation after the draw (for the hit table); 'S' for double rows. */
  action: 'S' | 'H' | null;
  /** EV of the resulting position (per unit of the original bet, before doubling). */
  ev: number;
  standEv?: number;
  hitEv?: number;
}

export interface SplitRow {
  rank: Rank;
  p: number;
  total: number;
  soft: boolean;
  action: 'S' | 'H' | 'D';
  ev: number;
  /** True if this second card is another pair card (the hand may be resplit). */
  isPair: boolean;
}

export interface Explanation {
  cards: Rank[];
  up: Rank;
  total: number;
  soft: boolean;
  basis: EVBasis;
  /** True when EVs were converted to the pre-peek basis because of early surrender. */
  earlyConversion: boolean;
  pBJ: number;
  ev: ActionEVs;
  best: Action;
  /** Cards left in the shoe for this calculation (null = infinite deck). */
  shoe: number[] | null;
  stand: {
    total: number;
    /** Dealer outcome probabilities 17,18,19,20,21,bust,BJ on the post-peek basis. */
    dealer: number[];
    win: number;
    push: number;
    lose: number;
    ev: number;
  };
  hit: { ev: number; rows: DrawRow[] } | null;
  double: { ev: number; rows: DrawRow[] } | null;
  split: {
    ev: number;
    pPair: number;
    maxHands: number;
    oneCardAces: boolean;
    rows: SplitRow[];
    eNonPair: number;
    ePairFinal: number;
    nNonPair: number;
    nPairFinal: number;
  } | null;
  surrender: { ev: number; early: boolean } | null;
}

// --------------------------------------------------------------------------------------------

export class EVEngine {
  readonly rules: Rules;
  readonly up: Rank;
  readonly infinite: boolean;
  private readonly base: number[];
  private readonly baseN: number;
  private readonly terms: DealerTerms;
  /** Conditioning on "no dealer blackjack" applies (peek game, upcard A or T). */
  private readonly peek: boolean;
  /** A dealer blackjack counts as a loss in the stand formula (no-hole-card game, upcard A/T). */
  private readonly enhcBJ: boolean;
  private readonly rem = new Int32Array(11);
  private remN = 0;
  private key = 0;
  private readonly dealerMemo = new Map<number, Float64Array>();
  private readonly hsMemo = new Map<number, number>();
  private infDealer: Float64Array | null = null;
  private readonly shoeBuf: number[] = new Array(11).fill(0);
  stats = { dealerEvals: 0 };

  /**
   * @param shoe composition from which the upcard and the player's cards are dealt (defaults to the
   *             full shoe for `rules.decks`). Ignored for an infinite deck.
   */
  constructor(rules: Rules, up: Rank, shoe?: Counts) {
    this.rules = rules;
    this.up = up;
    this.infinite = !shoe && !Number.isFinite(rules.decks);
    const s = (shoe ?? (this.infinite ? fullShoe(1) : fullShoe(rules.decks))).slice();
    if (!this.infinite) {
      if (s[up] <= 0) throw new Error('Upcard not available in shoe');
      s[up]--;
    }
    this.base = s;
    this.baseN = s.reduce((a, b) => a + b, 0);
    this.terms = dealerTerms(up, rules.hitSoft17);
    const bjUp = up === 1 || up === 10;
    this.peek = rules.dealerPeeks && bjUp;
    this.enhcBJ = !rules.dealerPeeks && bjUp;
  }

  // ---- shoe state --------------------------------------------------------------------------

  private push(r: number): void {
    this.rem[r]++;
    this.remN++;
    this.key += WEIGHT[r];
  }

  private pop(r: number): void {
    this.rem[r]--;
    this.remN--;
    this.key -= WEIGHT[r];
  }

  private resetTo(cards: readonly Rank[]): void {
    for (let r = 1; r <= 10; r++) while (this.rem[r] > 0) this.pop(r);
    for (const c of cards) this.push(c);
  }

  /** Probability that the next card drawn is rank r, given the cards removed so far. */
  private p(r: number): number {
    if (this.infinite) return INFINITE_PROBS[r];
    const left = this.base[r] - this.rem[r];
    return left > 0 ? left / (this.baseN - this.remN) : 0;
  }

  private dealer(): Float64Array {
    if (this.infinite) return (this.infDealer ??= dealerDistributionInfinite(this.terms));
    let d = this.dealerMemo.get(this.key);
    if (!d) {
      for (let r = 1; r <= 10; r++) this.shoeBuf[r] = this.base[r] - this.rem[r];
      d = dealerDistribution(this.terms, this.shoeBuf, new Float64Array(7));
      this.dealerMemo.set(this.key, d);
      this.stats.dealerEvals++;
    }
    return d;
  }

  /** P(no dealer blackjack | current shoe) when conditioning applies, else 1. */
  private scale(): number {
    if (!this.peek) return 1;
    const need = this.up === 1 ? 10 : 1;
    if (this.infinite) return 1 - INFINITE_PROBS[need];
    const left = this.base[need] - this.rem[need];
    return 1 - left / (this.baseN - this.remN);
  }

  /** P(dealer blackjack | current shoe), regardless of the peek rule. */
  private pBlackjack(): number {
    if (this.up !== 1 && this.up !== 10) return 0;
    const need = this.up === 1 ? 10 : 1;
    if (this.infinite) return INFINITE_PROBS[need];
    const left = this.base[need] - this.rem[need];
    return left / (this.baseN - this.remN);
  }

  // ---- J-value recursion -------------------------------------------------------------------

  private standJ(total: number): number {
    const d = this.dealer();
    const bjLoss = this.enhcBJ ? d[OUT_BJ] : 0;
    if (total < 17) return d[5] - (d[0] + d[1] + d[2] + d[3] + d[4]) - bjLoss;
    let ev = d[5] - bjLoss;
    for (let o = 0; o < 5; o++) {
      const t = 17 + o;
      if (t < total) ev += d[o];
      else if (t > total) ev -= d[o];
    }
    return ev;
  }

  private bustJ(): number {
    return -this.scale();
  }

  /** max(stand, hit) for a hand that may only hit or stand; memoised on (R, context). */
  private bestHS(hard: number, ace: boolean, ctx: number): number {
    const total = totalOf(hard, ace);
    if (total === 21) return this.standJ(21);
    const mk = this.key * 11 + ctx;
    const memo = this.hsMemo.get(mk);
    if (memo !== undefined) return memo;
    let best = this.hitJ(hard, ace, ctx);
    // Lemma (MATH.md §4.2): with hard ≤ 11 or soft ≤ 16 hitting weakly dominates standing, so the
    // stand value is only needed from hard 12 / soft 17 upward.
    const soft = ace && hard <= 11;
    if (soft ? total >= 17 : total >= 12) {
      const s = this.standJ(total);
      if (s > best) best = s;
    }
    this.hsMemo.set(mk, best);
    return best;
  }

  private hitJ(hard: number, ace: boolean, ctx: number): number {
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      const p = this.p(r);
      if (p === 0) continue;
      this.push(r);
      const nh = hard + r;
      ev += p * (nh > 21 ? this.bustJ() : this.bestHS(nh, ace || r === 1, ctx));
      this.pop(r);
    }
    return ev;
  }

  private doubleJ(hard: number, ace: boolean): number {
    let ev = 0;
    for (let r = 1; r <= 10; r++) {
      const p = this.p(r);
      if (p === 0) continue;
      this.push(r);
      const nh = hard + r;
      ev += p * (nh > 21 ? this.bustJ() : this.standJ(totalOf(nh, ace || r === 1)));
      this.pop(r);
    }
    return 2 * ev;
  }

  /**
   * Split EV on the post-peek basis. Current state must be R = {X, X}.
   * Returns the total plus the per-second-card details used by the proof drawer.
   */
  private splitDetail(X: Rank): NonNullable<Explanation['split']> {
    const rules = this.rules;
    const rootScale = this.scale();
    const oneCardAces = X === 1 && !rules.hitSplitAces;
    const rows: SplitRow[] = [];
    let pPair = 0;
    let sumNon = 0;
    let wNon = 0;
    let ePairFinal = 0;
    for (let c = 1; c <= 10; c++) {
      const pc = this.p(c);
      if (pc === 0) continue;
      this.push(c);
      const sc = this.scale();
      const hard = X + c;
      const ace = X === 1 || c === 1;
      const total = totalOf(hard, ace);
      const soft = ace && hard <= 11;
      let v: number;
      let action: 'S' | 'H' | 'D' = 'S';
      if (oneCardAces) {
        v = this.standJ(total);
      } else {
        const s = this.standJ(total);
        const h = total < 21 ? this.hitJ(hard, ace, X) : -Infinity;
        v = s;
        if (h > v) {
          v = h;
          action = 'H';
        }
        if (rules.doubleAfterSplit && canDoubleTotal(rules, total, soft)) {
          const d = this.doubleJ(hard, ace);
          if (d > v) {
            v = d;
            action = 'D';
          }
        }
      }
      this.pop(c);
      const pCond = (pc * sc) / rootScale;
      const vCond = v / sc;
      rows.push({ rank: c as Rank, p: pCond, total, soft, action, ev: vCond, isPair: c === X });
      if (c === X) {
        pPair = pCond;
        ePairFinal = vCond;
      } else {
        sumNon += pCond * vCond;
        wNon += pCond;
      }
    }
    const maxHands = X === 1 ? (rules.resplitAces ? rules.maxSplitHands : 2) : rules.maxSplitHands;
    const [nNonPair, nPairFinal] = splitChain(pPair, maxHands);
    const eNonPair = wNon > 0 ? sumNon / wNon : 0;
    return {
      ev: nNonPair * eNonPair + nPairFinal * ePairFinal,
      pPair,
      maxHands,
      oneCardAces,
      rows,
      eNonPair,
      ePairFinal,
      nNonPair,
      nPairFinal,
    };
  }

  // ---- outcome distributions ---------------------------------------------------------------
  //
  // Same recursion as the J-values, but tracking the probability mass of each result instead of
  // its expectation. Masses are "J-masses" (P(result and no dealer blackjack) when the dealer has
  // peeked), so dividing by scale() at the root conditions on the peek exactly as the EVs do.
  // A single hand only ends in lose / push / win, stored as [lose, push, win].

  private readonly distMemo = new Map<number, Float64Array>();

  private standDist(total: number): Float64Array {
    const d = this.dealer();
    const out = new Float64Array(3);
    out[0] = this.enhcBJ ? d[OUT_BJ] : 0;
    out[2] += d[5];
    for (let o = 0; o < 5; o++) {
      const t = 17 + o;
      if (total < 17 || t > total) out[0] += d[o];
      else if (t === total) out[1] += d[o];
      else out[2] += d[o];
    }
    return out;
  }

  /** Distribution when the hand plays on optimally (stand or hit), matching bestHS's decisions. */
  private bestDist(hard: number, ace: boolean, ctx: number): Float64Array {
    const total = totalOf(hard, ace);
    if (total === 21) return this.standDist(21);
    const mk = this.key * 11 + ctx;
    const memo = this.distMemo.get(mk);
    if (memo) return memo;
    const soft = ace && hard <= 11;
    const canStand = soft ? total >= 17 : total >= 12;
    const out = canStand && this.standJ(total) > this.hitJ(hard, ace, ctx) ? this.standDist(total) : this.hitDist(hard, ace, ctx);
    this.distMemo.set(mk, out);
    return out;
  }

  private hitDist(hard: number, ace: boolean, ctx: number): Float64Array {
    const out = new Float64Array(3);
    for (let r = 1; r <= 10; r++) {
      const p = this.p(r);
      if (p === 0) continue;
      this.push(r);
      const nh = hard + r;
      if (nh > 21) out[0] += p * this.scale();
      else {
        const d = this.bestDist(nh, ace || r === 1, ctx);
        out[0] += p * d[0];
        out[1] += p * d[1];
        out[2] += p * d[2];
      }
      this.pop(r);
    }
    return out;
  }

  private doubleDist(hard: number, ace: boolean): Float64Array {
    const out = new Float64Array(3);
    for (let r = 1; r <= 10; r++) {
      const p = this.p(r);
      if (p === 0) continue;
      this.push(r);
      const nh = hard + r;
      if (nh > 21) out[0] += p * this.scale();
      else {
        const d = this.standDist(totalOf(nh, ace || r === 1));
        out[0] += p * d[0];
        out[1] += p * d[1];
        out[2] += p * d[2];
      }
      this.pop(r);
    }
    return out;
  }

  /** Should a hand stand (S), hit (H) or double (D)? Uses the current shoe state (this.rem). */
  private decide(hard: number, ace: boolean, ctx: number, canDouble: boolean): 'S' | 'H' | 'D' {
    const total = totalOf(hard, ace);
    if (total >= 21) return 'S';
    const s = this.standJ(total);
    const h = this.hitJ(hard, ace, ctx);
    let best: 'S' | 'H' | 'D' = h > s ? 'H' : 'S';
    if (canDouble && this.doubleJ(hard, ace) > Math.max(s, h)) best = 'D';
    return best;
  }

  /**
   * Distribution of the total result of splitting X,X, by simulation. Every hand follows the
   * same decisions the exact split EV assumes (see splitDetail), and cards are dealt from a real
   * shoe, so each hand's draws affect the others. Seeded, so results are repeatable.
   */
  private simulateSplit(X: Rank, n: number): Map<number, number> {
    const rules = this.rules;
    const rand = mulberry32(0x5eed + X * 101 + this.up);
    const oneCardAces = X === 1 && !rules.hitSplitAces;
    const maxHands = X === 1 ? (rules.resplitAces ? rules.maxSplitHands : 2) : rules.maxSplitHands;
    const bjRank = this.up === 1 ? 10 : this.up === 10 ? 1 : 0;
    const shoe = new Array<number>(11).fill(0);
    let shoeN = 0;
    const draw = (exclude = 0): number => {
      if (this.infinite) {
        for (;;) {
          let u = rand();
          for (let r = 1; r <= 10; r++) {
            u -= INFINITE_PROBS[r];
            if (u < 0) {
              if (r !== exclude) return r;
              break;
            }
          }
        }
      }
      const total = shoeN - (exclude ? shoe[exclude] : 0);
      let u = rand() * total;
      for (let r = 1; r <= 10; r++) {
        if (r === exclude) continue;
        u -= shoe[r];
        if (u < 0) {
          shoe[r]--;
          shoeN--;
          return r;
        }
      }
      for (let r = 10; r >= 1; r--)
        if (r !== exclude && shoe[r] > 0) {
          shoe[r]--;
          shoeN--;
          return r;
        }
      throw new Error('Shoe exhausted');
    };
    const decisions = new Map<string, 'S' | 'H' | 'D'>();
    const decideFor = (cards: number[], canDouble: boolean): 'S' | 'H' | 'D' => {
      const k = cards.join(',') + (canDouble ? 'd' : '');
      let a = decisions.get(k);
      if (!a) {
        this.resetTo([X, ...(cards.slice(1) as Rank[])]);
        this.push(X);
        let hard = 0;
        let ace = false;
        for (const c of cards) {
          hard += c;
          if (c === 1) ace = true;
        }
        a = this.decide(hard, ace, X, canDouble);
        decisions.set(k, a);
      }
      return a;
    };
    const result = new Map<number, number>();
    for (let t = 0; t < n; t++) {
      shoeN = 0;
      for (let r = 1; r <= 10; r++) {
        shoe[r] = this.infinite ? 0 : this.base[r] - (r === X ? 2 : 0);
        shoeN += shoe[r];
      }
      // With a peek the hole card is known not to complete a blackjack.
      const hole = this.peek ? draw(bjRank) : -1;
      let pending = 2;
      let made = 2;
      const finals: { total: number; bust: boolean; bet: number }[] = [];
      while (pending > 0) {
        pending--;
        const cards: number[] = [X];
        let c = draw();
        while (c === X && made < maxHands) {
          made++;
          pending++;
          c = draw();
        }
        cards.push(c);
        let bet = 1;
        if (!oneCardAces) {
          const v0 = handValue(cards as Rank[]);
          const canDbl = rules.doubleAfterSplit && canDoubleTotal(rules, v0.total, v0.soft);
          let a = decideFor(cards, canDbl);
          if (a === 'D') {
            bet = 2;
            cards.push(draw());
          } else {
            while (a === 'H') {
              cards.push(draw());
              const v = handValue(cards as Rank[]);
              if (v.total >= 21) break;
              a = decideFor(cards, false);
            }
          }
        }
        const v = handValue(cards as Rank[]);
        finals.push({ total: v.total, bust: v.total > 21, bet });
      }
      // Dealer plays out (hole card drawn now in a no-peek game).
      const dc = [this.up, hole > 0 ? hole : draw()];
      const dealerBJ = (dc[0] === 1 && dc[1] === 10) || (dc[0] === 10 && dc[1] === 1);
      for (;;) {
        const v = handValue(dc as Rank[]);
        if (v.total > 17 || (v.total === 17 && !(v.soft && rules.hitSoft17))) break;
        dc.push(draw());
      }
      const dv = handValue(dc as Rank[]).total;
      let net = 0;
      for (const h of finals) {
        if (h.bust || dealerBJ) net -= h.bet;
        else if (dv > 21 || h.total > dv) net += h.bet;
        else if (h.total < dv) net -= h.bet;
      }
      result.set(net, (result.get(net) ?? 0) + 1);
    }
    for (const [k, v] of result) result.set(k, v / n);
    return result;
  }

  /** Outcome distribution of every legal play, on the same basis as analyze(). */
  distributions(cards: readonly Rank[], opts: RootOptions, splitSamples = 60000): PlayDistributions {
    const root = this.analyze(cards, opts);
    this.resetTo(cards);
    const v = handValue(cards);
    const ace = cards.includes(1);
    const scale = this.scale();
    const single = (a: Float64Array, m: number): Map<number, number> =>
      new Map([
        [-m, a[0] / scale],
        [0, a[1] / scale],
        [m, a[2] / scale],
      ]);
    const maps: Partial<Record<Action, Map<number, number>>> = {};
    maps.S = single(this.standDist(v.total), 1);
    maps.H = single(this.hitDist(v.hard, ace, 0), 1);
    if (opts.double) maps.D = single(this.doubleDist(v.hard, ace), 2);
    const simulated: PlayDistributions['simulated'] = {};
    if (opts.split && cards.length === 2 && cards[0] === cards[1]) {
      maps.P = this.simulateSplit(cards[0], splitSamples);
      simulated.P = splitSamples;
      this.resetTo(cards);
    }
    if (root.ev.R !== undefined) {
      const pBJ = root.pBJ;
      maps.R = !this.rules.dealerPeeks && this.rules.surrender === 'late' ? new Map([[-1, pBJ], [-0.5, 1 - pBJ]]) : new Map([[-0.5, 1]]);
    }
    if (root.basis === 'unconditional' && this.peek) {
      // Early surrender against A/T: every other play is seen before the peek, so a dealer
      // blackjack (probability pBJ) costs the original bet.
      for (const a of ['S', 'H', 'D', 'P'] as const) {
        const m = maps[a];
        if (!m) continue;
        const out = new Map<number, number>();
        for (const [x, p] of m) out.set(x, (out.get(x) ?? 0) + (1 - root.pBJ) * p);
        out.set(-1, (out.get(-1) ?? 0) + root.pBJ);
        maps[a] = out;
      }
    }
    const dist: PlayDistributions['dist'] = {};
    for (const a of ACTIONS) if (maps[a]) dist[a] = toOutcomes(maps[a]!);
    return { dist, simulated };
  }

  // ---- public API ---------------------------------------------------------------------------

  /** EVs of every legal action for a starting hand (2+ cards) against this engine's upcard. */
  analyze(cards: readonly Rank[], opts: RootOptions): RootEV {
    this.resetTo(cards);
    const v = handValue(cards);
    const ace = cards.includes(1);
    const scale = this.scale();
    const pBJ = this.pBlackjack();
    const ev: ActionEVs = {};
    ev.S = this.standJ(v.total) / scale;
    ev.H = this.hitJ(v.hard, ace, 0) / scale;
    if (opts.double) ev.D = this.doubleJ(v.hard, ace) / scale;
    if (opts.split && cards.length === 2 && cards[0] === cards[1]) ev.P = this.splitDetail(cards[0]).ev;
    let basis: EVBasis = this.peek ? 'conditional' : 'unconditional';
    if (opts.surrender && this.rules.surrender !== 'none') {
      // Late surrender only saves half the bet when the dealer does NOT have blackjack. With a peek
      // that is already known (−½ on the conditional basis). With no hole card the blackjack is
      // still possible and takes the whole bet. Early surrender is −½ unconditionally.
      ev.R = !this.rules.dealerPeeks && this.rules.surrender === 'late' ? -0.5 * (1 - pBJ) - pBJ : -0.5;
      if (this.peek && this.rules.surrender === 'early') {
        // Early surrender is decided before the peek: compare on the pre-peek basis.
        for (const a of ['S', 'H', 'D', 'P'] as const) {
          const x = ev[a];
          if (x !== undefined) ev[a] = -pBJ + (1 - pBJ) * x;
        }
        basis = 'unconditional';
      }
    }
    return { ev, pBJ, basis };
  }

  /** Full derivation for the proof drawer. */
  explain(cards: readonly Rank[], opts: RootOptions): Explanation {
    const root = this.analyze(cards, opts);
    this.resetTo(cards);
    const v = handValue(cards);
    const ace = cards.includes(1);
    const scale = this.scale();
    const earlyConversion = this.peek && root.basis === 'unconditional';

    // Stand
    const d = this.dealer();
    const dealerCond = Array.from(d, (x, o) => (o === OUT_BJ ? (this.enhcBJ ? x : 0) : x / scale));
    let win = dealerCond[5];
    let push = 0;
    let lose = this.enhcBJ ? dealerCond[OUT_BJ] : 0;
    for (let o = 0; o < 5; o++) {
      const t = 17 + o;
      if (v.total >= 17 && t < v.total) win += dealerCond[o];
      else if (v.total >= 17 && t === v.total) push += dealerCond[o];
      else lose += dealerCond[o];
    }
    const standEv = this.standJ(v.total) / scale;

    // Hit (and the optimal continuation for each card)
    const hitRows: DrawRow[] = [];
    let hitEv = 0;
    for (let r = 1; r <= 10; r++) {
      const p = this.p(r);
      if (p === 0) continue;
      this.push(r);
      const sc = this.scale();
      const nh = v.hard + r;
      const nAce = ace || r === 1;
      const pc = (p * sc) / scale;
      const ncards = [...cards, r as Rank];
      if (nh > 21) {
        hitRows.push({ rank: r as Rank, p: pc, cards: ncards, total: nh, soft: false, bust: true, action: null, ev: -1 });
        hitEv += pc * -1;
      } else {
        const t = totalOf(nh, nAce);
        const s = this.standJ(t) / sc;
        const h = t < 21 ? this.hitJ(nh, nAce, 0) / sc : -Infinity;
        const best = Math.max(s, h);
        hitRows.push({
          rank: r as Rank,
          p: pc,
          cards: ncards,
          total: t,
          soft: nAce && nh <= 11,
          bust: false,
          action: h > s ? 'H' : 'S',
          ev: best,
          standEv: s,
          hitEv: Number.isFinite(h) ? h : undefined,
        });
        hitEv += pc * best;
      }
      this.pop(r);
    }

    // Double
    let double: Explanation['double'] = null;
    if (opts.double) {
      const rows: DrawRow[] = [];
      let sum = 0;
      for (let r = 1; r <= 10; r++) {
        const p = this.p(r);
        if (p === 0) continue;
        this.push(r);
        const sc = this.scale();
        const nh = v.hard + r;
        const nAce = ace || r === 1;
        const pc = (p * sc) / scale;
        const bust = nh > 21;
        const t = bust ? nh : totalOf(nh, nAce);
        const s = bust ? -1 : this.standJ(t) / sc;
        rows.push({ rank: r as Rank, p: pc, cards: [...cards, r as Rank], total: t, soft: !bust && nAce && nh <= 11, bust, action: 'S', ev: s });
        sum += pc * s;
        this.pop(r);
      }
      double = { ev: 2 * sum, rows };
    }

    let split: Explanation['split'] = null;
    if (opts.split && cards.length === 2 && cards[0] === cards[1]) {
      this.resetTo(cards);
      split = this.splitDetail(cards[0]);
    }

    const ev = root.ev;
    let best: Action = 'S';
    let bestV = -Infinity;
    for (const a of ACTIONS) {
      const x = ev[a];
      if (x !== undefined && x > bestV + 1e-12) {
        best = a;
        bestV = x;
      }
    }

    this.resetTo(cards);
    const shoe = this.infinite ? null : this.base.map((n, r) => (r === 0 ? 0 : n - this.rem[r]));
    return {
      cards: [...cards],
      up: this.up,
      total: v.total,
      soft: v.soft,
      basis: root.basis,
      earlyConversion,
      pBJ: root.pBJ,
      ev,
      best,
      shoe,
      stand: { total: v.total, dealer: dealerCond, win, push, lose, ev: standEv },
      hit: { ev: hitEv, rows: hitRows },
      double,
      split,
      surrender: ev.R !== undefined ? { ev: ev.R, early: this.rules.surrender === 'early' } : null,
    };
  }

  /** Dealer distribution for the current analysis root (used by tests / UI). */
  dealerFor(cards: readonly Rank[]): Float64Array {
    this.resetTo(cards);
    return this.dealer().slice();
  }

  /** Probability of dealing this 2-card player hand, given the upcard is out. */
  compositionProb(a: Rank, b: Rank): number {
    if (this.infinite) return a === b ? INFINITE_PROBS[a] ** 2 : 2 * INFINITE_PROBS[a] * INFINITE_PROBS[b];
    const N = this.baseN;
    if (a === b) return (this.base[a] * (this.base[a] - 1)) / (N * (N - 1));
    return (2 * this.base[a] * this.base[b]) / (N * (N - 1));
  }

  /** P(dealer blackjack | upcard and these player cards). */
  blackjackProbGiven(cards: readonly Rank[]): number {
    this.resetTo(cards);
    return this.pBlackjack();
  }

  cacheSize(): number {
    return this.dealerMemo.size + this.hsMemo.size;
  }
}

/**
 * Exact dealer final-total distribution.
 *
 * THEOREM (multiset formula). Draw cards without replacement from a shoe with n_r cards of rank r
 * (N cards in total). The probability that the first k cards are a specific ordered sequence
 * containing m_r cards of rank r is
 *
 *        P(sequence) = Π_r n_r(n_r − 1)…(n_r − m_r + 1)  /  N(N − 1)…(N − k + 1)
 *                    = Π_r (n_r)_{m_r} / (N)_k                       ((x)_m = falling factorial)
 *
 * which depends only on the multiset {m_r}, not on the order. (Proof: the i-th factor of the
 * denominator is the number of cards left before the i-th draw, N − i + 1, independent of order;
 * the numerator collects, for each rank, the counts n_r, n_r − 1, … at the successive draws of
 * that rank, again independent of when they happen.)
 *
 * Whether the dealer must draw is a function of the multiset of cards held (total and softness are
 * order-free), so a dealer hand M ends in outcome o via exactly W(M) valid orderings — those in
 * which every proper prefix is a "must draw" state. Hence for ANY shoe
 *
 *        P(dealer ends with M) = W(M) · Π_r (n_r)_{m_r} / (N)_k.
 *
 * W(M) and the outcome of M do not depend on the shoe, so they are enumerated once per
 * (upcard, H17/S17) by dynamic programming over multisets:  W(M + r) += W(M) for every
 * draw-state M. Evaluating the distribution for a new shoe is then a single pass over the terminal
 * multisets — no recursion — which is what makes exact card-removal analysis fast.
 *
 * Outcome indices: 0..4 = final 17..21, 5 = bust, 6 = dealer blackjack (upcard + hole card).
 */
import { INFINITE_PROBS, type Counts, type Rank } from './cards';

export const OUT_17 = 0;
export const OUT_BUST = 5;
export const OUT_BJ = 6;
export const OUTCOME_LABELS = ['17', '18', '19', '20', '21', 'Bust', 'Blackjack'] as const;

export interface DealerTerms {
  up: Rank;
  hitSoft17: boolean;
  /** Number of terminal multisets. */
  n: number;
  outcome: Uint8Array;
  /** Cards drawn after the upcard (hole card included). */
  k: Uint8Array;
  /** Number of valid draw orderings W(M). */
  ways: Float64Array;
  /** Sparse representation: factors for term t are idx[start[t] .. start[t+1]). */
  start: Uint32Array;
  /** Encoded factor index: rank * STRIDE + multiplicity. */
  idx: Uint16Array;
  maxK: number;
  maxM: number;
  /** Terminal multisets (rank counts) — kept for explanations/tests. */
  multisets: Uint8Array[];
}

const STRIDE = 32;

interface DState {
  c: Uint8Array;
  hard: number;
  ace: boolean;
  k: number;
  ways: number;
}

/** Status of a dealer hand: -1 = must draw, otherwise the outcome index. */
function dealerStatus(hard: number, ace: boolean, k: number, hitSoft17: boolean): number {
  const soft = ace && hard <= 11;
  const total = soft ? hard + 10 : hard;
  if (k === 1 && total === 21) return OUT_BJ;
  if (total > 21) return OUT_BUST;
  if (total > 17) return total - 17;
  if (total === 17) return soft && hitSoft17 ? -1 : OUT_17;
  return -1;
}

function enumerate(up: Rank, hitSoft17: boolean): DealerTerms {
  const terms: DState[] = [];
  const outcomes: number[] = [];
  let level = new Map<string, DState>();
  level.set('', { c: new Uint8Array(11), hard: up, ace: up === 1, k: 0, ways: 1 });

  while (level.size > 0) {
    const next = new Map<string, DState>();
    for (const s of level.values()) {
      for (let r = 1; r <= 10; r++) {
        const c = s.c.slice();
        c[r]++;
        const key = c.join(',');
        let t = next.get(key);
        if (!t) {
          t = { c, hard: s.hard + r, ace: s.ace || r === 1, k: s.k + 1, ways: 0 };
          next.set(key, t);
        }
        t.ways += s.ways;
      }
    }
    level = new Map();
    for (const [key, t] of next) {
      const st = dealerStatus(t.hard, t.ace, t.k, hitSoft17);
      if (st < 0) level.set(key, t);
      else {
        terms.push(t);
        outcomes.push(st);
      }
    }
  }

  const n = terms.length;
  const outcome = new Uint8Array(n);
  const k = new Uint8Array(n);
  const ways = new Float64Array(n);
  const start = new Uint32Array(n + 1);
  const idxList: number[] = [];
  let maxK = 0;
  let maxM = 0;
  for (let t = 0; t < n; t++) {
    const s = terms[t];
    outcome[t] = outcomes[t];
    k[t] = s.k;
    ways[t] = s.ways;
    start[t] = idxList.length;
    maxK = Math.max(maxK, s.k);
    for (let r = 1; r <= 10; r++) {
      if (s.c[r] > 0) {
        idxList.push(r * STRIDE + s.c[r]);
        maxM = Math.max(maxM, s.c[r]);
      }
    }
  }
  start[n] = idxList.length;
  return {
    up,
    hitSoft17,
    n,
    outcome,
    k,
    ways,
    start,
    idx: Uint16Array.from(idxList),
    maxK,
    maxM,
    multisets: terms.map((s) => s.c),
  };
}

const termsCache = new Map<string, DealerTerms>();

export function dealerTerms(up: Rank, hitSoft17: boolean): DealerTerms {
  const key = `${up}|${hitSoft17 ? 1 : 0}`;
  let t = termsCache.get(key);
  if (!t) {
    t = enumerate(up, hitSoft17);
    termsCache.set(key, t);
  }
  return t;
}

/**
 * Scratch buffers reused between calls (the engine is single-threaded per worker).
 */
const ffBuf = new Float64Array(11 * STRIDE);
const invBuf = new Float64Array(STRIDE);

/**
 * Dealer outcome distribution for a finite shoe. `shoe` is the composition the dealer draws from:
 * the full shoe minus the upcard and minus every card known to be out (player cards, …).
 * Returns probabilities for outcomes 0..6 (they sum to 1; index 6 = dealer blackjack).
 */
export function dealerDistribution(terms: DealerTerms, shoe: Counts, out: Float64Array = new Float64Array(7)): Float64Array {
  let N = 0;
  for (let r = 1; r <= 10; r++) N += shoe[r];
  const { maxM, maxK } = terms;
  for (let r = 1; r <= 10; r++) {
    const base = r * STRIDE;
    let f = 1;
    ffBuf[base] = 1;
    const n = shoe[r];
    for (let m = 1; m <= maxM; m++) {
      const factor = n - m + 1;
      f = factor > 0 ? f * factor : 0;
      ffBuf[base + m] = f;
    }
  }
  invBuf[0] = 1;
  for (let k = 1; k <= maxK; k++) {
    const d = N - k + 1;
    invBuf[k] = d > 0 ? invBuf[k - 1] / d : 0;
  }
  return accumulate(terms, out);
}

/** Dealer outcome distribution for an infinite deck (draws with replacement). */
export function dealerDistributionInfinite(terms: DealerTerms, probs: readonly number[] = INFINITE_PROBS, out: Float64Array = new Float64Array(7)): Float64Array {
  const { maxM, maxK } = terms;
  for (let r = 1; r <= 10; r++) {
    const base = r * STRIDE;
    ffBuf[base] = 1;
    for (let m = 1; m <= maxM; m++) ffBuf[base + m] = ffBuf[base + m - 1] * probs[r];
  }
  for (let k = 0; k <= maxK; k++) invBuf[k] = 1;
  return accumulate(terms, out);
}

function accumulate(terms: DealerTerms, out: Float64Array): Float64Array {
  out.fill(0);
  const { n, outcome, k, ways, start, idx } = terms;
  for (let t = 0; t < n; t++) {
    let p = ways[t] * invBuf[k[t]];
    for (let j = start[t], e = start[t + 1]; j < e; j++) p *= ffBuf[idx[j]];
    out[outcome[t]] += p;
  }
  return out;
}

/**
 * Probability the dealer has blackjack given the shoe the hole card is drawn from
 * (`shoe` excludes the upcard).
 */
export function dealerBlackjackProb(up: Rank, shoe: Counts | null): number {
  if (up !== 1 && up !== 10) return 0;
  const need = up === 1 ? 10 : 1;
  if (!shoe) return INFINITE_PROBS[need];
  let N = 0;
  for (let r = 1; r <= 10; r++) N += shoe[r];
  return N > 0 ? shoe[need] / N : 0;
}

/**
 * Conditional distribution given that the dealer does NOT have blackjack (what a player sees after
 * the dealer peeks). Returns outcomes 0..5 renormalised; index 6 is 0.
 */
export function conditionalOnNoBlackjack(dist: Float64Array): Float64Array {
  const out = new Float64Array(7);
  const z = 1 - dist[OUT_BJ];
  if (z <= 0) return out;
  for (let o = 0; o < 6; o++) out[o] = dist[o] / z;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Dealer tree (for the "where does P(bust) come from?" explorer)
// ---------------------------------------------------------------------------------------------

export interface DealerTreeChild {
  rank: Rank;
  /** Probability of drawing this card next (from the shoe at this node). */
  p: number;
  total: number;
  soft: boolean;
  /** -1 = dealer must keep drawing; otherwise outcome index. */
  status: number;
  /** Final-outcome distribution conditional on reaching this child. */
  dist: number[];
}

export interface DealerTreeNode {
  cards: Rank[];
  total: number;
  soft: boolean;
  status: number;
  dist: number[];
  children: DealerTreeChild[];
}

/**
 * Lazily expands one node of the dealer's draw tree. `shoe` = cards available to the dealer at
 * the root (upcard and player cards already removed); `path` = dealer cards drawn after the upcard.
 * Distributions are computed by the recursion D(node) = Σ_c P(c) · D(node + c), memoised on the
 * multiset of dealer cards (consistent with the multiset formula above).
 */
export function dealerTreeNode(up: Rank, hitSoft17: boolean, shoe: Counts | null, path: readonly Rank[]): DealerTreeNode {
  const memo = new Map<string, number[]>();
  const counts = new Array(11).fill(0) as number[];
  const base = shoe ? shoe.slice() : null;
  let N = base ? base.reduce((a, b) => a + b, 0) : 0;

  const prob = (r: Rank): number => {
    if (!base) return INFINITE_PROBS[r];
    const left = base[r] - counts[r];
    return left > 0 ? left / N : 0;
  };

  const distFrom = (hard: number, ace: boolean, k: number): number[] => {
    const st = dealerStatus(hard, ace, k, hitSoft17);
    if (st >= 0) {
      const d = [0, 0, 0, 0, 0, 0, 0];
      d[st] = 1;
      return d;
    }
    const key = counts.join(',');
    const hit = memo.get(key);
    if (hit) return hit;
    const d = [0, 0, 0, 0, 0, 0, 0];
    for (let r = 1 as Rank; r <= 10; r = (r + 1) as Rank) {
      const p = prob(r);
      if (p === 0) continue;
      counts[r]++;
      N--;
      const sub = distFrom(hard + r, ace || r === 1, k + 1);
      counts[r]--;
      N++;
      for (let o = 0; o < 7; o++) d[o] += p * sub[o];
    }
    memo.set(key, d);
    return d;
  };

  // Walk down the path.
  let hard: number = up;
  let ace = up === 1;
  for (const r of path) {
    counts[r]++;
    N--;
    hard += r;
    ace = ace || r === 1;
  }
  const k = path.length;
  const status = dealerStatus(hard, ace, k, hitSoft17);
  const total = ace && hard <= 11 ? hard + 10 : hard;
  const node: DealerTreeNode = {
    cards: [up, ...path],
    total,
    soft: ace && hard <= 11,
    status,
    dist: distFrom(hard, ace, k),
    children: [],
  };
  if (status < 0) {
    for (let r = 1 as Rank; r <= 10; r = (r + 1) as Rank) {
      const p = prob(r);
      if (p === 0) continue;
      counts[r]++;
      N--;
      const h2 = hard + r;
      const a2 = ace || r === 1;
      const st2 = dealerStatus(h2, a2, k + 1, hitSoft17);
      node.children.push({
        rank: r,
        p,
        total: a2 && h2 <= 11 ? h2 + 10 : h2,
        soft: a2 && h2 <= 11,
        status: st2,
        dist: distFrom(h2, a2, k + 1),
      });
      counts[r]--;
      N++;
    }
  }
  return node;
}

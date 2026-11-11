/**
 * Hand analysis on a board: draws and outs, the hand groups used for range reading, and exact
 * equity against a weighted range by enumerating every runout.
 */
import { liveCards, rankOf, suitOf, type HCard } from './cards';
import { categoryOf, evaluate, slotRank, straightHigh, ONE_PAIR, STRAIGHT, TWO_PAIR } from './evaluate';
import type { HandGroup } from './profiles';
import type { Combo } from './ranges';

const buf = new Int32Array(7);

function score(hole: readonly HCard[], board: readonly HCard[], extra?: readonly HCard[]): number {
  let n = 0;
  for (const c of hole) buf[n++] = c;
  for (const c of board) buf[n++] = c;
  if (extra) for (const c of extra) buf[n++] = c;
  return evaluate(buf, n);
}

const rankMask = (cards: readonly HCard[]): number => cards.reduce((m, c) => m | (1 << rankOf(c)), 0);

export type DrawKind = 'flush' | 'oesd' | 'double-gutter' | 'gutshot';

export interface DrawInfo {
  /** Cards that complete a straight or better that uses a hole card. */
  outs: HCard[];
  kinds: DrawKind[];
  /** Suit of the flush draw, or −1. */
  flushSuit: number;
  /** Ranks that complete a straight. */
  straightRanks: number[];
  label: string;
}

/** Does the player have a pair or better that uses a hole card (better than the board alone)? */
export function improvesBoard(hole: readonly HCard[], board: readonly HCard[]): boolean {
  return categoryOf(score(hole, board)) > categoryOf(score([], board));
}

/** Draws to a straight or flush on a flop or turn, with the exact list of outs. */
export function analyzeDraw(hole: readonly HCard[], board: readonly HCard[]): DrawInfo {
  const cards = [...hole, ...board];
  const now = score(hole, board);
  const kinds: DrawKind[] = [];
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    const n = cards.filter((c) => suitOf(c) === s).length;
    if (n === 4 && hole.some((c) => suitOf(c) === s) && categoryOf(now) < STRAIGHT) flushSuit = s;
  }
  if (flushSuit >= 0) kinds.push('flush');

  const mask = rankMask(cards);
  const bmask = rankMask(board);
  const straightRanks: number[] = [];
  if (straightHigh(mask) < 0) {
    for (let r = 0; r < 13; r++) {
      if (mask & (1 << r)) continue;
      const hi = straightHigh(mask | (1 << r));
      if (hi >= 0 && hi > straightHigh(bmask | (1 << r))) straightRanks.push(r);
    }
  }
  if (straightRanks.length >= 2) {
    // Open-ended: four consecutive ranks in hand with both ends live.
    let open = false;
    for (let lo = -1; lo <= 9; lo++) {
      const has = (r: number) => (r === -1 ? (mask >> 12) & 1 : (mask >> r) & 1);
      if (has(lo) && has(lo + 1) && has(lo + 2) && has(lo + 3)) {
        const below = lo - 1;
        const above = lo + 4;
        const live = (r: number) => r >= -1 && r <= 12 && straightRanks.includes(r === -1 ? 12 : r);
        if (live(below) && live(above)) open = true;
      }
    }
    kinds.push(open ? 'oesd' : 'double-gutter');
  } else if (straightRanks.length === 1) kinds.push('gutshot');

  const outs: HCard[] = [];
  if (board.length < 5) {
    for (const c of liveCards(cards)) {
      const after = score(hole, board, [c]);
      if (categoryOf(after) < STRAIGHT || categoryOf(now) >= STRAIGHT) continue;
      if (board.length === 4 && after <= score([], board, [c])) continue; // only the board plays
      outs.push(c);
    }
  }

  const names: Record<DrawKind, string> = { flush: 'flush draw', oesd: 'open-ended straight draw', 'double-gutter': 'double-gutshot straight draw', gutshot: 'gutshot' };
  let label = kinds.length === 0 ? 'no draw' : kinds.map((k) => names[k]).join(' + ');
  if (kinds.length === 2 && kinds[0] === 'flush' && kinds[1] !== 'gutshot') label = `combo draw (flush + ${names[kinds[1]].replace(' straight draw', '')})`;
  label = label[0].toUpperCase() + label.slice(1);
  return { outs, kinds, flushSuit, straightRanks, label };
}

/** The range-reading group of a hand on a board. */
export function handGroup(a: HCard, b: HCard, board: readonly HCard[]): HandGroup {
  const s = score([a, b], board);
  const bs = score([], board);
  const cat = categoryOf(s);
  const bcat = categoryOf(bs);
  const top = Math.max(...board.map(rankOf));
  if (cat > bcat) {
    let pairRank = -1;
    if (cat === ONE_PAIR) pairRank = slotRank(s, 0);
    else if (cat === TWO_PAIR && bcat === ONE_PAIR) {
      // The board is paired: our "two pair" is really one pair of our own.
      const boardPair = slotRank(bs, 0);
      pairRank = slotRank(s, 0) === boardPair ? slotRank(s, 1) : slotRank(s, 0);
    } else return 'monster';
    return pairRank >= top ? 'top' : 'weak';
  }
  if (board.length < 5) {
    const d = analyzeDraw([a, b], board);
    if (d.kinds.includes('flush') || d.kinds.includes('oesd') || d.kinds.includes('double-gutter')) return 'draw';
  }
  return 'air';
}

const GROUP_BASE: Record<HandGroup, number> = { monster: 4, top: 3, weak: 2, draw: 1, air: 0 };

/** Ordering key used to decide which hands continue against a bet: made hands, then draws, then air. */
export function strengthKey(a: HCard, b: HCard, board: readonly HCard[], group: HandGroup = handGroup(a, b, board)): number {
  const s = score([a, b], board);
  if (group === 'draw') return GROUP_BASE.draw * 2 ** 24 + analyzeDraw([a, b], board).outs.length;
  return GROUP_BASE[group] * 2 ** 24 + s;
}

export interface WeightedCombo extends Combo {
  /** Relative weight (probability the player holds and plays it this way). */
  w: number;
  group: HandGroup;
}

/**
 * Exact equity (win + half of ties) of `hero` against each villain combo, enumerating every
 * board completion from the cards neither player holds.
 */
export function comboEquities(hero: readonly HCard[], board: readonly HCard[], combos: readonly Combo[]): Float64Array {
  const unseen = liveCards([...hero, ...board]);
  const need = 5 - board.length;
  const out = new Float64Array(combos.length);
  const vb = new Int32Array(7);
  const nb = board.length;
  for (let i = 0; i < nb; i++) vb[2 + i] = board[i];

  if (need === 0) {
    const h = score(hero, board);
    combos.forEach((v, i) => {
      vb[0] = v.a;
      vb[1] = v.b;
      const s = evaluate(vb, 7);
      out[i] = h > s ? 1 : h === s ? 0.5 : 0;
    });
    return out;
  }

  // Precompute hero's score on every runout, then score villain on the runouts their cards allow.
  const runs: number[][] = [];
  if (need === 1) for (const c of unseen) runs.push([c]);
  else for (let i = 0; i < unseen.length; i++) for (let j = i + 1; j < unseen.length; j++) runs.push([unseen[i], unseen[j]]);
  const hs = new Int32Array(runs.length);
  runs.forEach((r, i) => (hs[i] = score(hero, board, r)));

  combos.forEach((v, i) => {
    vb[0] = v.a;
    vb[1] = v.b;
    let n = 0;
    let eq = 0;
    for (let k = 0; k < runs.length; k++) {
      const r = runs[k];
      if (r[0] === v.a || r[0] === v.b || (need === 2 && (r[1] === v.a || r[1] === v.b))) continue;
      vb[nb + 2] = r[0];
      if (need === 2) vb[nb + 3] = r[1];
      const s = evaluate(vb, nb + 2 + need);
      const h = hs[k];
      eq += h > s ? 1 : h === s ? 0.5 : 0;
      n++;
    }
    out[i] = n ? eq / n : 0;
  });
  return out;
}

/** Weighted average of per-combo equities. */
export function rangeEquity(eqs: ArrayLike<number>, combos: readonly { w: number }[]): number {
  let s = 0;
  let w = 0;
  for (let i = 0; i < combos.length; i++) {
    s += eqs[i] * combos[i].w;
    w += combos[i].w;
  }
  return w ? s / w : 0;
}

export const totalWeight = (combos: readonly { w: number }[]): number => combos.reduce((n, c) => n + c.w, 0);

/** Score of hole + board (+ extra cards). */
export const handScore = score;

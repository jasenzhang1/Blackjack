/**
 * Exact poker hand evaluator for 1–7 cards (best five-card hand).
 *
 * The score is a 24-bit integer: category in bits 20–23 and up to five tie-break ranks in 4-bit
 * nibbles below it, each stored as rank + 1 so an absent kicker (0) sorts below a deuce. A higher
 * score is a better hand, equal scores tie. With fewer than five cards there can be no straight or
 * flush, and the score ranks pairs and kickers among the cards present (used to tell which hands
 * a player has improved with their hole cards).
 */

export const HIGH_CARD = 0;
export const ONE_PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

export const CATEGORY_NAMES = ['High card', 'One pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'] as const;

export const categoryOf = (score: number): number => score >> 20;
/** The rank (0..12) in tie-break slot `i` (0 = most significant), or −1 if absent. */
export const slotRank = (score: number, i: number): number => ((score >> (16 - 4 * i)) & 15) - 1;

/** Highest card (0..12) of the best straight in a rank bitmask, 3 for the wheel, −1 if none. */
export function straightHigh(mask: number): number {
  for (let hi = 12; hi >= 4; hi--) if (((mask >> (hi - 4)) & 31) === 31) return hi;
  if ((mask & 0x100f) === 0x100f) return 3; // A-2-3-4-5
  return -1;
}

export function popcount(x: number): number {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

const cnt = new Int32Array(13);
const suitMask = new Int32Array(4);
const suitCnt = new Int32Array(4);

/** Adds up to `num` kickers (highest first, skipping ranks exA/exB) starting at nibble `shift`. */
function kickers(v: number, exA: number, exB: number, num: number, shift: number): number {
  for (let r = 12; r >= 0 && num > 0; r--) {
    if (cnt[r] > 0 && r !== exA && r !== exB) {
      v |= (r + 1) << shift;
      shift -= 4;
      num--;
    }
  }
  return v;
}

export function evaluate(cards: ArrayLike<number>, n: number = cards.length): number {
  cnt.fill(0);
  suitMask.fill(0);
  suitCnt.fill(0);
  let mask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    cnt[r]++;
    suitMask[s] |= 1 << r;
    suitCnt[s]++;
    mask |= 1 << r;
  }
  for (let s = 0; s < 4; s++) {
    if (suitCnt[s] < 5) continue;
    const m = suitMask[s];
    const sf = straightHigh(m);
    if (sf >= 0) return (STRAIGHT_FLUSH << 20) | ((sf + 1) << 16);
    let v = FLUSH << 20;
    let shift = 16;
    for (let r = 12, k = 0; r >= 0 && k < 5; r--) {
      if (m & (1 << r)) {
        v |= (r + 1) << shift;
        shift -= 4;
        k++;
      }
    }
    return v;
  }
  let quad = -1;
  let t1 = -1;
  let t2 = -1;
  let p1 = -1;
  let p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = cnt[r];
    if (k === 4) quad = r;
    else if (k === 3) {
      if (t1 < 0) t1 = r;
      else if (t2 < 0) t2 = r;
    } else if (k === 2) {
      if (p1 < 0) p1 = r;
      else if (p2 < 0) p2 = r;
    }
  }
  if (quad >= 0) return kickers((QUADS << 20) | ((quad + 1) << 16), quad, -1, 1, 12);
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return (FULL_HOUSE << 20) | ((t1 + 1) << 16) | ((Math.max(t2, p1) + 1) << 12);
  const st = straightHigh(mask);
  if (st >= 0) return (STRAIGHT << 20) | ((st + 1) << 16);
  if (t1 >= 0) return kickers((TRIPS << 20) | ((t1 + 1) << 16), t1, -1, 2, 12);
  if (p2 >= 0) return kickers((TWO_PAIR << 20) | ((p1 + 1) << 16) | ((p2 + 1) << 12), p1, p2, 1, 8);
  if (p1 >= 0) return kickers((ONE_PAIR << 20) | ((p1 + 1) << 16), p1, -1, 3, 12);
  return kickers(HIGH_CARD << 20, -1, -1, 5, 16);
}

/** Readable name of a made hand ("Flush, ace high", "Two pair, kings and sevens"). */
export function describeScore(score: number): string {
  const cat = categoryOf(score);
  const r0 = slotRank(score, 0);
  const r1 = slotRank(score, 1);
  const W = ['deuces', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];
  const S = ['deuce', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
  switch (cat) {
    case STRAIGHT_FLUSH:
      return r0 === 12 ? 'Royal flush' : `Straight flush, ${S[r0]} high`;
    case QUADS:
      return `Four ${W[r0]}`;
    case FULL_HOUSE:
      return `Full house, ${W[r0]} full of ${W[r1]}`;
    case FLUSH:
      return `Flush, ${S[r0]} high`;
    case STRAIGHT:
      return `Straight, ${S[r0]} high`;
    case TRIPS:
      return `Three ${W[r0]}`;
    case TWO_PAIR:
      return `Two pair, ${W[r0]} and ${W[r1]}`;
    case ONE_PAIR:
      return `Pair of ${W[r0]}`;
    default:
      return `${S[r0][0].toUpperCase()}${S[r0].slice(1)} high`;
  }
}

/**
 * Starting-hand classes (the 169 cells of a range grid), combo counting with card removal and
 * preflop ranges built as the top X% of hands.
 *
 * Hands are ordered by the Chen formula (Bill Chen's quick hand-strength score), with pairs,
 * then suited hands, then higher cards breaking ties. It is a heuristic, not a solver ranking,
 * but it orders hands the way most players build ranges ("top 15%"), which is what the training
 * rooms need.
 */
import { makeCard, rankOf, suitOf, RANK_CHARS, type HCard } from './cards';

export interface HandClass {
  /** "AA", "AKs", "AKo". */
  label: string;
  /** Higher rank 0..12 (12 = ace). */
  hi: number;
  /** Lower rank 0..12 (equal to hi for pairs). */
  lo: number;
  suited: boolean;
  pair: boolean;
  /** Combos with no cards removed: 6 for pairs, 4 suited, 12 offsuit. */
  combos: number;
  /** Grid position (row, col) with A at the top left; suited above the diagonal. */
  row: number;
  col: number;
}

export interface Combo {
  a: HCard;
  b: HCard;
  cls: HandClass;
}

function makeClass(hi: number, lo: number, suited: boolean): HandClass {
  const pair = hi === lo;
  const label = pair ? RANK_CHARS[hi] + RANK_CHARS[lo] : RANK_CHARS[hi] + RANK_CHARS[lo] + (suited ? 's' : 'o');
  const row = pair || suited ? 12 - hi : 12 - lo;
  const col = pair || suited ? 12 - lo : 12 - hi;
  return { label, hi, lo, suited: !pair && suited, pair, combos: pair ? 6 : suited ? 4 : 12, row, col };
}

/** All 169 classes in grid order (row by row). */
export const ALL_CLASSES: readonly HandClass[] = (() => {
  const out: HandClass[] = [];
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const r1 = 12 - row;
      const r2 = 12 - col;
      if (row === col) out.push(makeClass(r1, r1, false));
      else if (row < col) out.push(makeClass(r1, r2, true)); // above diagonal: suited, hi = row rank
      else out.push(makeClass(r2, r1, false)); // below: offsuit, hi = col rank
    }
  }
  return out;
})();

const BY_LABEL = new Map(ALL_CLASSES.map((c) => [c.label, c]));
export const classByLabel = (label: string): HandClass | undefined => BY_LABEL.get(label);

/** The class of two specific hole cards. */
export function classOf(a: HCard, b: HCard): HandClass {
  const ra = rankOf(a);
  const rb = rankOf(b);
  const hi = Math.max(ra, rb);
  const lo = Math.min(ra, rb);
  if (hi === lo) return BY_LABEL.get(RANK_CHARS[hi] + RANK_CHARS[lo])!;
  return BY_LABEL.get(RANK_CHARS[hi] + RANK_CHARS[lo] + (suitOf(a) === suitOf(b) ? 's' : 'o'))!;
}

/** Chen formula score (rounded up). AA = 20, 72o = −1. */
export function chen(c: HandClass): number {
  const pts = (r: number) => (r === 12 ? 10 : r === 11 ? 8 : r === 10 ? 7 : r === 9 ? 6 : (r + 2) / 2);
  if (c.pair) return Math.max(5, Math.ceil(pts(c.hi) * 2));
  let s = pts(c.hi);
  if (c.suited) s += 2;
  const gap = c.hi - c.lo - 1;
  s -= gap <= 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && c.hi < 10) s += 1;
  return Math.ceil(s);
}

/** Classes from strongest to weakest. */
export const PREFLOP_ORDER: readonly HandClass[] = [...ALL_CLASSES].sort(
  (x, y) => chen(y) - chen(x) || Number(y.pair) - Number(x.pair) || Number(y.suited) - Number(x.suited) || y.hi - x.hi || y.lo - x.lo,
);

/** The strongest classes making up at least `fraction` of all 1326 starting combos. */
export function topRange(fraction: number): HandClass[] {
  const target = fraction * 1326;
  const out: HandClass[] = [];
  let n = 0;
  for (const c of PREFLOP_ORDER) {
    if (n >= target) break;
    out.push(c);
    n += c.combos;
  }
  return out;
}

/** Every specific two-card combo of a class that avoids the dead cards. */
export function combosOf(c: HandClass, dead: readonly HCard[] | Set<HCard>): Combo[] {
  const d = dead instanceof Set ? dead : new Set(dead);
  const out: Combo[] = [];
  for (let s1 = 0; s1 < 4; s1++) {
    for (let s2 = 0; s2 < 4; s2++) {
      if (c.pair && s2 <= s1) continue;
      if (!c.pair && c.suited !== (s1 === s2)) continue;
      const a = makeCard(c.hi, s1);
      const b = makeCard(c.lo, s2);
      if (!d.has(a) && !d.has(b)) out.push({ a, b, cls: c });
    }
  }
  return out;
}

/** All live combos of a list of classes. */
export function rangeCombos(classes: readonly HandClass[], dead: readonly HCard[]): Combo[] {
  const d = new Set(dead);
  return classes.flatMap((c) => combosOf(c, d));
}

/** Share of all 1326 combos covered by a list of classes. */
export const rangeShare = (classes: readonly HandClass[]): number => classes.reduce((n, c) => n + c.combos, 0) / 1326;

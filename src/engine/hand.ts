/**
 * Hand evaluation and strategy-chart row classification.
 */
import { rankLabel, type Rank } from './cards';

export interface HandValue {
  /** Best total (an ace counts 11 if that does not bust the hand). */
  total: number;
  /** True if an ace is currently counted as 11. */
  soft: boolean;
  /** Total with every ace counted as 1. */
  hard: number;
}

export function handValue(ranks: readonly Rank[]): HandValue {
  let hard = 0;
  let ace = false;
  for (const r of ranks) {
    hard += r;
    if (r === 1) ace = true;
  }
  const soft = ace && hard <= 11;
  return { total: soft ? hard + 10 : hard, soft, hard };
}

/** Total of a hand given its hard total and whether it contains an ace. */
export function totalOf(hard: number, ace: boolean): number {
  return ace && hard <= 11 ? hard + 10 : hard;
}

export function isSoftTotal(hard: number, ace: boolean): boolean {
  return ace && hard <= 11;
}

export function isBlackjack(ranks: readonly Rank[]): boolean {
  return ranks.length === 2 && handValue(ranks).total === 21;
}

export function isPair(ranks: readonly Rank[]): boolean {
  return ranks.length === 2 && ranks[0] === ranks[1];
}

/** Chart rows: hard totals `H4..H21`, soft totals `S12..S21`, and pairs `P1..P10` (P1 = A,A). */
export type RowKind = 'hard' | 'soft' | 'pair';
export type RowKey = string;

export function rowKey(kind: RowKind, n: number): RowKey {
  return (kind === 'hard' ? 'H' : kind === 'soft' ? 'S' : 'P') + n;
}

export function parseRow(key: RowKey): { kind: RowKind; n: number } {
  const kind: RowKind = key[0] === 'H' ? 'hard' : key[0] === 'S' ? 'soft' : 'pair';
  return { kind, n: Number(key.slice(1)) };
}

/** Rows shown in the chart, in display order. */
export const HARD_ROWS: readonly number[] = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
export const SOFT_ROWS: readonly number[] = [13, 14, 15, 16, 17, 18, 19, 20];
export const PAIR_ROWS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

/** Rows computed internally (superset of the displayed rows, used for lookups). */
export const ALL_HARD_ROWS: readonly number[] = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
export const ALL_SOFT_ROWS: readonly number[] = [12, 13, 14, 15, 16, 17, 18, 19, 20];

export function rowLabel(key: RowKey): string {
  const { kind, n } = parseRow(key);
  if (kind === 'hard') return `Hard ${n}`;
  if (kind === 'soft') return `Soft ${n}`;
  return `${rankLabel(n as Rank)},${rankLabel(n as Rank)}`;
}

/** Compact label for chart row headers (hard: "16", soft: "A,7", pair: "8,8"). */
export function rowShortLabel(key: RowKey): string {
  const { kind, n } = parseRow(key);
  if (kind === 'hard') return String(n);
  if (kind === 'soft') return n === 12 ? 'A,A' : `A,${n - 11}`;
  return `${rankLabel(n as Rank)},${rankLabel(n as Rank)}`;
}

/**
 * Which chart row a hand is played from. A two-card pair uses the pair row only if splitting is
 * currently possible; otherwise it is played as its hard/soft total.
 * Returns `null` for totals ≥ 21 (always stand) — callers treat those as "stand".
 */
export function rowForHand(ranks: readonly Rank[], canSplit: boolean): RowKey | null {
  if (ranks.length === 2 && ranks[0] === ranks[1] && canSplit) return rowKey('pair', ranks[0]);
  const v = handValue(ranks);
  if (v.total >= 21) return null;
  if (v.soft) return rowKey('soft', v.total);
  return rowKey('hard', Math.max(4, v.total));
}

/** Human-readable description, e.g. "soft 18", "hard 16", "pair of 8s", "blackjack". */
export function describeHand(ranks: readonly Rank[]): string {
  if (isBlackjack(ranks)) return 'blackjack';
  const v = handValue(ranks);
  if (v.total > 21) return `bust (${v.total})`;
  if (ranks.length === 2 && ranks[0] === ranks[1]) {
    return ranks[0] === 1 ? 'pair of aces' : ranks[0] === 10 ? 'pair of tens' : `pair of ${ranks[0]}s`;
  }
  return `${v.soft ? 'soft' : 'hard'} ${v.total}`;
}

export function cardsLabel(ranks: readonly Rank[]): string {
  return ranks.map(rankLabel).join('-');
}

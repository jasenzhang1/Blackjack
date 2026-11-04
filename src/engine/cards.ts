/**
 * Cards, ranks and shoe compositions.
 *
 * The math engine only cares about *ranks*: 1 = Ace, 2..9, and 10 = any ten-valued card
 * (10, J, Q, K). Physical cards (with faces and suits) are used by the table simulator.
 */

export type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export const RANKS: readonly Rank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Dealer upcards in the order they appear as strategy-chart columns. */
export const UPCARDS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];

/** Short label used in charts: A, 2..9, T. */
export function rankLabel(r: Rank): string {
  return r === 1 ? 'A' : r === 10 ? 'T' : String(r);
}

/** Label used in prose: "A", "2".."9", "10". */
export function rankText(r: Rank): string {
  return r === 1 ? 'A' : String(r);
}

/**
 * A shoe composition. `counts[r]` is the number of cards of rank `r` (1..10); index 0 is unused.
 * Using the rank itself as the index keeps the formulas readable.
 */
export type Counts = number[];

export function emptyCounts(): Counts {
  return new Array(11).fill(0);
}

/** Composition of `decks` standard 52-card decks. */
export function fullShoe(decks: number): Counts {
  const c = emptyCounts();
  for (let r = 1; r <= 9; r++) c[r] = 4 * decks;
  c[10] = 16 * decks;
  return c;
}

export function totalCards(c: Counts): number {
  let n = 0;
  for (let r = 1; r <= 10; r++) n += c[r];
  return n;
}

/** Returns a copy of `c` with the given ranks removed (throws if a rank is exhausted). */
export function removeRanks(c: Counts, ranks: readonly Rank[]): Counts {
  const out = c.slice();
  for (const r of ranks) {
    if (out[r] <= 0) throw new Error(`Cannot remove rank ${rankLabel(r)}: none left in shoe`);
    out[r]--;
  }
  return out;
}

/** Probability of each rank in an infinite deck. */
export const INFINITE_PROBS: readonly number[] = [0, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 4 / 13];

// ---------------------------------------------------------------------------------------------
// Physical cards
// ---------------------------------------------------------------------------------------------

export type Suit = 'S' | 'H' | 'D' | 'C';
export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];
export const SUIT_SYMBOL: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };
export const SUIT_NAME: Record<Suit, string> = { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' };

export type Face = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';
export const FACES: readonly Face[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export interface Card {
  /** Unique id within a shoe (stable React key). */
  id: number;
  face: Face;
  suit: Suit;
  rank: Rank;
}

export function faceRank(face: Face): Rank {
  if (face === 'A') return 1;
  if (face === 'J' || face === 'Q' || face === 'K' || face === '10') return 10;
  return Number(face) as Rank;
}

export function isRed(suit: Suit): boolean {
  return suit === 'H' || suit === 'D';
}

export function cardLabel(c: Card): string {
  return `${c.face}${SUIT_SYMBOL[c.suit]}`;
}

/** Builds an ordered (unshuffled) shoe of physical cards. */
export function buildShoe(decks: number, idStart = 0): Card[] {
  const cards: Card[] = [];
  let id = idStart;
  for (let d = 0; d < decks; d++) {
    for (const suit of SUITS) {
      for (const face of FACES) cards.push({ id: id++, face, suit, rank: faceRank(face) });
    }
  }
  return cards;
}

/** Picks a face for a rank (ten-valued ranks get a random 10/J/Q/K). */
export function faceForRank(r: Rank, rand: () => number = Math.random): Face {
  if (r === 1) return 'A';
  if (r === 10) return (['10', 'J', 'Q', 'K'] as const)[Math.floor(rand() * 4)];
  return String(r) as Face;
}

let syntheticId = 1_000_000;
/** Creates a standalone card of the given rank (used by drills and the trainer's hand generator). */
export function makeCard(r: Rank, rand: () => number = Math.random, suit?: Suit): Card {
  return {
    id: syntheticId++,
    face: faceForRank(r, rand),
    suit: suit ?? SUITS[Math.floor(rand() * 4)],
    rank: r,
  };
}

/** Counts the ranks in a list of physical cards. */
export function countsOf(cards: readonly Card[]): Counts {
  const c = emptyCounts();
  for (const card of cards) c[card.rank]++;
  return c;
}

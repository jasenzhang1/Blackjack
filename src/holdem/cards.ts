/**
 * Hold'em cards. A card is an integer 0..51: rank = c >> 2 (0 = deuce … 12 = ace), suit = c & 3
 * (0 = spades, 1 = hearts, 2 = diamonds, 3 = clubs). Small integers keep the evaluator and the
 * runout enumeration allocation-free.
 */
import { faceRank, type Card as PlayingCardModel, type Face, type Suit } from '../engine/cards';

export type HCard = number;

export const RANK_CHARS = '23456789TJQKA';
const SUIT_CHARS = 'shdc';
export const SUIT_SYM = ['♠', '♥', '♦', '♣'] as const;
export const SUIT_WORD = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
const FACES: Face[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const PSUITS: Suit[] = ['S', 'H', 'D', 'C'];
const RANK_WORDS = ['deuce', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
const RANK_PLURALS = ['deuces', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];

export const rankOf = (c: HCard): number => c >> 2;
export const suitOf = (c: HCard): number => c & 3;
export const makeCard = (rank: number, suit: number): HCard => (rank << 2) | suit;

/** Rank as printed on a card: 2..10, J, Q, K, A. */
export const rankName = (r: number): string => FACES[r];
export const rankWord = (r: number, plural = false): string => (plural ? RANK_PLURALS[r] : RANK_WORDS[r]);

/** "As", "Td" → card. */
export function parseCard(s: string): HCard {
  const r = RANK_CHARS.indexOf(s[0].toUpperCase());
  const su = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (r < 0 || su < 0) throw new Error(`Bad card "${s}"`);
  return makeCard(r, su);
}

/** "AsKd 7h" → cards (whitespace ignored). */
export function parseCards(s: string): HCard[] {
  const t = s.replace(/\s+/g, '');
  const out: HCard[] = [];
  for (let i = 0; i < t.length; i += 2) out.push(parseCard(t.slice(i, i + 2)));
  return out;
}

export const cardCode = (c: HCard): string => RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
/** "A♠", "10♥". */
export const cardText = (c: HCard): string => rankName(rankOf(c)) + SUIT_SYM[suitOf(c)];
export const cardsText = (cs: readonly HCard[]): string => cs.map(cardText).join(' ');

export function fullDeck(): HCard[] {
  return Array.from({ length: 52 }, (_, i) => i);
}

/** Cards of the deck that are not in `dead`. */
export function liveCards(dead: readonly HCard[]): HCard[] {
  const d = new Set(dead);
  return fullDeck().filter((c) => !d.has(c));
}

/** Converts to the card model the shared <PlayingCard> component draws. */
export function toPlaying(c: HCard): PlayingCardModel {
  const face = FACES[rankOf(c)];
  return { id: c, face, suit: PSUITS[suitOf(c)], rank: faceRank(face) };
}

/**
 * Card-counting systems and true-count arithmetic.
 *
 * A count assigns a tag t(r) to every rank. The running count is the sum of the tags of the cards
 * seen. For a *balanced* system Σ t(r)·n_r = 0 over a full shoe, so the running count measures
 * how unbalanced the unseen cards are; dividing by the decks remaining (the true count) converts it
 * into a per-deck density, which is what actually moves the player's edge (see docs/MATH.md §8).
 */
import { fullShoe, type Counts, type Rank } from './cards';

export interface CountingSystem {
  id: string;
  name: string;
  balanced: boolean;
  level: number;
  /** tags[r] for r = 1..10 (index 0 unused, 1 = ace, 10 = ten-valued). */
  tags: readonly number[];
  /** Initial running count (unbalanced systems). */
  irc?: (decks: number) => number;
  blurb: string;
}

export const SYSTEMS: readonly CountingSystem[] = [
  {
    id: 'hilo',
    name: 'Hi-Lo',
    balanced: true,
    level: 1,
    tags: [0, -1, 1, 1, 1, 1, 1, 0, 0, 0, -1],
    blurb: 'The standard. 2–6 count +1, 7–9 count 0, tens and aces count −1. All index plays in this app use Hi-Lo.',
  },
  {
    id: 'ko',
    name: 'Knock-Out (KO)',
    balanced: false,
    level: 1,
    tags: [0, -1, 1, 1, 1, 1, 1, 1, 0, 0, -1],
    irc: (decks) => 4 - 4 * decks,
    blurb: 'Like Hi-Lo but the 7 also counts +1. Unbalanced, so no true-count conversion: start at 4 − 4×decks and bet up at the key count.',
  },
  {
    id: 'hiopt1',
    name: 'Hi-Opt I',
    balanced: true,
    level: 1,
    tags: [0, 0, 0, 1, 1, 1, 1, 0, 0, 0, -1],
    blurb: '3–6 count +1, tens −1, and the ace and the 2 are neutral (aces are side-counted by serious players).',
  },
  {
    id: 'hiopt2',
    name: 'Hi-Opt II',
    balanced: true,
    level: 2,
    tags: [0, 0, 1, 1, 2, 2, 1, 1, 0, 0, -2],
    blurb: 'Two-level count: 4 and 5 are +2, tens are −2. More accurate and harder to keep.',
  },
  {
    id: 'omega2',
    name: 'Omega II',
    balanced: true,
    level: 2,
    tags: [0, 0, 1, 1, 2, 2, 2, 1, 0, -1, -2],
    blurb: 'Two-level count with the 9 at −1 and the ace neutral.',
  },
  {
    id: 'zen',
    name: 'Zen Count',
    balanced: true,
    level: 2,
    tags: [0, -1, 1, 1, 2, 2, 2, 1, 0, 0, -2],
    blurb: 'Two-level count that keeps the ace in the count (−1).',
  },
  {
    id: 'halves',
    name: 'Wong Halves',
    balanced: true,
    level: 3,
    tags: [0, -1, 0.5, 1, 1, 1.5, 1, 0.5, 0, -0.5, -1],
    blurb: 'Three-level count with half-point tags. Very accurate; the 5 is the most valuable card (+1.5).',
  },
];

export function getSystem(id: string): CountingSystem {
  return SYSTEMS.find((s) => s.id === id) ?? SYSTEMS[0];
}

export const HI_LO = SYSTEMS[0];

export function tagOf(system: CountingSystem, r: Rank): number {
  return system.tags[r];
}

export function initialRunningCount(system: CountingSystem, decks: number): number {
  return system.irc ? system.irc(decks) : 0;
}

export function runningCountOf(system: CountingSystem, ranks: readonly Rank[], decks = 0): number {
  let rc = initialRunningCount(system, decks);
  for (const r of ranks) rc += system.tags[r];
  return rc;
}

/** Exact true count: running count per deck of unseen cards. */
export function trueCount(rc: number, cardsUnseen: number): number {
  const decks = cardsUnseen / 52;
  return decks > 0 ? rc / decks : 0;
}

/** Decks remaining rounded to the nearest half deck (how counters estimate the discard tray). */
export function estimateDecksRemaining(cardsUnseen: number): number {
  return Math.max(0.5, Math.round((cardsUnseen / 52) * 2) / 2);
}

/** True count the way counters compute it: RC divided by decks remaining to the nearest half. */
export function practicalTrueCount(rc: number, cardsUnseen: number): number {
  return rc / estimateDecksRemaining(cardsUnseen);
}

/**
 * A representative unseen shoe at a given Hi-Lo true count: `decksLeft` decks of cards in which
 * low cards (2–6) are depleted and high cards (T, A) enriched so that the Hi-Lo running count of the
 * *dealt* cards equals TC × decksLeft. Neutral ranks (7–9) stay proportional. Counts may be
 * fractional — the engine's falling-factorial formulas accept that (a "smoothed" shoe).
 */
export function representativeShoe(decksLeft: number, tc: number): Counts {
  const s = fullShoe(decksLeft);
  // Hi-Lo RC of dealt cards = (#high left − #low left)  ⇒  shift δ = TC·decksLeft / 2 per group.
  const delta = (tc * decksLeft) / 2;
  const low = 20 * decksLeft;
  const high = 20 * decksLeft;
  const lowScale = (low - delta) / low;
  const highScale = (high + delta) / high;
  for (let r = 2; r <= 6; r++) s[r] *= lowScale;
  s[1] *= highScale;
  s[10] *= highScale;
  return s;
}

/**
 * Rule-of-thumb Hi-Lo player edge: the house edge off the top, plus about 0.5% for every true-count
 * point (the exact slope depends on the rules — the Rules Lab computes it with the engine).
 */
export function hiLoEdgeEstimate(tc: number, houseEdge: number): number {
  return -houseEdge + 0.005 * tc;
}

/**
 * Table rules. One `Rules` object drives everything: the strategy chart, the EV proofs, the
 * house edge, the trainer's answer key and the table simulator.
 */

export type SurrenderRule = 'none' | 'late' | 'early';
export type DoubleRule = 'any' | '9-11' | '10-11';

export interface Rules {
  /** Number of 52-card decks; `Infinity` = infinite deck (continuous shuffler). */
  decks: number;
  /** Dealer hits soft 17 (H17) instead of standing (S17). */
  hitSoft17: boolean;
  /** Blackjack payout multiple: 1.5 = 3:2, 1.2 = 6:5, 1.4 = 7:5, 1 = even money. */
  blackjackPays: number;
  surrender: SurrenderRule;
  doubleOn: DoubleRule;
  doubleAfterSplit: boolean;
  /** Maximum number of hands a player may hold after splitting (2 = no resplits). */
  maxSplitHands: number;
  resplitAces: boolean;
  hitSplitAces: boolean;
  /**
   * US rule: with an A or ten up the dealer checks for blackjack before the players act, so players
   * only lose their original bet to a dealer blackjack. `false` = European no-hole-card (ENHC):
   * the dealer's second card is drawn after the players act and a dealer blackjack takes all bets.
   */
  dealerPeeks: boolean;
  /** Fraction of the shoe dealt before the shuffle (table simulator only; does not affect EVs). */
  penetration: number;
}

export const DEFAULT_RULES: Rules = {
  decks: 6,
  hitSoft17: false,
  blackjackPays: 1.5,
  surrender: 'late',
  doubleOn: 'any',
  doubleAfterSplit: true,
  maxSplitHands: 4,
  resplitAces: false,
  hitSplitAces: false,
  dealerPeeks: true,
  penetration: 0.75,
};

export const DECK_OPTIONS: readonly number[] = [1, 2, 4, 5, 6, 8, Infinity];

export const PAYOUT_OPTIONS: readonly { value: number; label: string }[] = [
  { value: 1.5, label: '3:2' },
  { value: 1.4, label: '7:5' },
  { value: 1.2, label: '6:5' },
  { value: 1, label: '1:1' },
];

export function payoutLabel(v: number): string {
  const opt = PAYOUT_OPTIONS.find((o) => Math.abs(o.value - v) < 1e-9);
  return opt ? opt.label : `${v}:1`;
}

export function decksLabel(d: number): string {
  if (!Number.isFinite(d)) return '∞ decks';
  return d === 1 ? '1 deck' : `${d} decks`;
}

export interface RulePreset {
  id: string;
  name: string;
  blurb: string;
  rules: Rules;
}

export const PRESETS: readonly RulePreset[] = [
  {
    id: 'strip6',
    name: 'Vegas Strip shoe',
    blurb: '6 decks, dealer stands on soft 17, DAS, late surrender. A common good game.',
    rules: { ...DEFAULT_RULES },
  },
  {
    id: 'shoe6h17',
    name: 'Typical H17 shoe',
    blurb: '6 decks, dealer hits soft 17, DAS, late surrender. Most common today.',
    rules: { ...DEFAULT_RULES, hitSoft17: true },
  },
  {
    id: 'ac8',
    name: 'Atlantic City',
    blurb: '8 decks, S17, DAS, late surrender.',
    rules: { ...DEFAULT_RULES, decks: 8 },
  },
  {
    id: 'dd2',
    name: 'Downtown double deck',
    blurb: '2 decks, H17, DAS, no surrender. Pitch game.',
    rules: { ...DEFAULT_RULES, decks: 2, hitSoft17: true, surrender: 'none', penetration: 0.65 },
  },
  {
    id: 'sd32',
    name: 'Single deck 3:2',
    blurb: '1 deck, H17, no DAS, no surrender. Rare today.',
    rules: { ...DEFAULT_RULES, decks: 1, hitSoft17: true, doubleAfterSplit: false, surrender: 'none', penetration: 0.6 },
  },
  {
    id: 'sd65',
    name: 'Single deck 6:5 (avoid!)',
    blurb: '1 deck, H17, blackjack pays 6:5. The payout costs about 1.4% of every bet.',
    rules: {
      ...DEFAULT_RULES,
      decks: 1,
      hitSoft17: true,
      blackjackPays: 1.2,
      doubleAfterSplit: false,
      surrender: 'none',
      penetration: 0.6,
    },
  },
  {
    id: 'enhc',
    name: 'European (no hole card)',
    blurb: '6 decks, S17, double 9-11 only, DAS, no surrender, no hole card (lose all to a dealer blackjack).',
    rules: { ...DEFAULT_RULES, doubleOn: '9-11', surrender: 'none', dealerPeeks: false, maxSplitHands: 3 },
  },
  {
    id: 'infinite',
    name: 'Infinite deck (textbook)',
    blurb: 'The idealised game used in most textbooks: cards drawn with replacement.',
    rules: { ...DEFAULT_RULES, decks: Infinity, surrender: 'none' },
  },
];

/** Stable key of the strategy-relevant rules (penetration excluded). */
export function rulesKey(r: Rules): string {
  return [
    Number.isFinite(r.decks) ? `${r.decks}D` : 'infD',
    r.hitSoft17 ? 'H17' : 'S17',
    `BJ${r.blackjackPays}`,
    `SUR-${r.surrender}`,
    `DBL-${r.doubleOn}`,
    r.doubleAfterSplit ? 'DAS' : 'NDAS',
    `SP${r.maxSplitHands}`,
    r.resplitAces ? 'RSA' : 'NRSA',
    r.hitSplitAces ? 'HSA' : 'NHSA',
    r.dealerPeeks ? 'PEEK' : 'ENHC',
  ].join('|');
}

/** Key of the rules that affect *playing decisions* (blackjack payout does not). */
export function strategyKey(r: Rules): string {
  return rulesKey({ ...r, blackjackPays: 1.5 });
}

/** Short chips describing the rules, e.g. ["6 decks", "S17", "DAS", "Late surrender", "BJ 3:2"]. */
export function describeRules(r: Rules): string[] {
  const chips = [decksLabel(r.decks), r.hitSoft17 ? 'H17' : 'S17'];
  chips.push(r.doubleOn === 'any' ? 'Double any 2' : `Double ${r.doubleOn}`);
  chips.push(r.doubleAfterSplit ? 'DAS' : 'No DAS');
  if (r.surrender !== 'none') chips.push(r.surrender === 'late' ? 'Late surrender' : 'Early surrender');
  else chips.push('No surrender');
  chips.push(`Split to ${r.maxSplitHands}`);
  if (r.resplitAces) chips.push('RSA');
  if (r.hitSplitAces) chips.push('Hit split aces');
  if (!r.dealerPeeks) chips.push('No hole card');
  chips.push(`BJ ${payoutLabel(r.blackjackPays)}`);
  return chips;
}

/** Whether the rules allow doubling on a two-card hand of this (hard) total / softness. */
export function canDoubleTotal(r: Rules, total: number, soft: boolean): boolean {
  if (r.doubleOn === 'any') return true;
  if (soft) return false;
  if (r.doubleOn === '9-11') return total >= 9 && total <= 11;
  return total === 10 || total === 11;
}

/** Converts rules to a JSON-safe object (Infinity is not representable in JSON). */
export function rulesToJSON(r: Rules): Record<string, unknown> {
  return { ...r, decks: Number.isFinite(r.decks) ? r.decks : 'inf' };
}

export function rulesFromJSON(o: unknown): Rules {
  if (!o || typeof o !== 'object') return { ...DEFAULT_RULES };
  const src = o as Record<string, unknown>;
  const out: Rules = { ...DEFAULT_RULES };
  const decks = src.decks === 'inf' || src.decks === null ? Infinity : Number(src.decks);
  if (DECK_OPTIONS.includes(decks)) out.decks = decks;
  if (typeof src.hitSoft17 === 'boolean') out.hitSoft17 = src.hitSoft17;
  if (typeof src.blackjackPays === 'number' && src.blackjackPays >= 1 && src.blackjackPays <= 2) out.blackjackPays = src.blackjackPays;
  if (src.surrender === 'none' || src.surrender === 'late' || src.surrender === 'early') out.surrender = src.surrender;
  if (src.doubleOn === 'any' || src.doubleOn === '9-11' || src.doubleOn === '10-11') out.doubleOn = src.doubleOn;
  if (typeof src.doubleAfterSplit === 'boolean') out.doubleAfterSplit = src.doubleAfterSplit;
  if (typeof src.maxSplitHands === 'number' && [2, 3, 4].includes(src.maxSplitHands)) out.maxSplitHands = src.maxSplitHands;
  if (typeof src.resplitAces === 'boolean') out.resplitAces = src.resplitAces;
  if (typeof src.hitSplitAces === 'boolean') out.hitSplitAces = src.hitSplitAces;
  if (typeof src.dealerPeeks === 'boolean') out.dealerPeeks = src.dealerPeeks;
  if (typeof src.penetration === 'number' && src.penetration >= 0.4 && src.penetration <= 0.95) out.penetration = src.penetration;
  return out;
}

/** Physical number of decks used by the table simulator (∞ is simulated as a CSM-like 8-deck shoe). */
export function tableDecks(r: Rules): number {
  return Number.isFinite(r.decks) ? r.decks : 8;
}

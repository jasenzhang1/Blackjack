/**
 * Opponent archetypes. Each one has the HUD stats a player would show over a big sample and a
 * simple behaviour model the training rooms use to build betting ranges, fold equity and
 * implied-odds payoffs. The numbers are typical of live and online low-stakes games, not of any
 * particular player pool; every room shows the assumptions it uses.
 */

export type ProfileId = 'nit' | 'tag' | 'lag' | 'station' | 'maniac';

/** How a player's hands fall into the categories used for range reading. */
export type HandGroup = 'monster' | 'top' | 'weak' | 'draw' | 'air';

export const GROUPS: readonly HandGroup[] = ['monster', 'top', 'weak', 'draw', 'air'];

export const GROUP_LABEL: Record<HandGroup, string> = {
  monster: 'Two pair or better',
  top: 'Top pair / overpair',
  weak: 'Weaker pair',
  draw: 'Strong draw',
  air: 'Nothing (air)',
};

export const GROUP_COLOR: Record<HandGroup, string> = {
  monster: '#e9b949',
  top: '#199e70',
  weak: '#3987e5',
  draw: '#b07ce8',
  air: '#7d8781',
};

export interface HudStats {
  /** Voluntarily put money in the pot preflop, %. */
  vpip: number;
  /** Preflop raise, %. */
  pfr: number;
  /** 3-bet, %. */
  threeBet: number;
  /** Aggression factor: (bets + raises) / calls. */
  af: number;
  /** Fold to continuation bet, %. */
  foldToCbet: number;
  /** Went to showdown when seeing the flop, %. */
  wtsd: number;
}

export interface Profile {
  id: ProfileId;
  name: string;
  short: string;
  color: string;
  blurb: string;
  stats: HudStats;
  /** Probability of betting each hand group when checked to (or as the aggressor). */
  betProb: Record<HandGroup, number>;
  /** Probability of calling your river value bet after your draw comes in, by how visible it is. */
  payoff: Record<Visibility, number>;
  exploits: string[];
}

/** How obvious a completed draw is to the opponent. */
export type Visibility = 'obvious' | 'medium' | 'hidden';

export const VISIBILITY_LABEL: Record<Visibility, string> = {
  obvious: 'obvious (the flush card arrives)',
  medium: 'readable (open-ended straight comes in)',
  hidden: 'disguised (gutshot fills)',
};

export const PROFILES: Record<ProfileId, Profile> = {
  nit: {
    id: 'nit',
    name: 'Nit',
    short: 'Tight-passive',
    color: '#8fb3ff',
    blurb: 'Plays few hands, rarely bluffs, folds to pressure, and only puts in big money with big hands.',
    stats: { vpip: 12, pfr: 9, threeBet: 3, af: 1.8, foldToCbet: 62, wtsd: 21 },
    betProb: { monster: 0.85, top: 0.8, weak: 0.15, draw: 0.2, air: 0.05 },
    payoff: { obvious: 0.1, medium: 0.25, hidden: 0.4 },
    exploits: ['Steal and c-bet often: they fold too much.', 'Fold to their raises and big river bets: they are rarely bluffing.', 'Implied odds against them are poor: they will not pay you off unless they are strong too.'],
  },
  tag: {
    id: 'tag',
    name: 'TAG regular',
    short: 'Tight-aggressive',
    color: '#5fd08f',
    blurb: 'A solid regular. Selective preflop, bets for value and semi-bluffs, folds when beaten.',
    stats: { vpip: 22, pfr: 18, threeBet: 7, af: 2.8, foldToCbet: 48, wtsd: 27 },
    betProb: { monster: 0.8, top: 0.85, weak: 0.35, draw: 0.55, air: 0.3 },
    payoff: { obvious: 0.2, medium: 0.35, hidden: 0.55 },
    exploits: ['Few big leaks: play solid, close to balanced poker.', 'Their c-bets are wide on dry boards: float in position.', 'Respect their turn and river barrels more than their flop bets.'],
  },
  lag: {
    id: 'lag',
    name: 'LAG',
    short: 'Loose-aggressive',
    color: '#f0a35e',
    blurb: 'Plays many hands and plays them fast. Lots of pressure, plenty of bluffs and semi-bluffs.',
    stats: { vpip: 32, pfr: 26, threeBet: 11, af: 3.8, foldToCbet: 40, wtsd: 29 },
    betProb: { monster: 0.75, top: 0.9, weak: 0.5, draw: 0.75, air: 0.5 },
    payoff: { obvious: 0.3, medium: 0.45, hidden: 0.6 },
    exploits: ['Widen your calling and 4-bet ranges: their 3-bets are light.', 'Trap with strong hands and let them bet.', 'Bluff-catch more often with medium hands.'],
  },
  station: {
    id: 'station',
    name: 'Calling station',
    short: 'Loose-passive',
    color: '#ff8fa3',
    blurb: 'Calls with anything, rarely raises, hates to fold. Goes to showdown far too often.',
    stats: { vpip: 48, pfr: 7, threeBet: 2, af: 0.7, foldToCbet: 22, wtsd: 41 },
    betProb: { monster: 0.5, top: 0.45, weak: 0.2, draw: 0.2, air: 0.1 },
    payoff: { obvious: 0.55, medium: 0.7, hidden: 0.85 },
    exploits: ['Never bluff: they call.', 'Value bet thinly, even second pair on the river.', 'When a passive player suddenly bets or raises big, believe them.', 'Your implied odds are excellent: they pay off made hands.'],
  },
  maniac: {
    id: 'maniac',
    name: 'Maniac',
    short: 'Hyper-aggressive',
    color: '#ff6b6b',
    blurb: 'Raises and bets almost everything. Huge variance, and a huge bluffing frequency.',
    stats: { vpip: 62, pfr: 42, threeBet: 18, af: 5, foldToCbet: 30, wtsd: 33 },
    betProb: { monster: 0.9, top: 0.95, weak: 0.8, draw: 0.85, air: 0.75 },
    payoff: { obvious: 0.45, medium: 0.6, hidden: 0.75 },
    exploits: ['Call down lighter: their bets are often air.', 'Let them bluff into you rather than raising them off their bluffs.', 'Tighten up preflop and play big pots with strong hands.'],
  },
};

export const PROFILE_IDS: readonly ProfileId[] = ['nit', 'tag', 'lag', 'station', 'maniac'];

/**
 * Fraction of the range that folds to a bet of `frac` × pot. Anchored at the player's fold-to-c-bet
 * stat (measured against a typical two-thirds-pot c-bet) and rising with the bet size.
 */
export function foldVs(p: Profile, frac: number): number {
  return Math.min(0.9, Math.max(0.05, p.stats.foldToCbet / 100 + 0.3 * (frac - 0.66)));
}

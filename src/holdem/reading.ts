/**
 * Reading-opponents drills: naming a player type from HUD stats, counting combos with blockers,
 * breaking a betting range into hand groups, and choosing the exploit.
 */
import { pick, shuffle, type RNG } from '../engine/rng';
import { fullDeck, rankOf, rankWord, suitOf, type HCard } from './cards';
import type { WeightedCombo } from './analysis';
import { GROUPS, PROFILE_IDS, PROFILES, type HandGroup, type HudStats, type Profile, type ProfileId } from './profiles';
import { ALL_CLASSES, combosOf, topRange, type HandClass } from './ranges';
import { weightedRange } from './scenarios';

// ---------------------------------------------------------------------------------------------
// Profile from HUD stats
// ---------------------------------------------------------------------------------------------

export interface ProfileDrill {
  answer: ProfileId;
  stats: HudStats;
  hands: number;
}

export function profileDrill(rand: RNG): ProfileDrill {
  const answer = pick(rand, PROFILE_IDS);
  const base = PROFILES[answer].stats;
  const jitter = (x: number, rel = 0.14) => x * (1 + (rand() * 2 - 1) * rel);
  const vpip = Math.round(jitter(base.vpip));
  const pfr = Math.min(vpip - 1, Math.round(jitter(base.pfr)));
  return {
    answer,
    hands: pick(rand, [400, 900, 1500, 3000]),
    stats: {
      vpip,
      pfr: Math.max(1, pfr),
      threeBet: Math.max(1, Math.round(jitter(base.threeBet, 0.25))),
      af: Math.round(jitter(base.af, 0.18) * 10) / 10,
      foldToCbet: Math.round(jitter(base.foldToCbet, 0.12)),
      wtsd: Math.round(jitter(base.wtsd, 0.1)),
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Combo counting
// ---------------------------------------------------------------------------------------------

export interface ComboDrill {
  hero: HCard[];
  board: HCard[];
  cls: HandClass;
  answer: number;
  /** Plain-language working. */
  working: string;
}

export function comboWorking(cls: HandClass, dead: readonly HCard[]): string {
  const left = (r: number) => 4 - dead.filter((c) => rankOf(c) === r).length;
  const nh = left(cls.hi);
  if (cls.pair) {
    return `${nh} ${rankWord(cls.hi, true)} left, so ${nh} × ${Math.max(0, nh - 1)} ÷ 2 = ${(nh * Math.max(0, nh - 1)) / 2} ways to pair them up.`;
  }
  const nl = left(cls.lo);
  const deadSet = new Set(dead);
  let suited = 0;
  for (let s = 0; s < 4; s++) if (!deadSet.has((cls.hi << 2) | s) && !deadSet.has((cls.lo << 2) | s)) suited++;
  const H = rankWord(cls.hi, true);
  const L = rankWord(cls.lo, true);
  if (cls.suited) return `Suited needs both cards in one suit. ${suited} of the 4 suits still have both the ${rankWord(cls.hi)} and the ${rankWord(cls.lo)} live, so ${suited} combos.`;
  return `${nh} ${H} × ${nl} ${L} = ${nh * nl} combos in all, minus the ${suited} suited ones, leaves ${nh * nl - suited} offsuit combos.`;
}

export function comboDrill(rand: RNG): ComboDrill {
  const d = shuffle(fullDeck(), rand);
  const hero = d.slice(0, 2);
  const board = d.slice(2, 5);
  const dead = [...hero, ...board];
  const deadRanks = new Set(dead.map(rankOf));
  // Mostly ask about hands whose cards are blocked by the board or your hand: that is the skill.
  const blocked = ALL_CLASSES.filter((c) => deadRanks.has(c.hi) || deadRanks.has(c.lo));
  const pool = rand() < 0.8 ? blocked.filter((c) => c.pair || c.hi >= 6) : topRange(0.3);
  const cls = pick(rand, pool.length ? pool : blocked);
  return { hero, board, cls, answer: combosOf(cls, dead).length, working: comboWorking(cls, dead) };
}

// ---------------------------------------------------------------------------------------------
// Range breakdown
// ---------------------------------------------------------------------------------------------

export interface RangeDrill {
  profile: Profile;
  board: HCard[];
  preflop: HandClass[];
  range: WeightedCombo[];
  shares: Record<HandGroup, number>;
  answer: HandGroup;
}

export function rangeDrill(rand: RNG, id: ProfileId | 'random'): RangeDrill {
  const profile = PROFILES[id === 'random' ? pick(rand, PROFILE_IDS) : id];
  for (;;) {
    const board = shuffle(fullDeck(), rand).slice(0, 3);
    // Villain raised preflop (PFR range) and bets the flop.
    const share = Math.max(0.04, profile.stats.pfr / 100);
    const range = weightedRange(board, board, share, (g) => profile.betProb[g]);
    const totals = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<HandGroup, number>;
    let W = 0;
    for (const c of range) {
      totals[c.group] += c.w;
      W += c.w;
    }
    if (W === 0) continue;
    for (const g of GROUPS) totals[g] /= W;
    const sorted = [...GROUPS].sort((a, b) => totals[b] - totals[a]);
    // Skip near-ties: the drill should have one clear answer.
    if (totals[sorted[0]] - totals[sorted[1]] < 0.03) continue;
    return { profile, board, preflop: topRange(share), range, shares: totals, answer: sorted[0] };
  }
}

/** Fraction of each grid cell's live combos in a weighted range (for the range grid). */
export function cellWeights(range: readonly WeightedCombo[], dead: readonly HCard[]): Map<string, number> {
  const sum = new Map<string, number>();
  for (const c of range) sum.set(c.cls.label, (sum.get(c.cls.label) ?? 0) + c.w);
  const out = new Map<string, number>();
  for (const [label, s] of sum) {
    const cls = range.find((c) => c.cls.label === label)!.cls;
    const live = combosOf(cls, dead).length;
    out.set(label, live ? s / live : 0);
  }
  return out;
}

/** Board texture in words ("monotone", "two-tone", "paired", "connected"). */
export function textureText(board: readonly HCard[]): string {
  const suits = new Set(board.map(suitOf)).size;
  const ranks = board.map(rankOf).sort((a, b) => b - a);
  const paired = new Set(ranks).size < ranks.length;
  const parts = [suits === 1 ? 'monotone' : suits === 2 && board.length === 3 ? 'two-tone' : 'rainbow'];
  if (paired) parts.push('paired');
  if (ranks[0] - ranks[ranks.length - 1] <= 4 && !paired) parts.push('connected');
  if (ranks[0] >= 10) parts.push(`${rankWord(ranks[0])}-high`);
  else parts.push('low');
  return parts.join(', ');
}

// ---------------------------------------------------------------------------------------------
// Exploits
// ---------------------------------------------------------------------------------------------

export interface ExploitQuestion {
  id: string;
  profile: ProfileId;
  situation: string;
  options: string[];
  answer: number;
  why: string;
}

export const EXPLOITS: readonly ExploitQuestion[] = [
  {
    id: 'station-thin',
    profile: 'station',
    situation: 'River. You hold second pair, decent kicker. The calling station (VPIP 50, PFR 6, WTSD 41%) checks to you.',
    options: ['Check behind and show down', 'Bet about half pot for value', 'Shove as a bluff'],
    answer: 1,
    why: 'A station calls with any pair and many ace-highs. Second pair beats a big part of that calling range, so a thin value bet earns money a regular would never pay you.',
  },
  {
    id: 'station-bluff',
    profile: 'station',
    situation: 'River. Your flush draw missed and you have queen high. The calling station checks to you.',
    options: ['Bet big to make them fold', 'Give up and check', 'Bet small as a blocker'],
    answer: 1,
    why: 'Bluffs need folds, and stations fold far too little (fold to c-bet about 22%). Your bet only gets called by hands that beat you. Save the money for value bets.',
  },
  {
    id: 'station-raise',
    profile: 'station',
    situation: 'Turn. You bet top pair, good kicker. The calling station, who has only raised twice in 300 hands, suddenly check-raises big.',
    options: ['Re-raise all-in: they are wild', 'Call and hope', 'Fold: a passive player’s raise means a very strong hand'],
    answer: 2,
    why: 'An aggression factor under 1 means they almost never bet or raise without the goods. When a passive player wakes up, their range is two pair or better. One pair is a fold.',
  },
  {
    id: 'nit-raise',
    profile: 'nit',
    situation: 'Flop K♦ 7♣ 2♠. You raised with A♠K♣ and c-bet. The nit (VPIP 12) raises you.',
    options: ['Re-raise for value', 'Call one street, fold to more pressure', 'Shove: top pair top kicker'],
    answer: 1,
    why: 'A nit raising this dry board is mostly sets (77, 22, KK) and K7. Only 6 combos of KK/77/22 remain, but almost nothing worse raises. Do not build a big pot; continue cautiously and let go if the pressure keeps coming.',
  },
  {
    id: 'nit-steal',
    profile: 'nit',
    situation: 'You are on the button with 9♣6♣. It folds to the nit in the big blind.',
    options: ['Fold: the hand is weak', 'Raise to steal', 'Limp to see a cheap flop'],
    answer: 1,
    why: 'Nits defend their blinds far too little. Your raise wins the pot right away most of the time, and when they call you can c-bet often because they fold about 62% to c-bets.',
  },
  {
    id: 'nit-implied',
    profile: 'nit',
    situation: 'The nit opens to $10 (they play 12% of hands). You hold 4♥4♦ with $80 left in your stack. Set-mine?',
    options: ['Call: sets win huge pots', 'Fold: the stacks are too shallow for set mining', 'Re-raise all-in'],
    answer: 1,
    why: 'You flop a set about 1 time in 8.5. Calling $10 needs roughly $75–85 in implied winnings on top of the pot, and you can win at most $70 more even if the nit stacks off every time (they won’t). Set mining needs about 15–20× the call behind.',
  },
  {
    id: 'maniac-calldown',
    profile: 'maniac',
    situation: 'You have top pair, good kicker. The maniac (VPIP 62, AF 5) has bet every street. River: they bet again.',
    options: ['Fold: three barrels means a monster', 'Call: their range is full of bluffs', 'Raise all-in for value'],
    answer: 1,
    why: 'A maniac’s triple barrel includes a huge number of bluffs. Calling wins against all of them. Raising folds out the bluffs and gets called only by the hands that beat you.',
  },
  {
    id: 'maniac-trap',
    profile: 'maniac',
    situation: 'You flop a set out of position against the maniac.',
    options: ['Lead out big', 'Check and let them bet', 'Check and fold'],
    answer: 1,
    why: 'The maniac bets about 75% of their air when checked to. Checking lets them put money in with hands that would fold to your bet. Check-call or check-raise later.',
  },
  {
    id: 'lag-3bet',
    profile: 'lag',
    situation: 'You open A♦Q♣ from the cutoff. The LAG on the button (3-bet 11%) re-raises.',
    options: ['Fold: AQ is dominated by 3-bets', 'Call or 4-bet: their range is wide', 'Fold anything but AA/KK'],
    answer: 1,
    why: 'An 11% 3-bet range is full of suited connectors and weak aces. AQ is well ahead of that range. Folding it lets them steal profitably.',
  },
  {
    id: 'tag-float',
    profile: 'tag',
    situation: 'Dry board A♣ 8♦ 3♥. The TAG raised preflop and c-bets a third of the pot. You are in position with 7♠6♠.',
    options: ['Fold: you have nothing', 'Call (float) and take it away on later streets', 'Raise all-in'],
    answer: 1,
    why: 'Good players c-bet almost everything on ace-high dry boards, so the bet says little. The small price and position let you float and bet when they check the turn. A shove only gets called by aces.',
  },
  {
    id: 'blocker',
    profile: 'tag',
    situation: 'River on a board with three spades. You hold A♠ and nothing else. The TAG checks to you.',
    options: ['Check: you have nothing', 'Bluff: your A♠ blocks the nut flush', 'Bet tiny for value'],
    answer: 1,
    why: 'Holding the A♠ means the opponent can never have the nut flush, and weaker flushes may fold to a big bet. Your blocker makes this one of the best bluffing hands you can have.',
  },
  {
    id: 'cheap-catch',
    profile: 'lag',
    situation: 'The LAG bets a quarter of the pot on the river. You have a weak pair that only beats bluffs.',
    options: ['Fold: you only beat bluffs', 'Call: you need to win just 1 time in 6', 'Raise to find out where you are'],
    answer: 1,
    why: 'Calling ¼ pot means risking 1 to win 5 (pot + bet + your call = 6 parts). You need only 16.7% equity. Even a tight player bluffs that often with small bets.',
  },
];

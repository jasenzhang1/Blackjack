/**
 * Hi-Lo playing deviations: the Illustrious 18 and the Fab 4 surrenders (Don Schlesinger,
 * "Blackjack Attack"), multi-deck indices. A deviation reads: "at a true count ≥ index play
 * `atOrAbove`, otherwise play `below`".
 */
import { type Rank } from './cards';
import { type Action } from './ev';
import { rowForHand, rowLabel, type RowKey } from './hand';
import { type Rules } from './rules';
import { advise, type Availability, type StrategyTable } from './strategy';

export interface Deviation {
  id: string;
  group: 'Insurance' | 'Illustrious 18' | 'Fab 4';
  /** Rank in the Illustrious 18 by value (1 = most valuable). */
  order: number;
  row: RowKey | 'INS';
  up: Rank;
  index: number;
  indexH17?: number;
  atOrAbove: Action | 'I';
  below: Action | 'N';
  note: string;
}

const D = (
  id: string,
  group: Deviation['group'],
  order: number,
  row: Deviation['row'],
  up: Rank,
  index: number,
  atOrAbove: Deviation['atOrAbove'],
  below: Deviation['below'],
  note: string,
  indexH17?: number,
): Deviation => ({ id, group, order, row, up, index, atOrAbove, below, note, indexH17 });

export const DEVIATIONS: readonly Deviation[] = [
  D('ins', 'Insurance', 1, 'INS', 1, 3, 'I', 'N', 'Insurance pays 2:1, so it wins when more than 1/3 of the unseen cards are tens. That happens at about TC +3.'),
  D('16v10', 'Illustrious 18', 2, 'H16', 10, 0, 'S', 'H', 'Stand on 16 vs 10 at any positive count. A ten-rich shoe makes hitting bust more often.'),
  D('15v10', 'Illustrious 18', 3, 'H15', 10, 4, 'S', 'H', 'Stand on 15 vs 10 at TC +4 or more.'),
  D('TTv5', 'Illustrious 18', 4, 'P10', 5, 5, 'P', 'S', 'Split tens vs 5 at TC +5 or more. (Draws attention; use sparingly in a casino.)'),
  D('TTv6', 'Illustrious 18', 5, 'P10', 6, 4, 'P', 'S', 'Split tens vs 6 at TC +4 or more.'),
  D('10v10', 'Illustrious 18', 6, 'H10', 10, 4, 'D', 'H', 'Double 10 vs 10 at TC +4 or more.'),
  D('12v3', 'Illustrious 18', 7, 'H12', 3, 2, 'S', 'H', 'Stand on 12 vs 3 at TC +2 or more.'),
  D('12v2', 'Illustrious 18', 8, 'H12', 2, 3, 'S', 'H', 'Stand on 12 vs 2 at TC +3 or more.'),
  D('11vA', 'Illustrious 18', 9, 'H11', 1, 1, 'D', 'H', 'Double 11 vs A at TC +1 or more (basic strategy already doubles in H17 games).', -1),
  D('9v2', 'Illustrious 18', 10, 'H9', 2, 1, 'D', 'H', 'Double 9 vs 2 at TC +1 or more.'),
  D('10vA', 'Illustrious 18', 11, 'H10', 1, 4, 'D', 'H', 'Double 10 vs A at TC +4 or more (+3 in H17 games).', 3),
  D('9v7', 'Illustrious 18', 12, 'H9', 7, 3, 'D', 'H', 'Double 9 vs 7 at TC +3 or more.'),
  D('16v9', 'Illustrious 18', 13, 'H16', 9, 5, 'S', 'H', 'Stand on 16 vs 9 at TC +5 or more.'),
  D('13v2', 'Illustrious 18', 14, 'H13', 2, -1, 'S', 'H', 'Hit 13 vs 2 when the true count drops below −1.'),
  D('12v4', 'Illustrious 18', 15, 'H12', 4, 0, 'S', 'H', 'Hit 12 vs 4 at any negative count.'),
  D('12v5', 'Illustrious 18', 16, 'H12', 5, -2, 'S', 'H', 'Hit 12 vs 5 below TC −2.'),
  D('12v6', 'Illustrious 18', 17, 'H12', 6, -1, 'S', 'H', 'Hit 12 vs 6 below TC −1.'),
  D('13v3', 'Illustrious 18', 18, 'H13', 3, -2, 'S', 'H', 'Hit 13 vs 3 below TC −2.'),
  D('14v10R', 'Fab 4', 1, 'H14', 10, 3, 'R', 'N', 'Surrender 14 vs 10 at TC +3 or more.'),
  D('15v10R', 'Fab 4', 2, 'H15', 10, 0, 'R', 'N', 'Surrender 15 vs 10 at TC 0 or more. Below 0, play it out (hit).'),
  D('15v9R', 'Fab 4', 3, 'H15', 9, 2, 'R', 'N', 'Surrender 15 vs 9 at TC +2 or more.'),
  D('15vAR', 'Fab 4', 4, 'H15', 1, 1, 'R', 'N', 'Surrender 15 vs A at TC +1 or more (basic strategy surrenders in H17 games).', -1),
];

export function deviationIndex(d: Deviation, rules: Rules): number {
  return rules.hitSoft17 && d.indexH17 !== undefined ? d.indexH17 : d.index;
}

/** True counts within this distance of an index accept either play (deck-estimation grace). */
export const GRACE = 0.5;

export interface GradedPlay {
  /** The play graded as correct. */
  action: Action;
  /** Every play accepted as correct (more than one inside the grace band). */
  acceptable: Action[];
  /** Plain basic-strategy play. */
  basic: Action;
  /** Deviation that decided the play (if any). */
  deviation: Deviation | null;
  /** Human-readable reason. */
  reason: string;
}

function available(a: Action, avail: Availability): boolean {
  if (a === 'D') return avail.double;
  if (a === 'P') return avail.split;
  if (a === 'R') return avail.surrender;
  return true;
}

/**
 * Correct play for a hand, optionally including Hi-Lo index deviations at true count `tc`.
 */
export function gradePlay(
  table: StrategyTable,
  ranks: readonly Rank[],
  up: Rank,
  avail: Availability,
  tc: number,
  useDeviations: boolean,
): GradedPlay {
  const basicAdvice = advise(table, ranks, up, avail);
  const basic = basicAdvice.action;
  const base: GradedPlay = { action: basic, acceptable: [basic], basic, deviation: null, reason: 'Basic strategy' };
  if (!useDeviations) return base;
  const rules = table.rules;
  const row = rowForHand(ranks, avail.split);
  if (!row) return base;
  let matches = DEVIATIONS.filter((d) => d.row === row && d.up === up);
  // A pair that basic strategy does not split (5,5; 6,6 vs 7…) is played as its total, so the
  // hard-total indices apply to it (e.g. 5,5 vs 10 at TC +4 → double).
  if (!matches.length && row.startsWith('P') && basic !== 'P') {
    const alt = rowForHand(ranks, false);
    matches = DEVIATIONS.filter((d) => d.row === alt && d.up === up);
  }
  if (!matches.length) return base;

  const decide = (d: Deviation): { action: Action | null; both: boolean } => {
    const idx = deviationIndex(d, rules);
    const hi = d.atOrAbove as Action;
    const lo = d.below === 'N' ? null : (d.below as Action);
    const both = Math.abs(tc - idx) < GRACE;
    return { action: tc >= idx ? hi : lo, both };
  };

  // Surrender (Fab 4) first.
  const fab = matches.find((d) => d.group === 'Fab 4');
  const ill = matches.find((d) => d.group === 'Illustrious 18');
  const nonSurrenderPlay = (): { action: Action; dev: Deviation | null; both: Action[] } => {
    if (ill) {
      const { action, both } = decide(ill);
      const hi = ill.atOrAbove as Action;
      const lo = ill.below as Action;
      const pick = action && available(action, avail) ? action : advise(table, ranks, up, { ...avail, surrender: false }).action;
      const alts = both ? [hi, lo].filter((a) => available(a, avail)) : [pick];
      return { action: pick, dev: ill, both: alts.length ? alts : [pick] };
    }
    const a = advise(table, ranks, up, { ...avail, surrender: false }).action;
    return { action: a, dev: null, both: [a] };
  };

  if (fab && avail.surrender) {
    const idx = deviationIndex(fab, rules);
    const nsp = nonSurrenderPlay();
    const both = Math.abs(tc - idx) < GRACE;
    if (tc >= idx) {
      return {
        action: 'R',
        acceptable: both ? unique(['R', ...nsp.both]) : ['R'],
        basic,
        deviation: fab,
        reason: `${fab.group}: surrender at TC ≥ ${fmtIdx(idx)}`,
      };
    }
    return {
      action: nsp.action,
      acceptable: both ? unique([nsp.action, 'R', ...nsp.both]) : nsp.both,
      basic,
      deviation: nsp.dev ?? fab,
      reason: nsp.dev ? `${nsp.dev.group}: ${describeDeviation(nsp.dev, rules)}` : `Don't surrender below TC ${fmtIdx(idx)}`,
    };
  }

  // Basic strategy surrender beats the stand/hit index plays (e.g. 16 vs 10 with late surrender).
  if (basic === 'R') return base;

  if (ill) {
    const nsp = nonSurrenderPlay();
    return {
      action: nsp.action,
      acceptable: nsp.both,
      basic,
      deviation: ill,
      reason: `${ill.group}: ${describeDeviation(ill, rules)}`,
    };
  }
  return base;
}

/** Insurance / even-money decision: take it only with deviations on and TC ≥ +3. */
export function gradeInsurance(tc: number, useDeviations: boolean, rules: Rules): { take: boolean; acceptable: boolean[]; reason: string } {
  const ins = DEVIATIONS[0];
  const idx = deviationIndex(ins, rules);
  if (!useDeviations) return { take: false, acceptable: [false], reason: 'Basic strategy never takes insurance: it loses about 7.7% of the insured amount off the top.' };
  const take = tc >= idx;
  const both = Math.abs(tc - idx) < GRACE;
  return { take, acceptable: both ? [true, false] : [take], reason: `Insurance: take at TC ≥ +${idx}` };
}

function unique<T>(a: T[]): T[] {
  return Array.from(new Set(a));
}

export function fmtIdx(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

const ACTION_VERB: Record<string, string> = { H: 'hit', S: 'stand', D: 'double', P: 'split', R: 'surrender', I: 'insure', N: 'no' };

export function describeDeviation(d: Deviation, rules: Rules): string {
  const idx = deviationIndex(d, rules);
  const hand = d.row === 'INS' ? 'Insurance' : `${rowLabel(d.row)} vs ${d.up === 1 ? 'A' : d.up}`;
  const below = d.below === 'N' ? (d.atOrAbove === 'I' ? 'decline' : 'play normally') : ACTION_VERB[d.below];
  return `${hand}: ${ACTION_VERB[d.atOrAbove]} at TC ≥ ${fmtIdx(idx)}, otherwise ${below}`;
}

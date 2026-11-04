/**
 * Simulated players. Every bot plays from the engine's basic-strategy table; personalities add
 * realistic mistakes, betting styles and (for counters) Hi-Lo deviations.
 */
import type { Rank } from './cards';
import { HI_LO, trueCount } from './counting';
import { gradeInsurance, gradePlay } from './deviations';
import type { Action } from './ev';
import { handValue } from './hand';
import { pick, type RNG } from './rng';
import { advise, type StrategyTable } from './strategy';
import type { BotBrain, GameAvail, Player, PlayerHand, Seat, Table } from './game';

export type BotStyle = 'pro' | 'tourist' | 'counter';

export interface BotProfile {
  name: string;
  style: BotStyle;
  color: string;
}

export const BOT_STYLES: Record<BotStyle, { label: string; blurb: string; errorRate: number }> = {
  pro: { label: 'Basic strategy', blurb: 'Plays perfect basic strategy, flat-ish bets.', errorRate: 0 },
  tourist: { label: 'Tourist', blurb: 'Plays by feel: often stands on stiffs, skips doubles and splits, sometimes insures.', errorRate: 0.22 },
  counter: { label: 'Counter', blurb: 'Counts Hi-Lo, ramps bets with the true count and uses index plays.', errorRate: 0 },
};

const NAMES = ['Ava', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Hana', 'Ivan', 'Jo', 'Kai', 'Lena', 'Milo', 'Nia', 'Omar', 'Pia', 'Rosa', 'Sam', 'Tess', 'Uma', 'Vic', 'Wes', 'Yara', 'Zoe'];
const COLORS = ['#e07a5f', '#81b29a', '#f2cc8f', '#3d85c6', '#c27ba0', '#76a5af', '#e69138', '#8e7cc3', '#6aa84f', '#cc4125'];

export function makeBots(n: number, rng: RNG, styles: BotStyle[] = ['pro', 'tourist', 'counter']): Player[] {
  const names = NAMES.slice();
  const out: Player[] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(rng() * names.length);
    const name = names.splice(idx, 1)[0];
    const style = styles[i % styles.length];
    out.push({ id: `bot-${name}`, name, kind: 'bot', bankroll: 1_000_000, style, avatar: COLORS[(idx + i) % COLORS.length] });
  }
  return out;
}

/** Current Hi-Lo true count as seen by everyone at the table (exact). */
export function tableTrueCount(table: Table): number {
  let rc = 0;
  for (const c of table.revealed) rc += HI_LO.tags[c.rank];
  return trueCount(rc, table.cardsUnseen());
}

/** A plausible "feel player" mistake for a hand. */
function touristMistake(ranks: Rank[], up: Rank, best: Action, avail: GameAvail, rng: RNG): Action {
  const v = handValue(ranks);
  if (best === 'D') return 'H';
  if (best === 'P') return v.total >= 12 && v.total <= 16 ? 'S' : 'H';
  if (best === 'R') return 'H';
  if (best === 'H' && !v.soft && v.total >= 12 && v.total <= 16) return 'S'; // "don't bust"
  if (best === 'H' && v.soft && v.total === 18) return 'S';
  if (best === 'S' && v.total <= 13 && up >= 2 && up <= 6) return 'H';
  const options: Action[] = (['H', 'S'] as Action[]).filter((a) => a !== best && (a !== 'H' || avail.hit));
  return options.length ? pick(rng, options) : best;
}

export function makeBotBrain(getTable: () => StrategyTable | null, rng: RNG): BotBrain {
  return {
    act(table: Table, seat: Seat, hand: PlayerHand, avail: GameAvail): Action {
      const st = getTable();
      const ranks = hand.cards.map((c) => c.rank);
      const up = table.upcard!.rank;
      if (!st) return handValue(ranks).total < 17 && avail.hit ? 'H' : 'S';
      const style = (seat.player?.style ?? 'pro') as BotStyle;
      let action: Action;
      if (style === 'counter') {
        action = gradePlay(st, ranks, up, avail, tableTrueCount(table), true).action;
      } else {
        action = advise(st, ranks, up, avail).action;
      }
      if (style === 'tourist' && rng() < BOT_STYLES.tourist.errorRate) action = touristMistake(ranks, up, action, avail, rng);
      const legal = action === 'H' ? avail.hit : action === 'D' ? avail.double : action === 'P' ? avail.split : action === 'R' ? avail.surrender : true;
      return legal ? action : avail.hit && handValue(ranks).total < 12 ? 'H' : 'S';
    },
    insurance(table: Table, seat: Seat): boolean {
      const style = (seat.player?.style ?? 'pro') as BotStyle;
      if (style === 'counter') return gradeInsurance(tableTrueCount(table), true, table.rules).take;
      if (style === 'tourist') return rng() < 0.3;
      return false;
    },
    earlySurrender(table: Table, seat: Seat, hand: PlayerHand): boolean {
      const st = getTable();
      if (!st || seat.player?.style === 'tourist') return false;
      const ranks = hand.cards.map((c) => c.rank);
      return advise(st, ranks, table.upcard!.rank, { double: true, split: true, surrender: true }).action === 'R';
    },
  };
}

/** Bet for a bot this round, in table-minimum units. */
export function botBet(player: Player, table: Table, rng: RNG): number {
  const unit = table.minBet;
  const style = (player.style ?? 'pro') as BotStyle;
  let units: number;
  if (style === 'counter') {
    const tc = Math.floor(tableTrueCount(table));
    units = tc <= 1 ? 1 : Math.min(8, 2 * (tc - 1));
  } else if (style === 'tourist') {
    units = pick(rng, [1, 1, 2, 2, 3, 5]);
  } else {
    units = pick(rng, [1, 1, 1, 2]);
  }
  return Math.min(table.maxBet, units * unit);
}

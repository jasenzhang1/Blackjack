/**
 * The opponent's strategy at the play table. For any state and any hole cards it returns the
 * probability of folding, checking/calling and betting/raising. The bots play by sampling from it,
 * and the coach uses the same function to update the opponent's range after every action
 * (Bayes' rule: each combo's weight is multiplied by the probability it takes the action seen).
 */
import { classOf } from './ranges';
import { handGroup } from './analysis';
import { cardCode, type HCard } from './cards';
import { PERCENTILE, POSTFLOP_ORDER, type Pos } from './preflop';
import type { HandGroup, Profile, ProfileId } from './profiles';
import { BB, legal, totalPot, type HandState } from './table';

export interface Dist {
  fold: number;
  passive: number;
  aggressive: number;
  /** Street total for a bet or raise. */
  raiseTo: number;
}

export type ActionClass = 'fold' | 'passive' | 'aggressive';

/** Position multipliers on a player's PFR for raising first in. */
const OPEN_MULT: Record<Pos, number> = { UTG: 0.75, HJ: 0.95, CO: 1.35, BTN: 2.2, SB: 1.9, BB: 1 };

/** Postflop bet size as a fraction of the pot. */
const BET_SIZE: Record<ProfileId, number> = { nit: 0.5, tag: 0.66, lag: 0.75, station: 0.5, maniac: 1 };

/** Response to a bet: probabilities of raising and calling, against a two-thirds-pot bet. */
const RESPOND: Record<ProfileId, Record<HandGroup, { r: number; c: number }>> = {
  nit: { monster: { r: 0.35, c: 0.65 }, top: { r: 0.05, c: 0.8 }, weak: { r: 0, c: 0.3 }, draw: { r: 0.05, c: 0.45 }, air: { r: 0, c: 0.05 } },
  tag: { monster: { r: 0.4, c: 0.6 }, top: { r: 0.1, c: 0.85 }, weak: { r: 0, c: 0.5 }, draw: { r: 0.2, c: 0.6 }, air: { r: 0.08, c: 0.1 } },
  lag: { monster: { r: 0.45, c: 0.55 }, top: { r: 0.15, c: 0.8 }, weak: { r: 0.05, c: 0.6 }, draw: { r: 0.3, c: 0.6 }, air: { r: 0.15, c: 0.15 } },
  station: { monster: { r: 0.15, c: 0.85 }, top: { r: 0.02, c: 0.98 }, weak: { r: 0, c: 0.9 }, draw: { r: 0, c: 0.85 }, air: { r: 0, c: 0.35 } },
  maniac: { monster: { r: 0.55, c: 0.45 }, top: { r: 0.3, c: 0.65 }, weak: { r: 0.15, c: 0.65 }, draw: { r: 0.4, c: 0.5 }, air: { r: 0.3, c: 0.25 } },
};

/** Response after being raised (they bet, you raised): probabilities of re-raising all-in and calling. */
const VS_RAISE: Record<ProfileId, Record<HandGroup, { r: number; c: number }>> = {
  nit: { monster: { r: 0.5, c: 0.5 }, top: { r: 0, c: 0.35 }, weak: { r: 0, c: 0.1 }, draw: { r: 0, c: 0.2 }, air: { r: 0, c: 0 } },
  tag: { monster: { r: 0.5, c: 0.5 }, top: { r: 0.05, c: 0.5 }, weak: { r: 0, c: 0.2 }, draw: { r: 0.1, c: 0.35 }, air: { r: 0.03, c: 0.02 } },
  lag: { monster: { r: 0.55, c: 0.45 }, top: { r: 0.1, c: 0.6 }, weak: { r: 0.03, c: 0.35 }, draw: { r: 0.25, c: 0.4 }, air: { r: 0.12, c: 0.08 } },
  station: { monster: { r: 0.2, c: 0.8 }, top: { r: 0, c: 0.9 }, weak: { r: 0, c: 0.7 }, draw: { r: 0, c: 0.6 }, air: { r: 0, c: 0.2 } },
  maniac: { monster: { r: 0.6, c: 0.4 }, top: { r: 0.3, c: 0.6 }, weak: { r: 0.12, c: 0.5 }, draw: { r: 0.35, c: 0.45 }, air: { r: 0.25, c: 0.15 } },
};

/** Memoised hand groups for one board (computing draws for ~1,000 combos is the slow part). */
export function groupCache(): (a: HCard, b: HCard, board: readonly HCard[]) => HandGroup {
  let key = '';
  let m = new Map<number, HandGroup>();
  return (a, b, board) => {
    const k = board.map(cardCode).join('');
    if (k !== key) {
      key = k;
      m = new Map();
    }
    const id = a < b ? a * 64 + b : b * 64 + a;
    let g = m.get(id);
    if (!g) {
      g = handGroup(a, b, board);
      m.set(id, g);
    }
    return g;
  };
}

const defaultGroups = groupCache();

function inPosition(s: HandState): boolean {
  return POSTFLOP_ORDER.indexOf(s.players.villain.pos) > POSTFLOP_ORDER.indexOf(s.players.hero.pos);
}

function mk(fold: number, passive: number, aggressive: number, raiseTo: number, canRaise: boolean): Dist {
  if (!canRaise) {
    passive += aggressive;
    aggressive = 0;
  }
  return { fold, passive, aggressive, raiseTo };
}

/** Opening threshold (share of hands raised first in) for a profile in a position. */
export const openShare = (p: Profile, pos: Pos): number => Math.min(0.95, (p.stats.pfr / 100) * OPEN_MULT[pos]);

function preflop(s: HandState, p: Profile, a: HCard, b: HCard): Dist {
  const pct = PERCENTILE.get(classOf(a, b).label)!;
  const v = s.players.villain;
  const h = s.players.hero;
  const L = legal(s, 'villain');
  const st = p.stats;
  const yes = (x: boolean) => (x ? 1 : 0);
  const clampTo = (x: number) => Math.max(L.minTo, Math.min(L.maxTo, Math.round(x)));

  if (s.raises === 0) {
    if (L.toCall === 0) {
      // Big blind facing a limp (or a completed small blind): raise to isolate or check.
      const r = yes(pct < st.pfr / 100);
      return mk(0, 1 - r, r, clampTo(4 * BB + h.street), L.canRaise);
    }
    if (h.voluntary) {
      // Facing a limp from an earlier seat.
      const r = yes(pct < openShare(p, v.pos));
      const c = r ? 0 : yes(st.vpip - st.pfr >= 15 && pct < (st.vpip / 100) * 0.8);
      return mk(1 - r - c, c, r, clampTo(5 * BB), L.canRaise);
    }
    // First in.
    const openW = openShare(p, v.pos);
    const limpW = st.vpip - st.pfr >= 15 ? Math.min(0.95, (st.vpip / 100) * OPEN_MULT[v.pos] * 0.8) : 0;
    const r = yes(pct < openW);
    const c = r ? 0 : yes(pct < limpW);
    return mk(1 - r - c, c, r, clampTo(v.pos === 'SB' ? 3 * BB : 2.5 * BB), L.canRaise);
  }

  const bigBet = L.toCall >= 20 * BB;
  if (s.raises === 1 && !bigBet) {
    const tb = (st.threeBet / 100) * (v.pos === 'SB' || v.pos === 'BB' ? 1.1 : 1);
    const callW = tb + ((st.vpip - st.pfr) / 100) * 1.6 + (v.pos === 'BB' ? 0.12 : 0);
    const r = yes(pct < tb);
    const c = r ? 0 : yes(pct < callW);
    return mk(1 - r - c, c, r, clampTo(s.bet * (inPosition(s) ? 3 : 4)), L.canRaise);
  }
  if (s.raises === 2 && !bigBet) {
    const fourW = p.id === 'maniac' ? 0.06 : p.id === 'lag' ? 0.04 : 0.025;
    const callW = fourW + Math.max(0.05, openShare(p, v.pos) * (p.id === 'station' ? 0.8 : 0.4));
    const r = yes(pct < fourW);
    const c = r ? 0 : yes(pct < callW);
    return mk(1 - r - c, c, r, clampTo(s.bet * 2.3), L.canRaise);
  }
  // Facing a 4-bet, 5-bet or a big jam.
  const jamW = p.id === 'maniac' ? 0.06 : p.id === 'lag' ? 0.035 : 0.025;
  const r = yes(pct < jamW);
  const c = r ? 0 : yes(pct < jamW * 1.4 + (p.id === 'station' ? 0.02 : 0));
  return mk(1 - r - c, c, r, L.maxTo, L.canRaise);
}

function postflop(s: HandState, p: Profile, group: HandGroup): Dist {
  const v = s.players.villain;
  const L = legal(s, 'villain');
  const P = totalPot(s);
  const allInIfBig = (to: number) => (to >= 0.6 * L.maxTo ? L.maxTo : Math.max(L.minTo, Math.min(L.maxTo, Math.round(to))));
  if (L.toCall === 0) {
    const bp = p.betProb[group];
    return mk(0, 1 - bp, bp, allInIfBig(Math.max(BB, BET_SIZE[p.id] * P)), L.canRaise);
  }
  const frac = L.toCall / Math.max(1, P - L.toCall);
  const facingRaise = v.street > 0;
  let { r, c } = (facingRaise ? VS_RAISE : RESPOND)[p.id][group];
  // Bigger bets get fewer calls from weak hands, draws and air.
  if (group === 'weak' || group === 'draw' || group === 'air') c = Math.max(0, c - 0.3 * (frac - 0.66));
  else if (group === 'top') c = Math.max(facingRaise ? 0.1 : 0.2, c - 0.15 * (frac - 0.66));
  c = Math.min(c, 1 - r);
  return mk(1 - r - c, c, r, facingRaise ? L.maxTo : allInIfBig(s.bet * 3), L.canRaise);
}

/** The opponent's action probabilities with hole cards a, b in state s (opponent to act). */
export function villainDist(s: HandState, p: Profile, a: HCard, b: HCard, groups = defaultGroups): Dist {
  if (s.street === 'preflop') return preflop(s, p, a, b);
  return postflop(s, p, groups(a, b, s.board));
}

export function sampleAction(d: Dist, u: number): ActionClass {
  if (u < d.fold) return 'fold';
  if (u < d.fold + d.passive) return 'passive';
  return 'aggressive';
}

export interface RangeCombo {
  a: HCard;
  b: HCard;
  w: number;
}

/** Every two-card combo the opponent can hold, given the cards hero sees. */
export function initialRange(dead: readonly HCard[]): RangeCombo[] {
  const d = new Set(dead);
  const out: RangeCombo[] = [];
  for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) if (!d.has(a) && !d.has(b)) out.push({ a, b, w: 1 });
  return out;
}

/** Bayes update after the opponent takes an action class in state s (before the action). */
export function updateRange(range: readonly RangeCombo[], s: HandState, p: Profile, act: ActionClass, groups = defaultGroups): RangeCombo[] {
  const out: RangeCombo[] = [];
  for (const c of range) {
    const w = c.w * villainDist(s, p, c.a, c.b, groups)[act];
    if (w > 1e-9) out.push({ a: c.a, b: c.b, w });
  }
  return out;
}

/** Removes combos that use cards now on the board. */
export function pruneRange(range: readonly RangeCombo[], board: readonly HCard[]): RangeCombo[] {
  const d = new Set(board);
  return range.filter((c) => !d.has(c.a) && !d.has(c.b));
}

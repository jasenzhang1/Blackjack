/**
 * Heads-up no-limit hold'em hand engine for the play table. Six seats are dealt in, but the four
 * players not in the hand fold when the action reaches them, so every hand is you against one
 * opponent. Blinds posted by folded seats stay in the pot as dead money.
 *
 * The state is immutable: `apply` returns a new state, so the coach can try hypothetical actions.
 */
import { shuffle, type RNG } from '../engine/rng';
import { fullDeck, type HCard } from './cards';
import { evaluate } from './evaluate';
import { POSITIONS, POSTFLOP_ORDER, type Pos } from './preflop';

export type Seat = 'hero' | 'villain';
export type Street = 'preflop' | 'flop' | 'turn' | 'river';
export const STREETS: readonly Street[] = ['preflop', 'flop', 'turn', 'river'];

export const SB = 1;
export const BB = 2;
export const START_STACK = 200;

export interface PlayerState {
  seat: Seat;
  pos: Pos;
  hole: HCard[];
  stack: number;
  /** Chips put in on the current street. */
  street: number;
  /** Chips put in this hand. */
  total: number;
  folded: boolean;
  /** Has acted on this street since the last raise. */
  acted: boolean;
  /** Has made a voluntary action this hand. */
  voluntary: boolean;
}

export type ActKind = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface LogEntry {
  seat: Seat;
  street: Street;
  kind: ActKind;
  /** Chips added by this action. */
  add: number;
  /** For bets and raises: the street total raised to. */
  to: number;
  allIn: boolean;
  /** Pot (all chips in) before the action. */
  potBefore: number;
}

export interface HandState {
  players: Record<Seat, PlayerState>;
  board: HCard[];
  deck: HCard[];
  street: Street;
  /** Chips from earlier streets plus dead blinds. */
  pot: number;
  dead: number;
  /** Highest street investment. */
  bet: number;
  /** Minimum raise increment. */
  minRaise: number;
  /** Bets and raises on this street (preflop: the open counts as 1). */
  raises: number;
  toAct: Seat | null;
  log: LogEntry[];
  over: boolean;
  winner: Seat | 'split' | null;
  showdown: boolean;
  /** Hero's net result for the hand, once over. */
  heroNet: number;
}

export const other = (s: Seat): Seat => (s === 'hero' ? 'villain' : 'hero');

export function totalPot(s: HandState): number {
  return s.pot + s.players.hero.street + s.players.villain.street;
}

function clone(s: HandState): HandState {
  return { ...s, players: { hero: { ...s.players.hero }, villain: { ...s.players.villain } }, board: [...s.board], log: [...s.log] };
}

function firstToAct(s: HandState): Seat {
  const order = s.street === 'preflop' ? POSITIONS : POSTFLOP_ORDER;
  return order.indexOf(s.players.hero.pos) < order.indexOf(s.players.villain.pos) ? 'hero' : 'villain';
}

/** Deals a new hand. `deck` can be supplied for tests. */
export function newHand(rand: RNG, heroPos: Pos, villainPos: Pos, deck?: HCard[]): HandState {
  const d = deck ? [...deck] : shuffle(fullDeck(), rand);
  const mk = (seat: Seat, pos: Pos, hole: HCard[]): PlayerState => ({ seat, pos, hole, stack: START_STACK, street: 0, total: 0, folded: false, acted: false, voluntary: false });
  const s: HandState = {
    players: { hero: mk('hero', heroPos, [d[0], d[1]]), villain: mk('villain', villainPos, [d[2], d[3]]) },
    board: [],
    deck: d.slice(4),
    street: 'preflop',
    pot: 0,
    dead: 0,
    bet: BB,
    minRaise: BB,
    raises: 0,
    toAct: null,
    log: [],
    over: false,
    winner: null,
    showdown: false,
    heroNet: 0,
  };
  for (const [pos, amt] of [
    ['SB', SB],
    ['BB', BB],
  ] as const) {
    const p = [s.players.hero, s.players.villain].find((x) => x.pos === pos);
    if (p) {
      p.stack -= amt;
      p.street = amt;
      p.total = amt;
    } else s.dead += amt;
  }
  s.pot = s.dead;
  s.toAct = firstToAct(s);
  return s;
}

export interface Legal {
  toCall: number;
  canCheck: boolean;
  canRaise: boolean;
  minTo: number;
  maxTo: number;
}

export function legal(s: HandState, seat: Seat): Legal {
  const p = s.players[seat];
  const o = s.players[other(seat)];
  const toCall = Math.min(s.bet - p.street, p.stack);
  const maxTo = Math.min(p.street + p.stack, o.folded ? p.street + p.stack : o.street + o.stack);
  // Folded to you preflop: you may still open (and take the pot).
  const canRaise = o.folded ? s.street === 'preflop' && p.stack > toCall : o.stack > 0 && maxTo > s.bet;
  return { toCall, canCheck: toCall === 0, canRaise, minTo: Math.min(s.bet + s.minRaise, maxTo), maxTo };
}

export interface Move {
  kind: ActKind;
  /** For bets and raises: street total to raise to. */
  to?: number;
}

function finish(s: HandState, winner: Seat | 'split'): void {
  const pot = totalPot(s);
  s.pot = pot;
  s.players.hero.street = 0;
  s.players.villain.street = 0;
  s.over = true;
  s.toAct = null;
  s.winner = winner;
  const heroGets = winner === 'hero' ? pot : winner === 'split' ? pot / 2 : 0;
  s.heroNet = heroGets - s.players.hero.total;
}

function showdown(s: HandState): void {
  while (s.board.length < 5) s.board.push(s.deck.shift()!);
  const h = evaluate([...s.players.hero.hole, ...s.board]);
  const v = evaluate([...s.players.villain.hole, ...s.board]);
  s.showdown = true;
  finish(s, h > v ? 'hero' : h < v ? 'villain' : 'split');
}

function nextStreet(s: HandState): void {
  s.pot = totalPot(s);
  for (const p of [s.players.hero, s.players.villain]) {
    p.street = 0;
    p.acted = false;
  }
  s.bet = 0;
  s.minRaise = BB;
  s.raises = 0;
  const i = STREETS.indexOf(s.street);
  s.street = STREETS[i + 1];
  const n = s.street === 'flop' ? 3 : 1;
  for (let k = 0; k < n; k++) s.board.push(s.deck.shift()!);
  s.toAct = firstToAct(s);
}

/** Applies a move for the player to act and returns the new state. */
export function apply(prev: HandState, move: Move): HandState {
  if (prev.over || !prev.toAct) throw new Error('Hand is over');
  const s = clone(prev);
  const seat = s.toAct!;
  const p = s.players[seat];
  const o = s.players[other(seat)];
  const L = legal(prev, seat);
  const potBefore = totalPot(s);
  const entry = (kind: ActKind, add: number, to: number) => s.log.push({ seat, street: s.street, kind, add, to, allIn: p.stack === 0 && kind !== 'fold' && kind !== 'check', potBefore });

  if (move.kind === 'fold') {
    p.folded = true;
    p.acted = true;
    entry('fold', 0, 0);
    // The other player still gets a decision preflop if they have not acted and owe chips
    // (e.g. folded to you on the button): any action but folding then wins the pot.
    if (seat === 'villain' && s.street === 'preflop' && !o.acted && o.street < s.bet) {
      s.toAct = o.seat;
      return s;
    }
    finish(s, o.seat);
    return s;
  }

  if (o.folded) {
    // Only this player is left: they take the pot whatever they do (an uncalled raise comes back).
    p.acted = true;
    p.voluntary = true;
    entry(move.kind === 'check' ? 'check' : 'call', 0, 0);
    finish(s, seat);
    return s;
  }

  if (move.kind === 'check') {
    if (!L.canCheck) throw new Error('Cannot check');
    p.acted = true;
    entry('check', 0, 0);
  } else if (move.kind === 'call') {
    const add = L.toCall;
    p.stack -= add;
    p.street += add;
    p.total += add;
    p.acted = true;
    p.voluntary = true;
    entry('call', add, p.street);
  } else {
    if (!L.canRaise) throw new Error('Cannot raise');
    const to = Math.max(L.minTo, Math.min(L.maxTo, Math.round(move.to ?? L.minTo)));
    const add = to - p.street;
    const inc = to - s.bet;
    if (inc >= s.minRaise) s.minRaise = inc;
    p.stack -= add;
    p.street = to;
    p.total += add;
    p.acted = true;
    p.voluntary = true;
    s.bet = to;
    s.raises++;
    o.acted = false;
    entry(s.bet === to && prev.bet === 0 ? 'bet' : 'raise', add, to);
  }

  // Is the street over?
  const settled = [p, o].every((x) => x.stack === 0 || (x.acted && x.street === s.bet));
  if (!settled) {
    s.toAct = o.seat;
    return s;
  }
  if (p.stack === 0 || o.stack === 0 || s.street === 'river') {
    s.pot = totalPot(s);
    p.street = 0;
    o.street = 0;
    showdown(s);
    return s;
  }
  nextStreet(s);
  return s;
}

/** Hero's voluntary preflop situation, in the terms the preflop charts use. */
export type PreflopSpot =
  | { kind: 'rfi'; hero: Pos }
  | { kind: 'vsLimp'; hero: Pos; villain: Pos }
  | { kind: 'vsOpen'; hero: Pos; opener: Pos }
  | { kind: 'vs3bet'; hero: Pos; villain: Pos }
  | { kind: 'vs4bet'; hero: Pos; villain: Pos }
  | { kind: 'walk' };

export function preflopSpot(s: HandState): PreflopSpot {
  const hero = s.players.hero;
  const vil = s.players.villain;
  const raisesBy = (seat: Seat) => s.log.filter((e) => e.street === 'preflop' && e.seat === seat && (e.kind === 'raise' || e.kind === 'bet')).length;
  const vr = raisesBy('villain');
  const hr = raisesBy('hero');
  if (vil.folded || (!vil.voluntary && vr === 0 && hr === 0)) {
    if (hero.pos === 'BB' && hero.street >= s.bet) return { kind: 'walk' };
    return { kind: 'rfi', hero: hero.pos };
  }
  if (vr === 0) return { kind: 'vsLimp', hero: hero.pos, villain: vil.pos };
  if (hr === 0) return { kind: 'vsOpen', hero: hero.pos, opener: vil.pos };
  if (hr === 1 && vr === 1 && s.log.find((e) => e.street === 'preflop' && (e.kind === 'raise' || e.kind === 'bet'))?.seat === 'hero') return { kind: 'vs3bet', hero: hero.pos, villain: vil.pos };
  return { kind: 'vs4bet', hero: hero.pos, villain: vil.pos };
}

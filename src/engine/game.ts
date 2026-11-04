/**
 * Blackjack table simulator: a step-driven state machine shared by the Table Trainer, Watch & Count,
 * Count & Play and the Casino. Every automatic event (one card dealt, one bot decision, one dealer
 * draw) is a separate `step()` so the UI can animate at any speed and pause for the human.
 */
import { buildShoe, type Card, type Rank } from './cards';
import type { Action } from './ev';
import { handValue, isBlackjack } from './hand';
import { canDoubleTotal, tableDecks, type Rules } from './rules';
import { shuffle, type RNG } from './rng';
import type { Availability } from './strategy';

export type HandResult = 'blackjack' | 'win' | 'push' | 'lose' | 'bust' | 'surrender';

export interface PlayerHand {
  cards: Card[];
  /** Money currently wagered on this hand (doubled hands hold twice the original). */
  bet: number;
  doubled: boolean;
  fromSplit: boolean;
  splitAces: boolean;
  done: boolean;
  surrendered: boolean;
  result: HandResult | null;
  /** Net win (+) or loss (−) of this hand after settlement. */
  net: number;
}

export interface Player {
  id: string;
  name: string;
  kind: 'human' | 'bot';
  bankroll: number;
  avatar?: string;
  /** Bot personality id (see bots.ts). */
  style?: string;
}

export interface Seat {
  index: number;
  player: Player | null;
  /** Main bet for the next/current round. */
  bet: number;
  hands: PlayerHand[];
  insurance: number;
  insuranceDecided: boolean;
  insuranceNet: number;
  earlyDecided: boolean;
}

export type Phase = 'betting' | 'dealing' | 'insurance' | 'early' | 'peek' | 'playing' | 'dealer' | 'settling' | 'done';

export type GameEvent =
  | { type: 'shuffle' }
  | { type: 'deal'; to: 'dealer' | number; hand: number; card: Card; faceUp: boolean }
  | { type: 'reveal'; card: Card }
  | { type: 'insurance'; seat: number; take: boolean; amount: number }
  | { type: 'early'; seat: number; surrender: boolean }
  | { type: 'peek'; blackjack: boolean }
  | { type: 'action'; seat: number; hand: number; action: Action; card?: Card }
  | { type: 'dealerDraw'; card: Card }
  | { type: 'settle' };

export interface GameAvail extends Availability {
  hit: boolean;
  stand: boolean;
}

export type Pending =
  | { kind: 'betting' }
  | { kind: 'auto' }
  | { kind: 'insurance'; seat: number }
  | { kind: 'early'; seat: number }
  | { kind: 'action'; seat: number; hand: number; avail: GameAvail }
  | { kind: 'done' };

export interface BotBrain {
  act(table: Table, seat: Seat, hand: PlayerHand, avail: GameAvail): Action;
  insurance(table: Table, seat: Seat): boolean;
  earlySurrender(table: Table, seat: Seat, hand: PlayerHand): boolean;
}

export interface TableOptions {
  rules: Rules;
  seats: number;
  rng: RNG;
  minBet?: number;
  maxBet?: number;
}

const ranksOf = (cards: readonly Card[]): Rank[] => cards.map((c) => c.rank);

export function dealerMustDraw(cards: readonly Card[], rules: Rules): boolean {
  const v = handValue(ranksOf(cards));
  return v.total < 17 || (v.total === 17 && v.soft && rules.hitSoft17);
}

export class Table {
  rules: Rules;
  rng: RNG;
  shoe: Card[] = [];
  discards: Card[] = [];
  shoeSize = 0;
  /** Shuffle at the end of the round once this many cards (or fewer) remain. */
  cutRemaining = 0;
  /** Increments on every shuffle (counting UIs reset when it changes). */
  shoeId = 0;
  dealer: Card[] = [];
  holeRevealed = false;
  seats: Seat[];
  phase: Phase = 'betting';
  turn: { seat: number; hand: number } | null = null;
  roundId = 0;
  /** Face-up cards since the last shuffle, in the order they became visible. */
  revealed: Card[] = [];
  events: GameEvent[] = [];
  botBrain: BotBrain | null = null;
  minBet: number;
  maxBet: number;
  private dealQueue: ('up' | 'hole' | number)[] = [];
  private rigged: Rank[] = [];

  constructor(opts: TableOptions) {
    this.rules = opts.rules;
    this.rng = opts.rng;
    this.minBet = opts.minBet ?? 10;
    this.maxBet = opts.maxBet ?? 1000;
    this.seats = Array.from({ length: opts.seats }, (_, i) => ({
      index: i,
      player: null,
      bet: 0,
      hands: [],
      insurance: 0,
      insuranceDecided: false,
      insuranceNet: 0,
      earlyDecided: false,
    }));
    this.newShoe();
  }

  /** Continuous shuffling (infinite-deck rules): reshuffle every round. */
  get csm(): boolean {
    return !Number.isFinite(this.rules.decks);
  }

  setRules(rules: Rules): void {
    const reshuffle = tableDecks(rules) !== tableDecks(this.rules) || rules.penetration !== this.rules.penetration;
    this.rules = rules;
    if (reshuffle && this.phase === 'betting') this.newShoe();
  }

  newShoe(): void {
    const decks = tableDecks(this.rules);
    this.shoe = shuffle(buildShoe(decks, this.shoeId * 1000), this.rng);
    this.shoeSize = this.shoe.length;
    this.discards = [];
    this.revealed = [];
    this.cutRemaining = Math.round(this.shoeSize * (1 - this.rules.penetration));
    this.shoeId++;
    this.events.push({ type: 'shuffle' });
  }

  /** Cards not yet seen by the players (shoe + face-down hole card). */
  cardsUnseen(): number {
    const hole = this.dealer.length >= 2 && !this.holeRevealed ? 1 : 0;
    return this.shoe.length + hole;
  }

  /** Forces the next cards drawn (in order). Used by the trainer to deal specific hands. */
  rig(ranks: Rank[]): void {
    this.rigged = ranks.slice();
  }

  private draw(): Card {
    if (this.rigged.length) {
      const want = this.rigged.shift()!;
      // Take a *uniformly random* card of the wanted rank. (Taking the topmost one would bias the
      // cards above it — they would be guaranteed not to be that rank — and skew the next draws.)
      const idx: number[] = [];
      for (let i = 0; i < this.shoe.length; i++) if (this.shoe[i].rank === want) idx.push(i);
      if (idx.length) return this.shoe.splice(idx[Math.floor(this.rng() * idx.length)], 1)[0];
    }
    if (this.shoe.length === 0) {
      // Emergency reshuffle of the discards (only with very deep penetration and a full table).
      this.shoe = shuffle(this.discards, this.rng);
      this.discards = [];
      this.revealed = [];
      this.shoeId++;
      this.events.push({ type: 'shuffle' });
    }
    return this.shoe.pop()!;
  }

  private reveal(card: Card): void {
    this.revealed.push(card);
  }

  sit(index: number, player: Player | null): void {
    this.seats[index].player = player;
    this.seats[index].bet = 0;
  }

  activeSeats(): Seat[] {
    return this.seats.filter((s) => s.player && s.hands.length > 0);
  }

  placeBet(index: number, amount: number): boolean {
    const seat = this.seats[index];
    if (!seat.player || this.phase !== 'betting') return false;
    if (amount !== 0 && (amount < this.minBet || amount > this.maxBet)) return false;
    if (amount > seat.player.bankroll) return false;
    seat.bet = amount;
    return true;
  }

  canStart(): boolean {
    return this.phase === 'betting' && this.seats.some((s) => s.player && s.bet > 0);
  }

  startRound(): void {
    if (!this.canStart()) throw new Error('No bets placed');
    if (this.csm || this.shoe.length <= this.cutRemaining) this.newShoe();
    this.events = [];
    this.roundId++;
    this.dealer = [];
    this.holeRevealed = false;
    this.turn = null;
    const active: number[] = [];
    for (const s of this.seats) {
      s.hands = [];
      s.insurance = 0;
      s.insuranceNet = 0;
      s.insuranceDecided = false;
      s.earlyDecided = false;
      if (s.player && s.bet > 0) {
        s.player.bankroll -= s.bet;
        s.hands = [this.newHand(s.bet)];
        active.push(s.index);
      }
    }
    this.dealQueue = [...active, 'up', ...active];
    if (this.rules.dealerPeeks) this.dealQueue.push('hole');
    this.phase = 'dealing';
  }

  private newHand(bet: number): PlayerHand {
    return { cards: [], bet, doubled: false, fromSplit: false, splitAces: false, done: false, surrendered: false, result: null, net: 0 };
  }

  get upcard(): Card | undefined {
    return this.dealer[0];
  }

  availability(seat: Seat, hand: PlayerHand): GameAvail {
    const r = this.rules;
    const ranks = ranksOf(hand.cards);
    const v = handValue(ranks);
    const two = hand.cards.length === 2;
    const bankroll = seat.player?.bankroll ?? 0;
    const oneCardAce = hand.splitAces && !r.hitSplitAces;
    const pair = two && ranks[0] === ranks[1];
    const split = pair && seat.hands.length < r.maxSplitHands && (!hand.splitAces || r.resplitAces) && bankroll >= hand.bet;
    const double = two && !oneCardAce && canDoubleTotal(r, v.total, v.soft) && (!hand.fromSplit || r.doubleAfterSplit) && bankroll >= hand.bet && v.total < 21;
    const up = this.upcard?.rank;
    const earlyOnly = r.surrender === 'early' && (up === 1 || up === 10);
    const surrender = two && !hand.fromSplit && seat.hands.length === 1 && r.surrender !== 'none' && !earlyOnly;
    return { hit: !oneCardAce && v.total < 21, stand: true, double, split, surrender };
  }

  pending(): Pending {
    switch (this.phase) {
      case 'betting':
        return { kind: 'betting' };
      case 'insurance': {
        const s = this.seats.find((x) => x.hands.length && !x.insuranceDecided);
        if (s && s.player?.kind === 'human') return { kind: 'insurance', seat: s.index };
        return { kind: 'auto' };
      }
      case 'early': {
        const s = this.seats.find((x) => x.hands.length && !x.earlyDecided);
        if (s && s.player?.kind === 'human') return { kind: 'early', seat: s.index };
        return { kind: 'auto' };
      }
      case 'playing': {
        const t = this.turn;
        if (!t) return { kind: 'auto' };
        const seat = this.seats[t.seat];
        const hand = seat.hands[t.hand];
        if (hand.cards.length < 2 || hand.done || seat.player?.kind !== 'human') return { kind: 'auto' };
        return { kind: 'action', seat: t.seat, hand: t.hand, avail: this.availability(seat, hand) };
      }
      case 'done':
        return { kind: 'done' };
      default:
        return { kind: 'auto' };
    }
  }

  /** Performs one automatic step. Returns null if the table is waiting for the human. */
  step(): GameEvent | null {
    switch (this.phase) {
      case 'dealing':
        return this.stepDeal();
      case 'insurance': {
        const s = this.seats.find((x) => x.hands.length && !x.insuranceDecided);
        if (!s) {
          this.afterInsurance();
          return this.step();
        }
        if (s.player?.kind === 'human') return null;
        return this.decideInsurance(s.index, this.botBrain?.insurance(this, s) ?? false);
      }
      case 'early': {
        const s = this.seats.find((x) => x.hands.length && !x.earlyDecided);
        if (!s) {
          this.phase = 'peek';
          return this.step();
        }
        if (s.player?.kind === 'human') return null;
        return this.decideEarly(s.index, this.botBrain?.earlySurrender(this, s, s.hands[0]) ?? false);
      }
      case 'peek':
        return this.stepPeek();
      case 'playing':
        return this.stepPlay();
      case 'dealer':
        return this.stepDealer();
      case 'settling':
        return this.settle();
      default:
        return null;
    }
  }

  private push(e: GameEvent): GameEvent {
    this.events.push(e);
    return e;
  }

  private stepDeal(): GameEvent {
    const target = this.dealQueue.shift()!;
    const card = this.draw();
    let ev: GameEvent;
    if (target === 'up') {
      this.dealer.push(card);
      this.reveal(card);
      ev = { type: 'deal', to: 'dealer', hand: 0, card, faceUp: true };
    } else if (target === 'hole') {
      this.dealer.push(card);
      ev = { type: 'deal', to: 'dealer', hand: 0, card, faceUp: false };
    } else {
      this.seats[target].hands[0].cards.push(card);
      this.reveal(card);
      ev = { type: 'deal', to: target, hand: 0, card, faceUp: true };
    }
    if (this.dealQueue.length === 0) this.afterDeal();
    return this.push(ev);
  }

  private afterDeal(): void {
    if (this.upcard!.rank === 1) {
      this.phase = 'insurance';
      for (const s of this.seats) s.insuranceDecided = s.hands.length === 0;
    } else this.afterInsurance();
  }

  private afterInsurance(): void {
    const up = this.upcard!.rank;
    if (this.rules.surrender === 'early' && (up === 1 || up === 10)) {
      this.phase = 'early';
      for (const s of this.seats) s.earlyDecided = s.hands.length === 0 || isBlackjack(ranksOf(s.hands[0].cards));
    } else this.phase = 'peek';
  }

  decideInsurance(index: number, take: boolean): GameEvent {
    const s = this.seats[index];
    let amount = 0;
    if (take && s.player) {
      amount = Math.min(s.bet / 2, s.player.bankroll);
      s.player.bankroll -= amount;
      s.insurance = amount;
    }
    s.insuranceDecided = true;
    if (!this.seats.some((x) => x.hands.length && !x.insuranceDecided)) this.afterInsurance();
    return this.push({ type: 'insurance', seat: index, take: amount > 0, amount });
  }

  decideEarly(index: number, surrender: boolean): GameEvent {
    const s = this.seats[index];
    if (surrender && s.hands[0]) {
      s.hands[0].surrendered = true;
      s.hands[0].done = true;
    }
    s.earlyDecided = true;
    if (!this.seats.some((x) => x.hands.length && !x.earlyDecided)) this.phase = 'peek';
    return this.push({ type: 'early', seat: index, surrender });
  }

  private dealerHasBlackjack(): boolean {
    return this.dealer.length >= 2 && isBlackjack(ranksOf(this.dealer.slice(0, 2)));
  }

  private stepPeek(): GameEvent | null {
    const up = this.upcard!.rank;
    const canBJ = up === 1 || up === 10;
    let ev: GameEvent | null = null;
    if (this.rules.dealerPeeks && canBJ) {
      const bj = this.dealerHasBlackjack();
      ev = this.push({ type: 'peek', blackjack: bj });
      if (bj) {
        this.revealHole();
        this.phase = 'settling';
        return ev;
      }
      for (const s of this.seats) if (s.insurance > 0) s.insuranceNet = -s.insurance;
    }
    for (const s of this.seats) {
      const h = s.hands[0];
      if (h && isBlackjack(ranksOf(h.cards))) h.done = true;
    }
    this.phase = 'playing';
    this.turn = { seat: 0, hand: -1 };
    this.advanceTurn();
    return ev ?? this.step();
  }

  private revealHole(): void {
    if (!this.holeRevealed && this.dealer.length >= 2) {
      this.holeRevealed = true;
      this.reveal(this.dealer[1]);
      this.push({ type: 'reveal', card: this.dealer[1] });
    }
  }

  private advanceTurn(): void {
    let { seat, hand } = this.turn ?? { seat: 0, hand: -1 };
    hand++;
    while (seat < this.seats.length) {
      const s = this.seats[seat];
      while (hand < s.hands.length) {
        if (!s.hands[hand].done) {
          this.turn = { seat, hand };
          return;
        }
        hand++;
      }
      seat++;
      hand = 0;
    }
    this.turn = null;
    this.phase = 'dealer';
  }

  private stepPlay(): GameEvent | null {
    const t = this.turn;
    if (!t) {
      this.phase = 'dealer';
      return this.step();
    }
    const seat = this.seats[t.seat];
    const hand = seat.hands[t.hand];
    if (hand.cards.length < 2) {
      // Second card for a split hand.
      const card = this.draw();
      hand.cards.push(card);
      this.reveal(card);
      const v = handValue(ranksOf(hand.cards));
      if (hand.splitAces && !this.rules.hitSplitAces) {
        const canResplit = card.rank === 1 && this.rules.resplitAces && seat.hands.length < this.rules.maxSplitHands;
        if (!canResplit) hand.done = true;
      }
      if (v.total >= 21) hand.done = true;
      const ev = this.push({ type: 'deal', to: t.seat, hand: t.hand, card, faceUp: true });
      if (hand.done) this.advanceTurn();
      return ev;
    }
    if (hand.done) {
      this.advanceTurn();
      return this.step();
    }
    if (seat.player?.kind === 'human') return null;
    const avail = this.availability(seat, hand);
    const a = this.botBrain ? this.botBrain.act(this, seat, hand, avail) : 'S';
    return this.act(a);
  }

  /** Applies an action to the hand whose turn it is (human or bot). */
  act(action: Action): GameEvent {
    const t = this.turn;
    if (this.phase !== 'playing' || !t) throw new Error('Not in playing phase');
    const seat = this.seats[t.seat];
    const hand = seat.hands[t.hand];
    const avail = this.availability(seat, hand);
    const player = seat.player!;
    let card: Card | undefined;
    const legal = action === 'H' ? avail.hit : action === 'S' ? true : action === 'D' ? avail.double : action === 'P' ? avail.split : avail.surrender;
    if (!legal) action = avail.hit ? 'H' : 'S';

    if (action === 'H' || action === 'D') {
      if (action === 'D') {
        player.bankroll -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
      }
      card = this.draw();
      hand.cards.push(card);
      this.reveal(card);
      const v = handValue(ranksOf(hand.cards));
      if (action === 'D' || v.total >= 21) hand.done = true;
    } else if (action === 'S') {
      hand.done = true;
    } else if (action === 'R') {
      hand.surrendered = true;
      hand.done = true;
    } else if (action === 'P') {
      player.bankroll -= hand.bet;
      const moved = hand.cards.pop()!;
      const aces = moved.rank === 1;
      hand.fromSplit = true;
      hand.splitAces = aces;
      const twin = this.newHand(hand.bet);
      twin.cards = [moved];
      twin.fromSplit = true;
      twin.splitAces = aces;
      seat.hands.splice(t.hand + 1, 0, twin);
    }
    const ev = this.push({ type: 'action', seat: t.seat, hand: t.hand, action, card });
    if (hand.done) this.advanceTurn();
    return ev;
  }

  private liveHands(): PlayerHand[] {
    const out: PlayerHand[] = [];
    for (const s of this.seats) {
      for (const h of s.hands) {
        if (h.surrendered) continue;
        const v = handValue(ranksOf(h.cards));
        if (v.total > 21) continue;
        if (!h.fromSplit && s.hands.length === 1 && isBlackjack(ranksOf(h.cards))) continue;
        out.push(h);
      }
    }
    return out;
  }

  private stepDealer(): GameEvent {
    const live = this.liveHands().length > 0;
    const up = this.upcard!.rank;
    if (!this.rules.dealerPeeks && this.dealer.length === 1) {
      const anyBJ = this.seats.some((s) => s.hands.length === 1 && isBlackjack(ranksOf(s.hands[0].cards)));
      const lateSurrendered = this.rules.surrender === 'late' && this.seats.some((s) => s.hands.some((h) => h.surrendered));
      const bjPossible = up === 1 || up === 10;
      if (live || (bjPossible && (anyBJ || lateSurrendered)) || this.seats.some((s) => s.insurance > 0)) {
        const card = this.draw();
        this.dealer.push(card);
        this.holeRevealed = true;
        this.reveal(card);
        return this.push({ type: 'dealerDraw', card });
      }
      this.phase = 'settling';
      return this.settle();
    }
    if (!this.holeRevealed && this.dealer.length >= 2) {
      this.revealHole();
      return this.events[this.events.length - 1];
    }
    if (live && !this.dealerHasBlackjack() && dealerMustDraw(this.dealer, this.rules)) {
      const card = this.draw();
      this.dealer.push(card);
      this.reveal(card);
      return this.push({ type: 'dealerDraw', card });
    }
    this.phase = 'settling';
    return this.settle();
  }

  private settle(): GameEvent {
    this.revealHole();
    const dealerBJ = this.dealerHasBlackjack();
    const dv = handValue(ranksOf(this.dealer));
    const pays = this.rules.blackjackPays;
    for (const s of this.seats) {
      if (!s.player || !s.hands.length) continue;
      const p = s.player;
      for (const h of s.hands) {
        const v = handValue(ranksOf(h.cards));
        const playerBJ = !h.fromSplit && s.hands.length === 1 && isBlackjack(ranksOf(h.cards));
        if (h.surrendered && dealerBJ && !this.rules.dealerPeeks && this.rules.surrender === 'late') {
          // No hole card + late surrender: a dealer blackjack still takes the whole bet.
          h.result = 'lose';
          h.net = -h.bet;
        } else if (h.surrendered) {
          h.result = 'surrender';
          h.net = -h.bet / 2;
          p.bankroll += h.bet / 2;
        } else if (playerBJ) {
          if (dealerBJ) {
            h.result = 'push';
            h.net = 0;
            p.bankroll += h.bet;
          } else {
            h.result = 'blackjack';
            h.net = h.bet * pays;
            p.bankroll += h.bet + h.net;
          }
        } else if (v.total > 21) {
          h.result = 'bust';
          h.net = -h.bet;
        } else if (dealerBJ) {
          h.result = 'lose';
          h.net = -h.bet;
        } else if (dv.total > 21 || v.total > dv.total) {
          h.result = 'win';
          h.net = h.bet;
          p.bankroll += 2 * h.bet;
        } else if (v.total === dv.total) {
          h.result = 'push';
          h.net = 0;
          p.bankroll += h.bet;
        } else {
          h.result = 'lose';
          h.net = -h.bet;
        }
        h.done = true;
      }
      if (s.insurance > 0) {
        if (dealerBJ) {
          s.insuranceNet = 2 * s.insurance;
          p.bankroll += 3 * s.insurance;
        } else s.insuranceNet = -s.insurance;
      }
    }
    this.phase = 'done';
    this.turn = null;
    return this.push({ type: 'settle' });
  }

  /** Net result of a seat for the round just settled (hands + insurance). */
  seatNet(index: number): number {
    const s = this.seats[index];
    return s.hands.reduce((a, h) => a + h.net, 0) + s.insuranceNet;
  }

  /** Clears the table after a settled round; shuffles if the cut card was reached. */
  endRound(): boolean {
    if (this.phase !== 'done') return false;
    for (const s of this.seats) {
      for (const h of s.hands) this.discards.push(...h.cards);
      s.hands = [];
      s.insurance = 0;
      s.insuranceNet = 0;
      if (s.player && s.bet > s.player.bankroll) s.bet = 0;
    }
    this.discards.push(...this.dealer);
    this.dealer = [];
    this.holeRevealed = false;
    this.phase = 'betting';
    const reshuffle = this.csm || this.shoe.length <= this.cutRemaining;
    if (reshuffle) this.newShoe();
    return reshuffle;
  }

  /**
   * Abandons the round in progress (trainer "decision only" mode): every bet is refunded and the
   * cards go to the discard tray.
   */
  abortRound(): void {
    for (const s of this.seats) {
      if (s.player) s.player.bankroll += s.hands.reduce((a, h) => a + h.bet, 0) + s.insurance;
      for (const h of s.hands) this.discards.push(...h.cards);
      s.hands = [];
      s.insurance = 0;
      s.insuranceNet = 0;
    }
    if (this.dealer[1] && !this.holeRevealed) this.revealed.push(this.dealer[1]);
    this.discards.push(...this.dealer);
    this.dealer = [];
    this.holeRevealed = false;
    this.turn = null;
    this.phase = 'betting';
    if (this.csm || this.shoe.length <= this.cutRemaining) this.newShoe();
  }

  /** Runs automatic steps until the human must act or the round is over. */
  runUntilBlocked(maxSteps = 10_000): void {
    for (let i = 0; i < maxSteps; i++) {
      const p = this.pending();
      if (p.kind !== 'auto') return;
      if (this.step() === null && this.pending().kind === 'auto') return;
    }
  }
}

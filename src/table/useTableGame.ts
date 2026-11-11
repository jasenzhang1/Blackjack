/**
 * React controller around the Table engine, shared by every table mode.
 *
 * Responsibilities: create the table and the bots, run automatic steps with speed-scaled delays,
 * grade the human's decisions (basic strategy or Hi-Lo deviations), compute EV losses (cell EVs or
 * exact EVs for the actual shoe from the worker), trigger count checks, and keep the session log.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { emptyCounts, type Rank } from '../engine/cards';
import { botBet, makeBotBrain, makeBots, tableTrueCount, type BotStyle } from '../engine/bots';
import { getSystem, initialRunningCount, trueCount } from '../engine/counting';
import { gradeInsurance, gradePlay, type Deviation } from '../engine/deviations';
import type { Action, ActionEVs } from '../engine/ev';
import { Table, type GameAvail, type Pending, type Player } from '../engine/game';
import { strategyKey, tableDecks, type Rules } from '../engine/rules';
import { mulberry32, randomSeed } from '../engine/rng';
import { advise, bestOf, cellKey, type StrategyTable } from '../engine/strategy';
import { recordCell } from '../state/progress';
import { engine } from '../worker/client';
import type { Category, CountCheck, Decision, DecisionKind, DecisionRecord, RoundRecord } from './report';

export interface CountCheckSetup {
  frequency: 'off' | 'round' | 'every3' | 'random' | 'shoe';
  askTC: boolean;
}

export interface GameSetup {
  mode: 'trainer' | 'watch' | 'countplay' | 'casino';
  seats: number;
  humanSeat: number | null;
  bots: number;
  botStyles?: BotStyle[];
  bankroll: number;
  minBet: number;
  maxBet: number;
  /** Bet placed automatically for the human each round (trainer). */
  fixedBet?: number;
  /** Trainer: returns the ranks to rig [player1, up, player2, hole] (null = natural deal). */
  rig?: (() => Rank[] | null) | null;
  deviations: boolean;
  countChecks: CountCheckSetup;
  /** Automatically deal the next round (watch mode / trainer auto-advance). */
  autoNext: boolean;
  /** Trainer: grade only the first decision of each hand, then deal the next one. */
  decisionOnly?: boolean;
  /** Ask the worker for exact EVs of the actual shoe at each human decision. */
  exactEV?: boolean;
  countingSystem: string;
}

export interface Graded {
  ok: boolean;
  taken: Decision;
  correct: Decision;
  acceptable: Decision[];
  basic: Decision;
  deviation: Deviation | null;
  reason: string;
  evLoss: number;
  ev: ActionEVs;
  exact: boolean;
  cell: string | null;
  category: Category;
}

export interface Feedback extends Graded {
  id: string;
  kind: DecisionKind;
  cards: Rank[];
  up: Rank;
  tc: number;
  /** Base bet of the hand (money), for expressing the EV cost in dollars. */
  bet: number;
}

export interface CountPrompt {
  round: number;
  rcActual: number;
  tcActual: number | null;
  decksLeft: number;
  reason: string;
}

const PHASE_DELAY: Record<string, number> = {
  dealing: 260,
  insurance: 380,
  early: 380,
  peek: 520,
  playing: 560,
  dealer: 540,
  settling: 260,
};

function shoeCounts(t: Table): number[] {
  const c = emptyCounts();
  for (const card of t.shoe) c[card.rank]++;
  if (t.dealer[1] && !t.holeRevealed) c[t.dealer[1].rank]++;
  return c;
}

export function useTableGame(setup: GameSetup, rules: Rules, strategy: StrategyTable | null, speed: number) {
  const [version, bump] = useReducer((x: number) => x + 1, 0);
  const rngRef = useRef(mulberry32(randomSeed()));
  const strategyRef = useRef(strategy);
  strategyRef.current = strategy;
  const setupRef = useRef(setup);
  setupRef.current = setup;
  const rulesRef = useRef(rules);
  rulesRef.current = rules;

  const setupKey = `${setup.mode}|${setup.seats}|${setup.humanSeat}|${setup.bots}|${(setup.botStyles ?? []).join(',')}|${setup.bankroll}|${setup.minBet}|${setup.maxBet}`;

  const makeTable = useCallback((): Table => {
    const s = setupRef.current;
    const rng = rngRef.current;
    const t = new Table({ rules: rulesRef.current, seats: s.seats, rng, minBet: s.minBet, maxBet: s.maxBet, replacement: s.mode === 'trainer' });
    t.botBrain = makeBotBrain(() => strategyRef.current, rng);
    const bots = makeBots(s.bots, rng, s.botStyles);
    const free = Array.from({ length: s.seats }, (_, i) => i).filter((i) => i !== s.humanSeat);
    // Spread bots around the human.
    bots.forEach((b, i) => t.sit(free[Math.floor((i * free.length) / Math.max(1, bots.length))] ?? free[i], b));
    if (s.humanSeat !== null) {
      const me: Player = { id: 'you', name: 'You', kind: 'human', bankroll: s.bankroll };
      t.sit(s.humanSeat, me);
    }
    return t;
  }, []);

  const tableRef = useRef<Table | null>(null);
  const keyRef = useRef('');
  if (!tableRef.current || keyRef.current !== setupKey) {
    tableRef.current = makeTable();
    keyRef.current = setupKey;
  }
  const t = tableRef.current;

  useEffect(() => {
    t.setRules(rules);
    bump();
  }, [rules, t]);

  const [paused, setPaused] = useState(false);
  const [bet, setBet] = useState(setup.fixedBet ?? setup.minBet);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [countPrompt, setCountPrompt] = useState<CountPrompt | null>(null);
  const [shuffleFlash, setShuffleFlash] = useState(0);
  const [exact, setExact] = useState<{ key: string; ev: ActionEVs } | null>(null);
  const decisions = useRef<DecisionRecord[]>([]);
  const rounds = useRef<RoundRecord[]>([]);
  const checks = useRef<CountCheck[]>([]);
  const roundClosed = useRef(true);
  const roundsSinceCheck = useRef(0);
  const tcAtBet = useRef(0);
  const startedAt = useRef(Date.now());
  const decisionCountThisRound = useRef(0);
  const holdNext = useRef(false);

  // ---- derived counting values ----------------------------------------------------------
  const system = getSystem(setup.countingSystem);
  const runningCount = useMemo(() => {
    let rc = initialRunningCount(system, tableDecks(rules));
    for (const c of t.revealed) rc += system.tags[c.rank];
    return rc;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, system, t]);
  const cardsUnseen = t.cardsUnseen();
  const hiLoTC = tableTrueCount(t);

  const pending: Pending = t.pending();

  // ---- exact EVs for the human's current decision -----------------------------------------
  const decisionKey = pending.kind === 'action' ? `${t.roundId}:${pending.seat}:${pending.hand}:${t.seats[pending.seat].hands[pending.hand].cards.length}` : null;
  useEffect(() => {
    if (!decisionKey || !setup.exactEV || pending.kind !== 'action') return;
    const seat = t.seats[pending.seat];
    const hand = seat.hands[pending.hand];
    const ranks = hand.cards.map((c) => c.rank);
    const up = t.upcard!.rank;
    const shoe = shoeCounts(t);
    shoe[up]++;
    for (const r of ranks) shoe[r]++;
    let alive = true;
    engine
      .exact(rules, shoe, ranks, up, { double: pending.avail.double, split: pending.avail.split, surrender: pending.avail.surrender })
      .then((res) => {
        if (alive) setExact({ key: decisionKey, ev: res.ev });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionKey, setup.exactEV]);

  // ---- grading ---------------------------------------------------------------------------
  const evaluate = useCallback(
    (a: Action): Graded | null => {
      const st = strategyRef.current;
      const p = t.pending();
      if (!st || p.kind !== 'action') return null;
      const seat = t.seats[p.seat];
      const hand = seat.hands[p.hand];
      const ranks = hand.cards.map((c) => c.rank);
      const up = t.upcard!.rank;
      const tc = tableTrueCount(t);
      const avail = p.avail;
      const g = gradePlay(st, ranks, up, avail, tc, setupRef.current.deviations);
      const adv = advise(st, ranks, up, avail);
      let ev: ActionEVs = adv.ev;
      let isExact = false;
      const key = `${t.roundId}:${p.seat}:${p.hand}:${hand.cards.length}`;
      if (exact && exact.key === key) {
        ev = {};
        for (const [k, v] of Object.entries(exact.ev)) {
          const act = k as Action;
          if ((act === 'D' && !avail.double) || (act === 'P' && !avail.split) || (act === 'R' && !avail.surrender)) continue;
          ev[act] = v;
        }
        isExact = true;
      }
      const ok = g.acceptable.includes(a);
      const evLoss = ok ? 0 : Math.max(0, (ev[g.action] ?? ev[bestOf(ev) ?? 'S'] ?? 0) - (ev[a] ?? 0));
      const row = adv.row;
      const category: Category = a === 'R' || g.action === 'R' ? 'surrender' : row?.startsWith('P') ? 'pair' : row?.startsWith('S') ? 'soft' : 'hard';
      return {
        ok,
        taken: a,
        correct: g.action,
        acceptable: g.acceptable,
        basic: g.basic,
        deviation: g.deviation,
        reason: g.reason,
        evLoss,
        ev,
        exact: isExact,
        cell: row ? cellKey(row, up) : null,
        category,
      };
    },
    [t, exact],
  );

  const currentAdvice = useMemo(() => {
    const st = strategy;
    if (!st || pending.kind !== 'action') return null;
    const seat = t.seats[pending.seat];
    const hand = seat.hands[pending.hand];
    const ranks = hand.cards.map((c) => c.rank);
    const up = t.upcard!.rank;
    const g = gradePlay(st, ranks, up, pending.avail, hiLoTC, setup.deviations);
    const adv = advise(st, ranks, up, pending.avail);
    const key = `${t.roundId}:${pending.seat}:${pending.hand}:${hand.cards.length}`;
    return { action: g.action, reason: g.reason, deviation: g.deviation, ev: adv.ev, exactEv: exact && exact.key === key ? exact.ev : null, cards: ranks, up, avail: pending.avail as GameAvail };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, strategy, exact, setup.deviations]);

  const record = useCallback(
    (kind: DecisionKind, cards: Rank[], up: Rank, g: Graded, meta: { coached?: boolean; hinted?: boolean } = {}, bet = 0) => {
      const id = `${t.roundId}-${decisions.current.length}`;
      const tc = tableTrueCount(t);
      const rec: DecisionRecord = {
        id,
        round: t.roundId,
        kind,
        cards,
        up,
        taken: g.taken,
        correct: g.correct,
        acceptable: g.acceptable,
        ok: g.ok,
        basic: g.basic,
        deviation: g.deviation && g.correct !== g.basic ? g.deviation.id : undefined,
        deviationChecked: setupRef.current.deviations && g.deviation ? g.deviation.id : undefined,
        tc,
        bet,
        evLoss: g.evLoss,
        ev: g.ev,
        exact: g.exact,
        category: g.category,
        coached: meta.coached,
        hinted: meta.hinted,
      };
      decisions.current.push(rec);
      decisionCountThisRound.current++;
      if (kind === 'play' && g.cell && !g.deviation) {
        const p = t.pending();
        const fromSplit = p.kind === 'action' && t.seats[p.seat].hands[p.hand].fromSplit;
        const situation = fromSplit ? 'split' : cards.length > 2 ? 'multi' : 'two';
        recordCell(strategyKey(rulesRef.current), g.cell, g.ok, { situation, taken: g.taken, correct: g.correct, cards });
      }
      setFeedback({ ...g, id, kind, cards, up, tc, bet });
    },
    [t],
  );

  // ---- human actions -----------------------------------------------------------------------
  const act = useCallback(
    (a: Action, meta: { coached?: boolean; hinted?: boolean } = {}) => {
      const p = t.pending();
      if (p.kind !== 'action') return;
      const hand = t.seats[p.seat].hands[p.hand];
      const g = evaluate(a);
      if (g) record('play', hand.cards.map((c) => c.rank), t.upcard!.rank, g, meta, hand.bet / (hand.doubled ? 2 : 1));
      if (g && !g.ok && setupRef.current.mode === 'trainer') holdNext.current = true;
      if (setupRef.current.decisionOnly && g) {
        holdNext.current = !g.ok;
        t.abortRound();
        roundClosed.current = true;
        bump();
        return;
      }
      t.act(a);
      bump();
    },
    [t, evaluate, record],
  );

  const insurance = useCallback(
    (take: boolean) => {
      const p = t.pending();
      if (p.kind !== 'insurance') return;
      const seat = t.seats[p.seat];
      const tc = tableTrueCount(t);
      const gi = gradeInsurance(tc, setupRef.current.deviations, rulesRef.current);
      const shoe = shoeCounts(t);
      const unseen = shoe.reduce((x, y) => x + y, 0);
      const pTen = unseen ? shoe[10] / unseen : 4 / 13;
      const evIns = 0.5 * (3 * pTen - 1); // per unit of the main bet, insuring half
      const ok = gi.acceptable.includes(take);
      const g: Graded = {
        ok,
        taken: take ? 'I' : 'N',
        correct: gi.take ? 'I' : 'N',
        acceptable: gi.acceptable.map((x) => (x ? 'I' : 'N')),
        basic: 'N',
        deviation: null,
        reason: gi.reason,
        evLoss: ok ? 0 : Math.abs(evIns),
        ev: {},
        exact: true,
        cell: null,
        category: 'insurance',
      };
      record('insurance', seat.hands[0].cards.map((c) => c.rank), t.upcard!.rank, g, {}, seat.bet);
      t.decideInsurance(p.seat, take);
      bump();
    },
    [t, record],
  );

  const early = useCallback(
    (surrender: boolean) => {
      const p = t.pending();
      const st = strategyRef.current;
      if (p.kind !== 'early' || !st) return;
      const seat = t.seats[p.seat];
      const ranks = seat.hands[0].cards.map((c) => c.rank);
      const up = t.upcard!.rank;
      const adv = advise(st, ranks, up, { double: true, split: ranks[0] === ranks[1], surrender: true });
      const should = adv.action === 'R';
      const evR = adv.ev.R ?? -0.5;
      const evPlay = Math.max(...Object.entries(adv.ev).filter(([k]) => k !== 'R').map(([, v]) => v as number));
      const ok = should === surrender;
      const g: Graded = {
        ok,
        taken: surrender ? 'R' : 'N',
        correct: should ? 'R' : 'N',
        acceptable: [should ? 'R' : 'N'],
        basic: should ? 'R' : 'N',
        deviation: null,
        reason: 'Early surrender (before the dealer checks for blackjack)',
        evLoss: ok ? 0 : Math.abs(evR - evPlay),
        ev: adv.ev,
        exact: false,
        cell: adv.row ? cellKey(adv.row, up) : null,
        category: 'surrender',
      };
      record('early', ranks, up, g, {}, seat.bet);
      t.decideEarly(p.seat, surrender);
      bump();
    },
    [t, record],
  );

  // ---- dealing ------------------------------------------------------------------------------
  const deal = useCallback((): boolean => {
    const s = setupRef.current;
    if (countPrompt) return false;
    if (t.phase === 'done') {
      const before = t.shoeId;
      t.endRound();
      if (t.shoeId !== before) setShuffleFlash((x) => x + 1);
    }
    if (t.phase !== 'betting') return false;
    for (const seat of t.seats) {
      if (seat.player?.kind === 'bot') t.placeBet(seat.index, botBet(seat.player, t, rngRef.current));
    }
    if (s.humanSeat !== null) {
      const amount = s.fixedBet ?? bet;
      const me = t.seats[s.humanSeat].player!;
      if (s.fixedBet !== undefined && me.bankroll < amount) me.bankroll += 100 * amount; // trainer: unlimited chips
      if (!t.placeBet(s.humanSeat, amount)) return false;
    }
    if (s.rig) {
      const r = s.rig();
      if (r) t.rig(r);
    }
    tcAtBet.current = tableTrueCount(t);
    decisionCountThisRound.current = 0;
    roundClosed.current = false;
    holdNext.current = false;
    setFeedback((f) => (s.mode === 'trainer' ? f : null));
    t.startRound();
    bump();
    return true;
  }, [t, bet, countPrompt]);

  // ---- round completion ------------------------------------------------------------------
  const closeRound = useCallback(() => {
    if (roundClosed.current) return;
    roundClosed.current = true;
    const s = setupRef.current;
    if (s.humanSeat !== null) {
      const seat = t.seats[s.humanSeat];
      const base = seat.bet;
      if (seat.hands.length) rounds.current.push({ round: t.roundId, bet: base, net: t.seatNet(s.humanSeat), tc: tcAtBet.current });
    }
    // Count check?
    const cc = s.countChecks;
    roundsSinceCheck.current++;
    const endOfShoe = t.shoe.length <= t.cutRemaining;
    const due =
      cc.frequency === 'round' ||
      (cc.frequency === 'every3' && roundsSinceCheck.current >= 3) ||
      (cc.frequency === 'random' && rngRef.current() < 0.33) ||
      (cc.frequency === 'shoe' && endOfShoe);
    if (cc.frequency !== 'off' && due) {
      roundsSinceCheck.current = 0;
      const sys = getSystem(s.countingSystem);
      let rc = initialRunningCount(sys, tableDecks(rulesRef.current));
      for (const c of t.revealed) rc += sys.tags[c.rank];
      const unseen = t.cardsUnseen();
      setCountPrompt({
        round: t.roundId,
        rcActual: rc,
        tcActual: sys.balanced ? trueCount(rc, unseen) : null,
        decksLeft: unseen / 52,
        reason: endOfShoe ? 'End of shoe: one last check before the shuffle.' : 'Count check',
      });
    }
  }, [t]);

  const submitCount = useCallback(
    (rc: number, tc?: number) => {
      if (!countPrompt) return null;
      const sys = getSystem(setupRef.current.countingSystem);
      const rcOk = Math.abs(rc - countPrompt.rcActual) < 1e-9;
      let tcOk: boolean | undefined;
      if (tc !== undefined && countPrompt.tcActual !== null) {
        const exactTc = countPrompt.tcActual;
        tcOk = Math.abs(tc - exactTc) <= 0.5 || tc === Math.floor(exactTc) || tc === Math.ceil(exactTc) || tc === Math.trunc(exactTc);
      }
      const rec: CountCheck = {
        round: countPrompt.round,
        system: sys.id,
        rcAnswer: rc,
        rcActual: countPrompt.rcActual,
        tcAnswer: tc,
        tcActual: countPrompt.tcActual ?? undefined,
        rcOk,
        tcOk,
        decksLeft: countPrompt.decksLeft,
      };
      checks.current.push(rec);
      return rec;
    },
    [countPrompt],
  );

  const closeCountPrompt = useCallback(() => {
    setCountPrompt(null);
    bump();
  }, []);

  // ---- automatic stepping ----------------------------------------------------------------------
  useEffect(() => {
    if (paused || countPrompt) return;
    const p = t.pending();
    if (p.kind === 'auto') {
      const botTurn = t.phase === 'playing' && t.turn && t.seats[t.turn.seat].player?.kind === 'bot';
      const base = PHASE_DELAY[t.phase] ?? 300;
      const delay = (t.phase === 'playing' && !botTurn ? 320 : base) / speed;
      const id = window.setTimeout(() => {
        t.step();
        bump();
      }, delay);
      return () => window.clearTimeout(id);
    }
    if (p.kind === 'done') {
      if (!roundClosed.current) {
        closeRound();
        bump();
        return;
      }
      if (setupRef.current.autoNext && !holdNext.current) {
        const id = window.setTimeout(() => deal(), (setupRef.current.mode === 'watch' ? 1500 : 1100) / speed);
        return () => window.clearTimeout(id);
      }
    }
    if (p.kind === 'betting' && setupRef.current.autoNext && !holdNext.current && (setupRef.current.mode === 'watch' || setupRef.current.fixedBet !== undefined)) {
      const id = window.setTimeout(() => deal(), (setupRef.current.mode === 'trainer' ? 700 : 900) / speed);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [version, paused, countPrompt, speed, t, closeRound, deal]);

  const reset = useCallback(() => {
    tableRef.current = makeTable();
    decisions.current = [];
    rounds.current = [];
    checks.current = [];
    roundClosed.current = true;
    startedAt.current = Date.now();
    setFeedback(null);
    setCountPrompt(null);
    setExact(null);
    bump();
  }, [makeTable]);

  const continueAfterMistake = useCallback(() => {
    holdNext.current = false;
    bump();
  }, []);

  return {
    t,
    version,
    pending,
    paused,
    setPaused,
    bet,
    setBet,
    deal,
    act,
    evaluate,
    insurance,
    early,
    feedback,
    setFeedback,
    currentAdvice,
    countPrompt,
    submitCount,
    closeCountPrompt,
    runningCount,
    hiLoTC,
    cardsUnseen,
    shuffleFlash,
    decisions: decisions.current,
    rounds: rounds.current,
    checks: checks.current,
    startedAt: startedAt.current,
    reset,
    holdNext: holdNext.current,
    continueAfterMistake,
  };
}

export type TableGame = ReturnType<typeof useTableGame>;

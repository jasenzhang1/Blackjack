/**
 * Builds the full basic-strategy chart for a rule set, the exact house edge, and lookups.
 *
 * A chart cell such as "hard 16 vs 10" is a *mixture* of two-card compositions (10-6, 9-7).
 * Its EV for action a is the probability-weighted average
 *
 *      EV_cell(a) = Σ_i w_i · EV_i(a) / Σ_i w_i,     w_i = P(dealt composition i | upcard)
 *
 * and the chart shows argmax_a EV_cell(a) — the total-dependent basic-strategy play.
 */
import { INFINITE_PROBS, UPCARDS, fullShoe, totalCards, type Counts, type Rank } from './cards';
import { ACTIONS, EVEngine, type Action, type ActionEVs, type EVBasis } from './ev';
import { ALL_HARD_ROWS, ALL_SOFT_ROWS, PAIR_ROWS, handValue, rowForHand, rowKey, type RowKey } from './hand';
import { canDoubleTotal, rulesKey, type Rules } from './rules';

export interface Composition {
  cards: [Rank, Rank];
  /** Normalised weight inside its cell. */
  weight: number;
  ev: ActionEVs;
  pBJ: number;
}

export interface Cell {
  row: RowKey;
  up: Rank;
  ev: ActionEVs;
  best: Action;
  second: Action | null;
  /** EV(best) − EV(second best), in units of the initial bet. */
  margin: number;
  /** Chart code: H, S, Dh, Ds, P, Rh, Rs, Rp. */
  code: string;
  basis: EVBasis;
  comps: Composition[];
}

export interface StrategyTable {
  key: string;
  rules: Rules;
  cells: Record<string, Cell>;
  /** House edge as a fraction of the initial bet (positive = casino advantage), basic strategy. */
  houseEdge: number;
  /** House edge if every two-card hand were played composition-dependently. */
  houseEdgeCD: number;
  /** House edge when playing a *fixed* chart (ComputeOptions.fixed) on this shoe. */
  houseEdgeFixed?: number;
  /** Probability the player is dealt a blackjack. */
  pPlayerBJ: number;
  /** P(player blackjack and dealer has none) — the term the BJ payout multiplies. */
  pPlayerBJWin: number;
  /** Dealer final distribution by upcard (7 outcomes, BJ included) and conditional on no BJ. */
  dealer: Record<number, { all: number[]; noBJ: number[] }>;
  ms: number;
}

export function cellKey(row: RowKey, up: Rank): string {
  return `${row}|${up}`;
}

export function bestOf(ev: ActionEVs, exclude: readonly Action[] = []): Action | null {
  let best: Action | null = null;
  let bv = -Infinity;
  for (const a of ACTIONS) {
    if (exclude.includes(a)) continue;
    const x = ev[a];
    if (x !== undefined && x > bv + 1e-12) {
      best = a;
      bv = x;
    }
  }
  return best;
}

export function codeFor(ev: ActionEVs, best: Action): string {
  if (best === 'D') return (ev.H ?? -Infinity) >= (ev.S ?? -Infinity) ? 'Dh' : 'Ds';
  if (best === 'R') {
    const alt = bestOf(ev, ['R']);
    return 'R' + (alt ? alt.toLowerCase() : 'h');
  }
  return best;
}

function buildCell(row: RowKey, up: Rank, comps: { cards: [Rank, Rank]; w: number; ev: ActionEVs; pBJ: number }[], allowSplit: boolean, basis: EVBasis): Cell {
  const totalW = comps.reduce((a, c) => a + c.w, 0);
  const ev: ActionEVs = {};
  for (const a of ACTIONS) {
    if (a === 'P' && !allowSplit) continue;
    let sum = 0;
    let ok = comps.length > 0;
    for (const c of comps) {
      const x = c.ev[a];
      if (x === undefined) {
        ok = false;
        break;
      }
      sum += c.w * x;
    }
    if (ok) ev[a] = sum / totalW;
  }
  const best = bestOf(ev) ?? 'S';
  const second = bestOf(ev, [best]);
  const margin = second ? (ev[best] as number) - (ev[second] as number) : Infinity;
  return {
    row,
    up,
    ev,
    best,
    second,
    margin,
    code: codeFor(ev, best),
    basis,
    comps: comps.map((c) => ({ cards: c.cards, weight: c.w / totalW, ev: c.ev, pBJ: c.pBJ })),
  };
}

export interface ComputeOptions {
  /** Custom starting shoe (default: full shoe for rules.decks). Must be finite. */
  shoe?: Counts;
  onProgress?: (done: number, total: number) => void;
  /** Called with each upcard's engine so callers can keep the warm caches (explanations). */
  onEngine?: (up: Rank, engine: EVEngine) => void;
  /**
   * Also evaluate the house edge of playing this (other) table's chart on the given shoe — e.g.
   * neutral-shoe basic strategy applied to a ten-rich shoe.
   */
  fixed?: StrategyTable;
}

export function computeStrategy(rules: Rules, opts: ComputeOptions = {}): StrategyTable {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const shoe = opts.shoe ?? (Number.isFinite(rules.decks) ? fullShoe(rules.decks) : undefined);
  const N = shoe ? totalCards(shoe) : 0;
  const cells: Record<string, Cell> = {};
  const dealer: StrategyTable['dealer'] = {};
  let ev = 0;
  let evCD = 0;
  let evFixed = 0;
  let pPlayerBJ = 0;
  let pPlayerBJWin = 0;
  const surrenderAllowed = rules.surrender !== 'none';

  UPCARDS.forEach((up, i) => {
    const pUp = shoe ? shoe[up] / N : INFINITE_PROBS[up];
    if (pUp <= 0) return;
    const eng = new EVEngine(rules, up, shoe);
    opts.onEngine?.(up, eng);

    const all = Array.from(eng.dealerFor([]));
    const z = 1 - all[6];
    dealer[up] = { all, noBJ: all.map((x, o) => (o === 6 ? 0 : x / z)) };

    type C = { cards: [Rank, Rank]; w: number; ev: ActionEVs; pBJ: number; basis: EVBasis };
    const comps = new Map<string, C>();
    let basis: EVBasis = 'unconditional';
    for (let a = 1 as Rank; a <= 10; a = (a + 1) as Rank) {
      for (let b = a; b <= 10; b = (b + 1) as Rank) {
        const w = eng.compositionProb(a, b);
        if (w <= 0) continue;
        if (a === 1 && b === 10) {
          const pD = eng.blackjackProbGiven([1, 10]);
          const v = (1 - pD) * rules.blackjackPays;
          pPlayerBJ += pUp * w;
          pPlayerBJWin += pUp * w * (1 - pD);
          ev += pUp * w * v;
          evCD += pUp * w * v;
          evFixed += pUp * w * v;
          continue;
        }
        const hv = handValue([a, b]);
        const root = eng.analyze([a, b], {
          double: canDoubleTotal(rules, hv.total, hv.soft),
          split: a === b,
          surrender: surrenderAllowed,
        });
        basis = root.basis;
        comps.set(`${a},${b}`, { cards: [a, b], w, ev: root.ev, pBJ: root.pBJ, basis: root.basis });
      }
    }

    // ---- cells ----
    for (const n of ALL_HARD_ROWS) {
      let list: C[] = [];
      for (let a = 2; a <= 10; a++) {
        const b = n - a;
        if (b > a && b <= 10) {
          const c = comps.get(`${a},${b}`);
          if (c) list.push(c);
        }
      }
      if (list.length === 0 && n % 2 === 0) {
        const c = comps.get(`${n / 2},${n / 2}`);
        if (c) list = [c];
      }
      if (list.length) cells[cellKey(rowKey('hard', n), up)] = buildCell(rowKey('hard', n), up, list, false, basis);
    }
    for (const n of ALL_SOFT_ROWS) {
      const c = comps.get(n === 12 ? '1,1' : `1,${n - 11}`);
      if (c) cells[cellKey(rowKey('soft', n), up)] = buildCell(rowKey('soft', n), up, [c], false, basis);
    }
    for (const x of PAIR_ROWS) {
      const c = comps.get(`${x},${x}`);
      if (c) cells[cellKey(rowKey('pair', x), up)] = buildCell(rowKey('pair', x), up, [c], true, basis);
    }

    // ---- expectation of the round given this upcard ----
    for (const c of comps.values()) {
      const [a, b] = c.cards;
      const row = a === b ? rowKey('pair', a) : a === 1 ? rowKey('soft', 11 + b) : rowKey('hard', a + b);
      const cell = cells[cellKey(row, up)];
      const toUncond = (x: number) => (c.basis === 'conditional' ? -c.pBJ + (1 - c.pBJ) * x : x);
      const chosen = c.ev[cell.best] ?? c.ev.S!;
      ev += pUp * c.w * toUncond(chosen);
      const bestCD = c.ev[bestOf(c.ev) ?? 'S']!;
      evCD += pUp * c.w * toUncond(bestCD);
      if (opts.fixed) {
        const fcell = opts.fixed.cells[cellKey(row, up)];
        const fx = (fcell && c.ev[fcell.best]) ?? chosen;
        evFixed += pUp * c.w * toUncond(fx);
      }
    }
    opts.onProgress?.(i + 1, UPCARDS.length);
  });

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    key: rulesKey(rules),
    rules,
    cells,
    houseEdge: -ev,
    houseEdgeCD: -evCD,
    houseEdgeFixed: opts.fixed ? -evFixed : undefined,
    pPlayerBJ,
    pPlayerBJWin,
    dealer,
    ms: t1 - t0,
  };
}

// --------------------------------------------------------------------------------------------
// Lookups used by the trainer, the table bots and the coach
// --------------------------------------------------------------------------------------------

export interface Availability {
  double: boolean;
  split: boolean;
  surrender: boolean;
}

export interface Advice {
  action: Action;
  /** EVs of the *available* actions (cell values; 21+ → stand only). */
  ev: ActionEVs;
  cell: Cell | null;
  row: RowKey | null;
}

/** Basic-strategy play for a hand given which actions are currently legal. */
export function advise(table: StrategyTable, ranks: readonly Rank[], up: Rank, avail: Availability): Advice {
  const row = rowForHand(ranks, avail.split);
  if (!row) return { action: 'S', ev: { S: 1 }, cell: null, row: null };
  const cell = table.cells[cellKey(row, up)];
  if (!cell) return { action: 'S', ev: {}, cell: null, row };
  const ev: ActionEVs = {};
  for (const a of ACTIONS) {
    const x = cell.ev[a];
    if (x === undefined) continue;
    if (a === 'D' && !avail.double) continue;
    if (a === 'P' && !avail.split) continue;
    if (a === 'R' && !avail.surrender) continue;
    ev[a] = x;
  }
  return { action: bestOf(ev) ?? 'S', ev, cell, row };
}

/** All chart cells that differ between two tables (for the Rules Lab diff view). */
export function diffTables(a: StrategyTable, b: StrategyTable): { key: string; from: string; to: string }[] {
  const out: { key: string; from: string; to: string }[] = [];
  for (const k of Object.keys(a.cells)) {
    const ca = a.cells[k];
    const cb = b.cells[k];
    if (cb && ca.code !== cb.code) out.push({ key: k, from: ca.code, to: cb.code });
  }
  return out;
}

/**
 * Engine request handler. Runs inside the Web Worker (or synchronously as a fallback).
 * Keeps an LRU of computed strategy tables and the warm EV engines behind them, so explanations
 * of chart cells reuse the memoised sub-problems from the chart computation.
 */
import { fullShoe, removeRanks, type Rank } from '../engine/cards';
import { representativeShoe } from '../engine/counting';
import { dealerTreeNode } from '../engine/dealer';
import { EVEngine } from '../engine/ev';
import { DEFAULT_RULES, rulesKey, strategyKey, type Rules } from '../engine/rules';
import { computeStrategy, type StrategyTable } from '../engine/strategy';
import type { CurvePoint, EdgePoint, EORPoint, EngineRequest, RuleEffect } from './protocol';

type Progress = (done: number, total: number) => void;

const tables = new Map<string, StrategyTable>();
const MAX_TABLES = 48;
const engines = new Map<string, EVEngine>();
const engineSets: string[] = [];
const MAX_ENGINE_SETS = 2;

function remember(t: StrategyTable): void {
  tables.delete(t.key);
  tables.set(t.key, t);
  while (tables.size > MAX_TABLES) tables.delete(tables.keys().next().value as string);
}

/** Same playing strategy, different blackjack payout: only the house edge changes. */
function withPayout(t: StrategyTable, rules: Rules): StrategyTable {
  const d = (rules.blackjackPays - t.rules.blackjackPays) * t.pPlayerBJWin;
  return { ...t, key: rulesKey(rules), rules, houseEdge: t.houseEdge - d, houseEdgeCD: t.houseEdgeCD - d, ms: 0 };
}

export function getStrategy(rules: Rules, onProgress?: Progress, keepEngines = true): StrategyTable {
  const key = rulesKey(rules);
  const hit = tables.get(key);
  if (hit) {
    remember(hit);
    return hit;
  }
  const skey = strategyKey(rules);
  for (const t of tables.values()) {
    if (strategyKey(t.rules) === skey) {
      const out = withPayout(t, rules);
      remember(out);
      return out;
    }
  }
  const t = computeStrategy(rules, {
    onProgress,
    onEngine: keepEngines
      ? (up, eng) => {
          engines.set(`${skey}#${up}`, eng);
        }
      : undefined,
  });
  if (keepEngines) {
    const i = engineSets.indexOf(skey);
    if (i >= 0) engineSets.splice(i, 1);
    engineSets.push(skey);
    while (engineSets.length > MAX_ENGINE_SETS) {
      const old = engineSets.shift()!;
      for (const k of Array.from(engines.keys())) if (k.startsWith(old + '#')) engines.delete(k);
    }
  }
  remember(t);
  return t;
}

function engineFor(rules: Rules, up: Rank): EVEngine {
  const k = `${strategyKey(rules)}#${up}`;
  let e = engines.get(k);
  if (!e) {
    e = new EVEngine(rules, up);
    engines.set(k, e);
  }
  return e;
}

interface Variant {
  id: string;
  group: string;
  label: string;
  patch: Partial<Rules>;
}

function variants(rules: Rules): Variant[] {
  const v: Variant[] = [];
  for (const d of [1, 2, 4, 6, 8, Infinity]) v.push({ id: `decks-${d}`, group: 'Decks', label: Number.isFinite(d) ? `${d} deck${d > 1 ? 's' : ''}` : 'Infinite', patch: { decks: d } });
  v.push({ id: 's17', group: 'Soft 17', label: 'Dealer stands (S17)', patch: { hitSoft17: false } });
  v.push({ id: 'h17', group: 'Soft 17', label: 'Dealer hits (H17)', patch: { hitSoft17: true } });
  for (const [p, l] of [
    [1.5, '3:2'],
    [1.4, '7:5'],
    [1.2, '6:5'],
    [1, '1:1'],
  ] as const)
    v.push({ id: `bj-${p}`, group: 'Blackjack pays', label: l, patch: { blackjackPays: p } });
  v.push({ id: 'sur-none', group: 'Surrender', label: 'None', patch: { surrender: 'none' } });
  v.push({ id: 'sur-late', group: 'Surrender', label: 'Late', patch: { surrender: 'late' } });
  v.push({ id: 'sur-early', group: 'Surrender', label: 'Early', patch: { surrender: 'early' } });
  v.push({ id: 'dbl-any', group: 'Doubling', label: 'Any two cards', patch: { doubleOn: 'any' } });
  v.push({ id: 'dbl-911', group: 'Doubling', label: '9–11 only', patch: { doubleOn: '9-11' } });
  v.push({ id: 'dbl-1011', group: 'Doubling', label: '10–11 only', patch: { doubleOn: '10-11' } });
  v.push({ id: 'das-y', group: 'Double after split', label: 'Allowed', patch: { doubleAfterSplit: true } });
  v.push({ id: 'das-n', group: 'Double after split', label: 'Not allowed', patch: { doubleAfterSplit: false } });
  for (const n of [2, 3, 4]) v.push({ id: `sp-${n}`, group: 'Split up to', label: `${n} hands`, patch: { maxSplitHands: n } });
  v.push({ id: 'rsa-n', group: 'Resplit aces', label: 'No', patch: { resplitAces: false } });
  v.push({ id: 'rsa-y', group: 'Resplit aces', label: 'Yes', patch: { resplitAces: true } });
  v.push({ id: 'hsa-n', group: 'Hit split aces', label: 'No', patch: { hitSplitAces: false } });
  v.push({ id: 'hsa-y', group: 'Hit split aces', label: 'Yes', patch: { hitSplitAces: true } });
  v.push({ id: 'peek', group: 'Hole card', label: 'Dealer peeks (US)', patch: { dealerPeeks: true } });
  v.push({ id: 'enhc', group: 'Hole card', label: 'No hole card (ENHC)', patch: { dealerPeeks: false } });
  void rules;
  return v;
}

export function handle(req: EngineRequest, onProgress: Progress): unknown {
  switch (req.type) {
    case 'strategy':
      return getStrategy(req.rules, onProgress);

    case 'explain': {
      const eng = engineFor(req.rules, req.up);
      return eng.explain(req.cards, req.opts);
    }

    case 'dealerTree': {
      const r = req.rules;
      const shoe = Number.isFinite(r.decks) ? removeRanks(fullShoe(r.decks), [req.up, ...req.removed]) : null;
      return dealerTreeNode(req.up, r.hitSoft17, shoe, req.path);
    }

    case 'exact': {
      const eng = new EVEngine(req.rules, req.up, req.shoe);
      return eng.analyze(req.cards, req.opts);
    }

    case 'ruleEffects': {
      const base = getStrategy(req.rules);
      const list = variants(req.rules);
      const out: RuleEffect[] = [];
      list.forEach((v, i) => {
        const rules = { ...req.rules, ...v.patch };
        const t = getStrategy(rules, undefined, false);
        out.push({
          id: v.id,
          label: v.label,
          group: v.group,
          rules,
          houseEdge: t.houseEdge,
          delta: t.houseEdge - base.houseEdge,
          current: rulesKey(rules) === rulesKey(req.rules),
        });
        onProgress(i + 1, list.length);
      });
      return out;
    }

    case 'edgeVsCount': {
      const rules: Rules = Number.isFinite(req.rules.decks) ? req.rules : { ...req.rules, decks: 6 };
      const base = getStrategy(rules);
      const out: EdgePoint[] = [];
      req.tcs.forEach((tc, i) => {
        const shoe = representativeShoe(req.decksLeft, tc);
        const t = computeStrategy(rules, { shoe, fixed: base });
        out.push({ tc, basic: -(t.houseEdgeFixed ?? t.houseEdge), perfect: -t.houseEdge });
        onProgress(i + 1, req.tcs.length);
      });
      return out;
    }

    case 'deviationCurve': {
      const rules: Rules = Number.isFinite(req.rules.decks) ? req.rules : { ...req.rules, decks: 6 };
      const out: CurvePoint[] = [];
      req.tcs.forEach((tc, i) => {
        const shoe = representativeShoe(req.decksLeft, tc);
        shoe[req.up] += 1;
        for (const c of req.cards) shoe[c] += 1;
        const eng = new EVEngine(rules, req.up, shoe);
        out.push({ tc, ev: eng.analyze(req.cards, req.opts).ev });
        onProgress(i + 1, req.tcs.length);
      });
      return out;
    }

    case 'eor': {
      const rules: Rules = { ...(req.rules ?? DEFAULT_RULES), decks: 1 };
      const base = computeStrategy(rules).houseEdge;
      const out: EORPoint[] = [];
      for (let r = 1 as Rank; r <= 10; r = (r + 1) as Rank) {
        const shoe = removeRanks(fullShoe(1), [r]);
        const he = computeStrategy(rules, { shoe }).houseEdge;
        out.push({ rank: r, eor: -(he - base) });
        onProgress(r, 10);
      }
      return out;
    }
  }
}

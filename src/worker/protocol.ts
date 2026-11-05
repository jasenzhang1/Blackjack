import type { Counts, Rank } from '../engine/cards';
import type { DealerTreeNode } from '../engine/dealer';
import type { ActionEVs, Explanation, PlayDistributions, RootEV, RootOptions } from '../engine/ev';
import type { Rules } from '../engine/rules';
import type { StrategyTable } from '../engine/strategy';

export interface RuleEffect {
  id: string;
  label: string;
  group: string;
  rules: Rules;
  houseEdge: number;
  /** House edge minus the current rules' house edge (positive = worse for the player). */
  delta: number;
  current: boolean;
}

export interface CurvePoint {
  tc: number;
  ev: ActionEVs;
}

export interface EdgePoint {
  tc: number;
  /** Player edge with the neutral-shoe basic strategy held fixed. */
  basic: number;
  /** Player edge with perfect play for that composition. */
  perfect: number;
}

export interface EORPoint {
  rank: Rank;
  /** Change in player edge (fraction of a unit) when one card of `rank` is removed. */
  eor: number;
}

export type EngineRequest =
  | { type: 'strategy'; rules: Rules }
  | { type: 'explain'; rules: Rules; cards: Rank[]; up: Rank; opts: RootOptions }
  | { type: 'dealerTree'; rules: Rules; removed: Rank[]; up: Rank; path: Rank[] }
  | { type: 'exact'; rules: Rules; shoe: Counts; cards: Rank[]; up: Rank; opts: RootOptions }
  | { type: 'ruleEffects'; rules: Rules }
  | { type: 'edgeVsCount'; rules: Rules; tcs: number[]; decksLeft: number }
  | { type: 'deviationCurve'; rules: Rules; cards: Rank[]; up: Rank; opts: RootOptions; tcs: number[]; decksLeft: number }
  | { type: 'eor'; rules: Rules }
  | { type: 'dist'; rules: Rules; up: Rank; comps: { cards: Rank[]; weight: number; opts: RootOptions }[] };

export interface EngineResults {
  strategy: StrategyTable;
  explain: Explanation;
  dealerTree: DealerTreeNode;
  exact: RootEV;
  ruleEffects: RuleEffect[];
  edgeVsCount: EdgePoint[];
  deviationCurve: CurvePoint[];
  eor: EORPoint[];
  dist: PlayDistributions;
}

export type WorkerIn = { id: number; req: EngineRequest };
export type WorkerOut =
  | { id: number; kind: 'result'; data: unknown }
  | { id: number; kind: 'progress'; done: number; total: number }
  | { id: number; kind: 'error'; message: string };

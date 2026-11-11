/**
 * Session records and the report-card summary (grade, EV lost to mistakes, luck vs. skill, …).
 */
import type { Rank } from '../engine/cards';
import type { Action, ActionEVs } from '../engine/ev';
import type { Situation } from '../state/progress';

export type Decision = Action | 'I' | 'N';
export type DecisionKind = 'play' | 'insurance' | 'early';
export type Category = 'hard' | 'soft' | 'pair' | 'insurance' | 'surrender';

export interface DecisionRecord {
  id: string;
  round: number;
  kind: DecisionKind;
  cards: Rank[];
  up: Rank;
  taken: Decision;
  correct: Decision;
  acceptable: Decision[];
  ok: boolean;
  basic: Decision;
  /** Deviation id when the graded play differs from basic strategy because of the count. */
  deviation?: string;
  /** Deviation id that *could* apply to this hand (an opportunity, whether or not it fired). */
  deviationChecked?: string;
  tc: number;
  bet: number;
  /** EV given up by the decision, in units of the hand's bet (≥ 0). */
  evLoss: number;
  ev?: ActionEVs;
  exact?: boolean;
  category: Category;
  coached?: boolean;
  hinted?: boolean;
  /** Chart cell and situation of a play decision (for the per-cell stats). */
  cell?: string;
  situation?: Situation;
}

export interface CountCheck {
  round: number;
  system: string;
  rcAnswer: number;
  rcActual: number;
  tcAnswer?: number;
  tcActual?: number;
  rcOk: boolean;
  tcOk?: boolean;
  decksLeft: number;
}

export interface RoundRecord {
  round: number;
  bet: number;
  net: number;
  /** Exact Hi-Lo true count when the bet was placed. */
  tc: number;
}

export interface SessionReport {
  id: string;
  mode: 'casino' | 'countplay';
  start: number;
  end: number;
  rulesKey: string;
  rulesChips: string[];
  houseEdge: number;
  startBankroll: number;
  endBankroll: number;
  rounds: RoundRecord[];
  decisions: DecisionRecord[];
  checks: CountCheck[];
  deviationsOn: boolean;
  countingSystem: string;
  coach: string;
  unit: number;
}

export interface CategoryStat {
  category: Category;
  total: number;
  correct: number;
}

export interface ReportSummary {
  rounds: number;
  decisions: number;
  correct: number;
  accuracy: number | null;
  wagered: number;
  net: number;
  expected: number;
  luck: number;
  evLostMoney: number;
  evLostUnits: number;
  byCategory: CategoryStat[];
  mistakes: DecisionRecord[];
  checks: number;
  rcExact: number;
  rcAccuracy: number | null;
  meanAbsError: number | null;
  tcChecks: number;
  tcCorrect: number;
  deviationOpportunities: number;
  deviationCorrect: number;
  deviationAccuracy: number | null;
  betCorrelation: number | null;
  score: number | null;
  grade: string;
  comments: string[];
}

export function gradeFor(score: number): string {
  const s = score * 100;
  if (s >= 98) return 'A+';
  if (s >= 95) return 'A';
  if (s >= 92) return 'A−';
  if (s >= 89) return 'B+';
  if (s >= 85) return 'B';
  if (s >= 80) return 'B−';
  if (s >= 76) return 'C+';
  if (s >= 72) return 'C';
  if (s >= 68) return 'C−';
  if (s >= 60) return 'D';
  return 'F';
}

export function gradeColor(grade: string): string {
  if (grade.startsWith('A')) return 'var(--good)';
  if (grade.startsWith('B')) return '#9bd06b';
  if (grade.startsWith('C')) return 'var(--warn)';
  return 'var(--bad)';
}

function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n < 5) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return sxy / Math.sqrt(sxx * syy);
}

export function summarize(r: SessionReport): ReportSummary {
  const plays = r.decisions;
  const correct = plays.filter((d) => d.ok).length;
  const wagered = r.rounds.reduce((a, x) => a + x.bet, 0);
  const net = r.rounds.reduce((a, x) => a + x.net, 0);
  const evLostMoney = plays.reduce((a, d) => a + (d.ok ? 0 : d.evLoss * d.bet), 0);
  const evLostUnits = plays.reduce((a, d) => a + (d.ok ? 0 : d.evLoss), 0);
  const counting = r.mode === 'countplay';
  // Hi-Lo rule of thumb: each true-count point moves the edge by about +0.5%.
  const expected = r.rounds.reduce((a, x) => a + x.bet * (-r.houseEdge + (counting ? 0.005 * x.tc : 0)), 0) - evLostMoney;

  const cats: Category[] = ['hard', 'soft', 'pair', 'surrender', 'insurance'];
  const byCategory = cats
    .map((c) => {
      const list = plays.filter((d) => d.category === c);
      return { category: c, total: list.length, correct: list.filter((d) => d.ok).length };
    })
    .filter((c) => c.total > 0);

  const mistakes = plays
    .filter((d) => !d.ok)
    .slice()
    .sort((a, b) => b.evLoss * b.bet - a.evLoss * a.bet);

  const checks = r.checks.length;
  const rcExact = r.checks.filter((c) => c.rcOk).length;
  const meanAbsError = checks ? r.checks.reduce((a, c) => a + Math.abs(c.rcAnswer - c.rcActual), 0) / checks : null;
  const tcList = r.checks.filter((c) => c.tcOk !== undefined);
  const tcCorrect = tcList.filter((c) => c.tcOk).length;

  const devOpp = plays.filter((d) => d.deviationChecked);
  const devCorrect = devOpp.filter((d) => d.ok).length;

  const betCorrelation = counting ? pearson(r.rounds.map((x) => x.tc), r.rounds.map((x) => x.bet)) : null;

  const parts: [number, number][] = [];
  if (plays.length) parts.push([correct / plays.length, 0.5]);
  if (checks) parts.push([(rcExact + (tcList.length ? tcCorrect : rcExact)) / (checks + (tcList.length || checks)), 0.35]);
  if (r.deviationsOn && devOpp.length) parts.push([devCorrect / devOpp.length, 0.15]);
  const wsum = parts.reduce((a, p) => a + p[1], 0);
  const score = wsum ? parts.reduce((a, p) => a + p[0] * p[1], 0) / wsum : null;

  const comments: string[] = [];
  const accuracy = plays.length ? correct / plays.length : null;
  if (accuracy !== null) {
    if (accuracy >= 0.99) comments.push('Near-perfect strategy. The casino is only getting the house edge from you.');
    else if (accuracy >= 0.95) comments.push('Solid strategy. Clean up the few leaks listed under "Costliest mistakes".');
    else comments.push('Strategy errors are costing you real money. Drill the chart and the trainer on your weak spots.');
  }
  const worstCat = byCategory.filter((c) => c.total >= 3).sort((a, b) => a.correct / a.total - b.correct / b.total)[0];
  if (worstCat && worstCat.correct < worstCat.total) comments.push(`Weakest category: ${worstCat.category} hands (${worstCat.correct}/${worstCat.total} correct).`);
  if (checks && meanAbsError !== null) {
    if (rcExact === checks) comments.push('Every count check was exact. Great counting.');
    else comments.push(`Running count off by ${meanAbsError.toFixed(1)} on average. Try the speed drills and pairing cards that cancel.`);
  }
  if (betCorrelation !== null) {
    if (betCorrelation > 0.5) comments.push(`Your bets track the count well (correlation ${betCorrelation.toFixed(2)}).`);
    else comments.push(`Bet more when the true count is high: your bet/count correlation is only ${betCorrelation.toFixed(2)}.`);
  }
  if (Math.abs(net - expected) > 0) {
    const luck = net - expected;
    comments.push(luck >= 0 ? `You ran $${Math.round(luck)} above expectation. Variance was on your side.` : `You ran $${Math.round(-luck)} below expectation. That part is variance, not skill.`);
  }

  return {
    rounds: r.rounds.length,
    decisions: plays.length,
    correct,
    accuracy,
    wagered,
    net,
    expected,
    luck: net - expected,
    evLostMoney,
    evLostUnits,
    byCategory,
    mistakes,
    checks,
    rcExact,
    rcAccuracy: checks ? rcExact / checks : null,
    meanAbsError,
    tcChecks: tcList.length,
    tcCorrect,
    deviationOpportunities: devOpp.length,
    deviationCorrect: devCorrect,
    deviationAccuracy: devOpp.length ? devCorrect / devOpp.length : null,
    betCorrelation,
    score,
    grade: score === null ? '—' : gradeFor(score),
    comments,
  };
}

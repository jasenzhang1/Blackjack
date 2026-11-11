/**
 * The play-table coach. Preflop it follows the charts. After the flop it knows the opponent's range
 * (tracked by Bayes' rule from their actions under the bot model) and values each option with a
 * one-street look-ahead: the opponent's response to your action is modelled exactly, then the rest
 * of the hand is assumed to check down (your raw equity is realised). All-ins are exact.
 */
import { classOf } from './ranges';
import { comboEquities } from './analysis';
import { villainDist, type RangeCombo } from './bot';
import { actOf, RFI, threeBetterOf, VS3BET, VS4BET, vsOpenChart, type Chart, type ChartAct } from './preflop';
import type { HandGroup, Profile } from './profiles';
import { GROUPS } from './profiles';
import { apply, BB, legal, preflopSpot, totalPot, type HandState, type Move } from './table';

export interface HeroOption {
  id: string;
  label: string;
  move: Move;
  cls: 'fold' | 'passive' | 'aggressive';
}

const money = (x: number) => `$${Math.round(x * 100) / 100}`;

/** The buttons offered to hero in this state. */
export function heroOptions(s: HandState): HeroOption[] {
  const L = legal(s, 'hero');
  const h = s.players.hero;
  const out: HeroOption[] = [];
  if (L.toCall > 0) out.push({ id: 'fold', label: 'Fold', move: { kind: 'fold' }, cls: 'fold' });
  if (L.canCheck) out.push({ id: 'check', label: 'Check', move: { kind: 'check' }, cls: 'passive' });
  else {
    const allIn = L.toCall >= h.stack;
    const limp = s.street === 'preflop' && s.raises === 0;
    out.push({ id: 'call', label: allIn ? `Call all-in ${money(L.toCall)}` : limp ? (h.pos === 'SB' && L.toCall === 1 ? 'Complete $1' : `Limp ${money(L.toCall)}`) : `Call ${money(L.toCall)}`, move: { kind: 'call' }, cls: 'passive' });
  }
  if (!L.canRaise) return out;

  const sizes: { to: number; label: string }[] = [];
  if (s.street === 'preflop') {
    const spot = preflopSpot(s);
    const ip = (h.pos === 'BB' && s.players.villain.pos === 'SB') || (h.pos !== 'SB' && h.pos !== 'BB');
    if (spot.kind === 'rfi') sizes.push({ to: h.pos === 'SB' ? 3 * BB : 2.5 * BB, label: 'Raise to' });
    else if (spot.kind === 'vsLimp') sizes.push({ to: h.pos === 'BB' ? 4 * BB : 5 * BB, label: 'Raise to' });
    else if (spot.kind === 'vsOpen') sizes.push({ to: s.bet * (ip ? 3 : 4), label: '3-bet to' });
    else if (spot.kind === 'vs3bet') sizes.push({ to: s.bet * 2.3, label: '4-bet to' });
  } else {
    const P = totalPot(s);
    if (L.toCall === 0) {
      for (const [f, n] of [
        [1 / 3, '⅓ pot'],
        [0.5, '½ pot'],
        [0.75, '¾ pot'],
        [1, 'Pot'],
      ] as const)
        sizes.push({ to: Math.max(BB, f * P), label: `Bet ${n}` });
    } else sizes.push({ to: s.bet * 3, label: 'Raise to' });
  }
  const seen = new Set<number>();
  for (const z of sizes) {
    const to = Math.max(L.minTo, Math.round(z.to));
    if (to >= L.maxTo * 0.9 || seen.has(to)) continue;
    seen.add(to);
    const label = z.label.startsWith('Bet') ? `${z.label} (${money(to)})` : `${z.label} ${money(to)}`;
    out.push({ id: `r${to}`, label, move: { kind: 'raise', to }, cls: 'aggressive' });
  }
  out.push({ id: 'allin', label: `All-in ${money(L.maxTo)}`, move: { kind: 'raise', to: L.maxTo }, cls: 'aggressive' });
  return out;
}

export interface OptionEval {
  option: HeroOption;
  ev: number;
  /** Probability the opponent folds to this action. */
  fold?: number;
  /** Equity against the hands that continue. */
  eqCont?: number;
}

export interface Advice {
  street: HandState['street'];
  options: HeroOption[];
  /** Option ids that are fine to choose. */
  ok: string[];
  bestId: string;
  /** Short reason, shown by the coach. */
  text: string;
  chart?: Chart;
  chartAct?: ChartAct;
  hand?: string;
  evals?: OptionEval[];
  equity?: number;
  shares: Record<HandGroup, number>;
  /** Combos (weighted) in the opponent's range. */
  rangeSize: number;
}

function shares(range: readonly RangeCombo[], groups: (a: number, b: number, board: readonly number[]) => HandGroup, board: readonly number[]): Record<HandGroup, number> {
  const out = Object.fromEntries(GROUPS.map((g) => [g, 0])) as Record<HandGroup, number>;
  let W = 0;
  for (const c of range) {
    out[groups(c.a, c.b, board)] += c.w;
    W += c.w;
  }
  for (const g of GROUPS) out[g] = W ? out[g] / W : 0;
  return out;
}

/** The chart that applies to hero's preflop spot, and the chart's action for hero's hand. */
export function preflopChart(s: HandState, p: Profile): { chart: Chart | null; act: ChartAct; spotText: string } {
  const spot = preflopSpot(s);
  const label = classOf(s.players.hero.hole[0], s.players.hero.hole[1]).label;
  let chart: Chart | null = null;
  let spotText = '';
  if (spot.kind === 'rfi' && spot.hero !== 'BB') {
    chart = RFI[spot.hero];
    spotText = `Folded to you in the ${spot.hero}`;
  } else if (spot.kind === 'vsLimp') {
    chart = RFI[spot.hero === 'BB' ? 'CO' : spot.hero];
    spotText = `${spot.villain} limps; raise to isolate with your opening range`;
  } else if (spot.kind === 'vsOpen') {
    chart = vsOpenChart(spot.opener, spot.hero);
    spotText = `${spot.opener} opens, you are in the ${spot.hero}`;
  } else if (spot.kind === 'vs3bet') {
    chart = VS3BET[threeBetterOf(p.stats.threeBet)];
    spotText = `You opened and ${p.name} (3-bets ${p.stats.threeBet}%) re-raises`;
  } else if (spot.kind === 'vs4bet') {
    chart = VS4BET[p.id === 'lag' || p.id === 'maniac' ? 'loose' : 'tight'];
    spotText = `${p.name} 4-bets (or more)`;
  }
  return { chart, act: chart ? actOf(chart, label) : 'fold', spotText };
}

export function advise(s: HandState, p: Profile, range: readonly RangeCombo[], groups: (a: number, b: number, board: readonly number[]) => HandGroup): Advice {
  const options = heroOptions(s);
  const h = s.players.hero;
  const hand = classOf(h.hole[0], h.hole[1]).label;
  const sh = shares(range, groups, s.board);
  const rangeSize = range.reduce((n, c) => n + c.w, 0);

  if (s.street === 'preflop') {
    const { chart, act, spotText } = preflopChart(s, p);
    const want: HeroOption['cls'] = act === 'raise' ? 'aggressive' : act === 'call' ? 'passive' : options.some((o) => o.id === 'check') ? 'passive' : 'fold';
    // A 4-bet-or-more chart's "raise" means all-in.
    let ok = options.filter((o) => o.cls === want).map((o) => o.id);
    if (!chart) ok = options.filter((o) => o.cls !== 'fold').map((o) => o.id);
    const best = options.find((o) => ok.includes(o.id)) ?? options[0];
    const actName = act === 'raise' ? (chart?.raiseName ?? 'Raise').toLowerCase() : act === 'call' ? 'call' : want === 'passive' ? 'check' : 'fold';
    return {
      street: s.street,
      options,
      ok,
      bestId: best.id,
      text: chart ? `${spotText}. The chart says ${actName} with ${hand}.` : 'No chart covers this spot.',
      chart: chart ?? undefined,
      chartAct: act,
      hand,
      shares: sh,
      rangeSize,
    };
  }

  // Postflop: value every option.
  const live = range.filter((c) => c.w > 0);
  const combos = live.map((c) => ({ a: c.a, b: c.b, cls: classOf(c.a, c.b) }));
  const eqs = comboEquities(h.hole, s.board, combos);
  const W = rangeSize || 1;
  let q = 0;
  live.forEach((c, i) => (q += c.w * eqs[i]));
  q /= W;
  const P = totalPot(s);
  const L = legal(s, 'hero');
  const vil = s.players.villain;

  const respond = (after: HandState) => {
    let wf = 0;
    let wp = 0;
    let wa = 0;
    let qp = 0;
    let qa = 0;
    let raiseTo = 0;
    live.forEach((c, i) => {
      const d = villainDist(after, p, c.a, c.b, groups);
      wf += c.w * d.fold;
      wp += c.w * d.passive;
      wa += c.w * d.aggressive;
      qp += c.w * d.passive * eqs[i];
      qa += c.w * d.aggressive * eqs[i];
      raiseTo = d.raiseTo;
    });
    return { f: wf / W, p: wp / W, a: wa / W, qp: wp ? qp / wp : 0, qa: wa ? qa / wa : 0, raiseTo };
  };

  const evals: OptionEval[] = options.map((o) => {
    if (o.id === 'fold') return { option: o, ev: 0 };
    if (o.id === 'call') return { option: o, ev: q * (P + L.toCall) - L.toCall };
    if (o.id === 'check') {
      if (vil.acted || s.raises > 0) return { option: o, ev: q * P };
      // The opponent acts after your check: they check behind or bet, and you then call or fold.
      const r = respond(apply(s, o.move));
      const b = r.raiseTo;
      return { option: o, ev: r.p * r.qp * P + r.a * Math.max(0, r.qa * (P + 2 * b) - b) };
    }
    const to = o.move.to!;
    const after = apply(s, o.move);
    const r = respond(after);
    const add = to - h.street;
    const vCall = Math.min(to - vil.street, vil.stack);
    const R = r.raiseTo;
    const callBranch = r.qp * (P + add + vCall) - add;
    const raiseBranch = Math.max(-add, r.qa * (P + (R - h.street) + (R - vil.street)) - (R - h.street));
    return { option: o, ev: r.f * P + r.p * callBranch + r.a * raiseBranch, fold: r.f, eqCont: r.p + r.a ? (r.p * r.qp + r.a * r.qa) / (r.p + r.a) : 0 };
  });
  const best = evals.reduce((a, b) => (b.ev > a.ev ? b : a));
  const tol = Math.max(1, 0.03 * P);
  const ok = evals.filter((e) => e.ev >= best.ev - tol).map((e) => e.option.id);
  return {
    street: s.street,
    options,
    ok,
    bestId: best.option.id,
    text: `You have ${(q * 100).toFixed(0)}% equity against ${p.name}'s range. Best: ${best.option.label} (${best.ev >= 0 ? '+' : '−'}$${Math.abs(best.ev).toFixed(2)}).`,
    hand,
    evals: [...evals].sort((x, y) => y.ev - x.ev),
    equity: q,
    shares: sh,
    rangeSize,
  };
}

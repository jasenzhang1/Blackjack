/**
 * Preflop charts for 6-max cash games, 100 big blinds deep: opening (raise first in), facing an
 * open, and facing a 3-bet. They are simplified baseline charts in the style of common solver
 * outputs, rounded to one action per hand (real solver strategies mix many hands). They are a
 * solid default to learn from, not the last word.
 */
import { RANK_CHARS } from './cards';
import { ALL_CLASSES, PREFLOP_ORDER, type HandClass } from './ranges';

export type Pos = 'UTG' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';
/** Preflop acting order. */
export const POSITIONS: readonly Pos[] = ['UTG', 'HJ', 'CO', 'BTN', 'SB', 'BB'];
/** Postflop acting order (first to act first). */
export const POSTFLOP_ORDER: readonly Pos[] = ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'];
export const POS_NAME: Record<Pos, string> = { UTG: 'Under the gun', HJ: 'Hijack', CO: 'Cutoff', BTN: 'Button', SB: 'Small blind', BB: 'Big blind' };

export type ChartAct = 'raise' | 'call' | 'fold';

// ---------------------------------------------------------------------------------------------
// Range notation
// ---------------------------------------------------------------------------------------------

const ri = (ch: string): number => {
  const r = RANK_CHARS.indexOf(ch.toUpperCase());
  if (r < 0) throw new Error(`Bad rank "${ch}"`);
  return r;
};
const label = (hi: number, lo: number, kind: '' | 's' | 'o'): string => (hi === lo ? RANK_CHARS[hi] + RANK_CHARS[hi] : RANK_CHARS[Math.max(hi, lo)] + RANK_CHARS[Math.min(hi, lo)] + kind);

/**
 * Parses standard range notation into class labels: "22+", "TT-77", "A2s+", "A5s-A2s", "KQo",
 * "AK" (suited and offsuit), separated by commas.
 */
export function parseRange(spec: string): Set<string> {
  const out = new Set<string>();
  for (const raw of spec.split(',')) {
    const t = raw.trim();
    if (!t) continue;
    const kinds = (s: string): ('s' | 'o')[] => (s.length === 3 ? [s[2] as 's' | 'o'] : ['s', 'o']);
    if (t.includes('-')) {
      const [a, b] = t.split('-').map((x) => x.trim());
      const a1 = ri(a[0]);
      const a2 = ri(a[1]);
      const b2 = ri(b[1]);
      if (a1 === a2) {
        for (let r = Math.min(a1, ri(b[0])); r <= Math.max(a1, ri(b[0])); r++) out.add(label(r, r, ''));
      } else {
        for (const k of kinds(a)) for (let r = Math.min(a2, b2); r <= Math.max(a2, b2); r++) out.add(label(a1, r, k));
      }
    } else if (t.endsWith('+')) {
      const s = t.slice(0, -1);
      const h = ri(s[0]);
      const l = ri(s[1]);
      if (h === l) for (let r = h; r <= 12; r++) out.add(label(r, r, ''));
      else for (const k of kinds(s)) for (let r = l; r < h; r++) out.add(label(h, r, k));
    } else {
      const h = ri(t[0]);
      const l = ri(t[1]);
      if (h === l) out.add(label(h, h, ''));
      else for (const k of kinds(t)) out.add(label(h, l, k));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------------------------

export interface Chart {
  id: string;
  title: string;
  /** One-line description of the spot. */
  spot: string;
  /** What "raise" means here: open, 3-bet, 4-bet or all-in. */
  raiseName: string;
  acts: Map<string, ChartAct>;
  /** The actions this chart uses (fold is always available). */
  actions: ChartAct[];
  why: string;
}

function makeChart(id: string, title: string, spot: string, raiseName: string, raise: string, call: string, why: string): Chart {
  const acts = new Map<string, ChartAct>();
  for (const l of parseRange(call)) acts.set(l, 'call');
  for (const l of parseRange(raise)) acts.set(l, 'raise');
  return { id, title, spot, raiseName, acts, actions: call.trim() ? ['raise', 'call', 'fold'] : ['raise', 'fold'], why };
}

export const actOf = (c: Chart, label: string): ChartAct => c.acts.get(label) ?? 'fold';

export const RFI_SPECS: Record<Exclude<Pos, 'BB'>, string> = {
  UTG: '22+, A2s+, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+',
  HJ: '22+, A2s+, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A9o+, KTo+, QTo+, JTo',
  CO: '22+, A2s+, K5s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, A7o+, A5o, K9o+, Q9o+, J9o+, T9o',
  BTN: '22+, A2s+, K2s+, Q3s+, J5s+, T6s+, 95s+, 84s+, 74s+, 63s+, 52s+, 43s, A2o+, K8o+, Q8o+, J8o+, T8o+, 97o+, 87o, 76o, 65o',
  SB: '22+, A2s+, K3s+, Q5s+, J6s+, T6s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o, 98o',
};

const RFI_WHY: Record<Exclude<Pos, 'BB'>, string> = {
  UTG: 'Five players still to act, and you will be out of position for most of the hand. Open only hands that play well against strong ranges.',
  HJ: 'Four players behind you. Add more suited hands and the better offsuit broadways.',
  CO: 'Only the button and blinds are left. Open a wide range: you will often have position after the flop.',
  BTN: 'The best seat at the table: you act last on every street after the flop. Open close to half your hands.',
  SB: 'Only the big blind is left, but you will be out of position. Raise or fold (no limping) with a wide range.',
};

export const RFI: Record<Exclude<Pos, 'BB'>, Chart> = Object.fromEntries(
  (Object.keys(RFI_SPECS) as Exclude<Pos, 'BB'>[]).map((p) => [p, makeChart(`rfi-${p}`, `${p} open`, `Folded to you in the ${POS_NAME[p].toLowerCase()}`, 'Raise', RFI_SPECS[p], '', RFI_WHY[p])]),
) as Record<Exclude<Pos, 'BB'>, Chart>;

type OpenerGroup = 'early' | 'co' | 'btn' | 'sb';
type HeroKind = 'ip' | 'sb' | 'bb';

const VS_OPEN_SPECS: Partial<Record<`${OpenerGroup}-${HeroKind}`, { title: string; raise: string; call: string; why: string }>> = {
  'early-ip': {
    title: 'vs early open, in position',
    raise: 'QQ+, AKs, AKo, A5s-A4s',
    call: 'JJ-22, AQs-ATs, KQs, KJs, QJs, JTs, T9s, 98s, AQo',
    why: 'Early openers are strong. 3-bet your premiums plus a few suited wheel aces (they block AA and AK), and call with hands that flop well in position: pairs for sets, suited broadways and connectors.',
  },
  'early-sb': {
    title: 'vs early open, small blind',
    raise: 'JJ+, AQs+, AKo, A5s, KQs',
    call: '',
    why: 'Calling from the small blind invites the big blind in and leaves you out of position. 3-bet or fold.',
  },
  'early-bb': {
    title: 'vs early open, big blind',
    raise: 'QQ+, AKs, AKo, A5s-A4s',
    call: 'JJ-22, AQs-A2s, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, AQo-ATo, KJo+, QJo',
    why: 'You already have a big blind in, so the price is good. Defend with suited hands and pairs, but respect the strength of an early open with offsuit hands.',
  },
  'co-ip': {
    title: 'vs cutoff open, on the button',
    raise: 'TT+, AJs+, KQs, AQo+, A5s-A4s, 76s',
    call: '99-22, ATs-A6s, KJs-KTs, QTs+, J9s+, T9s, 98s, 87s, AJo, KQo',
    why: 'A cutoff open is wide. 3-bet more for value, and call with hands that play well in position.',
  },
  'co-sb': {
    title: 'vs cutoff open, small blind',
    raise: '99+, ATs+, KTs+, QJs, AJo+, KQo, A5s-A4s',
    call: '',
    why: '3-bet or fold from the small blind: a big 3-bet takes the initiative and isolates the opener.',
  },
  'co-bb': {
    title: 'vs cutoff open, big blind',
    raise: 'TT+, AJs+, KQs, AQo+, A5s-A3s',
    call: '99-22, ATs-A2s, KJs-K6s, Q8s+, J8s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, AJo-A8o, KTo+, QTo+, JTo, T9o',
    why: 'Getting a good price against a wide range: defend widely, especially suited hands.',
  },
  'btn-sb': {
    title: 'vs button open, small blind',
    raise: '77+, A8s+, K9s+, QTs+, JTs, ATo+, KJo+, A5s-A2s',
    call: '',
    why: 'Button opens are very wide. 3-bet a big range from the small blind; flatting leaves you squeezed between two players.',
  },
  'btn-bb': {
    title: 'vs button open, big blind',
    raise: '99+, ATs+, KJs+, AJo+, KQo, A5s-A2s, 87s, 76s',
    call: '88-22, A9s-A6s, KTs-K2s, QJs-Q5s, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, 43s, ATo-A2o, KJo-K8o, Q9o+, J9o+, T8o+, 98o, 87o',
    why: 'You close the action with a great price against the widest opening range. Defend a lot of hands.',
  },
  'sb-bb': {
    title: 'vs small blind open, big blind',
    raise: '88+, ATs+, KTs+, QJs, AJo+, KQo, A5s-A2s, 76s, 65s',
    call: '77-22, A9s-A6s, K9s-K2s, QTs-Q2s, J5s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, ATo-A2o, KJo-K5o, Q8o+, J8o+, T8o+, 97o+, 87o, 76o',
    why: 'The small blind opens very wide and you have position after the flop. Defend most of your hands and 3-bet aggressively.',
  },
};

const openerGroup = (p: Pos): OpenerGroup => (p === 'UTG' || p === 'HJ' ? 'early' : p === 'CO' ? 'co' : p === 'BTN' ? 'btn' : 'sb');
const heroKind = (p: Pos): HeroKind => (p === 'BB' ? 'bb' : p === 'SB' ? 'sb' : 'ip');

const vsOpenCache = new Map<string, Chart>();
/** Chart for facing a single raise from `opener` while sitting in `hero` (who acts later). */
export function vsOpenChart(opener: Pos, hero: Pos): Chart {
  let g = openerGroup(opener);
  let k = heroKind(hero);
  if (g === 'btn' && k === 'ip') k = 'sb'; // cannot happen at 6-max; keep total
  if (g === 'sb') k = 'bb';
  if (!VS_OPEN_SPECS[`${g}-${k}`]) g = 'early';
  const key = `${g}-${k}` as const;
  let c = vsOpenCache.get(key);
  if (!c) {
    const s = VS_OPEN_SPECS[key]!;
    c = makeChart(`vsopen-${key}`, s.title, `Facing a raise, ${s.title.replace('vs ', '')}`, '3-bet', s.raise, s.call, s.why);
    vsOpenCache.set(key, c);
  }
  return c;
}

export type ThreeBetter = 'tight' | 'standard' | 'light';
export const THREE_BETTER_LABEL: Record<ThreeBetter, string> = { tight: 'a tight 3-bettor (about 3%)', standard: 'a standard 3-bettor (about 7%)', light: 'a light 3-bettor (11% or more)' };

const VS3_SPECS: Record<ThreeBetter, { raise: string; call: string; why: string }> = {
  tight: {
    raise: 'KK+',
    call: 'QQ-JJ, AKs, AKo, AQs',
    why: 'A 3% 3-bet range is about QQ+ and AK. Only kings and aces are comfortable going all-in; continue with a few strong hands and fold the rest.',
  },
  standard: {
    raise: 'QQ+, AKs, AKo, A5s',
    call: 'JJ-88, AQs-ATs, KQs, KJs, QJs, JTs, T9s, AQo',
    why: 'Against a normal 3-bettor, 4-bet your best hands with A5s as a blocker bluff, and call with pairs and suited hands that play well after the flop.',
  },
  light: {
    raise: 'JJ+, AQs+, AQo+, A5s-A3s',
    call: 'TT-55, AJs-A6s, KTs+, QTs+, J9s+, T9s, 98s, 87s, 76s, AJo, KQo',
    why: 'A light 3-bettor has many bluffs. Fight back: 4-bet wider for value and continue with more of your opening range.',
  },
};

export const VS3BET: Record<ThreeBetter, Chart> = Object.fromEntries(
  (Object.keys(VS3_SPECS) as ThreeBetter[]).map((t) => [t, makeChart(`vs3bet-${t}`, `vs 3-bet: ${t}`, `You opened and face ${THREE_BETTER_LABEL[t]}`, '4-bet', VS3_SPECS[t].raise, VS3_SPECS[t].call, VS3_SPECS[t].why)]),
) as Record<ThreeBetter, Chart>;

export const threeBetterOf = (threeBetPct: number): ThreeBetter => (threeBetPct <= 4 ? 'tight' : threeBetPct < 9 ? 'standard' : 'light');

export const VS4BET: Record<'tight' | 'loose', Chart> = {
  tight: makeChart('vs4bet-tight', 'vs 4-bet', 'You 3-bet and face a 4-bet', 'All-in', 'KK+, AKs', 'QQ', 'A 4-bet from a normal player is very strong. Get it in with kings, aces and AKs; QQ can call; fold the rest.'),
  loose: makeChart('vs4bet-loose', 'vs 4-bet (aggressive player)', 'You 3-bet and face a 4-bet from an aggressive player', 'All-in', 'QQ+, AKs, AKo', 'JJ-TT, AQs', 'Aggressive players 4-bet light. Get it in with QQ+ and AK, and continue with JJ, TT and AQs.'),
};

/** Every chart, for the reference tab. */
export function allCharts(): Chart[] {
  return [
    ...Object.values(RFI),
    ...(Object.keys(VS_OPEN_SPECS) as `${OpenerGroup}-${HeroKind}`[]).map((k) => {
      const [g, h] = k.split('-') as [OpenerGroup, HeroKind];
      const opener: Pos = g === 'early' ? 'UTG' : g === 'co' ? 'CO' : g === 'btn' ? 'BTN' : 'SB';
      const hero: Pos = h === 'bb' ? 'BB' : h === 'sb' ? 'SB' : opener === 'CO' ? 'BTN' : 'CO';
      return vsOpenChart(opener, hero);
    }),
    ...Object.values(VS3BET),
  ];
}

/** Share of all 1326 combos the chart plays with `act` (or any non-fold action). */
export function chartShare(c: Chart, act?: ChartAct): number {
  let n = 0;
  for (const cls of ALL_CLASSES) {
    const a = actOf(c, cls.label);
    if (act ? a === act : a !== 'fold') n += cls.combos;
  }
  return n / 1326;
}

/** Percentile of each class in the strength ordering (0 = best), at the middle of its combos. */
export const PERCENTILE: ReadonlyMap<string, number> = (() => {
  const m = new Map<string, number>();
  let n = 0;
  for (const c of PREFLOP_ORDER) {
    m.set(c.label, (n + c.combos / 2) / 1326);
    n += c.combos;
  }
  return m;
})();

/** Grid neighbours (8 directions) of a class. */
export function neighbours(c: HandClass): HandClass[] {
  return ALL_CLASSES.filter((o) => o !== c && Math.abs(o.row - c.row) <= 1 && Math.abs(o.col - c.col) <= 1);
}

// ---------------------------------------------------------------------------------------------
// Drill spots
// ---------------------------------------------------------------------------------------------

export type DrillKind = 'rfi' | 'vsOpen' | 'vs3bet';

export interface DrillSpot {
  kind: DrillKind;
  hero: Pos;
  villain?: Pos;
  chart: Chart;
  hand: HandClass;
  /** Hole cards to draw. */
  hole: [number, number];
  /** The action before you, one line per seat that acted. */
  story: { pos: Pos; text: string }[];
  raiseLabel: string;
  callLabel: string;
  answer: ChartAct;
  /** Who 3-bet you (vs3bet only). */
  threeBetter?: ThreeBetter;
}

const pickOf = <T,>(rand: () => number, xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

/** Picks a hand: mostly near the chart's edges (where the decisions are), sometimes anything. */
function pickHand(rand: () => number, chart: Chart, pool: readonly HandClass[]): HandClass {
  const inPool = new Set(pool.map((c) => c.label));
  const edge = pool.filter((c) => {
    const a = actOf(chart, c.label);
    return neighbours(c).some((n) => inPool.has(n.label) && actOf(chart, n.label) !== a);
  });
  const src = rand() < 0.75 && edge.length ? edge : pool;
  // Weight by combos so offsuit hands come up as often as they do at the table.
  const total = src.reduce((n, c) => n + c.combos, 0);
  let x = rand() * total;
  for (const c of src) {
    x -= c.combos;
    if (x <= 0) return c;
  }
  return src[src.length - 1];
}

function holeFor(rand: () => number, c: HandClass): [number, number] {
  const s1 = Math.floor(rand() * 4);
  let s2 = c.suited ? s1 : Math.floor(rand() * 4);
  while (!c.suited && s2 === s1) s2 = Math.floor(rand() * 4);
  return [(c.hi << 2) | s1, (c.lo << 2) | s2];
}

export function drillSpot(rand: () => number, kind: DrillKind | 'mixed'): DrillSpot {
  const k: DrillKind = kind === 'mixed' ? pickOf(rand, ['rfi', 'rfi', 'vsOpen', 'vsOpen', 'vs3bet'] as const) : kind;
  const story: DrillSpot['story'] = [];
  const folds = (from: number, to: number) => {
    for (let i = from; i < to; i++) story.push({ pos: POSITIONS[i], text: 'folds' });
  };
  if (k === 'rfi') {
    const hero = pickOf(rand, ['UTG', 'HJ', 'CO', 'BTN', 'SB'] as const);
    folds(0, POSITIONS.indexOf(hero));
    const chart = RFI[hero];
    const hand = pickHand(rand, chart, ALL_CLASSES);
    return { kind: k, hero, chart, hand, hole: holeFor(rand, hand), story, raiseLabel: `Raise to $${hero === 'SB' ? 6 : 5}`, callLabel: '', answer: actOf(chart, hand.label) };
  }
  if (k === 'vsOpen') {
    const oi = Math.floor(rand() * 5);
    const hi = oi + 1 + Math.floor(rand() * (5 - oi));
    const opener = POSITIONS[oi];
    const hero = POSITIONS[hi];
    const open = opener === 'SB' ? 6 : 5;
    folds(0, oi);
    story.push({ pos: opener, text: `raises to $${open}` });
    folds(oi + 1, hi);
    const chart = vsOpenChart(opener, hero);
    const hand = pickHand(rand, chart, ALL_CLASSES);
    const ip = hero === 'BB' ? opener === 'SB' : hero !== 'SB';
    const owe = open - (hero === 'BB' ? 2 : hero === 'SB' ? 1 : 0);
    return { kind: k, hero, villain: opener, chart, hand, hole: holeFor(rand, hand), story, raiseLabel: `3-bet to $${open * (ip ? 3 : 4)}`, callLabel: `Call $${owe}`, answer: actOf(chart, hand.label) };
  }
  const hi = Math.floor(rand() * 5);
  const hero = POSITIONS[hi] as Exclude<Pos, 'BB'>;
  const vi = hi + 1 + Math.floor(rand() * (5 - hi));
  const villain = POSITIONS[vi];
  const tb = pickOf(rand, ['tight', 'standard', 'standard', 'light'] as const);
  const open = hero === 'SB' ? 6 : 5;
  const three = open * (villain === 'SB' || villain === 'BB' ? 4 : 3);
  folds(0, hi);
  story.push({ pos: hero, text: `you raise to $${open}` });
  folds(hi + 1, vi);
  story.push({ pos: villain, text: `3-bets to $${three}` });
  const chart = VS3BET[tb];
  const opening = ALL_CLASSES.filter((c) => actOf(RFI[hero], c.label) === 'raise');
  const hand = pickHand(rand, chart, opening);
  return {
    kind: k,
    hero,
    villain,
    chart,
    hand,
    hole: holeFor(rand, hand),
    story,
    raiseLabel: `4-bet to $${Math.round(three * 2.3)}`,
    callLabel: `Call $${three - open}`,
    answer: actOf(chart, hand.label),
    threeBetter: tb,
  };
}

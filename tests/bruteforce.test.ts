/**
 * Independent brute-force reference implementation (plain recursion, no multiset formula,
 * no memo keys, no dominance shortcut) used to validate the optimised engine.
 */
import { describe, expect, it } from 'vitest';
import { fullShoe, INFINITE_PROBS, type Rank } from '../src/engine/cards';
import { EVEngine } from '../src/engine/ev';
import { DEFAULT_RULES, type Rules } from '../src/engine/rules';

type Shoe = number[] | null; // null = infinite

function prob(s: Shoe, r: number): number {
  if (!s) return INFINITE_PROBS[r];
  const n = s.reduce((a, b) => a + b, 0);
  return s[r] / n;
}

function dealerDist(up: Rank, h17: boolean, s: Shoe): number[] {
  const out = [0, 0, 0, 0, 0, 0, 0];
  const rec = (hard: number, ace: boolean, k: number, p: number, sh: Shoe) => {
    const soft = ace && hard <= 11;
    const total = soft ? hard + 10 : hard;
    if (k === 1 && total === 21) { out[6] += p; return; }
    if (total > 21) { out[5] += p; return; }
    if (total > 17 || (total === 17 && !(soft && h17))) { out[total - 17] += p; return; }
    for (let r = 1; r <= 10; r++) {
      const q = prob(sh, r);
      if (q === 0) continue;
      const next = sh ? sh.slice() : null;
      if (next) next[r]--;
      rec(hard + r, ace || r === 1, k + 1, p * q, next);
    }
  };
  rec(up, up === 1, 0, 1, s);
  return out;
}

/** E[payoff | no dealer BJ] for standing (peek game). */
function standCond(total: number, up: Rank, h17: boolean, s: Shoe): number {
  const d = dealerDist(up, h17, s);
  const z = 1 - d[6];
  let ev = d[5];
  for (let o = 0; o < 5; o++) {
    const t = 17 + o;
    if (total < 17 || t > total) ev -= d[o];
    else if (t < total) ev += d[o];
  }
  return ev / z;
}

/**
 * Exact conditional EV via explicit conditioning on the hole card: average over hole cards h
 * that don't give the dealer BJ, with the player drawing from the shoe minus h.
 * (A completely different route to the same quantity as the engine's J-value trick.)
 */
function bestHSCond(hard: number, ace: boolean, up: Rank, h17: boolean, s: Shoe, depth = 0): number {
  const total = ace && hard <= 11 ? hard + 10 : hard;
  const st = standCond(total, up, h17, s);
  if (total >= 21) return st;
  return Math.max(st, hitCond(hard, ace, up, h17, s, depth));
}
function hitCond(hard: number, ace: boolean, up: Rank, h17: boolean, s: Shoe, depth = 0): number {
  // P(next card = r | no dealer BJ) computed by summing over the hole card.
  const bjNeed = up === 1 ? 10 : up === 10 ? 1 : 0;
  let ev = 0;
  for (let r = 1; r <= 10; r++) {
    let pr: number;
    if (!s) pr = INFINITE_PROBS[r];
    else if (!bjNeed) pr = prob(s, r);
    else {
      const n = s.reduce((a, b) => a + b, 0);
      const z = 1 - s[bjNeed] / n;
      pr = 0;
      for (let h = 1; h <= 10; h++) {
        if (h === bjNeed || s[h] === 0) continue;
        const ph = s[h] / n / z;
        const left = s[r] - (h === r ? 1 : 0);
        pr += ph * (left / (n - 1));
      }
    }
    if (pr === 0) continue;
    const next = s ? s.slice() : null;
    if (next) next[r]--;
    const nh = hard + r;
    ev += pr * (nh > 21 ? -1 : bestHSCond(nh, ace || r === 1, up, h17, next, depth + 1));
  }
  return ev;
}
function doubleCond(hard: number, ace: boolean, up: Rank, h17: boolean, s: Shoe): number {
  let ev = 0;
  for (let r = 1; r <= 10; r++) {
    const pr = prob(s, r); // for 2-9 upcards only in this test
    if (pr === 0) continue;
    const next = s ? s.slice() : null;
    if (next) next[r]--;
    const nh = hard + r;
    const t = (ace || r === 1) && nh <= 11 ? nh + 10 : nh;
    ev += pr * (nh > 21 ? -1 : standCond(t, up, h17, next));
  }
  return 2 * ev;
}

function removeFrom(s: Shoe, cards: number[]): Shoe {
  if (!s) return null;
  const o = s.slice();
  for (const c of cards) o[c]--;
  return o;
}

describe('engine vs brute force', () => {
  const cases: { cards: Rank[]; up: Rank }[] = [
    { cards: [1, 2], up: 5 },
    { cards: [1, 4], up: 4 },
    { cards: [10, 6], up: 10 },
    { cards: [9, 3], up: 2 },
    { cards: [1, 7], up: 9 },
    { cards: [8, 7], up: 1 },
    { cards: [10, 2], up: 4 },
  ];
  // Infinite deck: every case. Finite decks: the cheaper (high-total) cases keep the suite fast;
  // the full matrix (all cases × 1, 2 decks × S17/H17) was run once and agreed to 1e-10.
  const finiteCases = cases.filter((c) => c.cards[0] + c.cards[1] >= 12 && !c.cards.includes(1));
  for (const decks of [Infinity, 1, 2]) {
    for (const h17 of [false, true]) {
      const rules: Rules = { ...DEFAULT_RULES, decks, hitSoft17: h17, surrender: 'none' };
      const list = Number.isFinite(decks) ? (decks === 1 ? finiteCases : finiteCases.slice(0, 2)) : cases;
      for (const { cards, up } of list) {
        it(`${decks}D ${h17 ? 'H17' : 'S17'} ${cards.join(',')} vs ${up}`, () => {
          const eng = new EVEngine(rules, up);
          const res = eng.analyze(cards, { double: true, split: false, surrender: false });
          const shoe0: Shoe = Number.isFinite(decks) ? removeFrom(fullShoe(decks), [up, ...cards]) : null;
          const hard = cards[0] + cards[1];
          const ace = cards.includes(1);
          const total = ace && hard <= 11 ? hard + 10 : hard;
          expect(res.ev.S!).toBeCloseTo(standCond(total, up, h17, shoe0), 10);
          expect(res.ev.H!).toBeCloseTo(hitCond(hard, ace, up, h17, shoe0), 10);
          if (up !== 1 && up !== 10) expect(res.ev.D!).toBeCloseTo(doubleCond(hard, ace, up, h17, shoe0), 10);
        });
      }
    }
  }
});

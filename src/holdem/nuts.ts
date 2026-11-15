/**
 * Board reading ("what's the nuts?"): everything a player can hold on a given board.
 *
 * For a board of 3–5 cards it finds, over every two-card holding a player could have:
 *   - which strong hand types are possible (straight flush, quads, full house, flush, straight),
 *   - every straight, with the hole ranks it needs,
 *   - every straight flush, flush and four-of-a-kind, with the cards they need,
 *   - the nuts (the best possible hand) and exactly which holdings make it.
 *
 * It also grades a player's free-form answers: hole-card shorthand like "AhKh", "A♥ x♥", "TJ",
 * "9x" or "99", and lists of straights like "56 6T TJ".
 */
import { liveCards, makeCard, rankName, rankOf, RANK_CHARS, SUIT_SYM, SUIT_WORD, suitOf, cardText, type HCard } from './cards';
import { categoryOf, describeScore, evaluate, FLUSH, FULL_HOUSE, QUADS, STRAIGHT, STRAIGHT_FLUSH, straightHigh, TWO_PAIR } from './evaluate';

/** The hand types the drill asks about, strongest first. */
export const READ_TYPES = [STRAIGHT_FLUSH, QUADS, FULL_HOUSE, FLUSH, STRAIGHT] as const;
export type ReadType = (typeof READ_TYPES)[number];
export const READ_TYPE_NAME: Record<ReadType, string> = {
  [STRAIGHT_FLUSH]: 'Straight flush',
  [QUADS]: 'Four of a kind',
  [FULL_HOUSE]: 'Full house',
  [FLUSH]: 'Flush',
  [STRAIGHT]: 'Straight',
};

/** The five ranks of the straight with this high card (3 = the wheel, A-2-3-4-5). */
export function straightRanks(high: number): number[] {
  return high === 3 ? [3, 2, 1, 0, 12] : [high, high - 1, high - 2, high - 3, high - 4];
}

/** "T-high", "wheel (5-high)". */
export function straightName(high: number): string {
  if (high === 3) return 'Wheel (A-2-3-4-5)';
  return `${rankName(high - 4)} to ${rankName(high)}`;
}

/** Ranks as shorthand, highest first: [9, 4] → "T6"-style "96". */
export const ranksText = (rs: readonly number[]): string =>
  [...rs]
    .sort((a, b) => b - a)
    .map((r) => (r === 8 ? 'T' : rankName(r)))
    .join('');

export interface StraightOption {
  high: number;
  /** Hole ranks needed (0, 1 or 2 of them), highest first. Empty: the straight is on the board. */
  need: number[];
}

export interface StraightFlushOption {
  suit: number;
  high: number;
  need: HCard[];
}

export interface FlushInfo {
  suit: number;
  /** Cards of the suit on the board. */
  count: number;
  /** Cards of the suit a player needs (0–2). */
  need: number;
  /** Highest card of the suit not on the board (the nut-flush card), or −1 with no live card of the suit. */
  nutCard: HCard;
}

export interface QuadsOption {
  rank: number;
  /** Cards of the rank a player needs (0–2). */
  need: number;
}

export interface BoardRead {
  board: HCard[];
  /** Hand types a player can end up with as their best hand. */
  possible: Set<ReadType>;
  straights: StraightOption[];
  straightFlushes: StraightFlushOption[];
  flush: FlushInfo | null;
  quads: QuadsOption[];
  /** Ranks that appear more than once on the board. */
  pairedRanks: number[];
  /** The nuts as a key (see nutKey), its name, and every holding that makes it. */
  nutKey: number;
  nutName: string;
  nutCombos: [HCard, HCard][];
  /** Short descriptions of the nut holdings ("A♥ + any heart", "TJ"). */
  nutText: string[];
}

/**
 * Drops the kickers that poker players ignore when they say "the nuts": an ace-high flush is the
 * nut flush whatever its other cards, a jack-high straight is one hand. Kept: the category and the
 * ranks that name the hand (one slot, two for full houses and two pair).
 */
export function nutKey(score: number): number {
  const cat = categoryOf(score);
  const slots = cat === FULL_HOUSE || cat === TWO_PAIR ? 2 : 1;
  const keep = 0xf00000 | (slots === 2 ? 0x0ff000 : 0x0f0000);
  return score & keep;
}

/** A readable name for a nut key ("Flush, ace high", "Four kings"). */
export function nutKeyName(key: number): string {
  const cat = categoryOf(key);
  const s = describeScore(key);
  if (cat === FLUSH) return s.replace('Flush, ', '').replace(/^./, (c) => c.toUpperCase()) + ' flush';
  return s;
}

export function readBoard(board: readonly HCard[]): BoardRead {
  const b = [...board];
  const rankCount = new Array<number>(13).fill(0);
  const suitCards: number[][] = [[], [], [], []];
  let mask = 0;
  for (const c of b) {
    rankCount[rankOf(c)]++;
    suitCards[suitOf(c)].push(rankOf(c));
    mask |= 1 << rankOf(c);
  }

  // Straights: every five-rank window with at most two ranks missing from the board.
  const straights: StraightOption[] = [];
  for (let high = 12; high >= 3; high--) {
    const need = straightRanks(high).filter((r) => !(mask & (1 << r)));
    // Skip windows whose cards always make a higher straight (3-4 on 5-6-7-8 makes the 8-high).
    if (need.length <= 2 && straightHigh(need.reduce((m, r) => m | (1 << r), mask)) === high) straights.push({ high, need: need.sort((x, y) => y - x) });
  }

  const straightFlushes: StraightFlushOption[] = [];
  for (let s = 0; s < 4; s++) {
    if (suitCards[s].length < 3) continue;
    const sm = suitCards[s].reduce((m, r) => m | (1 << r), 0);
    for (let high = 12; high >= 3; high--) {
      const need = straightRanks(high).filter((r) => !(sm & (1 << r)));
      if (need.length <= 2 && straightHigh(need.reduce((m, r) => m | (1 << r), sm)) === high) straightFlushes.push({ suit: s, high, need: need.sort((x, y) => y - x).map((r) => makeCard(r, s)) });
    }
  }

  let flush: FlushInfo | null = null;
  for (let s = 0; s < 4; s++) {
    const n = suitCards[s].length;
    if (n >= 3) {
      let nutCard = -1;
      for (let r = 12; r >= 0; r--)
        if (!suitCards[s].includes(r)) {
          nutCard = makeCard(r, s);
          break;
        }
      flush = { suit: s, count: n, need: Math.max(0, 5 - n), nutCard };
    }
  }

  const pairedRanks: number[] = [];
  const quads: QuadsOption[] = [];
  for (let r = 12; r >= 0; r--) {
    if (rankCount[r] >= 2) {
      pairedRanks.push(r);
      quads.push({ rank: r, need: 4 - rankCount[r] });
    }
  }

  // Every holding a player could have: which hand types occur, and which hands are the nuts.
  const live = liveCards(b);
  const hand = [...b, 0, 0];
  const n = b.length;
  const possible = new Set<ReadType>();
  let best = -1;
  let combos: [HCard, HCard][] = [];
  for (let i = 0; i < live.length; i++) {
    hand[n] = live[i];
    for (let j = i + 1; j < live.length; j++) {
      hand[n + 1] = live[j];
      const sc = evaluate(hand, n + 2);
      const cat = categoryOf(sc);
      if (cat >= STRAIGHT) possible.add(cat as ReadType);
      const k = nutKey(sc);
      if (k > best) {
        best = k;
        combos = [[live[i], live[j]]];
      } else if (k === best) combos.push([live[i], live[j]]);
    }
  }

  return {
    board: b,
    possible,
    straights,
    straightFlushes,
    flush,
    quads,
    pairedRanks,
    nutKey: best,
    nutName: nutKeyName(best),
    nutCombos: combos,
    nutText: describeHoldings(combos, b),
  };
}

// ---------------------------------------------------------------------------------------------
// Describing a set of holdings
// ---------------------------------------------------------------------------------------------

const comboId = (a: HCard, b: HCard) => (a < b ? a * 52 + b : b * 52 + a);
const RANK_SHORT = (r: number) => (r === 8 ? 'T' : rankName(r));

/**
 * Describes a set of two-card holdings compactly: "A♥ + any heart", "9 + any card", "TJ", "K♠Q♠".
 * Patterns are tried from the widest down, so the list stays short.
 */
export function describeHoldings(combos: readonly [HCard, HCard][], board: readonly HCard[]): string[] {
  const live = liveCards(board);
  const left = new Set(combos.map(([a, b]) => comboId(a, b)));
  const out: string[] = [];
  const has = (a: HCard, b: HCard) => left.has(comboId(a, b));
  const take = (pairs: [HCard, HCard][]) => pairs.forEach(([a, b]) => left.delete(comboId(a, b)));
  const pairsWith = (c: HCard, partners: HCard[]) => partners.filter((p) => p !== c).map((p) => [c, p] as [HCard, HCard]);

  // 1. A rank plus any card ("9 + any card"), then a single card plus any card ("A♥ + any card").
  for (let r = 12; r >= 0; r--) {
    const cards = live.filter((c) => rankOf(c) === r);
    if (!cards.length) continue;
    const pairs = cards.flatMap((c) => pairsWith(c, live));
    if (pairs.every(([a, b]) => has(a, b))) {
      out.push(`${RANK_SHORT(r)} + any card`);
      take(pairs);
    }
  }
  for (const c of live) {
    const pairs = pairsWith(c, live);
    if (pairs.length && pairs.every(([a, b]) => has(a, b))) {
      out.push(`${cardText(c)} + any card`);
      take(pairs);
    }
  }
  // 2. A single card plus any card of a suit ("A♥ + any heart").
  for (const c of [...live].sort((x, y) => y - x)) {
    for (let s = 0; s < 4; s++) {
      const pairs = pairsWith(
        c,
        live.filter((p) => suitOf(p) === s),
      );
      if (pairs.length >= 2 && pairs.every(([a, b]) => has(a, b))) {
        out.push(`${cardText(c)} + any ${SUIT_WORD[s].slice(0, -1)}`);
        take(pairs);
      }
    }
  }
  // 3. Rank pairs with any suits ("TJ", "99"), then the single holdings left ("K♠Q♠").
  for (let hi = 12; hi >= 0; hi--) {
    for (let lo = hi; lo >= 0; lo--) {
      const pairs: [HCard, HCard][] = [];
      for (const a of live) for (const b of live) if (a < b && ((rankOf(a) === hi && rankOf(b) === lo) || (rankOf(a) === lo && rankOf(b) === hi))) pairs.push([a, b]);
      if (pairs.length && pairs.some(([a, b]) => has(a, b)) && pairs.every(([a, b]) => has(a, b))) {
        out.push(RANK_SHORT(hi) + RANK_SHORT(lo));
        take(pairs);
      }
    }
  }
  const rest = combos.filter(([a, b]) => left.has(comboId(a, b))).map(([a, b]) => (a > b ? [a, b] : [b, a]) as [HCard, HCard]);
  rest.sort((x, y) => y[0] - x[0] || y[1] - x[1]);
  for (const [a, b] of rest) out.push(cardText(a) + cardText(b));
  return out;
}

// ---------------------------------------------------------------------------------------------
// Parsing the player's answers
// ---------------------------------------------------------------------------------------------

const SUIT_INPUT: Record<string, number> = { s: 0, h: 1, d: 2, c: 3, '♠': 0, '♥': 1, '♦': 2, '♣': 3, '♤': 0, '♡': 1, '♢': 2, '♧': 3 };

/** One card of a holding as the player wrote it: a rank and/or a suit, either may be "any". */
export interface CardSpec {
  rank: number | null;
  suit: number | null;
}

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\bany\b|\banything\b|\bcard\b|\bof\b|\band\b/g, ' x ')
    .replace(/10/g, 't')
    .replace(/[\s,+/&-]+/g, ' ')
    .trim();
}

/**
 * Parses hole-card shorthand into one or two card specs. Accepts "AhKh", "A♥ K♥", "AhXh", "A♥ x♥",
 * "Ah" or "Ah x" (the ace of hearts and any card), "TJ", "10J", "99", "9x".
 */
export function parseHolding(raw: string): CardSpec[] | null {
  const t = normalize(raw).replace(/\s+/g, '');
  if (!t) return null;
  const specs: CardSpec[] = [];
  let i = 0;
  while (i < t.length) {
    const ch = t[i];
    let rank: number | null;
    if (ch === 'x' || ch === '*' || ch === '?') rank = null;
    else {
      const r = RANK_CHARS.toLowerCase().indexOf(ch);
      if (r < 0) {
        // A bare suit ("♥" = any heart).
        if (ch in SUIT_INPUT) {
          specs.push({ rank: null, suit: SUIT_INPUT[ch] });
          i++;
          continue;
        }
        return null;
      }
      rank = r;
    }
    i++;
    let suit: number | null = null;
    if (i < t.length && t[i] in SUIT_INPUT) {
      suit = SUIT_INPUT[t[i]];
      i++;
    }
    specs.push({ rank, suit });
  }
  if (specs.length === 1) specs.push({ rank: null, suit: null });
  return specs.length === 2 ? specs : null;
}

const matches = (c: HCard, s: CardSpec) => (s.rank === null || rankOf(c) === s.rank) && (s.suit === null || suitOf(c) === s.suit);

/** Every concrete holding (live cards only) that fits the specs. */
export function expandHolding(specs: readonly CardSpec[], board: readonly HCard[]): [HCard, HCard][] {
  const live = liveCards(board);
  const seen = new Set<number>();
  const out: [HCard, HCard][] = [];
  for (const a of live) {
    if (!matches(a, specs[0])) continue;
    for (const b of live) {
      if (a === b || !matches(b, specs[1])) continue;
      const id = comboId(a, b);
      if (seen.has(id)) continue;
      seen.add(id);
      out.push([a, b]);
    }
  }
  return out;
}

export function specText(s: readonly CardSpec[]): string {
  return s
    .map((c) => (c.rank === null ? (c.suit === null ? 'any card' : `any ${SUIT_WORD[c.suit].slice(0, -1)}`) : RANK_SHORT(c.rank) + (c.suit === null ? '' : SUIT_SYM[c.suit])))
    .join(' + ');
}

export interface NutGrade {
  ok: boolean;
  /** What the player's holding makes (or why it could not be read). */
  said: string;
  note: string;
}

export function gradeNuts(read: BoardRead, raw: string): NutGrade {
  const specs = parseHolding(raw);
  if (!specs) return { ok: false, said: raw.trim() || '(blank)', note: 'Could not read that holding. Write it like AhKh, A♥ x♥, TJ, 9x or 99.' };
  const combos = expandHolding(specs, read.board);
  if (!combos.length) return { ok: false, said: specText(specs), note: 'No live cards fit that: they are on the board.' };
  const hand = [...read.board, 0, 0];
  const n = read.board.length;
  const keys = combos.map(([a, b]) => {
    hand[n] = a;
    hand[n + 1] = b;
    return nutKey(evaluate(hand, n + 2));
  });
  const worst = Math.min(...keys);
  const bestK = Math.max(...keys);
  if (worst === read.nutKey) {
    const all = combos.length === read.nutCombos.length;
    return {
      ok: true,
      said: `${specText(specs)} → ${read.nutName}`,
      note: all ? '' : `Also the nuts: ${read.nutText.join(', ')}.`,
    };
  }
  if (bestK === read.nutKey)
    return { ok: false, said: `${specText(specs)} → sometimes ${read.nutName}`, note: `Some of those holdings only make ${nutKeyName(worst).toLowerCase()}. Be exact: the nuts are ${read.nutText.join(', ')}.` };
  return { ok: false, said: `${specText(specs)} → ${nutKeyName(bestK)}`, note: `That is not the best possible hand.` };
}

/** A straight the player listed, after reading it. */
export interface StraightClaim {
  raw: string;
  ranks: number[];
  /** High card of the best straight it makes, or −1. */
  high: number;
  /** Ranks in the claim the straight does not need. */
  extra: number[];
  error?: string;
}

/** Reads a list of straights: "56 6T TJ", "5-6, 6/10, J T", "9" (a nine and any card), "board". */
export function parseStraights(raw: string, read: BoardRead): StraightClaim[] {
  const t = raw
    .toLowerCase()
    .replace(/10/g, 't')
    .replace(/(?<=[2-9tjqka])-(?=[2-9tjqka])/g, '')
    .replace(/(?<=[2-9tjqka])\/(?=[2-9tjqka])/g, '');
  const tokens = t.split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 1 && /^(none|no|nothing|-|0)$/.test(tokens[0])) return [];
  const mask = read.board.reduce((m, c) => m | (1 << rankOf(c)), 0);
  const out: StraightClaim[] = [];
  for (const tok of tokens) {
    if (tok === 'board') {
      const h = straightHigh(mask);
      out.push({ raw: tok, ranks: [], high: h, extra: [], error: h < 0 ? 'There is no straight on the board.' : undefined });
      continue;
    }
    const ranks: number[] = [];
    let bad = false;
    for (const ch of tok.replace(/x/g, '')) {
      const r = RANK_CHARS.toLowerCase().indexOf(ch);
      if (r < 0) bad = true;
      else ranks.push(r);
    }
    if (bad || ranks.length === 0 || ranks.length > 2) {
      out.push({ raw: tok, ranks, high: -1, extra: [], error: `Could not read "${tok}": write the one or two hole ranks the straight needs, like 56 or 9.` });
      continue;
    }
    const m = ranks.reduce((acc, r) => acc | (1 << r), mask);
    const high = straightHigh(m);
    const opt = read.straights.find((s) => s.high === high);
    const extra = opt ? ranks.filter((r) => !opt.need.includes(r)) : [];
    out.push({ raw: tok, ranks, high, extra, error: high < 0 ? `${ranksText(ranks)} does not make a straight here.` : opt && opt.need.length === 0 && extra.length === ranks.length ? `${ranksText(ranks)} only plays the straight on the board.` : undefined });
  }
  return out;
}

export interface StraightGrade {
  ok: boolean;
  found: number[];
  missed: StraightOption[];
  wrong: StraightClaim[];
  loose: StraightClaim[];
}

export function gradeStraights(read: BoardRead, raw: string): StraightGrade {
  const claims = parseStraights(raw, read);
  const found = new Set<number>();
  const wrong: StraightClaim[] = [];
  const loose: StraightClaim[] = [];
  for (const c of claims) {
    if (c.error) wrong.push(c);
    else {
      found.add(c.high);
      if (c.extra.length) loose.push(c);
    }
  }
  const missed = read.straights.filter((s) => !found.has(s.high));
  return { ok: missed.length === 0 && wrong.length === 0, found: [...found], missed, wrong, loose };
}

export interface TypeGrade {
  ok: boolean;
  missed: ReadType[];
  wrong: ReadType[];
}

export function gradeTypes(read: BoardRead, said: ReadonlySet<ReadType>): TypeGrade {
  const missed = READ_TYPES.filter((t) => read.possible.has(t) && !said.has(t));
  const wrong = READ_TYPES.filter((t) => !read.possible.has(t) && said.has(t));
  return { ok: !missed.length && !wrong.length, missed, wrong };
}

/** One line on why a hand type is or is not possible on this board. */
export function typeReason(read: BoardRead, t: ReadType): string {
  const yes = read.possible.has(t);
  const sw = (s: number) => SUIT_WORD[s];
  switch (t) {
    case STRAIGHT_FLUSH: {
      if (!yes) return read.flush ? `The ${sw(read.flush.suit)} on the board are too far apart to fit in one straight with two more.` : 'Needs three cards of one suit on the board.';
      const f = read.straightFlushes[0];
      return `${read.straightFlushes.length > 1 ? `${read.straightFlushes.length} ways; best: ` : ''}${f.need.length ? f.need.map(cardText).join('') : 'on the board'} for ${straightName(f.high).toLowerCase()} in ${sw(f.suit)}.`;
    }
    case QUADS:
      if (!yes) return 'The board is unpaired: quads need a pair on the board and a pocket pair to match.';
      return read.quads.map((q) => (q.need === 0 ? `four ${rankName(q.rank)}s are on the board` : `${RANK_SHORT(q.rank).repeat(q.need)} makes four ${rankName(q.rank)}s`)).join('; ') + '.';
    case FULL_HOUSE:
      if (!yes) return read.pairedRanks.length ? 'Quads on the board play for everyone, so no one is left with a full house.' : 'The board is unpaired: a full house needs a pair (or trips) on the board.';
      return `The board pairs ${read.pairedRanks.map((r) => `${rankName(r)}s`).join(' and ')}: trips plus a pair is possible.`;
    case FLUSH:
      if (!read.flush) return 'No suit has three cards on the board.';
      if (!yes) return 'A straight flush is on the board, so no one ends with a plain flush.';
      return `${read.flush.count} ${sw(read.flush.suit)} on the board: ${read.flush.need === 0 ? 'the flush is on the board' : read.flush.need === 1 ? `any one ${SUIT_SYM[read.flush.suit]} makes it` : `two ${SUIT_SYM[read.flush.suit]} make it`}.`;
    case STRAIGHT:
      if (!yes) return read.straights.length ? 'A straight is possible but every straight is beaten for everyone holding it.' : 'No five-rank window has three board cards in it.';
      return `${read.straights.length} different straight${read.straights.length === 1 ? '' : 's'}.`;
  }
  return '';
}

// ---------------------------------------------------------------------------------------------
// Dealing boards
// ---------------------------------------------------------------------------------------------

export type Texture = 'any' | 'busy';

/** How many of flush-possible, straight-possible and paired a board has (0–3). */
export function busyness(read: BoardRead): number {
  return (read.flush ? 1 : 0) + (read.straights.length ? 1 : 0) + (read.pairedRanks.length ? 1 : 0);
}

export function dealRead(rand: () => number, size: 3 | 4 | 5, texture: Texture): BoardRead {
  for (let tries = 0; ; tries++) {
    const deck = Array.from({ length: 52 }, (_, i) => i);
    for (let i = 51; i > 51 - size; i--) {
      const j = Math.floor(rand() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    const board = deck.slice(52 - size);
    const read = readBoard(board);
    if (texture === 'any' || tries > 200 || busyness(read) >= 2) return read;
  }
}

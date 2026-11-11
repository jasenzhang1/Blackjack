/** Play-table sessions: the bot lineup, seat positions, graded decisions and saved report cards. */
import { load, save } from '../state/storage';
import type { Pos } from './preflop';
import { PROFILE_IDS, type ProfileId } from './profiles';
import type { Street } from './table';

export type CoachMode = 'off' | 'ask' | 'warn' | 'always';
export const COACH_LABEL: Record<CoachMode, string> = { off: 'Off', ask: 'On request', warn: 'Warn on mistakes', always: 'Always on' };

export interface Bot {
  name: string;
  profile: ProfileId;
}

const NAMES = ['Ava', 'Bruno', 'Chen', 'Dara', 'Eli'];

/** Five bots: one of each type, or five of one type. Seat i + 1 holds bot i. */
export function makeLineup(kind: 'mixed' | ProfileId, rand: () => number): Bot[] {
  const types = kind === 'mixed' ? [...PROFILE_IDS] : PROFILE_IDS.map(() => kind);
  for (let i = types.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [types[i], types[j]] = [types[j], types[i]];
  }
  return types.map((profile, i) => ({ name: NAMES[i], profile }));
}

/** Position of each of the six seats (0 = you) when the button is on seat `button`. */
export function seatPositions(button: number): Pos[] {
  const order: Pos[] = ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
  const out: Pos[] = new Array(6);
  for (let k = 0; k < 6; k++) out[(button + k) % 6] = order[k];
  return out;
}

export interface Decision {
  hand: number;
  street: Street;
  preflop: boolean;
  /** Hero's cards and the board, as text. */
  cards: string;
  board: string;
  spot: string;
  chose: string;
  best: string;
  ok: boolean;
  /** Postflop: coach's EV of the best option minus the chosen one, in dollars. */
  evLoss: number;
  opponent: string;
}

export interface PlayReport {
  id: string;
  start: number;
  end: number;
  hands: number;
  net: number;
  coach: CoachMode;
  lineup: string;
  decisions: Decision[];
}

export function summarize(r: PlayReport) {
  const pre = r.decisions.filter((d) => d.preflop);
  const post = r.decisions.filter((d) => !d.preflop);
  const all = r.decisions.length;
  const ok = r.decisions.filter((d) => d.ok).length;
  const acc = all ? ok / all : 1;
  const grade = acc >= 0.95 ? 'A' : acc >= 0.88 ? 'B' : acc >= 0.78 ? 'C' : acc >= 0.65 ? 'D' : 'F';
  return {
    pre: { n: pre.length, ok: pre.filter((d) => d.ok).length },
    post: { n: post.length, ok: post.filter((d) => d.ok).length },
    evLost: post.reduce((s, d) => s + d.evLoss, 0),
    acc,
    grade,
    bb100: r.hands ? (r.net / 2 / r.hands) * 100 : 0,
  };
}

export function saveReport(r: PlayReport): void {
  const list = load<PlayReport[]>('holdemSessions', []);
  const i = list.findIndex((x) => x.id === r.id);
  if (i >= 0) list[i] = r;
  else list.push(r);
  save('holdemSessions', list.slice(-40));
}

export function listReports(): PlayReport[] {
  return load<PlayReport[]>('holdemSessions', []).sort((a, b) => b.end - a.end);
}

export function deleteReport(id: string): void {
  save(
    'holdemSessions',
    load<PlayReport[]>('holdemSessions', []).filter((r) => r.id !== id),
  );
}

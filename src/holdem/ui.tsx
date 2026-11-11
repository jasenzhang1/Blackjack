/** Shared UI for the Hold'em training rooms: the table, range grid, step runner and room shell. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PlayingCard } from '../components/PlayingCard';
import { fmtMoney, useKeys } from '../components/ui';
import { mulberry32, randomSeed, type RNG } from '../engine/rng';
import { Link } from '../router';
import { toPlaying, type HCard } from './cards';
import { GROUP_COLOR, GROUP_LABEL, GROUPS, type HandGroup, type Profile } from './profiles';
import { recordSpot, roomStats, type RoomId, type RoomStats } from './progress';
import { ALL_CLASSES } from './ranges';

export function HCards({ cards, size, slots = 0 }: { cards: readonly HCard[]; size?: 'xs' | 'sm' | 'lg'; slots?: number }) {
  const ghosts = Math.max(0, slots - cards.length);
  return (
    <div className="hand spread">
      {cards.map((c) => (
        <PlayingCard key={c} card={toPlaying(c)} size={size} />
      ))}
      {Array.from({ length: ghosts }, (_, i) => (
        <PlayingCard key={`g${i}`} card={null} size={size} />
      ))}
    </div>
  );
}

export function Avatar({ profile }: { profile: Profile }) {
  return (
    <span className="avatar" style={{ background: profile.color }} aria-hidden>
      {profile.name[0]}
    </span>
  );
}

/** A heads-up table: villain on top, board and pot in the middle, hero at the bottom. */
export function PokerTable({
  board,
  hero,
  heroNote,
  profile,
  action,
  bet,
  pot,
  stack,
}: {
  board: readonly HCard[];
  hero?: readonly HCard[];
  heroNote?: ReactNode;
  profile: Profile;
  action?: ReactNode;
  bet?: number;
  pot: number;
  stack?: number;
}) {
  return (
    <div className="ptable">
      <div className="pseat villain">
        <div className="nameplate">
          <Avatar profile={profile} />
          {profile.name}
          <span className="muted">· {profile.short}</span>
        </div>
        <div className="hand spread">
          <PlayingCard faceDown card={toPlaying(0)} size="sm" />
          <PlayingCard faceDown card={toPlaying(1)} size="sm" />
        </div>
        {action && <div className="paction">{action}</div>}
        {bet ? <div className="pbet">{fmtMoney(bet)}</div> : null}
      </div>
      <div className="pmid">
        <HCards cards={board} slots={5} />
        <div className="ppot">
          Pot <strong>{fmtMoney(pot)}</strong>
          {stack !== undefined && <span className="muted"> · stacks behind {fmtMoney(stack)}</span>}
        </div>
      </div>
      {hero && (
        <div className="pseat hero">
          <HCards cards={hero} size="lg" />
          {heroNote && <div className="pnote">{heroNote}</div>}
        </div>
      )}
    </div>
  );
}

/** 13×13 starting-hand grid shaded by the share of each cell's combos in the range. */
export function RangeGrid({ weights, caption }: { weights: Map<string, number>; caption?: ReactNode }) {
  return (
    <figure className="rgrid-wrap">
      <div className="rgrid" role="table" aria-label="Range grid">
        {ALL_CLASSES.map((c) => {
          const w = weights.get(c.label) ?? 0;
          const a = w > 0 ? 0.18 + 0.82 * Math.min(1, w) : 0;
          return (
            <div
              key={c.label}
              role="cell"
              className={`rcell ${a > 0.55 ? 'dark' : ''} ${w === 0 ? 'out' : ''}`}
              style={a ? { background: `rgba(233, 185, 73, ${a.toFixed(3)})` } : undefined}
              title={`${c.label}: ${Math.round(w * 100)}% of combos`}
            >
              {c.label}
            </div>
          );
        })}
      </div>
      {caption && <figcaption className="small muted">{caption}</figcaption>}
    </figure>
  );
}

/** Share of a range in each hand group, as labelled bars. */
export function GroupBars({ shares, highlight }: { shares: Record<HandGroup, number>; highlight?: HandGroup }) {
  const max = Math.max(...GROUPS.map((g) => shares[g]), 0.0001);
  return (
    <div className="gbars">
      {GROUPS.map((g) => (
        <div key={g} className={`gbar ${g === highlight ? 'hl' : ''}`}>
          <span className="lbl">
            <span className="sw" style={{ background: GROUP_COLOR[g] }} />
            {GROUP_LABEL[g]}
          </span>
          <span className="track">
            <span style={{ width: `${(shares[g] / max) * 100}%`, background: GROUP_COLOR[g] }} />
          </span>
          <span className="val num">{(shares[g] * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------------------------

export interface StepResult {
  ok: boolean;
  /** The correct answer, shown after grading. */
  answer: ReactNode;
  note?: ReactNode;
}

export type StepInput = { kind: 'number'; unit: '%' | '$' | 'outs' | 'combos' } | { kind: 'choice'; options: { value: string; label: ReactNode }[] };

export interface Step {
  key: string;
  prompt: ReactNode;
  input: StepInput;
  grade: (raw: string) => StepResult;
}

/** Parses "28.6", "28.6%" or "0.286" as a fraction (0.286). */
export function parsePercent(raw: string): number | null {
  const t = raw.replace(/[%\s,]/g, '');
  if (!t) return null;
  const v = Number(t);
  if (!Number.isFinite(v)) return null;
  return !raw.includes('%') && v > 0 && v < 1 && t.includes('.') ? v : v / 100;
}

export function parseAmount(raw: string): number | null {
  const t = raw.replace(/[$\s,]/g, '');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

const pct = (x: number, d = 1) => `${(x * 100).toFixed(d)}%`;
export { pct };

function NumberInput({ unit, onSubmit }: { unit: '%' | '$' | 'outs' | 'combos'; onSubmit: (v: string) => void }) {
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus({ preventScroll: true }), []);
  return (
    <form
      className="step-input"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v);
      }}
    >
      {unit === '$' && <span className="unit">$</span>}
      <input ref={ref} type="text" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} aria-label="Your answer" autoComplete="off" />
      {unit !== '$' && <span className="unit">{unit}</span>}
      <button className="btn primary" type="submit" disabled={!v.trim()}>
        Check <span className="kbd">↵</span>
      </button>
    </form>
  );
}

function ChoiceInput({ options, onSubmit }: { options: { value: string; label: ReactNode }[]; onSubmit: (v: string) => void }) {
  useKeys(
    (k) => {
      const i = Number(k) - 1;
      if (i >= 0 && i < options.length) onSubmit(options[i].value);
    },
    [options],
  );
  return (
    <div className="step-choices">
      {options.map((o, i) => (
        <button key={o.value} className="btn choice" onClick={() => onSubmit(o.value)}>
          <span className="kbd">{i + 1}</span> {o.label}
        </button>
      ))}
    </div>
  );
}

function shownAnswer(input: StepInput, raw: string): ReactNode {
  if (input.kind === 'choice') return input.options.find((o) => o.value === raw)?.label ?? raw;
  if (input.unit === '$') return `$${raw.replace(/^\$/, '')}`;
  if (input.unit === '%') return raw.includes('%') ? raw : `${raw}%`;
  return `${raw} ${input.unit}`;
}

/** Runs a list of graded steps one at a time and reports the results when the last one is done. */
export function StepRunner({ steps, onDone }: { steps: Step[]; onDone: (results: boolean[]) => void }) {
  const [done, setDone] = useState<{ raw: string; res: StepResult }[]>([]);
  const reported = useRef(false);
  useEffect(() => {
    if (done.length === steps.length && !reported.current) {
      reported.current = true;
      onDone(done.map((d) => d.res.ok));
    }
  }, [done, steps.length, onDone]);
  const cur = steps[done.length];
  return (
    <ol className="steps">
      {done.map((d, i) => (
        <li key={steps[i].key} className={`step done ${d.res.ok ? 'ok' : 'bad'}`}>
          <div className="step-prompt">{steps[i].prompt}</div>
          <div className="step-result">
            <span className="mark">{d.res.ok ? '✓' : '✗'}</span>
            <span>
              You said <strong>{shownAnswer(steps[i].input, d.raw)}</strong>
              {d.res.ok ? '. ' : '. Answer: '}
              {!d.res.ok && <strong>{d.res.answer}</strong>}
              {d.res.ok && <span className="muted">{d.res.answer}</span>}
            </span>
          </div>
          {d.res.note && <div className="step-note small">{d.res.note}</div>}
        </li>
      ))}
      {cur && (
        <li key={cur.key} className="step current">
          <div className="step-prompt">{cur.prompt}</div>
          {cur.input.kind === 'number' ? (
            <NumberInput unit={cur.input.unit} onSubmit={(raw) => setDone((d) => [...d, { raw, res: cur.grade(raw) }])} />
          ) : (
            <ChoiceInput options={cur.input.options} onSubmit={(raw) => setDone((d) => [...d, { raw, res: cur.grade(raw) }])} />
          )}
        </li>
      )}
    </ol>
  );
}

// ---------------------------------------------------------------------------------------------
// Room shell
// ---------------------------------------------------------------------------------------------

/**
 * Generates spots off the render path (the heavier ones enumerate ~10⁶ runouts) and re-deals when
 * the settings change.
 */
export function useSpot<T>(make: (rand: RNG) => T, deps: unknown[]): { spot: T | null; id: number; next: () => void } {
  const rand = useMemo(() => mulberry32(randomSeed()), []);
  const [state, setState] = useState<{ spot: T | null; id: number }>({ spot: null, id: 0 });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setState((s) => ({ spot: null, id: s.id }));
    const t = setTimeout(() => setState((s) => ({ spot: make(rand), id: s.id + 1 })), 30);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { ...state, next: () => setTick((t) => t + 1) };
}

export function useRoomStats(room: RoomId): [RoomStats, (steps: boolean[]) => void] {
  const [stats, setStats] = useState(() => roomStats(room));
  return [stats, (steps: boolean[]) => setStats(recordSpot(room, steps))];
}

export function StatChips({ stats }: { stats: RoomStats }) {
  return (
    <div className="trainer-stats room-stats">
      <div>
        <div className="k">Decisions</div>
        <div className="v num">{stats.hands ? `${stats.correct}/${stats.hands}` : '—'}</div>
      </div>
      <div>
        <div className="k">All steps</div>
        <div className="v num">{stats.steps ? `${Math.round((100 * stats.stepsCorrect) / stats.steps)}%` : '—'}</div>
      </div>
      <div>
        <div className="k">Streak</div>
        <div className="v num">
          {stats.streak}
          <span className="sub"> best {stats.bestStreak}</span>
        </div>
      </div>
    </div>
  );
}

export function RoomShell({
  title,
  lead,
  stats,
  lesson,
  settings,
  children,
}: {
  title: string;
  lead: ReactNode;
  stats: RoomStats;
  lesson: ReactNode;
  settings?: ReactNode;
  children: ReactNode;
}) {
  // Open the lesson on a first visit only; afterwards the reader decides.
  const [openLesson] = useState(stats.hands === 0);
  return (
    <main className="page holdem-page">
      <div className="page-head">
        <div>
          <div className="small">
            <Link to="/holdem">← Hold'em training rooms</Link>
          </div>
          <h1 style={{ margin: '4px 0' }}>{title}</h1>
          <p>{lead}</p>
        </div>
        <StatChips stats={stats} />
      </div>
      <details className="acc lesson-acc" open={openLesson}>
        <summary>The idea, and the formulas you need</summary>
        <div className="acc-body lesson">{lesson}</div>
      </details>
      {settings && <div className="row room-settings">{settings}</div>}
      {children}
    </main>
  );
}

/** Two-column layout: table on the left, questions on the right. */
export function SpotLayout({ table, side }: { table: ReactNode; side: ReactNode }) {
  return (
    <div className="spot-layout">
      <div className="spot-table">{table}</div>
      <div className="spot-side panel">{side}</div>
    </div>
  );
}

export function Dealing() {
  return <div className="panel muted center dealing">Dealing…</div>;
}

/** "Next spot" button with the N shortcut. */
export function NextButton({ onNext }: { onNext: () => void }) {
  useKeys(
    (k) => {
      if (k === 'n') onNext();
    },
    [onNext],
  );
  return (
    <button className="btn primary big" onClick={onNext}>
      Next spot <span className="kbd">N</span>
    </button>
  );
}

/** Signed dollars for EVs: "+$12.40", "−$3". */
export const fmtEVd = (x: number): string => {
  const r = Math.round(x * 100) / 100;
  return `${r >= 0 ? '+' : '−'}${fmtMoney(Math.abs(r))}`;
};

/** Profile picker used by every room. */
export const PROFILE_OPTIONS = [
  { value: 'random', label: 'Random' },
  { value: 'nit', label: 'Nit' },
  { value: 'tag', label: 'TAG' },
  { value: 'lag', label: 'LAG' },
  { value: 'station', label: 'Station' },
  { value: 'maniac', label: 'Maniac' },
] as const;

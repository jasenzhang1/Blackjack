import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Modal, Progress, Seg, useKeys } from '../components/ui';
import { INFINITE_PROBS, rankText, type Rank } from '../engine/cards';
import { ACTION_NAMES, type Action } from '../engine/ev';
import { HARD_ROWS, PAIR_ROWS, SOFT_ROWS, handValue, rowKey } from '../engine/hand';
import { strategyKey } from '../engine/rules';
import { mulberry32, randomSeed, weightedIndex } from '../engine/rng';
import { cellKey, type StrategyTable } from '../engine/strategy';
import { cellStats, getTrainerStats, saveTrainerStats } from '../state/progress';
import { useSettings } from '../state/settings';
import { load, save } from '../state/storage';
import { ActionButtons, FeedbackBanner, InsurancePrompt, EarlyPrompt, TableView, WhyModal } from '../table/components';
import { useTableGame, type GameSetup } from '../table/useTableGame';
import { useStrategy } from '../worker/client';

type Filter = 'all' | 'hard' | 'soft' | 'pair' | 'stiff' | 'double' | 'surrender' | 'close' | 'weak';

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Natural deal' },
  { value: 'hard', label: 'Hard' },
  { value: 'soft', label: 'Soft' },
  { value: 'pair', label: 'Pairs' },
  { value: 'stiff', label: 'Stiffs 12–16' },
  { value: 'double', label: 'Doubles' },
  { value: 'surrender', label: 'Surrender spots' },
  { value: 'close', label: 'Close calls' },
  { value: 'weak', label: 'My weak spots' },
];

/** One-click hand-type toggle shown above the table. Clicking the active one goes back to all hands. */
const QUICK: { value: Filter; label: string }[] = [
  { value: 'hard', label: 'Hard' },
  { value: 'soft', label: 'Soft' },
  { value: 'pair', label: 'Pairs' },
];
const FILTER_KEY = 'trainer.filter';
const isFilter = (v: unknown): v is Filter => FILTERS.some((f) => f.value === v);

interface Candidate {
  row: string;
  up: Rank;
  w: number;
}

function candidates(table: StrategyTable, filter: Filter): Candidate[] {
  const rules = table.rules;
  const stats = filter === 'weak' ? cellStats(strategyKey(rules)) : {};
  const rows = [...HARD_ROWS.map((n) => rowKey('hard', n)), ...SOFT_ROWS.map((n) => rowKey('soft', n)), ...PAIR_ROWS.map((n) => rowKey('pair', n))];
  const out: Candidate[] = [];
  for (const row of rows) {
    for (const up of [2, 3, 4, 5, 6, 7, 8, 9, 10, 1] as Rank[]) {
      const c = table.cells[cellKey(row, up)];
      if (!c) continue;
      const kind = row[0];
      const n = Number(row.slice(1));
      let ok = false;
      let w = 1;
      switch (filter) {
        case 'hard':
          ok = kind === 'H' && n >= 8 && n <= 17;
          break;
        case 'soft':
          ok = kind === 'S';
          break;
        case 'pair':
          ok = kind === 'P';
          break;
        case 'stiff':
          ok = kind === 'H' && n >= 12 && n <= 16;
          break;
        case 'double':
          ok = (kind === 'H' && n >= 8 && n <= 11) || (kind === 'S' && n <= 19);
          break;
        case 'surrender':
          ok = rules.surrender !== 'none' && ((kind === 'H' && n >= 14 && n <= 17 && (up >= 9 || up === 1)) || (kind === 'P' && n === 8 && (up === 10 || up === 1)));
          break;
        case 'close':
          ok = c.margin < 0.02 && !(kind === 'H' && n <= 7);
          break;
        case 'weak': {
          const s = stats[cellKey(row, up)];
          ok = !(kind === 'H' && n <= 7) && !(kind === 'H' && n >= 18) && !(kind === 'S' && n === 20);
          // Error rate with a prior: unseen cells get moderate weight, mistakes get heavy weight.
          w = s ? (1 + 6 * (s.attempts - s.correct)) / (1 + s.attempts) : 0.6;
          break;
        }
        default:
          ok = true;
      }
      if (ok) out.push({ row, up, w });
    }
  }
  return out;
}

function makeRig(table: StrategyTable, filter: Filter, seed: number): (() => Rank[] | null) | null {
  if (filter === 'all') return null;
  const list = candidates(table, filter);
  if (!list.length) return null;
  const rng = mulberry32(seed);
  const rules = table.rules;
  return () => {
    const c = list[weightedIndex(rng, list.map((x) => x.w))];
    const cell = table.cells[cellKey(c.row, c.up)];
    const comp = cell.comps[weightedIndex(rng, cell.comps.map((x) => x.weight))];
    let [a, b] = comp.cards;
    if (rng() < 0.5) [a, b] = [b, a];
    const out: Rank[] = [a, c.up, b];
    if (rules.dealerPeeks) {
      // Hole card: natural frequencies, excluding a dealer blackjack (the drill is about your play).
      const bjRank = c.up === 1 ? 10 : c.up === 10 ? 1 : 0;
      const ranks = ([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as Rank[]).filter((r) => r !== bjRank);
      out.push(ranks[weightedIndex(rng, ranks.map((r) => INFINITE_PROBS[r]))]);
    }
    return out;
  };
}

export default function Trainer() {
  const { rules, prefs } = useSettings();
  const { table, progress } = useStrategy(rules);
  const [filter, setFilterState] = useState<Filter>(() => {
    const v = load<unknown>(FILTER_KEY, 'all');
    return isFilter(v) ? v : 'all';
  });
  const setFilter = (f: Filter) => {
    setFilterState(f);
    save(FILTER_KEY, f);
  };
  const [decisionOnly, setDecisionOnly] = useState(false);
  const [why, setWhy] = useState(false);
  const [optsOpen, setOptsOpen] = useState(false);
  const seed = useRef(randomSeed());
  const rig = useMemo(() => (table ? makeRig(table, filter, seed.current++) : null), [table, filter]);

  const setup: GameSetup = {
    mode: 'trainer',
    seats: 1,
    humanSeat: 0,
    bots: 0,
    bankroll: 100_000,
    minBet: 1,
    maxBet: 100_000,
    fixedBet: prefs.unit,
    rig,
    deviations: false,
    countChecks: { frequency: 'off', askTC: false },
    autoNext: false,
    decisionOnly,
    countingSystem: prefs.countingSystem,
  };
  const game = useTableGame(setup, rules, table, prefs.speed);
  const p = game.pending;

  // Session + lifetime stats.
  const plays = game.decisions;
  const correct = plays.filter((d) => d.ok).length;
  let streak = 0;
  for (let i = plays.length - 1; i >= 0 && plays[i].ok; i--) streak++;
  const lifetime = useRef(getTrainerStats());
  const lastCount = useRef(0);
  useEffect(() => {
    if (plays.length > lastCount.current) {
      const fresh = plays.slice(lastCount.current);
      lastCount.current = plays.length;
      const s = lifetime.current;
      s.total += fresh.length;
      s.correct += fresh.filter((d) => d.ok).length;
      s.bestStreak = Math.max(s.bestStreak, streak);
      saveTrainerStats(s);
    }
  });

  // Decision timing: the clock starts when the game starts waiting for a decision (the buttons
  // appear, after the deal animation) and stops when the decision is recorded.
  const promptKey =
    p.kind === 'action'
      ? `${game.t.roundId}:a:${p.seat}:${p.hand}:${game.t.seats[p.seat].hands[p.hand].cards.length}`
      : p.kind === 'insurance' || p.kind === 'early'
        ? `${game.t.roundId}:${p.kind}`
        : null;
  const promptAt = useRef<number | null>(null);
  const timedCount = useRef(0);
  const [times, setTimes] = useState<Record<string, number>>({});
  // Declared before the prompt effect so it reads the start time of the decision just made.
  useEffect(() => {
    if (plays.length <= timedCount.current) return;
    const fresh = plays.slice(timedCount.current);
    timedCount.current = plays.length;
    const start = promptAt.current;
    promptAt.current = null;
    if (start == null) return;
    const ms = performance.now() - start;
    setTimes((t) => ({ ...t, [fresh[0].id]: ms }));
  }, [plays.length, plays]);
  useEffect(() => {
    promptAt.current = promptKey ? performance.now() : null;
  }, [promptKey]);
  const timed = plays.filter((d) => times[d.id] != null && times[d.id] <= MAX_MS);
  const avgMs = timed.length ? timed.reduce((s, d) => s + times[d.id], 0) / timed.length : null;
  const [detailsOpen, setDetailsOpen] = useState(false);

  const waiting = p.kind === 'betting' || p.kind === 'done';
  const next = () => {
    if (game.holdNext) game.continueAfterMistake();
    if (p.kind === 'done' || p.kind === 'betting') game.deal();
  };
  useKeys(
    (k, e) => {
      if ((k === ' ' || k === 'enter') && waiting) {
        e.preventDefault();
        next();
      }
    },
    [waiting, game],
  );

  if (!table) {
    return (
      <main className="page">
        <h1>Table Trainer</h1>
        <div className="panel">
          <Progress value={progress} label="Preparing the exact strategy for these rules…" />
        </div>
      </main>
    );
  }

  const filterLabel = FILTERS.find((f) => f.value === filter)?.label;

  return (
    <main className="page trainer-page">
      <div className="trainer-head">
        <h1>Table Trainer</h1>
        <div className="trainer-quick">
          <div className="seg" role="group" aria-label="Deal only these hands">
            <button aria-pressed={filter === 'all'} className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')} title="Deal every kind of hand">
              All
            </button>
            {QUICK.map((q) => (
              <button
                key={q.value}
                aria-pressed={filter === q.value}
                className={filter === q.value ? 'on' : ''}
                onClick={() => setFilter(filter === q.value ? 'all' : q.value)}
                title={filter === q.value ? 'Click again to deal all hands' : `Deal only ${q.label.toLowerCase()} hands`}
              >
                {q.label}
              </button>
            ))}
          </div>
          <button className="btn small ghost" onClick={() => setOptsOpen(true)} title="Practice settings">
            ⚙ {QUICK.some((q) => q.value === filter) || filter === 'all' ? 'More' : filterLabel}
          </button>
        </div>
      </div>

      <div className="trainer-grid">
        <section className="trainer-side trainer-fb" aria-label="Last play">
          <h3>Last play</h3>
          {game.feedback ? (
            <FeedbackBanner fb={game.feedback} rules={rules} unit={prefs.unit} onWhy={() => setWhy(true)} bars={false} money={false} />
          ) : (
            <div className="muted small">Nothing yet.</div>
          )}
        </section>

        <div className="trainer-center">
          <TableView game={game} humanSeat={0} label={null} noMoney />
          <div className="dock">
            {p.kind === 'action' && <ActionButtons avail={p.avail} onAction={(a) => game.act(a)} showKeys={prefs.showKeys} />}
            {p.kind === 'insurance' && <InsurancePrompt game={game} seatIndex={0} />}
            {p.kind === 'early' && <EarlyPrompt game={game} />}
            {waiting && (
              <button className="btn primary big" onClick={next}>
                {game.holdNext ? 'Next hand' : p.kind === 'done' ? 'Next hand' : 'Deal'} <span className="kbd">Space</span>
              </button>
            )}
            {p.kind === 'auto' && <span className="status">Dealing…</span>}
          </div>
        </div>

        <section className="trainer-side trainer-log" aria-label="Your plays">
          <div className="trainer-stats">
            <div title={`${correct} of ${plays.length} correct`}>
              <div className="k">Correct</div>
              <div className="v num">{plays.length ? `${Math.round((correct / plays.length) * 100)}%` : '—'}</div>
              <div className="sub num">
                {correct}/{plays.length}
              </div>
            </div>
            <div>
              <div className="k">Streak</div>
              <div className="v num">{streak}</div>
              <div className="sub num">best {Math.max(lifetime.current.bestStreak, streak)}</div>
            </div>
            <div>
              <div className="k">Avg time</div>
              <div className="v num">{avgMs == null ? '—' : fmtSec(avgMs)}</div>
              <div className="sub">per decision</div>
            </div>
          </div>
          <div className="row between">
            <h3>Your plays</h3>
            <button className="btn ghost small" onClick={() => setDetailsOpen(true)} disabled={!plays.length}>
              Details
            </button>
          </div>
          {plays.length === 0 ? (
            <div className="muted small">Nothing yet.</div>
          ) : (
            <ol className="play-log">
              {plays
                .slice(-60)
                .reverse()
                .map((d) => (
                  <li key={d.id} className={d.ok ? 'ok' : 'bad'}>
                    <span className="mark">{d.ok ? '✓' : '✗'}</span>
                    <span className="ph">
                      {d.cards.length ? boardLabel(d) : 'Insurance'}
                      <span className="muted">{` vs ${rankText(d.up)}`}</span>
                    </span>
                    <span className="act">
                      {playName(d.taken, d.kind)}
                      {!d.ok && <span className="fix"> → {playName(d.correct, d.kind)}</span>}
                    </span>
                    <span className="t num muted">{times[d.id] != null ? fmtSec(times[d.id]) : ''}</span>
                  </li>
                ))}
            </ol>
          )}
        </section>
      </div>

      {optsOpen && (
        <Modal title="Practice settings" onClose={() => setOptsOpen(false)} narrow>
          <div className="stack">
            <div className="field">
              Deal me
              <Seg value={filter} onChange={setFilter} options={FILTERS} label="Hand filter" />
            </div>
            <Check checked={decisionOnly} onChange={setDecisionOnly}>
              First decision only (fast)
            </Check>
          </div>
        </Modal>
      )}
      {detailsOpen && <StatsModal plays={plays} times={times} onClose={() => setDetailsOpen(false)} />}
      {why && game.feedback && <WhyModal fb={game.feedback} rules={rules} onClose={() => setWhy(false)} />}
    </main>
  );
}

/** Decisions slower than this (you looked away) are left out of the time averages. */
const MAX_MS = 60_000;
const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

type Play = ReturnType<typeof useTableGame>['decisions'][number];

/** "Hard 16", "Soft 18", "Pair of 8s" or "Insurance": the board, without the dealer's card. */
function handType(d: Play): { group: string; label: string } {
  if (d.kind === 'insurance' || !d.cards.length) return { group: 'Insurance', label: 'Insurance' };
  const v = handValue(d.cards);
  return { group: d.cards.length === 2 && d.cards[0] === d.cards[1] ? 'Pairs' : v.soft ? 'Soft' : 'Hard', label: boardLabel(d) };
}

interface Agg {
  key: string;
  n: number;
  ok: number;
  ms: number;
  timed: number;
}

function aggregate(plays: Play[], times: Record<string, number>, keyOf: (d: Play) => string): Agg[] {
  const m = new Map<string, Agg>();
  for (const d of plays) {
    const key = keyOf(d);
    const a = m.get(key) ?? { key, n: 0, ok: 0, ms: 0, timed: 0 };
    a.n++;
    if (d.ok) a.ok++;
    const t = times[d.id];
    if (t != null && t <= MAX_MS) {
      a.ms += t;
      a.timed++;
    }
    m.set(key, a);
  }
  return [...m.values()];
}

function AggTable({ title, rows, first }: { title: string; rows: Agg[]; first: string }) {
  return (
    <div>
      <h4 style={{ margin: '0 0 6px' }}>{title}</h4>
      <table className="data">
        <thead>
          <tr>
            <th>{first}</th>
            <th className="num">Hands</th>
            <th className="num">Correct</th>
            <th className="num">Avg time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td className="num">{r.n}</td>
              <td className="num">{Math.round((r.ok / r.n) * 100)}%</td>
              <td className="num">{r.timed ? fmtSec(r.ms / r.timed) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const UP_ORDER = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

function StatsModal({ plays, times, onClose }: { plays: Play[]; times: Record<string, number>; onClose: () => void }) {
  const byType = aggregate(plays, times, (d) => handType(d).group).sort((a, b) => ['Hard', 'Soft', 'Pairs', 'Insurance'].indexOf(a.key) - ['Hard', 'Soft', 'Pairs', 'Insurance'].indexOf(b.key));
  const byUp = aggregate(plays, times, (d) => rankText(d.up)).sort((a, b) => UP_ORDER.indexOf(a.key) - UP_ORDER.indexOf(b.key));
  const spots = aggregate(plays, times, (d) => `${handType(d).label} vs ${rankText(d.up)}`)
    .filter((a) => a.timed)
    .sort((a, b) => b.ms / b.timed - a.ms / a.timed)
    .slice(0, 10);
  return (
    <Modal title="Session details" onClose={onClose}>
      <div className="stack" style={{ gap: 18 }}>
        <div className="details-grid">
          <AggTable title="By hand type" rows={byType} first="Hand" />
          <AggTable title="By dealer upcard" rows={byUp} first="Dealer" />
        </div>
        <AggTable title="Slowest spots" rows={spots} first="Spot" />
      </div>
    </Modal>
  );
}

const pairRank = (r: Rank) => (r === 1 ? 'A' : r === 10 ? 'T' : String(r));

/** Player hand as the chart names it: Hard 16, Soft 18, 8,8. */
function boardLabel(d: Play): string {
  if (d.cards.length === 2 && d.cards[0] === d.cards[1]) return `${pairRank(d.cards[0])},${pairRank(d.cards[0])}`;
  const v = handValue(d.cards);
  return `${v.soft ? 'Soft' : 'Hard'} ${v.total}`;
}

function playName(d: string, kind: string): string {
  if (d === 'I') return 'Insure';
  if (d === 'N') return kind === 'insurance' ? 'No insurance' : 'Play on';
  return ACTION_NAMES[d as Action] ?? d;
}

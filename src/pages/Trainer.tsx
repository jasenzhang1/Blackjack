import { useEffect, useMemo, useRef, useState } from 'react';
import { StudyRules } from '../components/StudyRules';
import { Check, Progress, Seg, useKeys } from '../components/ui';
import { INFINITE_PROBS, type Rank } from '../engine/cards';
import { HARD_ROWS, PAIR_ROWS, SOFT_ROWS, rowKey } from '../engine/hand';
import { strategyKey } from '../engine/rules';
import { mulberry32, randomSeed, weightedIndex } from '../engine/rng';
import { cellKey, type StrategyTable } from '../engine/strategy';
import { cellStats, getTrainerStats, saveTrainerStats } from '../state/progress';
import { useSettings } from '../state/settings';
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
  const [filter, setFilter] = useState<Filter>('all');
  const [decisionOnly, setDecisionOnly] = useState(false);
  const [autoNext, setAutoNext] = useState(true);
  const [why, setWhy] = useState(false);
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
    autoNext,
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
        <h1>Table trainer</h1>
        <div className="panel">
          <Progress value={progress} label="Preparing the exact strategy for these rules…" />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Table trainer</h1>
        </div>
        <div className="stat-row">
          <div className="stat">
            <div className="k">Session</div>
            <div className="v num">
              {correct}/{plays.length}
            </div>
          </div>
          <div className="stat">
            <div className="k">Accuracy</div>
            <div className="v num">{plays.length ? `${Math.round((correct / plays.length) * 100)}%` : '—'}</div>
          </div>
          <div className="stat">
            <div className="k">Streak</div>
            <div className="v num">{streak}</div>
          </div>
          <div className="stat">
            <div className="k">Best streak</div>
            <div className="v num">{Math.max(lifetime.current.bestStreak, streak)}</div>
          </div>
        </div>
      </div>

      <StudyRules note="Every decision is graded against the exact strategy for these rules." />
      <div className="panel tight row" style={{ marginBottom: 12 }}>
        <span className="muted small">Deal me:</span>
        <Seg value={filter} onChange={setFilter} options={FILTERS} label="Hand filter" />
        <span className="grow" />
        <Check checked={decisionOnly} onChange={setDecisionOnly}>
          First decision only (fast)
        </Check>
        <Check checked={autoNext} onChange={setAutoNext}>
          Auto-deal
        </Check>
      </div>

      <TableView game={game} humanSeat={0} label={`Blackjack pays ${rules.blackjackPays === 1.5 ? '3 to 2' : rules.blackjackPays === 1.2 ? '6 to 5' : rules.blackjackPays === 1.4 ? '7 to 5' : 'even money'} · Dealer ${rules.hitSoft17 ? 'hits' : 'stands on'} soft 17`} />

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

      {game.feedback && <FeedbackBanner fb={game.feedback} rules={rules} unit={prefs.unit} onWhy={() => setWhy(true)} />}
      {why && game.feedback && <WhyModal fb={game.feedback} rules={rules} onClose={() => setWhy(false)} />}
    </main>
  );
}

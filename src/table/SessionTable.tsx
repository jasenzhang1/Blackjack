/**
 * A graded table session shared by Count & Play (CC-3 / 3b) and the Casino (P-1).
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Modal, Progress, Seg, fmtMoney, useKeys } from '../components/ui';
import { HI_LO, getSystem, SYSTEMS } from '../engine/counting';
import type { Action } from '../engine/ev';
import { describeRules, rulesKey, tableDecks } from '../engine/rules';
import { saveSession } from '../state/progress';
import { useSettings, type CoachMode } from '../state/settings';
import { useStrategy } from '../worker/client';
import { ActionButtons, BetControls, CoachPanel, CoachWarning, CountPromptDialog, EarlyPrompt, FeedbackBanner, InsurancePrompt, TableView, WhyModal } from './components';
import { ReportCard } from './ReportCard';
import { summarize, type SessionReport } from './report';
import { useTableGame, type CountCheckSetup, type GameSetup } from './useTableGame';

interface Config {
  bankroll: number;
  minBet: number;
  maxBet: number;
  bots: number;
  deviations: boolean;
  checks: CountCheckSetup['frequency'];
  askTC: boolean;
  feedback: boolean;
  coach: CoachMode;
  showCount: boolean;
  showDecks: boolean;
  betHint: boolean;
}

export function SessionTable({ mode, title, intro }: { mode: 'countplay' | 'casino'; title: string; intro: ReactNode }) {
  const { rules, prefs, setPrefs } = useSettings();
  const { table, progress } = useStrategy(rules);
  const [cfg, setCfg] = useState<Config>(() => ({
    bankroll: 1000,
    minBet: mode === 'casino' ? 10 : 10,
    maxBet: mode === 'casino' ? 500 : 400,
    bots: mode === 'casino' ? 2 : 4,
    deviations: mode === 'countplay',
    checks: mode === 'countplay' ? 'every3' : 'off',
    askTC: true,
    feedback: mode === 'countplay',
    coach: mode === 'casino' ? 'warn' : 'off',
    showCount: false,
    showDecks: false,
    betHint: false,
  }));
  const [started, setStarted] = useState(false);
  const set = (p: Partial<Config>) => setCfg((c) => ({ ...c, ...p }));

  if (!table) {
    return (
      <main className="page">
        <h1>{title}</h1>
        <div className="panel">
          <Progress value={progress} label="Preparing the exact strategy for these rules…" />
        </div>
      </main>
    );
  }

  if (!started) {
    const counting = mode === 'countplay';
    return (
      <main className="page">
        <div className="page-head">
          <div>
            <h1>{title}</h1>
            <p>{intro}</p>
          </div>
        </div>
        <div className="grid-2">
          <div className="panel stack">
            <h3>Table</h3>
            <label className="field">
              Starting bankroll
              <select value={cfg.bankroll} onChange={(e) => set({ bankroll: Number(e.target.value) })}>
                {[500, 1000, 2500, 5000, 10000].map((v) => (
                  <option key={v} value={v}>
                    {fmtMoney(v)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Table limits
              <select
                value={`${cfg.minBet}-${cfg.maxBet}`}
                onChange={(e) => {
                  const [a, b] = e.target.value.split('-').map(Number);
                  set({ minBet: a, maxBet: b });
                }}
              >
                {[
                  [5, 200],
                  [10, 400],
                  [10, 500],
                  [25, 1000],
                  [100, 5000],
                ].map(([a, b]) => (
                  <option key={a + '-' + b} value={`${a}-${b}`}>
                    {fmtMoney(a)} – {fmtMoney(b)}
                  </option>
                ))}
              </select>
            </label>
            <div className="field">
              Other players at the table
              <Seg value={cfg.bots} onChange={(v) => set({ bots: v })} options={[0, 1, 2, 3, 4, 5].map((n) => ({ value: n, label: String(n) }))} />
            </div>
            {!Number.isFinite(rules.decks) && counting && <div className="callout bad">Counting cannot work against a continuous shuffler. The table will deal an 8-deck shoe with the cut card instead.</div>}
            <div className="muted small">Rules: {describeRules(rules).join(' · ')}. Change them with "Edit rules" above.</div>
          </div>
          <div className="panel stack">
            <h3>{counting ? 'Assessment' : 'Coach'}</h3>
            {counting ? (
              <>
                <div className="field">
                  Counting system (for count checks)
                  <select value={prefs.countingSystem} onChange={(e) => setPrefs({ countingSystem: e.target.value })}>
                    {SYSTEMS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  Count checks
                  <Seg
                    value={cfg.checks}
                    onChange={(v) => set({ checks: v })}
                    options={[
                      { value: 'round', label: 'Every round' },
                      { value: 'every3', label: 'Every 3' },
                      { value: 'random', label: 'Random' },
                      { value: 'shoe', label: 'End of shoe' },
                      { value: 'off', label: 'Off' },
                    ]}
                  />
                </div>
                <Check checked={cfg.askTC} onChange={(v) => set({ askTC: v })}>
                  Also ask for the true count
                </Check>
                <Check checked={cfg.deviations} onChange={(v) => set({ deviations: v })}>
                  <strong>Grade index deviations (Feature 3b)</strong>: Illustrious 18 + Fab 4 at the current true count
                </Check>
                <Check checked={cfg.feedback} onChange={(v) => set({ feedback: v })}>
                  Show feedback after every decision
                </Check>
                <Check checked={cfg.betHint} onChange={(v) => set({ betHint: v })}>
                  Show a bet-ramp hint (1 unit at TC ≤ +1, then 2 units per count)
                </Check>
                <Check checked={cfg.showDecks} onChange={(v) => set({ showDecks: v })}>
                  Label decks remaining (training wheels)
                </Check>
              </>
            ) : (
              <>
                <div className="field">
                  Live coach
                  <Seg
                    value={cfg.coach}
                    onChange={(v) => set({ coach: v })}
                    options={[
                      { value: 'off', label: 'Off' },
                      { value: 'hint', label: 'Hints on request' },
                      { value: 'warn', label: 'Warn on mistakes' },
                      { value: 'always', label: 'Always show' },
                    ]}
                  />
                </div>
                <Check checked={cfg.showCount} onChange={(v) => set({ showCount: v })}>
                  Coach shows the count (running, decks left, true count)
                </Check>
                <Check checked={cfg.deviations} onChange={(v) => set({ deviations: v })}>
                  Coach uses count-based index plays
                </Check>
                <p className="muted small">Every decision is recorded either way. Open the report card at any time.</p>
              </>
            )}
            <button className="btn primary big" onClick={() => setStarted(true)}>
              Take a seat
            </button>
          </div>
        </div>
      </main>
    );
  }

  return <Session mode={mode} title={title} cfg={cfg} onLeave={() => setStarted(false)} />;
}

function Session({ mode, title, cfg, onLeave }: { mode: 'countplay' | 'casino'; title: string; cfg: Config; onLeave: () => void }) {
  const { rules, prefs } = useSettings();
  const { table } = useStrategy(rules);
  const humanSeat = Math.min(cfg.bots, 2);
  const setup: GameSetup = {
    mode,
    seats: Math.max(1, cfg.bots + 1),
    humanSeat,
    bots: cfg.bots,
    botStyles: ['pro', 'tourist', 'counter', 'pro', 'tourist'],
    bankroll: cfg.bankroll,
    minBet: cfg.minBet,
    maxBet: cfg.maxBet,
    deviations: cfg.deviations,
    countChecks: { frequency: cfg.checks, askTC: cfg.askTC },
    autoNext: false,
    exactEV: true,
    countingSystem: mode === 'countplay' ? prefs.countingSystem : 'hilo',
  };
  const game = useTableGame(setup, rules, table, prefs.speed);
  const p = game.pending;
  const [warn, setWarn] = useState<{ rec: Action; taken: Action; ev: Record<string, number> } | null>(null);
  const [why, setWhy] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [peek, setPeek] = useState(false);
  const sessionId = useRef(`${mode}-${Date.now()}`);

  const me = game.t.seats[humanSeat].player!;
  const report = (): SessionReport => ({
    id: sessionId.current,
    mode,
    start: game.startedAt,
    end: Date.now(),
    rulesKey: rulesKey(rules),
    rulesChips: describeRules(rules),
    houseEdge: table?.houseEdge ?? 0,
    startBankroll: cfg.bankroll,
    endBankroll: me.bankroll,
    rounds: [...game.rounds],
    decisions: [...game.decisions],
    checks: [...game.checks],
    deviationsOn: cfg.deviations,
    countingSystem: setup.countingSystem,
    coach: cfg.coach,
    unit: cfg.minBet,
  });

  // Persist after every completed round so nothing is lost when navigating away.
  const savedRounds = useRef(0);
  useEffect(() => {
    if (game.rounds.length > savedRounds.current) {
      savedRounds.current = game.rounds.length;
      saveSession(report());
    }
  });

  const onAction = (a: Action) => {
    if (mode === 'casino' && cfg.coach === 'warn') {
      const g = game.evaluate(a);
      if (g && !g.ok) {
        setWarn({ rec: g.correct as Action, taken: a, ev: g.ev as Record<string, number> });
        return;
      }
    }
    game.act(a);
  };

  const showFeedback = mode === 'countplay' ? cfg.feedback : cfg.coach !== 'off';
  const broke = p.kind === 'betting' && me.bankroll < cfg.minBet;
  const tc = game.hiLoTC;
  const suggested = Math.max(1, Math.min(8, Math.floor(tc) <= 1 ? 1 : 2 * (Math.floor(tc) - 1)));
  const sum = summarize(report());
  const sys = getSystem(setup.countingSystem);

  useKeys(
    (k, e) => {
      if ((k === ' ' || k === 'enter') && p.kind === 'done') {
        e.preventDefault();
        game.deal();
      }
    },
    [p.kind, game],
  );

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            {mode === 'countplay' ? `Count with ${sys.name}${cfg.deviations ? ', graded on index plays (Hi-Lo true count)' : ''}.` : `Coach: ${cfg.coach}.`} Bankroll {fmtMoney(me.bankroll)} (started with {fmtMoney(cfg.bankroll)}).
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowReport(true)}>
            Report card
          </button>
          <button
            className="btn ghost"
            onClick={() => {
              if (game.rounds.length) saveSession(report());
              onLeave();
            }}
          >
            Leave table
          </button>
        </div>
      </div>

      <div className="side-layout">
        <div>
          <TableView game={game} humanSeat={humanSeat} showDecks={cfg.showDecks} label={`Blackjack pays ${rules.blackjackPays === 1.5 ? '3 to 2' : rules.blackjackPays === 1.2 ? '6 to 5' : rules.blackjackPays === 1.4 ? '7 to 5' : 'even money'}`} />
          <div className="dock">
            {broke && (
              <div className="row">
                <span className="bad">You're out of chips.</span>
                <button className="btn primary" onClick={() => setShowReport(true)}>
                  See your report card
                </button>
              </div>
            )}
            {!broke && (p.kind === 'betting' || p.kind === 'done') && (
              <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
                {cfg.betHint && mode === 'countplay' && (
                  <span className="chip gold">
                    Bet hint: true count {tc.toFixed(1)} → {suggested} unit{suggested > 1 ? 's' : ''} ({fmtMoney(suggested * cfg.minBet)})
                  </span>
                )}
                <BetControls game={game} humanSeat={humanSeat} onDeal={() => game.deal()} minBet={cfg.minBet} maxBet={cfg.maxBet} />
              </div>
            )}
            {p.kind === 'action' && <ActionButtons avail={p.avail} onAction={onAction} showKeys={prefs.showKeys} />}
            {p.kind === 'insurance' && <InsurancePrompt game={game} seatIndex={p.seat} />}
            {p.kind === 'early' && <EarlyPrompt game={game} />}
            {p.kind === 'auto' && <span className="status">{game.t.phase === 'dealer' ? 'Dealer plays…' : 'Dealing…'}</span>}
          </div>
          {showFeedback && game.feedback && <FeedbackBanner fb={game.feedback} rules={rules} unit={cfg.minBet} onWhy={() => setWhy(true)} />}
        </div>

        <div className="stack">
          <div className="panel stack" style={{ gap: 8 }}>
            <h3>Session</h3>
            <div className="row between small">
              <span className="muted">Rounds</span>
              <span className="num">{sum.rounds}</span>
            </div>
            <div className="row between small">
              <span className="muted">Net</span>
              <span className={`num ${sum.net >= 0 ? 'good' : 'bad'}`}>{fmtMoney(sum.net)}</span>
            </div>
            <div className="row between small">
              <span className="muted">Decisions correct</span>
              <span className="num">
                {sum.correct}/{sum.decisions}
              </span>
            </div>
            {sum.checks > 0 && (
              <div className="row between small">
                <span className="muted">Count checks exact</span>
                <span className="num">
                  {sum.rcExact}/{sum.checks}
                </span>
              </div>
            )}
            {cfg.deviations && (
              <div className="row between small">
                <span className="muted">Index plays</span>
                <span className="num">
                  {sum.deviationCorrect}/{sum.deviationOpportunities}
                </span>
              </div>
            )}
            <div className="row between small">
              <span className="muted">Grade so far</span>
              <strong>{sum.grade}</strong>
            </div>
            {mode === 'countplay' && (
              <button className="btn small" onMouseDown={() => setPeek(true)} onMouseUp={() => setPeek(false)} onMouseLeave={() => setPeek(false)} onTouchStart={() => setPeek(true)} onTouchEnd={() => setPeek(false)}>
                {peek ? `RC ${game.runningCount} · ${(game.cardsUnseen / 52).toFixed(1)} decks · TC ${game.hiLoTC.toFixed(1)}` : 'Hold to peek at the count'}
              </button>
            )}
            <div className="muted small">Shoe: {Math.round((1 - game.t.shoe.length / game.t.shoeSize) * 100)}% dealt · cut card at {Math.round(rules.penetration * 100)}% · {tableDecks(rules)} decks</div>
          </div>
          {mode === 'casino' && <CoachPanel game={game} mode={cfg.coach} showCount={cfg.showCount} systemId={HI_LO.id} />}
          <div className="panel small text-2">
            Keys: H S D P R for plays, I/N for insurance, Space to deal.
            {mode === 'countplay' && ' Count every card you see, including the dealer\'s hole card when it is turned over. Reset to zero when the shoe is shuffled.'}
          </div>
        </div>
      </div>

      {game.shuffleFlash > 0 && <ShuffleToast n={game.shuffleFlash} system={sys.name} irc={sys.irc ? sys.irc(tableDecks(rules)) : 0} />}
      {game.countPrompt && <CountPromptDialog prompt={game.countPrompt} systemId={setup.countingSystem} askTC={cfg.askTC} onSubmit={game.submitCount} onClose={game.closeCountPrompt} />}
      {warn && (
        <CoachWarning
          rec={warn.rec}
          taken={warn.taken}
          ev={warn.ev}
          onFollow={() => {
            game.act(warn.rec, { coached: true });
            setWarn(null);
          }}
          onAnyway={() => {
            game.act(warn.taken, { coached: true });
            setWarn(null);
          }}
        />
      )}
      {why && game.feedback && <WhyModal fb={game.feedback} rules={rules} onClose={() => setWhy(false)} />}
      {showReport && (
        <Modal title="Report card" onClose={() => setShowReport(false)}>
          <ReportCard report={report()} />
        </Modal>
      )}
    </main>
  );
}

function ShuffleToast({ n, system, irc }: { n: number; system: string; irc: number }) {
  const [show, setShow] = useState(true);
  useEffect(() => {
    setShow(true);
    const id = window.setTimeout(() => setShow(false), 3500);
    return () => window.clearTimeout(id);
  }, [n]);
  if (!show) return null;
  return (
    <div className="callout" style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 80, background: '#2a2414', boxShadow: 'var(--shadow)' }} role="status">
      The shoe was shuffled. Reset your {system} count to {irc}.
    </div>
  );
}

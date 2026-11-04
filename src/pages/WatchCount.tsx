import { useEffect, useRef, useState } from 'react';
import { Check, Progress, Seg, useKeys } from '../components/ui';
import { SYSTEMS, getSystem } from '../engine/counting';
import { tableDecks } from '../engine/rules';
import { getWatchStats, saveWatchStats } from '../state/progress';
import { useSettings } from '../state/settings';
import { CountPromptDialog, TableView } from '../table/components';
import type { CountCheck } from '../table/report';
import { useTableGame, type CountCheckSetup, type GameSetup } from '../table/useTableGame';
import { useStrategy } from '../worker/client';

const SPEEDS = [0.5, 1, 1.5, 2, 3, 4];

export default function WatchCount() {
  const { rules, prefs, setPrefs } = useSettings();
  const { table, progress } = useStrategy(rules);
  const [bots, setBots] = useState(5);
  const [freq, setFreq] = useState<CountCheckSetup['frequency']>('every3');
  const [askTC, setAskTC] = useState(true);
  const [wheels, setWheels] = useState(false);
  const [showDecks, setShowDecks] = useState(false);
  const [started, setStarted] = useState(false);

  if (!table) {
    return (
      <main className="page">
        <h1>Watch & count</h1>
        <div className="panel">
          <Progress value={progress} label="Preparing the simulated players' strategy…" />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Watch & count</h1>
          <p>Simulated players play at the speed you choose. You just count. Every so often the game stops and asks for your running count (and true count).</p>
        </div>
      </div>
      <div className="panel tight row" style={{ marginBottom: 12 }}>
        <span className="muted small">Players</span>
        <Seg value={bots} onChange={setBots} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: n, label: String(n) }))} />
        <span className="muted small">Speed</span>
        <Seg value={prefs.speed} onChange={(v) => setPrefs({ speed: v })} options={SPEEDS.map((s) => ({ value: s, label: `${s}×` }))} />
        <span className="muted small">Checks</span>
        <Seg
          value={freq}
          onChange={setFreq}
          options={[
            { value: 'round', label: 'Every round' },
            { value: 'every3', label: 'Every 3' },
            { value: 'random', label: 'Random' },
            { value: 'shoe', label: 'End of shoe' },
          ]}
        />
      </div>
      <div className="panel tight row" style={{ marginBottom: 12 }}>
        <span className="muted small">System</span>
        <select value={prefs.countingSystem} onChange={(e) => setPrefs({ countingSystem: e.target.value })}>
          {SYSTEMS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <Check checked={askTC} onChange={setAskTC}>
          Ask for the true count
        </Check>
        <Check checked={wheels} onChange={setWheels}>
          Training wheels: show the running count
        </Check>
        <Check checked={showDecks} onChange={setShowDecks}>
          Label decks left
        </Check>
      </div>
      {!started ? (
        <div className="panel stack" style={{ alignItems: 'flex-start' }}>
          <p className="text-2">
            Count every card that is turned face up: players' cards, the dealer's upcard, the hole card when it is flipped, and every hit. When the dealer shuffles, reset your count
            {getSystem(prefs.countingSystem).irc ? ` to ${getSystem(prefs.countingSystem).irc!(tableDecks(rules))}` : ' to 0'}.
          </p>
          <button className="btn primary big" onClick={() => setStarted(true)}>
            Start dealing
          </button>
        </div>
      ) : (
        <Watch key={`${bots}`} bots={bots} freq={freq} askTC={askTC} wheels={wheels} showDecks={showDecks} />
      )}
    </main>
  );
}

function Watch({ bots, freq, askTC, wheels, showDecks }: { bots: number; freq: CountCheckSetup['frequency']; askTC: boolean; wheels: boolean; showDecks: boolean }) {
  const { rules, prefs } = useSettings();
  const { table } = useStrategy(rules);
  const setup: GameSetup = {
    mode: 'watch',
    seats: bots,
    humanSeat: null,
    bots,
    botStyles: ['pro', 'tourist', 'counter', 'pro', 'tourist', 'pro'],
    bankroll: 0,
    minBet: 10,
    maxBet: 500,
    deviations: false,
    countChecks: { frequency: freq, askTC },
    autoNext: true,
    countingSystem: prefs.countingSystem,
  };
  const game = useTableGame(setup, rules, table, prefs.speed);
  const [results, setResults] = useState<CountCheck[]>([]);
  const lifetime = useRef(getWatchStats());
  const sys = getSystem(prefs.countingSystem);

  useKeys(
    (k, e) => {
      if (k === ' ' && !game.countPrompt) {
        e.preventDefault();
        game.setPaused(!game.paused);
      }
    },
    [game.paused, game.countPrompt],
  );

  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!game.shuffleFlash) return undefined;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 3500);
    return () => window.clearTimeout(id);
  }, [game.shuffleFlash]);

  const exact = results.filter((r) => r.rcOk).length;

  return (
    <div className="side-layout">
      <div>
        <TableView game={game} humanSeat={null} showDecks={showDecks} label="Watch the cards · count them all" />
        <div className="dock">
          <button className="btn primary" onClick={() => game.setPaused(!game.paused)}>
            {game.paused ? 'Resume' : 'Pause'} <span className="kbd">Space</span>
          </button>
          {flash && <span className="chip gold">Shuffle! Reset your count{sys.irc ? ` to ${sys.irc(tableDecks(rules))}` : ' to 0'}.</span>}
          {wheels && (
            <span className="chip">
              RC <strong className="num">{game.runningCount}</strong>
              {sys.balanced && (
                <>
                  {' '}
                  · TC <strong className="num">{(game.runningCount / Math.max(0.25, game.cardsUnseen / 52)).toFixed(1)}</strong>
                </>
              )}
            </span>
          )}
        </div>
      </div>
      <div className="stack">
        <div className="panel stack" style={{ gap: 8 }}>
          <h3>This session</h3>
          <div className="row between small">
            <span className="muted">Count checks</span>
            <span className="num">{results.length}</span>
          </div>
          <div className="row between small">
            <span className="muted">Exact</span>
            <span className="num">
              {exact}/{results.length}
            </span>
          </div>
          <div className="row between small">
            <span className="muted">Rounds watched</span>
            <span className="num">{game.t.roundId}</span>
          </div>
          <div className="row between small">
            <span className="muted">Lifetime exact</span>
            <span className="num">
              {lifetime.current.exact}/{lifetime.current.checks}
            </span>
          </div>
        </div>
        {results.length > 0 && (
          <div className="panel">
            <h3>Recent checks</h3>
            <table className="data">
              <tbody>
                {results
                  .slice(-8)
                  .reverse()
                  .map((r, i) => (
                    <tr key={i}>
                      <td>#{r.round}</td>
                      <td className="num">you {r.rcAnswer}</td>
                      <td className="num">actual {r.rcActual}</td>
                      <td className={r.rcOk ? 'good' : 'bad'}>{r.rcOk ? '✓' : '✗'}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel small text-2">
          Tips: cancel pairs (a ten and a 5 net to zero), count each hand as a group once its cards are out, and keep your eyes on the cards rather than the players.
        </div>
      </div>
      {game.countPrompt && (
        <CountPromptDialog
          prompt={game.countPrompt}
          systemId={prefs.countingSystem}
          askTC={askTC}
          onSubmit={(rc, tc) => {
            const r = game.submitCount(rc, tc);
            if (r) {
              setResults((x) => [...x, r]);
              lifetime.current = { checks: lifetime.current.checks + 1, exact: lifetime.current.exact + (r.rcOk ? 1 : 0) };
              saveWatchStats(lifetime.current);
            }
            return r;
          }}
          onClose={game.closeCountPrompt}
        />
      )}
    </div>
  );
}

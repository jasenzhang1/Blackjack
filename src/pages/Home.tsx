import { PlayingCard } from '../components/PlayingCard';
import { fmtMoney, fmtPct } from '../components/ui';
import type { Card } from '../engine/cards';
import { getTrainerStats, listQuizAttempts, listSessions, listDrills } from '../state/progress';
import { useSettings } from '../state/settings';
import { Link } from '../router';
import { useStrategy } from '../worker/client';

const HERO: Card[] = [
  { id: 1, face: 'A', suit: 'S', rank: 1 },
  { id: 2, face: 'K', suit: 'H', rank: 10 },
];

export default function Home() {
  const { rules, prefs, openRules } = useSettings();
  const { table } = useStrategy(rules);
  const quiz = listQuizAttempts();
  const bestQuiz = quiz.reduce((m, q) => Math.max(m, q.correct / q.total), 0);
  const trainer = getTrainerStats();
  const sessions = listSessions();
  const drills = listDrills();

  const handsPerHour = 80;
  const hourly = table ? table.houseEdge * prefs.unit * handsPerHour : null;
  const sixFiveCost = table ? table.pPlayerBJWin * 0.3 : null;

  return (
    <main className="page">
      <section className="hero">
        <div>
          <h1>
            Learn the <em>math</em>.<br />
            Master the <em>count</em>.
          </h1>
          <p className="lead">
            Blackjack Lab is a basic-strategy and card-counting trainer that shows its work. Every play in the chart comes with an exact expected-value proof. You can practice the
            count against simulated players and play a bankroll with a coach at your shoulder.
          </p>
          <div className="row" style={{ marginTop: 18 }}>
            <Link to="/strategy" className="btn primary big">
              Open the strategy chart
            </Link>
            <Link to="/counting/learn" className="btn big">
              Learn to count
            </Link>
            <button className="btn ghost" onClick={openRules}>
              Set your table's rules
            </button>
          </div>
        </div>
        <div className="hero-cards" aria-hidden>
          {HERO.map((c) => (
            <PlayingCard key={c.id} card={c} />
          ))}
        </div>
      </section>

      <section className="track">
        <div className="track-card">
          <div className="row">
            <span className="step">1</span>
            <h2 style={{ margin: 0 }}>Basic strategy</h2>
          </div>
          <p className="text-2">The mathematically best play for every hand, and the proof of why. Then drill it until it's automatic.</p>
          <ul>
            <li>
              <Link to="/strategy">
                Interactive chart <span>EV proofs in every cell</span>
              </Link>
            </li>
            <li>
              <Link to="/strategy/quiz">
                Grid quiz <span>fill in the whole chart</span>
              </Link>
            </li>
            <li>
              <Link to="/strategy/trainer">
                Table trainer <span>decide at a live table</span>
              </Link>
            </li>
          </ul>
        </div>
        <div className="track-card">
          <div className="row">
            <span className="step">2</span>
            <h2 style={{ margin: 0 }}>Card counting</h2>
          </div>
          <p className="text-2">Why removing small cards helps you, how to keep a running and true count, and when the count tells you to deviate.</p>
          <ul>
            <li>
              <Link to="/counting/learn">
                Lessons <span>Hi-Lo from zero</span>
              </Link>
            </li>
            <li>
              <Link to="/counting/drills">
                Drills <span>speed and accuracy</span>
              </Link>
            </li>
            <li>
              <Link to="/counting/watch">
                Watch & count <span>simulated players</span>
              </Link>
            </li>
            <li>
              <Link to="/counting/play">
                Count & play <span>graded, with deviations</span>
              </Link>
            </li>
          </ul>
        </div>
        <div className="track-card">
          <div className="row">
            <span className="step">3</span>
            <h2 style={{ margin: 0 }}>Play</h2>
          </div>
          <p className="text-2">Take a practice bankroll to the table. Turn the live coach on or off, then read your report card.</p>
          <ul>
            <li>
              <Link to="/play">
                Casino <span>bankroll + coach</span>
              </Link>
            </li>
            <li>
              <Link to="/reports">
                Report cards <span>{sessions.length} saved</span>
              </Link>
            </li>
            <li>
              <Link to="/rules">
                Rules lab <span>what each rule costs</span>
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <section className="grid-3" style={{ marginTop: 22 }}>
        <div className="panel">
          <h3>Your progress</h3>
          <table className="data">
            <tbody>
              <tr>
                <td>Best grid quiz</td>
                <td className="num">{quiz.length ? `${Math.round(bestQuiz * 100)}%` : '—'}</td>
              </tr>
              <tr>
                <td>Trainer decisions</td>
                <td className="num">{trainer.total ? `${trainer.correct}/${trainer.total}` : '—'}</td>
              </tr>
              <tr>
                <td>Best trainer streak</td>
                <td className="num">{trainer.bestStreak || '—'}</td>
              </tr>
              <tr>
                <td>Drills completed</td>
                <td className="num">{drills.length || '—'}</td>
              </tr>
              <tr>
                <td>Sessions played</td>
                <td className="num">{sessions.length || '—'}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Your table, in numbers</h3>
          {table ? (
            <>
              <p className="text-2">
                With perfect basic strategy the casino keeps <strong>{fmtPct(table.houseEdge, 2)}</strong> of every bet. At {fmtMoney(prefs.unit)} a hand and about {handsPerHour} hands an hour, that
                is about <strong>{fmtMoney(hourly!)}</strong> an hour.
              </p>
              <p className="text-2">
                If blackjack paid 6:5 instead of 3:2, you would give up another <strong>{fmtPct(sixFiveCost!, 2)}</strong>, roughly {fmtMoney(sixFiveCost! * prefs.unit * handsPerHour)} an hour. That
                one rule costs about four times what a whole session of good strategy keeps.
              </p>
            </>
          ) : (
            <p className="muted">Computing…</p>
          )}
        </div>
        <div className="panel">
          <h3>How it works</h3>
          <p className="text-2">
            A combinatorial engine runs in your browser. For each upcard it enumerates every possible sequence of dealer draws, then solves the player's choices with exact card
            removal. These are the same methods professional analyzers use, and they're checked against brute force and simulation.
          </p>
          <Link to="/math">Read the proofs →</Link>
        </div>
      </section>
    </main>
  );
}

import { PlayingCard } from '../components/PlayingCard';
import { fmtMoney, fmtPct } from '../components/ui';
import type { Card } from '../engine/cards';
import { getTrainerStats, listQuizAttempts, listSessions, listDrills } from '../state/progress';
import { useSettings } from '../state/settings';
import { Link } from '../router';
import { useStrategy } from '../worker/client';

/** Every game and lesson, shown as buttons on the home page on phones and tablets. */
const LAUNCHER: { label: string; items: { to: string; label: string; sub: string }[] }[] = [
  {
    label: 'Basic strategy',
    items: [
      { to: '/strategy', label: 'Strategy chart', sub: 'Every play, with proofs' },
      { to: '/strategy/quiz', label: 'Grid quiz', sub: 'Fill in the chart' },
      { to: '/strategy/trainer', label: 'Table trainer', sub: 'Play hands, get graded' },
    ],
  },
  {
    label: 'Card counting',
    items: [
      { to: '/counting/learn', label: 'Learn to count', sub: 'Seven lessons' },
      { to: '/counting/drills', label: 'Drills', sub: 'Tags, counts, conversion' },
      { to: '/counting/watch', label: 'Watch & count', sub: 'Count simulated players' },
      { to: '/counting/play', label: 'Count & play', sub: 'Play while counting' },
    ],
  },
  {
    label: 'Play',
    items: [
      { to: '/play', label: 'Casino', sub: 'Bankroll with a coach' },
      { to: '/reports', label: 'Report cards', sub: 'Past sessions' },
    ],
  },
  {
    label: "Texas Hold'em",
    items: [
      { to: '/holdem', label: 'Training rooms', sub: 'Start here' },
      { to: '/holdem/preflop', label: 'Preflop ranges', sub: 'Charts and drills' },
      { to: '/holdem/pot-odds', label: 'Pot odds', sub: 'Outs and prices' },
      { to: '/holdem/implied-odds', label: 'Implied odds', sub: 'Paying for the future' },
      { to: '/holdem/semi-bluff', label: 'Semi-bluffs', sub: 'Betting your draws' },
      { to: '/holdem/reading', label: 'Reading opponents', sub: 'Ranges and reads' },
      { to: '/holdem/play', label: 'Play table', sub: 'Full hands with a coach' },
    ],
  },
  {
    label: 'Explore',
    items: [
      { to: '/rules', label: 'Rules lab', sub: 'House edge by rule' },
      { to: '/math', label: 'The math', sub: 'All the proofs' },
    ],
  },
];

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
      <section className="launcher">
        <h1>
          Learn the <em>math</em>. Master the <em>count</em>.
        </h1>
        {LAUNCHER.map((g) => (
          <div key={g.label} className="launcher-group">
            <h2>{g.label}</h2>
            <div className="launcher-grid">
              {g.items.map((i) => (
                <Link key={i.to} to={i.to} className="launch-btn">
                  {i.label}
                  <span className="sub">{i.sub}</span>
                </Link>
              ))}
              {g.label === 'Explore' && (
                <button className="launch-btn" onClick={openRules}>
                  Table rules
                  <span className="sub">Set your table's rules</span>
                </button>
              )}
            </div>
          </div>
        ))}
      </section>

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
          <ul>
            <li>
              <Link to="/strategy">
                Interactive chart
              </Link>
            </li>
            <li>
              <Link to="/strategy/quiz">
                Grid quiz
              </Link>
            </li>
            <li>
              <Link to="/strategy/trainer">
                Table trainer
              </Link>
            </li>
          </ul>
        </div>
        <div className="track-card">
          <div className="row">
            <span className="step">2</span>
            <h2 style={{ margin: 0 }}>Card counting</h2>
          </div>
          <ul>
            <li>
              <Link to="/counting/learn">
                Lessons
              </Link>
            </li>
            <li>
              <Link to="/counting/drills">
                Drills
              </Link>
            </li>
            <li>
              <Link to="/counting/watch">
                Watch & count
              </Link>
            </li>
            <li>
              <Link to="/counting/play">
                Count & play
              </Link>
            </li>
          </ul>
        </div>
        <div className="track-card">
          <div className="row">
            <span className="step">3</span>
            <h2 style={{ margin: 0 }}>Play</h2>
          </div>
          <ul>
            <li>
              <Link to="/play">
                Casino
              </Link>
            </li>
            <li>
              <Link to="/reports">
                Report cards
              </Link>
            </li>
            <li>
              <Link to="/rules">
                Rules lab
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <section className="holdem-banner">
        <div>
          <span className="chip gold">New</span>
          <h2>Texas Hold'em training rooms</h2>
          <p className="text-2">Preflop ranges, pot odds, implied odds, semi-bluffs and reading opponents, then full hands at a coached table.</p>
        </div>
        <div className="row">
          <Link to="/holdem/preflop" className="btn">
            Preflop
          </Link>
          <Link to="/holdem/pot-odds" className="btn">
            Pot odds
          </Link>
          <Link to="/holdem/implied-odds" className="btn">
            Implied odds
          </Link>
          <Link to="/holdem/semi-bluff" className="btn">
            Semi-bluffs
          </Link>
          <Link to="/holdem/reading" className="btn">
            Reading opponents
          </Link>
          <Link to="/holdem/play" className="btn primary">
            Play table →
          </Link>
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

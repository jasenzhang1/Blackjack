import { PlayingCard } from '../components/PlayingCard';
import type { Card } from '../engine/cards';
import { getTrainerStats, listQuizAttempts, listSessions, listDrills } from '../state/progress';
import { useSettings } from '../state/settings';
import { Link } from '../router';

type Item = { to: string; label: string; sub: string };
type Group = { label: string; items: Item[] };
type Game = { name: string; icon: string; groups: Group[] };

/**
 * Every game and lesson, grouped by game. Phones and tablets show these as buttons; desktop shows
 * each group as a track card.
 */
const BLACKJACK: Game = {
  name: 'Blackjack',
  icon: '♠',
  groups: [
    {
      label: 'Basic Strategy',
      items: [
        { to: '/strategy', label: 'Strategy Chart', sub: 'Every play, with proofs' },
        { to: '/strategy/tricks', label: 'Memory Tricks', sub: 'Phrases for the chart' },
        { to: '/strategy/quiz', label: 'Grid Quiz', sub: 'Fill in the chart' },
        { to: '/strategy/trainer', label: 'Table Trainer', sub: 'Play hands, get graded' },
      ],
    },
    {
      label: 'Card Counting',
      items: [
        { to: '/counting/learn', label: 'Learn to Count', sub: 'Seven lessons' },
        { to: '/counting/drills', label: 'Drills', sub: 'Tags, counts, conversion' },
        { to: '/counting/watch', label: 'Watch & Count', sub: 'Count simulated players' },
        { to: '/counting/play', label: 'Count & Play', sub: 'Play while counting' },
      ],
    },
    {
      label: 'Play',
      items: [
        { to: '/play', label: 'Casino', sub: 'Bankroll with a coach' },
        { to: '/reports', label: 'Report Cards', sub: 'Past sessions' },
        { to: '/rules', label: 'Rules Lab', sub: 'House edge by rule' },
        { to: '/math', label: 'The Math', sub: 'All the proofs' },
      ],
    },
  ],
};

const HOLDEM: Game = {
  name: "Texas Hold'em",
  icon: '♣',
  groups: [
    {
      label: 'Learn',
      items: [
        { to: '/holdem', label: 'Training Rooms', sub: 'Start here' },
        { to: '/holdem/preflop', label: 'Preflop Ranges', sub: 'Charts and drills' },
        { to: '/holdem/pot-odds', label: 'Pot Odds', sub: 'Outs and prices' },
        { to: '/holdem/implied-odds', label: 'Implied Odds', sub: 'Paying for the future' },
        { to: '/holdem/semi-bluff', label: 'Semi-Bluffs', sub: 'Betting your draws' },
        { to: '/holdem/reading', label: 'Reading Opponents', sub: 'Ranges and reads' },
      ],
    },
    {
      label: 'Play',
      items: [{ to: '/holdem/play', label: 'Play Table', sub: 'Full hands with a coach' }],
    },
  ],
};

const HERO: Card[] = [
  { id: 1, face: 'A', suit: 'S', rank: 1 },
  { id: 2, face: 'K', suit: 'H', rank: 10 },
];

function GameHead({ game }: { game: Game }) {
  return (
    <div className="game-head">
      <span className="game-icon" aria-hidden>
        {game.icon}
      </span>
      <h2>{game.name}</h2>
    </div>
  );
}

/** Phone and tablet layout: one block of big buttons per game. */
function Launcher({ game, extra }: { game: Game; extra?: React.ReactNode }) {
  return (
    <div className="game-section">
      <GameHead game={game} />
      {game.groups.map((g, gi) => (
        <div key={g.label} className="launcher-group">
          <h3>{g.label}</h3>
          <div className="launcher-grid">
            {g.items.map((i) => (
              <Link key={i.to} to={i.to} className="launch-btn">
                {i.label}
                <span className="sub">{i.sub}</span>
              </Link>
            ))}
            {gi === game.groups.length - 1 && extra}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Desktop layout: one numbered track card per group. */
function Track({ game }: { game: Game }) {
  return (
    <section className="track">
      {game.groups.map((g, gi) => (
        <div key={g.label} className="track-card">
          <div className="row">
            <span className="step"><span>{gi + 1}</span></span>
            <h3 style={{ margin: 0 }}>{g.label}</h3>
          </div>
          <ul>
            {g.items.map((i) => (
              <li key={i.to}>
                <Link to={i.to}>{i.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="muted small">{k}</div>
      <strong className="num" style={{ fontSize: 20 }}>
        {v}
      </strong>
    </div>
  );
}

export default function Home() {
  const { openRules } = useSettings();
  const quiz = listQuizAttempts();
  const bestQuiz = quiz.reduce((m, q) => Math.max(m, q.correct / q.total), 0);
  const trainer = getTrainerStats();
  const sessions = listSessions();
  const drills = listDrills();

  return (
    <main className="page">
      <section className="launcher">
        <Launcher
          game={BLACKJACK}
          extra={
            <button className="launch-btn" onClick={openRules}>
              Table Rules
              <span className="sub">Set your table's rules</span>
            </button>
          }
        />
        <Launcher game={HOLDEM} />
      </section>

      <div className="game-section desk-only">
        <GameHead game={BLACKJACK} />
        <section className="hero">
          <div>
            <h1>
              Learn the <em>math</em>.<br />
              Master the <em>count</em>.
            </h1>
            <p className="lead">A basic-strategy and card-counting trainer with an exact EV proof for every play.</p>
            <div className="row" style={{ marginTop: 18 }}>
              <Link to="/strategy" className="btn primary big">
                Open the Strategy Chart
              </Link>
              <Link to="/counting/learn" className="btn big">
                Learn to Count
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

        <Track game={BLACKJACK} />

        <div className="panel home-stats" style={{ marginTop: 16 }}>
          <h3>Your Progress</h3>
          <div className="row" style={{ gap: 28 }}>
            <Stat k="Best grid quiz" v={quiz.length ? `${Math.round(bestQuiz * 100)}%` : '—'} />
            <Stat k="Trainer decisions" v={trainer.total ? `${trainer.correct}/${trainer.total}` : '—'} />
            <Stat k="Best trainer streak" v={trainer.bestStreak ? String(trainer.bestStreak) : '—'} />
            <Stat k="Drills completed" v={drills.length ? String(drills.length) : '—'} />
            <Stat k="Sessions played" v={sessions.length ? String(sessions.length) : '—'} />
          </div>
        </div>
      </div>

      <div className="game-section holdem desk-only">
        <GameHead game={HOLDEM} />
        <Track game={HOLDEM} />
      </div>
    </main>
  );
}

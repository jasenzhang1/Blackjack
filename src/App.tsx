import { lazy, Suspense, useEffect, useState } from 'react';
import { AccountButton } from './components/Account';
import { GuestReminder } from './components/GuestReminder';
import { RulesDialog, SettingsButtons } from './components/RulesDialog';
import { Link, useRoute } from './router';
import { useSettings } from './state/settings';

const Home = lazy(() => import('./pages/Home'));
const StrategyChart = lazy(() => import('./pages/StrategyChart'));
const GridQuiz = lazy(() => import('./pages/GridQuiz'));
const Trainer = lazy(() => import('./pages/Trainer'));
const MemoryTricksPage = lazy(() => import('./pages/MemoryTricksPage'));
const LearnCounting = lazy(() => import('./pages/LearnCounting'));
const Drills = lazy(() => import('./pages/Drills'));
const WatchCount = lazy(() => import('./pages/WatchCount'));
const CountPlay = lazy(() => import('./pages/CountPlay'));
const Casino = lazy(() => import('./pages/Casino'));
const Reports = lazy(() => import('./pages/Reports'));
const RulesLab = lazy(() => import('./pages/RulesLab'));
const MathPage = lazy(() => import('./pages/MathPage'));
const HoldemLobby = lazy(() => import('./pages/holdem/Lobby'));
const PotOdds = lazy(() => import('./pages/holdem/PotOdds'));
const ImpliedOdds = lazy(() => import('./pages/holdem/ImpliedOdds'));
const SemiBluff = lazy(() => import('./pages/holdem/SemiBluff'));
const Reading = lazy(() => import('./pages/holdem/Reading'));
const Preflop = lazy(() => import('./pages/holdem/Preflop'));
const PlayTable = lazy(() => import('./pages/holdem/Play'));

const ROUTES: Record<string, React.ComponentType> = {
  '/': Home,
  '/strategy': StrategyChart,
  '/strategy/quiz': GridQuiz,
  '/strategy/trainer': Trainer,
  '/strategy/tricks': MemoryTricksPage,
  '/counting/learn': LearnCounting,
  '/counting/drills': Drills,
  '/counting/watch': WatchCount,
  '/counting/play': CountPlay,
  '/play': Casino,
  '/reports': Reports,
  '/rules': RulesLab,
  '/math': MathPage,
  '/holdem': HoldemLobby,
  '/holdem/pot-odds': PotOdds,
  '/holdem/implied-odds': ImpliedOdds,
  '/holdem/semi-bluff': SemiBluff,
  '/holdem/reading': Reading,
  '/holdem/preflop': Preflop,
  '/holdem/play': PlayTable,
};

const GROUPS: { label: string; prefix: string; items: { to: string; label: string }[] }[] = [
  {
    label: 'Strategy',
    prefix: '/strategy',
    items: [
      { to: '/strategy', label: 'Strategy Chart' },
      { to: '/strategy/tricks', label: 'Memory Tricks' },
      { to: '/strategy/quiz', label: 'Grid Quiz' },
      { to: '/strategy/trainer', label: 'Table Trainer' },
    ],
  },
  {
    label: 'Counting',
    prefix: '/counting',
    items: [
      { to: '/counting/learn', label: 'Learn to Count' },
      { to: '/counting/drills', label: 'Drills' },
      { to: '/counting/watch', label: 'Watch & Count' },
      { to: '/counting/play', label: 'Count & Play' },
    ],
  },
  {
    label: 'Play',
    prefix: '/play',
    items: [
      { to: '/play', label: 'Casino' },
      { to: '/reports', label: 'Report Cards' },
    ],
  },
  {
    label: "Hold'em",
    prefix: '/holdem',
    items: [
      { to: '/holdem', label: 'Training rooms' },
      { to: '/holdem/preflop', label: 'Preflop ranges' },
      { to: '/holdem/pot-odds', label: 'Pot odds' },
      { to: '/holdem/implied-odds', label: 'Implied odds' },
      { to: '/holdem/semi-bluff', label: 'Semi-bluffs' },
      { to: '/holdem/reading', label: 'Reading opponents' },
      { to: '/holdem/play', label: 'Play table' },
    ],
  },
];

function TopNav() {
  const path = useRoute();
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setOpen(null), [path]);
  return (
    <header className="topnav no-print">
      <div className="topnav-inner">
        <Link to="/" className="brand">
          <span className="brand-mark">♠</span>
          <span className="brand-text">Blackjack Lab</span>
        </Link>
        <nav className="nav" aria-label="Main">
          {GROUPS.map((g) => (
            <div
              key={g.label}
              className={`nav-group ${open === g.label ? 'open' : ''}`}
              onMouseLeave={() => setOpen((o) => (o === g.label ? null : o))}
            >
              <button
                className={`nav-btn ${path.startsWith(g.prefix) || g.items.some((i) => i.to === path) ? 'active' : ''}`}
                aria-expanded={open === g.label}
                onClick={() => setOpen((o) => (o === g.label ? null : g.label))}
              >
                {g.label} <span aria-hidden>▾</span>
              </button>
              <div className="nav-menu">
                {g.items.map((i) => (
                  <Link key={i.to} to={i.to}>
                    {i.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
          <Link to="/rules" className="nav-link">
            Rules Lab
          </Link>
          <Link to="/math" className="nav-link">
            The Math
          </Link>
        </nav>
        <div className="topnav-right">
          {/* Phones and tablets get no dropdown menu: the home page lists every game and lesson as a button. */}
          {path !== '/' && (
            <Link to="/" className="btn small home-btn">
              ← Home
            </Link>
          )}
          <SettingsButtons />
          <AccountButton />
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const path = useRoute();
  const { rulesDialogOpen, prefs } = useSettings();
  const Page = ROUTES[path] ?? Home;
  // Re-mount the page when account data is synced in, so it shows the merged stats.
  const [syncTick, setSyncTick] = useState(0);
  useEffect(() => {
    const on = () => setSyncTick((t) => t + 1);
    window.addEventListener('bjlab-sync', on);
    return () => window.removeEventListener('bjlab-sync', on);
  }, []);
  return (
    <div className={`app ${prefs.reduceMotion ? 'reduce-motion' : ''}`}>
      <TopNav />
      <Suspense fallback={<div className="page muted">Loading…</div>}>
        <Page key={`${path}#${syncTick}`} />
      </Suspense>
      {rulesDialogOpen && <RulesDialog />}
      <GuestReminder />
    </div>
  );
}

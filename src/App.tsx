import { lazy, Suspense, useEffect, useState } from 'react';
import { RulesBar, RulesDialog } from './components/RulesDialog';
import { Link, useRoute } from './router';
import { useSettings } from './state/settings';

const Home = lazy(() => import('./pages/Home'));
const StrategyChart = lazy(() => import('./pages/StrategyChart'));
const GridQuiz = lazy(() => import('./pages/GridQuiz'));
const Trainer = lazy(() => import('./pages/Trainer'));
const LearnCounting = lazy(() => import('./pages/LearnCounting'));
const Drills = lazy(() => import('./pages/Drills'));
const WatchCount = lazy(() => import('./pages/WatchCount'));
const CountPlay = lazy(() => import('./pages/CountPlay'));
const Casino = lazy(() => import('./pages/Casino'));
const Reports = lazy(() => import('./pages/Reports'));
const RulesLab = lazy(() => import('./pages/RulesLab'));
const MathPage = lazy(() => import('./pages/MathPage'));

const ROUTES: Record<string, React.ComponentType> = {
  '/': Home,
  '/strategy': StrategyChart,
  '/strategy/quiz': GridQuiz,
  '/strategy/trainer': Trainer,
  '/counting/learn': LearnCounting,
  '/counting/drills': Drills,
  '/counting/watch': WatchCount,
  '/counting/play': CountPlay,
  '/play': Casino,
  '/reports': Reports,
  '/rules': RulesLab,
  '/math': MathPage,
};

const GROUPS: { label: string; prefix: string; items: { to: string; label: string }[] }[] = [
  {
    label: 'Strategy',
    prefix: '/strategy',
    items: [
      { to: '/strategy', label: 'Strategy chart' },
      { to: '/strategy/quiz', label: 'Grid quiz' },
      { to: '/strategy/trainer', label: 'Table trainer' },
    ],
  },
  {
    label: 'Counting',
    prefix: '/counting',
    items: [
      { to: '/counting/learn', label: 'Learn to count' },
      { to: '/counting/drills', label: 'Drills' },
      { to: '/counting/watch', label: 'Watch & count' },
      { to: '/counting/play', label: 'Count & play' },
    ],
  },
  {
    label: 'Play',
    prefix: '/play',
    items: [
      { to: '/play', label: 'Casino' },
      { to: '/reports', label: 'Report cards' },
    ],
  },
];

function TopNav() {
  const path = useRoute();
  const [open, setOpen] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    setOpen(null);
    setMobile(false);
  }, [path]);
  return (
    <header className="topnav no-print">
      <div className="topnav-inner">
        <Link to="/" className="brand">
          <span className="brand-mark">♠</span> Blackjack Lab
        </Link>
        <button className="btn ghost small nav-toggle" onClick={() => setMobile((m) => !m)} aria-label="Menu" aria-expanded={mobile}>
          ☰
        </button>
        <nav className={`nav ${mobile ? 'open' : ''}`} aria-label="Main">
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
            Rules lab
          </Link>
          <Link to="/math" className="nav-link">
            The math
          </Link>
        </nav>
      </div>
    </header>
  );
}

export default function App() {
  const path = useRoute();
  const { rulesDialogOpen, prefs } = useSettings();
  const Page = ROUTES[path] ?? Home;
  return (
    <div className={`app ${prefs.reduceMotion ? 'reduce-motion' : ''}`}>
      <TopNav />
      <RulesBar />
      <Suspense fallback={<div className="page muted">Loading…</div>}>
        <Page key={path} />
      </Suspense>
      <footer className="footer no-print">
        Blackjack Lab: exact combinatorial EVs for every play. Practice money only. Card counting is a legal skill, but casinos may refuse your action.
      </footer>
      {rulesDialogOpen && <RulesDialog />}
    </div>
  );
}

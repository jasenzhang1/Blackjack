import { Link } from '../router';

export default function About() {
  return (
    <main className="page narrow-page">
      <h1>About</h1>
      <div className="panel stack">
        <p>A pocket gym for optimal casino play. Drill blackjack basic strategy, card counting and Texas Hold'em decisions until they're automatic.</p>
        <p>Practice money only.</p>
      </div>
      <h2 style={{ marginTop: 24 }}>How It Works</h2>
      <div className="panel stack">
        <p>A combinatorial engine in your browser solves every blackjack play exactly, with card removal. Hold'em spots are checked against equities computed over every runout.</p>
        <div className="row">
          <Link to="/math" className="btn small">
            Read the proofs →
          </Link>
          <Link to="/house-edge" className="btn small">
            See your house edge →
          </Link>
        </div>
      </div>
    </main>
  );
}

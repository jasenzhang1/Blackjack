import { TeX } from '../../components/TeX';
import { parseCards } from '../../holdem/cards';
import { getHoldemStats, type RoomId } from '../../holdem/progress';
import { HCards, pct } from '../../holdem/ui';
import { Link } from '../../router';

const ROOMS: { id: RoomId; to: string; title: string; tag: string; learn: string[] }[] = [
  {
    id: 'preflop',
    to: '/holdem/preflop',
    title: 'Preflop ranges',
    tag: 'Before the flop',
    learn: ['Opening ranges by seat', 'Defending against a raise', 'Facing tight and light 3-bets', 'Paint ranges from memory'],
  },
  {
    id: 'potodds',
    to: '/holdem/pot-odds',
    title: 'Pot odds',
    tag: 'Price a call',
    learn: ['Count outs and spot dirty ones', 'Turn a bet size into the equity you need', 'Rule of 2 and 4 against the exact numbers'],
  },
  {
    id: 'implied',
    to: '/holdem/implied-odds',
    title: 'Implied odds',
    tag: 'Price the future',
    learn: ['Break-even future winnings', 'Stack depth, disguise and who pays you off', 'Reverse implied odds from dominated draws'],
  },
  {
    id: 'semibluff',
    to: '/holdem/semi-bluff',
    title: 'Semi-bluffs',
    tag: 'Bet your draws',
    learn: ['Fold equity plus equity when called', 'Break-even fold percentages by bet size', 'When the free card beats betting'],
  },
  {
    id: 'reading',
    to: '/holdem/reading',
    title: 'Reading opponents',
    tag: 'Ranges and reads',
    learn: ['Player types from HUD stats', 'Combo counting with blockers', 'What a bet means, and the exploit'],
  },
];

const HERO = parseCards('AhKh');

export default function HoldemLobby() {
  const stats = getHoldemStats();
  return (
    <main className="page holdem-page">
      <section className="hero holdem-hero">
        <div>
          <h1>
            Hold'em <em>training rooms</em>
          </h1>
          <p className="lead">
            Practise the decisions strong players make without thinking: preflop ranges, pot odds, implied odds and semi-bluffs, plus reading the player across the table. Every spot is dealt at random, and every
            answer is checked against equities computed exactly over every runout and every hand in the opponent's range.
          </p>
        </div>
        <div className="hero-cards" aria-hidden>
          <HCards cards={HERO} size="lg" />
        </div>
      </section>

      <section className="room-grid">
        {ROOMS.map((r, i) => {
          const s = stats[r.id];
          return (
            <Link key={r.id} to={r.to} className="room-card">
              <div className="row between">
                <span className="step"><span>{i + 1}</span></span>
                <span className="chip">{r.tag}</span>
              </div>
              <h2>{r.title}</h2>
              <ul>
                {r.learn.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <div className="room-foot small">
                {s && s.hands ? (
                  <>
                    <span>
                      {s.correct}/{s.hands} decisions right
                    </span>
                    <span className="muted">best streak {s.bestStreak}</span>
                  </>
                ) : (
                  <span className="muted">Not started</span>
                )}
                <span className="go">Enter →</span>
              </div>
            </Link>
          );
        })}
      </section>

      <Link to="/holdem/play" className="play-banner">
        <div>
          <span className="chip gold">Put it together</span>
          <h2>Play table</h2>
          <p className="text-2">
            Full hands at a six-max table against five bot players of different types. A coach tracks your opponent's range from their actions, values every option and grades you on a report card.
          </p>
        </div>
        <span className="btn primary big">Sit down →</span>
      </Link>

      <section className="grid-2" style={{ marginTop: 22 }}>
        <div className="panel">
          <h3>Cheat sheet</h3>
          <table className="data">
            <tbody>
              <tr>
                <td>Equity to call a bet</td>
                <td>
                  <TeX>{'\\dfrac{B}{P + 2B}'}</TeX>
                </td>
              </tr>
              <tr>
                <td>Hit chance, one card / two cards</td>
                <td>
                  <TeX>{'\\approx 2\\% \\times \\text{outs}\\;/\\;4\\% \\times \\text{outs}'}</TeX>
                </td>
              </tr>
              <tr>
                <td>Implied winnings needed</td>
                <td>
                  <TeX>{'W^* = \\dfrac{B}{h} - (P + 2B)'}</TeX>
                </td>
              </tr>
              <tr>
                <td>Folds a pure bluff needs</td>
                <td>
                  <TeX>{'\\dfrac{B}{P + B}'}</TeX>
                </td>
              </tr>
              <tr>
                <td>Semi-bluff EV</td>
                <td>
                  <TeX>{'F P + (1-F)[q_c(P+2B) - B]'}</TeX>
                </td>
              </tr>
              <tr>
                <td>Combos: pair / suited / offsuit</td>
                <td>6 / 4 / 12</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h3>Bet sizes at a glance</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Bet</th>
                <th className="num">Caller needs</th>
                <th className="num">Bluff needs folds</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['¼ pot', 0.25],
                ['⅓ pot', 1 / 3],
                ['½ pot', 0.5],
                ['⅔ pot', 2 / 3],
                ['¾ pot', 0.75],
                ['Pot', 1],
                ['2× pot', 2],
              ].map(([l, f]) => (
                <tr key={l as string}>
                  <td>{l}</td>
                  <td className="num">{pct((f as number) / (1 + 2 * (f as number)))}</td>
                  <td className="num">{pct((f as number) / (1 + (f as number)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 8 }}>
            Practice only: the opponents are models of common player types, described in each room.
          </p>
        </div>
      </section>
    </main>
  );
}

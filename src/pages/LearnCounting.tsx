import { useMemo, useRef, useState } from 'react';
import { DivergingColumns, LineChart } from '../components/charts';
import { PlayingCard } from '../components/PlayingCard';
import { TeX } from '../components/TeX';
import { ACTION_HEX, Progress, Seg, fmtPct, fmtSignedPct } from '../components/ui';
import { buildShoe, rankText, type Card, type Rank } from '../engine/cards';
import { HI_LO } from '../engine/counting';
import { DEVIATIONS, deviationIndex, describeDeviation, fmtIdx } from '../engine/deviations';
import { ACTION_NAMES, type Action } from '../engine/ev';
import { rulesKey, tableDecks } from '../engine/rules';
import { mulberry32, randomSeed, shuffle } from '../engine/rng';
import { Link } from '../router';
import { useSettings } from '../state/settings';
import { useEngine, useStrategy } from '../worker/client';

const LESSONS = [
  'Why counting works',
  'The Hi-Lo tags',
  'The running count',
  'The true count',
  'Betting with the count',
  'Playing deviations',
  'Your practice plan',
];

export default function LearnCounting() {
  const [i, setI] = useState(0);
  const Lesson = [L1, L2, L3, L4, L5, L6, L7][i];
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Learn to Count Cards</h1>
        </div>
      </div>
      <div className="lesson-layout">
        <nav className="lesson-nav" aria-label="Lessons">
          {LESSONS.map((l, j) => (
            <button key={l} className={j === i ? 'on' : ''} onClick={() => setI(j)}>
              <span className="n">{j + 1}</span>
              {l}
            </button>
          ))}
        </nav>
        <article className="lesson">
          <Lesson />
          <div className="row between" style={{ marginTop: 26 }}>
            <button className="btn" disabled={i === 0} onClick={() => setI(i - 1)}>
              ← {i > 0 ? LESSONS[i - 1] : 'Previous'}
            </button>
            <button className="btn primary" disabled={i === LESSONS.length - 1} onClick={() => setI(i + 1)}>
              {i < LESSONS.length - 1 ? LESSONS[i + 1] : 'Next'} →
            </button>
          </div>
        </article>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------------------------------------

function L1() {
  const { rules } = useSettings();
  const r1 = { ...rules, decks: 1 };
  const { data, progress } = useEngine<'eor'>(`eor|${rulesKey(r1)}`, () => ({ type: 'eor', rules: r1 }));
  // Betting correlation: cosine similarity between Hi-Lo tags and the EORs (tens weighted ×4).
  const bc = useMemo(() => {
    if (!data) return null;
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (const p of data) {
      const w = p.rank === 10 ? 4 : 1;
      const t = HI_LO.tags[p.rank];
      sxy += w * t * p.eor;
      sxx += w * t * t;
      syy += w * p.eor * p.eor;
    }
    return sxy / Math.sqrt(sxx * syy);
  }, [data]);
  return (
    <>
      <h2>1 · Why counting works</h2>
      <p>
        A roulette wheel has no memory, but a blackjack shoe does. Cards that have been dealt stay out until the shuffle, so <strong>the odds of the next hand depend on what is left</strong>.
        Some cards help you when they are still in the shoe and others help the dealer.
      </p>
      <p>A shoe that is rich in tens and aces favours the player:</p>
      <ul>
        <li>
          <strong>More blackjacks.</strong> Both sides get them equally often, but yours pays 3:2 and the dealer's only takes your bet at 1:1.
        </li>
        <li>
          <strong>Better doubles and splits.</strong> 11 against a 6 wins more when the next card is likely a ten. You choose when to double. The dealer never doubles.
        </li>
        <li>
          <strong>The dealer busts more.</strong> The dealer must hit 12–16 and can't stand on a stiff. You can.
        </li>
        <li>
          <strong>Insurance becomes a good bet</strong> once more than a third of the unseen cards are tens (lesson 6).
        </li>
      </ul>
      <p>Small cards (2–6) do the opposite: they turn the dealer's stiff hands into 17–21.</p>
      <div className="widget">
        <div className="widget-title">Effect of removing one card from a single deck (computed by the engine)</div>
        {!data ? (
          <Progress value={progress} label="Solving the game 11 times, once with each rank removed…" />
        ) : (
          <>
            <DivergingColumns
              data={data.map((p) => ({ label: rankText(p.rank), value: p.eor }))}
              format={(v) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}%`}
              xLabel="Card removed"
              yLabel="Change in player edge"
              posLabel="Removing it helps you"
              negLabel="Removing it hurts you"
            />
            <p className="small text-2" style={{ marginTop: 8 }}>
              Taking a 5 out of the deck helps the player most. Taking out a ten or an ace hurts most. Hi-Lo's tags (+1 for 2–6, −1 for tens and aces) line up with these effects with a{' '}
              <strong>betting correlation of {bc!.toFixed(3)}</strong>, computed from the bars above. That is why such a simple count captures almost all of the information.
            </p>
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function L2() {
  const rand = useRef(mulberry32(randomSeed()));
  const [cards, setCards] = useState<Card[]>(() => shuffle(buildShoe(1), rand.current).slice(0, 12));
  const [i, setI] = useState(0);
  const [score, setScore] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const answer = (v: number) => {
    const t = HI_LO.tags[cards[i].rank];
    if (v === t) setScore((s) => s + 1);
    setMsg(v === t ? '✓' : `✗ ${cards[i].face} is ${t > 0 ? '+1' : t}`);
    setI(i + 1);
  };
  return (
    <>
      <h2>2 · The Hi-Lo tags</h2>
      <p>Hi-Lo gives every card one of three values. You only need to remember two groups:</p>
      <table className="data" style={{ maxWidth: 520 }}>
        <thead>
          <tr>
            <th>Cards</th>
            <th className="num">Tag</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2, 3, 4, 5, 6</td>
            <td className="num good">+1</td>
            <td>Seeing them leave makes the shoe better for you</td>
          </tr>
          <tr>
            <td>7, 8, 9</td>
            <td className="num">0</td>
            <td>Roughly neutral</td>
          </tr>
          <tr>
            <td>10, J, Q, K, A</td>
            <td className="num bad">−1</td>
            <td>Seeing them leave makes the shoe worse for you</td>
          </tr>
        </tbody>
      </table>
      <p style={{ marginTop: 10 }}>
        The count is <strong>balanced</strong>: one deck has 20 low cards (+20) and 20 high cards (−20), so a full deck sums to exactly zero. After the shuffle you start at 0. A positive
        count means more high cards are left than usual.
      </p>
      <div className="widget">
        <div className="widget-title">Quick check: tag these 12 cards</div>
        {i < cards.length ? (
          <div className="row" style={{ gap: 24 }}>
            <PlayingCard card={cards[i]} size="lg" />
            <div className="stack">
              <div className="tag-buttons">
                {[1, 0, -1].map((v) => (
                  <button key={v} className="btn" onClick={() => answer(v)}>
                    {v > 0 ? '+1' : v}
                  </button>
                ))}
              </div>
              <span className="muted small">
                Card {i + 1} of {cards.length} · {msg}
              </span>
            </div>
          </div>
        ) : (
          <div className="row">
            <strong>
              {score}/{cards.length} correct.
            </strong>
            <button
              className="btn"
              onClick={() => {
                setCards(shuffle(buildShoe(1), rand.current).slice(0, 12));
                setI(0);
                setScore(0);
                setMsg(null);
              }}
            >
              Again
            </button>
            <Link to="/counting/drills">Full drills →</Link>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function L3() {
  const rand = useRef(mulberry32(randomSeed()));
  const [cards, setCards] = useState<Card[]>(() => shuffle(buildShoe(1), rand.current).slice(0, 10));
  const [ans, setAns] = useState('');
  const [shown, setShown] = useState(false);
  const rc = cards.reduce((a, c) => a + HI_LO.tags[c.rank], 0);
  return (
    <>
      <h2>3 · The running count</h2>
      <p>
        The <strong>running count</strong> (RC) is the sum of the tags of every card you have seen since the shuffle. That includes all players' cards, the dealer's upcard, every hit,
        and the hole card once it is turned over.
      </p>
      <ul>
        <li>
          <strong>Cancel pairs.</strong> A ten and a 4 are −1 and +1, so ignore them both. Most hands contain such pairs.
        </li>
        <li>
          <strong>Count by hand, not by card.</strong> When a player's two cards land, add their net value in one step.
        </li>
        <li>
          <strong>Keep the count to yourself.</strong> Don't move your lips. Practise until it costs you no effort.
        </li>
      </ul>
      <div className="widget">
        <div className="widget-title">Count this round</div>
        <div className="hand spread" style={{ flexWrap: 'wrap', gap: 6 }}>
          {cards.map((c) => (
            <PlayingCard key={c.id} card={c} size="sm" />
          ))}
        </div>
        <form
          className="row"
          style={{ marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            setShown(true);
          }}
        >
          <label className="field">
            Running count
            <input type="number" value={ans} onChange={(e) => setAns(e.target.value)} />
          </label>
          <button className="btn primary" type="submit" style={{ alignSelf: 'flex-end' }}>
            Check
          </button>
          <button
            type="button"
            className="btn"
            style={{ alignSelf: 'flex-end' }}
            onClick={() => {
              setCards(shuffle(buildShoe(1), rand.current).slice(0, 10));
              setAns('');
              setShown(false);
            }}
          >
            New cards
          </button>
        </form>
        {shown && (
          <div className={`callout ${Number(ans) === rc ? 'good' : 'bad'}`} style={{ marginTop: 10 }}>
            {Number(ans) === rc ? '✓ Correct' : '✗'}: the running count is {rc > 0 ? `+${rc}` : rc} ({cards.map((c) => `${c.face}:${HI_LO.tags[c.rank] > 0 ? '+1' : HI_LO.tags[c.rank]}`).join(' ')}).
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function L4() {
  const { rules } = useSettings();
  const { table } = useStrategy(rules);
  const [rc, setRc] = useState(6);
  const [left, setLeft] = useState(3);
  const tc = rc / left;
  const edge = table ? -table.houseEdge + 0.005 * tc : null;
  return (
    <>
      <h2>4 · The true count</h2>
      <p>
        A running count of +6 means 6 more high cards than low cards remain. That is a big deal with one deck left and almost nothing with six. What matters is the <strong>density</strong>{' '}
        of the surplus, so divide by the decks remaining:
      </p>
      <TeX block>{String.raw`\text{true count} = \frac{\text{running count}}{\text{decks remaining}}`}</TeX>
      <p>
        <strong>Why this works.</strong> For a balanced count, the unseen cards' tags sum to −RC. With <TeX>D</TeX> decks left, the surplus of high cards per deck is <TeX>{String.raw`\mathrm{RC}/D`}</TeX>.
        A card's chance of being a ten, and so the player's edge, depends on that per-deck surplus. That is why a single true count index works at any depth in the shoe (to first order).
      </p>
      <p>
        <strong>Estimating decks remaining.</strong> Glance at the discard tray. If 2 of 6 decks are in the tray, about 4 remain (cards on the table count as dealt). Rounding to the nearest
        half deck is plenty accurate.
      </p>
      <div className="widget">
        <div className="widget-title">True-count calculator</div>
        <div className="grid-2">
          <label className="field">
            Running count: <strong className="num">{rc > 0 ? `+${rc}` : rc}</strong>
            <input type="range" min={-20} max={20} value={rc} onChange={(e) => setRc(Number(e.target.value))} />
          </label>
          <label className="field">
            Decks remaining: <strong className="num">{left}</strong>
            <input type="range" min={0.5} max={tableDecks(rules)} step={0.5} value={left} onChange={(e) => setLeft(Number(e.target.value))} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 24 }}>
          <div>
            True count <div className="big-count">{tc >= 0 ? '+' : ''}{tc.toFixed(1)}</div>
          </div>
          {edge !== null && (
            <div>
              Estimated player edge <div className={`big-count ${edge >= 0 ? 'good' : 'bad'}`}>{fmtSignedPct(edge, 2)}</div>
              <span className="muted small">≈ −{fmtPct(table!.houseEdge, 2)} house edge + 0.5% × TC</span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function L5() {
  const { rules } = useSettings();
  const tcs = [-4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
  const decksLeft = Math.min(3, Math.max(1, Math.round(tableDecks(rules) / 2)));
  const { data, progress } = useEngine<'edgeVsCount'>(`edge|${rulesKey(rules)}|${decksLeft}`, () => ({ type: 'edgeVsCount', rules, tcs, decksLeft }));
  const breakEven = useMemo(() => {
    if (!data) return null;
    for (let i = 1; i < data.length; i++) {
      const a = data[i - 1].basic;
      const b = data[i].basic;
      if (a < 0 && b >= 0) return data[i - 1].tc + (-a / (b - a)) * (data[i].tc - data[i - 1].tc);
    }
    return null;
  }, [data]);
  return (
    <>
      <h2>5 · Betting with the count</h2>
      <p>
        Counting earns money mainly by <strong>betting more when you have the edge</strong>. Each Hi-Lo true-count point is worth about +0.5% to the player, so the edge goes from negative off
        the top to positive once the count climbs.
      </p>
      <div className="widget">
        <div className="widget-title">Player edge vs. true count, exact for your rules ({decksLeft} decks left)</div>
        {!data ? (
          <Progress value={progress} label={`Solving the whole game at ${tcs.length} different shoe compositions…`} />
        ) : (
          <>
            <LineChart
              series={[
                { id: 'basic', label: 'Basic Strategy', color: '#3987e5', points: data.map((d) => ({ x: d.tc, y: d.basic })) },
                { id: 'perfect', label: 'Perfect play', color: '#d95926', points: data.map((d) => ({ x: d.tc, y: d.perfect })) },
              ]}
              xLabel="Hi-Lo true count"
              yLabel="Player edge"
              xFormat={(v) => (v > 0 ? `+${v}` : String(v))}
              yFormat={(v) => `${(v * 100).toFixed(1)}%`}
              markers={breakEven !== null ? [{ x: breakEven, label: `break-even ≈ ${breakEven.toFixed(1)}` }] : undefined}
            />
          </>
        )}
      </div>
      <h3>A simple bet ramp</h3>
      <p>
        Bet the table minimum (1 unit) when the true count is +1 or less. Above that, a common ramp is <strong>2 units per true count above 1</strong>, capped at your maximum. The spread
        (max ÷ min) a game needs grows with the number of decks: about 1–8 for six decks, less for double deck.
      </p>
      <table className="data" style={{ maxWidth: 420 }}>
        <thead>
          <tr>
            <th>True count</th>
            <th className="num">Bet (units)</th>
          </tr>
        </thead>
        <tbody>
          {[1, 2, 3, 4, 5].map((t) => (
            <tr key={t}>
              <td>{t <= 1 ? '≤ +1' : `+${t}`}</td>
              <td className="num">{t <= 1 ? 1 : Math.min(8, 2 * (t - 1))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 style={{ marginTop: 16 }}>How much to bet: Kelly</h3>
      <p>
        The bet that grows a bankroll fastest is about <TeX>{String.raw`\text{bankroll}\times\frac{\text{edge}}{\text{variance}}`}</TeX>. Blackjack's variance is about 1.3 squared units per
        hand. So with a 1% edge the optimal bet is about 0.77% of your bankroll. Most counters bet half of that or less to keep the risk of ruin small, because blackjack swings are large
        compared with the edge.
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

const CURVES: { id: string; label: string; cards: Rank[]; up: Rank; acts: Action[]; dev: string }[] = [
  { id: '16v10', label: '16 vs 10', cards: [10, 6], up: 10, acts: ['H', 'S'], dev: '16v10' },
  { id: '15v10', label: '15 vs 10', cards: [10, 5], up: 10, acts: ['H', 'S'], dev: '15v10' },
  { id: '12v3', label: '12 vs 3', cards: [10, 2], up: 3, acts: ['H', 'S'], dev: '12v3' },
  { id: '12v2', label: '12 vs 2', cards: [10, 2], up: 2, acts: ['H', 'S'], dev: '12v2' },
  { id: '10v10', label: '10 vs 10', cards: [6, 4], up: 10, acts: ['H', 'D'], dev: '10v10' },
  { id: '11vA', label: '11 vs A', cards: [6, 5], up: 1, acts: ['H', 'D'], dev: '11vA' },
  { id: '9v2', label: '9 vs 2', cards: [5, 4], up: 2, acts: ['H', 'D'], dev: '9v2' },
  { id: 'TTv6', label: '10,10 vs 6', cards: [10, 10], up: 6, acts: ['S', 'P'], dev: 'TTv6' },
  { id: '13v2', label: '13 vs 2', cards: [10, 3], up: 2, acts: ['H', 'S'], dev: '13v2' },
];

function L6() {
  const { rules } = useSettings();
  const [cid, setCid] = useState('16v10');
  const c = CURVES.find((x) => x.id === cid)!;
  const tcs = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8];
  const opts = { double: c.acts.includes('D'), split: c.acts.includes('P'), surrender: false };
  const { data, progress } = useEngine<'deviationCurve'>(`dev|${rulesKey(rules)}|${cid}`, () => ({ type: 'deviationCurve', rules, cards: c.cards, up: c.up, opts, tcs, decksLeft: 3 }));
  const dev = DEVIATIONS.find((d) => d.id === c.dev)!;
  const crossing = useMemo(() => {
    if (!data) return null;
    const diff = (i: number) => (data[i].ev[c.acts[1]] ?? 0) - (data[i].ev[c.acts[0]] ?? 0);
    for (let i = 1; i < data.length; i++) {
      const a = diff(i - 1);
      const b = diff(i);
      if ((a < 0 && b >= 0) || (a > 0 && b <= 0)) return data[i - 1].tc + (-a / (b - a)) * (data[i].tc - data[i - 1].tc);
    }
    return null;
  }, [data, c]);
  return (
    <>
      <h2>6 · Playing deviations</h2>
      <p>
        Basic strategy is optimal for a <em>neutral</em> shoe. When the count moves far enough, the best play changes. The true count at which it flips is the play's <strong>index</strong>.
        The 18 most valuable flips are the "Illustrious 18", plus four surrenders, the "Fab 4" (Don Schlesinger, <em>Blackjack Attack</em>). Together they capture most of the value of
        playing deviations.
      </p>
      <h3>The most important one: insurance</h3>
      <p>
        Insurance is a side bet of half your stake that pays 2:1 if the dealer's hole card is a ten. If a fraction <TeX>p</TeX> of the unseen cards are tens, the EV per unit insured is
      </p>
      <TeX block>{String.raw`\mathrm{EV}_{\text{ins}} = 2p - (1-p) = 3p - 1 \;>\; 0 \iff p > \tfrac13 .`}</TeX>
      <p>
        A fresh six-deck shoe (minus the dealer's ace and two non-ten player cards) has <TeX>{String.raw`p = 96/309 \approx 0.311`}</TeX>, so insurance loses about 6.8% of what you
        insure. In the shoes this app uses to model a Hi-Lo true count, tens make up <TeX>{String.raw`\tfrac{16}{52}\bigl(1+\tfrac{\mathrm{TC}}{40}\bigr)`}</TeX> of the cards. That
        reaches 1/3 at <TeX>{String.raw`\mathrm{TC} = 40/12 \approx 3.3`}</TeX>, which is exactly why the index is +3.
      </p>
      <div className="widget">
        <div className="widget-title">See an index appear: EV of each play as the count changes</div>
        <Seg value={cid} onChange={setCid} options={CURVES.map((x) => ({ value: x.id, label: x.label }))} />
        <div style={{ marginTop: 12 }}>
          {!data ? (
            <Progress value={progress} label="Solving the hand at 15 true counts…" />
          ) : (
            <>
              <LineChart
                series={c.acts.map((a) => ({ id: a, label: ACTION_NAMES[a], color: ACTION_HEX[a], points: data.map((d) => ({ x: d.tc, y: d.ev[a] ?? 0 })) }))}
                xLabel="Hi-Lo true count"
                yLabel="EV (units)"
                xFormat={(v) => (v > 0 ? `+${v}` : String(v))}
                yFormat={(v) => v.toFixed(2)}
                markers={crossing !== null ? [{ x: crossing, label: `lines cross ≈ ${crossing.toFixed(1)}` }] : undefined}
              />
              <p className="small text-2">
                Published index: <strong>{describeDeviation(dev, rules)}</strong>
              </p>
            </>
          )}
        </div>
      </div>
      <h3>The Illustrious 18 and the Fab 4 (Hi-Lo, multi-deck)</h3>
      <table className="data">
        <thead>
          <tr>
            <th>#</th>
            <th>Play</th>
            <th className="num">Index</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {DEVIATIONS.map((d) => (
            <tr key={d.id}>
              <td className="muted">
                {d.group === 'Fab 4' ? 'F' : ''}
                {d.order}
              </td>
              <td>{d.group === 'Insurance' ? 'Insurance' : `${d.row.startsWith('P') ? '10,10' : d.row.slice(1)} vs ${rankText(d.up)}`}</td>
              <td className="num">{fmtIdx(deviationIndex(d, rules))}</td>
              <td className="small text-2">{d.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ---------------------------------------------------------------------------------------------

function L7() {
  return (
    <>
      <h2>7 · Your practice plan</h2>
      <ol>
        <li>
          <strong>Basic strategy first.</strong> Counting is worthless if your play leaks more than the count earns. Get 100% on the <Link to="/strategy/quiz">grid quiz</Link> and a 100+ streak in the{' '}
          <Link to="/strategy/trainer">trainer</Link>.
        </li>
        <li>
          <strong>Tags until automatic.</strong> In the <Link to="/counting/drills">card-tag drill</Link>, aim for 100% at under half a second per card.
        </li>
        <li>
          <strong>Count a deck down</strong> in under 25 seconds with no errors, then work on hand groups (cancelling pairs).
        </li>
        <li>
          <strong>Watch & count</strong> at 1×, then 2×, then 4× with five players. <Link to="/counting/watch">Start here</Link>.
        </li>
        <li>
          <strong>Count & Play</strong> with basic strategy, then with index deviations (Feature 3b). <Link to="/counting/play">Take a seat</Link>.
        </li>
        <li>
          <strong>Casino</strong> with the coach off. Read the report card: accuracy, money lost to mistakes, and how well your bets tracked the count. <Link to="/play">Play</Link>.
        </li>
      </ol>
      <div className="callout">
        Counting in your head is legal, but casinos are private property and may refuse your action or shuffle up when they suspect counting. Using any device to count is illegal in
        most places. This app is for learning and practice money only.
      </div>
    </>
  );
}

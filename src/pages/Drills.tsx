import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayingCard } from '../components/PlayingCard';
import { Seg, useKeys } from '../components/ui';
import { buildShoe, type Card } from '../engine/cards';
import { SYSTEMS, getSystem, type CountingSystem } from '../engine/counting';
import { mulberry32, randomSeed, randInt, shuffle } from '../engine/rng';
import { listDrills, saveDrill } from '../state/progress';
import { useSettings } from '../state/settings';

type DrillId = 'tags' | 'flash' | 'countdown' | 'tc' | 'groups';

const DRILLS: { value: DrillId; label: string }[] = [
  { value: 'tags', label: 'Card tags' },
  { value: 'flash', label: 'Running count' },
  { value: 'countdown', label: 'Deck countdown' },
  { value: 'tc', label: 'True count' },
  { value: 'groups', label: 'Hand groups' },
];

const fmt = (x: number) => (x > 0 ? `+${x}` : String(x));
function freshCards(decks: number, rand: () => number): Card[] {
  return shuffle(buildShoe(decks, Math.floor(rand() * 1e6)), rand);
}

export default function Drills() {
  const { prefs, setPrefs } = useSettings();
  const [drill, setDrill] = useState<DrillId>('tags');
  const sys = getSystem(prefs.countingSystem);
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Counting drills</h1>
        </div>
        <label className="field">
          Counting system
          <select value={prefs.countingSystem} onChange={(e) => setPrefs({ countingSystem: e.target.value })}>
            {SYSTEMS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div style={{ marginBottom: 14 }}>
        <Seg value={drill} onChange={setDrill} options={DRILLS} label="Drill" />
      </div>
      <TagTable sys={sys} />
      <div style={{ marginTop: 14 }}>
        {drill === 'tags' && <TagDrill key={sys.id} sys={sys} />}
        {drill === 'flash' && <FlashDrill key={sys.id} sys={sys} />}
        {drill === 'countdown' && <CountdownDrill key={sys.id} sys={sys} />}
        {drill === 'tc' && <TrueCountDrill />}
        {drill === 'groups' && <GroupsDrill key={sys.id} sys={sys} />}
      </div>
      <History drill={drill} />
    </main>
  );
}

function TagTable({ sys }: { sys: CountingSystem }) {
  const labels = ['A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
  return (
    <div className="panel tight row">
      <strong>{sys.name}</strong>
      {labels.map((l, i) => (
        <span key={l} className="chip">
          {l} <strong className="num">{fmt(sys.tags[i + 1])}</strong>
        </span>
      ))}
      <span className="muted small">{sys.balanced ? 'Balanced: a full deck sums to 0.' : 'Unbalanced.'}</span>
    </div>
  );
}

function History({ drill }: { drill: DrillId }) {
  const list = listDrills(drill).slice(-6).reverse();
  if (!list.length) return null;
  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <h3>Recent results</h3>
      <table className="data">
        <tbody>
          {list.map((r) => (
            <tr key={r.date}>
              <td className="muted small">{new Date(r.date).toLocaleString()}</td>
              <td className="num">
                {r.score}/{r.total}
              </td>
              <td className="num">{(r.ms / 1000).toFixed(1)} s</td>
              <td className="muted small">{r.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 1. Card tags
// ---------------------------------------------------------------------------------------------

function TagDrill({ sys }: { sys: CountingSystem }) {
  const values = useMemo(() => Array.from(new Set(sys.tags.slice(1))).sort((a, b) => a - b), [sys]);
  const N = 30;
  const rand = useRef(mulberry32(randomSeed()));
  const [cards, setCards] = useState<Card[]>(() => freshCards(1, rand.current).slice(0, N));
  const [i, setI] = useState(0);
  const [errors, setErrors] = useState(0);
  const [flashWrong, setFlashWrong] = useState<number | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const answer = (v: number) => {
    if (done !== null) return;
    const s = start ?? Date.now();
    if (!start) setStart(s);
    const correct = sys.tags[cards[i].rank];
    const wrong = v !== correct;
    if (wrong) {
      setErrors((e) => e + 1);
      setFlashWrong(correct);
      window.setTimeout(() => setFlashWrong(null), 700);
    }
    if (i + 1 >= N) {
      const ms = Date.now() - s;
      setDone(ms);
      saveDrill({ drill: 'tags', date: Date.now(), score: N - errors - (wrong ? 1 : 0), total: N, ms, detail: `${sys.name}, ${(ms / N / 1000).toFixed(2)} s/card` });
    } else setI(i + 1);
  };
  useKeys(
    (k) => {
      const n = Number(k);
      if (n >= 1 && n <= values.length) answer(values[n - 1]);
      if (values.length === 3) {
        if (k === 'arrowleft' || k === 'j') answer(values[0]);
        if (k === 'arrowdown' || k === 'k') answer(values[1]);
        if (k === 'arrowright' || k === 'l') answer(values[2]);
      }
    },
    [i, values, done, start, errors],
  );
  const restart = () => {
    setCards(freshCards(1, rand.current).slice(0, N));
    setI(0);
    setErrors(0);
    setStart(null);
    setDone(null);
  };
  return (
    <div className="panel stack">
      <div className="widget-title">What is this card's tag?</div>
      <div className="flash-stage">
        {done === null ? <PlayingCard card={cards[i]} size="lg" /> : <div className="big-count">{N - errors}/{N}</div>}
      </div>
      {flashWrong !== null && <div className="callout bad">That card is {fmt(flashWrong)}.</div>}
      {done === null ? (
        <div className="tag-buttons">
          {values.map((v, j) => (
            <button key={v} className="btn" onClick={() => answer(v)}>
              {fmt(v)} <span className="kbd">{j + 1}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="row">
          <span className="text-2">
            {N - errors} of {N} correct in {(done / 1000).toFixed(1)} s ({(done / N / 1000).toFixed(2)} s per card). Target: 100% at under 0.5 s per card.
          </span>
          <button className="btn primary" onClick={restart}>
            Again
          </button>
        </div>
      )}
      <div className="muted small">
        Card {Math.min(i + 1, N)} of {N} · mistakes {errors}. Keys: 1–{values.length}
        {values.length === 3 ? ' or ← (−1) ↓ (0) → (+1)' : ''}.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 2. Running-count flash cards
// ---------------------------------------------------------------------------------------------

function CountAnswer({ onSubmit, step = 1, label = 'Running count' }: { onSubmit: (n: number) => void; step?: number; label?: string }) {
  const [v, setV] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim() !== '' && !Number.isNaN(Number(v))) onSubmit(Number(v));
      }}
    >
      <label className="field">
        {label}
        <input ref={ref} type="number" step={step} value={v} onChange={(e) => setV(e.target.value)} />
      </label>
      <button className="btn primary" type="submit" style={{ alignSelf: 'flex-end' }}>
        Check
      </button>
    </form>
  );
}

function FlashDrill({ sys }: { sys: CountingSystem }) {
  const [count, setCount] = useState(20);
  const [speed, setSpeed] = useState(1000);
  const [per, setPer] = useState(1);
  const [cards, setCards] = useState<Card[]>([]);
  const [pos, setPos] = useState(-1);
  const [result, setResult] = useState<{ answer: number; actual: number } | null>(null);
  const rand = useRef(mulberry32(randomSeed()));
  const running = pos >= 0 && pos < cards.length;

  useEffect(() => {
    if (!running) return;
    const id = window.setTimeout(() => setPos((p) => p + per), speed);
    return () => window.clearTimeout(id);
  }, [pos, running, speed, per]);

  const start = () => {
    setCards(freshCards(2, rand.current).slice(0, count));
    setPos(0);
    setResult(null);
  };
  const actual = cards.reduce((a, c) => a + sys.tags[c.rank], 0);
  const showing = running ? cards.slice(pos, pos + per) : [];

  return (
    <div className="panel stack">
      <div className="widget-title">Keep the running count as the cards flash by</div>
      <div className="row">
        <span className="muted small">Cards</span>
        <Seg value={count} onChange={setCount} options={[10, 20, 30, 52].map((n) => ({ value: n, label: String(n) }))} />
        <span className="muted small">Speed</span>
        <Seg value={speed} onChange={setSpeed} options={[2000, 1200, 800, 500, 300].map((n) => ({ value: n, label: `${n / 1000}s` }))} />
        <span className="muted small">At a time</span>
        <Seg value={per} onChange={setPer} options={[1, 2, 3].map((n) => ({ value: n, label: String(n) }))} />
      </div>
      <div className="flash-stage">
        {running ? (
          <div className="hand spread" key={pos}>
            {showing.map((c) => (
              <PlayingCard key={c.id} card={c} size="lg" animate />
            ))}
          </div>
        ) : pos < 0 ? (
          <button className="btn primary big" onClick={start}>
            Start
          </button>
        ) : result ? (
          <div className="stack center">
            <div className="big-count" style={{ color: result.answer === result.actual ? 'var(--good-text)' : 'var(--bad-text)' }}>{fmt(result.actual)}</div>
            <div className="text-2">{result.answer === result.actual ? 'Correct!' : `You said ${fmt(result.answer)}.`}</div>
          </div>
        ) : (
          <div className="text-2">Time's up. What is the count?</div>
        )}
      </div>
      {pos >= cards.length && cards.length > 0 && !result && (
        <CountAnswer
          step={sys.level === 3 ? 0.5 : 1}
          onSubmit={(n) => {
            setResult({ answer: n, actual });
            saveDrill({ drill: 'flash', date: Date.now(), score: n === actual ? 1 : 0, total: 1, ms: (cards.length / per) * speed, detail: `${count} cards @ ${speed / 1000}s, ${per} at a time` });
          }}
        />
      )}
      {result && (
        <>
          <div className="row tight">
            {cards.map((c, i) => (
              <span key={c.id} className="chip">
                {c.face}
                {i % 1 === 0 && <span className="muted"> {fmt(sys.tags[c.rank])}</span>}
              </span>
            ))}
          </div>
          <button className="btn primary" onClick={start} style={{ alignSelf: 'flex-start' }}>
            Next run
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 3. Deck countdown
// ---------------------------------------------------------------------------------------------

function CountdownDrill({ sys }: { sys: CountingSystem }) {
  const rand = useRef(mulberry32(randomSeed()));
  const [deck, setDeck] = useState<Card[]>([]);
  const [hidden, setHidden] = useState<Card[]>([]);
  const [i, setI] = useState(-1);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState<number | null>(null);
  const [result, setResult] = useState<{ answer: number; actual: number } | null>(null);
  const begin = () => {
    const all = freshCards(1, rand.current);
    const k = randInt(rand.current, 1, 3);
    setHidden(all.slice(0, k));
    setDeck(all.slice(k));
    setI(0);
    setStart(Date.now());
    setEnd(null);
    setResult(null);
  };
  const advance = () => {
    if (i < 0 || end !== null) return;
    if (i + 1 >= deck.length) setEnd(Date.now());
    else setI(i + 1);
  };
  useKeys(
    (k, e) => {
      if (k === ' ' || k === 'arrowright') {
        e.preventDefault();
        advance();
      }
    },
    [i, deck, end],
  );
  const actual = deck.reduce((a, c) => a + sys.tags[c.rank], 0);
  return (
    <div className="panel stack">
      <div className="widget-title">Count down a whole deck as fast as you can</div>
      <p className="text-2 small">
        One to three cards are secretly removed first. Press Space for each card. At the end, give your running count. For a balanced count the missing cards' tags are
        exactly minus your answer, so this also checks how well you counted.
      </p>
      <div className="flash-stage" onClick={advance} style={{ cursor: i >= 0 && end === null ? 'pointer' : undefined }}>
        {i < 0 ? (
          <button className="btn primary big" onClick={begin}>
            Start
          </button>
        ) : end === null ? (
          <PlayingCard card={deck[i]} size="lg" />
        ) : result ? (
          <div className="stack center">
            <div className="big-count" style={{ color: result.answer === result.actual ? 'var(--good-text)' : 'var(--bad-text)' }}>{fmt(result.actual)}</div>
            <div className="text-2">
              {((end - start) / 1000).toFixed(1)} s. Missing: {hidden.map((c) => c.face).join(', ')}
            </div>
          </div>
        ) : (
          <div className="text-2">Done in {((end - start) / 1000).toFixed(1)} s. What is your count?</div>
        )}
      </div>
      <div className="muted small">{i >= 0 && end === null ? `Card ${i + 1} of ${deck.length}. Space or click for the next card.` : 'Good players get under 25 seconds per deck with no errors.'}</div>
      {end !== null && !result && (
        <CountAnswer
          step={sys.level === 3 ? 0.5 : 1}
          onSubmit={(n) => {
            setResult({ answer: n, actual });
            saveDrill({ drill: 'countdown', date: Date.now(), score: n === actual ? 1 : 0, total: 1, ms: end - start, detail: `${deck.length} cards` });
          }}
        />
      )}
      {result && (
        <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={begin}>
          Another deck
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 4. True-count conversion
// ---------------------------------------------------------------------------------------------

function TrueCountDrill() {
  const rand = useRef(mulberry32(randomSeed()));
  const make = () => {
    const decks = [6, 8, 2][randInt(rand.current, 0, 2)];
    const left = randInt(rand.current, 1, decks * 2 - 1) / 2;
    const rc = randInt(rand.current, -12, 16);
    return { decks, left, rc };
  };
  const [q, setQ] = useState(make);
  const [n, setN] = useState(0);
  const [score, setScore] = useState(0);
  const [last, setLast] = useState<{ ok: boolean; tc: number } | null>(null);
  const [start] = useState(Date.now());
  const tc = q.rc / q.left;
  const total = 10;
  return (
    <div className="panel stack">
      <div className="widget-title">Convert running count to true count</div>
      <p className="text-2 small">Estimate the decks remaining from the discard tray (to the nearest half deck), then divide. Round or truncate as you prefer: both are accepted.</p>
      {n < total ? (
        <div className="row" style={{ gap: 30, alignItems: 'flex-end' }}>
          <div className="stack center" style={{ gap: 4 }}>
            <div className="tray" style={{ width: 70, height: 150 }}>
              <div className="fill" style={{ height: `${((q.decks - q.left) / q.decks) * 100}%` }} />
            </div>
            <span className="muted small">Discards ({q.decks}-deck shoe)</span>
          </div>
          <div className="stack">
            <div>
              Running count: <span className="big-count" style={{ fontSize: '2rem' }}>{fmt(q.rc)}</span>
            </div>
            <CountAnswer
              key={n}
              label="True count"
              step={0.5}
              onSubmit={(ans) => {
                const ok = ans === Math.trunc(tc) || ans === Math.round(tc) || ans === Math.floor(tc) || Math.abs(ans - tc) <= 0.5;
                setLast({ ok, tc });
                const sc = score + (ok ? 1 : 0);
                setScore(sc);
                if (n + 1 >= total) saveDrill({ drill: 'tc', date: Date.now(), score: sc, total, ms: Date.now() - start });
                setN(n + 1);
                setQ(make());
              }}
            />
          </div>
        </div>
      ) : (
        <div className="row">
          <span className="big-count">
            {score}/{total}
          </span>
          <button
            className="btn primary"
            onClick={() => {
              setN(0);
              setScore(0);
              setLast(null);
            }}
          >
            Again
          </button>
        </div>
      )}
      {last && (
        <div className={`callout ${last.ok ? 'good' : 'bad'}`}>
          {last.ok ? '✓' : '✗'} Exact true count was {last.tc.toFixed(2)}.
        </div>
      )}
      <div className="muted small">
        Question {Math.min(n + 1, total)} of {total} · score {score}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// 5. Hand groups (cancellation)
// ---------------------------------------------------------------------------------------------

function GroupsDrill({ sys }: { sys: CountingSystem }) {
  const rand = useRef(mulberry32(randomSeed()));
  const [size, setSize] = useState(5);
  const [ms, setMs] = useState(2500);
  const [cards, setCards] = useState<Card[] | null>(null);
  const [visible, setVisible] = useState(false);
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [last, setLast] = useState<{ ok: boolean; actual: number } | null>(null);
  const total = 10;
  const deal = () => {
    setCards(freshCards(1, rand.current).slice(0, size));
    setVisible(true);
  };
  useEffect(() => {
    if (!visible) return;
    const id = window.setTimeout(() => setVisible(false), ms);
    return () => window.clearTimeout(id);
  }, [visible, ms, cards]);
  const actual = cards ? cards.reduce((a, c) => a + sys.tags[c.rank], 0) : 0;
  const nextGroup = () => {
    setLast(null);
    deal();
  };
  // Enter moves on to the next group once the answer has been checked.
  useKeys(
    (k, e) => {
      if (k === 'enter' && last && round < total) {
        e.preventDefault();
        nextGroup();
      }
    },
    [last, round, size],
  );
  return (
    <div className="panel stack">
      <div className="widget-title">Count a whole group at a glance</div>
      <p className="text-2 small">Pros don't count card by card. They see a ten and a 5 and think "zero". The cards disappear after the time limit, then give the net count of the group.</p>
      <div className="row">
        <span className="muted small">Cards</span>
        <Seg value={size} onChange={setSize} options={[3, 4, 5, 6, 8].map((n) => ({ value: n, label: String(n) }))} />
        <span className="muted small">Time</span>
        <Seg value={ms} onChange={setMs} options={[4000, 2500, 1500, 1000].map((n) => ({ value: n, label: `${n / 1000}s` }))} />
      </div>
      <div className="flash-stage">
        {!cards ? (
          <button className="btn primary big" onClick={deal}>
            Start
          </button>
        ) : visible ? (
          <div className="hand spread">
            {cards.map((c) => (
              <PlayingCard key={c.id} card={c} />
            ))}
          </div>
        ) : last ? (
          <div className="stack center">
            <div className="big-count" style={{ color: last.ok ? 'var(--good-text)' : 'var(--bad-text)' }}>{fmt(last.actual)}</div>
            <div className="hand spread">
              {cards.map((c) => (
                <PlayingCard key={c.id} card={c} size="sm" />
              ))}
            </div>
          </div>
        ) : (
          <div className="text-2">Net count of that group?</div>
        )}
      </div>
      {cards && !visible && !last && (
        <CountAnswer
          label="Group count"
          step={sys.level === 3 ? 0.5 : 1}
          onSubmit={(n) => {
            const ok = n === actual;
            setLast({ ok, actual });
            const sc = score + (ok ? 1 : 0);
            setScore(sc);
            if (round + 1 >= total) saveDrill({ drill: 'groups', date: Date.now(), score: sc, total, ms: ms * total, detail: `${size} cards @ ${ms / 1000}s` });
            setRound(round + 1);
          }}
        />
      )}
      {last && round < total && (
        <button
          className="btn primary"
          style={{ alignSelf: 'flex-start' }}
          onClick={nextGroup}
        >
          Next group <span className="kbd">Enter</span>
        </button>
      )}
      {round >= total && (
        <div className="row">
          <strong>
            Score {score}/{total}
          </strong>
          <button
            className="btn"
            onClick={() => {
              setRound(0);
              setScore(0);
              setLast(null);
              setCards(null);
            }}
          >
            Restart
          </button>
        </div>
      )}
      <div className="muted small">
        Round {Math.min(round + 1, total)} of {total} · score {score}
      </div>
    </div>
  );
}

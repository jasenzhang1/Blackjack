import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Seg, useKeys } from '../../components/ui';
import { cardText, rankName, SUIT_SYM, SUIT_WORD } from '../../holdem/cards';
import {
  dealRead,
  readBoard,
  gradeNuts,
  gradeStraights,
  gradeTypes,
  ranksText,
  READ_TYPE_NAME,
  READ_TYPES,
  straightName,
  typeReason,
  type BoardRead,
  type NutGrade,
  type ReadType,
  type StraightGrade,
  type Texture,
  type TypeGrade,
} from '../../holdem/nuts';
import { FLUSH } from '../../holdem/evaluate';
import { nutsTimes, saveNutsTime, type NutsTime } from '../../holdem/progress';
import { Dealing, HCards, NextButton, RoomShell, useRoomStats, useSpot } from '../../holdem/ui';

/** Cards on the board, or 0: one hand read street by street (flop, then turn, then river). */
type Size = 0 | 3 | 4 | 5;

const STREETS = ['Flop', 'Turn', 'River'] as const;

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

function timeSummary(times: NutsTime[]): string {
  const ok = times.filter((t) => t.ok);
  if (!ok.length) return 'No perfect sheets yet';
  const recent = ok.slice(-20);
  const avg = recent.reduce((s, t) => s + t.ms, 0) / recent.length;
  const best = Math.min(...ok.map((t) => t.ms));
  return `Perfect sheets: avg ${secs(avg)} (last ${recent.length}) · best ${secs(best)}`;
}

export default function Nuts() {
  const [size, setSize] = useState<Size>(0);
  const [texture, setTexture] = useState<Texture>('busy');
  const [stats, record] = useRoomStats('nuts');
  const [times, setTimes] = useState(nutsTimes);
  const { spot, id, next } = useSpot(
    (rand): BoardRead[] => {
      const r = dealRead(rand, size || 5, texture);
      return size ? [r] : [readBoard(r.board.slice(0, 3)), readBoard(r.board.slice(0, 4)), r];
    },
    [size, texture],
  );
  const onDone = useCallback(
    (steps: boolean[], ms: number) => {
      record(steps);
      setTimes(saveNutsTime(ms, steps[steps.length - 1]));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  return (
    <RoomShell
      title="Board reading"
      lead="Look at the board and write down everything that is possible on it: every hand type, every straight and the nuts. Nothing is multiple choice, and anything you miss is flagged. The clock is running."
      stats={stats}
      lesson={<Lesson />}
      settings={
        <>
          <Seg
            label="Board"
            value={size}
            onChange={setSize}
            options={[
              { value: 0, label: 'Flop → Turn → River' },
              { value: 3, label: 'Flop' },
              { value: 4, label: 'Turn' },
              { value: 5, label: 'River' },
            ]}
          />
          <Seg
            label="Boards"
            value={texture}
            onChange={setTexture}
            options={[
              { value: 'busy', label: 'Busy boards' },
              { value: 'any', label: 'Any board' },
            ]}
          />
          <span className="small muted">{timeSummary(times)}</span>
        </>
      }
    >
      {spot ? <Hand key={id} reads={spot} onDone={onDone} onNext={next} /> : <Dealing />}
    </RoomShell>
  );
}

/** One board, or one hand street by street: a fresh answer sheet for each street. */
function Hand({ reads, onDone, onNext }: { reads: BoardRead[]; onDone: (steps: boolean[], ms: number) => void; onNext: () => void }) {
  const [street, setStreet] = useState(0);
  const last = street === reads.length - 1;
  const walk = reads.length > 1;
  return (
    <Sheet
      key={street}
      read={reads[street]}
      street={walk ? `${STREETS[street]} · street ${street + 1} of ${reads.length}` : STREETS[reads[0].board.length - 3]}
      slots={walk ? 5 : 0}
      onDone={onDone}
      onNext={last ? onNext : () => setStreet((s) => s + 1)}
      nextLabel={last ? (walk ? 'Next hand' : 'Next spot') : `Deal the ${STREETS[street + 1].toLowerCase()}`}
    />
  );
}

interface Graded {
  types: TypeGrade;
  straights: StraightGrade;
  nuts: NutGrade;
  ms: number;
  ok: boolean;
}

function useClock(running: boolean): number {
  const start = useRef(performance.now());
  const [now, setNow] = useState(start.current);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [running]);
  return now - start.current;
}

function Sheet({
  read,
  street,
  slots,
  onDone,
  onNext,
  nextLabel,
}: {
  read: BoardRead;
  street: string;
  slots: number;
  onDone: (steps: boolean[], ms: number) => void;
  onNext: () => void;
  nextLabel: string;
}) {
  const [types, setTypes] = useState<Set<ReadType>>(new Set());
  const [straights, setStraights] = useState('');
  const [nuts, setNuts] = useState('');
  const [graded, setGraded] = useState<Graded | null>(null);
  const t0 = useRef(performance.now());
  const elapsed = useClock(!graded);
  const toggle = (t: ReadType) =>
    !graded &&
    setTypes((s) => {
      const n = new Set(s);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  useKeys(
    (k) => {
      const i = Number(k) - 1;
      if (i >= 0 && i < READ_TYPES.length) toggle(READ_TYPES[i]);
    },
    [graded],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (graded || !nuts.trim()) return;
    const ms = performance.now() - t0.current;
    const g = { types: gradeTypes(read, types), straights: gradeStraights(read, straights), nuts: gradeNuts(read, nuts), ms };
    const ok = g.types.ok && g.straights.ok && g.nuts.ok;
    setGraded({ ...g, ok });
    onDone([g.types.ok, g.straights.ok, g.nuts.ok, ok], ms);
  };

  return (
    <div className="spot-layout">
      <div className="spot-table">
        <div className="panel combo-board read-board">
          <div className="read-street">{street}</div>
          <HCards cards={read.board} size="lg" slots={slots} />
          <div className={`read-clock num ${graded ? (graded.ok ? 'ok' : 'bad') : ''}`}>{secs(graded ? graded.ms : elapsed)}</div>
        </div>
        {graded && <AnswerKey read={read} />}
      </div>
      <form className="spot-side panel read-sheet" onSubmit={submit}>
        <section className={`read-part ${graded ? (graded.types.ok ? 'ok' : 'bad') : ''}`}>
          <h4>1 · Which of these can a player hold?</h4>
          <div className="read-types">
            {READ_TYPES.map((t, i) => (
              <button key={t} type="button" className={`btn toggle ${types.has(t) ? 'on' : ''}`} aria-pressed={types.has(t)} onClick={() => toggle(t)} disabled={!!graded}>
                <span className="kbd">{i + 1}</span> {READ_TYPE_NAME[t]}
              </button>
            ))}
          </div>
          {graded && <TypeFlags read={read} g={graded.types} />}
        </section>

        <section className={`read-part ${graded ? (graded.straights.ok ? 'ok' : 'bad') : ''}`}>
          <h4>2 · List every straight</h4>
          <p className="small muted">The hole ranks each one needs, e.g. <code>56 6T 9</code>. One rank means that card plus anything. Leave blank if there are none.</p>
          <input type="text" value={straights} onChange={(e) => setStraights(e.target.value)} disabled={!!graded} placeholder="56 6T 9" aria-label="Straights" autoComplete="off" spellCheck={false} />
          {graded && <StraightFlags read={read} g={graded.straights} />}
        </section>

        <section className={`read-part ${graded ? (graded.nuts.ok ? 'ok' : 'bad') : ''}`}>
          <h4>3 · What are the nuts?</h4>
          <p className="small muted">
            The hole cards that make the best possible hand: <code>AhKh</code>, <code>A♥ x♥</code> (ace of hearts and any heart), <code>TJ</code>, <code>9x</code>, <code>KK</code>.
          </p>
          <input type="text" value={nuts} onChange={(e) => setNuts(e.target.value)} disabled={!!graded} placeholder="AhXh" aria-label="The nuts" autoComplete="off" spellCheck={false} />
          {graded && (
            <div className="read-flags small">
              <div className={graded.nuts.ok ? 'good' : 'bad'}>
                {graded.nuts.ok ? '✓' : '✗'} {graded.nuts.said}
              </div>
              {!graded.nuts.ok && (
                <div>
                  Nuts: <strong>{read.nutName}</strong> with {read.nutText.join(', ')}.
                </div>
              )}
              {graded.nuts.note && <div className="muted">{graded.nuts.note}</div>}
            </div>
          )}
        </section>

        {graded ? (
          <>
            <div className={`read-verdict ${graded.ok ? 'ok' : 'bad'}`}>{graded.ok ? `Perfect read in ${secs(graded.ms)}.` : `${[graded.types.ok, graded.straights.ok, graded.nuts.ok].filter(Boolean).length} of 3 parts right.`}</div>
            <NextButton onNext={onNext} label={nextLabel} />
          </>
        ) : (
          <button className="btn primary big" type="submit" disabled={!nuts.trim()}>
            Check my read <span className="kbd">↵</span>
          </button>
        )}
      </form>
    </div>
  );
}

function TypeFlags({ read, g }: { read: BoardRead; g: TypeGrade }) {
  if (g.ok) return <div className="read-flags small good">✓ All correct.</div>;
  return (
    <ul className="read-flags small">
      {g.missed.map((t) => (
        <li key={t} className="bad">
          Missed: <strong>{READ_TYPE_NAME[t].toLowerCase()}</strong> is possible. {typeReason(read, t)}
        </li>
      ))}
      {g.wrong.map((t) => (
        <li key={t} className="bad">
          Not possible: <strong>{READ_TYPE_NAME[t].toLowerCase()}</strong>. {typeReason(read, t)}
        </li>
      ))}
    </ul>
  );
}

const needText = (need: number[]) => (need.length === 0 ? 'on the board' : need.length === 1 ? `${ranksText(need)} + any` : ranksText(need));

function StraightFlags({ read, g }: { read: BoardRead; g: StraightGrade }) {
  const items = [
    ...g.missed.map((s) => (
      <li key={`m${s.high}`} className="bad">
        Missed: <strong>{straightName(s.high)}</strong> ({needText(s.need)}).
      </li>
    )),
    ...g.wrong.map((c, i) => (
      <li key={`w${i}`} className="bad">
        {c.error}
      </li>
    )),
    ...g.loose.map((c, i) => {
      const s = read.straights.find((x) => x.high === c.high)!;
      return (
        <li key={`l${i}`} className="muted">
          {ranksText(c.ranks)} makes the {straightName(c.high).toLowerCase()} straight, but only {needText(s.need)} is needed.
        </li>
      );
    }),
  ];
  return (
    <ul className="read-flags small">
      {g.ok && <li className="good">✓ {read.straights.length ? `All ${read.straights.length} found.` : 'Right: no straight is possible.'}</li>}
      {items}
    </ul>
  );
}

function AnswerKey({ read }: { read: BoardRead }) {
  return (
    <div className="panel explain">
      <h3>Answer key</h3>
      <p>
        The nuts: <strong>{read.nutName}</strong> — {read.nutText.join(', ')}
        {read.nutCombos.length > 1 && <span className="muted"> ({read.nutCombos.length} combos)</span>}.
      </p>
      <div className="table-scroll">
        <table className="data">
          <tbody>
            {READ_TYPES.map((t) => (
              <tr key={t}>
                <td>
                  <strong>{READ_TYPE_NAME[t]}</strong>
                </td>
                <td>{read.possible.has(t) ? <span className="chip good">Possible</span> : <span className="chip">No</span>}</td>
                <td className="small text-2">{typeReason(read, t)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {read.straights.length > 0 && (
        <>
          <h4>Straights</h4>
          <table className="data">
            <thead>
              <tr>
                <th>Straight</th>
                <th>Hole cards</th>
              </tr>
            </thead>
            <tbody>
              {read.straights.map((s) => (
                <tr key={s.high}>
                  <td>{straightName(s.high)}</td>
                  <td>
                    <code>{needText(s.need)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {read.straightFlushes.length > 0 && (
        <p className="small text-2">
          Straight flushes: {read.straightFlushes.map((s) => `${s.need.length ? s.need.map(cardText).join('') : 'board'} (${straightName(s.high).toLowerCase()})`).join(', ')}.
        </p>
      )}
      {read.flush && read.possible.has(FLUSH) && (
        <p className="small text-2">
          Flush: {read.flush.count} {SUIT_WORD[read.flush.suit]} on the board, so a player needs {read.flush.need === 0 ? 'nothing (it plays for everyone)' : `${read.flush.need} ${SUIT_SYM[read.flush.suit]}`}.
          {read.flush.nutCard >= 0 && <> The nut-flush card is the {cardText(read.flush.nutCard)}.</>}
        </p>
      )}
      {read.quads.length > 0 && (
        <p className="small text-2">
          Quads: {read.quads.map((q) => `${rankName(q.rank)}s (${q.need === 0 ? 'on the board' : `needs ${q.need === 2 ? 'the pocket pair' : 'the last one'}`})`).join(', ')}.
        </p>
      )}
    </div>
  );
}

function Lesson() {
  return (
    <>
      <p>
        At showdown you should already know where your hand ranks among everything your opponent could hold. That starts with reading the board in a few seconds: what is the best possible hand, and what
        else is out there?
      </p>
      <h4>A fixed order of checks</h4>
      <ol>
        <li>
          <strong>Pairs.</strong> Is the board paired? Then full houses and four of a kind are possible, and a pocket pair matching the board pair makes quads.
        </li>
        <li>
          <strong>Suits.</strong> Three cards of one suit means a flush with two more of that suit; four means one is enough. The nut flush is the highest card of the suit missing from the board.
        </li>
        <li>
          <strong>Straight flushes.</strong> If a flush is possible, are three of those suited cards within a five-rank window?
        </li>
        <li>
          <strong>Straights.</strong> Slide a five-rank window from A-K-Q-J-T down to the wheel (5-4-3-2-A). Any window with three board cards in it is a straight with the two missing ranks; four board cards
          means one missing rank is enough. A window does not count if the cards that fill it always make a higher straight (3-4 on 5-6-7-8 is the 8-high).
        </li>
        <li>
          <strong>The nuts.</strong> The strongest of the above. With nothing better available, it is a set of the top board card.
        </li>
      </ol>
      <h4>Street by street</h4>
      <p>
        In the default mode one hand plays out: read the flop, then the turn card comes and you read again, then the river. Each sheet asks what a player can hold <em>right now</em>, with the cards
        on the board so far. Watch what each new card changes: a third suited card brings flushes in, a pairing card brings full houses and quads, a connecting card adds straights, and the nuts can move
        every street (top set on a dry flop can be crushed by the river).
      </p>
      <h4>Writing your answers</h4>
      <p>
        Ranks: <code>A K Q J T 9 … 2</code> (<code>10</code> also works). Suits: <code>s h d c</code> or <code>♠ ♥ ♦ ♣</code>. <code>x</code> means any rank, so <code>A♥x♥</code> is the ace of hearts
        with any heart and <code>9x</code> is a nine with anything. For the nuts, every holding your answer covers has to be the nuts: <code>Ah</code> alone is wrong when the ace needs a second heart.
        &ldquo;The nuts&rdquo; ignores kickers, as players do: any ace-high flush is the nut flush.
      </p>
    </>
  );
}

import { useCallback, useMemo, useRef, useState } from 'react';
import { Seg, useKeys } from '../../components/ui';
import { ACT_LABEL, ChartGrid, ChartLegend } from '../../holdem/charts-ui';
import { actOf, allCharts, chartShare, drillSpot, POS_NAME, POSITIONS, THREE_BETTER_LABEL, type Chart, type ChartAct, type DrillKind, type DrillSpot } from '../../holdem/preflop';
import { paintScores, savePaintScore } from '../../holdem/progress';
import { ALL_CLASSES } from '../../holdem/ranges';
import { Dealing, HCards, NextButton, RoomShell, useRoomStats, useSpot } from '../../holdem/ui';

type Tab = 'drill' | 'paint' | 'charts';

export default function Preflop() {
  const [tab, setTab] = useState<Tab>('drill');
  const [stats, record] = useRoomStats('preflop');
  return (
    <RoomShell
      title="Preflop ranges"
      lead="Most money is won or lost before the flop. Learn which hands to open from each seat, how to defend against a raise, and how to respond to a 3-bet, for a 6-max cash game 100 big blinds deep ($1/$2 blinds, $200 stacks)."
      stats={stats}
      lesson={<Lesson />}
      settings={
        <Seg
          label="Mode"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'drill', label: 'Hand drill' },
            { value: 'paint', label: 'Paint a range' },
            { value: 'charts', label: 'Charts' },
          ]}
        />
      }
    >
      {tab === 'drill' && <Drill record={record} />}
      {tab === 'paint' && <Paint />}
      {tab === 'charts' && <Charts />}
    </RoomShell>
  );
}

// ---------------------------------------------------------------------------------------------

function Drill({ record }: { record: (r: boolean[]) => void }) {
  const [kind, setKind] = useState<DrillKind | 'mixed'>('mixed');
  const { spot, id, next } = useSpot((r) => drillSpot(r, kind), [kind]);
  return (
    <>
      <div className="row room-settings">
        <Seg
          label="Spot"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'mixed', label: 'Mixed' },
            { value: 'rfi', label: 'Opening' },
            { value: 'vsOpen', label: 'Facing a raise' },
            { value: 'vs3bet', label: 'Facing a 3-bet' },
          ]}
        />
      </div>
      {spot ? <DrillView key={id} spot={spot} onDone={record} onNext={next} /> : <Dealing />}
    </>
  );
}

function DrillView({ spot, onDone, onNext }: { spot: DrillSpot; onDone: (r: boolean[]) => void; onNext: () => void }) {
  const [chosen, setChosen] = useState<ChartAct | null>(null);
  const choose = useCallback(
    (a: ChartAct) => {
      if (chosen) return;
      setChosen(a);
      onDone([a === spot.answer]);
    },
    [chosen, onDone, spot.answer],
  );
  const acts: { a: ChartAct; label: string; key: string }[] = [
    { a: 'fold', label: 'Fold', key: 'f' },
    ...(spot.callLabel ? [{ a: 'call' as const, label: spot.callLabel, key: 'c' }] : []),
    { a: 'raise', label: spot.raiseLabel, key: 'r' },
  ];
  useKeys(
    (k) => {
      const m = acts.find((x) => x.key === k);
      if (m) choose(m.a);
    },
    [choose, acts.length],
  );
  const ok = chosen === spot.answer;
  const acted = new Map(spot.story.map((s) => [s.pos, s.text]));
  return (
    <div className="spot-layout">
      <div className="spot-table">
        <div className="panel preflop-spot">
          <div className="pos-strip">
            {POSITIONS.map((p) => (
              <div key={p} className={`pos-chip ${p === spot.hero ? 'me' : ''} ${acted.get(p) === 'folds' ? 'folded' : ''} ${p === spot.villain ? 'villain' : ''}`}>
                <span className="p">{p}</span>
                <span className="t">{p === spot.hero ? (spot.kind === 'vs3bet' ? 'you opened' : 'you') : (acted.get(p) ?? '')}</span>
              </div>
            ))}
          </div>
          <div className="row" style={{ justifyContent: 'center', gap: 24, marginTop: 14 }}>
            <HCards cards={spot.hole} size="lg" />
            <div className="stack" style={{ gap: 4 }}>
              <div className="big-hand">{spot.hand.label}</div>
              <div className="muted small">
                {POS_NAME[spot.hero]}
                {spot.threeBetter ? ` · facing ${THREE_BETTER_LABEL[spot.threeBetter]}` : ''}
              </div>
            </div>
          </div>
          <div className="dock preflop-dock">
            {acts.map((x) => (
              <button
                key={x.a}
                className={`btn big pf-${x.a} ${chosen === x.a ? (ok ? 'right' : 'wrong') : ''} ${chosen && x.a === spot.answer ? 'answer' : ''}`}
                disabled={!!chosen}
                onClick={() => choose(x.a)}
              >
                {x.label} <span className="kbd">{x.key.toUpperCase()}</span>
              </button>
            ))}
          </div>
        </div>
        {chosen && (
          <div className="panel explain">
            <div className="row between">
              <h3 style={{ margin: 0 }}>{spot.chart.title}</h3>
              <ChartLegend actions={spot.chart.actions} raiseName={spot.chart.raiseName} shares={Object.fromEntries(spot.chart.actions.map((a) => [a, chartShare(spot.chart, a)]))} />
            </div>
            <p className="small text-2">{spot.chart.why}</p>
            <ChartGrid act={(l) => actOf(spot.chart, l)} highlight={spot.hand.label} />
          </div>
        )}
      </div>
      <div className="spot-side panel">
        {!chosen ? (
          <p className="text-2">
            {spot.kind === 'rfi'
              ? `It folds to you in the ${POS_NAME[spot.hero].toLowerCase()}. Open or fold?`
              : spot.kind === 'vsOpen'
                ? `${spot.villain} raises and it is your turn in the ${POS_NAME[spot.hero].toLowerCase()}.`
                : `You opened from the ${POS_NAME[spot.hero].toLowerCase()} and ${spot.villain} 3-bets.`}
          </p>
        ) : (
          <>
            <div className={`feedback ${ok ? 'ok' : 'bad'}`} style={{ marginTop: 0 }}>
              <span className="icon">{ok ? '✓' : '✗'}</span>
              <div>
                <div className="title">{ok ? 'Correct' : `The chart says ${spot.answer === 'raise' ? spot.chart.raiseName.toLowerCase() : ACT_LABEL[spot.answer].toLowerCase()}`}</div>
                <div className="small text-2">
                  {spot.hand.label} in this spot: <strong>{spot.answer === 'raise' ? spot.chart.raiseName : ACT_LABEL[spot.answer]}</strong>. The highlighted cell on the chart is your hand.
                </div>
              </div>
            </div>
            <NextButton onNext={onNext} />
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function useChartPicker(): [Chart, (id: string) => void, Chart[]] {
  const charts = useMemo(() => allCharts(), []);
  const [id, setId] = useState(charts[0].id);
  return [charts.find((c) => c.id === id)!, setId, charts];
}

function ChartSelect({ chart, setId, charts }: { chart: Chart; setId: (id: string) => void; charts: Chart[] }) {
  return (
    <label className="field">
      Chart
      <select value={chart.id} onChange={(e) => setId(e.target.value)}>
        <optgroup label="Opening (raise first in)">
          {charts
            .filter((c) => c.id.startsWith('rfi'))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
        </optgroup>
        <optgroup label="Facing a raise">
          {charts
            .filter((c) => c.id.startsWith('vsopen'))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
        </optgroup>
        <optgroup label="Facing a 3-bet">
          {charts
            .filter((c) => c.id.startsWith('vs3bet'))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
        </optgroup>
      </select>
    </label>
  );
}

function Paint() {
  const [chart, setId, charts] = useChartPicker();
  const [painted, setPainted] = useState<Map<string, ChartAct>>(new Map());
  const [brush, setBrush] = useState<ChartAct>('raise');
  const [checked, setChecked] = useState(false);
  const stroke = useRef<ChartAct>('raise');
  const [best, setBest] = useState(paintScores);
  const pick = (id: string) => {
    setId(id);
    setPainted(new Map());
    setChecked(false);
    setBrush('raise');
  };
  const paint = (label: string, first: boolean) => {
    if (checked) return;
    setPainted((m) => {
      const n = new Map(m);
      // A stroke that starts on a cell already painted with this brush erases.
      if (first) stroke.current = (n.get(label) ?? 'fold') === brush ? 'fold' : brush;
      if (stroke.current === 'fold') n.delete(label);
      else n.set(label, stroke.current);
      return n;
    });
  };
  const mine = (l: string): ChartAct => painted.get(l) ?? 'fold';
  const score = useMemo(() => {
    let right = 0;
    let total = 0;
    let missing = 0;
    let extra = 0;
    let wrongAct = 0;
    for (const c of ALL_CLASSES) {
      const want = actOf(chart, c.label);
      const got = mine(c.label);
      if (want === 'fold' && got === 'fold') continue;
      total += c.combos;
      if (want === got) right += c.combos;
      else if (got === 'fold') missing++;
      else if (want === 'fold') extra++;
      else wrongAct++;
    }
    return { pct: total ? right / total : 1, missing, extra, wrongAct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [painted, chart]);
  const check = () => {
    setChecked(true);
    savePaintScore(chart.id, score.pct);
    setBest(paintScores());
  };
  return (
    <div className="spot-layout">
      <div className="spot-table">
        <div className="panel">
          <div className="row between" style={{ marginBottom: 10 }}>
            <ChartSelect chart={chart} setId={pick} charts={charts} />
            {!checked && (
              <Seg
                label="Brush"
                value={brush}
                onChange={setBrush}
                options={chart.actions.map((a) => ({ value: a, label: a === 'raise' ? chart.raiseName : a === 'fold' ? 'Erase' : ACT_LABEL[a] }))}
              />
            )}
          </div>
          <p className="small text-2" style={{ marginTop: 0 }}>
            {chart.spot}. Paint every hand you would {chart.actions.includes('call') ? `${chart.raiseName.toLowerCase()} or call` : chart.raiseName.toLowerCase()} with; drag to paint several. Click a painted cell again to erase it.
          </p>
          <ChartGrid act={checked ? (l) => actOf(chart, l) : mine} onPaint={checked ? undefined : paint} />
          {checked && (
            <>
              <h4 style={{ margin: '14px 0 6px' }}>Your range, with mistakes outlined</h4>
              <ChartGrid act={mine} correct={(l) => actOf(chart, l)} small />
            </>
          )}
        </div>
      </div>
      <div className="spot-side panel">
        {!checked ? (
          <>
            <p className="text-2" style={{ margin: 0 }}>
              Painted: {(ALL_CLASSES.reduce((n, c) => n + (painted.has(c.label) ? c.combos : 0), 0) / 13.26).toFixed(1)}% of hands. The chart plays {(chartShare(chart) * 100).toFixed(1)}%.
            </p>
            <div className="row">
              <button className="btn primary big" onClick={check}>
                Check my range
              </button>
              <button className="btn" onClick={() => setPainted(new Map())}>
                Clear
              </button>
            </div>
            {best[chart.id] !== undefined && <p className="small muted">Your best on this chart: {Math.round(best[chart.id] * 100)}%</p>}
          </>
        ) : (
          <>
            <div className="grade">{Math.round(score.pct * 100)}%</div>
            <p className="small text-2" style={{ margin: 0 }}>
              of the hands that matter (in your range or the chart's), weighted by combos.
            </p>
            <table className="data">
              <tbody>
                <tr>
                  <td>Missing (chart plays, you fold)</td>
                  <td className="num">{score.missing}</td>
                </tr>
                <tr>
                  <td>Extra (you play, chart folds)</td>
                  <td className="num">{score.extra}</td>
                </tr>
                <tr>
                  <td>Wrong action</td>
                  <td className="num">{score.wrongAct}</td>
                </tr>
              </tbody>
            </table>
            <p className="small text-2">{chart.why}</p>
            <ChartLegend actions={chart.actions} raiseName={chart.raiseName} />
            <div className="row">
              <button
                className="btn primary"
                onClick={() => {
                  setPainted(new Map());
                  setChecked(false);
                }}
              >
                Try again
              </button>
              <button className="btn" onClick={() => pick(charts[(charts.indexOf(chart) + 1) % charts.length].id)}>
                Next chart →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Charts() {
  const [chart, setId, charts] = useChartPicker();
  return (
    <div className="spot-layout">
      <div className="spot-table">
        <div className="panel">
          <div className="row between" style={{ marginBottom: 10 }}>
            <ChartSelect chart={chart} setId={setId} charts={charts} />
            <ChartLegend actions={chart.actions} raiseName={chart.raiseName} shares={Object.fromEntries(chart.actions.map((a) => [a, chartShare(chart, a)]))} />
          </div>
          <ChartGrid act={(l) => actOf(chart, l)} />
        </div>
      </div>
      <div className="spot-side panel">
        <h3 style={{ margin: 0 }}>{chart.title}</h3>
        <p className="small muted" style={{ margin: 0 }}>
          {chart.spot}
        </p>
        <p className="text-2">{chart.why}</p>
        <p className="small muted">Percentages are shares of all 1,326 starting combos. Real solver strategies mix many hands between actions; these charts round each hand to its main action.</p>
      </div>
    </div>
  );
}

function Lesson() {
  return (
    <>
      <p>
        <strong>Position is everything preflop.</strong> The later you act, the more players have already folded and the more often you will act last after the flop. So ranges widen from about 19% of
        hands under the gun to almost half on the button.
      </p>
      <ul>
        <li>
          <strong>Raise or fold when first in.</strong> Open-limping lets the blinds in cheaply and gives up the chance to win the pot right away.
        </li>
        <li>
          <strong>Facing a raise, respect position.</strong> An early raiser is strong, so continue tightly. The big blind already has a chip in and closes the action, so it defends widely. The small
          blind mostly 3-bets or folds.
        </li>
        <li>
          <strong>3-bet ranges are polarised:</strong> premium hands for value plus a few bluffs that block the hands that would continue. A5s is the classic: its ace makes AA and AK less likely, and it
          can make a straight or flush.
        </li>
        <li>
          <strong>Facing a 3-bet, adjust to the player.</strong> Against a tight 3-bettor (QQ+, AK) fold most hands; against a light one, fight back with more calls and 4-bets.
        </li>
      </ul>
      <p className="small muted">The charts are simplified 6-max baselines for 100-big-blind cash games, with each hand rounded to a single action.</p>
    </>
  );
}

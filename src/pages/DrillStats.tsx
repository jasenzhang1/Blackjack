import { useEffect, useState } from 'react';
import { LineChart } from '../components/charts';
import { Seg } from '../components/ui';
import { listDrills, type DrillResult } from '../state/progress';
import { onSave } from '../state/storage';

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const RANK_LABEL = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', 'T'];
/** Per-card times over this are treated as pauses and left out of the speed stats. */
const PAUSE_MS = 10_000;
const PHASES = 4;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const sec = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** Re-reads the drill log whenever a result is saved, so the stats update straight after a round. */
function useDrillLog(drill: string): DrillResult[] {
  const [list, setList] = useState(() => listDrills(drill));
  useEffect(() => {
    setList(listDrills(drill));
    return onSave((k) => k === 'drills' && setList(listDrills(drill)));
  }, [drill]);
  return list;
}

export function DrillStats({ drill }: { drill: string }) {
  const all = useDrillLog(drill);
  const [range, setRange] = useState<'20' | 'all'>('20');
  if (!all.length) return null;
  const list = range === 'all' ? all : all.slice(-20);
  const withCards = list.filter((r) => r.cards?.length);
  const graded = withCards.some((r) => r.cards!.some((c) => c.ok !== undefined));

  return (
    <div className="panel stack" style={{ marginTop: 14, gap: 18 }}>
      <div className="panel-title">
        <h3>Stats</h3>
        <Seg
          label="Range"
          value={range}
          onChange={setRange}
          options={[
            { value: '20', label: 'Last 20' },
            { value: 'all', label: 'All' },
          ]}
        />
      </div>
      <Summary list={list} />
      <OverTime list={list} />
      {withCards.length > 0 && <ByCard list={withCards} graded={graded} />}
      {withCards.length > 0 && <Pacing list={withCards} graded={graded} />}
      <Recent list={all.slice(-8).reverse()} />
    </div>
  );
}

function Summary({ list }: { list: DrillResult[] }) {
  const score = list.reduce((a, r) => a + r.score, 0);
  const total = list.reduce((a, r) => a + r.total, 0);
  const best = Math.max(...list.map((r) => r.score / r.total));
  const perfect = list.filter((r) => r.score === r.total).length;
  return (
    <div className="row" style={{ gap: 24 }}>
      <Stat k="Rounds" v={String(list.length)} />
      <Stat k="Accuracy" v={pct(score / total)} />
      <Stat k="Best" v={pct(best)} />
      <Stat k="Perfect rounds" v={String(perfect)} />
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="muted small">{k}</div>
      <strong className="num" style={{ fontSize: 22 }}>
        {v}
      </strong>
    </div>
  );
}

function OverTime({ list }: { list: DrillResult[] }) {
  if (list.length < 2) return null;
  // Single-answer drills score 0 or 1, so show a rolling average to make the trend readable.
  const win = list.every((r) => r.total === 1) ? 5 : 1;
  const acc = list.map((_, i) => {
    const w = list.slice(Math.max(0, i - win + 1), i + 1);
    return { x: i + 1, y: w.reduce((a, r) => a + r.score, 0) / w.reduce((a, r) => a + r.total, 0) };
  });
  const perCard = list.every((r) => r.cards?.length);
  const speed = list.map((r, i) => ({ x: i + 1, y: (perCard ? r.ms / r.cards!.length : r.ms) / 1000 }));
  return (
    <div className="grid-2">
      <LineChart
        height={200}
        series={[{ id: 'acc', label: win > 1 ? `Accuracy (last ${win})` : 'Accuracy', color: '#3987e5', points: acc }]}
        xLabel="Round"
        yLabel="Accuracy"
        xFormat={(v) => String(Math.round(v))}
        yFormat={(v) => `${Math.round(v * 100)}%`}
      />
      <LineChart
        height={200}
        series={[{ id: 'speed', label: perCard ? 'Seconds per card' : 'Seconds', color: '#d95926', points: speed }]}
        xLabel="Round"
        yLabel={perCard ? 'Seconds per card' : 'Seconds'}
        xFormat={(v) => String(Math.round(v))}
        yFormat={(v) => v.toFixed(perCard ? 2 : 1)}
      />
    </div>
  );
}

function ByCard({ list, graded }: { list: DrillResult[]; graded: boolean }) {
  const rows = RANKS.map((r) => {
    const cs = list.flatMap((x) => x.cards!.filter((c) => c.r === r));
    const timed = cs.filter((c) => c.ms > 0 && c.ms < PAUSE_MS);
    return {
      r,
      n: cs.length,
      acc: cs.length ? cs.filter((c) => c.ok).length / cs.length : 1,
      ms: timed.length ? timed.reduce((a, c) => a + c.ms, 0) / timed.length : 0,
    };
  });
  const worstAcc = graded ? Math.min(...rows.filter((x) => x.n).map((x) => x.acc)) : 1;
  const slowest = Math.max(...rows.map((x) => x.ms));
  return (
    <div>
      <h4 style={{ margin: '0 0 6px' }}>By Card</h4>
      <table className="data">
        <thead>
          <tr>
            <th>Card</th>
            {rows.map((x) => (
              <th key={x.r} className="num">
                {RANK_LABEL[x.r]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {graded && (
            <tr>
              <td>Accuracy</td>
              {rows.map((x) => (
                <td key={x.r} className={`num ${x.n && x.acc === worstAcc && worstAcc < 1 ? 'bad' : ''}`}>
                  {x.n ? pct(x.acc) : '–'}
                </td>
              ))}
            </tr>
          )}
          <tr>
            <td>Avg time</td>
            {rows.map((x) => (
              <td key={x.r} className={`num ${x.ms && x.ms === slowest ? 'bad' : ''}`}>
                {x.ms ? (x.ms / 1000).toFixed(2) : '–'}
              </td>
            ))}
          </tr>
          <tr>
            <td className="muted">Seen</td>
            {rows.map((x) => (
              <td key={x.r} className="num muted">
                {x.n}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Pacing({ list, graded }: { list: DrillResult[]; graded: boolean }) {
  const phases = Array.from({ length: PHASES }, (_, p) => {
    const cs = list.flatMap((x) => {
      const n = x.cards!.length;
      return x.cards!.filter((_, i) => Math.floor((i * PHASES) / n) === p);
    });
    const timed = cs.filter((c) => c.ms > 0 && c.ms < PAUSE_MS);
    return {
      acc: cs.length ? cs.filter((c) => c.ok).length / cs.length : 0,
      ms: timed.length ? timed.reduce((a, c) => a + c.ms, 0) / timed.length : 0,
    };
  });
  const first = phases[0].ms;
  const last = phases[PHASES - 1].ms;
  const verdict = !first || !last ? null : last < first * 0.9 ? 'Strong finish' : last > first * 1.1 ? 'Fast start, slower finish' : 'Steady';
  const labels = ['Start', 'Early', 'Late', 'Finish'];
  return (
    <div>
      <div className="row between" style={{ marginBottom: 6 }}>
        <h4 style={{ margin: 0 }}>Over the Round</h4>
        {verdict && <span className="chip">{verdict}</span>}
      </div>
      <table className="data">
        <thead>
          <tr>
            <th />
            {labels.map((l) => (
              <th key={l} className="num">
                {l}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {graded && (
            <tr>
              <td>Accuracy</td>
              {phases.map((p, i) => (
                <td key={i} className="num">
                  {pct(p.acc)}
                </td>
              ))}
            </tr>
          )}
          <tr>
            <td>Avg time</td>
            {phases.map((p, i) => (
              <td key={i} className="num">
                {p.ms ? sec(p.ms) : '–'}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Recent({ list }: { list: DrillResult[] }) {
  return (
    <div>
      <h4 style={{ margin: '0 0 6px' }}>Recent Results</h4>
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

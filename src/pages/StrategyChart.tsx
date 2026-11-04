import { useMemo, useState } from 'react';
import { StudyRules } from '../components/StudyRules';
import { BLUE_RAMP, ORANGE_RAMP, inkOn, rampColor } from '../components/charts';
import { ProofDrawer } from '../components/ProofDrawer';
import { ActionLegend, StrategyGrid, type CellView } from '../components/StrategyGrid';
import { Progress, Seg, codeFill, codeFillClass, fmtEV } from '../components/ui';
import { type Rank } from '../engine/cards';
import { HARD_ROWS, PAIR_ROWS, SOFT_ROWS, rowKey, type RowKey } from '../engine/hand';
import { strategyKey } from '../engine/rules';
import { cellKey, type StrategyTable } from '../engine/strategy';
import { cellStats } from '../state/progress';
import { useSettings, type Prefs } from '../state/settings';
import { useStrategy } from '../worker/client';

// Margin buckets (fraction of a bet) for the sequential "what is at stake" view.
const MARGIN_STOPS = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8];
function marginT(m: number): number {
  let i = 0;
  while (i < MARGIN_STOPS.length && m > MARGIN_STOPS[i]) i++;
  return i / MARGIN_STOPS.length;
}

export function useCellRenderer(table: StrategyTable | null, view: Prefs['chartView']) {
  const stats = useMemo(() => (table ? cellStats(strategyKey(table.rules)) : {}), [table]);
  return (row: RowKey, up: Rank): CellView => {
    const c = table?.cells[cellKey(row, up)];
    if (!c) return { className: 'blank', content: '·' };
    if (view === 'margin') {
      const t = marginT(c.margin);
      const pctv = c.margin * 100;
      return {
        className: '',
        style: { background: rampColor(BLUE_RAMP, t), color: inkOn(BLUE_RAMP, t) },
        content: (
          <>
            {c.code}
            <span className="ev">{pctv >= 10 ? pctv.toFixed(0) : pctv.toFixed(1)}</span>
          </>
        ),
        title: `${c.code}: beats the next-best play by ${pctv.toFixed(2)}% of a bet`,
      };
    }
    if (view === 'weak') {
      const s = stats[cellKey(row, up)];
      if (!s || s.attempts === 0) return { className: 'blank', content: <span className="muted">·</span>, title: 'No attempts yet' };
      const err = 1 - s.correct / s.attempts;
      const t = Math.min(1, err * 2);
      return {
        className: '',
        style: { background: rampColor(ORANGE_RAMP, t), color: inkOn(ORANGE_RAMP, t) },
        content: (
          <>
            {c.code}
            <span className="ev">
              {s.correct}/{s.attempts}
            </span>
          </>
        ),
        title: `${c.code}: ${s.correct} of ${s.attempts} correct`,
      };
    }
    return {
      className: `a-${c.best} ${codeFillClass(c.code)}`,
      style: codeFill(c.code),
      content:
        view === 'ev' ? (
          <>
            {c.code}
            <span className="ev">{fmtEV(c.ev[c.best], 2)}</span>
          </>
        ) : (
          c.code
        ),
      title: `${c.code}: EV ${fmtEV(c.ev[c.best])}`,
    };
  };
}

export const CHART_SECTIONS: { id: 'hard' | 'soft' | 'pair'; caption: string; rows: RowKey[] }[] = [
  { id: 'hard', caption: 'Hard totals', rows: HARD_ROWS.map((n) => rowKey('hard', n)) },
  { id: 'soft', caption: 'Soft totals (ace counted as 11)', rows: SOFT_ROWS.map((n) => rowKey('soft', n)) },
  { id: 'pair', caption: 'Pairs', rows: PAIR_ROWS.map((n) => rowKey('pair', n)) },
];

export default function StrategyChart() {
  const { rules, prefs, setPrefs } = useSettings();
  const { table, progress, error } = useStrategy(rules);
  const [sel, setSel] = useState<string | null>(null);
  const render = useCellRenderer(table, prefs.chartView);
  const cell = table && sel ? table.cells[sel] : null;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Basic strategy chart</h1>
        </div>
        <div className="row no-print">
          <Seg
            label="Chart view"
            value={prefs.chartView}
            onChange={(v) => setPrefs({ chartView: v })}
            options={[
              { value: 'actions', label: 'Plays' },
              { value: 'ev', label: 'Plays + EV' },
              { value: 'margin', label: 'What is at stake' },
              { value: 'weak', label: 'My weak spots' },
            ]}
          />
          <button className="btn small" onClick={() => window.print()}>
            Print
          </button>
        </div>
      </div>

      <StudyRules note="Pick the game you want to learn. The chart re-solves exactly for it (e.g. turn surrender off to see the no-surrender chart)." />
      {error && <div className="callout bad">Engine error: {error}</div>}
      {!table && !error && (
        <div className="panel">
          <Progress value={progress} label={`Computing the exact EV of every play in every cell… ${Math.round(progress * 100)}%`} />
          <p className="muted small" style={{ marginTop: 10 }}>
            Hundreds of thousands of card-removal sub-problems are solved in a background thread. Results are cached, so this only happens once per rule set.
          </p>
        </div>
      )}

      {table && (
        <div className={`chart-layout ${cell ? '' : 'no-drawer'}`}>
          <div className="panel">
            <div className="stack" style={{ gap: 18 }}>
              {CHART_SECTIONS.map((s) => (
                <StrategyGrid key={s.id} caption={s.caption} rows={s.rows} cell={render} selected={sel} onCell={(row, up) => setSel(cellKey(row, up))} />
              ))}
            </div>
            <div style={{ marginTop: 16 }} className="stack">
              {prefs.chartView === 'margin' ? (
                <div className="scale-bar">
                  <span>Close call</span>
                  <span className="ramp" style={{ background: `linear-gradient(90deg, ${BLUE_RAMP.join(',')})` }} />
                  <span>Big edge</span>
                  <span className="muted">Each number is how much the best play beats the runner-up, in % of a bet.</span>
                </div>
              ) : prefs.chartView === 'weak' ? (
                <div className="scale-bar">
                  <span>Always right</span>
                  <span className="ramp" style={{ background: `linear-gradient(90deg, ${ORANGE_RAMP.join(',')})` }} />
                  <span>Often wrong</span>
                  <span className="muted">From your grid-quiz and trainer history (correct/attempts).</span>
                </div>
              ) : (
                <ActionLegend />
              )}
              <p className="muted small">
                Columns are the dealer's upcard. Two-card hands. After three or more cards, play the same total but without doubling or surrendering (so Dh becomes hit
                and Ds becomes stand). House edge with this chart: <strong>{(table.houseEdge * 100).toFixed(3)}%</strong>.
              </p>
            </div>
          </div>
          {cell && <ProofDrawer key={sel!} table={table} cell={cell} onClose={() => setSel(null)} />}
        </div>
      )}
    </main>
  );
}

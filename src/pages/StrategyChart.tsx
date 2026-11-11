import { useMemo, useState } from 'react';
import { ACCURACY_RAMP, BLUE_RAMP, inkOn, rampColor } from '../components/charts';
import { ProofDrawer } from '../components/ProofDrawer';
import { ActionLegend, StrategyGrid, type CellView } from '../components/StrategyGrid';
import { Modal, Progress, Seg, codeFill, codeFillClass, fmtEV } from '../components/ui';
import { type Rank } from '../engine/cards';
import { ALL_HARD_ROWS, ALL_SOFT_ROWS, HARD_ROWS, PAIR_ROWS, SOFT_ROWS, rowKey, type RowKey } from '../engine/hand';
import { strategyKey } from '../engine/rules';
import { cellKey, type StrategyTable } from '../engine/strategy';
import { cellStats, resetCellStats } from '../state/progress';
import { useSettings, type Prefs } from '../state/settings';
import { useStrategy } from '../worker/client';

// Margin buckets (fraction of a bet) for the sequential "what is at stake" view.
const MARGIN_STOPS = [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.8];
function marginT(m: number): number {
  let i = 0;
  while (i < MARGIN_STOPS.length && m > MARGIN_STOPS[i]) i++;
  return i / MARGIN_STOPS.length;
}

export function useCellRenderer(table: StrategyTable | null, view: Prefs['chartView'], statsVersion = 0) {
  const stats = useMemo(() => (table ? cellStats(strategyKey(table.rules)) : {}), [table, statsVersion]);
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
        style: { background: rampColor(ACCURACY_RAMP, t), color: t < 0.25 || t > 0.75 ? '#ffffff' : '#0b0b0b' },
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
            <span className="ev">{fmtEV(c.ev[c.best], 0)}</span>
          </>
        ) : (
          c.code
        ),
      title: `${c.code}: EV ${fmtEV(c.ev[c.best])}`,
    };
  };
}

export type ChartSection = { id: 'hard' | 'soft' | 'pair'; caption: string; rows: RowKey[] };

/**
 * The chart's sections. Hard 4 (only 2,2) and soft 12 (only A,A) repeat a pair row played without
 * splitting, so they are hidden unless `hideRedundant` is false.
 */
/** Chart rows run from the highest hand at the top to the lowest at the bottom (A,A first for pairs). */
export function chartSections(hideRedundant: boolean): ChartSection[] {
  return [
    { id: 'hard', caption: 'Hard Totals', rows: (hideRedundant ? HARD_ROWS : ALL_HARD_ROWS).map((n) => rowKey('hard', n)).reverse() },
    { id: 'soft', caption: 'Soft Totals', rows: (hideRedundant ? SOFT_ROWS : ALL_SOFT_ROWS).map((n) => rowKey('soft', n)).reverse() },
    { id: 'pair', caption: 'Pairs', rows: PAIR_ROWS.map((n) => rowKey('pair', n)).reverse() },
  ];
}

export default function StrategyChart() {
  const { rules, prefs, setPrefs } = useSettings();
  const { table, progress, error } = useStrategy(rules);
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<'hard' | 'soft' | 'pair'>('hard');
  const [statsVersion, setStatsVersion] = useState(0);
  const render = useCellRenderer(table, prefs.chartView, statsVersion);
  const stats = useMemo(() => (table ? cellStats(strategyKey(table.rules)) : {}), [table, statsVersion]);
  const sections = chartSections(!prefs.showRepeatedRows);
  // Two-step confirmation: step 1 asks, step 2 asks again before anything is deleted.
  const [resetting, setResetting] = useState<{ sec: ChartSection; step: 1 | 2 } | null>(null);
  const doReset = () => {
    if (table && resetting) resetCellStats(strategyKey(table.rules), resetting.sec.rows);
    setStatsVersion((v) => v + 1);
    setResetting(null);
  };
  const legend =
    prefs.chartView === 'margin' ? (
      <div className="scale-bar">
        <span>Close call</span>
        <span className="ramp" style={{ background: `linear-gradient(90deg, ${BLUE_RAMP.join(',')})` }} />
        <span>Big edge</span>
      </div>
    ) : prefs.chartView === 'weak' ? (
      <div className="scale-bar">
        <span>Always right</span>
        <span className="ramp" style={{ background: `linear-gradient(90deg, ${ACCURACY_RAMP.join(',')})`, border: '1px solid var(--border)' }} />
        <span>Often wrong</span>
      </div>
    ) : (
      <ActionLegend />
    );
  const cell = table && sel ? table.cells[sel] : null;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Basic Strategy Chart</h1>
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
      {error && <div className="callout bad">Engine error: {error}</div>}
      {!table && !error && (
        <div className="panel">
          <Progress value={progress} label={`Computing the exact EV of every play in every cell… ${Math.round(progress * 100)}%`} />
        </div>
      )}

      {table && (
        <div className={`chart-layout ${cell ? '' : 'no-drawer'}`}>
          <div className="panel">
            {/* Phones and tablets show one chart at a time, picked with these tabs. */}
            <div className="chart-tabs no-print">
              <Seg
                label="Chart"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'hard', label: 'Hard Totals' },
                  { value: 'soft', label: 'Soft Totals' },
                  { value: 'pair', label: 'Pairs' },
                ]}
              />
            </div>
            <div className="chart-toolbar">
              {legend}
              {prefs.chartView === 'weak' && (
                <div className="row tight no-print">
                  {sections.map((s) => (
                    <button key={s.id} className={`btn danger small chart-reset ${s.id === tab ? 'on' : ''}`} onClick={() => setResetting({ sec: s, step: 1 })}>
                      Reset {s.caption} Progress
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="stack" style={{ gap: 18 }}>
              {sections.map((s) => (
                <div key={s.id} className={`chart-sec ${s.id === tab ? 'on' : ''}`}>
                  <StrategyGrid caption={s.caption} rows={s.rows} cell={render} selected={sel} onCell={(row, up) => setSel(cellKey(row, up))} />
                </div>
              ))}
            </div>
          </div>
          {cell && <ProofDrawer key={sel!} table={table} cell={cell} onClose={() => setSel(null)} stat={prefs.chartView === 'weak' ? stats[sel!] : undefined} />}
        </div>
      )}
      {resetting && (
        <Modal
          narrow
          title={resetting.step === 1 ? `Reset ${resetting.sec.caption} Progress?` : 'Are you sure?'}
          onClose={() => setResetting(null)}
          footer={
            <>
              <button className="btn" onClick={() => setResetting(null)} autoFocus>
                Cancel
              </button>
              <button className="btn danger solid" onClick={() => (resetting.step === 1 ? setResetting({ ...resetting, step: 2 }) : doReset())}>
                {resetting.step === 1 ? 'Reset' : 'Yes, Reset'}
              </button>
            </>
          }
        >
          <p>{resetting.step === 1 ? `All your ${resetting.sec.caption.toLowerCase()} results will be erased.` : 'This cannot be undone.'}</p>
        </Modal>
      )}
    </main>
  );
}

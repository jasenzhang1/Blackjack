/** Preflop chart grid: shows a chart, compares a painted range with it, or lets you paint. */
import { useEffect, useRef } from 'react';
import { ALL_CLASSES } from './ranges';
import type { ChartAct } from './preflop';

export const ACT_COLOR: Record<ChartAct, string> = { raise: '#e66767', call: '#199e70', fold: 'transparent' };
export const ACT_LABEL: Record<ChartAct, string> = { raise: 'Raise', call: 'Call', fold: 'Fold' };

export function ChartGrid({
  act,
  highlight,
  correct,
  onPaint,
  small,
}: {
  /** Action shown in each cell. */
  act: (label: string) => ChartAct;
  highlight?: string;
  /** When given, cells whose shown action differs from it are marked wrong. */
  correct?: (label: string) => ChartAct;
  onPaint?: (label: string, first: boolean) => void;
  small?: boolean;
}) {
  const painting = useRef(false);
  const last = useRef('');
  useEffect(() => {
    const up = () => (painting.current = false);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, []);
  const paintAt = (x: number, y: number, first: boolean) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    const l = el?.closest<HTMLElement>('[data-label]')?.dataset.label;
    if (l && (first || l !== last.current)) {
      last.current = l;
      onPaint?.(l, first);
    }
  };
  return (
    <div
      className={`cgrid ${onPaint ? 'paintable' : ''} ${small ? 'small' : ''}`}
      role="grid"
      aria-label="Preflop chart"
      onPointerDown={(e) => {
        if (!onPaint) return;
        e.preventDefault();
        painting.current = true;
        (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
        paintAt(e.clientX, e.clientY, true);
      }}
      onPointerMove={(e) => painting.current && paintAt(e.clientX, e.clientY, false)}
    >
      {ALL_CLASSES.map((c) => {
        const a = act(c.label);
        const want = correct?.(c.label);
        const wrong = want !== undefined && want !== a;
        return (
          <div
            key={c.label}
            data-label={c.label}
            role="gridcell"
            className={`ccell a-${a} ${c.label === highlight ? 'hl' : ''} ${wrong ? 'wrong' : ''}`}
            style={a !== 'fold' ? { background: ACT_COLOR[a] } : undefined}
            title={`${c.label}: ${ACT_LABEL[a]}${wrong ? ` (chart: ${ACT_LABEL[want]})` : ''}`}
          >
            {c.label}
          </div>
        );
      })}
    </div>
  );
}

export function ChartLegend({ actions, raiseName, shares }: { actions: ChartAct[]; raiseName: string; shares?: Partial<Record<ChartAct, number>> }) {
  return (
    <div className="legend">
      {actions.map((a) => (
        <span key={a} className="item">
          <span className="swatch" style={{ background: a === 'fold' ? 'var(--panel-2)' : ACT_COLOR[a], boxShadow: 'inset 0 0 0 1px var(--border-2)' }} />
          {a === 'raise' ? raiseName : ACT_LABEL[a]}
          {shares?.[a] !== undefined && <span className="muted">{(shares[a]! * 100).toFixed(1)}%</span>}
        </span>
      ))}
    </div>
  );
}

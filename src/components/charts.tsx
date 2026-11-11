/**
 * Small, dependency-free SVG charts following the dataviz method: thin 2px lines, ≤24px columns
 * with 4px rounded data-ends, hairline grid, legend + selective direct labels, crosshair / per-mark
 * hover tooltips that never gate a value (every chart has a table-view twin).
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';

export interface Series {
  id: string;
  label: string;
  color: string;
  points: { x: number; y: number }[];
}

function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const span = hi - lo;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 0.5; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

function TableToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button className="btn ghost small" onClick={onToggle} aria-expanded={open}>
      {open ? 'Hide table' : 'Show table'}
    </button>
  );
}

export function LineChart({
  series,
  xLabel,
  yLabel,
  xFormat = (v) => String(v),
  yFormat = (v) => v.toFixed(2),
  height = 260,
  markers,
  title,
}: {
  series: Series[];
  xLabel: string;
  yLabel: string;
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  height?: number;
  /** Vertical annotations (e.g. the index where two lines cross). */
  markers?: { x: number; label: string }[];
  title?: ReactNode;
}) {
  const W = 640;
  const H = height;
  const m = { l: 56, r: 104, t: 14, b: 38 };
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);

  const xs = useMemo(() => Array.from(new Set(series.flatMap((s) => s.points.map((p) => p.x)))).sort((a, b) => a - b), [series]);
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const yTicks = niceTicks(Math.min(0, ...allY), Math.max(0, ...allY));
  const y0 = yTicks[0];
  const y1 = yTicks[yTicks.length - 1];
  const x0 = xs[0] ?? 0;
  const x1 = xs[xs.length - 1] ?? 1;
  const sx = (x: number) => m.l + ((x - x0) / (x1 - x0 || 1)) * (W - m.l - m.r);
  const sy = (y: number) => m.t + (1 - (y - y0) / (y1 - y0 || 1)) * (H - m.t - m.b);

  const onMove = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg || !xs.length) return;
    const r = svg.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W;
    let best = xs[0];
    for (const x of xs) if (Math.abs(sx(x) - vx) < Math.abs(sx(best) - vx)) best = x;
    setHover(best);
  };

  const tipLeft = hover !== null ? (sx(hover) / W) * 100 : 0;

  return (
    <div className="viz">
      {title && <div className="widget-title">{title}</div>}
      {series.length > 1 && (
        <div className="viz-legend" aria-hidden>
          {series.map((s) => (
            <span key={s.id}>
              <span className="key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} by ${xLabel}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {yTicks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axisline' : 'gridline'} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text className="tick" x={m.l - 8} y={sy(t) + 4} textAnchor="end">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xs.map((x) => (
          <text key={x} className="tick" x={sx(x)} y={H - m.b + 16} textAnchor="middle">
            {xFormat(x)}
          </text>
        ))}
        <text className="axis-title" x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle">
          {xLabel}
        </text>
        <text className="axis-title" transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          {yLabel}
        </text>
        {markers?.map((mk) => (
          <g key={mk.label}>
            <line x1={sx(mk.x)} x2={sx(mk.x)} y1={m.t} y2={H - m.b} stroke="var(--gold)" strokeWidth={1} />
            <text x={sx(mk.x) + 4} y={m.t + 10} className="end-label" style={{ fill: 'var(--gold-2)' }}>
              {mk.label}
            </text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.id} className="series" stroke={s.color} d={s.points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('')} />
        ))}
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          if (!last) return null;
          return (
            <g key={s.id + '-end'}>
              <circle cx={sx(last.x)} cy={sy(last.y)} r={4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
              <text className="end-label" x={sx(last.x) + 8} y={sy(last.y) + 4}>
                {s.label}
              </text>
            </g>
          );
        })}
        {hover !== null && (
          <g>
            <line className="crosshair" x1={sx(hover)} x2={sx(hover)} y1={m.t} y2={H - m.b} />
            {series.map((s) => {
              const p = s.points.find((q) => q.x === hover);
              return p ? <circle key={s.id} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={s.color} stroke="var(--panel)" strokeWidth={2} /> : null;
            })}
          </g>
        )}
      </svg>
      {hover !== null && (
        <div className="viz-tip" style={{ left: `calc(${tipLeft}% + ${tipLeft > 60 ? -170 : 14}px)`, top: 30 }}>
          <div className="t">
            {xLabel}: {xFormat(hover)}
          </div>
          {series.map((s) => {
            const p = s.points.find((q) => q.x === hover);
            return p ? (
              <div className="r" key={s.id}>
                <span className="key" style={{ background: s.color }} />
                <b>{yFormat(p.y)}</b>
                <span className="muted">{s.label}</span>
              </div>
            ) : null;
          })}
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <TableToggle open={table} onToggle={() => setTable((x) => !x)} />
      </div>
      {table && (
        <table className="data">
          <thead>
            <tr>
              <th>{xLabel}</th>
              {series.map((s) => (
                <th key={s.id} className="num">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xs.map((x) => (
              <tr key={x}>
                <td>{xFormat(x)}</td>
                {series.map((s) => {
                  const p = s.points.find((q) => q.x === x);
                  return (
                    <td key={s.id} className="num">
                      {p ? yFormat(p.y) : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * Diverging column chart (one category axis, values above/below zero). Polarity is the job, so the
 * two arms take the two diverging poles; labels sit at the bar tips in text ink.
 */
export function DivergingColumns({
  data,
  format,
  posColor = '#3987e5',
  negColor = '#e66767',
  height = 240,
  xLabel,
  yLabel,
  posLabel,
  negLabel,
}: {
  data: { label: string; value: number }[];
  format: (v: number) => string;
  posColor?: string;
  negColor?: string;
  height?: number;
  xLabel: string;
  yLabel: string;
  posLabel: string;
  negLabel: string;
}) {
  const W = 640;
  const H = height;
  const m = { l: 56, r: 14, t: 22, b: 40 };
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const vals = data.map((d) => d.value);
  const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals), 4);
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const sy = (y: number) => m.t + (1 - (y - lo) / (hi - lo || 1)) * (H - m.t - m.b);
  const band = (W - m.l - m.r) / data.length;
  const bw = Math.min(24, band * 0.6);
  const r = 4;

  const colPath = (cx: number, v: number) => {
    const x = cx - bw / 2;
    const y0 = sy(0);
    const y1 = sy(v);
    const h = Math.abs(y1 - y0);
    if (h < 0.5) return '';
    const rr = Math.min(r, h, bw / 2);
    if (v >= 0) return `M${x},${y0} V${y1 + rr} Q${x},${y1} ${x + rr},${y1} H${x + bw - rr} Q${x + bw},${y1} ${x + bw},${y1 + rr} V${y0} Z`;
    return `M${x},${y0} V${y1 - rr} Q${x},${y1} ${x + rr},${y1} H${x + bw - rr} Q${x + bw},${y1} ${x + bw},${y1 - rr} V${y0} Z`;
  };

  return (
    <div className="viz">
      <div className="viz-legend" aria-hidden>
        <span>
          <span className="key box" style={{ background: posColor }} />
          {posLabel}
        </span>
        <span>
          <span className="key box" style={{ background: negColor }} />
          {negLabel}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} by ${xLabel}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axisline' : 'gridline'} x1={m.l} x2={W - m.r} y1={sy(t)} y2={sy(t)} />
            <text className="tick" x={m.l - 8} y={sy(t) + 4} textAnchor="end">
              {format(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = m.l + band * (i + 0.5);
          const pos = d.value >= 0;
          return (
            <g key={d.label} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} tabIndex={0} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              <rect x={cx - band / 2} y={m.t} width={band} height={H - m.t - m.b} fill="transparent" />
              <path d={colPath(cx, d.value)} fill={pos ? posColor : negColor} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text className="bar-label" x={cx} y={pos ? sy(d.value) - 6 : sy(d.value) + 14} textAnchor="middle">
                {format(d.value)}
              </text>
              <text className="tick" x={cx} y={H - m.b + 18} textAnchor="middle" style={{ fontWeight: 700, fill: 'var(--text-2)' }}>
                {d.label}
              </text>
            </g>
          );
        })}
        <text className="axis-title" x={(m.l + W - m.r) / 2} y={H - 4} textAnchor="middle">
          {xLabel}
        </text>
        <text className="axis-title" transform={`translate(12 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle">
          {yLabel}
        </text>
      </svg>
      {hover !== null && (
        <div className="viz-tip" style={{ left: `calc(${((m.l + band * (hover + 0.5)) / W) * 100}% + 12px)`, top: 20 }}>
          <div className="t">{data[hover].label}</div>
          <div className="r">
            <b>{format(data[hover].value)}</b>
            <span className="muted">{yLabel}</span>
          </div>
        </div>
      )}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <TableToggle open={table} onToggle={() => setTable((x) => !x)} />
      </div>
      {table && (
        <table className="data">
          <thead>
            <tr>
              <th>{xLabel}</th>
              <th className="num">{yLabel}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <td>{d.label}</td>
                <td className="num">{format(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** Sequential ramp (single hue, dark → light on the dark surface) for heat-mapped grid cells. */
export const BLUE_RAMP = ['#0d366b', '#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4'];
export const ORANGE_RAMP = ['#3d1d10', '#5a2914', '#773518', '#94411c', '#b14d21', '#d95926', '#e0723f', '#e78b5a', '#eea476', '#f4bd95', '#f8d3b7'];

/** Diverging blue → white → red, for "always right" → "often wrong". */
export const ACCURACY_RAMP = ['#1c5cab', '#3987e5', '#6da7ec', '#9ec5f4', '#cfe1f8', '#ffffff', '#f8cfcf', '#f09e9e', '#e36b6b', '#d13b3b', '#a91f1f'];

export function rampColor(ramp: string[], t: number): string {
  const i = Math.max(0, Math.min(ramp.length - 1, Math.round(t * (ramp.length - 1))));
  return ramp[i];
}

/** Text ink for a label sitting inside a ramp fill. */
export function inkOn(ramp: string[], t: number): string {
  const i = Math.round(Math.max(0, Math.min(1, t)) * (ramp.length - 1));
  return i >= 7 ? '#0b0b0b' : '#ffffff';
}

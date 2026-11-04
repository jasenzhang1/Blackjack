import type { CSSProperties, PointerEvent, ReactNode } from 'react';
import { UPCARDS, rankLabel, type Rank } from '../engine/cards';
import { rowShortLabel, type RowKey } from '../engine/hand';
import { cellKey } from '../engine/strategy';

export interface CellView {
  className: string;
  content: ReactNode;
  title?: string;
  style?: CSSProperties;
}

/** One block of the strategy chart (hard totals, soft totals or pairs). */
export function StrategyGrid({
  caption,
  rows,
  cell,
  selected,
  cursor,
  onCell,
  onCellDown,
  onCellEnter,
}: {
  caption: string;
  rows: readonly RowKey[];
  cell: (row: RowKey, up: Rank) => CellView;
  selected?: string | null;
  cursor?: string | null;
  onCell?: (row: RowKey, up: Rank) => void;
  onCellDown?: (row: RowKey, up: Rank, e: PointerEvent) => void;
  onCellEnter?: (row: RowKey, up: Rank, e: PointerEvent) => void;
}) {
  return (
    <div className="chart-wrap">
      <table className="sgrid">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th className="rowh" scope="col">
              <span className="sr-only">Hand</span>
            </th>
            {UPCARDS.map((u) => (
              <th key={u} scope="col" title={`Dealer shows ${rankLabel(u)}`}>
                {rankLabel(u)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th className="rowh" scope="row">
                {rowShortLabel(row)}
              </th>
              {UPCARDS.map((u) => {
                const v = cell(row, u);
                const k = cellKey(row, u);
                return (
                  <td
                    key={u}
                    className={`cell ${v.className} ${selected === k ? 'sel' : ''} ${cursor === k ? 'cursor' : ''}`}
                    style={v.style}
                    title={v.title}
                    onClick={() => onCell?.(row, u)}
                    onPointerDown={onCellDown ? (e) => onCellDown(row, u, e) : undefined}
                    onPointerEnter={onCellEnter ? (e) => onCellEnter(row, u, e) : undefined}
                    role="gridcell"
                    tabIndex={-1}
                  >
                    {v.content}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ActionLegend() {
  return (
    <div className="legend">
      <span className="item">
        <span className="tag H">H</span> Hit
      </span>
      <span className="item">
        <span className="tag S">S</span> Stand
      </span>
      <span className="item">
        <span className="tag D">Dh</span> Double, else hit
      </span>
      <span className="item">
        <span className="tag D">Ds</span> Double, else stand
      </span>
      <span className="item">
        <span className="tag P">P</span> Split
      </span>
      <span className="item">
        <span className="tag R">Rh</span> Surrender, else hit
      </span>
      <span className="item">
        <span className="tag R">Rs</span> Surrender, else stand
      </span>
      <span className="item">
        <span className="tag R">Rp</span> Surrender, else split
      </span>
    </div>
  );
}

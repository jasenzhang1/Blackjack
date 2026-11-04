import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { ACTION_NAMES, type Action, type ActionEVs } from '../engine/ev';
import { bestOf } from '../engine/strategy';

export function Modal({ title, onClose, children, footer, narrow }: { title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${narrow ? 'narrow' : ''}`} role="dialog" aria-modal="true" tabIndex={-1} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Check({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}

/**
 * Fill for a strategy code. Two-letter fallback codes (Dh, Ds, Rh, Rs, Rp) are split along the
 * y = x diagonal: the preferred play's colour in the top-left triangle, the fallback's colour in the
 * bottom-right one.
 */
export function codeFill(code: string): CSSProperties | undefined {
  if (code.length < 2) return undefined;
  const a = code[0].toUpperCase() as Action;
  const b = code[1].toUpperCase() as Action;
  if (!ACTION_VAR[a] || !ACTION_VAR[b]) return undefined;
  return { background: `linear-gradient(to bottom right, ${ACTION_VAR[a]} 50%, ${ACTION_VAR[b]} 50%)` };
}

/** Extra class for split tiles whose label sits on the dark surrender grey. */
export const codeFillClass = (code: string): string => (code.length >= 2 && (code[0] === 'R' || code[1] === 'r') ? 'split-r' : '');

export function Tag({ a }: { a: string }) {
  const k = a[0] as Action;
  return (
    <span className={`tag ${k} ${codeFillClass(a)}`} style={codeFill(a)}>
      {a}
    </span>
  );
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      {label && <div className="muted small">{label}</div>}
      <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
        <div style={{ width: `${Math.max(3, value * 100)}%` }} />
      </div>
    </div>
  );
}

export const fmtEV = (x: number | undefined, digits = 4): string => (x === undefined || !Number.isFinite(x) ? '—' : (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(digits));
export const fmtPct = (x: number, digits = 2): string => `${(x * 100).toFixed(digits)}%`;
export const fmtSignedPct = (x: number, digits = 2): string => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toFixed(digits)}%`;
export const fmtMoney = (x: number): string => `${x < 0 ? '−' : ''}$${Math.abs(x).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: Math.abs(x) % 1 ? 2 : 0 })}`;

const ACTION_VAR: Record<Action, string> = { H: 'var(--hit)', S: 'var(--stand)', D: 'var(--double)', P: 'var(--split)', R: 'var(--surrender)' };
export const actionColor = (a: Action): string => ACTION_VAR[a];
/** Hex values of the validated action palette (for SVG attributes, which can't use CSS variables). */
export const ACTION_HEX: Record<Action, string> = { H: '#199e70', S: '#e66767', D: '#e9b949', P: '#3987e5', R: '#5f6662' };

/**
 * Horizontal EV bars for each available action (diverging from 0). Identity is carried by the
 * action name + letter tag beside every bar (never colour alone); values are printed at the end.
 */
export function EVBars({ ev, order = ['S', 'H', 'D', 'P', 'R'], highlight }: { ev: ActionEVs; order?: Action[]; highlight?: Action }) {
  const acts = order.filter((a) => ev[a] !== undefined);
  const vals = acts.map((a) => ev[a] as number);
  const lo = Math.min(0, ...vals);
  const hi = Math.max(0, ...vals);
  const span = hi - lo || 1;
  const pos = (x: number) => ((x - lo) / span) * 100;
  const best = highlight ?? bestOf(ev);
  return (
    <div className="evbars" role="table" aria-label="Expected value of each action">
      {acts.map((a) => {
        const x = ev[a] as number;
        const left = Math.min(pos(0), pos(x));
        const width = Math.abs(pos(x) - pos(0));
        return (
          <div key={a} className={`evbar ${a === best ? 'best' : ''}`} role="row">
            <span className="lbl" role="cell">
              <span className={`tag ${a}`}>{a}</span>
              {ACTION_NAMES[a]}
            </span>
            <span className="track" role="cell" title={`${ACTION_NAMES[a]}: ${fmtEV(x)}`}>
              <span className="zero" style={{ left: `${pos(0)}%` }} />
              <span className="bar" style={{ left: `${left}%`, width: `max(2px, ${width}%)`, background: actionColor(a) }} />
            </span>
            <span className="val" role="cell">
              {fmtEV(x)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Keyboard shortcut hook (ignores keys typed into inputs). */
export function useKeys(handler: (key: string, e: KeyboardEvent) => void, deps: unknown[]) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      handler(e.key.toLowerCase(), e);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

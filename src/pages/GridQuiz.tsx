import { useEffect, useMemo, useRef, useState } from 'react';
import { ProofDrawer } from '../components/ProofDrawer';
import { StrategyGrid, type CellView } from '../components/StrategyGrid';
import { Check, Progress, Seg, Tag, codeFill, codeFillClass, useKeys } from '../components/ui';
import { UPCARDS, type Rank } from '../engine/cards';
import { rowLabel, type RowKey } from '../engine/hand';
import { rankLabel } from '../engine/cards';
import { rulesKey, strategyKey } from '../engine/rules';
import { cellKey } from '../engine/strategy';
import { listQuizAttempts, recordCell, saveQuizAttempt } from '../state/progress';
import { useSettings } from '../state/settings';
import { useStrategy } from '../worker/client';
import { chartSections } from './StrategyChart';

type Scope = 'all' | 'hard' | 'soft' | 'pair';

const SIMPLE = ['H', 'S', 'D', 'P', 'R'] as const;
const STRICT = ['H', 'S', 'Dh', 'Ds', 'P', 'Rh', 'Rs', 'Rp'] as const;
const NAMES: Record<string, string> = { H: 'Hit', S: 'Stand', D: 'Double', Dh: 'Double / hit', Ds: 'Double / stand', P: 'Split', R: 'Surrender', Rh: 'Surr. / hit', Rs: 'Surr. / stand', Rp: 'Surr. / split' };

function fmtTime(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function GridQuiz() {
  const { rules, prefs } = useSettings();
  const { table, progress } = useStrategy(rules);
  const [scope, setScope] = useState<Scope>('hard');
  const [strict, setStrict] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [brush, setBrush] = useState<string>('H');
  const [checked, setChecked] = useState(false);
  const [cursor, setCursor] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [proof, setProof] = useState<string | null>(null);
  const [startAt, setStartAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [elapsed, setElapsed] = useState<number | null>(null);
  const painting = useRef(false);

  const sections = chartSections(prefs.hideRedundantRows).filter((s) => scope === 'all' || s.id === scope);
  const rows: RowKey[] = useMemo(() => sections.flatMap((s) => s.rows), [sections]);
  const keys = useMemo(() => rows.flatMap((r) => UPCARDS.map((u) => cellKey(r, u))), [rows]);
  const palette = strict ? STRICT : SIMPLE;

  const expected = (k: string): string => {
    const c = table?.cells[k];
    if (!c) return '';
    return strict ? c.code : c.code[0];
  };

  useEffect(() => {
    setAnswers({});
    setChecked(false);
    setStartAt(null);
    setElapsed(null);
    setProof(null);
    setCursor({ r: 0, c: 0 });
  }, [scope, strict, rules]);

  useEffect(() => {
    if (!startAt || checked) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [startAt, checked]);

  useEffect(() => {
    const up = () => (painting.current = false);
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, []);

  const fill = (k: string, v: string) => {
    if (checked) return;
    if (!startAt) setStartAt(Date.now());
    setAnswers((a) => ({ ...a, [k]: v }));
  };

  const filled = keys.filter((k) => answers[k]).length;
  const correct = keys.filter((k) => answers[k] === expected(k)).length;

  const check = () => {
    if (!table) return;
    setChecked(true);
    const ms = startAt ? Date.now() - startAt : 0;
    setElapsed(ms);
    const skey = strategyKey(rules);
    for (const k of keys) if (answers[k]) recordCell(skey, k, answers[k] === expected(k));
    saveQuizAttempt({ date: Date.now(), scope, strict, correct, total: keys.length, ms, rulesKey: rulesKey(rules) });
  };

  const reset = () => {
    setAnswers({});
    setChecked(false);
    setStartAt(null);
    setElapsed(null);
    setProof(null);
  };

  // Keyboard: arrows move, letters / digits fill and advance.
  useKeys(
    (k, e) => {
      if (!table) return;
      const nRows = rows.length;
      const move = (dr: number, dc: number) => {
        e.preventDefault();
        setCursor((c) => {
          let r = c.r + dr;
          let col = c.c + dc;
          if (col > 9) {
            col = 0;
            r++;
          }
          if (col < 0) {
            col = 9;
            r--;
          }
          return { r: Math.max(0, Math.min(nRows - 1, r)), c: col };
        });
      };
      if (k === 'arrowright') return move(0, 1);
      if (k === 'arrowleft') return move(0, -1);
      if (k === 'arrowdown') return move(1, 0);
      if (k === 'arrowup') return move(-1, 0);
      let code: string | null = null;
      if (!strict && (SIMPLE as readonly string[]).includes(k.toUpperCase())) code = k.toUpperCase();
      if (strict && /^[1-8]$/.test(k)) code = STRICT[Number(k) - 1];
      if (strict && k === 'h') code = 'H';
      if (strict && k === 's') code = 'S';
      if (strict && k === 'p') code = 'P';
      if (code) {
        e.preventDefault();
        const key = cellKey(rows[cursor.r], UPCARDS[cursor.c]);
        fill(key, code);
        setBrush(code);
        move(0, 1);
      }
      if (k === 'enter' && !checked && filled > 0) check();
    },
    [table, rows, cursor, strict, checked, filled, startAt],
  );

  const cursorKey = rows[cursor.r] ? cellKey(rows[cursor.r], UPCARDS[cursor.c]) : null;

  const render = (row: RowKey, up: Rank): CellView => {
    const k = cellKey(row, up);
    const a = answers[k];
    const exp = expected(k);
    if (!checked) {
      if (!a) return { className: 'blank', content: '' };
      return { className: `a-${a[0]} ${codeFillClass(a)}`, style: codeFill(a), content: a };
    }
    if (a === exp) return { className: `a-${exp[0]} right ${codeFillClass(exp)}`, style: codeFill(exp), content: exp };
    return {
      className: `a-${exp[0]} wrong ${codeFillClass(exp)}`,
      style: codeFill(exp),
      content: (
        <>
          {exp}
          {a && <span className="was">{a}</span>}
        </>
      ),
      title: `You: ${a ?? '(blank)'} · Correct: ${exp}`,
    };
  };

  const mistakes = checked ? keys.filter((k) => answers[k] !== expected(k)) : [];
  const history = listQuizAttempts().filter((h) => h.rulesKey === rulesKey(rules)).slice(-8).reverse();
  const best = history.filter((h) => h.scope === scope && h.strict === strict).reduce((m, h) => Math.max(m, h.correct / h.total), 0);
  const proofCell = proof && table ? table.cells[proof] : null;
  const time = elapsed ?? (startAt ? now - startAt : 0);

  if (!table) {
    return (
      <main className="page">
        <h1>Grid quiz</h1>
        <div className="panel">
          <Progress value={progress} label="Computing the answer key for these rules…" />
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Grid quiz</h1>
        </div>
        <div className="row">
          <Seg
            value={scope}
            onChange={setScope}
            label="Scope"
            options={[
              { value: 'hard', label: 'Hard' },
              { value: 'soft', label: 'Soft' },
              { value: 'pair', label: 'Pairs' },
              { value: 'all', label: 'Whole chart' },
            ]}
          />
          <Check checked={strict} onChange={setStrict}>
            Strict (fallback codes)
          </Check>
        </div>
      </div>
      <div className="side-layout" style={{ gridTemplateColumns: proofCell ? 'minmax(0, 1fr) 440px' : undefined }}>
        <div className="panel">
          <div className="stack" style={{ gap: 18 }} onPointerUp={() => (painting.current = false)}>
            {sections.map((s) => (
              <StrategyGrid
                key={s.id}
                caption={s.caption}
                rows={s.rows}
                cell={render}
                cursor={checked ? null : cursorKey}
                onCellDown={(row, up, e) => {
                  e.preventDefault();
                  const k = cellKey(row, up);
                  if (checked) {
                    setProof(k);
                    return;
                  }
                  painting.current = true;
                  fill(k, brush);
                  setCursor({ r: rows.indexOf(row), c: UPCARDS.indexOf(up) });
                }}
                onCellEnter={(row, up) => {
                  if (painting.current) fill(cellKey(row, up), brush);
                }}
              />
            ))}
          </div>
        </div>

        <div className="stack">
          {proofCell ? (
            <ProofDrawer key={proof!} table={table} cell={proofCell} onClose={() => setProof(null)} />
          ) : (
            <>
              <div className="panel stack">
                <div className="panel-title">
                  <h3>Brush</h3>
                  <span className="muted small num">{fmtTime(time)}</span>
                </div>
                <div className="row tight">
                  {palette.map((code, i) => (
                    <button key={code} className={`btn small act ${code[0]} ${codeFillClass(code)}`} style={{ ...codeFill(code), ...(brush === code ? { boxShadow: '0 0 0 3px var(--gold-2)' } : { opacity: 0.8 }) }} onClick={() => setBrush(code)}>
                      {code} <span className="kbd">{strict ? i + 1 : code}</span>
                    </button>
                  ))}
                </div>
                <div className="muted small">
                  {strict ? 'Strict mode: Dh = double, otherwise hit. Ds = double, otherwise stand. Rh/Rs/Rp = surrender, otherwise hit/stand/split. Keys 1–8.' : 'Keys H S D P R fill the highlighted cell and move right.'}
                </div>
                <Progress value={filled / keys.length} label={`${filled} of ${keys.length} cells filled`} />
                <div className="row">
                  <button className="btn primary" onClick={check} disabled={checked || filled === 0}>
                    Check answers <span className="kbd">Enter</span>
                  </button>
                  <button className="btn" onClick={reset}>
                    Reset
                  </button>
                </div>
              </div>
              {checked && (
                <div className="panel stack">
                  <h3>
                    Score: {correct}/{keys.length} ({Math.round((correct / keys.length) * 100)}%)
                  </h3>
                  <div className="muted small">
                    Time {fmtTime(time)}
                    {best > 0 && ` · best for this scope ${Math.round(best * 100)}%`}
                  </div>
                  {mistakes.length === 0 ? (
                    <div className="callout good">Perfect chart! Try strict mode or the whole chart next.</div>
                  ) : (
                    <>
                      <div className="muted small">Click a cell (or a row below) to see why the answer is what it is:</div>
                      <table className="data">
                        <tbody>
                          {mistakes.slice(0, 40).map((k) => {
                            const [row, up] = k.split('|');
                            return (
                              <tr key={k} className="clickable" onClick={() => setProof(k)}>
                                <td>
                                  {rowLabel(row)} vs {rankLabel(Number(up) as Rank)}
                                </td>
                                <td>
                                  <span className="bad" style={{ textDecoration: 'line-through' }}>
                                    {answers[k] ?? 'blank'}
                                  </span>
                                </td>
                                <td>
                                  <Tag a={expected(k)} /> {NAMES[expected(k)]}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}
              {history.length > 0 && (
                <div className="panel">
                  <h3>Recent attempts</h3>
                  <table className="data">
                    <tbody>
                      {history.map((h) => (
                        <tr key={h.date}>
                          <td className="muted small">{new Date(h.date).toLocaleDateString()}</td>
                          <td>
                            {h.scope}
                            {h.strict ? ' (strict)' : ''}
                          </td>
                          <td className="num">
                            {h.correct}/{h.total}
                          </td>
                          <td className="num muted">{fmtTime(h.ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </main>
  );
}

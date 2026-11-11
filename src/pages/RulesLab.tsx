import { useMemo, useState } from 'react';
import { RulesForm } from '../components/RulesDialog';
import { Progress, Tag, fmtMoney, fmtPct } from '../components/ui';
import { rankLabel, type Rank } from '../engine/cards';
import { rowLabel } from '../engine/hand';
import { PRESETS, describeRules } from '../engine/rules';
import { diffTables } from '../engine/strategy';
import { useSettings } from '../state/settings';
import { useStrategy } from '../worker/client';

export default function RulesLab() {
  const { rules, setRules } = useSettings();
  const { table, progress } = useStrategy(rules);
  const [bet, setBet] = useState(25);
  const [hands, setHands] = useState(80);
  const [cmp, setCmp] = useState(PRESETS[1].id);
  const cmpRules = PRESETS.find((p) => p.id === cmp)!.rules;
  const { table: cmpTable } = useStrategy(cmpRules);
  const diff = useMemo(() => (table && cmpTable ? diffTables(table, cmpTable) : []), [table, cmpTable]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Rules Lab</h1>
        </div>
      </div>
      <div className="grid-2">
        <div className="panel">
          <h3>Rules</h3>
          <RulesForm value={rules} onChange={setRules} />
        </div>
        <div className="stack">
          <div className="panel">
            <div className="muted small">House edge with perfect basic strategy</div>
            {table ? (
              <>
                <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>{fmtPct(table.houseEdge, 3)}</div>
              </>
            ) : (
              <Progress value={progress} label="Solving…" />
            )}
          </div>
          <div className="panel">
            <h3>What it costs you</h3>
            <div className="row">
              <label className="field">
                Average bet ($)
                <input type="number" min={1} value={bet} onChange={(e) => setBet(Math.max(1, Number(e.target.value)))} />
              </label>
              <label className="field">
                Hands per hour
                <input type="number" min={10} value={hands} onChange={(e) => setHands(Math.max(1, Number(e.target.value)))} />
              </label>
            </div>
            {table && (
              <p className="text-2" style={{ marginTop: 10 }}>
                Expected loss: <strong>{fmtMoney(table.houseEdge * bet * hands)}</strong> per hour. At 6:5 blackjack: an extra{' '}
                <strong>{fmtMoney(table.pPlayerBJWin * (rules.blackjackPays - 1.2) * bet * hands)}</strong>.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-title">
          <h3>Strategy changes compared with…</h3>
          <select value={cmp} onChange={(e) => setCmp(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <p className="muted small">
          {describeRules(cmpRules).join(' · ')}. {cmpTable ? `House edge ${fmtPct(cmpTable.houseEdge, 3)}.` : ''}
        </p>
        {!cmpTable || !table ? (
          <p className="muted">Solving…</p>
        ) : diff.length === 0 ? (
          <p className="good">No differences: both rule sets use the identical chart.</p>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Hand</th>
                <th>Dealer</th>
                <th>Your rules</th>
                <th>{PRESETS.find((p) => p.id === cmp)!.name}</th>
              </tr>
            </thead>
            <tbody>
              {diff.map((d) => {
                const [row, up] = d.key.split('|');
                return (
                  <tr key={d.key}>
                    <td>{rowLabel(row)}</td>
                    <td>{rankLabel(Number(up) as Rank)}</td>
                    <td>
                      <Tag a={d.from} />
                    </td>
                    <td>
                      <Tag a={d.to} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}

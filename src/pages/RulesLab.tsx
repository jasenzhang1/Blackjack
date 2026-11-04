import { useMemo, useState } from 'react';
import { RulesForm } from '../components/RulesDialog';
import { Progress, Tag, fmtMoney, fmtPct } from '../components/ui';
import { rankLabel, type Rank } from '../engine/cards';
import { rowLabel } from '../engine/hand';
import { PRESETS, describeRules, rulesKey } from '../engine/rules';
import { diffTables } from '../engine/strategy';
import { useSettings } from '../state/settings';
import { useEngine, useStrategy } from '../worker/client';

export default function RulesLab() {
  const { rules, setRules } = useSettings();
  const { table, progress } = useStrategy(rules);
  const { data: effects, progress: effProgress } = useEngine<'ruleEffects'>(`effects|${rulesKey(rules)}`, () => ({ type: 'ruleEffects', rules }));
  const [bet, setBet] = useState(25);
  const [hands, setHands] = useState(80);
  const [cmp, setCmp] = useState(PRESETS[1].id);
  const cmpRules = PRESETS.find((p) => p.id === cmp)!.rules;
  const { table: cmpTable } = useStrategy(cmpRules);
  const diff = useMemo(() => (table && cmpTable ? diffTables(table, cmpTable) : []), [table, cmpTable]);

  const groups = useMemo(() => {
    const m = new Map<string, NonNullable<typeof effects>>();
    for (const e of effects ?? []) {
      if (!m.has(e.group)) m.set(e.group, []);
      m.get(e.group)!.push(e);
    }
    return Array.from(m.entries());
  }, [effects]);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Rules lab</h1>
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
                <div className="text-2 small">
                  {table.houseEdge < 0 ? 'Player advantage! ' : ''}Composition-dependent play of the first two cards: {fmtPct(table.houseEdgeCD, 3)}. Player blackjack {fmtPct(table.pPlayerBJ, 2)} of
                  hands. Solved in {Math.round(table.ms)} ms.
                </div>
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
                Expected loss: <strong>{fmtMoney(table.houseEdge * bet * hands)}</strong> per hour with perfect basic strategy (you wager {fmtMoney(bet * hands)} an hour). If blackjacks paid 6:5
                instead of {rules.blackjackPays === 1.5 ? '3:2' : 'this payout'}, you would lose an extra <strong>{fmtMoney(table.pPlayerBJWin * (rules.blackjackPays - 1.2) * bet * hands)}</strong> per hour.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Value of every rule (exact)</h3>
        <p className="muted small">Each row re-solves the game with one rule changed and everything else as above. Positive Δ is worse for you. Click a row to adopt it.</p>
        {!effects ? (
          <Progress value={effProgress} label={`Solving ${Math.round(effProgress * 100)}% of the variants…`} />
        ) : (
          <div className="grid-3">
            {groups.map(([g, list]) => (
              <div key={g}>
                <h4 style={{ margin: '6px 0' }}>{g}</h4>
                <table className="data">
                  <tbody>
                    {list.map((e) => (
                      <tr key={e.id} className={`clickable ${e.current ? 'hl' : ''}`} onClick={() => setRules({ ...e.rules, penetration: rules.penetration })}>
                        <td>
                          {e.label}
                          {e.current && <span className="muted small"> (current)</span>}
                        </td>
                        <td className="num">{fmtPct(e.houseEdge, 2)}</td>
                        <td className={`num ${e.delta > 1e-6 ? 'bad' : e.delta < -1e-6 ? 'good' : 'muted'}`}>{e.current ? '—' : `${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta * 100).toFixed(3)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
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

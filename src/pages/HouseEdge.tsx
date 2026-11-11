import { useMemo } from 'react';
import { Progress, fmtPct } from '../components/ui';
import { rulesKey } from '../engine/rules';
import { useSettings } from '../state/settings';
import { useEngine, useStrategy } from '../worker/client';

export default function HouseEdge() {
  const { rules, setRules } = useSettings();
  const { table, progress } = useStrategy(rules);
  const { data: effects, progress: effProgress } = useEngine<'ruleEffects'>(`effects|${rulesKey(rules)}`, () => ({ type: 'ruleEffects', rules }));

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
          <h1>House Edge</h1>
        </div>
      </div>
      <div className="panel">
        <div className="muted small">Your rules, perfect basic strategy</div>
        {table ? (
          <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.1 }}>{fmtPct(table.houseEdge, 3)}</div>
        ) : (
          <Progress value={progress} label="Solving…" />
        )}
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <h3>Value of every rule (exact)</h3>
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
    </main>
  );
}

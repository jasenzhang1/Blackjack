import { fmtMoney, fmtPct } from '../components/ui';
import { rankText } from '../engine/cards';
import { DEVIATIONS } from '../engine/deviations';
import { ACTION_NAMES, type Action } from '../engine/ev';
import { describeHand } from '../engine/hand';
import { gradeColor, summarize, type SessionReport } from './report';

const playName = (d: string, kind: string) => (d === 'I' ? 'insure' : d === 'N' ? (kind === 'insurance' ? 'no insurance' : 'play on') : ACTION_NAMES[d as Action]);

export function ReportCard({ report }: { report: SessionReport }) {
  const s = summarize(report);
  const minutes = Math.max(1, Math.round((report.end - report.start) / 60000));
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="report-head">
        <div className="stack center" style={{ gap: 2, minWidth: 110 }}>
          <span className="muted small">Grade</span>
          <span className="grade" style={{ color: gradeColor(s.grade) }}>
            {s.grade}
          </span>
          {s.score !== null && <span className="muted small num">{(s.score * 100).toFixed(1)} / 100</span>}
        </div>
        <div className="kpis">
          <div className="kpi">
            <div className="k">Rounds</div>
            <div className="v num">{s.rounds}</div>
            <div className="s">{minutes} min</div>
          </div>
          <div className="kpi">
            <div className="k">Net result</div>
            <div className={`v num ${s.net >= 0 ? 'good' : 'bad'}`}>{fmtMoney(s.net)}</div>
            <div className="s">wagered {fmtMoney(s.wagered)}</div>
          </div>
          <div className="kpi">
            <div className="k">Expected</div>
            <div className="v num">{fmtMoney(s.expected)}</div>
            <div className="s">luck {s.luck >= 0 ? '+' : ''}{fmtMoney(s.luck)}</div>
          </div>
          <div className="kpi">
            <div className="k">Decisions</div>
            <div className="v num">{s.accuracy === null ? '—' : fmtPct(s.accuracy, 1)}</div>
            <div className="s">
              {s.correct}/{s.decisions} correct
            </div>
          </div>
          <div className="kpi">
            <div className="k">EV lost to mistakes</div>
            <div className={`v num ${s.evLostMoney > 0 ? 'bad' : ''}`}>{fmtMoney(-s.evLostMoney)}</div>
            <div className="s">{s.evLostUnits.toFixed(2)} bets</div>
          </div>
          {s.checks > 0 && (
            <div className="kpi">
              <div className="k">Count checks</div>
              <div className="v num">
                {s.rcExact}/{s.checks}
              </div>
              <div className="s">mean error {s.meanAbsError?.toFixed(1)}</div>
            </div>
          )}
          {report.deviationsOn && (
            <div className="kpi">
              <div className="k">Index plays</div>
              <div className="v num">{s.deviationOpportunities ? `${s.deviationCorrect}/${s.deviationOpportunities}` : '—'}</div>
              <div className="s">I18 + Fab 4 spots</div>
            </div>
          )}
          {s.betCorrelation !== null && (
            <div className="kpi">
              <div className="k">Bet vs count</div>
              <div className="v num">{s.betCorrelation.toFixed(2)}</div>
              <div className="s">correlation</div>
            </div>
          )}
        </div>
      </div>

      {s.comments.length > 0 && (
        <div className="callout info">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {s.comments.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid-2">
        <div className="panel">
          <h3>Accuracy by category</h3>
          {s.byCategory.length === 0 && <p className="muted">No decisions recorded.</p>}
          <div className="stack" style={{ gap: 10 }}>
            {s.byCategory.map((c) => (
              <div key={c.category}>
                <div className="row between small">
                  <span style={{ textTransform: 'capitalize' }}>{c.category}</span>
                  <span className="num muted">
                    {c.correct}/{c.total} · {fmtPct(c.correct / c.total, 0)}
                  </span>
                </div>
                <div className="meter">
                  <div style={{ width: `${(c.correct / c.total) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel">
          <h3>Costliest mistakes</h3>
          {s.mistakes.length === 0 ? (
            <p className="good">No mistakes. Flawless.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Hand</th>
                  <th>You</th>
                  <th>Right</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {s.mistakes.slice(0, 12).map((d) => (
                  <tr key={d.id}>
                    <td>
                      {d.kind === 'insurance' ? 'Insurance' : describeHand(d.cards)} vs {rankText(d.up)}
                      {d.deviation && <span className="chip gold" style={{ marginLeft: 6 }}>TC {d.tc.toFixed(1)}</span>}
                    </td>
                    <td className="bad">{playName(d.taken, d.kind)}</td>
                    <td>{playName(d.correct, d.kind)}</td>
                    <td className="num">{d.evLoss > 0 ? fmtMoney(-d.evLoss * d.bet) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {report.checks.length > 0 && (
        <div className="panel">
          <h3>Count checks</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Round</th>
                <th className="num">Your RC</th>
                <th className="num">Actual RC</th>
                <th className="num">Your TC</th>
                <th className="num">Actual TC</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((c, i) => (
                <tr key={i}>
                  <td>#{c.round}</td>
                  <td className="num">{c.rcAnswer}</td>
                  <td className="num">{c.rcActual}</td>
                  <td className="num">{c.tcAnswer ?? '—'}</td>
                  <td className="num">{c.tcActual !== undefined ? c.tcActual.toFixed(2) : '—'}</td>
                  <td className={c.rcOk && c.tcOk !== false ? 'good' : 'bad'}>{c.rcOk && c.tcOk !== false ? '✓' : '✗'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report.deviationsOn && s.deviationOpportunities > 0 && (
        <div className="panel">
          <h3>Index plays you faced</h3>
          <table className="data">
            <thead>
              <tr>
                <th>Play</th>
                <th className="num">TC</th>
                <th>You</th>
                <th>Right</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {report.decisions
                .filter((d) => d.deviationChecked)
                .map((d) => {
                  const dev = DEVIATIONS.find((x) => x.id === d.deviationChecked);
                  return (
                    <tr key={d.id}>
                      <td>
                        {describeHand(d.cards)} vs {rankText(d.up)} <span className="muted small">({dev?.group})</span>
                      </td>
                      <td className="num">{d.tc.toFixed(1)}</td>
                      <td>{playName(d.taken, d.kind)}</td>
                      <td>{playName(d.correct, d.kind)}</td>
                      <td className={d.ok ? 'good' : 'bad'}>{d.ok ? '✓' : '✗'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        {report.rulesChips.join(' · ')} · house edge {fmtPct(report.houseEdge, 2)}
      </p>
    </div>
  );
}

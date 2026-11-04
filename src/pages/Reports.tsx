import { useState } from 'react';
import { fmtMoney } from '../components/ui';
import { Link } from '../router';
import { deleteSession, listSessions } from '../state/progress';
import { ReportCard } from '../table/ReportCard';
import { gradeColor, summarize } from '../table/report';

export default function Reports() {
  const [sessions, setSessions] = useState(listSessions);
  const [open, setOpen] = useState<string | null>(sessions[0]?.id ?? null);
  const current = sessions.find((s) => s.id === open) ?? null;

  if (!sessions.length) {
    return (
      <main className="page">
        <h1>Report cards</h1>
        <div className="panel">
          <p className="text-2">No sessions yet. Play a session in the <Link to="/play">Casino</Link> or <Link to="/counting/play">Count & play</Link>. Each one is saved here with its grade.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Report cards</h1>
        </div>
      </div>
      <div className="side-layout" style={{ gridTemplateColumns: '340px minmax(0, 1fr)' }}>
        <div className="panel" style={{ padding: 8 }}>
          <table className="data">
            <tbody>
              {sessions.map((s) => {
                const sum = summarize(s);
                return (
                  <tr key={s.id} className={`clickable ${s.id === open ? 'hl' : ''}`} onClick={() => setOpen(s.id)}>
                    <td>
                      <strong style={{ color: gradeColor(sum.grade) }}>{sum.grade}</strong>
                    </td>
                    <td>
                      <div>{s.mode === 'casino' ? 'Casino' : 'Count & play'}</div>
                      <div className="muted small">{new Date(s.end).toLocaleString()}</div>
                    </td>
                    <td className="num">
                      <div>{sum.rounds} rds</div>
                      <div className={`small ${sum.net >= 0 ? 'good' : 'bad'}`}>{fmtMoney(sum.net)}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div>
          {current && (
            <div className="panel stack">
              <div className="row between">
                <h2 style={{ margin: 0 }}>
                  {current.mode === 'casino' ? 'Casino' : 'Count & play'} · {new Date(current.start).toLocaleString()}
                </h2>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    deleteSession(current.id);
                    const next = listSessions();
                    setSessions(next);
                    setOpen(next[0]?.id ?? null);
                  }}
                >
                  Delete
                </button>
              </div>
              <ReportCard report={current} />
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

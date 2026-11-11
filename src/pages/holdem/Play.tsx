import { useEffect, useMemo, useRef, useState } from 'react';
import { PlayingCard } from '../../components/PlayingCard';
import { fmtMoney, Modal, Seg } from '../../components/ui';
import { mulberry32, randomSeed } from '../../engine/rng';
import { groupCache, initialRange, pruneRange, sampleAction, updateRange, villainDist, type RangeCombo } from '../../holdem/bot';
import { cardsText, toPlaying } from '../../holdem/cards';
import { ACT_LABEL, ChartGrid, ChartLegend } from '../../holdem/charts-ui';
import { advise, heroOptions, preflopChart, type Advice, type HeroOption } from '../../holdem/coach';
import { describeScore, evaluate } from '../../holdem/evaluate';
import { actOf } from '../../holdem/preflop';
import { PROFILES, type Profile, type ProfileId } from '../../holdem/profiles';
import { recordSpot } from '../../holdem/progress';
import { classOf, combosOf } from '../../holdem/ranges';
import { COACH_LABEL, listReports, makeLineup, saveReport, seatPositions, summarize, deleteReport, type Bot, type CoachMode, type Decision, type PlayReport } from '../../holdem/session';
import { apply, legal, newHand, totalPot, type HandState, type LogEntry } from '../../holdem/table';
import { Avatar, fmtEVd, GroupBars, HCards, RangeGrid } from '../../holdem/ui';
import { Link } from '../../router';
import { useSettings } from '../../state/settings';

type LineupKind = 'mixed' | ProfileId;

export default function Play() {
  const [lineup, setLineup] = useState<LineupKind>('mixed');
  const [coach, setCoach] = useState<CoachMode>('warn');
  const [playing, setPlaying] = useState(false);
  const [report, setReport] = useState<PlayReport | null>(null);
  if (report) return <ReportView report={report} onClose={() => setReport(null)} />;
  if (playing) return <Game lineupKind={lineup} initialCoach={coach} onEnd={(r) => (setPlaying(false), setReport(r))} />;
  return (
    <main className="page holdem-page">
      <div className="page-head">
        <div>
          <div className="small">
            <Link to="/holdem">← Hold'em training rooms</Link>
          </div>
          <h1 style={{ margin: '4px 0' }}>Play table</h1>
          <p>
            Six-max no-limit hold'em, $1/$2 blinds, $200 stacks (100 big blinds) every hand. Five bots sit with you, each a different kind of player. Each hand one of them plays the pot with you and the rest
            fold, so every hand is a heads-up lesson. A coach tracks your opponent's range from their actions and grades every decision.
          </p>
        </div>
      </div>
      <div className="grid-2">
        <div className="panel stack">
          <h3 style={{ margin: 0 }}>New session</h3>
          <label className="field">
            Opponents
            <Seg
              label="Opponents"
              value={lineup}
              onChange={setLineup}
              options={[
                { value: 'mixed', label: 'Mixed table' },
                { value: 'nit', label: 'Nits' },
                { value: 'tag', label: 'TAGs' },
                { value: 'lag', label: 'LAGs' },
                { value: 'station', label: 'Stations' },
                { value: 'maniac', label: 'Maniacs' },
              ]}
            />
          </label>
          <label className="field">
            Coach
            <Seg label="Coach" value={coach} onChange={setCoach} options={(Object.keys(COACH_LABEL) as CoachMode[]).map((m) => ({ value: m, label: COACH_LABEL[m] }))} />
          </label>
          <p className="small text-2" style={{ margin: 0 }}>
            {coach === 'off' && 'No help during the hand. Every decision is still graded on your report card.'}
            {coach === 'ask' && 'Ask the coach whenever you want a second opinion.'}
            {coach === 'warn' && 'The coach stops you before a mistake and lets you take it back.'}
            {coach === 'always' && "The coach shows the best play, the opponent's range and the EV of every option."}
          </p>
          <div>
            <button className="btn primary big" onClick={() => setPlaying(true)}>
              Sit down
            </button>
          </div>
        </div>
        <PastSessions onOpen={setReport} />
      </div>
    </main>
  );
}

function PastSessions({ onOpen }: { onOpen: (r: PlayReport) => void }) {
  const [list, setList] = useState(listReports);
  return (
    <div className="panel">
      <h3>Report cards</h3>
      {list.length === 0 ? (
        <p className="muted small">Finish a session to get a report card.</p>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Hands</th>
              <th className="num">Result</th>
              <th className="num">Grade</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.slice(0, 12).map((r) => (
              <tr key={r.id} className="clickable" onClick={() => onOpen(r)}>
                <td>{new Date(r.end).toLocaleDateString()}</td>
                <td className="num">{r.hands}</td>
                <td className={`num ${r.net >= 0 ? 'good' : 'bad'}`}>{fmtEVd(r.net)}</td>
                <td className="num">{summarize(r).grade}</td>
                <td className="num">
                  <button
                    className="btn ghost small"
                    aria-label="Delete report"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteReport(r.id);
                      setList(listReports());
                    }}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

interface Live {
  hand: HandState;
  handNo: number;
  button: number;
  villainSeat: number;
  range: RangeCombo[];
}

function Game({ lineupKind, initialCoach, onEnd }: { lineupKind: LineupKind; initialCoach: CoachMode; onEnd: (r: PlayReport) => void }) {
  const { prefs } = useSettings();
  const rand = useMemo(() => mulberry32(randomSeed()), []);
  const groups = useMemo(() => groupCache(), []);
  const bots = useMemo<Bot[]>(() => makeLineup(lineupKind, rand), [lineupKind, rand]);
  const [coach, setCoach] = useState<CoachMode>(initialCoach);
  const started = useRef(Date.now());
  const id = useRef(`hp-${started.current.toString(36)}`);

  const deal = (button: number, handNo: number): Live => {
    const pos = seatPositions(button);
    const villainSeat = 1 + Math.floor(rand() * 5);
    const hand = newHand(rand, pos[0], pos[villainSeat]);
    return { hand, handNo, button, villainSeat, range: initialRange(hand.players.hero.hole) };
  };
  const [live, setLive] = useState<Live>(() => deal(Math.floor(rand() * 6), 1));
  const [net, setNet] = useState(0);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [advice, setAdvice] = useState<{ for: HandState; a: Advice } | null>(null);
  const [asked, setAsked] = useState(false);
  const [warn, setWarn] = useState<{ option: HeroOption; a: Advice } | null>(null);
  const [last, setLast] = useState<Decision | null>(null);

  const { hand, villainSeat } = live;
  const bot = bots[villainSeat - 1];
  const profile = PROFILES[bot.profile];
  const positions = seatPositions(live.button);
  const delay = prefs.reduceMotion ? 150 : 650;

  const commit = (prev: Live, next: HandState, range: RangeCombo[]): Live => ({ ...prev, hand: next, range: pruneRange(range, next.board) });

  // Add each finished hand's result to the session once.
  const counted = useRef(new Set<number>());
  useEffect(() => {
    if (hand.over && !counted.current.has(live.handNo)) {
      counted.current.add(live.handNo);
      setNet((n) => n + hand.heroNet);
    }
  }, [hand, live.handNo]);

  // The opponent acts.
  useEffect(() => {
    if (hand.over || hand.toAct !== 'villain') return;
    const t = setTimeout(() => {
      setLive((l) => {
        const s = l.hand;
        if (s.over || s.toAct !== 'villain') return l;
        const v = s.players.villain;
        const d = villainDist(s, profile, v.hole[0], v.hole[1], groups);
        const act = sampleAction(d, rand());
        const range = updateRange(l.range, s, profile, act, groups);
        const move = act === 'fold' ? ({ kind: 'fold' } as const) : act === 'passive' ? ({ kind: legal(s, 'villain').canCheck ? 'check' : 'call' } as const) : ({ kind: 'raise', to: d.raiseTo } as const);
        return commit(l, apply(s, move), range);
      });
    }, delay);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand]);

  // Work out the coach's view whenever it is your turn.
  useEffect(() => {
    setAsked(false);
    if (hand.over || hand.toAct !== 'hero') return;
    const t = setTimeout(() => setAdvice({ for: hand, a: advise(hand, profile, live.range, groups) }), 20);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hand]);

  const current = advice?.for === hand ? advice.a : null;

  const act = (option: HeroOption, confirmed = false) => {
    const a = current ?? advise(hand, profile, live.range, groups);
    const ok = a.ok.includes(option.id);
    if (coach === 'warn' && !ok && !confirmed) {
      setWarn({ option, a });
      return;
    }
    setWarn(null);
    const best = a.options.find((o) => o.id === a.bestId)!;
    const evOf = (id: string) => a.evals?.find((e) => e.option.id === id)?.ev ?? 0;
    const L = legal(hand, 'hero');
    const d: Decision = {
      hand: live.handNo,
      street: hand.street,
      preflop: hand.street === 'preflop',
      cards: cardsText(hand.players.hero.hole),
      board: cardsText(hand.board),
      spot: hand.street === 'preflop' ? preflopChart(hand, profile).spotText || 'Preflop' : `${hand.street[0].toUpperCase()}${hand.street.slice(1)}, pot ${fmtMoney(totalPot(hand))}, ${L.toCall ? `facing ${fmtMoney(L.toCall)}` : 'checked to you'}`,
      chose: option.label,
      best: best.label,
      ok,
      evLoss: hand.street === 'preflop' ? 0 : Math.max(0, evOf(a.bestId) - evOf(option.id)),
      opponent: `${bot.name} (${profile.name})`,
    };
    setDecisions((ds) => [...ds, d]);
    setLast(d);
    recordSpot('play', [ok]);
    setLive((l) => commit(l, apply(l.hand, option.move), l.range));
  };

  const nextHand = () => {
    setLast(null);
    setLive((l) => deal((l.button + 1) % 6, l.handNo + 1));
  };

  const end = () => {
    const handsDone = live.hand.over ? live.handNo : live.handNo - 1;
    const r: PlayReport = {
      id: id.current,
      start: started.current,
      end: Date.now(),
      hands: handsDone,
      net,
      coach,
      lineup: lineupKind === 'mixed' ? 'Mixed table' : `${PROFILES[lineupKind].name}s`,
      decisions,
    };
    if (r.hands > 0 || decisions.length) saveReport(r);
    onEnd(r);
  };

  const showAdvice = current && (coach === 'always' || (coach === 'ask' && asked));
  const handDecisions = decisions.filter((d) => d.hand === live.handNo);

  return (
    <main className="page holdem-page play-page">
      <div className="play-grid">
        <div className="play-main">
          <TableView live={live} bots={bots} positions={positions} profile={profile} />
          <div className="dock play-dock">
            {hand.over ? (
              <div className="stack" style={{ width: '100%', alignItems: 'center', gap: 8 }}>
                <Result hand={hand} name={bot.name} />
                <button className="btn primary big" onClick={nextHand} autoFocus>
                  Next hand
                </button>
              </div>
            ) : hand.toAct === 'hero' ? (
              <div className="row" style={{ justifyContent: 'center' }}>
                {(current?.options ?? heroOptions(hand)).map((o) => (
                  <button key={o.id} className={`btn big pact ${o.cls} ${coach === 'always' && current?.bestId === o.id ? 'coach-pick' : ''}`} onClick={() => act(o)}>
                    {o.label}
                  </button>
                ))}
              </div>
            ) : (
              <span className="status">{bot.name} is thinking…</span>
            )}
          </div>
          {hand.over && coach !== 'off' && handDecisions.length > 0 && <HandReview decisions={handDecisions} />}
        </div>

        <aside className="play-side">
          <div className="panel tight">
            <div className="row between">
              <h3 style={{ margin: 0 }}>Session</h3>
              <button className="btn small" onClick={end}>
                End session
              </button>
            </div>
            <div className="trainer-stats" style={{ marginTop: 8 }}>
              <div>
                <div className="k">Hands</div>
                <div className="v num">{live.handNo}</div>
              </div>
              <div>
                <div className="k">Result</div>
                <div className={`v num ${net >= 0 ? 'good' : 'bad'}`}>{fmtEVd(net)}</div>
              </div>
              <div>
                <div className="k">Graded</div>
                <div className="v num">
                  {decisions.filter((d) => d.ok).length}/{decisions.length}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              <Seg label="Coach" value={coach} onChange={setCoach} options={(Object.keys(COACH_LABEL) as CoachMode[]).map((m) => ({ value: m, label: COACH_LABEL[m] }))} />
            </div>
          </div>

          <div className="panel tight">
            <h3 style={{ margin: '0 0 6px' }}>
              <span className="row tight" style={{ flexWrap: 'nowrap' }}>
                <Avatar profile={profile} /> {bot.name} <span className="muted small">· {profile.name}</span>
              </span>
            </h3>
            <div className="hud-row small">
              <span>VPIP {profile.stats.vpip}</span>
              <span>PFR {profile.stats.pfr}</span>
              <span>3B {profile.stats.threeBet}</span>
              <span>AF {profile.stats.af}</span>
              <span>FCB {profile.stats.foldToCbet}</span>
              <span>WTSD {profile.stats.wtsd}</span>
            </div>
          </div>

          {!hand.over && hand.toAct === 'hero' && coach !== 'off' && (
            <div className="panel tight coach-panel">
              <h3 style={{ margin: '0 0 6px' }}>Coach</h3>
              {coach === 'ask' && !asked && (
                <button className="btn" onClick={() => setAsked(true)} disabled={!current}>
                  Ask the coach
                </button>
              )}
              {coach === 'warn' && !showAdvice && <p className="small muted" style={{ margin: 0 }}>Watching. The coach will stop you before a mistake.</p>}
              {showAdvice && <AdviceView a={current!} hand={hand} range={live.range} profile={profile} />}
              {!current && (coach === 'always' || asked) && <p className="small muted">Thinking…</p>}
            </div>
          )}

          {last && coach !== 'off' && (
            <div className={`feedback ${last.ok ? 'ok' : 'bad'}`} style={{ marginTop: 0 }}>
              <span className="icon">{last.ok ? '✓' : '✗'}</span>
              <div className="small">
                <div className="title">{last.ok ? 'Good decision' : 'Mistake'}</div>
                You chose {last.chose}. {last.ok ? '' : `Best: ${last.best}.`} {last.evLoss > 0.005 && !last.ok ? `Cost about ${fmtMoney(Math.round(last.evLoss * 100) / 100)}.` : ''}
              </div>
            </div>
          )}

          <ActionLog log={hand.log} name={bot.name} />
        </aside>
      </div>
      {warn && (
        <Modal title="Coach: are you sure?" onClose={() => setWarn(null)} narrow footer={
          <>
            <button className="btn" onClick={() => act(warn.option, true)}>
              {warn.option.label} anyway
            </button>
            <button className="btn primary" onClick={() => setWarn(null)} autoFocus>
              Take it back
            </button>
          </>
        }>
          <p>
            <strong>{warn.option.label}</strong> is a mistake here.{warn.a.street !== 'preflop' ? ` ${warn.a.text}` : ''}
          </p>
          <AdviceView a={warn.a} hand={hand} range={live.range} profile={profile} compact />
        </Modal>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------------------------

function TableView({ live, bots, positions, profile }: { live: Live; bots: Bot[]; positions: ReturnType<typeof seatPositions>; profile: Profile }) {
  const { hand, villainSeat } = live;
  const h = hand.players.hero;
  const v = hand.players.villain;
  const reveal = hand.over && hand.showdown;
  return (
    <div className="ring">
      <div className="ring-felt" />
      {positions.map((pos, i) => {
        const isHero = i === 0;
        const isVil = i === villainSeat;
        const b = isHero ? null : bots[i - 1];
        const p = isHero ? h : isVil ? v : null;
        const turn = !hand.over && ((isHero && hand.toAct === 'hero') || (isVil && hand.toAct === 'villain'));
        return (
          <div key={i} className={`rseat s${i} ${p ? 'in' : 'out'} ${turn ? 'turn' : ''} ${p?.folded ? 'folded' : ''}`}>
            {pos === 'BTN' && <span className="dealer-btn">D</span>}
            <div className="rcards">
              {isHero && <HCards cards={h.hole} size="sm" />}
              {isVil && !v.folded && (reveal ? <HCards cards={v.hole} size="sm" /> : (
                <div className="hand">
                  <PlayingCard faceDown card={toPlaying(0)} size="xs" />
                  <PlayingCard faceDown card={toPlaying(1)} size="xs" />
                </div>
              ))}
            </div>
            <div className="nameplate">
              {b ? <Avatar profile={PROFILES[b.profile]} /> : <span className="avatar" style={{ background: 'var(--gold)' }}>Y</span>}
              <span className="nm">{isHero ? 'You' : b!.name}</span>
              <span className="pos">{pos}</span>
            </div>
            <div className="rsub small">
              {!p ? 'Folds' : p.folded ? 'Folded' : fmtMoney(p.stack)}
              {p && !p.folded && isVil && <span className="ptype"> · {profile.name}</span>}
            </div>
            {p && p.street > 0 && <div className="rbet">{fmtMoney(p.street)}</div>}
          </div>
        );
      })}
      <div className="ring-center">
        <HCards cards={hand.board} slots={5} size="sm" />
        <div className="ppot">
          Pot <strong>{fmtMoney(hand.over ? hand.pot : totalPot(hand))}</strong>
        </div>
      </div>
    </div>
  );
}

function Result({ hand, name }: { hand: HandState; name: string }) {
  const net = hand.heroNet;
  const hs = hand.showdown ? describeScore(evaluate([...hand.players.hero.hole, ...hand.board])) : '';
  const vs = hand.showdown ? describeScore(evaluate([...hand.players.villain.hole, ...hand.board])) : '';
  const text = hand.showdown
    ? hand.winner === 'split'
      ? `Split pot: both ${hs.toLowerCase()}`
      : hand.winner === 'hero'
        ? `You win with ${hs.toLowerCase()} against ${vs.toLowerCase()}`
        : `${name} wins with ${vs.toLowerCase()} against your ${hs.toLowerCase()}`
    : hand.winner === 'hero'
      ? hand.players.villain.folded
        ? `${name} folds`
        : 'Everyone folds'
      : 'You fold';
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      <span className={`result ${net > 0 ? 'win' : net < 0 ? 'lose' : 'push'}`}>{net > 0 ? `+${fmtMoney(net)}` : net < 0 ? `−${fmtMoney(-net)}` : '$0'}</span>
      <span className="text-2">{text}</span>
    </div>
  );
}

function ActionLog({ log, name }: { log: LogEntry[]; name: string }) {
  const ref = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [log.length]);
  return (
    <div className="panel tight">
      <h3 style={{ margin: '0 0 6px' }}>This hand</h3>
      <ol className="alog" ref={ref}>
        {log.length === 0 && <li className="muted">Blinds posted.</li>}
        {log.map((e, i) => (
          <li key={i}>
            <span className="st">{e.street}</span> {e.seat === 'hero' ? 'You' : name}{' '}
            {e.kind === 'fold' ? 'fold' : e.kind === 'check' ? 'check' : e.kind === 'call' ? `call ${fmtMoney(e.add)}` : e.kind === 'bet' ? `bet ${fmtMoney(e.to)}` : `raise to ${fmtMoney(e.to)}`}
            {e.allIn ? ' (all-in)' : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Share of each grid cell's live combos still in the range. */
function rangeCells(range: readonly RangeCombo[], dead: readonly number[]): Map<string, number> {
  const sum = new Map<string, { w: number; cls: ReturnType<typeof classOf> }>();
  for (const c of range) {
    const cls = classOf(c.a, c.b);
    const e = sum.get(cls.label);
    if (e) e.w += c.w;
    else sum.set(cls.label, { w: c.w, cls });
  }
  const out = new Map<string, number>();
  for (const [l, { w, cls }] of sum) {
    const n = combosOf(cls, dead).length;
    out.set(l, n ? w / n : 0);
  }
  return out;
}

function AdviceView({ a, hand, range, profile, compact }: { a: Advice; hand: HandState; range: readonly RangeCombo[]; profile: Profile; compact?: boolean }) {
  const cells = useMemo(() => rangeCells(range, [...hand.players.hero.hole, ...hand.board]), [range, hand]);
  if (a.street === 'preflop') {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <p className="small" style={{ margin: 0 }}>
          {a.text}
        </p>
        {a.chart && (
          <>
            {!compact && <ChartGrid act={(l) => actOf(a.chart!, l)} highlight={a.hand} small />}
            <ChartLegend actions={a.chart.actions} raiseName={a.chart.raiseName} />
            <p className="small muted" style={{ margin: 0 }}>
              {a.chart.title}: {ACT_LABEL[a.chartAct!] === 'Raise' ? a.chart.raiseName : ACT_LABEL[a.chartAct!]} with {a.hand}.
            </p>
          </>
        )}
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small" style={{ margin: 0 }}>
        Your equity against {profile.name}'s range: <strong>{((a.equity ?? 0) * 100).toFixed(1)}%</strong>
      </p>
      <table className="data compact-table">
        <thead>
          <tr>
            <th>Option</th>
            <th className="num">Folds</th>
            <th className="num">EV</th>
          </tr>
        </thead>
        <tbody>
          {a.evals!.map((e) => (
            <tr key={e.option.id} className={e.option.id === a.bestId ? 'hl' : ''}>
              <td>{e.option.label}</td>
              <td className="num">{e.fold !== undefined ? `${Math.round(e.fold * 100)}%` : '—'}</td>
              <td className="num">{fmtEVd(e.ev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <GroupBars shares={a.shares} />
      {!compact && <RangeGrid weights={cells} caption={`${profile.name}'s range given every action so far (model).`} />}
      <p className="small muted" style={{ margin: 0 }}>
        EVs look one street ahead: the opponent's reply is modelled, then the hand is checked down. All-ins are exact.
      </p>
    </div>
  );
}

function HandReview({ decisions }: { decisions: Decision[] }) {
  return (
    <div className="panel tight">
      <h3 style={{ margin: '0 0 6px' }}>Hand review</h3>
      <ul className="review">
        {decisions.map((d, i) => (
          <li key={i} className={d.ok ? 'ok' : 'bad'}>
            <span className="mark">{d.ok ? '✓' : '✗'}</span>
            <span>
              <strong>{d.street}</strong> · {d.spot}. You: {d.chose}.{d.ok ? '' : ` Best: ${d.best}.`}
              {!d.ok && d.evLoss > 0.005 ? ` (−${fmtMoney(Math.round(d.evLoss * 100) / 100)})` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function ReportView({ report, onClose }: { report: PlayReport; onClose: () => void }) {
  const s = summarize(report);
  const mistakes = report.decisions.filter((d) => !d.ok).sort((a, b) => b.evLoss - a.evLoss);
  return (
    <main className="page holdem-page">
      <div className="page-head">
        <div>
          <div className="small">
            <Link to="/holdem">← Hold'em training rooms</Link>
          </div>
          <h1 style={{ margin: '4px 0' }}>Session report card</h1>
          <p>
            {new Date(report.end).toLocaleString()} · {report.lineup} · coach {COACH_LABEL[report.coach].toLowerCase()}
          </p>
        </div>
        <button className="btn primary" onClick={onClose}>
          New session
        </button>
      </div>
      <div className="panel report-head">
        <div className="grade">{s.grade}</div>
        <div className="kpis">
          <div className="kpi">
            <div className="k">Hands</div>
            <div className="v">{report.hands}</div>
          </div>
          <div className="kpi">
            <div className="k">Result</div>
            <div className={`v ${report.net >= 0 ? 'good' : 'bad'}`}>{fmtEVd(report.net)}</div>
            <div className="s">{s.bb100.toFixed(1)} bb/100</div>
          </div>
          <div className="kpi">
            <div className="k">Preflop</div>
            <div className="v">{s.pre.n ? `${Math.round((100 * s.pre.ok) / s.pre.n)}%` : '—'}</div>
            <div className="s">
              {s.pre.ok}/{s.pre.n} by the charts
            </div>
          </div>
          <div className="kpi">
            <div className="k">After the flop</div>
            <div className="v">{s.post.n ? `${Math.round((100 * s.post.ok) / s.post.n)}%` : '—'}</div>
            <div className="s">
              {s.post.ok}/{s.post.n} best or close
            </div>
          </div>
          <div className="kpi">
            <div className="k">EV given away</div>
            <div className="v">{fmtMoney(Math.round(s.evLost * 100) / 100)}</div>
            <div className="s">postflop mistakes, coach's estimate</div>
          </div>
        </div>
      </div>
      <p className="small muted">
        Results swing a lot over a few hands; the grade is about decisions, not money won. A strong player can lose a short session and a weak one can win it.
      </p>
      <div className="panel">
        <h3>Mistakes, biggest first</h3>
        {mistakes.length === 0 ? (
          <p className="muted">No mistakes. Nice session.</p>
        ) : (
          <div className="table-scroll">
            <table className="data">
              <thead>
                <tr>
                  <th>Hand</th>
                  <th>Cards</th>
                  <th>Spot</th>
                  <th>You</th>
                  <th>Best</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {mistakes.slice(0, 25).map((d, i) => (
                  <tr key={i}>
                    <td>#{d.hand}</td>
                    <td className="mono">
                      {d.cards}
                      {d.board && <span className="muted"> | {d.board}</span>}
                    </td>
                    <td>
                      {d.spot}
                      <div className="small muted">{d.opponent}</div>
                    </td>
                    <td>{d.chose}</td>
                    <td>{d.best}</td>
                    <td className="num">{d.preflop ? 'chart' : fmtMoney(Math.round(d.evLoss * 100) / 100)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

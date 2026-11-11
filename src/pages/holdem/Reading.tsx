import { useCallback, useRef, useState } from 'react';
import { Seg } from '../../components/ui';
import { pick, shuffle, type RNG } from '../../engine/rng';
import { cardsText } from '../../holdem/cards';
import { GROUP_LABEL, GROUPS, PROFILE_IDS, PROFILES, type HudStats, type ProfileId } from '../../holdem/profiles';
import { cellWeights, comboDrill, EXPLOITS, profileDrill, rangeDrill, textureText, type ComboDrill, type ExploitQuestion, type ProfileDrill, type RangeDrill } from '../../holdem/reading';
import { rangeShare } from '../../holdem/ranges';
import { Avatar, Dealing, GroupBars, HCards, NextButton, PokerTable, PROFILE_OPTIONS, RangeGrid, RoomShell, StepRunner, useRoomStats, useSpot, type Step } from '../../holdem/ui';

type Mode = 'mixed' | 'profile' | 'combos' | 'range' | 'exploit';
type Drill = { kind: 'profile'; d: ProfileDrill } | { kind: 'combos'; d: ComboDrill } | { kind: 'range'; d: RangeDrill } | { kind: 'exploit'; d: ExploitQuestion };

const STAT_ROWS: { key: keyof HudStats; label: string; unit: string; what: string }[] = [
  { key: 'vpip', label: 'VPIP', unit: '%', what: 'How many hands they play. Under 15 is tight, over 35 is loose.' },
  { key: 'pfr', label: 'PFR', unit: '%', what: 'How many they raise. A big gap between VPIP and PFR means a passive caller.' },
  { key: 'threeBet', label: '3-bet', unit: '%', what: 'How often they re-raise preflop. Over 9% is light.' },
  { key: 'af', label: 'AF', unit: '', what: 'Aggression factor: (bets + raises) ÷ calls after the flop. Under 1 is passive, over 3 is very aggressive.' },
  { key: 'foldToCbet', label: 'Fold to c-bet', unit: '%', what: 'How often they give up to a continuation bet. Over 55% means bluff them.' },
  { key: 'wtsd', label: 'WTSD', unit: '%', what: 'Went to showdown. Over 35% means they call down too much: value bet, don’t bluff.' },
];

export default function Reading() {
  const [mode, setMode] = useState<Mode>('mixed');
  const [profile, setProfile] = useState<ProfileId | 'random'>('random');
  const [stats, record] = useRoomStats('reading');
  // Cycle through the exploit questions in a shuffled order so they don't repeat back to back.
  const queue = useRef<ExploitQuestion[]>([]);
  const make = (rand: RNG): Drill => {
    const kind = mode === 'mixed' ? pick(rand, ['profile', 'combos', 'combos', 'range', 'range', 'exploit'] as const) : mode;
    if (kind === 'profile') return { kind, d: profileDrill(rand) };
    if (kind === 'combos') return { kind, d: comboDrill(rand) };
    if (kind === 'range') return { kind, d: rangeDrill(rand, profile) };
    if (!queue.current.length) queue.current = shuffle([...EXPLOITS], rand);
    return { kind, d: queue.current.pop()! };
  };
  const { spot, id, next } = useSpot(make, [mode, profile]);
  return (
    <RoomShell
      title="Reading opponents"
      lead="Put players on types from their stats, count the combos they can hold, read what their bets mean, and choose the adjustment that beats them."
      stats={stats}
      lesson={<Lesson />}
      settings={
        <>
          <Seg
            label="Drill"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'mixed', label: 'Mixed' },
              { value: 'profile', label: 'Player types' },
              { value: 'combos', label: 'Combo counting' },
              { value: 'range', label: 'Range reading' },
              { value: 'exploit', label: 'Exploits' },
            ]}
          />
          {(mode === 'range' || mode === 'mixed') && <Seg label="Opponent" value={profile} onChange={setProfile} options={PROFILE_OPTIONS} />}
        </>
      }
    >
      {spot ? <DrillView key={id} drill={spot} onDone={record} onNext={next} /> : <Dealing />}
    </RoomShell>
  );
}

function DrillView({ drill, onDone, onNext }: { drill: Drill; onDone: (r: boolean[]) => void; onNext: () => void }) {
  const [done, setDone] = useState(false);
  const finish = useCallback(
    (r: boolean[]) => {
      onDone(r);
      setDone(true);
    },
    [onDone],
  );
  let table: React.ReactNode;
  let steps: Step[];
  let explain: React.ReactNode = null;

  if (drill.kind === 'profile') {
    const d = drill.d;
    table = (
      <div className="panel hud">
        <h3>Unknown player · {d.hands.toLocaleString()} hands</h3>
        <table className="data">
          <tbody>
            {STAT_ROWS.map((r) => (
              <tr key={r.key}>
                <td>
                  <strong>{r.label}</strong>
                  {done && <div className="small muted">{r.what}</div>}
                </td>
                <td className="num hud-v">
                  {d.stats[r.key]}
                  {r.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    steps = [
      {
        key: 'type',
        prompt: <>What type of player is this?</>,
        input: { kind: 'choice', options: PROFILE_IDS.map((p) => ({ value: p, label: `${PROFILES[p].name} (${PROFILES[p].short.toLowerCase()})` })) },
        grade: (raw) => ({ ok: raw === d.answer, answer: PROFILES[d.answer].name, note: PROFILES[d.answer].blurb }),
      },
    ];
    explain = done && <ProfileTable highlight={d.answer} />;
  } else if (drill.kind === 'combos') {
    const d = drill.d;
    table = (
      <div className="panel combo-board">
        <div className="row" style={{ gap: 24, justifyContent: 'center' }}>
          <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
            <span className="small muted">Board</span>
            <HCards cards={d.board} />
          </div>
          <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
            <span className="small muted">Your hand</span>
            <HCards cards={d.hero} />
          </div>
        </div>
      </div>
    );
    steps = [
      {
        key: 'combos',
        prompt: (
          <>
            How many combos of <strong>{d.cls.label}</strong> can your opponent hold? ({d.cls.pair ? '6' : d.cls.suited ? '4' : '12'} before any cards are removed.)
          </>
        ),
        input: { kind: 'number', unit: 'combos' },
        grade: (raw) => ({ ok: Number(raw) === d.answer, answer: `${d.answer} combos`, note: d.working }),
      },
    ];
    explain = done && (
      <div className="panel explain">
        <h3>Why combos matter</h3>
        <p className="small text-2">
          Every card you can see removes combos from your opponent's range. That is why a set is rarer than it looks (3 combos once a card of that rank is on the board) and why top pair with a strong
          kicker is so common. Blockers in your own hand cut combos too: holding an ace removes a quarter of their AK, and an ace on the board removes another.
        </p>
        <p className="small muted">
          Seen: {cardsText(d.board)} on the board, {cardsText(d.hero)} in your hand.
        </p>
      </div>
    );
  } else if (drill.kind === 'range') {
    const d = drill.d;
    table = (
      <>
        <PokerTable board={d.board} profile={d.profile} pot={0} action="Raised preflop · bets the flop" />
        <p className="small muted spot-caption">
          {d.profile.name}: {d.profile.blurb} Board: {textureText(d.board)}.
        </p>
      </>
    );
    steps = [
      {
        key: 'group',
        prompt: <>{d.profile.name} raised preflop and now bets this flop. What makes up the biggest part of their betting range?</>,
        input: { kind: 'choice', options: GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g] })) },
        grade: (raw) => ({ ok: raw === d.answer, answer: GROUP_LABEL[d.answer], note: `${Math.round(d.shares[d.answer] * 100)}% of the combos they bet.` }),
      },
    ];
    explain = done && (
      <div className="panel explain">
        <h3>{d.profile.name}'s flop betting range</h3>
        <div className="grid-2">
          <div>
            <GroupBars shares={d.shares} highlight={d.answer} />
            <p className="small text-2" style={{ marginTop: 10 }}>
              Raising range: top {Math.round(rangeShare(d.preflop) * 100)}% of hands (PFR {d.profile.stats.pfr}%). On the flop they bet{' '}
              {GROUPS.map((g) => `${Math.round(d.profile.betProb[g] * 100)}% of ${GROUP_LABEL[g].toLowerCase()}`).join(', ')}.
            </p>
            <p className="small text-2">
              Most flops miss most hands: an unpaired hand flops a pair about a third of the time. Tight players' bets lean on made hands, while aggressive players' bets are full of air and draws.
            </p>
          </div>
          <RangeGrid weights={cellWeights(d.range, d.board)} caption="Shading: share of each hand's live combos that bet this flop." />
        </div>
      </div>
    );
  } else {
    const d = drill.d;
    const p = PROFILES[d.profile];
    table = (
      <div className="panel exploit-card">
        <div className="nameplate exploit-np">
          <Avatar profile={p} /> {p.name} <span className="muted">· VPIP {p.stats.vpip} / PFR {p.stats.pfr} / AF {p.stats.af}</span>
        </div>
        <p style={{ marginTop: 12, fontSize: '1.05rem' }}>{d.situation}</p>
      </div>
    );
    steps = [
      {
        key: 'exploit',
        prompt: <>What is the best adjustment?</>,
        input: { kind: 'choice', options: d.options.map((o, i) => ({ value: String(i), label: o })) },
        grade: (raw) => ({ ok: Number(raw) === d.answer, answer: d.options[d.answer], note: d.why }),
      },
    ];
    explain = done && (
      <div className="panel explain">
        <h3>How to beat a {p.name.toLowerCase()}</h3>
        <ul className="small text-2">
          {p.exploits.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="spot-layout">
      <div className="spot-table">
        {table}
        {explain}
      </div>
      <div className="spot-side panel">
        <StepRunner steps={steps} onDone={finish} />
        {done && <NextButton onNext={onNext} />}
      </div>
    </div>
  );
}

function ProfileTable({ highlight }: { highlight?: ProfileId }) {
  return (
    <div className="panel explain">
      <h3>The five player types</h3>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Type</th>
              {STAT_ROWS.map((r) => (
                <th key={r.key} className="num">
                  {r.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PROFILE_IDS.map((id) => {
              const p = PROFILES[id];
              return (
                <tr key={id} className={id === highlight ? 'hl' : ''}>
                  <td>
                    <span className="row tight" style={{ flexWrap: 'nowrap' }}>
                      <Avatar profile={p} /> {p.name}
                    </span>
                  </td>
                  {STAT_ROWS.map((r) => (
                    <td key={r.key} className="num">
                      {p.stats[r.key]}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        Typical values. Real stats vary, and need a few hundred hands before they mean much (VPIP and PFR settle fastest; WTSD and fold to c-bet need thousands).
      </p>
    </div>
  );
}

function Lesson() {
  return (
    <>
      <p>
        Good players do not put opponents on <em>a hand</em>. They put them on a <strong>range</strong>: every hand they could hold, weighted by how likely they are to play it this way. Reading opponents
        is the work of narrowing that range with what you know.
      </p>
      <h4>1 · Player types from HUD stats</h4>
      <p>
        Two numbers do most of the work. <strong>VPIP</strong> says how loose a player is; the gap to <strong>PFR</strong> says how passive. A 48/7 player calls everything and raises almost nothing (a
        calling station). A 22/18 player is a solid regular. Postflop, <strong>AF</strong> (aggression), <strong>fold to c-bet</strong> and <strong>WTSD</strong> (went to showdown) tell you whether to bluff
        them or value bet them.
      </p>
      <ProfileTable />
      <h4>2 · Combos</h4>
      <p>
        Each pair has 6 combos, each suited hand 4 and each offsuit hand 12. Cards you can see remove combos: with an ace on the board, AK has 3 × 4 = 12 combos instead of 16, and a set of a board rank has
        just 3. Combo counting shows that hands like sets are much rarer than they feel.
      </p>
      <h4>3 · Ranges through the streets</h4>
      <p>
        Start from the preflop range (a 9% raiser has far fewer hands than a 26% raiser), then ask which of those hands take each action. Passive players bet mostly when strong, so their bets are worth
        respecting; aggressive players bet with draws and air too. Board texture matters: most flops miss most hands.
      </p>
      <h4>4 · Exploits</h4>
      <ul>
        <li>
          <strong>Nits:</strong> steal and c-bet; fold to their aggression.
        </li>
        <li>
          <strong>Calling stations:</strong> value bet thin, never bluff, believe their raises.
        </li>
        <li>
          <strong>Maniacs:</strong> call down lighter and let them bluff.
        </li>
        <li>
          <strong>LAGs:</strong> widen your continuing ranges; trap with strong hands.
        </li>
      </ul>
    </>
  );
}

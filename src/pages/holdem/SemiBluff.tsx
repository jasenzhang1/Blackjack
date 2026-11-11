import { useCallback, useState } from 'react';
import { fmtMoney, Seg } from '../../components/ui';
import { TeX } from '../../components/TeX';
import type { ProfileId } from '../../holdem/profiles';
import { semiBreakEven, semiSpot, type SemiSpot, type Street } from '../../holdem/scenarios';
import { Dealing, fmtEVd, NextButton, parsePercent, pct, PokerTable, PROFILE_OPTIONS, RoomShell, SpotLayout, StepRunner, useRoomStats, useSpot, type Step } from '../../holdem/ui';

export default function SemiBluff() {
  const [profile, setProfile] = useState<ProfileId | 'random'>('random');
  const [street, setStreet] = useState<Street | 'mixed'>('mixed');
  const [stats, record] = useRoomStats('semibluff');
  const { spot, id, next } = useSpot((r) => semiSpot(r, { profile, street }), [profile, street]);
  return (
    <RoomShell
      title="Semi-bluff room"
      lead="Your draw is checked to you. Bet and you can win two ways: they fold now, or you hit later. Weigh fold equity against the equity you keep when called, and pick the play that makes the most."
      stats={stats}
      lesson={<Lesson />}
      settings={
        <>
          <Seg label="Street" value={street} onChange={setStreet} options={[{ value: 'mixed', label: 'Mixed' }, { value: 'flop', label: 'Flop' }, { value: 'turn', label: 'Turn' }]} />
          <Seg label="Opponent" value={profile} onChange={setProfile} options={PROFILE_OPTIONS} />
        </>
      }
    >
      {spot ? <SpotView key={id} spot={spot} onDone={record} onNext={next} /> : <Dealing />}
    </RoomShell>
  );
}

function SpotView({ spot, onDone, onNext }: { spot: SemiSpot; onDone: (r: boolean[]) => void; onNext: () => void }) {
  const [done, setDone] = useState(false);
  const finish = useCallback(
    (r: boolean[]) => {
      onDone(r);
      setDone(true);
    },
    [onDone],
  );
  const { pot, profile, options } = spot;
  const q = options.find((o) => o.id === spot.quiz)!;
  const pure = q.bet / (pot + q.bet);
  const best = options.reduce((a, b) => (b.ev > a.ev ? b : a));
  const tol = Math.max(0.5, 0.02 * pot);
  const steps: Step[] = [
    {
      key: 'be',
      prompt: (
        <>
          First, a pure bluff: if you bet <strong>{fmtMoney(q.bet)}</strong> into <strong>{fmtMoney(pot)}</strong> with no chance of winning when called, how often must {profile.name} fold?
        </>
      ),
      input: { kind: 'number', unit: '%' },
      grade: (raw) => {
        const v = parsePercent(raw);
        return {
          ok: v !== null && Math.abs(v - pure) <= 0.02,
          answer: pct(pure),
          note: (
            <>
              Risk {fmtMoney(q.bet)} to win {fmtMoney(pot)}: {q.bet} ÷ ({pot} + {q.bet}) = {pct(pure)}. A draw needs fewer folds, because when called it can still win.
            </>
          ),
        };
      },
    },
    {
      key: 'play',
      prompt: (
        <>
          You hold a <strong>{spot.draw.label.toLowerCase()}</strong> and {profile.name} checks. What is the best play?
        </>
      ),
      input: { kind: 'choice', options: options.map((o) => ({ value: o.id, label: o.label })) },
      grade: (raw) => {
        const chosen = options.find((o) => o.id === raw)!;
        return {
          ok: chosen.ev >= best.ev - tol,
          answer: best.label,
          note: (
            <>
              {options.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ' · '}
                  {o.id === 'check' ? 'Check' : o.id === 'half' ? 'Half pot' : 'Pot'} {fmtEVd(o.ev)}
                </span>
              ))}
            </>
          ),
        };
      },
    },
  ];
  return (
    <SpotLayout
      table={
        <>
          <PokerTable board={spot.board} hero={spot.hero} heroNote={spot.draw.label} profile={profile} pot={pot} action="Checks" />
          <p className="small muted spot-caption">
            {spot.street === 'turn' ? 'Turn: one card to come.' : 'Flop: assume the turn and river are checked down after this street.'} {profile.name} called preflop and checks to you. They fold{' '}
            {profile.stats.foldToCbet}% to a typical continuation bet.
          </p>
          {done && <Explanation spot={spot} />}
        </>
      }
      side={
        <>
          <StepRunner steps={steps} onDone={finish} />
          {done && <NextButton onNext={onNext} />}
        </>
      }
    />
  );
}

function Explanation({ spot }: { spot: SemiSpot }) {
  const { pot, options, eqAll } = spot;
  const best = options.reduce((a, b) => (b.ev > a.ev ? b : a));
  const potBet = options.find((o) => o.id === 'pot')!;
  return (
    <div className="panel explain">
      <h3>The math</h3>
      <div className="table-scroll">
        <table className="data">
          <thead>
            <tr>
              <th>Play</th>
              <th className="num">They fold</th>
              <th className="num">Equity when called</th>
              <th className="num">Folds needed</th>
              <th className="num">EV</th>
            </tr>
          </thead>
          <tbody>
            {options.map((o) => (
              <tr key={o.id} className={o === best ? 'hl' : ''}>
                <td>{o.label}</td>
                <td className="num">{o.id === 'check' ? '—' : pct(o.fold, 0)}</td>
                <td className="num">{pct(o.eqCalled)}</td>
                <td className="num">{o.id === 'check' ? '—' : semiBreakEven(pot, o.bet, o.eqCalled) === 0 ? 'none' : pct(semiBreakEven(pot, o.bet, o.eqCalled))}</td>
                <td className="num">
                  <strong>{fmtEVd(o.ev)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div>
          <h4>Checking</h4>
          <TeX block>{`EV = q \\cdot P = ${eqAll.toFixed(3)} \\times ${pot} = \\$${(eqAll * pot).toFixed(2)}`}</TeX>
          <p className="small text-2">You see the next card for free and win your share of the pot at showdown.</p>
        </div>
        <div>
          <h4>Betting {fmtMoney(potBet.bet)} (pot)</h4>
          <TeX block>{`EV = F\\,P + (1-F)\\,[\\,q_c(P+2B) - B\\,]`}</TeX>
          <TeX block>{`= ${potBet.fold.toFixed(2)}\\cdot${pot} + ${(1 - potBet.fold).toFixed(2)}\\,[\\,${potBet.eqCalled.toFixed(3)}\\cdot${pot + 2 * potBet.bet} - ${potBet.bet}\\,] = ${potBet.ev >= 0 ? '' : '-'}\\$${Math.abs(potBet.ev).toFixed(2)}`}</TeX>
        </div>
      </div>
      <p className="small text-2">
        Your equity against everything {spot.profile.name} checks is {pct(eqAll)}, but only the stronger part of the range calls. Against the hands that call a pot-size bet you have {pct(potBet.eqCalled)}.
        The "folds needed" column is the break-even fold equity for each bet once your equity when called is counted; "none" means the bet makes money even if they always call.
      </p>
      <p className="small muted">
        Model: {spot.profile.name} plays the top {spot.profile.stats.vpip}% preflop and checks it all. Against a bet of <TeX>f</TeX> × pot they fold {spot.profile.stats.foldToCbet}% + 30% × (<TeX>f</TeX> − ⅔),
        keeping their strongest made hands and draws. Equities are exact over every runout.
      </p>
    </div>
  );
}

function Lesson() {
  return (
    <>
      <p>
        A <strong>semi-bluff</strong> is a bet with a hand that is probably behind now but can improve. It wins in two ways: the opponent folds (<strong>fold equity</strong>, <TeX>F</TeX>), or they call and
        you win at showdown with your <strong>equity when called</strong>, <TeX>{'q_c'}</TeX>:
      </p>
      <TeX block>{'EV(\\text{bet}) = F \\cdot P \\;+\\; (1 - F)\\,\\big[\\,q_c\\,(P + 2B) - B\\,\\big]'}</TeX>
      <p>
        A <strong>pure bluff</strong> (<TeX>{'q_c = 0'}</TeX>) breaks even when they fold <TeX>{'B/(P+B)'}</TeX> of the time: 33% for a half-pot bet, 50% for a pot-size bet. A draw needs less:
      </p>
      <TeX block>{'F^* = \\frac{B - q_c(P+2B)}{P + B - q_c(P+2B)}'}</TeX>
      <p>
        If <TeX>{'q_c(P+2B) \\ge B'}</TeX>, the bet makes money even when they never fold. Compare the bet with <strong>checking</strong>, which takes a free card and is worth <TeX>{'q \\cdot P'}</TeX>.
      </p>
      <h4>What to watch</h4>
      <ul>
        <li>
          <strong>Who you are against.</strong> Semi-bluff players who fold (nits, regulars). Against calling stations there is little fold equity, so take the free card or bet small.
        </li>
        <li>
          <strong>Your equity when called is lower</strong> than your equity against the whole range, because the hands that call are the stronger ones.
        </li>
        <li>
          <strong>Bigger draws can bet bigger.</strong> A 15-out combo draw is often a favourite even against a calling range.
        </li>
        <li>
          <strong>Sizing.</strong> A bigger bet wins more folds and a bigger pot when you hit, but loses more when called and you miss.
        </li>
      </ul>
    </>
  );
}

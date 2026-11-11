import { useCallback, useState } from 'react';
import { fmtMoney, Seg } from '../../components/ui';
import { TeX } from '../../components/TeX';
import { cardsText } from '../../holdem/cards';
import { VISIBILITY_LABEL, type ProfileId } from '../../holdem/profiles';
import { impliedSpot, type ImpliedSpot } from '../../holdem/scenarios';
import { Dealing, fmtEVd, NextButton, parseAmount, parsePercent, pct, PokerTable, PROFILE_OPTIONS, RoomShell, SpotLayout, StepRunner, useRoomStats, useSpot, type Step } from '../../holdem/ui';

export default function ImpliedOdds() {
  const [profile, setProfile] = useState<ProfileId | 'random'>('random');
  const [stats, record] = useRoomStats('implied');
  const { spot, id, next } = useSpot((r) => impliedSpot(r, { profile }), [profile]);
  return (
    <RoomShell
      title="Implied odds room"
      lead="The price is often too high on its own. Work out how much you must win later when you hit, then judge whether this opponent, this stack and this draw can pay it."
      stats={stats}
      lesson={<Lesson />}
      settings={<Seg label="Opponent" value={profile} onChange={setProfile} options={PROFILE_OPTIONS} />}
    >
      {spot ? <SpotView key={id} spot={spot} onDone={record} onNext={next} /> : <Dealing />}
    </RoomShell>
  );
}

function SpotView({ spot, onDone, onNext }: { spot: ImpliedSpot; onDone: (r: boolean[]) => void; onNext: () => void }) {
  const [done, setDone] = useState(false);
  const finish = useCallback(
    (r: boolean[]) => {
      onDone(r);
      setDone(true);
    },
    [onDone],
  );
  const { pot, bet, hitProb, neededW, stack, riverBet, profile } = spot;
  const outs = spot.draw.outs.length;
  const call = spot.evImplied >= 0;
  const close = Math.abs(spot.evImplied) < 1;
  const steps: Step[] = [
    {
      key: 'hit',
      prompt: (
        <>
          You have a <strong>{spot.draw.label.toLowerCase()}</strong> on the turn. How likely is the river to complete it?
        </>
      ),
      input: { kind: 'number', unit: '%' },
      grade: (raw) => {
        const v = parsePercent(raw);
        return {
          ok: v !== null && Math.abs(v - hitProb) <= 0.015,
          answer: `${outs} ÷ 46 = ${pct(hitProb)}`,
          note: <>Outs: {cardsText(spot.draw.outs)}</>,
        };
      },
    },
    {
      key: 'needed',
      prompt: (
        <>
          {profile.name} bets <strong>{fmtMoney(bet)}</strong> into <strong>{fmtMoney(pot)}</strong>. Counting only the times you hit, how much more must you win on the river to break even?
        </>
      ),
      input: { kind: 'number', unit: '$' },
      grade: (raw) => {
        const v = parseAmount(raw);
        const target = Math.max(0, neededW);
        return {
          ok: v !== null && Math.abs(v - target) <= Math.max(5, 0.12 * target),
          answer: neededW <= 0 ? '$0: the direct price already pays' : fmtMoney(Math.round(neededW)),
          note: (
            <>
              {fmtMoney(bet)} ÷ {pct(hitProb)} − {fmtMoney(pot + 2 * bet)} = {fmtMoney(Math.round(neededW))}. You have {fmtMoney(stack)} behind, so the most you could win is {fmtMoney(stack)}.
            </>
          ),
        };
      },
    },
    {
      key: 'decision',
      prompt: (
        <>
          When you hit you will bet {fmtMoney(riverBet)}. {profile.name} calls that {Math.round(profile.payoff.obvious * 100)}% of the time when the draw is obvious, {Math.round(profile.payoff.medium * 100)}% when it is readable and{' '}
          {Math.round(profile.payoff.hidden * 100)}% when it is disguised. Call or fold?
        </>
      ),
      input: {
        kind: 'choice',
        options: [
          { value: 'call', label: `Call ${fmtMoney(bet)}` },
          { value: 'fold', label: 'Fold' },
        ],
      },
      grade: (raw) => ({
        ok: close || (raw === 'call') === call,
        answer: close ? 'Either: within $1 of break-even' : call ? 'Call' : 'Fold',
        note: (
          <>
            Direct EV {fmtEVd(spot.evDirect)}, plus {fmtEVd(spot.extraWin)} expected from river payoffs, minus {fmtMoney(Math.round(spot.reverseLoss * 100) / 100)} lost when you hit and are still beaten ={' '}
            <strong>{fmtEVd(spot.evImplied)}</strong>.
          </>
        ),
      }),
    },
  ];
  return (
    <SpotLayout
      table={
        <>
          <PokerTable board={spot.board} hero={spot.hero} heroNote={spot.draw.label} profile={profile} pot={pot} bet={bet} stack={stack} action="Bets the turn" />
          <p className="small muted spot-caption">
            Turn, one card to come. {profile.name}: {profile.blurb} If you miss, the river is checked down, and you still win when he was bluffing with worse.
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

function Explanation({ spot }: { spot: ImpliedSpot }) {
  const { pot, bet, hitProb, neededW, stack, riverBet } = spot;
  const required = bet / (pot + 2 * bet);
  return (
    <div className="panel explain">
      <h3>The math</h3>
      <div className="grid-2">
        <div>
          <h4>1 · Direct odds fall short?</h4>
          <p className="small text-2">
            You need {pct(required)} to call on price alone. Your exact equity against the betting range is {pct(spot.equity)}, so calling on the direct price is worth {fmtEVd(spot.evDirect)}.
          </p>
          <h4>2 · Break-even implied winnings</h4>
          <TeX block>{`W^* = \\frac{B}{h} - (P + 2B) = \\frac{${bet}}{${hitProb.toFixed(3)}} - ${pot + 2 * bet} = ${neededW >= 0 ? '' : '-'}\\$${Math.abs(Math.round(neededW))}`}</TeX>
          <p className="small text-2">
            {neededW > stack ? (
              <>That is more than the {fmtMoney(stack)} left in the stacks: even a guaranteed payoff cannot cover the call. </>
            ) : neededW <= 0 ? (
              <>The price is already good enough without any future winnings. </>
            ) : (
              <>You must win {fmtMoney(Math.round(neededW))} on average every time you hit, out of {fmtMoney(stack)} behind. </>
            )}
            This shortcut assumes you win exactly when you hit; the table below does it card by card.
          </p>
        </div>
        <div>
          <h4>3 · What the river is worth</h4>
          <table className="data">
            <thead>
              <tr>
                <th>When you hit with</th>
                <th className="num">Cards</th>
                <th className="num">You win</th>
                <th className="num">He pays</th>
              </tr>
            </thead>
            <tbody>
              {spot.groups.map((g) => (
                <tr key={g.label}>
                  <td>
                    {g.label}
                    <div className="small muted">{VISIBILITY_LABEL[g.vis]}</div>
                  </td>
                  <td className="num">{g.cards.length}</td>
                  <td className="num">{pct(g.winWhenHit, 0)}</td>
                  <td className="num">{pct(g.pay, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <table className="data" style={{ marginTop: 10 }}>
            <tbody>
              <tr>
                <td>Direct EV (call now, check down)</td>
                <td className="num">{fmtEVd(spot.evDirect)}</td>
              </tr>
              <tr>
                <td>+ implied: he pays your {fmtMoney(riverBet)} river bet</td>
                <td className="num">{fmtEVd(spot.extraWin)}</td>
              </tr>
              <tr>
                <td>− reverse implied: you hit, bet, and lose</td>
                <td className="num">{fmtEVd(-spot.reverseLoss)}</td>
              </tr>
              <tr className="total">
                <td>EV of calling</td>
                <td className="num">{fmtEVd(spot.evImplied)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
      <p className="small muted">
        Model: {spot.profile.name} plays the top {spot.profile.stats.vpip}% of hands and bets this turn with a range weighted by hand strength (value hands pay off, bluffs and draws do not). Every river and
        every hand in the range is enumerated.
      </p>
    </div>
  );
}

function Lesson() {
  return (
    <>
      <p>
        <strong>Implied odds</strong> count the money you expect to win <em>after</em> you hit. If you call <TeX>B</TeX> into a pot of <TeX>P</TeX> and complete your draw with probability <TeX>h</TeX>, you
        break even when the extra amount <TeX>W</TeX> you win on later streets satisfies
      </p>
      <TeX block>{'h\\,(P + 2B + W) = B \\quad\\Longrightarrow\\quad W^* = \\frac{B}{h} - (P + 2B)'}</TeX>
      <p>
        Example: $20 into $40 with a gutshot (<TeX>{'h = 4/46 \\approx 8.7\\%'}</TeX>). You need <TeX>{'20 / 0.087 - 80 \\approx \\$150'}</TeX> more on average when you hit. If the stacks are only $100,
        no opponent can pay that, and the call is a mistake however good they are at paying off.
      </p>
      <h4>What makes implied odds good</h4>
      <ul>
        <li>
          <strong>Deep stacks.</strong> <TeX>W</TeX> can never be more than what is left behind.
        </li>
        <li>
          <strong>Opponents who pay.</strong> Calling stations call river bets with one pair; nits fold unless they are strong.
        </li>
        <li>
          <strong>Disguised draws.</strong> A gutshot that fills looks like nothing. A third flush card on the board warns everyone.
        </li>
        <li>
          <strong>Drawing to the nuts.</strong> Hitting a hand that can still lose costs you a big pot instead of winning one.
        </li>
      </ul>
      <h4>Reverse implied odds</h4>
      <p>
        When your draw comes in but loses (a smaller flush, a straight on a paired board against a full house), you usually pay off a big bet. Those spots subtract from the call, and the room counts them
        card by card.
      </p>
      <p className="callout">A common rule for set mining preflop: call a raise only if the effective stacks are about 15–20 times the call. You flop a set about 1 time in 8.5, and you will not always get paid.</p>
    </>
  );
}

import { useCallback, useState } from 'react';
import { Seg } from '../../components/ui';
import { TeX } from '../../components/TeX';
import { cardsText } from '../../holdem/cards';
import type { ProfileId } from '../../holdem/profiles';
import { GROUPS, type HandGroup } from '../../holdem/profiles';
import { cellWeights } from '../../holdem/reading';
import { potOddsSpot, type PotOddsSpot, type Street } from '../../holdem/scenarios';
import { Dealing, fmtEVd, GroupBars, NextButton, parsePercent, pct, PokerTable, PROFILE_OPTIONS, RangeGrid, RoomShell, SpotLayout, StepRunner, useRoomStats, useSpot, type Step } from '../../holdem/ui';
import { fmtMoney } from '../../components/ui';

export default function PotOdds() {
  const [profile, setProfile] = useState<ProfileId | 'random'>('random');
  const [street, setStreet] = useState<Street | 'mixed'>('mixed');
  const [stats, record] = useRoomStats('potodds');
  const { spot, id, next } = useSpot((r) => potOddsSpot(r, { profile, street }), [profile, street]);
  return (
    <RoomShell
      title="Pot odds room"
      lead="Count your outs, work out the price you are being laid, and decide whether the call makes money. Every answer is checked against the exact equity against your opponent's betting range."
      stats={stats}
      lesson={<Lesson />}
      settings={
        <>
          <Seg label="Street" value={street} onChange={setStreet} options={[{ value: 'mixed', label: 'Mixed' }, { value: 'turn', label: 'Turn bets' }, { value: 'flop', label: 'Flop all-ins' }]} />
          <Seg label="Opponent" value={profile} onChange={setProfile} options={PROFILE_OPTIONS} />
        </>
      }
    >
      {spot ? <SpotView key={id} spot={spot} onDone={record} onNext={next} /> : <Dealing />}
    </RoomShell>
  );
}

function SpotView({ spot, onDone, onNext }: { spot: PotOddsSpot; onDone: (r: boolean[]) => void; onNext: () => void }) {
  const [done, setDone] = useState(false);
  const finish = useCallback(
    (r: boolean[]) => {
      onDone(r);
      setDone(true);
    },
    [onDone],
  );
  const { pot, bet, required, equity } = spot;
  const close = Math.abs(equity - required) < 0.01;
  const shouldCall = spot.evCall >= 0;
  const steps: Step[] = [
    {
      key: 'outs',
      prompt: (
        <>
          You have a <strong>{spot.draw.label.toLowerCase()}</strong>. How many outs complete it?
        </>
      ),
      input: { kind: 'number', unit: 'outs' },
      grade: (raw) => ({
        ok: Number(raw) === spot.draw.outs.length,
        answer: `${spot.draw.outs.length} outs`,
        note: <>Outs: {cardsText(spot.draw.outs)}</>,
      }),
    },
    {
      key: 'price',
      prompt: (
        <>
          {spot.profile.name} bets <strong>{fmtMoney(bet)}</strong> into <strong>{fmtMoney(pot)}</strong>
          {spot.allIn ? ' (all-in)' : ''}. What equity do you need to call?
        </>
      ),
      input: { kind: 'number', unit: '%' },
      grade: (raw) => {
        const v = parsePercent(raw);
        return {
          ok: v !== null && Math.abs(v - required) <= 0.02,
          answer: pct(required),
          note: (
            <>
              Call {fmtMoney(bet)} to win the {fmtMoney(pot + bet)} in the middle: {fmtMoney(bet)} ÷ {fmtMoney(pot + 2 * bet)} = {pct(required)}.
            </>
          ),
        };
      },
    },
    {
      key: 'decision',
      prompt: <>Call or fold?</>,
      input: {
        kind: 'choice',
        options: [
          { value: 'call', label: `Call ${fmtMoney(bet)}` },
          { value: 'fold', label: 'Fold' },
        ],
      },
      grade: (raw) => ({
        ok: close || (raw === 'call') === shouldCall,
        answer: close ? 'Either: it is within 1% of break-even' : shouldCall ? 'Call' : 'Fold',
        note: (
          <>
            Exact equity against the betting range is <strong>{pct(equity)}</strong> versus the {pct(required)} you need, so calling is worth <strong>{fmtEVd(spot.evCall)}</strong>.
          </>
        ),
      }),
    },
  ];
  return (
    <SpotLayout
      table={
        <>
          <PokerTable
            board={spot.board}
            hero={spot.hero}
            heroNote={spot.draw.label}
            profile={spot.profile}
            pot={pot}
            bet={bet}
            action={spot.allIn ? 'Shoves all-in' : 'Bets'}
          />
          <p className="small muted spot-caption">
            {spot.street === 'turn' ? 'Turn, one card to come. Assume the river is checked down, so only the direct price counts.' : 'Flop all-in: both remaining cards come with no more betting.'}{' '}
            {spot.profile.name}: {spot.profile.blurb}
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

function Explanation({ spot }: { spot: PotOddsSpot }) {
  const { pot, bet, equity, required, draw, unseen } = spot;
  const outs = draw.outs.length;
  const toCome = spot.street === 'turn' ? 1 : 2;
  const ratio = (pot + bet) / bet;
  const W = spot.range.reduce((n, c) => n + c.w, 0);
  const shares = Object.fromEntries(GROUPS.map((g) => [g, spot.range.filter((c) => c.group === g).reduce((n, c) => n + c.w, 0) / W])) as Record<HandGroup, number>;
  return (
    <div className="panel explain">
      <h3>The math</h3>
      <div className="grid-2">
        <div>
          <h4>1 · The price</h4>
          <TeX block>{`\\text{need} = \\frac{B}{P + 2B} = \\frac{${bet}}{${pot} + 2\\cdot ${bet}} = ${(required * 100).toFixed(1)}\\%`}</TeX>
          <p className="small text-2">
            The pot lays you {fmtMoney(pot + bet)} to {fmtMoney(bet)}, which is {ratio.toFixed(2)} to 1. Break-even is 1 ÷ ({ratio.toFixed(2)} + 1) = {pct(required)}.
          </p>
        </div>
        <div>
          <h4>2 · Your equity, three ways</h4>
          <table className="data">
            <tbody>
              <tr>
                <td>Rule of {toCome === 1 ? '2' : '4'} ({outs} outs)</td>
                <td className="num">{pct(spot.rule, 0)}</td>
              </tr>
              <tr>
                <td>
                  Draw completes ({toCome === 1 ? `${outs} ÷ ${unseen}` : `1 − C(${unseen - outs},2)/C(${unseen},2)`})
                </td>
                <td className="num">{pct(spot.hitProb)}</td>
              </tr>
              <tr className="hl">
                <td>
                  <strong>Exact, against the betting range</strong>
                </td>
                <td className="num">
                  <strong>{pct(equity)}</strong>
                </td>
              </tr>
            </tbody>
          </table>
          {spot.split && (
            <p className="small text-2" style={{ marginTop: 8 }}>
              Your outs land {pct(spot.split.hit)} of the time but still lose {pct(spot.split.hitButLose)} of the time (dirty outs: a bigger flush, or the board pairs and fills up a set). Rivers that miss your draw still win you{' '}
              {pct(spot.split.fromOther)} by beating bluffs or pairing up.
            </p>
          )}
        </div>
      </div>
      <h4>3 · The decision</h4>
      <TeX block>{`EV(\\text{call}) = q\\,(P+2B) - B = ${equity.toFixed(3)} \\times ${pot + 2 * bet} - ${bet} = ${spot.evCall >= 0 ? '+' : '-'}\\$${Math.abs(spot.evCall).toFixed(2)}`}</TeX>
      <h4>{spot.profile.name}'s betting range here</h4>
      <div className="grid-2">
        <div>
          <GroupBars shares={shares} />
          <p className="small muted" style={{ marginTop: 8 }}>
            Model: plays the top {spot.profile.stats.vpip}% of hands preflop and bets {GROUPS.map((g) => `${Math.round(spot.profile.betProb[g] * 100)}%`).join(' / ')} of hands in these groups.
          </p>
        </div>
        <RangeGrid weights={cellWeights(spot.range, [...spot.hero, ...spot.board])} caption="Shading: share of each hand's live combos that bet." />
      </div>
    </div>
  );
}

function Lesson() {
  return (
    <>
      <p>
        <strong>Pot odds</strong> compare what a call costs with what it can win. When an opponent bets <TeX>B</TeX> into a pot of <TeX>P</TeX>, you pay <TeX>B</TeX> to win <TeX>{'P + B'}</TeX>. Calling breaks
        even when your equity <TeX>q</TeX> satisfies
      </p>
      <TeX block>{'q\\,(P + 2B) - B = 0 \\quad\\Longrightarrow\\quad q^* = \\frac{B}{P + 2B}'}</TeX>
      <table className="data" style={{ maxWidth: 520 }}>
        <thead>
          <tr>
            <th>Bet size</th>
            <th className="num">Pot lays you</th>
            <th className="num">Equity needed</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['¼ pot', 0.25],
            ['⅓ pot', 1 / 3],
            ['½ pot', 0.5],
            ['⅔ pot', 2 / 3],
            ['¾ pot', 0.75],
            ['Pot', 1],
            ['2× pot', 2],
          ].map(([l, f]) => (
            <tr key={l as string}>
              <td>{l}</td>
              <td className="num">{((1 + (f as number)) / (f as number)).toFixed(1)} : 1</td>
              <td className="num">{pct((f as number) / (1 + 2 * (f as number)))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 12 }}>
        <strong>Counting outs.</strong> An out is a card that completes your hand: 9 for a flush draw, 8 for an open-ender, 4 for a gutshot, 15 for a flush plus open-ender (the cards that do both count
        once). With one card to come, the <strong>rule of 2</strong> (outs × 2%) is close to the exact <TeX>{'\\text{outs}/46'}</TeX>. With two cards to come and no more betting (an all-in), use the{' '}
        <strong>rule of 4</strong>, minus one point for each out above 8.
      </p>
      <p>
        <strong>Why the exact number differs.</strong> Your outs are not all clean. A flush card that pairs the board can fill up a set, and a non-nut flush can lose to a bigger one. On the other side,
        players bet with bluffs and draws too, and some of those lose to your ace-high or a pair you catch on the river. The room computes your equity by dealing every possible river (or turn and river)
        against every hand in your opponent's betting range.
      </p>
      <p className="callout">
        Pot odds alone only work when no more money goes in: a turn bet with the river checked down, or an all-in. When there is betting to come, the next room adds implied odds.
      </p>
    </>
  );
}

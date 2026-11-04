import { useEffect, useRef, useState } from 'react';
import { HandView } from '../components/PlayingCard';
import { HandProof } from '../components/ProofDrawer';
import { EVBars, Modal, fmtEV, fmtMoney, fmtPct, useKeys } from '../components/ui';
import { rankText, type Rank } from '../engine/cards';
import { getSystem } from '../engine/counting';
import { describeDeviation } from '../engine/deviations';
import { ACTION_NAMES, type Action } from '../engine/ev';
import type { GameAvail, Seat, Table } from '../engine/game';
import { describeHand, handValue, isBlackjack } from '../engine/hand';
import { canDoubleTotal, type Rules } from '../engine/rules';
import type { CountCheck } from './report';
import type { CountPrompt, Feedback, TableGame } from './useTableGame';

const CHIP_VALUES = [1, 5, 25, 100, 500, 1000];

export function Chip({ value, onClick, disabled }: { value: number; onClick?: () => void; disabled?: boolean }) {
  return (
    <button className={`pokerchip c${value}`} onClick={onClick} disabled={disabled} aria-label={`Add $${value}`}>
      {value >= 1000 ? '1K' : value}
    </button>
  );
}

function chipFor(amount: number): number {
  let best = 1;
  for (const v of CHIP_VALUES) if (v <= amount) best = v;
  return best;
}

function SeatView({ seat, table, human, showResult }: { seat: Seat; table: Table; human: boolean; showResult: boolean }) {
  const p = seat.player;
  const turn = table.turn && table.turn.seat === seat.index;
  if (!p) return <div className="seat empty bot-seat" aria-hidden />;
  return (
    <div className={`seat ${turn ? 'turn' : ''} ${human ? 'me' : 'bot-seat'}`} aria-label={`${p.name}'s seat`}>
      <div className="seat-hands">
        {seat.hands.map((h, i) => {
          const active = turn && table.turn!.hand === i && table.phase === 'playing';
          return (
            <div key={i} className={`seat-hand ${active ? 'active' : ''}`}>
              <HandView cards={h.cards} size={human ? undefined : 'sm'} />
              <div className="row tight" style={{ justifyContent: 'center' }}>
                <span className="betspot">
                  <span className={`pokerchip mini c${chipFor(h.bet)}`} />
                  {fmtMoney(h.bet)}
                  {h.doubled && <span className="muted"> ×2</span>}
                </span>
                {showResult && h.result && <span className={`result ${h.result}`}>{h.result === 'blackjack' ? 'Blackjack' : h.result}</span>}
              </div>
            </div>
          );
        })}
        {seat.hands.length === 0 && seat.bet > 0 && table.phase === 'betting' && (
          <span className="betspot">
            <span className={`pokerchip mini c${chipFor(seat.bet)}`} /> {fmtMoney(seat.bet)}
          </span>
        )}
      </div>
      {seat.insurance > 0 && <span className="chip gold">Insured {fmtMoney(seat.insurance)}</span>}
      <div className="nameplate">
        <span className="avatar" style={{ background: human ? 'var(--gold)' : p.avatar ?? '#9bb' }}>
          {p.name[0]}
        </span>
        {p.name}
        {human && <span className="muted num"> · {fmtMoney(p.bankroll)}</span>}
        {!human && p.style && <span className="muted"> · {p.style === 'pro' ? 'BS' : p.style}</span>}
      </div>
    </div>
  );
}

export function TableView({ game, humanSeat, showDecks = false, label = 'Blackjack pays 3 to 2' }: { game: TableGame; humanSeat: number | null; showDecks?: boolean; label?: string }) {
  const t = game.t;
  const holeDown = t.dealer.length >= 2 && !t.holeRevealed;
  const shoeFrac = t.shoe.length / t.shoeSize;
  const trayFrac = t.discards.length / t.shoeSize;
  const order = [...t.seats].reverse(); // seat 0 (first base) sits on the dealer's left = screen right
  return (
    <div className="felt" aria-label="Blackjack table">
      <div className="felt-top">
        <div className="tray-box" title="Discard tray">
          <div className="tray">
            <div className="fill" style={{ height: `${Math.min(100, trayFrac * 100)}%` }} />
          </div>
          <span>Discards</span>
          {showDecks && <span className="num">{(t.discards.length / 52).toFixed(1)} decks</span>}
        </div>
        <div className="dealer">
          <span className="label">Dealer</span>
          {t.dealer.length ? <HandView cards={t.dealer} holeDown={holeDown} /> : <div className="pcard ghost" />}
        </div>
        <div className="shoe-box" title="Shoe">
          <div className="shoe">
            <div className="fill" style={{ width: `${shoeFrac * 100}%` }} />
          </div>
          <span>Shoe</span>
          {showDecks && <span className="num">{(game.cardsUnseen / 52).toFixed(1)} decks left</span>}
        </div>
      </div>
      <div className="felt-text">{label}</div>
      <div className="seats">
        {order.map((s) => (
          <SeatView key={s.index} seat={s} table={t} human={s.index === humanSeat} showResult={t.phase === 'done'} />
        ))}
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------------------------

export function ActionButtons({ avail, onAction, showKeys = true, disabled }: { avail: GameAvail; onAction: (a: Action) => void; showKeys?: boolean; disabled?: boolean }) {
  useKeys(
    (k) => {
      if (disabled) return;
      if (k === 'h' && avail.hit) onAction('H');
      else if (k === 's') onAction('S');
      else if (k === 'd' && avail.double) onAction('D');
      else if (k === 'p' && avail.split) onAction('P');
      else if (k === 'r' && avail.surrender) onAction('R');
    },
    [avail, onAction, disabled],
  );
  const btn = (a: Action, ok: boolean, key: string) => (
    <button key={a} className={`btn act big ${a}`} onClick={() => onAction(a)} disabled={!ok || disabled}>
      {ACTION_NAMES[a]} {showKeys && <span className="kbd">{key}</span>}
    </button>
  );
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      {btn('H', avail.hit, 'H')}
      {btn('S', avail.stand, 'S')}
      {btn('D', avail.double, 'D')}
      {btn('P', avail.split, 'P')}
      {btn('R', avail.surrender, 'R')}
    </div>
  );
}

export function InsurancePrompt({ game, seatIndex }: { game: TableGame; seatIndex: number }) {
  const seat = game.t.seats[seatIndex];
  const bj = seat.hands[0] && isBlackjack(seat.hands[0].cards.map((c) => c.rank));
  useKeys(
    (k) => {
      if (k === 'i' || k === 'y') game.insurance(true);
      if (k === 'n') game.insurance(false);
    },
    [game],
  );
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      <span className="text-2">
        Dealer shows an ace. {bj ? 'Take even money (insurance on your blackjack)?' : `Insurance? Costs ${fmtMoney(seat.bet / 2)}, pays 2:1 if the dealer has blackjack.`}
      </span>
      <button className="btn" onClick={() => game.insurance(true)}>
        {bj ? 'Even money' : 'Take insurance'} <span className="kbd">I</span>
      </button>
      <button className="btn primary" onClick={() => game.insurance(false)}>
        No thanks <span className="kbd">N</span>
      </button>
    </div>
  );
}

export function EarlyPrompt({ game }: { game: TableGame }) {
  useKeys(
    (k) => {
      if (k === 'r') game.early(true);
      if (k === 'n' || k === 'c') game.early(false);
    },
    [game],
  );
  return (
    <div className="row" style={{ justifyContent: 'center' }}>
      <span className="text-2">Early surrender is offered before the dealer checks for blackjack.</span>
      <button className="btn act R" onClick={() => game.early(true)}>
        Surrender now <span className="kbd">R</span>
      </button>
      <button className="btn primary" onClick={() => game.early(false)}>
        Play on <span className="kbd">N</span>
      </button>
    </div>
  );
}

export function BetControls({ game, humanSeat, onDeal, minBet, maxBet }: { game: TableGame; humanSeat: number; onDeal: () => void; minBet: number; maxBet: number }) {
  const me = game.t.seats[humanSeat].player!;
  const bet = game.bet;
  const add = (v: number) => game.setBet(Math.min(maxBet, Math.min(me.bankroll, bet + v)));
  const valid = bet >= minBet && bet <= me.bankroll;
  useKeys(
    (k, e) => {
      if ((k === ' ' || k === 'enter') && valid) {
        e.preventDefault();
        onDeal();
      }
    },
    [valid, onDeal],
  );
  return (
    <div className="row" style={{ justifyContent: 'center', gap: 16 }}>
      <div className="chip-tray">
        {CHIP_VALUES.filter((v) => v <= maxBet).map((v) => (
          <Chip key={v} value={v} onClick={() => add(v)} disabled={bet + v > Math.min(maxBet, me.bankroll)} />
        ))}
      </div>
      <div className="stack" style={{ gap: 2, alignItems: 'center' }}>
        <span className="muted small">Bet</span>
        <strong className="num" style={{ fontSize: '1.3rem' }}>
          {fmtMoney(bet)}
        </strong>
      </div>
      <button className="btn small" onClick={() => game.setBet(0)}>
        Clear
      </button>
      <button className="btn small" onClick={() => game.setBet(Math.min(maxBet, me.bankroll, bet * 2))} disabled={bet === 0}>
        ×2
      </button>
      <button className="btn primary big" onClick={onDeal} disabled={!valid}>
        Deal <span className="kbd">Space</span>
      </button>
      <span className="muted small">
        Limits {fmtMoney(minBet)}–{fmtMoney(maxBet)}
      </span>
    </div>
  );
}

// --------------------------------------------------------------------------------------------

export function CountPromptDialog({ prompt, systemId, askTC, onSubmit, onClose }: { prompt: CountPrompt; systemId: string; askTC: boolean; onSubmit: (rc: number, tc?: number) => CountCheck | null; onClose: () => void }) {
  const sys = getSystem(systemId);
  const [rc, setRc] = useState('');
  const [tc, setTc] = useState('');
  const [result, setResult] = useState<CountCheck | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const wantTC = askTC && sys.balanced;
  const submit = () => {
    const r = Number(rc);
    if (rc.trim() === '' || Number.isNaN(r)) return;
    const t = wantTC && tc.trim() !== '' ? Number(tc) : undefined;
    setResult(onSubmit(r, t));
  };
  return (
    <Modal title={prompt.reason} onClose={result ? onClose : () => {}} narrow>
      {!result ? (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-2">
            What is the <strong>running count</strong> ({sys.name}) after every card you have seen since the shuffle, including the dealer's hole card?
          </p>
          <div className="count-input">
            <button type="button" className="btn" onClick={() => setRc(String((Number(rc) || 0) - (sys.level === 3 ? 0.5 : 1)))}>
              −
            </button>
            <input ref={ref} type="number" step={sys.level === 3 ? 0.5 : 1} value={rc} onChange={(e) => setRc(e.target.value)} aria-label="Running count" placeholder="0" />
            <button type="button" className="btn" onClick={() => setRc(String((Number(rc) || 0) + (sys.level === 3 ? 0.5 : 1)))}>
              +
            </button>
          </div>
          {wantTC && (
            <>
              <p className="text-2" style={{ marginBottom: 0 }}>
                And the <strong>true count</strong> (running count ÷ decks remaining)? Whole numbers are fine.
              </p>
              <div className="count-input">
                <input type="number" step={0.5} value={tc} onChange={(e) => setTc(e.target.value)} aria-label="True count" placeholder="0" />
              </div>
            </>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" type="submit" disabled={rc.trim() === ''}>
              Check
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <div className={`callout ${result.rcOk ? 'good' : 'bad'}`}>
            {result.rcOk ? '✓ Exactly right.' : '✗ Not quite.'} Running count is <strong className="num">{fmtNum(result.rcActual)}</strong>
            {!result.rcOk && <> (you said {fmtNum(result.rcAnswer)})</>}.
          </div>
          {result.tcActual !== undefined && result.tcAnswer !== undefined && (
            <div className={`callout ${result.tcOk ? 'good' : 'bad'}`}>
              {result.tcOk ? '✓' : '✗'} True count ≈ <strong className="num">{result.tcActual.toFixed(2)}</strong> ({fmtNum(result.rcActual)} ÷ {result.decksLeft.toFixed(2)} decks left). You said{' '}
              {result.tcAnswer}.
            </div>
          )}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button className="btn primary" onClick={onClose} autoFocus>
              Continue
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

const fmtNum = (x: number) => (Number.isInteger(x) ? (x > 0 ? `+${x}` : String(x)) : x > 0 ? `+${x.toFixed(1)}` : x.toFixed(1));

// --------------------------------------------------------------------------------------------

export function FeedbackBanner({ fb, rules, unit, onNext, onWhy }: { fb: Feedback; rules: Rules; unit: number; onNext?: () => void; onWhy?: () => void }) {
  const actName = (a: string) => (a === 'I' ? 'take insurance' : a === 'N' ? (fb.kind === 'insurance' ? 'decline insurance' : 'play on') : ACTION_NAMES[a as Action].toLowerCase());
  const hand = fb.cards.length ? `${describeHand(fb.cards)} vs ${rankText(fb.up)}` : '';
  return (
    <div className={`feedback ${fb.ok ? 'ok' : 'bad'}`} role="status">
      <div className="icon">{fb.ok ? '✓' : '✗'}</div>
      <div className="grow">
        <div className="title">
          {fb.ok ? 'Correct' : 'Mistake'}: you chose to {actName(fb.taken)} with {hand}.
        </div>
        {!fb.ok && (
          <div className="text-2 small">
            The right play is <strong>{actName(fb.correct)}</strong>
            {fb.evLoss > 0 && (
              <>
                , and your choice gives up <strong>{fmtPct(fb.evLoss, 2)}</strong> of the bet ({fmtMoney(fb.evLoss * (fb.bet || unit))} on your {fmtMoney(fb.bet || unit)} bet)
              </>
            )}
            . {fb.deviation && fb.correct !== fb.basic ? `Count play: ${describeDeviation(fb.deviation, rules)} (TC ${fb.tc.toFixed(1)}).` : fb.kind === 'insurance' ? fb.reason : ''}
          </div>
        )}
        {fb.ok && fb.deviation && fb.correct !== fb.basic && (
          <div className="text-2 small">
            Nice deviation: {describeDeviation(fb.deviation, rules)} (TC {fb.tc.toFixed(1)}).
          </div>
        )}
        {Object.keys(fb.ev).length > 1 && fb.kind === 'play' && (
          <div style={{ marginTop: 8, maxWidth: 520 }}>
            <EVBars ev={fb.ev} highlight={fb.correct as Action} />
            <div className="muted small" style={{ marginTop: 4 }}>
              {fb.exact ? 'Exact EVs for the actual cards left in the shoe.' : 'Chart EVs for this total (two-card compositions averaged).'}
            </div>
          </div>
        )}
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {onWhy && fb.kind === 'play' && (
          <button className="btn small" onClick={onWhy}>
            Show the math
          </button>
        )}
        {onNext && (
          <button className="btn primary small" onClick={onNext}>
            Next hand <span className="kbd">Space</span>
          </button>
        )}
      </div>
    </div>
  );
}

/** Modal with the full EV derivation for the exact hand of a decision. */
export function WhyModal({ fb, rules, onClose }: { fb: Feedback; rules: Rules; onClose: () => void }) {
  const v = handValue(fb.cards);
  const two = fb.cards.length === 2;
  const opts = {
    double: two && canDoubleTotal(rules, v.total, v.soft),
    split: two && fb.cards[0] === fb.cards[1],
    surrender: two && rules.surrender !== 'none',
  };
  return (
    <Modal title={`Why? ${describeHand(fb.cards)} vs ${rankText(fb.up)}`} onClose={onClose}>
      <div className="proof">
        <HandProof rules={rules} cards={fb.cards as Rank[]} up={fb.up} opts={opts} />
      </div>
    </Modal>
  );
}

/** Coach panel: recommended play with EVs, optionally the count. */
export function CoachPanel({ game, mode, showCount, systemId }: { game: TableGame; mode: 'off' | 'hint' | 'warn' | 'always'; showCount: boolean; systemId: string }) {
  const [hintFor, setHintFor] = useState<string | null>(null);
  const adv = game.currentAdvice;
  const key = adv ? `${game.t.roundId}:${adv.cards.join(',')}` : null;
  const showRec = adv && (mode === 'always' || hintFor === key);
  const sys = getSystem(systemId);
  return (
    <div className="panel stack" style={{ gap: 10 }}>
      <div className="panel-title">
        <h3>Coach</h3>
        <span className="chip">{mode === 'off' ? 'Off' : mode === 'hint' ? 'Hints on request' : mode === 'warn' ? 'Warns on mistakes' : 'Always on'}</span>
      </div>
      {mode === 'off' && <p className="muted small">The coach is silent. Your decisions are still recorded for the report card.</p>}
      {mode !== 'off' && !adv && <p className="muted small">Waiting for your next decision…</p>}
      {mode === 'hint' && adv && hintFor !== key && (
        <button className="btn" onClick={() => setHintFor(key)}>
          Show hint
        </button>
      )}
      {showRec && adv && (
        <div className="stack" style={{ gap: 8 }}>
          <div>
            Recommended: <span className={`tag ${adv.action}`}>{adv.action}</span> <strong>{ACTION_NAMES[adv.action]}</strong>
          </div>
          <div className="muted small">{adv.deviation && adv.action !== 'R' && adv.reason !== 'Basic strategy' ? adv.reason : 'Basic strategy'}</div>
          <EVBars ev={adv.exactEv ?? adv.ev} />
          <div className="muted small">{adv.exactEv ? 'Exact EVs for the cards left in the shoe.' : 'Chart EVs for this total.'}</div>
        </div>
      )}
      {mode === 'warn' && adv && <p className="muted small">The coach will stop you if you pick a play that costs you money.</p>}
      {showCount && (
        <div className="stack" style={{ gap: 4, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          <div className="row between">
            <span className="muted small">Running count ({sys.name})</span>
            <strong className="num">{fmtNum(game.runningCount)}</strong>
          </div>
          <div className="row between">
            <span className="muted small">Decks left</span>
            <strong className="num">{(game.cardsUnseen / 52).toFixed(2)}</strong>
          </div>
          <div className="row between">
            <span className="muted small">Hi-Lo true count</span>
            <strong className="num">{game.hiLoTC.toFixed(2)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

export function CoachWarning({ rec, taken, ev, onFollow, onAnyway }: { rec: Action; taken: Action; ev: Record<string, number>; onFollow: () => void; onAnyway: () => void }) {
  const loss = (ev[rec] ?? 0) - (ev[taken] ?? 0);
  return (
    <Modal title="Coach: are you sure?" onClose={onFollow} narrow>
      <p>
        You chose <span className={`tag ${taken}`}>{taken}</span> {ACTION_NAMES[taken]}, but <span className={`tag ${rec}`}>{rec}</span> <strong>{ACTION_NAMES[rec]}</strong> is the better play.
      </p>
      <p className="text-2">
        {ACTION_NAMES[taken]} has EV {fmtEV(ev[taken])} vs {fmtEV(ev[rec])} for {ACTION_NAMES[rec].toLowerCase()}: it gives up {fmtPct(Math.max(0, loss), 2)} of your bet.
      </p>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button className="btn" onClick={onAnyway}>
          {ACTION_NAMES[taken]} anyway
        </button>
        <button className="btn primary" onClick={onFollow} autoFocus>
          {ACTION_NAMES[rec]} instead
        </button>
      </div>
    </Modal>
  );
}

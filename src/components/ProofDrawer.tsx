/**
 * The proof drawer: for a chart cell, shows the EV of every legal play and a complete, numeric
 * derivation of each one (stand, hit, double, split, surrender), composition by composition, with
 * recursive drill-down into the hit tree and a dealer-draw tree explorer.
 */
import { useState } from 'react';
import { rankLabel, rankText, type Rank } from '../engine/cards';
import { OUTCOME_LABELS, type DealerTreeNode } from '../engine/dealer';
import { ACTION_NAMES, type Action, type Explanation, type RootOptions } from '../engine/ev';
import { cardsLabel, describeHand, handValue, parseRow, rowLabel } from '../engine/hand';
import { canDoubleTotal, rulesKey, type Rules } from '../engine/rules';
import { bestOf, type Cell, type StrategyTable } from '../engine/strategy';
import { useSettings } from '../state/settings';
import { useEngine } from '../worker/client';
import { RankCards } from './PlayingCard';
import { TeX } from './TeX';
import { EVBars, Tag, fmtEV, fmtMoney, fmtPct } from './ui';

const p4 = (x: number) => x.toFixed(4);
const pc = (x: number) => `${(x * 100).toFixed(2)}%`;
const upName = (u: Rank) => (u === 1 ? 'an ace' : u === 10 ? 'a ten' : `a ${u}`);

function optsFor(rules: Rules, cards: Rank[], allowSplit: boolean): RootOptions {
  const v = handValue(cards);
  return {
    double: cards.length === 2 && canDoubleTotal(rules, v.total, v.soft),
    split: allowSplit && cards.length === 2 && cards[0] === cards[1],
    surrender: cards.length === 2 && rules.surrender !== 'none',
  };
}

export function ProofDrawer({ table, cell, onClose }: { table: StrategyTable; cell: Cell; onClose: () => void }) {
  const { prefs } = useSettings();
  const rules = table.rules;
  const [compIdx, setCompIdx] = useState(0);
  const [stack, setStack] = useState<Rank[][]>([]);
  const { kind } = parseRow(cell.row);
  const comps = cell.comps;
  const comp = comps[Math.min(compIdx, comps.length - 1)];
  const best = cell.best;
  const second = cell.second;
  const margin = cell.margin;
  const title = `${rowLabel(cell.row)} vs dealer ${rankLabel(cell.up)}`;
  const drill = stack[stack.length - 1];

  return (
    <aside className="panel drawer proof" aria-label="EV proof">
      <div className="panel-title">
        <h3>{title}</h3>
        <button className="btn ghost small" onClick={onClose} aria-label="Close proof">
          ✕
        </button>
      </div>
      <div className="verdict">
        <div className="row between">
          <span className="big">
            Best play: <Tag a={cell.code} /> {ACTION_NAMES[best]}
          </span>
          <span className="num">{fmtEV(cell.ev[best])} units</span>
        </div>
        {second && Number.isFinite(margin) && (
          <div className="text-2 small" style={{ marginTop: 6 }}>
            {ACTION_NAMES[best]} beats {ACTION_NAMES[second].toLowerCase()} by <strong>{p4(margin)}</strong> units, which is <strong>{fmtPct(margin, 2)}</strong> of your bet.
            At {fmtMoney(prefs.unit)} a hand that is worth {fmtMoney(margin * prefs.unit)} every time you're dealt this, or {fmtMoney(margin * prefs.unit * 100)} per 100 such hands.
            {margin < 0.005 && ' This is a close call. Getting it wrong costs very little.'}
            {margin > 0.1 && ' This one is not close. Getting it wrong is expensive.'}
          </div>
        )}
        {cell.basis === 'conditional' && <div className="muted small" style={{ marginTop: 6 }}>EVs are conditional on the dealer not having blackjack (the dealer has already peeked).</div>}
        {cell.basis === 'unconditional' && (cell.up === 1 || cell.up === 10) && (
          <div className="muted small" style={{ marginTop: 6 }}>
            {rules.dealerPeeks ? 'Early surrender is decided before the peek, so these EVs are on the pre-peek basis (they include the dealer-blackjack risk).' : 'No hole card: these EVs include the risk that the dealer turns out to have blackjack.'}
          </div>
        )}
      </div>

      <section>
        <h4>Expected value of each play</h4>
        <EVBars ev={cell.ev} highlight={best} />
        <p className="muted small" style={{ marginTop: 6 }}>
          Units are multiples of your initial bet: −0.5 means you lose half a bet on average. {kind !== 'pair' && 'Splitting is not an option for this row.'}
        </p>
      </section>

      {comps.length > 1 && (
        <section>
          <h4>Why a weighted average? Compositions of {rowLabel(cell.row).toLowerCase()}</h4>
          <p className="small text-2">
            A {rowLabel(cell.row).toLowerCase()} can be dealt as {comps.map((c) => cardsLabel(c.cards)).join(' or ')}. The cards in your hand change what is left in the shoe, so each
            composition has its own exact EV. The chart cell is their average, weighted by how often each one is dealt. Basic strategy is the single play that maximises that average.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Cards</th>
                <th className="num">Weight</th>
                {(['S', 'H', 'D', 'R'] as Action[])
                  .filter((a) => cell.ev[a] !== undefined)
                  .map((a) => (
                    <th key={a} className="num">
                      {ACTION_NAMES[a]}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody>
              {comps.map((c, i) => (
                <tr key={i} className={`clickable ${i === compIdx ? 'hl' : ''}`} onClick={() => (setCompIdx(i), setStack([]))}>
                  <td>{cardsLabel(c.cards)}</td>
                  <td className="num">{pc(c.weight)}</td>
                  {(['S', 'H', 'D', 'R'] as Action[])
                    .filter((a) => cell.ev[a] !== undefined)
                    .map((a) => (
                      <td key={a} className="num" style={bestOf(c.ev, ['P']) === a ? { fontWeight: 800 } : undefined}>
                        {fmtEV(c.ev[a])}
                      </td>
                    ))}
                </tr>
              ))}
              <tr className="total">
                <td>Weighted</td>
                <td className="num">100%</td>
                {(['S', 'H', 'D', 'R'] as Action[])
                  .filter((a) => cell.ev[a] !== undefined)
                  .map((a) => (
                    <td key={a} className="num">
                      {fmtEV(cell.ev[a])}
                    </td>
                  ))}
              </tr>
            </tbody>
          </table>
          <p className="muted small">Click a row to see the full proof for that composition.</p>
        </section>
      )}

      <section>
        <div className="row tight" style={{ marginBottom: 6 }}>
          <button className={`btn small ${stack.length ? '' : 'primary'}`} onClick={() => setStack([])}>
            {cardsLabel(comp.cards)}
          </button>
          {stack.map((s, i) => (
            <span key={i} className="row tight">
              <span className="muted">›</span>
              <button className={`btn small ${i === stack.length - 1 ? 'primary' : ''}`} onClick={() => setStack(stack.slice(0, i + 1))}>
                {cardsLabel(s)}
              </button>
            </span>
          ))}
        </div>
        <HandProof
          key={(drill ?? comp.cards).join(',')}
          rules={rules}
          cards={drill ?? comp.cards}
          up={cell.up}
          opts={drill ? { double: false, split: false, surrender: false } : optsFor(rules, comp.cards, kind === 'pair')}
          onDrill={(c) => setStack([...stack, c])}
          depth={stack.length}
        />
      </section>
    </aside>
  );
}

export function HandProof({ rules, cards, up, opts, onDrill, depth = 0 }: { rules: Rules; cards: Rank[]; up: Rank; opts: RootOptions; onDrill?: (c: Rank[]) => void; depth?: number }) {
  const key = `explain|${rulesKey(rules)}|${cards.join(',')}|${up}|${opts.double ? 1 : 0}${opts.split ? 1 : 0}${opts.surrender ? 1 : 0}`;
  const { data: x, error } = useEngine<'explain'>(key, () => ({ type: 'explain', rules, cards, up, opts }));
  if (error) return <div className="callout bad">Engine error: {error}</div>;
  if (!x) return <div className="muted small">Computing the exact derivation…</div>;
  return <ProofBody x={x} rules={rules} onDrill={onDrill} depth={depth} />;
}

function ProofBody({ x, rules, onDrill, depth }: { x: Explanation; rules: Rules; onDrill?: (c: Rank[]) => void; depth: number }) {
  const hand = describeHand(x.cards);
  const t = x.total;
  const conditional = rules.dealerPeeks && (x.up === 1 || x.up === 10);
  const enhc = !rules.dealerPeeks && (x.up === 1 || x.up === 10);
  const N = x.shoe ? x.shoe.reduce((a, b) => a + b, 0) : 0;
  const best = x.best;
  const pLabel = conditional ? 'P(c | no BJ)' : 'P(c)';

  return (
    <div>
      <div className="row" style={{ alignItems: 'center', gap: 14, marginBottom: 6 }}>
        <RankCards ranks={x.cards} size="sm" />
        <span className="muted">vs</span>
        <RankCards ranks={[x.up]} size="sm" seed={7} />
        <span className="text-2">
          {hand} against {upName(x.up)}
        </span>
      </div>

      <details className="acc" open={depth === 0}>
        <summary>Setup: what is left in the shoe</summary>
        <div className="acc-body small text-2">
          {x.shoe ? (
            <>
              <p>
                With your {x.cards.length} cards and the dealer's {rankText(x.up)} removed, <strong>{N}</strong> cards remain:
              </p>
              <div className="row tight" style={{ marginBottom: 8 }}>
                {([1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as Rank[]).map((r) => (
                  <span className="chip" key={r}>
                    {rankLabel(r)} × {x.shoe![r]}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <p>Infinite deck: every draw is independent. Each rank 2–9 and the ace have probability 1/13, and ten-valued cards 4/13.</p>
          )}
          {conditional && (
            <p>
              The dealer has peeked and does <strong>not</strong> have blackjack. With {upName(x.up)} up, the hole card cannot be {x.up === 1 ? 'a ten' : 'an ace'}.
              Every probability below is conditioned on that. For example, {pLabel} = P(c)·P(no BJ | c drawn) / P(no BJ). That is exact, including the slight effect the hidden hole card has on your own draws.
              Before the peek, P(dealer BJ) was {pc(x.pBJ)}.
            </p>
          )}
          {enhc && (
            <p>
              No hole card: the dealer's second card is drawn after you play, so a dealer blackjack ({pc(x.pBJ)}) is still possible. It beats every hand (including doubled
              and split bets) except your own blackjack.
            </p>
          )}
          <p>
            The dealer {rules.hitSoft17 ? 'hits' : 'stands on'} soft 17. All values are exact. Hands are evaluated with full card removal (composition-dependent), and
            every later decision is assumed to be played optimally.
          </p>
        </div>
      </details>

      <StandProof x={x} enhc={enhc} t={t} />

      {x.hit && t < 21 && (
        <details className="acc" open={depth > 0 || best === 'H'}>
          <summary>
            Hit: <span className="num">{fmtEV(x.ev.H)}</span>
          </summary>
          <div className="acc-body">
            <div className="formula">
              <TeX block>{String.raw`\mathrm{EV}_H = \sum_{c} ${conditional ? String.raw`P(c \mid \text{no BJ})` : 'P(c)'}\,\mathrm{EV}^*(\text{hand} + c),\qquad \mathrm{EV}^* = \max(\mathrm{EV}_S,\ \mathrm{EV}_H),\ \ \text{bust} \Rightarrow -1`}</TeX>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Next</th>
                  <th className="num">{pLabel}</th>
                  <th>New hand</th>
                  <th>Then</th>
                  <th className="num">EV*</th>
                  <th className="num">P × EV*</th>
                </tr>
              </thead>
              <tbody>
                {x.hit.rows.map((r) => (
                  <tr key={r.rank} className={!r.bust && onDrill ? 'clickable' : ''} onClick={() => !r.bust && onDrill?.(r.cards)} title={!r.bust ? 'Show the proof for this hand' : undefined}>
                    <td>
                      <strong>{rankLabel(r.rank)}</strong>
                    </td>
                    <td className="num">{pc(r.p)}</td>
                    <td>{r.bust ? <span className="bad">bust ({r.total})</span> : `${r.soft ? 'soft' : 'hard'} ${r.total}`}</td>
                    <td>{r.bust ? '—' : r.action === 'H' ? <span className="tag H">H</span> : <span className="tag S">S</span>}</td>
                    <td className="num">{fmtEV(r.ev)}</td>
                    <td className="num">{fmtEV(r.p * r.ev)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={5}>EV(Hit) = sum</td>
                  <td className="num">{fmtEV(x.hit.ev)}</td>
                </tr>
              </tbody>
            </table>
            {onDrill && <p className="muted small">Click any non-bust row to see how its EV* was derived (the recursion one level down).</p>}
          </div>
        </details>
      )}

      {x.double && (
        <details className="acc" open={best === 'D'}>
          <summary>
            Double: <span className="num">{fmtEV(x.ev.D)}</span>
          </summary>
          <div className="acc-body">
            <div className="formula">
              <TeX block>{String.raw`\mathrm{EV}_D = 2\sum_{c} ${conditional ? String.raw`P(c \mid \text{no BJ})` : 'P(c)'}\;\mathrm{EV}_S(\text{hand} + c)`}</TeX>
            </div>
            <p className="small text-2">You double the bet and receive exactly one card, then must stand. So each term uses the stand EV of the final hand.</p>
            <table className="data">
              <thead>
                <tr>
                  <th>Card</th>
                  <th className="num">{pLabel}</th>
                  <th>Final</th>
                  <th className="num">EV(stand)</th>
                  <th className="num">P × EV</th>
                </tr>
              </thead>
              <tbody>
                {x.double.rows.map((r) => (
                  <tr key={r.rank}>
                    <td>
                      <strong>{rankLabel(r.rank)}</strong>
                    </td>
                    <td className="num">{pc(r.p)}</td>
                    <td>{r.bust ? <span className="bad">bust</span> : `${r.soft ? 'soft' : 'hard'} ${r.total}`}</td>
                    <td className="num">{fmtEV(r.ev)}</td>
                    <td className="num">{fmtEV(r.p * r.ev)}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td colSpan={4}>Sum × 2</td>
                  <td className="num">{fmtEV(x.double.ev)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </details>
      )}

      {x.split && <SplitProof x={x} rules={rules} pLabel={pLabel} open={best === 'P'} />}

      {x.surrender && (
        <details className="acc" open={best === 'R'}>
          <summary>
            Surrender: <span className="num">{fmtEV(x.surrender.ev)}</span>
          </summary>
          <div className="acc-body small text-2">
            {enhc && !x.surrender.early ? (
              <>
                <TeX block>{String.raw`\mathrm{EV}_R = -\tfrac12\bigl(1-P(\text{BJ})\bigr) - P(\text{BJ}) = -\tfrac12(1-${p4(x.pBJ)}) - ${p4(x.pBJ)} = ${x.surrender.ev.toFixed(4)}`}</TeX>
                <p>With no hole card, a late surrender still loses the whole bet if the dealer turns up blackjack. It only saves half a bet the rest of the time.</p>
              </>
            ) : (
              <>
                <TeX block>{String.raw`\mathrm{EV}_R = -\tfrac{1}{2}`}</TeX>
                <p>
                  You give up and lose exactly half your bet. Surrender is right whenever every other play loses <em>more</em> than half a bet on average.{' '}
                  {x.surrender.early && 'Early surrender is offered before the dealer checks for blackjack, which makes it far more valuable against an ace or ten.'}
                </p>
              </>
            )}
          </div>
        </details>
      )}

      {x.earlyConversion && (
        <div className="callout info small" style={{ marginTop: 10 }}>
          <strong>Early surrender basis.</strong> The surrender decision is made before the peek, so the other plays are converted to the same pre-peek basis:
          <TeX block>{String.raw`\mathrm{EV}_{\text{pre}} = -P(\text{BJ}) + \bigl(1-P(\text{BJ})\bigr)\,\mathrm{EV}_{\text{post}},\quad P(\text{BJ}) = ${p4(x.pBJ)}`}</TeX>
          The tables above show the post-peek derivation. The headline numbers are pre-peek.
        </div>
      )}

      <details className="acc">
        <summary>Where do the dealer's probabilities come from?</summary>
        <div className="acc-body">
          <DealerTreeView rules={rules} removed={x.cards} up={x.up} />
        </div>
      </details>
    </div>
  );
}

function StandProof({ x, enhc, t }: { x: Explanation; enhc: boolean; t: number }) {
  const d = x.stand.dealer;
  const rows = [0, 1, 2, 3, 4, 5, ...(enhc ? [6] : [])];
  const res = (o: number): 'Win' | 'Push' | 'Lose' => {
    if (o === 5) return 'Win';
    if (o === 6) return 'Lose';
    const dt = 17 + o;
    if (t < 17) return 'Lose';
    return dt < t ? 'Win' : dt === t ? 'Push' : 'Lose';
  };
  const maxP = Math.max(...rows.map((o) => d[o]));
  return (
    <details className="acc" open>
      <summary>
        Stand: <span className="num">{fmtEV(x.stand.ev)}</span>
      </summary>
      <div className="acc-body">
        <p className="small text-2">If you stand on {t}, the result depends only on where the dealer finishes:</p>
        <table className="data">
          <thead>
            <tr>
              <th>Dealer ends</th>
              <th className="num">Probability</th>
              <th style={{ width: '38%' }} />
              <th>You</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o}>
                <td>{OUTCOME_LABELS[o]}</td>
                <td className="num">{pc(d[o])}</td>
                <td>
                  <div style={{ height: 8, width: `${(d[o] / maxP) * 100}%`, background: res(o) === 'Win' ? 'var(--good)' : res(o) === 'Push' ? 'var(--muted)' : 'var(--bad)', borderRadius: 4 }} />
                </td>
                <td>
                  <span className={res(o) === 'Win' ? 'good' : res(o) === 'Lose' ? 'bad' : 'muted'}>{res(o)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="formula">
          {t < 17 ? (
            <TeX block>{String.raw`\mathrm{EV}_S = P(\text{bust}) - P(\text{dealer makes a hand}) = ${p4(x.stand.win)} - ${p4(x.stand.lose)} = ${x.stand.ev.toFixed(4)}`}</TeX>
          ) : (
            <TeX block>{String.raw`\mathrm{EV}_S = P(\text{win}) - P(\text{lose}) = ${p4(x.stand.win)} - ${p4(x.stand.lose)} = ${x.stand.ev.toFixed(4)}\quad(\text{push } ${p4(x.stand.push)})`}</TeX>
          )}
        </div>
        {t < 17 && <p className="muted small">With {t} you can only win when the dealer busts. That is why every total from 12 to 16 has the same stand EV against a given upcard.</p>}
      </div>
    </details>
  );
}

function SplitProof({ x, rules, pLabel, open }: { x: Explanation; rules: Rules; pLabel: string; open: boolean }) {
  const s = x.split!;
  const X = x.cards[0];
  const XL = rankLabel(X);
  return (
    <details className="acc" open={open}>
      <summary>
        Split: <span className="num">{fmtEV(x.ev.P)}</span>
      </summary>
      <div className="acc-body">
        <p className="small text-2">
          Each split hand starts with a single {XL} and receives a second card from a shoe that is missing both {XL}s. {s.oneCardAces ? 'Split aces get exactly one card each and must stand.' : rules.doubleAfterSplit ? 'Double after split is allowed.' : 'Doubling after a split is not allowed.'}
        </p>
        <table className="data">
          <thead>
            <tr>
              <th>2nd card</th>
              <th className="num">{pLabel}</th>
              <th>Hand</th>
              <th>Play</th>
              <th className="num">EV</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.rank} className={r.isPair ? 'hl' : ''}>
                <td>
                  <strong>{rankLabel(r.rank)}</strong>
                </td>
                <td className="num">{pc(r.p)}</td>
                <td>
                  {XL}-{rankLabel(r.rank)} ({r.soft ? 'soft' : 'hard'} {r.total})
                </td>
                <td>
                  <span className={`tag ${r.action}`}>{r.action}</span>
                  {r.isPair && s.maxHands > 2 && <span className="muted small"> or resplit</span>}
                </td>
                <td className="num">{fmtEV(r.ev)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="formula small">
          <TeX block>{String.raw`\bar E_{\neg ${XL}} = \frac{\sum_{c \ne ${XL}} P(c)\,\mathrm{EV}(${XL},c)}{1 - P(${XL})} = ${s.eNonPair.toFixed(4)}`}</TeX>
          <TeX block>{String.raw`P(${XL}) = ${s.pPair.toFixed(4)}`}</TeX>
          <p className="text-2">
            Resplitting is allowed up to <strong>{s.maxHands}</strong> hands{s.maxHands === 2 ? ' (no resplits)' : ''}. Every time a hand catches another {XL} it either resplits or, once the limit is reached, plays on as a{' '}
            {XL}-{XL} total worth {fmtEV(s.ePairFinal)}. An exact Markov chain over (pending hands, hands so far) gives the expected number of finished hands of each kind:
          </p>
          <TeX block>{String.raw`\bar n_{\neg ${XL}} = ${s.nNonPair.toFixed(4)},\qquad \bar n_{${XL}${XL}} = ${s.nPairFinal.toFixed(4)}`}</TeX>
          <p className="muted">Expected number of hands: {(s.nNonPair + s.nPairFinal).toFixed(4)}.</p>
          <TeX block>{String.raw`\mathrm{EV}_P = \bar n_{\neg ${XL}}\,\bar E_{\neg ${XL}} + \bar n_{${XL}${XL}}\,E_{${XL}${XL}}`}</TeX>
          <TeX block>{String.raw`= ${s.nNonPair.toFixed(4)}\times(${s.eNonPair.toFixed(4)}) + ${s.nPairFinal.toFixed(4)}\times(${s.ePairFinal.toFixed(4)}) = ${s.ev.toFixed(4)}`}</TeX>
          <p className="muted">
            This is the total over all split hands, per unit of the original bet. The per-hand values use the shoe with both {XL}s removed. That is the standard approximation used by
            combinatorial analyzers, and it is exact for an infinite deck. A simulation test in this project confirms it to within sampling error.
          </p>
        </div>
      </div>
    </details>
  );
}

// --------------------------------------------------------------------------------------------
// Dealer tree explorer
// --------------------------------------------------------------------------------------------

function statusText(status: number, total: number, soft: boolean): string {
  if (status < 0) return `${soft ? 'soft ' : ''}${total}: draws`;
  if (status === 5) return `busts (${total})`;
  if (status === 6) return 'blackjack';
  return `stands on ${total}`;
}

export function DealerTreeView({ rules, removed, up }: { rules: Rules; removed: Rank[]; up: Rank }) {
  return (
    <div className="small">
      <p className="text-2">
        The dealer's play is fixed: draw to 17, {rules.hitSoft17 ? 'hitting' : 'standing on'} soft 17. Each node's probability of finishing at each total is the
        probability-weighted average of its children: <TeX>{String.raw`D(\text{node}) = \sum_c P(c)\,D(\text{node}+c)`}</TeX>. Expand the drawing nodes to follow the tree.
        (Unconditional view: with an A or T up, the blackjack branch is shown. After a peek it is removed and the rest renormalised.)
      </p>
      <TreeNode rules={rules} removed={removed} up={up} path={[]} depth={0} />
    </div>
  );
}

function TreeNode({ rules, removed, up, path, depth }: { rules: Rules; removed: Rank[]; up: Rank; path: Rank[]; depth: number }) {
  const key = `tree|${rulesKey(rules)}|${removed.join(',')}|${up}|${path.join(',')}`;
  const { data } = useEngine<'dealerTree'>(key, () => ({ type: 'dealerTree', rules, removed, up, path }));
  const [open, setOpen] = useState<Record<number, boolean>>({});
  if (!data) return <div className="muted">…</div>;
  const node: DealerTreeNode = data;
  return (
    <div style={{ marginLeft: depth ? 14 : 0, borderLeft: depth ? '1px solid var(--border)' : undefined, paddingLeft: depth ? 10 : 0 }}>
      {depth === 0 && (
        <div style={{ marginBottom: 6 }}>
          <strong>Dealer shows {rankLabel(up)}</strong>: final distribution{' '}
          {node.dist
            .map((p, o) => ({ p, o }))
            .filter((z) => z.p > 0)
            .map((z) => `${OUTCOME_LABELS[z.o]} ${pc(z.p)}`)
            .join(' · ')}
        </div>
      )}
      <table className="data">
        <tbody>
          {node.children.map((c) => (
            <tr key={c.rank}>
              <td style={{ width: 28 }}>
                {c.status < 0 ? (
                  <button className="btn ghost small" style={{ padding: '0 6px' }} onClick={() => setOpen({ ...open, [c.rank]: !open[c.rank] })} aria-label="Expand">
                    {open[c.rank] ? '▾' : '▸'}
                  </button>
                ) : null}
              </td>
              <td>
                +<strong>{rankLabel(c.rank)}</strong>
              </td>
              <td className="num">{pc(c.p)}</td>
              <td>{statusText(c.status, c.total, c.soft)}</td>
              <td className="num muted">bust from here {pc(c.dist[5])}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {node.children
        .filter((c) => c.status < 0 && open[c.rank])
        .map((c) => (
          <div key={c.rank}>
            <div className="muted" style={{ marginTop: 4 }}>
              After {[up, ...path, c.rank].map(rankLabel).join('-')}:
            </div>
            <TreeNode rules={rules} removed={removed} up={up} path={[...path, c.rank]} depth={depth + 1} />
          </div>
        ))}
    </div>
  );
}

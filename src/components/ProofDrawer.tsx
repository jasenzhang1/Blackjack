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
import type { Cell, StrategyTable } from '../engine/strategy';
import { useEngine } from '../worker/client';
import { RankCards } from './PlayingCard';
import { TeX } from './TeX';
import { EVBars, Modal, Tag, fmtEV, fmtPct } from './ui';

/** A probability or EV as a percent inside a TeX formula. */
const tp = (x: number) => `${x < 0 ? '-' : ''}${Math.abs(x * 100).toFixed(2)}\\%`;
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
  const [play, setPlay] = useState<Action | null>(null);
  const best = cell.best;
  const second = cell.second;
  const margin = cell.margin;
  const title = `${rowLabel(cell.row)} vs dealer ${rankLabel(cell.up)}`;

  return (
    <aside className="panel drawer proof" aria-label="Expected value of each play">
      <div className="panel-title">
        <h3>{title}</h3>
        <button className="btn ghost small" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <div className="verdict">
        <div className="row between">
          <span className="big">
            Best play: <Tag a={cell.code} /> {ACTION_NAMES[best]}
          </span>
          <span className="num">{fmtEV(cell.ev[best])}</span>
        </div>
        {second && Number.isFinite(margin) && (
          <div className="text-2 small" style={{ marginTop: 6 }}>
            Beats {ACTION_NAMES[second].toLowerCase()} by <strong>{fmtPct(margin, 2)}</strong> of your bet.
          </div>
        )}
      </div>

      <section>
        <h4>Expected value of each play</h4>
        <EVBars ev={cell.ev} highlight={best} onPick={setPlay} />
        <p className="muted small" style={{ marginTop: 6 }}>
          Tap a value to see the math.
        </p>
      </section>

      {play && <PlayProofModal rules={table.rules} cell={cell} play={play} onClose={() => setPlay(null)} />}
    </aside>
  );
}

/** Second popup: the full derivation of one play's EV for a chart cell. */
function PlayProofModal({ rules, cell, play, onClose }: { rules: Rules; cell: Cell; play: Action; onClose: () => void }) {
  const [compIdx, setCompIdx] = useState(0);
  const [stack, setStack] = useState<Rank[][]>([]);
  const { kind } = parseRow(cell.row);
  const comps = cell.comps;
  const comp = comps[Math.min(compIdx, comps.length - 1)];
  const drill = stack[stack.length - 1];
  return (
    <Modal title={`${ACTION_NAMES[play]}: ${rowLabel(cell.row)} vs dealer ${rankLabel(cell.up)} (${fmtEV(cell.ev[play])})`} onClose={onClose}>
      <div className="proof">
        {comps.length > 1 && (
          <div style={{ marginBottom: 12 }}>
            <p className="small text-2" style={{ marginBottom: 6 }}>
              This hand can be dealt {comps.length} ways. The chart value is their average, weighted by how often each is dealt:
            </p>
            <table className="data">
              <thead>
                <tr>
                  <th>Cards</th>
                  <th className="num">Weight</th>
                  <th className="num">{ACTION_NAMES[play]}</th>
                </tr>
              </thead>
              <tbody>
                {comps.map((c, i) => (
                  <tr key={i} className={`clickable ${i === compIdx ? 'hl' : ''}`} onClick={() => (setCompIdx(i), setStack([]))}>
                    <td>{cardsLabel(c.cards)}</td>
                    <td className="num">{pc(c.weight)}</td>
                    <td className="num">{fmtEV(c.ev[play])}</td>
                  </tr>
                ))}
                <tr className="total">
                  <td>Weighted</td>
                  <td className="num">100%</td>
                  <td className="num">{fmtEV(cell.ev[play])}</td>
                </tr>
              </tbody>
            </table>
            <p className="muted small">Tap a row to see the math for those cards.</p>
          </div>
        )}
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
          only={drill ? undefined : play}
        />
      </div>
    </Modal>
  );
}

export function HandProof({ rules, cards, up, opts, onDrill, depth = 0, only }: { rules: Rules; cards: Rank[]; up: Rank; opts: RootOptions; onDrill?: (c: Rank[]) => void; depth?: number; only?: Action }) {
  const key = `explain|${rulesKey(rules)}|${cards.join(',')}|${up}|${opts.double ? 1 : 0}${opts.split ? 1 : 0}${opts.surrender ? 1 : 0}`;
  const { data: x, error } = useEngine<'explain'>(key, () => ({ type: 'explain', rules, cards, up, opts }));
  if (error) return <div className="callout bad">Engine error: {error}</div>;
  if (!x) return <div className="muted small">Computing the exact derivation…</div>;
  return <ProofBody x={x} rules={rules} onDrill={onDrill} depth={depth} only={only} />;
}

/** Full derivation for a hand. With `only`, shows just that play's section (plus setup and dealer tree). */
function ProofBody({ x, rules, onDrill, depth, only }: { x: Explanation; rules: Rules; onDrill?: (c: Rank[]) => void; depth: number; only?: Action }) {
  const show = (a: Action) => !only || only === a;
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

      <details className="acc" open={depth === 0 && !only}>
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

      {show('S') && <StandProof x={x} enhc={enhc} t={t} />}

      {show('H') && x.hit && t < 21 && (
        <details className="acc" open={depth > 0 || best === 'H' || only === 'H'}>
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

      {show('D') && x.double && (
        <details className="acc" open={best === 'D' || only === 'D'}>
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

      {show('P') && x.split && <SplitProof x={x} rules={rules} pLabel={pLabel} open={best === 'P' || only === 'P'} />}

      {show('R') && x.surrender && (
        <details className="acc" open={best === 'R' || only === 'R'}>
          <summary>
            Surrender: <span className="num">{fmtEV(x.surrender.ev)}</span>
          </summary>
          <div className="acc-body small text-2">
            {enhc && !x.surrender.early ? (
              <>
                <TeX block>{String.raw`\mathrm{EV}_R = -\tfrac12\bigl(1-P(\text{BJ})\bigr) - P(\text{BJ}) = -\tfrac12(1-${tp(x.pBJ)}) - ${tp(x.pBJ)} = ${tp(x.surrender.ev)}`}</TeX>
                <p>With no hole card, a late surrender still loses the whole bet if the dealer turns up blackjack. It only saves half a bet the rest of the time.</p>
              </>
            ) : (
              <>
                <TeX block>{String.raw`\mathrm{EV}_R = -\tfrac{1}{2} = -50\%`}</TeX>
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
          <TeX block>{String.raw`\mathrm{EV}_{\text{pre}} = -P(\text{BJ}) + \bigl(1-P(\text{BJ})\bigr)\,\mathrm{EV}_{\text{post}},\quad P(\text{BJ}) = ${tp(x.pBJ)}`}</TeX>
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
            <TeX block>{String.raw`\mathrm{EV}_S = P(\text{bust}) - P(\text{dealer makes a hand}) = ${tp(x.stand.win)} - ${tp(x.stand.lose)} = ${tp(x.stand.ev)}`}</TeX>
          ) : (
            <TeX block>{String.raw`\mathrm{EV}_S = P(\text{win}) - P(\text{lose}) = ${tp(x.stand.win)} - ${tp(x.stand.lose)} = ${tp(x.stand.ev)}\quad(\text{push } ${tp(x.stand.push)})`}</TeX>
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
          <TeX block>{String.raw`\bar E_{\neg ${XL}} = \frac{\sum_{c \ne ${XL}} P(c)\,\mathrm{EV}(${XL},c)}{1 - P(${XL})} = ${tp(s.eNonPair)}`}</TeX>
          <TeX block>{String.raw`P(${XL}) = ${tp(s.pPair)}`}</TeX>
          <p className="text-2">
            Resplitting is allowed up to <strong>{s.maxHands}</strong> hands{s.maxHands === 2 ? ' (no resplits)' : ''}. Every time a hand catches another {XL} it either resplits or, once the limit is reached, plays on as a{' '}
            {XL}-{XL} total worth {fmtEV(s.ePairFinal)}. An exact Markov chain over (pending hands, hands so far) gives the expected number of finished hands of each kind:
          </p>
          <TeX block>{String.raw`\bar n_{\neg ${XL}} = ${s.nNonPair.toFixed(4)},\qquad \bar n_{${XL}${XL}} = ${s.nPairFinal.toFixed(4)}`}</TeX>
          <p className="muted">Expected number of hands: {(s.nNonPair + s.nPairFinal).toFixed(4)}.</p>
          <TeX block>{String.raw`\mathrm{EV}_P = \bar n_{\neg ${XL}}\,\bar E_{\neg ${XL}} + \bar n_{${XL}${XL}}\,E_{${XL}${XL}}`}</TeX>
          <TeX block>{String.raw`= ${s.nNonPair.toFixed(4)}\times(${tp(s.eNonPair)}) + ${s.nPairFinal.toFixed(4)}\times(${tp(s.ePairFinal)}) = ${tp(s.ev)}`}</TeX>
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

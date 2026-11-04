import { TeX } from '../components/TeX';
import { fmtPct } from '../components/ui';
import { Link } from '../router';
import { useSettings } from '../state/settings';
import { useStrategy } from '../worker/client';

const T = ({ children }: { children: string }) => <TeX>{children}</TeX>;
const B = ({ children }: { children: string }) => <TeX block>{children}</TeX>;

export default function MathPage() {
  const { rules } = useSettings();
  const { table } = useStrategy(rules);
  return (
    <main className="page math-page">
      <div className="page-head">
        <div>
          <h1>The math behind every number</h1>
        </div>
      </div>
      <article className="lesson" style={{ maxWidth: 900 }}>
        <h2>1. Setup</h2>
        <p>
          Cards are reduced to ranks <T>{String.raw`r \in \{A,2,\dots,9,T\}`}</T> (all ten-valued cards are equivalent). A shoe is a vector of counts <T>{String.raw`n_r`}</T> with{' '}
          <T>{String.raw`N=\sum_r n_r`}</T>. The dealer follows a fixed rule: draw until reaching 17 or more, and {rules.hitSoft17 ? 'hit' : 'stand on'} soft 17. A hand's value per unit
          bet is +1 for a win, 0 for a push, −1 for a loss, +payout for a natural, −½ for a surrender, and twice those for a doubled hand. All EVs are in units of the initial bet.
        </p>

        <h2>2. The dealer's final distribution</h2>
        <p>
          <strong>Theorem 1 (multiset formula).</strong> Draw <T>k</T> cards without replacement. The probability of one specific ordered sequence containing <T>{String.raw`m_r`}</T> cards of
          rank <T>r</T> is
        </p>
        <B>{String.raw`P(\text{sequence}) \;=\; \frac{\prod_r (n_r)_{m_r}}{(N)_k},\qquad (x)_m = x(x-1)\cdots(x-m+1).`}</B>
        <p>
          <em>Proof.</em> The <T>i</T>-th draw happens with <T>N-i+1</T> cards left, whatever came before, so the denominators multiply to <T>{String.raw`(N)_k`}</T>. The <T>j</T>-th time rank{' '}
          <T>r</T> is drawn, <T>{String.raw`n_r-j+1`}</T> cards of that rank remain, so the numerators multiply to <T>{String.raw`\prod_r (n_r)_{m_r}`}</T>. Neither product depends on the
          order. ∎
        </p>
        <p>
          <strong>Lemma 1.</strong> Whether the dealer must draw depends only on the <em>multiset</em> of cards held, because the total and softness don't depend on order. So a final dealer
          hand <T>M</T> is reached by exactly <T>{String.raw`W(M)`}</T> valid orderings: those whose every proper prefix is a "must draw" hand. <T>{String.raw`W`}</T> satisfies the
          recursion
        </p>
        <B>{String.raw`W(M+r) \;\mathrel{+}=\; W(M)\quad\text{for every draw-state } M \text{ and rank } r,\qquad W(\varnothing)=1,`}</B>
        <p>and combining with Theorem 1,</p>
        <B>{String.raw`P(\text{dealer finishes with } M) \;=\; W(M)\,\frac{\prod_r (n_r)_{m_r}}{(N)_{|M|}} .`}</B>
        <p>
          <T>{String.raw`W`}</T> and the outcome of each terminal <T>M</T> don't depend on the shoe, so they are enumerated <em>once</em> per (upcard, H17/S17). The distribution for any new
          shoe is then one pass over a few thousand terms with falling factorials, instead of a recursive tree of tens of thousands of draw sequences. This is what makes exact card-removal
          analysis fast enough to run in a browser. The test suite checks the formula against brute-force recursion to 12 decimal places and against the published infinite-deck dealer table.
        </p>

        <h2>3. The peek, done exactly</h2>
        <p>
          With an ace or ten up, a US dealer checks for blackjack before anyone plays, so every decision is made knowing <em>there is no dealer blackjack</em>. The engine computes
        </p>
        <B>{String.raw`J \;=\; \mathbb{E}\bigl[\text{payoff}\cdot \mathbf 1\{\text{no dealer BJ}\}\bigr],\qquad \mathbb{E}[\text{payoff}\mid\text{no BJ}] \;=\; \frac{J}{P(\text{no BJ})}.`}</B>
        <p>
          <strong>Lemma 2 (exchangeability).</strong> The hole card is dealt before you draw, but for the joint distribution of all cards it doesn't matter. Each complete deal (your draws,
          the hole card, the dealer's draws) has a probability that depends only on its multiset (Theorem 1), and your stopping decisions depend only on your own cards. So you may treat
          your draws as coming <em>first</em>. "No blackjack" then becomes an event about the dealer's cards alone, and <T>J</T> obeys the same recursions as an ordinary EV, with the
          blackjack outcome simply dropped from the dealer's distribution. Maximising <T>J</T> at a node is the same as maximising the conditional EV, because both are divided by the same{' '}
          <T>{String.raw`P(\text{no BJ}\mid\text{your cards})`}</T>. ∎
        </p>
        <p>
          The proofs print the conditional draw probabilities <T>{String.raw`P(c\mid \text{no BJ}) = P(c)\,P(\text{no BJ}\mid c)/P(\text{no BJ})`}</T>. With an ace up, a ten is slightly more
          likely to be your next card, because the hole card is known not to be one. In no-hole-card games there is no conditioning: a dealer blackjack is a dealer outcome that beats every
          bet on the table, including doubles and splits.
        </p>

        <h2>4. Hit, stand, double, surrender</h2>
        <p>
          Let <T>{String.raw`D_o(R)`}</T> be the dealer's distribution over outcomes <T>{String.raw`o \in \{17,\dots,21,\text{bust}\}`}</T> for the shoe minus the removed cards <T>R</T>. For a
          player total <T>t</T>:
        </p>
        <B>{String.raw`\mathrm{EV}_S(t) = D_{\text{bust}} + \sum_{o<t} D_o - \sum_{o>t} D_o \qquad(t<17:\ \mathrm{EV}_S = 2D_{\text{bust}}-1).`}</B>
        <p>The optimal value of a hand that may hit or stand is the Bellman equation</p>
        <B>{String.raw`\mathrm{EV}^*(h) = \max\Bigl(\mathrm{EV}_S(h),\ \sum_c P(c\mid h)\,\mathrm{EV}^*(h+c)\Bigr),\qquad \mathrm{EV}^*(\text{bust}) = -1,`}</B>
        <p>
          where <T>{String.raw`P(c\mid h)`}</T> uses the shoe minus every card in <T>h</T>. That is exact card removal: each distinct multiset of player cards gets its own dealer distribution.
          Doubling and surrender are only available on two cards:
        </p>
        <B>{String.raw`\mathrm{EV}_D = 2\sum_c P(c\mid h)\,\mathrm{EV}_S(h+c),\qquad \mathrm{EV}_R = -\tfrac12 .`}</B>
        <p>
          <strong>Lemma 3.</strong> With hard ≤ 11 or soft ≤ 16, hitting is at least as good as standing. <em>Proof.</em> Such a hand can't bust on one card. Standing on any total below 17 wins
          only when the dealer busts, and a total of 17 or more does at least as well. Averaged over the card you draw, the dealer's bust probability is unchanged (exchangeability again).
          So "hit once, then stand" already has EV ≥ standing now. ∎ The engine uses this to skip dealer calculations it provably doesn't need.
        </p>
        <p>
          <strong>Early surrender</strong> is decided before the peek, so the comparison is made on the pre-peek basis: <T>{String.raw`\mathrm{EV}_{\text{pre}} = -P(\mathrm{BJ}) + (1-P(\mathrm{BJ}))\,\mathrm{EV}_{\text{post}}`}</T>{' '}
          against <T>{String.raw`-\tfrac12`}</T>.
        </p>

        <h2>5. Splitting and the resplit chain</h2>
        <p>
          Each split hand starts with one card <T>X</T>. Its second card <T>c</T> comes from the shoe minus <em>both</em> pair cards, and the hand is then played optimally (with doubling if
          DAS is allowed; split aces get one card unless hitting split aces is allowed). Let <T>p</T> be the probability the second card is another <T>X</T>,{' '}
          <T>{String.raw`\bar E_{\neg X}`}</T> the average value when it isn't, and <T>{String.raw`E_{XX}`}</T> the value of an <T>X,X</T> hand that can no longer be split. Let{' '}
          <T>{String.raw`f(k, h)`}</T> be the expected numbers of finished hands of each kind with <T>k</T> pending one-card hands and <T>h</T> hands in total, with hand limit <T>H</T>:
        </p>
        <B>{String.raw`f(k,h) = p\cdot\begin{cases} f(k+1,h+1) & h<H \ \ (\text{resplit})\\ f(k-1,h)+(0,1) & h=H\end{cases} \;+\;(1-p)\bigl(f(k-1,h)+(1,0)\bigr),\qquad f(0,h)=(0,0).`}</B>
        <p>
          With <T>{String.raw`(\bar n_{\neg X}, \bar n_{XX}) = f(2,2)`}</T>, linearity of expectation gives <T>{String.raw`\mathrm{EV}_P = \bar n_{\neg X}\bar E_{\neg X} + \bar n_{XX}E_{XX}`}</T>. Without resplits this
          reduces to <T>{String.raw`2\bigl[(1-p)\bar E_{\neg X} + pE_{XX}\bigr]`}</T>. For an infinite deck the result is exact. For finite shoes it is the standard approximation used by
          combinatorial analyzers, because it ignores the cards the sister hand draws. A Monte Carlo test in this project (60,000 rigged 8,8 vs 10 rounds) confirms it to within sampling error.
        </p>

        <h2>6. From compositions to the chart</h2>
        <p>
          A chart cell like hard 16 vs 10 is a mixture of two-card compositions <T>i</T> (10-6, 9-7), dealt with probability <T>{String.raw`w_i \propto n_a n_b`}</T> (or{' '}
          <T>{String.raw`n_a(n_a-1)/2`}</T> for a pair) after the upcard is removed:
        </p>
        <B>{String.raw`\mathrm{EV}_{\text{cell}}(a) = \frac{\sum_i w_i\,\mathrm{EV}_i(a)}{\sum_i w_i},\qquad \text{chart play} = \arg\max_a \mathrm{EV}_{\text{cell}}(a).`}</B>
        <p>
          That is total-dependent basic strategy: one play per total. Playing each composition separately is "composition-dependent" strategy. For your rules it would lower the house edge
          from {table ? fmtPct(table.houseEdge, 3) : '…'} to {table ? fmtPct(table.houseEdgeCD, 3) : '…'}.
        </p>

        <h2>7. The house edge</h2>
        <p>For each upcard <T>u</T> and two-card hand <T>{String.raw`\{a,b\}`}</T>, with <T>{String.raw`\beta = P(\text{dealer BJ}\mid u,a,b)`}</T>:</p>
        <B>{String.raw`\mathrm{EV} = \sum_u P(u)\sum_{\{a,b\}} P(a,b\mid u)\cdot\begin{cases} (1-\beta)\cdot\text{payout} & \text{player blackjack}\\ -\beta + (1-\beta)\,\mathrm{EV}_{\text{cell}}\bigl(\text{chart play}\bigr) & \text{otherwise (peek)}\end{cases}`}</B>
        <p>
          The house edge is <T>{String.raw`-\mathrm{EV}`}</T>, which is <strong>{table ? fmtPct(table.houseEdge, 3) : '…'}</strong> for your current rules. The blackjack payout enters
          linearly:
        </p>
        <B>{String.raw`\frac{\partial\,\text{house edge}}{\partial\,\text{payout}} = -P(\text{player BJ},\ \text{dealer none})${table ? String.raw`\ =\ -${table.pPlayerBJWin.toFixed(5)}` : ''},`}</B>
        <p>
          so 6:5 instead of 3:2 costs <T>{String.raw`0.3\times`}</T> that probability: <strong>{table ? fmtPct(table.pPlayerBJWin * 0.3, 2) : '…'}</strong> of every bet. That is several times
          more than all the other rules combined usually move the edge.
        </p>

        <h2>8. Card counting</h2>
        <p>
          <strong>Effect of removal.</strong> Removing one card of rank <T>r</T> changes the player's edge by <T>{String.raw`e_r`}</T> (computed by re-solving the game, see the{' '}
          <Link to="/counting/learn">lessons</Link>). To first order, the edge of a depleted shoe is the edge off the top plus the sum of the <T>{String.raw`e_r`}</T> of the cards removed. A count
          with tags <T>{String.raw`t_r`}</T> estimates that sum. Its <em>betting correlation</em> is the cosine similarity of <T>t</T> and <T>e</T> (weighting tens ×4), about 0.97 for Hi-Lo.
        </p>
        <p>
          <strong>True count.</strong> For a balanced count the unseen cards' tags sum to <T>{String.raw`-\mathrm{RC}`}</T>. With <T>D</T> decks unseen, the surplus per deck is{' '}
          <T>{String.raw`\mathrm{RC}/D`}</T>. The probability that the next card has any given rank, and so every EV, depends on the composition per deck, not on the absolute surplus.
          That is why indices are expressed in true count.
        </p>
        <p>
          <strong>Insurance</strong> pays 2:1 on the event "hole card is a ten". With a fraction <T>p</T> of tens unseen, <T>{String.raw`\mathrm{EV} = 2p-(1-p) = 3p-1`}</T>. This is positive
          exactly when <T>{String.raw`p>1/3`}</T>, which happens near Hi-Lo TC +3.
        </p>
        <p>
          <strong>Index plays.</strong> For a decision between plays <T>a</T> and <T>b</T>, the index is the true count where{' '}
          <T>{String.raw`\mathrm{EV}_a(\mathrm{TC}) = \mathrm{EV}_b(\mathrm{TC})`}</T>. The lessons page solves the hand exactly at each count and shows where the lines cross.
        </p>
        <p>
          <strong>Bet sizing.</strong> Maximising the expected log of the bankroll gives the Kelly bet <T>{String.raw`f^* \approx \mu/\sigma^2`}</T> as a fraction of bankroll. For blackjack{' '}
          <T>{String.raw`\sigma^2\approx 1.3`}</T>.
        </p>

        <h2>9. How the engine is validated</h2>
        <ul>
          <li>Dealer distributions agree with the published infinite-deck table and with brute-force recursion for finite shoes (to 1e-12).</li>
          <li>Hit, stand and double EVs agree with an independent brute-force solver that conditions on the hole card explicitly (to 1e-10), for 1, 2 and ∞ decks under S17 and H17.</li>
          <li>The full 6-deck S17 DAS LS chart reproduces the published chart cell for cell, along with the known H17 and single-deck changes.</li>
          <li>House-edge deltas match published rule effects (H17 ≈ +0.2%, late surrender ≈ −0.08%, 6:5 ≈ +1.36%).</li>
          <li>A 150,000-round simulation of the table engine agrees with the exact house edge, and a rigged 8,8 vs 10 simulation agrees with the split EV.</li>
        </ul>
      </article>
    </main>
  );
}

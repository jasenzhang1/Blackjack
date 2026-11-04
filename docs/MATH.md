# The mathematics of Blackjack Lab

This document derives every number the app shows: the dealer's outcome probabilities, the
expected value (EV) of each play, the chart, the house edge, and the card-counting quantities.
It also proves the results the engine relies on. The implementation lives in
[`src/engine`](../src/engine), and the validation tests are in [`tests`](../tests).

All EVs are in **units of the initial bet**: +1 is winning one bet, −0.5 is losing half a bet.

---

## 1. Setup and notation

* Ranks $r \in \{A,2,\dots,9,T\}$ (all ten-valued cards are equivalent, $T$ = 10/J/Q/K). The code
  indexes them $1..10$.
* A **shoe** is a count vector $n = (n_A, n_2, \dots, n_T)$ with $N = \sum_r n_r$ cards. A full
  $d$-deck shoe has $n_r = 4d$ for $r \ne T$ and $n_T = 16d$. The infinite deck is the limit
  $d\to\infty$: draws are i.i.d. with $p_r = 1/13$ ($r\ne T$) and $p_T = 4/13$.
* $(x)_m = x(x-1)\cdots(x-m+1)$ is the falling factorial, $(x)_0 = 1$.
* A hand's **hard total** counts every ace as 1. It is **soft** if it holds an ace and
  hard total $\le 11$, in which case one ace counts 11.
* The dealer draws to 17 and stands on soft 17 (S17) or hits it (H17).
* Payoffs: win +1, push 0, loss −1, natural blackjack +$b$ (3:2 means $b = 1.5$, 6:5 means $b = 1.2$),
  surrender −½. A doubled hand pays or loses 2.

---

## 2. The dealer's final distribution

### Theorem 1 (multiset formula)

Draw $k$ cards without replacement from shoe $n$. Any one *ordered* sequence that contains
$m_r$ cards of each rank $r$ (so $\sum_r m_r = k$) has probability

$$
P(\text{sequence}) \;=\; \frac{\prod_r (n_r)_{m_r}}{(N)_k}.
$$

*Proof.* The $i$-th card is drawn when $N - i + 1$ cards remain, regardless of which cards came
earlier. So the product of denominators is $N(N-1)\cdots(N-k+1) = (N)_k$. For a fixed rank $r$,
the $j$-th time it is drawn there are $n_r - j + 1$ such cards left, so the numerators for rank $r$
multiply to $(n_r)_{m_r}$. Neither product depends on the order of the sequence. ∎

### Lemma 1 (order-free dealer status)

Whether the dealer must draw is a function of the **multiset** of cards held, since the total and
the softness don't depend on order. A blackjack is recognised on exactly two cards.

**Consequence.** A terminal dealer hand $M$ (a multiset of cards after the upcard) is produced by
exactly $W(M)$ *valid* orderings: those whose every proper prefix is a "must draw" state. By
Theorem 1, each valid ordering has the same probability, so

$$
P(\text{dealer ends with } M) \;=\; W(M)\,\frac{\prod_r (n_r)_{m_r}}{(N)_{|M|}} .
$$

$W$ satisfies a simple forward recursion over multisets, processed by size:

$$
W(\varnothing) = 1, \qquad W(M + r) \;\mathrel{+}=\; W(M)\quad \text{for every draw-state } M \text{ and every rank } r .
$$

Both $W(M)$ and the outcome of $M$ (17, 18, 19, 20, 21, bust or blackjack) depend only on the
upcard and the H17/S17 rule, **not on the shoe**. The engine enumerates them once
(`dealer.ts: enumerate`). Afterwards the distribution for *any* shoe is a single pass over the
terminal multisets with precomputed falling-factorial tables (`dealerDistribution`). This
replaces a recursion over tens of thousands of ordered draw sequences with a sum over a few
thousand terms. That makes exact card-removal analysis fast enough to run in the browser.

For the infinite deck, $\prod_r (n_r)_{m_r} / (N)_k$ is replaced by $\prod_r p_r^{m_r}$.

*Validation.* `tests/dealer.test.ts` checks the formula against brute-force recursion for finite
shoes (agreement to $10^{-12}$) and against the published infinite-deck S17 bust probabilities,
for example 35.36% with a 2 up and 42.32% with a 6 up.

---

## 3. The dealer peek, done exactly

With an ace or ten up, US dealers check for blackjack before the players act, so every decision
is made **knowing the dealer does not have blackjack**. This conditioning has a subtle effect: the
hole card is then known not to be a ten (ace up) or an ace (ten up), which changes the
composition the *player* draws from.

The engine works with **J-values**

$$
J \;=\; \mathbb{E}\big[\text{payoff}\cdot \mathbf{1}\{\text{no dealer blackjack}\}\big],
\qquad
\mathbb{E}[\text{payoff}\mid\text{no BJ}] \;=\; \frac{J}{P(\text{no BJ})}.
$$

### Lemma 2 (exchangeability)

Physically the hole card is dealt before the player draws. Nevertheless the joint distribution of
(player's draws, hole card, dealer's later draws) is the same as if the player drew **first** and
the dealer's hand were dealt afterwards from the remaining cards.

*Proof.* Fix any complete deal: the player's cards $c_1..c_\tau$ (where $\tau$ is chosen by the
player from the cards seen), the hole card $h$, and the dealer's draws $d_1..d_j$. In either
order this is one specific sequence of distinct draws from the same shoe, and by Theorem 1 its
probability depends only on its multiset, which is the same in both orders. The player's
stopping rule depends only on $c_1..c_\tau$ in both orders. So every complete deal has the
same probability under both orders. ∎

Under the "player first" order, "no blackjack" is an event about the dealer's cards alone.
Therefore **J-values obey exactly the same recursions as ordinary EVs, with the blackjack outcome
removed from the dealer's distribution** (it is neither a win nor a loss, since it is excluded).
When the player busts, $J = -P(\text{no BJ}\mid\text{cards so far})$.

At every decision node, all actions share the same denominator $P(\text{no BJ}\mid\text{cards seen})$.
So maximising $J$ is the same as maximising the conditional EV, and the optimal strategy is
unaffected by working with J-values.

In the proof drawer, conditional draw probabilities are displayed as
$P(c\mid\text{no BJ}) = P(c)\,P(\text{no BJ}\mid c)/P(\text{no BJ})$. These sum to 1 by the
law of total probability (equivalently, by Lemma 2).

*Validation.* `tests/bruteforce.test.ts` computes the same conditional EVs a completely different
way, by explicitly averaging over the possible hole cards, and agrees to $10^{-10}$.

**No hole card (ENHC).** There is no conditioning. A dealer blackjack is simply one of the
dealer's outcomes. It beats every player hand except a natural, including doubled and split
bets ("lose all").

---

## 4. Standing, hitting, doubling, surrendering

Let $R$ be the multiset of cards removed from the shoe besides the upcard (the player's cards),
and $D_o(R)$ the dealer's distribution over $o \in \{17,18,19,20,21,\text{bust}\}$ for the shoe
minus $R$ (J-weighted as in §3).

**Stand** on total $t$:

$$
\mathrm{EV}_S(t) \;=\; D_{\text{bust}} + \sum_{o<t} D_o - \sum_{o>t} D_o ,
\qquad
t < 17 \;\Rightarrow\; \mathrm{EV}_S = D_{\text{bust}} - \sum_{o\ge 17} D_o .
$$

(Every total from 12 to 16 has the same stand EV against a given upcard. You only win when the
dealer busts.)

**Hit.** The optimal value of a hand $h$ that may hit or stand is the Bellman equation

$$
\mathrm{EV}^*(h) \;=\; \max\Big(\mathrm{EV}_S(h),\; \mathrm{EV}_H(h)\Big),
\qquad
\mathrm{EV}_H(h) \;=\; \sum_c P(c\mid h)\,\mathrm{EV}^*(h+c),
\qquad
\mathrm{EV}^*(\text{bust}) = -1 .
$$

$P(c\mid h)$ uses the shoe minus every card in $h$, so each distinct multiset of player cards has
its own dealer distribution. That is full **composition-dependent** card removal. The recursion
terminates because the hard total strictly increases. Values are memoised on the multiset $R$,
encoded as a mixed-radix integer with bounds $\lfloor 21/r\rfloor + 2$ per rank.

**Double**: one card, then stand, at twice the stake:

$$
\mathrm{EV}_D \;=\; 2\sum_c P(c\mid h)\,\mathrm{EV}_S(h+c).
$$

**Late surrender**: $\mathrm{EV}_R = -\tfrac12$ (after the peek).

**Early surrender** is decided *before* the peek, so the comparison must be on the pre-peek basis:

$$
\mathrm{EV}_{\text{pre}}(a) \;=\; -P(\mathrm{BJ}) + \big(1-P(\mathrm{BJ})\big)\,\mathrm{EV}_{\text{post}}(a)
\quad\text{vs.}\quad -\tfrac12 .
$$

### Lemma 3 (hitting dominates standing on hard ≤ 11 and soft ≤ 16)

*Proof.* Such a hand cannot bust with one more card. Standing on any total below 17 wins only if
the dealer busts, and any total of 17 or more wins at least in those cases too, so
$\mathrm{EV}_S(t') \ge D_{\text{bust}}(R+c) - \sum_{o\ge17}D_o(R+c)$ for every resulting total
$t'$. Averaging over the next card $c$, Lemma 2 says the dealer's distribution is unchanged
in expectation: $\sum_c P(c\mid R)\,D_o(R+c) = D_o(R)$. So "hit once, then stand" has EV at least
$D_{\text{bust}}(R) - \sum_{o\ge17}D_o(R) = \mathrm{EV}_S(t)$. And $\mathrm{EV}_H \ge$ "hit once, then
stand". ∎

The engine uses Lemma 3 to skip dealer computations that provably cannot change the maximum.

### Standing on 21 is always optimal

By the same argument, any hit from 21 ends at a total ≤ 21, which in expectation cannot beat
the "win unless the dealer makes 21" value of standing. So the engine never explores hitting 21.

---

## 5. Splitting

Splitting a pair $X,X$ creates hands that each start with one $X$. The engine uses the standard
combinatorial-analyzer construction.

1. **Per-hand values.** For each second card $c$, the hand $\{X,c\}$ is valued with the shoe
   minus **both** $X$'s and $c$: $\mathrm{EV}(X,c) = \max(\text{stand}, \text{hit}, \text{double if DAS})$.
   Split aces receive one card unless hitting split aces is allowed. An ace and a ten after a
   split is 21, not a natural.
2. With $p$ = probability that the second card is another $X$:
   $\bar E_{\neg X} = \frac{1}{1-p}\sum_{c\ne X}P(c)\,\mathrm{EV}(X,c)$, and
   $E_{XX}$ = the value of an $X,X$ hand that may no longer be split.
3. **Resplit chain.** Let $f(k,h) = (\text{E}[\#\text{hands finished with a non-}X\text{ card}],\;
   \text{E}[\#\text{hands finished as an unsplittable pair}])$ with $k$ one-card hands pending and
   $h$ hands in total, hand limit $H$ (for aces, $H=2$ unless resplitting aces is allowed):

$$
f(k,h) \;=\; p\cdot\begin{cases} f(k+1,\,h+1) & h<H \quad(\text{resplit})\\[2pt] f(k-1,\,h) + (0,1) & h = H \end{cases}
\;+\;(1-p)\,\big(f(k-1,\,h) + (1,0)\big),
\qquad f(0,h) = (0,0).
$$

   The potential $2(H-h)+k$ strictly decreases, so the recursion terminates.
4. With $(\bar n_{\neg X}, \bar n_{XX}) = f(2,2)$, linearity of expectation gives

$$
\mathrm{EV}_P \;=\; \bar n_{\neg X}\,\bar E_{\neg X} \;+\; \bar n_{XX}\,E_{XX}.
$$

Without resplits this reduces to $2\big[(1-p)\bar E_{\neg X} + p\,E_{XX}\big]$. For an infinite deck
the construction is **exact**, because the hands are independent and expectation is linear even though
they share the dealer's outcome. For finite shoes it ignores the cards drawn by the sister hands.
That is the usual approximation, with errors far below anything that changes a decision.

*Validation.* `tests/game.test.ts` deals 60,000 rigged 8,8 vs 10 rounds through the table
simulator, playing the engine's strategy, and checks that the mean result agrees with
$\mathrm{EV}_P$ within four standard errors.

---

## 6. From compositions to the chart

A chart cell is a **total** against an upcard, for example hard 16 vs 10. It can be dealt as
several two-card compositions $i$ (10-6 or 9-7). With the upcard removed, composition
$\{a,b\}$ is dealt with probability $w \propto 2n_an_b$ (or $n_a(n_a-1)$ for a pair). The cell
EV is the mixture

$$
\mathrm{EV}_{\text{cell}}(a) \;=\; \frac{\sum_i w_i\,\mathrm{EV}_i(a)}{\sum_i w_i},
\qquad
\text{chart play} \;=\; \arg\max_a \mathrm{EV}_{\text{cell}}(a).
$$

This is **total-dependent** basic strategy: one play per total, the standard chart. The codes
`Dh`/`Ds` and `Rh`/`Rs`/`Rp` give the best play when doubling or surrender is not available. The
engine reports the runner-up action among the remaining options. Hands of three or more cards use
the same row with only hit and stand available.

The decision **margin** shown in the "What is at stake" view is
$\mathrm{EV}_{\text{cell}}(\text{best}) - \mathrm{EV}_{\text{cell}}(\text{second best})$.

*Validation.* `tests/strategy.test.ts` reproduces the published 4–8 deck S17/DAS/LS chart cell
for cell. It also checks the well-known H17 changes (double 11 v A, surrender 15 v A and 17 v A,
double A7 v 2 and A8 v 6, surrender 8,8 v A) and single-deck classics (double 8 v 5–6,
stand 7,7 v 10).

---

## 7. The house edge

Let $\beta = P(\text{dealer BJ}\mid u, a, b)$, which is 0 unless $u\in\{A,T\}$. For a peek game,

$$
\mathrm{EV} \;=\; \sum_u P(u)\sum_{\{a,b\}} P(a,b\mid u)\cdot
\begin{cases}
(1-\beta)\,b & \{a,b\} = \{A,T\}\ \ (\text{natural; pushes a dealer natural})\\[2pt]
-\beta + (1-\beta)\,\mathrm{EV}_{\{a,b\}}\big(\text{chart play of its cell}\big) & \text{otherwise.}
\end{cases}
$$

The house edge is $-\mathrm{EV}$. (For ENHC the EVs are already unconditional, and the second case
is just $\mathrm{EV}_{\{a,b\}}$.)

**The blackjack payout enters linearly.** No playing decision depends on $b$, so

$$
\frac{\partial\,\text{house edge}}{\partial b} \;=\; -P(\text{player natural},\ \text{dealer none}) \approx -0.045 .
$$

Changing 3:2 to 6:5 ($\Delta b = -0.3$) therefore costs about $0.3 \times 4.5\% \approx 1.36\%$ of
every bet. That is more than the entire house edge of a good six-deck game. The test suite checks
this identity exactly.

*Validation.* House-edge deltas match published rule effects: H17 about +0.2%, late surrender about
−0.08% in a six-deck S17 game, ENHC worse than peek, and early surrender much better than late. A 150,000-round
Monte Carlo through the table simulator agrees with the exact house edge within four standard errors.

---

## 8. Card counting

### 8.1 Effects of removal and betting correlation

Removing one card of rank $r$ from the shoe changes the player's edge by $e_r$ (the **effect of
removal**). The engine computes it by re-solving the whole game with that card removed. To first
order, the edge of a depleted shoe is

$$
\text{edge} \;\approx\; \text{edge}_0 + \sum_{\text{cards removed}} e_r .
$$

A counting system with tags $t_r$ is a linear proxy for that sum. Its **betting correlation** is
the cosine similarity (tens weighted ×4)

$$
\mathrm{BC} \;=\; \frac{\sum_r w_r t_r e_r}{\sqrt{\sum_r w_r t_r^2 \,\sum_r w_r e_r^2}} ,
$$

which the lesson page computes live. For Hi-Lo with typical rules it comes out at about 0.96 to 0.97.

### 8.2 True count

For a balanced count ($\sum_r t_r n_r = 0$ over a full shoe), the unseen cards' tags sum to
$-\mathrm{RC}$. With $D$ decks unseen, the surplus of high cards **per deck** is $\mathrm{RC}/D$. Draw
probabilities, and so every EV, depend on the composition per deck, not on the absolute surplus:
removing the same proportion from every rank leaves every probability unchanged. Hence

$$
\mathrm{TC} = \frac{\mathrm{RC}}{D}
$$

is the right statistic, and indices can be stated in true count independent of depth (to first
order).

The app's representative shoe at true count TC and $D$ decks scales the low cards (2–6) by
$1 - \tfrac{\mathrm{TC}}{40}$ and the high cards (T, A) by $1 + \tfrac{\mathrm{TC}}{40}$, which produces
exactly that Hi-Lo true count. The engine accepts fractional counts because the falling factorials
remain well defined.

### 8.3 Insurance

Insurance is a side bet of half the stake that pays 2:1 when the hole card is a ten. If a
fraction $p$ of the unseen cards are tens,

$$
\mathrm{EV}_{\text{ins}} \;=\; 2p - (1-p) \;=\; 3p - 1 \;>\; 0 \iff p > \tfrac13 .
$$

In a fresh six-deck shoe (dealer's ace and two non-ten player cards out), $p = 96/309 \approx 0.311$,
so insurance loses about 6.8% of the amount insured. In the representative shoe,
$p = \tfrac{16}{52}\big(1+\tfrac{\mathrm{TC}}{40}\big)$, which reaches $\tfrac13$ at $\mathrm{TC} = 40/12 \approx 3.3$.
That is the origin of the "+3" insurance index.

### 8.4 Index plays

For two candidate plays $a$ and $b$, the index is the true count at which
$\mathrm{EV}_a(\mathrm{TC}) = \mathrm{EV}_b(\mathrm{TC})$. The lessons page solves the hand exactly at each
count and marks the crossing. For 16 vs 10 the exact crossing is at about TC 0, matching the
published index. The grader uses the published Illustrious 18 and Fab 4 indices (Hi-Lo,
multi-deck) and accepts either play within ±0.5 of an index.

### 8.5 Bet sizing

Maximising $\mathbb{E}[\log(\text{bankroll})]$ for a bet with edge $\mu$ and variance $\sigma^2$
gives the Kelly fraction $f^* \approx \mu/\sigma^2$. For blackjack $\sigma^2 \approx 1.3$, so a 1% edge
calls for a bet of about 0.77% of the bankroll. The report card's **expected result** uses
$\text{edge} \approx -\text{house edge} + 0.5\%\times\mathrm{TC}$ per round in counting sessions,
minus the EV the player gave up through mistakes. "Luck" is the remainder.

---

## 9. Validation summary

| Test file | What it checks |
|---|---|
| `dealer.test.ts` | Multiset formula = brute force (1e-12); infinite-deck bust table; dealer tree consistency |
| `bruteforce.test.ts` | Stand/hit/double EVs = independent brute force with explicit hole-card conditioning (1e-10), ∞/1/2 decks, S17/H17 |
| `strategy.test.ts` | Published 6-deck chart cell for cell; H17 and single-deck changes; house-edge rule effects; resplit chain; rule-matrix smoke tests |
| `game.test.ts` | Settlement (3:2, 6:5, peek, ENHC lose-all, surrender, insurance, split aces); 150k-round house-edge simulation; rigged split simulation |
| `logic.test.ts` | Proof tables reproduce the headline EVs; balanced counts; representative shoes; deviation and insurance grading; report card; coaching latency |

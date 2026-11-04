# Blackjack Lab — Design Plan

This document is the plan for the site: what it looks like, how it is organised, and how every
requirement in [`App Specifications.md`](../App%20Specifications.md) maps onto a screen.

---

## 1. Product summary

**Blackjack Lab** is a single-page web app that teaches blackjack in three stages:

1. **Basic strategy.** An interactive, rule-aware strategy chart in which every cell opens a full
   expected-value (EV) derivation. A fill-in-the-grid quiz and a table trainer go with it.
2. **Card counting.** Lessons with interactive widgets, speed drills, a "watch the table and count"
   mode, and a "play while counting" mode graded on count accuracy, basic strategy and index
   deviations.
3. **Playing.** A bankroll game with an optional live coach and a report card after each session.

Every number in the app comes from one exact combinatorial engine (`src/engine`). The engine is
driven by a single **Rules** object, so changing a rule (3:2 → 6:5, surrender on/off, H17, decks,
DAS…) changes the chart, the proofs, the house edge, the trainer's answer key and the coach at the
same time.

---

## 2. Sitemap

```
Home ─┬─ Strategy ─┬─ Chart (Spec BS-1)            #/strategy
      │            ├─ Grid Quiz (BS-2)             #/strategy/quiz
      │            └─ Table Trainer (BS-3)         #/strategy/trainer
      ├─ Counting ─┬─ Learn (CC-1)                 #/counting/learn
      │            ├─ Drills (CC-1 practice)       #/counting/drills
      │            ├─ Watch & Count (CC-2)         #/counting/watch
      │            └─ Count & Play (CC-3 / 3b)     #/counting/play
      ├─ Play ─────┬─ Casino (P-1)                 #/play
      │            └─ Report cards                 #/reports
      ├─ Rules Lab (house-edge calculator)         #/rules
      └─ The Math (in-app proofs)                  #/math
```

The **rules bar** sits below the top navigation on every page. It shows the active rules as chips,
for example `6 decks · S17 · DAS · Late surrender · BJ 3:2`, plus the live house edge. **Edit rules**
opens the rules dialog.

---

## 3. Visual language

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0c1411` | App background (near-black green) |
| `--panel` | `#131d19` | Cards, drawers, dialogs |
| `--felt` | radial `#1b6b47 → #0f4a31` | Blackjack table surface |
| `--gold` | `#d9b45a` | Brand accent, focus rings, active nav |
| `--text` / `--muted` | `#e9f1ec` / `#97aba0` | Body copy / secondary |
| Hit | green `#3f9d58` | Strategy cells and buttons |
| Stand | red `#d2504a` | 〃 |
| Double | gold `#e1a731` | 〃 |
| Split | blue `#3f7fd6` | 〃 |
| Surrender | slate `#7d8a99` | 〃 |

* Every strategy cell always shows its letter code (`H`, `S`, `Dh`, `Ds`, `P`, `Rh`, …) as well as
  its colour, so the chart works for colour-blind users.
* Cards are drawn in CSS/SVG with no image assets: white face, red or black suits, a patterned back.
* Numbers use `font-variant-numeric: tabular-nums`. EVs are shown to 4 decimals, edges in %.
* Layouts are responsive. The table collapses to the dealer plus the player's seat on narrow
  screens, and the chart scrolls horizontally with a sticky first column.
* All actions have keyboard shortcuts: `H` hit, `S` stand, `D` double, `P` split, `R` surrender,
  `N` decline insurance (`Y` take it), `Space` deal / next.

---

## 4. Screens

### 4.1 Home

```
┌──────────────────────────────────────────────────────────────────────┐
│ ♠ Blackjack Lab   Strategy ▾  Counting ▾  Play ▾  Rules Lab  Math   │
├──────────────────────────────────────────────────────────────────────┤
│ 6 decks · S17 · DAS · LS · 3:2          House edge 0.36%  [Edit]    │
├──────────────────────────────────────────────────────────────────────┤
│  Learn the math. Master the count.                                   │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐               │
│  │ 1 Basic       │ │ 2 Card        │ │ 3 Play for    │               │
│  │   strategy    │ │   counting    │ │   (fake) money│               │
│  │ Chart · Quiz  │ │ Learn · Drill │ │ Casino · Coach│               │
│  │ Trainer       │ │ Watch · Play  │ │ Report cards  │               │
│  └───────────────┘ └───────────────┘ └───────────────┘               │
│  Your progress: quiz best 97% · trainer streak 41 · count acc. 92%   │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 Strategy chart (BS-1)

```
┌─────────────────────────────────────────────┬───────────────────────────┐
│ [Hard] [Soft] [Pairs]   ☐ show EV ☐ margins │  HARD 16 vs 10  (drawer)  │
│        2   3   4   5   6   7   8   9   T  A │  Composition: [10-6] 9-7  │
│  H 8   H   H   H   H   H   H   H   H   H  H │  ┌─────────────────────┐  │
│  H 9   H   D   D   D   D   H   H   H   H  H │  │ Surrender −0.5000 ★ │  │
│  ...                                        │  │ Hit       −0.5398   │  │
│  H16   S   S   S   S   S   H   H   Rh [Rh] Rh│  │ Stand     −0.5404   │  │
│  H17   S   S   S   S   S   S   S   S   S  S │  └─────────────────────┘  │
│                                             │  Why: dealer outcomes …   │
│ Legend: H hit · S stand · Dh double/hit …   │  EV(Stand) = P(bust) − …  │
│                                             │  EV(Hit) = Σ P(c)·EV*(…)  │
│                                             │  [table of next cards]    │
│                                             │  Dealer tree explorer ▸   │
└─────────────────────────────────────────────┴───────────────────────────┘
```

* **Cells** are coloured by the best action. The *margins* heat-map shades each cell by how close
  the decision is (EV gap between the best and second-best play).
* **Clicking a cell** opens the proof drawer:
  1. An EV bar for every legal action, with the best one starred and its edge over the runner-up in
     % of the bet, plus what that means in dollars per 100 hands at the current unit size.
  2. The **composition selector**: a total such as hard 16 can be dealt as 10-6 or 9-7. The cell
     value is the probability-weighted average, and each composition has its own exact derivation.
  3. **Stand proof**: the dealer's final-total distribution (conditioned on no dealer blackjack when
     the dealer peeks), then `EV = P(win) − P(lose)` with every term filled in.
  4. **Hit proof**: a table with one row per possible next card: probability, resulting hand, the
     optimal continuation and its EV, and the weighted sum. Rows drill down recursively.
  5. **Double proof**: `2 × Σ P(c)·EV_stand(hand + c)`.
  6. **Split proof**: the per-hand EV for each second card, the resplit Markov chain (expected
     number of hands) and the total.
  7. **Surrender**: `−½` (with the early-surrender variant explained).
  8. **Dealer tree explorer**: an expandable tree of dealer draws showing where `P(bust)` comes from.

### 4.3 Grid quiz (BS-2)

The same grid as the chart, but blank. The user picks an action from the palette (or presses the
`H/S/D/P/R` keys) and then clicks or drags to paint cells. Arrow keys move the cursor.
**Check** grades every cell (✓ / ✗ with the correct answer), shows accuracy and time, and links each
mistake to its proof. Scope can be *whole chart*, *hard*, *soft* or *pairs*. Strict mode also
requires the fallback codes (`Dh` vs `Ds`, `Rh/Rs/Rp`). Per-cell history feeds a "weak spots"
heat-map.

### 4.4 Table (shared by Trainer, Watch & Count, Count & Play, Casino)

```
┌───────────────────────────────────────────────────────────────────────┐
│  [discard ▤▤]              DEALER  (K ♠) (▒▒)               [shoe ▥]  │
│                                 17                                    │
│      ╭───────╮   ╭───────╮   ╭───────╮   ╭───────╮   ╭───────╮        │
│      │ Ava   │   │ Ben   │   │  YOU  │   │ Cleo  │   │ Dev   │        │
│      │ 9♦ 7♣ │   │ A♥ 6♠ │   │ 10♠ 6♥│   │ 5♣ 5♦ │   │ Q♣ K♦ │        │
│      │  $25  │   │  $10  │   │  $50  │   │  $25  │   │ $100  │        │
│      ╰───────╯   ╰───────╯   ╰───────╯   ╰───────╯   ╰───────╯        │
├───────────────────────────────────────────────────────────────────────┤
│  [Hit H] [Stand S] [Double D] [Split P] [Surrender R]     Bankroll $  │
├──────────────────────────────┬────────────────────────────────────────┤
│ Coach: "Surrender. Hitting   │  Count: RC +4 · decks left 3.5 · TC +1 │
│ 16 v 10 loses 54% of a bet." │  (hidden unless the mode allows it)    │
└──────────────────────────────┴────────────────────────────────────────┘
```

* **Table Trainer (BS-3).** One seat against the dealer. After every decision the user gets
  ✓ / ✗, the correct play and the EV cost, with a *Why?* link into the proof drawer. Options:
  hand filter (all, hard, soft, pairs, stiffs, doubles, my weak spots), decision-only fast mode,
  and streak and accuracy counters.
* **Watch & Count (CC-2).** One to six simulated players play at a chosen speed (pause, step, 0.5×
  to 4×). The user only counts. Count checks pop up every round, every N rounds, at random or at the
  end of the shoe, and ask for the running count and true count with exact feedback.
* **Count & Play (CC-3 / 3b).** The user takes a seat among the bots, bets and plays while counting.
  Count checks as above. Each decision is graded against basic strategy, and in *3b* against
  Hi-Lo index deviations (Illustrious 18 + Fab 4) using the true count at that moment, with a
  ±0.5 grace band near an index. A report card follows.
* **Casino (P-1).** A bankroll and table limits. The live coach can be *Off*, *On request* (Hint
  button), *Warn on mistakes* or *Always on* (shows the recommended play and EVs before each
  decision). Insurance and even-money offers are included. The report card can be opened at any time
  and is saved when the session ends.

### 4.5 Counting: Learn (CC-1) and Drills

Lessons are short pages with an interactive widget each:

1. Why counting works (effects of removal computed live by the engine).
2. The Hi-Lo tags (tag drill).
3. Running count (flash-card widget).
4. True count (formula, discard-tray estimation, conversion drill).
5. Betting with the count (edge ≈ ½ % per true count, ramp, bankroll and risk).
6. Playing deviations (Illustrious 18, Fab 4, and the exact insurance proof `EV = 3·P(ten) − 1`).
7. Putting it together (a guided path through the practice modes).

Drills: card tags, running-count flash (speed and length adjustable), deck count-down (timed),
true-count conversion, and hand-group cancellation. Other counting systems (KO, Hi-Opt I/II,
Omega II, Zen, Wong Halves) can be selected for counting practice. Deviations use Hi-Lo.

### 4.6 Report card

```
┌ Session report — Casino — 3 Nov 2026 ─────────────────────── Grade A− ┐
│ Hands 212 · Wagered $6,350 · Net +$185 · Expected −$22 (luck +$207)   │
│ Decisions 96.8% correct (205/212) · EV lost to mistakes −$41.30       │
│ ┌ By category ┐  hard 98% · soft 91% · pairs 100% · doubles 94%       │
│ Biggest mistakes: A7 v 9 stood (−0.183 units) · 12 v 3 stood (−0.019) │
│ Counting: 14 checks, 12 exact, mean abs error 0.4 · Deviations 8/9    │
└───────────────────────────────────────────────────────────────────────┘
```

### 4.7 Rules Lab

All the rules sit next to the exact house edge, along with each rule's marginal cost relative to
the current rules (for example *6:5 instead of 3:2: +1.36 %*, *H17: +0.2 %*). A diff view lists
the chart cells that change when one rule is toggled.

### 4.8 The Math

An in-app version of [`MATH.md`](MATH.md) with rendered formulas: the dealer distribution theorem,
the player Bellman equations, splits, peek conditioning, the house-edge sum, the true-count argument
and the insurance proof.

---

## 5. Rules supported

| Rule | Options |
|---|---|
| Decks | 1, 2, 4, 5, 6, 8, ∞ (infinite / continuous shuffle) |
| Dealer soft 17 | Stands (S17) / Hits (H17) |
| Blackjack pays | 3:2, 7:5, 6:5, 1:1 |
| Surrender | None / Late / Early |
| Double on | Any two cards / 9–11 / 10–11 |
| Double after split | Yes / No |
| Max hands from splitting | 2, 3, 4 |
| Resplit aces / hit split aces | Yes / No each |
| Dealer hole card | Peek for blackjack (US) / no hole card (ENHC: lose all to a dealer BJ) |
| Penetration (table modes) | 50 %–90 % |

---

## 6. Architecture

```
src/
  engine/            pure TypeScript, no DOM; unit-tested
    cards.ts         ranks, shoes, card objects
    rules.ts         Rules type, presets, labels, hashing
    hand.ts          totals, softness, blackjack, row classification
    dealer.ts        dealer final-total distribution (exact, multiset formula)
    ev.ts            player EV engine (stand/hit/double/split/surrender, peek-conditioning)
    strategy.ts      full chart (composition-weighted cells), lookups, fallbacks
    houseEdge.ts     exact expectation of a round, rule-effect deltas
    explain.ts       proof objects for the UI (per-action term tables, dealer tree)
    counting.ts      counting systems, true count
    deviations.ts    Illustrious 18 / Fab 4 with grading logic
    game.ts          table state machine (shoe, seats, splits, insurance, settlement)
    bots.ts          simulated players
    rng.ts           seeded RNG and shuffling
  worker/            Web Worker that hosts the engine (keeps the UI at 60 fps)
  state/             rules and preferences context, persistence (localStorage)
  components/        Card, Hand, Chip, Table, StrategyGrid, ProofDrawer, TeX, …
  pages/             one file per route
tests/               Vitest: dealer tables, EVs, chart, house edge, game engine
```

* **Engine in workers.** Computing a full chart is a few hundred thousand exact sub-problems, so
  a Web Worker computes it and caches it per rules hash (in memory and in `localStorage`). A second
  *batch* worker runs the long multi-solve jobs (rule effects, edge vs. count, effects of removal,
  index curves), so they never queue in front of an interactive request such as opening a proof.
* **Preferences** (⚙ in the rules bar): bet unit for money figures, animation speed, counting
  system, keyboard hints, reduced motion, and a full progress reset.
* **No server.** The app is a static site (`npm run build` → `dist/`) and can be hosted anywhere.
* **Persistence.** Rules, preferences, quiz history, per-cell accuracy and session reports are
  kept in `localStorage`.

---

## 7. Mathematical approach (summary; full proofs in [`MATH.md`](MATH.md))

* **Dealer distribution**: exact for a finite shoe without replacement. The probability of a
  draw sequence depends only on its multiset, so each upcard's terminal dealer hands are enumerated
  once (with counts of valid orderings) and evaluated for any shoe with falling factorials.
* **Player EV**: the Bellman recursion `EV*(h) = max(EV_stand, Σ_c P(c)·EV*(h+c))` over exact
  card-removal states (composition-dependent), with doubling, surrender and splitting at the root.
* **Peek**: values are computed as `E[payoff · 1{no dealer BJ}]` and divided by `P(no BJ)`. This
  is exact and includes the effect of the hole card on the player's own draws.
* **Splits**: the standard CA approximation. A per-hand EV comes from the shoe with both pair cards
  removed, combined with an exact Markov chain for resplits up to the hand limit.
* **Cells**: a total such as hard 16 is a probability-weighted mixture of its 2-card compositions.
  The action that maximises the mixture is the total-dependent basic-strategy play.

---

## 8. Spec traceability

| Spec item | Where |
|---|---|
| BS-1 interactive grid + EV proofs | Strategy chart + proof drawer |
| BS-2 fill the grid | Grid quiz |
| BS-3 simulated table quiz | Table trainer |
| CC-1 learn to count | Counting → Learn + Drills |
| CC-2 watch simulated players | Watch & Count |
| CC-3 play with simulated players, assessed on count + BS | Count & Play (assessment: count checks, decisions) |
| CC-3b assessed on deviations at high/low counts | Count & Play with *Deviations* on |
| P-1 bankroll, optional live coach, report card | Casino + Report cards |
| Rule variations (3:2 / 6:5, surrender, …) | Rules dialog, used by every page |
| Math code + proofs | `src/engine`, `docs/MATH.md`, in-app proof drawer and *The Math* page |

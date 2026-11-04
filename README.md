# ♠ Blackjack Lab

**Learn the math. Master the count.** Blackjack Lab is a basic-strategy and card-counting
trainer that shows its work. Every play in the strategy chart opens a step-by-step expected-value
proof computed exactly for your table's rules. You can practise the count against simulated
players and take a bankroll to the tables with a live coach.

Everything runs in the browser. A combinatorial engine computes exact card-removal EVs in a Web
Worker, with no server and no precomputed tables.

## Features

| Area | What you get |
|---|---|
| **Strategy chart** (spec BS-1) | Rule-aware chart. Click any cell to see the EV of every play and a full derivation: dealer outcome table, hit/double tables with recursive drill-down, the split Markov chain, surrender, composition weighting, and a dealer-draw tree explorer. Views: plays, plays + EV, "what is at stake" (decision margin heat-map), and your weak spots. |
| **Grid quiz** (BS-2) | Fill in the whole chart (or one section) by painting or by keyboard. Strict mode also requires the fallback codes (Dh/Ds, Rh/Rs/Rp). Graded cell by cell, with links to each proof and a history of attempts. |
| **Table trainer** (BS-3) | A live table with instant grading and the EV cost of each mistake. Hand filters: natural deal, hard, soft, pairs, stiffs, doubles, surrender spots, close calls, your weak spots. Optional fast "first decision only" mode. |
| **Learn to count** (CC-1) | Seven lessons with live widgets: effects of removal and Hi-Lo betting correlation (engine-computed), tag drill, running and true count, exact edge-vs-true-count chart, index-play curves showing where each index comes from, and the insurance proof. |
| **Drills** | Card tags, running-count flash cards, deck countdown, true-count conversion, hand-group cancellation. Hi-Lo, KO, Hi-Opt I/II, Omega II, Zen and Wong Halves. |
| **Watch & count** (CC-2) | One to six simulated players (basic-strategy players, tourists, counters) at 0.5–4× speed, with count checks every round, every three rounds, at random, or at the end of the shoe. |
| **Count & play** (CC-3 / 3b) | Play at the table while counting. You're graded on count checks and basic strategy and, with deviations on, on the Illustrious 18 + Fab 4 at the live true count. Report card at the end. |
| **Casino** (P-1) | A practice bankroll and table limits. The live coach can be off, on request, warn-on-mistakes (intercepts a costly play), or always on (shows the recommended play and exact EVs for the actual shoe). Report card with grade, EV lost to mistakes, and luck vs. skill. |
| **Rules lab** | Exact house edge for any rules, the exact value of every individual rule (each variant re-solved), cost per hour, and a strategy diff between any two rule sets. |
| **The math** | All the proofs, in the app and in [`docs/MATH.md`](docs/MATH.md). |

**Rule variations:** 1, 2, 4, 5, 6, 8 or infinite decks · S17/H17 · blackjack pays 3:2, 7:5, 6:5 or
1:1 · no, late or early surrender · double on any two, 9–11 or 10–11 · DAS on/off · split to 2/3/4
hands · resplit aces · hit split aces · US peek or European no-hole-card · penetration.

## Quick start

Requires Node.js 20+.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine, simulator and grading tests (about a minute)
npm run build      # static site in dist/ (deploy anywhere, e.g. GitHub Pages)
npm run preview    # serve the production build
```

The app uses hash routing and a relative base path, so `dist/` works from any static host or
sub-path.

## How the numbers are computed

* **Dealer probabilities**: exact for a finite shoe. The probability of a draw sequence depends only
  on its multiset, so each upcard's terminal dealer hands are enumerated once and then evaluated
  for any shoe with falling factorials.
* **Player EVs**: Bellman recursion over exact card-removal states (composition-dependent), with
  stand, hit, double, split (exact resplit Markov chain) and surrender.
* **The dealer peek** is handled exactly by computing `E[payoff · 1{no dealer BJ}]`. That includes the
  effect of the hidden hole card on your own draws.
* **The chart**: each total is the probability-weighted mixture of its two-card compositions,
  which gives total-dependent basic strategy.

The engine is checked against brute force (to 1e-10 or better), the published infinite-deck dealer
table, the published 6-deck chart (cell for cell), published rule effects, and Monte Carlo
simulation through the table engine. See [`docs/MATH.md`](docs/MATH.md) for the derivations and
proofs.

## Project layout

```
src/
  engine/       pure TypeScript math and game logic (no DOM)
    dealer.ts     dealer distribution (multiset formula), dealer tree
    ev.ts         player EV engine + proof explanations
    strategy.ts   chart construction, house edge, advice lookups
    counting.ts   counting systems, true count, representative shoes
    deviations.ts Illustrious 18 / Fab 4 and grading
    game.ts       step-driven table simulator; bots.ts = simulated players
  worker/       Web Worker hosting the engine + promise client and React hooks
  table/        table controller hook, table UI, session table, report card
  components/   chart grid, proof drawer, charts (SVG), KaTeX, cards, UI kit
  pages/        one file per route
  state/        rules/preferences context, progress persistence (localStorage)
tests/          Vitest suites
docs/           DESIGN.md (plan), MATH.md (proofs)
```

## Documents

* [`App Specifications.md`](App%20Specifications.md): the original requirements.
* [`docs/DESIGN.md`](docs/DESIGN.md): the plan (sitemap, screens, visual language, architecture).
* [`docs/MATH.md`](docs/MATH.md): the mathematics, with proofs.

## License

MIT. See [LICENSE](LICENSE). Practice money only. Card counting with your own brain is legal, but
casinos may refuse your action.

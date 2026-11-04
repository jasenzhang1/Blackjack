# App Specifications

> **Goal:** Create a website that a user can practice basic strategy and card counting.

---

## Basic Strategy

| # | Feature |
|---|---------|
| **1** | They can look at the basic strategy grid and it's interactive in the sense that the user can expand the cell and see mathematical proofs for the EV for each play. This helps the user understand why and to what extent a play is better. |
| **2** | The user can quiz themselves by filling in the entire basic strategy grid. |
| **3** | The user can simulate a real blackjack table against the dealer and quiz themselves on making the correct basic strategy decision. |

## Card Counting

| # | Feature |
|---|---------|
| **1** | The user learns how to card count. |
| **2** | The user gets to practice card counting by watching simulated people play. |
| **3** | The user gets to practice card counting by playing with simulated people. They get assessed on their card counting and basic strategy play. |
| **3b** | Everything in Feature 3, and the user gets assessed on deviating from basic strategy when the remainder of the deck is high count or low count. |

## Playing

| # | Feature |
|---|---------|
| **1** | The user gets a bankroll and plays blackjack. They may choose to get a live coach or not. They may also choose to look at their report card after the session. |

---

## Additional requirements (from the build request)

- Rule variations must be supported, e.g. blackjack paying **3:2 vs 6:5**, **surrender allowed or not**, and the other common table rules.
- The mathematical code and the proofs behind every expected-value (EV) figure must be written out.
- Other features that make the trainer better are welcome.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the plan and [`docs/MATH.md`](docs/MATH.md) for the mathematics.

/**
 * Short phrases for memorizing the chart. Written for 4–8 decks with double after split and late
 * surrender (the usual casino game); notes call out where "dealer hits soft 17" changes a play.
 */
const SECTIONS: { title: string; tricks: { phrase: string; detail: string }[] }[] = [
  {
    title: 'Pairs',
    tricks: [
      { phrase: 'Always split aces and eights.', detail: 'Two hands starting at 11 beat soft 12, and 16 is the worst total you can hold. (H17: surrender 8,8 vs A if you can.)' },
      { phrase: 'Never split tens or fives.', detail: '20 already wins. 5,5 is a hard 10: double vs 2–9.' },
      { phrase: 'Nines split, except vs 7, 10 and A.', detail: 'Stand there: your 18 already beats the 17 the dealer likely makes with a 7.' },
      { phrase: 'Twos, threes and sevens split through 7.', detail: 'Split vs 2–7, hit vs 8 and up.' },
      { phrase: 'Sixes split vs 2–6.', detail: 'The dealer’s weak cards. Hit vs 7 and up.' },
      { phrase: 'Fours split only vs 5 and 6.', detail: 'Otherwise hit.' },
      { phrase: 'No double after split? Split less.', detail: '2s and 3s only vs 4–7, 6s only vs 3–6, 4s never.' },
    ],
  },
  {
    title: 'Soft totals',
    tricks: [
      { phrase: 'Soft 19 and 20 stand.', detail: '(H17: double A,8 vs 6.)' },
      { phrase: 'Soft 18: double 3–6, stand 2, 7, 8, hit 9–A.', detail: '(H17: double vs 2 too.)' },
      { phrase: 'Soft doubles widen as the hand grows.', detail: 'A,2–A,3 double vs 5–6. A,4–A,5 vs 4–6. A,6–A,7 vs 3–6. Otherwise hit.' },
    ],
  },
  {
    title: 'Hard totals',
    tricks: [
      { phrase: '17 and up, always stand.', detail: '(H17: surrender 17 vs A if you can.)' },
      { phrase: '13–16: stand vs 2–6, hit vs 7–A.', detail: 'A dealer 2–6 is the one that busts most.' },
      { phrase: '12: stand vs 4–6 only.', detail: 'Hit vs 2 and 3.' },
      { phrase: '11: double vs everything but an ace.', detail: '(H17: double vs A too.)' },
      { phrase: '10: double vs 2–9.  9: double vs 3–6.', detail: '8 or less: always hit.' },
      { phrase: 'Surrender 16 vs 9, 10, A and 15 vs 10.', detail: '(H17: also 15 vs A.) Where surrender isn’t offered, hit.' },
    ],
  },
];

export function MemoryTricks() {
  return (
    <div className="panel stack">
      <div className="tricks">
        {SECTIONS.map((s) => (
          <div key={s.title} className="stack" style={{ gap: 8 }}>
            <h4 style={{ margin: 0 }}>{s.title}</h4>
            {s.tricks.map((t) => (
              <div key={t.phrase}>
                <strong>{t.phrase}</strong> <span className="muted small">{t.detail}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

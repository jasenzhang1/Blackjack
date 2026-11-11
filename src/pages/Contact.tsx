const REPO = 'https://github.com/jasenzhang1/Blackjack';

const TOPICS: { label: string; title: string }[] = [
  { label: 'Report a Bug', title: 'Bug: ' },
  { label: 'Suggest a Feature', title: 'Idea: ' },
  { label: 'General Feedback', title: 'Feedback: ' },
];

export default function Contact() {
  return (
    <main className="page narrow-page">
      <h1>Contact</h1>
      <div className="panel stack">
        <p>Found a bug or have an idea? Send it over.</p>
        <div className="row">
          {TOPICS.map((t) => (
            <a key={t.label} className="btn" href={`${REPO}/issues/new?title=${encodeURIComponent(t.title)}`} target="_blank" rel="noreferrer">
              {t.label}
            </a>
          ))}
        </div>
      </div>
    </main>
  );
}

import { SUIT_NAME, SUIT_SYMBOL, isRed, makeCard, type Card, type Rank } from '../engine/cards';
import { handValue, isBlackjack } from '../engine/hand';

export function PlayingCard({ card, faceDown = false, size, dim, animate }: { card?: Card | null; faceDown?: boolean; size?: 'xs' | 'sm' | 'lg'; dim?: boolean; animate?: boolean }) {
  const cls = ['pcard', size ?? '', dim ? 'dim' : '', animate ? 'deal-in' : ''];
  if (!card) return <div className={[...cls, 'ghost'].join(' ')} aria-hidden />;
  if (faceDown) return <div className={[...cls, 'back'].join(' ')} role="img" aria-label="Face-down card" />;
  const red = isRed(card.suit);
  const sym = SUIT_SYMBOL[card.suit];
  const face = card.face === 'J' || card.face === 'Q' || card.face === 'K';
  return (
    <div className={[...cls, red ? 'red' : ''].join(' ')} role="img" aria-label={`${card.face} of ${SUIT_NAME[card.suit]}`}>
      <div className="corner tl">
        <span>{card.face}</span>
        <span className="s">{sym}</span>
      </div>
      <div className={`pip ${face ? 'face' : ''}`}>{face ? <span>{card.face}</span> : sym}</div>
      <div className="corner br">
        <span>{card.face}</span>
        <span className="s">{sym}</span>
      </div>
    </div>
  );
}

/** A row of overlapping cards with an optional total badge. */
export function HandView({
  cards,
  holeDown = false,
  size,
  showTotal = true,
  spread = false,
  animateFrom = Infinity,
}: {
  cards: Card[];
  holeDown?: boolean;
  size?: 'xs' | 'sm' | 'lg';
  showTotal?: boolean;
  spread?: boolean;
  animateFrom?: number;
}) {
  const visible = holeDown ? cards.slice(0, 1) : cards;
  const ranks = visible.map((c) => c.rank);
  const v = handValue(ranks);
  const bj = !holeDown && isBlackjack(ranks);
  return (
    <div className="stack" style={{ alignItems: 'center', gap: 6 }}>
      <div className={`hand ${spread ? 'spread' : ''}`}>
        {cards.map((c, i) => (
          <PlayingCard key={c.id} card={c} faceDown={holeDown && i === 1} size={size} animate={i >= animateFrom} />
        ))}
      </div>
      {showTotal && cards.length > 0 && (
        <span className={`total-badge ${v.total > 21 ? 'bust' : ''} ${bj ? 'bj' : ''}`}>{bj ? 'BJ' : v.total > 21 ? `Bust ${v.total}` : v.soft ? `${v.total - 10}/${v.total}` : v.total}</span>
      )}
    </div>
  );
}

/** Small static cards for ranks (proof tables, drills). */
export function RankCards({ ranks, size = 'xs', seed = 1 }: { ranks: Rank[]; size?: 'xs' | 'sm' | 'lg'; seed?: number }) {
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  const cards = ranks.map((r, i) => ({ ...makeCard(r, rand), id: i }));
  return (
    <div className="hand">
      {cards.map((c) => (
        <PlayingCard key={c.id} card={c} size={size} />
      ))}
    </div>
  );
}

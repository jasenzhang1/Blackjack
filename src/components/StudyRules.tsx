import { DECK_OPTIONS, PAYOUT_OPTIONS, PRESETS, decksLabel, rulesKey, type Rules } from '../engine/rules';
import { useSettings } from '../state/settings';
import { Seg } from './ui';

/**
 * Inline "what game am I studying?" panel for the strategy pages. Changing a setting re-solves the
 * chart, the quiz answer key and the trainer for exactly those rules (and is remembered).
 */
export function StudyRules({ note }: { note?: string }) {
  const { rules, setRules, openRules } = useSettings();
  const set = (p: Partial<Rules>) => setRules({ ...rules, ...p });
  const preset = PRESETS.find((p) => rulesKey(p.rules) === rulesKey(rules));
  return (
    <div className="panel tight no-print" style={{ marginBottom: 14 }}>
      <div className="row between" style={{ marginBottom: 8 }}>
        <strong>Study settings</strong>
        <div className="row tight">
          <select
            aria-label="Preset"
            value={preset?.id ?? ''}
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) setRules({ ...p.rules, penetration: rules.penetration });
            }}
          >
            <option value="" disabled>
              Custom rules
            </option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={openRules}>
            All rules…
          </button>
        </div>
      </div>
      <div className="row" style={{ gap: '10px 16px' }}>
        <label className="field">
          Decks
          <select value={Number.isFinite(rules.decks) ? rules.decks : 'inf'} onChange={(e) => set({ decks: e.target.value === 'inf' ? Infinity : Number(e.target.value) })}>
            {DECK_OPTIONS.map((d) => (
              <option key={String(d)} value={Number.isFinite(d) ? d : 'inf'}>
                {decksLabel(d)}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          Soft 17
          <Seg value={rules.hitSoft17 ? 'h' : 's'} onChange={(v) => set({ hitSoft17: v === 'h' })} options={[{ value: 's', label: 'S17' }, { value: 'h', label: 'H17' }]} />
        </div>
        <div className="field">
          Surrender
          <Seg
            value={rules.surrender}
            onChange={(v) => set({ surrender: v })}
            options={[
              { value: 'none', label: 'None' },
              { value: 'late', label: 'Late' },
              { value: 'early', label: 'Early' },
            ]}
          />
        </div>
        <div className="field">
          Double after split
          <Seg value={rules.doubleAfterSplit ? 'y' : 'n'} onChange={(v) => set({ doubleAfterSplit: v === 'y' })} options={[{ value: 'y', label: 'Yes' }, { value: 'n', label: 'No' }]} />
        </div>
        <div className="field">
          Double on
          <Seg
            value={rules.doubleOn}
            onChange={(v) => set({ doubleOn: v })}
            options={[
              { value: 'any', label: 'Any 2' },
              { value: '9-11', label: '9–11' },
              { value: '10-11', label: '10–11' },
            ]}
          />
        </div>
        <div className="field">
          Hole card
          <Seg value={rules.dealerPeeks ? 'peek' : 'enhc'} onChange={(v) => set({ dealerPeeks: v === 'peek' })} options={[{ value: 'peek', label: 'Peek (US)' }, { value: 'enhc', label: 'None (EU)' }]} />
        </div>
        <div className="field">
          Blackjack pays
          <Seg value={rules.blackjackPays} onChange={(v) => set({ blackjackPays: v })} options={PAYOUT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        </div>
      </div>
      <div className="muted small" style={{ marginTop: 8 }}>
        {note ?? 'The chart, quiz answer key, trainer and coach all use these rules.'} Your choice is remembered and applies across the whole site.
      </div>
    </div>
  );
}

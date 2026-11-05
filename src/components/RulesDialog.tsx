import { useState } from 'react';
import { DECK_OPTIONS, PAYOUT_OPTIONS, PRESETS, decksLabel, describeRules, rulesKey, type Rules } from '../engine/rules';
import { useSettings } from '../state/settings';
import { useStrategy } from '../worker/client';
import { PrefsDialog } from './PrefsDialog';
import { Modal, Seg, fmtPct } from './ui';

export function RulesForm({ value, onChange }: { value: Rules; onChange: (r: Rules) => void }) {
  const set = (p: Partial<Rules>) => onChange({ ...value, ...p });
  return (
    <div className="rules-form">
      <label className="field">
        Decks
        <select value={Number.isFinite(value.decks) ? value.decks : 'inf'} onChange={(e) => set({ decks: e.target.value === 'inf' ? Infinity : Number(e.target.value) })}>
          {DECK_OPTIONS.map((d) => (
            <option key={String(d)} value={Number.isFinite(d) ? d : 'inf'}>
              {decksLabel(d)}
              {!Number.isFinite(d) ? ' (continuous shuffle)' : ''}
            </option>
          ))}
        </select>
      </label>
      <div className="field">
        Dealer on soft 17
        <Seg value={value.hitSoft17 ? 'h' : 's'} onChange={(v) => set({ hitSoft17: v === 'h' })} options={[{ value: 's', label: 'Stands (S17)' }, { value: 'h', label: 'Hits (H17)' }]} />
      </div>
      <div className="field">
        Blackjack pays
        <Seg value={value.blackjackPays} onChange={(v) => set({ blackjackPays: v })} options={PAYOUT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
      </div>
      <div className="field">
        Surrender
        <Seg
          value={value.surrender}
          onChange={(v) => set({ surrender: v })}
          options={[
            { value: 'none', label: 'Not allowed' },
            { value: 'late', label: 'Late' },
            { value: 'early', label: 'Early' },
          ]}
        />
      </div>
      <div className="field">
        Double down on
        <Seg
          value={value.doubleOn}
          onChange={(v) => set({ doubleOn: v })}
          options={[
            { value: 'any', label: 'Any two cards' },
            { value: '9-11', label: '9–11' },
            { value: '10-11', label: '10–11' },
          ]}
        />
      </div>
      <div className="field">
        Double after split
        <Seg value={value.doubleAfterSplit ? 'y' : 'n'} onChange={(v) => set({ doubleAfterSplit: v === 'y' })} options={[{ value: 'y', label: 'Allowed' }, { value: 'n', label: 'Not allowed' }]} />
      </div>
      <div className="field">
        Split up to
        <Seg value={value.maxSplitHands} onChange={(v) => set({ maxSplitHands: v })} options={[2, 3, 4].map((n) => ({ value: n, label: `${n} hands` }))} />
      </div>
      <div className="field">
        Aces after splitting
        <div className="row tight">
          <Seg value={value.resplitAces ? 'y' : 'n'} onChange={(v) => set({ resplitAces: v === 'y' })} options={[{ value: 'n', label: 'No resplit' }, { value: 'y', label: 'Resplit (RSA)' }]} />
          <Seg value={value.hitSplitAces ? 'y' : 'n'} onChange={(v) => set({ hitSplitAces: v === 'y' })} options={[{ value: 'n', label: 'One card' }, { value: 'y', label: 'May hit' }]} />
        </div>
      </div>
      <div className="field">
        Dealer hole card
        <Seg
          value={value.dealerPeeks ? 'peek' : 'enhc'}
          onChange={(v) => set({ dealerPeeks: v === 'peek' })}
          options={[
            { value: 'peek', label: 'Peeks for BJ (US)' },
            { value: 'enhc', label: 'No hole card (EU)' },
          ]}
        />
      </div>
      <label className="field">
        Penetration (table games only): {Math.round(value.penetration * 100)}% of the shoe dealt
        <input type="range" min={0.5} max={0.9} step={0.05} value={value.penetration} onChange={(e) => set({ penetration: Number(e.target.value) })} />
      </label>
    </div>
  );
}

export function RulesDialog() {
  const { rules, setRules, closeRules } = useSettings();
  const [draft, setDraft] = useState<Rules>(rules);
  const { table, progress } = useStrategy(draft);
  const changed = rulesKey(draft) !== rulesKey(rules) || draft.penetration !== rules.penetration;
  return (
    <Modal
      title="Table rules"
      onClose={closeRules}
      footer={
        <>
          <span className="grow muted small">
            {table ? (
              <>
                House edge with perfect basic strategy: <strong className="num" style={{ color: 'var(--text)' }}>{fmtPct(table.houseEdge, 3)}</strong>
              </>
            ) : (
              `Computing exact house edge… ${Math.round(progress * 100)}%`
            )}
          </span>
          <button className="btn ghost" onClick={closeRules}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              setRules(draft);
              closeRules();
            }}
            disabled={!changed}
          >
            Apply rules
          </button>
        </>
      }
    >
      <h3>Presets</h3>
      <div className="preset-list" style={{ marginBottom: 18 }}>
        {PRESETS.map((p) => (
          <button key={p.id} className="preset" onClick={() => setDraft({ ...p.rules })} style={rulesKey(p.rules) === rulesKey(draft) ? { borderColor: 'var(--gold)' } : undefined}>
            <div className="n">{p.name}</div>
            <div className="b">{p.blurb}</div>
          </button>
        ))}
      </div>
      <h3>Custom</h3>
      <RulesForm value={draft} onChange={setDraft} />
      <div className="row tight" style={{ marginTop: 14 }}>
        {describeRules(draft).map((c) => (
          <span className="chip" key={c}>
            {c}
          </span>
        ))}
      </div>
    </Modal>
  );
}

/** Compact rules and preferences buttons for the top bar. The rule details live in the dialogs. */
export function SettingsButtons() {
  const { openRules } = useSettings();
  const [prefsOpen, setPrefsOpen] = useState(false);
  return (
    <>
      <button className="btn small ghost" onClick={openRules} title="Change the table's rules">
        Table rules
      </button>
      <button className="btn small ghost" onClick={() => setPrefsOpen(true)} aria-label="Preferences" title="Preferences">
        ⚙
      </button>
      {prefsOpen && <PrefsDialog onClose={() => setPrefsOpen(false)} />}
    </>
  );
}

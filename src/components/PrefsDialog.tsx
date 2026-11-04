import { useState } from 'react';
import { SYSTEMS } from '../engine/counting';
import { useSettings } from '../state/settings';
import { clearAll } from '../state/storage';
import { Check, Modal, Seg } from './ui';

export function PrefsDialog({ onClose }: { onClose: () => void }) {
  const { prefs, setPrefs } = useSettings();
  const [confirm, setConfirm] = useState(false);
  return (
    <Modal title="Preferences" onClose={onClose} narrow footer={<button className="btn primary" onClick={onClose}>Done</button>}>
      <div className="stack">
        <label className="field">
          Bet unit for money figures in proofs and feedback
          <select value={prefs.unit} onChange={(e) => setPrefs({ unit: Number(e.target.value) })}>
            {[1, 5, 10, 25, 50, 100, 500].map((v) => (
              <option key={v} value={v}>
                ${v} per hand
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          Table animation speed
          <Seg value={prefs.speed} onChange={(v) => setPrefs({ speed: v })} options={[0.5, 1, 1.5, 2, 3, 4].map((s) => ({ value: s, label: `${s}×` }))} />
        </div>
        <label className="field">
          Counting system (drills and count checks)
          <select value={prefs.countingSystem} onChange={(e) => setPrefs({ countingSystem: e.target.value })}>
            {SYSTEMS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <Check checked={prefs.showKeys} onChange={(v) => setPrefs({ showKeys: v })}>
          Show keyboard shortcuts on buttons
        </Check>
        <Check checked={prefs.reduceMotion} onChange={(v) => setPrefs({ reduceMotion: v })}>
          Reduce motion (no card-dealing animation)
        </Check>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {!confirm ? (
            <button className="btn small" onClick={() => setConfirm(true)}>
              Reset all progress…
            </button>
          ) : (
            <div className="row">
              <span className="bad small">Delete quiz history, trainer stats, drills, report cards and settings?</span>
              <button
                className="btn small"
                onClick={() => {
                  clearAll();
                  window.location.reload();
                }}
              >
                Yes, reset
              </button>
              <button className="btn small ghost" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_RULES, rulesFromJSON, rulesToJSON, type Rules } from '../engine/rules';
import { load, save } from './storage';

export type CoachMode = 'off' | 'hint' | 'warn' | 'always';

export interface Prefs {
  /** Counting system used for count checks and drills. */
  countingSystem: string;
  /** Bet unit (in $) used to express EV differences in money. */
  unit: number;
  /** Animation speed multiplier for the table (0.5 – 4). */
  speed: number;
  /** Strategy chart display: action letters, best EV, or decision margin heat-map. */
  chartView: 'actions' | 'ev' | 'margin' | 'weak';
  /** Keyboard hints shown on buttons. */
  showKeys: boolean;
  /** Reduce motion (no card-flip / slide animations). */
  reduceMotion: boolean;
}

export const DEFAULT_PREFS: Prefs = {
  countingSystem: 'hilo',
  unit: 25,
  speed: 1,
  chartView: 'actions',
  showKeys: true,
  reduceMotion: false,
};

interface SettingsValue {
  rules: Rules;
  setRules: (r: Rules) => void;
  prefs: Prefs;
  setPrefs: (p: Partial<Prefs>) => void;
  rulesDialogOpen: boolean;
  openRules: () => void;
  closeRules: () => void;
}

const Ctx = createContext<SettingsValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [rules, setRulesState] = useState<Rules>(() => rulesFromJSON(load('rules', rulesToJSON(DEFAULT_RULES))));
  const [prefs, setPrefsState] = useState<Prefs>(() => ({ ...DEFAULT_PREFS, ...load<Partial<Prefs>>('prefs', {}) }));
  const [rulesDialogOpen, setOpen] = useState(false);

  const setRules = useCallback((r: Rules) => {
    setRulesState(r);
    save('rules', rulesToJSON(r));
  }, []);
  const setPrefs = useCallback((p: Partial<Prefs>) => {
    setPrefsState((old) => {
      const next = { ...old, ...p };
      save('prefs', next);
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ rules, setRules, prefs, setPrefs, rulesDialogOpen, openRules: () => setOpen(true), closeRules: () => setOpen(false) }),
    [rules, setRules, prefs, setPrefs, rulesDialogOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSettings(): SettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSettings outside provider');
  return v;
}

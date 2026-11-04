/**
 * Promise-based client for the engine worker. Falls back to running the engine on the main thread
 * if Web Workers are unavailable.
 */
import { useEffect, useState } from 'react';
import type { Counts, Rank } from '../engine/cards';
import type { RootOptions } from '../engine/ev';
import { rulesKey, rulesToJSON, type Rules } from '../engine/rules';
import type { StrategyTable } from '../engine/strategy';
import type { EngineRequest, EngineResults, WorkerOut } from './protocol';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; onProgress?: (d: number, t: number) => void };

class EngineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private failed = false;

  private ensure(): Worker | null {
    if (this.worker || this.failed) return this.worker;
    try {
      this.worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<WorkerOut>) => {
        const m = e.data;
        const p = this.pending.get(m.id);
        if (!p) return;
        if (m.kind === 'progress') p.onProgress?.(m.done, m.total);
        else {
          this.pending.delete(m.id);
          if (m.kind === 'result') p.resolve(m.data);
          else p.reject(new Error(m.message));
        }
      };
      this.worker.onerror = (e) => {
        console.error('Engine worker error', e);
      };
    } catch {
      this.failed = true;
      this.worker = null;
    }
    return this.worker;
  }

  request<K extends EngineRequest['type']>(req: Extract<EngineRequest, { type: K }>, onProgress?: (d: number, t: number) => void): Promise<EngineResults[K]> {
    const w = this.ensure();
    if (!w) {
      return import('./handler').then((m) => m.handle(req, onProgress ?? (() => {})) as EngineResults[K]);
    }
    const id = ++this.seq;
    return new Promise<EngineResults[K]>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
      w.postMessage({ id, req });
    });
  }

  explain(rules: Rules, cards: Rank[], up: Rank, opts: RootOptions) {
    return this.request({ type: 'explain', rules, cards, up, opts });
  }

  exact(rules: Rules, shoe: Counts, cards: Rank[], up: Rank, opts: RootOptions) {
    return this.request({ type: 'exact', rules, shoe, cards, up, opts });
  }
}

/** Interactive worker: chart tables, proofs, dealer trees and per-decision exact EVs. */
export const engine = new EngineClient();
/**
 * Batch worker: long multi-solve jobs (rule effects, edge vs. count, effects of removal, index
 * curves) run here so they never queue in front of an interactive request.
 */
export const batchEngine = new EngineClient();
const BATCH_TYPES = new Set<EngineRequest['type']>(['ruleEffects', 'edgeVsCount', 'eor', 'deviationCurve']);

// ---------------------------------------------------------------------------------------------
// Strategy tables: shared in-memory cache + small localStorage cache for instant reloads.
// ---------------------------------------------------------------------------------------------

const memory = new Map<string, StrategyTable>();
const inflight = new Map<string, Promise<StrategyTable>>();
const progressListeners = new Map<string, Set<(p: number) => void>>();
const LS_PREFIX = 'bjlab.table.v2.';
const LS_MAX = 3;

function lsLoad(key: string): StrategyTable | null {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key);
    if (!raw) return null;
    const t = JSON.parse(raw) as StrategyTable;
    const r = t.rules as unknown as Record<string, unknown>;
    if (r.decks === 'inf') r.decks = Infinity;
    return t;
  } catch {
    return null;
  }
}

function lsSave(t: StrategyTable): void {
  try {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith(LS_PREFIX));
    const idxKey = 'bjlab.table.order';
    const order: string[] = JSON.parse(localStorage.getItem(idxKey) ?? '[]').filter((k: string) => keys.includes(LS_PREFIX + k));
    const next = [...order.filter((k) => k !== t.key), t.key];
    while (next.length > LS_MAX) localStorage.removeItem(LS_PREFIX + next.shift());
    const slim = { ...t, rules: rulesToJSON(t.rules) };
    localStorage.setItem(LS_PREFIX + t.key, JSON.stringify(slim));
    localStorage.setItem(idxKey, JSON.stringify(next));
  } catch {
    /* storage full or unavailable — ignore */
  }
}

export function getStrategyTable(rules: Rules, onProgress?: (p: number) => void): Promise<StrategyTable> {
  const key = rulesKey(rules);
  const hit = memory.get(key);
  if (hit) return Promise.resolve(hit);
  const stored = lsLoad(key);
  if (stored) {
    memory.set(key, stored);
    return Promise.resolve(stored);
  }
  if (onProgress) {
    if (!progressListeners.has(key)) progressListeners.set(key, new Set());
    progressListeners.get(key)!.add(onProgress);
  }
  let p = inflight.get(key);
  if (!p) {
    p = engine
      .request({ type: 'strategy', rules }, (d, t) => progressListeners.get(key)?.forEach((f) => f(d / t)))
      .then((t) => {
        memory.set(key, t);
        inflight.delete(key);
        progressListeners.delete(key);
        lsSave(t);
        return t;
      });
    inflight.set(key, p);
  }
  return p;
}

export function peekStrategyTable(rules: Rules): StrategyTable | null {
  return memory.get(rulesKey(rules)) ?? null;
}

/** React hook: the strategy table for `rules` (null while computing) and computation progress. */
export function useStrategy(rules: Rules): { table: StrategyTable | null; progress: number; error: string | null } {
  const key = rulesKey(rules);
  const [state, setState] = useState<{ key: string; table: StrategyTable | null; progress: number; error: string | null }>(() => ({
    key,
    table: memory.get(key) ?? null,
    progress: 0,
    error: null,
  }));
  useEffect(() => {
    let alive = true;
    const cached = memory.get(key);
    if (cached) {
      setState({ key, table: cached, progress: 1, error: null });
      return;
    }
    setState({ key, table: null, progress: 0, error: null });
    getStrategyTable(rules, (p) => alive && setState((s) => (s.key === key ? { ...s, progress: p } : s)))
      .then((t) => alive && setState({ key, table: t, progress: 1, error: null }))
      .catch((e: Error) => alive && setState({ key, table: null, progress: 0, error: e.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state : { table: memory.get(key) ?? null, progress: 0, error: null };
}

/** Generic hook for one-off engine requests keyed by a string (null key = don't run). */
export function useEngine<K extends EngineRequest['type']>(
  key: string | null,
  make: () => Extract<EngineRequest, { type: K }>,
): { data: EngineResults[K] | null; progress: number; loading: boolean; error: string | null } {
  const [state, setState] = useState<{ key: string | null; data: EngineResults[K] | null; progress: number; error: string | null }>({
    key: null,
    data: null,
    progress: 0,
    error: null,
  });
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const hit = requestCache.get(key);
    if (hit) {
      setState({ key, data: hit as EngineResults[K], progress: 1, error: null });
      return;
    }
    setState({ key, data: null, progress: 0, error: null });
    const req = make();
    (BATCH_TYPES.has(req.type) ? batchEngine : engine)
      .request(req, (d, t) => alive && setState((s) => ({ ...s, progress: d / t })))
      .then((data) => {
        requestCache.set(key, data);
        if (requestCache.size > 200) requestCache.delete(requestCache.keys().next().value as string);
        if (alive) setState({ key, data, progress: 1, error: null });
      })
      .catch((e: Error) => alive && setState({ key, data: null, progress: 0, error: e.message }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!key) return { data: null, progress: 0, loading: false, error: null };
  const fresh = state.key === key;
  return { data: fresh ? state.data : null, progress: fresh ? state.progress : 0, loading: !fresh || (!state.data && !state.error), error: fresh ? state.error : null };
}

const requestCache = new Map<string, unknown>();

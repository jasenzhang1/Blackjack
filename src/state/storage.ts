/** Tiny typed wrapper around localStorage (all keys are namespaced with `bjlab.`). */
const NS = 'bjlab.';

type Listener = (key: string) => void;
const listeners = new Set<Listener>();

/** Subscribe to every save/remove (used by cloud sync). Returns an unsubscribe function. */
export function onSave(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(key: string): void {
  for (const fn of listeners) fn(key);
}

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* quota exceeded / private mode */
  }
  notify(key);
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(NS + key);
  } catch {
    /* ignore */
  }
  notify(key);
}

/** Writes a value without notifying listeners (applying data that came from the cloud). */
export function saveQuiet(key: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(NS + key);
    else localStorage.setItem(NS + key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/** Removes every key written by the app (progress reset). */
export function clearAll(): void {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(NS)) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

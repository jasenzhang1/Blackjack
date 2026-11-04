/** Tiny typed wrapper around localStorage (all keys are namespaced with `bjlab.`). */
const NS = 'bjlab.';

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
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(NS + key);
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

/** Small, fast, seedable PRNG (mulberry32) and helpers. */
export type RNG = () => number;

export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0];
  }
  return Math.floor(Math.random() * 2 ** 32);
}

/** In-place Fisher–Yates shuffle. */
export function shuffle<T>(arr: T[], rand: RNG): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

export function randInt(rand: RNG, lo: number, hi: number): number {
  return lo + Math.floor(rand() * (hi - lo + 1));
}

export function pick<T>(rand: RNG, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

/** Picks an index with probability proportional to its weight. */
export function weightedIndex(rand: RNG, weights: readonly number[]): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let x = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

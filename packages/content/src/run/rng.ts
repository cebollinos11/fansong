import { rngNext, seedRng } from '@fansong/engine';

/**
 * The run's dice. A run stores no RNG state, only its seed and two counters:
 * every random step opens a fresh stream keyed by `(seed, round, rolls)` and the
 * run then bumps `rolls`. So a saved run is plain integers, a reroll is as
 * seeded as a first roll, and the same seed with the same picks replays the
 * same run.
 */
export interface RunRandom {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in `lo..hi`, inclusive. */
  int(lo: number, hi: number): number;
  /** A d6. */
  d6(): number;
  /** One of `items` (which must not be empty). */
  pick<T>(items: readonly T[]): T;
  /** One of `items`, each as likely as its weight (which must not be empty). */
  weighted<T>(items: readonly T[], weight: (item: T) => number): T;
  /** Up to `count` different items, in random order. */
  sample<T>(items: readonly T[], count: number): T[];
}

/** Which of a round's streams to open: its numbered rolls, or its encounter (or, before round 1, the run's rivals; or, keyed by act rather than round, the act's route). */
export const RUN_STREAM = { rolls: 0, encounter: 1, rivals: 2, route: 3 } as const;

/** A 32-bit seed mixed from the run's seed and where in the run a stream opens. */
export function runSeed(seed: number, round: number, rolls: number, stream: number = RUN_STREAM.rolls): number {
  let h = seed | 0;
  for (const part of [round, rolls, stream]) {
    h = Math.imul(h ^ (part + 0x9e3779b9), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  return h | 0;
}

/** A stateful stream over the engine's pure RNG, as `mapGen.ts` wraps it. */
export function makeRunRandom(seed: number, round: number, rolls: number, stream: number = RUN_STREAM.rolls): RunRandom {
  let state = seedRng(runSeed(seed, round, rolls, stream));
  const next = (): number => {
    const draw = rngNext(state);
    state = draw.state;
    return draw.value;
  };
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1));
  const pick = <T>(items: readonly T[]): T => {
    if (items.length === 0) throw new Error('nothing to pick from');
    return items[int(0, items.length - 1)]!;
  };
  return {
    next,
    int,
    d6: () => int(1, 6),
    pick,
    weighted: (items, weight) => {
      const total = items.reduce((sum, item) => sum + Math.max(0, weight(item)), 0);
      if (items.length === 0 || total <= 0) return pick(items);
      let at = next() * total;
      for (const item of items) {
        at -= Math.max(0, weight(item));
        if (at < 0) return item;
      }
      return items[items.length - 1]!;
    },
    sample: (items, count) => {
      const pool = [...items];
      const out: (typeof items)[number][] = [];
      while (out.length < count && pool.length > 0) out.push(pool.splice(int(0, pool.length - 1), 1)[0]!);
      return out;
    },
  };
}

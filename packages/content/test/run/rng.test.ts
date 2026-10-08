import { describe, expect, it } from 'vitest';
import { makeRunRandom, RUN_STREAM } from '../../src/index.js';

const draws = (...key: [number, number, number, number?]) => {
  const rnd = makeRunRandom(...key);
  return Array.from({ length: 8 }, () => rnd.next());
};

describe('makeRunRandom', () => {
  it('gives the same stream for the same key', () => {
    expect(draws(7, 3, 2)).toEqual(draws(7, 3, 2));
  });

  it('gives a different stream for another seed, round, roll or stream', () => {
    const base = draws(7, 3, 2);
    expect(draws(8, 3, 2)).not.toEqual(base);
    expect(draws(7, 4, 2)).not.toEqual(base);
    expect(draws(7, 3, 3)).not.toEqual(base);
    expect(draws(7, 3, 2, RUN_STREAM.encounter)).not.toEqual(base);
    expect(draws(3, 7, 2)).not.toEqual(base);
  });

  it('rolls within range and samples without repeats', () => {
    const rnd = makeRunRandom(1, 1, 0);
    for (let i = 0; i < 200; i++) {
      expect(rnd.d6()).toBeGreaterThanOrEqual(1);
      expect(rnd.int(3, 5)).toBeLessThanOrEqual(5);
      expect(rnd.next()).toBeLessThan(1);
    }
    const sample = rnd.sample([1, 2, 3, 4, 5], 3);
    expect(new Set(sample).size).toBe(3);
    expect(rnd.sample([1, 2], 5).sort()).toEqual([1, 2]);
    expect(() => rnd.pick([])).toThrow();
  });

  it('weights its picks', () => {
    const rnd = makeRunRandom(5, 1, 0);
    const counts = { a: 0, b: 0, never: 0 };
    for (let i = 0; i < 2000; i++) counts[rnd.weighted(['a', 'b', 'never'] as const, (k) => ({ a: 3, b: 1, never: 0 })[k])]++;
    expect(counts.never).toBe(0);
    expect(counts.a).toBeGreaterThan(counts.b * 2);
  });
});

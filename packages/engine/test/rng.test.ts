import { describe, expect, it } from 'vitest';
import { rollD6, rollDice, rngNext, seedRng, tossInitiative } from '../src/rng.js';

describe('rng', () => {
  it('is deterministic for a given state', () => {
    const a = rngNext(123);
    const b = rngNext(123);
    expect(a).toEqual(b);
  });

  it('advances state so successive draws differ', () => {
    const first = rngNext(1);
    const second = rngNext(first.state);
    expect(first.value).not.toEqual(second.value);
    expect(first.value).toBeGreaterThanOrEqual(0);
    expect(first.value).toBeLessThan(1);
  });

  it('rolls d6 in [1,6]', () => {
    let s = seedRng(7);
    for (let i = 0; i < 1000; i++) {
      const r = rollD6(s);
      expect(r.die).toBeGreaterThanOrEqual(1);
      expect(r.die).toBeLessThanOrEqual(6);
      s = r.state;
    }
  });

  it('rollDice returns the requested count and a reproducible sequence', () => {
    const s = seedRng(99);
    const a = rollDice(s, 3);
    const b = rollDice(s, 3);
    expect(a.dice).toHaveLength(3);
    expect(a).toEqual(b);
  });

  it('distinct seeds diverge immediately', () => {
    expect(seedRng(1)).not.toEqual(seedRng(2));
  });
});

describe('tossInitiative', () => {
  it('gives the same side for the same seed', () => {
    for (const seed of [0, 1, 42, 1337, 2 ** 31 - 1]) expect(tossInitiative(seed)).toBe(tossInitiative(seed));
  });

  it('is a fair coin across seeds', () => {
    let tails = 0;
    for (let seed = 0; seed < 20_000; seed++) tails += tossInitiative(seed);
    expect(tails / 20_000).toBeGreaterThan(0.48);
    expect(tails / 20_000).toBeLessThan(0.52);
  });

  it('costs the game no roll: the first die of a seed is what it always was', () => {
    const before = rollD6(seedRng(42));
    tossInitiative(42);
    expect(rollD6(seedRng(42))).toEqual(before);
  });
});

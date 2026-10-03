import { GAME_MODES } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { FLAG_EDGE_DISTANCE, generateRandomMap, MAP_LIMITS, mirrorHex, supportedModes, validateMap } from '../src/index.js';

describe('generateRandomMap', () => {
  const sizes: [number, number][] = [
    [MAP_LIMITS.minWidth, MAP_LIMITS.minHeight],
    [6, 40],
    [40, 6],
    [7, 9],
    [14, 12],
    [23, 17],
    [MAP_LIMITS.maxWidth, MAP_LIMITS.maxHeight],
  ];

  it('always yields a valid map that hosts every game mode', () => {
    for (const symmetric of [true, false])
      for (const [w, h] of sizes)
        for (let seed = 0; seed < 25; seed++) {
          const map = generateRandomMap(w, h, seed, { symmetric });
          expect(validateMap(map).errors, `${w}x${h} seed ${seed} symmetric ${symmetric}`).toEqual([]);
          expect(supportedModes(map)).toEqual([...GAME_MODES]);
        }
  });

  it('keeps the requested size, clamped to the map limits', () => {
    const map = generateRandomMap(17, 11, 3);
    expect([map.width, map.height]).toEqual([17, 11]);
    const big = generateRandomMap(99, 2, 3);
    expect([big.width, big.height]).toEqual([MAP_LIMITS.maxWidth, MAP_LIMITS.minHeight]);
  });

  it('is deterministic per seed and varies between seeds', () => {
    expect(generateRandomMap(14, 12, 42)).toEqual(generateRandomMap(14, 12, 42));
    expect(generateRandomMap(14, 12, 42).hexes).not.toEqual(generateRandomMap(14, 12, 43).hexes);
  });

  it('is point-symmetric, so neither side is favoured', () => {
    const map = generateRandomMap(15, 13, 7);
    for (let y = 0; y < map.height; y++)
      for (let x = 0; x < map.width; x++) {
        const m = mirrorHex(map, { x, y });
        expect(map.hexes[y * map.width + x]).toEqual(map.hexes[m.y * map.width + m.x]);
      }
    expect(map.objectives.flags![1]).toEqual(mirrorHex(map, map.objectives.flags![0]));
  });

  it('sets each flag base 3–5 hexes in from its home edge', () => {
    for (const symmetric of [true, false])
      for (let seed = 0; seed < 50; seed++) {
        const map = generateRandomMap(20, 16, seed, { symmetric });
        const [f0, f1] = map.objectives.flags!;
        const d1 = map.width - 1 - f1.x;
        for (const d of [f0.x, d1]) {
          expect(d).toBeGreaterThanOrEqual(FLAG_EDGE_DISTANCE.min);
          expect(d).toBeLessThanOrEqual(FLAG_EDGE_DISTANCE.max);
        }
      }
  });

  it("keeps narrow maps' flags in their own half", () => {
    const [f0, f1] = generateRandomMap(6, 12, 1).objectives.flags!;
    expect(f0.x).toBeLessThan(3);
    expect(f1.x).toBeGreaterThan(2);
  });

  it('can generate asymmetric maps', () => {
    const asymmetric = (seed: number) => {
      const map = generateRandomMap(15, 13, seed, { symmetric: false });
      return map.hexes.some((hex, i) => JSON.stringify(hex) !== JSON.stringify(map.hexes[map.hexes.length - 1 - i]));
    };
    expect([1, 2, 3].some(asymmetric)).toBe(true);
    expect(generateRandomMap(15, 13, 9, { symmetric: false })).toEqual(
      generateRandomMap(15, 13, 9, { symmetric: false }),
    );
  });

  it('places some terrain', () => {
    const map = generateRandomMap(20, 20, 1);
    expect(map.hexes.some((hex) => hex.feature !== undefined)).toBe(true);
    expect(map.hexes.some((hex) => hex.elevation > 0)).toBe(true);
  });
});

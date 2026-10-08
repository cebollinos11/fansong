import { GAME_MODES } from '@fansong/engine';
import { describe, expect, it } from 'vitest';
import { GAME_MODES as MODES, MAX_ELEVATION } from '@fansong/engine';
import {
  FEATURE_SHARE_MAX,
  FLAG_EDGE_DISTANCE,
  generateRandomMap,
  MAP_LIMITS,
  mirrorHex,
  supportedModes,
  validateMap,
  type TerrainSettings,
} from '../src/index.js';

describe('generateRandomMap', () => {
  const sizes: [number, number][] = [
    [MAP_LIMITS.minWidth, MAP_LIMITS.minHeight],
    [6, 40],
    [40, 6],
    [7, 9],
    // Sizes where mirroring through the centre is not a symmetry of the hex grid.
    [11, 10],
    [15, 10],
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

describe('generateRandomMap with terrain settings', () => {
  const count = (map: ReturnType<typeof generateRandomMap>, f: string) => map.hexes.filter((hex) => hex.feature === f).length;

  it('stays valid for every mode at the extremes', () => {
    const extremes: TerrainSettings[] = [
      { hills: 0, features: { forest: 0, rock: 0, building: 0, lava: 0 } },
      { hills: 1, maxHeight: MAX_ELEVATION, clumping: 2.5 },
      {
        features: { forest: FEATURE_SHARE_MAX, rock: FEATURE_SHARE_MAX, building: FEATURE_SHARE_MAX, lava: FEATURE_SHARE_MAX },
        clumping: 0.25,
      },
      { features: { rock: FEATURE_SHARE_MAX, building: FEATURE_SHARE_MAX }, clumping: 2.5 },
    ];
    for (const terrain of extremes)
      for (const [w, h] of [[MAP_LIMITS.minWidth, MAP_LIMITS.minHeight], [14, 12], [30, 20]] as const)
        for (const symmetric of [true, false])
          for (let seed = 0; seed < 8; seed++) {
            const map = generateRandomMap(w, h, seed, { symmetric, terrain });
            expect(validateMap(map).errors, `${JSON.stringify(terrain)} ${w}x${h} seed ${seed}`).toEqual([]);
            expect(supportedModes(map)).toEqual([...MODES]);
          }
  });

  it('leaves out what is set to none', () => {
    const map = generateRandomMap(20, 16, 5, { terrain: { hills: 0, features: { forest: 0, rock: 0, building: 0, lava: 0 } } });
    expect(map.hexes.every((hex) => hex.elevation === 0 && hex.feature === undefined)).toBe(true);
  });

  it('caps hills at the maximum height', () => {
    for (let seed = 0; seed < 10; seed++) {
      const map = generateRandomMap(20, 16, seed, { terrain: { hills: 1, maxHeight: 1 } });
      expect(Math.max(...map.hexes.map((hex) => hex.elevation))).toBe(1);
    }
  });

  it('places more of a feature the higher its share', () => {
    const forest = (share: number) => count(generateRandomMap(24, 18, 3, { terrain: { features: { forest: share } } }), 'forest');
    expect(forest(0.25)).toBeGreaterThan(forest(0.05));
    expect(forest(0.05)).toBeGreaterThan(0);
  });

  it('can force lava onto a map', () => {
    for (let seed = 0; seed < 5; seed++) {
      const map = generateRandomMap(20, 16, seed, { terrain: { features: { lava: 0.05 } } });
      expect(count(map, 'lava')).toBeGreaterThan(0);
    }
  });

  it('only overrides what it sets: the rest still comes from the seed', () => {
    const plain = generateRandomMap(20, 16, 11);
    const sameLava = generateRandomMap(20, 16, 11, { terrain: {} });
    expect(sameLava).toEqual(plain);
  });
});

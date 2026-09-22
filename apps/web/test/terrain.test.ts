import { describe, expect, it } from 'vitest';
import type { BoardData } from '@fansong/engine';
import {
  ELEVATION_STEP,
  hexElevation,
  surfaceY,
  TILE_BOTTOM,
  TILE_TOP,
  tileHeight,
  tileSideColor,
  tileTopColor,
} from '../src/three/terrain.js';

const board: BoardData = {
  width: 4,
  height: 3,
  blocked: [],
  terrain: { '1,1': { elevation: 2 }, '2,0': { feature: 'forest' } },
};

const luma = (c: number) => ((c >> 16) & 0xff) + ((c >> 8) & 0xff) + (c & 0xff);

describe('board terrain layout', () => {
  it('reads sparse elevation, defaulting to flat', () => {
    expect(hexElevation(board, { x: 1, y: 1 })).toBe(2);
    expect(hexElevation(board, { x: 2, y: 0 })).toBe(0);
    expect(hexElevation(board, { x: 0, y: 0 })).toBe(0);
    expect(hexElevation({ width: 2, height: 2, blocked: [] }, { x: 0, y: 0 })).toBe(0);
  });

  it('keeps flat tiles exactly where they were', () => {
    expect(surfaceY(0)).toBe(TILE_TOP);
    expect(tileHeight(0)).toBeCloseTo(0.2);
    expect(TILE_BOTTOM + tileHeight(0) / 2).toBeCloseTo(0);
  });

  it('raises each level by a fixed step from a shared floor', () => {
    for (const e of [1, 2, 3]) {
      expect(surfaceY(e) - surfaceY(e - 1)).toBeCloseTo(ELEVATION_STEP);
      expect(TILE_BOTTOM + tileHeight(e)).toBeCloseTo(surfaceY(e));
    }
  });

  it('keeps the flat checkerboard and shades sides darker than tops', () => {
    expect(tileTopColor({ x: 0, y: 0 }, 0)).toBe(0x2a3140);
    expect(tileTopColor({ x: 1, y: 0 }, 0)).toBe(0x232936);
    for (const e of [0, 1, 2, 3]) {
      const v = { x: 1, y: 1 };
      expect(luma(tileSideColor(v, e))).toBeLessThan(luma(tileTopColor(v, e)));
      if (e > 0) expect(luma(tileTopColor(v, e))).toBeGreaterThan(luma(tileTopColor(v, e - 1)));
    }
  });
});

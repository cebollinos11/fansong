import { describe, expect, it } from 'vitest';
import type { BoardData, Vec } from '@fansong/engine';
import { BUILDING_HEIGHT, cellNoise, featureLayout } from '../src/three/features.js';
import { surfaceY } from '../src/three/terrain.js';

const SIZE = 0.62;
// Flat-top odd-q centres, as BoardView lays them out (origin irrelevant here).
const centre = (v: Vec) => ({ x: 1.5 * SIZE * v.x, z: Math.sqrt(3) * SIZE * (v.y + 0.5 * (v.x & 1)) });

const board = (terrain: BoardData['terrain']): BoardData => ({ width: 6, height: 5, blocked: [], terrain });
const kinds = (b: BoardData) => featureLayout(b, centre, SIZE).map((p) => p.kind);

describe('feature layout', () => {
  it('draws nothing on a featureless board', () => {
    expect(featureLayout({ width: 6, height: 5, blocked: [] }, centre, SIZE)).toEqual([]);
    expect(featureLayout(board({ '1,1': { elevation: 2 } }), centre, SIZE)).toEqual([]);
  });

  it('gives each feature its own kind of mesh', () => {
    expect(new Set(kinds(board({ '1,1': { feature: 'rock' } })))).toEqual(new Set(['rock']));
    expect(new Set(kinds(board({ '1,1': { feature: 'building' } })))).toEqual(new Set(['box']));
    expect(new Set(kinds(board({ '1,1': { feature: 'forest' } })))).toEqual(new Set(['cone', 'trunk']));
  });

  it('is deterministic and tags every piece with its hex', () => {
    const b = board({ '0,0': { feature: 'rock' }, '3,2': { feature: 'forest' }, '4,4': { feature: 'building' } });
    expect(featureLayout(b, centre, SIZE)).toEqual(featureLayout(b, centre, SIZE));
    const cells = new Set(featureLayout(b, centre, SIZE).map((p) => `${p.cell.x},${p.cell.y}`));
    expect(cells).toEqual(new Set(['0,0', '3,2', '4,4']));
    expect(cellNoise({ x: 3, y: 2 }, 1)).toBeGreaterThanOrEqual(0);
    expect(cellNoise({ x: 3, y: 2 }, 1)).toBeLessThan(1);
  });

  it('stands features on their hex surface, raised by elevation', () => {
    for (const elevation of [0, 2]) {
      const b = board({ '2,2': { feature: 'building', elevation } });
      const body = featureLayout(b, centre, SIZE)[0]!;
      expect(body.y - (body.kind === 'box' ? body.h / 2 : 0)).toBeCloseTo(surfaceY(elevation));
      expect(body.kind === 'box' && body.h).toBe(BUILDING_HEIGHT);
    }
    const trees = featureLayout(board({ '2,2': { feature: 'forest', elevation: 3 } }), centre, SIZE);
    for (const t of trees) expect(t.y).toBeGreaterThan(surfaceY(3));
  });

  it('joins adjacent buildings at the same level with one connector per pair', () => {
    // Body + roof per hex, plus wall + roof per connector.
    const pair = board({ '2,2': { feature: 'building' }, '2,3': { feature: 'building' } });
    expect(kinds(pair)).toHaveLength(2 * 2 + 2);
    // A three-hex triangle (mutually adjacent) gets three connectors.
    const tri = board({ '2,2': { feature: 'building' }, '3,2': { feature: 'building' }, '2,3': { feature: 'building' } });
    expect(kinds(tri)).toHaveLength(3 * 2 + 3 * 2);
    // Apart, or on different levels: no connector.
    expect(kinds(board({ '0,0': { feature: 'building' }, '4,4': { feature: 'building' } }))).toHaveLength(4);
    expect(kinds(board({ '2,2': { feature: 'building' }, '2,3': { feature: 'building', elevation: 1 } }))).toHaveLength(4);
  });

  it('aligns a connector along the line between the two hex centres', () => {
    const pieces = featureLayout(board({ '1,1': { feature: 'building' }, '2,1': { feature: 'building' } }), centre, SIZE);
    const link = pieces[2]!;
    if (link.kind !== 'box') throw new Error('expected a box');
    const a = centre({ x: 1, y: 1 });
    const b = centre({ x: 2, y: 1 });
    expect(link.x).toBeCloseTo((a.x + b.x) / 2);
    expect(link.z).toBeCloseTo((a.z + b.z) / 2);
    expect(link.w).toBeCloseTo(Math.hypot(b.x - a.x, b.z - a.z));
    // Box local +X rotated by rotY about Y points along (cos, -sin).
    expect(Math.cos(link.rotY)).toBeCloseTo((b.x - a.x) / link.w);
    expect(-Math.sin(link.rotY)).toBeCloseTo((b.z - a.z) / link.w);
  });

  it('keeps forest trees off the hex centre where a unit stands', () => {
    const c = centre({ x: 2, y: 2 });
    for (const t of featureLayout(board({ '2,2': { feature: 'forest' } }), centre, SIZE)) {
      expect(Math.hypot(t.x - c.x, t.z - c.z)).toBeGreaterThan(0.45 * SIZE);
    }
  });
});

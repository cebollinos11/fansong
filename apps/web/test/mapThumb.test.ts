import { getMap, listMaps, newEditorMap } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { hexCenter, mapThumb } from '../src/ui/mapThumb.js';

describe('hexCenter', () => {
  it('lays hexes out odd-q: odd columns sit half a row lower', () => {
    const even = hexCenter({ x: 0, y: 0 });
    const odd = hexCenter({ x: 1, y: 0 });
    expect(odd.x - even.x).toBeCloseTo(1.5);
    expect(odd.y - even.y).toBeCloseTo(Math.sqrt(3) / 2);
    expect(hexCenter({ x: 0, y: 1 }).y - even.y).toBeCloseTo(Math.sqrt(3));
  });
});

describe('mapThumb', () => {
  it('draws one hex per cell, all inside the viewBox', () => {
    for (const map of listMaps()) {
      const t = mapThumb(map);
      expect(t.hexes).toHaveLength(map.width * map.height);
      const [, , w, h] = t.viewBox.split(' ').map(Number);
      for (const hex of t.hexes) {
        for (const p of hex.points.split(' ')) {
          const [x, y] = p.split(',').map(Number);
          expect(x).toBeGreaterThanOrEqual(0);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(w!);
          expect(y).toBeLessThanOrEqual(h!);
        }
      }
    }
  });

  it('tints deploy zones in their player colours and leaves open ground plain', () => {
    const map = newEditorMap(8, 6);
    const fill = (x: number, y: number) => mapThumb(map).hexes.find((h) => h.cell.x === x && h.cell.y === y)!.fill;
    const [a] = map.deployZones[0];
    const [b] = map.deployZones[1];
    const plain = mapThumb({ ...map, deployZones: [[], []] }).hexes.find((h) => h.cell.x === a!.x && h.cell.y === a!.y)!.fill;
    expect(fill(a!.x, a!.y)).not.toBe(plain);
    expect(fill(a!.x, a!.y)).not.toBe(fill(b!.x, b!.y));
  });

  it('marks terrain features and flag bases', () => {
    const map = getMap('crossroads')!;
    const t = mapThumb(map);
    const forest = map.hexes.findIndex((h) => h.feature === 'forest' && h.elevation === 0);
    const open = map.hexes.findIndex((h, i) => !h.feature && h.elevation === 0 && (i % map.width) % 2 === (forest % map.width) % 2 && Math.floor(i / map.width) % 2 === Math.floor(forest / map.width) % 2);
    expect(t.hexes[forest]!.fill).not.toBe(t.hexes[open]!.fill);
    expect(t.flags).toHaveLength(map.objectives.flags ? 2 : 0);
  });
});

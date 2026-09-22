import { describe, expect, it } from 'vitest';
import {
  MAX_UNDO,
  brushCells,
  canRedo,
  canUndo,
  clearFlags,
  commitEdit,
  createHistory,
  eraseTerrain,
  newEditorMap,
  paintConquest,
  paintDeploy,
  paintElevation,
  paintFeature,
  paintHill,
  redoEdit,
  regionCells,
  renameMap,
  setFlag,
  slugify,
  undoEdit,
} from '../src/editor.js';
import { mapHexAt, parseMap } from '../src/map.js';
import { validateMap } from '../src/mapValidate.js';

const v = (x: number, y: number) => ({ x, y });

describe('newEditorMap / renameMap', () => {
  it('creates a valid flat map whose id follows the name', () => {
    const map = newEditorMap(10, 8, 'My First Map!');
    expect(map.id).toBe('my-first-map');
    expect(map.hexes).toHaveLength(80);
    expect(validateMap(map).ok).toBe(true);
    expect(parseMap(JSON.parse(JSON.stringify(map)))).toEqual(map);
  });

  it('slugifies names and falls back for empty slugs', () => {
    expect(slugify('  Rocky -- Pass 2 ')).toBe('rocky-pass-2');
    expect(slugify('!!!')).toBe('custom-map');
    expect(renameMap(newEditorMap(6, 6), 'Hill Fort').id).toBe('hill-fort');
  });
});

describe('brushCells / regionCells', () => {
  const map = newEditorMap(8, 8);

  it('brush radius 0/1/2 covers 1/7/19 hexes in the interior, centre first', () => {
    expect(brushCells(map, v(4, 4), 0)).toEqual([v(4, 4)]);
    expect(brushCells(map, v(4, 4), 1)).toHaveLength(7);
    expect(brushCells(map, v(4, 4), 2)).toHaveLength(19);
    expect(brushCells(map, v(4, 4), 9)).toHaveLength(19); // clamped
    expect(brushCells(map, v(4, 4), 2)[0]).toEqual(v(4, 4));
  });

  it('clips at the edge and is empty off the map', () => {
    expect(brushCells(map, v(0, 0), 1).length).toBeLessThan(7);
    expect(brushCells(map, v(-1, 0), 1)).toEqual([]);
  });

  it('region is the rectangle between corners in either drag direction, clipped', () => {
    expect(regionCells(map, v(1, 1), v(2, 3))).toHaveLength(6);
    expect(regionCells(map, v(2, 3), v(1, 1))).toEqual(regionCells(map, v(1, 1), v(2, 3)));
    expect(regionCells(map, v(6, 6), v(10, 10))).toHaveLength(4);
  });
});

describe('terrain brushes', () => {
  it('raise/lower/set clamp to 0–3 and keep features; input untouched', () => {
    const map = paintFeature(newEditorMap(6, 6), [v(2, 2)], 'forest');
    const before = JSON.stringify(map);
    let m = map;
    for (let i = 0; i < 5; i++) m = paintElevation(m, [v(2, 2)], { kind: 'raise' });
    expect(mapHexAt(m, v(2, 2))).toEqual({ elevation: 3, feature: 'forest' });
    m = paintElevation(m, [v(2, 2)], { kind: 'set', value: 1 });
    expect(mapHexAt(m, v(2, 2))?.elevation).toBe(1);
    m = paintElevation(m, [v(2, 2)], { kind: 'lower' });
    m = paintElevation(m, [v(2, 2)], { kind: 'lower' });
    expect(mapHexAt(m, v(2, 2))?.elevation).toBe(0);
    expect(JSON.stringify(map)).toBe(before);
  });

  it('features place, replace and remove (sparse); erase flattens', () => {
    let m = paintElevation(newEditorMap(6, 6), [v(1, 1)], { kind: 'set', value: 2 });
    m = paintFeature(m, [v(1, 1), v(9, 9)], 'rock');
    expect(mapHexAt(m, v(1, 1))).toEqual({ elevation: 2, feature: 'rock' });
    m = paintFeature(m, [v(1, 1)], 'building');
    expect(mapHexAt(m, v(1, 1))?.feature).toBe('building');
    m = paintFeature(m, [v(1, 1)], undefined);
    expect(mapHexAt(m, v(1, 1))).toStrictEqual({ elevation: 2 });
    m = eraseTerrain(paintFeature(m, [v(1, 1)], 'forest'), [v(1, 1)]);
    expect(mapHexAt(m, v(1, 1))).toStrictEqual({ elevation: 0 });
    expect(m.hexes).toHaveLength(36);
  });
});

describe('deploy zones & objectives', () => {
  it('painting a deploy zone steals hexes from the other and dedupes', () => {
    const map = newEditorMap(8, 6);
    const m = paintDeploy(map, 0, [v(7, 0), v(7, 0), v(3, 3)]);
    expect(m.deployZones[0].filter((c) => c.x === 7 && c.y === 0)).toHaveLength(1);
    expect(m.deployZones[1].some((c) => c.x === 7 && c.y === 0)).toBe(false);
    const removed = paintDeploy(m, 0, [v(3, 3)], false);
    expect(removed.deployZones[0].some((c) => c.x === 3 && c.y === 3)).toBe(false);
    expect(paintDeploy(map, 1, [v(20, 20)])).toEqual(map);
  });

  it('first flag placement mirrors the other base; later ones move just one', () => {
    let m = setFlag(newEditorMap(10, 8), 0, v(2, 3));
    expect(m.objectives.flags).toEqual([v(2, 3), v(7, 4)]);
    m = setFlag(m, 1, v(8, 1));
    expect(m.objectives.flags).toEqual([v(2, 3), v(8, 1)]);
    expect(supported(m)).toContain('capture-the-flag');
    expect(clearFlags(m).objectives).toStrictEqual({});
  });

  it('hill zone adds/removes and disappears when emptied', () => {
    let m = paintHill(newEditorMap(8, 8), [v(3, 3), v(4, 3)]);
    expect(m.objectives.hill).toEqual([v(3, 3), v(4, 3)]);
    m = paintHill(m, [v(3, 3), v(4, 3)], false);
    expect(m.objectives).toStrictEqual({});
  });

  it('conquest zones stay disjoint and are removed when all empty', () => {
    let m = paintConquest(newEditorMap(10, 8), 0, [v(4, 1)]);
    expect(m.objectives.conquest).toEqual([[v(4, 1)], [], []]);
    m = paintConquest(m, 1, [v(4, 1), v(5, 4)]);
    m = paintConquest(m, 2, [v(5, 6)]);
    expect(m.objectives.conquest).toEqual([[], [v(4, 1), v(5, 4)], [v(5, 6)]]);
    expect(validateMap(m, 'conquest').ok).toBe(false); // zone 1 is empty
    m = paintConquest(m, 0, [v(3, 1)]);
    expect(validateMap(m, 'conquest').ok).toBe(true);
    for (const i of [0, 1, 2] as const) m = paintConquest(m, i, regionCells(m, v(0, 0), v(9, 7)), false);
    expect(m.objectives).toStrictEqual({});
  });
});

function supported(m: ReturnType<typeof newEditorMap>) {
  return (['capture-the-flag', 'king-of-the-hill', 'conquest'] as const).filter(
    (mode) => validateMap(m, mode).ok,
  );
}

describe('undo / redo history', () => {
  it('commits, undoes, redoes, and a new edit clears redo', () => {
    const a = newEditorMap(6, 6);
    const b = paintFeature(a, [v(2, 2)], 'rock');
    const c = paintFeature(b, [v(3, 3)], 'forest');
    let h = commitEdit(commitEdit(createHistory(a), b), c);
    expect(h.present).toBe(c);
    h = undoEdit(h);
    expect(h.present).toBe(b);
    expect(canRedo(h)).toBe(true);
    h = redoEdit(h);
    expect(h.present).toBe(c);
    h = commitEdit(undoEdit(undoEdit(h)), paintHill(a, [v(1, 1)]));
    expect(canRedo(h)).toBe(false);
    expect(h.past).toEqual([a]);
  });

  it('ignores no-op commits and empty undo/redo', () => {
    const a = newEditorMap(6, 6);
    const h = createHistory(a);
    expect(commitEdit(h, paintFeature(a, [v(9, 9)], 'rock'))).toBe(h);
    expect(undoEdit(h)).toBe(h);
    expect(redoEdit(h)).toBe(h);
    expect(canUndo(h)).toBe(false);
  });

  it('caps the undo stack', () => {
    let h = createHistory(newEditorMap(6, 6));
    for (let i = 0; i < MAX_UNDO + 20; i++) {
      h = commitEdit(h, paintElevation(h.present, [v(0, 0)], { kind: 'set', value: 1 + (i % 2) }));
    }
    expect(h.past).toHaveLength(MAX_UNDO);
  });
});

import { commitEdit, createHistory, getMap, MAP_LIMITS, mapToBoard, newEditorMap } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import {
  applyDrag,
  applyTool,
  clampMapSize,
  dragCells,
  footprintCells,
  hexMarkings,
  MAX_FOOTPRINT_SIDE,
  mapOverlays,
  mapPreviewState,
  toolDrags,
  ZONE_COLORS,
  zoneCells,
  type EditorTool,
} from '../src/ui/editorView.js';
import { describeHex } from '../src/ui/hexInfo.js';

describe('mapPreviewState', () => {
  it('renders the map board with no units', () => {
    const map = getMap('rocky-pass')!;
    const state = mapPreviewState(map);
    const board = mapToBoard(map);
    expect(state.board.terrain).toEqual(board.terrain);
    expect(state.board.blocked).toEqual(board.blocked ?? []);
    expect(state.units).toEqual([]);
    expect(state.winner).toBeNull();
  });

  it('feeds the hex tooltip for the picked cell', () => {
    const state = mapPreviewState(newEditorMap(8, 6));
    expect(describeHex(state, { x: 7, y: 5 })?.title).toBe('Hex (7, 5)');
    expect(describeHex(state, { x: 8, y: 0 })).toBeNull();
  });
});

describe('clampMapSize', () => {
  it('keeps sizes within the map limits', () => {
    expect(clampMapSize(2, 'width')).toBe(MAP_LIMITS.minWidth);
    expect(clampMapSize(99, 'height')).toBe(MAP_LIMITS.maxHeight);
    expect(clampMapSize(10.4, 'width')).toBe(10);
    expect(clampMapSize(Number.NaN, 'height')).toBe(MAP_LIMITS.minHeight);
  });
});

describe('applyTool', () => {
  const at = (map: ReturnType<typeof newEditorMap>, x: number, y: number) => map.hexes[y * map.width + x];

  it('select leaves the map untouched (same reference)', () => {
    const map = newEditorMap(8, 6);
    expect(applyTool(map, { kind: 'select' }, { x: 3, y: 3 }, 2)).toBe(map);
  });

  it('raises and lowers a single hex at radius 0, clamped to the elevation range', () => {
    let map = newEditorMap(8, 6);
    const raise = { kind: 'elevation', brush: { kind: 'raise' } } as const;
    for (let i = 0; i < 5; i++) map = applyTool(map, raise, { x: 3, y: 3 }, 0);
    expect(at(map, 3, 3)?.elevation).toBe(3);
    expect(at(map, 4, 3)?.elevation).toBe(0);
    map = applyTool(map, { kind: 'elevation', brush: { kind: 'lower' } }, { x: 3, y: 3 }, 0);
    expect(at(map, 3, 3)?.elevation).toBe(2);
  });

  it('sets a whole brush footprint and shows up on the preview board', () => {
    const map = applyTool(newEditorMap(8, 6), { kind: 'elevation', brush: { kind: 'set', value: 2 } }, { x: 3, y: 3 }, 1);
    expect(map.hexes.filter((h) => h.elevation === 2)).toHaveLength(7);
    const board = mapPreviewState(map).board;
    expect(mapToBoard(map).terrain).toEqual(board.terrain);
  });

  it('erase flattens and clears features but keeps deploy zones', () => {
    const rocky = getMap('rocky-pass')!;
    const feature = rocky.hexes.findIndex((h) => h.feature !== undefined);
    const cell = { x: feature % rocky.width, y: Math.floor(feature / rocky.width) };
    const erased = applyTool(rocky, { kind: 'erase' }, cell, 0);
    expect(erased.hexes[feature]).toEqual({ elevation: 0 });
    expect(erased.deployZones).toEqual(rocky.deployZones);
  });

  it('off-board clicks and no-op strokes add no undo step', () => {
    const map = newEditorMap(8, 6);
    expect(applyTool(map, { kind: 'erase' }, { x: 20, y: 20 }, 2)).toBe(map);
    const h = createHistory(map);
    const lowered = applyTool(map, { kind: 'elevation', brush: { kind: 'lower' } }, { x: 1, y: 1 }, 1);
    expect(commitEdit(h, lowered).past).toHaveLength(0);
  });
});

describe('building tool', () => {
  const building = { kind: 'building' } as const;
  const at = (map: ReturnType<typeof newEditorMap>, x: number, y: number) => map.hexes[y * map.width + x];

  it('a click toggles a single-hex building, ignoring the radius and keeping elevation', () => {
    let map = applyTool(newEditorMap(8, 6), { kind: 'elevation', brush: { kind: 'set', value: 2 } }, { x: 3, y: 3 }, 0);
    map = applyTool(map, building, { x: 3, y: 3 }, 2);
    expect(at(map, 3, 3)).toEqual({ elevation: 2, feature: 'building' });
    expect(map.hexes.filter((h) => h.feature === 'building')).toHaveLength(1);
    expect(mapPreviewState(map).board.terrain).toEqual(mapToBoard(map).terrain);
    map = applyTool(map, building, { x: 3, y: 3 }, 0);
    expect(at(map, 3, 3)).toEqual({ elevation: 2 });
  });

  it('a click replaces another feature and ignores off-board hexes', () => {
    const rocky = getMap('rocky-pass')!;
    const i = rocky.hexes.findIndex((h) => h.feature === 'rock');
    const placed = applyTool(rocky, building, { x: i % rocky.width, y: Math.floor(i / rocky.width) }, 0);
    expect(placed.hexes[i]?.feature).toBe('building');
    const map = newEditorMap(8, 6);
    expect(commitEdit(createHistory(map), applyTool(map, building, { x: 9, y: 9 }, 0)).past).toHaveLength(0);
  });

  it('only drag tools take over left-drag', () => {
    expect(toolDrags(building)).toBe(true);
    expect(toolDrags({ kind: 'select' })).toBe(false);
    expect(toolDrags({ kind: 'erase' })).toBe(false);
    expect(dragCells(newEditorMap(8, 6), { kind: 'erase' }, { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([]);
  });

  it('a drag stamps the whole footprint as one undo step', () => {
    const map = newEditorMap(8, 6);
    const stamped = applyDrag(map, building, { x: 4, y: 3 }, { x: 3, y: 2 });
    const cells = [
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
    ];
    for (const c of cells) expect(at(stamped, c.x, c.y)?.feature).toBe('building');
    expect(stamped.hexes.filter((h) => h.feature === 'building')).toHaveLength(4);
    expect(commitEdit(createHistory(map), stamped).past).toHaveLength(1);
  });

  it('caps the footprint side and clips it to the board', () => {
    const map = newEditorMap(12, 10);
    const big = footprintCells(map, { x: 5, y: 5 }, { x: 0, y: 11 });
    expect(Math.max(...big.map((c) => c.x)) - Math.min(...big.map((c) => c.x)) + 1).toBe(MAX_FOOTPRINT_SIDE);
    expect(big.every((c) => c.x >= 2 && c.x <= 5 && c.y >= 5 && c.y <= 8)).toBe(true);
    expect(footprintCells(map, { x: 10, y: 8 }, { x: 13, y: 9 })).toHaveLength(2 * 2);
  });
});

describe('forest & rock tools', () => {
  const forest = { kind: 'area', feature: 'forest' } as const;
  const rock = { kind: 'area', feature: 'rock' } as const;
  const count = (map: ReturnType<typeof newEditorMap>, f: string) => map.hexes.filter((h) => h.feature === f).length;
  const at = (map: ReturnType<typeof newEditorMap>, x: number, y: number) => map.hexes[y * map.width + x];

  it('a radius-0 click places and removes a single hex', () => {
    let map = applyTool(newEditorMap(8, 6), rock, { x: 2, y: 2 }, 0);
    expect(at(map, 2, 2)).toEqual({ elevation: 0, feature: 'rock' });
    expect(count(map, 'rock')).toBe(1);
    map = applyTool(map, rock, { x: 2, y: 2 }, 0);
    expect(count(map, 'rock')).toBe(0);
  });

  it('paints the whole brush and clears it again from a forest centre', () => {
    let map = applyTool(newEditorMap(8, 6), { kind: 'building' }, { x: 4, y: 3 }, 0);
    map = applyTool(map, forest, { x: 3, y: 3 }, 1);
    expect(count(map, 'forest')).toBe(7);
    expect(count(map, 'building')).toBe(0);
    map = applyTool(map, forest, { x: 3, y: 3 }, 2);
    expect(count(map, 'forest')).toBe(0);
    expect(mapPreviewState(map).board.terrain).toEqual(mapToBoard(map).terrain);
  });

  it('clearing leaves other features in the brush alone and keeps elevation', () => {
    let map = applyTool(newEditorMap(8, 6), { kind: 'elevation', brush: { kind: 'set', value: 2 } }, { x: 3, y: 3 }, 0);
    map = applyTool(map, forest, { x: 3, y: 3 }, 0);
    map = applyTool(map, rock, { x: 4, y: 3 }, 0);
    map = applyTool(map, forest, { x: 3, y: 3 }, 1);
    expect(at(map, 3, 3)).toEqual({ elevation: 2 });
    expect(at(map, 4, 3)?.feature).toBe('rock');
  });

  it('a drag fills the whole (uncapped) region as one undo step', () => {
    const map = newEditorMap(12, 10);
    expect(toolDrags(forest)).toBe(true);
    expect(dragCells(map, forest, { x: 0, y: 0 }, { x: 9, y: 1 })).toHaveLength(20);
    const filled = applyDrag(map, forest, { x: 0, y: 0 }, { x: 9, y: 1 });
    expect(count(filled, 'forest')).toBe(20);
    expect(commitEdit(createHistory(map), filled).past).toHaveLength(1);
  });

  it('a drag started on the feature clears it from the region', () => {
    let map = applyDrag(newEditorMap(12, 10), rock, { x: 1, y: 1 }, { x: 5, y: 4 });
    map = applyTool(map, forest, { x: 3, y: 2 }, 0);
    map = applyDrag(map, rock, { x: 1, y: 1 }, { x: 3, y: 4 });
    expect(count(map, 'rock')).toBe(2 * 4);
    expect(at(map, 3, 2)?.feature).toBe('forest');
    expect(at(map, 4, 1)?.feature).toBe('rock');
  });
});

describe('zone & objective tools', () => {
  const blank = () => ({ ...newEditorMap(8, 6), deployZones: [[], []] as [never[], never[]] });
  const deploy = (player: 0 | 1): EditorTool => ({ kind: 'zone', zone: { kind: 'deploy', player } });
  const hill: EditorTool = { kind: 'zone', zone: { kind: 'hill' } };
  const conquest = (index: 0 | 1 | 2): EditorTool => ({ kind: 'zone', zone: { kind: 'conquest', index } });

  it('zone tools drag; flag tools do not', () => {
    expect(toolDrags(deploy(0))).toBe(true);
    expect(toolDrags(hill)).toBe(true);
    expect(toolDrags({ kind: 'flag', player: 0 })).toBe(false);
    expect(dragCells(blank(), { kind: 'flag', player: 0 }, { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([]);
  });

  it('a click paints the brush into a deploy zone, and clicking the zone removes it', () => {
    const painted = applyTool(blank(), deploy(0), { x: 3, y: 3 }, 1);
    expect(painted.deployZones[0]).toHaveLength(7);
    expect(painted.deployZones[1]).toEqual([]);
    const cleared = applyTool(painted, deploy(0), { x: 3, y: 3 }, 0);
    expect(cleared.deployZones[0]).toHaveLength(6);
    expect(cleared.deployZones[0]).not.toContainEqual({ x: 3, y: 3 });
  });

  it('deploy zones stay disjoint when painted over each other', () => {
    const a = applyDrag(blank(), deploy(0), { x: 0, y: 0 }, { x: 2, y: 1 });
    const b = applyTool(a, deploy(1), { x: 1, y: 0 }, 0);
    expect(b.deployZones[0]).toHaveLength(5);
    expect(b.deployZones[1]).toEqual([{ x: 1, y: 0 }]);
  });

  it('drag fills a region, or clears it when started inside the zone', () => {
    const filled = applyDrag(blank(), hill, { x: 2, y: 2 }, { x: 4, y: 3 });
    expect(zoneCells(filled, { kind: 'hill' })).toHaveLength(6);
    const cleared = applyDrag(filled, hill, { x: 4, y: 3 }, { x: 5, y: 5 });
    expect(zoneCells(cleared, { kind: 'hill' })).toHaveLength(5);
    expect(applyDrag(filled, hill, { x: 2, y: 2 }, { x: 4, y: 3 }).objectives).toEqual({});
  });

  it('conquest zones are painted separately and kept disjoint', () => {
    let m = applyTool(blank(), conquest(0), { x: 1, y: 1 }, 0);
    m = applyTool(m, conquest(2), { x: 6, y: 4 }, 1);
    expect(m.objectives.conquest?.map((z) => z.length)).toEqual([1, 0, 7]);
    m = applyTool(m, conquest(1), { x: 6, y: 4 }, 0);
    expect(m.objectives.conquest?.map((z) => z.length)).toEqual([1, 1, 6]);
  });

  it('the first flag mirrors the other; later clicks move one base; same hex is a no-op', () => {
    const m = applyTool(blank(), { kind: 'flag', player: 0 }, { x: 1, y: 2 }, 2);
    expect(m.objectives.flags).toEqual([{ x: 1, y: 2 }, { x: 6, y: 3 }]);
    const moved = applyTool(m, { kind: 'flag', player: 1 }, { x: 7, y: 0 }, 0);
    expect(moved.objectives.flags).toEqual([{ x: 1, y: 2 }, { x: 7, y: 0 }]);
    expect(applyTool(moved, { kind: 'flag', player: 1 }, { x: 7, y: 0 }, 0)).toBe(moved);
    expect(applyTool(moved, { kind: 'flag', player: 1 }, { x: 9, y: 0 }, 0)).toBe(moved);
  });

  it('a no-op zone click adds no undo step', () => {
    const h = createHistory(blank());
    expect(commitEdit(h, applyTool(h.present, hill, { x: 20, y: 20 }, 0)).past).toHaveLength(0);
  });
});

describe('mapOverlays & hexMarkings', () => {
  it('draws deploy zones and nothing else on a fresh map', () => {
    const m = newEditorMap(8, 6);
    const o = mapOverlays(m);
    expect(o.map((x) => x.color)).toEqual([ZONE_COLORS.deploy[0], ZONE_COLORS.deploy[1]]);
    expect(o[0]!.cells).toEqual(m.deployZones[0]);
  });

  it('adds hill, conquest and flag overlays, flags last', () => {
    const m = getMap('crossroads')!;
    const o = mapOverlays(m);
    const conquestCount = m.objectives.conquest ? 3 : 0;
    const flagCount = m.objectives.flags ? 2 : 0;
    expect(o).toHaveLength(2 + (m.objectives.hill ? 1 : 0) + conquestCount + flagCount);
    if (m.objectives.flags) expect(o[o.length - 1]!.cells).toEqual([m.objectives.flags[1]]);
  });

  it('lists what a hex is part of', () => {
    let m = applyTool(newEditorMap(8, 6), { kind: 'flag', player: 0 }, { x: 0, y: 0 }, 0);
    m = applyTool(m, { kind: 'zone', zone: { kind: 'hill' } }, { x: 0, y: 0 }, 0);
    expect(hexMarkings(m, { x: 0, y: 0 })).toEqual(['Deploy zone: player 1', 'Flag base: player 1', 'Hill zone']);
    expect(hexMarkings(m, { x: 4, y: 3 })).toEqual([]);
  });
});

import { commitEdit, createHistory, getMap, MAP_LIMITS, mapToBoard, newEditorMap } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { applyTool, clampMapSize, mapPreviewState } from '../src/ui/editorView.js';
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

import { getMap, MAP_LIMITS, mapToBoard, newEditorMap } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { clampMapSize, mapPreviewState } from '../src/ui/editorView.js';
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

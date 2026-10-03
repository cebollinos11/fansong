import { describe, expect, it } from 'vitest';
import { createGame, makeHexGrid, reduce, getLegalCommands, vecKey } from '@fansong/engine';
import { buildMatch, DEFAULT_BOARD, DEFAULT_MAP, defaultPigRounds, GOLDEN_PIG, layOutWarband } from '../src/deploy.js';
import { listMaps } from '../src/mapRegistry.js';
import { supportedModes } from '../src/mapValidate.js';
import { PRESETS } from '../src/presets.js';

const board = DEFAULT_BOARD;

describe('layOutWarband', () => {
  it('places player 0 on the left edge and player 1 on the right edge', () => {
    const p0 = layOutWarband(PRESETS['iron-wardens-medium']!.units, 0, board);
    const p1 = layOutWarband(PRESETS['ashfang-raiders-medium']!.units, 1, board);
    expect(p0.every((s) => s.pos.x === 0)).toBe(true); // one column fits
    expect(p1.every((s) => s.pos.x === board.width - 1)).toBe(true);
  });

  it('keeps every model in bounds with no two sharing a cell', () => {
    // A deliberately overflowing roster to exercise column wrapping.
    const units = Array.from({ length: board.height + 3 }, (_, i) => ({
      name: `U${i}`,
      quality: 4,
      combat: 2,
    }));
    const specs = layOutWarband(units, 0, board);
    const seen = new Set<string>();
    for (const s of specs) {
      expect(s.pos.x).toBeGreaterThanOrEqual(0);
      expect(s.pos.x).toBeLessThan(board.width);
      expect(s.pos.y).toBeGreaterThanOrEqual(0);
      expect(s.pos.y).toBeLessThan(board.height);
      const key = vecKey(s.pos);
      expect(seen.has(key), `collision at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('wraps overflow into a second column inward from the edge', () => {
    const units = Array.from({ length: board.height + 1 }, (_, i) => ({
      name: `U${i}`,
      quality: 4,
      combat: 2,
    }));
    const p0 = layOutWarband(units, 0, board);
    const p1 = layOutWarband(units, 1, board);
    expect(p0.some((s) => s.pos.x === 1)).toBe(true);
    expect(p1.some((s) => s.pos.x === board.width - 2)).toBe(true);
  });
});

describe('buildMatch', () => {
  it('produces a config that createGame accepts and can start reducing', () => {
    const config = buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['bonefield-legion-medium']!, {
      seed: 7,
      board,
    });
    const state = createGame(config);
    expect(state.units).toHaveLength(
      PRESETS['iron-wardens-medium']!.units.length + PRESETS['bonefield-legion-medium']!.units.length,
    );
    // No two units start stacked, and there is a legal opening move.
    expect(new Set(state.units.map((u) => vecKey(u.pos))).size).toBe(state.units.length);
    expect(getLegalCommands(state).length).toBeGreaterThan(0);
    // One reduce step keeps the game well-formed.
    const next = reduce(state, getLegalCommands(state)[0]!);
    expect(next.state.units).toHaveLength(state.units.length);
  });

  it('honours the requested initiative leader', () => {
    const config = buildMatch(PRESETS['iron-wardens-medium']!, PRESETS['bonefield-legion-medium']!, {
      seed: 1,
      board,
      initiativeLeader: 1,
    });
    expect(createGame(config).initiativeLeader).toBe(1);
  });
});

describe('buildMatch: extract the golden Pig', () => {
  const p0 = PRESETS['iron-wardens-medium']!;
  const p1 = PRESETS['ashfang-raiders-medium']!;
  const map = listMaps().find((m) => m.id === 'old-forest')!;

  it('adds the Pig last to the escort, leaving every other unit id as it was', () => {
    const plain = buildMatch(p0, p1, { seed: 3, map });
    const config = buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' });
    expect(config.warbands[0]).toHaveLength(p0.units.length + 1);
    expect(config.warbands[1]).toHaveLength(p1.units.length);
    expect(config.warbands[0].map((s) => s.name)).toEqual([...plain.warbands[0].map((s) => s.name), GOLDEN_PIG.name]);
    const pig = config.warbands[0].at(-1)!;
    expect(pig).toMatchObject({ pig: true, quality: 2, combat: 3, slow: true, tough: true, look: 'Piglet', tint: '#ffd700' });
    expect(config.warbands.flat().filter((s) => s.pig)).toHaveLength(1);
    const state = createGame(config);
    expect(state.mode?.pig).toEqual({ unitId: `p0u${p0.units.length}`, escort: 0 });
    expect(new Set(state.units.map((u) => vecKey(u.pos))).size).toBe(state.units.length);
  });

  it('deploys the Pig in the middle of the back rank', () => {
    const config = buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' });
    const board = makeHexGrid({ width: map.width, height: map.height, blocked: [] });
    const depth = (v: { x: number; y: number }) => Math.min(...map.deployZones[1].map((e) => board.distance(v, e)));
    const pig = config.warbands[0].at(-1)!;
    expect(depth(pig.pos)).toBe(Math.max(...map.deployZones[0].map(depth)));
    // On the flat board the escort's eight models fill rows 1–8 of its edge column.
    const flat = buildMatch(p0, p1, { seed: 3, mode: 'golden-pig' });
    expect(flat.warbands[0].at(-1)!.pos).toEqual({ x: 0, y: 4 });
    expect(new Set(flat.warbands[0].map((s) => vecKey(s.pos))).size).toBe(flat.warbands[0].length);
    expect(buildMatch(p0, p1, { seed: 3, mode: 'golden-pig', escort: 1 }).warbands[1].at(-1)!.pos).toEqual({ x: DEFAULT_BOARD.width - 1, y: 4 });
  });

  it('makes the defender’s deploy zone the goal, for either escort', () => {
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' }).objectives).toEqual({ extraction: map.deployZones[1] });
    const swapped = buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig', escort: 1 });
    expect(swapped.objectives).toEqual({ extraction: map.deployZones[0] });
    expect(swapped.warbands[0]).toHaveLength(p0.units.length);
    expect(swapped.warbands[1].at(-1)).toMatchObject({ name: GOLDEN_PIG.name, pig: true });
    expect(createGame(swapped).mode?.pig).toEqual({ unitId: `p1u${p1.units.length}`, escort: 1 });
  });

  it('plays on the flat default board too, aiming for the defender’s edge column', () => {
    const config = buildMatch(p0, p1, { seed: 3, mode: 'golden-pig' });
    expect(config.objectives?.extraction).toEqual(Array.from({ length: DEFAULT_BOARD.height }, (_, y) => ({ x: DEFAULT_BOARD.width - 1, y })));
    expect(createGame(config).mode?.pig?.escort).toBe(0);
  });

  it('sets the round limit from the walk to the goal unless one is given', () => {
    expect(defaultPigRounds(DEFAULT_MAP)).toBe(PIG_ROUNDS_DEFAULT_BOARD);
    expect(defaultPigRounds(DEFAULT_MAP, 1)).toBe(PIG_ROUNDS_DEFAULT_BOARD);
    expect(buildMatch(p0, p1, { seed: 3, mode: 'golden-pig' }).limits).toEqual({ roundLimit: PIG_ROUNDS_DEFAULT_BOARD });
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig' }).limits).toEqual({ roundLimit: defaultPigRounds(map) });
    for (const m of listMaps()) {
      expect(defaultPigRounds(m)).toBeGreaterThanOrEqual(5);
      expect(defaultPigRounds(m)).toBeLessThanOrEqual(50);
    }
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig', limits: { roundLimit: 9 } }).limits).toEqual({ roundLimit: 9 });
    expect(buildMatch(p0, p1, { seed: 3, map, mode: 'golden-pig', limits: { roundLimit: null } }).limits).toEqual({ roundLimit: null });
    // Other modes get no limit of their own from here.
    expect(buildMatch(p0, p1, { seed: 3, map }).limits).toBeUndefined();
  });

  it('is hosted by every built-in map, and ignores the escort in other modes', () => {
    for (const m of listMaps()) expect(supportedModes(m)).toContain('golden-pig');
    expect(buildMatch(p0, p1, { seed: 3, map, escort: 1 })).toEqual(buildMatch(p0, p1, { seed: 3, map }));
  });
});

/** ceil(10 hexes / 3 per Move) + 4 on the flat 12×10 board. */
const PIG_ROUNDS_DEFAULT_BOARD = 8;

import { describe, expect, it } from 'vitest';
import { buildMatch, DEFAULT_BOARD, getMap, listMaps, PRESETS, supportedModes } from '@fansong/content';
import { createDemoGame, createGame } from '@fansong/engine';
import { renderRoster } from '../src/format.js';
import { CliError, helpText, listText, parseArgs, resultLine, setupMatch } from '../src/options.js';

describe('parseArgs', () => {
  it('defaults to the demo on the flat board', () => {
    const opts = parseArgs([]);
    expect(opts).toMatchObject({ seed: 42, map: null, mode: null, p0: null, p1: null, list: false });
    expect(setupMatch(opts).state).toEqual(createDemoGame(42));
  });

  it('reads --map, --mode and the other flags', () => {
    const opts = parseArgs(['--map', 'crossroads', '--mode', 'conquest', '--seed', '7', '-q', '--p0', 'iron-wardens']);
    expect(opts).toMatchObject({ map: 'crossroads', mode: 'conquest', seed: 7, quiet: true, p0: 'iron-wardens' });
    expect(parseArgs(['--list']).list).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('rejects unknown modes, unknown options and missing values', () => {
    expect(() => parseArgs(['--mode', 'deathmatch'])).toThrow(CliError);
    expect(() => parseArgs(['--mode', 'deathmatch'])).toThrow(/capture-the-flag/);
    expect(() => parseArgs(['--bogus'])).toThrow(/Unknown option/);
    expect(() => parseArgs(['--map'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--map', '--quiet'])).toThrow(/needs a value/);
    expect(() => parseArgs(['--seed', 'x'])).toThrow(/needs a number/);
  });
});

describe('setupMatch', () => {
  it('without map or mode keeps the legacy preset config (no mode keys)', () => {
    const { state } = setupMatch(parseArgs(['--p0', 'iron-wardens', '--p1', 'ashfang-raiders', '--seed', '3']));
    const legacy = createGame(
      buildMatch(PRESETS['iron-wardens']!, PRESETS['ashfang-raiders']!, { seed: 3, board: DEFAULT_BOARD }),
    );
    expect(state).toEqual(legacy);
    expect(state.mode).toBeUndefined();
  });

  it('--map plays on the map terrain; annihilation adds no mode state', () => {
    const { state, label } = setupMatch(parseArgs(['--map', 'rocky-pass']));
    const map = getMap('rocky-pass')!;
    expect(state.board.width).toBe(map.width);
    expect(state.board.terrain).toBeDefined();
    expect(state.mode).toBeUndefined();
    expect(label).toContain(map.name);
    // Unspecified sides field the fallback preset.
    expect(label).toContain(`${PRESETS['free-company']!.name} (P0)`);
  });

  it('--mode sets up every mode on every map that supports it', () => {
    for (const map of listMaps()) {
      for (const mode of supportedModes(map)) {
        const { state, label } = setupMatch(parseArgs(['--map', map.id, '--mode', mode]));
        if (mode === 'annihilation') expect(state.mode).toBeUndefined();
        else {
          expect(state.mode?.mode).toBe(mode);
          expect(label).toContain(mode);
        }
      }
    }
  });

  it('kill-the-king works on the default board and marks Kings in the roster', () => {
    const { state } = setupMatch(parseArgs(['--mode', 'kill-the-king']));
    expect(state.mode?.kings).toHaveLength(2);
    expect(renderRoster(state).match(/♛/g)).toHaveLength(2);
  });

  it('rejects unknown presets/maps and modes a map cannot host', () => {
    expect(() => setupMatch(parseArgs(['--map', 'atlantis']))).toThrow(/Unknown map "atlantis"/);
    expect(() => setupMatch(parseArgs(['--p0', 'nobody']))).toThrow(/Unknown preset/);
    expect(() => setupMatch(parseArgs(['--mode', 'conquest']))).toThrow(/pass --map.*crossroads/);
    const unsupported = listMaps().find((m) => !supportedModes(m).includes('capture-the-flag'))!;
    expect(() => setupMatch(parseArgs(['--map', unsupported.id, '--mode', 'capture-the-flag']))).toThrow(
      new RegExp(`not supported on map "${unsupported.id}"`),
    );
  });
});

describe('--list / --help text', () => {
  it('lists every preset, map (with its modes) and mode', () => {
    const text = listText();
    for (const id of Object.keys(PRESETS)) expect(text).toContain(id);
    for (const map of listMaps()) {
      const line = text.split('\n').find((l) => l.trimStart().startsWith(map.id + ' '))!;
      expect(line).toContain(map.name);
      expect(line).toContain(supportedModes(map).join(', '));
    }
    expect(text).toContain('Modes: annihilation, kill-the-king');
    expect(helpText()).toContain('--map <id>');
    expect(helpText()).toContain('--mode <mode>');
  });
});

describe('resultLine', () => {
  it('shows the score in points modes only', () => {
    const koth = setupMatch(parseArgs(['--map', 'rolling-hills', '--mode', 'king-of-the-hill'])).state;
    const over = { ...koth, phase: 'gameOver' as const, winner: 1 as const, mode: { ...koth.mode!, scores: [2, 5] as [number, number] } };
    expect(resultLine(over, 99, 5000)).toBe(`Result: P1 wins after ${koth.round} round(s), 99 steps, score 2–5.`);
    const ctf = setupMatch(parseArgs(['--map', 'twin-towers', '--mode', 'capture-the-flag'])).state;
    expect(resultLine({ ...ctf, phase: 'gameOver', winner: 0 }, 5, 5000)).toMatch(/5 steps\.$/);
    const demo = { ...createDemoGame(1), phase: 'gameOver' as const, winner: 0 as const };
    expect(resultLine(demo, 10, 5000)).toMatch(/steps\.$/);
    expect(resultLine(createDemoGame(1), 10, 5000)).toMatch(/no winner within 5000/);
  });
});

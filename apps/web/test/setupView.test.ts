import { getMap, DEFAULT_MAP_ID, defaultKing, PRESETS, presetUnit, supportedModes, type WarbandUnit } from '@fansong/content';
import { describe, expect, it } from 'vitest';
import { formation, kingIn, modesOf } from '../src/ui/setupView.js';

const soldier = presetUnit('Ironguard')!;
const giant: WarbandUnit = { ...soldier, name: 'Giant', big: true };
const band = (n: number): WarbandUnit[] => Array.from({ length: n }, () => soldier);

describe('formation', () => {
  it('gives every unit a hex of its own, whatever the size of the warband', () => {
    for (const n of [1, 2, 3, 4, 7, 12, 15, 16, 30]) {
      const f = formation(band(n), 0);
      expect(f.slots.map((s) => s.index)).toEqual([...Array(n).keys()]);
      expect(new Set(f.slots.map((s) => `${s.col},${s.row}`)).size).toBe(n);
      for (const s of f.slots) {
        expect(s.col).toBeLessThan(f.cols);
        expect(s.row).toBeLessThan(f.rows);
      }
    }
  });

  it('places every preset warband', () => {
    for (const w of Object.values(PRESETS)) expect(formation(w.units, 0).slots).toHaveLength(w.units.length);
  });

  it('stands the lead in the front file and fills up from the front', () => {
    const f = formation(band(7), 4);
    expect(f.slots[4]!.col).toBe(0);
    // Only the last file may be short of units.
    const perFile = Array.from({ length: f.cols }, (_, col) => f.slots.filter((s) => s.col === col).length);
    expect(perFile.slice(0, -1).every((count) => count === f.rows)).toBe(true);
  });

  it('draws small warbands large and large ones small', () => {
    expect(formation(band(3), 0)).toMatchObject({ size: 'large', rows: 1, cols: 3 });
    expect(formation(band(12), 0)).toMatchObject({ size: 'medium', rows: 3, cols: 4 });
    expect(formation(band(30), 0)).toMatchObject({ size: 'small', rows: 5, cols: 6 });
  });

  it('keeps Big units in the top rank, where they hide nobody', () => {
    const units = [soldier, soldier, soldier, giant, soldier, giant, soldier, soldier, soldier];
    const f = formation(units, 0);
    expect(f.slots[3]!.row).toBe(0);
    expect(f.slots[5]!.row).toBe(0);
  });
});

describe('modesOf', () => {
  it('matches supportedModes and is worked out once per map', () => {
    const map = getMap(DEFAULT_MAP_ID)!;
    expect(modesOf(map)).toEqual(supportedModes(map));
    expect(modesOf(map)).toBe(modesOf(map));
  });
});

describe('kingIn', () => {
  it('keeps the King a side picked, and crowns the roster default once it is gone', () => {
    const band3 = band(3);
    expect(kingIn(band3, 2)).toBe(2);
    // The army behind a King can be edited shorter while the setup screen waits.
    for (const out of [-1, 3, 99]) expect(kingIn(band3, out)).toBe(defaultKing(band3));
  });
});

import { defaultKing, supportedModes, type MapDef, type WarbandUnit } from '@fansong/content';
import type { GameMode } from '@fansong/engine';

// Pure pieces of the setup screen (no DOM), so they can be unit-tested.

const modesByMap = new WeakMap<MapDef, readonly GameMode[]>();

/**
 * The modes a map can host, worked out once per map: checking a map walks all
 * of it, which is too slow to redo for every card each time a gallery opens.
 */
export function modesOf(map: MapDef): readonly GameMode[] {
  let modes = modesByMap.get(map);
  if (!modes) modesByMap.set(map, (modes = supportedModes(map)));
  return modes;
}

/** Where one unit stands in a {@link Formation}. */
export interface FormationSlot {
  /** Index into the warband's units. */
  index: number;
  /** File, counted back from the enemy: 0 is the front. */
  col: number;
  /** Rank, from the top of the picture down. */
  row: number;
}

/** A whole warband drawn up on a patch of hexes, facing its enemy. */
export interface Formation {
  cols: number;
  rows: number;
  /** How large to draw it: the fewer the units, the larger each stands. */
  size: 'large' | 'medium' | 'small';
  slots: FormationSlot[];
}

/**
 * Stand every unit of a warband on its own hex. `lead` (the leader, or the
 * King) takes the middle of the front file. Big units take the top rank, where
 * nobody stands behind them to be hidden; the rest fill up from the front.
 */
export function formation(units: readonly WarbandUnit[], lead: number): Formation {
  const n = units.length;
  const size = n <= 6 ? 'large' : n <= 15 ? 'medium' : 'small';
  const rows = n <= 3 ? 1 : n <= 8 ? 2 : n <= 15 ? 3 : n <= 24 ? 4 : 5;
  const cols = Math.max(1, Math.ceil(n / rows));
  // The ranks of a file, most wanted first: the middle, then outwards.
  const middle = Math.floor(rows / 2);
  const ranks = [...Array(rows).keys()].sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle) || a - b);
  const free: { col: number; row: number }[] = [];
  for (let col = 0; col < cols && free.length < n; col++) {
    for (const row of ranks) if (free.length < n) free.push({ col, row });
  }

  const slots: FormationSlot[] = [];
  const place = (index: number, at: number): void => {
    slots.push({ index, ...free.splice(at, 1)[0]! });
  };
  const order = units.map((_, i) => i);
  if (lead >= 0 && lead < n) {
    order.splice(lead, 1);
    place(lead, 0);
  }
  for (const i of order.filter((i) => units[i]!.big)) place(i, Math.max(0, free.findIndex((s) => s.row === 0)));
  for (const i of order.filter((i) => !units[i]!.big)) place(i, 0);
  return { cols, rows, size, slots: slots.sort((a, b) => a.index - b.index) };
}

/**
 * A chosen King kept inside a roster that may have been edited under it: the
 * unit picked if it is still there, else whichever unit the roster leads with.
 */
export function kingIn(units: readonly WarbandUnit[], king: number): number {
  return king >= 0 && king < units.length ? king : defaultKing(units);
}

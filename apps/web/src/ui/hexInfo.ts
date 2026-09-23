import { vecKey, type GameState, type Vec } from '@fansong/engine';
import { traitLine } from './hudView.js';

// Pure hex-tooltip text (no DOM), so it can be unit-tested.

const FEATURE_TEXT = {
  rock: 'Rocks — impassable, blocks sight',
  building: 'Building — impassable, blocks sight',
  forest: 'Forest — blocks sight through it',
} as const;

export interface HexInfo {
  title: string;
  lines: string[];
}

/** Describe a board hex for the hover tooltip; null when the cell is off the board. */
export function describeHex(state: GameState, cell: Vec): HexInfo | null {
  const { board } = state;
  if (cell.x < 0 || cell.y < 0 || cell.x >= board.width || cell.y >= board.height) return null;
  const key = vecKey(cell);
  const terrain = board.terrain?.[key];
  const lines: string[] = [];
  const elevation = terrain?.elevation ?? 0;
  lines.push(elevation > 0 ? `Elevation ${elevation} — high ground` : 'Elevation 0');
  if (board.blocked.includes(key)) lines.push('Blocked — impassable, blocks sight');
  if (terrain?.feature) lines.push(FEATURE_TEXT[terrain.feature]);
  const unit = state.units.find((u) => !u.dead && vecKey(u.pos) === key);
  if (unit) {
    const marks = [unit.knockedDown ? 'knocked down' : null, unit.guarding ? 'on guard' : null].filter(Boolean);
    lines.push([`${unit.name} (P${unit.owner})`, ...marks].join(' · '));
    lines.push(`Q${unit.quality} · C${unit.combat} · M${unit.move}`);
    // The abilities decide how the unit must be fought, so the tooltip names them.
    const traits = traitLine(unit);
    if (traits) lines.push(traits);
  }
  return { title: `Hex (${cell.x}, ${cell.y})`, lines };
}

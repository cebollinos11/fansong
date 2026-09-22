import { unitById, type GameEvent, type GameState, type TerrainFeature } from '@fansong/engine';

function name(state: GameState, id: string | null): string {
  if (!id) return '(none)';
  const u = unitById(state, id);
  return u ? `${u.name}[${u.id}]` : id;
}

/** One-line human description of an event, resolved against post-reduce state. */
export function formatEvent(state: GameState, e: GameEvent): string {
  switch (e.type) {
    case 'ActivationChosen':
      return `P${e.player} activates ${name(state, e.unitId)} with ${e.diceCount} dice`;
    case 'DiceRolled':
      return `  rolls [${e.dice.join(', ')}] vs Q${e.quality} -> ${e.successes} hit / ${e.failures} miss`;
    case 'Turnover':
      return `  ✗ TURNOVER — P${e.player} benched for the round`;
    case 'UnitStoodUp':
      return `  ${name(state, e.unitId)} stands up`;
    case 'UnitMoved':
      return `  ${name(state, e.unitId)} moves (${e.from.x},${e.from.y}) -> (${e.to.x},${e.to.y})`;
    case 'AttackResolved':
      return `  ${name(state, e.attackerId)} attacks ${name(state, e.targetId)}: ${e.attackScore} vs ${e.defenseScore} (d${e.attackDie}/d${e.defenseDie}) -> ${e.result}`;
    case 'ShotResolved':
      return `  ${name(state, e.attackerId)} shoots ${name(state, e.targetId)}: ${e.attackScore} vs ${e.defenseScore} (d${e.attackDie}/d${e.defenseDie}) -> ${e.result}`;
    case 'GuardDeclared':
      return `  ${name(state, e.unitId)} raises guard`;
    case 'GuardRiposte':
      return `  ⚔ ${name(state, e.guardId)} ripostes ${name(state, e.attackerId)}: ${e.guardScore} vs ${e.attackerScore} (d${e.guardDie}/d${e.attackerDie}) -> ${e.result}${e.prevented ? ' (attack stopped)' : ''}`;
    case 'ToughnessSaved':
      return `    ${name(state, e.unitId)} shrugs off the blow (Tough)`;
    case 'NerveCheck':
      return `    ${name(state, e.unitId)} nerve check d${e.die} vs Q${e.quality} -> ${e.passed ? 'holds' : 'falters'}`;
    case 'WarbandBroken':
      return `  ‼ P${e.player}'s warband BREAKS`;
    case 'UnitRouted':
      return `    ⚑ ${name(state, e.unitId)} routs and flees the field`;
    case 'UnitKnockedDown':
      return `    ${name(state, e.unitId)} is knocked down`;
    case 'UnitRecoiled':
      return `    ${name(state, e.unitId)} is pushed back to (${e.to.x},${e.to.y})`;
    case 'UnitKilled':
      return `    ☠ ${name(state, e.unitId)} is killed`;
    case 'ActivationEnded':
      return `  — activation ends (${name(state, e.unitId)})`;
    case 'RoundEnded':
      return `=== Round ${e.round} begins — P${e.nextLeader} leads ===`;
    case 'ScoreChanged':
      return `  ★ P${e.player} scores ${e.points} (${e.scores[0]}–${e.scores[1]})`;
    case 'FlagPickedUp':
      return `  ⚐ ${name(state, e.unitId)} seizes P${e.player}'s flag`;
    case 'FlagDropped':
      return `  ⚐ ${name(state, e.unitId)} drops P${e.player}'s flag at (${e.at.x},${e.at.y})`;
    case 'FlagReturned':
      return `  ⚐ ${name(state, e.unitId)} returns P${e.player}'s flag to base`;
    case 'FlagCaptured':
      return `  ★ ${name(state, e.unitId)} carries the flag home — P${e.player} captures!`;
    case 'GameOver':
      return `### GAME OVER — P${e.winner} wins${e.reason ? ` (${e.reason})` : ''} ###`;
  }
}

const FEATURE_GLYPH: Record<TerrainFeature, string> = {
  rock: '^',
  building: 'B',
  forest: 'T',
};

/**
 * ASCII render of the flat-top hex board (offset "odd-q" coordinates: odd columns
 * sit half a cell lower, so vertical neighbours interlock). A cell's glyph is its
 * unit's initial (P0 upper-case, P1 lower-case); otherwise '#' is legacy blocked
 * terrain, '^' rock, 'B' building, 'T' forest and '·' an empty cell. A raised hex
 * shows its elevation (1–3) as a digit right after the glyph.
 */
export function renderBoard(state: GameState): string {
  const { width, height } = state.board;
  const blocked = new Set(state.board.blocked);
  const terrain = state.board.terrain ?? {};

  const glyphAt = (x: number, y: number): string => {
    const unit = state.units.find((u) => !u.dead && u.pos.x === x && u.pos.y === y);
    if (unit) {
      const g = unit.name[0] ?? '?';
      return unit.owner === 0 ? g.toUpperCase() : g.toLowerCase();
    }
    if (blocked.has(`${x},${y}`)) return '#';
    const feature = terrain[`${x},${y}`]?.feature;
    return feature ? FEATURE_GLYPH[feature] : '·';
  };

  // One text line per half-row; odd columns are dropped a half-row (one line).
  // Neighbouring columns never share a line, so the spacer after a glyph is
  // free to carry that hex's elevation.
  const lineCount = height * 2 + 1;
  const canvas: string[][] = Array.from({ length: lineCount }, () =>
    Array.from({ length: width * 2 }, () => ' '),
  );
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const li = y * 2 + (x % 2);
      canvas[li]![x * 2] = glyphAt(x, y);
      const elevation = terrain[`${x},${y}`]?.elevation ?? 0;
      if (elevation > 0) canvas[li]![x * 2 + 1] = String(elevation);
    }
  }

  const header = '  ' + Array.from({ length: width }, (_, x) => (x % 10).toString()).join(' ');
  return header + '\n' + canvas.map((line) => line.join('').replace(/\s+$/, '')).join('\n');
}

/** Roster summary: which units are alive, on which side (kill-the-king Kings marked ♛). */
export function renderRoster(state: GameState): string {
  const kings = new Set(state.mode?.kings ?? []);
  const side = (owner: 0 | 1) =>
    state.units
      .filter((u) => u.owner === owner)
      .map((u) => `${kings.has(u.id) ? '♛' : ''}${u.name}${u.dead ? '†' : u.knockedDown ? '↓' : ''}`)
      .join(', ');
  return `P0: ${side(0)}\nP1: ${side(1)}`;
}

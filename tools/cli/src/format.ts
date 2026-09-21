import { unitById, type GameEvent, type GameState } from '@fansong/engine';

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
    case 'UnitKilled':
      return `    ☠ ${name(state, e.unitId)} is killed`;
    case 'ActivationEnded':
      return `  — activation ends (${name(state, e.unitId)})`;
    case 'RoundEnded':
      return `=== Round ${e.round} begins — P${e.nextLeader} leads ===`;
    case 'GameOver':
      return `### GAME OVER — P${e.winner} wins ###`;
  }
}

/** ASCII render of the board. Living units shown by id digit; '#' blocked, '.' empty. */
export function renderBoard(state: GameState): string {
  const { width, height } = state.board;
  const blocked = new Set(state.board.blocked);
  const rows: string[] = [];
  rows.push('   ' + Array.from({ length: width }, (_, x) => x).join(' '));
  for (let y = 0; y < height; y++) {
    const cells: string[] = [];
    for (let x = 0; x < width; x++) {
      const unit = state.units.find((u) => !u.dead && u.pos.x === x && u.pos.y === y);
      if (unit) {
        const glyph = unit.name[0] ?? '?';
        cells.push(unit.owner === 0 ? glyph.toUpperCase() : glyph.toLowerCase());
      } else if (blocked.has(`${x},${y}`)) {
        cells.push('#');
      } else {
        cells.push('.');
      }
    }
    rows.push(`${String(y).padStart(2)} ${cells.join(' ')}`);
  }
  return rows.join('\n');
}

/** Roster summary: which units are alive, on which side. */
export function renderRoster(state: GameState): string {
  const side = (owner: 0 | 1) =>
    state.units
      .filter((u) => u.owner === owner)
      .map((u) => `${u.name}${u.dead ? '†' : u.knockedDown ? '↓' : ''}`)
      .join(', ');
  return `P0: ${side(0)}\nP1: ${side(1)}`;
}

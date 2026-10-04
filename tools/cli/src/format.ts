import { unitById, type GameEvent, type GameState, type TerrainFeature } from '@fansong/engine';

function name(state: GameState, id: string | null): string {
  if (!id) return '(none)';
  const u = unitById(state, id);
  return u ? `${u.name}[${u.id}]` : id;
}

/** Score modifiers worth calling out, e.g. " [outnumbered -1, cover -1]". */
function mods(parts: [string, number | undefined][]): string {
  const shown = parts.filter(([, v]) => v).map(([label, v]) => `${label} ${v! > 0 ? '+' : ''}${v}`);
  return shown.length ? ` [${shown.join(', ')}]` : '';
}

const gore = (e: { gruesome?: true }) => (e.gruesome ? ' (gruesome!)' : '');

/** One-line human description of an event, resolved against post-reduce state. */
export function formatEvent(state: GameState, e: GameEvent): string {
  switch (e.type) {
    case 'ActivationChosen':
      return e.group
        ? `P${e.player} activates a group of ${e.group.length} (${e.group.map((id) => name(state, id)).join(', ')}) with ${e.diceCount} dice`
        : `P${e.player} activates ${name(state, e.unitId)} with ${e.diceCount} dice`;
    case 'DiceRolled':
      return `  rolls [${e.dice.join(', ')}] vs Q${e.quality} -> ${e.successes} hit / ${e.failures} miss${e.inspired ? ' (inspired: first die a 6)' : ''}`;
    case 'Turnover':
      return `  ✗ TURNOVER — P${e.player} benched for the round`;
    case 'UnitStoodUp':
      return e.reassembled
        ? `  ${name(state, e.unitId)} reassembles and stands up`
        : `  ${name(state, e.unitId)} stands up`;
    case 'UnitMoved':
      return `  ${name(state, e.unitId)} moves (${e.from.x},${e.from.y}) -> (${e.to.x},${e.to.y})`;
    case 'AttackResolved':
      return `  ${name(state, e.attackerId)} ${e.powerPenalty ? 'lands a power blow on' : 'attacks'} ${name(state, e.targetId)}: ${e.attackScore} vs ${e.defenseScore} (d${e.attackDie}/d${e.defenseDie})${mods([['outnumbered', e.attackOutnumbered && -e.attackOutnumbered], ['size', e.attackBig], ['swoop', e.attackFly], ['opportunist', e.attackOpportunist], ['pincer', e.attackPincer], ['rusher', e.attackRusher], ['woodwise', e.attackWoodwise], ['foe outnumbered', e.defenseOutnumbered && -e.defenseOutnumbered], ['foe size', e.defenseBig], ['foe opportunist', e.defenseOpportunist], ['foe shieldwall', e.defenseShieldwall], ['foe woodwise', e.defenseWoodwise], ['foe power-blown', e.powerPenalty && -e.powerPenalty]])} -> ${e.result}${gore(e)}`;
    case 'ShotResolved':
      return `  ${name(state, e.attackerId)} ${e.aimPenalty ? 'takes an aimed shot at' : 'shoots'} ${name(state, e.targetId)}: ${e.attackScore} vs ${e.defenseScore} (d${e.attackDie}/d${e.defenseDie})${mods([['big target', e.bigTarget], ['flying target', e.flyingTarget], ['opportunist', e.attackOpportunist], ['sharpshooter', e.attackSharpshooter], ['woodwise', e.attackWoodwise], ['foe woodwise', e.defenseWoodwise], ['long range', e.rangePenalty && -e.rangePenalty], ['cover', e.coverPenalty && -e.coverPenalty], ['foe aimed at', e.aimPenalty && -e.aimPenalty]])} -> ${e.result}${gore(e)}`;
    case 'FreeHackResolved':
      return `  ${name(state, e.attackerId)} takes a free hack at ${name(state, e.targetId)} leaving contact: ${e.attackScore} vs ${e.defenseScore} (d${e.attackDie}/d${e.defenseDie})${mods([['size', e.attackBig], ['swoop', e.attackFly], ['opportunist', e.attackOpportunist], ['pincer', e.attackPincer], ['woodwise', e.attackWoodwise], ['leaver woodwise', e.defenseWoodwise], ['leaver outnumbered', e.defenseOutnumbered && -e.defenseOutnumbered], ['leaver size', e.defenseBig], ['leaver opportunist', e.defenseOpportunist]])} -> ${e.result === 'defenderRecoiled' ? 'slips away' : e.result}${gore(e)}`;
    case 'GuardDeclared':
      return `  ${name(state, e.unitId)} raises guard`;
    case 'WarCry':
      return `  📣 ${name(state, e.unitId)} war cries, inspiring ${e.inspired.length ? e.inspired.map((id) => name(state, id)).join(', ') : 'no one'}`;
    case 'LeaderFallen':
      return `  ‼ Leader ${name(state, e.unitId)} has fallen`;
    case 'GuardRiposte':
      return `  ⚔ ${name(state, e.guardId)} ripostes ${name(state, e.attackerId)}: ${e.guardScore} vs ${e.attackerScore} (d${e.guardDie}/d${e.attackerDie})${mods([['size', e.guardBig], ['swoop', e.guardFly], ['opportunist', e.guardOpportunist], ['pincer', e.guardPincer], ['woodwise', e.guardWoodwise], ['foe woodwise', e.attackerWoodwise], ['foe size', e.attackerBig], ['foe opportunist', e.attackerOpportunist]])} -> ${e.result}${gore(e)}${e.prevented ? ' (attack stopped)' : ''}`;
    case 'ToughnessSaved':
      return `    ${name(state, e.unitId)} shrugs off the blow (Tough)`;
    case 'ArmorHeld':
      return `    ${name(state, e.unitId)}'s armor turns the blow aside (Armored)`;
    case 'MasteryStruck':
      return `    ${name(state, e.unitId)}'s mastery turns the tie into a kill (Combat Mastery)`;
    case 'NerveCheck':
      return `    ${name(state, e.unitId)} nerve check d${e.die} vs Q${e.quality} -> ${e.passed ? 'holds' : 'falters'}${e.inspirationLost ? ' (inspiration lost)' : ''}`;
    case 'WarbandBroken':
      return `  ‼ P${e.player}'s warband BREAKS`;
    case 'UnitRouted':
      return `    ⚑ ${name(state, e.unitId)} flees the field`;
    case 'UnitFled':
      return `    ${name(state, e.unitId)} runs for the edge -> (${e.to.x},${e.to.y})`;
    case 'UnitKnockedDown':
      return `    ${name(state, e.unitId)} is knocked down`;
    case 'UnitRecoiled':
      return `    ${name(state, e.unitId)} is pushed back to (${e.to.x},${e.to.y})`;
    case 'UnitSupported':
      return `    ${name(state, e.unitId)} holds its ground, supported by ${name(state, e.supporterId)}`;
    case 'UnitHeldGround':
      return `    ${name(state, e.unitId)} holds its ground (Immovable)`;
    case 'UnitDefected':
      return `    ‼ ${name(state, e.unitId)} changes sides and joins P${e.to}`;
    case 'UnitPushedOff':
      return `    ${name(state, e.unitId)} is pushed off the edge of the map`;
    case 'UnitPushedIntoLava':
      return `    ${name(state, e.unitId)} is pushed into the lava at (${e.to.x},${e.to.y})`;
    case 'UnitFellIntoLava':
      return `    ${name(state, e.unitId)} is knocked out of the sky into the lava`;
    case 'UnitKilled':
      return `    ☠ ${name(state, e.unitId)} is killed`;
    case 'ActivationEnded':
      return `  — activation ends (${name(state, e.unitId)})`;
    case 'GroupMemberActivated':
      return `${name(state, e.unitId)} takes its turn in the group (${e.actions} actions)`;
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
  lava: '~',
};

/**
 * ASCII render of the flat-top hex board (offset "odd-q" coordinates: odd columns
 * sit half a cell lower, so vertical neighbours interlock). A cell's glyph is its
 * unit's initial (P0 upper-case, P1 lower-case); otherwise '#' is legacy blocked
 * terrain, '^' rock, 'B' building, 'T' forest, '~' lava and '·' an empty cell. A raised hex
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

/** Roster summary: which units are alive, on which side (kill-the-king Kings marked ♛, the golden Pig ★). */
export function renderRoster(state: GameState): string {
  const kings = new Set(state.mode?.kings ?? []);
  const pig = state.mode?.pig?.unitId;
  const side = (owner: 0 | 1) =>
    state.units
      .filter((u) => u.owner === owner)
      .map((u) => `${kings.has(u.id) ? '♛' : u.id === pig ? '★' : ''}${u.name}${u.dead ? '†' : u.knockedDown ? '↓' : ''}`)
      .join(', ');
  return `P0: ${side(0)}\nP1: ${side(1)}`;
}

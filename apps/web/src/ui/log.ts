import { unitById, type GameEvent, type GameOverReason, type GameState } from '@fansong/engine';

/**
 * How a log line is emphasised: `objective` for scoring and flag events, `end` for the game-over line.
 * Absent for ordinary play.
 */
export type LogTone = 'objective' | 'end';

export interface LogEntry {
  id: number;
  text: string;
  tone?: LogTone;
}

let counter = 0;

function name(state: GameState, id: string): string {
  return unitById(state, id)?.name ?? id;
}

/**
 * A combat score, noting the modifiers already included in it: a high-ground
 * bonus, then any penalties (e.g. `['outnumbered', 1]` reads "−1 outnumbered").
 */
function score(total: number, bonus: number | undefined, penalties: [string, number | undefined][] = []): string {
  const notes = bonus ? [`+${bonus} high ground`] : [];
  for (const [label, n] of penalties) if (n) notes.push(`−${n} ${label}`);
  return [`${total}`, ...notes].join(', ');
}

const gore = (e: { gruesome?: true }) => (e.gruesome ? ' (gruesome!)' : '');

/** Conquest zones are lettered A, B, C — matching the mode HUD. */
function zoneLetter(zone: number): string {
  return String.fromCharCode(65 + zone);
}

/** A unit's name tagged with its owner, e.g. "Knight (P1)". */
function tagged(state: GameState, id: string): string {
  const u = unitById(state, id);
  return u ? `${u.name} (P${u.owner})` : id;
}

const GAME_OVER_REASONS: Record<GameOverReason, string> = {
  annihilation: 'last side standing',
  score: 'target score reached',
  roundLimit: 'most points after the final round',
  king: 'the King has fallen',
  flag: 'flag captured',
};

/** Render one engine event as a short human-readable line. Presentation only. */
export function formatEvent(state: GameState, e: GameEvent): string | null {
  switch (e.type) {
    case 'ActivationChosen':
      return `P${e.player} activates ${name(state, e.unitId)} with ${e.diceCount} dice`;
    case 'DiceRolled':
      return `  rolls [${e.dice.join(', ')}] vs Q${e.quality} → ${e.successes} hit / ${e.failures} miss`;
    case 'Turnover':
      return `  TURNOVER — P${e.player} is benched for the round`;
    case 'UnitStoodUp':
      return `  ${name(state, e.unitId)} stands up`;
    case 'UnitMoved':
      return `  ${name(state, e.unitId)} moves to (${e.to.x}, ${e.to.y})`;
    case 'AttackResolved':
      return `  ${name(state, e.attackerId)} (${score(e.attackScore, e.attackBonus, [['outnumbered', e.attackOutnumbered]])}) ${e.powerPenalty ? 'lands a power blow on' : 'attacks'} ${name(state, e.targetId)} (${score(e.defenseScore, e.defenseBonus, [['outnumbered', e.defenseOutnumbered], ['power blow', e.powerPenalty]])}) → ${e.result}${gore(e)}`;
    case 'ShotResolved':
      return `  ${name(state, e.attackerId)} (${score(e.attackScore, e.attackBonus, [['long range', e.rangePenalty], ['cover', e.coverPenalty]])}) ${e.aimPenalty ? 'takes an aimed shot at' : 'shoots'} ${name(state, e.targetId)} (${score(e.defenseScore, e.defenseBonus, [['aimed at', e.aimPenalty]])}) → ${e.result}${gore(e)}`;
    case 'FreeHackResolved':
      return `  ${name(state, e.attackerId)} (${score(e.attackScore, e.attackBonus, [['outnumbered', e.attackOutnumbered]])}) takes a free hack at ${name(state, e.targetId)} (${score(e.defenseScore, e.defenseBonus, [['outnumbered', e.defenseOutnumbered]])}) → ${e.result === 'defenderRecoiled' ? 'slips away' : e.result}${gore(e)}`;
    case 'GuardDeclared':
      return `  ${name(state, e.unitId)} raises guard`;
    case 'GuardRiposte':
      return `  ${name(state, e.guardId)} (${score(e.guardScore, e.guardBonus, [['outnumbered', e.guardOutnumbered]])}) ripostes ${name(state, e.attackerId)} (${score(e.attackerScore, e.attackerBonus, [['outnumbered', e.attackerOutnumbered]])}) → ${e.result === 'clash' ? 'attack goes through' : e.result}${gore(e)}${e.prevented ? ' (attack stopped)' : ''}`;
    case 'ToughnessSaved':
      return `  ${name(state, e.unitId)} shrugs off the blow (Tough)`;
    case 'NerveCheck':
      return null; // implied by the knockdown/rout it produces; keep the log terse
    case 'WarbandBroken':
      return `  Player ${e.player}'s warband breaks!`;
    case 'UnitRouted':
      return `  ${name(state, e.unitId)} routs and flees`;
    case 'UnitKnockedDown':
      return `  ${name(state, e.unitId)} is knocked down`;
    case 'UnitRecoiled':
      return `  ${name(state, e.unitId)} is pushed back`;
    case 'UnitKilled':
      return `  ${name(state, e.unitId)} is killed`;
    case 'RoundEnded':
      return `=== Round ${e.round} — P${e.nextLeader} leads ===`;
    case 'ScoreChanged': {
      const what = e.zone !== undefined ? `zone ${zoneLetter(e.zone)}` : state.mode?.mode === 'king-of-the-hill' ? 'the hill' : null;
      return `  ★ Player ${e.player} scores ${e.points}${what ? ` for holding ${what}` : ''} (${e.scores[0]}–${e.scores[1]})`;
    }
    case 'FlagPickedUp':
      return `  ⚑ ${tagged(state, e.unitId)} seizes Player ${e.player}'s flag`;
    case 'FlagDropped':
      return `  ⚑ ${tagged(state, e.unitId)} drops Player ${e.player}'s flag at (${e.at.x}, ${e.at.y})`;
    case 'FlagReturned':
      return `  ⚑ ${tagged(state, e.unitId)} returns Player ${e.player}'s flag to base`;
    case 'FlagCaptured':
      return `  ⚑ ${tagged(state, e.unitId)} carries the flag home — Player ${e.player} captures it!`;
    case 'GameOver':
      return `GAME OVER — Player ${e.winner} wins${e.reason ? ` (${GAME_OVER_REASONS[e.reason]})` : ''}`;
    case 'ActivationEnded':
      return null; // implied by the next activation; keep the log terse
  }
}

/** Emphasis for an event's log line; undefined for ordinary play. */
export function eventTone(e: GameEvent): LogTone | undefined {
  switch (e.type) {
    case 'ScoreChanged':
    case 'FlagPickedUp':
    case 'FlagDropped':
    case 'FlagReturned':
    case 'FlagCaptured':
      return 'objective';
    case 'GameOver':
      return 'end';
    default:
      return undefined;
  }
}

/** The newest emphasised entry — what the HUD's transient callout shows. */
export function latestCallout(log: readonly LogEntry[]): LogEntry | null {
  for (let i = log.length - 1; i >= 0; i--) if (log[i]!.tone) return log[i]!;
  return null;
}

export function appendEvents(prev: LogEntry[], state: GameState, events: GameEvent[]): LogEntry[] {
  const added: LogEntry[] = [];
  for (const e of events) {
    const text = formatEvent(state, e);
    if (text === null) continue;
    const tone = eventTone(e);
    added.push(tone ? { id: counter++, text, tone } : { id: counter++, text });
  }
  // Keep the log bounded.
  return [...prev, ...added].slice(-200);
}

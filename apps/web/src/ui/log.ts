import { unitById, type GameEvent, type GameState } from '@fansong/engine';

export interface LogEntry {
  id: number;
  text: string;
}

let counter = 0;

function name(state: GameState, id: string): string {
  return unitById(state, id)?.name ?? id;
}

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
      return `  ${name(state, e.attackerId)} (${e.attackScore}) attacks ${name(state, e.targetId)} (${e.defenseScore}) → ${e.result}`;
    case 'UnitKnockedDown':
      return `  ${name(state, e.unitId)} is knocked down`;
    case 'UnitKilled':
      return `  ${name(state, e.unitId)} is killed`;
    case 'RoundEnded':
      return `=== Round ${e.round} — P${e.nextLeader} leads ===`;
    case 'GameOver':
      return `GAME OVER — Player ${e.winner} wins`;
    case 'ActivationEnded':
      return null; // implied by the next activation; keep the log terse
  }
}

export function appendEvents(prev: LogEntry[], state: GameState, events: GameEvent[]): LogEntry[] {
  const added: LogEntry[] = [];
  for (const e of events) {
    const text = formatEvent(state, e);
    if (text !== null) added.push({ id: counter++, text });
  }
  // Keep the log bounded.
  return [...prev, ...added].slice(-200);
}

import { scoringZones, standingInZone, type GameEvent, type GameState, type Owner, type Vec } from '@fansong/engine';
import type { Transition } from './controller.js';

/** One zone as it is scored at a round's end: who stands in it, and who that hands the point to. */
export interface ZoneTally {
  /** Index into the mode's scoring zones (the hill is 0; conquest's A/B/C are 0-2). */
  zone: number;
  cells: Vec[];
  /** Standing (living, not knocked down) units of player 0 and player 1 in the zone. */
  counts: [number, number];
  /** The side with strictly more of them, or `undefined` when it is tied or empty. */
  holder: Owner | undefined;
  /** Points the zone awards its holder this round. */
  points: number;
}

/** Each scoring zone of `state`'s mode with the units standing in it right now (nothing awarded). */
export function zoneTallies(state: GameState): ZoneTally[] {
  return scoringZones(state).map((cells, zone) => {
    const counts = standingInZone(state, cells);
    const holder = counts[0] === counts[1] ? undefined : counts[0] > counts[1] ? 0 : 1;
    return { zone, cells, counts, holder, points: 0 };
  });
}

type ScoreChanged = Extract<GameEvent, { type: 'ScoreChanged' }>;

/** Where a round's end starts in a batch of events: its first point scored, else the round (or game) ending. */
function boundary(events: GameEvent[]): number {
  return events.findIndex(
    (e) => e.type === 'ScoreChanged' || e.type === 'RoundEnded' || (e.type === 'GameOver' && e.reason === 'roundLimit'),
  );
}

/**
 * Split a round-ending transition in a zone mode (king of the hill, conquest),
 * so the scoring is shown one zone at a time rather than landing all at once
 * under the last action: first that action, then a step per zone (carrying its
 * {@link ZoneTally}, and the `ScoreChanged` it earned, if any), then the round
 * ending. Anything else passes through unchanged.
 *
 * The engine resolves all of it in one command, so the states in between are
 * rebuilt here: the score wound back and counted up zone by zone, with the
 * round not yet turned over (nor the game ended, nor the Reassembling stood up).
 */
export function splitRoundScoring(t: Transition): Transition[] {
  if (scoringZones(t.state).length === 0) return [t];
  const at = boundary(t.events);
  if (at < 0) return [t];
  const tail = t.events.slice(at);
  const scored = tail.filter((e): e is ScoreChanged => e.type === 'ScoreChanged');
  const rest = tail.filter((e) => e.type !== 'ScoreChanged');

  // The table as it stood when the zones were counted.
  const before = structuredClone(t.state);
  for (const e of rest) {
    if (e.type === 'UnitStoodUp' && e.reassembled) {
      const unit = before.units.find((u) => u.id === e.unitId);
      if (unit) unit.knockedDown = true;
    } else if (e.type === 'RoundEnded') {
      before.round = e.round - 1;
    } else if (e.type === 'GameOver') {
      before.phase = 'awaitingActivation';
      before.winner = null;
    }
  }
  const scores = before.mode!.scores;
  for (const e of scored) scores[e.player] -= e.points;

  const parts: Transition[] = [];
  if (at > 0) parts.push({ state: before, events: t.events.slice(0, at) });
  let running = before;
  for (const tally of zoneTallies(before)) {
    // King of the hill's one zone goes unnamed in its event.
    const event = scored.find((e) => (e.zone ?? 0) === tally.zone);
    if (event) {
      running = structuredClone(running);
      running.mode!.scores = [event.scores[0], event.scores[1]];
    }
    parts.push({ state: running, events: event ? [event] : [], scoring: { ...tally, points: event?.points ?? 0 } });
  }
  parts.push({ state: t.state, events: rest });
  if (t.command) parts[0]!.command = t.command;
  return parts;
}

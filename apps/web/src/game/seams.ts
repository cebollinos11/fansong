import type { GameEvent, Owner } from '@fansong/engine';

/** Beat after an activation ends before the next unit steps up, or the player gets the board back. */
export const ACTIVATION_SEAM_MS = 600;
/** Extra time a blow's verdict stays alone on screen before the same unit carries on. */
export const VERDICT_SEAM_MS = 400;

const BLOWS: ReadonlySet<GameEvent['type']> = new Set(['AttackResolved', 'ShotResolved', 'GuardRiposte', 'FreeHackResolved']);

/**
 * How long to hold the board after a batch of events has played, before
 * whatever comes next. Only what the watcher did not do themselves needs the
 * time: an activation ending when either it or the next one belongs to someone
 * else, and a blow struck by someone else. The player's own chain of actions
 * runs at their pace, and a batch that took no time (nothing shown, or
 * skipped) earns no pause either.
 */
export function seamHoldMs(
  events: readonly GameEvent[],
  /** Who was to act before these events, and who is after them. */
  actor: Owner,
  next: Owner,
  controlled: readonly Owner[],
  /** How long the batch took to play (0 when it was instant or skipped). */
  playedMs: number,
): number {
  if (playedMs <= 0 || events.some((e) => e.type === 'GameOver')) return 0;
  const watchedActor = !controlled.includes(actor);
  // A turnover with no successes hands play over without an activation to end.
  const ended = actor !== next || events.some((e) => e.type === 'ActivationEnded');
  if (ended && (watchedActor || !controlled.includes(next))) return ACTIVATION_SEAM_MS;
  if (watchedActor && events.some((e) => BLOWS.has(e.type))) return VERDICT_SEAM_MS;
  return 0;
}

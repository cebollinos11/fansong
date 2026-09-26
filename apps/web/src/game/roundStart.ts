import type { GameEvent } from '@fansong/engine';
import type { Transition } from './controller.js';

/**
 * Split a round-ending transition in two, so what happens at the top of the new
 * round plays after the round is announced rather than under the banner: first
 * the round ending (with the Reassembling units still down), then the free
 * stand-ups and whatever they bring with them (a flag taken back in hand).
 * Anything else passes through unchanged.
 *
 * The engine resolves both in one command, so the in-between state is rebuilt
 * here by laying those units back down and dropping the flags they regrabbed.
 */
export function splitRoundStart(t: Transition): Transition[] {
  const at = t.events.findIndex((e) => e.type === 'RoundEnded');
  if (at < 0) return [t];
  const after = t.events.slice(at + 1);
  if (!after.some(isReassembly)) return [t];

  const before = structuredClone(t.state);
  for (const e of after) {
    if (isReassembly(e)) {
      const unit = before.units.find((u) => u.id === e.unitId);
      if (unit) unit.knockedDown = true;
    } else if (e.type === 'FlagPickedUp') {
      const flag = before.mode?.flags?.[e.player];
      if (flag?.carrier === e.unitId) flag.carrier = null;
    }
  }
  return [
    { state: before, events: t.events.slice(0, at + 1), command: t.command },
    { state: t.state, events: after },
  ];
}

function isReassembly(e: GameEvent): e is Extract<GameEvent, { type: 'UnitStoodUp' }> {
  return e.type === 'UnitStoodUp' && e.reassembled === true;
}

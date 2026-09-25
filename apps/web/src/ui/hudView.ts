import { BASE_MOVE, livingCount, routThreshold, SPEED_STEP, type GameState, type Owner, type Unit } from '@fansong/engine';
import { getPreset, isAiSeat, type MatchSetup } from '@fansong/content';

// Pure HUD presentation (no DOM), so every label and warning is unit-testable.

/** The army a seat is fielding: its explicit roster's name, else its preset's. */
export function armyName(setup: MatchSetup, owner: Owner): string | null {
  const explicit = setup.warbands?.[owner]?.name;
  if (explicit) return explicit;
  return getPreset(setup.presets[owner])?.name ?? null;
}

/**
 * What to call a seat. An AI seat is "AI", and in online or vs-AI play the
 * local player's seat is "You" and the other "Opponent". In hotseat the local
 * player works both sides, so "You" would sit on both seats and say nothing —
 * there the army's own name is the useful label.
 */
export function seatLabel(setup: MatchSetup, controlled: readonly Owner[], owner: Owner): string {
  if (isAiSeat(setup, owner)) return 'AI';
  if (controlled.length > 1) return armyName(setup, owner) ?? `Seat ${owner}`;
  return controlled.includes(owner) ? 'You' : 'Opponent';
}

/** A seat label turned into a phrase: "You" becomes "Your turn", everything else "<label>'s turn". */
export function turnPhrase(label: string): string {
  return label === 'You' ? 'Your turn' : `${label}'s turn`;
}

/** How a warband is doing, for its line in the scoreline. */
export interface WarbandStatus {
  alive: number;
  /** Benched for the rest of this round (it turned over). */
  benched: boolean;
  /** Already routed once — the one-time collapse has happened. */
  broken: boolean;
  /**
   * Set only while the warband is still whole and one more loss would break it:
   * the living count it must stay above. Cleared once it has broken, since the
   * rout only ever fires once.
   */
  breaksAt: number | null;
}

/**
 * A warband's standing. `breaksAt` warns *before* the rout rather than after:
 * a player who can't see the threshold coming reads the collapse as arbitrary.
 */
export function warbandStatus(state: GameState, owner: Owner): WarbandStatus {
  const alive = livingCount(state, owner);
  const threshold = routThreshold(state, owner);
  const broken = state.broken[owner];
  return {
    alive,
    benched: state.benched[owner],
    broken,
    // Only worth saying while the next casualty or two could actually trigger it.
    breaksAt: !broken && threshold > 0 && alive <= threshold + 2 ? threshold : null,
  };
}

/** What each trait does, for the inspector's tooltips. */
export const TRAIT_HELP = {
  slow: `Moves ${BASE_MOVE - SPEED_STEP} hexes per Move action instead of ${BASE_MOVE}`,
  fast: `Moves ${BASE_MOVE + SPEED_STEP} hexes per Move action instead of ${BASE_MOVE}`,
  ranged: 'Shoots at range, taking no return damage — but not while in melee',
  tough: 'The first would-be kill is downgraded to a knockdown',
  guard: 'May take a Guard action, meeting its next melee attacker with a riposte',
  big: 'Head and shoulders above the rest: +1 in melee against smaller foes, but +1 to anyone shooting it',
  flying: 'Soars over terrain and units and draws no free hacks; +1 swooping into melee, but +1 to anyone shooting it airborne',
  reassembling: 'Stands back up for free at the start of each round if knocked down',
} as const;

/** One of a unit's special abilities, as the inspector shows it. */
export interface TraitTag {
  label: string;
  help: string;
}

/**
 * A unit's special abilities. These decide how you fight a unit far more than
 * its stats do, so they belong wherever a unit is described.
 */
export function traitTags(unit: Pick<Unit, 'traits'>): TraitTag[] {
  const tags: TraitTag[] = [];
  if (unit.traits.slow) tags.push({ label: 'Slow', help: TRAIT_HELP.slow });
  if (unit.traits.fast) tags.push({ label: 'Fast', help: TRAIT_HELP.fast });
  if (unit.traits.ranged > 0) tags.push({ label: `Ranged ${unit.traits.ranged}`, help: TRAIT_HELP.ranged });
  if (unit.traits.tough) tags.push({ label: 'Tough', help: TRAIT_HELP.tough });
  if (unit.traits.guard) tags.push({ label: 'Guard', help: TRAIT_HELP.guard });
  if (unit.traits.big) tags.push({ label: 'Big', help: TRAIT_HELP.big });
  if (unit.traits.flying) tags.push({ label: 'Flying', help: TRAIT_HELP.flying });
  if (unit.traits.reassembling) tags.push({ label: 'Reassembling', help: TRAIT_HELP.reassembling });
  return tags;
}

/** A unit's abilities as one short line, for a tooltip that has no room for tags. */
export function traitLine(unit: Pick<Unit, 'traits'>): string | null {
  const tags = traitTags(unit);
  return tags.length > 0 ? tags.map((t) => t.label).join(' · ') : null;
}

import { BASE_MOVE, DUMB_MAX_DICE, livingCount, routThreshold, SPEED_STEP, type GameState, type Owner, type Unit } from '@fansong/engine';
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

/**
 * What the HUD says while the local player cannot act. While the board is
 * playing something out (`playingUnitId` is the unit doing it), it names that
 * unit rather than claiming the other side is still thinking.
 */
export function waitingLine(
  setup: MatchSetup,
  controlled: readonly Owner[],
  state: GameState,
  playingUnitId: string | null,
): string {
  const unit = playingUnitId ? state.units.find((u) => u.id === playingUnitId) : undefined;
  if (unit && !controlled.includes(unit.owner)) return `${seatLabel(setup, controlled, unit.owner)}: ${unit.name} acts…`;
  if (playingUnitId !== null && (unit || controlled.includes(state.active))) return 'Resolving…';
  return isAiSeat(setup, state.active) ? 'AI is thinking…' : "Opponent's turn…";
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

/**
 * What being inspired does. The sure 6 only guarantees one action: two failures
 * among the other dice still turn the unit over, which new players don't expect.
 */
export const INSPIRED_HELP =
  'Its first activation die this round is a sure 6, but two failures among its other dice still turn it over. Lost on a failed nerve check';

/** The war cry button's tooltip. */
export const WAR_CRY_HELP =
  'Press C — one action: every friend still to activate within 5 hexes and in sight is inspired, its first activation die a sure 6 (two failures among its other dice still turn it over)';

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
  opportunist: 'Strikes when a foe is down: +1 in melee or shooting against a knocked-down foe',
  savage: 'Kills horribly: every kill it deals is gruesome, so the victim\'s friends must test for fear',
  leader: 'Once a round, one action: a war cry inspires every friend still to activate within 5 hexes and in sight (first activation die a sure 6, though two failures among the rest still turn over). Friends who see it fall must test nerve',
  armored: 'Turns blows aside: a combat it loses by exactly 1 point does it no harm, even knocked down',
  sharpshooter: 'A deadly eye: +1 to every shot it takes',
  mastery: 'A master of arms: a melee it ties against a foe without Combat Mastery kills that foe (knocked down, only on a natural 6)',
  shieldwall: 'Locks shields: +1 defending against a melee attack while next to a standing friend',
  rusher: 'Hits hardest on the charge: +1 on the first attack after a Move that brought it into contact with its target',
  slippery: 'Ducks away: leaving contact draws no free hacks, unless it carries a flag',
  whirling: 'Fights all comers: never outnumbered in melee while on its feet',
  immovable: 'Gives no ground: a push leaves it standing where it is',
  woodwise: 'At home among the trees: +1 on every combat roll, melee or shot, while standing in a forest hex',
  trample: 'Drives foes back: a foe it pushes in melee goes two hexes, and falls if the second is blocked',
  dumb: `Slow-witted: rolls at most ${DUMB_MAX_DICE} activation dice`,
  disloyal: 'Not to be trusted: a natural 1 on a nerve check makes it change sides',
  badBalance: 'Unsteady on its feet: a push that moves it also knocks it down',
} as const;

/** Why a flyer carrying a flag has lost its flight. */
const GROUNDED_HELP = 'A flyer weighed down by the flag it carries: it walks, and fights and is shot at like a unit on foot, until it drops it';

/** One of a unit's special abilities, as the inspector shows it. */
export interface TraitTag {
  label: string;
  help: string;
}

/**
 * A unit's special abilities. These decide how you fight a unit far more than
 * its stats do, so they belong wherever a unit is described. A `grounded` flyer
 * (weighed down by a flag it carries) is shown as such.
 */
export function traitTags(unit: Pick<Unit, 'traits'>, grounded = false): TraitTag[] {
  const tags: TraitTag[] = [];
  if (unit.traits.slow) tags.push({ label: 'Slow', help: TRAIT_HELP.slow });
  if (unit.traits.fast) tags.push({ label: 'Fast', help: TRAIT_HELP.fast });
  if (unit.traits.ranged > 0) tags.push({ label: `Ranged ${unit.traits.ranged}`, help: TRAIT_HELP.ranged });
  if (unit.traits.tough) tags.push({ label: 'Tough', help: TRAIT_HELP.tough });
  if (unit.traits.guard) tags.push({ label: 'Guard', help: TRAIT_HELP.guard });
  if (unit.traits.big) tags.push({ label: 'Big', help: TRAIT_HELP.big });
  if (unit.traits.flying) {
    tags.push(grounded ? { label: 'Grounded', help: GROUNDED_HELP } : { label: 'Flying', help: TRAIT_HELP.flying });
  }
  if (unit.traits.reassembling) tags.push({ label: 'Reassembling', help: TRAIT_HELP.reassembling });
  if (unit.traits.opportunist) tags.push({ label: 'Opportunist', help: TRAIT_HELP.opportunist });
  if (unit.traits.savage) tags.push({ label: 'Savage', help: TRAIT_HELP.savage });
  if (unit.traits.leader) tags.push({ label: 'Leader', help: TRAIT_HELP.leader });
  if (unit.traits.armored) tags.push({ label: 'Armored', help: TRAIT_HELP.armored });
  if (unit.traits.sharpshooter) tags.push({ label: 'Sharpshooter', help: TRAIT_HELP.sharpshooter });
  if (unit.traits.mastery) tags.push({ label: 'Combat Mastery', help: TRAIT_HELP.mastery });
  if (unit.traits.shieldwall) tags.push({ label: 'Shieldwall', help: TRAIT_HELP.shieldwall });
  if (unit.traits.rusher) tags.push({ label: 'Rusher', help: TRAIT_HELP.rusher });
  if (unit.traits.slippery) tags.push({ label: 'Slippery', help: TRAIT_HELP.slippery });
  if (unit.traits.whirling) tags.push({ label: 'Whirling', help: TRAIT_HELP.whirling });
  if (unit.traits.immovable) tags.push({ label: 'Immovable', help: TRAIT_HELP.immovable });
  if (unit.traits.woodwise) tags.push({ label: 'Woodwise', help: TRAIT_HELP.woodwise });
  if (unit.traits.trample) tags.push({ label: 'Trample', help: TRAIT_HELP.trample });
  if (unit.traits.dumb) tags.push({ label: 'Dumb', help: TRAIT_HELP.dumb });
  if (unit.traits.disloyal) tags.push({ label: 'Disloyal', help: TRAIT_HELP.disloyal });
  if (unit.traits.badBalance) tags.push({ label: 'Bad Balance', help: TRAIT_HELP.badBalance });
  return tags;
}

/** A unit's abilities as one short line, for a tooltip that has no room for tags. */
export function traitLine(unit: Pick<Unit, 'traits'>): string | null {
  const tags = traitTags(unit);
  return tags.length > 0 ? tags.map((t) => t.label).join(' · ') : null;
}

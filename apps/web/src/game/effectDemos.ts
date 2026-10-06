import {
  getLegalCommands,
  makeHexGrid,
  reduce,
  type Command,
  type CombatResult,
  type GameEvent,
  type GameState,
  type Owner,
  type Unit,
  type Vec,
} from '@fansong/engine';
import type { WarbandUnit } from '@fansong/content';
import { activateUnit, clearUnits, freshRound, paintHex, setActivePlayer, spawnUnit, type HexPaint } from './sandbox.js';

/**
 * The dev sandbox's animation demos: one small scene per combat outcome and
 * per trait, staged in the middle of the board and played with a single real
 * command, so each board effect can be watched on demand. A demo only rewrites
 * the state (with the sandbox's own operations) and picks an RNG state under
 * which the reducer's own events come out the way the demo wants; the reducer
 * plays it, so what shows is what a game would show.
 */
export interface EffectDemo {
  id: string;
  group: DemoGroup;
  label: string;
  /** What to watch for. */
  hint: string;
  /** Lay the scene out and return the command that sets it off. */
  stage: (scene: Scene) => Command;
  /** Whether `events` (what the command produced) are the outcome this demo is for. */
  shows: (events: readonly GameEvent[]) => boolean;
}

export const DEMO_GROUPS = ['Melee', 'Shooting', 'Traits'] as const;
export type DemoGroup = (typeof DEMO_GROUPS)[number];

/** A demo ready to play: the staged state, and the command that sets it off. */
export interface StagedDemo {
  state: GameState;
  command: Command;
}

/**
 * The hexes a scene is laid out on, all on or beside the column through the
 * middle of the board (hexes of one column are always neighbours, and the ones
 * either side of a hex are directly opposite each other across it).
 */
interface Spots {
  /** Where the acting unit stands, just below its target. */
  attacker: Vec;
  target: Vec;
  /** The hex beyond the target, and the one beyond that. */
  far: Vec;
  beyond: Vec;
  /** The hex behind the attacker. */
  behind: Vec;
  /** Beside the target, and beside the attacker. */
  side: Vec;
  flank: Vec;
  /** Three hexes well out of the way, for the rest of a warband. */
  corner: Vec[];
  /** A hex on the top edge of the board, and the one below it. */
  edge: Vec;
  inward: Vec;
}

/** What a demo lays its scene out with. Units are named `p<owner>u<n>` in the order each side's are spawned. */
export interface Scene extends Spots {
  spawn(owner: Owner, unit: WarbandUnit, pos: Vec, patch?: Partial<Unit>): void;
  paint(pos: Vec, paint: HexPaint): void;
  /** Put `id` mid-activation with two actions. */
  act(id: string): void;
  /** Start a round with nothing activated and `owner` to pick. */
  fresh(owner: Owner): void;
  edit(fn: (s: GameState) => void): void;
  state(): GameState;
}

export const ELF: WarbandUnit = { name: 'Elvish Fighter', quality: 3, combat: 3 };
export const BONES: WarbandUnit = { name: 'Skeleton Infantry', quality: 3, combat: 3 };
const MAGE: WarbandUnit = { name: 'Elvish Sorceress', quality: 3, combat: 2, magicUser: true };
const BOW: WarbandUnit = { name: 'Thorn-Bow', quality: 3, combat: 3, shooter: 'normal' };

type Events = readonly GameEvent[];
export const blow = (ev: Events) => ev.find((e) => e.type === 'AttackResolved');
const shot = (ev: Events) => ev.find((e) => e.type === 'ShotResolved');
const hack = (ev: Events) => ev.find((e) => e.type === 'FreeHackResolved');
export const has = (ev: Events, type: GameEvent['type']) => ev.some((e) => e.type === type);
/** The roll's own outcome stands: no save, armor or mastery rewrote it. */
const plain = (ev: Events) => !has(ev, 'ToughnessSaved') && !has(ev, 'ArmorHeld') && !has(ev, 'MasteryStruck');
export const melee = (result: CombatResult) => (ev: Events) => blow(ev)?.result === result && !blow(ev)?.gruesome && plain(ev);
const shoots = (result: CombatResult) => (ev: Events) => shot(ev)?.result === result && !shot(ev)?.gruesome && plain(ev);

const CAST: Command = { type: 'Cast', casterId: 'p0u0', targetId: 'p1u0' };
const spell = (ev: Events) => ev.find((e) => e.type === 'SpellCast');
const rolled = (ev: Events) => ev.find((e) => e.type === 'DiceRolled');

/** A Magic User (P0) takes a spell turn on `dice` dice, an enemy (P1) three hexes off. */
function spellTurn(scene: Scene, dice: number): Command {
  scene.spawn(0, MAGE, scene.behind);
  scene.spawn(1, BONES, scene.far);
  scene.fresh(0);
  return { type: 'ChooseActivation', unitId: 'p0u0', diceCount: dice, spell: true };
}

/** A Magic User (P0), its spell of power 2 in hand, casts it at `target` (P1) three hexes off. */
function casting(scene: Scene, target: WarbandUnit = BONES): Command {
  scene.spawn(0, MAGE, scene.behind);
  scene.spawn(1, target, scene.far);
  scene.act('p0u0');
  scene.edit((s) => {
    s.spell = { power: 2 };
    s.actionsRemaining = 1;
  });
  return CAST;
}

const ATTACK: Command = { type: 'Attack', attackerId: 'p0u0', targetId: 'p1u0' };
const SHOOT: Command = { type: 'Shoot', attackerId: 'p0u0', targetId: 'p1u0' };

/** `attacker` (P0) faces `defender` (P1) and attacks it. */
export function duel(scene: Scene, attacker: WarbandUnit = ELF, defender: WarbandUnit = BONES, patch?: Partial<Unit>): Command {
  scene.spawn(0, attacker, scene.attacker);
  scene.spawn(1, defender, scene.target, patch);
  scene.act('p0u0');
  return ATTACK;
}

/** `shooter` (P0) shoots `target` (P1) from three hexes off. */
function volley(scene: Scene, shooter: WarbandUnit = BOW, target: WarbandUnit = BONES): Command {
  scene.spawn(0, shooter, scene.behind);
  scene.spawn(1, target, scene.far);
  scene.act('p0u0');
  return SHOOT;
}

/** A shooter that triples its score on a weak target four hexes off: a gruesome shot. */
function longShot(scene: Scene): Command {
  scene.spawn(0, { ...BOW, combat: 5 }, scene.behind);
  scene.spawn(1, { ...BONES, combat: 1 }, scene.beyond);
  scene.act('p0u0');
  return SHOOT;
}

/** The rest of a warband, well away, so one loss doesn't break it. */
export function reserve(scene: Scene, owner: Owner, unit: WarbandUnit): void {
  for (const pos of scene.corner) scene.spawn(owner, unit, pos);
}

/** The acting unit's legal move that takes it furthest from `from`. */
export function runFrom(scene: Scene, from: Vec): Command {
  const grid = makeHexGrid(scene.state().board);
  const moves = getLegalCommands(scene.state()).filter((c) => c.type === 'Move');
  const best = moves.sort((a, b) => grid.distance(b.to, from) - grid.distance(a.to, from))[0];
  if (!best) throw new Error('The unit has nowhere to go.');
  return best;
}

export const EFFECT_DEMOS: readonly EffectDemo[] = [
  // --- Melee outcomes ---------------------------------------------------------
  {
    id: 'clash',
    group: 'Melee',
    label: 'Clash',
    hint: 'A tied roll: the swing is blocked, the answer meets it in sparks, and both are thrown a step apart.',
    stage: (s) => duel(s),
    shows: melee('clash'),
  },
  {
    id: 'pushed',
    group: 'Melee',
    label: 'Pushed back',
    hint: 'A win on an odd die: the loser skids back a hex in a trail of dust.',
    stage: (s) => duel(s),
    shows: melee('defenderRecoiled'),
  },
  {
    id: 'knockdown',
    group: 'Melee',
    label: 'Knocked down',
    hint: 'A win on an even die: the attacker gathers and dashes in, the blow freezes on a flash, and the loser is lifted off its feet, slams down and sees stars.',
    stage: (s) => duel(s),
    shows: melee('defenderKnockedDown'),
  },
  {
    id: 'kill',
    group: 'Melee',
    label: 'Kill',
    hint: 'A doubled score: the camera closes in, the attacker gathers and dashes in, and the body is lifted off its feet, slams down, breaks into motes and its ghost rises.',
    stage: (s) => duel(s),
    shows: (ev) => melee('defenderKilled')(ev) && has(ev, 'UnitKilled'),
  },
  {
    id: 'gruesome',
    group: 'Melee',
    label: 'Gruesome kill',
    hint: 'A tripled score: the full build-up, the body hurled away, and a wave of fear that breaks the friend beside it.',
    stage: (s) => {
      const command = duel(s, { ...ELF, combat: 5 }, { ...BONES, combat: 2 });
      s.spawn(1, { ...BONES, quality: 5 }, s.far);
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => blow(ev)?.gruesome === true && ev.some((e) => e.type === 'NerveCheck' && !e.passed),
  },
  {
    id: 'finish',
    group: 'Melee',
    label: 'Finish a downed foe',
    hint: 'Any win over a unit that is already down kills it.',
    stage: (s) => duel(s, ELF, BONES, { knockedDown: true }),
    shows: (ev) => melee('defenderKilled')(ev) && has(ev, 'UnitKilled'),
  },
  {
    id: 'power',
    group: 'Melee',
    label: 'Power blow',
    hint: 'Two actions behind one swing: the defender fights it at -1.',
    stage: (s) => ({ ...duel(s), power: true }),
    shows: (ev) => (blow(ev)?.powerPenalty ?? 0) > 0 && melee('defenderKnockedDown')(ev),
  },
  {
    id: 'counterPush',
    group: 'Melee',
    label: 'Attacker pushed',
    hint: 'The defender wins on an odd die: the swing is blocked in a spray of steel sparks, the attacker staggers off it, and the answer drives it back.',
    stage: (s) => duel(s),
    shows: melee('attackerRecoiled'),
  },
  {
    id: 'counterDown',
    group: 'Melee',
    label: 'Attacker floored',
    hint: 'The defender wins on an even die: the answer puts the attacker on the ground.',
    stage: (s) => duel(s),
    shows: melee('attackerKnockedDown'),
  },
  {
    id: 'counterKill',
    group: 'Melee',
    label: 'Attacker killed',
    hint: 'The defender doubles the attacker: the answer kills it.',
    stage: (s) => duel(s, { ...ELF, combat: 2 }, { ...BONES, combat: 4 }),
    shows: (ev) => melee('attackerKilled')(ev) && has(ev, 'UnitKilled'),
  },
  {
    id: 'supported',
    group: 'Melee',
    label: 'Supported',
    hint: 'A push into a standing friend: a bar of light and a shield between them, and it holds.',
    stage: (s) => {
      const command = duel(s);
      s.spawn(1, BONES, s.far);
      return command;
    },
    shows: (ev) => has(ev, 'UnitSupported'),
  },
  {
    id: 'pincer',
    group: 'Melee',
    label: 'Pincer',
    hint: 'An orange bar runs through the foe to the friend opposite, and chevrons close in from both ends.',
    stage: (s) => {
      const command = duel(s, ELF);
      s.spawn(0, ELF, s.far);
      return command;
    },
    shows: (ev) => (blow(ev)?.attackPincer ?? 0) > 0 && melee('defenderKnockedDown')(ev),
  },
  {
    id: 'pushedOff',
    group: 'Melee',
    label: 'Pushed off the map',
    hint: 'A push with the table edge behind: it slides over the lip, topples and drops.',
    stage: (s) => {
      s.spawn(0, ELF, s.inward);
      s.spawn(1, BONES, s.edge);
      reserve(s, 1, BONES);
      s.act('p0u0');
      return ATTACK;
    },
    shows: (ev) => has(ev, 'UnitPushedOff') && has(ev, 'UnitKilled') && !blow(ev)?.gruesome,
  },
  {
    id: 'lava',
    group: 'Melee',
    label: 'Pushed into lava',
    hint: 'A push with lava behind: it slides in and sinks glowing, in embers and smoke.',
    stage: (s) => {
      s.paint(s.far, { feature: 'lava' });
      const command = duel(s);
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => has(ev, 'UnitPushedIntoLava') && !blow(ev)?.gruesome,
  },
  {
    id: 'hackDown',
    group: 'Melee',
    label: 'Free hack lands',
    hint: 'Leaving contact, it is cut down by the foe it turned its back on.',
    stage: (s) => {
      duel(s);
      return runFrom(s, s.target);
    },
    shows: (ev) => hack(ev)?.result === 'defenderKnockedDown' && plain(ev),
  },
  {
    id: 'hackSlip',
    group: 'Melee',
    label: 'Free hack slips',
    hint: 'Leaving contact, it loses the hack on an odd die, blocks it and gets away.',
    stage: (s) => {
      duel(s);
      return runFrom(s, s.target);
    },
    shows: (ev) => hack(ev)?.result === 'defenderRecoiled' && has(ev, 'UnitMoved'),
  },
  {
    id: 'riposteBlocked',
    group: 'Melee',
    label: 'Riposte blocked',
    hint: "A guard's first strike fails: the attacker blocks it, and its own blow goes in.",
    stage: (s) => duel(s, ELF, { ...BONES, guard: true }, { guarding: true }),
    shows: (ev) => ev.some((e) => e.type === 'GuardRiposte' && e.result === 'clash') && has(ev, 'AttackResolved') && plain(ev),
  },

  // --- Shooting outcomes --------------------------------------------------------
  {
    id: 'shotMiss',
    group: 'Shooting',
    label: 'Miss',
    hint: 'The arrow flies past and kicks up dust behind the target.',
    stage: (s) => volley(s),
    shows: (ev) => shot(ev) !== undefined && !shot(ev)!.result.startsWith('defender'),
  },
  {
    id: 'shotCover',
    group: 'Shooting',
    label: 'Miss into cover',
    hint: 'The target stands in forest (-1 to the shot): the arrow knocks chips off the cover.',
    stage: (s) => {
      s.paint(s.far, { feature: 'forest' });
      return volley(s);
    },
    shows: (ev) => (shot(ev)?.coverPenalty ?? 0) > 0 && !shot(ev)!.result.startsWith('defender'),
  },
  {
    id: 'shotPush',
    group: 'Shooting',
    label: 'Hit: pushed back',
    hint: 'A hit on an odd die drives the target back a hex.',
    stage: (s) => volley(s),
    shows: shoots('defenderRecoiled'),
  },
  {
    id: 'shotDown',
    group: 'Shooting',
    label: 'Hit: knocked down',
    hint: 'A hit on an even die puts the target on the ground.',
    stage: (s) => volley(s),
    shows: shoots('defenderKnockedDown'),
  },
  {
    id: 'shotKill',
    group: 'Shooting',
    label: 'Hit: kill',
    hint: 'A doubled score: the arrow kills.',
    stage: (s) => volley(s),
    shows: (ev) => shoots('defenderKilled')(ev) && has(ev, 'UnitKilled'),
  },
  {
    id: 'shotGruesome',
    group: 'Shooting',
    label: 'Gruesome shot',
    hint: 'A tripled score from four hexes: the draw is held, the bow kicks, the arrow flies in slow motion trailing dread and smoke over hexes that light as it passes, bursts out the back of its victim and stays stuck in the ground behind.',
    stage: (s) => {
      const command = longShot(s);
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => shot(ev)?.gruesome === true,
  },
  {
    id: 'shotGruesomeBlocked',
    group: 'Shooting',
    label: 'Gruesome shot, friend behind',
    hint: 'The same shot with another unit right behind the victim: the arrow goes into the ground inside the victim’s own hex, never into the one behind.',
    stage: (s) => {
      const command = longShot(s);
      s.spawn(1, BONES, { x: s.beyond.x, y: s.beyond.y - 1 });
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => shot(ev)?.gruesome === true,
  },
  {
    id: 'aimed',
    group: 'Shooting',
    label: 'Aimed shot',
    hint: 'Two actions behind one shot: the target defends at -1.',
    stage: (s) => ({ ...volley(s), aimed: true }),
    shows: (ev) => (shot(ev)?.aimPenalty ?? 0) > 0 && shoots('defenderKnockedDown')(ev),
  },

  // --- Traits -----------------------------------------------------------------
  {
    id: 'tough',
    group: 'Traits',
    label: 'Tough',
    hint: 'A killing blow is caught: a gold ward flares and shatters, and it drops to a knockdown instead.',
    stage: (s) => duel(s, { ...ELF, combat: 4 }, { ...BONES, combat: 2, tough: true }),
    shows: (ev) => has(ev, 'ToughnessSaved'),
  },
  {
    id: 'armored',
    group: 'Traits',
    label: 'Armored',
    hint: 'A loss by exactly 1: a steel shield flares and the blow glances off.',
    stage: (s) => duel(s, ELF, { name: 'Death Knight', quality: 3, combat: 3, armored: true }),
    shows: (ev) => has(ev, 'ArmorHeld'),
  },
  {
    id: 'guard',
    group: 'Traits',
    label: 'Guard',
    hint: 'The guard strikes first: crossed blades over it, and a gold arc stops the attack.',
    stage: (s) => duel(s, ELF, { ...BONES, guard: true }, { guarding: true }),
    shows: (ev) => ev.some((e) => e.type === 'GuardRiposte' && e.prevented && e.result === 'defenderRecoiled'),
  },
  {
    id: 'mastery',
    group: 'Traits',
    label: 'Combat Mastery',
    hint: 'A tie against a master is no clash: the master kills.',
    stage: (s) => duel(s, { name: 'Deathblade', quality: 3, combat: 3, mastery: true }, { ...ELF }),
    shows: (ev) => has(ev, 'MasteryStruck') && has(ev, 'UnitKilled'),
  },
  {
    id: 'savage',
    group: 'Traits',
    label: 'Savage',
    hint: 'An ordinary kill, but a Savage dealt it: it plays as a gruesome one.',
    stage: (s) => {
      const command = duel(s, { ...ELF, savage: true });
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => blow(ev)?.gruesome === true && blow(ev)!.attackScore < blow(ev)!.defenseScore * 3,
  },
  {
    id: 'opportunist',
    group: 'Traits',
    label: 'Opportunist',
    hint: '+1 against a foe that is down.',
    stage: (s) => duel(s, { ...ELF, opportunist: true }, BONES, { knockedDown: true }),
    shows: (ev) => (blow(ev)?.attackOpportunist ?? 0) > 0 && melee('defenderKilled')(ev),
  },
  {
    id: 'big',
    group: 'Traits',
    label: 'Big',
    hint: 'A head taller than the rest, and +1 in melee against anything smaller.',
    stage: (s) => duel(s, { name: 'Yeti', quality: 3, combat: 3, big: true }, ELF),
    shows: (ev) => (blow(ev)?.attackBig ?? 0) > 0 && melee('defenderRecoiled')(ev),
  },
  {
    id: 'flying',
    group: 'Traits',
    label: 'Flying',
    hint: 'It hovers over its hex and swoops at +1 on a grounded foe.',
    stage: (s) => duel(s, { name: 'Sky-Talon', quality: 3, combat: 3, flying: true }, BONES),
    shows: (ev) => (blow(ev)?.attackFly ?? 0) > 0 && melee('defenderKnockedDown')(ev),
  },
  {
    id: 'flyingFalls',
    group: 'Traits',
    label: 'Flyer over lava',
    hint: 'A flyer knocked out of the air over lava drops straight into it.',
    stage: (s) => {
      s.paint(s.target, { feature: 'lava' });
      const command = duel(s, ELF, { name: 'Sky-Talon', quality: 3, combat: 3, flying: true });
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => has(ev, 'UnitFellIntoLava'),
  },
  {
    id: 'reassembling',
    group: 'Traits',
    label: 'Reassembling',
    hint: 'As the round turns, the fallen skeleton pulls its bones back together and stands.',
    stage: (s) => {
      s.spawn(0, ELF, s.behind);
      s.spawn(1, { ...BONES, reassembling: true }, s.far, { knockedDown: true, activatedThisRound: true });
      s.act('p0u0');
      return { type: 'EndActivation' };
    },
    shows: (ev) => ev.some((e) => e.type === 'UnitStoodUp' && e.reassembled),
  },
  {
    id: 'sharpshooter',
    group: 'Traits',
    label: 'Sharpshooter',
    hint: '+1 on every shot it takes.',
    stage: (s) => volley(s, { ...BOW, sharpshooter: true }),
    shows: (ev) => (shot(ev)?.attackSharpshooter ?? 0) > 0 && shoots('defenderKnockedDown')(ev),
  },
  {
    id: 'warCry',
    group: 'Traits',
    label: 'Leader: war cry',
    hint: 'The Leader rallies: the camera takes in every friend yet to act within 5 hexes and in sight, a gold wave rolls out over the hexes the cry reaches (the rock casts a shadow), and each friend blinks gold three times as the wave reaches it and its star lands.',
    stage: (s) => {
      s.spawn(0, { name: 'Death Knight', quality: 3, combat: 3, leader: true }, s.target);
      s.spawn(0, ELF, s.side);
      // Down the column (four hexes, or as far as a small board allows), so the
      // wave is seen to travel before it reaches this one.
      s.spawn(0, ELF, { x: s.target.x, y: Math.min(s.target.y + 4, s.state().board.height - 1) });
      // A rock beside the Leader, whose shadow the wave leaves dark.
      s.paint({ x: s.target.x - 1, y: s.target.y }, { feature: 'rock' });
      s.spawn(1, BONES, s.corner[0]!);
      s.fresh(0);
      s.act('p0u0');
      return { type: 'WarCry', unitId: 'p0u0' };
    },
    shows: (ev) => ev.some((e) => e.type === 'WarCry' && e.inspired.length === 2),
  },
  {
    id: 'leaderFalls',
    group: 'Traits',
    label: 'Leader falls',
    hint: 'The Leader is killed, and every friend who saw it must test its nerve.',
    stage: (s) => {
      const command = duel(s, { ...ELF, combat: 4 }, { name: 'Death Knight', quality: 3, combat: 2, leader: true });
      s.spawn(1, BONES, s.far);
      s.spawn(1, BONES, s.side);
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => has(ev, 'LeaderFallen') && !blow(ev)?.gruesome && has(ev, 'NerveCheck'),
  },
  {
    id: 'shieldwall',
    group: 'Traits',
    label: 'Shieldwall',
    hint: 'The defender and the friend beside it raise joined shields toward the blow.',
    stage: (s) => {
      const command = duel(s, ELF, { ...BONES, shieldwall: true });
      s.spawn(1, BONES, s.side);
      return command;
    },
    shows: (ev) => (blow(ev)?.defenseShieldwall ?? 0) > 0 && melee('attackerRecoiled')(ev),
  },
  {
    id: 'rusher',
    group: 'Traits',
    label: 'Rusher',
    hint: 'The charge lunges deeper, trailing streaks and throwing dirt back.',
    stage: (s) => {
      const command = duel(s, { ...ELF, rusher: true });
      // As if its Move had just brought it up against the target.
      s.edit((state) => {
        state.rushed = ['p1u0'];
      });
      return command;
    },
    shows: (ev) => (blow(ev)?.attackRusher ?? 0) > 0 && melee('defenderRecoiled')(ev),
  },
  {
    id: 'slippery',
    group: 'Traits',
    label: 'Slippery',
    hint: 'It runs out of contact leaving a trail of afterimages, and both foes swing at the air.',
    stage: (s) => {
      duel(s, { ...ELF, slippery: true });
      s.spawn(1, BONES, s.flank);
      return runFrom(s, s.target);
    },
    shows: (ev) => has(ev, 'UnitMoved') && !has(ev, 'FreeHackResolved'),
  },
  {
    id: 'whirling',
    group: 'Traits',
    label: 'Whirling',
    hint: 'With three foes on it, blade trails sweep a full circle round it.',
    stage: (s) => {
      const command = duel(s, { ...ELF, whirling: true });
      s.spawn(1, BONES, s.behind);
      s.spawn(1, BONES, s.flank);
      return command;
    },
    shows: (ev) => blow(ev)?.attackOutnumbered === undefined && melee('defenderKnockedDown')(ev),
  },
  {
    id: 'immovable',
    group: 'Traits',
    label: 'Immovable',
    hint: 'The shove breaks on it: a ring draws tight, grit flies, and the attacker bounces off.',
    stage: (s) => duel(s, ELF, { ...BONES, immovable: true }),
    shows: (ev) => has(ev, 'UnitHeldGround'),
  },
  {
    id: 'woodwise',
    group: 'Traits',
    label: 'Woodwise',
    hint: 'Fighting from the trees, it throws up leaves and takes a green rim.',
    stage: (s) => {
      s.paint(s.attacker, { feature: 'forest' });
      return duel(s, { ...ELF, woodwise: true });
    },
    shows: (ev) => (blow(ev)?.attackWoodwise ?? 0) > 0 && melee('defenderKnockedDown')(ev),
  },
  {
    id: 'trample',
    group: 'Traits',
    label: 'Trample',
    hint: 'The foe is driven back two hexes at a run, with a stamp of dust on each.',
    stage: (s) => duel(s, { name: 'Skeleton Rider', quality: 3, combat: 3, trample: true }, ELF),
    shows: (ev) => ev.some((e) => e.type === 'UnitRecoiled' && Math.abs(e.to.y - e.from.y) === 2) && !has(ev, 'UnitKnockedDown'),
  },
  {
    id: 'badBalance',
    group: 'Traits',
    label: 'Bad Balance',
    hint: 'Pushed back, it rocks wider and wider, then goes over with a thump.',
    stage: (s) => duel(s, BONES, { ...ELF, badBalance: true }),
    shows: (ev) => has(ev, 'UnitRecoiled') && has(ev, 'UnitKnockedDown'),
  },
  {
    id: 'spellTurn',
    group: 'Traits',
    label: 'Magic User: gathers a spell',
    hint: 'It rolls three successes on its spell turn: the charge swells with each one, and it holds the spell ready for a target.',
    stage: (s) => spellTurn(s, 3),
    shows: (ev) => rolled(ev)?.successes === 3,
  },
  {
    id: 'spellFizzle',
    group: 'Traits',
    label: 'Magic User: fizzles',
    hint: 'Not one success on its spell roll: what it had gathered falls in on itself and goes up in smoke.',
    stage: (s) => spellTurn(s, 1),
    shows: (ev) => rolled(ev)?.successes === 0,
  },
  {
    id: 'transfix',
    group: 'Traits',
    label: 'Magic User: transfixed',
    hint: 'The caster looses the spell it holds; the web is over its target as it rolls to resist, and hardens when a die fails.',
    stage: (s) => casting(s),
    shows: (ev) => spell(ev)?.transfixed === true,
  },
  {
    id: 'spellResisted',
    group: 'Traits',
    label: 'Magic User: resisted',
    hint: 'The target passes every die of its roll, and bursts the web thrown over it.',
    stage: (s) => casting(s, { ...BONES, quality: 2 }),
    shows: (ev) => spell(ev)?.transfixed === false,
  },
  {
    id: 'breakFree',
    group: 'Traits',
    label: 'Transfixed: breaks free',
    hint: 'A held unit rolls to break free: two successes, and it tears out of the web with one action left.',
    stage: (s) => {
      s.spawn(0, ELF, s.attacker, { transfixedBy: 'p1u0' });
      s.spawn(1, { ...MAGE, name: 'Dark Adept' }, s.beyond);
      s.fresh(0);
      return { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 3 };
    },
    shows: (ev) => has(ev, 'TransfixBroken') && !has(ev, 'Turnover'),
  },
  {
    id: 'stillHeld',
    group: 'Traits',
    label: 'Transfixed: still held',
    hint: 'A held unit strains at the web but rolls only one success, and it snaps back tight.',
    stage: (s) => {
      s.spawn(0, ELF, s.attacker, { transfixedBy: 'p1u0' });
      s.spawn(1, { ...MAGE, name: 'Dark Adept' }, s.beyond);
      s.fresh(0);
      return { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 };
    },
    shows: (ev) => rolled(ev)?.successes === 1 && !has(ev, 'TransfixBroken'),
  },
  {
    id: 'transfixedKill',
    group: 'Traits',
    label: 'Transfixed: struck down',
    hint: 'A held unit is struck at +2, and any blow that beats it kills.',
    stage: (s) => {
      const command = duel(s, ELF, BONES, { transfixedBy: 'p0u1' });
      s.spawn(0, MAGE, s.behind);
      return command;
    },
    shows: (ev) => blow(ev)?.attackTransfixed === 2 && blow(ev)?.result === 'defenderKilled' && has(ev, 'UnitKilled') && !blow(ev)?.gruesome,
  },
  {
    id: 'casterFalls',
    group: 'Traits',
    label: 'Transfixed: the caster falls',
    hint: 'The Magic User is killed, and the unit it held is free at once.',
    stage: (s) => {
      const command = duel(s, { ...ELF, combat: 5 }, { ...MAGE, name: 'Dark Adept', combat: 1 });
      s.spawn(0, ELF, s.behind, { transfixedBy: 'p1u0' });
      reserve(s, 1, BONES);
      return command;
    },
    shows: (ev) => has(ev, 'UnitKilled') && has(ev, 'TransfixBroken') && !blow(ev)?.gruesome,
  },
  {
    id: 'dumb',
    group: 'Traits',
    label: 'Dumb',
    hint: 'A question mark wobbles beside its head as it is picked to activate.',
    stage: (s) => {
      s.spawn(0, { name: 'Giant Rat', quality: 3, combat: 2, dumb: true }, s.attacker);
      s.spawn(1, BONES, s.beyond);
      s.fresh(0);
      return { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 2 };
    },
    shows: (ev) => ev.some((e) => e.type === 'DiceRolled' && e.successes > 0) && !has(ev, 'Turnover'),
  },
  {
    id: 'disloyal',
    group: 'Traits',
    label: 'Disloyal',
    hint: 'After the gruesome kill, the archer fails its nerve on a 1: its colours drain and it turns blue.',
    stage: (s) => {
      const command = duel(s, { ...ELF, savage: true });
      s.spawn(1, { name: 'Skeleton Archer', quality: 3, combat: 2, disloyal: true }, s.far);
      reserve(s, 1, BONES);
      s.spawn(0, ELF, s.behind);
      return command;
    },
    shows: (ev) => has(ev, 'UnitDefected'),
  },
];

/** RNG states tried for a demo's outcome before giving up; every one here is found within a few hundred. */
const MAX_TRIES = 20000;

/**
 * Stage `id`'s scene on `state`'s board: every unit is replaced by the demo's
 * few, on ground cleared for them, with the RNG set so its command comes out
 * the way the demo is for. Throws on a board too small to hold a scene.
 */
export function stageDemo(state: GameState, id: string): StagedDemo {
  const demo = EFFECT_DEMOS.find((d) => d.id === id);
  if (!demo) throw new Error(`No effect demo '${id}'.`);
  return stageScene(state, demo);
}

/** {@link stageDemo} for any scene, one of the listed demos or not. */
export function stageScene(state: GameState, demo: Pick<EffectDemo, 'label' | 'stage' | 'shows'>): StagedDemo {
  const { width, height } = state.board;
  if (width < 4 || height < 6) throw new Error('The board is too small for the effect demos (it needs 4 by 6 hexes).');
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const at = (dx: number, dy: number): Vec => ({ x: cx + dx, y: cy + dy });
  const spots: Spots = {
    attacker: at(0, 1),
    target: at(0, 0),
    far: at(0, -1),
    beyond: at(0, -2),
    behind: at(0, 2),
    side: at(1, 0),
    flank: at(1, 1),
    corner: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    edge: { x: cx, y: 0 },
    inward: { x: cx, y: 1 },
  };

  let s = clearUnits(state);
  // Flat, open ground under the scene and one hex round it, whatever the map had there.
  const grid = makeHexGrid(s.board);
  for (const centre of [spots.target, spots.behind, spots.edge]) {
    for (const pos of grid.cellsWithin(centre, 3)) s = paintHex(s, pos, { feature: null, elevation: 0, blocked: false });
  }
  for (const pos of spots.corner) s = paintHex(s, pos, { feature: null, elevation: 0, blocked: false });
  s = structuredClone(s);
  s.startCount = [0, 0];
  s.broken = [false, false];
  s.benched = [false, false];
  delete s.rushed;
  delete s.group;
  delete s.spell;

  const scene: Scene = {
    ...spots,
    spawn(owner, unit, pos, patch) {
      s = spawnUnit(s, owner, unit, pos);
      if (patch) Object.assign(s.units[s.units.length - 1]!, patch);
    },
    paint(pos, paint) {
      s = paintHex(s, pos, paint);
    },
    act(unitId) {
      s = activateUnit(s, unitId, 2);
    },
    fresh(owner) {
      s = setActivePlayer(freshRound(s), owner);
    },
    edit(fn) {
      s = structuredClone(s);
      fn(s);
    },
    state: () => s,
  };
  const command = demo.stage(scene);

  // The same scene always plays the same way: the search starts from a fixed RNG state.
  for (let i = 0; i < MAX_TRIES; i++) {
    const tried: GameState = { ...s, rngState: Math.imul(i + 1, 0x9e3779b9) | 0 };
    if (demo.shows(reduce(tried, command).events)) return { state: tried, command };
  }
  throw new Error(`No dice make the '${demo.label}' demo come out as intended.`);
}

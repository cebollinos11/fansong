import type { GameEvent } from '@fansong/engine';
import type { WarbandUnit } from '@fansong/content';
import { VOICE_FAMILIES, type VoiceFamily } from '../audio/sfxCues.js';
import { blow, BONES, duel, EFFECT_DEMOS, ELF, has, melee, reserve, runFrom, type EffectDemo } from './effectDemos.js';

/**
 * The scene the recording booth plays a sound cue against: a small staged
 * moment of the game (see {@link ./effectDemos.ts}) in which the board plays
 * that cue, so a take can be heard at the instant the game would play it.
 * Cues the board never plays from a command (the interface, the ambience, the
 * objectives of the game modes) have none.
 */
export type SoundScene = Pick<EffectDemo, 'label' | 'stage' | 'shows'>;

type Events = readonly GameEvent[];

function demo(id: string): SoundScene {
  const found = EFFECT_DEMOS.find((d) => d.id === id);
  if (!found) throw new Error(`No effect demo '${id}'.`);
  return found;
}

/** `unit` walks (rides, flies) as far as two actions take it. */
function walk(label: string, unit: WarbandUnit): SoundScene {
  return {
    label,
    stage: (s) => {
      s.spawn(0, unit, s.behind);
      s.spawn(1, BONES, s.corner[0]!);
      s.act('p0u0');
      return runFrom(s, s.behind);
    },
    shows: (ev) => has(ev, 'UnitMoved'),
  };
}

/** A unit is picked and rolls three dice to activate. */
function roll(label: string, shows: (ev: Events) => boolean): SoundScene {
  return {
    label,
    stage: (s) => {
      s.spawn(0, ELF, s.attacker);
      s.spawn(1, BONES, s.beyond);
      s.fresh(0);
      return { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 3 };
    },
    shows,
  };
}

const successes = (n: number) => (ev: Events) => ev.some((e) => e.type === 'DiceRolled' && e.successes === n);

/** One of each kind of creature that has a voice of its own. */
const SPEAKERS: Record<VoiceFamily, WarbandUnit> = {
  human: ELF,
  orc: { name: 'Marauder', quality: 3, combat: 3 },
  bones: BONES,
  spirit: { name: 'Ghost', quality: 3, combat: 3 },
  beast: { name: 'Giant Rat', quality: 3, combat: 3 },
  bird: { name: 'Vampire Bat', quality: 3, combat: 3 },
  bug: { name: 'Giant Spider', quality: 3, combat: 3 },
  dwarf: { name: 'Dwarvish Fighter', quality: 3, combat: 3 },
  troll: { name: 'Troll', quality: 3, combat: 3 },
  drake: { name: 'Drake Fighter', quality: 3, combat: 3 },
  lizard: { name: 'Saurian Skirmisher', quality: 3, combat: 3 },
  wose: { name: 'Wose Shaman', quality: 3, combat: 3 },
  horse: { name: 'Bay Horse', quality: 3, combat: 3 },
  sea: { name: 'Water Serpent', quality: 3, combat: 3 },
  elemental: { name: 'Fire Guardian', quality: 3, combat: 3 },
};

const VOICES = Object.fromEntries(
  (Object.keys(VOICE_FAMILIES) as VoiceFamily[]).flatMap((family): [string, SoundScene][] => [
    [
      `${family}-attack`,
      {
        label: `An attack by a ${SPEAKERS[family].name}`,
        stage: (s) => duel(s, SPEAKERS[family], family === 'bones' ? ELF : BONES),
        shows: (ev) => has(ev, 'AttackResolved'),
      },
    ],
    [
      `${family}-death`,
      {
        label: `The death of a ${SPEAKERS[family].name}`,
        stage: (s) => {
          const command = duel(s, { ...(family === 'human' ? BONES : ELF), combat: 4 }, { ...SPEAKERS[family], combat: 2 });
          reserve(s, 1, BONES);
          return command;
        },
        shows: (ev) => melee('defenderKilled')(ev) && has(ev, 'UnitKilled'),
      },
    ],
  ]),
);

const SCENES: Record<string, SoundScene> = {
  select: roll('A unit is picked and rolls three successes', successes(3)),
  'dice-roll': roll('A unit is picked and rolls three successes', successes(3)),
  'die-success': roll('A unit is picked and rolls three successes', successes(3)),
  'die-fail': roll('A unit is picked and fails one die of three', (ev) => successes(2)(ev) && !has(ev, 'Turnover')),
  turnover: roll('A unit is picked and fails two dice', (ev) => has(ev, 'Turnover')),
  'end-activation': {
    label: 'A unit finishes acting',
    stage: (s) => {
      s.spawn(0, ELF, s.attacker);
      s.spawn(1, BONES, s.corner[0]!);
      s.spawn(1, BONES, s.corner[1]!);
      s.act('p0u0');
      return { type: 'EndActivation' };
    },
    shows: (ev) => has(ev, 'ActivationEnded') && !has(ev, 'RoundEnded'),
  },
  'round-start': demo('reassembling'),

  step: walk('A walk on foot', ELF),
  hoof: walk('A ride', { name: 'Skeleton Rider', quality: 3, combat: 3 }),
  wingbeat: walk('A flight', { name: 'Sky-Talon', quality: 3, combat: 3, flying: true }),
  'stand-up': {
    label: 'A knocked-down unit gets up',
    stage: (s) => {
      s.spawn(0, ELF, s.attacker, { knockedDown: true });
      s.spawn(1, BONES, s.beyond);
      s.fresh(0);
      // Getting up is the first thing its activation pays for.
      return { type: 'ChooseActivation', unitId: 'p0u0', diceCount: 3 };
    },
    shows: (ev) => has(ev, 'UnitStoodUp'),
  },

  swing: demo('knockdown'),
  hit: demo('knockdown'),
  block: demo('counterPush'),
  clash: demo('clash'),
  skid: demo('pushed'),
  knockdown: demo('knockdown'),
  dizzy: demo('knockdown'),

  'bow-release': demo('shotDown'),
  'arrow-fly': demo('shotDown'),
  'arrow-hit': demo('shotDown'),
  'arrow-miss': demo('shotMiss'),

  death: demo('kill'),
  'ghost-rise': demo('kill'),
  victory: {
    label: 'The last enemy is killed',
    stage: (s) => duel(s, { ...ELF, combat: 4 }, { ...BONES, combat: 2 }),
    shows: (ev) => blow(ev)?.result === 'defenderKilled' && !blow(ev)?.gruesome && has(ev, 'GameOver'),
  },
  defeat: {
    label: 'Your last unit is killed',
    stage: (s) => duel(s, { ...ELF, combat: 2 }, { ...BONES, combat: 4 }),
    shows: (ev) => blow(ev)?.result === 'attackerKilled' && !blow(ev)?.gruesome && has(ev, 'GameOver'),
  },

  'power-charge': demo('power'),
  heartbeat: demo('gruesome'),
  'gruesome-kill': demo('gruesome'),
  'dread-wave': demo('gruesome'),
  'arrow-cover': demo('shotCover'),
  'arrow-pierce': demo('shotGruesome'),
  'free-hack': demo('hackDown'),
  'pushed-off': demo('pushedOff'),
  'lava-sink': demo('lava'),

  'nerve-pass': { ...demo('gruesome'), shows: (ev) => blow(ev)?.gruesome === true && ev.some((e) => e.type === 'NerveCheck' && e.passed) },
  'nerve-fail': demo('gruesome'),
  flee: demo('gruesome'),
  'warband-broken': {
    label: 'A kill leaves a side under half its strength',
    stage: (s) => {
      const command = duel(s, { ...ELF, combat: 4 }, { ...BONES, combat: 2 });
      s.spawn(1, BONES, s.corner[0]!);
      // As if it had started with four and was already down to these two.
      s.edit((state) => {
        state.startCount[1] = 4;
      });
      return command;
    },
    shows: (ev) => has(ev, 'WarbandBroken') && !blow(ev)?.gruesome,
  },

  'war-cry': demo('warCry'),
  inspire: demo('warCry'),
  'leader-falls': demo('leaderFalls'),
  'guard-set': {
    label: 'A unit goes on guard',
    stage: (s) => {
      s.spawn(0, { ...ELF, guard: true }, s.attacker);
      s.spawn(1, BONES, s.beyond);
      s.act('p0u0');
      return { type: 'Guard', unitId: 'p0u0' };
    },
    shows: (ev) => has(ev, 'GuardDeclared'),
  },
  riposte: demo('guard'),
  'armor-clang': demo('armored'),
  'tough-save': demo('tough'),
  mastery: demo('mastery'),
  brace: demo('supported'),
  reassemble: demo('reassembling'),
  dumb: demo('dumb'),
  defect: demo('disloyal'),
  'whoosh-trait': demo('rusher'),
  'spell-charge': demo('spellTurn'),
  'spell-fizzle': demo('spellFizzle'),
  'web-strain': demo('stillHeld'),
  'spell-cast': demo('transfix'),
  transfixed: demo('transfix'),
  'spell-resisted': demo('spellResisted'),
  'break-free': demo('breakFree'),

  ...VOICES,
};

/** The scene `cue` is heard in, if the board plays it from a command. */
export function soundScene(cue: string): SoundScene | null {
  return SCENES[cue] ?? null;
}

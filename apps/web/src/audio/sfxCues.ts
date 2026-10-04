/**
 * Every sound effect the game can play: the one list behind the recording booth
 * (`?dev=1&record`), the player ({@link ./sfx.ts}) and the sandbox's checklist.
 * A cue with nothing recorded is simply silent (or plays its `fallback`), so
 * the game works with any subset of these on disk.
 *
 * Recordings live in `public/sfx/<name>-<take>.wav`, listed by
 * `public/sfx/manifest.json`; the booth writes both. A cue with nothing
 * recorded down its fallback chain may still have a {@link STOCK} clip (free
 * library sounds in `public/sfx/stock/`), played until it is recorded.
 */
export interface SfxCue {
  name: string;
  /** 1: heard every game. 2: rarer moments and traits. 3: objectives, voices, interface, ambience. */
  tier: 1 | 2 | 3;
  group: string;
  /** When it plays. */
  when: string;
  /** What it might sound like. */
  idea: string;
  /** How many takes the booth asks for (variations of one played often). */
  takes: number;
  /** The cue played in its place until it is recorded. */
  fallback?: string;
  /** Loudness against the rest (1 when absent). */
  gain?: number;
  /** A long recording played round and round, not a one-shot. */
  loop?: true;
}

const BASE = [
  // --- Tier 1: the core game ---------------------------------------------------
  { name: 'select', tier: 1, group: 'Activation and dice', when: 'A unit is picked to activate', idea: 'short "hup" or pop', takes: 1 },
  { name: 'dice-roll', tier: 1, group: 'Activation and dice', when: 'Dice tumble on a roll card', idea: 'rattly "brrrrdl"', takes: 3 },
  { name: 'die-success', tier: 1, group: 'Activation and dice', when: 'An activation die comes up a success', idea: 'bright "ding"', takes: 1, gain: 0.8 },
  { name: 'die-fail', tier: 1, group: 'Activation and dice', when: 'An activation die comes up a failure', idea: 'dull "bonk"', takes: 1, gain: 0.8 },
  { name: 'turnover', tier: 1, group: 'Activation and dice', when: 'Two failures: the turn passes to the other side', idea: 'sad trombone "wah-wahh"', takes: 1 },
  { name: 'end-activation', tier: 1, group: 'Activation and dice', when: 'A unit finishes acting', idea: 'soft "tk"', takes: 1, gain: 0.6 },
  { name: 'round-start', tier: 1, group: 'Activation and dice', when: 'A new round begins', idea: 'short fanfare "ta-daa", or a gong', takes: 1 },

  { name: 'step', tier: 1, group: 'Moving', when: 'Each hex of a walk on foot', idea: '"tup"', takes: 3, gain: 0.6 },
  { name: 'hoof', tier: 1, group: 'Moving', when: 'Each hex a mounted unit rides', idea: '"clop"', takes: 3, gain: 0.6, fallback: 'step' },
  { name: 'wingbeat', tier: 1, group: 'Moving', when: 'Each hex a flyer crosses', idea: '"fwup"', takes: 3, gain: 0.6 },
  { name: 'stand-up', tier: 1, group: 'Moving', when: 'A knocked-down unit gets up', idea: 'effortful "hnngh"', takes: 1 },

  { name: 'swing', tier: 1, group: 'Melee', when: 'Every melee swing', idea: '"fwsh"', takes: 3, gain: 0.8 },
  { name: 'hit', tier: 1, group: 'Melee', when: 'A blow lands', idea: 'meaty "thwack"', takes: 3 },
  { name: 'block', tier: 1, group: 'Melee', when: 'A blow is blocked', idea: 'metallic "tink"', takes: 3 },
  { name: 'clash', tier: 1, group: 'Melee', when: 'A tied roll: both blades meet in sparks', idea: '"kshing!"', takes: 1 },
  { name: 'skid', tier: 1, group: 'Melee', when: 'The loser is pushed back a hex in dust', idea: '"shhrrp"', takes: 1 },
  { name: 'knockdown', tier: 1, group: 'Melee', when: 'A unit is put on the ground', idea: '"whoa", then a thud', takes: 1 },
  { name: 'dizzy', tier: 1, group: 'Melee', when: 'Stars spin over a downed unit', idea: 'cuckoo twitter "tweedle-eedle"', takes: 1, gain: 0.7 },

  { name: 'bow-release', tier: 1, group: 'Shooting', when: 'An arrow is loosed', idea: '"twang"', takes: 3 },
  { name: 'arrow-fly', tier: 1, group: 'Shooting', when: 'The arrow is in the air', idea: '"fweeee"', takes: 1, gain: 0.7 },
  { name: 'arrow-hit', tier: 1, group: 'Shooting', when: 'The arrow strikes its target', idea: '"thok"', takes: 3 },
  { name: 'arrow-miss', tier: 1, group: 'Shooting', when: 'The arrow lands in the dirt behind', idea: '"pfft"', takes: 1 },

  { name: 'death', tier: 1, group: 'Death and the end', when: 'A unit is killed', idea: '"bleeargh"', takes: 3 },
  { name: 'ghost-rise', tier: 1, group: 'Death and the end', when: 'Its ghost floats up afterwards', idea: 'rising "ooOOoo"', takes: 1, gain: 0.7 },
  { name: 'victory', tier: 1, group: 'Death and the end', when: 'The game ends and you won', idea: 'triumphant fanfare', takes: 1 },
  { name: 'defeat', tier: 1, group: 'Death and the end', when: 'The game ends and you lost', idea: 'deflating "womp womp"', takes: 1 },

  // --- Tier 2: special moments --------------------------------------------------
  { name: 'power-charge', tier: 2, group: 'Big combat moments', when: 'A power blow or aimed shot: two actions behind one strike', idea: 'rising "nnnnNNN"', takes: 1 },
  { name: 'heartbeat', tier: 2, group: 'Big combat moments', when: 'The build-up to a gruesome kill', idea: 'one "lub-dub"', takes: 1 },
  { name: 'gruesome-kill', tier: 2, group: 'Big combat moments', when: 'A tripled score: the body is hurled away', idea: 'big wet "SPLORCH"', takes: 1 },
  { name: 'dread-wave', tier: 2, group: 'Big combat moments', when: 'Fear spreads from a gruesome kill', idea: 'low "wooOOOoom"', takes: 1 },
  { name: 'arrow-cover', tier: 2, group: 'Big combat moments', when: 'An arrow knocks chips off cover', idea: '"tok", then a crackle', takes: 1, fallback: 'arrow-miss' },
  { name: 'arrow-pierce', tier: 2, group: 'Big combat moments', when: 'A gruesome shot bursts out the back of its victim', idea: 'slow "fwoooosh", then "shlick"', takes: 1 },
  { name: 'free-hack', tier: 2, group: 'Big combat moments', when: 'A foe swings at a unit leaving contact', idea: 'quick "hah!"', takes: 1 },
  { name: 'pushed-off', tier: 2, group: 'Big combat moments', when: 'A unit is pushed off the table edge', idea: 'falling "aaaaah" fading away', takes: 1 },
  { name: 'lava-sink', tier: 2, group: 'Big combat moments', when: 'A unit goes into lava', idea: '"sssssss", then "bloop"', takes: 1 },

  { name: 'nerve-pass', tier: 2, group: 'Morale', when: 'A nerve check is passed', idea: 'steady "hm!"', takes: 1 },
  { name: 'nerve-fail', tier: 2, group: 'Morale', when: 'A nerve check is failed', idea: 'gulp or whimper', takes: 1 },
  { name: 'flee', tier: 2, group: 'Morale', when: 'A unit runs for its edge', idea: 'panicked "aaAAaah"', takes: 1 },
  { name: 'routed', tier: 2, group: 'Morale', when: 'It runs off the map for good', idea: 'scream fading into the distance', takes: 1 },
  { name: 'warband-broken', tier: 2, group: 'Morale', when: 'A side drops below half and breaks', idea: 'a "krrk" and a groan', takes: 1 },

  { name: 'war-cry', tier: 2, group: 'Traits', when: 'A Leader rallies', idea: 'long "RAAAAH!"', takes: 1 },
  { name: 'inspire', tier: 2, group: 'Traits', when: 'Each friend the war cry reaches takes heart', idea: 'sparkle "tinggg"', takes: 1, gain: 0.7 },
  { name: 'leader-falls', tier: 2, group: 'Traits', when: 'A Leader is killed', idea: 'dramatic "NOOOO"', takes: 1 },
  { name: 'guard-set', tier: 2, group: 'Traits', when: 'A unit goes on guard', idea: '"shink" of blades crossing', takes: 1 },
  { name: 'riposte', tier: 2, group: 'Traits', when: "A guard's first strike stops the attack", idea: '"ha-HA!"', takes: 1 },
  { name: 'armor-clang', tier: 2, group: 'Traits', when: 'Armored: the blow glances off', idea: 'dull "dongg"', takes: 1 },
  { name: 'tough-save', tier: 2, group: 'Traits', when: 'Tough: a gold ward flares and shatters', idea: 'glassy "pkshh"', takes: 1 },
  { name: 'mastery', tier: 2, group: 'Traits', when: 'Combat Mastery turns a tie into a kill', idea: 'razor "shiiing"', takes: 1 },
  { name: 'brace', tier: 2, group: 'Traits', when: 'Supported or Immovable: it holds its ground', idea: 'solid "hup", then a thud', takes: 1 },
  { name: 'reassemble', tier: 2, group: 'Traits', when: "A skeleton's bones pull back together", idea: 'bone rattle "klaklaklak"', takes: 1 },
  { name: 'dumb', tier: 2, group: 'Traits', when: 'A question mark wobbles over a Dumb unit', idea: '"duhhh?"', takes: 1 },
  { name: 'defect', tier: 2, group: 'Traits', when: 'A Disloyal unit changes sides', idea: 'sneaky "heh-heh"', takes: 1 },
  { name: 'whoosh-trait', tier: 2, group: 'Traits', when: 'A Rusher lunges, a Slippery unit ducks away, a Whirling one spins, a Trample drives through', idea: 'bigger, longer "FWOOSH"', takes: 1, fallback: 'swing' },

  // --- Tier 3: objectives, interface, ambience ------------------------------------
  { name: 'score', tier: 3, group: 'Game modes', when: 'Points are scored', idea: 'coin "ba-ding"', takes: 1 },
  { name: 'flag-pickup', tier: 3, group: 'Game modes', when: 'The enemy flag is taken', idea: '"yoink!"', takes: 1 },
  { name: 'flag-drop', tier: 3, group: 'Game modes', when: 'The carrier goes down and the flag falls', idea: 'a flap and a thud', takes: 1 },
  { name: 'flag-return', tier: 3, group: 'Game modes', when: 'A flag is returned to its base', idea: 'relieved "phew"', takes: 1 },
  { name: 'flag-capture', tier: 3, group: 'Game modes', when: 'The flag is carried home', idea: 'big fanfare', takes: 1 },

  { name: 'ui-click', tier: 3, group: 'Interface', when: 'Any button is pressed', idea: '"tk"', takes: 1, gain: 0.5 },
  { name: 'ui-hover', tier: 3, group: 'Interface', when: 'The pointer comes onto a button', idea: 'the faintest "p"', takes: 1, gain: 0.25 },
  { name: 'your-turn', tier: 3, group: 'Interface', when: 'Play passes to you, against the AI or online', idea: '"ahem", or "bing-bong"', takes: 1, gain: 0.8 },

  { name: 'amb-table', tier: 3, group: 'Ambience', when: 'All game long, on the table backdrop', idea: '20 to 30 seconds of quiet room: a hum, a clock, a far-off cough', takes: 1, gain: 0.35, loop: true },
  { name: 'amb-meadow', tier: 3, group: 'Ambience', when: 'All game long, on the meadow backdrop', idea: '20 to 30 seconds of wind and birdsong', takes: 1, gain: 0.35, loop: true },
] as const satisfies readonly SfxCue[];

/** The kinds of creature that get a voice of their own, with who speaks in it. */
export const VOICE_FAMILIES = {
  human: 'men and elves',
  orc: 'orcs and goblins',
  bones: 'skeletons (rattle and clack)',
  spirit: 'ghosts and shadows',
  beast: 'bears, wolves, boars, rats and the yeti (growl)',
  bird: 'gryphons, falcons, wyverns and bats (screech)',
  bug: 'spiders and scorpions (chitter and hiss)',
} as const;

export type VoiceFamily = keyof typeof VOICE_FAMILIES;
export type VoiceLine = 'attack' | 'death';
export type SfxName = (typeof BASE)[number]['name'] | `${VoiceFamily}-${VoiceLine}`;

const VOICES: SfxCue[] = (Object.keys(VOICE_FAMILIES) as VoiceFamily[]).flatMap((family) => [
  {
    name: `${family}-attack`,
    tier: 3,
    group: 'Voices',
    when: `An attack by one of the ${VOICE_FAMILIES[family]}`,
    idea: 'a grunt of effort, in that voice',
    takes: 2,
    gain: 0.8,
  },
  {
    name: `${family}-death`,
    tier: 3,
    group: 'Voices',
    when: `The death of one of the ${VOICE_FAMILIES[family]}`,
    idea: 'a dying cry, in that voice',
    takes: 2,
    fallback: 'death',
  },
]);

/** Every cue, in the order the booth asks for them. */
export const SFX_CUES: readonly SfxCue[] = [...BASE.filter((c) => c.tier < 3), ...BASE.filter((c) => c.tier === 3), ...VOICES];

const BY_NAME = new Map(SFX_CUES.map((c) => [c.name, c]));

export function sfxCue(name: string): SfxCue | undefined {
  return BY_NAME.get(name);
}

/** How many takes of each cue are on disk, and a version that changes whenever any are re-recorded. */
export interface SfxManifest {
  version: number;
  takes: Record<string, number>;
  /**
   * How many milliseconds after its moment on the board each cue's recording
   * starts, as tuned in the booth. Negative starts it that far into the
   * recording instead, since a sound can't start before it is asked for.
   */
  delays?: Record<string, number>;
}

/** The furthest the booth may shift a cue either way, in ms. */
export const MAX_SFX_DELAY_MS = 500;

export const EMPTY_MANIFEST: SfxManifest = { version: 0, takes: {} };

/** The file a take is stored in, under `public/sfx/`. Takes count from 1. */
export function takeFile(name: string, take: number): string {
  return `${name}-${take}.wav`;
}

/**
 * The cue to actually play for `name`: itself when it has a recording, else the
 * first recorded cue down its chain of fallbacks, else nothing.
 */
export function resolveSfx(name: string, manifest: SfxManifest): string | null {
  const seen = new Set<string>();
  for (let at: string | undefined = name; at && !seen.has(at); at = BY_NAME.get(at)?.fallback) {
    if ((manifest.takes[at] ?? 0) > 0) return at;
    seen.add(at);
  }
  return null;
}

// --- Stock sounds -------------------------------------------------------------

/**
 * Free library clip sets in `public/sfx/stock/` (`<clip>-<i>.mp3`, i from 0;
 * sources and licences in its CREDITS.md): how many variants each has, and its
 * level against the rest (the files are peak-normalised, unlike the takes).
 * A `loop` set is ambience, fetched only when it starts playing.
 */
export const STOCK_CLIPS = {
  swing: { count: 3, level: 0.35 },
  hit: { count: 9, level: 0.6 },
  'heavy-hit': { count: 5, level: 0.75 },
  clang: { count: 4, level: 0.55 },
  armor: { count: 5, level: 0.55 },
  bow: { count: 4, level: 0.5 },
  'arrow-hit': { count: 5, level: 0.5 },
  death: { count: 5, level: 0.55 },
  gore: { count: 1, level: 0.6 },
  thud: { count: 3, level: 0.6 },
  grunt: { count: 2, level: 0.45 },
  'war-cry': { count: 2, level: 0.6 },
  step: { count: 10, level: 0.12 },
  dice: { count: 6, level: 0.4 },
  flag: { count: 1, level: 0.5 },
  capture: { count: 1, level: 0.55 },
  victory: { count: 1, level: 0.6 },
  defeat: { count: 1, level: 0.5 },
  select: { count: 1, level: 0.35 },
  press: { count: 1, level: 0.25 },
  turnover: { count: 1, level: 0.45 },
  alarm: { count: 1, level: 0.5 },
  score: { count: 1, level: 0.5 },
  round: { count: 1, level: 0.4 },
  guard: { count: 1, level: 0.4 },
  ding: { count: 1, level: 0.3 },
  bonk: { count: 1, level: 0.3 },
  tick: { count: 1, level: 0.25 },
  hover: { count: 1, level: 0.2 },
  chime: { count: 1, level: 0.4 },
  flap: { count: 4, level: 0.3 },
  skid: { count: 2, level: 0.4 },
  tweet: { count: 1, level: 0.3 },
  'arrow-fly': { count: 1, level: 0.3 },
  dirt: { count: 1, level: 0.45 },
  chips: { count: 3, level: 0.5 },
  ghost: { count: 1, level: 0.4 },
  charge: { count: 1, level: 0.45 },
  heartbeat: { count: 1, level: 0.75 },
  dread: { count: 1, level: 0.6 },
  pierce: { count: 1, level: 0.55 },
  fall: { count: 1, level: 0.5 },
  lava: { count: 1, level: 0.45 },
  hm: { count: 1, level: 0.45 },
  eep: { count: 1, level: 0.4 },
  panic: { count: 1, level: 0.45 },
  'scream-away': { count: 1, level: 0.5 },
  sparkle: { count: 1, level: 0.35 },
  parry: { count: 1, level: 0.5 },
  reassemble: { count: 1, level: 0.45 },
  rattle: { count: 2, level: 0.45 },
  duh: { count: 1, level: 0.4 },
  snicker: { count: 1, level: 0.45 },
  orc: { count: 2, level: 0.5 },
  'orc-death': { count: 3, level: 0.55 },
  'skeleton-death': { count: 1, level: 0.55 },
  spook: { count: 2, level: 0.45 },
  'ghoul-death': { count: 2, level: 0.55 },
  growl: { count: 5, level: 0.45 },
  'beast-death': { count: 2, level: 0.55 },
  screech: { count: 3, level: 0.4 },
  'bird-death': { count: 2, level: 0.5 },
  chitter: { count: 3, level: 0.45 },
  'bug-death': { count: 3, level: 0.5 },
  // No ambience loops for now (the user turned ambience off; see AMBIENCE_ON in sfx.ts).
  // A loop set is listed like the rest with `loop: true`, e.g. `meadow: { count: 1, level: 0.8, loop: true }`.
} as const satisfies Record<string, { count: number; level: number; loop?: true }>;

export type StockClip = keyof typeof STOCK_CLIPS;

/** The stock clip set a cue plays until it is recorded. Cues missing here stay silent. */
export const STOCK: Partial<Record<SfxName, StockClip>> = {
  'dice-roll': 'dice',
  turnover: 'turnover',
  select: 'select',
  'round-start': 'round',
  step: 'step',
  'stand-up': 'grunt',
  swing: 'swing',
  hit: 'hit',
  block: 'clang',
  clash: 'clang',
  knockdown: 'thud',
  'bow-release': 'bow',
  'arrow-hit': 'arrow-hit',
  death: 'death',
  victory: 'victory',
  defeat: 'defeat',
  'gruesome-kill': 'gore',
  'free-hack': 'heavy-hit',
  'warband-broken': 'alarm',
  'war-cry': 'war-cry',
  'leader-falls': 'alarm',
  'guard-set': 'guard',
  'armor-clang': 'armor',
  'tough-save': 'grunt',
  mastery: 'heavy-hit',
  brace: 'thud',
  score: 'score',
  'flag-pickup': 'flag',
  'flag-drop': 'flag',
  'flag-return': 'flag',
  'flag-capture': 'capture',
  'ui-click': 'press',
  'die-success': 'ding',
  'die-fail': 'bonk',
  'end-activation': 'tick',
  wingbeat: 'flap',
  skid: 'skid',
  dizzy: 'tweet',
  'arrow-fly': 'arrow-fly',
  'arrow-miss': 'dirt',
  'arrow-cover': 'chips',
  'ghost-rise': 'ghost',
  'power-charge': 'charge',
  heartbeat: 'heartbeat',
  'dread-wave': 'dread',
  'arrow-pierce': 'pierce',
  'pushed-off': 'fall',
  'lava-sink': 'lava',
  'nerve-pass': 'hm',
  'nerve-fail': 'eep',
  flee: 'panic',
  routed: 'scream-away',
  inspire: 'sparkle',
  riposte: 'parry',
  reassemble: 'reassemble',
  dumb: 'duh',
  defect: 'snicker',
  'ui-hover': 'hover',
  'your-turn': 'chime',
  'human-attack': 'grunt',
  'orc-attack': 'orc',
  'orc-death': 'orc-death',
  'bones-attack': 'rattle',
  'bones-death': 'skeleton-death',
  'spirit-attack': 'spook',
  'spirit-death': 'ghoul-death',
  'beast-attack': 'growl',
  'beast-death': 'beast-death',
  'bird-attack': 'screech',
  'bird-death': 'bird-death',
  'bug-attack': 'chitter',
  'bug-death': 'bug-death',
};

/** The file of a stock clip's variant `take` (from 1), under `public/sfx/`. */
export function stockFile(clip: StockClip, take: number): string {
  return `stock/${clip}-${take - 1}.mp3`;
}

/** What to play for a cue: a recorded cue, or (with nothing recorded) a stock clip standing in for `cue`. */
export type Playable = { cue: string; stock?: undefined } | { cue: string; stock: StockClip };

/**
 * The sound to play for `name`: the first recorded cue down its fallback chain
 * (see {@link resolveSfx}), else the first stock clip down the same chain, else
 * nothing. A recording always wins over stock, wherever it is in the chain.
 */
export function resolvePlayable(name: string, manifest: SfxManifest): Playable | null {
  const recorded = resolveSfx(name, manifest);
  if (recorded) return { cue: recorded };
  const seen = new Set<string>();
  for (let at: string | undefined = name; at && !seen.has(at); at = BY_NAME.get(at)?.fallback) {
    const stock = STOCK[at as SfxName];
    if (stock) return { cue: at, stock };
    seen.add(at);
  }
  return null;
}

/** Which of `count` takes to play (from 1), never `last` again while there is another. */
export function pickTake(count: number, last: number | undefined, rand: () => number = Math.random): number {
  if (count <= 1) return 1;
  const others = last !== undefined && last >= 1 && last <= count ? count - 1 : count;
  const pick = 1 + Math.min(others - 1, Math.floor(rand() * others));
  return others < count && pick >= last! ? pick + 1 : pick;
}

/** Whose voice a unit drawn with the Wesnoth sprite `sprite` speaks in. */
export function voiceFamily(sprite: string): VoiceFamily {
  if (/^undead-skeletal\//.test(sprite)) return 'bones';
  if (/^undead/.test(sprite)) return 'spirit';
  if (/^(orcs|goblins|trolls|ogres)\//.test(sprite)) return 'orc';
  if (/gryphon|falcon|wyvern|^bats\/|drake|bird/.test(sprite)) return 'bird';
  if (/spider|scorpion/.test(sprite)) return 'bug';
  if (/^monsters\//.test(sprite)) return 'beast';
  return 'human';
}

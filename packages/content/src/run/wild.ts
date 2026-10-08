import { SHOOTER_KINDS, type Profile, type ShooterKind } from '../cost.js';
import type { WarbandUnit } from '../warband.js';

/**
 * Wild units: every unit the game can draw that no preset warband fields. None
 * has a hand-written profile; each is built on load from a one-line sketch —
 * how seasoned it is, what it does in a fight, and whatever else marks its kind.
 * They widen what a run can draft and recruit, and each is named for the look
 * that draws it.
 */

/** Quality and Combat by rank: a rank 0 unit is rabble, a rank 4 one a legend. */
const RANK_STATS: readonly { quality: number; combat: number }[] = [
  { quality: 5, combat: 2 },
  { quality: 4, combat: 3 },
  { quality: 3, combat: 3 },
  { quality: 3, combat: 4 },
  { quality: 2, combat: 4 },
];

/**
 * What a unit does in a fight: the traits it grows into, one step at rank 1 (or
 * 0), two at rank 2 and all three from rank 3. `combat` shifts its Combat.
 */
const ROLES: Record<string, { steps: readonly Partial<Profile>[]; combat?: number }> = {
  fighter: { steps: [{}, { armored: true }, { tough: true }] },
  rusher: { steps: [{ rusher: true }, { savage: true }, { whirling: true }] },
  guard: { steps: [{ guard: true }, { armored: true }, { immovable: true }] },
  archer: { steps: [{ shooter: 'normal' }, { shooter: 'long' }, { sharpshooter: true }], combat: -1 },
  thrower: { steps: [{ shooter: 'short' }, { rusher: true }, { tough: true }] },
  rider: { steps: [{ fast: true }, { trample: true }, { rusher: true }] },
  scout: { steps: [{ fast: true }, { slippery: true }, { opportunist: true }] },
  sneak: { steps: [{ slippery: true }, { opportunist: true }, { savage: true }] },
  caster: { steps: [{ magicUser: true }, { shooter: 'short' }, { shooter: 'normal' }], combat: -1 },
  brute: { steps: [{ big: true }, { tough: true }, { savage: true }] },
  beast: { steps: [{}, { opportunist: true }, { savage: true }] },
};

/** Each wild unit as `rank role`, then any traits of its own (a bare `short`, `normal` or `long` is its Shooter trait). */
const SKETCHES: Record<string, string> = {
  // Humans — soldiers, riders, mages and outlaws.
  'Watch-Captain': '3 guard',
  'Shield-Warden': '2 guard shieldwall',
  Sentry: '1 guard',
  Horseman: '1 rider',
  Knight: '2 rider',
  'Grand Knight': '3 rider armored',
  Cavalryman: '1 fighter fast',
  Dragoon: '2 fighter fast',
  Cavalier: '3 fighter fast',
  Bowman: '1 archer',
  'Master Bowman': '3 archer',
  Fencer: '1 sneak',
  Javelineer: '2 thrower',
  Lieutenant: '2 fighter',
  'Grand Marshal': '4 fighter',
  'Royal Warrior': '4 guard',
  Mage: '1 caster',
  'Red Mage': '2 caster',
  'White Mage': '2 caster armored',
  'Arch Mage': '3 caster',
  'Silver Mage': '3 caster fast',
  'Mage of Light': '3 caster armored',
  'Great Mage': '4 caster',
  'Elder Mage': '4 caster slow',
  Thug: '1 rusher',
  Bandit: '2 rusher',
  Highwayman: '3 rusher',
  Outlaw: '2 thrower slippery',
  Fugitive: '3 thrower slippery',
  Assassin: '3 sneak short',
  Poacher: '1 archer woodwise',
  Trapper: '2 archer woodwise',
  Huntsman: '3 archer woodwise',
  Ranger: '3 scout normal woodwise',

  // Elves.
  'Elvish Ranger': '2 archer woodwise',
  'Elvish Sharpshooter': '3 archer woodwise',
  'Elvish Avenger': '3 sneak normal woodwise',
  'Elvish Hero': '2 fighter woodwise',
  'Elvish Champion': '3 fighter woodwise',
  'Elvish Marshal': '3 guard woodwise',
  'Elvish High Lord': '4 caster woodwise',
  'Elvish Druid': '2 caster woodwise tough',
  'Elvish Shyde': '3 caster woodwise flying',
  'Elvish Sorceress': '2 caster woodwise',
  'Elvish Enchantress': '3 caster woodwise',
  'Elvish Outrider': '3 scout woodwise',

  // Dwarves.
  'Dwarvish Miner': '0 fighter',
  'Dwarvish Fighter': '1 fighter',
  'Dwarvish Steelclad': '2 fighter',
  'Dwarvish Lord': '3 fighter',
  'Dwarvish Guardsman': '1 guard',
  'Dwarvish Stalwart': '2 guard',
  'Dwarvish Sentinel': '3 guard',
  'Dwarvish Thunderer': '1 archer',
  'Dwarvish Thunderguard': '2 archer',
  'Dwarvish Dragonguard': '3 archer',
  'Dwarvish Ulfserker': '1 rusher',
  'Dwarvish Berserker': '3 rusher',
  'Dwarvish Scout': '1 scout',
  'Dwarvish Pathfinder': '2 scout',
  'Dwarvish Explorer': '3 scout short',
  'Dwarvish Runesmith': '2 caster armored',

  // Orcs.
  'Orcish Archer': '1 archer',
  'Orcish Crossbowman': '2 archer',
  'Orcish Slurbow': '3 archer',
  'Orcish Assassin': '1 sneak short',
  'Orcish Slayer': '2 sneak short',
  'Orcish Nightblade': '3 sneak short',
  'Orcish Ruler': '2 fighter',
  'Orcish Sovereign': '3 fighter',
  'Orcish Warlord': '3 rusher',

  // Goblins and their wolf riders.
  'Goblin Rouser': '1 fighter',
  'Goblin Impaler': '1 guard',
  'Goblin Pillager': '2 rider',
  'Direwolf Rider': '3 scout',

  // Trolls and ogres.
  'Troll Whelp': '1 fighter tough',
  Troll: '2 brute',
  'Troll Rocklobber': '2 brute short',
  'Troll Hero': '2 brute rusher',
  'Troll Shaman': '1 caster tough',
  'Troll Warrior': '3 brute',
  'Great Troll': '4 brute',
  'Young Ogre': '1 brute dumb',
  Ogre: '2 brute dumb',

  // Undead — corpse-eaters, necromancers, skeletons and spirits.
  Ghoul: '1 fighter tough',
  Necrophage: '2 fighter tough',
  Ghast: '3 brute',
  'Dark Adept': '1 caster',
  'Dark Sorcerer': '2 caster',
  Necromancer: '3 caster',
  Lich: '3 caster reassembling',
  'Ancient Lich': '4 caster reassembling',
  'Bone Shooter': '2 archer reassembling',
  Banebow: '3 archer reassembling',
  'Bone Knight': '2 rider reassembling',
  Chocobone: '2 scout reassembling',
  'Death Squire': '2 fighter reassembling',
  Revenant: '2 guard reassembling',
  Draug: '3 fighter reassembling',
  Wraith: '2 sneak flying',
  Spectre: '3 sneak flying',

  // Drakes.
  'Drake Fighter': '1 fighter flying',
  'Drake Warrior': '2 fighter flying',
  'Drake Blademaster': '3 fighter flying',
  'Drake Burner': '1 thrower flying',
  'Fire Drake': '2 thrower flying',
  'Inferno Drake': '3 thrower flying',
  'Armageddon Drake': '4 thrower flying',
  'Drake Flare': '2 rusher flying',
  'Drake Flameheart': '3 rusher flying',
  'Drake Glider': '1 scout flying',
  'Sky Drake': '2 scout flying',
  'Hurricane Drake': '3 scout flying',
  'Drake Clasher': '1 guard',
  'Drake Thrasher': '2 guard',
  'Drake Enforcer': '3 guard',
  'Drake Arbiter': '2 fighter',
  'Drake Warden': '3 fighter',

  // Saurians.
  'Saurian Skirmisher': '1 scout',
  'Saurian Ambusher': '2 scout',
  'Saurian Flanker': '3 scout',
  'Saurian Augur': '1 caster slippery',
  'Saurian Oracle': '2 caster slippery',
  'Saurian Soothsayer': '2 caster fast',
  'Saurian Seer': '3 caster slippery',
  'Saurian Prophet': '3 caster fast',
  'Saurian Spearthrower': '2 thrower slippery',
  'Saurian Javelineer': '3 thrower slippery',

  // Merfolk and nagas.
  'Merman Citizen': '0 fighter',
  'Merman Fighter': '1 fighter',
  'Merman Warrior': '2 fighter',
  'Merman Hunter': '1 thrower',
  'Merman Brawler': '1 rusher',
  'Mermaid Initiate': '1 caster',
  'Naga Fighter': '1 sneak',
  'Naga Warrior': '2 sneak',
  'Naga Myrmidon': '3 sneak',
  'Naga Guard': '1 guard',
  'Naga Shield Guard': '2 guard',
  'Naga High Guard': '3 guard',
  'Naga Dirkfang': '1 thrower slippery',
  'Naga Ophidian': '2 thrower slippery',
  'Naga Sicarius': '3 thrower slippery',
  'Naga Ringcaster': '2 thrower',

  // Dunefolk and woses.
  'Dune Rover': '1 fighter',
  'Dune Burner': '1 thrower',
  'Dune Marauder': '3 rider',
  'Wose Shaman': '2 caster woodwise slow',

  // Bats.
  'Blood Bat': '1 scout flying',
  'Dread Bat': '2 scout flying',

  // Beasts and monsters.
  'Sky-Talon': '2 beast flying fast',
  'Elder Falcon': '2 scout flying',
  'Giant Ant Queen': '2 brute',
  Caribe: '0 sneak',
  'Hunter Caribe': '1 sneak',
  Jumpcat: '1 beast fast',
  'Redtail Cat': '1 beast woodwise',
  'Forest Lion': '2 beast fast woodwise',
  'Cuttle Fish': '2 brute short',
  'Fire Guardian': '1 thrower',
  'Frost Stoat': '1 scout',
  Mudcrawler: '0 thrower slow',
  'Giant Mudcrawler': '1 thrower slow',
  'Giant Scorpling': '0 guard',
  'Sand Scuttler': '1 guard fast',
  'Rock Scorpion': '2 guard',
  'Horned Scarab': '1 fighter armored',
  'Bay Horse': '0 scout',
  'Black Horse': '1 scout',
  Icemonax: '1 fighter tough',
  'Great Icemonax': '2 brute',
  Jinn: '3 caster flying',
  Kraken: '3 brute slow',
  'Tentacle of the Deep': '1 guard slow',
  'Great Seahorse': '2 rider',
  'Water Serpent': '2 beast tough',
  'Shadow Jumping Spider': '2 sneak woodwise',
  'Great Wolf': '1 beast fast opportunist',
  Direwolf: '2 beast fast',
};

/** Build the unit `sketch` describes. */
function fromSketch(name: string, sketch: string): WarbandUnit {
  const [rank, roleName, ...extras] = sketch.split(' ');
  const stats = RANK_STATS[Number(rank)];
  const role = ROLES[roleName!];
  if (!stats || !role) throw new Error(`${name}: bad sketch "${sketch}"`);
  const unit: WarbandUnit = { name, quality: stats.quality, combat: Math.max(1, stats.combat + (role.combat ?? 0)) };
  for (const step of role.steps.slice(0, Math.max(1, Number(rank)))) Object.assign(unit, step);
  for (const extra of extras) {
    if ((SHOOTER_KINDS as readonly string[]).includes(extra)) unit.shooter = extra as ShooterKind;
    else Object.assign(unit, { [extra]: true });
  }
  return unit;
}

/** Sketched, but left out for now: creatures of the sea, until there is water for them. */
export const SEA_CREATURES: readonly string[] = [
  ...Object.keys(SKETCHES).filter((name) => /^(Merman|Mermaid|Naga) /.test(name)),
  'Caribe',
  'Hunter Caribe',
  'Cuttle Fish',
  'Kraken',
  'Tentacle of the Deep',
  'Great Seahorse',
  'Water Serpent',
];

/** Every wild unit. */
export const WILD_UNITS: readonly WarbandUnit[] = Object.entries(SKETCHES)
  .filter(([name]) => !SEA_CREATURES.includes(name))
  .map(([name, sketch]) => fromSketch(name, sketch));

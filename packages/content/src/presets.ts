import type { Warband, WarbandUnit } from './warband.js';

/**
 * Original preset warbands. Names, themes, and stat lines are FanSong's own —
 * no trademarked names or published profiles. Each is built to be legal under
 * {@link DEFAULT_RULES}; the preset test asserts that invariant.
 *
 * Thirteen warbands, each a different family at one size: small (3 or 4 units,
 * about 120 points), medium (about 250) or large (about 400). The id ends in the
 * size. Between them they field every trait, which the preset test also asserts.
 *
 * Design intent (so the matchups stay interesting):
 *  - border-watch-small : the starter human patrol, and the default pick — a
 *    Leader sergeant, a long bow and an Armored Guard spearman.
 *  - restless-dead-small : the starter skeletons, the default opponent — a
 *    Leader captain, a bow and a warrior, all Reassembling. A few points
 *    cheaper than the Border Watch, because getting back up is worth more than
 *    its price in a three-unit fight: the AI plays the two to an even split.
 *  - iron-wardens-medium : a shield wall that grinds forward and is hard to
 *    shift — Shieldwall foot and Guard, Armored veterans around an Armored Leader
 *    and a Slow, Big, Tough, Immovable bulwark, covered by a Slow Sharpshooter
 *    crossbow.
 *  - ashfang-raiders-medium : orcs who win on first contact (melee only) —
 *    Rusher foot and Big but Dumb brutes behind a Savage Leader.
 *  - goblin-rabble-medium : a fast, cheap swarm that won't stay loyal — Fast
 *    riders that Trample and Disloyal Opportunist wolf riders and spearmen,
 *    under a Fast Leader.
 *  - free-company-medium : sellswords and hired locals — a Leader sergeant,
 *    Rusher swordsmen who may change sides, Guard pikes, Slippery slingers, a
 *    Woodwise woodsman and raw recruits.
 *  - night-haunt-medium : spirits that strike from nowhere — a Flying Leader,
 *    Slippery Opportunist shadows, Flying Armored ghosts and Fast bats.
 *  - greenwood-elves-medium : skilled and at home in the forest — every elf is
 *    Woodwise; long bows (one a Sharpshooter), blades and a Fast scout.
 *  - bonefield-legion-large : a Reassembling undead host that wins by attrition —
 *    you must kill them, not just knock them over. Badly balanced foot and bows,
 *    Fast riders and Whirling twin-blades, under a Slow Leader with Combat Mastery.
 *  - wild-menagerie-large : leaderless beasts — Flying hunters (one Savage), Fast
 *    wolves, Slippery rats, Woodwise forest ambushers (a Trampling boar and a
 *    web-spitting spider) and Big, Tough brutes.
 *  - gryphon-eyrie-small : a Flying, Armored gryphon rider leading two falcons.
 *  - wolf-pack-small : a Fast alpha and two Opportunist wolves that circle the
 *    fallen.
 *  - hogwallow-farm-small : a farmer and three pigs — a Trampling, Woodwise old
 *    boar and two Fast, Slippery piglets.
 */

/** A preset unit's profile. Its name is its key in {@link PRESET_UNITS}. */
export type PresetUnit = Omit<WarbandUnit, 'name'>;

/** One line of a preset roster: a unit from {@link PRESET_UNITS}, and how many of it (default 1). */
export interface RosterSlot {
  unit: string;
  count?: number;
}

/** A preset warband as written: a name plus lines naming shared units. */
export interface PresetRoster {
  name: string;
  units: RosterSlot[];
}

/**
 * Every preset unit, defined once by name. A warband takes a unit by naming it
 * in its roster, so a unit several warbands share is changed in one place.
 *
 * After the warbands' units come the ones no warband fields yet, a family at a
 * time: every sprite the game can draw has a unit here. Each family runs from
 * cheap rabble to its heavy hitters, with shooters, runners and the odd leader;
 * a family short of sprites reuses one under another tint. A run drafts and
 * recruits from all of them but the sea creatures.
 */
export const PRESET_UNITS: Record<string, PresetUnit> = {
  // Border Watch
  'Watch Sergeant': { quality: 3, combat: 4, leader: true, look: 'Sergeant' },
  'Watch Bowman': { quality: 3, combat: 2, shooter: 'long', look: 'Longbow' },
  'Watch Spearman': { quality: 3, combat: 3, guard: true, armored: true, look: 'Pikeman' },

  // Restless Dead
  'Bone Captain': { quality: 3, combat: 4, leader: true, reassembling: true, look: 'Death Knight' },
  'Bone Archer': { quality: 4, combat: 2, shooter: 'normal', reassembling: true, look: 'Skeleton Archer' },
  'Bone Warrior': { quality: 4, combat: 3, reassembling: true, look: 'Skeleton Infantry' },

  // Iron Wardens
  'Warden-Captain': { quality: 3, combat: 4, leader: true, armored: true },
  Sentinel: { quality: 3, combat: 3, guard: true, armored: true },
  Bulwark: { quality: 4, combat: 4, slow: true, tough: true, big: true, immovable: true },
  Ironguard: { quality: 4, combat: 3, guard: true, shieldwall: true },
  Halberdier: { quality: 4, combat: 3, shieldwall: true },
  Crossbow: { quality: 4, combat: 3, shooter: 'long', sharpshooter: true, slow: true },
  Levy: { quality: 4, combat: 2, shieldwall: true },

  // Ashfang Raiders
  'Raid-Leader': { quality: 3, combat: 4, leader: true, savage: true },
  Reaver: { quality: 4, combat: 4, big: true, rusher: true, dumb: true },
  Marauder: { quality: 4, combat: 3, rusher: true },

  // Goblin Rabble
  'Goblin Boss': { quality: 3, combat: 3, leader: true, fast: true, look: 'Outrider', tint: '#c9a227' },
  Outrider: { quality: 3, combat: 3, fast: true, trample: true },
  'Wolf-Prowler': { quality: 4, combat: 2, fast: true, opportunist: true, disloyal: true },
  Whelp: { quality: 4, combat: 2, opportunist: true, disloyal: true },

  // Free Company
  Sergeant: { quality: 3, combat: 4, leader: true },
  Swordsman: { quality: 4, combat: 3, rusher: true, disloyal: true },
  Pikeman: { quality: 4, combat: 3, guard: true },
  Slinger: { quality: 4, combat: 2, shooter: 'short', slippery: true },
  Woodsman: { quality: 4, combat: 2, shooter: 'normal', woodwise: true, look: 'Halberd-Recruit' },
  Recruit: { quality: 5, combat: 2 },

  // Bonefield Legion
  'Death Knight': { quality: 3, combat: 4, slow: true, leader: true, mastery: true, reassembling: true },
  Deathblade: { quality: 4, combat: 3, fast: true, whirling: true, reassembling: true },
  'Skeleton Rider': { quality: 4, combat: 3, fast: true, reassembling: true },
  'Skeleton Archer': { quality: 4, combat: 2, shooter: 'normal', reassembling: true },
  'Skeleton Infantry': { quality: 4, combat: 3, reassembling: true, badBalance: true },

  // Night Haunt
  Nightgaunt: { quality: 3, combat: 4, leader: true, flying: true },
  Shadow: { quality: 3, combat: 3, slippery: true, opportunist: true },
  Ghost: { quality: 4, combat: 2, flying: true, armored: true },
  'Vampire Bat': { quality: 4, combat: 1, fast: true, flying: true },

  // Greenwood Elves
  'Elvish Captain': { quality: 3, combat: 3, leader: true, woodwise: true },
  'Elvish Fighter': { quality: 3, combat: 3, woodwise: true },
  'Elvish Archer': { quality: 3, combat: 2, shooter: 'long', woodwise: true },
  'Elvish Marksman': { quality: 3, combat: 2, shooter: 'long', sharpshooter: true, woodwise: true },
  'Elvish Scout': { quality: 3, combat: 2, fast: true, woodwise: true },

  // Gryphon Eyrie
  'Gryphon Rider': { quality: 3, combat: 4, leader: true, flying: true, armored: true },

  // Wolf Pack
  'Pack Alpha': { quality: 3, combat: 4, leader: true, fast: true, look: 'Wolf', tint: '#3a3a44' },
  'Grey Wolf': { quality: 4, combat: 3, fast: true, opportunist: true, look: 'Wolf' },

  // Hogwallow Farm
  Farmer: { quality: 3, combat: 3, leader: true, look: 'Levy' },
  Tusker: { quality: 4, combat: 4, trample: true, woodwise: true, look: 'Boar' },
  Truffle: { quality: 4, combat: 2, fast: true, slippery: true, look: 'Piglet' },
  Hamlet: { quality: 4, combat: 2, fast: true, slippery: true, look: 'Piglet' },

  // Wild Menagerie
  Yeti: { quality: 3, combat: 5, big: true },
  'Wild Wyvern': { quality: 3, combat: 4, flying: true, savage: true },
  'Giant Spider': { quality: 3, combat: 3, shooter: 'short', woodwise: true },
  Bear: { quality: 4, combat: 4, big: true, tough: true },
  Boar: { quality: 4, combat: 4, trample: true, woodwise: true },
  'Giant Scorpion': { quality: 4, combat: 3, guard: true, armored: true },
  Crocodile: { quality: 4, combat: 5, slow: true, tough: true, dumb: true },
  Falcon: { quality: 4, combat: 2, fast: true, flying: true },
  Wolf: { quality: 4, combat: 2, fast: true },
  'Giant Rat': { quality: 5, combat: 2, fast: true, slippery: true },

  // --- Units no warband fields yet, a family at a time ---

  // Human soldiers
  Sentry: { quality: 4, combat: 2, guard: true },
  Bowman: { quality: 4, combat: 2, shooter: 'normal' },
  Fencer: { quality: 3, combat: 2, fast: true, slippery: true },
  Javelineer: { quality: 3, combat: 3, shooter: 'short', guard: true },
  'Shield-Warden': { quality: 3, combat: 3, guard: true, armored: true, shieldwall: true },
  'Master Bowman': { quality: 3, combat: 3, shooter: 'long', sharpshooter: true },
  Lieutenant: { quality: 3, combat: 3, leader: true },
  'Watch-Captain': { quality: 3, combat: 4, guard: true, mastery: true },
  'Royal Warrior': { quality: 2, combat: 5, tough: true, armored: true },
  'Grand Marshal': { quality: 2, combat: 4, leader: true, armored: true },

  // Human riders
  Horseman: { quality: 4, combat: 3, fast: true, rusher: true },
  Cavalryman: { quality: 4, combat: 3, fast: true, armored: true },
  Dragoon: { quality: 3, combat: 3, fast: true, armored: true },
  Knight: { quality: 3, combat: 4, fast: true, rusher: true, trample: true },
  Cavalier: { quality: 3, combat: 4, fast: true, shooter: 'short', armored: true },
  'Grand Knight': { quality: 3, combat: 5, big: true, armored: true, rusher: true, trample: true },

  // Mages
  Mage: { quality: 5, combat: 1, magicUser: true },
  'White Mage': { quality: 4, combat: 1, tough: true, magicUser: true },
  'Red Mage': { quality: 4, combat: 2, shooter: 'short', magicUser: true },
  'Silver Mage': { quality: 3, combat: 2, fast: true, slippery: true, magicUser: true },
  'Arch Mage': { quality: 3, combat: 2, shooter: 'normal', magicUser: true },
  'Mage of Light': { quality: 3, combat: 3, armored: true, magicUser: true },
  'Elder Mage': { quality: 2, combat: 2, slow: true, shooter: 'normal', sharpshooter: true, magicUser: true },
  'Great Mage': { quality: 2, combat: 3, shooter: 'long', magicUser: true },

  // Outlaws
  Thug: { quality: 5, combat: 3, rusher: true },
  Poacher: { quality: 5, combat: 2, shooter: 'normal', woodwise: true },
  Outlaw: { quality: 4, combat: 2, fast: true, shooter: 'short', slippery: true },
  Trapper: { quality: 4, combat: 2, shooter: 'normal', opportunist: true, woodwise: true },
  Bandit: { quality: 4, combat: 4, rusher: true },
  Fugitive: { quality: 3, combat: 3, fast: true, shooter: 'short', slippery: true },
  Ranger: { quality: 3, combat: 3, fast: true, shooter: 'normal', woodwise: true },
  Huntsman: { quality: 3, combat: 2, shooter: 'long', sharpshooter: true, woodwise: true },
  Assassin: { quality: 3, combat: 3, shooter: 'short', opportunist: true, savage: true, slippery: true },
  Highwayman: { quality: 3, combat: 5, savage: true, rusher: true },

  // Elves
  'Elvish Druid': { quality: 4, combat: 1, woodwise: true, magicUser: true },
  'Elvish Sorceress': { quality: 4, combat: 2, shooter: 'short', woodwise: true, magicUser: true },
  'Elvish Ranger': { quality: 3, combat: 3, shooter: 'normal', slippery: true, woodwise: true },
  'Elvish Outrider': { quality: 3, combat: 3, fast: true, shooter: 'normal', woodwise: true },
  'Elvish Shyde': { quality: 3, combat: 2, flying: true, woodwise: true, magicUser: true },
  'Elvish Enchantress': { quality: 3, combat: 2, shooter: 'normal', woodwise: true, magicUser: true },
  'Elvish Hero': { quality: 3, combat: 4, rusher: true, woodwise: true },
  'Elvish Sharpshooter': { quality: 2, combat: 2, shooter: 'long', sharpshooter: true, woodwise: true },
  'Elvish Avenger': { quality: 2, combat: 4, shooter: 'normal', opportunist: true, slippery: true, woodwise: true },
  'Elvish Champion': { quality: 2, combat: 5, mastery: true, woodwise: true },
  'Elvish Marshal': { quality: 2, combat: 4, leader: true, armored: true, woodwise: true },
  'Elvish High Lord': { quality: 2, combat: 4, leader: true, woodwise: true, magicUser: true },

  // Dwarves
  'Dwarvish Miner': { quality: 5, combat: 3, slow: true },
  'Dwarvish Scout': { quality: 4, combat: 2, fast: true, shooter: 'short' },
  'Dwarvish Guardsman': { quality: 4, combat: 2, slow: true, guard: true, shieldwall: true },
  'Dwarvish Thunderer': { quality: 4, combat: 2, slow: true, shooter: 'normal' },
  'Dwarvish Fighter': { quality: 4, combat: 3, armored: true },
  'Dwarvish Ulfserker': { quality: 4, combat: 3, savage: true, rusher: true },
  'Dwarvish Stalwart': { quality: 4, combat: 3, slow: true, guard: true, armored: true, shieldwall: true },
  'Dwarvish Pathfinder': { quality: 3, combat: 3, shooter: 'short', slippery: true },
  'Dwarvish Thunderguard': { quality: 3, combat: 3, slow: true, shooter: 'long' },
  'Dwarvish Runesmith': { quality: 3, combat: 3, armored: true, magicUser: true },
  'Dwarvish Explorer': { quality: 3, combat: 4, shooter: 'short', slippery: true, woodwise: true },
  'Dwarvish Dragonguard': { quality: 3, combat: 3, slow: true, shooter: 'long', sharpshooter: true },
  'Dwarvish Steelclad': { quality: 3, combat: 4, tough: true, armored: true },
  'Dwarvish Berserker': { quality: 3, combat: 4, savage: true, rusher: true, whirling: true },
  'Dwarvish Sentinel': { quality: 3, combat: 4, slow: true, guard: true, armored: true, immovable: true },
  'Dwarvish Lord': { quality: 2, combat: 5, slow: true, leader: true, armored: true },

  // Orcs
  'Orcish Archer': { quality: 4, combat: 2, shooter: 'normal' },
  'Orcish Assassin': { quality: 4, combat: 2, shooter: 'short', slippery: true },
  'Orcish Crossbowman': { quality: 4, combat: 3, shooter: 'long' },
  'Orcish Slayer': { quality: 3, combat: 2, shooter: 'short', opportunist: true, slippery: true },
  'Orcish Slurbow': { quality: 3, combat: 3, slow: true, shooter: 'long', sharpshooter: true },
  'Orcish Nightblade': { quality: 3, combat: 3, fast: true, shooter: 'short', opportunist: true, savage: true, slippery: true },
  'Orcish Ruler': { quality: 3, combat: 3, leader: true, rusher: true },
  'Orcish Warlord': { quality: 3, combat: 5, savage: true, rusher: true },
  'Orcish Sovereign': { quality: 2, combat: 4, leader: true, savage: true, armored: true },

  // Goblins
  'Goblin Rouser': { quality: 4, combat: 2, leader: true },
  'Goblin Impaler': { quality: 4, combat: 3, guard: true },
  'Goblin Pillager': { quality: 4, combat: 3, fast: true, opportunist: true, trample: true },
  'Direwolf Rider': { quality: 3, combat: 4, fast: true, opportunist: true, savage: true },

  // Trolls
  'Troll Whelp': { quality: 5, combat: 3, tough: true, dumb: true },
  'Troll Shaman': { quality: 4, combat: 2, shooter: 'short', tough: true, magicUser: true },
  'Troll Rocklobber': { quality: 4, combat: 3, shooter: 'short', tough: true, big: true },
  Troll: { quality: 4, combat: 4, tough: true, big: true },
  'Troll Hero': { quality: 3, combat: 4, tough: true, big: true, rusher: true },
  'Troll Warrior': { quality: 3, combat: 5, tough: true, big: true },
  'Great Troll': { quality: 3, combat: 6, tough: true, big: true, immovable: true },

  // Ogres
  'Ogre Runt': { quality: 5, combat: 3, fast: true, big: true, dumb: true, look: 'Young Ogre', tint: '#8fae6a' },
  'Young Ogre': { quality: 5, combat: 4, big: true, dumb: true },
  'Ogre Hurler': { quality: 4, combat: 3, shooter: 'short', big: true, dumb: true, look: 'Young Ogre', tint: '#8a8f9c' },
  Ogre: { quality: 4, combat: 5, tough: true, big: true, dumb: true },
  'Ogre Butcher': { quality: 4, combat: 5, big: true, savage: true, dumb: true, look: 'Ogre', tint: '#a8443a' },
  'Hill Ogre': { quality: 3, combat: 5, tough: true, big: true, trample: true, look: 'Ogre', tint: '#7a6a4a' },

  // Undead
  'Dark Adept': { quality: 5, combat: 1, magicUser: true },
  Ghoul: { quality: 4, combat: 2, slow: true, tough: true },
  'Dark Sorcerer': { quality: 4, combat: 2, shooter: 'short', magicUser: true },
  'Bone Shooter': { quality: 4, combat: 2, shooter: 'long', reassembling: true },
  Necrophage: { quality: 4, combat: 3, tough: true, opportunist: true },
  'Death Squire': { quality: 4, combat: 3, reassembling: true, armored: true },
  Chocobone: { quality: 4, combat: 3, fast: true, reassembling: true, rusher: true, badBalance: true },
  Ghast: { quality: 4, combat: 4, slow: true, tough: true, big: true, savage: true },
  Revenant: { quality: 3, combat: 3, guard: true, reassembling: true, armored: true },
  Wraith: { quality: 3, combat: 3, flying: true, slippery: true },
  Lich: { quality: 3, combat: 2, shooter: 'normal', reassembling: true, magicUser: true },
  Banebow: { quality: 3, combat: 3, shooter: 'long', reassembling: true, sharpshooter: true },
  'Bone Knight': { quality: 3, combat: 4, fast: true, reassembling: true, trample: true },
  Necromancer: { quality: 3, combat: 3, leader: true, magicUser: true },
  Draug: { quality: 3, combat: 5, slow: true, reassembling: true, armored: true, whirling: true },
  Spectre: { quality: 2, combat: 4, flying: true, savage: true, slippery: true },
  'Ancient Lich': { quality: 2, combat: 3, slow: true, shooter: 'long', reassembling: true, leader: true, magicUser: true },

  // Bats
  'Cave Bat': { quality: 5, combat: 1, fast: true, flying: true, slippery: true, look: 'Vampire Bat', tint: '#7a7a82' },
  'Blood Bat': { quality: 4, combat: 2, fast: true, flying: true, opportunist: true },
  'Dread Bat': { quality: 3, combat: 3, fast: true, flying: true, savage: true },
  'Bat Matriarch': { quality: 3, combat: 3, fast: true, flying: true, leader: true, look: 'Dread Bat', tint: '#7a4a9a' },

  // Drakes
  'Drake Glider': { quality: 4, combat: 2, fast: true, flying: true },
  'Drake Burner': { quality: 4, combat: 2, shooter: 'short', big: true, flying: true },
  'Drake Fighter': { quality: 4, combat: 3, flying: true },
  'Drake Clasher': { quality: 4, combat: 3, guard: true, armored: true },
  'Sky Drake': { quality: 3, combat: 3, fast: true, flying: true, slippery: true },
  'Fire Drake': { quality: 3, combat: 3, shooter: 'normal', big: true, flying: true },
  'Drake Flare': { quality: 3, combat: 3, flying: true, leader: true },
  'Drake Arbiter': { quality: 3, combat: 4, guard: true, big: true },
  'Drake Thrasher': { quality: 3, combat: 4, guard: true, big: true, armored: true },
  'Drake Warrior': { quality: 3, combat: 4, big: true, flying: true },
  'Hurricane Drake': { quality: 3, combat: 4, fast: true, flying: true, rusher: true, slippery: true },
  'Inferno Drake': { quality: 3, combat: 4, shooter: 'normal', big: true, flying: true, savage: true },
  'Drake Enforcer': { quality: 3, combat: 5, slow: true, tough: true, big: true, armored: true, immovable: true },
  'Drake Warden': { quality: 2, combat: 4, guard: true, big: true, armored: true, shieldwall: true },
  'Drake Flameheart': { quality: 2, combat: 4, big: true, flying: true, leader: true },
  'Drake Blademaster': { quality: 2, combat: 5, big: true, flying: true, mastery: true },
  'Armageddon Drake': { quality: 2, combat: 5, shooter: 'normal', tough: true, big: true, flying: true, savage: true },

  // Saurians
  'Saurian Augur': { quality: 5, combat: 1, slippery: true, magicUser: true },
  'Saurian Skirmisher': { quality: 4, combat: 2, fast: true, slippery: true },
  'Saurian Spearthrower': { quality: 4, combat: 2, fast: true, shooter: 'short' },
  'Saurian Soothsayer': { quality: 4, combat: 2, fast: true, magicUser: true },
  'Saurian Oracle': { quality: 4, combat: 2, shooter: 'short', slippery: true, magicUser: true },
  'Saurian Ambusher': { quality: 3, combat: 3, fast: true, opportunist: true, slippery: true },
  'Saurian Javelineer': { quality: 3, combat: 3, fast: true, shooter: 'normal', slippery: true },
  'Saurian Seer': { quality: 3, combat: 2, shooter: 'normal', slippery: true, magicUser: true },
  'Saurian Prophet': { quality: 3, combat: 2, fast: true, leader: true, magicUser: true },
  'Saurian Flanker': { quality: 3, combat: 4, fast: true, opportunist: true, rusher: true, slippery: true },

  // Merfolk
  'Merman Citizen': { quality: 5, combat: 2 },
  'Mermaid Initiate': { quality: 4, combat: 1, magicUser: true },
  'Merman Hunter': { quality: 4, combat: 2, fast: true, shooter: 'short' },
  'Merman Brawler': { quality: 4, combat: 3, rusher: true, slippery: true },
  'Merman Fighter': { quality: 4, combat: 3, guard: true },
  'Merman Warrior': { quality: 3, combat: 4, guard: true, armored: true },

  // Nagas
  'Naga Dirkfang': { quality: 4, combat: 2, shooter: 'short', slippery: true },
  'Naga Fighter': { quality: 4, combat: 3, slippery: true },
  'Naga Guard': { quality: 4, combat: 3, slow: true, guard: true, armored: true },
  'Naga Ringcaster': { quality: 3, combat: 3, fast: true, shooter: 'short' },
  'Naga Ophidian': { quality: 3, combat: 3, shooter: 'short', opportunist: true, slippery: true },
  'Naga Shield Guard': { quality: 3, combat: 3, slow: true, guard: true, armored: true, shieldwall: true },
  'Naga Warrior': { quality: 3, combat: 4, rusher: true, slippery: true },
  'Naga Sicarius': { quality: 3, combat: 3, shooter: 'normal', opportunist: true, savage: true, slippery: true },
  'Naga High Guard': { quality: 3, combat: 4, slow: true, guard: true, armored: true, immovable: true },
  'Naga Myrmidon': { quality: 2, combat: 5, slippery: true, whirling: true },

  // Dunefolk
  'Dune Drudge': { quality: 5, combat: 2, look: 'Dune Rover', tint: '#8a7a5a' },
  'Dune Scout': { quality: 4, combat: 2, fast: true, slippery: true, look: 'Dune Rover', tint: '#6f8f5a' },
  'Dune Burner': { quality: 4, combat: 2, shooter: 'short' },
  'Dune Rover': { quality: 4, combat: 3 },
  'Dune Raider': { quality: 4, combat: 3, fast: true, shooter: 'short', look: 'Dune Marauder', tint: '#9a5a3a' },
  'Dune Firecaller': { quality: 3, combat: 2, shooter: 'short', magicUser: true, look: 'Dune Burner', tint: '#c9542a' },
  'Dune Blade': { quality: 3, combat: 4, armored: true, rusher: true, look: 'Dune Rover', tint: '#4a5a8a' },
  'Dune Marauder': { quality: 3, combat: 4, fast: true, rusher: true, trample: true },
  'Dune Warlord': { quality: 3, combat: 4, fast: true, leader: true, look: 'Dune Marauder', tint: '#c9a227' },

  // Woses
  'Wose Sapling': { quality: 5, combat: 3, slow: true, woodwise: true, look: 'Wose Shaman', tint: '#9fc46a' },
  'Wose Shaman': { quality: 4, combat: 2, slow: true, woodwise: true, magicUser: true },
  'Thornlash Wose': { quality: 4, combat: 3, slow: true, shooter: 'short', woodwise: true, look: 'Wose Shaman', tint: '#6a8f3a' },
  'Oak Wose': { quality: 4, combat: 5, slow: true, tough: true, big: true, woodwise: true, look: 'Wose Shaman', tint: '#8a6a3e' },
  'Wose Elder': { quality: 3, combat: 4, slow: true, big: true, leader: true, woodwise: true, look: 'Wose Shaman', tint: '#c9a227' },
  'Ancient Wose': { quality: 3, combat: 6, slow: true, tough: true, big: true, immovable: true, woodwise: true, look: 'Wose Shaman', tint: '#4a4a3a' },

  // Gryphons
  'Sky-Talon': { quality: 3, combat: 4, fast: true, flying: true },
  'Storm-Talon': { quality: 3, combat: 5, big: true, flying: true, savage: true, tint: '#5a6a8a' },

  // Beasts
  'Bay Horse': { quality: 5, combat: 2, fast: true },
  'Giant Scorpling': { quality: 5, combat: 2, armored: true },
  Mudcrawler: { quality: 5, combat: 2, slow: true, shooter: 'short' },
  'Frost Stoat': { quality: 4, combat: 2, fast: true, slippery: true },
  'Redtail Cat': { quality: 4, combat: 2, slippery: true, woodwise: true },
  Jumpcat: { quality: 4, combat: 3, fast: true, rusher: true },
  'Black Horse': { quality: 4, combat: 3, fast: true, trample: true },
  'Sand Scuttler': { quality: 4, combat: 3, fast: true, armored: true },
  'Horned Scarab': { quality: 4, combat: 3, armored: true, trample: true },
  Icemonax: { quality: 4, combat: 3, tough: true },
  'Fire Guardian': { quality: 4, combat: 3, shooter: 'short', savage: true },
  'Giant Mudcrawler': { quality: 4, combat: 3, slow: true, shooter: 'short', tough: true, big: true },
  'Rock Scorpion': { quality: 4, combat: 4, slow: true, guard: true, armored: true },
  'Giant Ant Queen': { quality: 4, combat: 4, slow: true, tough: true, big: true },
  'Great Icemonax': { quality: 4, combat: 5, tough: true, big: true, trample: true },
  'Elder Falcon': { quality: 3, combat: 3, fast: true, flying: true, opportunist: true },
  'Great Wolf': { quality: 3, combat: 3, fast: true, opportunist: true },
  'Shadow Jumping Spider': { quality: 3, combat: 3, fast: true, opportunist: true, slippery: true, woodwise: true },
  Jinn: { quality: 3, combat: 3, shooter: 'normal', flying: true, magicUser: true },
  'Forest Lion': { quality: 3, combat: 4, fast: true, savage: true, woodwise: true },
  Direwolf: { quality: 3, combat: 4, fast: true, big: true, savage: true },

  // Sea creatures
  Caribe: { quality: 5, combat: 2, slippery: true },
  'Hunter Caribe': { quality: 4, combat: 3, savage: true, slippery: true },
  'Great Seahorse': { quality: 4, combat: 3, fast: true, trample: true },
  'Tentacle of the Deep': { quality: 4, combat: 3, slow: true, guard: true, immovable: true },
  'Cuttle Fish': { quality: 4, combat: 4, slow: true, shooter: 'short', big: true },
  'Water Serpent': { quality: 3, combat: 4, tough: true, opportunist: true },
  Kraken: { quality: 3, combat: 6, slow: true, tough: true, big: true, immovable: true },
};

/** Which units each preset warband fields, in menu order. */
export const PRESET_ROSTERS: Record<string, PresetRoster> = {
  'border-watch-small': {
    name: 'Border Watch',
    units: [
      { unit: 'Watch Sergeant' },
      { unit: 'Watch Bowman' },
      { unit: 'Watch Spearman' },
    ],
  },
  'restless-dead-small': {
    name: 'Restless Dead',
    units: [
      { unit: 'Bone Captain' },
      { unit: 'Bone Archer' },
      { unit: 'Bone Warrior' },
    ],
  },
  'iron-wardens-medium': {
    name: 'Iron Wardens',
    units: [
      { unit: 'Warden-Captain' },
      { unit: 'Sentinel' },
      { unit: 'Bulwark' },
      { unit: 'Ironguard' },
      { unit: 'Halberdier' },
      { unit: 'Crossbow' },
      { unit: 'Levy' },
    ],
  },
  'ashfang-raiders-medium': {
    name: 'Ashfang Raiders',
    units: [
      { unit: 'Raid-Leader' },
      { unit: 'Reaver', count: 2 },
      { unit: 'Marauder', count: 4 },
    ],
  },
  'goblin-rabble-medium': {
    name: 'Goblin Rabble',
    units: [
      { unit: 'Goblin Boss' },
      { unit: 'Outrider', count: 2 },
      { unit: 'Wolf-Prowler', count: 3 },
      { unit: 'Whelp', count: 4 },
    ],
  },
  'free-company-medium': {
    name: 'Free Company',
    units: [
      { unit: 'Sergeant' },
      { unit: 'Swordsman', count: 2 },
      { unit: 'Pikeman', count: 2 },
      { unit: 'Slinger', count: 2 },
      { unit: 'Woodsman' },
      { unit: 'Recruit', count: 2 },
    ],
  },
  'night-haunt-medium': {
    name: 'Night Haunt',
    units: [
      { unit: 'Nightgaunt' },
      { unit: 'Shadow', count: 2 },
      { unit: 'Ghost', count: 2 },
      { unit: 'Vampire Bat', count: 3 },
    ],
  },
  'greenwood-elves-medium': {
    name: 'Greenwood Elves',
    units: [
      { unit: 'Elvish Captain' },
      { unit: 'Elvish Fighter', count: 2 },
      { unit: 'Elvish Archer', count: 2 },
      { unit: 'Elvish Marksman' },
      { unit: 'Elvish Scout' },
    ],
  },
  'bonefield-legion-large': {
    name: 'Bonefield Legion',
    units: [
      { unit: 'Death Knight' },
      { unit: 'Deathblade', count: 2 },
      { unit: 'Skeleton Rider', count: 3 },
      { unit: 'Skeleton Infantry', count: 4 },
      { unit: 'Skeleton Archer', count: 2 },
    ],
  },
  'wild-menagerie-large': {
    name: 'Wild Menagerie',
    units: [
      { unit: 'Wild Wyvern' },
      { unit: 'Yeti' },
      { unit: 'Bear' },
      { unit: 'Boar' },
      { unit: 'Giant Spider' },
      { unit: 'Giant Scorpion' },
      { unit: 'Crocodile' },
      { unit: 'Falcon' },
      { unit: 'Wolf', count: 2 },
      { unit: 'Giant Rat', count: 2 },
    ],
  },
  'gryphon-eyrie-small': {
    name: 'Gryphon Eyrie',
    units: [
      { unit: 'Gryphon Rider' },
      { unit: 'Falcon', count: 2 },
    ],
  },
  'wolf-pack-small': {
    name: 'Wolf Pack',
    units: [
      { unit: 'Pack Alpha' },
      { unit: 'Grey Wolf', count: 2 },
    ],
  },
  'hogwallow-farm-small': {
    name: 'Hogwallow Farm',
    units: [
      { unit: 'Farmer' },
      { unit: 'Tusker' },
      { unit: 'Truffle' },
      { unit: 'Hamlet' },
    ],
  },
};

/**
 * Expand a roster into a playable warband, looking each line's unit up by
 * reference. A line with a count of `n` fields `n` copies: the first keeps the
 * unit's name, the rest are numbered (`Wolf 2`, `Wolf 3`, …) and drawn as it.
 * Throws if a line names a unit `lookup` doesn't know.
 */
export function expandRoster(
  roster: PresetRoster,
  lookup: (ref: string) => WarbandUnit | undefined,
): Warband {
  const units: WarbandUnit[] = [];
  for (const slot of roster.units) {
    const unit = lookup(slot.unit);
    if (!unit) throw new Error(`${roster.name}: no unit "${slot.unit}"`);
    for (let k = 1; k <= (slot.count ?? 1); k++) {
      units.push(k === 1 ? { ...unit } : { ...unit, name: `${unit.name} ${k}`, look: unit.look ?? unit.name });
    }
  }
  return { name: roster.name, units };
}

/** A preset unit as a warband unit, or `undefined` if there is none by that name. */
export function presetUnit(name: string): WarbandUnit | undefined {
  const profile = PRESET_UNITS[name];
  return profile && { name, ...profile };
}

/** Every preset warband, expanded from {@link PRESET_ROSTERS}. */
export const PRESETS: Record<string, Warband> = Object.fromEntries(
  Object.entries(PRESET_ROSTERS).map(([id, roster]) => [id, expandRoster(roster, presetUnit)]),
);

/** Stable list of preset ids, for CLI help and menus. */
export const PRESET_IDS = Object.keys(PRESETS);

/** Look up a preset by id, or `undefined` if unknown. */
export function getPreset(id: string): Warband | undefined {
  return PRESETS[id];
}

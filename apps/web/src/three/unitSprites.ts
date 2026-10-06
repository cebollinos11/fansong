/**
 * Which Wesnoth unit sprite stands in for each FanSong unit. Paths are relative
 * to Wesnoth's `data/core/images/units/` and mirrored under
 * `public/sprites/units/`; `pnpm --filter @fansong/web sprites` imports them, and
 * their animations, from a local Wesnoth checkout (see scripts/import-wesnoth.ts).
 *
 * Wesnoth art is GPL-2.0-or-later; see `public/sprites/CREDITS.md`.
 */
export const UNIT_SPRITES: Record<string, string> = {
  // Iron Wardens — heavy, disciplined loyalist infantry.
  'Warden-Captain': 'human-loyalists/general.png',
  Ironguard: 'human-loyalists/heavyinfantry.png',
  Bulwark: 'human-loyalists/siegetrooper.png',
  Sentinel: 'human-loyalists/royalguard.png',
  Halberdier: 'human-loyalists/halberdier.png',
  Levy: 'human-peasants/peasant.png',

  // Ashfang Raiders — orcs and goblin wolf riders.
  'Raid-Leader': 'orcs/leader.png',
  Marauder: 'orcs/grunt.png',
  Reaver: 'orcs/warrior.png',
  'Wolf-Prowler': 'goblins/wolf-rider.png',
  Outrider: 'goblins/knight.png',
  Whelp: 'goblins/spearman.png',

  // Free Company — sellswords and hired locals (its woodsman is drawn as the
  // Halberd-Recruit). The Hollow Watch, Thorn Patrol and Sky Talons groups below
  // are named after retired presets; their sprites are still looks in the army
  // builder, and the current presets reuse the Crossbow.
  Sergeant: 'human-loyalists/sergeant.png',
  Swordsman: 'human-loyalists/swordsman.png',
  Pikeman: 'human-loyalists/pikeman.png',
  Slinger: 'human-outlaws/footpad.png',
  'Halberd-Recruit': 'human-peasants/woodsman.png',
  Recruit: 'human-peasants/ruffian.png',

  // Hollow Watch — a garrison of bows, shields and a riposting captain.
  'Watch-Captain': 'human-loyalists/master-at-arms.png',
  'Shield-Warden': 'human-loyalists/shocktrooper.png',
  Longbow: 'human-loyalists/longbowman.png',
  Crossbow: 'human-loyalists/lieutenant-crossbow.png',
  Sentry: 'human-loyalists/spearman.png',

  // Thorn Patrol — a three-man border patrol: one bow, two foot.
  'Thorn-Bow': 'human-loyalists/longbowman.png',
  'Thorn-Blade': 'human-loyalists/swordsman.png',
  'Thorn-Spear': 'human-loyalists/spearman.png',

  // Sky Talons — a pair of flying gryphons screened by foot and a bow.
  'Sky-Talon': 'monsters/gryphon.png',
  'Storm-Talon': 'monsters/gryphon.png',
  'Talon-Falconer': 'human-loyalists/longbowman.png',
  Skywatch: 'human-loyalists/spearman.png',
  Fledgling: 'human-peasants/ruffian.png',

  // Bonefield Legion — Reassembling undead skeletons that refuse to stay down.
  'Skeleton Infantry': 'undead-skeletal/skeleton/skeleton.png',
  'Skeleton Archer': 'undead-skeletal/archer/archer.png',

  // Grave Knights — the skeletal elite: a rider, a twin-blade, and a crowned lord.
  'Skeleton Rider': 'undead-skeletal/rider.png',
  Deathblade: 'undead-skeletal/deathblade.png',
  'Death Knight': 'undead-skeletal/deathknight.png',

  // Wild beasts and monsters — the wandering menagerie and the brute horde.
  Falcon: 'monsters/falcon/falcon.png',
  'Wild Wyvern': 'monsters/wyvern/wild-wyvern.png',
  Bear: 'monsters/bear/bear.png',
  Yeti: 'monsters/yeti.png',
  'Giant Spider': 'monsters/spider.png',
  'Giant Scorpion': 'monsters/scorpion/scorpion.png',
  Wolf: 'monsters/wolf.png',
  Boar: 'monsters/boar/woodland.png',
  'Giant Rat': 'monsters/giant-rat.png',
  Crocodile: 'monsters/croc/crocodile.png',

  // Walkers — sprites with a real multi-frame Wesnoth walk cycle. The Night
  // Haunt, Greenwood Elves, Gryphon Eyrie and Hogwallow Farm presets use them.
  'Elvish Fighter': 'elves-wood/fighter/fighter.png',
  Ghost: 'undead-spirit/ghost-base.png',
  Shadow: 'undead-spirit/shadow-s-2.png',
  Nightgaunt: 'undead-spirit/nightgaunt.png',
  Piglet: 'monsters/boar/piglet.png',
  'Vampire Bat': 'bats/bat-se-3.png',
  'Gryphon Rider': 'dwarves/gryphon-rider.png',

  // --- Looks for the army builder ---
  // Every other Wesnoth unit with an attack clip of three or more frames (see
  // sprite-report.md), under its Wesnoth name and grouped by Wesnoth folder.
  // No preset fields them.
  // Humans — loyalist soldiers, riders, mages and outlaws.
  Horseman: 'human-loyalists/horseman/horseman.png',
  'Grand Knight': 'human-loyalists/grand-knight/grand-knight.png',
  Knight: 'human-loyalists/knight/knight.png',
  Bowman: 'human-loyalists/bowman.png',
  Cavalier: 'human-loyalists/cavalier/cavalier.png',
  Cavalryman: 'human-loyalists/cavalryman/cavalryman.png',
  Dragoon: 'human-loyalists/dragoon/dragoon.png',
  Fencer: 'human-loyalists/fencer.png',
  'Grand Marshal': 'human-loyalists/marshal.png',
  Javelineer: 'human-loyalists/javelineer.png',
  Lieutenant: 'human-loyalists/lieutenant.png',
  'Master Bowman': 'human-loyalists/masterbowman.png',
  Mage: 'human-magi/mage.png',
  'Arch Mage': 'human-magi/arch-mage.png',
  'Elder Mage': 'human-magi/elder-mage.png',
  'Great Mage': 'human-magi/great-mage.png',
  'Mage of Light': 'human-magi/white-cleric.png',
  'Red Mage': 'human-magi/red-mage.png',
  'Silver Mage': 'human-magi/silver-mage.png',
  'White Mage': 'human-magi/white-mage.png',
  Outlaw: 'human-outlaws/outlaw.png',
  Assassin: 'human-outlaws/assassin.png',
  Bandit: 'human-outlaws/bandit.png',
  Fugitive: 'human-outlaws/fugitive.png',
  Highwayman: 'human-outlaws/highwayman.png',
  Thug: 'human-outlaws/thug.png',
  'Royal Warrior': 'human-loyalists/royal-warrior.png',
  Huntsman: 'human-outlaws/huntsman.png',
  Poacher: 'human-outlaws/poacher.png',
  Ranger: 'human-outlaws/ranger.png',
  Trapper: 'human-outlaws/trapper.png',

  // Elves.
  'Elvish Archer': 'elves-wood/archer.png',
  'Elvish Avenger': 'elves-wood/avenger.png',
  'Elvish Captain': 'elves-wood/captain.png',
  'Elvish Champion': 'elves-wood/champion.png',
  'Elvish Druid': 'elves-wood/druid.png',
  'Elvish Enchantress': 'elves-wood/enchantress.png',
  'Elvish Hero': 'elves-wood/hero.png',
  'Elvish High Lord': 'elves-wood/high-lord.png',
  'Elvish Marksman': 'elves-wood/marksman.png',
  'Elvish Marshal': 'elves-wood/marshal.png',
  'Elvish Outrider': 'elves-wood/outrider/outrider.png',
  'Elvish Ranger': 'elves-wood/ranger.png',
  'Elvish Scout': 'elves-wood/scout/scout.png',
  'Elvish Sharpshooter': 'elves-wood/sharpshooter.png',
  'Elvish Shyde': 'elves-wood/shyde.png',
  'Elvish Sorceress': 'elves-wood/sorceress.png',

  // Dwarves.
  'Dwarvish Berserker': 'dwarves/berserker/berserker.png',
  'Dwarvish Dragonguard': 'dwarves/dragonguard/dragonguard.png',
  'Dwarvish Explorer': 'dwarves/explorer.png',
  'Dwarvish Fighter': 'dwarves/fighter.png',
  'Dwarvish Guardsman': 'dwarves/guard.png',
  'Dwarvish Lord': 'dwarves/lord.png',
  'Dwarvish Miner': 'dwarves/miner.png',
  'Dwarvish Pathfinder': 'dwarves/pathfinder.png',
  'Dwarvish Runesmith': 'dwarves/runesmith.png',
  'Dwarvish Scout': 'dwarves/scout.png',
  'Dwarvish Sentinel': 'dwarves/sentinel.png',
  'Dwarvish Stalwart': 'dwarves/stalwart.png',
  'Dwarvish Steelclad': 'dwarves/steelclad.png',
  'Dwarvish Thunderer': 'dwarves/thunderer/thunderer.png',
  'Dwarvish Thunderguard': 'dwarves/thunderguard/thunderguard.png',
  'Dwarvish Ulfserker': 'dwarves/ulfserker.png',

  // Orcs.
  'Orcish Archer': 'orcs/archer.png',
  'Orcish Assassin': 'orcs/assassin.png',
  'Orcish Crossbowman': 'orcs/xbowman.png',
  'Orcish Nightblade': 'orcs/nightblade.png',
  'Orcish Ruler': 'orcs/ruler.png',
  'Orcish Slayer': 'orcs/slayer.png',
  'Orcish Slurbow': 'orcs/slurbow.png',
  'Orcish Sovereign': 'orcs/sovereign.png',
  'Orcish Warlord': 'orcs/warlord.png',

  // Goblins and their wolf riders.
  'Direwolf Rider': 'goblins/direwolver.png',
  'Goblin Impaler': 'goblins/impaler.png',
  'Goblin Pillager': 'goblins/pillager-base1.png',
  'Goblin Rouser': 'goblins/rouser.png',

  // Trolls.
  'Great Troll': 'trolls/great-troll.png',
  'Troll Hero': 'trolls/troll-hero.png',
  'Troll Rocklobber': 'trolls/lobber.png',
  Troll: 'trolls/grunt.png',
  'Troll Shaman': 'trolls/shaman.png',
  'Troll Warrior': 'trolls/warrior.png',
  'Troll Whelp': 'trolls/whelp.png',

  // Ogres.
  Ogre: 'ogres/ogre.png',
  'Young Ogre': 'ogres/young-ogre.png',

  // Undead — skeletons, necromancers, corpse-eaters and spirits.
  Ghast: 'undead/ghast.png',
  Ghoul: 'undead/ghoul.png',
  Necrophage: 'undead/necrophage.png',
  Necromancer: 'undead-necromancers/necromancer.png',
  'Ancient Lich': 'undead-necromancers/ancient-lich.png',
  'Dark Adept': 'undead-necromancers/adept.png',
  'Dark Sorcerer': 'undead-necromancers/dark-sorcerer.png',
  Lich: 'undead-necromancers/lich.png',
  Banebow: 'undead-skeletal/banebow.png',
  'Bone Knight': 'undead-skeletal/boneknight.png',
  'Bone Shooter': 'undead-skeletal/bone-shooter.png',
  Chocobone: 'undead-skeletal/chocobone.png',
  'Death Squire': 'undead-skeletal/deathsquire.png',
  Draug: 'undead-skeletal/draug.png',
  Revenant: 'undead-skeletal/revenant/revenant.png',
  Spectre: 'undead-spirit/spectre.png',
  Wraith: 'undead-spirit/wraith-s.png',

  // Drakes.
  'Drake Arbiter': 'drakes/arbiter.png',
  'Armageddon Drake': 'drakes/armageddon.png',
  'Drake Blademaster': 'drakes/blademaster.png',
  'Drake Burner': 'drakes/burner.png',
  'Drake Clasher': 'drakes/clasher.png',
  'Drake Enforcer': 'drakes/enforcer.png',
  'Drake Fighter': 'drakes/fighter.png',
  'Fire Drake': 'drakes/fire.png',
  'Drake Flameheart': 'drakes/flameheart.png',
  'Drake Flare': 'drakes/flare.png',
  'Drake Glider': 'drakes/glider.png',
  'Hurricane Drake': 'drakes/hurricane.png',
  'Inferno Drake': 'drakes/inferno.png',
  'Sky Drake': 'drakes/sky.png',
  'Drake Thrasher': 'drakes/slasher.png',
  'Drake Warden': 'drakes/warden.png',
  'Drake Warrior': 'drakes/warrior.png',

  // Saurians.
  'Saurian Ambusher': 'saurians/ambusher/ambusher.png',
  'Saurian Augur': 'saurians/augur/augur.png',
  'Saurian Flanker': 'saurians/flanker/flanker.png',
  'Saurian Javelineer': 'saurians/javelineer/javelineer.png',
  'Saurian Oracle': 'saurians/oracle/oracle.png',
  'Saurian Prophet': 'saurians/prophet/prophet.png',
  'Saurian Seer': 'saurians/seer/seer.png',
  'Saurian Skirmisher': 'saurians/skirmisher/skirmisher.png',
  'Saurian Soothsayer': 'saurians/soothsayer/soothsayer.png',
  'Saurian Spearthrower': 'saurians/spearthrower/spearthrower.png',

  // Merfolk.
  'Merman Brawler': 'merfolk/brawler.png',
  'Merman Citizen': 'merfolk/citizen.png',
  'Merman Fighter': 'merfolk/fighter.png',
  'Merman Hunter': 'merfolk/hunter.png',
  'Mermaid Initiate': 'merfolk/initiate.png',
  'Merman Warrior': 'merfolk/warrior.png',

  // Nagas.
  'Naga Dirkfang': 'nagas/mixed/dirkfang.png',
  'Naga Fighter': 'nagas/fighter/fighter.png',
  'Naga Guard': 'nagas/guardian/guardian.png',
  'Naga High Guard': 'nagas/guardian/sentinel.png',
  'Naga Shield Guard': 'nagas/guardian/warden.png',
  'Naga Myrmidon': 'nagas/fighter/myrmidon.png',
  'Naga Ophidian': 'nagas/mixed/ophidian.png',
  'Naga Ringcaster': 'nagas/mixed/ringcaster.png',
  'Naga Sicarius': 'nagas/mixed/sicarius.png',
  'Naga Warrior': 'nagas/fighter/warrior.png',

  // Dunefolk.
  'Dune Burner': 'dunefolk/burner/burner.png',
  'Dune Marauder': 'dunefolk/rider/marauder.png',
  'Dune Rover': 'dunefolk/rover/rover.png',

  // Woses.
  'Wose Shaman': 'woses/wose-shaman.png',

  // Bats.
  'Blood Bat': 'bats/bloodbat-se-3.png',
  'Dread Bat': 'bats/dreadbat-se-3.png',

  // Beasts and monsters.
  'Giant Ant Queen': 'monsters/ant/queen.png',
  Caribe: 'monsters/caribe/caribe-small.png',
  'Hunter Caribe': 'monsters/caribe/caribe.png',
  'Forest Lion': 'monsters/cat/tritail-sitting.png',
  Jumpcat: 'monsters/cat/jumpcat.png',
  'Redtail Cat': 'monsters/cat/redtail-cat.png',
  'Cuttle Fish': 'monsters/cuttlefish.png',
  'Elder Falcon': 'monsters/falcon/elder-falcon.png',
  'Fire Guardian': 'monsters/fireghost/fireghost.png',
  'Frost Stoat': 'monsters/stoat/stoat.png',
  'Giant Mudcrawler': 'monsters/giant-mudcrawler.png',
  'Giant Scorpling': 'monsters/scorpion/scorpling.png',
  'Horned Scarab': 'monsters/scarab/scarab.png',
  'Bay Horse': 'monsters/horse/horse.png',
  'Black Horse': 'monsters/horse/horse-larger.png',
  Icemonax: 'monsters/icemonax/young-icemonax.png',
  'Great Icemonax': 'monsters/icemonax/great-icemonax.png',
  Jinn: 'monsters/jinn/jinn.png',
  Kraken: 'monsters/kraken/kraken.png',
  Mudcrawler: 'monsters/mudcrawler.png',
  'Rock Scorpion': 'monsters/scorpion/rock-scorpion.png',
  'Sand Scuttler': 'monsters/scorpion/sand-scuttler.png',
  'Great Seahorse': 'monsters/seahorse.png',
  'Shadow Jumping Spider': 'monsters/jumping-spider.png',
  'Tentacle of the Deep': 'monsters/deep-tentacle.png',
  'Water Serpent': 'monsters/water-serpent.png',
  Direwolf: 'monsters/direwolf.png',
  'Great Wolf': 'monsters/wolf-great.png',
};

/**
 * Sprites drawn on the back of a mount, and the horses themselves. Cosmetic only — riding is not a rule —
 * it picks the hoof sound over the footstep when one of them moves.
 */
export const RIDING_SPRITES: ReadonlySet<string> = new Set([
  'goblins/wolf-rider.png',
  'goblins/knight.png',
  'undead-skeletal/rider.png',
  'undead-skeletal/boneknight.png',
  'undead-skeletal/chocobone.png',
  'goblins/direwolver.png',
  'goblins/pillager-base1.png',
  'human-loyalists/horseman/horseman.png',
  'human-loyalists/knight/knight.png',
  'human-loyalists/grand-knight/grand-knight.png',
  'human-loyalists/cavalryman/cavalryman.png',
  'human-loyalists/dragoon/dragoon.png',
  'human-loyalists/cavalier/cavalier.png',
  'elves-wood/scout/scout.png',
  'elves-wood/outrider/outrider.png',
  'dunefolk/rider/marauder.png',
  'monsters/horse/horse.png',
  'monsters/horse/horse-larger.png',
]);

/**
 * The frame of a sprite's death clip that shows it knocked down but alive —
 * kneeling or staggered, before the fall. Hand-picked; a sprite without one
 * crouches (squashes) instead.
 */
export const DOWN_POSES: Record<string, string> = {
  'orcs/grunt.png': 'orcs/grunt-die-2.png',
  'goblins/spearman.png': 'goblins/spearman-die-1.png',
  'goblins/wolf-rider.png': 'goblins/wolf-rider-die-3.png',
  'human-loyalists/spearman.png': 'human-loyalists/spearman-death3.png',
  'human-loyalists/lieutenant-crossbow.png': 'human-loyalists/lieutenant-die-3.png',
  'human-peasants/peasant.png': 'human-peasants/peasant-die3.png',
  'undead-skeletal/skeleton/skeleton.png': 'undead-skeletal/skeleton/skeleton-dying-2.png',
  'undead-skeletal/archer/archer.png': 'undead-skeletal/archer/archer-die2-2.png',
  'undead-skeletal/deathblade.png': 'undead-skeletal/deathblade-dying-2.png',
  'monsters/giant-rat.png': 'monsters/giant-rat-die-1.png',
};

/** Used for any unit name without an entry above. */
export const FALLBACK_SPRITE = 'human-loyalists/spearman.png';

export function spriteFor(name: string): string {
  return UNIT_SPRITES[name] ?? FALLBACK_SPRITE;
}

/** Public URL of a sprite path from {@link UNIT_SPRITES}. */
export function spriteUrl(path: string): string {
  return `${import.meta.env.BASE_URL}sprites/units/${path}`;
}

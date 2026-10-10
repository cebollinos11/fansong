import type { GameMode } from '@fansong/engine';

/**
 * Every number that shapes a run, in one place, so the calibration sim can tune
 * difficulty and economy without touching the rules around them.
 */
export const RUN_TUNING = {
  draft: {
    /** Points the starting warband is drafted to. */
    budget: 120,
    /** Units shown per draft pick. */
    offers: 3,
  },
  /** Most units a run's roster may hold. */
  rosterCap: 12,
  /** Beating this step (the second act's boss) is the run's "victory"; play goes on after it. */
  victoryRound: 14,
  /** An act's map: `rows` steps of up to `lanes` nodes each, then the boss, joined by `paths` walks from the bottom row to the top. */
  route: {
    lanes: 5,
    rows: 6,
    paths: 4,
    /** How much likelier a walk is to step onto a place no walk has passed (`fresh`), or along a new road to one that has (`fork`), than to follow a road already there. */
    spread: { fresh: 4, fork: 3 },
    /** Chance that two neighbouring places the walks left unjoined get a road anyway (if it crosses none). */
    sideRoads: 0.8,
    /** How often a battle node pays each kind of reward. */
    rewardKinds: { recruit: 3, boost: 3, gold: 3, mend: 1 },
    /**
     * How often a node between the first row and the last is each kind. The
     * first row is all battles and the last all camps and markets; an elite
     * waits no lower than row `eliteFromRow`; no stop follows a stop; and
     * every act has at least one elite and one market.
     */
    kinds: { battle: 45, mystery: 15, elite: 15, market: 10, camp: 8, training: 7 },
    eliteFromRow: 3,
  },
  /** An elite's warband is bought with the step's budget times a roll between these; it is always led, and has veterans from the first step. */
  elite: { threat: { min: 1.4, max: 1.6 } },
  /** A camp's drill gives every unit this much XP. */
  camp: { drillXp: 3 },
  /** A training ground offers the unit named this many advances. */
  training: { choices: 3 },
  /** The events a mystery node may turn out to be. */
  events: {
    /** A recruit costing at least `minCost` points, for this share of its price. */
    sellsword: { minCost: 45, priceShare: 0.6 },
    /** A fight against the step's budget times `threat`, or a toll in gold to pass. */
    ambush: { threat: 0.75, toll: { base: 10, perRound: 3 } },
    /** Gold for the taking, or a d6: up to `collapse` a unit sits out and the gold is lost, over it `multiplier` times the gold. */
    cache: { gold: { base: 8, perRound: 2 }, collapse: 2, multiplier: 3 },
    /** A free Disloyal recruit costing at most `maxCost` points before the trait, or gold. */
    deserters: { maxCost: 45, gold: { base: 6, perRound: 2 } },
    /** A retreat banner, or this much gold. */
    standard: { gold: 25 },
  },
  /** What a market sells besides its shop. */
  market: {
    /** A retreat banner, in gold. */
    banner: 40,
  },
  enemy: {
    /** Step 1's enemy budget, in points. */
    start: 100,
    /** How much the budget grows each step, compounding, whether or not the step was a fight. */
    perRound: 0.2,
    /** A boss every this many steps: the length of an act. */
    bossEvery: 7,
    /** Extra budget on a boss round, as a share of that round's. */
    bossBonus: 0.2,
    /** Earlier rounds meet a leaderless patrol: only from this round on does the enemy bring its leader. */
    leaderFromRound: 4,
    /** Fewest units an enemy warband fields, even if its cheapest troops then cost more than the budget. */
    minUnits: 3,
    /** Most units an enemy warband fields. */
    maxUnits: 14,
    /** From this round on, points not spent on units buy veteran upgrades. */
    veteranFromRound: 6,
    /** Share of the budget kept back from buying units, for veterans: this much more each round from `veteranFromRound`, up to a cap. */
    veteranShare: { perRound: 0.04, max: 0.4 },
  },
  /** Warbands of past runs, met again as enemies. */
  rivals: {
    /** Most past warbands one run meets. */
    max: 3,
    /** None before this round. */
    fromRound: 2,
    /** A past warband fights in a round whose enemy budget its cost is within these shares of. */
    band: { min: 0.75, max: 1.3 },
  },
  champion: {
    /** A boss's champion is pushed to this Quality… */
    quality: 2,
    /** …and at least this Combat… */
    minCombat: 5,
    /** …with this many extra traits on the first boss… */
    traits: 2,
    /** …and this many more on each boss after it. */
    traitsPerBoss: 1,
  },
  modes: {
    /** Rounds up to this one are always annihilation. */
    annihilationThrough: 3,
    /** The modes a regular round rolls between. */
    regular: ['annihilation', 'conquest', 'king-of-the-hill'] as readonly GameMode[],
    boss: 'kill-the-king' as GameMode,
  },
  map: {
    /** Board size: a base, plus a hex per so many units on the field, up to a cap. */
    width: { base: 14, unitsPerHex: 3, max: 26 },
    height: { base: 10, unitsPerHex: 4, max: 20 },
    /** Terrain goes from `from` to `to` over this many rounds. */
    rampRounds: 17,
    hills: { from: 0.9, to: 1 },
    forest: { from: 0.14, to: 0.22 },
    rock: { from: 0.06, to: 0.1 },
    building: { from: 0.03, to: 0.05 },
    lava: { from: 0.01, to: 0.04 },
    /** Rounds before this one have no lava. */
    lavaFromRound: 6,
    /** From this round on, maps are no longer mirrored. */
    asymmetricFromRound: 8,
  },
  xp: {
    /** For taking part in a won battle. */
    fought: 1,
    perKill: 2,
    /** On top of `perKill`, for killing a unit that costs more than the killer. */
    costlierKill: 1,
    /** Total XP at which a unit reaches level 1, 2, …; the last is the cap. */
    levels: [6, 14, 24, 36] as readonly number[],
    /** Advances offered per level. */
    choices: 2,
  },
  /** The d6 a fallen unit rolls: up to `dead` it dies, up to `wound` it takes a lasting wound, up to `sitsOut` it misses the next battle, above that it recovers. */
  injury: { dead: 1, wound: 2, sitsOut: 3 },
  /** The same d6 for a unit left behind when the player retreats: two more faces of death. */
  leftBehind: { dead: 3, wound: 4, sitsOut: 5 },
  /** Retreat banners: a run starts with `start`, gains `perBoss` for each boss beaten, and never holds more than `max`. */
  banners: { start: 1, max: 3, perBoss: 1 },
  gold: {
    perWin: 6,
    /** Times the round just won. */
    perRound: 1,
    /** Share of the enemy points destroyed. */
    killShare: 0.05,
  },
  /** The battles on the route, and what they pay. */
  mission: {
    /** Each battle's enemy is bought with the step's budget times a roll between these. */
    threat: { min: 0.75, max: 1.3 },
    /** Skulls a mission at `threat.max` or over shows; one at `threat.min` or under shows 1. */
    skulls: 5,
    reward: {
      /** What a mission of threat 1 pays, in gold's worth: a base, plus this much per round. */
      base: 30,
      perRound: 4,
      /** Each 1% of threat over (under) 1 adds (takes off) this many % of that… */
      slope: 2.5,
      /** …but never down to less than this share of it. */
      min: 0.4,
      /** A boss pays this many times it. */
      boss: 2,
      /** A recruit, boost or mending worth less than the mission pays is topped up in gold, if the gap is at least this. */
      spareGold: 3,
    },
  },
  /** The small shop in the field after a battle: mending and a recruit, no reroll, no selling. */
  fieldShop: { recruits: 1, upgrades: 0 },
  /** A market's shop. */
  shop: {
    recruits: 3,
    upgrades: 2,
    /** An upgrade costs its point-cost difference times this (at least `minUpgrade`). */
    upgradeMultiplier: 1.5,
    minUpgrade: 3,
    heal: 10,
    /** A reroll costs this, plus `rerollStep` for each one already bought this visit. */
    reroll: 4,
    rerollStep: 2,
    /** Selling a unit pays this share of its point cost. */
    sellShare: 0.5,
  },
} as const;

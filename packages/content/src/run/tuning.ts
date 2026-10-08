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
  /** Beating this round is the run's "victory"; play goes on after it. */
  victoryRound: 10,
  enemy: {
    /** Round 1's enemy budget, as a share of the draft budget. */
    startShare: 0.9,
    /** Budget added each round, as a share of round 1's. */
    perRound: 0.12,
    /** A boss every this many rounds. */
    bossEvery: 5,
    /** Extra budget on a boss round, as a share of that round's. */
    bossBonus: 0.25,
    /** Most units an enemy warband fields. */
    maxUnits: 14,
    /** From this round on, points not spent on units buy veteran upgrades. */
    veteranFromRound: 4,
    /** Share of the budget kept back from buying units, for veterans: this much more each round from `veteranFromRound`, up to a cap. */
    veteranShare: { perRound: 0.04, max: 0.4 },
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
    annihilationThrough: 2,
    /** The modes a regular round rolls between. */
    regular: ['annihilation', 'conquest', 'king-of-the-hill'] as readonly GameMode[],
    boss: 'kill-the-king' as GameMode,
  },
  map: {
    /** Board size: a base, plus a hex per so many units on the field, up to a cap. */
    width: { base: 14, unitsPerHex: 3, max: 26 },
    height: { base: 10, unitsPerHex: 4, max: 20 },
    /** Terrain goes from `from` to `to` over this many rounds. */
    rampRounds: 12,
    hills: { from: 0.3, to: 0.8 },
    forest: { from: 0.08, to: 0.16 },
    rock: { from: 0.03, to: 0.08 },
    building: { from: 0.01, to: 0.04 },
    lava: { from: 0.01, to: 0.04 },
    /** Rounds before this one have no lava. */
    lavaFromRound: 4,
    /** From this round on, maps are no longer mirrored. */
    asymmetricFromRound: 6,
  },
  xp: {
    /** For taking part in a won battle. */
    fought: 1,
    perKill: 2,
    /** On top of `perKill`, for killing a unit that costs more than the killer. */
    costlierKill: 1,
    /** Total XP at which a unit reaches level 1, 2, …; the last is the cap. */
    levels: [3, 7, 12, 18] as readonly number[],
    /** Advances offered per level. */
    choices: 2,
  },
  /** The d6 a fallen unit rolls: up to `dead` it dies, up to `wound` it takes a lasting wound, up to `sitsOut` it misses the next battle, above that it recovers. */
  injury: { dead: 1, wound: 2, sitsOut: 3 },
  gold: {
    perWin: 15,
    /** Times the round just won. */
    perRound: 3,
    /** Share of the enemy points destroyed. */
    killShare: 0.15,
  },
  reward: {
    options: 3,
    /** A gold purse: a base, plus this much per round. */
    purse: 20,
    pursePerRound: 3,
  },
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

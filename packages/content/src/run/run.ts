import type { GameConfig } from '@fansong/engine';
import { DEFAULT_BOARD, defaultKing } from '../deploy.js';
import { getMap } from '../mapRegistry.js';
import { configFromSetup, type MapLookup, type MatchSetup } from '../match.js';
import type { Warband } from '../warband.js';
import { applyAdvance } from './advance.js';
import { leaderOffer, troopOffer } from './draft.js';
import { generateEncounter, isBossRound } from './encounter.js';
import { applyAftermath, applyRetreat, applyReward, missionRewardOffers, rewardNeedsUnit, rewardsClaimable, rewardValue, rollLevelUps } from './progress.js';
import { battleReport } from './report.js';
import { scheduleRivals } from './rivals.js';
import { makeRunRandom, type RunRandom } from './rng.js';
import { enlist, fieldedUnits, fitUnits, isWounded, playerWarband, renameUnit, rosterCost, rosterUnit } from './roster.js';
import { buyRecruit, buyUpgrade, healUnit, rerollShop, sellUnit, shopStock } from './shop.js';
import { RUN_TUNING } from './tuning.js';
import type { RunAction, RunMission, RunState } from './types.js';

/**
 * The run state machine. A run is `newRun(seed)` plus the actions taken:
 * {@link runStep} applies one and returns the next state, never touching the
 * one it was given, and throws on an action the state doesn't allow.
 * {@link legalRunActions} lists what is allowed. A {@link RunState} is plain
 * JSON, so it can be saved between any two steps.
 *
 * The battle itself is an ordinary match: the client plays
 * {@link runBattleConfig} and hands its replay back as a `battleResult`.
 */

/** Open the round's next stream of dice (mutates `s`: it counts the roll). */
function roll(s: RunState): RunRandom {
  return makeRunRandom(s.seed, s.round, s.rolls++);
}

/** A new run, at its leader pick. It meets some of `past` (warbands earlier runs ended with) again as enemies. */
export function newRun(seed: number, past: readonly Warband[] = []): RunState {
  const s: RunState = {
    version: 2,
    seed: Math.floor(seed),
    round: 1,
    phase: 'draft',
    roster: [],
    gold: 0,
    rolls: 0,
    nextId: 1,
    banners: RUN_TUNING.banners.start,
    log: [],
  };
  const rivals = scheduleRivals(s.seed, past);
  if (rivals.length > 0) s.rivals = rivals;
  s.offer = { kind: 'draft', stage: 'leader', units: leaderOffer(roll(s)) };
  return s;
}

/**
 * Roll the round's missions and put them up for choosing (mutates `s`). The
 * enemies come from the seed, the round and the retreats made from it alone;
 * what each pays is rolled for the roster as it stands, so every reward offered
 * can be taken.
 */
function enterMission(s: RunState): void {
  const rival = s.rivals?.find((r) => r.round === s.round)?.warband;
  const { mode, map, seed, enemies } = generateEncounter(s.seed, s.round, s.roster.length, rival, s.retreats ?? 0);
  const values = enemies.map((e) => rewardValue(s.round, e.threat));
  const rewards = missionRewardOffers(s, values, roll(s));
  const missions = enemies.map((e, i): RunMission => {
    const mission: RunMission = { faction: e.faction, enemy: e.warband, threat: e.threat, rewards: rewards[i]!, rewardValue: values[i]! };
    if (e.king !== undefined) mission.enemyKing = e.king;
    return mission;
  });
  s.phase = 'mission';
  s.offer = { kind: 'missions', mode, map, seed, missions };
}

/** Whether the run has beaten its victory round (it may still be going). */
export function runVictorious(s: RunState): boolean {
  return s.log.some((r) => r.won && r.round >= RUN_TUNING.victoryRound);
}

/** The match of the battle phase; throws before the battle has started. */
export function runMatchSetup(s: RunState): MatchSetup {
  if (!s.battle?.setup) throw new Error('the battle has not started');
  return s.battle.setup;
}

/** A map lookup that knows the run's generated battlefield as well as the built-in maps. */
export function runMapLookup(s: RunState): MapLookup {
  const map = s.battle?.map;
  return (id) => (map && id === map.id ? map : getMap(id));
}

/**
 * The engine config of the battle phase's match. The same every time, so a
 * battle left midway restarts as it began. With a retreat banner in hand, the
 * player's deploy zone is where its retreat flag may go up; the enemy never
 * retreats. (The banner is only spent when the battle's result is handed in.)
 */
export function runBattleConfig(s: RunState): GameConfig {
  const config = configFromSetup(runMatchSetup(s), DEFAULT_BOARD, runMapLookup(s));
  if (s.banners > 0) config.retreatZones = [s.battle!.map.deployZones[0].map((v) => ({ x: v.x, y: v.y })), []];
  return config;
}

/** Apply `action` to a run. Returns the next state; `state` is left untouched. Throws on an illegal action. */
export function runStep(state: RunState, action: RunAction): RunState {
  const s = JSON.parse(JSON.stringify(state)) as RunState;
  const need = (...phases: RunState['phase'][]) => {
    if (!phases.includes(s.phase)) throw new Error(`"${action.type}" is not allowed in the ${s.phase} phase`);
  };

  switch (action.type) {
    case 'draftPick': {
      need('draft');
      const unit = s.offer?.kind === 'draft' ? s.offer.units[action.index] : undefined;
      if (!unit) throw new Error(`no draft offer ${action.index}`);
      enlist(s, unit);
      const left = RUN_TUNING.draft.budget - rosterCost(s);
      const units = s.roster.length < RUN_TUNING.rosterCap ? troopOffer(left, roll(s)) : [];
      if (units.length > 0) s.offer = { kind: 'draft', stage: 'troop', units };
      else enterMission(s);
      break;
    }
    case 'pickMission': {
      need('mission');
      const offer = s.offer?.kind === 'missions' ? s.offer : undefined;
      const mission = offer?.missions[action.index];
      if (!offer || !mission) throw new Error(`no mission ${action.index}`);
      const { faction, enemy, enemyKing, threat, rewards, rewardValue: value } = mission;
      s.battle = { mode: offer.mode, faction, enemy, map: offer.map, seed: offer.seed, threat, rewards, rewardValue: value };
      if (enemyKing !== undefined) s.battle.enemyKing = enemyKing;
      s.phase = 'briefing';
      delete s.offer;
      // A bench that would leave nobody to fight is cleared.
      if (fitUnits(s).every((u) => u.benched)) for (const u of s.roster) delete u.benched;
      break;
    }
    case 'bench': {
      need('briefing');
      const u = rosterUnit(s, action.unitId);
      if (action.benched) u.benched = true;
      else delete u.benched;
      if (fitUnits(s).every((x) => x.benched)) throw new Error('someone has to fight');
      break;
    }
    case 'setKing': {
      need('briefing');
      if (s.battle!.mode !== 'kill-the-king') throw new Error('this battle has no King');
      if (!fieldedUnits(s).some((u) => u.id === action.unitId)) throw new Error(`unit "${action.unitId}" is not fighting this battle`);
      s.battle!.playerKing = action.unitId;
      break;
    }
    case 'startBattle': {
      need('briefing');
      const battle = s.battle!;
      const fielded = fieldedUnits(s);
      const warband = playerWarband(s);
      const setup: MatchSetup = {
        presets: ['run', battle.faction],
        warbands: [warband, battle.enemy],
        seats: ['human', 'ai'],
        seed: battle.seed,
        mapId: battle.map.id,
      };
      if (battle.mode !== 'annihilation') setup.mode = battle.mode;
      if (battle.mode === 'kill-the-king') {
        const chosen = fielded.findIndex((u) => u.id === battle.playerKing);
        setup.kings = [chosen >= 0 ? chosen : defaultKing(warband.units), battle.enemyKing ?? defaultKing(battle.enemy.units)];
      }
      battle.fielded = fielded.map((u) => u.id);
      battle.setup = setup;
      s.phase = 'battle';
      delete s.aftermath;
      break;
    }
    case 'battleResult': {
      need('battle');
      const battle = s.battle!;
      if (JSON.stringify(action.replay.config) !== JSON.stringify(runBattleConfig(s)))
        throw new Error("the replay is not of this round's battle");
      const report = battleReport(action.replay, battle.fielded!);
      if (report.winner === null) throw new Error('the battle is not over');
      if (report.winner === 0) {
        applyAftermath(s, report, roll(s));
        s.offer = { kind: 'reward', rewards: battle.rewards, value: battle.rewardValue };
        s.phase = 'aftermath';
        // A beaten boss's banner is the player's to carry.
        const { max, perBoss } = RUN_TUNING.banners;
        if (isBossRound(s.round)) s.banners = Math.max(s.banners, Math.min(max, s.banners + perBoss));
      } else if (report.retreated && s.banners > 0) {
        // The battle is lost but the run is not: the banner is spent, and the
        // round will be fought again against someone new.
        applyRetreat(s, report, roll(s));
        s.banners--;
        s.retreats = (s.retreats ?? 0) + 1;
        delete s.offer;
        s.phase = s.roster.length > 0 ? 'aftermath' : 'over';
      } else {
        s.log.push({
          round: s.round,
          mode: battle.mode,
          enemy: battle.enemy.name,
          boss: battle.enemyKing !== undefined,
          won: false,
          kills: Object.values(report.units).reduce((sum, u) => sum + u.kills, 0),
          losses: 0,
          gold: 0,
        });
        s.phase = 'over';
      }
      delete s.battle;
      break;
    }
    case 'advance': {
      need('aftermath');
      const at = (s.pending ?? []).findIndex((p) => p.unitId === action.unitId);
      const advance = s.pending?.[at]?.choices[action.index];
      if (!advance) throw new Error(`no advance ${action.index} pending for "${action.unitId}"`);
      const u = rosterUnit(s, action.unitId);
      u.unit = applyAdvance(u.unit, advance);
      u.level++;
      s.pending!.splice(at, 1);
      rollLevelUps(s, roll(s));
      break;
    }
    case 'continue': {
      need('aftermath');
      if (s.pending?.length) throw new Error('there are levels still to spend');
      // A retreat is owed nothing: straight to the shop, to replace the lost with the gold in hand.
      if (s.aftermath?.retreated) {
        s.offer = shopStock(s, roll(s));
        s.phase = 'shop';
        break;
      }
      if (s.offer?.kind !== 'reward') throw new Error('no reward is owed');
      // Pay the battle left nobody to take (the unit it suited died) comes as gold.
      if (!rewardsClaimable(s, s.offer.rewards)) s.offer.rewards = [{ kind: 'gold', amount: s.offer.value }];
      s.phase = 'reward';
      break;
    }
    case 'reward': {
      need('reward');
      if (s.offer?.kind !== 'reward') throw new Error('no reward is owed');
      for (const option of s.offer.rewards) applyReward(s, option, rewardNeedsUnit(option) ? action.unitId : undefined);
      s.offer = shopStock(s, roll(s));
      s.phase = 'shop';
      break;
    }
    case 'buyRecruit':
      need('shop');
      buyRecruit(s, action.index);
      break;
    case 'buyUpgrade':
      need('shop');
      buyUpgrade(s, action.index, action.unitId);
      break;
    case 'heal':
      need('shop');
      healUnit(s, action.unitId);
      break;
    case 'reroll':
      need('shop');
      rerollShop(s, roll(s));
      break;
    case 'sell':
      need('shop');
      sellUnit(s, action.unitId);
      break;
    case 'leaveShop':
      need('shop');
      // After a retreat the same round is fought again; only a win moves the run on.
      if (!s.aftermath?.retreated) {
        s.round++;
        s.rolls = 0;
        delete s.retreats;
      }
      enterMission(s);
      break;
    case 'rename':
      if (s.phase === 'battle' || s.phase === 'over') throw new Error('units cannot be renamed now');
      renameUnit(s, action.unitId, action.name);
      break;
    default:
      throw new Error(`unknown action ${JSON.stringify(action satisfies never)}`);
  }
  return s;
}

/** Why `action` can't be taken now, or `null` if it can. */
export function runActionError(state: RunState, action: RunAction): string | null {
  try {
    runStep(state, action);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * Every action the run allows now, for an auto-picker and the tests. The battle
 * phase lists none: its one action, `battleResult`, needs the played match.
 */
export function legalRunActions(s: RunState): RunAction[] {
  const ids = s.roster.map((u) => u.id);
  const candidates: RunAction[] = [];
  switch (s.phase) {
    case 'draft':
      if (s.offer?.kind === 'draft') s.offer.units.forEach((_, index) => candidates.push({ type: 'draftPick', index }));
      break;
    case 'mission':
      if (s.offer?.kind === 'missions') s.offer.missions.forEach((_, index) => candidates.push({ type: 'pickMission', index }));
      break;
    case 'briefing':
      candidates.push({ type: 'startBattle' });
      for (const u of s.roster) candidates.push({ type: 'bench', unitId: u.id, benched: !u.benched });
      for (const unitId of ids) candidates.push({ type: 'setKing', unitId });
      break;
    case 'aftermath':
      for (const p of s.pending ?? []) p.choices.forEach((_, index) => candidates.push({ type: 'advance', unitId: p.unitId, index }));
      candidates.push({ type: 'continue' });
      break;
    case 'reward':
      if (s.offer?.kind === 'reward') {
        if (s.offer.rewards.some(rewardNeedsUnit)) for (const unitId of ids) candidates.push({ type: 'reward', unitId });
        else candidates.push({ type: 'reward' });
      }
      break;
    case 'shop':
      candidates.push({ type: 'leaveShop' });
      if (s.offer?.kind === 'shop') {
        s.offer.recruits.forEach((_, index) => candidates.push({ type: 'buyRecruit', index }));
        s.offer.upgrades.forEach((_, index) => {
          for (const unitId of ids) candidates.push({ type: 'buyUpgrade', index, unitId });
        });
      }
      for (const u of s.roster) if (isWounded(u)) candidates.push({ type: 'heal', unitId: u.id });
      candidates.push({ type: 'reroll' });
      for (const unitId of ids) candidates.push({ type: 'sell', unitId });
      break;
    case 'battle':
    case 'over':
      break;
  }
  return candidates.filter((a) => runActionError(s, a) === null);
}

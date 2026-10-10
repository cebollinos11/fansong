import type { GameConfig } from '@fansong/engine';
import { DEFAULT_BOARD, defaultKing } from '../deploy.js';
import { getMap } from '../mapRegistry.js';
import { configFromSetup, type MapLookup, type MatchSetup } from '../match.js';
import type { Warband } from '../warband.js';
import { applyAdvance } from './advance.js';
import { leaderOffer, troopOffer } from './draft.js';
import { generateBattle, isBossRound } from './encounter.js';
import { eventChoices, resolveEvent, rollEvent } from './events.js';
import { applyAftermath, applyRetreat, applyReward, missionRewards, rewardKinds, rewardNeedsUnit, rewardsClaimable, rewardValue, rollLevelUps } from './progress.js';
import { battleReport } from './report.js';
import { scheduleRivals } from './rivals.js';
import { makeRunRandom, type RunRandom } from './rng.js';
import { actOf, generateRoute, openNodes } from './route.js';
import { enlist, fieldedUnits, fitUnits, isWounded, playerWarband, renameUnit, rosterCost, rosterUnit } from './roster.js';
import { buyRecruit, buyUpgrade, healUnit, rerollShop, sellUnit, shopStock } from './shop.js';
import { buyBanner, makeCamp, takeTraining, trainUnit } from './stops.js';
import { RUN_TUNING } from './tuning.js';
import type { RouteNode, RunAction, RunState } from './types.js';

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
    version: 3,
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

/** Open the map (mutates `s`), drawing the act's route if the run has just come into the act. */
function enterMap(s: RunState): void {
  const act = actOf(s.round);
  if (s.route?.act !== act) s.route = generateRoute(s.seed, act, s.rivals ?? []);
  s.phase = 'map';
  delete s.offer;
}

/**
 * Finish the node being played and go back to the map, a step on (mutates
 * `s`). After a retreat there is no such node: the run stays at its step, the
 * fled node closed.
 */
function leaveNode(s: RunState): void {
  const route = s.route!;
  if (route.going !== undefined) {
    route.at = route.going;
    route.path.push(route.going);
    delete route.going;
    s.round++;
    s.rolls = 0;
    delete s.retreats;
  }
  enterMap(s);
}

/**
 * Meet the battle waiting at `node` (mutates `s`). The enemy comes from the
 * seed, the step, the node and the retreats made at the step alone; what
 * winning pays is rolled for the roster as it stands, so it can be taken.
 */
function enterBattle(s: RunState, node: Pick<RouteNode, 'id'> & Partial<RouteNode>, plain = false): void {
  const retreats = s.retreats ?? 0;
  // A rival the player has fled does not wait around: someone new holds the place.
  const rival = node.rival && retreats === 0 ? s.rivals?.find((r) => r.round === s.round)?.warband : undefined;
  const { mode, map, seed, enemy } = generateBattle(s.seed, s.round, node, s.roster.length, rival, retreats);
  const value = plain ? 0 : rewardValue(s.round, enemy.threat);
  const kind = node.rewardKind !== undefined && rewardKinds(s).includes(node.rewardKind) ? node.rewardKind : 'gold';
  const rewards = plain ? [] : missionRewards(s, kind, value, roll(s));
  s.battle = { mode, faction: enemy.faction, enemy: enemy.warband, map, seed, threat: enemy.threat, rewards, rewardValue: value };
  if (enemy.king !== undefined) s.battle.enemyKing = enemy.king;
  if (node.kind === 'elite') s.battle.elite = true;
  if (plain) s.battle.plain = true;
  s.phase = 'briefing';
  delete s.offer;
  // A bench that would leave nobody to fight is cleared.
  if (fitUnits(s).every((u) => u.benched)) for (const u of s.roster) delete u.benched;
}

/** Move on from a training ground (mutates `s`): to the field shop if it was an elite's pay, else back to the map. */
function afterTraining(s: RunState): void {
  if (s.offer?.kind === 'training' && s.offer.then === 'shop') enterFieldShop(s);
  else leaveNode(s);
}

/** The small shop every battle ends at (mutates `s`). */
function enterFieldShop(s: RunState): void {
  s.offer = shopStock(s, roll(s));
  s.phase = 'shop';
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
 * retreats. (The banner the call spends is only taken when the battle's result
 * is handed in.)
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
      else enterMap(s);
      break;
    }
    case 'travel': {
      need('map');
      const route = s.route!;
      const node = route.nodes[action.nodeId];
      if (!node || !openNodes(route).includes(node.id)) throw new Error(`the road does not lead to node ${action.nodeId}`);
      route.going = node.id;
      delete s.aftermath;
      switch (node.kind) {
        case 'battle':
        case 'elite':
        case 'boss':
          enterBattle(s, node);
          break;
        case 'market':
          s.offer = shopStock(s, roll(s), true);
          s.phase = 'shop';
          break;
        case 'camp':
        case 'training':
          s.offer = { kind: node.kind };
          s.phase = 'stop';
          break;
        case 'mystery':
          s.offer = rollEvent(s, roll(s));
          s.phase = 'stop';
          break;
      }
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
      // Sounding the retreat spends the banner, however the battle then went.
      const called = report.retreated && s.banners > 0;
      if (called) s.banners--;
      if (report.winner === 0) {
        applyAftermath(s, report, roll(s));
        // An ambush had nothing at stake but the road.
        if (battle.plain) {
          delete s.offer;
          s.aftermath!.plain = true;
        } else s.offer = { kind: 'reward', rewards: battle.rewards, value: battle.rewardValue };
        s.phase = 'aftermath';
        // A beaten boss's banner is the player's to carry.
        const { max, perBoss } = RUN_TUNING.banners;
        if (isBossRound(s.round)) s.banners = Math.max(s.banners, Math.min(max, s.banners + perBoss));
      } else if (called) {
        // The battle is lost but the run is not: it falls back to the map, and
        // the node it fled is closed if another road is left (never the boss's).
        applyRetreat(s, report, roll(s));
        s.retreats = (s.retreats ?? 0) + 1;
        const route = s.route!;
        const fled = route.going!;
        delete route.going;
        if (route.nodes[fled]!.kind !== 'boss') {
          route.closed.push(fled);
          if (openNodes(route).length === 0) route.closed.pop();
        }
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
      need('aftermath', 'stop');
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
      // A retreat is owed nothing, and an ambush had no reward: straight to the field shop.
      if (s.aftermath?.retreated || s.aftermath?.plain) {
        enterFieldShop(s);
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
      // An elite's defeat also pays a free training, before the field shop.
      if (s.route!.nodes[s.route!.going!]!.kind === 'elite') {
        s.offer = { kind: 'training', then: 'shop' };
        s.phase = 'stop';
      } else enterFieldShop(s);
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
      leaveNode(s);
      break;
    case 'buyBanner':
      need('shop');
      buyBanner(s);
      break;
    case 'camp':
      need('stop');
      makeCamp(s, action.choice, roll(s));
      break;
    case 'train':
      need('stop');
      trainUnit(s, action.unitId, roll(s));
      break;
    case 'trainPick':
      need('stop');
      takeTraining(s, action.index);
      afterTraining(s);
      break;
    case 'leaveStop': {
      need('stop');
      if (s.pending?.length) throw new Error('there are levels still to spend');
      if (s.offer?.kind === 'camp') {
        if (!s.offer.taken) throw new Error('the night is still to be spent: rest or drill');
        leaveNode(s);
      } else if (s.offer?.kind === 'training') {
        if (s.offer.unitId !== undefined) throw new Error('the unit training has yet to choose');
        afterTraining(s);
      } else if (s.offer?.kind === 'event') {
        if (!s.offer.result) throw new Error('this is still to be settled');
        leaveNode(s);
      } else throw new Error('there is nothing to leave');
      break;
    }
    case 'eventChoice': {
      need('stop');
      const outcome = resolveEvent(s, action.index, action.unitId, roll(s));
      // An ambush fought is a battle at the mystery's own node, weaker than the road's.
      if ('battle' in outcome) enterBattle(s, { id: s.route!.going!, budget: RUN_TUNING.events.ambush.threat }, true);
      break;
    }
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
    case 'map':
      for (const nodeId of s.route ? openNodes(s.route) : []) candidates.push({ type: 'travel', nodeId });
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
      if (s.offer?.kind === 'shop' && s.offer.market) {
        candidates.push({ type: 'reroll' });
        candidates.push({ type: 'buyBanner' });
        for (const unitId of ids) candidates.push({ type: 'sell', unitId });
      }
      break;
    case 'stop':
      candidates.push({ type: 'leaveStop' });
      for (const p of s.pending ?? []) p.choices.forEach((_, index) => candidates.push({ type: 'advance', unitId: p.unitId, index }));
      if (s.offer?.kind === 'camp') for (const choice of ['rest', 'drill'] as const) candidates.push({ type: 'camp', choice });
      if (s.offer?.kind === 'training') {
        for (const unitId of ids) candidates.push({ type: 'train', unitId });
        (s.offer.choices ?? []).forEach((_, index) => candidates.push({ type: 'trainPick', index }));
      }
      if (s.offer?.kind === 'event')
        eventChoices(s.offer, s).forEach((c, index) => {
          if (c.needsUnit) for (const unitId of ids) candidates.push({ type: 'eventChoice', index, unitId });
          else candidates.push({ type: 'eventChoice', index });
        });
      break;
    case 'battle':
    case 'over':
      break;
  }
  return candidates.filter((a) => runActionError(s, a) === null);
}

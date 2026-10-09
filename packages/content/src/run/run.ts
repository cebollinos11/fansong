import type { GameConfig } from '@fansong/engine';
import { DEFAULT_BOARD, defaultKing } from '../deploy.js';
import { getMap } from '../mapRegistry.js';
import { configFromSetup, type MapLookup, type MatchSetup } from '../match.js';
import type { Warband } from '../warband.js';
import { applyAdvance } from './advance.js';
import { leaderOffer, troopOffer } from './draft.js';
import { generateEncounter } from './encounter.js';
import { applyAftermath, applyReward, rewardOffer, rollLevelUps } from './progress.js';
import { battleReport } from './report.js';
import { scheduleRivals } from './rivals.js';
import { makeRunRandom, type RunRandom } from './rng.js';
import { enlist, fieldedUnits, fitUnits, isWounded, playerWarband, renameUnit, rosterCost, rosterUnit } from './roster.js';
import { buyRecruit, buyUpgrade, healUnit, rerollShop, sellUnit, shopStock } from './shop.js';
import { RUN_TUNING } from './tuning.js';
import type { RunAction, RunState } from './types.js';

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
  const s: RunState = { version: 1, seed: Math.floor(seed), round: 1, phase: 'draft', roster: [], gold: 0, rolls: 0, nextId: 1, log: [] };
  const rivals = scheduleRivals(s.seed, past);
  if (rivals.length > 0) s.rivals = rivals;
  s.offer = { kind: 'draft', stage: 'leader', units: leaderOffer(roll(s)) };
  return s;
}

/** Roll the round's battle and go to its briefing (mutates `s`). */
function enterBriefing(s: RunState): void {
  s.phase = 'briefing';
  delete s.offer;
  const rival = s.rivals?.find((r) => r.round === s.round)?.warband;
  s.battle = generateEncounter(s.seed, s.round, s.roster.length, rival);
  // A bench that would leave nobody to fight is cleared.
  if (fitUnits(s).every((u) => u.benched)) for (const u of s.roster) delete u.benched;
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

/** The engine config of the battle phase's match. The same every time, so a battle left midway restarts as it began. */
export function runBattleConfig(s: RunState): GameConfig {
  return configFromSetup(runMatchSetup(s), DEFAULT_BOARD, runMapLookup(s));
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
      else enterBriefing(s);
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
        s.phase = 'aftermath';
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
      s.offer = { kind: 'reward', options: rewardOffer(s, roll(s)) };
      s.phase = 'reward';
      break;
    }
    case 'reward': {
      need('reward');
      const option = s.offer?.kind === 'reward' ? s.offer.options[action.index] : undefined;
      if (!option) throw new Error(`no reward ${action.index}`);
      applyReward(s, option, action.unitId);
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
      s.round++;
      s.rolls = 0;
      enterBriefing(s);
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
      if (s.offer?.kind === 'reward')
        s.offer.options.forEach((option, index) => {
          if (option.kind === 'gold' || option.kind === 'recruit') candidates.push({ type: 'reward', index });
          else for (const unitId of ids) candidates.push({ type: 'reward', index, unitId });
        });
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

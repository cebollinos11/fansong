import { chooseCommand } from '@fansong/ai';
import {
  advanceCost,
  enemyPoints,
  isFight,
  isWounded,
  legalRunActions,
  mendWound,
  newRun,
  playerWarband,
  recruitPrice,
  restHelps,
  runBattleConfig,
  runStep,
  RUN_TUNING,
  runVictorious,
  shooterForRange,
  unitCost,
  upgradePrice,
  warbandCost,
  type NodeKind,
  type RouteNode,
  type RunAction,
  type RunState,
  type RunUnit,
} from '@fansong/content';
import { getLegalCommands, makeHexGrid, recordReplay, type Command, type GameMode, type GameState, type Unit } from '@fansong/engine';
import { CliError } from './options.js';

/**
 * The run-mode calibration sim (`pnpm play run`): the AI plays the player's
 * seat as well as the enemy's, a greedy picker makes every choice between
 * battles (but for the way up the map, which `--route` sets), and the report
 * says how deep runs get. It is how `RUN_TUNING` is
 * set: an AI-piloted run should usually die around steps 5–8, which a human
 * should beat.
 *
 * The AI never retreats, so by default nobody does and a banner changes
 * nothing. `--retreat losing` has the player's seat give a battle up once it is
 * badly behind (see {@link retreatPilot}), to measure what the banners are worth.
 */

/**
 * Which way up the map the sim's player goes: `safe` takes a stop where there
 * is one and else the weakest enemy, `greedy` the strongest enemy (an elite
 * before anyone), `balanced` the enemy nearest the step's usual strength.
 */
export type RoutePolicy = 'safe' | 'balanced' | 'greedy';
const ROUTE_POLICIES: readonly RoutePolicy[] = ['safe', 'balanced', 'greedy'];

/** When the sim's player retreats: never (as the AI plays), or once the battle is being lost. */
export type RetreatPolicy = 'never' | 'losing';
const RETREAT_POLICIES: readonly RetreatPolicy[] = ['never', 'losing'];

/** `--retreat losing` sounds the retreat when the player's living points fall under this share of the enemy's. */
export const DEFAULT_RETREAT_SHARE = 0.75;

/** Rounds the Leader of a retreating warband waits by the flag for its troops before it leaves without them. */
const RETREAT_WAIT_ROUNDS = 3;

export interface RunSimOptions {
  /** How many runs to play. */
  seeds: number;
  /** Seed of the first run; the rest count up from it. */
  seed: number;
  /** Stop a run that is still alive after this many steps. */
  maxRounds: number;
  route: RoutePolicy;
  retreat: RetreatPolicy;
  /** `--retreat losing`: the share of the enemy's living points under which the retreat is sounded. */
  retreatShare: number;
  /** Print a line per battle. */
  verbose: boolean;
  help: boolean;
}

/** Steps a battle may take before the sim calls it stalled. */
const BATTLE_STEP_CAP = 20_000;

function numberArg(flag: string, value: string | undefined, min: number): number {
  const n = Number(value);
  if (value === undefined || !Number.isInteger(n) || n < min) throw new CliError(`${flag} needs a whole number of at least ${min}`);
  return n;
}

/** Parse the arguments after `run`. Throws {@link CliError} on a malformed flag. */
export function parseRunArgs(argv: string[]): RunSimOptions {
  const opts: RunSimOptions = {
    seeds: 20,
    seed: 1,
    maxRounds: 30,
    route: 'balanced',
    retreat: 'never',
    retreatShare: DEFAULT_RETREAT_SHARE,
    verbose: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seeds') opts.seeds = numberArg(arg, argv[++i], 1);
    else if (arg === '--seed') opts.seed = numberArg(arg, argv[++i], 0);
    else if (arg === '--max-rounds') opts.maxRounds = numberArg(arg, argv[++i], 1);
    else if (arg === '--route') {
      const policy = argv[++i] as RoutePolicy;
      if (!ROUTE_POLICIES.includes(policy)) throw new CliError(`--route needs one of ${ROUTE_POLICIES.join(', ')}`);
      opts.route = policy;
    } else if (arg === '--retreat') {
      const policy = argv[++i] as RetreatPolicy;
      if (!RETREAT_POLICIES.includes(policy)) throw new CliError(`--retreat needs one of ${RETREAT_POLICIES.join(', ')}`);
      opts.retreat = policy;
    } else if (arg === '--retreat-share') {
      const share = Number(argv[++i]);
      if (!(share > 0 && share <= 2)) throw new CliError('--retreat-share needs a number over 0, up to 2');
      opts.retreatShare = share;
    } else if (arg === '--verbose' || arg === '-v') opts.verbose = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new CliError(`Unknown option "${arg}". Try run --help.`);
  }
  return opts;
}

export function runHelpText(): string {
  return `fansong play run — run-mode calibration sim

Plays whole runs with the AI in both seats and a greedy picker choosing every
draft pick, level-up and purchase, then reports how deep the runs got.

Usage: pnpm play run [options]

Options:
  --seeds <n>       Runs to play (default 20)
  --seed <n>        Seed of the first run; the rest count up (default 1)
  --max-rounds <n>  Stop a surviving run after this many steps (default 30)
  --route <which>   The way up the map: safe (stops, and the weakest enemies),
                    balanced (enemies of the usual strength) or greedy (elites,
                    and the strongest enemies) (default balanced)
  --retreat <when>  When the player retreats, banner in hand: never, or losing
                    (its living points under a share of the enemy's; then every
                    unit walks for the flag) (default never)
  --retreat-share <n>  That share, for --retreat losing (default ${DEFAULT_RETREAT_SHARE})
  --verbose, -v     Print a line per battle
  --help, -h        Show this help
`;
}

/** Points mending `u`'s oldest wound would give back. */
function mendGain(u: RunUnit): number {
  const wound = u.wounds?.[0];
  return wound ? unitCost(mendWound(u.unit, wound)) - unitCost(u.unit) : 0;
}

/**
 * What an action is worth in warband points, and what it costs in gold. Gold in
 * hand counts as points one for one, since that is what a recruit costs.
 */
function worth(s: RunState, action: RunAction): { points: number; price: number } {
  const unit = (id: string | undefined) => s.roster.find((u) => u.id === id)!;
  switch (action.type) {
    case 'draftPick':
      return { points: s.offer?.kind === 'draft' ? unitCost(s.offer.units[action.index]!) : 0, price: 0 };
    case 'advance': {
      const advance = s.pending!.find((p) => p.unitId === action.unitId)!.choices[action.index]!;
      return { points: advanceCost(unit(action.unitId).unit, advance), price: 0 };
    }
    case 'reward': {
      // Only what goes to a unit differs between the ways to take a reward.
      let points = 0;
      for (const option of s.offer?.kind === 'reward' ? s.offer.rewards : []) {
        if (option.kind === 'mend') points += mendGain(unit(action.unitId));
        else if (option.kind === 'boost') points += advanceCost(unit(action.unitId).unit, option.advance);
      }
      return { points, price: 0 };
    }
    case 'buyRecruit': {
      const recruit = s.offer?.kind === 'shop' ? s.offer.recruits[action.index]! : undefined;
      return recruit ? { points: unitCost(recruit), price: recruitPrice(recruit) } : { points: 0, price: 0 };
    }
    case 'buyUpgrade': {
      const advance = s.offer?.kind === 'shop' ? s.offer.upgrades[action.index]! : undefined;
      if (!advance) return { points: 0, price: 0 };
      const u = unit(action.unitId).unit;
      return { points: advanceCost(u, advance), price: upgradePrice(u, advance) };
    }
    case 'heal':
      return { points: mendGain(unit(action.unitId)), price: RUN_TUNING.shop.heal };
    // A camp rests if anyone is hurt, and drills if not.
    case 'camp':
      return { points: action.choice === 'rest' ? (restHelps(s) ? 2 : 0) : 1, price: 0 };
    // A training ground takes the costliest unit, which then takes the dearest advance.
    case 'train':
      return { points: unitCost(unit(action.unitId).unit), price: 0 };
    case 'trainPick': {
      const training = s.offer?.kind === 'training' ? s.offer : undefined;
      const advance = training?.choices?.[action.index];
      return { points: advance ? Math.max(1, advanceCost(unit(training!.unitId).unit, advance)) : 0, price: 0 };
    }
    default:
      return { points: 0, price: 0 };
  }
}

/** How dangerous a node looks from the map: a fight's threat, nothing for a stop. */
function danger(node: RouteNode): number {
  return isFight(node.kind) ? (node.threat ?? 1) : 0;
}

/** Which of the open `nodes` a policy travels to. Ties go to the first listed. */
export function routePick(nodes: readonly RouteNode[], policy: RoutePolicy): RouteNode {
  const score = (n: RouteNode) => (policy === 'safe' ? -danger(n) : policy === 'greedy' ? danger(n) : -Math.abs(danger(n) - 1));
  return nodes.reduce((best, n) => (score(n) > score(best) ? n : best));
}

/**
 * How the picker takes a mystery's event, as a preference per choice (the
 * legal one with the highest wins): it hires the sellsword and takes the
 * deserter in, leaves the shrine alone (a trait for a wound is a wash), digs
 * for the cache (two times in three it triples), and raises the standard only
 * if it means to retreat. An ambush is fought, but for a `safe` run that can
 * pay its way past.
 */
function eventPreference(s: RunState, index: number, route: RoutePolicy, retreat: RetreatPolicy): number {
  const event = s.offer?.kind === 'event' ? s.offer.event : undefined;
  const first = index === 0 ? 2 : 1;
  const second = index === 1 ? 2 : 1;
  switch (event) {
    case 'sellsword':
    case 'deserters':
      return first;
    case 'shrine':
      return second;
    case 'cache':
      return second;
    case 'ambush':
      return route === 'safe' ? second : first;
    case 'standard':
      return retreat === 'losing' ? first : second;
    default:
      return 0;
  }
}

/**
 * The greedy picker: of the legal actions, the one worth the most points — in
 * the shop, the most points per gold, buying until nothing worth its price is
 * left. It fields everyone, never rerolls and never sells, and goes up the map
 * as `route` says. At a camp it rests if anyone is hurt and drills if not; at
 * a training ground its costliest unit takes the dearest advance. It buys a
 * retreat banner only when it means to use one (`retreat` `'losing'`) and has
 * none. Deterministic: ties go to the first action listed.
 */
export function autoPick(s: RunState, route: RoutePolicy = 'balanced', retreat: RetreatPolicy = 'never'): RunAction {
  const legal = legalRunActions(s);
  const only = (type: RunAction['type']) => legal.find((a) => a.type === type);
  if (s.phase === 'briefing') return only('startBattle')!;
  if (s.phase === 'map') {
    const open = legal.flatMap((a) => (a.type === 'travel' ? [s.route!.nodes[a.nodeId]!] : []));
    return { type: 'travel', nodeId: routePick(open, route).id };
  }
  if (s.offer?.kind === 'event' && !s.offer.result) {
    const choices = legal.flatMap((a) => (a.type === 'eventChoice' ? [a] : []));
    return choices.reduce((best, a) => (eventPreference(s, a.index, route, retreat) > eventPreference(s, best.index, route, retreat) ? a : best));
  }

  let best: RunAction | undefined;
  let bestScore = 0;
  for (const action of legal) {
    const { points, price } = worth(s, action);
    const score = s.phase === 'shop' ? (price > 0 ? points / price : points > 0 && action.type === 'buyRecruit' ? Infinity : 0) : points;
    if (score > bestScore) [best, bestScore] = [action, score];
  }
  if (best) return best;
  const banner = retreat === 'losing' && s.banners === 0 ? only('buyBanner') : undefined;
  const fallback = banner ?? only('continue') ?? only('leaveShop') ?? only('leaveStop') ?? legal[0];
  if (!fallback) throw new Error(`nothing to do in the ${s.phase} phase`);
  return fallback;
}

/** Point cost of a unit on the field, read back from its engine profile. */
function fieldCost(u: Unit): number {
  return unitCost({ ...u.traits, quality: u.quality, combat: u.combat, shooter: shooterForRange(u.traits.ranged) });
}

const livingPoints = (state: GameState, owner: 0 | 1): number =>
  state.units.reduce((sum, u) => (u.owner === owner && !u.dead ? sum + fieldCost(u) : sum), 0);

/**
 * The player's seat for `--retreat losing`: the AI, until its side's living
 * points fall under `share` of the enemy's. Then its Leader sounds the retreat
 * the next time it acts (it is activated first, on all its dice, to do so),
 * and from there every unit only walks for the flag: the troops first, and the
 * Leader onto it once they are off, down, or {@link RETREAT_WAIT_ROUNDS} rounds
 * have gone by. One pilot plays one battle. Deterministic.
 */
export function retreatPilot(share: number = DEFAULT_RETREAT_SHARE): (state: GameState) => Command {
  let calledIn: number | null = null;
  return (state) => {
    if (state.active !== 0) return chooseCommand(state);
    const legal = getLegalCommands(state);
    const called = state.retreat?.owner === 0;
    const losing = livingPoints(state, 0) < share * livingPoints(state, 1);
    const leader = state.units.find((u) => u.owner === 0 && u.traits.leader && !u.dead);

    if (!called) {
      if (!losing || !state.retreatZones || !leader) return chooseCommand(state);
      const call = legal.find((c) => c.type === 'Retreat');
      if (call) {
        calledIn = state.round;
        return call;
      }
      // Get the Leader acting, on every die it may roll, so it can call.
      const rouse = legal.filter((c) => c.type === 'ChooseActivation' && c.unitId === leader.id && !c.group && !c.spell).at(-1);
      return state.phase === 'awaitingActivation' && rouse ? rouse : chooseCommand(state);
    }

    const solo = legal.filter((c) => c.type === 'ChooseActivation' && !c.group && !c.spell);
    if (state.phase === 'awaitingActivation') {
      // Troops go first, the Leader last; each on all the dice it may roll.
      const troop = solo.filter((c) => c.type === 'ChooseActivation' && c.unitId !== leader?.id);
      const unitId = (troop.at(-1) ?? solo.at(-1) ?? legal[0]!) as Extract<Command, { type: 'ChooseActivation' }>;
      return solo.filter((c) => c.type === 'ChooseActivation' && c.unitId === unitId.unitId).at(-1) ?? legal[0]!;
    }

    const unit = state.units.find((u) => u.id === state.activeUnitId);
    const flag = state.retreat!.hex;
    if (!unit) return chooseCommand(state);
    const board = makeHexGrid(state.board);
    // The Leader holds off stepping onto the flag while a troop on its feet could still make it.
    const waiting =
      unit.traits.leader &&
      state.round < (calledIn ?? state.round) + RETREAT_WAIT_ROUNDS &&
      state.units.some((u) => u.owner === 0 && !u.dead && u.id !== unit.id);
    let best: Command = { type: 'EndActivation' };
    let gap = board.distance(unit.pos, flag);
    for (const c of legal) {
      if (c.type !== 'Move') continue;
      const d = board.distance(c.to, flag);
      if (d < gap && !(waiting && d === 0)) [best, gap] = [c, d];
    }
    return best;
  };
}

/** One battle of a simulated run. */
export interface BattleStat {
  /** The step it was fought at. */
  round: number;
  /** The kind of node it was fought at. */
  node: NodeKind;
  mode: GameMode;
  enemy: string;
  boss: boolean;
  won: boolean;
  playerUnits: number;
  playerPoints: number;
  enemyUnits: number;
  enemyPoints: number;
  /** The battle's threat: the enemy's cost over the step's budget. */
  threat: number;
  /** What the battle paid, or would have, in gold's worth. */
  reward: number;
  /** Lasting wounds the fielded units carried in. */
  wounds: number;
  /** Lost, but by a retreat that spent a banner: the run went on. */
  retreated: boolean;
  /** After a retreat: units that left by the flag, units left behind on the field, and how many of those died of it. */
  gotAway: number;
  leftBehind: number;
  leftDead: number;
}

export interface RunResult {
  seed: number;
  /** Battles won. */
  wins: number;
  /** How the run ended: lost a battle, hit the step cap still alive, or a battle never finished. */
  end: 'lost' | 'capped' | 'stalled';
  battles: BattleStat[];
  /** The kind of every node travelled to, in order. */
  visits: NodeKind[];
  final: RunState;
}

/**
 * Play one whole run with the AI in both seats and {@link autoPick} choosing.
 * With `retreat` `'losing'` the player's seat is a {@link retreatPilot} instead.
 */
export function simulateRun(
  seed: number,
  maxRounds: number,
  route: RoutePolicy = 'balanced',
  retreat: RetreatPolicy = 'never',
  retreatShare: number = DEFAULT_RETREAT_SHARE,
): RunResult {
  let s = newRun(seed);
  const battles: BattleStat[] = [];
  const visits: NodeKind[] = [];
  let end: RunResult['end'] = 'capped';
  for (let step = 0; s.round <= maxRounds; step++) {
    if (step > 100_000) throw new Error(`run ${seed} never ends`);
    if (s.phase === 'over') {
      end = 'lost';
      break;
    }
    if (s.phase !== 'battle') {
      const action = autoPick(s, route, retreat);
      if (action.type === 'travel') visits.push(s.route!.nodes[action.nodeId]!.kind);
      s = runStep(s, action);
      continue;
    }
    const battle = s.battle!;
    const node = s.route!.nodes[s.route!.going!]!.kind;
    const fielded = playerWarband(s);
    const replay = recordReplay(runBattleConfig(s), retreat === 'losing' ? retreatPilot(retreatShare) : chooseCommand, BATTLE_STEP_CAP);
    if (replay.commands.length >= BATTLE_STEP_CAP) {
      end = 'stalled';
      break;
    }
    const round = s.round;
    const wounds = s.roster.filter((u) => battle.fielded!.includes(u.id) && isWounded(u)).length;
    s = runStep(s, { type: 'battleResult', replay });
    const logged = s.log.at(-1)!;
    const fates = logged.retreated ? (s.aftermath?.units ?? []) : [];
    const behind = fates.filter((l) => l.fate === 'leftBehind');
    battles.push({
      round,
      node,
      mode: battle.mode,
      enemy: battle.enemy.name,
      boss: battle.enemyKing !== undefined,
      won: logged.won,
      playerUnits: fielded.units.length,
      playerPoints: warbandCost(fielded),
      enemyUnits: battle.enemy.units.length,
      enemyPoints: warbandCost(battle.enemy),
      threat: battle.threat,
      reward: battle.rewardValue,
      wounds,
      retreated: logged.retreated === true,
      gotAway: fates.filter((l) => l.fate === 'retreated').length,
      leftBehind: behind.length,
      leftDead: behind.filter((l) => l.injury === 'dead').length,
    });
  }
  return { seed, wins: battles.filter((b) => b.won).length, end, battles, visits, final: s };
}

/** One line for a battle, for `--verbose`. */
export function battleLine(seed: number, b: BattleStat): string {
  const versus = `${b.playerUnits}u/${b.playerPoints}pt vs ${b.enemyUnits}u/${b.enemyPoints}pt`;
  const result = b.won ? 'WON ' : b.retreated ? 'FLED' : 'LOST';
  const flight = b.retreated ? ` · ${b.gotAway} got away, ${b.leftBehind} left behind (${b.leftDead} died)` : '';
  const kind = b.node === 'battle' || b.node === 'boss' ? '' : ` (${b.node})`;
  return `seed ${seed} step ${String(b.round).padStart(2)} ${result} ${versus.padEnd(26)} ${b.mode}${b.boss ? ' (boss)' : ''}${kind} · ${b.enemy}${flight}`;
}

const pct = (n: number, of: number) => (of === 0 ? '  -' : `${Math.round((100 * n) / of)}%`.padStart(4));
const mean = (xs: number[]) => (xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The report: how deep the runs got, and how each step, node kind and mode went. */
export function summarize(results: RunResult[]): string {
  const lines: string[] = [];
  // The step a run died at, or stood at when the cap stopped it.
  const depth = results.map((r) => r.final.round).sort((a, b) => a - b);
  const lost = results.filter((r) => r.end === 'lost');
  const bossEvery = RUN_TUNING.enemy.bossEvery;
  lines.push(`${results.length} runs · reached step: mean ${mean(depth).toFixed(1)}, median ${depth[Math.floor(depth.length / 2)]}, best ${depth.at(-1)}`);
  lines.push(
    `ended: ${lost.length} lost, ${results.filter((r) => r.end === 'capped').length} still alive at the cap, ${results.filter((r) => r.end === 'stalled').length} stalled · ` +
      `beat the first boss (step ${bossEvery}): ${pct(results.filter((r) => r.battles.some((b) => b.won && b.round === bossEvery)).length, results.length).trim()} · ` +
      `beat step ${RUN_TUNING.victoryRound}: ${pct(results.filter((r) => runVictorious(r.final)).length, results.length).trim()}`,
  );

  const battles = results.flatMap((r) => r.battles);
  lines.push(`battles: ${battles.length} fought, ${pct(battles.filter((b) => b.won).length, battles.length).trim()} won`);
  const visits = results.flatMap((r) => r.visits);
  const kinds = [...new Set(visits)].sort();
  lines.push(`visits a run: ${kinds.map((k) => `${k} ${(visits.filter((v) => v === k).length / results.length).toFixed(1)}`).join(', ')}`);
  // Only said when somebody retreated, so a sim in which nobody does reads as it always has.
  const retreats = battles.filter((b) => b.retreated);
  if (retreats.length > 0) {
    const saved = results.filter((r) => r.battles.some((b) => b.retreated));
    const further = saved.filter((r) => r.battles.some((b) => b.won && b.round >= Math.min(...r.battles.filter((x) => x.retreated).map((x) => x.round))));
    const sum = (key: 'gotAway' | 'leftBehind' | 'leftDead') => retreats.reduce((n, b) => n + b[key], 0);
    lines.push(
      `retreats: ${retreats.length} in ${saved.length} runs (${pct(saved.length, results.length).trim()}); ${further.length} of those runs then won the round they fled · ` +
        `${sum('gotAway')} units got away, ${sum('leftBehind')} were left behind, ${sum('leftDead')} of them died`,
    );
  }
  const last = Math.max(0, ...battles.map((b) => b.round));
  lines.push('', ' step  fought   won  died here  player pts  enemy pts (budget)  threat  reward  units');
  for (let round = 1; round <= last; round++) {
    const here = battles.filter((b) => b.round === round);
    if (here.length === 0) continue;
    const won = here.filter((b) => b.won).length;
    // A battle lost is a run ended, unless it was retreated from.
    const died = here.filter((b) => !b.won && !b.retreated).length;
    lines.push(
      [
        String(round).padStart(5),
        String(here.length).padStart(7),
        pct(won, here.length).padStart(5),
        pct(died, results.length).padStart(10),
        mean(here.map((b) => b.playerPoints)).toFixed(0).padStart(11),
        `${mean(here.map((b) => b.enemyPoints)).toFixed(0)} (${enemyPoints(round)})`.padStart(19),
        mean(here.map((b) => b.threat)).toFixed(2).padStart(7),
        mean(here.map((b) => b.reward)).toFixed(0).padStart(7),
        `${mean(here.map((b) => b.playerUnits)).toFixed(1)} v ${mean(here.map((b) => b.enemyUnits)).toFixed(1)}`.padStart(11),
      ].join(' '),
    );
  }

  const by = (title: string, key: (b: BattleStat) => string) => {
    lines.push('', `${title.padEnd(20)} fought   won`);
    const keys = [...new Set(battles.map(key))].sort();
    for (const k of keys) {
      const here = battles.filter((b) => key(b) === k);
      lines.push(`${k.padEnd(20)} ${String(here.length).padStart(6)} ${pct(here.filter((b) => b.won).length, here.length).padStart(5)}`);
    }
  };
  by('node', (b) => b.node);
  by('mode', (b) => b.mode);
  by('enemy', (b) => b.enemy);
  return lines.join('\n');
}

/** The `run` subcommand. Returns the process exit code. */
export function runSimMain(argv: string[], print: (line: string) => void = console.log): number {
  const opts = parseRunArgs(argv);
  if (opts.help) {
    print(runHelpText());
    return 0;
  }
  const started = Date.now();
  const results: RunResult[] = [];
  for (let i = 0; i < opts.seeds; i++) {
    const result = simulateRun(opts.seed + i, opts.maxRounds, opts.route, opts.retreat, opts.retreatShare);
    results.push(result);
    if (opts.verbose) for (const b of result.battles) print(battleLine(result.seed, b));
  }
  print(summarize(results));
  print(`\n${((Date.now() - started) / 1000).toFixed(1)}s`);
  return results.some((r) => r.end === 'stalled') ? 1 : 0;
}

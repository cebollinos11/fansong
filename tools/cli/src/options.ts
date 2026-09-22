import {
  buildMatch,
  DEFAULT_BOARD,
  getMap,
  getPreset,
  listMaps,
  PRESET_IDS,
  PRESETS,
  supportedModes,
  validateWarband,
  warbandCost,
  type MapDef,
  type Warband,
} from '@fansong/content';
import { createDemoGame, createGame, GAME_MODES, type GameMode, type GameState } from '@fansong/engine';

/** A bad command line: the message is shown to the user and the CLI exits with code 2. */
export class CliError extends Error {}

export interface Options {
  seed: number;
  maxSteps: number;
  quiet: boolean;
  p0: string | null;
  p1: string | null;
  /** Built-in map id (`--map`); null = the legacy flat board. */
  map: string | null;
  /** Game mode (`--mode`); null = annihilation. */
  mode: GameMode | null;
  list: boolean;
  help: boolean;
}

/** Preset fielded by a side the command line leaves unspecified in a warband match. */
const FALLBACK_PRESET = 'free-company';

function isGameMode(s: string): s is GameMode {
  return (GAME_MODES as readonly string[]).includes(s);
}

function numberArg(flag: string, value: string | undefined): number {
  const n = Number(value);
  if (value === undefined || !Number.isFinite(n)) throw new CliError(`${flag} needs a number`);
  return n;
}

/** Parse argv (without node/script). Throws {@link CliError} on a malformed flag. */
export function parseArgs(argv: string[]): Options {
  const opts: Options = {
    seed: 42,
    maxSteps: 5000,
    quiet: false,
    p0: null,
    p1: null,
    map: null,
    mode: null,
    list: false,
    help: false,
  };
  const value = (i: number, flag: string): string => {
    const v = argv[i];
    if (v === undefined || v.startsWith('--')) throw new CliError(`${flag} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--seed') opts.seed = numberArg(arg, argv[++i]);
    else if (arg === '--max-steps') opts.maxSteps = numberArg(arg, argv[++i]);
    else if (arg === '--quiet' || arg === '-q') opts.quiet = true;
    else if (arg === '--p0') opts.p0 = value(++i, arg);
    else if (arg === '--p1') opts.p1 = value(++i, arg);
    else if (arg === '--map') opts.map = value(++i, arg);
    else if (arg === '--mode') {
      const mode = value(++i, arg);
      if (!isGameMode(mode)) throw new CliError(`Unknown mode "${mode}". Known: ${GAME_MODES.join(', ')}`);
      opts.mode = mode;
    } else if (arg === '--list') opts.list = true;
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new CliError(`Unknown option "${arg}". Try --help.`);
  }
  return opts;
}

export function helpText(): string {
  return `fansong play — headless AI-vs-AI runner

Usage: pnpm play [options]

Options:
  --seed <n>       RNG seed (default 42)
  --p0 <preset>    Warband for player 0 (default: built-in demo)
  --p1 <preset>    Warband for player 1 (default: built-in demo)
  --map <id>       Built-in map to play on (default: flat ${DEFAULT_BOARD.width}×${DEFAULT_BOARD.height} board)
  --mode <mode>    Game mode (default annihilation); must be supported by the map
  --list           List preset warbands, maps and modes, then exit
  --max-steps <n>  Safety cap on reduce steps (default 5000)
  --quiet, -q      Only print setup and final result
  --help, -h       Show this help

With --map or --mode, an unspecified side fields "${FALLBACK_PRESET}".

Presets: ${PRESET_IDS.join(', ')}
Maps:    ${listMaps().map((m) => m.id).join(', ')}
Modes:   ${GAME_MODES.join(', ')}
`;
}

/** The `--list` output: presets, built-in maps (size + supported modes), and modes. */
export function listText(): string {
  const lines = ['Preset warbands:', ''];
  for (const id of PRESET_IDS) {
    const wb = PRESETS[id]!;
    lines.push(`  ${id.padEnd(18)} ${wb.name}  (${warbandCost(wb)} pts, ${wb.units.length} units)`);
  }
  lines.push('', 'Maps:', '');
  for (const map of listMaps()) {
    const size = `${map.width}×${map.height}`;
    lines.push(`  ${map.id.padEnd(18)} ${map.name.padEnd(16)} ${size.padEnd(6)} ${supportedModes(map).join(', ')}`);
  }
  lines.push('', `Modes: ${GAME_MODES.join(', ')}`);
  return lines.join('\n');
}

/** Resolve a preset id to a legal warband, or throw a helpful {@link CliError}. */
function requirePreset(id: string): Warband {
  const wb = getPreset(id);
  if (!wb) throw new CliError(`Unknown preset "${id}". Try --list. Known: ${PRESET_IDS.join(', ')}`);
  const check = validateWarband(wb);
  if (!check.ok) throw new CliError(`Preset "${id}" is illegal: ${check.errors.join('; ')}`);
  return wb;
}

function requireMap(id: string): MapDef {
  const map = getMap(id);
  if (!map)
    throw new CliError(`Unknown map "${id}". Try --list. Known: ${listMaps().map((m) => m.id).join(', ')}`);
  return map;
}

/**
 * Check `mode` can be played on `map` (or on the flat board when no map is given),
 * suggesting maps that host it otherwise.
 */
function checkMode(mode: GameMode, map: MapDef | null): void {
  const ok = map ? supportedModes(map).includes(mode) : mode === 'annihilation' || mode === 'kill-the-king';
  if (ok) return;
  const hosts = listMaps()
    .filter((m) => supportedModes(m).includes(mode))
    .map((m) => m.id);
  const where = map ? `map "${map.id}"` : 'the default board (pass --map)';
  throw new CliError(`Mode "${mode}" is not supported on ${where}. Maps that support it: ${hosts.join(', ') || 'none'}`);
}

/**
 * Build the starting state the options describe. Presets, a map or a mode make a
 * warband match (missing sides field {@link FALLBACK_PRESET}); none of them runs
 * the built-in demo. Throws {@link CliError} on an unknown preset/map or an
 * unsupported mode.
 */
export function setupMatch(opts: Options): { state: GameState; label: string } {
  if (!opts.p0 && !opts.p1 && opts.map === null && opts.mode === null)
    return { state: createDemoGame(opts.seed), label: 'demo warbands' };

  const w0 = requirePreset(opts.p0 ?? FALLBACK_PRESET);
  const w1 = requirePreset(opts.p1 ?? FALLBACK_PRESET);
  const map = opts.map === null ? null : requireMap(opts.map);
  const mode = opts.mode ?? 'annihilation';
  checkMode(mode, map);
  // Annihilation passes no mode, so its config is byte-identical to the pre-mode CLI.
  const modeOpt = mode === 'annihilation' ? {} : { mode };
  const config = map
    ? buildMatch(w0, w1, { seed: opts.seed, map, ...modeOpt })
    : buildMatch(w0, w1, { seed: opts.seed, board: DEFAULT_BOARD, ...modeOpt });

  let label = `${w0.name} (P0) vs ${w1.name} (P1)`;
  if (map) label += ` on ${map.name}`;
  if (mode !== 'annihilation') label += ` · ${mode}`;
  return { state: createGame(config), label };
}

/** The closing result line, with the score in the points modes (hill, conquest). */
export function resultLine(state: GameState, steps: number, maxSteps: number): string {
  if (state.phase !== 'gameOver')
    return `Result: no winner within ${maxSteps} steps (stopped at round ${state.round}).`;
  const m = state.mode;
  const points = m && (m.mode === 'king-of-the-hill' || m.mode === 'conquest');
  const score = points ? `, score ${m.scores[0]}–${m.scores[1]}` : '';
  return `Result: P${state.winner} wins after ${state.round} round(s), ${steps} steps${score}.`;
}

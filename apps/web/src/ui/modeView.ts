import {
  flagAtBase,
  gameMode,
  pigOf,
  roundLimitOf,
  scoringZones,
  targetScoreOf,
  unitById,
  zoneController,
  type GameState,
  type Owner,
  type Vec,
} from '@fansong/engine';
import { zoneTallies, type ZoneTally } from '../game/roundScoring.js';
import type { BoardMarker, HexOverlay, UnitBadge, ZoneScore } from '../three/BoardView.js';
import { CONQUEST_LABELS, MODE_LABELS, ZONE_COLORS } from './editorView.js';
import { COLOR_NAMES, sideDoes, sideName, sidePossessive, type SideNames } from './sides.js';

// Pure game-mode presentation (no DOM): the HUD's mode panel and the board's
// objective overlays, flag markers and unit badges, so it can be unit-tested.

export interface ModeHud {
  label: string;
  /** How the mode is won, e.g. "First to 5 points · ends after round 12". */
  goal: string;
  /** Player 0's and player 1's score, in the modes played for points; else null. */
  scores: [number, number] | null;
  /** Status lines: Kings, zone holders, where each flag is, how the Pig fares. */
  lines: string[];
}

const GOALS = {
  'kill-the-king': 'Kill the enemy King',
  'capture-the-flag': 'Carry the enemy flag to your base',
  'golden-pig': 'Get the golden Pig into the enemy camp',
} as const;

const holderText = (names: SideNames, holder: Owner | undefined): string =>
  holder === undefined ? '—' : sideName(names, holder, true);

/** " · ends after round N" when the game has a round limit, else "". */
const limitText = (state: GameState): string => {
  const limit = roundLimitOf(state);
  return limit === undefined ? '' : ` · ends after round ${limit}`;
};

/**
 * The HUD's mode panel, or null in annihilation without a round limit (which
 * shows no panel). `names` are what the top bar calls the sides.
 */
export function modeHud(state: GameState, names: SideNames = COLOR_NAMES): ModeHud | null {
  const m = state.mode;
  if (!m) {
    if (roundLimitOf(state) === undefined) return null;
    return { label: MODE_LABELS.annihilation, goal: `Destroy the enemy warband${limitText(state)}`, scores: null, lines: [] };
  }
  const label = MODE_LABELS[m.mode];
  const lines: string[] = [];

  if (m.mode === 'kill-the-king') {
    m.kings?.forEach((id, p) => {
      const king = unitById(state, id);
      if (king) lines.push(`${sidePossessive(names, p as Owner, true)} King: ${king.name}${king.dead ? ' (fallen)' : king.knockedDown ? ' (knocked down)' : ''}`);
    });
    return { label, goal: GOALS[m.mode] + limitText(state), scores: null, lines };
  }

  if (m.mode === 'capture-the-flag') {
    m.flags?.forEach((flag, p) => {
      const carrier = flag.carrier ? unitById(state, flag.carrier) : undefined;
      const where = carrier
        ? `carried by ${carrier.name} (${sideName(names, carrier.owner, true)})`
        : flagAtBase(state, p as Owner)
          ? 'at base'
          : `dropped at (${flag.at.x}, ${flag.at.y})`;
      lines.push(`${sidePossessive(names, p as Owner, true)} flag: ${where}`);
    });
    return { label, goal: GOALS[m.mode] + limitText(state), scores: null, lines };
  }

  if (m.mode === 'golden-pig') {
    const pig = m.pig ? unitById(state, m.pig.unitId) : undefined;
    if (m.pig && pig) {
      lines.push(`${sideDoes(names, m.pig.escort, 'escorts', true)} the Pig${pig.dead ? ' (fallen)' : pig.knockedDown ? ' (knocked down)' : ''}`);
      lines.push(`${sideDoes(names, m.pig.escort === 0 ? 1 : 0, 'wins', true)} by killing it, or when time runs out`);
    }
    return { label, goal: GOALS[m.mode] + limitText(state), scores: null, lines };
  }

  const zones = scoringZones(state);
  if (m.mode === 'king-of-the-hill') {
    if (zones[0]) lines.push(`Hill: ${holderText(names, zoneController(state, zones[0]))}`);
  } else {
    lines.push(zones.map((z, i) => `${CONQUEST_LABELS[i]}: ${holderText(names, zoneController(state, z))}`).join(' · '));
  }
  const goal = `First to ${targetScoreOf(state)} points${limitText(state)}`;
  return { label, goal, scores: [m.scores[0], m.scores[1]], lines };
}

/** What a scoring zone is called on screen: "The hill", or "Zone A" / "B" / "C". */
export function zoneName(state: GameState, zone: number): string {
  return state.mode?.mode === 'king-of-the-hill' ? 'The hill' : `Zone ${CONQUEST_LABELS[zone] ?? zone + 1}`;
}

/**
 * The words for one zone's turn in the end-of-round scoring: who takes the
 * point and the count that decided it, or why nobody does. `names` are the two
 * seats' labels ("You", "AI", an army's name).
 */
export function zoneScore(state: GameState, tally: ZoneTally, names: readonly [string, string]): ZoneScore {
  const [a, b] = tally.counts;
  const base = { name: zoneName(state, tally.zone), cells: tally.cells, counts: tally.counts };
  if (tally.holder !== undefined) {
    return { ...base, owner: tally.holder, headline: `+${tally.points} ${names[tally.holder]}`, reason: 'more units standing in it' };
  }
  return a === 0 && b === 0
    ? { ...base, owner: null, headline: 'No points', reason: 'nobody standing in it' }
    : { ...base, owner: null, headline: 'No points', reason: 'contested: equal numbers standing in it' };
}

/**
 * Objective zones tinted on the board: the hill, or conquest zones A/B/C, each
 * rimmed in its holder's colour while one side has more units standing in it;
 * flag bases as faint small hexes; the golden Pig's goal in gold.
 */
export function modeOverlays(state: GameState): HexOverlay[] {
  const m = state.mode;
  if (!m) return [];
  const out: HexOverlay[] = [];
  // Under the zones' own tint, so it shows as a rim around each hex.
  for (const tally of zoneTallies(state)) {
    if (tally.holder === undefined) continue;
    out.push({ cells: tally.cells.slice(), color: ZONE_COLORS.deploy[tally.holder]!, opacity: 0.6, scale: 0.98 });
  }
  if (m.mode === 'king-of-the-hill' && m.objectives.hill) {
    out.push({ cells: m.objectives.hill.slice(), color: ZONE_COLORS.hill, opacity: 0.35, scale: 0.8 });
  }
  if (m.mode === 'conquest') {
    m.objectives.conquest?.forEach((zone, i) =>
      out.push({ cells: zone.slice(), color: ZONE_COLORS.conquest[i]!, opacity: 0.4, scale: 0.8 }),
    );
  }
  if (m.objectives.extraction) {
    out.push({ cells: m.objectives.extraction.slice(), color: PIG_GOAL_COLOR, opacity: 0.35, scale: 0.8 });
  }
  m.objectives.flags?.forEach((base, p) =>
    out.push({ cells: [base], color: ZONE_COLORS.deploy[p]!, opacity: 0.45, scale: 0.5 }),
  );
  return out;
}

/** The tint of the golden Pig's goal zone. */
export const PIG_GOAL_COLOR = 0xffd700;

/** Flags lying on a hex (at base or dropped); a carried flag is a badge on its carrier instead. */
export function modeMarkers(state: GameState): BoardMarker[] {
  const flags = state.mode?.flags;
  if (!flags) return [];
  const out: BoardMarker[] = [];
  flags.forEach((flag, p) => {
    if (flag.carrier === null) out.push({ kind: 'flag', owner: p as Owner, cell: { ...flag.at } });
  });
  return out;
}

/**
 * Unit badges: a crown over each living King and the living golden Pig, a flag over each carrier (the
 * flag's owner colour), and — regardless of game mode — a shield over any
 * living unit currently holding a Guard stance. The ring already tints for
 * selection/attack-target state and can't be trusted to show Guard on its own
 * (a unit flagged as an attack target loses its guard-coloured ring), so the
 * badge is the one indicator that survives every other highlight. King and
 * flag take the slot first on the rare unit that is also guarding — one badge
 * per unit — since those mark the objective itself. Last in line, a star marks
 * a unit inspired by a Leader's war cry.
 */
export function unitBadges(state: GameState): Record<string, UnitBadge> {
  const m = state.mode;
  const out: Record<string, UnitBadge> = {};
  m?.kings?.forEach((id) => {
    if (unitById(state, id)?.dead === false) out[id] = 'crown';
  });
  const pig = pigOf(state);
  if (pig && unitById(state, pig.unitId)?.dead === false) out[pig.unitId] = 'crown';
  m?.flags?.forEach((flag, p) => {
    if (flag.carrier) out[flag.carrier] = p === 0 ? 'flag-0' : 'flag-1';
  });
  for (const u of state.units) {
    if (u.guarding && !u.dead && !out[u.id]) out[u.id] = 'guard';
  }
  for (const u of state.units) {
    if (u.inspired && !u.dead && !out[u.id]) out[u.id] = 'inspired';
  }
  return out;
}

/**
 * A string that changes exactly when the mode's board markings do, so the
 * board redraws overlays and markers only then (the state is cloned per
 * command). Guarding and inspired units feed their badges in every mode, not
 * just this one's own objectives, so their ids are folded in regardless of
 * `state.mode`.
 */
export function modeMarkingsKey(state: GameState): string {
  const m = state.mode;
  const guards = state.units
    .filter((u) => u.guarding && !u.dead)
    .map((u) => u.id)
    .join(',');
  const inspired = state.units
    .filter((u) => u.inspired && !u.dead)
    .map((u) => u.id)
    .join(',');
  if (!m) return `${gameMode(state)};${guards};${inspired}`;
  const cell = (v: Vec) => `${v.x},${v.y}`;
  const flags = m.flags?.map((f) => `${cell(f.at)}:${f.carrier ?? ''}`).join('|') ?? '';
  const kings = m.kings?.map((id) => `${id}:${unitById(state, id)?.dead ? 1 : 0}`).join('|') ?? '';
  const holders = zoneTallies(state).map((z) => z.holder ?? '-').join('');
  // Appended only in its own mode, so the other modes' keys are unchanged.
  const pig = m.pig ? `;pig:${m.pig.unitId}:${unitById(state, m.pig.unitId)?.dead ? 1 : 0}` : '';
  return `${m.mode};${flags};${kings};${holders};${guards};${inspired}${pig}`;
}

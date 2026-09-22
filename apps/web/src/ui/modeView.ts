import {
  flagAtBase,
  gameMode,
  MODE_RULES,
  scoringZones,
  unitById,
  zoneController,
  type GameState,
  type Owner,
  type Vec,
} from '@fansong/engine';
import type { BoardMarker, HexOverlay, UnitBadge } from '../three/BoardView.js';
import { CONQUEST_LABELS, MODE_LABELS, ZONE_COLORS } from './editorView.js';

// Pure game-mode presentation (no DOM): the HUD's mode panel and the board's
// objective overlays, flag markers and unit badges, so it can be unit-tested.

export interface ModeHud {
  label: string;
  /** How the mode is won, e.g. "First to 5 points · ends after round 12". */
  goal: string;
  /** Player 0's and player 1's score, in the modes played for points; else null. */
  scores: [number, number] | null;
  /** Status lines: Kings, zone holders, where each flag is. */
  lines: string[];
}

const GOALS = {
  'kill-the-king': 'Kill the enemy King',
  'capture-the-flag': 'Carry the enemy flag to your base',
} as const;

const holderText = (holder: Owner | undefined): string => (holder === undefined ? '—' : `P${holder}`);

/** The HUD's mode panel, or null in annihilation (which shows no panel). */
export function modeHud(state: GameState): ModeHud | null {
  const m = state.mode;
  if (!m) return null;
  const rules = MODE_RULES[m.mode];
  const label = MODE_LABELS[m.mode];
  const lines: string[] = [];

  if (m.mode === 'kill-the-king') {
    m.kings?.forEach((id, p) => {
      const king = unitById(state, id);
      if (king) lines.push(`P${p} King: ${king.name}${king.dead ? ' (fallen)' : king.knockedDown ? ' (knocked down)' : ''}`);
    });
    return { label, goal: GOALS[m.mode], scores: null, lines };
  }

  if (m.mode === 'capture-the-flag') {
    m.flags?.forEach((flag, p) => {
      const carrier = flag.carrier ? unitById(state, flag.carrier) : undefined;
      const where = carrier
        ? `carried by ${carrier.name} (P${carrier.owner})`
        : flagAtBase(state, p as Owner)
          ? 'at base'
          : `dropped at (${flag.at.x}, ${flag.at.y})`;
      lines.push(`P${p} flag: ${where}`);
    });
    return { label, goal: GOALS[m.mode], scores: null, lines };
  }

  const zones = scoringZones(state);
  if (m.mode === 'king-of-the-hill') {
    if (zones[0]) lines.push(`Hill: ${holderText(zoneController(state, zones[0]))}`);
  } else {
    lines.push(zones.map((z, i) => `${CONQUEST_LABELS[i]}: ${holderText(zoneController(state, z))}`).join(' · '));
  }
  const goal = `First to ${rules.targetScore} points · ends after round ${rules.roundLimit}`;
  return { label, goal, scores: [m.scores[0], m.scores[1]], lines };
}

/** Objective zones tinted on the board: the hill, or conquest zones A/B/C; flag bases as faint small hexes. */
export function modeOverlays(state: GameState): HexOverlay[] {
  const m = state.mode;
  if (!m) return [];
  const out: HexOverlay[] = [];
  if (m.mode === 'king-of-the-hill' && m.objectives.hill) {
    out.push({ cells: m.objectives.hill.slice(), color: ZONE_COLORS.hill, opacity: 0.35, scale: 0.8 });
  }
  if (m.mode === 'conquest') {
    m.objectives.conquest?.forEach((zone, i) =>
      out.push({ cells: zone.slice(), color: ZONE_COLORS.conquest[i]!, opacity: 0.4, scale: 0.8 }),
    );
  }
  m.objectives.flags?.forEach((base, p) =>
    out.push({ cells: [base], color: ZONE_COLORS.deploy[p]!, opacity: 0.45, scale: 0.5 }),
  );
  return out;
}

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

/** Unit badges: a crown over each living King, a flag over each carrier (the flag's owner colour). */
export function unitBadges(state: GameState): Record<string, UnitBadge> {
  const m = state.mode;
  const out: Record<string, UnitBadge> = {};
  m?.kings?.forEach((id) => {
    if (unitById(state, id)?.dead === false) out[id] = 'crown';
  });
  m?.flags?.forEach((flag, p) => {
    if (flag.carrier) out[flag.carrier] = p === 0 ? 'flag-0' : 'flag-1';
  });
  return out;
}

/**
 * A string that changes exactly when the mode's board markings do, so the
 * board redraws overlays and markers only then (the state is cloned per command).
 */
export function modeMarkingsKey(state: GameState): string {
  const m = state.mode;
  if (!m) return gameMode(state);
  const cell = (v: Vec) => `${v.x},${v.y}`;
  const flags = m.flags?.map((f) => `${cell(f.at)}:${f.carrier ?? ''}`).join('|') ?? '';
  const kings = m.kings?.map((id) => `${id}:${unitById(state, id)?.dead ? 1 : 0}`).join('|') ?? '';
  return `${m.mode};${flags};${kings}`;
}

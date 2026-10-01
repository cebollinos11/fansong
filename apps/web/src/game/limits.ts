import { LIMIT_RANGE, MODE_RULES, type GameLimits, type GameMode } from '@fansong/engine';

/** Custom limits remembered per game mode (setup screen prefs, the online host's picks). */
export type LimitsByMode = Partial<Record<GameMode, GameLimits>>;

const inRange = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= LIMIT_RANGE.min && n <= LIMIT_RANGE.max;

/**
 * `limits` as `mode` can use them: out-of-range values dropped, and a target score
 * dropped in modes that don't score points. `undefined` when nothing custom is left.
 */
export function limitsForMode(mode: GameMode, limits: unknown): GameLimits | undefined {
  if (typeof limits !== 'object' || limits === null) return undefined;
  const r = limits as Record<string, unknown>;
  const out: GameLimits = {};
  if (r.roundLimit === null || inRange(r.roundLimit)) out.roundLimit = r.roundLimit;
  if (inRange(r.targetScore) && MODE_RULES[mode].targetScore !== undefined) out.targetScore = r.targetScore;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Untrusted stored per-mode limits, keeping only what parses. */
export function parseLimitsByMode(raw: unknown): LimitsByMode {
  const out: LimitsByMode = {};
  if (typeof raw !== 'object' || raw === null) return out;
  for (const [mode, limits] of Object.entries(raw)) {
    if (!(mode in MODE_RULES)) continue;
    const clean = limitsForMode(mode as GameMode, limits);
    if (clean) out[mode as GameMode] = clean;
  }
  return out;
}

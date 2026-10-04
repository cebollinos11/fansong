import { SFX_CUES, type SfxName } from './sfxCues.js';

/**
 * Which sound cues are switched off. The game ships with {@link DISABLED_SFX}
 * off; the dev cue panel (`?dev=1`, in a game) can switch any cue on or off
 * on top of that, remembered per browser, and export the result to be made
 * the new shipped defaults.
 */

/** Cues the game ships switched off. */
export const DISABLED_SFX: readonly SfxName[] = [];

/** The panel's switches that differ from the shipped defaults: cue name -> on. */
export type CueOverrides = Record<string, boolean>;

/** Whether `name` plays, given the panel's overrides. */
export function cueEnabled(name: string, overrides: CueOverrides, defaults: readonly string[] = DISABLED_SFX): boolean {
  return overrides[name] ?? !defaults.includes(name);
}

/** The overrides after switching `name` to `on`, dropping the entry when that is just the default again. */
export function setCueOverride(
  overrides: CueOverrides,
  name: string,
  on: boolean,
  defaults: readonly string[] = DISABLED_SFX,
): CueOverrides {
  const next = { ...overrides };
  if (on === !defaults.includes(name)) delete next[name];
  else next[name] = on;
  return next;
}

/** Keep only overrides naming a known cue with a boolean, from whatever was in storage. */
export function parseOverrides(raw: unknown): CueOverrides {
  const out: CueOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  const known = new Set(SFX_CUES.map((c) => c.name));
  for (const [name, on] of Object.entries(raw as Record<string, unknown>)) {
    if (known.has(name) && typeof on === 'boolean') out[name] = on;
  }
  return out;
}

/** What the export button hands over: every cue that should ship off, plus what changed from today's defaults. */
export interface CueReport {
  kind: 'fansong-sound-cues';
  version: 1;
  /** The full list to put in DISABLED_SFX, in the booth's order. */
  disabled: string[];
  /** Switched off in the panel, on by default today. */
  newlyDisabled: string[];
  /** Switched back on in the panel, off by default today. */
  reEnabled: string[];
}

export function cueReport(overrides: CueOverrides, defaults: readonly string[] = DISABLED_SFX): CueReport {
  const names = SFX_CUES.map((c) => c.name);
  return {
    kind: 'fansong-sound-cues',
    version: 1,
    disabled: names.filter((n) => !cueEnabled(n, overrides, defaults)),
    newlyDisabled: names.filter((n) => !defaults.includes(n) && overrides[n] === false),
    reEnabled: names.filter((n) => defaults.includes(n) && overrides[n] === true),
  };
}

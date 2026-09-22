import type { MatchSetup, Warband } from '@fansong/content';
import type { GameMode } from '@fansong/engine';

/**
 * What the setup screen hands to the app: either a fully-specified local match
 * (built and played in-process) or an online request (matchmade and played
 * against the authoritative worker). The app turns each into a {@link MatchClient}.
 */
export type Launch =
  | { kind: 'local'; setup: MatchSetup }
  | {
      kind: 'online';
      /** [own army, a stand-in opponent until one joins] (see the matchmake request). */
      presets: [string, string];
      /** Army-builder rosters for the two sides; override `presets`. */
      warbands?: [Warband, Warband];
      seed: number;
      /** Built-in map id (the worker can't see custom maps); omitted = default board. */
      mapId?: string;
      gameMode?: GameMode;
      kings?: [number, number];
    };

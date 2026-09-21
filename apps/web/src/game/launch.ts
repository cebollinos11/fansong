import type { MatchSetup } from '@fansong/content';

/**
 * What the setup screen hands to the app: either a fully-specified local match
 * (built and played in-process) or an online request (matchmade and played
 * against the authoritative worker). The app turns each into a {@link MatchClient}.
 */
export type Launch =
  | { kind: 'local'; setup: MatchSetup }
  | { kind: 'online'; presets: [string, string]; seed: number };

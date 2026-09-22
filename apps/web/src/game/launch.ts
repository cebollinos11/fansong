import type { MatchSetup } from '@fansong/content';

/**
 * What the setup screen hands to the app: either a fully-specified local match
 * (built and played in-process) or an online room — a fresh one to create
 * (`code: null`) or an existing one to join by its code. Armies, map and mode
 * for an online match are picked in the room's lobby, not here.
 */
export type Launch = { kind: 'local'; setup: MatchSetup } | { kind: 'online'; code: string | null };

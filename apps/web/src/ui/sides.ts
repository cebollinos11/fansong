import type { Owner } from '@fansong/engine';
import type { MatchSetup } from '@fansong/content';
import { seatLabel } from './hudView.js';

// What the two sides are called wherever the game talks about them: the battle
// log, the board's banners and verdicts, the mode panel. Pure, so the wording
// is unit-testable.

/** Each side's name, indexed by owner — the same names the top bar shows. */
export type SideNames = readonly [string, string];

/**
 * The names to fall back on when there's no match to name the sides from (a
 * replay, a test): the sides' own colours on the board.
 */
export const COLOR_NAMES: SideNames = ['Blue', 'Red'];

/**
 * The sides' names for a match, as the top bar labels them (see
 * {@link seatLabel}): "You" and "AI" against the AI, "You" and "Opponent"
 * online, the armies' names in hotseat.
 */
export function sideNames(setup: MatchSetup, controlled: readonly Owner[]): SideNames {
  return [seatLabel(setup, controlled, 0), seatLabel(setup, controlled, 1)];
}

const isYou = (name: string): boolean => name === 'You';

/**
 * A side's name as a sentence's subject or object. "You" is lower-cased unless
 * it opens the sentence (`capital`); any other name is a proper noun and kept.
 */
export function sideName(names: SideNames, owner: Owner, capital = false): string {
  const name = names[owner];
  return isYou(name) && !capital ? 'you' : name;
}

/** A side's name as a possessive: "Your" / "your", "AI's", "Iron Wardens'". */
export function sidePossessive(names: SideNames, owner: Owner, capital = false): string {
  const name = names[owner];
  if (isYou(name)) return capital ? 'Your' : 'your';
  return name.endsWith('s') ? `${name}'` : `${name}'s`;
}

/**
 * A present-tense verb, given in its third-person form ("wins", "is"), agreed
 * with the side doing it: "You" takes "win", "are"; everyone else keeps it.
 */
export function sideVerb(names: SideNames, owner: Owner, verb: string): string {
  if (!isYou(names[owner])) return verb;
  if (verb === 'is') return 'are';
  if (verb === 'has') return 'have';
  if (/(s|sh|ch|x|z)es$/.test(verb)) return verb.slice(0, -2);
  return verb.endsWith('s') ? verb.slice(0, -1) : verb;
}

/** A side doing something, as a clause's start: "You win", "AI wins", "you are" mid-sentence. */
export function sideDoes(names: SideNames, owner: Owner, verb: string, capital = false): string {
  return `${sideName(names, owner, capital)} ${sideVerb(names, owner, verb)}`;
}

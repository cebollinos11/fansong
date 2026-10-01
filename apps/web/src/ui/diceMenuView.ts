/**
 * What the dice commitment menu says about each choice. Pure, so the wording
 * (and the inspired guarantee it promises) is tested without a DOM.
 */

/** What one shared roll of this many dice buys a group of `size`, and what it risks. */
export function groupHint(n: number, size: number, inspired: boolean): string {
  const sure = inspired ? ' All are inspired: the first die is a sure 6.' : '';
  const risk =
    n === 1
      ? 'A single die can never turn over, but a miss wastes all of them.'
      : 'Two failures bench you, and a roll with no successes wastes all of them.';
  return `Group of ${size}, ${n === 1 ? 'one die' : `${n} dice`} rolled once — each gets up to ${n} action${n === 1 ? '' : 's'}. ${risk}${sure}`;
}

/** What committing this many dice buys, and what it risks. */
export function diceHint(n: number, inspired: boolean): string {
  if (inspired) {
    // The sure 6 can't fail, so only the other dice can add up to a turnover.
    if (n === 1) return 'One die — inspired: a sure 6, one guaranteed action.';
    const risk =
      n - 1 >= 2 ? 'but two failures on the rest still bench you.' : 'and it can never turn over.';
    return `${n} dice — inspired: the first is a sure 6, so at least one action, up to ${n}, ${risk}`;
  }
  return n === 1
    ? 'One die — at most one action, but a single die can never turn over.'
    : `${n} dice — up to ${n} actions, but two failures bench you for the rest of the round.`;
}

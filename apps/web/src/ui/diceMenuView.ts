/**
 * What the dice commitment menu says about each choice. Pure, so the wording
 * (and the inspired guarantee it promises) is tested without a DOM.
 */

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
